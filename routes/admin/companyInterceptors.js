'use strict';

/**
 * ============================================================================
 * COMPANY INTERCEPTORS — Admin API Routes
 * ============================================================================
 *
 * CRUD API for per-company custom interceptor rules that fire BEFORE the main
 * KC routing pipeline. Each interceptor matches caller input by keyword list
 * and executes a configured action (RESPOND / ROUTE_KC / BOOK / TRANSFER).
 *
 * ISOLATION RULES:
 *   - Every route is scoped by companyId (path parameter)
 *   - MongoDB queries always include { companyId } filter
 *   - Redis cache key is namespaced: interceptors:{companyId}
 *   - No cross-tenant access is possible — enforced by _validateCompanyAccess()
 *
 * ROUTE REGISTRATION ORDER (critical):
 *   Literal segment routes (/active, /reorder, /test) MUST be registered
 *   BEFORE the parameterised /:id route, or Express will match the literal
 *   string as the :id value → 404 / unexpected 400 errors.
 *   The ⚠️ markers below indicate routes that are order-sensitive.
 *
 * ENDPOINTS:
 *   GET    /:companyId/interceptors              — List all rules incl. disabled (admin view)
 *   POST   /:companyId/interceptors              — Create new rule
 *   ⚠️ GET  /:companyId/interceptors/active      — List only enabled rules (runtime view)
 *   ⚠️ POST /:companyId/interceptors/reorder     — Bulk priority update [{id, priority}]
 *   ⚠️ POST /:companyId/interceptors/test        — Dry-run input against all rules (no DB write)
 *   GET    /:companyId/interceptors/:id          — Get single rule
 *   PATCH  /:companyId/interceptors/:id          — Partial update
 *   DELETE /:companyId/interceptors/:id          — Soft-delete (enabled=false)
 *   DELETE /:companyId/interceptors/:id/hard     — Hard delete (permanent)
 *
 * ============================================================================
 */

const express                 = require('express');
const router                  = express.Router();
const logger                  = require('../../utils/logger');
const { authenticateJWT }     = require('../../middleware/auth');
const CompanyInterceptor      = require('../../models/CompanyInterceptor');
const SmartInterceptorService = require('../../services/engine/arbitration/SmartInterceptorService');

// ── All routes require a valid JWT ───────────────────────────────────────────
router.use(authenticateJWT);

// ── Allowed Fields ────────────────────────────────────────────────────────────

/**
 * ALLOWED_FIELDS — Whitelist of fields accepted on create and update.
 * Any field not on this list is silently dropped by _sanitiseBody().
 * Prevents accidental or malicious writes to internal fields (companyId, stats, etc.).
 */
const ALLOWED_FIELDS = [
  'name',
  'description',
  'enabled',
  'priority',
  'keywords',
  'matchMode',
  'action'
];

// ── Validation Helpers ────────────────────────────────────────────────────────

/**
 * _validateCompanyAccess — Verify that the requesting user is allowed to
 * access the specified companyId.
 *
 * Sends an error response and returns false if access is denied.
 * Returns true if access is granted (caller may proceed).
 *
 * Admin/super_admin/platform_admin roles bypass the companyId match check
 * so support engineers can administer any tenant.
 *
 * @param {Object} req       — Express request
 * @param {Object} res       — Express response
 * @param {string} companyId — companyId from route param
 * @returns {boolean}
 */
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

/**
 * _sanitiseBody — Extract and clean only allowed fields from request body.
 *
 * Keyword arrays are trimmed, lowercased, and deduplicated on every write.
 * String fields are trimmed. The action object is passed through as-is
 * (schema validation handles action field constraints).
 *
 * @param {Object} body — req.body
 * @returns {Object} Sanitised fields
 */
