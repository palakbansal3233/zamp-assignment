const { request, withSession, TEST_SESSION, OTHER_SESSION } = require('./helpers/session');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Mock only the model-calling boundary (askModel/generateSuggestions/
// computeCorpusFingerprint) — verifyCitations and computeConflicts run for
// real against the seeded database, because the whole point of these tests
// is proving the verification/refusal/conflict logic actually works against
// real data, not just that the controller calls the right functions.
jest.mock('../src/services/askEngine', () => {
  const actual = jest.requireActual('../src/services/askEngine');
  return {
    ...actual,
    askModel: jest.fn(),
    generateSuggestions: jest.fn(),
    computeCorpusFingerprint: jest.fn(),
  };
});

const { askModel, generateSuggestions, computeCorpusFingerprint } = require('../src/services/askEngine');
const Document = require('../src/models/Document');
const SuggestionCache = require('../src/models/SuggestionCache');
const { createApp } = require('../src/app');

let mongod;
let app;

beforeAll(async () => {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  app = createApp();
}, 60000);

afterEach(async () => {
  jest.clearAllMocks();
  const { collections } = mongoose.connection;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongod.stop();
});

async function seedInvoice(fields, sessionId = TEST_SESSION) {
  return withSession(() => Document.create({
    filename: 'invoice.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 10,
    status: 'done',
    docType: 'invoice',
    summary: 'An invoice.',
    fields,
  }), sessionId);
}

describe('POST /ask', () => {
  test('rejects a missing question with 400', async () => {
    const res = await request(app).post('/ask').send({});
    expect(res.status).toBe(400);
    expect(askModel).not.toHaveBeenCalled();
  });

  test('refuses immediately, without calling the model, when the corpus is empty', async () => {
    const res = await request(app).post('/ask').send({ question: 'anything?' });
    expect(res.status).toBe(200);
    expect(res.body.refused).toBe(true);
    expect(askModel).not.toHaveBeenCalled();
  });

  test('returns a grounded answer with real, verified citations', async () => {
    const doc = await seedInvoice([{ key: 'total_due', label: 'Total Due', value: 500, sensitive: false }]);
    askModel.mockResolvedValue({
      refused: false,
      refusal_reason: null,
      answer: 'The total due is 500.',
      citations: [{ document_id: String(doc._id), field_key: 'total_due' }],
    });

    const res = await request(app).post('/ask').send({ question: 'What is the total due?' });
    expect(res.status).toBe(200);
    expect(res.body.refused).toBe(false);
    expect(res.body.answer).toBe('The total due is 500.');
    expect(res.body.citations).toEqual([
      { documentId: String(doc._id), filename: 'invoice.pdf', fieldKey: 'total_due', label: 'Total Due', value: 500, quote: '' },
    ]);
    expect(res.body.caveats).toEqual([]);
    expect(res.body.sensitive).toBe(false);
  });

  test('the core safety rule: a non-refused answer whose citations do NOT verify becomes a refusal', async () => {
    await seedInvoice([{ key: 'total_due', label: 'Total Due', value: 500 }]);
    const fakeId = new mongoose.Types.ObjectId().toString();
    askModel.mockResolvedValue({
      refused: false,
      refusal_reason: null,
      answer: 'Something confidently wrong.',
      citations: [{ document_id: fakeId, field_key: 'total_due' }], // does not exist
    });

    const res = await request(app).post('/ask').send({ question: 'anything?' });
    expect(res.status).toBe(200);
    expect(res.body.refused).toBe(true);
    expect(res.body.answer).toBeNull();
    expect(res.body.citations).toEqual([]);
  });

  test('passes through an explicit model refusal', async () => {
    await seedInvoice([{ key: 'total_due', label: 'Total Due', value: 500 }]);
    askModel.mockResolvedValue({ refused: true, refusal_reason: 'Nothing in the corpus covers that.', answer: null, citations: [] });

    const res = await request(app).post('/ask').send({ question: 'What is the meaning of life?' });
    expect(res.status).toBe(200);
    expect(res.body.refused).toBe(true);
    expect(res.body.reason).toBe('Nothing in the corpus covers that.');
  });

  test('surfaces a real conflict caveat when verified citations disagree across documents', async () => {
    const docA = await seedInvoice([{ key: 'price_escalator', label: 'Price Escalator', value: 'CPI + 2%' }]);
    const docB = await withSession(() => Document.create({
      filename: 'msa.pdf', mimeType: 'application/pdf', sizeBytes: 10, status: 'done', docType: 'contract',
      fields: [{ key: 'price_escalator', label: 'Price Escalator', value: '4%' }],
    }));
    askModel.mockResolvedValue({
      refused: false, refusal_reason: null, answer: 'The escalator is CPI + 2% per the contract.',
      citations: [{ document_id: String(docA._id), field_key: 'price_escalator' }, { document_id: String(docB._id), field_key: 'price_escalator' }],
    });

    const res = await request(app).post('/ask').send({ question: 'What is the price escalator?' });
    expect(res.status).toBe(200);
    expect(res.body.caveats).toHaveLength(1);
    expect(res.body.caveats[0].type).toBe('conflict');
    expect(res.body.caveats[0].fieldKey).toBe('price_escalator');
  });

  test('flags a citation touching a sensitive field, reading sensitivity from the stored field not the model', async () => {
    const doc = await seedInvoice([{ key: 'account_number', label: 'Account', value: '4471-2298', sensitive: true, sensitivityReason: 'financial account number' }]);
    askModel.mockResolvedValue({
      refused: false, refusal_reason: null, answer: 'The account number is 4471-2298.',
      citations: [{ document_id: String(doc._id), field_key: 'account_number' }],
    });

    const res = await request(app).post('/ask').send({ question: 'What is the account number?' });
    expect(res.body.sensitive).toBe(true);
    expect(res.body.sensitiveFields).toEqual(['account_number']);
  });
});

describe('GET /ask/suggestions', () => {
  test('regenerates and caches when there is no cache or the fingerprint changed', async () => {
    await seedInvoice([{ key: 'total_due', label: 'Total Due', value: 500 }]);
    computeCorpusFingerprint.mockResolvedValue('fp-1');
    generateSuggestions.mockResolvedValue([{ text: 'What is the total due?', docTypes: ['invoice'] }]);

    const res = await request(app).get('/ask/suggestions');
    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual([{ text: 'What is the total due?', docTypes: ['invoice'] }]);
    expect(generateSuggestions).toHaveBeenCalledTimes(1);

    const cached = await SuggestionCache.findById(TEST_SESSION).lean();
    expect(cached.fingerprint).toBe('fp-1');
  });

  test('serves the cache without re-calling the model when the fingerprint is unchanged', async () => {
    await seedInvoice([{ key: 'total_due', label: 'Total Due', value: 500 }]);
    await SuggestionCache.create({ _id: TEST_SESSION, fingerprint: 'fp-same', questions: [{ text: 'Cached question?', docTypes: [] }] });
    computeCorpusFingerprint.mockResolvedValue('fp-same');

    const res = await request(app).get('/ask/suggestions');
    expect(res.status).toBe(200);
    expect(res.body.questions).toEqual([{ text: 'Cached question?', docTypes: [] }]);
    expect(generateSuggestions).not.toHaveBeenCalled();
  });

  // Seen for real: generation came back empty once (it's occasionally
  // flaky), the empty list was cached against the current fingerprint, and
  // the Ask screen then showed no suggestions indefinitely — the fingerprint
  // only changes when the corpus does, which for someone who has finished
  // uploading is never.
  test('an empty result is never cached, so a flaky generation heals itself', async () => {
    await seedInvoice([{ key: 'total_due', label: 'Total Due', value: 500 }]);
    computeCorpusFingerprint.mockResolvedValue('fp-1');
    generateSuggestions.mockResolvedValueOnce([]);

    const first = await request(app).get('/ask/suggestions');
    expect(first.body.questions).toEqual([]);
    expect(await SuggestionCache.findById(TEST_SESSION).lean()).toBeNull();

    // Same fingerprint, but the next request must try again rather than
    // serve the empty list back.
    generateSuggestions.mockResolvedValueOnce([{ text: 'What is the total due?', docTypes: ['invoice'] }]);
    const second = await request(app).get('/ask/suggestions');
    expect(second.body.questions).toHaveLength(1);
    expect(generateSuggestions).toHaveBeenCalledTimes(2);
  });

  test('a stale empty cache is not trusted either', async () => {
    await seedInvoice([{ key: 'total_due', label: 'Total Due', value: 500 }]);
    await SuggestionCache.create({ _id: TEST_SESSION, fingerprint: 'fp-same', questions: [] });
    computeCorpusFingerprint.mockResolvedValue('fp-same');
    generateSuggestions.mockResolvedValue([{ text: 'Recovered question?', docTypes: ['invoice'] }]);

    const res = await request(app).get('/ask/suggestions');
    expect(res.body.questions).toEqual([{ text: 'Recovered question?', docTypes: ['invoice'] }]);
    expect(generateSuggestions).toHaveBeenCalledTimes(1);
  });
});
