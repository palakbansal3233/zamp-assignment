const { PDFDocument } = require('pdf-lib');
const { getChunkPlan, buildChunkInput, mergeChunkResult, PAGES_PER_CHUNK, CHARS_PER_CHUNK } = require('../src/services/chunking');

async function makePdf(pageCount) {
  const pdf = await PDFDocument.create();
  for (let i = 0; i < pageCount; i += 1) pdf.addPage([200, 200]);
  return Buffer.from(await pdf.save());
}

describe('getChunkPlan', () => {
  test('splits a multi-page PDF into page-range chunks', async () => {
    const buffer = await makePdf(7);
    const plan = await getChunkPlan({ kind: 'pdf', buffer });
    expect(plan.unit).toBe('page');
    expect(plan.totalUnits).toBe(7);
    expect(plan.totalChunks).toBe(Math.ceil(7 / PAGES_PER_CHUNK));
  });

  test('a single-page PDF is one chunk', async () => {
    const plan = await getChunkPlan({ kind: 'pdf', buffer: await makePdf(1) });
    expect(plan.totalChunks).toBe(1);
  });

  test('rejects a PDF that cannot be opened with actionable advice rather than a stack trace', async () => {
    const notAPdf = Buffer.from('this is definitely not a pdf');
    await expect(getChunkPlan({ kind: 'pdf', buffer: notAPdf })).rejects.toMatchObject({
      status: 422,
      message: expect.stringMatching(/password-protected or corrupted/i),
    });
  });

  test('splits long text into character-range chunks, short text into one', async () => {
    const long = Buffer.from('x'.repeat(CHARS_PER_CHUNK * 2 + 10));
    expect((await getChunkPlan({ kind: 'text', buffer: long })).totalChunks).toBe(3);

    const short = Buffer.from('just a receipt');
    expect((await getChunkPlan({ kind: 'text', buffer: short })).totalChunks).toBe(1);
  });

  test('an image is always a single chunk — there is nothing to split', async () => {
    const plan = await getChunkPlan({ kind: 'image', buffer: Buffer.from([1, 2, 3]) });
    expect(plan.totalChunks).toBe(1);
  });
});

describe('buildChunkInput', () => {
  test('builds a real, smaller PDF containing only that chunk’s pages', async () => {
    const buffer = await makePdf(7);
    const plan = await getChunkPlan({ kind: 'pdf', buffer });

    const second = await buildChunkInput({ kind: 'pdf', buffer, filename: 'lease.pdf', index: 1, plan });
    expect(second.kind).toBe('pdf');

    // The slice must genuinely be a smaller PDF, not the whole file again —
    // otherwise "chunking" would just be re-reading the document N times.
    const sliced = await PDFDocument.load(second.buffer);
    expect(sliced.getPageCount()).toBe(PAGES_PER_CHUNK);
    expect(second.buffer.length).toBeLessThan(buffer.length);
    // Derived from the constant, not hardcoded — chunk size is a tuning
    // knob (it moved 3 -> 2 on production evidence) and a test that has to
    // be edited every time it's tuned is just friction.
    const start = PAGES_PER_CHUNK + 1;
    expect(second.chunkContext.label).toBe(`pages ${start}-${start + PAGES_PER_CHUNK - 1} of 7`);
  });

  test('the final PDF chunk covers only the remaining pages', async () => {
    const buffer = await makePdf(7);
    const plan = await getChunkPlan({ kind: 'pdf', buffer });
    const last = await buildChunkInput({ kind: 'pdf', buffer, filename: 'lease.pdf', index: plan.totalChunks - 1, plan });
    const sliced = await PDFDocument.load(last.buffer);
    expect(sliced.getPageCount()).toBe(1); // 7 pages, 3 per chunk -> last chunk has 1
  });

  test('slices text by character range and labels the part', async () => {
    const text = 'A'.repeat(CHARS_PER_CHUNK) + 'B'.repeat(500);
    const buffer = Buffer.from(text);
    const plan = await getChunkPlan({ kind: 'text', buffer });

    const first = await buildChunkInput({ kind: 'text', buffer, filename: 'notes.txt', index: 0, plan });
    const second = await buildChunkInput({ kind: 'text', buffer, filename: 'notes.txt', index: 1, plan });

    expect(first.text).toHaveLength(CHARS_PER_CHUNK);
    expect(second.text).toBe('B'.repeat(500));
    expect(second.chunkContext.label).toBe('part 2 of 2');
  });

  test('a single-chunk document carries no chunk context (the model shouldn’t be told it’s a fragment)', async () => {
    const buffer = Buffer.from('short receipt');
    const plan = await getChunkPlan({ kind: 'text', buffer });
    const only = await buildChunkInput({ kind: 'text', buffer, filename: 'r.txt', index: 0, plan });
    expect(only.chunkContext).toBeFalsy();
  });
});

