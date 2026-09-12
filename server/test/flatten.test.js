const { flattenToSearchableText, buildSearchableText, buildFieldIndex } = require('../src/utils/flatten');

describe('flattenToSearchableText', () => {
  test('flattens nested objects and arrays into one string', () => {
    const text = flattenToSearchableText({
      vendor: 'Acme Corp',
      line_items: [
        { description: 'Widget', price: 9.99 },
        { description: 'Gadget', price: 19.99 },
      ],
      paid: false,
    });
    expect(text).toContain('Acme Corp');
    expect(text).toContain('Widget');
    expect(text).toContain('Gadget');
    expect(text).toContain('9.99');
    expect(text).toContain('false');
  });

  test('handles null/undefined/empty gracefully', () => {
    expect(flattenToSearchableText(null)).toBe('');
    expect(flattenToSearchableText(undefined)).toBe('');
    expect(flattenToSearchableText({})).toBe('');
  });

  test('does not throw on deeply nested or malformed shapes', () => {
    const deep = { a: { b: { c: { d: { e: { f: { g: 'too deep' } } } } } } };
    expect(() => flattenToSearchableText(deep)).not.toThrow();
  });
});

describe('buildSearchableText', () => {
  test('combines filename, docType, summary and fields (array shape), and caps length', () => {
    const text = buildSearchableText({
      filename: 'invoice-2024.pdf',
      docType: 'invoice',
      summary: 'An invoice from Acme.',
      fields: [
        { key: 'vendor_name', label: 'Vendor', value: 'Acme Corp' },
        { key: 'total_amount', label: 'Total', value: 42 },
      ],
    });
    expect(text).toContain('invoice-2024.pdf');
    expect(text).toContain('Acme Corp');
    expect(text).toContain('vendor_name');
    expect(text.length).toBeLessThanOrEqual(20000);
  });

  test('tolerates a missing/non-array fields value instead of throwing', () => {
    expect(() => buildSearchableText({ filename: 'x.txt', docType: null, summary: '', fields: undefined })).not.toThrow();
  });
});

describe('buildFieldIndex', () => {
  test('builds a flat {key: value} map from the fields array', () => {
    const index = buildFieldIndex([
      { key: 'vendor_name', value: 'Acme Corp' },
      { key: 'total_amount', value: 42 },
    ]);
    expect(index).toEqual({ vendor_name: 'Acme Corp', total_amount: 42 });
  });

  test('skips malformed entries and handles empty/non-array input', () => {
    expect(buildFieldIndex([{ value: 'no key' }, null, { key: 'ok', value: 1 }])).toEqual({ ok: 1 });
    expect(buildFieldIndex([])).toEqual({});
    expect(buildFieldIndex(undefined)).toEqual({});
  });
});
