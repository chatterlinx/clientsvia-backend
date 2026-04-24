'use strict';

/**
 * ============================================================================
 * BEHAVIOR CARDS — ADMIN API ROUTES
 * ============================================================================
 *
 * Full CRUD + AI generation for Behavior Cards (BC) per company.
 * Scope (April 2026): category-linked BCs only. The standalone BC variant
 * and the Engine Hub runtime that consumed it were removed; flow-level
 * behavior now lives in `company.aiAgentSettings.llmAgent.behaviorRules[]`
 * edited in services.html Behavior tab.
 *
 * ALL routes enforce:
 *   - companyId scoping (multi-tenant — no cross-tenant reads possible)
 *   - JWT authentication (authenticateJWT middleware)
 *   - Cache invalidation after every write (fire-and-forget)
 *   - Idempotency-safe operations (MongoDB findOneAndUpdate, not upsert)
 *
 * ROUTE TABLE:
 *   GET    /company/:companyId/behavior-cards                List all BC for company
 *   GET    /company/:companyId/behavior-cards/:bcId          Get single BC
 *   POST   /company/:companyId/behavior-cards                Create new BC (category_linked only)
 *   PATCH  /company/:companyId/behavior-cards/:bcId          Update BC (partial)
 *   DELETE /company/:companyId/behavior-cards/:bcId          Delete BC
 *   POST   /company/:companyId/behavior-cards/generate       AI-generate draft BC
 *
 * BASE PATH registered in index.js:
 *   /api/admin/behavior-cards
 *
 * RELATED:
 *   Model:   models/BehaviorCard.js
 *   Service: services/behaviorCards/BehaviorCardService.js
 *   UI:      public/agent-console/services.html  (Behavior Cards per KC category)
 * ============================================================================
 */

const express              = require('express');
const router               = express.Router();
const mongoose             = require('mongoose');
const BehaviorCard         = require('../../models/BehaviorCard');
const BehaviorCardService  = require('../../services/behaviorCards/BehaviorCardService');
const GroqStreamAdapter    = require('../../services/streaming/adapters/GroqStreamAdapter');
const v2Company            = require('../../models/v2Company');
const { authenticateJWT }  = require('../../middleware/auth');
const logger               = require('../../utils/logger');

// ============================================================================
// INTERNAL HELPERS
// ============================================================================

/** Validate that a string is a legal MongoDB ObjectId. */
function _isValidObjectId(id) {
  return typeof id === 'string' && mongoose.Types.ObjectId.isValid(id);
}

/**
 * Invalidate the BC Redis cache after any write.
 * Always fire-and-forget — never awaited, never blocks the API response.
 */
function _invalidateCacheFAF(companyId, category) {
  if (!category) return;
  BehaviorCardService.invalidate(companyId, category)
    .catch(err => logger.warn('[BC ROUTES] Cache invalidation failed (non-fatal)', {
      companyId, category, error: err.message
    }));
}

// ============================================================================
// GET /company/:companyId/behavior-cards
// List all Behavior Cards for a company, sorted by name.
// ============================================================================

