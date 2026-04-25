'use strict';

/**
 * ============================================================================
 * CoreGateConfigResolver — UAP Logic 2 three-tier dispatch config
 * ============================================================================
 *
 * WHY THIS EXISTS:
 *
 *   The UAP "Logic 2" core gate is being upgraded from a single-threshold
 *   cosine check (kitchen-sink phraseCore embedding) to a three-tier
 *   dispatch over per-phrase MAX cosine, with an LLM judge resolving the
 *   ambiguous middle band. Cross-section audits proved no single threshold
 *   pair can separate real paraphrases from anchor-false-positives like
 *   "do I have to PAY for parking AGAIN".
 *
 *   Every knob driving that dispatch lives in the schema:
 *     • Platform default — AdminSettings.globalHub.coreGateJudge
 *     • Per-tenant override — company.aiAgentSettings.agent2
 *                              .speechDetection.coreGate
 *
 *   This resolver is the single seam that turns those two sources into one
 *   plain-object config the engine can read without doing fallback gymnastics
 *   inline. ALL coregate code paths (Logic 2, Re-score, judge, health) MUST
 *   go through resolveCoreGateConfig() — never read company fields directly.
 *
 * MULTI-TENANT SAFETY:
 *
 *   - Zero hardcoded tenant references. Defaults are last-resort literals.
 *   - Falls back gracefully when AdminSettings is unavailable (degraded mode
 *     uses hardcoded last-resort values, never throws — calls must keep
 *     completing even if the singleton load fails).
 *   - Tenant override per-field: a tenant may override thresholdHigh and
 *     leave everything else at platform default. Null = inherit.
 *
 * RESOLUTION ORDER (per field):
 *
 *   1. Tenant override (company.aiAgentSettings.agent2.speechDetection
 *      .coreGate.<field>) — when non-null
 *   2. Platform default (adminSettings.globalHub.coreGateJudge.<field>) —
 *      when present
 *   3. Hardcoded last-resort literal (LAST_RESORT below)
 *
 *   If the resolved judgeProvider is unsupported or the model id is empty,
 *   the resolver coerces judgeEnabled to false — engine reverts to legacy
 *   threshold-only behaviour rather than crashing on a misconfiguration.
 *
 * CACHING:
 *
 *   AdminSettings is loaded fresh on every call by default (the input is
 *   typically a `.lean()` doc the caller already has). Pass `adminSettings`
 *   explicitly to avoid the load. The Mongo round-trip + .lean() is on the
 *   order of 1ms; we keep this resolver pure rather than carrying a TTL
 *   cache that complicates testability.
 *
 * @module services/engine/kc/CoreGateConfigResolver
 * ============================================================================
 */

const logger = require('../../../utils/logger');

// ─── Hardcoded last-resort defaults ───────────────────────────────────────
// These match the schema defaults (AdminSettings.js globalHub.coreGateJudge).
// Repeated here so a Mongo outage does NOT break Logic 2 — engine still has
// a usable config and reverts to threshold-only when judge can't be reached.
const LAST_RESORT = Object.freeze({
    thresholdHigh:   0.85,
    thresholdLow:    0.65,
    judgeEnabled:    true,
    judgeProvider:   'groq',
    judgeModel:      'llama-3.1-8b-instant',
    judgeTimeoutMs:  200,
});

const SUPPORTED_PROVIDERS = new Set(['groq', 'openai', 'anthropic']);

// ─── Helpers ──────────────────────────────────────────────────────────────

function _firstDefined(...vals) {
    for (const v of vals) {
        if (v !== null && v !== undefined) return v;
    }
    return undefined;
}

function _clampNumber(val, min, max) {
    if (typeof val !== 'number' || !Number.isFinite(val)) return null;
    if (val < min) return min;
    if (val > max) return max;
    return val;
}

// ─── Main resolver ────────────────────────────────────────────────────────

/**
 * Resolve the coregate judge config for a company.
 *
 * @param {object}  args
 * @param {object}  [args.company]        — v2Company doc (optional; null → platform-only)
 * @param {object}  [args.adminSettings]  — AdminSettings doc (optional; loaded if omitted)
 * @returns {Promise<{
 *   thresholdHigh:  number,
 *   thresholdLow:   number,
 *   judgeEnabled:   boolean,
 *   judgeProvider:  string,
 *   judgeModel:     string,
 *   judgeTimeoutMs: number,
 *   _source:        { thresholdHigh: 'tenant'|'platform'|'lastResort', ... }
 * }>}
 */
