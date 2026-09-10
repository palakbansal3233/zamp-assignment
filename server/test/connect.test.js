const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Regression test for a real bug caught in manual smoke testing, NOT by the
// mocked/pre-connected supertest suite (documents.api.test.js pre-connects
// mongoose directly in beforeAll, which coincidentally masks this race —
// see decisions.md, "A passing test suite that still shipped two bugs").
//
// The bug: mongoose builds schema indexes (the text index behind keyword
// search) in the background and does NOT wait for them before `.connect()`
// resolves. A request landing on a brand-new database before that build
// finishes got a raw "text index required for $text query" Mongo error.
// The fix lives in db/connect.js: connectToDatabase() awaits Document.init()
// as part of the same cached connection promise, so every caller of it
// (including this test, which goes through connectToDatabase() itself
// rather than pre-connecting) waits for indexes too.
describe('connectToDatabase', () => {
  let mongod;

  afterAll(async () => {
    await mongoose.disconnect();
    if (mongod) await mongod.stop();
  });

  test('a $text query immediately after connecting does not race the background index build', async () => {
    mongod = await MongoMemoryServer.create();
    process.env.MONGODB_URI = mongod.getUri();

    const { connectToDatabase } = require('../src/db/connect');
    const Document = require('../src/models/Document');

    await connectToDatabase();

    // This is the exact query keyword search runs. Before the fix, this
    // could throw MongoServerError: text index required for $text query.
    await expect(Document.find({ $text: { $search: 'anything' } })).resolves.toEqual([]);
  }, 30000);
});
