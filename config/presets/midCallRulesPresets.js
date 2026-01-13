/**
 * ============================================================================
 * MID-CALL RULE PRESETS (V93+) - BACKEND-OWNED, VERSIONED
 * ============================================================================
 *
 * Purpose:
 * - Provide "Apply Recommended" seed rules for the Control Plane UI.
 * - NOT used in runtime call handling (ConversationEngine).
 *
 * Why backend-owned:
 * - Control Plane is raw browser JS (no bundler), so sharing Node modules directly
 *   with the UI would either duplicate logic or introduce build complexity.
 * - This module provides a single canonical source for presets, served via an
 *   authenticated admin endpoint.
 *
 * Design goals:
 * - Trade-safe: presets are suggestions only, scoped by company and saved into
 *   company config. No cross-tenant bleed.
 * - Human-sounding: avoid repetitive "No problem — ..." while still re-asking
 *   the exact slot question for consistency.
 * - Deterministic placeholders: {slotQuestion}, {slotLabel}, optional {exampleFormat}.
 */

const PRESET_VERSION = 'MIDCALL_PRESETS_V1.0';

const ALLOWED_PLACEHOLDERS = ['slotQuestion', 'slotLabel', 'exampleFormat'];

function normalizeKey(v) {
  return String(v || '').trim().toLowerCase();
}

function baseRule(overrides = {}) {
  return {
    enabled: true,
    matchType: 'contains',
    action: 'reply_reask',
    cooldownTurns: 2,
    maxPerCall: 2,
    ...overrides
  };
}

function getUniversalPresets(slotKey) {
  // NOTE: Keep copy short; always end with {slotQuestion} where applicable so the
  // admin-authored slot question remains the canonical ask.
  if (slotKey === 'name') {
    return [
      baseRule({
        trigger: 'is that what you want',
        responseTemplate: 'Sure — {slotQuestion}'
      }),
      baseRule({
        trigger: 'what do you mean',
        responseTemplate: 'Happy to clarify — {slotQuestion}'
      })
    ];
  }

  if (slotKey === 'phone') {
    return [
      baseRule({
        trigger: 'why do you need',
        responseTemplate: 'We use it for appointment updates and confirmations. {slotQuestion}'
      }),
      baseRule({
        trigger: 'too many',
        responseTemplate: 'Got it — just the 10 digits works best (example: {exampleFormat}). {slotQuestion}'
      })
    ];
  }

  if (slotKey === 'address') {
    return [
      baseRule({
        trigger: 'do you need city',
        responseTemplate: 'Yes — street address and city help us send the technician to the right place. {slotQuestion}'
      }),
      baseRule({
        trigger: "i don't know the zip",
        responseTemplate: "That's okay — street address and city is enough to start. {slotQuestion}"
      })
    ];
  }

  if (slotKey === 'time' || slotKey === 'datetime' || slotKey === 'date') {
    return [
      baseRule({
        trigger: 'what do you have',
        responseTemplate: 'We can work around your schedule — {slotQuestion}'
      })
    ];
  }

  return [];
}

/**
 * Returns recommended mid-call rules for a given trade + slot type/id.
 * These are suggestions only; they become tenant-scoped only after an admin saves.
 */
function getMidCallRulePresets({ tradeKey = 'universal', slotIdOrType }) {
  const slotKey = normalizeKey(slotIdOrType);
  const trade = normalizeKey(tradeKey) || 'universal';

  // Today: universal presets only, but trade packs can be layered here.
  // Example future shape:
  // if (trade === 'dental') return getDentalPresets(slotKey) ?? getUniversalPresets(slotKey);

  return getUniversalPresets(slotKey);
}

module.exports = {
  PRESET_VERSION,
  ALLOWED_PLACEHOLDERS,
  getMidCallRulePresets
};

