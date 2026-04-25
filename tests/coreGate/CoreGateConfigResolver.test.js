/**
 * Unit tests for services/engine/kc/CoreGateConfigResolver.js
 *
 * Resolution order:
 *   tenant override → platform default → hardcoded last-resort
 *
 * Plus per-field validators (provider enum, model non-empty, threshold
 * clamps, inverted threshold snap) that must NEVER throw.
 */

const {
  resolveCoreGateConfig,
  LAST_RESORT,
  SUPPORTED_PROVIDERS,
} = require('../../services/engine/kc/CoreGateConfigResolver');

function makeAdmin(overrides = {}) {
  return { globalHub: { coreGateJudge: overrides } };
}

function makeCompany(overrides = {}) {
  return {
    aiAgentSettings: {
      agent2: {
        speechDetection: {
          coreGate: overrides,
        },
      },
    },
  };
}

describe('CoreGateConfigResolver.resolveCoreGateConfig', () => {
  describe('fallback chain', () => {
    test('returns last-resort defaults when neither tenant nor platform supplies anything', async () => {
      // Pass an empty admin object so the resolver doesn't try to lazy-load
      // AdminSettings via Mongoose (the lazy-load path requires a live DB
      // connection and buffers for 10s in unit tests; a separate slow test
      // below covers that degraded-mode path explicitly).
      const r = await resolveCoreGateConfig({ company: {}, adminSettings: {} });
      expect(r.thresholdHigh).toBe(LAST_RESORT.thresholdHigh);
      expect(r.thresholdLow).toBe(LAST_RESORT.thresholdLow);
      expect(r.judgeEnabled).toBe(LAST_RESORT.judgeEnabled);
      expect(r.judgeProvider).toBe(LAST_RESORT.judgeProvider);
      expect(r.judgeModel).toBe(LAST_RESORT.judgeModel);
      expect(r.judgeTimeoutMs).toBe(LAST_RESORT.judgeTimeoutMs);
      // Every field should be tagged 'lastResort'.
      expect(r._source.thresholdHigh).toBe('lastResort');
      expect(r._source.judgeEnabled).toBe('lastResort');
    });

    test('degraded mode — AdminSettings lazy-load failure returns last-resort without throwing', async () => {
      // No adminSettings argument → resolver lazy-loads via Mongoose. With
      // no DB connection, the load times out (default 10s) and the resolver
      // falls through to LAST_RESORT. We just verify it returns successfully
      // and never throws. The 15s timeout accommodates the Mongoose buffer.
      const r = await resolveCoreGateConfig({ company: {} });
      expect(r.thresholdHigh).toBe(LAST_RESORT.thresholdHigh);
      expect(r._source.thresholdHigh).toBe('lastResort');
    }, 15000);

    test('platform default beats last-resort when tenant has no override', async () => {
      const admin = makeAdmin({
        thresholdHigh: 0.90,
        thresholdLow: 0.70,
        judgeEnabled: false,
        judgeProvider: 'openai',
        judgeModel: 'gpt-4o-mini',
        judgeTimeoutMs: 350,
      });
      const r = await resolveCoreGateConfig({ company: makeCompany({}), adminSettings: admin });
      expect(r.thresholdHigh).toBe(0.90);
      expect(r.thresholdLow).toBe(0.70);
      expect(r.judgeEnabled).toBe(false);
      expect(r.judgeProvider).toBe('openai');
      expect(r.judgeModel).toBe('gpt-4o-mini');
      expect(r.judgeTimeoutMs).toBe(350);
      expect(r._source.thresholdHigh).toBe('platform');
      expect(r._source.judgeEnabled).toBe('platform');
    });

    test('tenant override beats platform default per-field', async () => {
      const admin = makeAdmin({
        thresholdHigh: 0.85,
        thresholdLow: 0.65,
        judgeEnabled: true,
        judgeProvider: 'groq',
        judgeModel: 'llama-3.1-8b-instant',
        judgeTimeoutMs: 200,
      });
      // Tenant overrides only thresholds; everything else inherits.
      const company = makeCompany({
        thresholdHigh: 0.92,
        thresholdLow: 0.55,
      });
      const r = await resolveCoreGateConfig({ company, adminSettings: admin });
      expect(r.thresholdHigh).toBe(0.92);
      expect(r.thresholdLow).toBe(0.55);
      expect(r._source.thresholdHigh).toBe('tenant');
      expect(r._source.thresholdLow).toBe('tenant');
      // Inherited fields stay at platform.
      expect(r.judgeProvider).toBe('groq');
      expect(r._source.judgeProvider).toBe('platform');
    });

    test('null tenant value falls through to platform (does not lock-in null)', async () => {
      const admin = makeAdmin({ thresholdHigh: 0.90 });
      const company = makeCompany({ thresholdHigh: null });
      const r = await resolveCoreGateConfig({ company, adminSettings: admin });
      expect(r.thresholdHigh).toBe(0.90);
      expect(r._source.thresholdHigh).toBe('platform');
    });

    test('undefined tenant value falls through to platform', async () => {
      const admin = makeAdmin({ thresholdLow: 0.70 });
      const company = makeCompany({ /* no thresholdLow key */ });
      const r = await resolveCoreGateConfig({ company, adminSettings: admin });
      expect(r.thresholdLow).toBe(0.70);
      expect(r._source.thresholdLow).toBe('platform');
    });

    test('empty companies/admins produce all-lastResort sources', async () => {
      const r = await resolveCoreGateConfig({ company: {}, adminSettings: {} });
      Object.values(r._source).forEach(src => expect(src).toBe('lastResort'));
    });
  });

  describe('validators (never throw)', () => {
    test('thresholdHigh out-of-range → clamped', async () => {
      const r = await resolveCoreGateConfig({
        company: makeCompany({ thresholdHigh: 1.5 }),
        adminSettings: {},
      });
      expect(r.thresholdHigh).toBeLessThanOrEqual(0.99);
    });

    test('thresholdLow below 0.30 → clamped to 0.30', async () => {
      const r = await resolveCoreGateConfig({
        company: makeCompany({ thresholdLow: -10 }),
        adminSettings: {},
      });
      expect(r.thresholdLow).toBe(0.30);
    });

    test('judgeTimeoutMs above 1000 → clamped to 1000', async () => {
      const r = await resolveCoreGateConfig({
        company: makeCompany({ judgeTimeoutMs: 99999 }),
        adminSettings: {},
      });
      expect(r.judgeTimeoutMs).toBe(1000);
    });

    test('non-string judgeProvider → falls back AND disables judge', async () => {
      const r = await resolveCoreGateConfig({
        company: makeCompany({ judgeProvider: 12345 }),
        adminSettings: {},
      });
      expect(SUPPORTED_PROVIDERS.has(r.judgeProvider)).toBe(true);
      expect(r.judgeEnabled).toBe(false);
      expect(r._source.judgeProvider).toBe('lastResort');
    });

    test('unsupported provider string → falls back AND disables judge', async () => {
      const r = await resolveCoreGateConfig({
        company: makeCompany({ judgeProvider: 'cohere' }),
        adminSettings: {},
      });
      expect(SUPPORTED_PROVIDERS.has(r.judgeProvider)).toBe(true);
      expect(r.judgeEnabled).toBe(false);
    });

    test('empty judgeModel → disables judge', async () => {
      const r = await resolveCoreGateConfig({
        company: makeCompany({ judgeModel: '   ' }),
        adminSettings: {},
      });
      expect(r.judgeEnabled).toBe(false);
      expect(r._source.judgeModel).toBe('lastResort');
    });

    test('thresholdLow >= thresholdHigh → snaps both to last-resort pair', async () => {
      const r = await resolveCoreGateConfig({
        company: makeCompany({ thresholdHigh: 0.60, thresholdLow: 0.80 }),
        adminSettings: {},
      });
      expect(r.thresholdHigh).toBe(LAST_RESORT.thresholdHigh);
      expect(r.thresholdLow).toBe(LAST_RESORT.thresholdLow);
      expect(r._source.thresholdHigh).toBe('lastResort');
      expect(r._source.thresholdLow).toBe('lastResort');
    });

    test('non-boolean judgeEnabled → coerced to last-resort default', async () => {
      const r = await resolveCoreGateConfig({
        company: makeCompany({ judgeEnabled: 'yes' }),
        adminSettings: {},
      });
      expect(typeof r.judgeEnabled).toBe('boolean');
      expect(r.judgeEnabled).toBe(LAST_RESORT.judgeEnabled);
    });
  });

  describe('multi-tenant safety', () => {
    test('zero tenant references in last-resort defaults (sanity check on the constants)', () => {
      // No companyId, phone number, name, or other tenant-shaped strings allowed.
      const json = JSON.stringify(LAST_RESORT);
      expect(json).not.toMatch(/68e3f77a/);  // Penguin Air id fragment
      expect(json).not.toMatch(/penguin/i);
      expect(json).not.toMatch(/\+1\d{10}/);
    });

    test('platform-only resolve (no company arg) still produces a usable config', async () => {
      const admin = makeAdmin({ thresholdHigh: 0.88 });
      const r = await resolveCoreGateConfig({ adminSettings: admin });
      expect(r.thresholdHigh).toBe(0.88);
      expect(r._source.thresholdHigh).toBe('platform');
    });
  });
});
