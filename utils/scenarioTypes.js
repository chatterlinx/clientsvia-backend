/**
 * Scenario Type Utilities
 * ============================================================================
 * Canonical scenario types only (legacy values are no longer supported).
 *
 * NOTE:
 * - We intentionally treat blank / null as "UNKNOWN" for health/scoring.
 */

const CANONICAL_SCENARIO_TYPES = Object.freeze([
  'EMERGENCY',
  'BOOKING',
  'FAQ',
  'TROUBLESHOOT',
  'BILLING',
  'TRANSFER',
  'SMALL_TALK',
  'SYSTEM',
  'UNKNOWN',
]);
const ALL_SCENARIO_TYPES = Object.freeze([...CANONICAL_SCENARIO_TYPES]);

function normalizeScenarioType(raw) {
  const t = (raw ?? '').toString().trim().toUpperCase();
  if (!t) return 'UNKNOWN';

  // Canonical passthrough (or unknown)
  if (CANONICAL_SCENARIO_TYPES.includes(t)) return t;
  return 'UNKNOWN';
}

function isAllowedScenarioType(raw) {
  const t = (raw ?? '').toString().trim().toUpperCase();
  if (!t) return true; // blank allowed at storage level; quality gates may flag it
  return ALL_SCENARIO_TYPES.includes(t);
}

function isUnknownOrBlankScenarioType(raw) {
  const t = (raw ?? '').toString().trim();
  if (!t) return true;
  return t.toUpperCase() === 'UNKNOWN';
}

module.exports = {
  CANONICAL_SCENARIO_TYPES,
  ALL_SCENARIO_TYPES,
  normalizeScenarioType,
  isAllowedScenarioType,
  isUnknownOrBlankScenarioType,
};


