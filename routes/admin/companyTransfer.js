'use strict';

/**
 * ============================================================================
 * COMPANY TRANSFER — Admin API Routes
 * ============================================================================
 *
 * Full CRUD API for the enterprise Transfer & Routing system.
 * Two resource families under one router:
 *
 *   1. DESTINATIONS — the routing directory (employees, departments, externals)
 *   2. POLICY       — company-wide settings (schedule, screening, protocol)
 *
 * ROUTE REGISTRATION ORDER — CRITICAL:
 *   Literal segment routes (/policy, /active, /reorder, /stats) MUST be
 *   registered BEFORE the parameterised /:destId routes, or Express will
 *   match the literal string as the :destId value → 400/404 errors.
 *   The ⚠️ markers below indicate order-sensitive routes.
 *
 * ISOLATION RULES:
 *   - Every route is scoped by companyId (path parameter)
 *   - MongoDB queries always include { companyId } filter
 *   - Redis cache key is namespaced per companyId
 *   - _validateCompanyAccess() enforces tenant isolation on every request
 *   - Admin/super_admin/platform_admin roles can access any tenant
 *
 * ENDPOINTS — DESTINATIONS:
 *   GET    /:companyId/transfer/destinations              — List all (admin view)
 *   POST   /:companyId/transfer/destinations              — Create destination
 *   ⚠️ GET  /:companyId/transfer/destinations/active      — Enabled only (runtime view)
 *   ⚠️ POST /:companyId/transfer/destinations/reorder     — Bulk priority update
 *   ⚠️ GET  /:companyId/transfer/destinations/stats       — Usage stats summary
 *   GET    /:companyId/transfer/destinations/:destId      — Get single destination
 *   PATCH  /:companyId/transfer/destinations/:destId      — Partial update
 *   DELETE /:companyId/transfer/destinations/:destId      — Soft-delete (enabled=false)
 *   DELETE /:companyId/transfer/destinations/:destId/hard — Hard delete (permanent)
 *
 * ENDPOINTS — POLICY:
 *   ⚠️ GET   /:companyId/transfer/policy                  — Get/create policy
 *   ⚠️ PATCH /:companyId/transfer/policy                  — Partial update
 *   ⚠️ POST  /:companyId/transfer/policy/emergency        — Toggle emergency override
 *   ⚠️ POST  /:companyId/transfer/policy/vip              — Add/remove VIP number
 *   ⚠️ POST  /:companyId/transfer/policy/blocklist        — Add/remove blocked number
 *
 * REDIS CACHE:
 *   Keys:
 *     transfer-destinations:{companyId}  — list of all destinations
 *     transfer-policy:{companyId}        — company policy
 *   Invalidated on every mutating operation (POST/PATCH/DELETE).
 *   If Redis is unavailable, runtime falls through to MongoDB directly.
 *
 * ============================================================================
 */

const express               = require('express');
const router                = express.Router();
const logger                = require('../../utils/logger');
const { authenticateJWT }   = require('../../middleware/auth');
const TransferDestination   = require('../../models/TransferDestination');
const TransferPolicy        = require('../../models/TransferPolicy');
const { getSharedRedisClient } = require('../../services/redisClientFactory');

// ── All routes require a valid JWT ───────────────────────────────────────────
router.use(authenticateJWT);

// ── Cache helpers ─────────────────────────────────────────────────────────────

const DESTINATIONS_CACHE_TTL = 600;   // 10 min
const POLICY_CACHE_TTL       = 600;   // 10 min

async function _invalidateDestinationsCache(companyId) {
  try {
    const redis = await getSharedRedisClient();
    if (redis) await redis.del(`transfer-destinations:${companyId}`);
  } catch (_) { /* graceful degrade */ }
}

async function _invalidatePolicyCache(companyId) {
  try {
    const redis = await getSharedRedisClient();
    if (redis) await redis.del(`transfer-policy:${companyId}`);
  } catch (_) { /* graceful degrade */ }
}

// ── Access control ────────────────────────────────────────────────────────────

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

// ── Allowed destination fields ────────────────────────────────────────────────

const DESTINATION_ALLOWED_FIELDS = [
  'name', 'type', 'title', 'departmentId', 'departmentName',
  'phoneNumber', 'email', 'extension',
  'enabled', 'priority',
  'schedule', 'overflow', 'notifications',
  'transferContext', 'callerAccess', 'calendar', 'internalNotes'
];

// ── Allowed policy fields ─────────────────────────────────────────────────────

const POLICY_ALLOWED_FIELDS = [
  'directoryProtocol',
  'emergencyOverride',
  'schedule',
  'defaultTransferMode',
  'defaultOverflowAction',
  'defaultOverflowMessage',
  'sendCallerSummaryDefault',
  'includeDiscoveryNotesDefault',
  'announceTransfer',
  'callerScreening'
];

