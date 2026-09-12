const request = require('supertest');
const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

// Extraction hits a real external API — mocked here so tests are fast,
// deterministic, and runnable with no ANTHROPIC_API_KEY at all. The
// sanitizer/prompt/schema logic itself is covered separately in
// extraction.js by construction (forced tool_choice) and exercised for real
// only in manual/local testing with a live key.
jest.mock('../src/services/extraction', () => ({
  ExtractionConfigError: class ExtractionConfigError extends Error {},
  extractStructuredData: jest.fn(),
}));

// Smart search hits the same external API — mocked for the same reason.
// This also means these tests behave identically whether or not the
// developer's local server/.env happens to have a real ANTHROPIC_API_KEY
// (it does, once you set one up) — a test that relied on the key being
// *absent* to exercise the fallback path would pass locally-without-a-key
// and silently stop testing anything the moment a real key was added.
jest.mock('../src/services/queryBuilder', () => ({
  buildSmartQuery: jest.fn(),
  sanitizeFilters: jest.requireActual('../src/services/queryBuilder').sanitizeFilters,
}));

const { extractStructuredData, ExtractionConfigError } = require('../src/services/extraction');
const { buildSmartQuery } = require('../src/services/queryBuilder');
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

function pngBase64() {
  // 1x1 transparent PNG
  return 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
}

// Builds one field descriptor with the new array shape's full set of
// defaults filled in, so individual tests only need to name what they
// actually care about.
function field(key, value, overrides = {}) {
  return {
    key,
    label: key,
    value,
    quote: '',
    confidence: 0.9,
    needsReview: false,
    reviewNote: null,
    reviewActions: [],
    confirmed: false,
    resolvedAction: null,
    sensitive: false,
    sensitivityReason: null,
    ...overrides,
  };
}

describe('POST /documents', () => {
  test('extracts and stores a text document end-to-end', async () => {
    extractStructuredData.mockResolvedValue({
      unreadable: false,
      unreadableReason: null,
      docType: 'receipt',
      summary: 'A coffee shop receipt for $4.50.',
      documentText: 'Blue Bottle Coffee — Total: $4.50',
      fields: [field('vendor_name', 'Blue Bottle', { quote: 'Blue Bottle Coffee' }), field('total_amount', 4.5), field('currency', 'USD')],
    });

    const res = await request(app)
      .post('/documents')
      .send({
        filename: 'receipt.txt',
        mimeType: 'text/plain',
        dataBase64: Buffer.from('Blue Bottle Coffee — Total: $4.50').toString('base64'),
      });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('done');
    expect(res.body.docType).toBe('receipt');
    expect(res.body.documentText).toBe('Blue Bottle Coffee — Total: $4.50');
    const vendor = res.body.fields.find((f) => f.key === 'vendor_name');
    expect(vendor.value).toBe('Blue Bottle');
    expect(vendor.quote).toBe('Blue Bottle Coffee');
    expect(res.body.fileData).toBeUndefined(); // never leaks raw bytes in the JSON response
  });

  test('stores the document with status "error" when extraction fails, without failing the request', async () => {
    extractStructuredData.mockRejectedValue(new Error('The model did not return structured data for this document.'));

    const res = await request(app)
      .post('/documents')
      .send({ filename: 'weird.txt', mimeType: 'text/plain', dataBase64: Buffer.from('???').toString('base64') });

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('error');
    expect(res.body.errorMessage).toMatch(/structured data/i);
  });

  test('handles an unreadable/garbage document gracefully instead of inventing fields', async () => {
    extractStructuredData.mockResolvedValue({
      unreadable: true,
      unreadableReason: 'The image is entirely blank.',
      docType: 'other',
      summary: '',
      documentText: '',
      fields: [],
    });

    const res = await request(app)
      .post('/documents')
      .send({ filename: 'blank.png', mimeType: 'image/png', dataBase64: pngBase64() });

    expect(res.status).toBe(201);
    expect(res.body.unreadable).toBe(true);
    expect(res.body.docType).toBeNull();
    expect(res.body.fields).toHaveLength(0);
  });

  test('rejects unsupported file types with 415 and a helpful message', async () => {
    const res = await request(app)
      .post('/documents')
      .send({ filename: 'resume.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', dataBase64: 'AAAA' });

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/docx/i);
    expect(extractStructuredData).not.toHaveBeenCalled();
  });

  test('rejects files over the configured size cap with 413', async () => {
    const { config } = require('../src/config');
    const big = Buffer.alloc(config.maxFileBytes + 1024, 1).toString('base64');

    const res = await request(app)
      .post('/documents')
      .send({ filename: 'huge.txt', mimeType: 'text/plain', dataBase64: big });

    expect(res.status).toBe(413);
    expect(extractStructuredData).not.toHaveBeenCalled();
  });

  test('rejects a missing filename with 400', async () => {
    const res = await request(app).post('/documents').send({ dataBase64: 'AAAA' });
    expect(res.status).toBe(400);
  });

  test('rejects empty file data with 400', async () => {
    const res = await request(app).post('/documents').send({ filename: 'empty.txt', dataBase64: '' });
    expect(res.status).toBe(400);
  });
});

