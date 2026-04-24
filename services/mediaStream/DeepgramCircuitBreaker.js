/**
 * DeepgramCircuitBreaker.js — Platform-wide kill switch for Media Streams
 *
 * Mirrors the pattern in services/v2elevenLabsService.js (Redis primary,
 * in-memory fallback, 1-hour TTL). One platform-wide key protects every
 * tenant simultaneously — if Deepgram is down, every call instantly falls
 * back to <Gather> with no wasted connect attempts.
 *
 * Lifecycle:
 *   recordFailure()  → counts consecutive failures, opens circuit at ≥3
 *   recordSuccess()  → clears the failure counter
 *   isOpen()         → cheap check callers do before attempting a WS connect
 *   forceOpen()      → emergency manual kill switch (Render shell)
 *   forceClose()     → manual reset
 *
 * @module services/mediaStream/DeepgramCircuitBreaker
 * @version 1.0.0
 */

'use strict';

const logger = require('../../utils/logger');

const CIRCUIT_KEY = 'deepgram:ms:circuit:global';
const FAILURE_KEY = 'deepgram:ms:failures:global';
const CIRCUIT_TTL_SECONDS = 3600;      // 1 hour
const FAILURE_TTL_SECONDS = 300;       // 5 min window for counting streaks
const FAILURE_THRESHOLD = 3;           // 3 consecutive failures → open

// In-memory fallback (single-process). Still blocks flood within the hour
// if Redis isn't configured.
const _memCircuit = { openUntil: 0, reason: null };
let _memFailures = 0;
let _memFailuresExpiresAt = 0;

// Lazy-loaded Redis factory. Mirrors v2elevenLabsService pattern.
let _redisFactory = null;
function _loadRedisFactory() {
    if (_redisFactory !== null) return _redisFactory;
    try {
        _redisFactory = require('../redisClientFactory');
    } catch (_err) {
        _redisFactory = false;
    }
    return _redisFactory;
}

async function _getRedisClient() {
    const factory = _loadRedisFactory();
    if (!factory || !factory.isRedisConfigured || !factory.isRedisConfigured()) return null;
    try { return await factory.getSharedRedisClient(); } catch (_err) { return null; }
}

function _now() { return Date.now(); }

/**
 * Check if the circuit is open. Returns true → callers must skip Media
 * Streams and fall back to Gather.
 *
 * @returns {Promise<boolean>}
 */
async function isOpen() {
    // Redis first
    try {
        const redis = await _getRedisClient();
        if (redis) {
            const val = await redis.get(CIRCUIT_KEY);
            if (val) return true;
        }
    } catch (_err) { /* fall through */ }

    // In-memory fallback
    if (_memCircuit.openUntil && _now() < _memCircuit.openUntil) return true;
    if (_memCircuit.openUntil && _now() >= _memCircuit.openUntil) {
        _memCircuit.openUntil = 0;
        _memCircuit.reason = null;
    }
    return false;
}

/**
 * Open the circuit immediately (emergency or after failure threshold).
 * @param {string} reason
 */
async function _openCircuit(reason) {
    const safeReason = String(reason || 'deepgram_unreachable').slice(0, 120);
    _memCircuit.openUntil = _now() + (CIRCUIT_TTL_SECONDS * 1000);
    _memCircuit.reason = safeReason;
    logger.warn(`[DG CIRCUIT] OPEN — Media Streams path disabled for ${CIRCUIT_TTL_SECONDS}s`, {
        reason: safeReason
    });
    try {
        const redis = await _getRedisClient();
        if (redis) {
            await redis.set(CIRCUIT_KEY, safeReason, { EX: CIRCUIT_TTL_SECONDS });
        }
    } catch (_err) { /* in-memory already set */ }
}

/**
 * Close the circuit and clear failure counter.
 */
async function _closeCircuit() {
    _memCircuit.openUntil = 0;
    _memCircuit.reason = null;
    _memFailures = 0;
    _memFailuresExpiresAt = 0;
    try {
        const redis = await _getRedisClient();
        if (redis) {
            await redis.del(CIRCUIT_KEY);
            await redis.del(FAILURE_KEY);
        }
    } catch (_err) { /* in-memory already cleared */ }
    logger.info('[DG CIRCUIT] CLOSED — Media Streams path re-enabled');
}

/**
 * Record a failed Deepgram connection attempt. Opens circuit on threshold.
 * @param {string} [reason]
 */
async function recordFailure(reason) {
    let count = 0;

    // Redis path
    try {
        const redis = await _getRedisClient();
        if (redis) {
            count = await redis.incr(FAILURE_KEY);
            if (count === 1) await redis.expire(FAILURE_KEY, FAILURE_TTL_SECONDS);
        }
    } catch (_err) { /* fall through to memory */ }

    // Always update memory counter too
    if (_memFailuresExpiresAt < _now()) {
        _memFailures = 0;
    }
    _memFailures += 1;
    _memFailuresExpiresAt = _now() + (FAILURE_TTL_SECONDS * 1000);

    // Use the higher of the two counters (Redis is canonical when available)
    const effectiveCount = Math.max(count, _memFailures);

    logger.warn('[DG CIRCUIT] failure recorded', {
        count: effectiveCount,
        threshold: FAILURE_THRESHOLD,
        reason: reason || 'unknown'
    });

    if (effectiveCount >= FAILURE_THRESHOLD) {
        await _openCircuit(reason || `threshold_${effectiveCount}_failures`);
    }
}

/**
 * Record a successful Deepgram connection. Clears the failure counter so a
 * transient blip doesn't carry weight toward threshold.
 */
async function recordSuccess() {
    _memFailures = 0;
    _memFailuresExpiresAt = 0;
    try {
        const redis = await _getRedisClient();
        if (redis) {
            await redis.del(FAILURE_KEY);
        }
    } catch (_err) { /* memory already cleared */ }
}

/**
 * Force the circuit open (emergency manual kill switch).
 * Callable from Render shell:
 *   node -e "require('./services/mediaStream/DeepgramCircuitBreaker').forceOpen('manual')"
 */
async function forceOpen(reason) {
    await _openCircuit(reason || 'manual_force_open');
}

/**
 * Force the circuit closed (manual reset).
 */
async function forceClose() {
    await _closeCircuit();
}

/**
 * Inspect state for health endpoints.
 * @returns {Promise<{open:boolean, reason:string|null, failures:number}>}
 */
async function getState() {
    const open = await isOpen();
    return {
        open,
        reason: _memCircuit.reason,
        failures: _memFailures,
        thresholds: { failure: FAILURE_THRESHOLD, circuitTtlSec: CIRCUIT_TTL_SECONDS }
    };
}

module.exports = {
    isOpen,
    recordFailure,
    recordSuccess,
    forceOpen,
    forceClose,
    getState,
    // exports for tests
    _internals: {
        CIRCUIT_KEY,
        FAILURE_KEY,
        CIRCUIT_TTL_SECONDS,
        FAILURE_THRESHOLD,
        _resetForTests: () => {
            _memCircuit.openUntil = 0;
            _memCircuit.reason = null;
            _memFailures = 0;
            _memFailuresExpiresAt = 0;
        }
    }
};
