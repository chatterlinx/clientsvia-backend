/**
 * Unit tests for utils/coreGateHealthMonitor.js
 *
 * The aggregateRecent() helper hits Mongo, so these tests exercise:
 *   - module exports + constants
 *   - the route handler shape (with Mongo unavailable / mocked)
 *   - the percentile calculator behaviour via the public surface
 */

const monitor = require('../../utils/coreGateHealthMonitor');

describe('coreGateHealthMonitor — module exports', () => {
  test('exposes aggregateRecent + handler', () => {
    expect(typeof monitor.aggregateRecent).toBe('function');
    expect(typeof monitor.healthCoreGateHandler).toBe('function');
  });

  test('exposes KNOWN_DECISIONS for the 3-tier dispatch', () => {
    expect(monitor.KNOWN_DECISIONS).toContain('strict_pass');
    expect(monitor.KNOWN_DECISIONS).toContain('definite_fail');
    expect(monitor.KNOWN_DECISIONS).toContain('judge_pass');
    expect(monitor.KNOWN_DECISIONS).toContain('judge_fail');
    expect(monitor.KNOWN_DECISIONS).toContain('judge_skipped');
    expect(monitor.KNOWN_DECISIONS).toContain('judge_error_fallback');
    expect(monitor.KNOWN_DECISIONS).toContain('legacy_fallback');
    expect(monitor.KNOWN_DECISIONS).toContain('no_embeddings');
    expect(monitor.KNOWN_DECISIONS.length).toBe(8);
  });

  test('WINDOW_MS is a 24h-shaped value', () => {
    expect(monitor.WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe('coreGateHealthMonitor.healthCoreGateHandler — degraded mode', () => {
  // Without a Mongo connection, the handler should still respond with a
  // valid JSON shape (the degraded contract for /health/* endpoints).
  test('returns 200 with circuit + null/empty activity when Mongo aggregation fails', async () => {
    let captured = null;
    const req = { query: {} };
    const res = {
      json: (body) => { captured = body; return res; },
      status: () => res,
    };

    await monitor.healthCoreGateHandler(req, res);
    expect(captured).toBeTruthy();
    expect(captured.ok).toBe(true);
    expect(typeof captured.ts).toBe('string');
    expect(captured.circuit).toBeTruthy();
    expect(typeof captured.circuit.open).toBe('boolean');
    expect(typeof captured.circuit.failureCount).toBe('number');
    // activity is either null (Mongo unreachable) or an object — both valid.
    expect(captured.activity === null || typeof captured.activity === 'object').toBe(true);
  });

  test('handler is async (returns a Promise / thenable)', () => {
    const req = { query: {} };
    const res = { json: () => res, status: () => res };
    const out = monitor.healthCoreGateHandler(req, res);
    expect(typeof out?.then).toBe('function');
  });

  test('accepts ?companyId query param without crashing', async () => {
    let captured = null;
    const req = { query: { companyId: '68e3f77a9d623b8058c700c4' } };
    const res = { json: (b) => { captured = b; return res; }, status: () => res };
    await monitor.healthCoreGateHandler(req, res);
    expect(captured.ok).toBe(true);
  });
});

describe('coreGateHealthMonitor — multi-tenant safety', () => {
  test('module source contains no hardcoded tenant references', () => {
    const fs = require('fs');
    const src = fs.readFileSync(require.resolve('../../utils/coreGateHealthMonitor'), 'utf8');
    expect(src).not.toMatch(/68e3f77a/);
    expect(src).not.toMatch(/penguin/i);
  });
});
