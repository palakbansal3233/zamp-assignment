const mongoose = require('mongoose');
const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('../config');
const { withTimeout } = require('../utils/withTimeout');
const { ExtractionConfigError } = require('./extraction');
const Document = require('../models/Document');

let client = null;
function getClient() {
  if (!config.anthropicApiKey) throw new ExtractionConfigError('ANTHROPIC_API_KEY is not set.');
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

const ASK_TOOL = {
  name: 'answer_question',
  description: 'Answer a question about a document corpus, grounded strictly in the fields provided.',
  input_schema: {
    type: 'object',
    properties: {
      refused: {
        type: 'boolean',
        description: 'true if nothing in the provided corpus digest supports an answer. When true, answer must be null.',
      },
      refusal_reason: {
        type: ['string', 'null'],
        description: 'If refused, a short plain-language reason (e.g. "no document mentions this"). Otherwise null.',
      },
      answer: {
        type: ['string', 'null'],
        description: 'A direct, plain-language answer to the question, using only facts from the digest. Null if refused.',
      },
      citations: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            document_id: { type: 'string', description: 'The exact documentId from the digest this fact came from.' },
            field_key: { type: 'string', description: 'The exact field key from that document that supports this fact.' },
          },
          required: ['document_id', 'field_key'],
        },
        description: 'Every citation must point at a documentId + field key that literally appears in the digest — never invent one.',
      },
    },
    required: ['refused', 'refusal_reason', 'answer', 'citations'],
  },
};

// Every claim in the answer must trace to a citation, and every citation
// must survive verifyCitations() against the real database before the
// caller trusts it — this system prompt sets the model's half of that
// contract; the code below enforces the other half regardless of what the
// model claims.
const ASK_SYSTEM_PROMPT = `You answer questions about a corpus of documents that have already been read and structured. You are given a "digest": for each document, its id, filename, type, summary, and the fields extracted from it (a field may be marked sensitive).

Rules:
- Answer only using facts present in the digest. Never use outside knowledge, never guess, never fill a gap with something plausible.
- Every fact you state must be backed by a citation naming the exact documentId and field key it came from. If you can't cite it, don't say it.
- If the digest doesn't contain enough to answer, set refused: true with a short reason, and leave answer null. Refusing is correct and expected when the corpus doesn't cover the question — it is not a failure.
- If multiple documents give conflicting values for what looks like the same fact, still answer citing all of them — the caller will surface the conflict; you don't need to pick a winner or mention it yourself.
- Keep the answer direct and specific — a sentence or two, not a report.
- Always call answer_question exactly once. Do not respond in plain text.`;

function digestToPrompt(digest) {
  if (digest.length === 0) return '(No documents have been read yet.)';
  return digest
    .map((d) => {
      const fieldLines = d.fields
        .map((f) => `  - ${f.key}${f.label && f.label !== f.key ? ` (${f.label})` : ''}: ${JSON.stringify(f.value)}${f.sensitive ? ' [sensitive]' : ''}`)
        .join('\n');
      return `Document ${d.documentId} — "${d.filename}" (${d.docType || 'unknown type'})\nSummary: ${d.summary || '(none)'}\nFields:\n${fieldLines || '  (none extracted)'}`;
    })
    .join('\n\n');
}

async function askModel(question, digest) {
  const anthropic = getClient();

  const request = anthropic.messages.create({
    model: config.anthropicModel,
    max_tokens: 1500,
    system: ASK_SYSTEM_PROMPT,
    tools: [ASK_TOOL],
    tool_choice: { type: 'tool', name: 'answer_question' },
    messages: [{ role: 'user', content: `${digestToPrompt(digest)}\n\nQuestion: ${question}` }],
  });

  const response = await withTimeout(
    request,
    config.askTimeoutMs,
    'Answering timed out. Try a narrower question, or ask about one document instead of the whole corpus.'
  );

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) throw new Error('The model did not return an answer.');
  return toolUse.input;
}

