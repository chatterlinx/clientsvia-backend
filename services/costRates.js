// services/costRates.js
//
// ═══════════════════════════════════════════════════════════════════════════
// COST RATES RESOLVER — single source of truth for LLM / TTS pricing
// ═══════════════════════════════════════════════════════════════════════════
//
// Commit 2 (2026-04-21). Called from every cost-computation site so that
// per-company overrides set in the Agent Studio "Cost & Billing" tab are
// always respected. When a field is not set on company.costConfig, we fall
// back to the corresponding env var, and finally to a hardcoded default.
//
// Shape returned:
//   {
//     claude:     { inPerM, outPerM, tier },
//     groq:       { inPerM, outPerM, tier },
//     elevenlabs: { perKChars, tier },
//     deepgram:   { perMin, tier },
//     twilio:     { perMin, tier },
//     _source:    'company' | 'env' | 'default'    // for UI debugging
//   }
//
// Zero-cost: no I/O, pure function, safe to call on every turn.

'use strict';

// ── Hardcoded defaults (match existing KCDiscoveryRunner + Agent2 + TTS) ──
const DEFAULTS = Object.freeze({
    claude:     { inPerM: 3.00, outPerM: 15.00, tier: 'Sonnet 4.5 (list price)' },
    groq:       { inPerM: 0.59, outPerM: 0.79,  tier: 'Llama 3.3 70B (list price)' },
    elevenlabs: { perKChars: 0.30,              tier: 'Turbo v2.5 (list price)' },
    deepgram:   { perMin: 0.0043,               tier: 'Nova-2 streaming (list price)' },
    twilio:     { perMin: 0.0085,               tier: 'Voice (list price)' },
});

// ── Env var fallbacks (match existing names so deploys don't break) ──
function envNum(name) {
    const v = parseFloat(process.env[name]);
    return Number.isFinite(v) && v >= 0 ? v : null;
}

function envRates() {
    return {
        claude: {
            inPerM:  envNum('KC_COST_CLAUDE_IN_PER_M')  ?? DEFAULTS.claude.inPerM,
            outPerM: envNum('KC_COST_CLAUDE_OUT_PER_M') ?? DEFAULTS.claude.outPerM,
            tier:    DEFAULTS.claude.tier,
        },
        groq: {
            inPerM:  envNum('KC_COST_GROQ_IN_PER_M')  ?? DEFAULTS.groq.inPerM,
            outPerM: envNum('KC_COST_GROQ_OUT_PER_M') ?? DEFAULTS.groq.outPerM,
            tier:    DEFAULTS.groq.tier,
        },
        elevenlabs: {
            perKChars: envNum('KC_COST_ELEVENLABS_PER_K_CHARS') ?? DEFAULTS.elevenlabs.perKChars,
            tier:      DEFAULTS.elevenlabs.tier,
        },
        deepgram: {
            perMin: envNum('KC_COST_DEEPGRAM_PER_MIN') ?? DEFAULTS.deepgram.perMin,
            tier:   DEFAULTS.deepgram.tier,
        },
        twilio: {
            perMin: envNum('KC_COST_TWILIO_PER_MIN') ?? DEFAULTS.twilio.perMin,
            tier:   DEFAULTS.twilio.tier,
        },
    };
}

/**
 * Resolve effective cost rates for a company.
 * company.costConfig fields override env vars; env overrides defaults.
 *
 * @param {object|null} company   Company document (lean or full); null → env/defaults only
 * @returns {object}              Full rates object
 */
