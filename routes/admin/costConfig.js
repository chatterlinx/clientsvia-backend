'use strict';

/**
 * ============================================================================
 * COST CONFIG — Per-Company LLM / TTS Plan Pricing
 * ============================================================================
 *
 * Commit 2 (2026-04-21). Surfaces the effective cost rates for a company
 * (Claude / Groq / ElevenLabs / Deepgram / Twilio) and lets the admin
 * override them per-company when they have a custom plan.
 *
 * Resolution hierarchy (see services/costRates.js):
 *   company.costConfig[provider]  →  env var  →  hardcoded list-price default
 *
 * MOUNT: /api/admin/agent2/company
 *
 * ENDPOINTS:
 *   GET  /:companyId/cost-config   — returns { overrides, effective, defaults }
 *   PUT  /:companyId/cost-config   — replaces company.costConfig (full object)
 *
 * ============================================================================
 */

const express             = require('express');
const router              = express.Router();
const logger              = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const v2Company           = require('../../models/v2Company');
const costRates           = require('../../services/costRates');

router.use(authenticateJWT);

// ── Access control (same pattern as kcGaps.js) ──────────────────────────────
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

// ── Validator for incoming costConfig payload ───────────────────────────────
// Accepts shape matching v2Company.costConfig schema. Each numeric field is
// optional; null / undefined clears the override so we fall back to env/default.
// Non-numeric / negative values rejected.
function _sanitizeCostConfig(raw) {
    const out = {};
    const body = (raw && typeof raw === 'object') ? raw : {};

    function num(v) {
        if (v === null || v === undefined || v === '') return null;
        const n = Number(v);
        return Number.isFinite(n) && n >= 0 ? n : null;
    }
    function str(v) {
        if (v === null || v === undefined) return null;
        if (typeof v !== 'string') return null;
        const s = v.trim();
        return s.length ? s.slice(0, 120) : null;
    }

    // claude / groq (inPerM, outPerM, tier)
    for (const k of ['claude', 'groq']) {
        const src = body[k] || {};
        out[k] = {
            tier:    str(src.tier),
            inPerM:  num(src.inPerM),
            outPerM: num(src.outPerM),
        };
    }
    // elevenlabs (perKChars, tier)
    {
        const src = body.elevenlabs || {};
        out.elevenlabs = {
            tier:      str(src.tier),
            perKChars: num(src.perKChars),
        };
    }
    // deepgram / twilio (perMin, tier)
    for (const k of ['deepgram', 'twilio']) {
        const src = body[k] || {};
        out[k] = {
            tier:   str(src.tier),
            perMin: num(src.perMin),
        };
    }
    // free-form notes (sales contract ref, negotiated plan, etc.)
    out.notes = str(body.notes);

    return out;
}

/**
 * GET /:companyId/cost-config
 *
 * Returns:
 *   {
 *     success:   true,
 *     overrides: company.costConfig || {},   // raw values stored on doc
 *     effective: { claude, groq, elevenlabs, deepgram, twilio, _source },
 *     defaults:  { claude, groq, elevenlabs, deepgram, twilio }
 *   }
 */
router.get('/:companyId/cost-config', async (req, res) => {
    try {
        const { companyId } = req.params;
        if (!_validateCompanyAccess(req, res, companyId)) return;

        const company = await v2Company.findById(companyId).select('_id costConfig').lean();
        if (!company) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }

        const effective = costRates.getRates(company);

        return res.json({
            success:   true,
            companyId,
            overrides: company.costConfig || null,
            effective,
            defaults:  costRates.DEFAULTS,
        });
    } catch (err) {
        logger.error('[COST_CONFIG] GET failed', { error: err.message, companyId: req.params.companyId });
        return res.status(500).json({ success: false, error: 'Failed to load cost config' });
    }
});

/**
 * PUT /:companyId/cost-config
 *
 * Body: partial costConfig. Each numeric field may be null/empty to clear.
 * Replaces `company.costConfig` wholesale with the sanitized payload.
 */
router.put('/:companyId/cost-config', async (req, res) => {
    try {
        const { companyId } = req.params;
        if (!_validateCompanyAccess(req, res, companyId)) return;

        const clean = _sanitizeCostConfig(req.body);

        const updated = await v2Company.findByIdAndUpdate(
            companyId,
            { $set: { costConfig: clean } },
            { new: true, projection: '_id costConfig' }
        ).lean();

        if (!updated) {
            return res.status(404).json({ success: false, error: 'Company not found' });
        }

        const effective = costRates.getRates(updated);

        logger.info('[COST_CONFIG] updated', {
            companyId,
            source: effective._source,
            by:     req.user?.email || req.user?.id || 'unknown',
        });

        return res.json({
            success:   true,
            companyId,
            overrides: updated.costConfig,
            effective,
            defaults:  costRates.DEFAULTS,
        });
    } catch (err) {
        logger.error('[COST_CONFIG] PUT failed', { error: err.message, companyId: req.params.companyId });
        return res.status(500).json({ success: false, error: 'Failed to save cost config' });
    }
});

module.exports = router;
