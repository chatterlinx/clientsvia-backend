// config/LLMDiagnostics.js
//
// LLM stream failure reasons and fallback outcome codes.
// Used for observability emit events, Call Intelligence display, and debugging.
//
// Rule: Never just "LLM failed" — always WHY it failed.
//
// String values are intentionally kept stable for backward compat with existing
// MongoDB emit records (some were written under the 123rp naming era).
//

const LLM_FAILURE_REASON = {
  // ── LLM stream failure reasons ────────────────────────────────────────
  STREAM_SILENT:    't2_stream_silent',    // Streaming started but no tokens arrived
  PROVIDER_ERROR:   't2_provider_error',   // API returned non-200 or threw
  GUARDRAIL_ABORT:  't2_guardrail_abort',  // Response blocked by safety guardrail
  MAX_LATENCY:      't2_max_latency',      // Hit ceiling timeout (25s)
  EMPTY_RESPONSE:   't2_empty_response',   // API returned 200 but empty content
  LLM_DISABLED:     't2_disabled',         // LLM Agent not enabled for company
  MAX_TURNS:        't2_max_turns',        // maxTurnsPerSession reached
  NO_API_KEY:       't2_no_api_key',       // ANTHROPIC_API_KEY not set
  BACKUP_FAILED:    't2_backup_failed',    // Both primary and backup model failed

  // ── Fallback outcome reasons ──────────────────────────────────────────
  FALLBACK_REASON_CAPTURED:   't3_reason_captured',   // Had intent, used empathy + handoff
  FALLBACK_NO_REASON:         't3_no_reason',          // No intent captured, generic fallback
  FALLBACK_RECOVERY_TURN:     't3_recovery_turn',      // Recovery after previous fallback
  FALLBACK_CONSECUTIVE_LIMIT: 't3_consecutive_limit',  // 3+ consecutive fallbacks, escalate
  FALLBACK_PARTIAL_RESPONSE:  't3_partial_response',   // Used partial response (80%+)

  // ── Bridge / streaming layer ──────────────────────────────────────────
  BRIDGE_CEILING_HIT:    'bridge_ceiling_hit',    // Absolute ceiling (25s) reached
  BRIDGE_HEARTBEAT_DEAD: 'bridge_heartbeat_dead', // Heartbeat stopped, stream assumed dead
};

module.exports = { LLM_FAILURE_REASON };
