'use strict';

/**
 * ============================================================================
 * CoreGateJudgeCircuitBreaker — platform-wide kill switch for the LLM judge
 * ============================================================================
 *
 * WHY THIS EXISTS:
 *
 *   The coregate judge (CoreGateLLMJudge) calls Groq / OpenAI / Anthropic in
 *   the call path with a tight timeout (default 200ms). When the upstream
 *   provider has an outage or rate-limit storm, every concurrent call would
 *   eat the full timeout, kill latency budgets, and produce zero usable
 *   answers anyway. This breaker tracks consecutive judge failures across
 *   the platform and "opens" — every subsequent call short-circuits to the
 *   threshold-only fallback path until the breaker auto-closes (1h TTL) or
 *   an admin force-closes it.
 *
 * SHAPE — mirrors services/v2elevenLabsService.js:10-77:
 *
 *   - Two-tier state: Redis (shared, survives restarts) → in-memory
 *     fallback (single-process, still blocks floods within one window).
 *   - Failure tracking: separate counter (`kc:judge:failures:global`)
 *     incremented on every error path. When count ≥ FAILURE_THRESHOLD,
 *     the circuit opens.
 *   - Open semantics: a single boolean key (`kc:judge:circuit:global`)
 *     with TTL = CIRCUIT_BREAKER_TTL. Existence == open.
 *   - Recovery: any successful judge call resets the failure counter.
 *
 * SCOPE — platform-wide, NOT per-tenant:
 *
 *   The judge talks to ONE upstream provider regardless of which tenant
 *   triggered the call. If Groq is down, every tenant's judge fails. The
 *   breaker key is therefore global. Per-tenant CallTranscriptV2 events
 *   still carry companyId so observability can show who got affected.
 *
 * MULTI-TENANT SAFETY:
 *
 *   - No hardcoded tenant references.
 *   - Empty / unreachable Redis = degraded mode using in-memory state.
 *     A single process still blocks floods; a multi-instance fleet loses
 *     coordination but each instance independently reaches the threshold
 *     and opens its own breaker.
 *   - The judge module ALWAYS calls isOpen() before doing work; this
 *     module never throws.
 *
 * @module services/engine/kc/CoreGateJudgeCircuitBreaker
 * ============================================================================
 */

const logger = require('../../../utils/logger');

// ─── Tunables ─────────────────────────────────────────────────────────────
// Mirror v2elevenLabsService.js: 1h auto-recovery, 3-strike threshold.
const CIRCUIT_BREAKER_TTL_S = 3600;          // open for 1h on trip
const FAILURE_THRESHOLD     = 3;             // open after N consecutive failures
const FAILURE_WINDOW_S      = 60;            // failures must occur within this window
const CIRCUIT_KEY           = 'kc:judge:circuit:global';
const FAILURE_KEY           = 'kc:judge:failures:global';

// ─── In-memory fallback state ─────────────────────────────────────────────
// Used when Redis is unreachable. Maps the same two pieces of state.
let _memCircuitExpiresAt = 0;        // epoch ms — circuit open until this
let _memFailCount        = 0;
let _memFailFirstAt      = 0;        // epoch ms — when the current failure run started

// ─── Redis client (lazy, best-effort) ─────────────────────────────────────
let _redisFactory = null;
function _loadRedisFactory() {
    if (_redisFactory !== null) return _redisFactory;
    try {
        _redisFactory = require('../../redisClientFactory');
    } catch (_err) {
        _redisFactory = false;
    }
    return _redisFactory;
}

