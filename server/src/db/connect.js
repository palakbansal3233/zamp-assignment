const mongoose = require('mongoose');
const { config } = require('../config');
const Document = require('../models/Document');

// Netlify Functions reuse warm Lambda containers between invocations, so a
// naive `mongoose.connect()` on every request would slowly leak connections
// until Atlas's free-tier connection cap (500) is exhausted. We cache the
// connection *promise* on the module scope: the first invocation in a
// container creates it, every later invocation in that same warm container
// reuses it, and a small maxPoolSize keeps any one container from hogging
// connections.
let connectionPromise = null;

async function connectToDatabase() {
  if (mongoose.connection.readyState === 1) {
    return mongoose.connection;
  }

  if (!connectionPromise) {
    mongoose.set('strictQuery', true);
    connectionPromise = mongoose
      .connect(config.mongoUri, {
        maxPoolSize: 5,
        serverSelectionTimeoutMS: 8000,
      })
      .then(async (conn) => {
        // Mongoose builds schema indexes (notably the text index behind
        // keyword search) in the background by default and does NOT wait
        // for them before the connection promise resolves. A request that
        // lands before that background build finishes gets a raw
        // "text index required for $text query" Mongo error instead of a
        // working search — we hit this ourselves in a fresh-database smoke
        // test. Awaiting Model.init() here makes every request wait for
        // indexes exactly once, on the very first connection.
        await Document.init();
        return conn;
      })
      .catch((err) => {
        // Reset so the *next* request gets a chance to retry instead of
        // being stuck forever on a rejected promise from a transient
        // network blip.
        connectionPromise = null;
        throw err;
      });
  }

  await connectionPromise;
  return mongoose.connection;
}

module.exports = { connectToDatabase };
