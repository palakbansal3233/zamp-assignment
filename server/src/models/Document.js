const mongoose = require('mongoose');

const { Schema } = mongoose;

// One extracted field, however the document arrived. Each is its own
// subdocument rather than a flat `{key: value}` map because a real field
// carries a lot more than a value now: where it came from (`quote`, matched
// against `documentText` client-side to drive the Review screen's
// click-to-highlight provenance), how sure the model was, whether it needs a
// human's confirmation (and, if so, what the plausible resolutions are), and
// whether it's sensitive enough to warrant a caution before it's cited in an
// answer. `key` stays the stable identifier (used in the PATCH route and as
// the React list key); `label` is what's actually shown.
const FieldSchema = new Schema(
  {
    key: { type: String, required: true },
    label: { type: String, default: '' },
    value: { type: Schema.Types.Mixed },

    // Verbatim substring of `documentText` this value came from. '' means
    // the model couldn't point at one clean span (e.g. a value it inferred
    // rather than read directly) — the client just won't highlight it; a
    // quote that turns out not to actually appear in documentText (a
    // hallucinated span) degrades the same way, never breaks anything.
    quote: { type: String, default: '' },

    confidence: { type: Number, default: null, min: 0, max: 1 },

    // Upgrades the old flat `lowConfidenceFields: [string]` list into a
    // first-class per-field concept: a reason, and concrete resolutions the
    // model itself proposed (e.g. ["Keep 4%", "Keep 496.00"]) rather than
    // just a generic "are you sure?".
    needsReview: { type: Boolean, default: false },
    reviewNote: { type: String, default: null },
    reviewActions: { type: [String], default: [] },

    // Set once a human picks a resolution via PATCH /documents/:id/fields/:key.
    confirmed: { type: Boolean, default: false },
    resolvedAction: { type: String, default: null },

    // The model's own judgment that this value is sensitive (PII, financial
    // account details, health information, an internal-only figure). Ask
    // only ever trusts this stored value when deciding whether to caution
    // on a citation — never whatever the model's answer text happens to say
    // at ask-time, which could omit it.
    sensitive: { type: Boolean, default: false },
    sensitivityReason: { type: String, default: null },
  },
  { _id: false }
);

const DocumentSchema = new Schema(
  {
    filename: { type: String, required: true },
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },

    status: {
      type: String,
      enum: ['processing', 'done', 'error'],
      default: 'processing',
      index: true,
    },
    errorMessage: { type: String },

    // Best-effort classification, e.g. "invoice", "resume", "handwritten_note".
    // Not an enum on purpose — the whole point is we don't know the domain
    // ahead of time.
    docType: { type: String, default: null, index: true },
    summary: { type: String, default: '' },

    // The dynamic, arbitrarily-shaped structured data extracted from the
    // document — see decisions.md ("Dynamic schema over per-type
    // collections", and the later note on why this is an array of
    // descriptors rather than a flat Mixed object). One entry per top-level
    // extracted concept; a naturally nested value (e.g. an invoice's line
    // items) stays as one field whose `value` is itself an array/object,
    // not flattened into one descriptor per leaf.
    fields: { type: [FieldSchema], default: [] },

    // Derived, read-only `{key: value}` shadow of `fields`, rebuilt every
    // time `fields` is written (see utils/flatten.js#buildFieldIndex).
    // Exists purely so smart-search filtering (services/queryBuilder.js)
    // can keep querying a flat `fieldIndex.<key>` path instead of needing
    // `$elemMatch` against the fields array — see decisions.md for why that
    // tradeoff was made. Never set directly from a request body.
    fieldIndex: { type: Schema.Types.Mixed, default: {} },

    // The model's full verbatim transcription of the document (capped —
    // see extraction.js), used purely as the substring-match target for
    // `fields[].quote`. Not shown as "the extracted data" itself.
    documentText: { type: String, default: '' },

    // Where we are in reading a long document. A 12-page agreement is read
    // in bounded chunks with results persisted after each one, so progress
    // survives a timeout, a crash, or a closed tab — and so the progress
    // bar in the UI reports something real. See services/chunking.js.
    extraction: {
      totalChunks: { type: Number, default: 0 },
      completedChunks: { type: Number, default: 0 },
      nextChunkIndex: { type: Number, default: 0 },
      unit: { type: String, default: 'whole' }, // 'page' | 'char' | 'whole'
      totalUnits: { type: Number, default: 0 },
      // How many pages this particular document is read at a time. Normally
      // the default, but a scanned/photographed page is far slower to read
      // than a text one, so a chunk that times out gets retried smaller and
      // that narrower size is remembered here. It has to be persisted, not
      // just held in memory: each resume is a separate serverless container,
      // and without this the next one would go straight back to the size
      // that already proved too slow.
      pagesPerChunk: { type: Number, default: 0 },
      // Pages that could not be read even on their own, and were skipped so
      // the rest of the document could still be delivered. Recorded rather
      // than hidden — "here is the document, minus page 4" is honest and
      // useful; silently returning six pages as though they were seven is
      // neither.
      unreadableParts: { type: [Number], default: [] },
    },

    unreadable: { type: Boolean, default: false },
    unreadableReason: { type: String, default: null },

    // Flattened concatenation of every field's key/label/value, plus
    // summary/docType/filename — rebuilt on every save. Powers full-text
    // search without needing per-field indexes we can't predict in advance.
    searchableText: { type: String, default: '', index: 'text' },

    // Original bytes, capped by config.maxFileBytes, kept so the UI can show
    // the source alongside what we extracted from it (crucial for trust —
    // the user should be able to check our work).
    fileData: { type: Buffer, select: false },
  },
  {
    timestamps: true,
    // Mongoose's default `minimize: true` strips any key whose value is an
    // empty object ({}) before saving. `fieldIndex` legitimately is `{}` for
    // an unreadable document — without this, it would silently come back as
    // `undefined` instead of `{}`, a meaningfully different signal (missing
    // data vs. "we checked, there's nothing here").
    minimize: false,
  }
);

module.exports = mongoose.model('Document', DocumentSchema);
