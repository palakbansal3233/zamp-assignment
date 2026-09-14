// Central place that decides which documents we support and how each one
// should reach the model. Keeping this as an explicit allowlist (rather than
// "try to process anything") means an unsupported file gets a clear, honest
// error instead of silently failing deep inside the extraction call.
//
// The list is scoped to what the person this is built for actually holds:
// a rental agreement (PDF or DOCX), a prescription or receipt photographed
// on a phone (image), an emailed invoice (PDF), notes or exported data
// (text/CSV). Not video, not audio, not archives — see decisions.md.
const TEXT_EXTENSIONS = ['.txt', '.md', '.csv', '.json', '.log'];
const IMAGE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const PDF_MIME_TYPE = 'application/pdf';
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

function extensionOf(filename) {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx).toLowerCase();
}

/**
 * @returns {{ kind: 'text'|'image'|'pdf'|'docx' } | { kind: 'unsupported', reason: string }}
 */
function classifyFile(filename, mimeType) {
  const ext = extensionOf(filename);

  if (mimeType === PDF_MIME_TYPE || ext === '.pdf') {
    return { kind: 'pdf' };
  }
  if (mimeType === DOCX_MIME_TYPE || ext === '.docx') {
    return { kind: 'docx' };
  }
  if (IMAGE_MIME_TYPES.includes(mimeType)) {
    return { kind: 'image' };
  }
  if (TEXT_EXTENSIONS.includes(ext) || mimeType?.startsWith('text/')) {
    return { kind: 'text' };
  }

  // `.doc` (the pre-2007 binary format) is called out separately because
  // it's the single most likely near-miss now that `.docx` works — a
  // generic "unsupported" would leave someone re-uploading the same file.
  if (ext === '.doc') {
    return {
      kind: 'unsupported',
      reason: 'Old-format .doc files aren’t supported — open it and "Save as" .docx or PDF, then try again.',
    };
  }

  return {
    kind: 'unsupported',
    reason:
      `"${ext || mimeType || 'unknown'}" isn't supported. ` +
      'Try a PDF, a Word document (.docx), a photo or scan (PNG, JPEG, WEBP), or a plain text/CSV file.',
  };
}

module.exports = { classifyFile, TEXT_EXTENSIONS, IMAGE_MIME_TYPES, PDF_MIME_TYPE, DOCX_MIME_TYPE };
