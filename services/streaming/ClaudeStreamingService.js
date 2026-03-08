// services/streaming/ClaudeStreamingService.js
//
// ═══════════════════════════════════════════════════════════════════════════════
// CLAUDE STREAMING SERVICE — Tier 2 Intelligence Layer Transport
// ═══════════════════════════════════════════════════════════════════════════════
//
// Replaces batch fetch() calls to the Anthropic API with streaming responses
// and Redis heartbeat signaling. This is the core fix for the "dead T2" problem:
//
//   OLD: fetch() + AbortSignal.timeout(6000) → Claude killed at 6s → T3 amnesia
//   NEW: SDK streaming + heartbeat every 500ms → bridge waits while tokens flow
//
// ARCHITECTURE:
//   ┌─────────────────┐    heartbeat     ┌──────────────────┐
//   │ ClaudeStreaming  │───────────────▶  │  Redis            │
//   │ Service          │   partial text   │  a2bridge:*       │
//   │                  │───────────────▶  │                    │
//   └────────┬────────┘                  └──────────┬─────────┘
//            │ stream tokens                        │ poll heartbeat
//            ▼                                      ▼
//   ┌─────────────────┐                  ┌──────────────────┐
//   │ Anthropic API    │                  │ Bridge-Continue   │
//   │ (Claude)         │                  │ (v2twilio.js)     │
//   └─────────────────┘                  └──────────────────┘
//
// REDIS KEYS (written during streaming):
//   a2bridge:heartbeat:{callSid}:{turn}:{token}  — JSON { ts, tokens, status }
//   a2bridge:partial:{callSid}:{turn}:{token}    — accumulated response text
//   a2bridge:result:{callSid}:{turn}:{token}     — final complete response
//
// EXPORTS:
//   streamWithHeartbeat(opts)  → { response, tokensUsed, latencyMs, wasPartial, failureReason }
//   streamWithRetry(opts)      → same, but tries backup model on API failure
//
// EVENTS EMITTED (via opts.emit):
//   A2_LLM_STREAM_START       — streaming session began
//   A2_LLM_STREAM_HEARTBEAT   — periodic heartbeat update
//   A2_LLM_STREAM_COMPLETE    — full response received
//   A2_LLM_STREAM_PARTIAL     — partial response delivered (stream died mid-way)
//   A2_LLM_STREAM_FAILED      — complete failure, no usable response
//
// ═══════════════════════════════════════════════════════════════════════════════

'use strict';

const Anthropic = require('@anthropic-ai/sdk');
const logger = require('../../utils/logger');
const { FALLBACK_REASON_CODE } = require('../../config/ResponseProtocol');

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGURATION DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════════

const DEFAULTS = {
  maxCeilingMs:       15000,  // Absolute max wait time — emergency-only safety stop (was 25s)
  heartbeatIntervalMs: 500,   // How often to update Redis heartbeat
  partialThreshold:    0.40,  // 40% of maxTokens = usable partial response
  partialMinChars:     40,    // Minimum chars for a partial to be deliverable
  resultTtlSeconds:    30,    // How long final result lives in Redis
  heartbeatTtlSeconds: 60,    // How long heartbeat keys survive
};

// ═══════════════════════════════════════════════════════════════════════════════
// REDIS KEY BUILDERS
// ═══════════════════════════════════════════════════════════════════════════════
// Centralized key construction — never hand-build keys outside this module.
// ═══════════════════════════════════════════════════════════════════════════════

function heartbeatKey(callSid, turn, token) {
  return `a2bridge:heartbeat:${callSid}:${turn}:${token}`;
}

function partialKey(callSid, turn, token) {
  return `a2bridge:partial:${callSid}:${turn}:${token}`;
}

