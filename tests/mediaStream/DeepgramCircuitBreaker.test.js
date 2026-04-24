/**
 * Unit tests for services/mediaStream/DeepgramCircuitBreaker.js
 * Tests the in-memory fallback path (Redis factory mocked to return null).
 */

// Force Redis factory to report unavailable so we exercise the in-memory path.
jest.mock('../../services/redisClientFactory', () => ({
    isRedisConfigured: () => false,
    getSharedRedisClient: async () => null
}));

const CB = require('../../services/mediaStream/DeepgramCircuitBreaker');

beforeEach(() => {
    CB._internals._resetForTests();
});

describe('DeepgramCircuitBreaker.isOpen', () => {
    test('returns false by default', async () => {
        expect(await CB.isOpen()).toBe(false);
    });

    test('returns true after forceOpen', async () => {
        await CB.forceOpen('test');
        expect(await CB.isOpen()).toBe(true);
    });

    test('forceClose clears an open circuit', async () => {
        await CB.forceOpen('test');
        expect(await CB.isOpen()).toBe(true);
        await CB.forceClose();
        expect(await CB.isOpen()).toBe(false);
    });
});

describe('DeepgramCircuitBreaker.recordFailure', () => {
    test('does not open below threshold', async () => {
        await CB.recordFailure('first');
        await CB.recordFailure('second');
        expect(await CB.isOpen()).toBe(false);
    });

    test('opens at threshold (3 consecutive failures)', async () => {
        await CB.recordFailure('f1');
        await CB.recordFailure('f2');
        await CB.recordFailure('f3');
        expect(await CB.isOpen()).toBe(true);
    });

    test('recordSuccess clears failure streak', async () => {
        await CB.recordFailure('f1');
        await CB.recordFailure('f2');
        await CB.recordSuccess();
        await CB.recordFailure('new-f1');
        await CB.recordFailure('new-f2');
        // Should still be below threshold (counter was reset)
        expect(await CB.isOpen()).toBe(false);
    });
});

describe('DeepgramCircuitBreaker.getState', () => {
    test('snapshot includes threshold constants', async () => {
        const s = await CB.getState();
        expect(s.open).toBe(false);
        expect(s.thresholds.failure).toBe(CB._internals.FAILURE_THRESHOLD);
        expect(s.thresholds.circuitTtlSec).toBe(CB._internals.CIRCUIT_TTL_SECONDS);
    });

    test('reports open state and reason after forceOpen', async () => {
        await CB.forceOpen('manual');
        const s = await CB.getState();
        expect(s.open).toBe(true);
        expect(s.reason).toBe('manual');
    });
});
