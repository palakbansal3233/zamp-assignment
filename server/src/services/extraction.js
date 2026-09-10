const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('../config');

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

// Forcing the model to respond through a tool call (instead of asking it to
// "return JSON" in prose) is what makes this reliable: there is no
// JSON.parse() on freeform model text anywhere in this codebase, and no
// markdown-fence-stripping regex to keep patching. The schema itself also
// carries the honesty contract — `unreadable` and `low_confidence_fields`
// give the model an explicit way to say "I'm not sure" instead of being
// nudged to confidently invent fields.
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
      fields: {
        type: 'object',
        description:
          'The concrete structured data found in the document, as key-value pairs with lowercase_snake_case keys. Use nested objects/arrays where the data is naturally nested (e.g. an invoice "line_items" array). Only include fields you found actual evidence for in the document — never invent plausible-sounding values. Normalize dates to ISO 8601 (YYYY-MM-DD) and monetary amounts to plain numbers with a separate currency field when a currency is identifiable.',
        additionalProperties: true,
      },
      low_confidence_fields: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Dot-path keys from `fields` (e.g. "total_amount" or "line_items.0.price") that you are genuinely unsure about due to illegible handwriting, ambiguous formatting, or a low-quality scan. Empty array if everything extracted is clear.',
      },
    },
    required: ['unreadable', 'unreadable_reason', 'doc_type', 'summary', 'fields', 'low_confidence_fields'],
  },
};

const SYSTEM_PROMPT = `You are a document-structuring engine embedded in a product that turns arbitrary, messy, real-world documents into structured, queryable data.

You will be shown one document at a time. It could be a clean digital invoice, a photo of a handwritten receipt, a scanned form, a resume, a contract, or something else entirely — the product does not know the document type in advance, and neither do you until you look.

Rules:
- Never fabricate a value you don't have evidence for. If a field isn't present or legible, leave it out of \`fields\` rather than guessing.
- If handwriting, image quality, or formatting makes a specific value uncertain but readable, include your best reading AND list it in low_confidence_fields — don't silently drop it.
- If the document is genuinely unreadable (blank, corrupted, indecipherable), set unreadable: true with a short reason, and leave fields empty. Do not force a classification onto noise.
- Prefer the document's own vocabulary for field names where sensible (e.g. "invoice_number" not "id").
- Always call the record_extraction tool exactly once with your findings. Do not respond in plain text.`;

function withTimeout(promise, ms, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

  const content = [];
  if (input.kind === 'text') {
    content.push({
      type: 'text',
      text: `Filename: ${input.filename}\n\nDocument content:\n\n${input.text}`,
    });
  } else if (input.kind === 'image') {
    content.push({ type: 'text', text: `Filename: ${input.filename}` });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: input.mimeType, data: input.buffer.toString('base64') },
    });
  } else if (input.kind === 'pdf') {
    content.push({ type: 'text', text: `Filename: ${input.filename}` });
    content.push({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: input.buffer.toString('base64') },
    });
  } else {
    throw new Error(`Unsupported extraction kind: ${input.kind}`);
  }

  const request = anthropic.messages.create({
    model: config.anthropicModel,
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    tools: [EXTRACTION_TOOL],
    tool_choice: { type: 'tool', name: 'record_extraction' },
    messages: [{ role: 'user', content }],
  });

  const response = await withTimeout(
    request,
    config.extractionTimeoutMs,
    'Extraction timed out. Large or multi-page documents can exceed the time limit — try a smaller file or fewer pages.'
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
    fields: result.fields && typeof result.fields === 'object' ? result.fields : {},
    lowConfidenceFields: Array.isArray(result.low_confidence_fields) ? result.low_confidence_fields : [],
  };
}

module.exports = { extractStructuredData, ExtractionConfigError, EXTRACTION_TOOL, SYSTEM_PROMPT };
