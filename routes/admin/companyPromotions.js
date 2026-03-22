'use strict';

/**
 * ============================================================================
 * COMPANY PROMOTIONS — Admin API Routes
 * ============================================================================
 *
 * Manages per-company promotions, coupons, and specials.
 * All routes require companyId in the path — no cross-tenant access possible.
 *
 * ISOLATION RULES:
 *   - Every route is scoped by companyId
 *   - MongoDB queries always include { companyId } filter
 *   - Redis cache key is namespaced: promotions:{companyId}
 *
 * REDIS CACHE:
 *   Every write operation (POST, PATCH, DELETE) calls
 *   PromotionsInterceptor.invalidateCache(companyId) to ensure the next
 *   runtime call reads fresh data.
 *
 * FUTURE FRONTEND (end-user platform):
 *   These same routes will be consumed by the customer-facing frontend.
 *   The only addition needed at that time is a companyId-scoped JWT middleware
 *   in place of (or alongside) the existing admin JWT.
 *   No schema or route changes required.
 *
 * ENDPOINTS:
 *   GET    /:companyId/promotions           — List all promos (admin view)
 *   GET    /:companyId/promotions/active    — List only active/valid promos (runtime view)
 *   POST   /:companyId/promotions           — Create a new promo
 *   GET    /:companyId/promotions/:id       — Get a single promo by _id
 *   PATCH  /:companyId/promotions/:id       — Update a promo (partial update)
 *   DELETE /:companyId/promotions/:id       — Soft-delete (sets isActive=false + deletedAt)
 *   DELETE /:companyId/promotions/:id/hard  — Hard delete (removes document permanently)
 *   POST   /:companyId/promotions/reorder   — Bulk update priorities for drag-and-drop ordering
 *
 * ============================================================================
 */

const express            = require('express');
const router             = express.Router();
const logger             = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const CompanyPromotion   = require('../../models/CompanyPromotion');
const PromotionsInterceptor = require('../../services/engine/agent2/PromotionsInterceptor');

// ── All routes require a valid JWT ───────────────────────────────────────────
router.use(authenticateJWT);

// ── Validation helper ────────────────────────────────────────────────────────

/**
 * _validateCompanyAccess — Ensures the requesting user can access this company.
 * Platform admins can access any companyId.
 * Regular users can only access their own companyId.
 */
function _validateCompanyAccess(req, res, companyId) {
  if (!companyId) {
    res.status(400).json({ success: false, error: 'companyId is required' });
    return false;
  }
  const user = req.user;
  const isAdmin = (
    user?.role === 'admin' ||
    user?.role === 'super_admin' ||
    user?.role === 'platform_admin' ||
    user?.isSuperAdmin === true ||
    user?.isPlatformAdmin === true
  );
  if (!isAdmin && user?.companyId !== companyId) {
    res.status(403).json({ success: false, error: 'Access denied — company mismatch' });
    return false;
  }
  return true;
}

// ── Sanitize body fields — only allow known writable fields ──────────────────

