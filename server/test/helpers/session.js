const supertest = require('supertest');
const { HEADER, runWithSession } = require('../../src/middleware/sessionContext');

// Documents are scoped to a visitor's session, so a test has to pick one and
// use it on both sides: the HTTP requests it makes, and anything it seeds
// straight into the database. Getting those two out of step doesn't throw —
// it just quietly returns an empty list, which is a confusing way to fail.
const TEST_SESSION = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';
// A second one, for proving isolation actually holds.
const OTHER_SESSION = '0f9e8d7c6b5a40312918f7e6d5c4b3a2';

/**
 * supertest, with the session header already attached — so the ~100 existing
 * `request(app).get(...)` call sites keep working untouched.
 */
function request(app, sessionId = TEST_SESSION) {
  const agent = supertest(app);
  const verb = (method) => (path) => agent[method](path).set(HEADER, sessionId);
  return {
    get: verb('get'),
    post: verb('post'),
    put: verb('put'),
    patch: verb('patch'),
    delete: verb('delete'),
  };
}

/**
 * Run direct model work (seeding, unit-testing a service) inside a session.
 *
 * The `await` inside matters and is not tidiness. A Mongoose query is lazy:
 * `() => Document.find({})` merely *builds* one and returns it, so without
 * awaiting here the AsyncLocalStorage context would be gone by the time the
 * query actually ran, and the scoping hook would see no session and quietly
 * skip — handing back every session's documents. Awaiting inside keeps
 * execution within the context, which is exactly what Express does in
 * production by holding the context open across the whole request.
 */
async function withSession(fn, sessionId = TEST_SESSION) {
  return runWithSession(sessionId, async () => fn());
}

module.exports = { request, withSession, TEST_SESSION, OTHER_SESSION };
