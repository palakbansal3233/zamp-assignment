const Anthropic = require('@anthropic-ai/sdk');
const { config } = require('../config');
const { ExtractionConfigError } = require('./extraction');

let client = null;
function getClient() {
  if (!config.anthropicApiKey) throw new ExtractionConfigError('ANTHROPIC_API_KEY is not set.');
  if (!client) client = new Anthropic({ apiKey: config.anthropicApiKey });
  return client;
}

const QUERY_TOOL = {
  name: 'build_query',
  description: 'Translate a natural-language question about a document library into a small set of structured filters.',
  input_schema: {
    type: 'object',
    properties: {
      filters: {
        type: 'array',
        maxItems: 6,
        items: {
          type: 'object',
          properties: {
            field: {
              type: 'string',
              description:
                'Field to filter on: "docType", "summary", "filename", or "fields.<key>" using one of the known field keys provided.',
            },
            operator: { type: 'string', enum: ['eq', 'gt', 'gte', 'lt', 'lte', 'contains'] },
            value: { description: 'The comparison value (string or number).' },
          },
          required: ['field', 'operator', 'value'],
        },
      },
      explanation: { type: 'string', description: 'One short sentence explaining the filters in plain language.' },
    },
    required: ['filters', 'explanation'],
  },
};

// Everything the model can name a field as gets re-validated here against an
// allowlist shape before it ever touches a Mongo query. This is the layer
// that matters: even if a crafted natural-language query tricked the model
// into proposing something like a field named "$where" or "fields.__proto__",
// it gets rejected here rather than reaching the database. We never eval()
// or otherwise execute anything the model returns.
const SAFE_TOP_LEVEL_FIELDS = new Set(['docType', 'summary', 'filename']);
const SAFE_FIELD_PATH = /^fields(\.[a-zA-Z0-9_]+){1,6}$/;
const OPERATOR_MAP = { eq: '$eq', gt: '$gt', gte: '$gte', lt: '$lt', lte: '$lte' };

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sanitizeFilters(rawFilters) {
  if (!Array.isArray(rawFilters)) return [];

  const clauses = [];
  for (const raw of rawFilters.slice(0, 6)) {
    if (!raw || typeof raw !== 'object') continue;
    const field = String(raw.field || '');
    const operator = String(raw.operator || '');
    const value = raw.value;

    const fieldIsSafe = SAFE_TOP_LEVEL_FIELDS.has(field) || SAFE_FIELD_PATH.test(field);
    if (!fieldIsSafe) continue;
    if (value === null || value === undefined) continue;
    if (typeof value === 'object') continue; // no operator objects, no arrays as raw values

    if (operator === 'contains') {
      if (String(value).length > 200) continue;
      clauses.push({ [field]: { $regex: escapeRegex(value), $options: 'i' } });
    } else if (OPERATOR_MAP[operator]) {
      const numeric = typeof value === 'number' ? value : Number(value);
      const comparisonValue = Number.isFinite(numeric) && operator !== 'eq' ? numeric : value;
      clauses.push({ [field]: { [OPERATOR_MAP[operator]]: comparisonValue } });
    }
  }
  return clauses;
}

/**
 * @param {string} question
 * @param {{ docTypes: string[], fieldKeys: string[] }} context
 */
async function buildSmartQuery(question, context) {
  const anthropic = getClient();

  const grounding =
    `Known document types seen so far: ${context.docTypes.join(', ') || '(none yet)'}\n` +
    `Known field keys seen so far (use these exact names when relevant, under "fields."): ${
      context.fieldKeys.join(', ') || '(none yet)'
    }`;

  const response = await anthropic.messages.create({
    model: config.anthropicModel,
    max_tokens: 1024,
    system:
      'You translate a user question about a personal document library into structured filters. ' +
      'Only use field names from the provided grounding list — never invent a field key that was not listed. ' +
      'If the question is too vague to filter (e.g. "show me stuff"), return an empty filters array.',
    tools: [QUERY_TOOL],
    tool_choice: { type: 'tool', name: 'build_query' },
    messages: [{ role: 'user', content: `${grounding}\n\nQuestion: ${question}` }],
  });

  const toolUse = response.content.find((b) => b.type === 'tool_use');
  if (!toolUse) return { filters: [], explanation: '' };

  const clauses = sanitizeFilters(toolUse.input.filters);
  return { filters: clauses, explanation: toolUse.input.explanation || '' };
}

module.exports = { buildSmartQuery, sanitizeFilters };
