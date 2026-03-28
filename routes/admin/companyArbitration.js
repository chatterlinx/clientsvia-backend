'use strict';

/**
 * ============================================================================
 * COMPANY ARBITRATION — Admin API Routes
 * ============================================================================
 *
 * Arbitration policy CRUD and turn trace query endpoints for the Intent
 * Arbitration Engine. Provides full per-company control over how competing
 * intent signals are weighted, disambiguated, and routed.
 *
 * ISOLATION RULES:
 *   - Every route is scoped by companyId (path parameter)
 *   - MongoDB queries always include { companyId } filter
 *   - Trace callId ownership is verified before returning trace data
 *   - No cross-tenant data is accessible — enforced by _validateCompanyAccess()
 *
 * ROUTE REGISTRATION ORDER:
 *   /trace/:callId and /trace MUST be registered BEFORE any :id param routes.
 *   /lanes/active is a literal segment — registered to avoid :id collisions.
 *   ⚠️ markers indicate order-sensitive routes.
 *
 * ENDPOINTS:
 *   GET    /:companyId/arbitration/policy           — Get policy (defaults if not set)
 *   PATCH  /:companyId/arbitration/policy           — Update policy (partial upsert)
 *   DELETE /:companyId/arbitration/policy           — Reset to platform defaults
 *   ⚠️ GET /:companyId/arbitration/trace/:callId    — Full turn trace for a call
 *   ⚠️ GET /:companyId/arbitration/trace            — Recent traces (?limit=N)
 *   ⚠️ GET /:companyId/arbitration/lanes/active     — Currently locked lanes (Redis scan)
 *
 * ============================================================================
 */

const express                    = require('express');
const router                     = express.Router();
const logger                     = require('../../utils/logger');
const { authenticateJWT }        = require('../../middleware/auth');
const CompanyArbitrationPolicy   = require('../../models/CompanyArbitrationPolicy');
const CallTurnTrace              = require('../../models/CallTurnTrace');
const TurnTracer                 = require('../../services/engine/arbitration/TurnTracer');
const { getSharedRedisClient }   = require('../../services/redisClientFactory');

// ── All routes require a valid JWT ───────────────────────────────────────────
router.use(authenticateJWT);

// ── Policy field allowlist ────────────────────────────────────────────────────

/**
 * ALLOWED_POLICY_FIELDS — Whitelist for PATCH /policy.
 * Only these top-level fields may be updated. Any other key in req.body is
 * silently dropped by _sanitisePolicyBody(). This prevents writes to companyId,
 * _id, timestamps, or other internal fields.
 */
const ALLOWED_POLICY_FIELDS = [
  'laneStickyEnabled',
  'laneTimeoutMs',
  'escapeKeywords',
  'weights',
  'bookingBeatsAll',
  'queueSecondaryIntent',
  'autoRouteMinScore',
  'minScoreGap',
  'disambiguateFloor',
  'maxDisambiguateAttempts'
];

/** Default trace query limit. Hard-capped at 200 to prevent runaway queries. */
const MAX_TRACE_LIMIT = 200;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * _validateCompanyAccess — Verify that the requesting user may access companyId.
 * Admin roles bypass the per-company check. Returns false and sends the error
 * response itself so the route handler just needs `if (!validate) return;`.
 *
 * @param {Object} req
 * @param {Object} res
 * @param {string} companyId
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
 * _sanitisePolicyBody — Extract and type-check only allowed policy fields.
 * Weights sub-object is merged field-by-field to prevent accidental full
 * replacement of the weights map.
 *
 * @param {Object} body — req.body
 * @returns {Object} Sanitised $set payload (dot-notation for nested weights)
 */
