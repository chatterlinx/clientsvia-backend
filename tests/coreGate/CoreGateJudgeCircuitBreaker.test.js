/**
 * Unit tests for services/engine/kc/CoreGateJudgeCircuitBreaker.js
 *
 * Behaviour covered:
 *   - In-memory state transitions (Redis unreachable in test env).
 *   - 3-strike threshold within FAILURE_WINDOW_S.
 *   - Counter resets on success.
 *   - forceOpen / forceClose levers.
 *   - getState shape.
 *
 * The breaker is a singleton with module-level state; tests use the
 * `_resetForTests` hook between cases to keep them isolated.
 */

const breaker = require('../../services/engine/kc/CoreGateJudgeCircuitBreaker');

describe('CoreGateJudgeCircuitBreaker', () => {
  beforeEach(() => {
    breaker._resetForTests();
  });

  describe('initial state', () => {
    test('isOpen() is false on a fresh process', async () => {
      expect(await breaker.isOpen()).toBe(false);
    });

    test('getState reports closed + zero failures + null expiry', async () => {
      const s = await breaker.getState();
      expect(s.open).toBe(false);
      expect(s.failureCount).toBe(0);
      expect(s.expiresAt).toBeNull();
    });
  });

  describe('failure accumulation', () => {
    test('two consecutive failures keep breaker closed', async () => {
      const r1 = await breaker.recordFailure({ reason: 'JUDGE_TIMEOUT' });
      const r2 = await breaker.recordFailure({ reason: 'JUDGE_TIMEOUT' });
      expect(r1.opened).toBe(false);
      expect(r2.opened).toBe(false);
      expect(await breaker.isOpen()).toBe(false);
    });

    test('three consecutive failures open the breaker', async () => {
      await breaker.recordFailure({ reason: 'JUDGE_TIMEOUT' });
      await breaker.recordFailure({ reason: 'JUDGE_TIMEOUT' });
      const r3 = await breaker.recordFailure({ reason: 'JUDGE_TIMEOUT' });
      expect(r3.opened).toBe(true);
      expect(await breaker.isOpen()).toBe(true);
    });

    test('opened breaker reports a future expiresAt within TTL', async () => {
      await breaker.recordFailure({ reason: 'JUDGE_TIMEOUT' });
      await breaker.recordFailure({ reason: 'JUDGE_TIMEOUT' });
      await breaker.recordFailure({ reason: 'JUDGE_TIMEOUT' });
      const s = await breaker.getState();
      expect(s.open).toBe(true);
      expect(s.expiresAt).toBeGreaterThan(Date.now());
      expect(s.expiresAt - Date.now()).toBeLessThanOrEqual(breaker.CIRCUIT_BREAKER_TTL_S * 1000 + 1000);
    });
  });

  describe('recovery', () => {
    test('recordSuccess resets the in-memory counter', async () => {
      await breaker.recordFailure({ reason: 'A' });
      await breaker.recordFailure({ reason: 'B' });
      await breaker.recordSuccess();
      // After reset, two more failures should NOT trip — we need 3 from zero.
      const r3 = await breaker.recordFailure({ reason: 'C' });
      const r4 = await breaker.recordFailure({ reason: 'D' });
      expect(r3.opened).toBe(false);
      expect(r4.opened).toBe(false);
      expect(await breaker.isOpen()).toBe(false);
    });

    test('forceOpen marks breaker open immediately', async () => {
      await breaker.forceOpen('manual-test');
      expect(await breaker.isOpen()).toBe(true);
    });

    test('forceClose clears state even if previously opened', async () => {
      await breaker.forceOpen('manual-test');
      await breaker.forceClose();
      expect(await breaker.isOpen()).toBe(false);
      const s = await breaker.getState();
      expect(s.failureCount).toBe(0);
    });
  });

  describe('module exports', () => {
    test('exposes constants for callers + tests', () => {
      expect(typeof breaker.CIRCUIT_BREAKER_TTL_S).toBe('number');
      expect(breaker.FAILURE_THRESHOLD).toBe(3);
      expect(typeof breaker.FAILURE_WINDOW_S).toBe('number');
      expect(breaker.CIRCUIT_KEY).toMatch(/^kc:judge:circuit:/);
      expect(breaker.FAILURE_KEY).toMatch(/^kc:judge:failures:/);
    });

    test('keys are platform-wide (no tenant fragments)', () => {
      // Platform-wide breaker — keys must NOT contain a per-tenant component.
      expect(breaker.CIRCUIT_KEY).toMatch(/global$/);
      expect(breaker.FAILURE_KEY).toMatch(/global$/);
    });
  });

  describe('observability hooks never throw', () => {
    test('recordFailure with empty meta object', async () => {
      await expect(breaker.recordFailure()).resolves.toBeDefined();
      await expect(breaker.recordFailure({})).resolves.toBeDefined();
    });

    test('recordSuccess with no meta', async () => {
      await expect(breaker.recordSuccess()).resolves.toBeUndefined();
    });

    test('getState always returns the expected shape', async () => {
      const s = await breaker.getState();
      expect(s).toHaveProperty('open');
      expect(s).toHaveProperty('expiresAt');
      expect(s).toHaveProperty('failureCount');
    });
  });
});
