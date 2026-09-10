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
  // How long we'll let a single extraction call run before giving up and
  // reporting a clear error, rather than hanging until the platform kills
  // the function with an opaque timeout.
  extractionTimeoutMs: parseInt(process.env.EXTRACTION_TIMEOUT_MS || '25000', 10),
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
