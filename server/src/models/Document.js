const mongoose = require('mongoose');
const { config } = require('../config');
const { getSessionId } = require('../middleware/sessionContext');

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
    // Which visitor's workspace this belongs to. Everything in this file is
    // scoped by it — see the query middleware at the bottom.
    sessionId: { type: String, required: true, index: true },

    // A backstop for cleanup, not the primary mechanism. The client deletes
    // its own documents when the tab goes away; this catches the cases a
    // beacon can't (a crashed browser, a killed mobile tab, a lost network)
    // so nothing lingers indefinitely just because a goodbye was missed.
    expiresAt: { type: Date, default: () => new Date(Date.now() + config.sessionTtlMs), index: { expires: 0 } },

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

// ── session scoping ───────────────────────────────────────────────────────
// Enforced here rather than in each controller on purpose: there are around
// twenty query sites, and a single forgotten `.find()` would leak one
// visitor's documents to another. A rule that must hold everywhere belongs
// in one place that cannot be bypassed by forgetting, so queries inherit it
// whether or not the caller thought about it.
const SCOPED_QUERIES = [
  'find', 'findOne', 'findOneAndUpdate', 'findOneAndDelete', 'findOneAndReplace',
  'countDocuments', 'distinct', 'deleteMany', 'deleteOne', 'updateMany', 'updateOne',
];

DocumentSchema.pre(SCOPED_QUERIES, function scopeToSession() {
  const sessionId = getSessionId();
  // Outside a request (a migration, a one-off script) there is no session to
  // scope to. Filtering on `undefined` would silently match nothing and look
  // like data loss, so leave the query alone — every HTTP path goes through
  // sessionMiddleware and therefore always has one.
  if (!sessionId) return;
  this.setQuery({ ...this.getQuery(), sessionId });
});

// pre('validate'), not pre('save'): Mongoose runs validation as its own
// built-in pre-save hook before user hooks, so stamping on save would land
// after 'sessionId is required' had already failed.
DocumentSchema.pre('validate', function stampSession(next) {
  if (!this.sessionId) {
    const sessionId = getSessionId();
    if (!sessionId) return next(new Error('Refusing to save a document with no session — it would be visible to nobody.'));
    this.sessionId = sessionId;
  }
  next();
});

module.exports = mongoose.model('Document', DocumentSchema);
