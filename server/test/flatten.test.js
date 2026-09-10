const { flattenToSearchableText, buildSearchableText } = require('../src/utils/flatten');

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
  test('combines filename, docType, summary and fields, and caps length', () => {
    const text = buildSearchableText({
      filename: 'invoice-2024.pdf',
      docType: 'invoice',
      summary: 'An invoice from Acme.',
      fields: { vendor_name: 'Acme Corp', total_amount: 42 },
    });
    expect(text).toContain('invoice-2024.pdf');
    expect(text).toContain('Acme Corp');
    expect(text.length).toBeLessThanOrEqual(20000);
  });
});
