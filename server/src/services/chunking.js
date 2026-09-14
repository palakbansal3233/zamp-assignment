const { PDFDocument } = require('pdf-lib');
const mammoth = require('mammoth');
const { HttpError } = require('../middleware/errorHandler');

// A 12-page rental agreement is the document that matters most to the person
// this is built for — and it's exactly the one that blows a single
// request/response extraction budget. So a document isn't one model call
// any more: it's a sequence of bounded chunks, each persisted as it
// completes. See decisions.md ("Long documents").
// Two pages per chunk, not three: a text-dense contract page takes real
// time to read, and the whole scheme only works if a single chunk
// comfortably fits inside one request. Smaller chunks mean more requests,
// which is fine — they're cheap and each one lands saved progress.
const PAGES_PER_CHUNK = 2;
const CHARS_PER_CHUNK = 12000;

async function docxToText(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value || '';
}

/**
 * Works out how many chunks a document splits into, without doing any
 * model work. Cheap enough to re-run on every resume request, which keeps
 * the whole flow stateless — nothing about the split is persisted except
 * the counts, so a resume never depends on in-memory state from an earlier
 * invocation (it can't: each one is a separate serverless container).
 */
async function getChunkPlan({ kind, buffer }) {
  if (kind === 'pdf') {
    let pdf;
    try {
      pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    } catch (err) {
      throw new HttpError(
        422,
        'This PDF could not be opened — it may be password-protected or corrupted. Try exporting an unlocked copy.'
      );
    }
    const pages = pdf.getPageCount();
    return { totalChunks: Math.max(1, Math.ceil(pages / PAGES_PER_CHUNK)), totalUnits: pages, unit: 'page' };
  }

  if (kind === 'docx' || kind === 'text') {
    const text = kind === 'docx' ? await docxToText(buffer) : buffer.toString('utf-8');
    return {
      totalChunks: Math.max(1, Math.ceil(text.length / CHARS_PER_CHUNK)),
      totalUnits: text.length,
      unit: 'char',
      text,
    };
  }

  // An image is one look — there's nothing to split.
  return { totalChunks: 1, totalUnits: 1, unit: 'whole' };
}

/**
 * Materializes the actual payload for chunk `index` — for a PDF that means
 * building a real, smaller PDF containing only that page range, so the
 * model sees a genuine document rather than a description of one.
 */
async function buildChunkInput({ kind, buffer, filename, mimeType, index, plan }) {
  const isSingleChunk = plan.totalChunks === 1;
  const chunkContext = isSingleChunk
    ? null
    : { index, total: plan.totalChunks, unit: plan.unit };

  if (kind === 'pdf') {
    if (isSingleChunk) return { kind: 'pdf', filename, buffer, chunkContext };
    const source = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const start = index * PAGES_PER_CHUNK;
    const end = Math.min(start + PAGES_PER_CHUNK, source.getPageCount());
    const slice = await PDFDocument.create();
    const pages = await slice.copyPages(source, Array.from({ length: end - start }, (_, i) => start + i));
    pages.forEach((p) => slice.addPage(p));
    const bytes = await slice.save();
    return {
      kind: 'pdf',
      filename,
      buffer: Buffer.from(bytes),
      chunkContext: { ...chunkContext, label: `pages ${start + 1}-${end} of ${source.getPageCount()}` },
    };
  }

  if (kind === 'docx' || kind === 'text') {
    const text = plan.text ?? buffer.toString('utf-8');
    const start = index * CHARS_PER_CHUNK;
    const slice = text.slice(start, start + CHARS_PER_CHUNK);
    return {
      kind: 'text',
      filename,
      text: slice,
      chunkContext: chunkContext && { ...chunkContext, label: `part ${index + 1} of ${plan.totalChunks}` },
    };
  }

  return { kind: 'image', filename, buffer, mimeType, chunkContext: null };
}

/**
 * Folds one chunk's result into the document being built up.
 *
 * Two rules that matter, both chosen so a later chunk can never quietly
 * weaken what an earlier one found:
 *  - on a duplicate field key, the higher-confidence reading wins;
 *  - `needsReview` and `sensitive` are sticky — if any chunk flagged a
 *    field, the merged field stays flagged. A warning that disappears
 *    because a later page happened to mention the same key more
 *    confidently is exactly the kind of silent downgrade this product
 *    can't afford.
 */
function mergeChunkResult(existing, result) {
  const fieldsByKey = new Map((existing.fields || []).map((f) => [f.key, f]));

  for (const incoming of result.fields || []) {
    const current = fieldsByKey.get(incoming.key);
    if (!current) {
      fieldsByKey.set(incoming.key, incoming);
      continue;
    }
    const winner = (incoming.confidence ?? 0) > (current.confidence ?? 0) ? incoming : current;
    fieldsByKey.set(incoming.key, {
      ...winner,
      needsReview: current.needsReview || incoming.needsReview,
      reviewNote: current.reviewNote || incoming.reviewNote,
      reviewActions: current.reviewActions?.length ? current.reviewActions : incoming.reviewActions,
      sensitive: current.sensitive || incoming.sensitive,
      sensitivityReason: current.sensitivityReason || incoming.sensitivityReason,
      confirmed: current.confirmed || incoming.confirmed,
      resolvedAction: current.resolvedAction || incoming.resolvedAction,
    });
  }

  const mergedText = [existing.documentText, result.documentText].filter(Boolean).join('\n\n');
  const mergedFields = Array.from(fieldsByKey.values());

  // "Unreadable" is a statement about the whole document, so it can only be
  // decided from the merged state: nothing was transcribed, nothing was
  // extracted, anywhere, and this chunk agrees it couldn't read anything.
  // (Deriving it from the previous value instead doesn't work — a fresh
  // document's `unreadable` defaults to false, which is indistinguishable
  // from "an earlier chunk read fine".)
  const unreadable = Boolean(result.unreadable) && mergedText.length === 0 && mergedFields.length === 0;

  return {
    fields: mergedFields,
    documentText: mergedText,
    // Keep the first real classification/summary we got — a later chunk of
    // a rental agreement shouldn't relabel the whole thing as "other"
    // just because page 9 is a signature block.
    docType: existing.docType || (result.unreadable ? null : result.docType),
    summary: existing.summary || result.summary,
    unreadable,
    unreadableReason: unreadable ? existing.unreadableReason || result.unreadableReason : null,
  };
}

module.exports = { getChunkPlan, buildChunkInput, mergeChunkResult, docxToText, PAGES_PER_CHUNK, CHARS_PER_CHUNK };
