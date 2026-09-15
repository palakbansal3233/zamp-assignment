const { buildCorpusDigest } = require('../services/corpusDigest');
const { getSessionId } = require('../middleware/sessionContext');
const {
  askModel,
  verifyCitations,
  computeConflicts,
  generateSuggestions,
  computeCorpusFingerprint,
} = require('../services/askEngine');
const SuggestionCache = require('../models/SuggestionCache');
const { HttpError } = require('../middleware/errorHandler');

async function askQuestion(req, res) {
  const question = String((req.body && req.body.question) || '').trim();
  if (!question) throw new HttpError(400, 'Missing "question".');

  const digest = await buildCorpusDigest({ questionForPrefilter: question });

  if (digest.length === 0) {
    return res.json({
      question,
      refused: true,
      reason: 'No documents have been read yet.',
      answer: null,
      citations: [],
      caveats: [],
      sensitive: false,
      sensitiveFields: [],
    });
  }

  const raw = await askModel(question, digest);
  const verified = await verifyCitations(raw.citations);

  // The core safety rule: a non-refused answer with zero surviving
  // citations is not a grounded answer, it's a guess that happened to cite
  // things that don't check out. Treat it as a refusal instead of showing
  // it — see decisions.md.
  const refused = Boolean(raw.refused) || verified.length === 0;

  if (refused) {
    return res.json({
      question,
      refused: true,
      reason: raw.refusal_reason || (verified.length === 0 && !raw.refused
        ? 'The proposed citations did not check out against the stored documents.'
        : 'Nothing in the corpus supports an answer.'),
      answer: null,
      citations: [],
      caveats: [],
      sensitive: false,
      sensitiveFields: [],
    });
  }

  const caveats = computeConflicts(verified);
  const sensitiveFields = verified.filter((c) => c.sensitive).map((c) => c.fieldKey);

  res.json({
    question,
    refused: false,
    answer: raw.answer,
    citations: verified.map((c) => ({
      documentId: c.documentId,
      filename: c.filename,
      fieldKey: c.fieldKey,
      label: c.label,
      value: c.value,
      quote: c.quote,
    })),
    caveats,
    sensitive: sensitiveFields.length > 0,
    sensitiveFields,
  });
}

async function getSuggestions(req, res) {
  const fingerprint = await computeCorpusFingerprint();
  const cached = await SuggestionCache.findById(getSessionId()).lean();

  // An empty cached list is never worth trusting — see below.
  if (cached && cached.fingerprint === fingerprint && cached.questions.length > 0) {
    return res.json({ questions: cached.questions });
  }

  const digest = await buildCorpusDigest({});
  const questions = await generateSuggestions(digest);

  // Only cache a real result. Generation can come back empty for transient
  // reasons (the model returns no tool_use, a call is cut short), and caching
  // that pins the Ask screen to an empty suggestion list until the corpus
  // *itself* changes — which, for someone who has finished uploading, is
  // never. Observed exactly that: a cache holding zero questions against a
  // current fingerprint, serving empty indefinitely. Not storing the empty
  // case costs one retried call and lets it heal itself.
  if (questions.length > 0) {
    await SuggestionCache.findByIdAndUpdate(
      getSessionId(),
      { fingerprint, questions, generatedAt: new Date() },
      { upsert: true }
    );
  }

  res.json({ questions });
}

module.exports = { askQuestion, getSuggestions };