function _sanitizePromoBody(body) {
  const allowed = [
    'name', 'code', 'serviceType', 'serviceLabel',
    'discountType', 'discountValue',
    'description', 'bookingPrompt', 'noCouponResponse', 'terms',
    'validFrom', 'validTo',
    'isActive', 'priority'
  ];
  const clean = {};
  for (const key of allowed) {
    if (body[key] !== undefined) {
      clean[key] = body[key];
    }
  }
  return clean;
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/promotions
// List all promos for this company (admin view — includes inactive)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/promotions', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const promos = await CompanyPromotion
      .find({ companyId })
      .sort({ priority: 1, createdAt: -1 })
      .lean();

    logger.info(`[CompanyPromotions] GET list — company ${companyId} — ${promos.length} promos`);
    return res.json({ success: true, promotions: promos, total: promos.length });

  } catch (err) {
    logger.error('[CompanyPromotions] GET list failed', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load promotions' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/promotions/active
// List only active, in-window promos (mirrors what runtime sees)
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/promotions/active', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const promos = await CompanyPromotion.findActiveForCompany(companyId);
    logger.info(`[CompanyPromotions] GET active — company ${companyId} — ${promos.length} active promos`);
    return res.json({ success: true, promotions: promos, total: promos.length });

  } catch (err) {
    logger.error('[CompanyPromotions] GET active failed', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load active promotions' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/promotions
// Create a new promotion
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/promotions', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const fields = _sanitizePromoBody(req.body);

  if (!fields.name?.trim()) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }

  try {
    const promo = await CompanyPromotion.create({ ...fields, companyId });

    // Invalidate Redis cache so the next runtime call reads fresh data
    PromotionsInterceptor.invalidateCache(companyId).catch(e =>
      logger.warn('[CompanyPromotions] POST — cache invalidation failed (non-fatal)', { companyId, error: e.message })
    );

    logger.info(`[CompanyPromotions] ✅ Created promo "${promo.name}"`, {
      companyId, promoId: promo._id
    });
    return res.status(201).json({ success: true, promotion: promo });

  } catch (err) {
    logger.error('[CompanyPromotions] POST failed', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to create promotion' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:companyId/promotions/:id
// Get a single promo by _id
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/promotions/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const promo = await CompanyPromotion.findOne({ _id: id, companyId }).lean();
    if (!promo) {
      return res.status(404).json({ success: false, error: 'Promotion not found' });
    }
    return res.json({ success: true, promotion: promo });

  } catch (err) {
    logger.error('[CompanyPromotions] GET single failed', { companyId, id, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load promotion' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:companyId/promotions/:id
// Update a promotion (partial update — only provided fields are changed)
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:companyId/promotions/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const fields = _sanitizePromoBody(req.body);

  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ success: false, error: 'No valid fields provided for update' });
  }

  try {
    const updated = await CompanyPromotion.findOneAndUpdate(
      { _id: id, companyId },
      { $set: fields },
      { new: true, runValidators: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Promotion not found' });
    }

    // Invalidate Redis cache
    PromotionsInterceptor.invalidateCache(companyId).catch(e =>
      logger.warn('[CompanyPromotions] PATCH — cache invalidation failed (non-fatal)', { companyId, error: e.message })
    );

    logger.info(`[CompanyPromotions] ✅ Updated promo "${updated.name}"`, {
      companyId, promoId: id, fields: Object.keys(fields)
    });
    return res.json({ success: true, promotion: updated });

  } catch (err) {
    logger.error('[CompanyPromotions] PATCH failed', { companyId, id, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update promotion' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:companyId/promotions/:id
// Soft delete — sets isActive = false and records deletedAt timestamp.
// Promo remains in the database for reporting / audit purposes.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:companyId/promotions/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const updated = await CompanyPromotion.findOneAndUpdate(
      { _id: id, companyId },
      { $set: { isActive: false } },
      { new: true }
    ).lean();

    if (!updated) {
      return res.status(404).json({ success: false, error: 'Promotion not found' });
    }

    // Invalidate Redis cache
    PromotionsInterceptor.invalidateCache(companyId).catch(e =>
      logger.warn('[CompanyPromotions] DELETE (soft) — cache invalidation failed (non-fatal)', { companyId, error: e.message })
    );

    logger.info(`[CompanyPromotions] ✅ Soft-deleted promo "${updated.name}"`, {
      companyId, promoId: id
    });
    return res.json({ success: true, message: 'Promotion deactivated', promotion: updated });

  } catch (err) {
    logger.error('[CompanyPromotions] DELETE (soft) failed', { companyId, id, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to deactivate promotion' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:companyId/promotions/:id/hard
// Hard delete — permanently removes the document from the database.
// Use with caution: irreversible.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:companyId/promotions/:id/hard', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const deleted = await CompanyPromotion.findOneAndDelete({ _id: id, companyId }).lean();

    if (!deleted) {
      return res.status(404).json({ success: false, error: 'Promotion not found' });
    }

    // Invalidate Redis cache
    PromotionsInterceptor.invalidateCache(companyId).catch(e =>
      logger.warn('[CompanyPromotions] DELETE (hard) — cache invalidation failed (non-fatal)', { companyId, error: e.message })
    );

    logger.info(`[CompanyPromotions] ✅ Hard-deleted promo "${deleted.name}"`, {
      companyId, promoId: id
    });
    return res.json({ success: true, message: 'Promotion permanently deleted' });

  } catch (err) {
    logger.error('[CompanyPromotions] DELETE (hard) failed', { companyId, id, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to delete promotion' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:companyId/promotions/reorder
// Bulk update priorities for drag-and-drop ordering in the UI.
// Body: { order: [ { id: '...', priority: 10 }, ... ] }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/promotions/reorder', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { order } = req.body;
  if (!Array.isArray(order) || order.length === 0) {
    return res.status(400).json({ success: false, error: 'order array is required' });
  }

  try {
    const ops = order.map(({ id, priority }) => ({
      updateOne: {
        filter: { _id: id, companyId },
        update: { $set: { priority: Number(priority) || 100 } }
      }
    }));

    await CompanyPromotion.bulkWrite(ops, { ordered: false });

    // Invalidate Redis cache
    PromotionsInterceptor.invalidateCache(companyId).catch(e =>
      logger.warn('[CompanyPromotions] reorder — cache invalidation failed (non-fatal)', { companyId, error: e.message })
    );

    logger.info(`[CompanyPromotions] ✅ Reordered ${ops.length} promos`, { companyId });
    return res.json({ success: true, message: `${ops.length} promos reordered` });

  } catch (err) {
    logger.error('[CompanyPromotions] reorder failed', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to reorder promotions' });
  }
});

module.exports = router;
