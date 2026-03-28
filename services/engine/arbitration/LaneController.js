'use strict';

/**
 * ============================================================================
 * LANE CONTROLLER
 * ============================================================================
 *
 * Redis-backed per-call lane state management for the Intent Arbitration Engine.
 *
 * PURPOSE:
 *   A "lane" represents the dominant intent category that a call is currently
 *   locked into. Once a caller enters a lane (e.g. BOOKING), the arbitration
 *   engine filters candidate signals to only those compatible with that lane —
 *   preventing mid-booking digressions from derailing the conversation flow.
 *
 * LANE LIFECYCLE:
 *   1. Call starts → lane = null (no lock, all candidates compete freely)
 *   2. ArbitrationEngine sets a winner → LaneController.setLane() locks it
 *   3. Subsequent turns: ArbitrationEngine filters to lane-compatible signals
 *   4. Escape keyword detected → LaneController.clearLane() → open competition
 *   5. Call ends → Redis TTL auto-expires the key (or explicit clearLane call)
 *
 * ESCAPE KEYWORDS:
 *   Each company policy can define escape phrases that break a lane lock.
 *   Example: caller in BOOKING lane says "actually, I have a different question"
 *   → isEscapeKeyword() returns true → ArbitrationEngine clears the lane and
 *   treats the next turn as open competition.
 *
 * REDIS KEY PATTERN:
 *   lane:{callId}
 *   TTL: configurable per policy (default 300_000ms / 5 min). Auto-expires
 *   if the call ends without an explicit clearLane call — prevents orphan keys.
 *
 * GRACEFUL DEGRADE:
 *   If Redis is unavailable (network error, timeout, not configured),
 *   all operations log a warning and return null/void. The call continues
 *   without lane locking — suboptimal UX but never a call failure.
 *
 * MULTI-TENANT SAFETY:
 *   The callId used as the Redis key suffix is a Twilio CallSid (CA...) which
 *   is globally unique — no cross-tenant collision possible.
 *
 * PUBLIC API:
 *   getLane(callId)                    → String|null
 *   setLane(callId, lane, ttlMs)       → void
 *   clearLane(callId)                  → void
 *   isEscapeKeyword(input, escapeList) → boolean
 *
 * ============================================================================
 */

const { getSharedRedisClient } = require('../../redisClientFactory');
const logger                   = require('../../../utils/logger');

// ── Lane Enum Constants ───────────────────────────────────────────────────────

/**
 * LANES — Valid lane identifiers for the arbitration engine.
 * These are stored as raw strings in Redis so they must be stable identifiers.
 * Never rename a lane value without a migration — live calls read these strings.
 */
const LANES = Object.freeze({
  INTAKE:    'INTAKE',
  BOOKING:   'BOOKING',
  DISCOVERY: 'DISCOVERY',
  PRICING:   'PRICING',
  TRANSFER:  'TRANSFER'
});

const VALID_LANE_SET = new Set(Object.values(LANES));

// ── Defaults ──────────────────────────────────────────────────────────────────

/** Default lane TTL in milliseconds — 5 minutes. Overridden by policy.laneTimeoutMs. */
const DEFAULT_TTL_MS = 300_000;

/** Redis TTL is stored in seconds. */
function _msToSeconds(ms) {
  return Math.ceil(ms / 1000);
}

// ── Redis Key Helpers ─────────────────────────────────────────────────────────

/**
 * _laneKey — Build the Redis key for a callId.
 * Pattern: lane:{callId}
 * @param {string} callId — Twilio CallSid (CA...)
 * @returns {string}
 */
function _laneKey(callId) {
  return `lane:${callId}`;
}

// ── Input Normalization ───────────────────────────────────────────────────────

/**
 * _normalizeInput — Lowercase, strip punctuation (keep apostrophes), collapse spaces.
 * Used for both lane values (stored) and escape-keyword matching at call time.
 * @param {string} str
 * @returns {string}
 */
