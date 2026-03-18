// services/streaming/adapters/GroqStreamAdapter.js
//
// ═══════════════════════════════════════════════════════════════════════════════
// GROQ STREAM ADAPTER — Groq LPU inference provider
// ═══════════════════════════════════════════════════════════════════════════════
//
// Uses Groq's OpenAI-compatible REST API via native Node.js fetch.
// Zero additional npm dependencies — works in Node 18+.
//
// ACTIVATION (one-time server setup):
//   1. Get API key at console.groq.com
//   2. Add GROQ_API_KEY to Render env group → Save
//   3. Deploy — done.
//
// PER-COMPANY ACTIVATION (UI):
//   In LLM Agent settings → Provider → select "Groq (Llama)"
//   Each company independently controls their own provider.
//
// PERFORMANCE:
//   Groq LPU: ~100-400ms TTFT vs ~1500-4000ms for Claude Haiku
//   Target: eliminates the need for bridge audio on turn 1
//
// MULTI-TENANT DESIGN:
//   apiKey is always passed per-call (resolved from per-company settings +
//   server env). This adapter never reads env vars directly — the caller
//   is responsible for key resolution and fallback logic.
//
// MODEL TRANSLATION:
//   Companies can keep their Claude model ID in config — we translate to
//   the closest Groq equivalent automatically. Or they can select a Groq
//   model ID directly from the UI.
//
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

const logger = require('../../../utils/logger');

const providerName = 'groq';
const GROQ_API_BASE = 'https://api.groq.com/openai/v1';

// ── Model mapping: translate Claude model IDs → closest Groq equivalents ──────
// Used when a company switches provider without changing modelId.
// If modelId is already a Groq model (non-Claude), it passes through unchanged.
// llama-3.1-70b-versatile was decommissioned by Groq on 2025-01-24.
// All mappings now use llama-3.3-70b-versatile (the official replacement).
const MODEL_MAP = {
    'claude-haiku-4-5-20251001': 'llama-3.3-70b-versatile',
    'claude-haiku-3-5-20241022': 'llama-3.3-70b-versatile',
    'claude-sonnet-4-5':         'llama-3.3-70b-versatile',
    'claude-sonnet-4-6':         'llama-3.3-70b-versatile',
    'claude-opus-4-6':           'llama-3.3-70b-versatile',
    default:                     'llama-3.3-70b-versatile',
};

/**
 * Resolve a model ID to a Groq model name.
 * Non-Claude IDs (e.g. 'llama-3.1-70b-versatile') pass through unchanged,
 * so companies that select a Groq model directly get exactly what they pick.
 *
 * @param {string} modelId  — Claude or Groq model ID
 * @returns {string}         — Groq model ID
 */
// ── Decommissioned Groq models → their replacements ────────────────────────
// Groq periodically retires old model IDs. If a company has a stale model
// saved in config, auto-correct to the replacement instead of sending a
// decommissioned ID to the API (which returns 400).
const DECOMMISSIONED = {
    'llama-3.1-70b-versatile':  'llama-3.3-70b-versatile',  // retired 2025-01-24
    'llama-3.1-8b-instant':     'llama-3.3-70b-versatile',  // retired 2025-01-24
};

function resolveModel(modelId) {
    if (!modelId) return MODEL_MAP.default;
    // Check decommissioned list first — stale config auto-corrects
    if (DECOMMISSIONED[modelId]) return DECOMMISSIONED[modelId];
    if (!modelId.startsWith('claude-')) return modelId;  // already a valid Groq model
    return MODEL_MAP[modelId] || MODEL_MAP.default;
}

// ─────────────────────────────────────────────────────────────────────────────
// streamTokens — async generator, yields raw text fragments via SSE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Async generator that streams tokens from Groq's OpenAI-compatible API.
 * Uses native fetch + hand-rolled SSE parser. No external dependencies.
 *
 * @param {object} opts
 * @param {string}   opts.apiKey       — Groq API key (GROQ_API_KEY)
 * @param {string}   [opts.model]      — Claude or Groq model ID (auto-translated)
 * @param {number}   [opts.maxTokens]  — default 300
 * @param {number}   [opts.temperature]— default 0.4
 * @param {string}   [opts.system]     — system prompt
 * @param {Array}    opts.messages     — OpenAI-format messages
 * @param {string}   [opts.callSid]    — for logging
 * @param {number}   [opts.turn]       — for logging
 * @param {AbortSignal} [opts.signal]  — cancellation signal
 * @yields {string} Text fragment
 * @throws {Error} on API failure (non-abort)
 */
