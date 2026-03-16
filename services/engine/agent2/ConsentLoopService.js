'use strict';

/**
 * ConsentLoopService
 * ──────────────────────────────────────────────────────────────────────────────
 * Makes the LLM Agent a first-class producer of pendingFollowUpQuestion (PFUQ).
 *
 * PROBLEM SOLVED
 * ──────────────────────────────────────────────────────────────────────────────
 * The 7-bucket Follow-up Consent Gate was originally triggered ONLY by Trigger
 * Cards that had a `followUpQuestion` field set. When a call reached the LLM
 * Agent (no trigger match), the consent gate never activated — the system looped
 * back through ScrabEngine on every turn instead of funneling toward booking.
 *
 * This service closes that gap:
 *  • Turn-1 intake LLM   → ask a booking consent question → set PFUQ
 *  • noMatch LLM turns   → extract closing question → set PFUQ
 *  • NO bucket response  → set grace period (prevents pushy re-ask)
 *
 * FLOW
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *  Any turn (T1 intake or Tn noMatch)
 *  └── LLM responds with a consent question
 *      └── setPFUQFromLLM() → nextState.agent2.discovery.pendingFollowUpQuestion set
 *          ↓
 *  Next turn → 7-bucket consent gate activates (PFUQ present)
 *  ├── YES / SERVICE_CALL / MAINTENANCE → booking handoff ✅
 *  ├── NO  → clearPendingFollowUp + setGracePeriod (one-turn breathing room)
 *  ├── COMPLEX / HESITANT / REPROMPT → LLM handles w/ context, PFUQ preserved
 *  └── Grace period (1 turn) → LLM responds normally → extractConsentQuestion
 *                               → if found → new PFUQ → consent gate resumes
 *
 * DESIGN PRINCIPLES
 * ──────────────────────────────────────────────────────────────────────────────
 *  1. Pure state manipulation — no Redis, no DB, no async
 *  2. Every public function guards against null/missing state (never throws)
 *  3. Mirrors trigger-card PFUQ setter pattern (Agent2DiscoveryRunner.js:3858)
 *  4. Constants exported so call traces log exactly what happened
 */

// ─── Source labels ────────────────────────────────────────────────────────────

/** PFUQ was set by the Turn-1 LLM Intake (structured JSON extraction path) */
const SOURCE_LLM_INTAKE = 'llm:intake';

/** PFUQ was set by a noMatch LLM Agent turn (Tier-2 discovery path) */
const SOURCE_LLM_NO_MATCH = 'llm:nomatch';

// ─── Timing constants ─────────────────────────────────────────────────────────

/**
 * How many turns after a NO-bucket response we hold off before re-setting PFUQ.
 * Prevents the caller from feeling pressured immediately after declining.
 *
 * Example: caller says "No" on turn 4 → grace covers turn 5 → turn 6 can re-ask.
 * Set to 1 for minimum friction without completely abandoning the funnel.
 */
const GRACE_PERIOD_TURNS = 1;

// ─── nextAction written by LLM-originated PFUQ ───────────────────────────────

/**
 * The nextAction stored alongside the LLM-originated PFUQ.
 * Matches the value trigger cards use for booking-intent consent questions,
 * ensuring the consent gate routes YES answers to the booking handoff path.
 */
const LLM_PFUQ_NEXT_ACTION = 'BOOKING_HANDOFF';

// ─── Consent question detection ───────────────────────────────────────────────

/**
 * Matches sentences that contain scheduling / service-dispatch language.
 * Combined with an `endsWith('?')` check to identify booking consent questions.
 *
 * Designed to be permissive — a false positive (e.g. "Can I help you with that?")
 * is far preferable to a false negative (consent question goes undetected).
 */
const CONSENT_QUESTION_RE = /\b(schedul|book|appoint|technician|tech|come out|send someone|get .{1,40}out|help .{1,30}with that|set .{1,30}up|get .{1,30}taken care|get .{1,30}handled|get .{1,30}scheduled|get .{1,30}sorted|get someone|have someone)\b/i;

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Splits voice TTS text into individual sentences.
 * Handles common abbreviations and avoids splitting on decimal points.
 *
 * @param {string} text
 * @returns {string[]}
 */