function _normalizeInput(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * getLane — Retrieve the current lane for a call from Redis.
 *
 * Returns null on cache miss, on Redis error, or when no lane has been set.
 * The caller (ArbitrationEngine) treats null as "open competition — no filter".
 *
 * @param {string} callId — Twilio CallSid or equivalent unique call identifier
 * @returns {Promise<string|null>} — One of LANES values, or null
 */
async function getLane(callId) {
  if (!callId) return null;

  let redis;
  try {
    redis = await getSharedRedisClient();
    if (!redis) return null;
  } catch (_e) {
    return null;
  }

  try {
    const value = await redis.get(_laneKey(callId));
    return VALID_LANE_SET.has(value) ? value : null;
  } catch (err) {
    logger.warn('[LaneController] getLane Redis error — returning null', {
      callId,
      error: err.message
    });
    return null;
  }
}

/**
 * setLane — Write (or overwrite) the lane for a call in Redis.
 *
 * The TTL is refreshed on every setLane call, ensuring the key does not expire
 * mid-booking if the caller takes a while to respond.
 *
 * @param {string} callId  — Twilio CallSid
 * @param {string} lane    — Must be a LANES value; invalid values are rejected with a warning
 * @param {number} [ttlMs] — TTL in milliseconds. Defaults to DEFAULT_TTL_MS (5 min)
 * @returns {Promise<void>}
 */
async function setLane(callId, lane, ttlMs = DEFAULT_TTL_MS) {
  if (!callId || !lane) return;

  if (!VALID_LANE_SET.has(lane)) {
    logger.warn('[LaneController] setLane called with invalid lane value — ignoring', {
      callId,
      lane,
      validLanes: Object.values(LANES)
    });
    return;
  }

  let redis;
  try {
    redis = await getSharedRedisClient();
    if (!redis) return;
  } catch (_e) {
    return;
  }

  const ttlSeconds = _msToSeconds(ttlMs > 0 ? ttlMs : DEFAULT_TTL_MS);

  try {
    await redis.setEx(_laneKey(callId), ttlSeconds, lane);
    logger.debug('[LaneController] Lane set', { callId, lane, ttlSeconds });
  } catch (err) {
    logger.warn('[LaneController] setLane Redis error — lane lock skipped', {
      callId,
      lane,
      error: err.message
    });
  }
}

/**
 * clearLane — Delete the lane lock for a call.
 *
 * Called when:
 *   - An escape keyword is detected by ArbitrationEngine
 *   - The call ends (v2twilio.js status-callback)
 *   - A TRANSFER action fires (call is leaving the platform)
 *
 * Silently succeeds if the key does not exist (DEL is idempotent).
 *
 * @param {string} callId — Twilio CallSid
 * @returns {Promise<void>}
 */
async function clearLane(callId) {
  if (!callId) return;

  let redis;
  try {
    redis = await getSharedRedisClient();
    if (!redis) return;
  } catch (_e) {
    return;
  }

  try {
    await redis.del(_laneKey(callId));
    logger.debug('[LaneController] Lane cleared', { callId });
  } catch (err) {
    logger.warn('[LaneController] clearLane Redis error — lane may persist until TTL', {
      callId,
      error: err.message
    });
  }
}

/**
 * isEscapeKeyword — Synchronous check whether the caller's input matches any
 * escape phrase from the company policy's escapeKeywords list.
 *
 * Matching rules (mirrors SmartInterceptorService.test ANY mode):
 *   - Multi-word phrase → substring match on normalized input
 *   - Single word → whole-word boundary match (prevents "transfer" matching "transferred")
 *
 * @param {string}   input      — Raw caller utterance
 * @param {string[]} escapeList — Array of escape phrases from CompanyArbitrationPolicy
 * @returns {boolean}
 */
function isEscapeKeyword(input, escapeList) {
  if (!input || !Array.isArray(escapeList) || escapeList.length === 0) return false;

  const norm    = _normalizeInput(input);
  const words   = norm.split(/\s+/);

  for (const phrase of escapeList) {
    const normPhrase = _normalizeInput(phrase);
    if (!normPhrase) continue;

    if (normPhrase.includes(' ')) {
      // Multi-word: substring match
      if (norm.includes(normPhrase)) return true;
    } else {
      // Single word: whole-word match
      if (words.includes(normPhrase)) return true;
    }
  }

  return false;
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  LANES,
  DEFAULT_TTL_MS,
  getLane,
  setLane,
  clearLane,
  isEscapeKeyword
};
