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

function buildSearchableText({ filename, docType, summary, fields }) {
  return [filename, docType, summary, flattenToSearchableText(fields)]
    .filter(Boolean)
    .join(' ')
    .slice(0, 20000); // keep the index sane even for very field-heavy documents
}

module.exports = { flattenToSearchableText, buildSearchableText };
