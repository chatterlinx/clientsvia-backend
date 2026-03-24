'use strict';

/**
 * ============================================================================
 * COMPANY KNOWLEDGE — Admin API Routes
 * ============================================================================
 *
 * Full CRUD for Knowledge Containers — the unified informational content
 * system for the ClientsVia platform. One container = one topic the caller
 * might ask about. Groq reads the container and answers within a word limit.
 *
 * ISOLATION RULES:
 *   - Every route is scoped by companyId
 *   - MongoDB queries always include { companyId } filter
 *   - Redis cache key is namespaced: knowledge:{companyId}
 *
 * ROUTE REGISTRATION ORDER (critical for Express):
 *   Literal segment routes (/settings, /active, /reorder, /generate-keywords)
 *   MUST be registered BEFORE the parameterised route (/:id) or Express will
 *   match the literal string as an :id value → 400/500 errors.
 *
 * ENDPOINTS:
 *   GET    /:companyId/knowledge/settings               — Load knowledgeBaseSettings
 *   PATCH  /:companyId/knowledge/settings               — Save knowledgeBaseSettings
 *   GET    /:companyId/knowledge                        — List all containers (admin)
 *   GET    /:companyId/knowledge/active                 — List active only (runtime)
 *   POST   /:companyId/knowledge                        — Create container
 *   POST   /:companyId/knowledge/generate-keywords      — Groq keyword generation (pre-save)
 *   POST   /:companyId/knowledge/reorder                — Bulk priority update
 * ⚠️ GET    /:companyId/knowledge/:id                   — Get single (AFTER literal routes)
 *   PATCH  /:companyId/knowledge/:id                    — Partial update
 *   DELETE /:companyId/knowledge/:id                    — Soft delete (isActive=false)
 *   DELETE /:companyId/knowledge/:id/hard               — Hard delete (permanent)
 *   POST   /:companyId/knowledge/:id/generate-keywords  — Regen keywords for existing
 *
 * ============================================================================
 */

const express                      = require('express');
const router                       = express.Router();
const logger                       = require('../../utils/logger');
const { authenticateJWT }          = require('../../middleware/auth');
const CompanyKnowledgeContainer    = require('../../models/CompanyKnowledgeContainer');
const KnowledgeContainerService    = require('../../services/engine/agent2/KnowledgeContainerService');
const CompanyTriggerSettings       = require('../../models/CompanyTriggerSettings');
const v2Company                    = require('../../models/v2Company');
const GroqStreamAdapter            = require('../../services/streaming/adapters/GroqStreamAdapter');

// ── All routes require a valid JWT ───────────────────────────────────────────
router.use(authenticateJWT);

// ─────────────────────────────────────────────────────────────────────────────
// VALIDATION HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function _validateCompanyAccess(req, res, companyId) {
  if (!companyId) {
    res.status(400).json({ success: false, error: 'companyId is required' });
    return false;
  }
  const user    = req.user || {};
  const isAdmin = ['admin', 'super_admin', 'platform_admin'].includes(user.role);
  if (!isAdmin && user.companyId !== companyId) {
    res.status(403).json({ success: false, error: 'Access denied' });
    return false;
  }
  return true;
}

// Allowed fields for container CRUD operations
const ALLOWED_FIELDS = [
  'title', 'category',
  'sections',        // [{ label, content, order }]
  'keywords',
  'wordLimit',
  'bookingAction',
  'closingPrompt',
  'isActive',
  'priority'
];

// Allowed fields for settings PATCH
const SETTINGS_FIELDS = [
  'enabled', 'defaultWordLimit', 'bookingOfferMode', 'bookingOfferPhrase',
  'fallbackResponse',   // String — spoken by KC_GRACEFUL_ACK when all AI paths fail
  'callerScreening',    // Object — { enabled, vendorResponse, deliveryResponse, wrongNumberResponse, defaultResponse }
];

/**
 * _sanitiseBody — Strip fields not in ALLOWED_FIELDS and clean values.
 * Keywords are deduped and lowercased. Sections are validated minimally.
 *
 * @param {Object} body
 * @returns {Object}
 */
