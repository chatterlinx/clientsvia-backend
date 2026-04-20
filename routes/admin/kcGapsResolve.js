'use strict';

/**
 * ============================================================================
 * KC GAPS RESOLVE — Closed-loop gap verification, fix advisor, and resolution
 * ============================================================================
 *
 * Runtime gap events (KC_SECTION_GAP / KC_LLM_FALLBACK / KC_GRACEFUL_ACK) are
 * surfaced by kcGaps.js from Customer.discoveryNotes[].qaLog[]. For each gap,
 * the admin can:
 *
 *   1. Verify WHY the phrase fails (full 6-gate trace)         — POST /gaps/verify
 *   2. Ask Claude for a classified, over-build-safe fix plan   — POST /gaps/fix-advisor
 *   3. Mark the gap resolved (persists trace + advisor output) — POST /gaps/resolve
 *   4. List what's resolved / weak / regressed                 — GET  /gaps/resolutions
 *   5. Re-open a resolution                                    — DELETE /gaps/resolutions/:gapKey
 *
 * MOUNT: /api/admin/agent2/company (same as kcGaps.js — shares JWT + access)
 *
 * KEY ARCHITECTURE NOTE
 * ---------------------
 * /verify is backed by GapReplayService, which COMPOSES the four production
 * routing modules (CueExtractorService, UtteranceActParser, SemanticMatchService,
 * KnowledgeContainerService) rather than re-implementing routing. The earlier
 * KCVerifyService ran only 2 of 4 gates and was retired April 2026.
 *
 * /fix-advisor is backed by FixAdvisorService, which embeds the phrase, sweeps
 * ALL active callerPhrase/phraseCore/content embeddings for near-matches, and
 * then asks Claude Sonnet to classify the fix as
 *   ADD_PHRASES | AUGMENT_SECTION | NEW_SECTION | ROUTING_PROBLEM
 * with a server-side veto that downgrades NEW_SECTION to AUGMENT_SECTION when
 * existing content already covers the phrase ≥0.80 cosine similarity.
 *
 * VERIFY is stateless — no DB writes, safe to call repeatedly.
 * FIX-ADVISOR is stateless — no DB writes, safe to call repeatedly.
 * RESOLVE is idempotent — upserts by (companyId, gapKey) and refreshes trace.
 *
 * ============================================================================
 */

const express             = require('express');
const router              = express.Router();
const logger              = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const KCGapResolution     = require('../../models/KCGapResolution');
const GapReplayService    = require('../../services/kcVerify/GapReplayService');
const FixAdvisorService   = require('../../services/kcVerify/FixAdvisorService');

// ── All routes require a valid JWT ───────────────────────────────────────────
router.use(authenticateJWT);

// ── Access control (same pattern as kcGaps.js + kcHealth.js) ────────────────
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
// POST /:companyId/knowledge/gaps/verify
// ──────────────────────────────────────────────────────────────────────────────
// Body: {
//   phrase: string,
//   anchorContainerId?: string,    // simulate a turn where anchor is already set
//   expectedContainerId?: string,  // if provided, wrong container → 'weak'
// }
//
// Runs the phrase through the SAME 6-gate pipeline the production runtime uses
// (CueExtractor → UAP → Word Gate → Core Confirm → Semantic → Keyword) with
// ZERO side effects. Returns a full trace plus a tri-state verdict:
//
//   'resolved' → clean routing hit: container + section, solid score
//   'weak'     → partial: container matched but no section OR score near threshold
//                OR wrong container when an expected one was supplied
//   'failing'  → no match: would fall through to LLM fallback in production
//
// Safe to call repeatedly — no DB writes happen here.
// ══════════════════════════════════════════════════════════════════════════════