async function* streamTokens(opts) {
    const {
        apiKey,
        model       = 'llama-3.1-70b-versatile',
        maxTokens   = 300,
        temperature = 0.4,
        system,
        messages,
        callSid,
        turn,
        signal,
        jsonMode    = false,  // When true: forces JSON output via response_format
    } = opts;

    if (!apiKey) throw new Error('GROQ_NO_API_KEY');

    const groqModel = resolveModel(model);

    // Groq uses OpenAI chat format — system goes as a message, not a separate field
    const groqMessages = [];
    if (system) groqMessages.push({ role: 'system', content: system });
    if (messages?.length) groqMessages.push(...messages);

    // Build request body — only add response_format when explicitly requested.
    // Groq requires the word "json" to appear in the system prompt when using
    // json_object mode (otherwise returns 400). Intake system prompt satisfies this.
    const requestBody = {
        model:       groqModel,
        max_tokens:  maxTokens,
        temperature,
        messages:    groqMessages,
        stream:      true,
        ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
    };

    let response;
    try {
        response = await fetch(`${GROQ_API_BASE}/chat/completions`, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'Content-Type':  'application/json',
            },
            body: JSON.stringify(requestBody),
            signal,
        });
    } catch (err) {
        if (err.name === 'AbortError') return;  // clean cancellation
        throw new Error(`GROQ_FETCH_ERROR: ${err.message}`);
    }

    if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`GROQ_API_${response.status}: ${errText.slice(0, 200)}`);
    }

    // ── SSE stream parser ────────────────────────────────────────────────────
    // Groq sends: `data: {"choices":[{"delta":{"content":"..."}}]}\n\n`
    // Final line:  `data: [DONE]\n\n`
    const reader    = response.body.getReader();
    const decoder   = new TextDecoder();
    let   sseBuffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            sseBuffer += decoder.decode(value, { stream: true });

            // Split on newlines — last (possibly incomplete) line stays in buffer
            const lines = sseBuffer.split('\n');
            sseBuffer   = lines.pop() ?? '';

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data: ')) continue;

                const data = trimmed.slice(6);
                if (data === '[DONE]') return;

                try {
                    const chunk = JSON.parse(data);
                    const text  = chunk.choices?.[0]?.delta?.content;
                    if (text) yield text;
                } catch {
                    // Malformed SSE chunk — skip silently (Groq occasionally
                    // sends comment lines or empty data lines)
                }
            }
        }
    } catch (err) {
        if (err.name === 'AbortError') return;  // clean cancellation
        logger.warn('[GROQ_ADAPTER] Stream error', { error: err.message, callSid, turn, groqModel });
        throw err;
    } finally {
        try { reader.cancel(); } catch { /* ignore */ }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// streamFull — accumulates complete response, returns StreamResult
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Streams a full response and returns it as a complete string.
 * Same return shape as ClaudeStreamAdapter.streamFull() for drop-in compat.
 *
 * @param {object} opts  — same as streamTokens
 * @returns {Promise<{response, tokensUsed, latencyMs, wasPartial, failureReason}>}
 */
async function streamFull(opts) {
    const startMs = Date.now();
    let   buffer  = '';

    try {
        for await (const token of streamTokens(opts)) {
            buffer += token;
        }
        return {
            response:      buffer || null,
            tokensUsed:    { input: 0, output: 0 },  // Groq SSE stream omits usage counts
            latencyMs:     Date.now() - startMs,
            wasPartial:    false,
            failureReason: buffer ? null : 'EMPTY_RESPONSE',
        };
    } catch (err) {
        return {
            response:      buffer.length >= 40 ? buffer : null,
            tokensUsed:    { input: 0, output: 0 },
            latencyMs:     Date.now() - startMs,
            wasPartial:    buffer.length >= 40,
            failureReason: err.message || 'STREAM_ERROR',
        };
    }
}

module.exports = {
    providerName,
    streamTokens,
    streamFull,
    resolveModel,   // exported for tests
};
