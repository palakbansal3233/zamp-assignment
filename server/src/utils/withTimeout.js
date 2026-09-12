// Shared timeout wrapper — used everywhere we make a Claude API call that
// could otherwise hang until the platform kills the request with an opaque
// error. Originally lived inline in services/extraction.js; pulled out once
// services/askEngine.js needed the exact same behavior.
function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

module.exports = { withTimeout };
