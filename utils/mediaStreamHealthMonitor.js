'use strict';

/**
 * ============================================================================
 * MEDIA STREAMS HEALTH MONITOR — Lean Platform Telemetry (C5/5)
 * ============================================================================
 *
 * Daily heartbeat + GET /health/media-streams endpoint.
 *
 * Pattern mirrors utils/memoryMonitor.js — all in-memory ring buffers, zero
 * database reads on the hot path. The MediaStreamServer pushes into this
 * module via record* calls; the health endpoint reads back aggregates.
 *
 * Tracks (per plan C5):
 *   - activeWS          — count of Twilio↔server WebSockets currently open
 *   - deepgramConnects  — ring buffer of last 1000 attempts { ok: true|false }
 *   - turnLatencyMs     — ring buffer of last 1000 turn wall-clock values
 *   - midcallFallbacks  — ring buffer of last 1000 { ts, companyId, reason }
 *                         (24h window surfaced via getCountLast24h)
 *   - circuit           — delegates to DeepgramCircuitBreaker.getState()
 *
 * Platform-wide: counts span every tenant. Per-tenant metrics remain in
 * CallTranscriptV2.trace (via MS_* events) for per-call debugging.
 *
 * ============================================================================
 */

const logger = require('./logger');

// ---------------------------------------------------------------------------
// In-memory metrics state
// ---------------------------------------------------------------------------

const RING_CAPACITY = 1000;           // last-N samples window
const FALLBACK_WINDOW_MS = 24 * 3600 * 1000; // 24h for MS_MIDCALL_FALLBACK count

// Currently-open Twilio↔server WebSocket connections
let _activeWS = 0;

// Connection attempt outcomes (ring buffer of booleans)
const _dgAttempts = [];
let _dgAttemptsHead = 0; // write index (wraps)
let _dgTotalAttempts = 0; // monotonic counter since process start

// Turn latencies (ms). Ring buffer of numbers.
const _turnLatencies = [];
let _turnLatenciesHead = 0;
let _totalTurns = 0;

// Mid-call fallbacks: ring buffer of { ts, companyId, reason }
const _fallbacks = [];
let _fallbacksHead = 0;

// Startup timestamp for derived metrics
const _startedAt = Date.now();

// ---------------------------------------------------------------------------
// Ring-buffer helpers
// ---------------------------------------------------------------------------

function _ringPush(ring, headRef, value) {
    // headRef is the name so we can mutate the closure's cursor.
    // Keeps the buffer size bounded at RING_CAPACITY.
    if (ring.length < RING_CAPACITY) {
        ring.push(value);
    } else {
        ring[headRef.i] = value;
        headRef.i = (headRef.i + 1) % RING_CAPACITY;
    }
}

// Small adapters so we only expose a record* API.
const _attemptsHeadRef  = { i: 0 };
const _latenciesHeadRef = { i: 0 };
const _fallbacksHeadRef = { i: 0 };

// ---------------------------------------------------------------------------
// Recording API (called by MediaStreamServer)
// ---------------------------------------------------------------------------

function recordStreamOpened() {
    _activeWS += 1;
}

function recordStreamClosed() {
    if (_activeWS > 0) _activeWS -= 1;
}

function recordDeepgramAttempt(ok) {
    _dgTotalAttempts += 1;
    _ringPush(_dgAttempts, _attemptsHeadRef, !!ok);
}

function recordTurnLatency(ms) {
    if (!Number.isFinite(ms) || ms < 0) return;
    _totalTurns += 1;
    _ringPush(_turnLatencies, _latenciesHeadRef, ms);
}

function recordMidcallFallback({ companyId = null, callSid = null, reason = null } = {}) {
    _ringPush(_fallbacks, _fallbacksHeadRef, {
        ts: Date.now(),
        companyId: companyId || null,
        callSid: callSid ? `${callSid}`.slice(-8) : null,
        reason: reason ? `${reason}`.slice(0, 120) : null
    });
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

function _percentile(sortedAsc, pct) {
    if (!sortedAsc.length) return null;
    const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((pct / 100) * sortedAsc.length)));
    return sortedAsc[idx];
}

function _turnLatencyStats() {
    if (!_turnLatencies.length) {
        return { samples: 0, p50: null, p95: null, p99: null, max: null };
    }
    const sorted = [..._turnLatencies].sort((a, b) => a - b);
    return {
        samples: sorted.length,
        p50: _percentile(sorted, 50),
        p95: _percentile(sorted, 95),
        p99: _percentile(sorted, 99),
        max: sorted[sorted.length - 1]
    };
}

