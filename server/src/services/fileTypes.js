// Central place that decides which documents we support and how each one
// should reach the model. Keeping this as an explicit allowlist (rather than
// "try to process anything") means an unsupported file gets a clear, honest
// error instead of silently failing deep inside the extraction call.
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.log'];
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const PDF_MIME_TYPE = 'application/pdf';

function extensionOf(filename) {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

/**
 * @returns {{ kind: 'text'|'image'|'pdf' } | { kind: 'unsupported', reason: string }}
 */
function classifyFile(filename, mimeType) {
  const ext = extensionOf(filename);

  if (mimeType === PDF_MIME_TYPE || ext === '.pdf') {
    return { kind: 'pdf' };
  }
  if (IMAGE_MIME_TYPES.includes(mimeType)) {
    return { kind: 'image' };
  }
  if (TEXT_EXTENSIONS.includes(ext) || mimeType?.startsWith('text/')) {
    return { kind: 'text' };
  }
  return {
    kind: 'unsupported',
    reason:
      `"${ext || mimeType || 'unknown'}" isn't supported yet. ` +
      'Try a PDF, a photo/scan (PNG, JPEG, WEBP), or a plain text/CSV file. ' +
      '(.docx/.doc aren’t supported — export or print to PDF first.)',
  };
}

module.exports = { classifyFile, TEXT_EXTENSIONS, IMAGE_MIME_TYPES, PDF_MIME_TYPE };