// ── Body sanitisers ───────────────────────────────────────────────────────────

function _sanitiseDestination(body) {
  const out = {};
  for (const key of DESTINATION_ALLOWED_FIELDS) {
    if (key in body) out[key] = body[key];
  }
  if (typeof out.name       === 'string') out.name       = out.name.trim();
  if (typeof out.title      === 'string') out.title      = out.title.trim();
  if (typeof out.phoneNumber === 'string') out.phoneNumber = out.phoneNumber.replace(/\s/g, '');
  if (typeof out.email      === 'string') out.email      = out.email.trim().toLowerCase();
  return out;
}

function _sanitisePolicy(body) {
  const out = {};
  for (const key of POLICY_ALLOWED_FIELDS) {
    if (key in body) out[key] = body[key];
  }
  return out;
}

// ════════════════════════════════════════════════════════════════════════════
// DESTINATION ROUTES
// ════════════════════════════════════════════════════════════════════════════

// ── GET /:companyId/transfer/destinations — List ALL destinations ─────────────
router.get('/:companyId/transfer/destinations', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const destinations = await TransferDestination
      .find({ companyId })
      .sort({ type: 1, priority: 1, createdAt: 1 })
      .lean();

    return res.json({
      success:      true,
      destinations,
      total:        destinations.length,
      byType: {
        agent:      destinations.filter(d => d.type === 'agent').length,
        department: destinations.filter(d => d.type === 'department').length,
        external:   destinations.filter(d => d.type === 'external').length
      }
    });
  } catch (err) {
    logger.error('[companyTransfer] GET destinations error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load destinations' });
  }
});

// ── POST /:companyId/transfer/destinations — Create destination ───────────────
router.post('/:companyId/transfer/destinations', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const body = _sanitiseDestination(req.body || {});

  if (!body.name) {
    return res.status(400).json({ success: false, error: 'name is required' });
  }
  if (!body.type || !['agent', 'department', 'external'].includes(body.type)) {
    return res.status(400).json({ success: false, error: 'type must be agent, department, or external' });
  }

  try {
    const dest = await TransferDestination.create({ companyId, ...body });
    await _invalidateDestinationsCache(companyId);

    logger.info('[companyTransfer] Created destination', {
      companyId, id: dest._id, name: dest.name, type: dest.type
    });

    return res.status(201).json({ success: true, destination: dest });
  } catch (err) {
    logger.error('[companyTransfer] POST create error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to create destination' });
  }
});

// ── GET /:companyId/transfer/destinations/active — Enabled only ───────────────
// ⚠️ MUST be registered BEFORE /:destId
router.get('/:companyId/transfer/destinations/active', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    // Try Redis cache first
    let cached;
    try {
      const redis = await getSharedRedisClient();
      if (redis) {
        const raw = await redis.get(`transfer-destinations:${companyId}`);
        if (raw) cached = JSON.parse(raw);
      }
    } catch (_) { /* graceful degrade */ }

    if (cached) {
      return res.json({ success: true, destinations: cached, total: cached.length, source: 'cache' });
    }

    const destinations = await TransferDestination.findActiveForCompany(companyId);

    // Write to cache
    try {
      const redis = await getSharedRedisClient();
      if (redis) await redis.setEx(
        `transfer-destinations:${companyId}`,
        DESTINATIONS_CACHE_TTL,
        JSON.stringify(destinations)
      );
    } catch (_) { /* graceful degrade */ }

    return res.json({ success: true, destinations, total: destinations.length, source: 'db' });
  } catch (err) {
    logger.error('[companyTransfer] GET active error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load active destinations' });
  }
});

// ── POST /:companyId/transfer/destinations/reorder — Bulk priority update ─────
// ⚠️ MUST be registered BEFORE /:destId
// Body: { order: [{ id, priority }, ...] }
router.post('/:companyId/transfer/destinations/reorder', async (req, res) => {
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

    if (ops.length) await TransferDestination.bulkWrite(ops);
    await _invalidateDestinationsCache(companyId);

    logger.info('[companyTransfer] Reordered destinations', { companyId, updatedCount: ops.length });
    return res.json({ success: true, message: `Reordered ${ops.length} destinations` });
  } catch (err) {
    logger.error('[companyTransfer] reorder error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to reorder destinations' });
  }
});

// ── GET /:companyId/transfer/destinations/stats — Usage stats summary ─────────
// ⚠️ MUST be registered BEFORE /:destId
router.get('/:companyId/transfer/destinations/stats', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const destinations = await TransferDestination
      .find({ companyId })
      .select('name type enabled stats')
      .sort({ 'stats.transferCount': -1 })
      .lean();

    const total = destinations.reduce((acc, d) => acc + (d.stats?.transferCount || 0), 0);
    return res.json({ success: true, destinations, totalTransfers: total });
  } catch (err) {
    logger.error('[companyTransfer] GET stats error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load stats' });
  }
});

