// services/engine/agent2/TierStateContract.js
//
// ═══════════════════════════════════════════════════════════════════════════
// 123RP — TIER STATE CONTRACT
// ═══════════════════════════════════════════════════════════════════════════
// Enforces the hard state contract: when T2 falls to T3, ALL captured
// context MUST be preserved. T3 should never have amnesia about what
// the caller said or what the system already knows.
//
// USAGE:
//   const { buildT3Context, validateT3Context } = require('./TierStateContract');
//   const t3Ctx = buildT3Context(state, scrabResult, callerName, 't2_provider_error');
//   const validation = validateT3Context(t3Ctx);
//
// REQUIRED FIELDS ON T2 → T3 TRANSITION:
//   intent           — call_reason_detail (why the caller is calling)
//   callerName       — extracted caller name (for personalization)
//   pendingFollowUp  — pending follow-up question (if any)
//   lastQuestionAsked — legacy pending question (if any)
//   normalizedInput  — ScrabEngine cleaned text
//   expandedTokens   — ScrabEngine expanded tokens
//   lastPath         — previous turn's routing path
//   llmTurnsThisCall — how many T2 attempts have been made
//   t2FailureReason  — specific reason code (from FALLBACK_REASON_CODE)
// ═══════════════════════════════════════════════════════════════════════════

'use strict';

/**
 * Build the T3 context object from all available state.
 * This is the "state contract" — everything T3 needs to not be amnesic.
 *
 * @param {Object} state           - Current call state (from Redis)
 * @param {Object} scrabResult     - ScrabEngine output for this turn
 * @param {string|null} callerName - Extracted caller name
 * @param {string|null} t2FailureReason - FALLBACK_REASON_CODE value
 * @returns {Object} T3 context
 */
function buildT3Context(state, scrabResult, callerName, t2FailureReason) {
  const discovery = state?.agent2?.discovery || {};

  return {
    // ── What the caller needs ───────────────────────────────────────
    intent: state?.plainSlots?.call_reason_detail
         || state?.slots?.call_reason_detail
         || null,

    // ── Who the caller is ───────────────────────────────────────────
    callerName: callerName || null,

    // ── Pending questions (must survive tier transitions) ───────────
    pendingFollowUp: discovery.pendingFollowUpQuestion || null,
    pendingFollowUpTurn: discovery.pendingFollowUpQuestionTurn || null,
    lastQuestionAsked: discovery.pendingQuestion || null,
    lastQuestionTurn: discovery.pendingQuestionTurn || null,

    // ── What ScrabEngine captured this turn ──────────────────────────
    normalizedInput: scrabResult?.normalizedText || null,
    expandedTokens: Array.isArray(scrabResult?.expandedTokens)
      ? scrabResult.expandedTokens
      : [],

    // ── System state ────────────────────────────────────────────────
    lastPath: discovery.lastPath || null,
    llmTurnsThisCall: discovery.llmTurnsThisCall || 0,

    // ── Why T2 failed ───────────────────────────────────────────────
    t2FailureReason: t2FailureReason || null,
  };
}

/**
 * Validate the T3 context for completeness.
 * Returns warnings if critical fields are missing.
 * This is diagnostic — T3 still fires even with warnings.
 *
 * @param {Object} ctx - T3 context from buildT3Context()
 * @returns {{ valid: boolean, warnings: string[] }}
 */
function validateT3Context(ctx) {
  const warnings = [];

  if (!ctx) {
    return { valid: false, warnings: ['T3_CONTEXT_NULL'] };
  }

  // No intent AND no input = T3 has nothing to work with
  if (!ctx.intent && !ctx.normalizedInput) {
    warnings.push('NO_INTENT_AND_NO_INPUT');
  }

  // No caller name = can't personalize
  if (!ctx.callerName) {
    warnings.push('NO_CALLER_NAME');
  }

  // No failure reason = we don't know why T2 failed
  if (!ctx.t2FailureReason) {
    warnings.push('NO_T2_FAILURE_REASON');
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

module.exports = {
  buildT3Context,
  validateT3Context,
};