function _sanitisePolicyBody(body) {
  const updates = {};

  for (const field of ALLOWED_POLICY_FIELDS) {
    if (!(field in body)) continue;

    if (field === 'weights') {
      // Merge weights individually using dot-notation $set keys so we do not
      // wipe unspecified weight fields with a full object replacement.
      const weightKeys = ['booking', 'transfer', 'pricing', 'promo', 'customRule', 'kc'];
      for (const wk of weightKeys) {
        if (wk in body.weights) {
          const val = parseFloat(body.weights[wk]);
          if (!isNaN(val)) updates[`weights.${wk}`] = Math.min(1, Math.max(0, val));
        }
      }
      continue;
    }

    if (field === 'escapeKeywords') {
      // Normalise: trim, lowercase, deduplicate
      if (Array.isArray(body.escapeKeywords)) {
        updates.escapeKeywords = [
          ...new Set(
            body.escapeKeywords
              .map(k => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
              .filter(Boolean)
          )
        ];
      }
      continue;
    }

    // Numeric fields — parse and validate range
    const numericFields = ['laneTimeoutMs', 'autoRouteMinScore', 'minScoreGap', 'disambiguateFloor', 'maxDisambiguateAttempts'];
    if (numericFields.includes(field)) {
      const val = parseFloat(body[field]);
      if (!isNaN(val) && val >= 0) updates[field] = val;
      continue;
    }

    // Boolean fields
    const boolFields = ['laneStickyEnabled', 'bookingBeatsAll', 'queueSecondaryIntent'];
    if (boolFields.includes(field)) {
      updates[field] = Boolean(body[field]);
      continue;
    }

    updates[field] = body[field];
  }

  return updates;
}

// ── GET /:companyId/arbitration/policy — Get policy ──────────────────────────
// Returns the company's arbitration policy. If no doc exists yet, one is
// created with platform defaults via CompanyArbitrationPolicy.getForCompany()
// (upsert, setDefaultsOnInsert). Response always contains a complete policy.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/arbitration/policy', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    const policy = await CompanyArbitrationPolicy.getForCompany(companyId);
    return res.json({ success: true, policy });
  } catch (err) {
    logger.error('[companyArbitration] GET policy error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load arbitration policy' });
  }
});

// ── PATCH /:companyId/arbitration/policy — Update policy (partial upsert) ─────
// Only ALLOWED_POLICY_FIELDS are accepted. weights are merged field-by-field.
// Upserts on companyId — safe to call before a GET has been made.
// ─────────────────────────────────────────────────────────────────────────────
router.patch('/:companyId/arbitration/policy', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const updates = _sanitisePolicyBody(req.body || {});
  if (!Object.keys(updates).length) {
    return res.status(400).json({ success: false, error: 'No valid policy fields provided' });
  }

  try {
    const policy = await CompanyArbitrationPolicy.findOneAndUpdate(
      { companyId },
      { $set: updates },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, lean: true }
    );

    logger.info('[companyArbitration] Policy updated', {
      companyId,
      fields: Object.keys(updates)
    });

    return res.json({ success: true, policy });
  } catch (err) {
    logger.error('[companyArbitration] PATCH policy error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to update arbitration policy' });
  }
});

// ── DELETE /:companyId/arbitration/policy — Reset to platform defaults ─────────
// Deletes the company's policy document. The next GET (or runtime read) will
// upsert a fresh document with BUILT_IN_DEFAULTS via getForCompany().
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:companyId/arbitration/policy', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    await CompanyArbitrationPolicy.deleteOne({ companyId });

    logger.info('[companyArbitration] Policy reset to defaults', { companyId });

    // Return the effective defaults so the UI can reflect the new state immediately
    const defaults = CompanyArbitrationPolicy.getDefaults();
    return res.json({
      success:  true,
      message:  'Policy reset to platform defaults',
      defaults
    });
  } catch (err) {
    logger.error('[companyArbitration] DELETE policy error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to reset arbitration policy' });
  }
});

// ── GET /:companyId/arbitration/trace/:callId — Full trace for a call ──────────
// ⚠️ MUST be registered BEFORE /trace (no :callId param) — specificity rule.
//
// Returns all turns for a call in ascending turn order.
// Ownership check: verifies the first trace record belongs to this companyId.
// Hot path: TurnTracer.getForCall() tries Redis first, then MongoDB.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/arbitration/trace/:callId', async (req, res) => {
  const { companyId, callId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  if (!callId) {
    return res.status(400).json({ success: false, error: 'callId is required' });
  }

  try {
    const turns = await TurnTracer.getForCall(callId);

    if (!turns.length) {
      return res.status(404).json({ success: false, error: 'No trace found for this call' });
    }

    // ── Ownership check ────────────────────────────────────────────────────
    // Verify the callId belongs to this companyId by inspecting the first turn.
    // This prevents tenant A from reading tenant B's traces by guessing callIds.
    const firstTurn = turns[0];
    if (firstTurn.companyId && firstTurn.companyId !== companyId) {
      logger.warn('[companyArbitration] Cross-tenant trace access attempt blocked', {
        requestingCompanyId: companyId,
        traceCompanyId:      firstTurn.companyId,
        callId
      });
      return res.status(403).json({ success: false, error: 'Access denied to this call trace' });
    }

    return res.json({
      success:    true,
      callId,
      companyId,
      turnCount:  turns.length,
      turns
    });
  } catch (err) {
    logger.error('[companyArbitration] GET trace/:callId error', {
      companyId,
      callId,
      error: err.message
    });
    return res.status(500).json({ success: false, error: 'Failed to load call trace' });
  }
});