async function _getRedis() {
    const factory = _loadRedisFactory();
    if (!factory || typeof factory.getSharedRedisClient !== 'function') return null;
    try { return await factory.getSharedRedisClient(); } catch (_err) { return null; }
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * @returns {Promise<boolean>} true if the breaker is currently open.
 */
async function isOpen() {
    // Redis first (shared truth across instances).
    try {
        const redis = await _getRedis();
        if (redis) {
            const val = await redis.get(CIRCUIT_KEY);
            if (val) return true;
        }
    } catch (_err) { /* fall through to memory */ }

    // In-memory fallback — single process.
    if (_memCircuitExpiresAt && Date.now() < _memCircuitExpiresAt) return true;
    if (_memCircuitExpiresAt && Date.now() >= _memCircuitExpiresAt) {
        _memCircuitExpiresAt = 0;  // expired → close
    }
    return false;
}

/**
 * Record a judge success. Resets the consecutive-failure counter so a single
 * sporadic timeout doesn't carry over and trip the breaker prematurely.
 *
 * @param {object} [meta] — optional context (companyId, sectionId, latencyMs)
 */
async function recordSuccess(_meta = {}) {
    _memFailCount   = 0;
    _memFailFirstAt = 0;
    try {
        const redis = await _getRedis();
        if (redis) {
            await redis.del(FAILURE_KEY);
        }
    } catch (_err) { /* best-effort */ }
}

/**
 * Record a judge failure. When consecutive failures within FAILURE_WINDOW_S
 * reach FAILURE_THRESHOLD, the breaker opens.
 *
 * @param {object} [meta]           — { companyId, sectionId, reason, error }
 * @returns {Promise<{opened: boolean, count: number}>}
 */
async function recordFailure(meta = {}) {
    const now = Date.now();
    let count = 0;
    let opened = false;

    // Try Redis-coordinated counter first.
    try {
        const redis = await _getRedis();
        if (redis) {
            // INCR + EXPIRE is the standard pattern. EXPIRE only sets if the
            // key was newly created — failures within the window keep counting.
            count = Number(await redis.incr(FAILURE_KEY)) || 1;
            if (count === 1) {
                await redis.expire(FAILURE_KEY, FAILURE_WINDOW_S);
            }
            if (count >= FAILURE_THRESHOLD) {
                await redis.set(CIRCUIT_KEY, 'open', { EX: CIRCUIT_BREAKER_TTL_S });
                opened = true;
            }
        }
    } catch (_err) { /* fall through to memory */ }

    // Always update in-memory state too — both as a fallback when Redis is
    // unreachable AND so the in-process cached `isOpen()` agrees with the
    // shared truth without paying a Redis round-trip.
    if (!_memFailFirstAt || (now - _memFailFirstAt) > FAILURE_WINDOW_S * 1000) {
        _memFailFirstAt = now;
        _memFailCount   = 1;
    } else {
        _memFailCount += 1;
    }
    if (_memFailCount >= FAILURE_THRESHOLD) {
        _memCircuitExpiresAt = now + CIRCUIT_BREAKER_TTL_S * 1000;
        opened = opened || true;
    }

    if (count === 0) count = _memFailCount;

    if (opened) {
        logger.warn('[CoreGateJudgeCircuitBreaker] OPENED — judge calls suspended', {
            count,
            ttlSeconds: CIRCUIT_BREAKER_TTL_S,
            reason: meta.reason || 'unknown',
            companyId: meta.companyId,
            sectionId: meta.sectionId,
        });
    }

    return { opened, count };
}

/**
 * Force the breaker open. Used as an emergency lever when the LLM provider
 * is in a known-bad state and we want to bypass judge calls entirely.
 *
 * Render Shell example:
 *   node -e "require('./services/engine/kc/CoreGateJudgeCircuitBreaker').forceOpen('manual')"
 *
 * @param {string} [reason]
 */
async function forceOpen(reason = 'manual') {
    _memCircuitExpiresAt = Date.now() + CIRCUIT_BREAKER_TTL_S * 1000;
    try {
        const redis = await _getRedis();
        if (redis) {
            await redis.set(CIRCUIT_KEY, `forced:${reason}`, { EX: CIRCUIT_BREAKER_TTL_S });
        }
    } catch (_err) { /* in-memory already set */ }
    logger.warn('[CoreGateJudgeCircuitBreaker] FORCED OPEN', { reason, ttlSeconds: CIRCUIT_BREAKER_TTL_S });
}

/**
 * Force the breaker closed. Used to immediately resume judge calls after an
 * upstream incident is resolved without waiting for the TTL.
 */
async function forceClose() {
    _memCircuitExpiresAt = 0;
    _memFailCount        = 0;
    _memFailFirstAt      = 0;
    try {
        const redis = await _getRedis();
        if (redis) {
            await redis.del(CIRCUIT_KEY);
            await redis.del(FAILURE_KEY);
        }
    } catch (_err) { /* in-memory already reset */ }
    logger.info('[CoreGateJudgeCircuitBreaker] FORCED CLOSED');
}

/**
 * Snapshot for observability / health endpoint.
 * @returns {Promise<{open: boolean, expiresAt: number|null, failureCount: number}>}
 */
async function getState() {
    const open = await isOpen();
    let failureCount = 0;
    let expiresAtMs = null;

    try {
        const redis = await _getRedis();
        if (redis) {
            const fc = await redis.get(FAILURE_KEY);
            if (fc !== null) failureCount = Number(fc) || 0;
            if (open) {
                const ttl = await redis.ttl(CIRCUIT_KEY);
                if (typeof ttl === 'number' && ttl > 0) {
                    expiresAtMs = Date.now() + ttl * 1000;
                }
            }
        }
    } catch (_err) { /* fall through to memory */ }

    if (failureCount === 0) failureCount = _memFailCount;
    if (open && expiresAtMs === null && _memCircuitExpiresAt) expiresAtMs = _memCircuitExpiresAt;

    return { open, expiresAt: expiresAtMs, failureCount };
}

/**
 * Test hook — reset all in-memory state so tests don't leak between runs.
 * Not for production use.
 */
function _resetForTests() {
    _memCircuitExpiresAt = 0;
    _memFailCount        = 0;
    _memFailFirstAt      = 0;
}

module.exports = {
    isOpen,
    recordSuccess,
    recordFailure,
    forceOpen,
    forceClose,
    getState,
    // exposed for tests + health endpoint
    CIRCUIT_BREAKER_TTL_S,
    FAILURE_THRESHOLD,
    FAILURE_WINDOW_S,
    CIRCUIT_KEY,
    FAILURE_KEY,
    _resetForTests,
};
