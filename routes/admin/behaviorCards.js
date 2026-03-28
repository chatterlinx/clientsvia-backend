'use strict';

/**
 * ============================================================================
 * BEHAVIOR CARDS — ADMIN API ROUTES
 * ============================================================================
 *
 * Full CRUD for Behavior Cards (BC) per company.
 *
 * ALL routes enforce:
 *   - companyId scoping (multi-tenant — no cross-tenant reads possible)
 *   - JWT authentication (authenticateJWT middleware)
 *   - Cache invalidation after every write (fire-and-forget)
 *   - Idempotency-safe operations (MongoDB findOneAndUpdate, not upsert)
 *
 * ROUTE TABLE:
 *   GET    /company/:companyId/behavior-cards            List all BC for company
 *   GET    /company/:companyId/behavior-cards/:bcId      Get single BC
 *   POST   /company/:companyId/behavior-cards            Create new BC
 *   PATCH  /company/:companyId/behavior-cards/:bcId      Update BC (partial)
 *   DELETE /company/:companyId/behavior-cards/:bcId      Delete BC
 *
 * BASE PATH registered in index.js:
 *   /api/admin/behavior-cards
 *
 * RELATED:
 *   Model:   models/BehaviorCard.js
 *   Service: services/behaviorCards/BehaviorCardService.js
 *   UI:      public/agent-console/enginehub.html  (Behavior Cards tab)
 * ============================================================================
 */

const express             = require('express');
const router              = express.Router();
const mongoose            = require('mongoose');
const BehaviorCard        = require('../../models/BehaviorCard');
const BehaviorCardService = require('../../services/behaviorCards/BehaviorCardService');
const { authenticateJWT } = require('../../middleware/auth');
const logger              = require('../../utils/logger');

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
 *
 * @param {string} companyId
 * @param {string} type         'category_linked' | 'standalone'
 * @param {string} identifier   category or standaloneType
 */
function _invalidateCacheFAF(companyId, type, identifier) {
  if (!identifier) return;
  BehaviorCardService.invalidate(companyId, type, identifier)
    .catch(err => logger.warn('[BC ROUTES] Cache invalidation failed (non-fatal)', {
      companyId, type, identifier, error: err.message
    }));
}

// ============================================================================
// GET /company/:companyId/behavior-cards
// List all Behavior Cards for a company, sorted by type then name.
// ============================================================================

router.get('/company/:companyId/behavior-cards', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;

  if (!_isValidObjectId(companyId)) {
    return res.status(400).json({ ok: false, error: 'Invalid companyId' });
  }

  try {
    // companyId in every query — zero cross-tenant reads possible
    const cards = await BehaviorCard
      .find({ companyId })
      .sort({ type: 1, name: 1 })
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
    // Both _id AND companyId required — cross-tenant bcId returns 404 not the doc
    const card = await BehaviorCard.findOne({ _id: bcId, companyId }).lean();

    if (!card) {
      return res.status(404).json({ ok: false, error: 'Behavior Card not found' });
    }

    return res.json({ ok: true, card });

  } catch (err) {
    logger.error('[BC ROUTES] GET single failed', { companyId, bcId, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to load Behavior Card' });
  }
});

// ============================================================================
// POST /company/:companyId/behavior-cards
// Create a new Behavior Card.
// Uniqueness is enforced at the database layer (compound partial indexes).
// A 409 is returned if a BC already exists for the same category or standaloneType.
// ============================================================================

router.post('/company/:companyId/behavior-cards', authenticateJWT, async (req, res) => {
  const { companyId } = req.params;

  if (!_isValidObjectId(companyId)) {
    return res.status(400).json({ ok: false, error: 'Invalid companyId' });
  }

  const {
    name,
    type,
    category,
    standaloneType,
    tone,
    rules,
    afterAction,
    escalationConfig,
    enabled
  } = req.body;

  // ── Required field validation ──────────────────────────────────────────────

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ ok: false, error: 'name is required' });
  }

  if (!type || !['category_linked', 'standalone'].includes(type)) {
    return res.status(400).json({
      ok:    false,
      error: 'type must be "category_linked" or "standalone"'
    });
  }

  if (type === 'category_linked' && (!category || category.trim().length === 0)) {
    return res.status(400).json({
      ok:    false,
      error: 'category is required for category_linked type'
    });
  }

  if (type === 'standalone' && !standaloneType) {
    return res.status(400).json({
      ok:    false,
      error: 'standaloneType is required for standalone type'
    });
  }

  // Validate standaloneType against allowed enum
  if (type === 'standalone' && !BehaviorCard.STANDALONE_TYPES.includes(standaloneType)) {
    return res.status(400).json({
      ok:    false,
      error: `Invalid standaloneType. Allowed: ${BehaviorCard.STANDALONE_TYPES.join(', ')}`
    });
  }

  // Validate afterAction against allowed enum
  if (afterAction && !BehaviorCard.AFTER_ACTIONS.includes(afterAction)) {
    return res.status(400).json({
      ok:    false,
      error: `Invalid afterAction. Allowed: ${BehaviorCard.AFTER_ACTIONS.join(', ')}`
    });
  }

  try {
    const card = new BehaviorCard({
      companyId:      companyId.trim(),
      name:           name.trim(),
      type,
      category:       type === 'category_linked' ? (category || '').trim() : '',
      standaloneType: type === 'standalone' ? standaloneType : null,
      tone:           (tone || '').trim(),
      rules: {
        do:               (rules?.do               || []).filter(r => r && r.trim().length > 0),
        doNot:            (rules?.doNot            || []).filter(r => r && r.trim().length > 0),
        exampleResponses: (rules?.exampleResponses || []).filter(r => r && r.trim().length > 0)
      },
      afterAction:      afterAction || 'none',
      escalationConfig: escalationConfig || undefined,
      enabled:          enabled !== false  // default true unless explicitly false
    });

    await card.save();

    // Invalidate Redis cache for this BC's lookup key (fire-and-forget)
    const identifier = type === 'category_linked' ? card.category : card.standaloneType;
    _invalidateCacheFAF(companyId, type, identifier);

    logger.info('[BC ROUTES] ✅ Created', {
      companyId,
      bcId: card._id.toString(),
      type,
      name: card.name
    });

    return res.status(201).json({ ok: true, card });

  } catch (err) {
    // Unique index violation — duplicate category or standaloneType for this company
    if (err.code === 11000) {
      const description = type === 'category_linked'
        ? `A Behavior Card for category "${category}" already exists for this company`
        : `A Behavior Card for standalone type "${standaloneType}" already exists for this company`;

      return res.status(409).json({ ok: false, error: description });
    }

    logger.error('[BC ROUTES] POST failed', { companyId, error: err.message });
    return res.status(500).json({ ok: false, error: 'Failed to create Behavior Card' });
  }
});

