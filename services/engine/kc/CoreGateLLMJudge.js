'use strict';

/**
 * ============================================================================
 * CoreGateLLMJudge — ambiguous-zone disambiguator for UAP Logic 2
 * ============================================================================
 *
 * WHY THIS EXISTS:
 *
 *   The new three-tier core gate dispatch (per CoreGateConfigResolver)
 *   handles the easy cases with a per-phrase MAX cosine: ≥ thresholdHigh
 *   → strict_pass, < thresholdLow → definite_fail. The middle band — real
 *   paraphrases that scored low AND anchor-false-positives that scored
 *   medium-high — cannot be separated by any threshold pair (cross-section
 *   audits proved this: section 1 needs different cutoffs than section 2,
 *   no linear gate works for both).
 *
 *   The judge resolves the middle band with one cheap LLM call. Given the
 *   section's content + callerPhrases + anchors and the caller's raw input,
 *   the model returns a strict pass/fail JSON verdict. We only call it on
 *   ~10-20% of evals (those that fall in the ambiguous zone) so the latency
 *   and cost stay bounded.
 *
 * INTERFACE:
 *
 *   const judge = require('./CoreGateLLMJudge');
 *   const result = await judge.judgeMatch({
 *     companyId,         // for cache key + observability
 *     sectionId,         // for cache key
 *     sectionLabel,      // for prompt context
 *     sectionContent,    // first ~500 chars of section content
 *     callerPhrases,     // array of strings (the section's expected callerPhrases.text)
 *     anchorWords,       // optional unique anchors across the section
 *     rawInput,          // exact caller utterance (cache key + prompt)
 *     perPhraseMAX,      // optional float — for prompt context only
 *     timeoutMs,         // hard timeout (ms)
 *     model,             // e.g. 'llama-3.1-8b-instant'
 *     provider,          // 'groq' (currently the only supported)
 *   });
 *   // → { verdict: 'pass'|'fail', confidence: 0-1, reason, latencyMs,
 *   //     cached: boolean, model, provider, cacheKey }
 *
 * BEHAVIOUR:
 *
 *   - Always returns OR throws. On success: returns the verdict. On any
 *     error (timeout, provider non-200, parse failure, missing API key):
 *     throws with a tagged error code (e.g. 'JUDGE_TIMEOUT',
 *     'JUDGE_PROVIDER_ERROR'). Caller is responsible for incrementing the
 *     circuit breaker via CoreGateJudgeCircuitBreaker.recordFailure().
 *
 *   - Caches results in Redis with key
 *       kc:judge:{companyId}:{sectionId}:{md5(rawInput)}   (TTL 1h)
 *     Cache hit → returns the stored verdict with latencyMs ~ 0 + cached:true.
 *     Caller still records success on a cached hit (the section/input pair
 *     is healthy as far as we know).
 *
 *   - This module does NOT call the circuit breaker itself — separation of
 *     concerns. Caller checks isOpen() before calling, and records the
 *     outcome (success/failure) afterwards.
 *
 * MULTI-TENANT SAFETY:
 *
 *   - Zero hardcoded tenant references in the prompt.
 *   - Cache key includes companyId so tenants never see each other's
 *     cached verdicts. Section label/content also vary per tenant so even
 *     a md5 collision on rawInput cannot cross-pollute.
 *   - API key is platform-wide (process.env.GROQ_API_KEY) — the judge is
 *     platform infra, parallel to embedding/STT services. Per-tenant keys
 *     are out of scope for this rev.
 *
 * @module services/engine/kc/CoreGateLLMJudge
 * ============================================================================
 */

const crypto = require('crypto');
const logger = require('../../../utils/logger');

// ─── Tunables ─────────────────────────────────────────────────────────────
const CACHE_TTL_S       = 3600;            // 1h — verdicts are stable for an input
const SECTION_SNIPPET_MAX = 500;           // chars of section content to include in prompt
const PHRASES_MAX       = 8;               // max callerPhrases shown in prompt (avoid token bloat)
const RAW_INPUT_MAX     = 240;             // chars of caller input shown (long inputs are usually noisy)

