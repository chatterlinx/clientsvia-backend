// services/streaming/adapters/ClaudeStreamAdapter.js
//
// ═══════════════════════════════════════════════════════════════════════════════
// CLAUDE STREAM ADAPTER — Anthropic provider implementation
// ═══════════════════════════════════════════════════════════════════════════════
//
// Implements the LLMStreamAdapter interface for Anthropic Claude.
// Uses the @anthropic-ai/sdk streaming API to yield tokens as they arrive.
//
// This adapter is the ONLY file that imports @anthropic-ai/sdk.
// Swap it for GroqStreamAdapter to switch providers — nothing else changes.
//
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger    = require('../../../utils/logger');

const providerName = 'claude';

// ── Default model fallback (overridden by opts.model from llmAgentDefaults) ──
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

// ─────────────────────────────────────────────────────────────────────────────
// streamTokens — async generator, yields raw text fragments as they arrive
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Async generator that streams tokens from Anthropic Claude.
 *
 * @param {import('./LLMStreamAdapter').StreamOpts} opts
 * @yields {string} Text fragment
 * @throws {Error} on API failure
 */
async function* streamTokens(opts) {
  const {
    apiKey,
    model       = DEFAULT_MODEL,
    maxTokens   = 300,
    temperature = 0.4,
    system,
    messages,
    callSid,
    turn,
    signal,
  } = opts;

  if (!apiKey) throw new Error('CLAUDE_NO_API_KEY');

  const client = new Anthropic({ apiKey });

  const stream = client.messages.stream({
    model,
    max_tokens:  maxTokens,
    temperature,
    system,
    messages,
  });

  // Respect external abort signal
  if (signal) {
    signal.addEventListener('abort', () => {
      try { stream.abort(); } catch { /* ignore */ }
    }, { once: true });
  }

  try {
    for await (const event of stream) {
      // ContentBlockDelta events carry the text tokens
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta' &&
        event.delta?.text
      ) {
        yield event.delta.text;
      }
    }
  } catch (err) {
    logger.warn('[CLAUDE_ADAPTER] Stream error', {
      error:   err.message,
      callSid,
      turn,
    });
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// streamFull — convenience wrapper, returns complete StreamResult
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Streams full response from Claude, returns complete text.
 *
 * @param {import('./LLMStreamAdapter').StreamOpts} opts
 * @returns {Promise<import('./LLMStreamAdapter').StreamResult>}
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
      tokensUsed:    { input: 0, output: 0 },  // Anthropic SDK stream doesn't expose usage mid-stream
      latencyMs:     Date.now() - startMs,
      wasPartial:    false,
      failureReason: buffer ? null : 'EMPTY_RESPONSE',
    };
  } catch (err) {
    return {
      response:      buffer.length >= 40 ? buffer : null,  // return partial if usable
      tokensUsed:    { input: 0, output: 0 },
      latencyMs:     Date.now() - startMs,
      wasPartial:    buffer.length >= 40,
      failureReason: err.message || 'STREAM_ERROR',
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  providerName,
  streamTokens,
  streamFull,
};
