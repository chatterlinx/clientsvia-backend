'use strict';

/**
 * ============================================================================
 * KC VERIFY SERVICE — Side-effect-free phrase routing check
 * ============================================================================
 *
 * Given a companyId and a caller phrase, this service answers the question the
 * admin wants to answer on the Gaps & Todo page:
 *
 *   "If this phrase came in as a live utterance, would KC route it correctly?"
 *
 * It does so by running the phrase through the SAME gates the production
 * KCDiscoveryRunner uses — CueExtractorService and KnowledgeContainerService —
 * but without any side effects:
 *
 *   ✖ No writes to discoveryNotes
 *   ✖ No Redis writes
 *   ✖ No qaLog events
 *   ✖ No LLM calls
 *   ✖ No logging of call-level events
 *
 * This is intentional. Production routing is a 2990-line orchestrator with
 * dozens of stateful branches. Adding a `dryRun` flag across every side-effect
 * site is invasive and risky. Instead, this service composes the two
 * deterministic, pure modules that actually decide routing:
 *
 *   1. CueExtractorService.extract  — 8-field pattern match (<1ms)
 *   2. KCS.findContainer            — keyword + title + section scoring
 *
 * That matches GATE 2.4 → GATE 3 in the production pipeline. The gaps this
 * tests for — SECTION_GAP / LLM_FALLBACK — originate here. Verifying them here
 * is the right level of abstraction.
 *
 * ── VERDICT TAXONOMY ─────────────────────────────────────────────────────────
 *
 *   'resolved' — Clean hit: container matched, section identified, score solid
 *   'weak'     — Partial hit: container matched but section unclear OR low score
 *   'failing'  — No KC match: would fall through to LLM fallback in production
 *
 * ── RESPONSE SHAPE ───────────────────────────────────────────────────────────
 *
 *   {
 *     verdict:              'resolved' | 'weak' | 'failing',
 *     phrase:               <original>,
 *     normalizedPhrase:     <lowercased, punctuation stripped>,
 *     gapKey:               <sha1 fingerprint — same as KCGapResolution.gapKey>,
 *
 *     gates: {
 *       cueExtractor: {
 *         fieldCount:      <0-8>,
 *         fields:          { requestCue, permissionCue, ... },
 *         tradeMatches:    [{ containerId, sectionIdx, term, kcId, title }],
 *         isSingleTrade:   <bool>,
 *       },
 *       keywordScoring: {
 *         matched:             <bool>,
 *         score:               <int>,
 *         threshold:           <int>,
 *         anchorFloor:         <int>,
 *         matchedContainerId:  <ObjectId string>,
 *         matchedContainerTitle: <string>,
 *         matchedSectionIdx:   <int | null>,
 *         matchedSectionLabel: <string | null>,
 *         sourceTier:          <'T1' | 'T2' | 'T3' | null>,
 *       },
 *     },
 *
 *     matchedContainer: {
 *       id:    <ObjectId string>,
 *       kcId:  <string>,
 *       title: <string>,
 *     } | null,
 *     matchedSection: {
 *       idx:   <int>,
 *       label: <string>,
 *     } | null,
 *
 *     wouldFallThroughToLLM: <bool>,
 *     latencyMs:             <int>,
 *     verifiedAt:            <ISO>,
 *   }
 *
 * ── MULTI-TENANT SAFETY ──────────────────────────────────────────────────────
 *
 *   All Mongo reads are scoped by companyId via KCS.getActiveForCompany.
 *   No cross-tenant data is ever read or returned.
 *
 * ============================================================================
 */

const crypto = require('crypto');

const CueExtractorService = require('../cueExtractor/CueExtractorService');
const KCS                 = require('../engine/agent2/KnowledgeContainerService');
const KCGapResolution     = require('../../models/KCGapResolution');
const logger              = require('../../utils/logger');

// ── Thresholds mirrored from KCDiscoveryRunner + KnowledgeContainerService ──
// Keeping these locally lets verify report the SAME thresholds the runtime uses
// without cross-importing internal constants (which would couple test + prod).
const MIN_THRESHOLD = parseInt(process.env.KC_KEYWORD_THRESHOLD, 10) || 8;
const ANCHOR_FLOOR  = 24;
const WEAK_MARGIN   = 4;   // score within this of MIN_THRESHOLD → 'weak'

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Verify whether a caller phrase routes to a KC container in production today.
 *
 * @param {Object} opts
 * @param {string} opts.companyId
 * @param {string} opts.phrase
 * @param {string} [opts.expectedContainerId]   — if provided, contributes to
 *   'weak' vs 'resolved' decision (wrong container → weak)
 * @returns {Promise<Object>} verify report (see module docstring)
 */
