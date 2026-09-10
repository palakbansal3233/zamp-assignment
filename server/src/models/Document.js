const mongoose = require('mongoose');

const { Schema } = mongoose;

// Documents arrive as anything from an invoice to a handwritten note, so the
// extracted fields have no fixed shape. We deliberately use Schema.Types.Mixed
// for `fields` rather than a per-document-type collection or a rigid schema —
// see decisions.md ("Dynamic schema over per-type collections").
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

    // The dynamic, arbitrarily-shaped structured data extracted from the doc.
    fields: { type: Schema.Types.Mixed, default: {} },
    lowConfidenceFields: { type: [String], default: [] },
    unreadable: { type: Boolean, default: false },
    unreadableReason: { type: String, default: null },

    // Flattened concatenation of every string/number leaf in `fields`, plus
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
    // empty object ({}) before saving. That's exactly what an "unreadable"
    // document's `fields` legitimately is — without this, it would silently
    // come back as `undefined` instead of `{}`, which is a meaningfully
    // different signal to the client (missing data vs. "we checked, there's
    // nothing here").
    minimize: false,
  }
);

module.exports = mongoose.model('Document', DocumentSchema);
