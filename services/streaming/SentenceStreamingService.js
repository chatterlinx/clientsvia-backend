// services/streaming/SentenceStreamingService.js
//
// ═══════════════════════════════════════════════════════════════════════════════
// SENTENCE STREAMING SERVICE — First-sentence-fast LLM → TTS pipeline
// ═══════════════════════════════════════════════════════════════════════════════
//
// PROBLEM SOLVED:
//   Old system: wait for FULL LLM response → then ElevenLabs → then caller hears
//   New system: first sentence arrives (~150ms) → ElevenLabs starts immediately
//               while LLM generates sentence 2, caller already hears sentence 1
//
// ARCHITECTURE:
//
//   ┌──────────────────┐  tokens   ┌──────────────────────┐  sentence[]
//   │  LLM Adapter     │──────────▶│  SentenceSplitter     │────────────▶ onSentence()
//   │  (Claude/Groq)   │           │  (boundary detection) │
//   └──────────────────┘           └──────────────────────┘
//                                                              ↓
//                                                    ┌─────────────────┐
//                                                    │ Redis heartbeat  │
//                                                    │ (same keys as    │
//                                                    │  ClaudeStreaming) │
//                                                    └─────────────────┘
//
// PROVIDER SWAP:
//   Change the adapter import at line ~80 to switch providers.
//   Everything downstream is identical.
//
// EXPORTS:
//   streamWithSentences(opts)  → same return shape as streamWithHeartbeat()
//                                drop-in replacement in Agent2DiscoveryRunner
//
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

const logger                        = require('../../utils/logger');
const { HeartbeatWriter, resultKey, DEFAULTS } = require('./ClaudeStreamingService');

// ── Adapter registry — lazy-loaded, resolved per call for multi-tenant safety ─
// Never use a module-level constant: different companies may use different
// providers in the same running process. Lazy-require avoids circular deps
// and keeps startup fast when only one provider is ever used.
const _adapterCache = {};

function resolveAdapter(provider) {
    const key = (provider || 'anthropic').toLowerCase();
    if (!_adapterCache[key]) {
        if (key === 'groq') {
            _adapterCache[key] = require('./adapters/GroqStreamAdapter');
        } else {
            _adapterCache[key] = require('./adapters/ClaudeStreamAdapter');
        }
    }
    return _adapterCache[key];
}

// ─────────────────────────────────────────────────────────────────────────────
// SENTENCE SPLITTER
// ─────────────────────────────────────────────────────────────────────────────
// Accumulates tokens and emits complete sentences as they cross a boundary.
// Sentence boundary = ends with [.!?] followed by space, newline, or end of stream.
//
// Conservative approach: only split on unambiguous boundaries so we never
// cut mid-sentence. A short wait for the second character after punctuation
// avoids splitting "Mr. Smith" as two sentences.
// ─────────────────────────────────────────────────────────────────────────────

