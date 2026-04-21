'use strict';

/**
 * ============================================================================
 * KC GAPS — Call Gap Audit API
 * ============================================================================
 *
 * Surfaces every KC pipeline event from live calls so the admin can see:
 *   - Which UAP hits worked (what's covered)
 *   - Which UAP misses had to be rescued by keyword scoring (what needs phrases)
 *   - Which utterances fell all the way through to Groq (what needs sections)
 *   - Near-miss rescues and negative-keyword blocks
 *
 * Each Groq fallback costs money + caller wait time — the Gap page is the
 * feedback loop that closes the KC corpus over time.
 *
 * MOUNT: /api/admin/agent2/company
 *
 * ENDPOINTS:
 *   GET /:companyId/knowledge/gaps — gap + health events from qaLog
 *
 * DATA SOURCE:
 *   Customer.discoveryNotes[].qaLog[] — written by KCDiscoveryRunner.js
 *
 * EVENT TYPES SURFACED:
 *   UAP_LAYER1               — Phrase index hit (GATE 2.5 win). Used for hit-rate.
 *   UAP_MISS_KEYWORD_RESCUED — GATES 2.4/2.5/2.8 missed, GATE 3 keyword saved it.
 *                              The single most actionable gap signal — each row
 *                              = a phrase that should be added to UAP.
 *   NEGATIVE_KEYWORD_BLOCK   — Negative keyword suppressed a match (tune neg kws).
 *   KC_SECTION_GAP_RESCUED   — Cross-container rescue swapped the winning container.
 *   KC_SECTION_GAP           — Container matched but no section covered utterance.
 *   KC_LLM_FALLBACK          — Full UAP miss, Groq answered from KB context.
 *   KC_GRACEFUL_ACK          — All paths exhausted, canned safety response.
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

// All qaLog types the Gap page surfaces (Phase 1 expansion — April 2026).
// Phase A.2 — adds UAP_SEMANTIC_MISS + KC_SECTION_GAP_ANSWERED so the admin
// can see "GATE 2.8 came close" + "Claude saved a section-gap call" events
// alongside the rest of the pipeline.
const GAP_TYPES = [
  'KC_SECTION_GAP',
  'KC_SECTION_GAP_ANSWERED',
  'KC_LLM_FALLBACK',
  'KC_GRACEFUL_ACK',
  'UAP_MISS_KEYWORD_RESCUED',
  'UAP_LAYER1',
  'UAP_SEMANTIC_MISS',
  'NEGATIVE_KEYWORD_BLOCK',
  'KC_SECTION_GAP_RESCUED',
];

// Types that always appear regardless of turn (they are real signals even on
// turn 1 — Turn1Engine strips preamble before KC, so hits/misses there are real).
const ALWAYS_SHOW_TYPES = [
  'KC_SECTION_GAP',
  'UAP_MISS_KEYWORD_RESCUED',
  'UAP_LAYER1',
  'UAP_SEMANTIC_MISS',
  'NEGATIVE_KEYWORD_BLOCK',
  'KC_SECTION_GAP_RESCUED',
];

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

  // Turn 1 filtering:
  //   KC_LLM_FALLBACK + KC_GRACEFUL_ACK on turn 1 → residual preamble noise, hide by default.
  //   All other types on turn 1 → real signals, always show.
  //   ?turn1=1 → show everything including turn 1 fallback/ack.
  const includeTurn1 = req.query.turn1 === '1';

  const cutoff = new Date(Date.now() - RANGE_MS[range]).toISOString();

  try {
    const turnFilter = includeTurn1
      ? {}
      : {
          $or: [
            { 'discoveryNotes.qaLog.turn': { $gt: 1 } },
            { 'discoveryNotes.qaLog.type': { $in: ALWAYS_SHOW_TYPES } },
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
      // Project flat fields (superset — all event types covered)
      {
        $project: {
          _id:                    0,
          callSid:                '$discoveryNotes.callSid',
          callReason:             '$discoveryNotes.callReason',
          type:                   '$discoveryNotes.qaLog.type',
          turn:                   '$discoveryNotes.qaLog.turn',
          question:               '$discoveryNotes.qaLog.question',
          answer:                 '$discoveryNotes.qaLog.answer',
          timestamp:              '$discoveryNotes.qaLog.timestamp',

          // Shared container fields
          containerTitle:         '$discoveryNotes.qaLog.containerTitle',
          containerId:            '$discoveryNotes.qaLog.containerId',
          kcId:                   '$discoveryNotes.qaLog.kcId',

          // KC_SECTION_GAP fields
          gapFiltered:            '$discoveryNotes.qaLog.gapFiltered',
          gapOriginalCount:       '$discoveryNotes.qaLog.gapOriginalCount',
          gapFilteredCount:       '$discoveryNotes.qaLog.gapFilteredCount',
          gapTopSections:         '$discoveryNotes.qaLog.gapTopSections',

          // UAP_MISS_KEYWORD_RESCUED fields
          rescuedContainerId:     '$discoveryNotes.qaLog.rescuedContainerId',
          rescuedContainerTitle:  '$discoveryNotes.qaLog.rescuedContainerTitle',
          rescuedKcId:            '$discoveryNotes.qaLog.rescuedKcId',
          rescuedSection:         '$discoveryNotes.qaLog.rescuedSection',
          rescuedSectionIdx:      '$discoveryNotes.qaLog.rescuedSectionIdx',
          rescuedScore:           '$discoveryNotes.qaLog.rescuedScore',
          anchorContainerId:      '$discoveryNotes.qaLog.anchorContainerId',
          cueFrame:               '$discoveryNotes.qaLog.cueFrame',

          // UAP_LAYER1 fields
          hit:                    '$discoveryNotes.qaLog.hit',
          confidence:             '$discoveryNotes.qaLog.confidence',
          matchType:              '$discoveryNotes.qaLog.matchType',
          matchSource:            '$discoveryNotes.qaLog.matchSource',
          fuzzyRecovery:          '$discoveryNotes.qaLog.fuzzyRecovery',
          inputPreview:           '$discoveryNotes.qaLog.inputPreview',

          // NEGATIVE_KEYWORD_BLOCK fields
          suppressedContainerId:    '$discoveryNotes.qaLog.suppressedContainerId',
          suppressedContainerTitle: '$discoveryNotes.qaLog.suppressedContainerTitle',
          blockedBy:                '$discoveryNotes.qaLog.blockedBy',
          sectionLabel:             '$discoveryNotes.qaLog.sectionLabel',

          // KC_SECTION_GAP_RESCUED fields
          originalContainer:      '$discoveryNotes.qaLog.originalContainer',
          rescuedContainer:       '$discoveryNotes.qaLog.rescuedContainer',
          originalScore:          '$discoveryNotes.qaLog.originalScore',

          // ── Phase A.1 — UAP_LAYER1 diagnostic fields ─────────────────────
          anchorGate:             '$discoveryNotes.qaLog.anchorGate',
          coreGate:               '$discoveryNotes.qaLog.coreGate',
          topicWords:             '$discoveryNotes.qaLog.topicWords',
          sectionIdx:             '$discoveryNotes.qaLog.sectionIdx',
          sectionId:              '$discoveryNotes.qaLog.sectionId',
          noCandidate:            '$discoveryNotes.qaLog.noCandidate',
          reason:                 '$discoveryNotes.qaLog.reason',
          belowThreshold:         '$discoveryNotes.qaLog.belowThreshold',
          threshold:              '$discoveryNotes.qaLog.threshold',
          phrase:                 '$discoveryNotes.qaLog.phrase',

          // ── Phase A.2 — UAP_SEMANTIC_MISS fields ────────────────────────
          similarity:             '$discoveryNotes.qaLog.similarity',
          matchedPhrase:          '$discoveryNotes.qaLog.matchedPhrase',

          // ── Phase A.3 — pre-gate timeline carried on rescue + fallback ──
          uap25:                  '$discoveryNotes.qaLog.uap25',
          semantic28:             '$discoveryNotes.qaLog.semantic28',

          // ── Phase A.3 — rescued section deep-link id ────────────────────
          rescuedSectionId:       '$discoveryNotes.qaLog.rescuedSectionId',

          // ── Phase A.4 — per-turn cost + latency on LLM fallbacks ────────
          cost:                   '$discoveryNotes.qaLog.cost',
          latencyMs:              '$discoveryNotes.qaLog.latencyMs',
        },
      },
      // Facet: entries + aggregate counts + UAP health metrics
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
          // UAP health: GATE 2.5 phrase index hits (hit=true only — skips non-hit UAP_LAYER1 telemetry)
          uapHits: [
            { $match: { type: 'UAP_LAYER1', hit: true } },
            { $count: 'n' },
          ],
          // UAP misses rescued by keyword (the corpus-is-incomplete signal)
          uapMissKeywordRescues: [
            { $match: { type: 'UAP_MISS_KEYWORD_RESCUED' } },
            { $count: 'n' },
          ],
          // Full UAP misses (section gaps + LLM fallbacks = container or answer missing)
          llmFallbacks: [
            { $match: { type: 'KC_LLM_FALLBACK' } },
            { $count: 'n' },
          ],
          // Top 10 UAP hits (what's working)
          topUapHits: [
            { $match: { type: 'UAP_LAYER1', hit: true, containerId: { $ne: null } } },
            { $group: {
              _id:   '$containerId',
              title: { $first: '$containerTitle' },
              kcId:  { $first: '$kcId' },
              count: { $sum: 1 },
            } },
            { $sort: { count: -1 } },
            { $limit: 10 },
          ],
          // Top 10 UAP misses (what needs phrases added)
          topUapMisses: [
            { $match: { type: 'UAP_MISS_KEYWORD_RESCUED', rescuedContainerId: { $ne: null } } },
            { $group: {
              _id:           '$rescuedContainerId',
              title:         { $first: '$rescuedContainerTitle' },
              kcId:          { $first: '$rescuedKcId' },
              count:         { $sum: 1 },
              samplePhrases: { $push: '$question' },
            } },
            { $sort: { count: -1 } },
            { $limit: 10 },
            // Cap samplePhrases to 5 per container (keep payload bounded)
            { $project: {
              _id: 1, title: 1, kcId: 1, count: 1,
              samplePhrases: { $slice: ['$samplePhrases', 5] },
            } },
          ],

          // ── Phase A.2 — Semantic near-misses (GATE 2.8 closest candidates)
          // "Tune these sections or add this phrase as a callerPhrase" signal.
          semanticMisses: [
            { $match: { type: 'UAP_SEMANTIC_MISS' } },
            { $count: 'n' },
          ],
          topSemanticMisses: [
            { $match: { type: 'UAP_SEMANTIC_MISS', containerId: { $ne: null } } },
            { $group: {
              _id:           '$containerId',
              title:         { $first: '$containerTitle' },
              kcId:          { $first: '$kcId' },
              count:         { $sum: 1 },
              avgSimilarity: { $avg: '$similarity' },
              samplePhrases: { $push: '$question' },
            } },
            { $sort: { count: -1 } },
            { $limit: 10 },
            { $project: {
              _id: 1, title: 1, kcId: 1, count: 1,
              avgSimilarity: { $round: ['$avgSimilarity', 3] },
              samplePhrases: { $slice: ['$samplePhrases', 5] },
            } },
          ],

          // ── Phase A.4 — Cost aggregates (Claude $/turn on fallbacks) ────
          llmCostTotal: [
            { $match: { type: { $in: ['KC_LLM_FALLBACK', 'KC_SECTION_GAP_ANSWERED'] }, 'cost.totalUsd': { $exists: true, $ne: null } } },
            { $group: {
              _id:          null,
              totalUsd:     { $sum: '$cost.totalUsd' },
              inputTokens:  { $sum: '$cost.inputTokens' },
              outputTokens: { $sum: '$cost.outputTokens' },
              fallbackN:    { $sum: 1 },
              avgLatencyMs: { $avg: '$latencyMs' },
            } },
          ],
          // Top 10 most-expensive UAP miss patterns grouped by question shape —
          // highest-ROI fixes (add a phrase here, save these $ going forward).
          topCostDrivers: [
            { $match: { type: 'KC_LLM_FALLBACK', 'cost.totalUsd': { $exists: true, $ne: null } } },
            { $group: {
              _id:       { $toLower: { $substr: ['$question', 0, 60] } },
              question:  { $first: '$question' },
              count:     { $sum: 1 },
              totalUsd:  { $sum: '$cost.totalUsd' },
              avgUsd:    { $avg: '$cost.totalUsd' },
              closestContainer: { $first: '$semantic28.bestBelow.containerTitle' },
              closestScore:     { $first: '$semantic28.bestBelow.similarity' },
            } },
            { $sort: { totalUsd: -1 } },
            { $limit: 10 },
            { $project: {
              _id: 1, question: 1, count: 1,
              totalUsd: { $round: ['$totalUsd', 4] },
              avgUsd:   { $round: ['$avgUsd', 4] },
              closestContainer: 1,
              closestScore: { $round: ['$closestScore', 3] },
            } },
          ],
        },
      },
    ];

    const [result] = await Customer.aggregate(pipeline);

    // Build byType map
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

    // Derived UAP health metrics
    const uapHitsN     = result.uapHits?.[0]?.n || 0;
    const uapKeyResc   = result.uapMissKeywordRescues?.[0]?.n || 0;
    const llmFbN       = result.llmFallbacks?.[0]?.n || 0;
    const semanticMissN = result.semanticMisses?.[0]?.n || 0;
    // Denominator: only turns that reached GATES 2.4-3 (not Turn1Engine, LAP hold, Transfer).
    // UAP hits + Keyword rescues + LLM fallbacks = all KC pipeline outcomes.
    const uapConsidered = uapHitsN + uapKeyResc + llmFbN;
    const uapHitRate    = uapConsidered > 0 ? uapHitsN / uapConsidered : null;

    // Phase A.4 — cost summary. Null when no fallback data yet (not "$0").
    const costAgg = result.llmCostTotal?.[0] || null;
    const costSummary = costAgg ? {
      totalUsd:      Math.round((costAgg.totalUsd || 0) * 10000) / 10000,
      inputTokens:   costAgg.inputTokens || 0,
      outputTokens:  costAgg.outputTokens || 0,
      fallbackN:     costAgg.fallbackN || 0,
      avgLatencyMs:  Math.round(costAgg.avgLatencyMs || 0),
      avgUsdPerTurn: costAgg.fallbackN > 0
        ? Math.round((costAgg.totalUsd / costAgg.fallbackN) * 10000) / 10000
        : null,
    } : null;

    return res.json({
      success: true,
      gaps:    entries,
      summary: {
        total,
        byType,
        range,
        // UAP health
        uapHitsN,
        uapKeyResc,
        llmFbN,
        semanticMissN,
        uapConsidered,
        uapHitRate,
        topUapHits:        result.topUapHits        || [],
        topUapMisses:      result.topUapMisses      || [],
        topSemanticMisses: result.topSemanticMisses || [],
        // Phase A.4 — cost intelligence
        cost:              costSummary,
        topCostDrivers:    result.topCostDrivers    || [],
      },
    });
  } catch (err) {
    logger.error('[kcGaps] Aggregation error', { companyId, err: err.message });
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;