describe('GET/DELETE /documents', () => {
  async function seedOne(overrides = {}) {
    extractStructuredData.mockResolvedValue({
      unreadable: false,
      unreadableReason: null,
      docType: 'invoice',
      summary: 'Invoice #123 for $500.',
      documentText: 'Invoice #123, total $500',
      fields: [field('invoice_number', '123'), field('total_amount', 500)],
      ...overrides,
    });
    const res = await request(app)
      .post('/documents')
      .send({ filename: 'invoice.txt', mimeType: 'text/plain', dataBase64: Buffer.from('Invoice #123, total $500').toString('base64') });
    return res.body;
  }

  test('lists documents newest-first with pagination metadata', async () => {
    await seedOne();
    await seedOne();

    const res = await request(app).get('/documents?limit=1&page=1');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.total).toBe(2);
    expect(res.body.totalPages).toBe(2);
  });

  test('gets a single document by id', async () => {
    const created = await seedOne();
    const res = await request(app).get(`/documents/${created._id}`);
    expect(res.status).toBe(200);
    expect(res.body.fields.find((f) => f.key === 'invoice_number').value).toBe('123');
  });

  test('flags which fields are new to the dataset, computed at read time', async () => {
    const first = await seedOne({ fields: [field('invoice_number', '123')] });
    // Second document shares "invoice_number" but introduces "vendor_name".
    const second = await seedOne({ fields: [field('invoice_number', '124'), field('vendor_name', 'Acme')] });

    const res = await request(app).get(`/documents/${second._id}`);
    expect(res.body.newFieldKeys).toEqual(['vendor_name']);

    // The first document, read after the second exists, has nothing new
    // relative to it (invoice_number was already present elsewhere).
    const firstAgain = await request(app).get(`/documents/${first._id}`);
    expect(firstAgain.body.newFieldKeys).toEqual([]);
  });

  test('404s for a missing document id', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).get(`/documents/${fakeId}`);
    expect(res.status).toBe(404);
  });

  test('deletes a document', async () => {
    const created = await seedOne();
    const del = await request(app).delete(`/documents/${created._id}`);
    expect(del.status).toBe(204);

    const get = await request(app).get(`/documents/${created._id}`);
    expect(get.status).toBe(404);
  });

  test('serves the original file bytes for preview, byte-for-byte (not base64-wrapped)', async () => {
    // Regression test: a Buffer path fetched via .lean() comes back as raw
    // BSON Binary, and res.send() on that silently serialized it as a
    // base64 *string* body instead of the actual file bytes. See
    // getDocumentFile in documentsController.js.
    const created = await seedOne();
    const res = await request(app).get(`/documents/${created._id}/file`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toBe('Invoice #123, total $500');
  });
});

