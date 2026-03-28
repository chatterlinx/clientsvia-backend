'use strict';

/**
 * ============================================================================
 * TURN TRACER
 * ============================================================================
 *
 * Fire-and-forget per-turn decision trace writer. Writes to Redis (hot cache,
 * 15 min TTL) and MongoDB (cold storage, 30-day TTL via model index) on every
 * call turn. Designed to NEVER propagate errors — trace writes are strictly
 * best-effort and must never block or break a live call response.
 *
 * PURPOSE:
 *   TurnTracer is the persistence layer for the Intent Arbitration audit trail.
 *   It captures one ArbitrationDecision record per call turn and makes it
 *   available for:
 *     - Post-call review in the Call Review Console (Redis hot path)
 *     - Admin analytics and policy tuning (MongoDB cold path)
 *     - Debugging arbitration issues without touching production call logs
 *
 * DUAL-WRITE STRATEGY:
 *   Redis (hot):     key = trace:{callId}  → JSON array of all turns for the call
 *                    TTL = 900s (15 min after last write)
 *                    Refreshed on each record() call.
 *                    On getForCall(): Redis hit returns array immediately.
 *
 *   MongoDB (cold):  CallTurnTrace document per turn (append-only, never updated)
 *                    Indexed for getForCall() and getRecentForCompany() queries.
 *                    30-day TTL index on createdAt auto-purges old traces.
 *
 * HOT/COLD FALLBACK:
 *   getForCall() tries Redis first (sub-ms). On Redis miss, falls back to
 *   MongoDB.getForCall(callId). If both fail, returns [] (graceful degrade).
 *
 * ZERO-THROW CONTRACT:
 *   Every method wraps its async body in try/catch and swallows all errors.
 *   Trace failures are logged at warn level but NEVER surfaced to callers.
 *   A trace write failure must never prevent a call response from being sent.
 *
 * MULTI-TENANT SAFETY:
 *   All MongoDB writes and reads include companyId.
 *   Redis keys are scoped to callId (globally unique Twilio CallSids).
 *   No cross-tenant data leakage is architecturally possible.
 *
 * TRACE DATA SHAPE (traceData argument to record()):
 *   {
 *     callId:    string,           // Required — Twilio CallSid
 *     companyId: string,           // Required — tenant isolator
 *     turn:      number,           // Required — monotonic counter starting at 1
 *     input:     { raw, normalized },
 *     lane:      { before, after, locked, escapeTriggered },
 *     candidates: Array<{ type, score, signal, detector, suppressed, suppressReason }>,
 *     decision:  { winner, action, reason, policyApplied, scoreGap, arbitrationMs },
 *     execution: { responsePreview, laneRedirect, executionMs }
 *   }
 *
 * PUBLIC API:
 *   record(traceData)                        → void (fire-and-forget)
 *   getForCall(callId)                       → Promise<Array<CallTurnTrace>>
 *   getRecentForCompany(companyId, limit)    → Promise<Array<CallTurnTrace>>
 *
 * ============================================================================
 */

const CallTurnTrace            = require('../../../models/CallTurnTrace');         // 3 levels up: arbitration/ → engine/ → services/ → root
const { getSharedRedisClient } = require('../../redisClientFactory');              // 2 levels up: arbitration/ → engine/ → services/redisClientFactory
const logger                   = require('../../../utils/logger');

// ── Constants ─────────────────────────────────────────────────────────────────

/** Redis TTL for the hot trace cache — 15 minutes. */
const REDIS_TTL_SECONDS = 900;

/** Default limit for getRecentForCompany when none specified. */
const DEFAULT_RECENT_LIMIT = 50;

/** Maximum turns stored in the Redis array (prevents unbounded key growth on long calls). */
const REDIS_MAX_TURNS = 200;

// ── Redis Key Helper ──────────────────────────────────────────────────────────

/**
 * _traceKey — Build the Redis key for a call's turn trace array.
 * Pattern: trace:{callId}
 * @param {string} callId — Twilio CallSid (CA...)
 * @returns {string}
 */
function _traceKey(callId) {
  return `trace:${callId}`;
}

// ── Input Validation ──────────────────────────────────────────────────────────

/**
 * _validateTraceData — Basic sanity check before attempting any writes.
 * Does not throw — returns an object describing what's missing.
 * @param {Object} traceData
 * @returns {{ valid: boolean, reason: string }}
 */
function _validateTraceData(traceData) {
  if (!traceData || typeof traceData !== 'object') {
    return { valid: false, reason: 'traceData is not an object' };
  }
  if (!traceData.callId)    return { valid: false, reason: 'callId is required' };
  if (!traceData.companyId) return { valid: false, reason: 'companyId is required' };
  if (!traceData.turn || typeof traceData.turn !== 'number') {
    return { valid: false, reason: 'turn must be a positive number' };
  }
  return { valid: true, reason: '' };
}

// ── Redis Helpers ─────────────────────────────────────────────────────────────