// ============================================================================
// PATCH /company/:companyId/behavior-cards/:bcId
// Partial update. Only fields explicitly provided in the request body are changed.
// type, category, standaloneType, and companyId cannot be updated after creation.
// ============================================================================

router.patch('/company/:companyId/behavior-cards/:bcId', authenticateJWT, async (req, res) => {
  const { companyId, bcId } = req.params;

  if (!_isValidObjectId(companyId) || !_isValidObjectId(bcId)) {
    return res.status(400).json({ ok: false, error: 'Invalid companyId or bcId' });
  }

  // Only these fields may be updated after creation.
  // type, category, standaloneType, companyId are intentionally excluded.
  const PATCHABLE_FIELDS = ['name', 'tone', 'rules', 'afterAction', 'escalationConfig', 'enabled'];

  const patch = {};
  for (const field of PATCHABLE_FIELDS) {
    if (req.body[field] !== undefined) {
      patch[field] = req.body[field];
    }
  }

  if (Object.keys(patch).length === 0) {
    return res.status(400).json({
      ok:    false,
      error: `No patchable fields provided. Allowed: ${PATCHABLE_FIELDS.join(', ')}`
    });
  }

  // Validate afterAction if provided
  if (patch.afterAction && !BehaviorCard.AFTER_ACTIONS.includes(patch.afterAction)) {
    return res.status(400).json({
      ok:    false,
      error: `Invalid afterAction. Allowed: ${BehaviorCard.AFTER_ACTIONS.join(', ')}`
    });
  }

  try {
    // companyId in filter enforces tenant isolation — cannot patch another tenant's BC
    const card = await BehaviorCard.findOneAndUpdate(
      { _id: bcId, companyId },
      { $set: patch },
      { new: true, runValidators: true }
    ).lean();

    if (!card) {
      return res.status(404).json({ ok: false, error: 'Behavior Card not found' });
    }

    // Invalidate Redis cache (fire-and-forget)
    const identifier = card.type === 'category_linked' ? card.category : card.standaloneType;
    _invalidateCacheFAF(companyId, card.type, identifier);

    logger.info('[BC ROUTES] ✅ Updated', {
      companyId,
      bcId,
      fields: Object.keys(patch)
    });

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
    // companyId in filter enforces tenant isolation
    const card = await BehaviorCard.findOneAndDelete({ _id: bcId, companyId }).lean();

    if (!card) {
      return res.status(404).json({ ok: false, error: 'Behavior Card not found' });
    }

    // Invalidate Redis cache (fire-and-forget)
    const identifier = card.type === 'category_linked' ? card.category : card.standaloneType;
    _invalidateCacheFAF(companyId, card.type, identifier);

    logger.info('[BC ROUTES] ✅ Deleted', {
      companyId,
      bcId,
      name: card.name
    });

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
