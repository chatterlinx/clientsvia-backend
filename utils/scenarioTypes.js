/**
 * Scenario Type Utilities
 * ============================================================================
 * The platform currently has legacy scenarioType values (older UI/editor)
 * and canonical scenarioType values (runtime truth / scoring / quality gates).
 *
 * This module provides:
 * - A single source of truth for allowed scenario types (canonical + legacy)
 * - Safe normalization from legacy → canonical for runtime enforcement logic
 *
 * NOTE:
 * - We intentionally treat blank / null as "UNKNOWN" for health/scoring.
 * - We DO NOT auto-map ACTION_FLOW to TRANSFER; we conservatively map it to BOOKING
 *   because ACTION_FLOW includes booking/transfer and BOOKING consent gating is safer.
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

const LEGACY_SCENARIO_TYPES = Object.freeze([
  // Older scenario editor taxonomy
  'INFO_FAQ',
  'ACTION_FLOW',
  'SYSTEM_ACK',
]);

const ALL_SCENARIO_TYPES = Object.freeze([
  ...new Set([...CANONICAL_SCENARIO_TYPES, ...LEGACY_SCENARIO_TYPES]),
]);

function normalizeScenarioType(raw) {
  const t = (raw ?? '').toString().trim().toUpperCase();
  if (!t) return 'UNKNOWN';

  // Legacy aliases → canonical
  if (t === 'INFO_FAQ') return 'FAQ';
  if (t === 'SYSTEM_ACK') return 'SYSTEM';
  if (t === 'ACTION_FLOW') return 'BOOKING';

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
  LEGACY_SCENARIO_TYPES,
  ALL_SCENARIO_TYPES,
  normalizeScenarioType,
  isAllowedScenarioType,
  isUnknownOrBlankScenarioType,
};