// These rules are the ones that keep a long document's later pages from
// quietly weakening what its earlier pages established.
describe('mergeChunkResult', () => {
  const emptyDoc = { fields: [], documentText: '', docType: null, summary: '', unreadable: false, unreadableReason: null };
  const field = (key, over = {}) => ({
    key, label: key, value: 'v', quote: '', confidence: 0.8,
    needsReview: false, reviewNote: null, reviewActions: [], confirmed: false,
    resolvedAction: null, sensitive: false, sensitivityReason: null, ...over,
  });

  test('concatenates transcriptions and unions new fields', () => {
    const afterFirst = mergeChunkResult(emptyDoc, {
      fields: [field('rent')], documentText: 'page one', docType: 'rental_agreement', summary: 'A lease.', unreadable: false,
    });
    const afterSecond = mergeChunkResult(afterFirst, {
      fields: [field('notice_period')], documentText: 'page two', docType: 'other', summary: 'Signatures.', unreadable: false,
    });

    expect(afterSecond.documentText).toBe('page one\n\npage two');
    expect(afterSecond.fields.map((f) => f.key).sort()).toEqual(['notice_period', 'rent']);
  });

  test('keeps the first real classification — a signature page must not relabel the whole document', () => {
    const afterFirst = mergeChunkResult(emptyDoc, {
      fields: [], documentText: 'page one', docType: 'rental_agreement', summary: 'A lease.', unreadable: false,
    });
    const afterSecond = mergeChunkResult(afterFirst, {
      fields: [], documentText: 'signatures', docType: 'other', summary: 'Just signatures.', unreadable: false,
    });
    expect(afterSecond.docType).toBe('rental_agreement');
    expect(afterSecond.summary).toBe('A lease.');
  });

  test('on a duplicate key, the higher-confidence reading wins', () => {
    const afterFirst = mergeChunkResult(emptyDoc, { fields: [field('deposit', { value: '1000', confidence: 0.5 })], documentText: 'a', unreadable: false });
    const afterSecond = mergeChunkResult(afterFirst, { fields: [field('deposit', { value: '2000', confidence: 0.95 })], documentText: 'b', unreadable: false });
    expect(afterSecond.fields.find((f) => f.key === 'deposit').value).toBe('2000');
  });

  test('a needs-review flag is sticky — a more confident later chunk cannot silently clear it', () => {
    const afterFirst = mergeChunkResult(emptyDoc, {
      fields: [field('deposit', { confidence: 0.4, needsReview: true, reviewNote: 'handwriting unclear', reviewActions: ['Keep 1000'] })],
      documentText: 'a', unreadable: false,
    });
    const afterSecond = mergeChunkResult(afterFirst, {
      fields: [field('deposit', { confidence: 0.99, needsReview: false })],
      documentText: 'b', unreadable: false,
    });

    const deposit = afterSecond.fields.find((f) => f.key === 'deposit');
    expect(deposit.needsReview).toBe(true);
    expect(deposit.reviewNote).toBe('handwriting unclear');
  });

  test('a sensitivity flag is sticky for the same reason', () => {
    const afterFirst = mergeChunkResult(emptyDoc, {
      fields: [field('account', { sensitive: true, sensitivityReason: 'bank account number', confidence: 0.5 })],
      documentText: 'a', unreadable: false,
    });
    const afterSecond = mergeChunkResult(afterFirst, {
      fields: [field('account', { sensitive: false, confidence: 0.99 })],
      documentText: 'b', unreadable: false,
    });

    const account = afterSecond.fields.find((f) => f.key === 'account');
    expect(account.sensitive).toBe(true);
    expect(account.sensitivityReason).toBe('bank account number');
  });

  test('unreadable only survives when nothing at all was read, from any chunk', () => {
    const allBlank = mergeChunkResult(emptyDoc, { fields: [], documentText: '', unreadable: true, unreadableReason: 'blank scan' });
    expect(allBlank.unreadable).toBe(true);

    // One blank page inside a document that read fine elsewhere is not an
    // unreadable document.
    const readSomething = mergeChunkResult(
      { ...emptyDoc, documentText: 'page one read fine' },
      { fields: [], documentText: '', unreadable: true, unreadableReason: 'blank page' }
    );
    expect(readSomething.unreadable).toBe(false);
    expect(readSomething.unreadableReason).toBeNull();
  });
});