function _dgSuccessRate() {
    if (!_dgAttempts.length) return { sampleSize: 0, successRate: null };
    const ok = _dgAttempts.reduce((n, v) => n + (v ? 1 : 0), 0);
    return {
        sampleSize: _dgAttempts.length,
        successRate: Math.round((ok / _dgAttempts.length) * 1000) / 1000,
        totalSinceBoot: _dgTotalAttempts
    };
}

function _fallbackCountLast24h() {
    const cutoff = Date.now() - FALLBACK_WINDOW_MS;
    const recent = _fallbacks.filter(f => f.ts >= cutoff);
    return { count: recent.length, windowMs: FALLBACK_WINDOW_MS };
}

function getCountLast24h() {
    return _fallbackCountLast24h().count;
}

/**
 * Build a platform-wide snapshot. Intended for /health/media-streams and the
 * daily heartbeat. Keeps output small & stable — no per-tenant data here
 * (that lives in CallTranscriptV2.trace).
 *
 * Returns a plain object; caller can serialize as JSON.
 */
async function getHealthSnapshot() {
    const latency = _turnLatencyStats();
    const connect = _dgSuccessRate();
    const fallback24h = _fallbackCountLast24h();

    // Circuit state is async (Redis or memory) — await it.
    let circuit = { open: false, failures: 0, reason: null };
    try {
        const DeepgramCircuitBreaker = require('../services/mediaStream/DeepgramCircuitBreaker');
        circuit = await DeepgramCircuitBreaker.getState();
    } catch (err) {
        circuit = { open: false, error: err.message };
    }

    return {
        timestamp: new Date().toISOString(),
        uptimeHours: Math.round(((Date.now() - _startedAt) / 3600000) * 10) / 10,
        activeWS: _activeWS,
        totalTurns: _totalTurns,
        turnLatencyMs: latency,
        deepgramConnect: connect,
        midcallFallback: fallback24h,
        circuit
    };
}

// ---------------------------------------------------------------------------
// Express route handler + daily heartbeat
// ---------------------------------------------------------------------------

/**
 * GET /health/media-streams
 *
 * Calls snapshot through module.exports so tests can spy on / mock the
 * function without patching the internal closure.
 */
async function healthMediaStreamsHandler(_req, res) {
    try {
        const snap = await module.exports.getHealthSnapshot();
        return res.json({ ok: true, mediaStreams: snap });
    } catch (err) {
        logger.error('[MS-HEALTH] snapshot failed', { error: err.message });
        return res.status(500).json({ ok: false, error: err.message });
    }
}

/**
 * Start the daily heartbeat log. Mirrors memoryMonitor's pattern — first
 * snapshot on startup, then every 24h. timer.unref() so tests can exit.
 */
function startDailyHeartbeat() {
    getHealthSnapshot()
        .then((snap) => logger.info('[MS-HEALTH] Startup snapshot', snap))
        .catch((err) => logger.warn('[MS-HEALTH] Startup snapshot failed', { error: err.message }));

    const timer = setInterval(() => {
        getHealthSnapshot()
            .then((snap) => {
                const level = (snap.circuit?.open || snap.deepgramConnect.successRate !== null && snap.deepgramConnect.successRate < 0.8)
                    ? 'warn'
                    : 'info';
                logger[level]('[MS-HEALTH] Daily heartbeat', snap);
            })
            .catch((err) => logger.warn('[MS-HEALTH] Daily heartbeat failed', { error: err.message }));
    }, 24 * 3600 * 1000);

    timer.unref();
    return timer;
}

// ---------------------------------------------------------------------------
// Test helper — resets in-memory state between tests
// ---------------------------------------------------------------------------

function _resetForTests() {
    _activeWS = 0;
    _dgAttempts.length = 0;
    _dgAttemptsHead = 0;
    _dgTotalAttempts = 0;
    _turnLatencies.length = 0;
    _turnLatenciesHead = 0;
    _totalTurns = 0;
    _fallbacks.length = 0;
    _attemptsHeadRef.i = 0;
    _latenciesHeadRef.i = 0;
    _fallbacksHeadRef.i = 0;
}

module.exports = {
    recordStreamOpened,
    recordStreamClosed,
    recordDeepgramAttempt,
    recordTurnLatency,
    recordMidcallFallback,
    getCountLast24h,
    getHealthSnapshot,
    healthMediaStreamsHandler,
    startDailyHeartbeat,
    // internals for tests
    _internals: {
        RING_CAPACITY,
        FALLBACK_WINDOW_MS,
        _resetForTests,
        _getActiveWS: () => _activeWS,
        _getAttemptsCount: () => _dgAttempts.length
    }
};
