const serverless = require('serverless-http');
const { createApp } = require('../../server/src/app');

// Same Express app as local dev (server/src/index.js) — see app.js for why.
// basePath strips the "/.netlify/functions/api" prefix Netlify puts on the
// rewritten path (see the /api/* redirect in netlify.toml) so the app's own
// routes stay defined as plain /documents, /query, /health in both places.
const app = createApp();
exports.handler = serverless(app, { basePath: '/.netlify/functions/api' });
