/**
 * mediaStreamHealthMonitor — unit tests (C5/5)
 *
 * Covers: ring-buffer bounds, percentile math, success-rate math, 24h
 * fallback window, circuit-state merge, and the Express handler shape.
 * All in-memory — no Mongo, no Redis, no WebSocket.
 */

'use strict';

const express = require('express');
const request = require('supertest');

// Deepgram API key gating isn't relevant to the health monitor itself,
// but the circuit breaker that getHealthSnapshot() calls uses its own
// state (in-memory fallback). We reset both between tests.
describe('mediaStreamHealthMonitor', () => {
    let MS;
    let DGCB;

    beforeEach(() => {
        jest.resetModules();
        MS = require('../../utils/mediaStreamHealthMonitor');
        DGCB = require('../../services/mediaStream/DeepgramCircuitBreaker');
        MS._internals._resetForTests();
        DGCB._internals._resetForTests();
    });

    // ------------------------------------------------------------
    // Stream-open / stream-close gauge
    // ------------------------------------------------------------
    describe('active WS gauge', () => {
        test('increments on open and decrements on close', () => {
            expect(MS._internals._getActiveWS()).toBe(0);
            MS.recordStreamOpened();
            MS.recordStreamOpened();
            MS.recordStreamOpened();
            expect(MS._internals._getActiveWS()).toBe(3);
            MS.recordStreamClosed();
            expect(MS._internals._getActiveWS()).toBe(2);
        });

        test('never goes negative (extra close is a no-op)', () => {
            MS.recordStreamClosed();
            MS.recordStreamClosed();
            expect(MS._internals._getActiveWS()).toBe(0);
        });
    });

    // ------------------------------------------------------------
    // Deepgram connect ring + success rate
    // ------------------------------------------------------------
    describe('deepgramConnect', () => {
        test('reports null successRate on empty buffer', async () => {
            const snap = await MS.getHealthSnapshot();
            expect(snap.deepgramConnect.sampleSize).toBe(0);
            expect(snap.deepgramConnect.successRate).toBeNull();
        });

        test('computes success rate over mixed attempts', async () => {
            // 8 ok, 2 fail → 0.8
            for (let i = 0; i < 8; i += 1) MS.recordDeepgramAttempt(true);
            for (let i = 0; i < 2; i += 1) MS.recordDeepgramAttempt(false);
            const snap = await MS.getHealthSnapshot();
            expect(snap.deepgramConnect.sampleSize).toBe(10);
            expect(snap.deepgramConnect.successRate).toBeCloseTo(0.8, 3);
        });

        test('ring buffer caps samples at RING_CAPACITY but counts totalSinceBoot', async () => {
            const cap = MS._internals.RING_CAPACITY;
            for (let i = 0; i < cap + 50; i += 1) MS.recordDeepgramAttempt(true);
            const snap = await MS.getHealthSnapshot();
            expect(snap.deepgramConnect.sampleSize).toBe(cap);
            expect(snap.deepgramConnect.totalSinceBoot).toBe(cap + 50);
        });
    });

    // ------------------------------------------------------------
    // Turn latency — percentile math
    // ------------------------------------------------------------
    describe('turn latency', () => {
        test('null stats when no samples', async () => {
            const snap = await MS.getHealthSnapshot();
            expect(snap.turnLatencyMs.samples).toBe(0);
            expect(snap.turnLatencyMs.p50).toBeNull();
            expect(snap.turnLatencyMs.p95).toBeNull();
        });

        test('p50/p95/p99 over 100 ascending samples', async () => {
            for (let i = 1; i <= 100; i += 1) MS.recordTurnLatency(i * 10); // 10..1000ms
            const snap = await MS.getHealthSnapshot();
            expect(snap.turnLatencyMs.samples).toBe(100);
            // p50 at idx 50 → 510 ms
            expect(snap.turnLatencyMs.p50).toBe(510);
            // p95 at idx 95 → 960 ms
            expect(snap.turnLatencyMs.p95).toBe(960);
            // p99 at idx 99 → 1000 ms
            expect(snap.turnLatencyMs.p99).toBe(1000);
            expect(snap.turnLatencyMs.max).toBe(1000);
        });

        test('ignores negative and NaN values', async () => {
            MS.recordTurnLatency(-5);
            MS.recordTurnLatency(NaN);
            MS.recordTurnLatency(Infinity);
            MS.recordTurnLatency(250);
            const snap = await MS.getHealthSnapshot();
            expect(snap.turnLatencyMs.samples).toBe(1);
            expect(snap.turnLatencyMs.p50).toBe(250);
        });

        test('ring buffer caps at RING_CAPACITY (keeps the most recent)', async () => {
            const cap = MS._internals.RING_CAPACITY;
            // Write cap samples of 100, then 50 samples of 999 — the last
            // 50 should still be represented when querying p99.
            for (let i = 0; i < cap; i += 1) MS.recordTurnLatency(100);
            for (let i = 0; i < 50; i += 1) MS.recordTurnLatency(999);
            const snap = await MS.getHealthSnapshot();
            expect(snap.turnLatencyMs.samples).toBe(cap);
            expect(snap.turnLatencyMs.max).toBe(999);
        });
    });

    // ------------------------------------------------------------
    // Midcall fallbacks — 24h window
    // ------------------------------------------------------------
    describe('midcall fallback count', () => {
        test('returns 0 when nothing recorded', () => {
            expect(MS.getCountLast24h()).toBe(0);
        });

        test('counts all fresh records', () => {
            MS.recordMidcallFallback({ companyId: 'c-1', callSid: 'CA1', reason: 'dg_error:x' });
            MS.recordMidcallFallback({ companyId: 'c-2', callSid: 'CA2', reason: 'engine_error:y' });
            expect(MS.getCountLast24h()).toBe(2);
        });

        test('snapshot surfaces 24h window', async () => {
            MS.recordMidcallFallback({ reason: 'test' });
            const snap = await MS.getHealthSnapshot();
            expect(snap.midcallFallback.count).toBe(1);
            expect(snap.midcallFallback.windowMs).toBe(MS._internals.FALLBACK_WINDOW_MS);
        });
    });

    // ------------------------------------------------------------
    // Circuit state merge
    // ------------------------------------------------------------
    describe('circuit state in snapshot', () => {
        test('reports closed by default', async () => {
            const snap = await MS.getHealthSnapshot();
            expect(snap.circuit.open).toBe(false);
        });

        test('reflects forced-open circuit', async () => {
            await DGCB.forceOpen('unit_test_open');
            const snap = await MS.getHealthSnapshot();
            expect(snap.circuit.open).toBe(true);
            expect(snap.circuit.reason).toBe('unit_test_open');
        });
    });

    // ------------------------------------------------------------
    // Snapshot shape (stable contract for admin UI)
    // ------------------------------------------------------------
    describe('snapshot shape', () => {
        test('returns all expected top-level keys', async () => {
            const snap = await MS.getHealthSnapshot();
            expect(Object.keys(snap).sort()).toEqual([
                'activeWS',
                'circuit',
                'deepgramConnect',
                'midcallFallback',
                'timestamp',
                'totalTurns',
                'turnLatencyMs',
                'uptimeHours'
            ]);
            expect(typeof snap.timestamp).toBe('string');
            expect(typeof snap.uptimeHours).toBe('number');
        });
    });

    // ------------------------------------------------------------
    // Express handler
    // ------------------------------------------------------------
    describe('GET /health/media-streams handler', () => {
        function makeApp() {
            const app = express();
            app.get('/health/media-streams', MS.healthMediaStreamsHandler);
            return app;
        }

        test('returns JSON with { ok: true, mediaStreams: {...} }', async () => {
            MS.recordStreamOpened();
            MS.recordDeepgramAttempt(true);
            MS.recordTurnLatency(500);

            const res = await request(makeApp()).get('/health/media-streams');
            expect(res.status).toBe(200);
            expect(res.headers['content-type']).toMatch(/json/);
            expect(res.body.ok).toBe(true);
            expect(res.body.mediaStreams.activeWS).toBe(1);
            expect(res.body.mediaStreams.deepgramConnect.sampleSize).toBe(1);
            expect(res.body.mediaStreams.turnLatencyMs.p50).toBe(500);
        });

        test('returns 500 + error body when snapshot throws', async () => {
            const spy = jest.spyOn(MS, 'getHealthSnapshot').mockRejectedValueOnce(new Error('boom'));
            const res = await request(makeApp()).get('/health/media-streams');
            expect(res.status).toBe(500);
            expect(res.body.ok).toBe(false);
            expect(res.body.error).toBe('boom');
            spy.mockRestore();
        });
    });
});
