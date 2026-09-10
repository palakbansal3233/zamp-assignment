// Demo/showcase data ported from the Claude Design export (Sift.dc.html).
// This drives the States panel — see decisions.md for which of these 15
// scenarios are backed by real logic once the app is wired to the real API
// (Phase B) versus kept here as illustrative-only demo states (the ones
// that would need infrastructure — auth, billing, an offline sync queue —
// this assignment deliberately doesn't build).

export const DOCS = [
  {
    id: 'inv', name: 'northwind-invoice-2291.pdf', kind: 'Invoice', icon: 'ph ph-receipt',
    label: 'Invoice 2291', meta: 'PDF · 1 page · text layer found · read in 1.4s',
    schemaNote: '11 fields inferred from the document itself — no template was applied',
    newFields: ['discount_pct', 'vat_id', 'delivery_site'],
    lines: [
      { k: 'h', segs: [['NORTHWIND SUPPLY CO.', null]] },
      { k: 'small', segs: [['Unit 4, Ashbourne Business Park, Co. Meath, Ireland', null]] },
      { k: 'gap', segs: [['', null]] },
      { k: 'row', segs: [['Invoice ', null], ['INV-2291', 'invoice_no'], ['   ·   Issued ', null], ['14 March 2025', 'issue_date']] },
      { k: 'p', segs: [['Bill to ', null], ['Meridian Health Group, 40 Pearse Street, Dublin 2', 'customer']] },
      { k: 'p', segs: [['Deliver to ', null], ['Meridian Clinic — Sandyford', 'delivery_site']] },
      { k: 'gap', segs: [['', null]] },
      { k: 'li', amt: '5,120.00', segs: [['Nitrile gloves, M, case of 1000 · 8 × 640.00', null]] },
      { k: 'li', amt: '3,780.00', segs: [['Sterile drape kit · 12 × 315.00', null]] },
      { k: 'li', amt: '3,500.00', segs: [['Sharps bin 7L · 40 × 87.50', null]] },
      { k: 'gap', segs: [['', null]] },
      { k: 'sum', amt: '12,400.00', segs: [['Subtotal', null]] },
      { k: 'sum', amt: '-496.00', segs: [['Volume discount ', null], ['4%', 'discount_pct']] },
      { k: 'sum', amt: '2,847.92', segs: [['VAT 23%', null]] },
      { k: 'row', segs: [['Total due   ', null], ['EUR 14,751.92', 'total']] },
      { k: 'gap', segs: [['', null]] },
      { k: 'p', segs: [['Payment terms: ', null], ['Net 45 days from invoice date', 'terms'], ['. Late balances accrue 1.5% monthly.', null]] },
      { k: 'small', segs: [['VAT ID ', null], ['IE 4839201K', 'vat_id'], ['   ·   PO reference MHG-PO-8842', null]] }
    ],
    fields: [
      { id: 'invoice_no', label: 'invoice_no', value: 'INV-2291', conf: 0.99 },
      { id: 'issue_date', label: 'issue_date', value: '2025-03-14', conf: 0.98 },
      { id: 'customer', label: 'customer', value: 'Meridian Health Group', conf: 0.96 },
      { id: 'delivery_site', label: 'delivery_site', value: 'Meridian Clinic — Sandyford', conf: 0.91 },
      { id: 'total', label: 'total_due', value: '14,751.92 EUR', conf: 0.97 },
      { id: 'discount_pct', label: 'discount_pct', value: '4%', conf: 0.62, check: 'Written as a percent, applied as a flat 496.00 — which is right?', actions: ['Keep 4%', 'Keep 496.00'] },
      { id: 'terms', label: 'payment_terms', value: 'net_45', conf: 0.94 },
      { id: 'vat_id', label: 'vat_id', value: 'IE4839201K', conf: 0.88 }
    ]
  },
  {
    id: 'msa', name: 'meridian-northwind-MSA-signed.pdf', kind: 'Contract', icon: 'ph ph-scroll',
    label: 'Supply MSA', meta: 'PDF · 14 pages · scanned, OCR applied · read in 6.2s',
    schemaNote: '19 fields inferred; 6 of them are new to this dataset',
    newFields: ['auto_renew', 'notice_period_days', 'liability_cap_basis'],
    lines: [
      { k: 'h', segs: [['MASTER SUPPLY AGREEMENT', null]] },
      { k: 'small', segs: [['between Northwind Supply Co. and Meridian Health Group', null]] },
      { k: 'gap', segs: [['', null]] },
      { k: 'row', segs: [['3.2  Term and Renewal', null]] },
      { k: 'p', segs: [['This Agreement commences on ', null], ['1 April 2025', 'effective_date'], [' and continues for ', null], ['twelve (12) months', 'term_months'], [', ', null], ['renewing automatically', 'auto_renew'], [' for successive twelve-month terms unless either party gives ', null], ['ninety (90) days', 'notice_period_days'], [' written notice prior to the end of the then-current term.', null]] },
      { k: 'gap', segs: [['', null]] },
      { k: 'row', segs: [['5.1  Pricing', null]] },
      { k: 'p', segs: [['Unit prices are held for the initial term. Thereafter Northwind may adjust prices once per term, capped at ', null], ['CPI + 2%', 'price_escalator'], ['.', null]] },
      { k: 'gap', segs: [['', null]] },
      { k: 'row', segs: [['7.1  Limitation of Liability', null]] },
      { k: 'p', segs: [['Neither party’s aggregate liability shall exceed ', null], ['the fees paid in the twelve months preceding the claim', 'liability_cap_basis'], [', save for fraud or wilful misconduct.', null]] },
      { k: 'gap', segs: [['', null]] },
      { k: 'row', segs: [['9.4  Governing Law', null]] },
      { k: 'p', segs: [['This Agreement is governed by the laws of ', null], ['Ireland', 'governing_law'], [' and the parties submit to the exclusive jurisdiction of its courts.', null]] }
    ],
    fields: [
      { id: 'effective_date', label: 'effective_date', value: '2025-04-01', conf: 0.97 },
      { id: 'term_months', label: 'term_months', value: '12', conf: 0.95 },
      { id: 'auto_renew', label: 'auto_renew', value: 'true', conf: 0.93 },
      { id: 'notice_period_days', label: 'notice_period_days', value: '90', conf: 0.94 },
      { id: 'price_escalator', label: 'price_escalator', value: 'CPI + 2%', conf: 0.71, check: 'Cap is conditional on “once per term” — kept as text, not a number.', actions: ['Keep as text'] },
      { id: 'liability_cap_basis', label: 'liability_cap_basis', value: 'trailing_12mo_fees', conf: 0.86 },
      { id: 'governing_law', label: 'governing_law', value: 'IE', conf: 0.99 }
    ]
  }
];