const SENTENCE_END_RE = /[.!?]["')\]]*(?:\s|$)/;
const MIN_SENTENCE_CHARS = 15;  // Don't emit micro-fragments like "Hi."

class SentenceSplitter {
  constructor(onSentence) {
    this._onSentence = onSentence;
    this._buffer     = '';
  }

  /** Feed a raw token fragment. May emit 0 or more sentences. */
  push(token) {
    this._buffer += token;
    this._flush(false);
  }

  /** End of stream — flush whatever is left. */
  end() {
    if (this._buffer.trim().length > 0) {
      this._onSentence(this._buffer.trim());
      this._buffer = '';
    }
  }

  _flush(isEnd) {
    // Scan forward for sentence boundaries.
    // BUG-2 FIX: use a searchFrom pointer instead of prepending short sentences
    // back to the buffer. The old approach caused O(n²) re-scanning: every new
    // token would re-process the same short-sentence prefix at position 0.
    // Now we advance searchFrom past each too-short boundary and keep looking.
    let searchFrom = 0;

    while (true) {
      const tail  = this._buffer.slice(searchFrom);
      const match = SENTENCE_END_RE.exec(tail);
      if (!match) break;

      const absoluteEnd = searchFrom + match.index + match[0].length;
      const sentence    = this._buffer.slice(0, absoluteEnd).trim();

      if (sentence.length >= MIN_SENTENCE_CHARS) {
        // Long enough — emit and consume from buffer, reset scan position
        this._onSentence(sentence);
        this._buffer = this._buffer.slice(absoluteEnd);
        searchFrom   = 0;
      } else {
        // Too short — advance past this boundary; the short prefix will merge
        // with whatever comes next (no buffer mutation, no O(n²) re-scan)
        searchFrom = absoluteEnd;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// streamWithSentences — drop-in replacement for streamWithHeartbeat()
// ─────────────────────────────────────────────────────────────────────────────
//
// Identical call signature and return shape to streamWithHeartbeat().
// Callers in Agent2DiscoveryRunner require zero changes beyond the import.
//
// ADDITIONAL opts:
//   opts.onSentence  — async (sentence, index) => void
//                      Called as each sentence completes. Use this to fire
//                      ElevenLabs TTS for that sentence immediately.
//                      index=0 is the first sentence (fires fastest).
//
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @param {Object} opts
 * @param {string}   opts.apiKey
 * @param {string}   [opts.provider]    — 'anthropic' | 'groq' (default: 'anthropic')
 * @param {string}   opts.model
 * @param {number}   opts.maxTokens
 * @param {number}   opts.temperature
 * @param {string}   opts.system
 * @param {Array}    opts.messages
 * @param {string}   opts.callSid
 * @param {number}   opts.turn
 * @param {string}   opts.token
 * @param {Object}   opts.redis
 * @param {Function} opts.emit
 * @param {Function} [opts.onSentence]   — async (sentence: string, index: number) => void
 * @param {boolean}  [opts.skipResultKey] — when true, skip writing the final joined
 *                                          response to a2bridge:result. Use for intake
 *                                          calls where the parser overwrites the key with
 *                                          clean responseText — prevents raw JSON/YAML from
 *                                          racing into bridge-continue before parsing is done.
 * @param {number}   [opts.maxCeilingMs]
 * @param {number}   [opts.heartbeatIntervalMs]
 * @returns {Promise<{ response, tokensUsed, latencyMs, wasPartial, failureReason, sentences }>}
 */
async function streamWithSentences(opts) {
  const {
    apiKey,
    provider,                    // 'anthropic' | 'groq' — resolved per company
    model,
    maxTokens    = 300,
    temperature  = 0.4,
    system,
    messages,
    callSid,
    turn,
    token,
    redis,
    emit         = () => {},
    onSentence   = null,
    skipResultKey = false,
    jsonMode      = false,       // passed through to adapter — Groq JSON mode
    maxCeilingMs = DEFAULTS.maxCeilingMs,
    heartbeatIntervalMs = DEFAULTS.heartbeatIntervalMs,
  } = opts;

  // ── Resolve adapter for this call — multi-tenant safe ─────────────────────
  const adapter = resolveAdapter(provider);

  const startMs      = Date.now();
  const sentences    = [];
  let   sentenceIndex = 0;
  let   failureReason = null;

  if (!apiKey) {
    emit('A2_LLM_STREAM_FAILED', { reason: 'T2_NO_API_KEY', turn });
    return { response: null, tokensUsed: null, latencyMs: 0, wasPartial: false, failureReason: 'T2_NO_API_KEY', sentences: [] };
  }

  // ── Heartbeat writer (same Redis keys — bridge-continue is unchanged) ──────
  const heartbeat = new HeartbeatWriter({
    redis, callSid, turn, token,
    intervalMs:  heartbeatIntervalMs,
    ttlSeconds:  DEFAULTS.heartbeatTtlSeconds,
  });

  // ── Sentence splitter — emits sentences as they cross a boundary ──────────
  const splitter = new SentenceSplitter(async (sentence) => {
    sentences.push(sentence);
    const idx = sentenceIndex++;

    emit('A2_LLM_SENTENCE_READY', {
      turn,
      sentenceIndex: idx,
      length:        sentence.length,
      elapsedMs:     Date.now() - startMs,
      provider:      adapter.providerName,
    });

    // Fire caller's onSentence hook (e.g. ElevenLabs TTS for this sentence)
    if (onSentence) {
      try {
        await onSentence(sentence, idx);
      } catch (err) {
        logger.warn('[SENTENCE_STREAM] onSentence callback failed (non-fatal)', {
          sentenceIndex: idx,
          error: err.message,
          callSid,
        });
      }
    }
  });

  emit('A2_LLM_STREAM_START', {
    model,
    maxTokens,
    turn,
    callSid,
    hasBridgeToken: !!token,
    hasRedis:       !!redis,
    ceilingMs:      maxCeilingMs,
    provider:       adapter.providerName,
    sentenceMode:   true,
  });

  heartbeat.start();

  // ── Ceiling timeout ───────────────────────────────────────────────────────
  let ceilingTimer = null;
  let ceilingHit   = false;
  const abortController = new AbortController();

  const ceilingPromise = new Promise((_, reject) => {
    ceilingTimer = setTimeout(() => {
      ceilingHit = true;
      abortController.abort();
      reject(new Error('CEILING_TIMEOUT'));
    }, maxCeilingMs);
  });

  // ── Token streaming ───────────────────────────────────────────────────────
  // NOTE: loop variable is named `chunk` to avoid shadowing `token` (bridge token) from opts
  const streamPromise = (async () => {
    for await (const chunk of adapter.streamTokens({
      apiKey, model, maxTokens, temperature, system, messages,
      callSid, turn, jsonMode,
      signal: abortController.signal,
    })) {
      heartbeat.onTokens(chunk);
      splitter.push(chunk);
    }
    splitter.end();
  })();

  let caughtErrorMsg = null;
  try {
    await Promise.race([streamPromise, ceilingPromise]);
    clearTimeout(ceilingTimer);
    ceilingTimer = null;
  } catch (err) {
    if (ceilingTimer) { clearTimeout(ceilingTimer); ceilingTimer = null; }

    if (ceilingHit || err.message === 'CEILING_TIMEOUT') {
      // Flush any remaining buffer as a partial sentence
      splitter.end();
      failureReason = 'T2_MAX_LATENCY';
    } else {
      // API / network error — flush what we have
      splitter.end();
      failureReason = 'T2_PROVIDER_ERROR';
      caughtErrorMsg = err.message?.substring(0, 200) || null;
      logger.warn('[SENTENCE_STREAM] Provider error', { error: err.message, callSid, turn, provider: adapter.providerName });
    }
  }

  // ── Build full response from sentences ────────────────────────────────────
  const responseText = sentences.join(' ');
  const latencyMs    = Date.now() - startMs;
  const tokensUsed   = { input: 0, output: heartbeat.tokenCount };

  if (!responseText || responseText.trim().length === 0) {
    heartbeat.setFailed();
    await heartbeat.stop();
    failureReason = failureReason || 'T2_EMPTY_RESPONSE';

    emit('A2_LLM_STREAM_FAILED', {
      reason: failureReason, turn, latencyMs,
      provider: adapter.providerName,
      tokenCount: heartbeat.tokenCount,
      ...(caughtErrorMsg ? { errorMsg: caughtErrorMsg } : {}),
    });
    return { response: null, tokensUsed, latencyMs, wasPartial: false, failureReason, sentences: [] };
  }

  const wasPartial = ceilingHit && sentences.length > 0;

  if (wasPartial) {
    heartbeat.setPartial();
  } else {
    heartbeat.setComplete();
  }
  await heartbeat.stop();

  // Write final result to Redis (bridge-continue picks this up).
  // skipResultKey=true: intake calls skip this write so raw JSON/YAML never races
  // into bridge-continue. The intake parser overwrites the key with clean responseText.
  if (redis && callSid && token && !skipResultKey) {
    try {
      const rKey = resultKey(callSid, turn, token);
      await redis.set(rKey, responseText, { EX: DEFAULTS.resultTtlSeconds });
    } catch { /* non-fatal */ }
  }

  emit('A2_LLM_STREAM_COMPLETE', {
    turn,
    latencyMs,
    model,
    provider:        adapter.providerName,
    tokensOutput:    heartbeat.tokenCount,
    responseLength:  responseText.length,
    sentenceCount:   sentences.length,
    firstSentenceMs: sentences.length > 0 ? latencyMs : null,  // approx
    wasPartial,
  });

  return {
    response:      responseText,
    tokensUsed,
    latencyMs,
    wasPartial,
    failureReason: null,
    sentences,     // bonus: caller can inspect individual sentences
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  streamWithSentences,
  SentenceSplitter,    // exported for unit tests
  ACTIVE_PROVIDER: 'dynamic',  // resolved per-call — see resolveAdapter()
};
