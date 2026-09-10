// Deterministic color per doc type string, so "invoice" is always the same
// hue across the whole app without maintaining a manual color map for types
// we don't know in advance.
export function hashHue(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i += 1) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) % 360;
}

export function docTypeColor(docType) {
  if (!docType) return 'hsl(0, 0%, 55%)';
  const hue = hashHue(docType);
  return `hsl(${hue}, 55%, 45%)`;
}