function _sanitiseBody(body) {
  const out = {};
  for (const key of ALLOWED_FIELDS) {
    if (key in body) out[key] = body[key];
  }

  // Normalise keywords — trim, lowercase, remove empties, deduplicate
  if (Array.isArray(out.keywords)) {
    out.keywords = [
      ...new Set(
        out.keywords
          .map(k => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
          .filter(Boolean)
      )
    ];
  }

  // Trim string scalars
  for (const sf of ['name', 'description']) {
    if (typeof out[sf] === 'string') out[sf] = out[sf].trim();
  }

  return out;
}

// ── GET /:companyId/interceptors — List ALL rules (admin view) ────────────────
// Returns all interceptors including disabled ones, sorted by priority ASC.
// Use this for the admin UI where the engineer needs to see and manage all rules.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/interceptors', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const rules = await CompanyInterceptor
      .find({ companyId })
      .sort({ priority: 1, createdAt: 1 })
      .lean();

    return res.json({ success: true, rules, total: rules.length });
  } catch (err) {
    logger.error('[companyInterceptors] GET list error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load interceptors' });
  }
});

// ── POST /:companyId/interceptors — Create new rule ───────────────────────────
// Keywords are normalised on write. Cache is invalidated immediately.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/interceptors', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const body = _sanitiseBody(req.body || {});

  if (!body.name) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }
  if (!Array.isArray(body.keywords) || body.keywords.length === 0) {
    return res.status(400).json({ success: false, error: 'keywords must be a non-empty array' });
  }
  if (!body.action?.type) {
    return res.status(400).json({ success: false, error: 'action.type is required' });
  }

  try {
    const rule = await CompanyInterceptor.create({ companyId, ...body });

    // Invalidate runtime cache so the next call turn sees the new rule
    SmartInterceptorService.invalidateCache(companyId);

    logger.info('[companyInterceptors] Created interceptor', {
      companyId,
      id:   rule._id,
      name: rule.name
    });

    return res.status(201).json({ success: true, rule });
  } catch (err) {
    logger.error('[companyInterceptors] POST create error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to create interceptor' });
  }
});

// ── GET /:companyId/interceptors/active — Enabled rules only ──────────────────
// ⚠️ MUST be registered BEFORE /:id — literal segment beats param only if registered first.
// Returns only enabled=true interceptors, sorted by priority.
// This is the "runtime view" — what SmartInterceptorService would load.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/interceptors/active', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const rules = await CompanyInterceptor.findActiveForCompany(companyId);
    return res.json({ success: true, rules, total: rules.length });
  } catch (err) {
    logger.error('[companyInterceptors] GET active error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load active interceptors' });
  }
});

// ── POST /:companyId/interceptors/reorder — Bulk priority update ──────────────
// ⚠️ MUST be registered BEFORE /:id
// Accepts: { order: [{ id, priority }, ...] }
// Performs a MongoDB bulkWrite to update priority on all listed rules at once.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/interceptors/reorder', async (req, res) => {
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

    if (ops.length) await CompanyInterceptor.bulkWrite(ops);

    SmartInterceptorService.invalidateCache(companyId);

    logger.info('[companyInterceptors] Reordered interceptors', {
      companyId,
      updatedCount: ops.length
    });

    return res.json({ success: true, message: `Reordered ${ops.length} interceptors` });
  } catch (err) {
    logger.error('[companyInterceptors] reorder error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to reorder interceptors' });
  }
});

