/**
 * 123RP (1, 2, 3 Response Protocol) — Unit Tests
 *
 * Verifies that the ResponseProtocol module correctly classifies
 * all known lastPath values into the correct tiers.
 */

const {
  RESPONSE_TIER,
  RESPONSE_TIER_LABEL,
  PATH_TO_TIER,
  resolveTier,
  tierLabel,
  build123rpMeta,
} = require('../config/ResponseProtocol');

describe('123RP — ResponseProtocol', () => {

  // ──────────────────────────────────────────────────────────────────
  // TIER CONSTANTS
  // ──────────────────────────────────────────────────────────────────

  test('RESPONSE_TIER has three tiers', () => {
    expect(RESPONSE_TIER.TIER_1).toBe(1);
    expect(RESPONSE_TIER.TIER_2).toBe(2);
    expect(RESPONSE_TIER.TIER_3).toBe(3);
  });

  test('RESPONSE_TIER_LABEL maps tiers to human-readable names', () => {
    expect(RESPONSE_TIER_LABEL[1]).toBe('DETERMINISTIC');
    expect(RESPONSE_TIER_LABEL[2]).toBe('LLM_AGENT');
    expect(RESPONSE_TIER_LABEL[3]).toBe('FALLBACK');
  });

  // ──────────────────────────────────────────────────────────────────
  // TIER 1: DETERMINISTIC MATCH
  // ──────────────────────────────────────────────────────────────────

  describe('Tier 1 — Deterministic paths', () => {
    const tier1Paths = [
      'TRIGGER_CARD_ANSWER',
      'TRIGGER_CARD_LLM',
      'GREETING_ONLY',
      'GREETING_INTERCEPTOR',
      'CLARIFIER_ASKED',
      'SCENARIO_ANSWER',
      'ROBOT_CHALLENGE',
      'PATIENCE_MODE',
      'FOLLOWUP_YES',
      'FOLLOWUP_NO',
      'FOLLOWUP_REPROMPT',
      'FOLLOWUP_HESITANT',
      'FOLLOWUP_COMPLEX',
      'PENDING_YES',
      'PENDING_NO',
      'PENDING_REPROMPT',
      'LLM_HANDOFF_CONFIRMED',
      'LLM_HANDOFF_DECLINED',
    ];

    test.each(tier1Paths)('%s → Tier 1', (path) => {
      expect(resolveTier(path)).toBe(RESPONSE_TIER.TIER_1);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // TIER 2: LLM AGENT (AI intelligence — NOT fallback)
  // ──────────────────────────────────────────────────────────────────

  describe('Tier 2 — LLM Agent paths', () => {
    const tier2Paths = [
      'LLM_AGENT_NO_MATCH',
      'FOLLOWUP_LLM_AGENT',
    ];

    test.each(tier2Paths)('%s → Tier 2', (path) => {
      expect(resolveTier(path)).toBe(RESPONSE_TIER.TIER_2);
    });

    test('LLM Agent is NOT classified as fallback', () => {
      const meta = build123rpMeta('LLM_AGENT_NO_MATCH');
      expect(meta.tier).toBe(2);
      expect(meta.tierLabel).toBe('LLM_AGENT');
      expect(meta.tierLabel).not.toBe('FALLBACK');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // TIER 3: FALLBACK (safety net)
  // ──────────────────────────────────────────────────────────────────

  describe('Tier 3 — Fallback paths', () => {
    const tier3Paths = [
      'FALLBACK_REASON_CAPTURED',
      'FALLBACK_NO_MATCH',
    ];

    test.each(tier3Paths)('%s → Tier 3', (path) => {
      expect(resolveTier(path)).toBe(RESPONSE_TIER.TIER_3);
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // DYNAMIC PATH RESOLUTION (prefix matching)
  // ──────────────────────────────────────────────────────────────────

  describe('Dynamic path resolution', () => {
    test('FOLLOWUP_ prefixed paths with LLM_AGENT → Tier 2', () => {
      expect(resolveTier('FOLLOWUP_COMPLEX_LLM_AGENT')).toBe(RESPONSE_TIER.TIER_2);
    });

    test('FOLLOWUP_ prefixed paths without LLM_AGENT → Tier 1', () => {
      expect(resolveTier('FOLLOWUP_CUSTOM_PATH')).toBe(RESPONSE_TIER.TIER_1);
    });

    test('FALLBACK_ prefixed unknown paths → Tier 3', () => {
      expect(resolveTier('FALLBACK_SOMETHING_NEW')).toBe(RESPONSE_TIER.TIER_3);
    });

    test('Completely unknown path → null', () => {
      expect(resolveTier('SOME_UNKNOWN_PATH')).toBeNull();
    });

    test('null/undefined input → null', () => {
      expect(resolveTier(null)).toBeNull();
      expect(resolveTier(undefined)).toBeNull();
      expect(resolveTier('')).toBeNull();
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // build123rpMeta
  // ──────────────────────────────────────────────────────────────────

  describe('build123rpMeta', () => {
    test('returns correct shape for Tier 1 path', () => {
      const meta = build123rpMeta('TRIGGER_CARD_ANSWER');
      expect(meta).toEqual({
        tier: 1,
        tierLabel: 'DETERMINISTIC',
        lastPath: 'TRIGGER_CARD_ANSWER',
      });
    });

    test('returns correct shape for Tier 2 path', () => {
      const meta = build123rpMeta('LLM_AGENT_NO_MATCH');
      expect(meta).toEqual({
        tier: 2,
        tierLabel: 'LLM_AGENT',
        lastPath: 'LLM_AGENT_NO_MATCH',
      });
    });

    test('returns correct shape for Tier 3 path', () => {
      const meta = build123rpMeta('FALLBACK_NO_MATCH');
      expect(meta).toEqual({
        tier: 3,
        tierLabel: 'FALLBACK',
        lastPath: 'FALLBACK_NO_MATCH',
      });
    });

    test('returns null tier for unknown path', () => {
      const meta = build123rpMeta('UNKNOWN_PATH');
      expect(meta).toEqual({
        tier: null,
        tierLabel: 'UNKNOWN',
        lastPath: 'UNKNOWN_PATH',
      });
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // tierLabel helper
  // ──────────────────────────────────────────────────────────────────

  describe('tierLabel', () => {
    test('returns label for valid tiers', () => {
      expect(tierLabel(1)).toBe('DETERMINISTIC');
      expect(tierLabel(2)).toBe('LLM_AGENT');
      expect(tierLabel(3)).toBe('FALLBACK');
    });

    test('returns UNKNOWN for invalid tier', () => {
      expect(tierLabel(null)).toBe('UNKNOWN');
      expect(tierLabel(99)).toBe('UNKNOWN');
    });
  });

  // ──────────────────────────────────────────────────────────────────
  // CORE PROTOCOL RULE: LLM Agent is NOT fallback
  // ──────────────────────────────────────────────────────────────────

  test('123RP core rule: LLM_AGENT_NO_MATCH is Tier 2, not Tier 3', () => {
    const tier = resolveTier('LLM_AGENT_NO_MATCH');
    expect(tier).toBe(RESPONSE_TIER.TIER_2);
    expect(tier).not.toBe(RESPONSE_TIER.TIER_3);
  });

  test('123RP core rule: TRIGGER_CARD_LLM is Tier 1 (routing was deterministic)', () => {
    // Even though an LLM generates the response text, the ROUTING decision
    // was deterministic (keyword matched a trigger card with responseMode=llm)
    const tier = resolveTier('TRIGGER_CARD_LLM');
    expect(tier).toBe(RESPONSE_TIER.TIER_1);
  });
});
