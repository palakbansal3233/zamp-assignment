// Shared timeout wrapper — used everywhere we make a Claude API call that
// could otherwise hang until the platform kills the request with an opaque
// error. Originally lived inline in services/extraction.js; pulled out once
// services/askEngine.js needed the exact same behavior.
// The error carries a `timedOut` flag because callers need to *act* on a
// timeout specifically (a slow chunk gets retried smaller — see
// documentsController#runExtractionChunks), and matching on the message
// text would silently stop working the first time someone reworded it.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(message);
      err.timedOut = true;
      reject(err);
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };
