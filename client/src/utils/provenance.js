// Turns a document's real transcription + its extracted fields into the
// clickable-span structure the Review screen renders — the real
// counterpart to the mock engine's hand-authored `lines`/`segs`.
//
// A field's `quote` is trusted only as far as `documentText.indexOf(quote)`
// takes it: if it's not there verbatim (a hallucinated or paraphrased
// quote), that field's text just never gets a clickable span — nothing
// else about the page breaks. Overlapping quotes are resolved
// first-match-wins by position, not by which field "should" win; two
// fields can't sensibly claim the same span anyway.
export function buildProvenanceSegments(documentText, fields) {
  if (!documentText) return [];

  const matches = [];
  for (const f of fields || []) {
    if (!f.quote) continue;
    const idx = documentText.indexOf(f.quote);
    if (idx === -1) continue; // quote doesn't actually appear — silently skip
    matches.push({ start: idx, end: idx + f.quote.length, fieldKey: f.key });
  }
  matches.sort((a, b) => a.start - b.start);

  const kept = [];
  let lastEnd = -1;
  for (const m of matches) {
    if (m.start < lastEnd) continue; // overlaps an already-kept match
    kept.push(m);
    lastEnd = m.end;
  }

  const segments = [];
  let cursor = 0;
  for (const m of kept) {
    if (m.start > cursor) segments.push({ text: documentText.slice(cursor, m.start), fieldKey: null });
    segments.push({ text: documentText.slice(m.start, m.end), fieldKey: m.fieldKey });
    cursor = m.end;
  }
  if (cursor < documentText.length) segments.push({ text: documentText.slice(cursor), fieldKey: null });
  return segments;
}

// Splits a flat segment list on newlines into "lines" shaped for the
// existing ReviewScreen DocLine component (kind 'p' for flowing text, 'gap'
// for a blank line). Real documents render as flowing highlighted
// paragraphs — the mock's hand-styled invoice layout (kind 'h'/'li'/'sum')
// was authored per specific sample document and isn't something a generic
// transcript can be mapped back into.
export function segmentsToLines(segments) {
  const lines = [[]];
  for (const seg of segments) {
    const parts = seg.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part.length > 0) lines[lines.length - 1].push({ text: part, fieldKey: seg.fieldKey });
    });
  }
  return lines.map((segs) => (segs.length === 0 ? { kind: 'gap', segments: [] } : { kind: 'p', segments: segs }));
}

export function buildProvenanceLines(documentText, fields) {
  return segmentsToLines(buildProvenanceSegments(documentText, fields));
}