// The verification layer: never trust a citation just because the model
// named it. A citation only counts if it resolves to a real, done document
// that really has that field. Anything else — a hallucinated documentId, a
// field key that doesn't exist on that document, a malformed shape — is
// silently dropped, the same way a non-matching `quote` just doesn't
// highlight in Review: a bad citation should degrade quietly, not surface
// as an error or (worse) get treated as grounding for an answer.
async function verifyCitations(rawCitations) {
  if (!Array.isArray(rawCitations)) return [];

  const candidates = [];
  const seen = new Set();
  for (const raw of rawCitations.slice(0, 8)) {
    if (!raw || typeof raw !== 'object') continue;
    const documentId = typeof raw.document_id === 'string' ? raw.document_id : null;
    const fieldKey = typeof raw.field_key === 'string' ? raw.field_key : null;
    if (!documentId || !fieldKey || !mongoose.Types.ObjectId.isValid(documentId)) continue;
    const dedupeKey = `${documentId}:${fieldKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    candidates.push({ documentId, fieldKey });
  }
  if (!candidates.length) return [];

  const docIds = [...new Set(candidates.map((c) => c.documentId))];
  const docs = await Document.find({ _id: { $in: docIds }, status: 'done' }, 'filename fields').lean();
  const docsById = new Map(docs.map((d) => [String(d._id), d]));

  const out = [];
  for (const { documentId, fieldKey } of candidates) {
    const doc = docsById.get(documentId);
    if (!doc) continue;
    const field = (doc.fields || []).find((f) => f.key === fieldKey);
    if (!field) continue;
    out.push({
      documentId,
      filename: doc.filename,
      fieldKey,
      label: field.label,
      value: field.value,
      quote: field.quote,
      sensitive: Boolean(field.sensitive),
    });
  }
  return out;
}

// Scoped to one answer's verified citation set (not a standing corpus-wide
// job) — see decisions.md. Computed from the real, just-fetched DB values,
// never from anything the model's answer text says.
function computeConflicts(verifiedCitations) {
  const byKey = new Map();
  for (const c of verifiedCitations) {
    if (!byKey.has(c.fieldKey)) byKey.set(c.fieldKey, []);
    byKey.get(c.fieldKey).push(c);
  }

  const caveats = [];
  for (const [fieldKey, citations] of byKey) {
    const distinctDocs = new Set(citations.map((c) => c.documentId));
    if (distinctDocs.size < 2) continue;
    const distinctValues = new Set(citations.map((c) => JSON.stringify(c.value)));
    if (distinctValues.size < 2) continue;
    caveats.push({
      type: 'conflict',
      fieldKey,
      values: citations.map((c) => ({ documentId: c.documentId, filename: c.filename, value: c.value })),
    });
  }
  return caveats;
}

// ---- Suggested questions (cached — see models/SuggestionCache.js) ----

const SUGGEST_TOOL = {
  name: 'suggest_questions',
  description: 'Propose realistic questions this document corpus can actually answer.',
  input_schema: {
    type: 'object',
    properties: {
      questions: {
        type: 'array',
        maxItems: 8,
        items: {
          type: 'object',
          properties: {
            text: { type: 'string', description: 'A natural question a real user might ask, answerable from the digest.' },
            doc_types: { type: 'array', items: { type: 'string' }, description: 'Which document types it draws on.' },
          },
          required: ['text', 'doc_types'],
        },
      },
    },
    required: ['questions'],
  },
};

const SUGGEST_SYSTEM_PROMPT = `You propose example questions for a "questions this corpus can answer" list, given a digest of documents and their extracted fields.

Rules:
- Every question must be answerable strictly from fields actually present in the digest — don't propose a question about something that isn't there.
- Prefer a mix: a couple of simple lookups, and (if the digest supports it) one that draws on more than one document.
- Phrase questions the way a real person would ask them, not as a field-name lookup.
- Always call suggest_questions exactly once.`;

async function generateSuggestions(digest) {
  if (digest.length === 0) return [];
  const anthropic = getClient();

  const response = await withTimeout(
    anthropic.messages.create({
      model: config.anthropicModel,
      max_tokens: 1024,
      system: SUGGEST_SYSTEM_PROMPT,
      tools: [SUGGEST_TOOL],
      tool_choice: { type: 'tool', name: 'suggest_questions' },
      messages: [{ role: 'user', content: digestToPrompt(digest) }],
    }),
    config.askTimeoutMs,
    'Generating suggestions timed out.'
  );

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) return [];
  const questions = Array.isArray(toolUse.input.questions) ? toolUse.input.questions : [];
  return questions
    .filter((q) => q && typeof q.text === 'string' && q.text.trim())
    .slice(0, 8)
    .map((q) => ({ text: q.text.trim(), docTypes: Array.isArray(q.doc_types) ? q.doc_types.filter((t) => typeof t === 'string') : [] }));
}

async function computeCorpusFingerprint() {
  const [count, latest] = await Promise.all([
    Document.countDocuments({ status: 'done' }),
    Document.findOne({ status: 'done' }, 'updatedAt').sort({ updatedAt: -1 }).lean(),
  ]);
  return `${count}:${latest ? new Date(latest.updatedAt).getTime() : 0}`;
}

module.exports = {
  ASK_TOOL,
  ASK_SYSTEM_PROMPT,
  askModel,
  verifyCitations,
  computeConflicts,
  generateSuggestions,
  computeCorpusFingerprint,
  digestToPrompt,
};
