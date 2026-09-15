// Centralized config + validation. Fails loud and early if something required
// is missing, instead of letting a half-configured server limp along and
// throw confusing errors three layers deep later.
require('dotenv').config();

const config = {
  port: parseInt(process.env.PORT || '5050', 10),
  mongoUri: process.env.MONGODB_URI || '',
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || '',
  anthropicModel: process.env.ANTHROPIC_MODEL || 'claude-sonnet-5',
  // Netlify's synchronous function body limit is 6MB total. Base64 inflates
  // raw bytes by ~4/3, and we wrap the payload in a small JSON envelope, so
  // we cap the *original* file well under that line to leave headroom.
  maxFileBytes: parseInt(process.env.MAX_FILE_BYTES || String(4 * 1024 * 1024), 10),
  // How long we'll let a single *chunk's* model call run before giving up
  // with a clear error rather than hanging until the platform kills the
  // function. This bounds one chunk, not one document — a long document is
  // read across several requests (see documentsController#runExtractionChunks).
  //
  // This has to stay *below* the platform's request ceiling, because the
  // controller always reads at least one chunk per request — so one chunk's
  // timeout is the real worst case for the whole request. It was 45s, which
  // was longer than the ceiling and so guaranteed the edge would kill the
  // request (a 504) before our own error could ever be returned. A chunk
  // that can't finish in 24s is retried at half the size, and a single page
  // that still won't read is skipped and reported rather than failing the
  // whole document.
  //
  // 24s is measured, not guessed: on a real scanned tenancy agreement a
  // typical page took 20.7s and a dense one 34.1s. So this sits above the
  // common case and below the platform's ~26s ceiling — the occasional
  // genuinely-too-slow page is the one that gets skipped.
  extractionTimeoutMs: parseInt(process.env.EXTRACTION_TIMEOUT_MS || '24000', 10),
  // How much wall-clock one upload/resume request will spend reading chunks
  // before returning what it has and letting the client resume. The point
  // is that a document's length stops being coupled to the platform's
  // patience — so this has to sit comfortably below the edge's request
  // ceiling, not near it. Set from real evidence: a request that ran ~45s
  // in production came back as a 504 from the edge, so the budget is 18s
  // and the controller refuses to *start* a chunk that wouldn't fit.
  requestChunkBudgetMs: parseInt(process.env.REQUEST_CHUNK_BUDGET_MS || '18000', 10),
  // Same idea, for the /ask endpoint's grounded-answer call — kept as its
  // own knob since the corpus-digest prompt has different size/latency
  // characteristics than a single document's extraction.
  askTimeoutMs: parseInt(process.env.ASK_TIMEOUT_MS || '25000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
};

function assertConfigured() {
  const missing = [];
  if (!config.mongoUri) missing.push('MONGODB_URI');
  if (missing.length) {
    throw new Error(
      `Missing required environment variable(s): ${missing.join(', ')}. ` +
        'Copy .env.example to .env and fill them in.'
    );
  }
}

module.exports = { config, assertConfigured };
