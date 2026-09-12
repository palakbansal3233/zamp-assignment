const Document = require('../models/Document');
const { config } = require('../config');
const { classifyFile } = require('../services/fileTypes');
const { extractStructuredData } = require('../services/extraction');
const { buildSearchableText, buildFieldIndex } = require('../utils/flatten');
const { HttpError } = require('../middleware/errorHandler');

const LIST_PROJECTION = '-fileData -searchableText';

function asPublicDoc(doc) {
  const obj = doc.toObject ? doc.toObject() : doc;
  delete obj.fileData;
  delete obj.searchableText;
  delete obj.__v;
  return obj;
}

/**
 * Upload + process a document in one synchronous request/response.
 *
 * Why synchronous rather than a background job queue: Netlify Functions have
 * no durable queue to hand work off to, and standing up one (SQS-alike +
 * poller) was disproportionate for a document-at-a-time assignment. The
 * tradeoff, spelled out in decisions.md, is that very large or multi-page
 * documents risk the platform's function timeout — we mitigate with a strict
 * file-size cap and an explicit internal timeout that fails with a clear
 * message instead of hanging.
 */
async function uploadDocument(req, res) {
  const { filename, mimeType, dataBase64 } = req.body || {};

  if (!filename || typeof filename !== 'string') {
    throw new HttpError(400, 'Missing "filename".');
  }
  if (!dataBase64 || typeof dataBase64 !== 'string') {
    throw new HttpError(400, 'Missing file data.');
  }

  let buffer;
  try {
    buffer = Buffer.from(dataBase64, 'base64');
  } catch {
    throw new HttpError(400, 'File data is not valid base64.');
  }
  if (buffer.length === 0) {
    throw new HttpError(400, 'The file appears to be empty.');
  }
  if (buffer.length > config.maxFileBytes) {
    const mb = (config.maxFileBytes / (1024 * 1024)).toFixed(1);
    throw new HttpError(413, `"${filename}" is too large. Max file size is ${mb}MB.`);
  }

  const classification = classifyFile(filename, mimeType);
  if (classification.kind === 'unsupported') {
    throw new HttpError(415, classification.reason);
  }

  const doc = await Document.create({
    filename,
    mimeType: mimeType || 'application/octet-stream',
    sizeBytes: buffer.length,
    status: 'processing',
    fileData: buffer,
  });

  try {
    const extractionInput =
      classification.kind === 'text'
        ? { kind: 'text', filename, text: buffer.toString('utf-8').slice(0, 50000) }
        : classification.kind === 'image'
        ? { kind: 'image', filename, buffer, mimeType }
        : { kind: 'pdf', filename, buffer };

    const result = await extractStructuredData(extractionInput);

    doc.status = 'done';
    doc.unreadable = result.unreadable;
    doc.unreadableReason = result.unreadableReason;
    doc.docType = result.unreadable ? null : result.docType;
    doc.summary = result.summary;
    doc.fields = result.fields;
    doc.documentText = result.documentText;
    doc.fieldIndex = buildFieldIndex(result.fields);
    doc.searchableText = buildSearchableText({
      filename,
      docType: doc.docType,
      summary: doc.summary,
      fields: doc.fields,
    });
    await doc.save();
  } catch (err) {
    doc.status = 'error';
    doc.errorMessage = err.message || 'Extraction failed for an unknown reason.';
    await doc.save();
    // Still return 201 — the upload succeeded and is queryable; only
    // extraction failed. The client shows the per-document error inline
    // rather than treating the whole request as failed.
  }

  res.status(201).json(asPublicDoc(doc));
}

async function listDocuments(req, res) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));

  const [items, total] = await Promise.all([
    Document.find({}, LIST_PROJECTION).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
    Document.countDocuments({}),
  ]);

  res.json({ items, total, page, limit, totalPages: Math.max(1, Math.ceil(total / limit)) });
}