function _sanitiseBody(body) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) out[key] = body[key];
  }

  // Normalise keywords — trim, lowercase, deduplicate
  if (Array.isArray(out.keywords)) {
    out.keywords = [...new Set(
      out.keywords.map(k => `${k}`.toLowerCase().trim()).filter(Boolean)
    )];
  }

  // Sanitise sections array — remove empty labels/content, enforce types
  if (Array.isArray(out.sections)) {
    out.sections = out.sections
      .filter(s => typeof s.label === 'string' && s.label.trim() &&
                   typeof s.content === 'string' && s.content.trim())
      .map((s, idx) => ({
        label:   s.label.trim().slice(0, 80),
        content: s.content.trim().slice(0, 2000),
        order:   typeof s.order === 'number' ? s.order : idx,
        // Preserve existing _id if provided (for updates)
        ...(s._id ? { _id: s._id } : {})
      }));
  }

  // Trim string fields
  if (typeof out.title    === 'string') out.title    = out.title.trim();
  if (typeof out.category === 'string') out.category = out.category.trim();

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET  /:companyId/knowledge/settings — Load knowledgeBaseSettings
// PATCH/:companyId/knowledge/settings — Save knowledgeBaseSettings
// ⚠️ MUST be registered BEFORE /:id
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:companyId/knowledge/settings', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const company = await v2Company.findById(companyId, 'knowledgeBaseSettings').lean();
    if (!company) return res.status(404).json({ success: false, error: 'Company not found' });
    return res.json({ success: true, knowledgeBaseSettings: company.knowledgeBaseSettings || {} });
  } catch (err) {
    logger.error('[companyKnowledge] GET settings error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load knowledge settings' });
  }
});

