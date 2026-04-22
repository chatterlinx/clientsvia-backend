'use strict';

/**
 * SpeculativeLLMService
 * ─────────────────────
 * Runs CallRuntime.processTurn() speculatively against the Twilio
 * partialResultCallback transcript — BEFORE the caller finishes speaking.
 *
 * When the main gather handler arrives with the final transcript, it checks
 * Redis for a matching pre-warm result. If the transcripts are ≥75% similar,
 * it uses the pre-computed LLM response directly, skipping the LLM call
 * entirely and saving ~1–2s of latency on every turn.
 *
 * Design principles:
 *  1. BEST-EFFORT ONLY — any error is swallowed, caller never blocked
 *  2. NEVER writes callState back to Redis (main handler owns state)
 *  3. NEVER flushes the event buffer (main handler flushes if it uses the result)
 *  4. Result expires in 8s — stale results are ignored automatically
 */

const { getSharedRedisClient, isRedisConfigured } = require('../redisClientFactory');
const { CallRuntime }  = require('../engine/CallRuntime');
const Company          = require('../../models/v2Company');
const logger           = require('../../utils/logger');

const RESULT_KEY_PREFIX = 'speculative:result:';
const RESULT_TTL_S      = 8;   // Expires well before next turn could fire

// ─── Similarity helper ────────────────────────────────────────────────────────
// Token-containment: "what fraction of the partial's tokens appear in final?"
// Partial is always a prefix of final (for normal STT), so containment ≈ 1.0
// even when final is longer. Works even for very different lengths.
function _tokenContainment(partial, final) {
  const tokenize = s =>
    new Set((s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(t => t.length >= 2));
  const pToks = tokenize(partial);
  const fToks = tokenize(final);
  if (pToks.size === 0) return 0;
  let hits = 0;
  for (const t of pToks) if (fToks.has(t)) hits++;
  return hits / pToks.size;
}

// ─── Safe Redis getter (mirrors getRedis() in v2twilio.js) ───────────────────
async function _getRedis() {
  if (!isRedisConfigured()) return null;
  try { return await getSharedRedisClient(); }
  catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// runSpeculativeLLM
// Called fire-and-forget from the partialResultCallback handler.
// ─────────────────────────────────────────────────────────────────────────────
async function runSpeculativeLLM(callSid, companyId, partialText) {
  const TAG = '[SPEC_LLM]';
  const t0  = Date.now();

  try {
    // ── 1. Sanity checks ─────────────────────────────────────────────────────
    if (!callSid || !companyId || !partialText?.trim()) return;

    const redis = await _getRedis();
    if (!redis) return;

    // ── 2. Load call state ───────────────────────────────────────────────────
    const callStateRaw = await redis.get(`call:${callSid}`).catch(() => null);
    if (!callStateRaw) {
      logger.debug(`${TAG} No callState, skipping`, { callSid: callSid.slice(-8) });
      return;
    }
    let callState;
    try { callState = JSON.parse(callStateRaw); }
    catch { return; }

    const turnCount = callState.turnCount || 0;

    // ── 3. Load company (lean — skip Mongoose document overhead) ─────────────
    const company = await Company.findById(companyId).lean().exec();
    if (!company) {
      logger.debug(`${TAG} Company not found, skipping`, { companyId });
      return;
    }

    // ── 4. Run the full turn pipeline (same args as main handler) ────────────
    //      We pass _isSpeculative:true so downstream code can suppress side
    //      effects (CallLogger writes are still skipped because we don't flush
    //      the event buffer).
    const runtimeResult = await CallRuntime.processTurn(
      company.aiAgentSettings || {},
      callState,
      partialText,
      {
        company,
        callSid,
        companyId,
        callerPhone: callState.from || callState.callerPhone || '',
        turnCount,
        onSentence:    null,   // no streaming — we store the full response text
        bridgeToken:   null,   // no bridge in speculative path
        redis,
        // 🧹 STAGE 4 (Y9) TODO: Currently aspirational — no downstream code reads this flag
        //                       yet. Intended future use: suppress side effects (CallLogger
        //                       writes, Mongo persistence, transcript appends) so speculative
        //                       never pollutes observability when its result is discarded.
        //                       Today, the event buffer is dropped on the floor when the main
        //                       handler doesn't adopt the speculative result.
        _isSpeculative: true,  // informational flag for future use
      }
    );

    if (!runtimeResult?.response) {
      logger.debug(`${TAG} No response from processTurn, skipping`, { callSid: callSid.slice(-8) });
      return;
    }

    // ── 5. Store result in Redis ──────────────────────────────────────────────
    //    Strip turnEventBuffer — it contains closures/refs that won't serialize,
    //    and the main handler re-buffers events when it uses this result.
    const payload = JSON.stringify({
      input:     partialText,
      result:    { ...runtimeResult, turnEventBuffer: [] },
      turnCount,
      latencyMs: Date.now() - t0,
      ts:        Date.now(),
    });

    await redis.set(`${RESULT_KEY_PREFIX}${callSid}`, payload, { EX: RESULT_TTL_S });

    logger.info(`${TAG} ✅ Pre-warm stored`, {
      callSid:    callSid.slice(-8),
      turnCount,
      latencyMs:  Date.now() - t0,
      responsePreview: runtimeResult.response.substring(0, 60),
      path:       runtimeResult?._123rp?.lastPath || '?',
    });

  } catch (err) {
    // Completely non-fatal — main handler proceeds normally on any error
    logger.debug(`${TAG} Pre-warm failed (non-fatal): ${err.message}`, {
      callSid: callSid?.slice(-8),
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// checkSpeculativeResult
// Called at the start of computeTurnPromise in v2-agent-respond.
// Returns the runtimeResult if a valid match exists, null otherwise.
// ─────────────────────────────────────────────────────────────────────────────
async function checkSpeculativeResult(callSid, finalText, expectedTurnCount, redis) {
  const TAG = '[SPEC_CHECK]';
  try {
    if (!redis || !callSid || !finalText?.trim()) return null;

    const raw = await redis.get(`${RESULT_KEY_PREFIX}${callSid}`).catch(() => null);
    if (!raw) return null;

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { return null; }

    // Guard: must be for the same turn
    if (parsed.turnCount !== expectedTurnCount) {
      logger.debug(`${TAG} Turn mismatch — discarding (expected ${expectedTurnCount}, got ${parsed.turnCount})`, {
        callSid: callSid.slice(-8),
      });
      await redis.del(`${RESULT_KEY_PREFIX}${callSid}`).catch(() => {});
      return null;
    }

    // Guard: transcripts must be similar enough
    const similarity = _tokenContainment(parsed.input, finalText);
    if (similarity < 0.75) {
      logger.info(`${TAG} Low similarity (${(similarity * 100).toFixed(0)}%) — discarding pre-warm`, {
        callSid:   callSid.slice(-8),
        partial:   parsed.input?.substring(0, 50),
        final:     finalText?.substring(0, 50),
      });
      await redis.del(`${RESULT_KEY_PREFIX}${callSid}`).catch(() => {});
      return null;
    }

    // Hit! Consume it (delete so it can't be reused on the next turn)
    await redis.del(`${RESULT_KEY_PREFIX}${callSid}`).catch(() => {});

    logger.info(`${TAG} 🚀 HIT — using pre-warm (similarity ${(similarity * 100).toFixed(0)}%, saved ~${parsed.latencyMs}ms)`, {
      callSid:   callSid.slice(-8),
      turnCount: parsed.turnCount,
      savedMs:   parsed.latencyMs,
      path:      parsed.result?._123rp?.lastPath || '?',
    });

    return parsed.result;

  } catch (err) {
    logger.debug(`[SPEC_CHECK] Error (non-fatal): ${err.message}`, { callSid: callSid?.slice(-8) });
    return null;
  }
}

module.exports = { runSpeculativeLLM, checkSpeculativeResult };
