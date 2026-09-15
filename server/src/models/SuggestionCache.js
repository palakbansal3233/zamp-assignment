const mongoose = require('mongoose');
const { config } = require('../config');

const { Schema } = mongoose;

// A per-session cache of "things you could ask" so GET /ask/suggestions
// doesn't call the model on every page load — regenerated only when that
// session's corpus has actually changed (see
// askEngine.js#computeCorpusFingerprint), via upsert.
//
// `_id` is the session id, not a fixed 'singleton'. It used to be the
// latter, which quietly made this shared state: one visitor's suggestions —
// derived from, and describing, their documents — would have been served to
// the next person to open the link. Keying by session is what makes the row
// belong to someone.
const SuggestionCacheSchema = new Schema(
  {
    _id: { type: String }, // sessionId
    fingerprint: { type: String, required: true },
    questions: {
      type: [new Schema({ text: String, docTypes: [String] }, { _id: false })],
      default: [],
    },
    generatedAt: { type: Date, default: Date.now },
    // Same backstop as documents: if a session never says goodbye, it still
    // doesn't linger forever.
    expiresAt: { type: Date, default: () => new Date(Date.now() + config.sessionTtlMs), index: { expires: 0 } },
  },
  { minimize: false }
);

module.exports = mongoose.model('SuggestionCache', SuggestionCacheSchema);