export const LAB_DOC = {
  id: 'lab', name: 'meridian-lab-panel-scan.tiff', kind: 'Lab record', icon: 'ph ph-flask',
  label: 'Lab panel scan', meta: 'TIFF · 2 pages · 118 dpi · OCR returned 4 characters',
  schemaNote: 'Nothing to infer from yet', newFields: [], lines: [], fields: []
};

export const PENDING = [
  { id: 'lab', name: 'meridian-lab-panel-scan.tiff', kind: 'Lab record', icon: 'ph ph-flask', sub: 'Scanned, no text layer — OCR running' },
  { id: 'thread', name: 're-late-delivery-thread.eml', kind: 'Email thread', icon: 'ph ph-envelope-simple', sub: '9 messages · resolving entities against the dataset' }
];

export const GREETING = { role: 'bot', text: 'I have read 12 of your 14 documents. Ask in plain words — I answer only from fields I can point at.' };

export const SUGGESTIONS = [
  { id: 's1', text: 'What are the payment terms on invoice 2291?', source: '1 doc', score: 0.98, answer: 'Net 45 days from the 14 March 2025 issue date — so due 28 April 2025.', cites: [['inv', 'terms', 'Invoice 2291 · payment_terms'], ['inv', 'issue_date', 'Invoice 2291 · issue_date']] },
  { id: 's2', text: 'Does the Meridian supply agreement renew automatically?', source: '1 doc', score: 0.95, answer: 'Yes. It auto-renews in twelve-month terms unless either side gives 90 days written notice — next cut-off is 1 January 2026.', cites: [['msa', 'auto_renew', 'Supply MSA §3.2 · auto_renew'], ['msa', 'notice_period_days', 'Supply MSA §3.2 · notice_period_days']] },
  { id: 's3', text: 'Is the discount on 2291 consistent with the contracted price cap?', source: '2 docs', score: 0.74, answer: 'Unclear — the invoice discount is recorded as 4% but applied as a flat 496.00, and the MSA caps increases rather than discounts. One field needs confirming first.', cites: [['inv', 'discount_pct', 'Invoice 2291 · discount_pct'], ['msa', 'price_escalator', 'Supply MSA §5.1 · price_escalator']] },
  { id: 's4', text: 'What is the liability cap, and on what basis?', source: '1 doc', score: 0.89, answer: 'Capped at the fees paid in the trailing twelve months, with fraud and wilful misconduct carved out.', cites: [['msa', 'liability_cap_basis', 'Supply MSA §7.1 · liability_cap_basis']] },
  { id: 's5', text: 'Which VAT ID does Northwind bill under?', source: '1 doc', score: 0.86, answer: 'IE4839201K, printed in the invoice footer alongside PO reference MHG-PO-8842.', cites: [['inv', 'vat_id', 'Invoice 2291 · vat_id']] },
  { id: 's6', text: 'Where is delivery actually going, versus who is billed?', source: '1 doc', score: 0.8, answer: 'Billed to Meridian Health Group in Dublin 2; delivered to the Sandyford clinic.', cites: [['inv', 'delivery_site', 'Invoice 2291 · delivery_site'], ['inv', 'customer', 'Invoice 2291 · customer']] }
];

