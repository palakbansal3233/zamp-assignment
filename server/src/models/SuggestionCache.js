const mongoose = require('mongoose');

const { Schema } = mongoose;

// A single-row cache of "questions this corpus can answer" so GET
// /ask/suggestions doesn't call the model on every page load — regenerated
// only when the corpus has actually changed (see
// askEngine.js#computeCorpusFingerprint), via upsert on a fixed _id.
const SuggestionCacheSchema = new Schema(
  {
    _id: { type: String, default: 'singleton' },
    fingerprint: { type: String, required: true },
    questions: {
      type: [new Schema({ text: String, docTypes: [String] }, { _id: false })],
      default: [],
    },
    generatedAt: { type: Date, default: Date.now },
  },
  { minimize: false }
);

module.exports = mongoose.model('SuggestionCache', SuggestionCacheSchema);
