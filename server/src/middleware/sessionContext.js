const { AsyncLocalStorage } = require('node:async_hooks');
const crypto = require('node:crypto');

/**
 * Per-visitor isolation.
 *
 * Sift is a single deployed link that anyone can open. Without this, every
 * visitor shares one corpus — so sending someone the link hands them your
 * tenancy agreement and your prescription. For a product whose whole pitch is
 * "documents that matter, which you can't fully read", that is the single
 * worst possible default.
 *
 * Every request carries a session id (`X-Sift-Session`), and every document
 * belongs to exactly one session.
 *
 * The enforcement deliberately does NOT live in the controllers. Scoping ~20
 * separate query sites by hand means one forgotten `.find()` is a silent
 * privacy leak that no test would obviously catch — the wrong shape entirely
 * for a rule that has to hold everywhere. Instead the session travels in
 * AsyncLocalStorage and is injected by Mongoose query middleware (see
 * models/Document.js), so a query is scoped whether or not whoever wrote it
 * remembered. Code added later inherits the rule for free.
 */
const storage = new AsyncLocalStorage();

const HEADER = 'x-sift-session';
// Long enough that ids aren't guessable — a session id is the only thing
// standing between two visitors' documents.
const ID_BYTES = 24;

function newSessionId() {
  return crypto.randomBytes(ID_BYTES).toString('hex');
}

/** The current request's session, or undefined outside a request. */
function getSessionId() {
  return storage.getStore()?.sessionId;
}

/** Run `fn` inside an explicit session — used by the eval harness and tests. */
function runWithSession(sessionId, fn) {
  return storage.run({ sessionId }, fn);
}

function isValidId(value) {
  return typeof value === 'string' && /^[a-f0-9]{16,128}$/i.test(value);
}

/**
 * Establishes the session for the request. A client that doesn't send one
 * (or sends a malformed one) gets a fresh session rather than an error —
 * being handed an empty workspace is the correct, safe outcome, and it keeps
 * first contact with the API from needing a handshake.
 */
function sessionMiddleware(req, res, next) {
  // The header is the normal channel. The query string exists for exactly one
  // caller: the `navigator.sendBeacon` that fires as the tab closes, which
  // cannot set headers. It's the visitor's own id going back to the origin
  // that issued it, so there's nothing being exposed that wasn't already.
  const supplied = req.get(HEADER) || req.query.session;
  const sessionId = isValidId(supplied) ? supplied.toLowerCase() : newSessionId();
  // Echo it back so a client that didn't have one can adopt it.
  res.set('X-Sift-Session', sessionId);
  storage.run({ sessionId }, next);
}

module.exports = { sessionMiddleware, getSessionId, runWithSession, newSessionId, HEADER };
