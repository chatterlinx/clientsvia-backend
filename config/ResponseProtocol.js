// config/ResponseProtocol.js
//
// 123RP — 1, 2, 3 Response Protocol
// ==================================
// Universal response tier classification for the ClientsVia platform.
//
// TIER 1: Deterministic match (trigger keyword/phrase, yes/no detection, greeting, clarifier)
// TIER 2: LLMAgent — AI intelligence layer (NOT a fallback)
// TIER 3: Fallback — safety net when Tier 1 + Tier 2 cannot respond
//
// Rule: LLMAgent is intelligence, NOT fallback.
// This protocol applies everywhere: discovery triggers, follow-up consent, booking, etc.
// Only Tier 1 changes per context — Tier 2 and Tier 3 are always the same.
//

const RESPONSE_TIER = {
  TIER_1: 1, // Deterministic match
  TIER_2: 2, // LLM Agent (AI intelligence)
  TIER_3: 3, // Fallback (safety net)
};

const RESPONSE_TIER_LABEL = {
  1: 'DETERMINISTIC',
  2: 'LLM_AGENT',
  3: 'FALLBACK',
};

// Maps existing lastPath values to their 123RP tier
const PATH_TO_TIER = {
  // Tier 1: Deterministic
  'TRIGGER_CARD_ANSWER':   RESPONSE_TIER.TIER_1,
  'TRIGGER_CARD_LLM':      RESPONSE_TIER.TIER_1, // LLM trigger is still a trigger match — routing was deterministic
  'GREETING_ONLY':          RESPONSE_TIER.TIER_1,
  'GREETING_INTERCEPTOR':  RESPONSE_TIER.TIER_1,
  'CLARIFIER_ASKED':        RESPONSE_TIER.TIER_1,
  'SCENARIO_ANSWER':        RESPONSE_TIER.TIER_1,
  'ROBOT_CHALLENGE':        RESPONSE_TIER.TIER_1,
  'PATIENCE_MODE':          RESPONSE_TIER.TIER_1,

  // Follow-up consent paths (Tier 1 — deterministic yes/no/reprompt routing)
  'FOLLOWUP_YES':                    RESPONSE_TIER.TIER_1,
  'FOLLOWUP_NO':                     RESPONSE_TIER.TIER_1,
  'FOLLOWUP_REPROMPT':               RESPONSE_TIER.TIER_1,
  'FOLLOWUP_HESITANT':               RESPONSE_TIER.TIER_1,
  'FOLLOWUP_COMPLEX':                RESPONSE_TIER.TIER_1,
  'PENDING_YES':                     RESPONSE_TIER.TIER_1,
  'PENDING_NO':                      RESPONSE_TIER.TIER_1,
  'PENDING_REPROMPT':                RESPONSE_TIER.TIER_1,
  'LLM_HANDOFF_CONFIRMED':          RESPONSE_TIER.TIER_1,
  'LLM_HANDOFF_DECLINED':           RESPONSE_TIER.TIER_1,

  // Tier 2: LLM Agent (AI intelligence — NOT fallback)
  'LLM_AGENT_NO_MATCH':     RESPONSE_TIER.TIER_2,
  'FOLLOWUP_LLM_AGENT':     RESPONSE_TIER.TIER_2,

  // Tier 3: Fallback (safety net)
  'FALLBACK_REASON_CAPTURED': RESPONSE_TIER.TIER_3,
  'FALLBACK_NO_MATCH':        RESPONSE_TIER.TIER_3,
};

/**
 * Resolve the 123RP tier for a given lastPath.
 * Returns null for unrecognized paths.
 */
function resolveTier(lastPath) {
  if (!lastPath) return null;
  if (PATH_TO_TIER[lastPath] !== undefined) return PATH_TO_TIER[lastPath];
  // Handle dynamic follow-up paths (e.g., FOLLOWUP_COMPLEX_HANDOFF_BOOKING)
  if (lastPath.startsWith('FOLLOWUP_') && lastPath.includes('LLM_AGENT')) return RESPONSE_TIER.TIER_2;
  if (lastPath.startsWith('FOLLOWUP_')) return RESPONSE_TIER.TIER_1;
  if (lastPath.startsWith('FALLBACK_')) return RESPONSE_TIER.TIER_3;
  return null;
}

/**
 * Get the human-readable tier label.
 */
function tierLabel(tier) {
  return RESPONSE_TIER_LABEL[tier] || 'UNKNOWN';
}

/**
 * Build the _123rp metadata object for return values.
 * Standardized shape attached to every response return object.
 */
function build123rpMeta(lastPath) {
  const tier = resolveTier(lastPath);
  return {
    tier,
    tierLabel: tierLabel(tier),
    lastPath,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// FALLBACK REASON CODES
// ═══════════════════════════════════════════════════════════════════════════
// Every T2 failure and T3 fallback gets a specific reason code.
// Used for observability, Call Intelligence display, and debugging.
// Rule: Never just "T3 fired" — always WHY it fired.
// ═══════════════════════════════════════════════════════════════════════════
const FALLBACK_REASON_CODE = {
  // ── T2 failure reasons (Claude didn't respond) ────────────────────────
  T2_STREAM_SILENT:      't2_stream_silent',       // Streaming started but no tokens arrived
  T2_PROVIDER_ERROR:     't2_provider_error',       // Anthropic API returned non-200
  T2_GUARDRAIL_ABORT:    't2_guardrail_abort',      // Response blocked by safety guardrail
  T2_MAX_LATENCY:        't2_max_latency',          // Hit ceiling timeout (25s)
  T2_EMPTY_RESPONSE:     't2_empty_response',       // API returned 200 but empty content
  T2_DISABLED:           't2_disabled',              // LLM Agent not enabled for company
  T2_MAX_TURNS:          't2_max_turns',             // maxTurnsPerSession reached
  T2_NO_API_KEY:         't2_no_api_key',            // ANTHROPIC_API_KEY not set
  T2_BACKUP_FAILED:      't2_backup_failed',         // Both primary and backup model failed

  // ── T3 outcome reasons (what kind of fallback was used) ───────────────
  T3_REASON_CAPTURED:    't3_reason_captured',       // Had intent, used empathy + handoff
  T3_NO_REASON:          't3_no_reason',             // No intent captured, generic fallback
  T3_RECOVERY_TURN:      't3_recovery_turn',         // Recovery attempt after previous T3
  T3_CONSECUTIVE_LIMIT:  't3_consecutive_limit',     // 3+ consecutive T3s, escalation triggered
  T3_PARTIAL_RESPONSE:   't3_partial_response',      // Used partial Claude response (80%+)

  // ── Bridge reasons ────────────────────────────────────────────────────
  BRIDGE_CEILING_HIT:    'bridge_ceiling_hit',       // Absolute ceiling (25s) reached
  BRIDGE_HEARTBEAT_DEAD: 'bridge_heartbeat_dead',    // Heartbeat stopped, stream assumed dead
};

module.exports = {
  RESPONSE_TIER,
  RESPONSE_TIER_LABEL,
  PATH_TO_TIER,
  FALLBACK_REASON_CODE,
  resolveTier,
  tierLabel,
  build123rpMeta,
};