function getRates(company) {
    const env = envRates();
    const cc  = (company && company.costConfig) || {};

    const pickNum = (v, fallback) => (typeof v === 'number' && v >= 0) ? v : fallback;
    const pickStr = (v, fallback) => (typeof v === 'string' && v.trim()) ? v.trim() : fallback;

    let source = 'env';
    const hasAnyOverride = (o) => o && (
        typeof o.inPerM    === 'number' ||
        typeof o.outPerM   === 'number' ||
        typeof o.perKChars === 'number' ||
        typeof o.perMin    === 'number' ||
        (typeof o.tier === 'string' && o.tier.trim())
    );
    if (hasAnyOverride(cc.claude) || hasAnyOverride(cc.groq) ||
        hasAnyOverride(cc.elevenlabs) || hasAnyOverride(cc.deepgram) ||
        hasAnyOverride(cc.twilio)) {
        source = 'company';
    }

    return {
        claude: {
            inPerM:  pickNum(cc.claude?.inPerM,  env.claude.inPerM),
            outPerM: pickNum(cc.claude?.outPerM, env.claude.outPerM),
            tier:    pickStr(cc.claude?.tier,    env.claude.tier),
        },
        groq: {
            inPerM:  pickNum(cc.groq?.inPerM,  env.groq.inPerM),
            outPerM: pickNum(cc.groq?.outPerM, env.groq.outPerM),
            tier:    pickStr(cc.groq?.tier,    env.groq.tier),
        },
        elevenlabs: {
            perKChars: pickNum(cc.elevenlabs?.perKChars, env.elevenlabs.perKChars),
            tier:      pickStr(cc.elevenlabs?.tier,      env.elevenlabs.tier),
        },
        deepgram: {
            perMin: pickNum(cc.deepgram?.perMin, env.deepgram.perMin),
            tier:   pickStr(cc.deepgram?.tier,   env.deepgram.tier),
        },
        twilio: {
            perMin: pickNum(cc.twilio?.perMin, env.twilio.perMin),
            tier:   pickStr(cc.twilio?.tier,   env.twilio.tier),
        },
        notes:   pickStr(cc.notes, null),
        _source: source,
    };
}

/**
 * Compute Claude USD cost from token counts using effective rates.
 * @param {object} tokensUsed  { input, output }
 * @param {object} company     Company doc (for rate overrides)
 * @returns {number}           USD, rounded to 6 decimals; 0 if no tokens
 */
function computeClaudeCost(tokensUsed, company) {
    const t = tokensUsed || {};
    const inTok  = t.input  || 0;
    const outTok = t.output || 0;
    if (inTok === 0 && outTok === 0) return 0;
    const r = getRates(company).claude;
    const usd = (inTok / 1_000_000) * r.inPerM + (outTok / 1_000_000) * r.outPerM;
    return Math.round(usd * 1_000_000) / 1_000_000;
}

function computeGroqCost(tokensUsed, company) {
    const t = tokensUsed || {};
    const inTok  = t.input  || 0;
    const outTok = t.output || 0;
    if (inTok === 0 && outTok === 0) return 0;
    const r = getRates(company).groq;
    const usd = (inTok / 1_000_000) * r.inPerM + (outTok / 1_000_000) * r.outPerM;
    return Math.round(usd * 1_000_000) / 1_000_000;
}

function computeElevenLabsCost(chars, company) {
    const n = Number(chars) || 0;
    if (n <= 0) return 0;
    const r = getRates(company).elevenlabs;
    const usd = (n / 1000) * r.perKChars;
    return Math.round(usd * 1_000_000) / 1_000_000;
}

// ── WithMeta variants — return { usd, rate } so call sites can stamp the ──
// exact tier/rate used onto each qaLog event (enables the Cost Breakdown
// drawer to show "Sonnet 4.5 (enterprise) @ $2.50/M" per line).
function _meta(r, kind) {
    if (kind === 'elevenlabs') return { tier: r.tier, perKChars: r.perKChars };
    return { tier: r.tier, inPerM: r.inPerM, outPerM: r.outPerM };
}

function computeClaudeCostWithMeta(tokensUsed, company) {
    const rates = getRates(company);
    return { usd: computeClaudeCost(tokensUsed, company), rate: { ..._meta(rates.claude, 'llm'), source: rates._source } };
}

function computeGroqCostWithMeta(tokensUsed, company) {
    const rates = getRates(company);
    return { usd: computeGroqCost(tokensUsed, company), rate: { ..._meta(rates.groq, 'llm'), source: rates._source } };
}

function computeElevenLabsCostWithMeta(chars, company) {
    const rates = getRates(company);
    return { usd: computeElevenLabsCost(chars, company), rate: { ..._meta(rates.elevenlabs, 'elevenlabs'), source: rates._source } };
}

module.exports = {
    DEFAULTS,
    getRates,
    computeClaudeCost,
    computeGroqCost,
    computeElevenLabsCost,
    computeClaudeCostWithMeta,
    computeGroqCostWithMeta,
    computeElevenLabsCostWithMeta,
};
