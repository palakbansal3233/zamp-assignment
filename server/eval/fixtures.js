// Synthetic documents for the golden eval, embedded as plain text so the
// eval doesn't depend on any binary sample files existing on disk. `alias`
// is a stable local id runQuestions.js uses to check retrieval quality
// (did the answer cite the right *documents*) without depending on exactly
// which field keys the model happens to choose that run.
module.exports = [
  {
    alias: 'invoice_a',
    filename: 'invoice-acme-001.txt',
    text: `INVOICE
Acme Corp
Bill to: Contoso Construction LLC
Invoice #INV-001
Total due: $1,200.00
Payment terms: Net 30 days from invoice date.
Late fee: 1.5% per month on overdue balances.`,
  },
  {
    // Deliberately phrased almost identically to invoice_a except for the
    // one number that differs — this maximizes the chance the model picks
    // the same field key both times, which is what makes the conflict
    // detector's exact-key-match design actually fire (see decisions.md
    // for the honest limitation when documents phrase the same fact
    // differently and get different keys).
    alias: 'invoice_b',
    filename: 'invoice-acme-002.txt',
    text: `INVOICE
Acme Corp
Bill to: Meridian Health Group
Invoice #INV-002
Total due: $800.00
Payment terms: Net 30 days from invoice date.
Late fee: 2.5% per month on overdue balances.`,
  },
  {
    alias: 'contract',
    filename: 'services-agreement.txt',
    text: `SERVICES AGREEMENT
Between Acme Corp ("Provider") and Meridian Health Group ("Client").
3.1 Term: This Agreement commences 1 January 2025 and continues for twelve (12) months, renewing automatically unless either party gives 60 days written notice.
7.1 Governing Law: This Agreement is governed by the laws of Ireland.`,
  },
  {
    alias: 'resume',
    filename: 'candidate-resume.txt',
    text: `JORDAN LEE
Software Engineer — 6 years experience
Skills: Node.js, React, PostgreSQL, AWS
Most recent role: Senior Backend Engineer at Northwind Supply Co. (2022-2026)
Education: BS Computer Science, State University, 2018`,
  },
  {
    alias: 'blank',
    filename: 'corrupted-scan.txt',
    text: '   \n\n   .....   \n\n   ',
  },
];