// Which of these are backed by real app logic (Phase B) vs. mock-only
// (needs infra out of scope — auth, billing, offline sync) is recorded in
// decisions.md, not here — this file is presentation data only.
export const SCENARIOS = [
  { id: 'ok', label: 'Healthy', note: 'Two documents read, two still reading', screen: 'ingest' },
  { id: 'upload', label: 'Upload failed', note: 'Connection dropped mid-transfer', screen: 'ingest' },
  { id: 'reject', label: 'Files rejected', note: 'Too large, encrypted, corrupt, duplicate', screen: 'ingest' },
  { id: 'stalled', label: 'Processing stalled', note: 'Worker queue backed up, no progress', screen: 'ingest' },
  { id: 'blank', label: 'Nothing extractable', note: 'Scan too poor for OCR', screen: 'review' },
  { id: 'partial', label: 'Partial extraction', note: 'Model stopped at page 9 of 14', screen: 'review' },
  { id: 'conflict', label: 'Sources disagree', note: 'Invoice and contract give different values', screen: 'review' },
  { id: 'denied', label: 'No access to source', note: 'Fields visible, document restricted', screen: 'review' },
  { id: 'model', label: 'Model unavailable', note: 'Timeout, then rate limit', screen: 'ask' },
  { id: 'nocite', label: 'Refused to guess', note: 'No field supports an answer', screen: 'ask' },
  { id: 'ambiguous', label: 'Ambiguous question', note: 'Two entities match “Meridian”', screen: 'ask' },
  { id: 'offline', label: 'Offline', note: 'Reads from cache, writes queued', screen: 'ingest' },
  { id: 'quota', label: 'Quota exhausted', note: 'Page allowance spent for the month', screen: 'ingest' },
  { id: 'session', label: 'Session expired', note: 'Signed out mid-review', screen: 'review' },
  { id: '404', label: 'Page not found', note: 'Deleted record, dead link', screen: 'notfound' }
];

