// Walk an arbitrarily-shaped value (object/array/primitive) and collect every
// primitive leaf into a single lowercase, whitespace-joined string. Used to
// build the free-text search index over `fields`, whose shape we can't know
// in advance since it comes straight from the LLM's read of an arbitrary
// document.
function flattenToSearchableText(value, depth = 0) {
  if (value === null || value === undefined) return '';
  if (depth > 6) return ''; // guard against pathological/cyclic-looking input

  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  if (Array.isArray(value)) {
    return value.map((v) => flattenToSearchableText(v, depth + 1)).join(' ');
  }

  if (typeof value === 'object') {
    return Object.keys(value)
      .map((key) => `${key} ${flattenToSearchableText(value[key], depth + 1)}`)
      .join(' ');
  }

  return '';
}

// `fields` is now an array of field descriptors ({key, label, value, ...}),
// not an arbitrary nested object — so instead of flattening the whole
// descriptor (which would pull quote/confidence/reviewNote text into the
// search index too), we flatten just each field's own key/label/value.
function buildSearchableText({ filename, docType, summary, fields }) {
  const fieldsText = Array.isArray(fields)
    ? fields.map((f) => `${f.key || ''} ${f.label || ''} ${flattenToSearchableText(f.value)}`).join(' ')
    : '';
  return [filename, docType, summary, fieldsText]
    .filter(Boolean)
    .join(' ')
    .slice(0, 20000); // keep the index sane even for very field-heavy documents
}

// The derived `{key: value}` shadow of `fields`, used only so smart-search
// filtering can keep querying a flat path (`fieldIndex.<key>`) instead of
// needing `$elemMatch` against the fields array — see decisions.md. Must be
// recomputed and re-saved every time `fields` changes; there is no code path
// that's allowed to write `fields` without also calling this.
function buildFieldIndex(fields) {
  const index = {};
  if (Array.isArray(fields)) {
    for (const f of fields) {
      if (f && f.key) index[f.key] = f.value;
    }
  }
  return index;
}

module.exports = { flattenToSearchableText, buildSearchableText, buildFieldIndex };
