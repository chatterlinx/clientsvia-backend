// services/streaming/adapters/GroqStreamAdapter.js
//
// ═══════════════════════════════════════════════════════════════════════════════
// GROQ STREAM ADAPTER — Groq LPU inference provider (STUB — not yet active)
// ═══════════════════════════════════════════════════════════════════════════════
//
// TO ACTIVATE:
//   1. Open account at console.groq.com → get API key
//   2. Add GROQ_API_KEY to Render env group
//   3. Run: npm install groq-sdk
//   4. Uncomment the implementation below (remove the NOT_CONFIGURED throw)
//   5. In SentenceStreamingService.js change:
//        const adapter = require('./adapters/ClaudeStreamAdapter');
//      to:
//        const adapter = require('./adapters/GroqStreamAdapter');
//   6. Deploy — done. No other files change.
//
// RECOMMENDED MODEL: llama-3.1-70b-versatile
//   ~100-300ms inference vs ~500-1000ms for Claude Haiku
//   OpenAI-compatible API — same message format, same streaming protocol
//
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

// const Groq = require('groq-sdk');  // npm install groq-sdk when ready
const logger = require('../../../utils/logger');

const providerName = 'groq';

// ── Model mapping: pass the same Claude model IDs and we translate ────────────
const MODEL_MAP = {
  'claude-haiku-4-5-20251001': 'llama-3.1-70b-versatile',  // primary swap
  'claude-haiku-3-5-20241022': 'llama-3.1-70b-versatile',
  'claude-sonnet-4-5':         'llama-3.3-70b-versatile',  // heavier calls
  default:                     'llama-3.1-70b-versatile',
};

function resolveModel(claudeModelId) {
  return MODEL_MAP[claudeModelId] || MODEL_MAP.default;
}

// ─────────────────────────────────────────────────────────────────────────────
// streamTokens — async generator (STUB until GROQ_API_KEY is set)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {import('./LLMStreamAdapter').StreamOpts} opts
 * @yields {string}
 */
async function* streamTokens(opts) {
  // ── STUB: throw until activated ──────────────────────────────────────────
  throw new Error('GROQ_NOT_CONFIGURED — see activation steps at top of GroqStreamAdapter.js');

  /* ── IMPLEMENTATION (uncomment when ready) ────────────────────────────────
  const {
    apiKey,
    model       = 'claude-haiku-4-5-20251001',
    maxTokens   = 300,
    temperature = 0.4,
    system,
    messages,
    callSid,
    turn,
    signal,
  } = opts;

  if (!apiKey) throw new Error('GROQ_NO_API_KEY');

  const groqModel = resolveModel(model);
  const client    = new Groq({ apiKey });

  // Groq uses OpenAI-compatible format — system prompt goes in messages array
  const groqMessages = [
    { role: 'system', content: system },
    ...messages,
  ];

  const stream = await client.chat.completions.create({
    model:       groqModel,
    max_tokens:  maxTokens,
    temperature,
    messages:    groqMessages,
    stream:      true,
  });

  // Respect external abort signal
  if (signal) {
    signal.addEventListener('abort', () => {
      try { stream.controller.abort(); } catch { }
    }, { once: true });
  }

  try {
    for await (const chunk of stream) {
      const text = chunk.choices?.[0]?.delta?.content;
      if (text) yield text;
    }
  } catch (err) {
    logger.warn('[GROQ_ADAPTER] Stream error', { error: err.message, callSid, turn });
    throw err;
  }
  ─────────────────────────────────────────────────────────────────────────── */
}

// ─────────────────────────────────────────────────────────────────────────────
// streamFull — convenience wrapper
// ─────────────────────────────────────────────────────────────────────────────

async function streamFull(opts) {
  const startMs = Date.now();
  let   buffer  = '';

  try {
    for await (const token of streamTokens(opts)) {
      buffer += token;
    }
    return {
      response:      buffer || null,
      tokensUsed:    { input: 0, output: 0 },
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
  resolveModel,  // exported for testing
};
