const { ExtractionConfigError } = require('../services/extraction');

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Single place that turns any thrown error into a consistent JSON shape the
// client can render as a message, instead of a generic "Something went
// wrong" or a leaked stack trace.
function errorHandler(err, req, res, _next) {
  if (res.headersSent) return;

  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message });
  }
  if (err instanceof ExtractionConfigError) {
    return res.status(503).json({ error: err.message });
  }
  if (err?.status === 401 || err?.status === 403) {
    // Anthropic SDK error shape for a bad/missing API key.
    return res.status(502).json({ error: 'The AI extraction service rejected our API key. Check ANTHROPIC_API_KEY.' });
  }
  if (err?.code === 27 && /text index/.test(err?.message || '')) {
    // Belt-and-suspenders alongside db/connect.js awaiting Document.init():
    // if this still somehow races on a brand-new database, tell the user
    // to retry in a second rather than showing a raw Mongo error.
    return res.status(503).json({ error: 'Search is still finishing initial setup — try again in a moment.' });
  }

  console.error('[unhandled]', err); // eslint-disable-line no-console
  const status = err?.status && Number.isInteger(err.status) ? err.status : 500;
  res.status(status).json({ error: err?.message || 'Something went wrong on the server.' });
}

module.exports = { errorHandler, HttpError };