function resultKey(callSid, turn, token) {
  return `a2bridge:result:${callSid}:${turn}:${token}`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HEARTBEAT WRITER
// ═══════════════════════════════════════════════════════════════════════════════
// Writes heartbeat + partial text to Redis on a timer during streaming.
// The bridge-continue endpoint polls these keys to decide: keep waiting or cap.
// ═══════════════════════════════════════════════════════════════════════════════

class HeartbeatWriter {
  constructor({ redis, callSid, turn, token, intervalMs, ttlSeconds }) {
    this._redis = redis;
    this._callSid = callSid;
    this._turn = turn;
    this._token = token;
    this._intervalMs = intervalMs || DEFAULTS.heartbeatIntervalMs;
    this._ttlSeconds = ttlSeconds || DEFAULTS.heartbeatTtlSeconds;
    this._timer = null;
    this._tokenCount = 0;
    this._buffer = '';
    this._status = 'streaming';  // streaming | complete | failed | partial
    this._startedAt = Date.now();
  }

  /** Start the periodic heartbeat timer */
  start() {
    if (!this._redis) return;  // No Redis = no heartbeat (graceful degradation)

    // Write first heartbeat immediately
    this._write();

    // Then on interval
    this._timer = setInterval(() => this._write(), this._intervalMs);
  }

  /** Record new tokens arriving from stream */
  onTokens(text) {
    this._tokenCount++;
    this._buffer += text;
  }

  /** Get current accumulated buffer */
  get buffer() { return this._buffer; }

  /** Get current token count */
  get tokenCount() { return this._tokenCount; }

  /** Mark stream as complete */
  setComplete() { this._status = 'complete'; }

  /** Mark stream as failed */
  setFailed() { this._status = 'failed'; }

  /** Mark stream as partial (died mid-stream but usable) */
  setPartial() { this._status = 'partial'; }

  /** Stop the heartbeat timer and write final state */
  async stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    // Write final heartbeat
    await this._write();
  }

  /** Internal: write heartbeat + partial to Redis */
  async _write() {
    if (!this._redis) return;

    const hbKey = heartbeatKey(this._callSid, this._turn, this._token);
    const ptKey = partialKey(this._callSid, this._turn, this._token);

    try {
      const heartbeat = JSON.stringify({
        ts:      Date.now(),
        tokens:  this._tokenCount,
        status:  this._status,
        elapsed: Date.now() - this._startedAt,
        chars:   this._buffer.length,
      });

      // Pipeline both writes for efficiency
      await Promise.all([
        this._redis.set(hbKey, heartbeat, { EX: this._ttlSeconds }),
        this._buffer.length > 0
          ? this._redis.set(ptKey, this._buffer, { EX: this._ttlSeconds })
          : Promise.resolve(),
      ]);
    } catch (err) {
      // Heartbeat write failure is non-fatal — stream continues
      logger.warn('[CLAUDE_STREAM] Heartbeat write failed', {
        error: err.message,
        callSid: this._callSid,
        turn: this._turn,
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM WITH HEARTBEAT — Primary streaming function
// ═══════════════════════════════════════════════════════════════════════════════
// Streams a Claude API response while writing Redis heartbeat signals.
// The bridge-continue endpoint uses these heartbeats to decide whether
// Claude is still working (keep waiting) or dead (fall to T3).
//
// RETURNS:
//   { response, tokensUsed, latencyMs, wasPartial: false, failureReason: null }  — success
//   { response, tokensUsed, latencyMs, wasPartial: true,  failureReason: null }  — partial
//   null + failureReason — complete failure
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @param {Object} opts
 * @param {string}   opts.apiKey       — Anthropic API key
 * @param {string}   opts.model        — Model ID (e.g. 'claude-haiku-4-5-20251001')
 * @param {number}   opts.maxTokens    — Max output tokens
 * @param {number}   opts.temperature  — Temperature (0-1)
 * @param {string}   opts.system       — System prompt
 * @param {Array}    opts.messages     — Messages array [{ role, content }]
 * @param {string}   opts.callSid      — Twilio CallSid (for Redis keys)
 * @param {number}   opts.turn         — Turn number
 * @param {string}   opts.token        — Bridge token (for Redis keys)
 * @param {Object}   opts.redis        — Connected Redis client (node-redis v5)
 * @param {Function} opts.emit         — Event emitter function
 * @param {number}  [opts.maxCeilingMs]       — Override default ceiling timeout
 * @param {number}  [opts.heartbeatIntervalMs] — Override heartbeat interval
 * @returns {Promise<{ response: string, tokensUsed: Object, latencyMs: number, wasPartial: boolean, failureReason: string|null }|null>}
 */
async function streamWithHeartbeat(opts) {
  const {
    apiKey,
    model,
    maxTokens,
    temperature,
    system,
    messages,
    callSid,
    turn,
    token,
    redis,
    emit = () => {},
    maxCeilingMs = DEFAULTS.maxCeilingMs,
    heartbeatIntervalMs = DEFAULTS.heartbeatIntervalMs,
  } = opts;

  const startMs = Date.now();
  let failureReason = null;

  // ── Validate required params ──────────────────────────────────────────────
  if (!apiKey) {
    emit('A2_LLM_STREAM_FAILED', { reason: FALLBACK_REASON_CODE.T2_NO_API_KEY, turn });
    return { response: null, tokensUsed: null, latencyMs: 0, wasPartial: false, failureReason: FALLBACK_REASON_CODE.T2_NO_API_KEY };
  }

  // ── Initialize heartbeat writer ───────────────────────────────────────────
  const heartbeat = new HeartbeatWriter({
    redis, callSid, turn, token,
    intervalMs: heartbeatIntervalMs,
    ttlSeconds: DEFAULTS.heartbeatTtlSeconds,
  });

  // ── Initialize Anthropic SDK client ───────────────────────────────────────
  const client = new Anthropic({ apiKey });

  emit('A2_LLM_STREAM_START', {
    model, maxTokens, turn, callSid,
    hasBridgeToken: !!token,
    hasRedis: !!redis,
    ceilingMs: maxCeilingMs,
  });

  // ── Start streaming ───────────────────────────────────────────────────────
  heartbeat.start();

  let stream = null;
  let ceilingTimer = null;
  let ceilingHit = false;
  let usage = { input_tokens: 0, output_tokens: 0 };

  try {
    // Create the stream with Anthropic SDK
    stream = client.messages.stream({
      model,
      max_tokens: maxTokens,
      temperature,
      system,
      messages,
    });

    // ── Ceiling timeout (absolute safety valve) ─────────────────────────────
    // This is the ONLY hard limit. Unlike the old 6s AbortSignal, this gives
    // Claude up to 25s (configurable) to finish. The bridge-continue endpoint
    // uses heartbeat to extend beyond its own soft cap.
    const ceilingPromise = new Promise((_, reject) => {
      ceilingTimer = setTimeout(() => {
        ceilingHit = true;
        reject(new Error('CEILING_TIMEOUT'));
      }, maxCeilingMs);
    });

    // ── Token accumulation with heartbeat ───────────────────────────────────
    const streamPromise = (async () => {
      // Listen for text tokens
      stream.on('text', (text) => {
        heartbeat.onTokens(text);
      });

      // Wait for the final message
      const finalMessage = await stream.finalMessage();

      // Extract usage from final message
      if (finalMessage.usage) {
        usage = finalMessage.usage;
      }

      return finalMessage;
    })();

    // ── Race: stream completion vs ceiling timeout ──────────────────────────
    const result = await Promise.race([streamPromise, ceilingPromise]);

    // Stream completed before ceiling
    clearTimeout(ceilingTimer);
    ceilingTimer = null;

    const responseText = heartbeat.buffer;
    const latencyMs = Date.now() - startMs;
    const tokensUsed = {
      input: usage.input_tokens || 0,
      output: usage.output_tokens || 0,
    };

    // ── Handle empty response ───────────────────────────────────────────────
    if (!responseText || responseText.trim().length === 0) {
      heartbeat.setFailed();
      await heartbeat.stop();
      failureReason = FALLBACK_REASON_CODE.T2_EMPTY_RESPONSE;
      emit('A2_LLM_STREAM_FAILED', {
        reason: failureReason, turn, latencyMs,
        tokenCount: heartbeat.tokenCount,
      });
      return { response: null, tokensUsed, latencyMs, wasPartial: false, failureReason };
    }

    // ── SUCCESS: Full response ──────────────────────────────────────────────
    heartbeat.setComplete();
    await heartbeat.stop();

    // Write final result to Redis for bridge-continue to pick up
    if (redis && callSid && token) {
      try {
        const rKey = resultKey(callSid, turn, token);
        await redis.set(rKey, responseText, { EX: DEFAULTS.resultTtlSeconds });
      } catch (err) {
        logger.warn('[CLAUDE_STREAM] Result write to Redis failed', { error: err.message });
      }
    }

    emit('A2_LLM_STREAM_COMPLETE', {
      turn, latencyMs, model,
      tokensInput: tokensUsed.input,
      tokensOutput: tokensUsed.output,
      responseLength: responseText.length,
      tokenCount: heartbeat.tokenCount,
    });

    return { response: responseText, tokensUsed, latencyMs, wasPartial: false, failureReason: null };

  } catch (err) {
    // ── Ceiling timeout hit ─────────────────────────────────────────────────
    if (ceilingHit || err.message === 'CEILING_TIMEOUT') {
      if (ceilingTimer) clearTimeout(ceilingTimer);

      const latencyMs = Date.now() - startMs;
      const partialText = heartbeat.buffer;
      const tokensUsed = {
        input: usage.input_tokens || 0,
        output: usage.output_tokens || 0,
      };

      // Abort the stream gracefully
      try { stream?.abort?.(); } catch { /* ignore */ }

      // Check if we have a usable partial response
      const hasUsablePartial = partialText.length >= DEFAULTS.partialMinChars
        && heartbeat.tokenCount >= Math.floor(maxTokens * DEFAULTS.partialThreshold);

      if (hasUsablePartial) {
        // ── PARTIAL: Deliver what we have ─────────────────────────────────
        heartbeat.setPartial();
        await heartbeat.stop();

        if (redis && callSid && token) {
          try {
            const rKey = resultKey(callSid, turn, token);
            await redis.set(rKey, partialText, { EX: DEFAULTS.resultTtlSeconds });
          } catch { /* non-fatal */ }
        }

        emit('A2_LLM_STREAM_PARTIAL', {
          turn, latencyMs, model,
          responseLength: partialText.length,
          tokenCount: heartbeat.tokenCount,
          maxTokens,
          percentComplete: Math.round((heartbeat.tokenCount / maxTokens) * 100),
        });

        return { response: partialText, tokensUsed, latencyMs, wasPartial: true, failureReason: null };
      }

      // ── CEILING HIT: Not enough to deliver ──────────────────────────────
      heartbeat.setFailed();
      await heartbeat.stop();
      failureReason = FALLBACK_REASON_CODE.T2_MAX_LATENCY;

      emit('A2_LLM_STREAM_FAILED', {
        reason: failureReason, turn, latencyMs,
        partialChars: partialText.length,
        tokenCount: heartbeat.tokenCount,
      });

      return { response: null, tokensUsed, latencyMs, wasPartial: false, failureReason };
    }

    // ── API / network error ─────────────────────────────────────────────────
    if (ceilingTimer) clearTimeout(ceilingTimer);
    const latencyMs = Date.now() - startMs;

    // Determine specific failure reason
    if (err.status) {
      // HTTP error from Anthropic API
      failureReason = FALLBACK_REASON_CODE.T2_PROVIDER_ERROR;
    } else if (err.message?.includes('guardrail') || err.message?.includes('blocked')) {
      failureReason = FALLBACK_REASON_CODE.T2_GUARDRAIL_ABORT;
    } else {
      failureReason = FALLBACK_REASON_CODE.T2_PROVIDER_ERROR;
    }

    heartbeat.setFailed();
    await heartbeat.stop();

    logger.error('[CLAUDE_STREAM] Stream failed', {
      error: err.message,
      status: err.status || null,
      failureReason,
      callSid,
      turn,
      latencyMs,
      partialChars: heartbeat.buffer.length,
    });

    emit('A2_LLM_STREAM_FAILED', {
      reason: failureReason, turn, latencyMs,
      error: err.message?.substring(0, 200),
      httpStatus: err.status || null,
      partialChars: heartbeat.buffer.length,
    });

    // Check if we got a usable partial before the error
    const partialText = heartbeat.buffer;
    if (partialText.length >= DEFAULTS.partialMinChars) {
      if (redis && callSid && token) {
        try {
          const rKey = resultKey(callSid, turn, token);
          await redis.set(rKey, partialText, { EX: DEFAULTS.resultTtlSeconds });
        } catch { /* non-fatal */ }
      }

      emit('A2_LLM_STREAM_PARTIAL', {
        turn, latencyMs, model,
        responseLength: partialText.length,
        tokenCount: heartbeat.tokenCount,
        afterError: true,
      });

      return { response: partialText, tokensUsed: { input: 0, output: 0 }, latencyMs, wasPartial: true, failureReason: null };
    }

    return { response: null, tokensUsed: { input: 0, output: 0 }, latencyMs, wasPartial: false, failureReason };
  } finally {
    // Safety cleanup — clear ceiling timer if still alive
    if (ceilingTimer) clearTimeout(ceilingTimer);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// STREAM WITH RETRY — Backup model failover
// ═══════════════════════════════════════════════════════════════════════════════
// Tries primary model → if API error (NOT timeout) → tries backup model
// with tighter ceiling. If both fail → null → T3.
//
// This is Package 5 of the 123RP hardening plan.
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * @param {Object} opts                  — Same as streamWithHeartbeat
 * @param {Object} opts.backupModel      — { modelId, temperature, maxTokens, enabled }
 * @param {number} [opts.backupCeilingMs] — Override backup model ceiling (default: 10s)
 * @returns {Promise<{ response: string, tokensUsed: Object, latencyMs: number, wasPartial: boolean, failureReason: string|null, usedBackup: boolean }|null>}
 */
async function streamWithRetry(opts) {
  const { backupModel, backupCeilingMs = 10000, emit = () => {}, ...primaryOpts } = opts;

  // ── Try primary model ─────────────────────────────────────────────────────
  const primaryResult = await streamWithHeartbeat({ ...primaryOpts, emit });

  // Success or partial from primary → return immediately
  if (primaryResult?.response) {
    return { ...primaryResult, usedBackup: false };
  }

  // ── Check if backup is available and applicable ───────────────────────────
  // Only retry on API errors, NOT on timeouts (ceiling hit = model was working, just slow)
  const retryableReasons = [
    FALLBACK_REASON_CODE.T2_PROVIDER_ERROR,
    FALLBACK_REASON_CODE.T2_STREAM_SILENT,
    FALLBACK_REASON_CODE.T2_EMPTY_RESPONSE,
    FALLBACK_REASON_CODE.T2_GUARDRAIL_ABORT,
  ];

  const shouldRetry = backupModel?.enabled
    && primaryResult?.failureReason
    && retryableReasons.includes(primaryResult.failureReason);

  if (!shouldRetry) {
    return primaryResult ? { ...primaryResult, usedBackup: false } : null;
  }

  // ── Try backup model ──────────────────────────────────────────────────────
  logger.info('[CLAUDE_STREAM] Primary failed, trying backup model', {
    primaryReason: primaryResult.failureReason,
    backupModel: backupModel.modelId,
    callSid: primaryOpts.callSid,
    turn: primaryOpts.turn,
  });

  emit('A2_LLM_BACKUP_ATTEMPT', {
    primaryReason: primaryResult.failureReason,
    backupModel: backupModel.modelId,
    turn: primaryOpts.turn,
  });

  const backupResult = await streamWithHeartbeat({
    ...primaryOpts,
    model: backupModel.modelId,
    temperature: backupModel.temperature ?? primaryOpts.temperature,
    maxTokens: backupModel.maxTokens ?? primaryOpts.maxTokens,
    maxCeilingMs: backupCeilingMs,
    emit,
  });

  if (backupResult?.response) {
    emit('A2_LLM_BACKUP_SUCCESS', {
      backupModel: backupModel.modelId,
      latencyMs: backupResult.latencyMs,
      turn: primaryOpts.turn,
    });
    return { ...backupResult, usedBackup: true };
  }

  // ── Both failed ───────────────────────────────────────────────────────────
  emit('A2_LLM_STREAM_FAILED', {
    reason: FALLBACK_REASON_CODE.T2_BACKUP_FAILED,
    turn: primaryOpts.turn,
    primaryReason: primaryResult.failureReason,
    backupReason: backupResult?.failureReason || 'unknown',
  });

  return {
    response: null,
    tokensUsed: { input: 0, output: 0 },
    latencyMs: (primaryResult?.latencyMs || 0) + (backupResult?.latencyMs || 0),
    wasPartial: false,
    failureReason: FALLBACK_REASON_CODE.T2_BACKUP_FAILED,
    usedBackup: true,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
  streamWithHeartbeat,
  streamWithRetry,

  // Exported for bridge-continue endpoint to read
  heartbeatKey,
  partialKey,
  resultKey,

  // Exported for testing
  DEFAULTS,
  HeartbeatWriter,
};