router.get('/company/:companyId/behavior-cards', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;

  if (!_isValidObjectId(companyId)) {
    return res.status(400).json({ ok: false, error: 'Invalid companyId' });
  }

  try {
    const cards = await BehaviorCard
      .find({ companyId, type: 'category_linked' })
      .sort({ name: 1 })
      .lean();

    logger.info('[BC ROUTES] GET list', { companyId, count: cards.length });
    return res.json({ ok: true, cards, total: cards.length });

  } catch (err) {
    logger.error('[BC ROUTES] GET list failed', { companyId, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to load Behavior Cards' });
  }
});

// ============================================================================
// GET /company/:companyId/behavior-cards/:bcId
// Get a single Behavior Card. companyId scoping is enforced in the query —
// a bcId from another tenant returns 404, not the foreign document.
// ============================================================================

router.get('/company/:companyId/behavior-cards/:bcId', authenticateJWT, async (req, res) => {
  const { companyId, bcId } = req.params;

  if (!_isValidObjectId(companyId) || !_isValidObjectId(bcId)) {
    return res.status(400).json({ ok: false, error: 'Invalid companyId or bcId' });
  }

  try {
    const card = await BehaviorCard.findOne({ _id: bcId, companyId }).lean();
    if (!card) return res.status(404).json({ ok: false, error: 'Behavior Card not found' });
    return res.json({ ok: true, card });

  } catch (err) {
    logger.error('[BC ROUTES] GET single failed', { companyId, bcId, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to load Behavior Card' });
  }
});

// ============================================================================
// POST /company/:companyId/behavior-cards/generate
// AI-generate a draft Behavior Card. Does NOT save — returns a draft for the
// owner to review and edit before saving via the normal POST endpoint.
//
// Body: { category }
//   category — KC category name (required)
//
// Returns: { ok, draft: { name, tone, rules: { do[], doNot[], exampleResponses[] } } }
// ============================================================================

router.post('/company/:companyId/behavior-cards/generate', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;

  if (!_isValidObjectId(companyId)) {
    return res.status(400).json({ ok: false, error: 'Invalid companyId' });
  }

  const { category } = req.body;

  if (!category?.trim()) {
    return res.status(400).json({ ok: false, error: 'category is required' });
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ ok: false, error: 'Groq API key not configured' });
  }

  try {
    // Load company context so Groq generates trade-specific rules
    const company = await v2Company.findById(companyId)
      .select('companyName tradeCategories')
      .lean();

    const companyName = company?.companyName || 'this company';
    const trade       = (company?.tradeCategories || []).join(', ') || 'home services';

    const scenario = `a caller asking about "${category}" topics`;

    const systemPrompt = `You are an expert phone agent behavior designer for home-service companies.
You write Behavior Cards — structured rules that govern how a phone agent speaks in a specific situation.
Behavior Cards are injected into the Groq system prompt. They must be clear, actionable, and spoken-word natural.

COMPANY: ${companyName}
TRADE/INDUSTRY: ${trade}
SCENARIO: ${scenario}

OUTPUT FORMAT — respond ONLY with valid JSON, no extra text:
{
  "name": "<short descriptive name, e.g. Pricing & Trust Behavior>",
  "tone": "<one sentence describing voice register and personality for this scenario>",
  "rules": {
    "do": ["<rule 1>", "<rule 2>", "<rule 3>", "<rule 4>"],
    "doNot": ["<rule 1>", "<rule 2>", "<rule 3>"],
    "exampleResponses": ["<30-word example 1>", "<30-word example 2>"]
  }
}

GUIDELINES:
- tone: voice register description, not a persona name. e.g. "Direct and confident — never apologetic about pricing. Moves naturally toward scheduling."
- do rules: specific, actionable. e.g. "State the exact price without hesitation" not "Be helpful"
- doNot rules: concrete prohibitions. e.g. "Never apologize for cost" not "Don't be rude"
- exampleResponses: 2 spoken examples that show the exact tone and length expected. These are calibration anchors — Groq pattern-matches from them.
- All rules must be specific to ${trade} and the "${category}" scenario.
- Do NOT generate generic rules. Every rule must be specific to this trade and scenario.`;

    const result = await GroqStreamAdapter.streamFull({
      apiKey,
      model:      'llama-3.3-70b-versatile',
      maxTokens:  600,
      temperature: 0.4,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: `Generate a Behavior Card for: ${scenario}` }],
      jsonMode:   true,
    });

    if (!result.response) {
      return res.status(502).json({ ok: false, error: 'Groq returned no response' });
    }

    // Parse the draft
    let draft;
    try {
      draft = JSON.parse(result.response.trim());
    } catch (_e) {
      logger.warn('[BC ROUTES] generate — JSON parse failed, attempting extraction', { companyId });
      // Try to extract from malformed response
      const match = result.response.match(/\{[\s\S]*\}/);
      if (match) {
        try { draft = JSON.parse(match[0]); } catch { /* fall through */ }
      }
      if (!draft) {
        return res.status(502).json({ ok: false, error: 'Failed to parse Groq response — try again' });
      }
    }

    // Sanitize output — never trust LLM to follow schema exactly
    const sanitized = {
      name:  typeof draft.name === 'string' ? draft.name.trim().slice(0, 120) : '',
      tone:  typeof draft.tone === 'string' ? draft.tone.trim().slice(0, 400) : '',
      rules: {
        do:               Array.isArray(draft.rules?.do)               ? draft.rules.do.filter(r => typeof r === 'string' && r.trim()).map(r => r.trim())               : [],
        doNot:            Array.isArray(draft.rules?.doNot)            ? draft.rules.doNot.filter(r => typeof r === 'string' && r.trim()).map(r => r.trim())            : [],
        exampleResponses: Array.isArray(draft.rules?.exampleResponses) ? draft.rules.exampleResponses.filter(r => typeof r === 'string' && r.trim()).map(r => r.trim()) : [],
      }
    };

    logger.info('[BC ROUTES] ✅ Generated draft BC', {
      companyId,
      target: category,
      name:   sanitized.name
    });

    return res.json({ ok: true, draft: sanitized });

  } catch (err) {
    logger.error('[BC ROUTES] generate failed', { companyId, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to generate Behavior Card' });
  }
});