// ── GET /:companyId/transfer/destinations/:destId — Single destination ────────
router.get('/:companyId/transfer/destinations/:destId', async (req, res) => {
  const { companyId, destId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const dest = await TransferDestination.findOne({ _id: destId, companyId }).lean();
    if (!dest) return res.status(404).json({ success: false, error: 'Destination not found' });
    return res.json({ success: true, destination: dest });
  } catch (err) {
    logger.error('[companyTransfer] GET single error', { companyId, destId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load destination' });
  }
});

// ── PATCH /:companyId/transfer/destinations/:destId — Partial update ──────────
router.patch('/:companyId/transfer/destinations/:destId', async (req, res) => {
  const { companyId, destId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const body = _sanitiseDestination(req.body || {});
  if (!Object.keys(body).length) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }

  try {
    const dest = await TransferDestination.findOneAndUpdate(
      { _id: destId, companyId },
      { $set: body },
      { new: true, lean: true }
    );
    if (!dest) return res.status(404).json({ success: false, error: 'Destination not found' });

    await _invalidateDestinationsCache(companyId);

    logger.info('[companyTransfer] Updated destination', { companyId, destId, fields: Object.keys(body) });
    return res.json({ success: true, destination: dest });
  } catch (err) {
    logger.error('[companyTransfer] PATCH error', { companyId, destId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update destination' });
  }
});

// ── DELETE /:companyId/transfer/destinations/:destId — Soft-delete ────────────
router.delete('/:companyId/transfer/destinations/:destId', async (req, res) => {
  const { companyId, destId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const dest = await TransferDestination.findOneAndUpdate(
      { _id: destId, companyId },
      { $set: { enabled: false } },
      { new: true, lean: true }
    );
    if (!dest) return res.status(404).json({ success: false, error: 'Destination not found' });

    await _invalidateDestinationsCache(companyId);

    logger.info('[companyTransfer] Soft-deleted destination', { companyId, destId, name: dest.name });
    return res.json({ success: true, message: 'Destination disabled', destination: dest });
  } catch (err) {
    logger.error('[companyTransfer] DELETE error', { companyId, destId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to disable destination' });
  }
});

// ── DELETE /:companyId/transfer/destinations/:destId/hard — Hard delete ───────
router.delete('/:companyId/transfer/destinations/:destId/hard', async (req, res) => {
  const { companyId, destId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const result = await TransferDestination.deleteOne({ _id: destId, companyId });
    if (!result.deletedCount) return res.status(404).json({ success: false, error: 'Destination not found' });

    await _invalidateDestinationsCache(companyId);

    logger.info('[companyTransfer] Hard-deleted destination', { companyId, destId });
    return res.json({ success: true, message: 'Destination permanently deleted' });
  } catch (err) {
    logger.error('[companyTransfer] hard DELETE error', { companyId, destId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to delete destination' });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// POLICY ROUTES
// All use literal segment /policy — no :destId conflict possible.
// ════════════════════════════════════════════════════════════════════════════

// ── GET /:companyId/transfer/policy — Get or create policy ────────────────────
router.get('/:companyId/transfer/policy', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    // Try Redis cache
    let cached;
    try {
      const redis = await getSharedRedisClient();
      if (redis) {
        const raw = await redis.get(`transfer-policy:${companyId}`);
        if (raw) cached = JSON.parse(raw);
      }
    } catch (_) { /* graceful degrade */ }

    if (cached) {
      return res.json({ success: true, policy: cached, source: 'cache' });
    }

    const policy = await TransferPolicy.getForCompany(companyId);

    // Write to cache
    try {
      const redis = await getSharedRedisClient();
      if (redis) await redis.setEx(
        `transfer-policy:${companyId}`,
        POLICY_CACHE_TTL,
        JSON.stringify(policy)
      );
    } catch (_) { /* graceful degrade */ }

    return res.json({ success: true, policy, source: 'db', defaults: TransferPolicy.BUILT_IN_DEFAULTS });
  } catch (err) {
    logger.error('[companyTransfer] GET policy error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load transfer policy' });
  }
});

// ── PATCH /:companyId/transfer/policy — Update policy ────────────────────────
router.patch('/:companyId/transfer/policy', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const body = _sanitisePolicy(req.body || {});
  if (!Object.keys(body).length) {
    return res.status(400).json({ success: false, error: 'No valid fields to update' });
  }

  try {
    // Build a flat $set object to support deep nested field updates
    // (e.g. "schedule.weekly.mon.enabled" without clobbering sibling fields)
    const setOps = {};
    for (const [key, val] of Object.entries(body)) {
      setOps[key] = val;
    }

    const policy = await TransferPolicy.findOneAndUpdate(
      { companyId },
      { $set: setOps },
      { upsert: true, new: true, lean: true, setDefaultsOnInsert: true }
    );

    await _invalidatePolicyCache(companyId);

    logger.info('[companyTransfer] Updated policy', { companyId, fields: Object.keys(body) });
    return res.json({ success: true, policy });
  } catch (err) {
    logger.error('[companyTransfer] PATCH policy error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update transfer policy' });
  }
});

// ── POST /:companyId/transfer/policy/emergency — Toggle emergency override ────
// Body: { active: boolean, message?: string, forwardTo?: string }
router.post('/:companyId/transfer/policy/emergency', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { active, message, forwardTo } = req.body || {};
  if (typeof active !== 'boolean') {
    return res.status(400).json({ success: false, error: 'active (boolean) is required' });
  }

  try {
    const setFields = {
      'emergencyOverride.active':      active,
      'emergencyOverride.activatedAt': active ? new Date() : null,
      'emergencyOverride.activatedBy': req.user?.email || req.user?.id || 'unknown'
    };
    if (message)   setFields['emergencyOverride.message']   = message.trim();
    if (forwardTo) setFields['emergencyOverride.forwardTo'] = forwardTo.trim();

    const policy = await TransferPolicy.findOneAndUpdate(
      { companyId },
      { $set: setFields },
      { upsert: true, new: true, lean: true, setDefaultsOnInsert: true }
    );

    await _invalidatePolicyCache(companyId);

    logger.warn('[companyTransfer] Emergency override toggled', {
      companyId,
      active,
      activatedBy: setFields['emergencyOverride.activatedBy']
    });

    return res.json({
      success: true,
      active,
      message: active ? '🚨 Emergency override ACTIVATED — all calls will receive emergency message' : '✅ Emergency override deactivated',
      policy:  policy.emergencyOverride
    });
  } catch (err) {
    logger.error('[companyTransfer] emergency toggle error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to toggle emergency override' });
  }
});

// ── POST /:companyId/transfer/policy/vip — Add / remove VIP number ────────────
// Body: { action: 'add' | 'remove', phoneNumber: string }
router.post('/:companyId/transfer/policy/vip', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { action, phoneNumber } = req.body || {};
  if (!action || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ success: false, error: 'action must be "add" or "remove"' });
  }
  const num = (phoneNumber || '').replace(/\s/g, '').trim();
  if (!num) {
    return res.status(400).json({ success: false, error: 'phoneNumber is required' });
  }

  try {
    const op = action === 'add'
      ? { $addToSet: { 'callerScreening.vipList':  num } }
      : { $pull:     { 'callerScreening.vipList':  num } };

    const policy = await TransferPolicy.findOneAndUpdate(
      { companyId },
      op,
      { upsert: true, new: true, lean: true, setDefaultsOnInsert: true }
    );

    await _invalidatePolicyCache(companyId);

    logger.info('[companyTransfer] VIP list updated', { companyId, action, phoneNumber: num });
    return res.json({ success: true, vipList: policy.callerScreening?.vipList || [] });
  } catch (err) {
    logger.error('[companyTransfer] VIP update error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update VIP list' });
  }
});