router.patch('/:companyId/knowledge/settings', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const updates = {};
  for (const field of SETTINGS_FIELDS) {
    if (field in req.body) {
      updates[`knowledgeBaseSettings.${field}`] = req.body[field];
    }
  }
  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: 'No valid settings fields provided' });
  }

  try {
    const company = await v2Company.findByIdAndUpdate(
      companyId,
      { $set: updates },
      { new: true, select: 'knowledgeBaseSettings', runValidators: true }
    ).lean();

    if (!company) return res.status(404).json({ success: false, error: 'Company not found' });

    logger.info('[companyKnowledge] Settings updated', { companyId, fields: Object.keys(updates) });
    return res.json({ success: true, knowledgeBaseSettings: company.knowledgeBaseSettings || {} });
  } catch (err) {
    logger.error('[companyKnowledge] PATCH settings error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to save knowledge settings' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/knowledge — List ALL containers (admin view, includes inactive)
// Also returns companyVariables so services.html can render the same auto-detected
// variables table as triggers.html — same store, same PUT /variables endpoint.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/knowledge', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const [containers, triggerSettings] = await Promise.all([
      CompanyKnowledgeContainer.findAllForCompany(companyId),
      CompanyTriggerSettings.findOne({ companyId }).lean().catch(() => null),
    ]);
    const companyVariables = triggerSettings?.companyVariables instanceof Map
      ? Object.fromEntries(triggerSettings.companyVariables)
      : (triggerSettings?.companyVariables || {});
    return res.json({ success: true, containers, total: containers.length, companyVariables });
  } catch (err) {
    logger.error('[companyKnowledge] GET list error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load knowledge containers' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/knowledge/active — Active containers only (runtime view)
// ⚠️ MUST be registered BEFORE /:id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/knowledge/active', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const containers = await CompanyKnowledgeContainer.findActiveForCompany(companyId);
    return res.json({ success: true, containers, total: containers.length });
  } catch (err) {
    logger.error('[companyKnowledge] GET active error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load active knowledge containers' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge — Create a knowledge container
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const body = _sanitiseBody(req.body || {});

  if (!body.title) {
    return res.status(400).json({ success: false, error: 'title is required' });
  }
  if (!body.sections?.length) {
    return res.status(400).json({ success: false, error: 'At least one section is required' });
  }

  try {
    // ── Atomic KC ID generation ──────────────────────────────────────────────
    // $inc guarantees no two containers ever share a seq number, even under
    // concurrent POSTs. Counter never resets — deleted numbers are never reused.
    // Format: {last5charsOfCompanyId}-{seq padded to 2 digits}  e.g. "700c4-01"
    const updatedCompany = await v2Company.findOneAndUpdate(
      { _id: companyId },
      { $inc: { 'aiAgentSettings.kcSeq': 1 } },
      { new: true, select: 'aiAgentSettings.kcSeq' }
    );
    const seq    = updatedCompany?.aiAgentSettings?.kcSeq ?? 1;
    const prefix = String(companyId).slice(-5);
    const kcId   = `${prefix}-${String(seq).padStart(2, '0')}`;
    // ────────────────────────────────────────────────────────────────────────

    const container = await CompanyKnowledgeContainer.create({ companyId, kcId, ...body });

    // Invalidate runtime cache — next call sees fresh data
    KnowledgeContainerService.invalidateCache(companyId).catch(e =>
      logger.warn('[companyKnowledge] cache invalidation failed on POST', { companyId, e: e.message })
    );

    logger.info('[companyKnowledge] Created container', { companyId, id: container._id, kcId, title: container.title });
    return res.status(201).json({ success: true, container });
  } catch (err) {
    logger.error('[companyKnowledge] POST create error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to create knowledge container' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// KEYWORD GENERATION HELPER — shared by both generate-keywords endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _runKeywordGeneration — Call Groq to generate keyword phrases for a container.
 * Used by both the pre-save and existing-container generate-keywords endpoints.
 *
 * @param {string} companyId — for logging
 * @param {string} title     — container title
 * @param {Array}  sections  — [{label, content}]
 * @param {Object} res       — Express response object
 * @returns {Promise<Response>} — sends JSON response and returns
 */
async function _runKeywordGeneration(companyId, title, sections, res) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'Groq API key not configured' });
  }

  // Build content summary for the Groq prompt
  const sectionSummary = (sections || [])
    .filter(s => s.label?.trim() && s.content?.trim())
    .map(s => `${s.label.trim()}: ${s.content.trim().slice(0, 300)}`)
    .join('\n');

  const promptContent = [
    title?.trim() ? `Topic: ${title.trim()}` : '',
    sectionSummary ? `Content:\n${sectionSummary}` : ''
  ].filter(Boolean).join('\n\n');

  if (!promptContent) {
    return res.status(400).json({ success: false, error: 'No usable content for keyword generation' });
  }

  try {
    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   300,
      temperature: 0.4,
      system: `You are a keyword generation expert for a phone AI agent.
Given a knowledge container for a service company, generate 12-18 short keyword phrases that a caller might say when asking about this topic over the phone.
Think about all natural ways a caller would ask: pricing, what's included, availability, specials, warranties, etc.
Return ONLY a valid JSON array of strings. No extra text. Example: ["how much is a service call","what does it include","is there a fee"]`,
      messages: [{ role: 'user', content: promptContent }],
      jsonMode: false,   // raw JSON array, not object mode
    });

    if (!result.response) {
      return res.status(500).json({ success: false, error: 'Groq returned no response' });
    }

    // Parse — expect a JSON array; handle any leading/trailing prose
    let keywords = [];
    try {
      const raw        = result.response.trim();
      const arrayMatch = raw.match(/\[[\s\S]*\]/);
      keywords = JSON.parse(arrayMatch ? arrayMatch[0] : raw);
    } catch (_e) {
      // Fallback: split on newlines and strip punctuation
      keywords = result.response
        .split(/[\n,]+/)
        .map(k => k.replace(/^[\s"'\-*•\d.]+|[\s"',]+$/g, '').trim())
        .filter(k => k.length > 2 && k.length < 80);
    }

    if (!Array.isArray(keywords)) {
      return res.status(500).json({ success: false, error: 'Failed to parse Groq keyword response' });
    }

    // Clean and deduplicate; cap at 20
    const cleaned = [...new Set(
      keywords
        .filter(k => typeof k === 'string')
        .map(k => k.toLowerCase().trim())
        .filter(k => k.length > 2 && k.length < 80)
    )].slice(0, 20);

    logger.info('[companyKnowledge] Generated keywords', { companyId, count: cleaned.length });
    return res.json({ success: true, keywords: cleaned });

  } catch (err) {
    logger.error('[companyKnowledge] generate-keywords error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Keyword generation failed' });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/generate-keywords — Generate keywords via Groq
// ⚠️ MUST be registered BEFORE /:id
//
// Accepts { title, sections: [{label, content}] } — works pre-save (no :id needed).
// Returns { keywords: [...] } — admin reviews, edits, saves via POST/PATCH separately.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/generate-keywords', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { title = '', sections = [] } = req.body || {};
  if (!title.trim() && !sections.length) {
    return res.status(400).json({ success: false, error: 'title or sections are required for keyword generation' });
  }

  return _runKeywordGeneration(companyId, title, sections, res);
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/reorder — Bulk priority update (drag-and-drop)
// ⚠️ MUST be registered BEFORE /:id
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/reorder', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const order = Array.isArray(req.body?.order) ? req.body.order : [];
  if (!order.length) {
    return res.status(400).json({ success: false, error: 'order array is required' });
  }

  try {
    const ops = order
      .filter(o => o.id && typeof o.priority === 'number')
      .map(o => ({
        updateOne: {
          filter: { _id: o.id, companyId },
          update: { $set: { priority: o.priority } }
        }
      }));

    if (ops.length) await CompanyKnowledgeContainer.bulkWrite(ops);

    KnowledgeContainerService.invalidateCache(companyId).catch(() => {});
    return res.json({ success: true, message: `Reordered ${ops.length} containers` });
  } catch (err) {
    logger.error('[companyKnowledge] reorder error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to reorder containers' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/knowledge/:id — Get single container
// ⚠️ Must be AFTER all literal-segment routes above
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/knowledge/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const container = await CompanyKnowledgeContainer.findOne({ _id: id, companyId }).lean();
    if (!container) return res.status(404).json({ success: false, error: 'Knowledge container not found' });
    return res.json({ success: true, container });
  } catch (err) {
    logger.error('[companyKnowledge] GET single error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load knowledge container' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:companyId/knowledge/:id — Partial update
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:companyId/knowledge/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const updates = _sanitiseBody(req.body || {});
  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }

  try {
    const container = await CompanyKnowledgeContainer.findOneAndUpdate(
      { _id: id, companyId },
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();

    if (!container) return res.status(404).json({ success: false, error: 'Knowledge container not found' });

    KnowledgeContainerService.invalidateCache(companyId).catch(e =>
      logger.warn('[companyKnowledge] cache invalidation failed on PATCH', { companyId, e: e.message })
    );

    logger.info('[companyKnowledge] Updated container', { companyId, id, fields: Object.keys(updates) });
    return res.json({ success: true, container });
  } catch (err) {
    logger.error('[companyKnowledge] PATCH error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update knowledge container' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:companyId/knowledge/:id — Soft delete (isActive = false)
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:companyId/knowledge/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const container = await CompanyKnowledgeContainer.findOneAndUpdate(
      { _id: id, companyId },
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!container) return res.status(404).json({ success: false, error: 'Knowledge container not found' });

    KnowledgeContainerService.invalidateCache(companyId).catch(() => {});
    logger.info('[companyKnowledge] Soft-deleted container', { companyId, id });
    return res.json({ success: true, message: 'Knowledge container deactivated' });
  } catch (err) {
    logger.error('[companyKnowledge] DELETE error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to deactivate knowledge container' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:companyId/knowledge/:id/hard — Permanent delete
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:companyId/knowledge/:id/hard', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const result = await CompanyKnowledgeContainer.deleteOne({ _id: id, companyId });
    if (!result.deletedCount) return res.status(404).json({ success: false, error: 'Knowledge container not found' });

    KnowledgeContainerService.invalidateCache(companyId).catch(() => {});
    logger.info('[companyKnowledge] Hard-deleted container', { companyId, id });
    return res.json({ success: true, message: 'Knowledge container permanently deleted' });
  } catch (err) {
    logger.error('[companyKnowledge] hard DELETE error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to delete knowledge container' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/:id/generate-keywords — Regen for existing container
// Uses the same Groq logic as the pre-save endpoint — loads container from DB
// then delegates to _runKeywordGeneration.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/:id/generate-keywords', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const container = await CompanyKnowledgeContainer.findOne({ _id: id, companyId }).lean();
    if (!container) return res.status(404).json({ success: false, error: 'Knowledge container not found' });

    return _runKeywordGeneration(companyId, container.title, container.sections, res);
  } catch (err) {
    logger.error('[companyKnowledge] generate-keywords (existing) error', { companyId, id, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to generate keywords' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/optimize-priorities
// Analyzes ALL containers for the company and returns AI-proposed priority
// numbers. Does NOT write — caller applies via POST /reorder when confirmed.
// Returns: { success, proposals: [{ id, title, kcId, oldPriority, newPriority }] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/optimize-priorities', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'Groq API key not configured' });
  }

  try {
    const containers = await CompanyKnowledgeContainer.find({ companyId })
      .select('_id title category keywords kcId priority isActive')
      .sort({ priority: 1, createdAt: 1 })
      .lean();

    if (!containers.length) {
      return res.status(400).json({ success: false, error: 'No containers found for this company' });
    }

    // Compact summary for Groq — titles, categories, sample keywords only
    const summary = containers.map((c, i) => {
      const kwSample = (c.keywords || []).slice(0, 6).join(', ');
      const kwExtra  = (c.keywords || []).length > 6 ? ` +${(c.keywords||[]).length - 6} more` : '';
      return `${i + 1}. ID:${c._id} | "${c.title}" | cat:${c.category || 'none'} | kw:[${kwSample}${kwExtra}]`;
    }).join('\n');

    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   400,
      temperature: 0.15,
      system: `You are a priority optimizer for a phone AI knowledge base used by home-service companies.
Given a list of Knowledge Containers, assign each a priority number so the most relevant container wins when a caller's question could match multiple containers.

PRIORITY RULES:
- Lower number = higher priority = wins tie-breaks when two containers score equally on keyword matching
- Use multiples of 10 ONLY (10, 20, 30 … 990) — leaves room for future manual adjustments
- SPECIFIC topic beats GENERAL: "Refrigerant Recharge (Freon)" beats "General Service Pricing"
- Unique-keyword containers (little overlap risk) → higher numbers (200–500) — they rarely compete
- High-overlap broad containers (general pricing, FAQs) → lower numbers so they serve as catch-all last resort
- Promotions/Specials → medium range (40–100), specific trigger words reduce overlap risk
- If only 1 container, assign priority 10

Return ONLY a valid JSON array — no markdown, no explanation:
[{"id":"...","priority":10},{"id":"...","priority":20}]`,
      messages: [{ role: 'user', content: `CONTAINERS:\n${summary}` }],
      jsonMode: false,
    });

    if (!result.response) {
      return res.status(500).json({ success: false, error: 'Groq returned no response' });
    }

    // Strip any accidental markdown fences then parse
    const raw = result.response.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
    let proposed;
    try {
      proposed = JSON.parse(raw);
      if (!Array.isArray(proposed)) throw new Error('not an array');
    } catch (_e) {
      return res.status(500).json({ success: false, error: 'Groq returned unparseable priority list' });
    }

    // Build before/after proposals for the preview modal
    const idToContainer = Object.fromEntries(containers.map(c => [String(c._id), c]));
    const proposals = proposed
      .filter(p => p.id && typeof p.priority === 'number' && idToContainer[String(p.id)])
      .map(p => {
        const c = idToContainer[String(p.id)];
        return {
          id:          String(p.id),
          title:       c.title,
          kcId:        c.kcId   || null,
          isActive:    c.isActive,
          oldPriority: c.priority ?? 100,
          newPriority: Math.max(10, Math.round(p.priority / 10) * 10),
        };
      })
      .sort((a, b) => a.newPriority - b.newPriority);

    logger.info('[companyKnowledge] optimize-priorities', { companyId, count: proposals.length });
    return res.json({ success: true, proposals });

  } catch (err) {
    logger.error('[companyKnowledge] optimize-priorities error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to optimize priorities' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/knowledge/suggest-label
// Body: { content: string }   — one section's text content
// Returns: { success, suggestion }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/knowledge/suggest-label', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { content } = req.body;
  if (!content?.trim()) {
    return res.status(400).json({ success: false, error: 'No content provided' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ success: false, error: 'Groq API key not configured' });
  }

  try {
    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:       'llama-3.3-70b-versatile',
      maxTokens:   40,
      temperature: 0.3,
      system: `You are a label writer for a phone AI knowledge base used by service companies.
Given a section's content, write a short label (5-10 words max) that describes the scenario or question this section answers.
Rules:
- Plain English only — no markdown, no asterisks, no brackets
- Describe the situation or caller's question, NOT the answer
- Be specific and descriptive
- Use title-case or sentence-case (not ALL CAPS)
Examples of good labels:
  "Cost Objection — Caller Pushes Back on Price"
  "What's Included in Each Tune-Up Visit"
  "Monthly vs Annual Payment Options"
  "Caller Asks What the Technician Does On-Site"
  "General Pricing — How Much Is the Plan"
Return ONLY the label text. No quotes. No extra text.`,
      messages: [{ role: 'user', content: content.trim().slice(0, 600) }],
      jsonMode: false,
    });

    const suggestion = (result.response || '').trim().replace(/^["'`]|["'`]$/g, '');
    if (!suggestion) {
      return res.status(500).json({ success: false, error: 'Groq returned no suggestion' });
    }

    logger.debug('[companyKnowledge] suggest-label', { companyId, suggestion });
    return res.json({ success: true, suggestion });
  } catch (err) {
    logger.error('[companyKnowledge] suggest-label error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: 'Failed to generate label suggestion' });
  }
});

module.exports = router;