describe('PATCH /documents/:id/fields/:key', () => {
  async function seedOne(overrides = {}) {
    extractStructuredData.mockResolvedValue({
      unreadable: false,
      unreadableReason: null,
      docType: 'invoice',
      summary: 'Invoice #123 for $500.',
      documentText: 'Invoice #123, total $500',
      fields: [field('invoice_number', '123'), field('discount_pct', '4%', { needsReview: true, reviewNote: 'ambiguous', reviewActions: ['Keep 4%', 'Keep flat amount'] })],
      ...overrides,
    });
    const res = await request(app)
      .post('/documents')
      .send({ filename: 'invoice.txt', mimeType: 'text/plain', dataBase64: Buffer.from('Invoice #123, total $500').toString('base64') });
    return res.body;
  }

  test('confirms a flagged field with a chosen resolution, clearing needsReview', async () => {
    const created = await seedOne();
    const res = await request(app)
      .patch(`/documents/${created._id}/fields/discount_pct`)
      .send({ value: '496.00', resolvedAction: 'Keep flat amount' });

    expect(res.status).toBe(200);
    const patched = res.body.fields.find((f) => f.key === 'discount_pct');
    expect(patched.value).toBe('496.00');
    expect(patched.resolvedAction).toBe('Keep flat amount');
    expect(patched.confirmed).toBe(true);
    expect(patched.needsReview).toBe(false);

    // fieldIndex and searchableText must reflect the patched value too —
    // they're derived, but derived data that goes stale is worse than none.
    const again = await request(app).get(`/documents/${created._id}`);
    expect(again.body.fieldIndex.discount_pct).toBe('496.00');
  });

  test('confirming without changing the value just clears needsReview', async () => {
    const created = await seedOne();
    const res = await request(app).patch(`/documents/${created._id}/fields/discount_pct`).send({});

    expect(res.status).toBe(200);
    const patched = res.body.fields.find((f) => f.key === 'discount_pct');
    expect(patched.value).toBe('4%'); // unchanged
    expect(patched.confirmed).toBe(true);
    expect(patched.needsReview).toBe(false);
  });

  test('404s for an unknown field key', async () => {
    const created = await seedOne();
    const res = await request(app).patch(`/documents/${created._id}/fields/not_a_real_key`).send({ confirmed: true });
    expect(res.status).toBe(404);
  });

  test('404s for an unknown document id', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const res = await request(app).patch(`/documents/${fakeId}/fields/discount_pct`).send({ confirmed: true });
    expect(res.status).toBe(404);
  });
});

describe('GET /query', () => {
  test('falls back to keyword search when smart search is not configured', async () => {
    extractStructuredData.mockResolvedValue({
      unreadable: false,
      unreadableReason: null,
      docType: 'invoice',
      summary: 'Invoice for Acme Corp, total $500.',
      documentText: 'Acme Corp invoice, total $500',
      fields: [field('vendor_name', 'Acme Corp'), field('total_amount', 500)],
    });
    await request(app)
      .post('/documents')
      .send({ filename: 'acme.txt', mimeType: 'text/plain', dataBase64: Buffer.from('Acme Corp invoice, total $500').toString('base64') });

    // Simulate "smart search unavailable" deterministically (see the
    // jest.mock comment above for why this isn't left to depend on whether
    // ANTHROPIC_API_KEY happens to be set in the environment).
    buildSmartQuery.mockRejectedValue(new ExtractionConfigError('ANTHROPIC_API_KEY is not set.'));

    const res = await request(app).get('/query').query({ q: 'Acme' });
    expect(res.status).toBe(200);
    expect(res.body.modeUsed).toBe('keyword');
    expect(res.body.items.length).toBeGreaterThan(0);
  });

  test('an empty query returns recent documents without requiring a search term', async () => {
    const res = await request(app).get('/query');
    expect(res.status).toBe(200);
    expect(res.body.modeUsed).toBe('none');
  });
});