async function resolveCoreGateConfig({ company, adminSettings } = {}) {
    // Lazy-load AdminSettings if not supplied. Never throws — degraded mode
    // returns last-resort defaults.
    let admin = adminSettings;
    if (!admin) {
        try {
            const AdminSettings = require('../../../models/AdminSettings');
            admin = await AdminSettings.findOne().lean();
        } catch (err) {
            logger.warn('[CoreGateConfigResolver] AdminSettings load failed; using last-resort defaults', {
                error: err.message,
            });
            admin = null;
        }
    }

    const platform = (admin && admin.globalHub && admin.globalHub.coreGateJudge) || {};
    const tenant   = (company
        && company.aiAgentSettings
        && company.aiAgentSettings.agent2
        && company.aiAgentSettings.agent2.speechDetection
        && company.aiAgentSettings.agent2.speechDetection.coreGate) || {};

    // Per-field three-stage fallback. Track the source for observability.
    const source = {};
    const pick = (field) => {
        if (tenant[field] !== null && tenant[field] !== undefined) {
            source[field] = 'tenant';
            return tenant[field];
        }
        if (platform[field] !== null && platform[field] !== undefined) {
            source[field] = 'platform';
            return platform[field];
        }
        source[field] = 'lastResort';
        return LAST_RESORT[field];
    };

    let thresholdHigh   = pick('thresholdHigh');
    let thresholdLow    = pick('thresholdLow');
    let judgeEnabled    = pick('judgeEnabled');
    let judgeProvider   = pick('judgeProvider');
    let judgeModel      = pick('judgeModel');
    let judgeTimeoutMs  = pick('judgeTimeoutMs');

    // ─── Sanity coercions ─────────────────────────────────────────────────
    // These mirror the schema validators — but the resolver runs in the call
    // path against `.lean()` docs that bypass Mongoose validation, so we
    // re-clamp here. Schema enums also bypass on lean reads; we re-check.

    thresholdHigh  = _clampNumber(thresholdHigh,  0.50, 0.99) ?? LAST_RESORT.thresholdHigh;
    thresholdLow   = _clampNumber(thresholdLow,   0.30, 0.90) ?? LAST_RESORT.thresholdLow;
    judgeTimeoutMs = _clampNumber(judgeTimeoutMs, 50,   1000) ?? LAST_RESORT.judgeTimeoutMs;

    if (typeof judgeEnabled !== 'boolean') judgeEnabled = LAST_RESORT.judgeEnabled;

    // Provider must be supported. Bad config → silent fallback to platform default
    // (then last-resort if that's also bad). Never crash a call over a typo.
    if (typeof judgeProvider !== 'string' || !SUPPORTED_PROVIDERS.has(judgeProvider)) {
        logger.warn('[CoreGateConfigResolver] invalid judgeProvider — falling back', {
            requested: judgeProvider,
            supported: Array.from(SUPPORTED_PROVIDERS),
        });
        judgeProvider = LAST_RESORT.judgeProvider;
        judgeEnabled  = false;  // disable judge until config is fixed
        source.judgeProvider = 'lastResort';
    }

    // Empty / non-string model → disable judge rather than send a malformed request.
    if (typeof judgeModel !== 'string' || !judgeModel.trim()) {
        logger.warn('[CoreGateConfigResolver] invalid judgeModel — disabling judge', { requested: judgeModel });
        judgeModel    = LAST_RESORT.judgeModel;
        judgeEnabled  = false;
        source.judgeModel = 'lastResort';
    }

    // Inverted thresholds (low ≥ high) is a config error. Snap to last-resort
    // pair rather than producing an empty ambiguous zone.
    if (thresholdLow >= thresholdHigh) {
        logger.warn('[CoreGateConfigResolver] thresholdLow >= thresholdHigh — snapping to last-resort pair', {
            thresholdLow, thresholdHigh,
        });
        thresholdHigh = LAST_RESORT.thresholdHigh;
        thresholdLow  = LAST_RESORT.thresholdLow;
        source.thresholdHigh = 'lastResort';
        source.thresholdLow  = 'lastResort';
    }

    return {
        thresholdHigh,
        thresholdLow,
        judgeEnabled,
        judgeProvider,
        judgeModel,
        judgeTimeoutMs,
        _source: source,
    };
}

module.exports = {
    resolveCoreGateConfig,
    // Exposed for tests / observability.
    LAST_RESORT,
    SUPPORTED_PROVIDERS,
};