router.post('/:companyId/knowledge/gaps/verify', async (req, res) => {
    const { companyId } = req.params;
    if (!_validateCompanyAccess(req, res, companyId)) return;

    const { phrase, anchorContainerId, expectedContainerId } = req.body || {};

    if (!phrase || typeof phrase !== 'string' || !phrase.trim()) {
        return res.status(400).json({ success: false, error: 'phrase is required' });
    }

    try {
        const result = await GapReplayService.replayPhrase({
            companyId,
            phrase,
            anchorContainerId:   anchorContainerId   || null,
            expectedContainerId: expectedContainerId || null,
        });

        return res.json({ success: true, verify: result });
    } catch (err) {
        logger.error('[kcGapsResolve] verify error', { companyId, err: err.message, stack: err.stack });
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /:companyId/knowledge/gaps/fix-advisor
// ──────────────────────────────────────────────────────────────────────────────
// Body: {
//   phrase: string,
//   replayTrace?: Object,                   // if not provided, we replay first
//   originalContainerId?: string,
//   originalContainerTitle?: string,
// }
//
// Runs Claude Sonnet over a curated container catalog + top-K near-miss table
// (from a cosine sweep) and returns a classified fix plan. The advisor is
// server-side-vetoed: if existing content scores ≥0.80 cosine to the phrase,
// NEW_SECTION is downgraded to AUGMENT_SECTION to prevent duplicate-content
// drift across hundreds of sections.
//
// Stateless — no DB writes. Call repeatedly while authoring.
// ══════════════════════════════════════════════════════════════════════════════

router.post('/:companyId/knowledge/gaps/fix-advisor', async (req, res) => {
    const { companyId } = req.params;
    if (!_validateCompanyAccess(req, res, companyId)) return;

    const {
        phrase,
        replayTrace: clientTrace,
        originalContainerId,
        originalContainerTitle,
    } = req.body || {};

    if (!phrase || typeof phrase !== 'string' || !phrase.trim()) {
        return res.status(400).json({ success: false, error: 'phrase is required' });
    }

    try {
        // If the caller didn't send a fresh trace, replay now so the advisor
        // has authoritative gate outcomes to reason about.
        let replayTrace = clientTrace || null;
        const stale =
            !replayTrace ||
            !replayTrace.verifiedAt ||
            (Date.now() - new Date(replayTrace.verifiedAt).getTime() > 60_000);

        if (stale) {
            replayTrace = await GapReplayService.replayPhrase({
                companyId,
                phrase,
                anchorContainerId:   null,
                expectedContainerId: originalContainerId || null,
            });
        }

        const advisor = await FixAdvisorService.adviseFix({
            companyId,
            phrase,
            replayTrace,
            originalContainerId:    originalContainerId    || null,
            originalContainerTitle: originalContainerTitle || null,
        });

        return res.json({ success: true, advisor, replayTrace });
    } catch (err) {
        logger.error('[kcGapsResolve] fix-advisor error', {
            companyId, err: err.message, stack: err.stack,
        });
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /:companyId/knowledge/gaps/resolve
// ──────────────────────────────────────────────────────────────────────────────
// Body: {
//   phrase:                  string,
//   verifyResult?:           Object,   // from /gaps/verify (captured in doc)
//   fixAdvisor?:             Object,   // from /gaps/fix-advisor (captured in doc)
//   originalType?:           string,   // KC_SECTION_GAP / KC_LLM_FALLBACK / ...
//   originalContainerId?:    string,
//   originalContainerTitle?: string,
//   note?:                   string,
//   forceStatus?:            'RESOLVED'|'WEAK'|'DISMISSED'  // admin override
// }
//
// Idempotent — upserts by (companyId, gapKey).
//
// If the caller did not supply a verifyResult, we re-run the 6-gate replay
// (authoritative) before writing. That way the resolution status always
// reflects reality at time of resolve, and the trace on disk matches what
// production would actually do with this phrase today.
// ══════════════════════════════════════════════════════════════════════════════

router.post('/:companyId/knowledge/gaps/resolve', async (req, res) => {
    const { companyId } = req.params;
    if (!_validateCompanyAccess(req, res, companyId)) return;

    const {
        phrase,
        verifyResult,
        fixAdvisor,
        originalType,
        originalContainerId,
        originalContainerTitle,
        note,
        forceStatus,
    } = req.body || {};

    if (!phrase || typeof phrase !== 'string' || !phrase.trim()) {
        return res.status(400).json({ success: false, error: 'phrase is required' });
    }

    try {
        // ── Re-replay unless client passed a fresh result (< 60s ago) ──────
        let verify = verifyResult || null;
        const stale =
            !verify ||
            !verify.verifiedAt ||
            (Date.now() - new Date(verify.verifiedAt).getTime() > 60_000);

        if (stale) {
            verify = await GapReplayService.replayPhrase({
                companyId,
                phrase,
                anchorContainerId:   null,
                expectedContainerId: originalContainerId || null,
            });
        }

        // ── Derive status from verdict (unless admin forced one) ────────────
        let status;
        if (forceStatus && KCGapResolution.STATUS[forceStatus]) {
            status = forceStatus;
        } else if (verify.verdict === 'resolved') {
            status = KCGapResolution.STATUS.RESOLVED;
        } else if (verify.verdict === 'weak') {
            status = KCGapResolution.STATUS.WEAK;
        } else {
            // 'failing' — do not let admin mark as resolved if verify fails.
            // Surface the trace so the UI can explain exactly which gate failed.
            return res.status(409).json({
                success: false,
                error:   'Cannot resolve: replay returned "failing" — KC would not route this phrase. Author more content or run the Fix Advisor.',
                verify,
            });
        }

        const gapKey = KCGapResolution.buildGapKey(companyId, phrase);
        const normPh = KCGapResolution.normalizePhrase(phrase);
        const now    = new Date();

        // NOTE: verifyCount is NOT in $setOnInsert — MongoDB forbids the same
        // field appearing in both $setOnInsert and $inc on an upsert (path
        // conflict). On insert, $inc creates verifyCount=1 automatically; on
        // update it increments. Same net effect, no conflict.
        const setOnInsert = {
            companyId,
            gapKey,
            phrase:           phrase.trim(),
            normalizedPhrase: normPh,
            createdAt:        now,
            resolvedAt:       now,
        };

        const setFields = {
            status,
            lastVerdict:            verify.verdict,
            lastVerifyResult:       verify,
            replayTrace:            verify,             // full 6-gate trace on disk
            fixAdvisor:             fixAdvisor || undefined,
            lastVerifiedAt:         now,
            resolvedBy:             req.user?.email || req.user?.id || 'admin',
            updatedAt:              now,
            originalType:           originalType            || undefined,
            originalContainerId:    originalContainerId     || undefined,
            originalContainerTitle: originalContainerTitle  || undefined,
            resolvedContainerId:    verify.finalMatch?.containerId  || undefined,
            resolvedContainerTitle: verify.finalMatch?.containerTitle || undefined,
            resolvedSectionLabel:   verify.finalMatch?.sectionLabel   || undefined,
            note:                   note || undefined,
        };
        // Strip undefined so $set does not overwrite existing values with null
        for (const k of Object.keys(setFields)) {
            if (setFields[k] === undefined) delete setFields[k];
        }

        const doc = await KCGapResolution.findOneAndUpdate(
            { companyId, gapKey },
            {
                $set:         setFields,
                $setOnInsert: setOnInsert,
                $inc:         { verifyCount: 1 },
            },
            { upsert: true, new: true, setDefaultsOnInsert: true }
        );

        logger.info('[kcGapsResolve] resolved', {
            companyId,
            gapKey:      gapKey.slice(0, 10),
            status,
            verdict:     verify.verdict,
            failureMode: verify.failureMode,
        });

        return res.json({ success: true, resolution: doc, verify });
    } catch (err) {
        logger.error('[kcGapsResolve] resolve error', {
            companyId, err: err.message, stack: err.stack,
        });
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /:companyId/knowledge/gaps/resolutions
// ──────────────────────────────────────────────────────────────────────────────
// Query:
//   ?status=RESOLVED|WEAK|REGRESSED|DISMISSED|all  (default: active)
//   ?limit=<int>                                    (default: 500, max 2000)
//
// Returns: { resolutions: [], map: { gapKey → doc } }
//   `map` is keyed by gapKey for O(1) client-side join with /gaps response.
// ══════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/knowledge/gaps/resolutions', async (req, res) => {
    const { companyId } = req.params;
    if (!_validateCompanyAccess(req, res, companyId)) return;

    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);

    const statusParam = req.query.status || 'active';
    let statusFilter;
    if (statusParam === 'all') {
        statusFilter = null;
    } else if (statusParam === 'active') {
        statusFilter = { $in: ['RESOLVED', 'WEAK', 'REGRESSED'] };
    } else if (KCGapResolution.STATUS[statusParam]) {
        statusFilter = statusParam;
    } else {
        return res.status(400).json({ success: false, error: 'invalid status filter' });
    }

    try {
        const query = { companyId };
        if (statusFilter) query.status = statusFilter;

        const docs = await KCGapResolution
            .find(query)
            .sort({ resolvedAt: -1 })
            .limit(limit)
            .lean();

        const map = {};
        for (const d of docs) map[d.gapKey] = d;

        return res.json({
            success:     true,
            resolutions: docs,
            map,
            count:       docs.length,
        });
    } catch (err) {
        logger.error('[kcGapsResolve] resolutions error', { companyId, err: err.message });
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /:companyId/knowledge/gaps/resolutions/:gapKey
// ──────────────────────────────────────────────────────────────────────────────
// Re-open a resolution (admin clicked "Undo mark as done").
// Permanently removes the resolution doc so the gap row reappears on the todo
// list. No soft-delete — the qaLog events remain as the source of truth.
// ══════════════════════════════════════════════════════════════════════════════

router.delete('/:companyId/knowledge/gaps/resolutions/:gapKey', async (req, res) => {
    const { companyId, gapKey } = req.params;
    if (!_validateCompanyAccess(req, res, companyId)) return;

    if (!gapKey || !/^[a-f0-9]{40}$/.test(gapKey)) {
        return res.status(400).json({ success: false, error: 'invalid gapKey' });
    }

    try {
        const result = await KCGapResolution.deleteOne({ companyId, gapKey });
        logger.info('[kcGapsResolve] resolution deleted', {
            companyId, gapKey: gapKey.slice(0, 10), removed: result.deletedCount,
        });
        return res.json({ success: true, removed: result.deletedCount || 0 });
    } catch (err) {
        logger.error('[kcGapsResolve] delete error', { companyId, err: err.message });
        return res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