async function verifyPhrase({ companyId, phrase, expectedContainerId = null }) {
    const startMs = Date.now();

    // ── Input normalization ──────────────────────────────────────────────────
    const rawPhrase    = String(phrase || '').trim();
    const normPhrase   = KCGapResolution.normalizePhrase(rawPhrase);
    const gapKey       = KCGapResolution.buildGapKey(companyId, rawPhrase);

    const base = {
        verdict:           'failing',
        phrase:            rawPhrase,
        normalizedPhrase:  normPhrase,
        gapKey,
        gates:             {},
        matchedContainer:  null,
        matchedSection:    null,
        wouldFallThroughToLLM: true,
        latencyMs:         0,
        verifiedAt:        new Date().toISOString(),
    };

    if (!companyId || !rawPhrase) {
        base.latencyMs = Date.now() - startMs;
        base.error = 'companyId and phrase are required';
        return base;
    }

    try {
        // ── GATE 2.4 — CueExtractor ──────────────────────────────────────────
        // 8-field pattern match. Returns fieldCount + tradeMatches.
        const cueFrame = await CueExtractorService.extract(companyId, rawPhrase);

        base.gates.cueExtractor = {
            fieldCount: cueFrame.fieldCount || 0,
            fields: {
                requestCue:    cueFrame.requestCue    || null,
                permissionCue: cueFrame.permissionCue || null,
                infoCue:       cueFrame.infoCue       || null,
                directiveCue:  cueFrame.directiveCue  || null,
                actionCore:    cueFrame.actionCore    || null,
                urgencyCore:   cueFrame.urgencyCore   || null,
                modifierCore:  cueFrame.modifierCore  || null,
            },
            tradeMatches: (cueFrame.tradeMatches || []).map(tm => ({
                containerId: tm.containerId ? String(tm.containerId) : null,
                sectionIdx:  tm.sectionIdx,
                term:        tm.term,
                kcId:        tm.kcId,
                title:       tm.title,
            })),
            isSingleTrade: !!cueFrame.isSingleTrade,
        };

        // ── Load active containers for scoring ───────────────────────────────
        const containers = await KCS.getActiveForCompany(companyId);

        // ── GATE 3 — Keyword / title / section scoring ───────────────────────
        // Pass no anchor context — verify simulates a fresh turn (worst case).
        const match = KCS.findContainer(containers, rawPhrase, null);

        if (match) {
            const matchedSectionLabel = match.bestSection?.label || null;
            const matchedSectionIdx   = (typeof match.bestSIdx === 'number') ? match.bestSIdx : null;

            base.gates.keywordScoring = {
                matched:               true,
                score:                 match.score ?? null,
                threshold:             MIN_THRESHOLD,
                anchorFloor:           ANCHOR_FLOOR,
                matchedContainerId:    match._id ? String(match._id) : null,
                matchedContainerTitle: match.title || null,
                matchedSectionIdx,
                matchedSectionLabel,
                sourceTier:            match.sourceTier || null,
            };

            base.matchedContainer = {
                id:    match._id ? String(match._id) : null,
                kcId:  match.kcId || null,
                title: match.title || null,
            };
            if (matchedSectionIdx !== null) {
                base.matchedSection = {
                    idx:   matchedSectionIdx,
                    label: matchedSectionLabel,
                };
            }

            base.wouldFallThroughToLLM = false;
            base.verdict = _computeVerdict({
                score:              match.score,
                matchedContainerId: base.matchedContainer.id,
                matchedSectionIdx,
                expectedContainerId,
            });
        } else {
            base.gates.keywordScoring = {
                matched:               false,
                score:                 0,
                threshold:             MIN_THRESHOLD,
                anchorFloor:           ANCHOR_FLOOR,
                matchedContainerId:    null,
                matchedContainerTitle: null,
                matchedSectionIdx:     null,
                matchedSectionLabel:   null,
                sourceTier:            null,
            };
            base.wouldFallThroughToLLM = true;
            base.verdict = 'failing';
        }

    } catch (err) {
        logger.error('[KCVerifyService] verifyPhrase error', {
            companyId, err: err.message, stack: err.stack,
        });
        base.error = err.message;
        base.verdict = 'failing';
    }

    base.latencyMs = Date.now() - startMs;
    return base;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Compute the 3-state verdict from the scored match.
 *
 *   resolved  — score is comfortably above threshold AND section identified
 *               AND (if expected container was specified) it matches
 *   weak      — container matched but either no section OR low score
 *               OR wrong container when expected one was supplied
 *   failing   — no match (handled upstream, just returned here for clarity)
 */
function _computeVerdict({ score, matchedContainerId, matchedSectionIdx, expectedContainerId }) {
    if (!matchedContainerId) return 'failing';

    const safeScore = typeof score === 'number' ? score : 0;

    // Expected container mismatch → weak (caller would route somewhere else)
    if (expectedContainerId && String(expectedContainerId) !== String(matchedContainerId)) {
        return 'weak';
    }

    // Container matched but no section → Groq gets ALL sections → bad UX
    if (matchedSectionIdx === null || matchedSectionIdx === undefined) {
        return 'weak';
    }

    // Score within WEAK_MARGIN of threshold → still shaky
    if (safeScore < (MIN_THRESHOLD + WEAK_MARGIN)) {
        return 'weak';
    }

    return 'resolved';
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    verifyPhrase,
    // exported for tests
    _computeVerdict,
    _constants: { MIN_THRESHOLD, ANCHOR_FLOOR, WEAK_MARGIN },
};