async function getDocument(req, res) {
  const doc = await Document.findById(req.params.id, LIST_PROJECTION).lean();
  if (!doc) throw new HttpError(404, 'Document not found.');

  // "Fields this document added to the dataset" — computed at read time
  // (not stored) so it can't go stale if other documents are later deleted
  // or edited. Cheap: one distinct() over an already-indexed-by-nothing but
  // small collection, not run on every list/upload, only when a document is
  // actually opened.
  const priorKeys = new Set(
    await Document.distinct('fields.key', { _id: { $ne: doc._id }, status: 'done' })
  );
  doc.newFieldKeys = (doc.fields || []).map((f) => f.key).filter((k) => !priorKeys.has(k));

  res.json(doc);
}

async function confirmField(req, res) {
  const { id, key } = req.params;
  const { value, confirmed, resolvedAction } = req.body || {};

  const doc = await Document.findById(id);
  if (!doc) throw new HttpError(404, 'Document not found.');

  const field = doc.fields.find((f) => f.key === key);
  if (!field) throw new HttpError(404, `No field "${key}" on this document.`);

  if (value !== undefined) field.value = value;
  if (typeof resolvedAction === 'string') field.resolvedAction = resolvedAction;
  field.confirmed = confirmed !== undefined ? Boolean(confirmed) : true;
  field.needsReview = false;

  doc.fieldIndex = buildFieldIndex(doc.fields);
  doc.searchableText = buildSearchableText({
    filename: doc.filename,
    docType: doc.docType,
    summary: doc.summary,
    fields: doc.fields,
  });
  await doc.save();

  res.json(asPublicDoc(doc));
}

async function getDocumentFile(req, res) {
  // Deliberately NOT .lean() here: lean() skips Mongoose's schema-based
  // casting, so a Buffer path comes back as the driver's raw BSON Binary
  // instead of a real Buffer — and res.send() on that silently serializes
  // it as a base64 *string* instead of sending raw bytes. Hydrating a real
  // document keeps the Buffer type honest.
  const doc = await Document.findById(req.params.id).select('+fileData filename mimeType');
  if (!doc || !doc.fileData) throw new HttpError(404, 'File not found.');
  res.setHeader('Content-Type', doc.mimeType || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(doc.filename)}"`);
  res.send(doc.fileData);
}

async function deleteDocument(req, res) {
  const doc = await Document.findByIdAndDelete(req.params.id);
  if (!doc) throw new HttpError(404, 'Document not found.');
  res.status(204).end();
}

async function retryDocument(req, res) {
  const doc = await Document.findById(req.params.id).select('+fileData');
  if (!doc) throw new HttpError(404, 'Document not found.');
  if (!doc.fileData) throw new HttpError(410, 'Original file bytes are no longer available to retry.');

  const classification = classifyFile(doc.filename, doc.mimeType);
  if (classification.kind === 'unsupported') throw new HttpError(415, classification.reason);

  doc.status = 'processing';
  doc.errorMessage = null;
  await doc.save();

  try {
    const extractionInput =
      classification.kind === 'text'
        ? { kind: 'text', filename: doc.filename, text: doc.fileData.toString('utf-8').slice(0, 50000) }
        : classification.kind === 'image'
        ? { kind: 'image', filename: doc.filename, buffer: doc.fileData, mimeType: doc.mimeType }
        : { kind: 'pdf', filename: doc.filename, buffer: doc.fileData };

    const result = await extractStructuredData(extractionInput);
    doc.status = 'done';
    doc.unreadable = result.unreadable;
    doc.unreadableReason = result.unreadableReason;
    doc.docType = result.unreadable ? null : result.docType;
    doc.summary = result.summary;
    doc.fields = result.fields;
    doc.documentText = result.documentText;
    doc.fieldIndex = buildFieldIndex(result.fields);
    doc.searchableText = buildSearchableText({
      filename: doc.filename,
      docType: doc.docType,
      summary: doc.summary,
      fields: doc.fields,
    });
  } catch (err) {
    doc.status = 'error';
    doc.errorMessage = err.message || 'Extraction failed for an unknown reason.';
  }
  await doc.save();
  res.json(asPublicDoc(doc));
}

module.exports = {
  uploadDocument,
  listDocuments,
  getDocument,
  getDocumentFile,
  deleteDocument,
  retryDocument,
  confirmField,
};
