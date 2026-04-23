'use strict';

/**
 * ============================================================================
 * KC HEALTH — Config Health API
 * ============================================================================
 *
 * Structural audit of a company's KC configuration. Complement to kcGaps
 * (runtime call failures). This endpoint reports on misconfigured containers
 * and sections — meta-containers with noAnchor unset, missing phrase cores,
 * etc.
 *
 * MOUNT: /api/admin/agent2/company
 *
 * ENDPOINTS:
 *   GET  /:companyId/knowledge/health          — cached report (5 min TTL)
 *   POST /:companyId/knowledge/health/rescan   — bust cache + re-run
 *
 * CACHING:
 *   In-memory Map keyed by companyId, TTL 5 min. Safe for a multi-tenant
 *   admin tool where inspection is bursty (admin loads page → multiple tabs).
 *
 * ============================================================================
 */

const express               = require('express');
const router                = express.Router();
const logger                = require('../../utils/logger');
const { authenticateJWT }   = require('../../middleware/auth');
const KCHealthCheckService  = require('../../services/kc/KCHealthCheckService');

router.use(authenticateJWT);

// ── Access control (same pattern as kcGaps.js) ───────────────────────────────
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

// ── In-memory cache (5 min TTL, keyed by companyId) ──────────────────────────
const CACHE_TTL_MS = 5 * 60 * 1000;
const _cache = new Map(); // companyId → { at: Date, report: object }

function _cacheGet(companyId) {
  const hit = _cache.get(String(companyId));
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    _cache.delete(String(companyId));
    return null;
  }
  return hit.report;
}

function _cacheSet(companyId, report) {
  _cache.set(String(companyId), { at: Date.now(), report });
}

function _cacheBust(companyId) {
  _cache.delete(String(companyId));
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /:companyId/knowledge/health
// ══════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/knowledge/health', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    // Cache check
    const cached = _cacheGet(companyId);
    if (cached) {
      return res.json({ ...cached, cached: true });
    }

    // Run fresh audit — companyId on CompanyKnowledgeContainer is STRING, not ObjectId
    const report = await KCHealthCheckService.runHealthCheck(companyId);
    _cacheSet(companyId, report);

    return res.json({ ...report, cached: false });
  } catch (err) {
    logger.error('[kcHealth] runHealthCheck failed', { companyId, err: err.message, stack: err.stack });
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /:companyId/knowledge/health/rescan
// ══════════════════════════════════════════════════════════════════════════════

router.post('/:companyId/knowledge/health/rescan', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    _cacheBust(companyId);
    const report = await KCHealthCheckService.runHealthCheck(companyId);
    _cacheSet(companyId, report);

    return res.json({ ...report, cached: false });
  } catch (err) {
    logger.error('[kcHealth] rescan failed', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