// ── POST /:companyId/transfer/policy/blocklist — Add / remove blocked number ──
// Body: { action: 'add' | 'remove', phoneNumber: string }
router.post('/:companyId/transfer/policy/blocklist', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const { action, phoneNumber } = req.body || {};
  if (!action || !['add', 'remove'].includes(action)) {
    return res.status(400).json({ success: false, error: 'action must be "add" or "remove"' });
  }
  const num = (phoneNumber || '').replace(/\s/g, '').trim();
  if (!num) {
    return res.status(400).json({ success: false, error: 'phoneNumber is required' });
  }

  try {
    const op = action === 'add'
      ? { $addToSet: { 'callerScreening.blocklist': num } }
      : { $pull:     { 'callerScreening.blocklist': num } };

    const policy = await TransferPolicy.findOneAndUpdate(
      { companyId },
      op,
      { upsert: true, new: true, lean: true, setDefaultsOnInsert: true }
    );

    await _invalidatePolicyCache(companyId);

    logger.info('[companyTransfer] Blocklist updated', { companyId, action, phoneNumber: num });
    return res.json({ success: true, blocklist: policy.callerScreening?.blocklist || [] });
  } catch (err) {
    logger.error('[companyTransfer] blocklist update error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update blocklist' });
  }
});

module.exports = router;
