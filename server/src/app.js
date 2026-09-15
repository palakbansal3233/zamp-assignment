const express = require('express');
const cors = require('cors');

const { connectToDatabase } = require('./db/connect');
const { errorHandler } = require('./middleware/errorHandler');
const documentsRouter = require('./routes/documents');
const queryRouter = require('./routes/query');
const healthRouter = require('./routes/health');
const askRouter = require('./routes/ask');
const sessionRouter = require('./routes/session');
const { sessionMiddleware } = require('./middleware/sessionContext');

/**
 * The "core" Express app, deliberately defined WITHOUT an /api prefix on its
 * routes (they're just /documents, /query, /health). It's mounted two
 * different ways depending on where it runs:
 *
 *  - locally (src/index.js): mounted under /api on a plain app.listen server.
 *  - on Netlify (netlify/functions/api.js): wrapped with serverless-http,
 *    whose basePath strips Netlify's own /.netlify/functions/api prefix.
 *
 * Same route definitions, same middleware, same behavior in both places —
 * only the outer wiring differs. See decisions.md ("One Express app, two
 * runtimes").
 */
function createApp() {
  const app = express();

  app.use(cors());
  // 6MB matches Netlify's synchronous function payload ceiling; base64 file
  // data plus JSON overhead is what actually hits this limit, and we cap
  // file size well under it in config.maxFileBytes as the primary guard.
  app.use(express.json({ limit: '6mb' }));

  // Every request ensures a DB connection first. On a warm serverless
  // container this resolves instantly (see db/connect.js); locally it just
  // connects once at startup.
  app.use(async (req, res, next) => {
    try {
      await connectToDatabase();
      next();
    } catch (err) {
      next(Object.assign(new Error('Could not connect to the database. Check MONGODB_URI.'), { status: 503, cause: err }));
    }
  });

  // Establishes which visitor this request belongs to, before any route can
  // touch the database. Everything below is scoped to it.
  app.use(sessionMiddleware);

  app.use('/health', healthRouter);
  app.use('/session', sessionRouter);
  app.use('/documents', documentsRouter);
  app.use('/query', queryRouter);
  app.use('/ask', askRouter);

  app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