// ─── Provider endpoints ───────────────────────────────────────────────────
const GROQ_API_BASE     = 'https://api.groq.com/openai/v1';

// ─── Redis client (lazy, best-effort cache) ───────────────────────────────
let _redisFactory = null;
function _loadRedisFactory() {
    if (_redisFactory !== null) return _redisFactory;
    try {
        _redisFactory = require('../../redisClientFactory');
    } catch (_err) {
        _redisFactory = false;
    }
    return _redisFactory;
}

async function _getRedis() {
    const factory = _loadRedisFactory();
    if (!factory || typeof factory.getSharedRedisClient !== 'function') return null;
    try { return await factory.getSharedRedisClient(); } catch (_err) { return null; }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function _md5(s) {
    return crypto.createHash('md5').update(String(s || '')).digest('hex');
}

function _truncate(s, n) {
    s = String(s || '');
    return s.length > n ? s.slice(0, n) + '…' : s;
}

function _buildCacheKey({ companyId, sectionId, rawInput }) {
    return `kc:judge:${companyId || 'noco'}:${sectionId || 'nosec'}:${_md5(rawInput)}`;
}

// ─── Prompt builder ───────────────────────────────────────────────────────
//
// The system prompt is intentionally short and rule-based. The model needs
// to be permissive on real paraphrases (a caller saying "do I have to PAY
// AGAIN" matches a "Do I have to pay again" section even if word order
// differs) but strict on anchor-false-positives (a caller saying "do I have
// to PAY for parking AGAIN" is asking about parking, not the section's
// topic). The word "json" appears so Groq accepts response_format=json_object.

const SYSTEM_PROMPT =
    'You are a strict semantic-match judge for a phone agent. Decide whether the ' +
    'caller\'s utterance is asking about THIS specific knowledge base section, or ' +
    'about a DIFFERENT topic that happens to share keywords. Respond with a single ' +
    'JSON object only. Do not include any prose outside the JSON.\n\n' +
    'Output schema:\n' +
    '  { "verdict": "pass" | "fail", "confidence": 0.0..1.0, "reason": "<≤140 char explanation>" }\n\n' +
    'Rules:\n' +
    '1. "pass" iff the caller\'s intent is the same topic this section answers. ' +
    'Paraphrases, reordered words, and synonyms are fine.\n' +
    '2. "fail" if the caller is asking about a different domain (parking vs. service, ' +
    'a car vs. an HVAC unit, fitness vs. health, etc.) even when keywords overlap.\n' +
    '3. "fail" if the caller is making a statement / narrative rather than asking the ' +
    'question this section answers.\n' +
    '4. Be brief: reason MUST be a short clause, not a sentence with citations.\n' +
    '5. Output the JSON object and nothing else.';

function _buildUserPrompt({ sectionLabel, sectionContent, callerPhrases, anchorWords, rawInput, perPhraseMAX }) {
    const phrases = Array.isArray(callerPhrases) ? callerPhrases.slice(0, PHRASES_MAX) : [];
    const anchors = Array.isArray(anchorWords) ? anchorWords.slice(0, 12) : [];

    let prompt = '';
    prompt += `SECTION LABEL: ${_truncate(sectionLabel || '(unlabelled)', 120)}\n`;
    prompt += `SECTION CONTENT: ${_truncate(sectionContent || '(no content)', SECTION_SNIPPET_MAX)}\n`;

    if (phrases.length) {
        prompt += `\nThis section is for callers asking things like:\n`;
        phrases.forEach((p, i) => { prompt += `  ${i + 1}. ${_truncate(p, 120)}\n`; });
    }
    if (anchors.length) {
        prompt += `\nAnchor words for this section: [${anchors.join(', ')}]\n`;
    }
    if (typeof perPhraseMAX === 'number' && Number.isFinite(perPhraseMAX)) {
        prompt += `\n(Embedding similarity to closest expected phrase: ${perPhraseMAX.toFixed(3)} — ` +
                  `in the ambiguous zone, hence this judgment.)\n`;
    }

    prompt += `\nCALLER UTTERANCE: "${_truncate(rawInput, RAW_INPUT_MAX)}"\n`;
    prompt += `\nIs the caller asking the question this section answers? Respond with json only.`;
    return prompt;
}

// ─── Provider call (Groq) ─────────────────────────────────────────────────
//
// One-shot non-streaming JSON-mode call. Hard timeout via AbortController so
// the judge respects timeoutMs even if Groq stalls in the middle of streaming
// a response. We do NOT go through GroqStreamAdapter because:
//   - We want a single JSON object, not a token stream.
//   - GroqStreamAdapter rewrites llama-3.1-8b-instant → llama-3.3-70b-versatile
//     via its DECOMMISSIONED map (8b-instant is actually still active on
//     Groq's API today, per config/llmAgentDefaults.js extractionModel usage).
//     Going direct preserves the exact model id from config.

async function _callGroq({ apiKey, model, system, user, timeoutMs }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let resp;
    try {
        resp = await fetch(`${GROQ_API_BASE}/chat/completions`, {
            method:  'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify({
                model,
                max_tokens:      120,                 // verdict + short reason fits comfortably
                temperature:     0,                   // deterministic
                response_format: { type: 'json_object' },
                messages: [
                    { role: 'system', content: system },
                    { role: 'user',   content: user   },
                ],
            }),
            signal: controller.signal,
        });
    } catch (err) {
        clearTimeout(timer);
        if (err.name === 'AbortError') {
            const e = new Error('JUDGE_TIMEOUT');
            e.code = 'JUDGE_TIMEOUT';
            throw e;
        }
        const e = new Error(`JUDGE_FETCH_ERROR: ${err.message}`);
        e.code = 'JUDGE_FETCH_ERROR';
        throw e;
    }
    clearTimeout(timer);

    if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        const e = new Error(`JUDGE_PROVIDER_${resp.status}: ${text.slice(0, 160)}`);
        e.code = 'JUDGE_PROVIDER_ERROR';
        e.status = resp.status;
        throw e;
    }

    const json = await resp.json().catch(() => null);
    const content = json?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
        const e = new Error('JUDGE_EMPTY_RESPONSE');
        e.code = 'JUDGE_EMPTY_RESPONSE';
        throw e;
    }
    return content;
}

