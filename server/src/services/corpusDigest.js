const mongoose = require('mongoose');
const Document = require('../models/Document');

const MAX_DOCS = 50;
const MAX_FIELDS_PER_DOC = 40;

/**
 * Builds a compact view of the extracted corpus for a Claude call to reason
 * over — this *is* the retrieval step for /ask, deliberately not a vector
 * search: the corpus is already structured (that's the whole point of the
 * rest of this app), so grounding the model in the extracted fields
 * directly is simpler and more precise than round-tripping through an
 * embedding index, at the scale a document-at-a-time tool like this
 * actually operates at. See decisions.md.
 *
 * @param {object} [opts]
 * @param {string} [opts.questionForPrefilter] - if the corpus exceeds
 *   MAX_DOCS, use this question to shortlist the most relevant documents via
 *   the existing $text index rather than arbitrarily truncating by recency.
 * @param {number} [opts.maxDocs]
 * @param {number} [opts.maxFieldsPerDoc]
 * @param {string} [opts.documentId] - restrict the digest to a single
 *   document. This is what makes "Ask this document" mean it: the model is
 *   never shown the rest of the corpus, so it cannot answer from a document
 *   the person wasn't looking at, and a citation to one is impossible rather
 *   than merely discouraged.
 */
async function buildCorpusDigest(opts = {}) {
  const maxDocs = opts.maxDocs || MAX_DOCS;
  const maxFieldsPerDoc = opts.maxFieldsPerDoc || MAX_FIELDS_PER_DOC;
  const projection = 'filename docType summary fields';

  let docs;

  // Scoped to one document: no prefilter, no recency fallback, no corpus.
  if (opts.documentId) {
    if (!mongoose.isValidObjectId(opts.documentId)) return [];
    docs = await Document.find({ _id: opts.documentId, status: 'done' }, projection).lean();
    return docs.map(toDigestEntry(maxFieldsPerDoc));
  }

  const total = await Document.countDocuments({ status: 'done' });
  if (total > maxDocs && opts.questionForPrefilter) {
    docs = await Document.find({ status: 'done', $text: { $search: opts.questionForPrefilter } }, projection)
      .sort({ score: { $meta: 'textScore' } })
      .limit(maxDocs)
      .lean();
    // A $text search can legitimately return nothing if the question shares
    // no keywords with any document — fall back to "most recent" rather
    // than handing the model an empty corpus when one plainly exists.
    if (docs.length === 0) {
      docs = await Document.find({ status: 'done' }, projection).sort({ createdAt: -1 }).limit(maxDocs).lean();
    }
  } else {
    docs = await Document.find({ status: 'done' }, projection).sort({ createdAt: -1 }).limit(maxDocs).lean();
  }

  return docs.map(toDigestEntry(maxFieldsPerDoc));
}

function toDigestEntry(maxFieldsPerDoc) {
  return (doc) => ({
    documentId: String(doc._id),
    filename: doc.filename,
    docType: doc.docType,
    summary: doc.summary,
    fields: (doc.fields || []).slice(0, maxFieldsPerDoc).map((f) => ({
      key: f.key,
      label: f.label,
      value: f.value,
      sensitive: Boolean(f.sensitive),
    })),
  });
}

module.exports = { buildCorpusDigest, MAX_DOCS, MAX_FIELDS_PER_DOC };