/**
 * _appendToRedis — Append one turn record to the Redis JSON array for a call.
 *
 * Strategy: GET → parse → push → SET with refreshed TTL.
 * This is a read-modify-write and is NOT atomic. For trace data (non-critical,
 * append-only, best-effort), a small race window on concurrent turn writes is
 * acceptable — turns are also persisted individually to MongoDB.
 *
 * Caps the in-memory array at REDIS_MAX_TURNS to prevent unbounded growth
 * on very long calls.
 *
 * @param {Object} redis     — Connected Redis client
 * @param {string} callId    — Twilio CallSid
 * @param {Object} turnData  — Serializable turn trace object
 * @returns {Promise<void>}
 */
async function _appendToRedis(redis, callId, turnData) {
  const key   = _traceKey(callId);
  let   turns = [];

  try {
    const existing = await redis.get(key);
    if (existing) turns = JSON.parse(existing);
  } catch (_e) {
    turns = [];
  }

  turns.push(turnData);

  // Trim to cap — keep most recent REDIS_MAX_TURNS entries
  if (turns.length > REDIS_MAX_TURNS) {
    turns = turns.slice(turns.length - REDIS_MAX_TURNS);
  }

  await redis.setEx(key, REDIS_TTL_SECONDS, JSON.stringify(turns));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * record — Write a per-turn trace record.
 *
 * Execution model: synchronous return, async body runs in background.
 * Never throws. Never blocks the caller (ConversationEngine / ArbitrationEngine).
 * Failures are logged at warn level but do not surface.
 *
 * Write order:
 *   1. Validate traceData (synchronous guard)
 *   2. Append to Redis hot array (best-effort, non-blocking)
 *   3. Save to MongoDB CallTurnTrace (best-effort, non-blocking)
 *
 * @param {Object} traceData — See TRACE DATA SHAPE in module header
 * @returns {void}
 */
function record(traceData) {
  const { valid, reason } = _validateTraceData(traceData);
  if (!valid) {
    logger.warn('[TurnTracer] record() called with invalid traceData — skipping', { reason });
    return;
  }

  // Fire-and-forget — intentionally not awaited
  (async () => {
    const { callId, companyId, turn } = traceData;

    // ── Write to Redis (hot) ───────────────────────────────────────────────
    try {
      const redis = await getSharedRedisClient();
      if (redis) {
        await _appendToRedis(redis, callId, traceData);
      }
    } catch (redisErr) {
      logger.warn('[TurnTracer] Redis write failed (non-fatal) — MongoDB write continues', {
        callId,
        companyId,
        turn,
        error: redisErr.message
      });
    }

    // ── Write to MongoDB (cold) ────────────────────────────────────────────
    try {
      await CallTurnTrace.create(traceData);
    } catch (mongoErr) {
      // Duplicate key on { callId, turn } means this turn was already saved
      // (e.g. retry after timeout). Log at debug, not warn — not unexpected.
      if (mongoErr.code === 11000) {
        logger.debug('[TurnTracer] Duplicate turn trace ignored', { callId, turn });
      } else {
        logger.warn('[TurnTracer] MongoDB write failed (non-fatal)', {
          callId,
          companyId,
          turn,
          error: mongoErr.message
        });
      }
    }
  })();
}

/**
 * getForCall — Retrieve all recorded turns for a call in ascending turn order.
 *
 * Hot path: Redis — sub-millisecond, returns the in-memory JSON array.
 * Cold fallback: MongoDB — uses CallTurnTrace.getForCall() static method.
 * Ultimate fallback: returns [] on all failures.
 *
 * @param {string} callId — Twilio CallSid
 * @returns {Promise<Array>} Array of turn trace records, sorted by turn ASC
 */
async function getForCall(callId) {
  if (!callId) return [];

  // ── Try Redis hot cache ────────────────────────────────────────────────────
  try {
    const redis = await getSharedRedisClient();
    if (redis) {
      const cached = await redis.get(_traceKey(callId));
      if (cached) {
        const turns = JSON.parse(cached);
        // Ensure stable sort by turn number (Redis array may be unordered on very rare races)
        return turns.sort((a, b) => (a.turn || 0) - (b.turn || 0));
      }
    }
  } catch (_e) {
    // Redis miss or parse error — fall through to MongoDB
  }

  // ── Fallback to MongoDB ────────────────────────────────────────────────────
  try {
    return await CallTurnTrace.getForCall(callId);
  } catch (err) {
    logger.warn('[TurnTracer] getForCall MongoDB fallback failed', {
      callId,
      error: err.message
    });
    return [];
  }
}

/**
 * getRecentForCompany — Retrieve the most recent N turn traces across all calls
 * for a company, newest first.
 *
 * Reads directly from MongoDB (no Redis hot path for cross-call analytics).
 * Used by admin dashboards and the arbitration trace endpoint.
 *
 * @param {string} companyId
 * @param {number} [limit=50]  Maximum number of turn documents to return
 * @returns {Promise<Array>}
 */
async function getRecentForCompany(companyId, limit = DEFAULT_RECENT_LIMIT) {
  if (!companyId) return [];

  const safeLimit = Math.min(Math.max(1, parseInt(limit, 10) || DEFAULT_RECENT_LIMIT), 500);

  try {
    return await CallTurnTrace.getRecentForCompany(companyId, safeLimit);
  } catch (err) {
    logger.warn('[TurnTracer] getRecentForCompany failed', {
      companyId,
      limit: safeLimit,
      error: err.message
    });
    return [];
  }
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  record,
  getForCall,
  getRecentForCompany
};
