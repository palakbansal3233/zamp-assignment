const serverless = require('serverless-http');
const { createApp } = require('../../server/src/app');

// Same Express app as local dev (server/src/index.js) — see app.js for why.
//
// basePath here strips "/api" — NOT "/.netlify/functions/api" as an earlier
// version of this file assumed. That assumption was wrong, and only a real
// deployment exposed it: netlify.toml's `/api/* -> /.netlify/functions/api/:splat`
// redirect is a *rewrite*, and Netlify invokes the function with `event.path`
// set to the original client-facing path ("/api/health"), not the internal
// function path — confirmed by curling the deployed site directly, where
// hitting the function's own canonical URL worked (200) but hitting it via
// the redirect the app actually uses returned this app's own 404 (the old
// basePath never matched "/api/health", so nothing was stripped, and Express
// saw "/api/health" against routes defined as "/health" etc.). See
// decisions.md for the full story.
const app = createApp();
exports.handler = serverless(app, { basePath: '/api' });