// ─── Verdict parser ───────────────────────────────────────────────────────

function _parseVerdict(rawJsonStr) {
    let parsed;
    try { parsed = JSON.parse(rawJsonStr); } catch (_e) {
        const e = new Error('JUDGE_PARSE_ERROR');
        e.code = 'JUDGE_PARSE_ERROR';
        e.rawSnippet = String(rawJsonStr || '').slice(0, 160);
        throw e;
    }

    const verdict = String(parsed.verdict || '').toLowerCase().trim();
    if (verdict !== 'pass' && verdict !== 'fail') {
        const e = new Error(`JUDGE_BAD_VERDICT: ${verdict}`);
        e.code = 'JUDGE_BAD_VERDICT';
        throw e;
    }
    let confidence = Number(parsed.confidence);
    if (!Number.isFinite(confidence)) confidence = (verdict === 'pass') ? 0.7 : 0.7;
    if (confidence < 0) confidence = 0;
    if (confidence > 1) confidence = 1;

    const reason = String(parsed.reason || '').slice(0, 200);

    return { verdict, confidence, reason };
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Judge whether a caller utterance matches a candidate KC section.
 *
 * @param {object} args
 * @param {string} args.companyId
 * @param {string} args.sectionId
 * @param {string} args.sectionLabel
 * @param {string} args.sectionContent
 * @param {string[]} args.callerPhrases     Array of expected phrase texts.
 * @param {string[]} [args.anchorWords]     Anchor words for the section.
 * @param {string} args.rawInput            Caller utterance.
 * @param {number} [args.perPhraseMAX]      Optional context (embedding cosine).
 * @param {number} args.timeoutMs           Hard timeout in ms.
 * @param {string} args.model               Provider model id.
 * @param {string} args.provider            'groq' (currently only supported).
 * @returns {Promise<{verdict, confidence, reason, latencyMs, cached, model, provider, cacheKey}>}
 * @throws Tagged error: JUDGE_NO_API_KEY | JUDGE_UNSUPPORTED_PROVIDER |
 *                       JUDGE_TIMEOUT | JUDGE_FETCH_ERROR | JUDGE_PROVIDER_ERROR |
 *                       JUDGE_EMPTY_RESPONSE | JUDGE_PARSE_ERROR | JUDGE_BAD_VERDICT
 */
async function judgeMatch(args) {
    const {
        companyId,
        sectionId,
        sectionLabel,
        sectionContent,
        callerPhrases = [],
        anchorWords   = [],
        rawInput,
        perPhraseMAX,
        timeoutMs     = 200,
        model,
        provider      = 'groq',
    } = args || {};

    if (provider !== 'groq') {
        const e = new Error(`JUDGE_UNSUPPORTED_PROVIDER: ${provider}`);
        e.code = 'JUDGE_UNSUPPORTED_PROVIDER';
        throw e;
    }
    if (!model || typeof model !== 'string') {
        const e = new Error('JUDGE_NO_MODEL');
        e.code = 'JUDGE_NO_MODEL';
        throw e;
    }
    if (typeof rawInput !== 'string' || !rawInput.trim()) {
        const e = new Error('JUDGE_NO_INPUT');
        e.code = 'JUDGE_NO_INPUT';
        throw e;
    }

    const cacheKey = _buildCacheKey({ companyId, sectionId, rawInput });

    // ─── Cache lookup ────────────────────────────────────────────────────
    try {
        const redis = await _getRedis();
        if (redis) {
            const hit = await redis.get(cacheKey);
            if (hit) {
                try {
                    const parsed = JSON.parse(hit);
                    return {
                        verdict:    parsed.verdict,
                        confidence: parsed.confidence,
                        reason:     parsed.reason,
                        latencyMs:  0,
                        cached:     true,
                        model,
                        provider,
                        cacheKey,
                    };
                } catch (_e) {
                    // Bad cache entry — drop it and fall through to fresh call.
                    try { await redis.del(cacheKey); } catch (_e2) { /* */ }
                }
            }
        }
    } catch (_err) { /* cache is best-effort */ }

    // ─── API key resolution ──────────────────────────────────────────────
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || !apiKey.trim()) {
        const e = new Error('JUDGE_NO_API_KEY');
        e.code = 'JUDGE_NO_API_KEY';
        throw e;
    }

    // ─── Provider call ───────────────────────────────────────────────────
    const userPrompt = _buildUserPrompt({
        sectionLabel, sectionContent, callerPhrases, anchorWords, rawInput, perPhraseMAX,
    });

    const t0 = Date.now();
    const rawJson = await _callGroq({
        apiKey,
        model,
        system: SYSTEM_PROMPT,
        user:   userPrompt,
        timeoutMs,
    });
    const verdict = _parseVerdict(rawJson);
    const latencyMs = Date.now() - t0;

    // ─── Cache write (best-effort) ───────────────────────────────────────
    try {
        const redis = await _getRedis();
        if (redis) {
            await redis.set(cacheKey, JSON.stringify(verdict), { EX: CACHE_TTL_S });
        }
    } catch (_err) { /* not fatal */ }

    logger.debug('[CoreGateLLMJudge] verdict', {
        companyId, sectionId, verdict: verdict.verdict, confidence: verdict.confidence,
        latencyMs, model, perPhraseMAX,
    });

    return {
        ...verdict,
        latencyMs,
        cached: false,
        model,
        provider,
        cacheKey,
    };
}

module.exports = {
    judgeMatch,
    // exposed for tests / observability
    SYSTEM_PROMPT,
    CACHE_TTL_S,
    _buildCacheKey,
    _buildUserPrompt,
    _parseVerdict,
};
