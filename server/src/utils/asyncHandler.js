// Express 4 doesn't catch rejected promises from async route handlers on its
// own — an unhandled rejection would just hang the request. This wraps a
// handler so any thrown/rejected error reaches errorHandler via next().
function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

module.exports = { asyncHandler };
