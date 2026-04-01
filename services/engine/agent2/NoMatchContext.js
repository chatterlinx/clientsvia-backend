// services/engine/agent2/NoMatchContext.js
//
// Builds and validates the no-match context object passed through the agent
// when neither a trigger card nor the LLM could produce a response.
// Ensures the no-match response path has full caller context — intent,
// name, pending questions, what ScrabEngine captured — so it never fires blind.
//

'use strict';

/**
 * Build the no-match context from all available call state.
 *
 * @param {Object} state            - Current call state (from Redis)
 * @param {Object} scrabResult      - ScrabEngine output for this turn
 * @param {string|null} callerName  - Extracted caller name
 * @param {string|null} llmFailureReason - LLM_FAILURE_REASON value (why LLM failed)
 * @returns {Object}
 */
function buildNoMatchContext(state, scrabResult, callerName, llmFailureReason) {
  const discovery = state?.agent2?.discovery || {};

  return {
    // ── What the caller needs ───────────────────────────────────────
    intent: state?.plainSlots?.call_reason_detail
         || state?.slots?.call_reason_detail
         || null,

    // ── Who the caller is ───────────────────────────────────────────
    callerName: callerName || null,

    // ── Pending questions (must survive no-match turns) ─────────────
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

    // ── Why LLM failed ──────────────────────────────────────────────
    llmFailureReason: llmFailureReason || null,
  };
}

/**
 * Validate the no-match context for completeness.
 * Returns warnings if critical fields are missing.
 * Diagnostic only — no-match path still runs even with warnings.
 *
 * @param {Object} ctx - Result of buildNoMatchContext()
 * @returns {{ valid: boolean, warnings: string[] }}
 */
function validateNoMatchContext(ctx) {
  const warnings = [];

  if (!ctx) {
    return { valid: false, warnings: ['NO_MATCH_CONTEXT_NULL'] };
  }

  if (!ctx.intent && !ctx.normalizedInput) {
    warnings.push('NO_INTENT_AND_NO_INPUT');
  }

  if (!ctx.callerName) {
    warnings.push('NO_CALLER_NAME');
  }

  if (!ctx.llmFailureReason) {
    warnings.push('NO_LLM_FAILURE_REASON');
  }

  return {
    valid: warnings.length === 0,
    warnings,
  };
}

module.exports = {
  buildNoMatchContext,
  validateNoMatchContext,
};
