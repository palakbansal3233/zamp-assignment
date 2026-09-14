const { normalizeFields } = require('../src/services/extraction');

// normalizeFields is the boundary between "what the model said" and "what
// this app is willing to store". Everything here is a rule about not
// passing the model's output straight through.
describe('normalizeFields', () => {
  const raw = (over = {}) => ({ key: 'deposit', value: 2175, quote: '2,175.00', confidence: 0.9, needs_review: false, sensitive: false, ...over });

  test('maps the model’s snake_case response onto the stored shape', () => {
    const [field] = normalizeFields([raw({ label: 'Security Deposit' })]);
    expect(field).toMatchObject({ key: 'deposit', label: 'Security Deposit', value: 2175, quote: '2,175.00', confidence: 0.9, confirmed: false });
  });

  test('derives a readable label when the model omits one', () => {
    const [field] = normalizeFields([raw({ key: 'security_deposit_amount', label: undefined })]);
    expect(field.label).toBe('Security Deposit Amount');
  });

  test('clamps confidence into 0..1 and defaults a missing one', () => {
    expect(normalizeFields([raw({ confidence: 4.2 })])[0].confidence).toBe(1);
    expect(normalizeFields([raw({ confidence: -3 })])[0].confidence).toBe(0);
    expect(normalizeFields([raw({ confidence: 'high' })])[0].confidence).toBe(0.5);
  });

  test('keeps a review flag that comes with a reason, and the options to resolve it', () => {
    const [field] = normalizeFields([
      raw({ needs_review: true, review_note: 'Clause 4 and Schedule A disagree.', review_actions: ['Keep 2,175.00', 'Keep 2,750.00'] }),
    ]);
    expect(field.needsReview).toBe(true);
    expect(field.reviewNote).toBe('Clause 4 and Schedule A disagree.');
    expect(field.reviewActions).toEqual(['Keep 2,175.00', 'Keep 2,750.00']);
  });

  test('drops a review flag with no reason — an unexplained warning isn’t actionable', () => {
    // The uncertainty isn't lost: it still shows up as the confidence score.
    const [noNote] = normalizeFields([raw({ needs_review: true, confidence: 0.55 })]);
    expect(noNote.needsReview).toBe(false);
    expect(noNote.reviewNote).toBeNull();
    expect(noNote.confidence).toBe(0.55);

    const [blankNote] = normalizeFields([raw({ needs_review: true, review_note: '   ' })]);
    expect(blankNote.needsReview).toBe(false);
  });

  test('only carries a sensitivity reason when the field is actually sensitive', () => {
    expect(normalizeFields([raw({ sensitive: true, sensitivity_reason: 'bank details' })])[0]).toMatchObject({
      sensitive: true, sensitivityReason: 'bank details',
    });
    expect(normalizeFields([raw({ sensitive: false, sensitivity_reason: 'leftover' })])[0].sensitivityReason).toBeNull();
  });

  test('drops malformed entries and keeps the first of a duplicated key', () => {
    const fields = normalizeFields([
      null,
      'nonsense',
      { value: 'no key at all' },
      raw({ key: '  ' }),
      raw({ key: 'rent', value: 1450 }),
      raw({ key: 'rent', value: 9999 }),
    ]);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ key: 'rent', value: 1450 });
  });

  test('tolerates a non-array where fields were expected', () => {
    expect(normalizeFields(undefined)).toEqual([]);
    expect(normalizeFields({ key: 'nope' })).toEqual([]);
  });
});
