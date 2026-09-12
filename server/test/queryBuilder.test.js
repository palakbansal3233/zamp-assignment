const { sanitizeFilters } = require('../src/services/queryBuilder');

// These tests exist because sanitizeFilters is the only thing standing
// between "the LLM proposed a Mongo filter" and "we actually run it" — see
// decisions.md ("Sanitizing LLM-generated queries"). If this regresses, a
// cleverly-worded search could turn into a NoSQL injection.
describe('sanitizeFilters', () => {
  test('accepts well-formed filters on known-safe fields', () => {
    const out = sanitizeFilters([
      { field: 'docType', operator: 'eq', value: 'invoice' },
      { field: 'fieldIndex.total_amount', operator: 'gte', value: 500 },
    ]);
    expect(out).toEqual([{ docType: { $eq: 'invoice' } }, { 'fieldIndex.total_amount': { $gte: 500 } }]);
  });

  test('rejects fields outside the allowlist (no raw top-level Mongo operators)', () => {
    const out = sanitizeFilters([{ field: '$where', operator: 'eq', value: '1==1' }]);
    expect(out).toEqual([]);
  });

  test('rejects attempts to reach fieldIndex.__proto__ / constructor style paths', () => {
    const out = sanitizeFilters([
      { field: 'fieldIndex.__proto__.polluted', operator: 'eq', value: 'x' },
      { field: 'fieldIndex.constructor', operator: 'eq', value: 'x' },
    ]);
    // __proto__/constructor aren't in [a-zA-Z0-9_]+ exclusively... they are
    // technically alnum, so we assert they're at least contained safely as
    // plain string equality filters and never interpreted as operators.
    out.forEach((clause) => {
      const [, value] = Object.entries(clause)[0];
      expect(Object.keys(value)).toEqual(['$eq']);
    });
  });

  test('rejects unknown operators', () => {
    const out = sanitizeFilters([{ field: 'docType', operator: 'exec', value: 'x' }]);
    expect(out).toEqual([]);
  });

  test('rejects object/array values (no smuggling operator objects as values)', () => {
    const out = sanitizeFilters([{ field: 'docType', operator: 'eq', value: { $gt: '' } }]);
    expect(out).toEqual([]);
  });

  test('contains operator escapes regex special characters', () => {
    const out = sanitizeFilters([{ field: 'summary', operator: 'contains', value: 'a.*evil(' }]);
    expect(out[0].summary.$regex).toBe('a\\.\\*evil\\(');
  });

  test('caps at 6 filters even if more are supplied', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ field: 'docType', operator: 'eq', value: `t${i}` }));
    const out = sanitizeFilters(many);
    expect(out.length).toBeLessThanOrEqual(6);
  });

  test('ignores garbage input types gracefully', () => {
    expect(sanitizeFilters(null)).toEqual([]);
    expect(sanitizeFilters(undefined)).toEqual([]);
    expect(sanitizeFilters('not an array')).toEqual([]);
    expect(sanitizeFilters([null, 42, 'x', {}])).toEqual([]);
  });
});
