const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('../config');
const { withTimeout } = require('../utils/withTimeout');

let client = null;
function getClient() {
  if (!config.anthropicApiKey) {
    throw new ExtractionConfigError(
      'ANTHROPIC_API_KEY is not set on the server. Add it to server/.env (local) or ' +
        'the Netlify site environment variables (deployed), then retry.'
    );
  }
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

class ExtractionConfigError extends Error {}

const MAX_DOCUMENT_TEXT_CHARS = 15000;
const MAX_FIELDS = 60;

// Forcing the model to respond through a tool call (instead of asking it to
// "return JSON" in prose) is what makes this reliable: there is no
// JSON.parse() on freeform model text anywhere in this codebase, and no
// markdown-fence-stripping regex to keep patching. The schema itself also
// carries the honesty contract — `unreadable`, `needs_review`, and `sensitive`
// give the model explicit ways to say "I'm not sure" or "be careful with
// this" instead of being nudged to confidently invent or flatten nuance.
//
// `document_text` is new: a verbatim transcription the product needs for its
// own purposes (provenance — see decisions.md), not something we'd otherwise
// ask an extraction engine for. Each field's `quote` is checked against it
// client-side as a plain substring match; a quote that doesn't actually
// appear in the transcription just doesn't highlight anything, it never
// breaks the page — we never trust a `quote` any further than that.
const EXTRACTION_TOOL = {
  name: 'record_extraction',
  description:
    'Record the structured data extracted from a document, however messy, handwritten, or unfamiliar its layout is.',
  input_schema: {
    type: 'object',
    properties: {
      unreadable: {
        type: 'boolean',
        description:
          'true if the content could not be meaningfully read at all (blank page, totally illegible scan, corrupted/garbled text). false otherwise, even if some fields are uncertain.',
      },
      unreadable_reason: {
        type: ['string', 'null'],
        description: 'If unreadable is true, a short plain-language reason. Otherwise null.',
      },
      doc_type: {
        type: 'string',
        description:
          'Short lowercase_snake_case label for the kind of document, e.g. "invoice", "receipt", "resume", "contract", "handwritten_note", "form", "letter", "other".',
      },
      summary: {
        type: 'string',
        description: '1-3 plain-language sentences describing what this document is and contains.',
      },
      document_text: {
        type: 'string',
        description:
          `A verbatim transcription of the document's visible text, in reading order. Transcribe faithfully — do not summarize, correct spelling, or reformat. If the document is longer than roughly ${MAX_DOCUMENT_TEXT_CHARS} characters, transcribe as much as fits and stop cleanly rather than cutting off mid-word. Empty string if unreadable.`,
      },
      fields: {
        type: 'array',
        description:
          'The concrete structured data found in the document. Only include fields you found actual evidence for — never invent plausible-sounding values. Normalize dates to ISO 8601 (YYYY-MM-DD) and monetary amounts to plain numbers with a separate currency field when identifiable. Use a nested object/array as one field\'s `value` where the data is naturally nested (e.g. an invoice\'s line items as one "line_items" field) rather than inventing one field per leaf.',
        items: {
          type: 'object',
          properties: {
            key: { type: 'string', description: 'Stable lowercase_snake_case identifier, e.g. "invoice_no", "total_due", "line_items".' },
            label: { type: 'string', description: 'Short human-readable label, e.g. "Invoice No.". If unsure, repeat the key in Title Case.' },
            value: { description: 'The extracted value: a string, number, boolean, array, or object.' },
            quote: {
              type: 'string',
              description:
                'The exact verbatim substring of `document_text` this value was read from — copy-paste exact, not paraphrased. Empty string if the value was inferred rather than read from one clean span (e.g. computed, or assembled from scattered text).',
            },
            confidence: { type: 'number', description: '0.0-1.0, how sure you are this value is correct.' },
            needs_review: {
              type: 'boolean',
              description: 'true if this reading is genuinely ambiguous and a human should confirm it (illegible handwriting, two plausible readings, conflicting formatting within the same document).',
            },
            review_note: {
              type: ['string', 'null'],
              description: 'If needs_review is true, a short explanation of the ambiguity. Otherwise null.',
            },
            review_actions: {
              type: 'array',
              items: { type: 'string' },
              description: 'If needs_review is true, 1-3 short concrete resolutions a human could pick between (e.g. ["Keep 4%", "Keep 496.00"]). Empty array otherwise.',
            },
            sensitive: {
              type: 'boolean',
              description: 'true if this value is the kind of thing that shouldn\'t be casually shared — personal identifying information, financial account details, health information, salary, or anything marked confidential/internal in the document itself.',
            },
            sensitivity_reason: {
              type: ['string', 'null'],
              description: 'If sensitive is true, a short reason. Otherwise null.',
            },
          },
          required: ['key', 'value', 'quote', 'confidence', 'needs_review', 'sensitive'],
        },
      },
    },
    required: ['unreadable', 'unreadable_reason', 'doc_type', 'summary', 'document_text', 'fields'],
  },
};

const SYSTEM_PROMPT = `You are a document-structuring engine embedded in a product that turns arbitrary, messy, real-world documents into structured, queryable data.

You will be shown one document at a time. It could be a clean digital invoice, a photo of a handwritten receipt, a scanned form, a resume, a contract, or something else entirely — the product does not know the document type in advance, and neither do you until you look.

Rules:
- Transcribe the document's visible text verbatim into \`document_text\` first, in reading order. This is not a summary — every field's \`quote\` must be checked against it later, so transcribe faithfully rather than cleaning it up.
- Never fabricate a value you don't have evidence for. If a field isn't present or legible, leave it out of \`fields\` rather than guessing.
- Every field's \`quote\` must be an exact substring of \`document_text\` — copy it, don't paraphrase it. Use an empty string only when the value was inferred rather than read from one clean span.
- If handwriting, image quality, or formatting makes a specific value genuinely ambiguous, still include your best reading, but set \`needs_review: true\` with a \`review_note\` explaining the ambiguity and, where there's a small set of plausible readings, \`review_actions\` naming them concretely (e.g. two different ways the same number is written on the same page).
- Flag anything sensitive — personal identifying information, financial account numbers, health details, salary, or content marked confidential/internal — with \`sensitive: true\` and a short \`sensitivity_reason\`.
- If the document is genuinely unreadable (blank, corrupted, indecipherable), set unreadable: true with a short reason, and leave document_text/fields empty. Do not force a classification onto noise.
- Prefer the document's own vocabulary for field names where sensible (e.g. "invoice_number" not "id").
- Always call the record_extraction tool exactly once with your findings. Do not respond in plain text.`;

function clampConfidence(n) {
  const num = typeof n === 'number' && Number.isFinite(n) ? n : 0.5;
  return Math.max(0, Math.min(1, num));
}

function humanizeKey(key) {
  return String(key)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function normalizeFields(rawFields) {
  if (!Array.isArray(rawFields)) return [];
  const seen = new Set();
  const out = [];
  for (const f of rawFields) {
    if (!f || typeof f !== 'object' || typeof f.key !== 'string' || !f.key.trim()) continue;
    const key = f.key.trim();
    if (seen.has(key)) continue; // first occurrence wins on a duplicate key
    seen.add(key);
    // A review flag is only kept if it comes with a reason. "This needs
    // checking" with no explanation isn't something a person can act on —
    // it just adds a warning badge and a Confirm button to a value they
    // now trust slightly less, for reasons nobody will ever tell them.
    // The uncertainty itself isn't lost: it's still in the confidence
    // score the UI shows regardless.
    const reviewNote = typeof f.review_note === 'string' && f.review_note.trim() ? f.review_note.trim() : null;
    const needsReview = Boolean(f.needs_review) && Boolean(reviewNote);

    out.push({
      key,
      label: typeof f.label === 'string' && f.label.trim() ? f.label.trim() : humanizeKey(key),
      value: f.value === undefined ? null : f.value,
      quote: typeof f.quote === 'string' ? f.quote : '',
      confidence: clampConfidence(f.confidence),
      needsReview,
      reviewNote: needsReview ? reviewNote : null,
      reviewActions: needsReview && Array.isArray(f.review_actions) ? f.review_actions.filter((a) => typeof a === 'string').slice(0, 3) : [],
      confirmed: false,
      resolvedAction: null,
      sensitive: Boolean(f.sensitive),
      sensitivityReason: f.sensitive && typeof f.sensitivity_reason === 'string' ? f.sensitivity_reason : null,
    });
    if (out.length >= MAX_FIELDS) break;
  }
  return out;
}

/**
 * @param {object} input
 * @param {'text'|'image'|'pdf'} input.kind
 * @param {string} input.filename
 * @param {string} [input.text] - for kind 'text'
 * @param {Buffer} [input.buffer] - for kind 'image' | 'pdf'
 * @param {string} [input.mimeType] - for kind 'image'
 */
async function extractStructuredData(input) {
  const anthropic = getClient();

  // When a long document is being read in chunks, the model needs to know
  // it's looking at a slice — otherwise page 7 of a rental agreement, with
  // no title block and no parties named on it, reads as an unlabelled
  // fragment and comes back "unreadable" or misclassified.
  const chunkNote = input.chunkContext
    ? `\n\nNOTE: this is ${input.chunkContext.label || `part ${input.chunkContext.index + 1} of ${input.chunkContext.total}`} of a longer document. Extract only what this part actually contains — don't infer the parts you can't see, and don't mark it unreadable merely because it lacks a heading or context that would appear elsewhere in the document.\n\nOne exception: write \`summary\` as a description of what the document as a whole appears to be, based on what you can see here. Do not describe it as an excerpt and do not mention part or page numbers — these summaries are stitched together, and the reader sees one document, not the parts it was read in.`
    : '';

  const content = [];
  if (input.kind === 'text') {
    content.push({
      type: 'text',
      text: `Filename: ${input.filename}${chunkNote}\n\nDocument content:\n\n${input.text}`,
    });
  } else if (input.kind === 'image') {
    content.push({ type: 'text', text: `Filename: ${input.filename}${chunkNote}` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: input.mimeType, data: input.buffer.toString('base64') },
    });
  } else if (input.kind === 'pdf') {
    content.push({ type: 'text', text: `Filename: ${input.filename}${chunkNote}` });
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: input.buffer.toString('base64') },
    });
  } else {
    throw new Error(`Unsupported extraction kind: ${input.kind}`);
  }

  // Streaming, not a plain create() call: the response now includes a full
  // document transcription (document_text) on top of the field list, which
  // pushes well past the old 2048-token response we used to expect — a
  // large non-streamed request risks an HTTP timeout before the SDK even
  // gets to apply our own withTimeout(). Streaming avoids that regardless
  // of how long generation takes; withTimeout still bounds the *whole*
  // request against config.extractionTimeoutMs.
  const request = anthropic.messages
    .stream({
      model: config.anthropicModel,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      tools: [EXTRACTION_TOOL],
      tool_choice: { type: 'tool', name: 'record_extraction' },
      messages: [{ role: 'user', content }],
    })
    .finalMessage();

  const response = await withTimeout(
    request,
    config.extractionTimeoutMs,
    'This part of the document took too long to read.'
  );

  const toolUse = response.content.find((block) => block.type === 'tool_use');
  if (!toolUse) {
    // Defensive: shouldn't happen with tool_choice forced, but a model
    // refusal (e.g. safety) can still come back as plain text.
    throw new Error('The model did not return structured data for this document.');
  }

  const result = toolUse.input;
  return {
    unreadable: Boolean(result.unreadable),
    unreadableReason: result.unreadable_reason || null,
    docType: result.doc_type || 'other',
    summary: result.summary || '',
    documentText: typeof result.document_text === 'string' ? result.document_text.slice(0, MAX_DOCUMENT_TEXT_CHARS) : '',
    fields: normalizeFields(result.fields),
  };
}

module.exports = { extractStructuredData, ExtractionConfigError, EXTRACTION_TOOL, SYSTEM_PROMPT, normalizeFields };