// ── POST /:companyId/interceptors/test — Dry-run test ─────────────────────────
// ⚠️ MUST be registered BEFORE /:id
// Tests caller input against all company interceptors without writing to DB.
// Returns which rule (if any) would fire and the match details.
// Body: { input: string }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/:companyId/interceptors/test', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const input = (req.body?.input || '').trim();
  if (!input) {
    return res.status(400).json({ success: false, error: 'input is required' });
  }

  try {
    // Load all active rules for this company (uses cache)
    const rules = await SmartInterceptorService.loadForCompany(companyId);

    // Test input against each rule in priority order — mirrors evaluate() but
    // does NOT call recordMatch() (no DB write, pure simulation)
    const results = [];

    for (const rule of rules) {
      if (!rule.enabled) continue;

      const testResult = SmartInterceptorService.test(
        input,
        rule.keywords,
        rule.matchMode || 'ANY'
      );

      results.push({
        ruleId:         rule._id,
        ruleName:       rule.name,
        matchMode:      rule.matchMode || 'ANY',
        matched:        testResult.matched,
        matchedKeyword: testResult.matchedKeyword,
        matchCount:     testResult.matchCount,
        normalizedInput: testResult.normalizedInput,
        action:         rule.action,
        priority:       rule.priority
      });
    }

    const firstMatch = results.find(r => r.matched) || null;

    return res.json({
      success:        true,
      input,
      wouldFire:      !!firstMatch,
      matchedRule:    firstMatch,
      allRuleResults: results,
      totalRules:     results.length
    });
  } catch (err) {
    logger.error('[companyInterceptors] test error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to run interceptor test' });
  }
});

// ── GET /:companyId/interceptors/:id — Get single rule ────────────────────────
router.get('/:companyId/interceptors/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const rule = await CompanyInterceptor
      .findOne({ _id: id, companyId })
      .lean();

    if (!rule) return res.status(404).json({ success: false, error: 'Interceptor not found' });

    return res.json({ success: true, rule });
  } catch (err) {
    logger.error('[companyInterceptors] GET single error', { companyId, id, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load interceptor' });
  }
});

// ── PATCH /:companyId/interceptors/:id — Partial update ──────────────────────
// Only ALLOWED_FIELDS may be updated. Keywords are re-normalised on write.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:companyId/interceptors/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const updates = _sanitiseBody(req.body || {});
  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }

  try {
    const rule = await CompanyInterceptor.findOneAndUpdate(
      { _id: id, companyId },
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();

    if (!rule) return res.status(404).json({ success: false, error: 'Interceptor not found' });

    SmartInterceptorService.invalidateCache(companyId);

    logger.info('[companyInterceptors] Updated interceptor', {
      companyId,
      id,
      fields: Object.keys(updates)
    });

    return res.json({ success: true, rule });
  } catch (err) {
    logger.error('[companyInterceptors] PATCH error', { companyId, id, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update interceptor' });
  }
});

// ── DELETE /:companyId/interceptors/:id — Soft delete (enabled = false) ───────
// Sets enabled=false. Rule is preserved in DB for audit and re-activation.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:companyId/interceptors/:id', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const rule = await CompanyInterceptor.findOneAndUpdate(
      { _id: id, companyId },
      { $set: { enabled: false } },
      { new: true }
    ).lean();

    if (!rule) return res.status(404).json({ success: false, error: 'Interceptor not found' });

    SmartInterceptorService.invalidateCache(companyId);

    logger.info('[companyInterceptors] Soft-deleted interceptor', { companyId, id });

    return res.json({ success: true, message: 'Interceptor disabled' });
  } catch (err) {
    logger.error('[companyInterceptors] soft-DELETE error', { companyId, id, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to disable interceptor' });
  }
});

// ── DELETE /:companyId/interceptors/:id/hard — Hard delete (permanent) ────────
// Permanently removes the document. This action is irreversible.
// Use soft-delete unless the admin explicitly requests a permanent removal.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:companyId/interceptors/:id/hard', async (req, res) => {
  const { companyId, id } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const result = await CompanyInterceptor.deleteOne({ _id: id, companyId });

    if (!result.deletedCount) {
      return res.status(404).json({ success: false, error: 'Interceptor not found' });
    }

    SmartInterceptorService.invalidateCache(companyId);

    logger.info('[companyInterceptors] Hard-deleted interceptor', { companyId, id });

    return res.json({ success: true, message: 'Interceptor permanently deleted' });
  } catch (err) {
    logger.error('[companyInterceptors] hard-DELETE error', { companyId, id, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to delete interceptor' });
  }
});

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = router;
