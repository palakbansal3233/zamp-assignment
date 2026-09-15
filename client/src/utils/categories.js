// Extraction infers a document type per document, freely — that's the whole
// point of the schema-agnostic design, and it means the types that come back
// are long-tailed: `rental_agreement`, `tenancy_agreement`, `lease`,
// `book_page`, `e_stamp_certificate`. Useful as a label, useless as a way to
// organise a list, because you end up with one heading per document.
//
// Categories are the coarse layer on top: a handful of buckets a person
// would actually recognise, matched by keyword so an unseen type still lands
// somewhere sensible rather than needing the list to be exhaustive.
const CATEGORIES = [
  {
    id: 'agreements',
    label: 'Agreements & contracts',
    icon: 'ph ph-scroll',
    match: /agreement|contract|lease|tenanc|rental|terms|nda|deed|policy|licen[cs]e/,
  },
  {
    id: 'money',
    label: 'Bills & payments',
    icon: 'ph ph-receipt',
    match: /invoice|receipt|bill|statement|payslip|payment|quote|estimate|tax|salary/,
  },
  {
    id: 'health',
    label: 'Health',
    icon: 'ph ph-first-aid-kit',
    match: /prescription|medical|health|lab_result|diagnos|discharge|clinic|patient|dental/,
  },
  {
    id: 'official',
    label: 'Official & identity',
    icon: 'ph ph-identification-card',
    match: /certificate|passport|identity|\bid\b|stamp|registration|permit|visa|licence_plate|govern/,
  },
  {
    id: 'correspondence',
    label: 'Letters & notices',
    icon: 'ph ph-envelope-simple-open',
    match: /letter|notice|memo|email|correspond/,
  },
  {
    id: 'personal',
    label: 'Notes & personal',
    icon: 'ph ph-notepad',
    match: /note|book|page|photo|diary|journal|recipe|handwritten|resume|cv/,
  },
];

const OTHER = { id: 'other', label: 'Everything else', icon: 'ph ph-file-text' };

export function categoryFor(docType) {
  if (!docType) return OTHER;
  const key = String(docType).toLowerCase();
  return CATEGORIES.find((c) => c.match.test(key)) || OTHER;
}

/**
 * Groups queue items by category, preserving the order items arrived in and
 * the order categories are declared above.
 *
 * Returns `null` when nothing has a category — the demo engine's fixtures
 * don't carry one, and a single heading over a single list is just noise, so
 * the screen falls back to a plain list in that case.
 */
export function groupByCategory(items) {
  if (!items.some((i) => i.category)) return null;

  const buckets = new Map();
  for (const item of items) {
    const cat = item.category || OTHER;
    if (!buckets.has(cat.id)) buckets.set(cat.id, { ...cat, items: [] });
    buckets.get(cat.id).items.push(item);
  }

  const order = [...CATEGORIES.map((c) => c.id), OTHER.id];
  return [...buckets.values()].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
}
