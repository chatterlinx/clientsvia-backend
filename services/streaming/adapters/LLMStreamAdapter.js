// services/streaming/adapters/LLMStreamAdapter.js
//
// ═══════════════════════════════════════════════════════════════════════════════
// LLM STREAM ADAPTER — Provider-Agnostic Interface Contract
// ═══════════════════════════════════════════════════════════════════════════════
//
// All LLM provider adapters MUST implement this interface so that the
// SentenceStreamingService can be swapped between Claude, Groq, or any future
// provider without touching downstream code.
//
// SUPPORTED PROVIDERS:
//   ClaudeStreamAdapter  — Anthropic Claude (current)
//   GroqStreamAdapter    — Groq LPU inference (future — stub ready)
//
// TO ADD A NEW PROVIDER:
//   1. Copy GroqStreamAdapter.js
//   2. Implement the stream() method below
//   3. Pass the adapter to SentenceStreamingService
//   That's it. Nothing else changes.
//
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

/**
 * LLMStreamAdapter — interface contract (JSDoc only, not enforced at runtime)
 *
 * All adapter implementations must export an object with this shape:
 *
 * @typedef {Object} LLMStreamAdapter
 *
 * @property {string} providerName
 *   Human-readable provider label (e.g. 'claude', 'groq').
 *   Used in logs and event payloads.
 *
 * @property {function(StreamOpts): AsyncGenerator<string>} streamTokens
 *   Async generator that yields raw text tokens as they arrive from the
 *   provider. Each yield is a string fragment (may be a word, partial word,
 *   or punctuation). Throws on unrecoverable failure.
 *
 *   The generator MUST:
 *   - Yield tokens as soon as they arrive (do not buffer internally)
 *   - Throw with a descriptive Error on API failure
 *   - Respect the abortSignal in opts if provided
 *
 * @property {function(StreamOpts): Promise<StreamResult>} streamFull
 *   Convenience wrapper — streams full response, returns complete text.
 *   Adapters may delegate to streamTokens internally.
 *   Returns a StreamResult object (see below).
 */

/**
 * @typedef {Object} StreamOpts
 * @property {string}   apiKey       — Provider API key
 * @property {string}   model        — Model ID
 * @property {number}   maxTokens    — Max output tokens
 * @property {number}   temperature  — Temperature (0-1)
 * @property {string}   system       — System prompt
 * @property {Array}    messages     — [{ role: 'user'|'assistant', content: string }]
 * @property {string}   [callSid]    — Twilio CallSid (for logs)
 * @property {number}   [turn]       — Turn number (for logs)
 * @property {AbortSignal} [signal]  — Optional abort signal
 */

/**
 * @typedef {Object} StreamResult
 * @property {string|null} response      — Full response text (null on failure)
 * @property {Object}      tokensUsed    — { input: number, output: number }
 * @property {number}      latencyMs     — Total streaming latency
 * @property {boolean}     wasPartial    — True if ceiling cut the response short
 * @property {string|null} failureReason — Failure code or null on success
 */

// This file is documentation only — no runtime exports needed.
// Import adapters directly:
//   const ClaudeStreamAdapter = require('./ClaudeStreamAdapter');
//   const GroqStreamAdapter   = require('./GroqStreamAdapter');

module.exports = {};
