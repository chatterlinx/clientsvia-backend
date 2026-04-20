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
const KCGapResolution     = require('../../models/KCGapResolution');

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
  // Turn 1: KC_LLM_FALLBACK and KC_GRACEFUL_ACK on turn 1 are expected
  // (Turn1Engine preamble stripping means some residual noise is normal).
  // BUT KC_SECTION_GAP on turn 1 IS a real failure — container matched yet
  // no section could handle the caller's utterance.  Always show SECTION_GAPs.
  // ?turn1=1 shows ALL turn 1 events including fallback/ack.
  const includeTurn1 = req.query.turn1 === '1';

  const cutoff = new Date(Date.now() - RANGE_MS[range]).toISOString();

  try {
    // Build turn filter: always show KC_SECTION_GAP on turn 1; hide
    // fallback/ack on turn 1 unless ?turn1=1.
    const turnFilter = includeTurn1
      ? {}      // show everything
      : {
          $or: [
            { 'discoveryNotes.qaLog.turn': { $gt: 1 } },
            { 'discoveryNotes.qaLog.type': 'KC_SECTION_GAP' },
          ],
        };

    const pipeline = [
      { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
      { $unwind: { path: '$discoveryNotes', preserveNullAndEmptyArrays: false } },
      { $unwind: { path: '$discoveryNotes.qaLog', preserveNullAndEmptyArrays: false } },
      // Only gap-type entries within the time range
      {
        $match: {
          'discoveryNotes.qaLog.type':      { $in: typeFilter },
          'discoveryNotes.qaLog.timestamp': { $gte: cutoff },
          ...turnFilter,
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
          containerTitle:   '$discoveryNotes.qaLog.containerTitle',
          containerId:      '$discoveryNotes.qaLog.containerId',
          kcId:             '$discoveryNotes.qaLog.kcId',
          gapFiltered:      '$discoveryNotes.qaLog.gapFiltered',
          gapOriginalCount: '$discoveryNotes.qaLog.gapOriginalCount',
          gapFilteredCount: '$discoveryNotes.qaLog.gapFilteredCount',
          gapTopSections:   '$discoveryNotes.qaLog.gapTopSections',
          timestamp:        '$discoveryNotes.qaLog.timestamp',
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

    // Post-aggregation enrichment: stamp gapKey + normalizedPhrase on each
    // entry so the client can group duplicates without re-normalizing.
    // Same hash as KCGapResolution → O(1) join with /gaps/resolutions response.
    const entries = (result.entries || []).map(g => {
      const normalizedPhrase = KCGapResolution.normalizePhrase(g.question || '');
      const gapKey           = normalizedPhrase
        ? KCGapResolution.buildGapKey(companyId, g.question || '')
        : null;
      return { ...g, normalizedPhrase, gapKey };
    });

    return res.json({
      success: true,
      gaps:    entries,
      summary: { total, byType, range },
    });
  } catch (err) {
    logger.error('[kcGaps] Aggregation error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
