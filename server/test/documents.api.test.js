const { request, withSession, TEST_SESSION, OTHER_SESSION } = require('./helpers/session');
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
  // Build indexes before any test runs. Keyword search uses the `$text`
  // index, and Mongoose creates indexes in the background — so without this
  // a search could run against a not-yet-built index and return nothing,
  // failing a test that has nothing wrong with it. (The app's own connect
  // helper awaits this for the same reason; these tests bypass it by
  // connecting directly.)
  await require('../src/models/Document').init();
  app = createApp();
}, 60000);

afterEach(async () => {
  // resetAllMocks, not clearAllMocks: `clear` wipes call history but leaves
  // queued `mockResolvedValueOnce` values in place. The chunked-extraction
  // tests below deliberately leave chunks unconsumed (that's what a budget
  // cut-off *is*), so leftovers would spill into whichever test ran next
  // and fail it for reasons that have nothing to do with it — an
  // order-dependent failure that looks like a real regression.
  jest.resetAllMocks();
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
      .send({ filename: 'archive.zip', mimeType: 'application/zip', dataBase64: 'AAAA' });

    expect(res.status).toBe(415);
    expect(res.body.error).toMatch(/PDF/i);
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

// The long-document path: a 12-page rental agreement can't be read inside
// one request, so it's read in chunks, persisted as it goes, and resumed.
// These cover the properties that make that safe rather than just clever.
describe('POST /documents (long documents, chunked + resumable)', () => {
  const { CHARS_PER_CHUNK } = require('../src/services/chunking');
  const { config } = require('../src/config');
  const longText = () => 'A'.repeat(CHARS_PER_CHUNK) + 'B'.repeat(CHARS_PER_CHUNK) + 'C'.repeat(100);

  function mockChunkResults() {
    // One distinct result per chunk, so we can prove all of them landed.
    extractStructuredData
      .mockResolvedValueOnce({ unreadable: false, unreadableReason: null, docType: 'rental_agreement', summary: 'A lease.', documentText: 'part one', fields: [field('rent', 1000)] })
      .mockResolvedValueOnce({ unreadable: false, unreadableReason: null, docType: 'other', summary: 'More.', documentText: 'part two', fields: [field('deposit', 2000)] })
      .mockResolvedValueOnce({ unreadable: false, unreadableReason: null, docType: 'other', summary: 'End.', documentText: 'part three', fields: [field('notice_period', 60)] });
  }

  const upload = () =>
    request(app)
      .post('/documents')
      .send({ filename: 'rental-agreement.txt', mimeType: 'text/plain', dataBase64: Buffer.from(longText()).toString('base64') });

  test('reads every chunk and merges them when the request budget allows', async () => {
    mockChunkResults();
    const res = await upload();

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('done');
    expect(extractStructuredData).toHaveBeenCalledTimes(3);
    expect(res.body.extraction).toMatchObject({ totalChunks: 3, completedChunks: 3, unit: 'char' });
    expect(res.body.fields.map((f) => f.key).sort()).toEqual(['deposit', 'notice_period', 'rent']);
    expect(res.body.documentText).toBe('part one\n\npart two\n\npart three');
    expect(res.body.docType).toBe('rental_agreement'); // first real classification held
  });

  test('with no budget left, one request reads exactly one chunk and reports real partial progress', async () => {
    const original = config.requestChunkBudgetMs;
    config.requestChunkBudgetMs = 0;
    try {
      mockChunkResults();
      const res = await upload();

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('processing'); // honest: not finished
      expect(extractStructuredData).toHaveBeenCalledTimes(1);
      expect(res.body.extraction).toMatchObject({ totalChunks: 3, completedChunks: 1, nextChunkIndex: 1 });
      // The partial result is already real and readable — not withheld
      // until the whole document finishes.
      expect(res.body.fields.map((f) => f.key)).toEqual(['rent']);
    } finally {
      config.requestChunkBudgetMs = original;
    }
  });

  test('resume picks up exactly where it stopped rather than starting over', async () => {
    const original = config.requestChunkBudgetMs;
    config.requestChunkBudgetMs = 0;
    let created;
    try {
      mockChunkResults();
      created = (await upload()).body;
      expect(created.extraction.completedChunks).toBe(1);

      // Two resumes, one chunk each.
      const afterSecond = await request(app).post(`/documents/${created._id}/resume`);
      expect(afterSecond.body.extraction.completedChunks).toBe(2);
      expect(afterSecond.body.status).toBe('processing');

      const afterThird = await request(app).post(`/documents/${created._id}/resume`);
      expect(afterThird.body.extraction.completedChunks).toBe(3);
      expect(afterThird.body.status).toBe('done');

      // Three chunks total across all requests — no chunk was re-read.
      expect(extractStructuredData).toHaveBeenCalledTimes(3);
      expect(afterThird.body.fields.map((f) => f.key).sort()).toEqual(['deposit', 'notice_period', 'rent']);
    } finally {
      config.requestChunkBudgetMs = original;
    }
  });

  test('will not start a chunk that would overrun the request budget', async () => {
    // The budget has to bound total elapsed time, not just when a chunk
    // starts — checking only the latter is what earned a 504 from the edge
    // in production, because a chunk beginning just inside the budget ran
    // the request far past it.
    const original = config.requestChunkBudgetMs;
    config.requestChunkBudgetMs = 150;
    try {
      const slowChunk = (documentText) => () =>
        new Promise((resolve) => setTimeout(() => resolve({
          unreadable: false, unreadableReason: null, docType: 'rental_agreement', summary: 'A lease.', documentText, fields: [],
        }), 100));
      extractStructuredData
        .mockImplementationOnce(slowChunk('one'))
        .mockImplementationOnce(slowChunk('two'))
        .mockImplementationOnce(slowChunk('three'));

      const res = await upload();

      // One chunk took ~100ms, so a second would land at ~200ms against a
      // 150ms budget — it must not be started.
      expect(extractStructuredData).toHaveBeenCalledTimes(1);
      expect(res.body.status).toBe('processing');
      expect(res.body.extraction.completedChunks).toBe(1);
    } finally {
      config.requestChunkBudgetMs = original;
    }
  });

  test('resuming an already-finished document is a no-op, not a re-read', async () => {
    mockChunkResults();
    const created = (await upload()).body;
    expect(created.status).toBe('done');
    extractStructuredData.mockClear();

    const res = await request(app).post(`/documents/${created._id}/resume`);
    expect(res.body.status).toBe('done');
    expect(extractStructuredData).not.toHaveBeenCalled();
  });

  test('a failure partway through keeps everything read so far, and says where it stopped', async () => {
    extractStructuredData
      .mockResolvedValueOnce({ unreadable: false, unreadableReason: null, docType: 'rental_agreement', summary: 'A lease.', documentText: 'part one', fields: [field('rent', 1000)] })
      .mockRejectedValueOnce(new Error('Extraction timed out.'));

    const res = await upload();

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('error');
    // The first chunk's work survives the second chunk's failure.
    expect(res.body.fields.map((f) => f.key)).toEqual(['rent']);
    expect(res.body.documentText).toBe('part one');
    // The message has to say, in plain words, that the work was kept and how
    // to carry on — "failed" with no mention of the saved parts is what sent
    // someone hunting for results that were there all along.
    expect(res.body.errorMessage).toMatch(/1 of 3 parts already read/i);
    expect(res.body.errorMessage).toMatch(/keep reading/i);
    // ...and it's resumable from exactly there.
    expect(res.body.extraction.nextChunkIndex).toBe(1);
  });

  test('retry re-reads from the beginning, unlike resume', async () => {
    extractStructuredData.mockResolvedValue({
      unreadable: false, unreadableReason: null, docType: 'receipt', summary: 'A receipt.', documentText: 'text', fields: [field('total', 10)],
    });
    const created = (await request(app)
      .post('/documents')
      .send({ filename: 'receipt.txt', mimeType: 'text/plain', dataBase64: Buffer.from('short').toString('base64') })).body;
    extractStructuredData.mockClear();

    const res = await request(app).post(`/documents/${created._id}/retry`);
    expect(res.body.extraction.completedChunks).toBe(1);
    expect(extractStructuredData).toHaveBeenCalledTimes(1); // read again from scratch
  });
});

// A scanned or photographed page makes the model read pixels rather than
// text, which is dramatically slower — slow enough that a two-page slice
// can blow the per-chunk timeout. This used to be a permanent dead end: the
// document went straight to `error` with nothing extracted, and Retry re-ran
// the identical oversized slice and failed the same way, forever. Found in
// production on a signed 7-page tenancy agreement.
describe('POST /documents (a chunk too slow to read is retried smaller)', () => {
  const { PDFDocument } = require('pdf-lib');
  const { PAGES_PER_CHUNK } = require('../src/services/chunking');

  async function scannedPdf(pageCount) {
    const pdf = await PDFDocument.create();
    for (let i = 0; i < pageCount; i += 1) pdf.addPage([200, 200]);
    return Buffer.from(await pdf.save());
  }

  const uploadPdf = async (pages) =>
    request(app)
      .post('/documents')
      .send({
        filename: 'tenant_agreement_signed.pdf',
        mimeType: 'application/pdf',
        dataBase64: (await scannedPdf(pages)).toString('base64'),
      });

  const timeout = () => {
    const err = new Error('Extraction timed out.');
    err.timedOut = true;
    return err;
  };
  const page = (key) => ({
    unreadable: false, unreadableReason: null, docType: 'rental_agreement',
    summary: 'A tenancy agreement.', documentText: key, fields: [field(key, 1)],
  });

  test('a timed-out chunk halves the slice and keeps going, instead of failing the document', async () => {
    // Every full-size (2-page) slice times out; single pages read fine.
    extractStructuredData.mockImplementation(async (input) => {
      const pageCount = (await PDFDocument.load(input.buffer)).getPageCount();
      if (pageCount > 1) throw timeout();
      return page('rent');
    });

    const res = await uploadPdf(4);

    expect(res.status).toBe(201);
    // The document must NOT be a dead end with nothing to show.
    expect(res.body.status).not.toBe('error');
    expect(res.body.extraction.pagesPerChunk).toBe(1);
    expect(res.body.extraction.totalChunks).toBe(4); // re-planned at 1 page each
  });

  test('the narrower slice is remembered, so a resume in a fresh container does not relearn it the slow way', async () => {
    extractStructuredData.mockImplementation(async (input) => {
      const pageCount = (await PDFDocument.load(input.buffer)).getPageCount();
      if (pageCount > 1) throw timeout();
      return page('rent');
    });

    const created = (await uploadPdf(4)).body;
    expect(created.extraction.pagesPerChunk).toBe(1);

    // Resume: every subsequent call must already be a single page, so no
    // further time is burned rediscovering that two pages is too slow.
    extractStructuredData.mockClear();
    await request(app).post(`/documents/${created._id}/resume`);
    for (const call of extractStructuredData.mock.calls) {
      // eslint-disable-next-line no-await-in-loop
      expect((await PDFDocument.load(call[0].buffer)).getPageCount()).toBe(1);
    }
  });

  // Measured on the real document: a typical scanned page took 20.7s but a
  // dense one took 34.1s — longer than a request lasts, and a page is the
  // smallest unit there is. Losing the other six pages over that one is the
  // opposite of what this product is for.
  test('a page that will not read even alone is skipped and reported, not fatal', async () => {
    let call = 0;
    extractStructuredData.mockImplementation(async (input) => {
      const pageCount = (await PDFDocument.load(input.buffer)).getPageCount();
      if (pageCount > 1) throw timeout(); // force the shrink to single pages
      call += 1;
      if (call === 2) throw timeout(); // the second page is the stubborn one
      return page(`p${call}`);
    });

    const res = await uploadPdf(3);

    expect(res.status).toBe(201);
    expect(res.body.status).toBe('done');
    // The unreadable page is named, not silently dropped.
    expect(res.body.extraction.unreadableParts).toEqual([2]);
    // ...and the pages that did read are all still there.
    expect(res.body.fields.length).toBeGreaterThan(0);
    expect(res.body.documentText).toContain('p1');
  });

  test('every page failing is still an honest failure, not a silently empty success', async () => {
    extractStructuredData.mockRejectedValue(timeout());

    const res = await uploadPdf(2);

    expect(res.status).toBe(201);
    // Nothing was read, so this must not masquerade as a finished document
    // showing "0 details found".
    expect(res.body.fields).toHaveLength(0);
    expect(res.body.documentText).toBe('');
    expect(res.body.extraction.unreadableParts.length).toBeGreaterThan(0);
    expect(res.body.unreadable).toBe(true);
    expect(res.body.unreadableReason).toMatch(/could not|couldn|none of this/i);
    // It shrank once, then skipped each page rather than looping forever.
    expect(extractStructuredData.mock.calls.length).toBeLessThanOrEqual(PAGES_PER_CHUNK + 3);
  });

  test('a non-timeout failure is not retried smaller — only slowness is worth re-slicing for', async () => {
    extractStructuredData.mockRejectedValue(new Error('Model refused the request.'));

    const res = await uploadPdf(4);

    expect(res.body.status).toBe('error');
    expect(res.body.errorMessage).toMatch(/refused/i);
    expect(extractStructuredData).toHaveBeenCalledTimes(1);
  });
});

describe('GET/DELETE /documents', () => {
  async function seedOne({ filename = 'invoice.txt', ...overrides } = {}) {
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
      .send({ filename, mimeType: 'text/plain', dataBase64: Buffer.from('Invoice #123, total $500').toString('base64') });
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

  test('lists most recently updated first, and keeping a session alive does not disturb that', async () => {
    const older = await seedOne({ filename: 'older.txt' });
    await new Promise((r) => setTimeout(r, 30));
    const newer = await seedOne({ filename: 'newer.txt' });

    const first = await request(app).get('/documents');
    expect(first.body.items.map((d) => d.filename)).toEqual(['newer.txt', 'older.txt']);

    // Loading the list touches the session to cancel any pending expiry.
    // That's housekeeping, not an edit — if it bumped `updatedAt` it would
    // stamp every document with the same instant and scramble this order,
    // which is exactly what happened before `timestamps: false`.
    const second = await request(app).get('/documents');
    expect(second.body.items.map((d) => d.filename)).toEqual(['newer.txt', 'older.txt']);

    // ...and a real edit *does* move a document to the top, because that one
    // genuinely is the document you were last working on.
    await request(app).patch(`/documents/${older._id}/fields/invoice_number`).send({ confirmed: true });
    const third = await request(app).get('/documents');
    expect(third.body.items.map((d) => d.filename)).toEqual(['older.txt', 'newer.txt']);
    expect(String(newer._id)).not.toBe(String(older._id));
  });

  test('gets a single document by id', async () => {
    const created = await seedOne();
    const res = await request(app).get(`/documents/${created._id}`);
    expect(res.status).toBe(200);
    expect(res.body.fields.find((f) => f.key === 'invoice_number').value).toBe('123');
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

// The privacy property the whole session mechanism exists for. Sift is one
// public link: without this, sending someone that link hands them your
// tenancy agreement. These tests are written against the *observable*
// behaviour rather than the implementation, so they'd still catch a leak if
// the enforcement were ever moved or rewritten.
describe('session isolation', () => {
  const { config } = require('../src/config');
  async function uploadAs(sessionId, filename) {
    extractStructuredData.mockResolvedValue({
      unreadable: false, unreadableReason: null, docType: 'receipt',
      summary: 'A receipt.', documentText: 'text', fields: [field('total', 10)],
    });
    return request(app, sessionId)
      .post('/documents')
      .send({ filename, mimeType: 'text/plain', dataBase64: Buffer.from('hi').toString('base64') });
  }

  test('one visitor never sees another visitor’s documents', async () => {
    await uploadAs(TEST_SESSION, 'mine.txt');
    await uploadAs(OTHER_SESSION, 'theirs.txt');

    const mine = await request(app, TEST_SESSION).get('/documents');
    const theirs = await request(app, OTHER_SESSION).get('/documents');

    expect(mine.body.items.map((d) => d.filename)).toEqual(['mine.txt']);
    expect(theirs.body.items.map((d) => d.filename)).toEqual(['theirs.txt']);
  });

  test('a document cannot be opened by id from another session', async () => {
    const created = (await uploadAs(TEST_SESSION, 'private.txt')).body;

    // Knowing the id is not enough — this is the case that matters, because
    // an id can be shared, guessed from a link, or left in someone's history.
    const asOther = await request(app, OTHER_SESSION).get(`/documents/${created._id}`);
    expect(asOther.status).toBe(404);
    // ...and the owner still gets it.
    expect((await request(app, TEST_SESSION).get(`/documents/${created._id}`)).status).toBe(200);
  });

  test('a document cannot be deleted from another session', async () => {
    const created = (await uploadAs(TEST_SESSION, 'private.txt')).body;
    expect((await request(app, OTHER_SESSION).delete(`/documents/${created._id}`)).status).toBe(404);
    expect((await request(app, TEST_SESSION).get(`/documents/${created._id}`)).status).toBe(200);
  });

  test('search and ask never reach across sessions', async () => {
    await uploadAs(TEST_SESSION, 'mine.txt');
    buildSmartQuery.mockRejectedValue(new ExtractionConfigError('not configured'));

    const q = await request(app, OTHER_SESSION).get('/query').query({ q: 'receipt' });
    expect(q.body.items).toHaveLength(0);

    // With nothing of their own, the other session's corpus is empty, so Ask
    // refuses rather than answering from someone else's documents.
    const ask = await request(app, OTHER_SESSION).post('/ask').send({ question: 'What is the total?' });
    expect(ask.body.refused).toBe(true);
  });

  test('a fresh visitor with no session header starts empty, not in someone else’s workspace', async () => {
    await uploadAs(TEST_SESSION, 'mine.txt');
    // No X-Sift-Session header at all — what the very first request from a
    // new browser looks like.
    const res = await require('supertest')(app).get('/documents');
    expect(res.status).toBe(200);
    expect(res.body.items).toEqual([]);
    // The server hands back the session it minted, so the client can adopt it.
    expect(res.headers['x-sift-session']).toMatch(/^[a-f0-9]{32,}$/);
  });

  test('leaving schedules this visitor’s documents to expire, and nobody else’s', async () => {
    await uploadAs(TEST_SESSION, 'mine.txt');
    await uploadAs(OTHER_SESSION, 'theirs.txt');

    // POST, because this is what navigator.sendBeacon can send on teardown.
    const res = await request(app, TEST_SESSION).post('/session/end');
    expect(res.status).toBe(204);

    const Document = require('../src/models/Document');
    const [mine] = await withSession(() => Document.find({}).lean(), TEST_SESSION);
    const [theirs] = await withSession(() => Document.find({}).lean(), OTHER_SESSION);

    // Due imminently...
    expect(mine.expiresAt.getTime() - Date.now()).toBeLessThan(config.sessionGraceMs + 1000);
    // ...and the other visitor is untouched, still on the full TTL.
    expect(theirs.expiresAt.getTime() - Date.now()).toBeGreaterThan(config.sessionGraceMs * 2);
  });

  // pagehide fires on reload as well as on close, so an immediate delete
  // meant pressing F5 destroyed everything you had uploaded. Coming back has
  // to undo the goodbye.
  test('a reload after leaving keeps the documents, by cancelling the pending expiry', async () => {
    await uploadAs(TEST_SESSION, 'mine.txt');
    await request(app, TEST_SESSION).post('/session/end');

    // What a reload does first: load the list.
    const afterReload = await request(app, TEST_SESSION).get('/documents');
    expect(afterReload.body.items.map((d) => d.filename)).toEqual(['mine.txt']);

    const Document = require('../src/models/Document');
    const [mine] = await withSession(() => Document.find({}).lean(), TEST_SESSION);
    expect(mine.expiresAt.getTime() - Date.now()).toBeGreaterThan(config.sessionGraceMs * 2);
  });

  test('ending a session twice is not an error — teardown gets no second chance to handle one', async () => {
    await uploadAs(TEST_SESSION, 'mine.txt');
    expect((await request(app, TEST_SESSION).post('/session/end')).status).toBe(204);
    expect((await request(app, TEST_SESSION).post('/session/end')).status).toBe(204);
  });

  test('clearing documents explicitly still deletes them there and then', async () => {
    const created = (await uploadAs(TEST_SESSION, 'mine.txt')).body;
    // "Clear all" is a deliberate act, not a guess about whether someone
    // left, so it deletes immediately rather than scheduling anything.
    expect((await request(app, TEST_SESSION).delete(`/documents/${created._id}`)).status).toBe(204);
    expect((await request(app, TEST_SESSION).get('/documents')).body.items).toEqual([]);
  });
});
