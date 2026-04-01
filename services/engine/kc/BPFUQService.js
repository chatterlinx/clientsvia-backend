'use strict';

/**
 * ============================================================================
 * BPFUQ SERVICE — Booking Pending Follow-Up Question
 * ============================================================================
 *
 * PURPOSE:
 *   Tracks mid-booking KC digressions so the agent can return to the
 *   interrupted booking step after answering a caller's knowledge question.
 *
 *   Analogous to SPFUQ (which anchors KC topics in the discovery lane),
 *   but entirely separate — BPFUQ operates in the BOOKING lane only.
 *
 *   SPFUQ = "what topic are we discussing in KC?"
 *   BPFUQ = "which booking step did we pause, and does the caller want to
 *             return to it after their KC question was answered?"
 *
 * FLOW:
 *   Turn N  — BookingLogicEngine Tier 1.5 fires:
 *               • KCS answers with bookingOfferMode:'return_to_booking'
 *               • Groq naturally closes: "Does that help? Shall we get back
 *                 to your booking?"
 *               • BPFUQService.set(ctx, { step }) stores pending state
 *
 *   Turn N+1 — Gate 0 in processCurrentStep intercepts BEFORE step handler:
 *               • detectConsent(userInput) → YES | NO | AMBIGUOUS
 *               • YES      → clear BPFUQ, return step re-anchor prompt
 *               • NO       → clear BPFUQ, fall through to 123RP cascade
 *                            (caller has another question — KC or otherwise)
 *               • AMBIGUOUS → keep BPFUQ, re-ask return prompt
 *
 * STORAGE:
 *   State is stored directly on bookingCtx._bpfuq. bookingCtx is already
 *   persisted in Redis as part of the call session (v2twilio.js), so no
 *   separate Redis key is needed. callSid is not threaded into
 *   BookingLogicEngine, making ctx the natural storage vehicle.
 *
 * SCHEMA (stored as bookingCtx._bpfuq):
 *   {
 *     step:        String,   // STEPS.* constant — booking step that was interrupted
 *     anchoredAt:  ISO,      // when the digression fired
 *   }
 *
 * MULTI-TENANT SAFETY:
 *   bookingCtx is already scoped per call per company — no leakage possible.
 *
 * ============================================================================
 */

const logger = require('../../../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL KEY
// ─────────────────────────────────────────────────────────────────────────────

const CTX_KEY = '_bpfuq';

// ─────────────────────────────────────────────────────────────────────────────
// CONSENT DETECTION — simple keyword classification
// ─────────────────────────────────────────────────────────────────────────────

/**
 * YES_PHRASES — explicit agreement signals.
 * Caller confirms they want to return to the booking.
 */
const YES_PHRASES = [
  'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay',
  'go ahead', 'go on', 'proceed', 'continue', 'of course',
  'sounds good', 'absolutely', 'definitely', 'alright', 'all right',
  'great', 'perfect', 'that works', 'for sure', 'please',
  "let's do", 'lets do', "let's go", 'lets go', 'i would', 'i do',
];

/**
 * NO_PHRASES — signals that the caller has more questions or is not ready.
 * Falls through to 123RP so the follow-on question is handled normally.
 */
const NO_PHRASES = [
  'no', 'nope', 'nah', 'not yet', 'wait', 'actually', 'hold on',
  'one more', 'before', 'also', 'another question', 'what about',
  'how about', 'can i ask', 'i have a question', 'what if',
  'what is', 'how much', 'how long', 'do you', 'is there', 'are you',
  'will you', 'tell me about',
];

// ─────────────────────────────────────────────────────────────────────────────
// SET — store pending booking return state on ctx
// ─────────────────────────────────────────────────────────────────────────────

/**
 * set — Record that a mid-booking KC digression has occurred.
 *
 * @param {Object}  ctx              — bookingCtx (mutated in place)
 * @param {Object}  data
 * @param {string}  data.step        — STEPS.* constant for the interrupted step
 * @param {boolean} [data.inlineResumed=false]
 *   When true: the KC answer and the step re-anchor were delivered in the
 *   SAME response (IntentHold inline pattern). Gate 0 skips the consent check
 *   and falls straight through to the step handler on the next turn.
 *   When false (legacy): Gate 0 asks "Shall we get back to your booking?" first.
 */
function set(ctx, { step, inlineResumed = false }) {
  if (!ctx || !step) return;
  ctx[CTX_KEY] = {
    step,
    inlineResumed,
    anchoredAt: new Date().toISOString(),
  };
  logger.debug('[BPFUQ] Pending set', { step, inlineResumed });
}

// ─────────────────────────────────────────────────────────────────────────────
// LOAD — read pending state from ctx
// ─────────────────────────────────────────────────────────────────────────────

/**
 * load — Return the BPFUQ pending object, or null if none is set.
 *
 * @param {Object} ctx — bookingCtx
 * @returns {Object|null}
 */
function load(ctx) {
  return (ctx && ctx[CTX_KEY]) ? ctx[CTX_KEY] : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// CLEAR — erase pending state
// ─────────────────────────────────────────────────────────────────────────────

/**
 * clear — Remove the BPFUQ pending state from ctx.
 * Called on: consent YES, consent NO (fall through), booking completion.
 *
 * @param {Object} ctx — bookingCtx (mutated in place)
 */
function clear(ctx) {
  if (!ctx) return;
  delete ctx[CTX_KEY];
  logger.debug('[BPFUQ] Pending cleared');
}

// ─────────────────────────────────────────────────────────────────────────────
// DETECT CONSENT — classify caller's next turn as YES | NO | AMBIGUOUS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * detectConsent — Classify the caller's response to the return-to-booking
 * invitation as YES (resume), NO (more questions/fall through), or AMBIGUOUS
 * (re-ask gently).
 *
 * YES     → BookingLogicEngine Gate 0 returns the step re-anchor prompt.
 * NO      → Gate 0 clears BPFUQ and falls through to 123RP cascade so the
 *           next question is answered normally (Tier 1.5 will re-fire if KC).
 * AMBIGUOUS → Gate 0 keeps BPFUQ alive and re-asks "Shall we get back?"
 *
 * @param {string} input — raw caller utterance
 * @returns {'YES'|'NO'|'AMBIGUOUS'}
 */
function detectConsent(input) {
  const lc    = (input || '').toLowerCase().replace(/[^a-z\s]/g, ' ').trim();
  const words = lc.split(/\s+/).filter(Boolean);

  // Single or double word YES (e.g. "yes", "yeah sure", "ok please")
  if (words.length <= 2 && YES_PHRASES.some(p => !p.includes(' ') && words.includes(p))) {
    return 'YES';
  }
  // Multi-word YES phrase at start (e.g. "go ahead", "sounds good")
  if (YES_PHRASES.some(p => p.includes(' ') && lc.startsWith(p))) {
    return 'YES';
  }

  // NO signals — any position (caller is expressing a follow-on question or hesitation)
  if (NO_PHRASES.some(p => lc.includes(p))) {
    return 'NO';
  }

  return 'AMBIGUOUS';
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  set,
  load,
  clear,
  detectConsent,
  CTX_KEY,
};