function _splitSentences(text) {
  if (!text) return [];
  // Split on sentence-ending punctuation followed by whitespace or end of string
  return text
    .split(/(?<=[.?!])(?:\s+|$)/)
    .map(s => s.trim())
    .filter(Boolean);
}

// ─────────────────────────────────────────────────────────────────────────────
// extractConsentQuestion
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Scans an LLM response for the LAST sentence that looks like a yes/no
 * booking consent question. Walking backwards ensures we find the closing
 * call-to-action, not an incidental question earlier in the response.
 *
 * Criteria:
 *  1. Sentence ends with `?`
 *  2. Sentence contains scheduling/booking/service language (CONSENT_QUESTION_RE)
 *
 * @param {string} responseText - Full LLM response string
 * @returns {string|null}       - The consent question, or null if none found
 */
function extractConsentQuestion(responseText) {
  if (!responseText?.trim()) return null;

  const sentences = _splitSentences(responseText);

  // Walk backwards — the closing question is the consent CTA
  for (let i = sentences.length - 1; i >= 0; i--) {
    const s = sentences[i];
    if (s.endsWith('?') && CONSENT_QUESTION_RE.test(s)) {
      return s;
    }
  }

  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// setPFUQFromLLM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Writes pendingFollowUpQuestion state fields so the 7-bucket consent gate
 * activates on the NEXT turn.
 *
 * Mirrors the trigger-card PFUQ setter at Agent2DiscoveryRunner.js:3858 exactly,
 * so downstream consent-gate evaluation sees LLM-originated PFUQ identically
 * to trigger-card-originated PFUQ.
 *
 * @param {Object} nextState - Mutable state object (must have agent2.discovery)
 * @param {string} question  - The consent question to ask (non-empty)
 * @param {number} turn      - Current turn number
 * @param {string} source    - SOURCE_LLM_INTAKE | SOURCE_LLM_NO_MATCH
 */
function setPFUQFromLLM(nextState, question, turn, source) {
  // Guard: bad state shape
  if (!nextState?.agent2?.discovery) return;
  // Guard: empty question
  if (!question?.trim()) return;

  nextState.agent2.discovery.pendingFollowUpQuestion          = question.trim();
  nextState.agent2.discovery.pendingFollowUpQuestionTurn      = typeof turn === 'number' ? turn : null;
  nextState.agent2.discovery.pendingFollowUpQuestionSource    = source || SOURCE_LLM_NO_MATCH;
  nextState.agent2.discovery.pendingFollowUpQuestionNextAction = LLM_PFUQ_NEXT_ACTION;
  nextState.agent2.discovery.followUpContinuationCount        = 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// setGracePeriod
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Marks the current turn as a "grace period start" after the NO bucket clears PFUQ.
 * For the next GRACE_PERIOD_TURNS turns, isGracePeriodActive() returns true,
 * preventing the system from immediately re-setting a consent question on the
 * very next LLM response.
 *
 * Call this AFTER clearPendingFollowUp() in the NO bucket handler.
 *
 * @param {Object} nextState - Mutable state object (must have agent2.discovery)
 * @param {number} turn      - Current turn number
 */
function setGracePeriod(nextState, turn) {
  if (!nextState?.agent2?.discovery) return;
  nextState.agent2.discovery.consentGracePeriodTurn = typeof turn === 'number' ? turn : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// isGracePeriodActive
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true if we are within GRACE_PERIOD_TURNS turns of a NO-bucket clear.
 * When true: the LLM may respond normally but should NOT set a new PFUQ.
 *
 * @param {Object} state - The CURRENT (incoming) callState — checks stored value
 * @param {number} turn  - Current turn number
 * @returns {boolean}
 */
function isGracePeriodActive(state, turn) {
  const graceTurn = state?.agent2?.discovery?.consentGracePeriodTurn;
  if (graceTurn == null || typeof turn !== 'number') return false;
  return (turn - graceTurn) <= GRACE_PERIOD_TURNS;
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  // ── Core API ──────────────────────────────────────────────────────────────
  extractConsentQuestion,
  setPFUQFromLLM,
  setGracePeriod,
  isGracePeriodActive,

  // ── Constants (exported for call-trace logging clarity) ───────────────────
  SOURCE_LLM_INTAKE,
  SOURCE_LLM_NO_MATCH,
  GRACE_PERIOD_TURNS,
  LLM_PFUQ_NEXT_ACTION,
};
