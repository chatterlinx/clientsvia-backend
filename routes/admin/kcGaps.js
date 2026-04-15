'use strict';

/**
 * ============================================================================
 * KC GAPS — Call Gap Audit API
 * ============================================================================
 *
 * Surfaces every KC pipeline failure event from live calls so the admin can
 * see what the caller asked, what the agent responded, and which container
 * matched (or didn't). The admin then investigates in Phrase Finder and
 * manually builds the missing KC content.
 *
 * MOUNT: /api/admin/agent2/company
 *
 * ENDPOINTS:
 *   GET /:companyId/knowledge/gaps — gap events from qaLog
 *
 * DATA SOURCE:
 *   Customer.discoveryNotes[].qaLog[] — written by KCDiscoveryRunner.js
 *   Entry types surfaced:
 *     - KC_SECTION_GAP  — container matched but no section covered the utterance
 *     - KC_LLM_FALLBACK — no KC match, routed to Claude LLM
 *     - KC_GRACEFUL_ACK — all AI paths exhausted, canned response
 *
 * ============================================================================
 */

const express             = require('express');
const router              = express.Router();
const mongoose            = require('mongoose');
const logger              = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const Customer            = require('../../models/Customer');

// ── All routes require a valid JWT ───────────────────────────────────────────
router.use(authenticateJWT);

// ── Access control (same pattern as calibration.js) ──────────────────────────
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

// ── Range helpers ────────────────────────────────────────────────────────────
const RANGE_MS = { '24h': 86400000, '7d': 604800000, '30d': 2592000000 };
const GAP_TYPES = ['KC_SECTION_GAP', 'KC_LLM_FALLBACK', 'KC_GRACEFUL_ACK'];

// ══════════════════════════════════════════════════════════════════════════════
// GET /:companyId/knowledge/gaps
// ══════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/knowledge/gaps', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  const range      = RANGE_MS[req.query.range] ? req.query.range : '7d';
  const typeParam  = req.query.type || 'all';
  const typeFilter = typeParam !== 'all' && GAP_TYPES.includes(typeParam)
    ? [typeParam]
    : GAP_TYPES;

  const cutoff = new Date(Date.now() - RANGE_MS[range]).toISOString();

  try {
    const pipeline = [
      { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
      { $unwind: { path: '$discoveryNotes', preserveNullAndEmptyArrays: false } },
      { $unwind: { path: '$discoveryNotes.qaLog', preserveNullAndEmptyArrays: false } },
      // Only gap-type entries within the time range
      {
        $match: {
          'discoveryNotes.qaLog.type':      { $in: typeFilter },
          'discoveryNotes.qaLog.timestamp': { $gte: cutoff },
        },
      },
      // Project flat fields
      {
        $project: {
          _id:            0,
          callSid:        '$discoveryNotes.callSid',
          callReason:     '$discoveryNotes.callReason',
          type:           '$discoveryNotes.qaLog.type',
          turn:           '$discoveryNotes.qaLog.turn',
          question:       '$discoveryNotes.qaLog.question',
          answer:         '$discoveryNotes.qaLog.answer',
          containerTitle: '$discoveryNotes.qaLog.containerTitle',
          containerId:    '$discoveryNotes.qaLog.containerId',
          kcId:           '$discoveryNotes.qaLog.kcId',
          timestamp:      '$discoveryNotes.qaLog.timestamp',
        },
      },
      // Facet: paginated entries + summary counts
      {
        $facet: {
          entries: [
            { $sort: { timestamp: -1 } },
            { $limit: 500 },
          ],
          byType: [
            { $group: { _id: '$type', count: { $sum: 1 } } },
          ],
          totalCount: [
            { $count: 'total' },
          ],
        },
      },
    ];

    const [result] = await Customer.aggregate(pipeline);

    // Build summary from facet results
    const byType = {};
    for (const t of (result.byType || [])) {
      byType[t._id] = t.count;
    }
    const total = result.totalCount?.[0]?.total || 0;

    return res.json({
      success: true,
      gaps:    result.entries || [],
      summary: { total, byType, range },
    });
  } catch (err) {
    logger.error('[kcGaps] Aggregation error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