export const REJECTS = {
  upload: [{
    name: 'q3-supplier-statements.pdf', kind: 'Upload failed', icon: 'ph ph-cloud-warning',
    sub: 'Connection dropped at 41% — 8.2 MB of 20.1 MB sent. Nothing was stored.',
    actions: [['Resume upload', 'btn-primary'], ['Discard', 'btn-ghost']]
  }],
  reject: [
    { name: 'archive-2019-2024.zip', kind: 'Too large', icon: 'ph ph-file-x', sub: '412 MB exceeds the 200 MB per-file limit — upload the folder instead and we read each file separately.', actions: [['Upload as folder', 'btn-primary'], ['Remove', 'btn-ghost']] },
    { name: 'board-pack-locked.pdf', kind: 'Encrypted', icon: 'ph ph-lock-simple', sub: 'Password-protected. We never store the password — it is used once to open the file.', actions: [['Enter password', 'btn-primary'], ['Remove', 'btn-ghost']] },
    { name: 'scan-0043.pdf', kind: 'Corrupt', icon: 'ph ph-file-x', sub: 'Truncated at byte 118,433 of an expected 2.1 MB — the export was interrupted. Re-export and drop it again.', actions: [['Re-upload', 'btn-secondary'], ['Remove', 'btn-ghost']] },
    { name: 'northwind-invoice-2291.pdf', kind: 'Duplicate', icon: 'ph ph-copy', sub: 'Same checksum as a document read on 4 September. The earlier copy and its 11 fields were kept.', actions: [['Replace existing', 'btn-secondary'], ['Keep existing', 'btn-ghost']] }
  ]
};

export const BANNERS = {
  offline: { icon: 'ph ph-wifi-slash', title: 'You are offline.', text: 'Showing the 12 documents already read. Uploads and field confirmations are queued and will send when the connection returns.', cta: 'Retry now' },
  quota: { icon: 'ph ph-gauge', title: 'Page allowance spent.', text: '5,000 of 5,000 pages read this month. Documents already in the corpus stay queryable; new ones wait in the queue.', cta: 'Add pages' },
  stalled: { icon: 'ph ph-hourglass-high', title: 'Processing is stalled.', text: 'No worker has picked up the queue in 14 minutes. Two documents are waiting; nothing has been lost.', cta: 'Check status' },
  denied: { icon: 'ph ph-eye-slash', title: 'Source document restricted.', text: 'You can see the extracted fields but not the original file — it sits in a folder shared only with the finance group.', cta: 'Request access' }
};

export const ASK_ERRORS = {
  timeout: { icon: 'ph ph-clock-countdown', title: 'The model did not answer in time', text: 'Timed out after 30 seconds while reading 14 documents. Nothing was charged and your question is kept — retrying reuses the extracted fields.', code: 'gateway_timeout · request 8f2c-4471 · 30,012ms' },
  rate: { icon: 'ph ph-traffic-cone', title: 'Rate limited — queued', text: 'Your workspace is at capacity. This question is in line and will run automatically in about 12 seconds.', code: '429 too_many_requests · retry_after=12s' },
  nocite: { icon: 'ph ph-shield-check', title: 'I will not answer this one', text: 'The corpus has nothing that supports an answer, and guessing from a contract is worse than silence. Extraction can look for it specifically.', code: '' },
  nofield: { icon: 'ph ph-magnifying-glass-minus', title: 'No field covers that yet', text: 'The documents may still say it — extraction just never pulled it out. Re-read the corpus for this and it becomes a column.', code: '' },
  ambiguous: { icon: 'ph ph-signpost', title: 'Which Meridian do you mean?', text: 'Two entities in the corpus resolve to that name and their records do not agree. Pick one and I will answer against it.', code: '' },
  offline: { icon: 'ph ph-wifi-slash', title: 'Offline — cached answers only', text: 'Six earlier answers are readable from cache. New questions need the model, so this one is queued.', code: 'net::ERR_INTERNET_DISCONNECTED' }
};
