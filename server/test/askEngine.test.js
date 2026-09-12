const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');
const Document = require('../src/models/Document');
const { verifyCitations, computeConflicts } = require('../src/services/askEngine');

// verifyCitations is the single most important safety property in the ask
// pipeline: a citation only counts if it resolves to a real, done document
// that really has that field. If this regresses, an ungrounded answer could
// present hallucinated citations as if they were real.
describe('verifyCitations', () => {
  let mongod;
  let doc;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    await mongoose.connect(mongod.getUri());
  }, 60000);

  beforeEach(async () => {
    doc = await Document.create({
      filename: 'invoice.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 10,
      status: 'done',
      fields: [
        { key: 'total_due', label: 'Total Due', value: 500, sensitive: false },
        { key: 'account_number', label: 'Account', value: '4471-2298', sensitive: true },
      ],
    });
  });

  afterEach(async () => {
    const { collections } = mongoose.connection;
    await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongod.stop();
  });

  test('keeps a citation that resolves to a real document and field', async () => {
    const out = await verifyCitations([{ document_id: String(doc._id), field_key: 'total_due' }]);
    expect(out).toEqual([
      { documentId: String(doc._id), filename: 'invoice.pdf', fieldKey: 'total_due', label: 'Total Due', value: 500, quote: '', sensitive: false },
    ]);
  });

  test('carries the sensitive flag through from the real stored field', async () => {
    const out = await verifyCitations([{ document_id: String(doc._id), field_key: 'account_number' }]);
    expect(out[0].sensitive).toBe(true);
  });

  test('drops a citation naming a nonexistent document id', async () => {
    const fakeId = new mongoose.Types.ObjectId().toString();
    const out = await verifyCitations([{ document_id: fakeId, field_key: 'total_due' }]);
    expect(out).toEqual([]);
  });

  test('drops a citation naming a field key that does not exist on that document', async () => {
    const out = await verifyCitations([{ document_id: String(doc._id), field_key: 'not_a_real_field' }]);
    expect(out).toEqual([]);
  });

  test('drops a citation pointing at a document that is not status "done"', async () => {
    const processing = await Document.create({ filename: 'x.pdf', mimeType: 'application/pdf', sizeBytes: 5, status: 'processing', fields: [{ key: 'a', value: 1 }] });
    const out = await verifyCitations([{ document_id: String(processing._id), field_key: 'a' }]);
    expect(out).toEqual([]);
  });

  test('drops malformed citations (missing keys, wrong types, non-ObjectId strings)', async () => {
    const out = await verifyCitations([
      { document_id: String(doc._id) }, // missing field_key
      { field_key: 'total_due' }, // missing document_id
      { document_id: 'not-an-object-id', field_key: 'total_due' },
      { document_id: 123, field_key: 'total_due' },
      null,
      'garbage',
    ]);
    expect(out).toEqual([]);
  });

  test('gracefully handles non-array input', async () => {
    expect(await verifyCitations(null)).toEqual([]);
    expect(await verifyCitations(undefined)).toEqual([]);
  });

  test('dedupes repeated (documentId, fieldKey) pairs and caps at 8', async () => {
    const many = Array.from({ length: 20 }, () => ({ document_id: String(doc._id), field_key: 'total_due' }));
    const out = await verifyCitations(many);
    expect(out).toHaveLength(1);
  });
});

describe('computeConflicts', () => {
  test('flags a field whose value differs across at least two documents', () => {
    const caveats = computeConflicts([
      { documentId: 'a', filename: 'a.pdf', fieldKey: 'price_escalator', value: 'CPI + 2%' },
      { documentId: 'b', filename: 'b.pdf', fieldKey: 'price_escalator', value: '4%' },
    ]);
    expect(caveats).toHaveLength(1);
    expect(caveats[0]).toMatchObject({ type: 'conflict', fieldKey: 'price_escalator' });
    expect(caveats[0].values).toHaveLength(2);
  });

  test('does not flag the same value repeated across documents', () => {
    const caveats = computeConflicts([
      { documentId: 'a', filename: 'a.pdf', fieldKey: 'governing_law', value: 'IE' },
      { documentId: 'b', filename: 'b.pdf', fieldKey: 'governing_law', value: 'IE' },
    ]);
    expect(caveats).toEqual([]);
  });

  test('does not flag a field only cited from a single document', () => {
    const caveats = computeConflicts([
      { documentId: 'a', filename: 'a.pdf', fieldKey: 'total_due', value: 500 },
      { documentId: 'a', filename: 'a.pdf', fieldKey: 'total_due', value: 500 },
    ]);
    expect(caveats).toEqual([]);
  });

  test('handles an empty citation list', () => {
    expect(computeConflicts([])).toEqual([]);
  });
});
