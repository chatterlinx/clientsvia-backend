const express = require('express');
const mongoose = require('mongoose');
const ConfigAuditLog = require('../../models/ConfigAuditLog');
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');

const router = express.Router();

function clampInt(value, def, min, max) {
  const v = Number.parseInt(value, 10);
  if (!Number.isFinite(v)) return def;
  return Math.max(min, Math.min(max, v));
}

function parseBool(value, def = false) {
  if (value === true || value === false) return value;
  const s = String(value || '').toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  return def;
}

/**
 * GET /api/admin/config-audit/:companyId?limit=50&includeSnapshots=0|1
 *
 * Purpose:
 * - Operator-grade verification of governance (RBAC + audit + effectiveConfigVersion)
 * - Removes need for Mongo shell/Compass for basic verification.
 *
 * Auth:
 * - Requires CONFIG_READ (support requires break-glass token to WRITE but can READ; break-glass company scope is enforced in RBAC)
 */
router.get('/config-audit/:companyId', authenticateJWT, requirePermission(PERMISSIONS.CONFIG_READ), async (req, res) => {
  const { companyId } = req.params;
  const limit = clampInt(req.query?.limit, 50, 1, 200);
  const includeSnapshots = parseBool(req.query?.includeSnapshots, false);

  if (!mongoose.Types.ObjectId.isValid(companyId)) {
    return res.status(400).json({ success: false, message: 'Invalid companyId' });
  }

  const projection = {
    companyId: 1,
    createdAt: 1,
    action: 1,
    actor: 1,
    request: 1,
    effectiveConfigVersionBefore: 1,
    effectiveConfigVersionAfter: 1,
    diff: 1,
    before: includeSnapshots ? 1 : 0,
    after: includeSnapshots ? 1 : 0
  };

  const rows = await ConfigAuditLog.find({ companyId })
    .sort({ createdAt: -1 })
    .limit(limit)
    .select(projection)
    .lean();

  const items = rows.map(r => ({
    createdAt: r.createdAt,
    action: r.action,
    actor: {
      userId: r.actor?.userId || null,
      email: r.actor?.email || null,
      role: r.actor?.role || null,
      effectiveRole: r.actor?.effectiveRole || null,
      breakGlass: r.actor?.breakGlass === true
    },
    requestId: r.request?.requestId || null,
    method: r.request?.method || null,
    path: r.request?.path || null,
    updatedPaths: Array.isArray(r.diff?.updatedPaths) ? r.diff.updatedPaths : [],
    diffSummary: r.diff?.summary || null,
    effectiveConfigVersionBefore: r.effectiveConfigVersionBefore || null,
    effectiveConfigVersionAfter: r.effectiveConfigVersionAfter || null,
    ...(includeSnapshots ? { before: r.before || null, after: r.after || null } : {})
  }));

  return res.json({
    success: true,
    _meta: {
      companyId,
      limit,
      includeSnapshots
    },
    items
  });
});

module.exports = router;