// ── GET /:companyId/arbitration/trace — Recent traces ────────────────────────
// ⚠️ MUST be registered BEFORE any /:id param route.
// Query: ?limit=N (default 20, max 200)
// Returns recent turn traces across all calls for this company, newest first.
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/arbitration/trace', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const rawLimit = parseInt(req.query.limit, 10);
  const limit    = isNaN(rawLimit) ? 20 : Math.min(Math.max(1, rawLimit), MAX_TRACE_LIMIT);

  try {
    const traces = await TurnTracer.getRecentForCompany(companyId, limit);

    return res.json({
      success:    true,
      companyId,
      limit,
      total:      traces.length,
      traces
    });
  } catch (err) {
    logger.error('[companyArbitration] GET trace error', { companyId, error: err.message });
    return res.status(500).json({ success: false, error: 'Failed to load recent traces' });
  }
});

// ── GET /:companyId/arbitration/lanes/active — Currently locked lanes ──────────
// ⚠️ MUST be registered BEFORE any /:id param route.
//
// Best-effort scan of Redis for `lane:CA*` keys that belong to this company's
// active calls. Because Redis SCAN matches on key pattern only (not call
// ownership), we cross-reference against recent CallTurnTrace records to filter
// to this company's calls.
//
// Returns a list of { callId, lane } pairs currently locked in Redis.
// If Redis is unavailable, returns an empty list (graceful degrade).
// ─────────────────────────────────────────────────────────────────────────────
router.get('/:companyId/arbitration/lanes/active', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    // ── Identify recent callIds for this company ───────────────────────────
    // Query recent CallTurnTrace documents to get the set of callIds that
    // belong to this company. This is our ownership filter for the Redis scan.
    const recentTraces = await CallTurnTrace
      .find({ companyId })
      .sort({ createdAt: -1 })
      .limit(100)
      .select('callId')
      .lean();

    const companyCallIds = new Set(recentTraces.map(t => t.callId).filter(Boolean));

    if (!companyCallIds.size) {
      return res.json({ success: true, activeLanes: [], total: 0 });
    }

    // ── Scan Redis for lane:CA* keys ──────────────────────────────────────
    const redis = await getSharedRedisClient();
    if (!redis) {
      return res.json({ success: true, activeLanes: [], total: 0, note: 'Redis unavailable' });
    }

    // SCAN with MATCH pattern — non-blocking, returns cursor + keys
    // We scan for lane:CA* (Twilio CallSids all start with CA)
    const activeLanes = [];
    let   cursor      = 0;
    const scanPattern = 'lane:CA*';
    const scanCount   = 100;  // keys per SCAN batch

    do {
      const [nextCursor, keys] = await redis.scan(cursor, {
        MATCH: scanPattern,
        COUNT: scanCount
      });
      cursor = parseInt(nextCursor, 10);

      for (const key of keys) {
        // key format: lane:{callId}
        const callId = key.slice('lane:'.length);

        // Only include if this callId belongs to our company
        if (!companyCallIds.has(callId)) continue;

        try {
          const lane = await redis.get(key);
          if (lane) {
            activeLanes.push({ callId, lane });
          }
        } catch (_e) {
          // Individual key read failure — skip and continue
        }
      }
    } while (cursor !== 0);

    return res.json({
      success:     true,
      companyId,
      activeLanes,
      total:       activeLanes.length
    });

  } catch (err) {
    logger.error('[companyArbitration] GET lanes/active error', {
      companyId,
      error: err.message
    });
    // Graceful degrade — lanes view is informational, not blocking
    return res.json({
      success:     true,
      activeLanes: [],
      total:       0,
      note:        'Lane scan unavailable'
    });
  }
});

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = router;
