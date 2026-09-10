const { classifyFile } = require('../src/services/fileTypes');

describe('classifyFile', () => {
  test('classifies PDFs by mime type or extension', () => {
    expect(classifyFile('invoice.pdf', 'application/pdf').kind).toBe('pdf');
    expect(classifyFile('weird-name', 'application/pdf').kind).toBe('pdf');
    expect(classifyFile('scan.PDF', 'application/octet-stream').kind).toBe('pdf');
  });

  test('classifies common image mime types', () => {
    expect(classifyFile('photo.jpg', 'image/jpeg').kind).toBe('image');
    expect(classifyFile('photo.png', 'image/png').kind).toBe('image');
    expect(classifyFile('photo.webp', 'image/webp').kind).toBe('image');
  });

  test('classifies plain text-ish files by extension or mime prefix', () => {
    expect(classifyFile('notes.txt', 'text/plain').kind).toBe('text');
    expect(classifyFile('data.csv', 'application/octet-stream').kind).toBe('text');
    expect(classifyFile('readme.md', '').kind).toBe('text');
  });

  test('rejects unsupported types with a human-readable reason', () => {
    const result = classifyFile('resume.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    expect(result.kind).toBe('unsupported');
    expect(result.reason).toMatch(/docx/i);
  });

  test('rejects unknown binary with no extension and no mime type', () => {
    const result = classifyFile('mystery', '');
    expect(result.kind).toBe('unsupported');
  });
});