// ============================================================================
// POST /company/:companyId/behavior-cards
// Create a new Behavior Card (category_linked only).
// Uniqueness is enforced at the database layer (compound partial indexes).
// A 409 is returned if a BC already exists for the same category.
// ============================================================================

router.post('/company/:companyId/behavior-cards', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;

  if (!_isValidObjectId(companyId)) {
    return res.status(400).json({ ok: false, error: 'Invalid companyId' });
  }

  const { name, category, tone, rules, enabled } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }

  if (!category || category.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'category is required' });
  }

  try {
    const card = new BehaviorCard({
      companyId:      companyId.trim(),
      name:           name.trim(),
      type:           'category_linked',
      category:       category.trim(),
      tone:           (tone || '').trim(),
      rules: {
        do:               (rules?.do               || []).filter(r => r && r.trim().length > 0),
        doNot:            (rules?.doNot            || []).filter(r => r && r.trim().length > 0),
        exampleResponses: (rules?.exampleResponses || []).filter(r => r && r.trim().length > 0)
      },
      enabled: enabled !== false
    });

    await card.save();

    _invalidateCacheFAF(companyId, card.category);

    logger.info('[BC ROUTES] ✅ Created', { companyId, bcId: card._id.toString(), category: card.category, name: card.name });
    return res.status(201).json({ ok: true, card });

  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        ok: false,
        error: `A Behavior Card for category "${category}" already exists for this company`
      });
    }

    logger.error('[BC ROUTES] POST failed', { companyId, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to create Behavior Card' });
  }
});

// ============================================================================
// PATCH /company/:companyId/behavior-cards/:bcId
// Partial update. Only fields explicitly provided in the request body are changed.
// type, category, and companyId cannot be updated after creation.
// ============================================================================

router.patch('/company/:companyId/behavior-cards/:bcId', authenticateJWT, async (req, res) => {
  const { companyId, bcId } = req.params;

  if (!_isValidObjectId(companyId) || !_isValidObjectId(bcId)) {
    return res.status(400).json({ ok: false, error: 'Invalid companyId or bcId' });
  }

  const PATCHABLE_FIELDS = ['name', 'tone', 'rules', 'enabled'];

  const patch = {};
  for (const field of PATCHABLE_FIELDS) {
    if (req.body[field] !== undefined) patch[field] = req.body[field];
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({
      ok:    false,
      error: `No patchable fields provided. Allowed: ${PATCHABLE_FIELDS.join(', ')}`
    });
  }

  try {
    const card = await BehaviorCard.findOneAndUpdate(
      { _id: bcId, companyId },
      { $set: patch },
      { new: true, runValidators: true }
    ).lean();

    if (!card) return res.status(404).json({ ok: false, error: 'Behavior Card not found' });

    _invalidateCacheFAF(companyId, card.category);

    logger.info('[BC ROUTES] ✅ Updated', { companyId, bcId, fields: Object.keys(patch) });
    return res.json({ ok: true, card });

  } catch (err) {
    logger.error('[BC ROUTES] PATCH failed', { companyId, bcId, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to update Behavior Card' });
  }
});

// ============================================================================
// DELETE /company/:companyId/behavior-cards/:bcId
// Hard delete. companyId scoping enforced — cannot delete another tenant's BC.
// ============================================================================

router.delete('/company/:companyId/behavior-cards/:bcId', authenticateJWT, async (req, res) => {
  const { companyId, bcId } = req.params;

  if (!_isValidObjectId(companyId) || !_isValidObjectId(bcId)) {
    return res.status(400).json({ ok: false, error: 'Invalid companyId or bcId' });
  }

  try {
    const card = await BehaviorCard.findOneAndDelete({ _id: bcId, companyId }).lean();
    if (!card) return res.status(404).json({ ok: false, error: 'Behavior Card not found' });

    _invalidateCacheFAF(companyId, card.category);

    logger.info('[BC ROUTES] ✅ Deleted', { companyId, bcId, name: card.name });
    return res.json({ ok: true, message: `Behavior Card "${card.name}" deleted` });

  } catch (err) {
    logger.error('[BC ROUTES] DELETE failed', { companyId, bcId, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to delete Behavior Card' });
  }
});

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = router;
