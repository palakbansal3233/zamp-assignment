const Document = require('../models/Document');
const { buildSmartQuery } = require('../services/queryBuilder');
const { ExtractionConfigError } = require('../services/extraction');
const { HttpError } = require('../middleware/errorHandler');

const LIST_PROJECTION = '-fileData -searchableText';

/**
 * Two search modes behind one endpoint:
 *  - keyword: plain MongoDB $text search over searchableText. Always
 *    available, zero external dependency, the reliable baseline.
 *  - smart: natural-language -> sanitized structured filter via the LLM
 *    (see services/queryBuilder.js), for questions like "invoices over $500
 *    from March". Falls back to keyword automatically if it errors, returns
 *    no filters, or the API key isn't configured — the user always gets a
 *    result, never a dead end.
 */
async function search(req, res) {
  const q = String(req.query.q || '').trim();
  const mode = req.query.mode === 'keyword' ? 'keyword' : 'smart';

  if (!q) {
    const items = await Document.find({}, LIST_PROJECTION).sort({ createdAt: -1 }).limit(50).lean();
    return res.json({ items, modeUsed: 'none', explanation: '' });
  }

  if (mode === 'smart') {
    try {
      const [docTypes, fieldKeys] = await Promise.all([distinctDocTypes(), sampleFieldKeys()]);
      const { filters, explanation } = await buildSmartQuery(q, { docTypes, fieldKeys });

      if (filters.length > 0) {
        const mongoQuery = { $and: filters };
        const items = await Document.find(mongoQuery, LIST_PROJECTION).sort({ createdAt: -1 }).limit(50).lean();
        if (items.length > 0) {
          return res.json({ items, modeUsed: 'smart', explanation });
        }
        // Smart filters were valid but matched nothing — don't leave the
        // user at a dead end silently narrowed by a filter they didn't
        // explicitly ask for; fall through to keyword search below.
      }
    } catch (err) {
      if (!(err instanceof ExtractionConfigError)) {
        console.error('[smart-query] falling back to keyword:', err.message); // eslint-disable-line no-console
      }
      // fall through to keyword search
    }
  }

  const items = await Document.find({ $text: { $search: q } }, LIST_PROJECTION)
    .sort({ score: { $meta: 'textScore' } })
    .limit(50)
    .lean();
  res.json({ items, modeUsed: 'keyword', explanation: '' });
}

async function distinctDocTypes() {
  const types = await Document.distinct('docType', { docType: { $ne: null } });
  return types.slice(0, 30);
}

async function sampleFieldKeys() {
  const docs = await Document.find({ status: 'done' }, 'fields').sort({ createdAt: -1 }).limit(40).lean();
  const keys = new Set();
  for (const doc of docs) {
    if (doc.fields && typeof doc.fields === 'object') {
      Object.keys(doc.fields).forEach((k) => keys.add(k));
    }
  }
  return Array.from(keys).slice(0, 60);
}

module.exports = { search };
