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
 * Streams full response from Claude, returns complete text WITH real token counts.
 * Uses the stream object directly (not through streamTokens generator) so we can
 * capture message_start / message_delta usage events.
 *
 * @param {import('./LLMStreamAdapter').StreamOpts} opts
 * @returns {Promise<import('./LLMStreamAdapter').StreamResult>}
 */
async function streamFull(opts) {
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

  const startMs = Date.now();
  let   buffer  = '';
  const usage   = { input: 0, output: 0 };

  if (!apiKey) {
    return { response: null, tokensUsed: usage, latencyMs: 0, wasPartial: false, failureReason: 'CLAUDE_NO_API_KEY' };
  }

  const client = new Anthropic({ apiKey });
  const stream = client.messages.stream({ model, max_tokens: maxTokens, temperature, system, messages });

  if (signal) {
    signal.addEventListener('abort', () => {
      try { stream.abort(); } catch { /* ignore */ }
    }, { once: true });
  }

  try {
    for await (const event of stream) {
      // Capture input token count from message_start
      if (event.type === 'message_start' && event.message?.usage?.input_tokens) {
        usage.input = event.message.usage.input_tokens;
      }
      // Capture output token count from message_delta (running total)
      if (event.type === 'message_delta' && event.usage?.output_tokens) {
        usage.output = event.usage.output_tokens;
      }
      // Accumulate text
      if (
        event.type === 'content_block_delta' &&
        event.delta?.type === 'text_delta' &&
        event.delta?.text
      ) {
        buffer += event.delta.text;
      }
    }

    return {
      response:      buffer || null,
      tokensUsed:    usage,
      latencyMs:     Date.now() - startMs,
      wasPartial:    false,
      failureReason: buffer ? null : 'EMPTY_RESPONSE',
    };
  } catch (err) {
    logger.warn('[CLAUDE_ADAPTER] streamFull error', { error: err.message, callSid, turn });
    return {
      response:      buffer.length >= 40 ? buffer : null,
      tokensUsed:    usage,  // may have partial counts from events before the error
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
