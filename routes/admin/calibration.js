'use strict';

/**
 * ============================================================================
 * CALIBRATION — UAP Intelligence Calibration Dashboard API
 * ============================================================================
 *
 * Aggregates qaLog[] entries from Customer.discoveryNotes[] to compute
 * Layer 1 (KC match) vs Layer 2 (LLM Agent fallback) vs UNKNOWN (no match)
 * hit rates for the UAP Intelligence Calibration tab.
 *
 * MOUNT: /api/admin/calibration/company
 *
 * ENDPOINTS:
 *   GET /:companyId/stats — aggregated qaLog stats + recent calls
 *
 * DATA SOURCE:
 *   Customer.discoveryNotes[].qaLog[] — written by KCDiscoveryRunner.js
 *   Entry types:
 *     - { type: 'UAP_LAYER1', hit: true/false, ... }  — Diagnostic only (SKIPPED)
 *     - { question, answer, ... } (no type field)      — KC direct answer (Layer 1)
 *     - { type: 'KC_LLM_FALLBACK', ... }               — LLM Agent fallback (Layer 2)
 *     - { type: 'KC_GRACEFUL_ACK', ... }                — No match (Unknown)
 *
 * ============================================================================
 */

const express             = require('express');
const router              = express.Router();
const logger              = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const Customer            = require('../../models/Customer');

// ── All routes require a valid JWT ───────────────────────────────────────────
router.use(authenticateJWT);

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

// ══════════════════════════════════════════════════════════════════════════════
// GET /:companyId/stats
// ══════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/stats', async (req, res) => {
  const { companyId } = req.params;
  if (!_validateCompanyAccess(req, res, companyId)) return;

  try {
    // ── Aggregation: unwind discoveryNotes → unwind qaLog → classify entries ──
    const pipeline = [
      { $match: { companyId } },
      { $unwind: { path: '$discoveryNotes', preserveNullAndEmptyArrays: false } },
      { $unwind: { path: '$discoveryNotes.qaLog', preserveNullAndEmptyArrays: false } },
      {
        $addFields: {
          _qaEntry: '$discoveryNotes.qaLog',
          _callSid: '$discoveryNotes.callSid',
          _capturedAt: '$discoveryNotes.capturedAt',
          _turnCount: '$discoveryNotes.turnCount',
        },
      },
      // Classify each qaLog entry into a layer
      {
        $addFields: {
          _layer: {
            $switch: {
              branches: [
                // UAP_LAYER1 with fuzzyRecovery flag → track separately
                {
                  case: {
                    $and: [
                      { $eq: ['$_qaEntry.type', 'UAP_LAYER1'] },
                      { $eq: ['$_qaEntry.fuzzyRecovery', true] },
                    ]
                  },
                  then: 'fuzzyRecovery'
                },
                // UAP_LAYER1 → SKIP (diagnostic only — the actual outcome is
                // recorded as a separate entry: {question,answer} for KC match,
                // KC_LLM_FALLBACK for Layer 2, or KC_GRACEFUL_ACK for unknown)
                { case: { $eq: ['$_qaEntry.type', 'UAP_LAYER1'] }, then: 'SKIP' },
                // KC_LLM_FALLBACK → Layer 2
                { case: { $eq: ['$_qaEntry.type', 'KC_LLM_FALLBACK'] }, then: 'layer2' },
                // KC_GRACEFUL_ACK → Unknown
                { case: { $eq: ['$_qaEntry.type', 'KC_GRACEFUL_ACK'] }, then: 'unknown' },
              ],
              // No type field + has question → standard KC answer → Layer 1
              default: {
                $cond: [{ $ifNull: ['$_qaEntry.question', false] }, 'layer1', 'SKIP']
              },
            },
          },
        },
      },
      // Filter out SKIP entries
      { $match: { _layer: { $ne: 'SKIP' } } },
    ];

    // ── Facet: summary stats + recent calls + matchType breakdown ──────────
    pipeline.push({
      $facet: {
        // Aggregate counts by layer
        summary: [
          {
            $group: {
              _id: '$_layer',
              count: { $sum: 1 },
            },
          },
        ],
        // Distinct call count
        calls: [
          {
            $group: {
              _id: '$_callSid',
              capturedAt: { $first: '$_capturedAt' },
              turnCount:  { $first: '$_turnCount' },
              layer1:     { $sum: { $cond: [{ $eq: ['$_layer', 'layer1'] }, 1, 0] } },
              layer2:     { $sum: { $cond: [{ $eq: ['$_layer', 'layer2'] }, 1, 0] } },
              unknown:    { $sum: { $cond: [{ $eq: ['$_layer', 'unknown'] }, 1, 0] } },
              fuzzy:      { $sum: { $cond: [{ $eq: ['$_layer', 'fuzzyRecovery'] }, 1, 0] } },
            },
          },
          { $sort: { capturedAt: -1 } },
          { $limit: 20 },
        ],
        // Match type distribution across all non-SKIP entries that have matchType
        matchTypeBreakdown: [
          { $match: { '_qaEntry.matchType': { $exists: true, $ne: null } } },
          { $group: { _id: '$_qaEntry.matchType', count: { $sum: 1 } } },
        ],
      },
    });

    const [result] = await Customer.aggregate(pipeline);

    // ── Compute summary ──────────────────────────────────────────────────────
    const summaryMap = {};
    for (const row of (result?.summary || [])) {
      summaryMap[row._id] = row.count;
    }
    const layer1Count        = summaryMap.layer1        || 0;
    const layer2Count        = summaryMap.layer2        || 0;
    const unknownCount       = summaryMap.unknown       || 0;
    const fuzzyRecoveryCount = summaryMap.fuzzyRecovery || 0;
    const totalEntries = layer1Count + layer2Count + unknownCount + fuzzyRecoveryCount;

    const pct = (n) => totalEntries > 0 ? Math.round((n / totalEntries) * 100) : 0;

    // ── Format recent calls ──────────────────────────────────────────────────
    const recentCalls = (result?.calls || []).map(c => ({
      callSid:    c._id,
      capturedAt: c.capturedAt,
      turnCount:  c.turnCount || 0,
      layer1:     c.layer1,
      layer2:     c.layer2,
      unknown:    c.unknown,
      fuzzy:      c.fuzzy,
    }));

    // ── Format match type breakdown ────────────────────────────────────────
    const matchTypeBreakdown = (result?.matchTypeBreakdown || []).map(r => ({
      matchType: r._id || 'UNKNOWN',
      count:     r.count,
    }));

    return res.json({
      success: true,
      stats: {
        totalEntries,
        layer1:         { count: layer1Count,        pct: pct(layer1Count) },
        layer2:         { count: layer2Count,        pct: pct(layer2Count) },
        unknown:        { count: unknownCount,       pct: pct(unknownCount) },
        fuzzyRecovery:  { count: fuzzyRecoveryCount, pct: pct(fuzzyRecoveryCount) },
        matchTypeBreakdown,
        callCount:   recentCalls.length,
        targetCalls: 500,
        recentCalls,
      },
    });
  } catch (err) {
    logger.error('[CALIBRATION] Stats aggregation failed', {
      companyId, error: err.message, stack: err.stack?.slice(0, 300),
    });
    return res.status(500).json({ success: false, error: 'Failed to load calibration stats' });
  }
});

module.exports = router;
