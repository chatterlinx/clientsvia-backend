'use strict';

/**
 * ============================================================================
 * KC GAPS RESOLVE — Closed-loop gap verification + resolution API
 * ============================================================================
 *
 * Runtime gap events (KC_SECTION_GAP / KC_LLM_FALLBACK / KC_GRACEFUL_ACK) are
 * surfaced by kcGaps.js from Customer.discoveryNotes[].qaLog[]. Admins author
 * new callerPhrases / sections to cover the gap, then need a way to:
 *
 *   1. Verify the fix actually routes                — POST /gaps/verify
 *   2. Mark the gap done (persistent, hides on list) — POST /gaps/resolve
 *   3. List what they've resolved / regressed        — GET  /gaps/resolutions
 *   4. Re-open a resolution                          — DELETE /gaps/resolutions/:gapKey
 *
 * MOUNT: /api/admin/agent2/company  (same as kcGaps.js — they share JWT + access check)
 *
 * ENDPOINTS:
 *   POST   /:companyId/knowledge/gaps/verify
 *   POST   /:companyId/knowledge/gaps/resolve
 *   GET    /:companyId/knowledge/gaps/resolutions
 *   DELETE /:companyId/knowledge/gaps/resolutions/:gapKey
 *
 * VERIFY is stateless — no DB writes, safe to call repeatedly.
 * RESOLVE is idempotent — upserts by (companyId, gapKey).
 *
 * ============================================================================
 */

const express             = require('express');
const router              = express.Router();
const logger              = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const KCGapResolution     = require('../../models/KCGapResolution');
const KCVerifyService     = require('../../services/kcVerify/KCVerifyService');

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
// Body: { phrase: string, expectedContainerId?: string }
//
// Runs the phrase through the SAME gates production uses (CueExtractor +
// KCS.findContainer) but with ZERO side effects. Returns a verdict:
//
//   'resolved' → clean hit: container AND section, score above (threshold + margin)
//   'weak'     → partial: container matched but no section OR low score
//                OR wrong container when expected one was supplied
//   'failing'  → no KC match: would fall through to LLM fallback in production
//
// This is safe to call repeatedly — no DB writes happen here.
// ══════════════════════════════════════════════════════════════════════════════

router.post('/:companyId/knowledge/gaps/verify', async (req, res) => {
    const { companyId } = req.params;
    if (!_validateCompanyAccess(req, res, companyId)) return;

    const { phrase, expectedContainerId } = req.body || {};

    if (!phrase || typeof phrase !== 'string' || !phrase.trim()) {
        return res.status(400).json({ success: false, error: 'phrase is required' });
    }

    try {
        const result = await KCVerifyService.verifyPhrase({
            companyId,
            phrase,
            expectedContainerId: expectedContainerId || null,
        });

        return res.json({ success: true, verify: result });
    } catch (err) {
        logger.error('[kcGapsResolve] verify error', { companyId, err: err.message });
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// POST /:companyId/knowledge/gaps/resolve
// ──────────────────────────────────────────────────────────────────────────────
// Body: {
//   phrase:               string,
//   verifyResult?:        Object,    // from /gaps/verify (captured in doc)
//   originalType?:        string,    // KC_SECTION_GAP / KC_LLM_FALLBACK / KC_GRACEFUL_ACK
//   originalContainerId?: string,
//   originalContainerTitle?: string,
//   note?:                string,
//   forceStatus?:         'RESOLVED'|'WEAK'|'DISMISSED'   // admin override
// }
//
// Idempotent — upserts by (companyId, gapKey).
// If the caller did not supply a verifyResult, we run verify ourselves (fresh,
// authoritative) before writing. That way the resolution status always reflects
// reality at time of resolve.
// ══════════════════════════════════════════════════════════════════════════════

router.post('/:companyId/knowledge/gaps/resolve', async (req, res) => {
    const { companyId } = req.params;
    if (!_validateCompanyAccess(req, res, companyId)) return;

    const {
        phrase,
        verifyResult,
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
        // ── Re-verify unless client passed a fresh result (e.g. < 60s ago) ──
        let verify = verifyResult || null;
        const stale = !verify
            || !verify.verifiedAt
            || (Date.now() - new Date(verify.verifiedAt).getTime() > 60_000);

        if (stale) {
            verify = await KCVerifyService.verifyPhrase({
                companyId,
                phrase,
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
            // 'failing' — don't let admin mark as resolved if verify fails
            return res.status(409).json({
                success: false,
                error:   'Cannot resolve: verify returned "failing" — KC would not route this phrase. Author more content and try again.',
                verify,
            });
        }

        const gapKey  = KCGapResolution.buildGapKey(companyId, phrase);
        const normPh  = KCGapResolution.normalizePhrase(phrase);
        const now     = new Date();

        const setOnInsert = {
            companyId,
            gapKey,
            phrase:           phrase.trim(),
            normalizedPhrase: normPh,
            createdAt:        now,
            resolvedAt:       now,
            verifyCount:      1,
        };

        const setFields = {
            status,
            lastVerdict:            verify.verdict,
            lastVerifyResult:       verify,
            lastVerifiedAt:         now,
            resolvedBy:             req.user?.email || req.user?.id || 'admin',
            updatedAt:              now,
            originalType:           originalType            || undefined,
            originalContainerId:    originalContainerId     || undefined,
            originalContainerTitle: originalContainerTitle  || undefined,
            resolvedContainerId:    verify.matchedContainer?.id    || undefined,
            resolvedContainerTitle: verify.matchedContainer?.title || undefined,
            resolvedSectionLabel:   verify.matchedSection?.label   || undefined,
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
            gapKey: gapKey.slice(0, 10),
            status,
            verdict: verify.verdict,
        });

        return res.json({ success: true, resolution: doc, verify });
    } catch (err) {
        logger.error('[kcGapsResolve] resolve error', { companyId, err: err.message });
        return res.status(500).json({ success: false, error: err.message });
    }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /:companyId/knowledge/gaps/resolutions
// ──────────────────────────────────────────────────────────────────────────────
// Query:
//   ?status=RESOLVED|WEAK|REGRESSED|DISMISSED|all   (default: all non-dismissed)
//   ?limit=<int>                                     (default: 500)
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
