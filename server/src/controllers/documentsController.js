const Document = require('../models/Document');
const { config } = require('../config');
const { classifyFile } = require('../services/fileTypes');
const { extractStructuredData } = require('../services/extraction');
const { getChunkPlan, buildChunkInput, mergeChunkResult } = require('../services/chunking');
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
 * Reads as much of a document as fits in one request's budget, persisting
 * after every chunk, and leaves behind enough state to pick up exactly
 * where it stopped.
 *
 * This is the answer to the problem a single request/response extraction
 * can't solve: a 12-page rental agreement takes longer to read than any
 * serverless platform will hold a request open, and the person uploading
 * it doesn't care whose limit it is. So instead of one long call that
 * either finishes or loses everything, each chunk is its own bounded model
 * call whose result is saved immediately. A timeout, a crash, or a closed
 * laptop lid costs you one chunk, not the document — and `nextChunkIndex`
 * means resuming is just "keep going", not "start over". See decisions.md.
 *
 * Always does at least one chunk, so a single request always makes real
 * progress no matter how tight the budget.
 */
async function runExtractionChunks(doc, buffer, classification) {
  const startedAt = Date.now();
  const plan = await getChunkPlan({ kind: classification.kind, buffer });

  doc.extraction.totalChunks = plan.totalChunks;
  doc.extraction.unit = plan.unit;
  doc.extraction.totalUnits = plan.totalUnits;

  let chunksThisRequest = 0;
  let slowestChunkMs = 0;

  while (doc.extraction.nextChunkIndex < plan.totalChunks) {
    // Always read at least one chunk per request, so every request makes
    // real forward progress no matter how tight the budget.
    //
    // After that, the budget has to bound *total elapsed time*, not just
    // when a chunk starts — an earlier version checked only the latter and
    // a chunk beginning at 29s could run the request well past 45s, which
    // is how this earned a 504 from the edge in production. So only start
    // another chunk if the slowest one so far would still fit.
    if (chunksThisRequest > 0) {
      const elapsed = Date.now() - startedAt;
      if (elapsed + slowestChunkMs > config.requestChunkBudgetMs) break;
    }

    const chunkStartedAt = Date.now();
    const index = doc.extraction.nextChunkIndex;
    const input = await buildChunkInput({
      kind: classification.kind,
      buffer,
      filename: doc.filename,
      mimeType: doc.mimeType,
      index,
      plan,
    });

    const result = await extractStructuredData(input);
    const merged = mergeChunkResult(doc, result);

    doc.fields = merged.fields;
    doc.documentText = merged.documentText;
    doc.docType = merged.docType;
    doc.summary = merged.summary;
    doc.unreadable = merged.unreadable;
    doc.unreadableReason = merged.unreadableReason;
    doc.fieldIndex = buildFieldIndex(merged.fields);
    doc.searchableText = buildSearchableText({
      filename: doc.filename,
      docType: doc.docType,
      summary: doc.summary,
      fields: merged.fields,
    });

    doc.extraction.nextChunkIndex = index + 1;
    doc.extraction.completedChunks = index + 1;
    doc.status = doc.extraction.nextChunkIndex >= plan.totalChunks ? 'done' : 'processing';

    // Persist after every single chunk — this is the whole point.
    await doc.save();
    chunksThisRequest += 1;
    slowestChunkMs = Math.max(slowestChunkMs, Date.now() - chunkStartedAt);
  }

  return doc;
}

/**
 * Upload + start processing in one request. Short documents finish here;
 * long ones come back `processing` with real partial results already
 * readable, and the client resumes them (see `resumeDocument`).
 *
 * Still no background job queue, deliberately — see decisions.md. The
 * person this is built for uploads one document that matters and watches
 * it land; they aren't batch-ingesting a corpus overnight, so durable
 * queue infrastructure would buy them nothing and cost a lot.
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
    await runExtractionChunks(doc, buffer, classification);
  } catch (err) {
    doc.status = 'error';
    // Anything already extracted stays on the record — a document that got
    // 4 pages in before failing is far more useful than an empty error,
    // and `nextChunkIndex` still points at where to resume.
    doc.errorMessage =
      doc.extraction.completedChunks > 0
        ? `${err.message} (read ${doc.extraction.completedChunks} of ${doc.extraction.totalChunks} parts before this — retry to continue from there)`
        : err.message || 'Extraction failed for an unknown reason.';
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

/**
 * Continues reading a document that isn't finished yet — the other half of
 * chunked extraction. `POST /documents/:id/resume` picks up at
 * `nextChunkIndex`; `POST /documents/:id/retry` starts the whole document
 * over (for when the problem was the reading, not where it stopped).
 */
async function continueExtraction(req, res, { fromScratch }) {
  const doc = await Document.findById(req.params.id).select('+fileData');
  if (!doc) throw new HttpError(404, 'Document not found.');
  if (!doc.fileData) throw new HttpError(410, 'Original file bytes are no longer available.');

  const classification = classifyFile(doc.filename, doc.mimeType);
  if (classification.kind === 'unsupported') throw new HttpError(415, classification.reason);

  if (fromScratch) {
    doc.extraction.nextChunkIndex = 0;
    doc.extraction.completedChunks = 0;
    doc.fields = [];
    doc.documentText = '';
    doc.docType = null;
    doc.summary = '';
    doc.unreadable = false;
    doc.unreadableReason = null;
  } else if (doc.status === 'done') {
    return res.json(asPublicDoc(doc)); // nothing left to do
  }

  doc.status = 'processing';
  doc.errorMessage = null;
  await doc.save();

  try {
    await runExtractionChunks(doc, doc.fileData, classification);
  } catch (err) {
    doc.status = 'error';
    doc.errorMessage =
      doc.extraction.completedChunks > 0
        ? `${err.message} (read ${doc.extraction.completedChunks} of ${doc.extraction.totalChunks} parts before this — retry to continue from there)`
        : err.message || 'Extraction failed for an unknown reason.';
    await doc.save();
  }

  res.json(asPublicDoc(doc));
}

const retryDocument = (req, res) => continueExtraction(req, res, { fromScratch: true });
const resumeDocument = (req, res) => continueExtraction(req, res, { fromScratch: false });

module.exports = {
  uploadDocument,
  listDocuments,
  getDocument,
  getDocumentFile,
  deleteDocument,
  retryDocument,
  resumeDocument,
  confirmField,
};
