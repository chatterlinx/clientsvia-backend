'use strict';

/**
 * ============================================================================
 * BOOKING UTTERANCE CLASSIFIER (UAPB)
 * ============================================================================
 *
 * PURPOSE:
 * Lightweight phrase-matching classifier for caller utterances during active
 * booking flow. Replaces the broken parallel-UAP approach where every booking
 * answer competed against all KC callerPhrases in the database.
 *
 * This classifier runs ONLY when the step handler fails to advance — meaning
 * the caller's input didn't look like valid booking data for the current step.
 * It determines WHAT the caller was doing instead.
 *
 * FIVE RESPONSE TYPES:
 *   BOOKING_CONFIRM  — "yes", "that's right", "correct"
 *   BOOKING_CORRECT  — "no, it's Smith not Smyth", "actually it's 555-1235"
 *   BOOKING_SIDE_Q   — "how much does that cost?", "do you do maintenance?"
 *   BOOKING_ABORT    — "never mind", "I'll call back"
 *   BOOKING_UNCLEAR  — cannot classify → re-ask current step
 *
 * PERFORMANCE:
 *   Sub-1ms — pure string matching, zero LLM, zero network calls.
 *
 * USAGE:
 *   const { classify } = require('./BookingUtteranceClassifier');
 *   const result = classify(userInput, currentStep);
 *   // result = { type: 'BOOKING_SIDE_Q' }
 *
 * ============================================================================
 */

// ============================================================================
// CONFIRM PHRASES — caller is agreeing / affirming
// ============================================================================

const CONFIRM_PHRASES = [
  'yes', 'yeah', 'yep', 'yup', 'correct', 'right',
  'sure', 'ok', 'okay', 'alright',
  "that's right", "that's correct", "that is correct",
  'absolutely', 'definitely', 'of course',
  'go ahead', 'sounds good', 'sounds great',
  'perfect', 'exactly', 'confirmed', 'affirmative',
  'you got it', "that's it", "that's the one",
  'please do', 'yes please', 'go for it',
  'mm hmm', 'mhm', 'uh huh',
];

// ============================================================================
// CORRECT PHRASES — caller is fixing/correcting a value
// ============================================================================

const CORRECT_TRIGGERS = [
  /\bno[,.]?\s+(?:it's|its|it is|my|the)\b/i,
  /\bactually\s+(?:it's|its|it is|my|the)\b/i,
  /\bi said\b/i,
  /\bi meant\b/i,
  /\bnot\s+\w+[,.]?\s+(?:it's|its|it is)\b/i,
  /\bsorry[,.]?\s+(?:it's|its|it is)\b/i,
  /\blet me correct\b/i,
  /\bthat's wrong\b/i,
  /\bthat's not right\b/i,
  /\bwrong\b.*\b(?:it's|its|it is|the|my)\b/i,
  /\bspell(?:ed|ing)?\b/i,      // "it's spelled S-M-I-T-H"
  /\bno[,.]?\s+\w{2,}\s+not\s+\w{2,}\b/i,   // "no, Smith not Smyth"
];

// ============================================================================
// ABORT PHRASES — caller wants to exit booking
// ============================================================================

const ABORT_PHRASES = [
  'never mind', 'nevermind', 'forget it', 'forget about it',
  "i'll call back", 'i will call back', 'call back later',
  "i don't want to book", "i don't want to schedule",
  'cancel', 'cancel that', 'cancel the booking',
  "i don't need an appointment", "i changed my mind",
  'on second thought', 'actually never mind',
  "don't worry about it", 'no thanks',
  'not right now', 'not today', 'maybe later',
  "i'm not ready", "i'm just looking",
  'just wanted information', 'just had a question',
];

// ============================================================================
// SIDE QUESTION DETECTION — caller is asking a knowledge question
// ============================================================================

// Strong question indicators (from BookingLogicEngine's _isClearQuestion)
const QUESTION_SIGNALS = [
  'what are you booking', 'what are you scheduling', 'what is this for',
  'what do you mean',     'what does that mean',
  'i want to ask',        'i was wondering',        'wondering if',
  'are you able to',      'can you do',             'do you do',
  'do you offer',         'is that something',      'is this something',
  'what exactly',         'why are you',            'why do you',
  'how long does',        'how long will',          'what happens',
  'what if',              'tell me about',          'what about',
  'does it include',      'does that include',      'is it included',
  'what kind of',         'what type of',           'which type',
  'do i need',            'will i need',            'should i',
  'what should i',        'where do',               'when do',
  'how does',             'how do you',
];

// Pricing/cost keywords (always a question, never booking data)
const PRICING_PATTERN = /\b(?:how much|price|pricing|cost|charge|fee|rate|expensive|afford|what do you charge|what does it cost|quote|estimate)\b/i;

// ============================================================================
// CLASSIFIER
// ============================================================================

/**
 * Classify a caller utterance during active booking flow.
 *
 * Only call this when the step handler FAILED to advance — meaning the input
 * didn't look like valid booking data. This determines what the caller was
 * doing instead.
 *
 * @param {string}  userInput    - Raw caller speech
 * @param {string}  currentStep  - Current booking step (e.g. 'COLLECT_PHONE')
 * @returns {{ type: string }}   - One of: BOOKING_CONFIRM, BOOKING_CORRECT,
 *                                  BOOKING_SIDE_Q, BOOKING_ABORT, BOOKING_UNCLEAR
 */
function classify(userInput, currentStep) {
  if (!userInput || typeof userInput !== 'string') {
    return { type: 'BOOKING_UNCLEAR' };
  }

  const trimmed = userInput.trim();
  if (trimmed.length === 0) return { type: 'BOOKING_UNCLEAR' };

  const lc = trimmed.toLowerCase();
  const wordCount = trimmed.split(/\s+/).length;

  // ── 1. ABORT — check first, highest priority escape ───────────────────
  if (_isAbort(lc)) return { type: 'BOOKING_ABORT' };

  // ── 2. CORRECT — caller is fixing/correcting something ────────────────
  if (_isCorrect(lc)) return { type: 'BOOKING_CORRECT' };

  // ── 3. SIDE QUESTION — caller asking a knowledge question ─────────────
  if (_isSideQuestion(lc, wordCount, currentStep)) return { type: 'BOOKING_SIDE_Q' };

  // ── 4. CONFIRM — caller is affirming ──────────────────────────────────
  // Check AFTER side question, because "yes, but how much does it cost?" is a question
  if (_isConfirm(lc, wordCount)) return { type: 'BOOKING_CONFIRM' };

  // ── 5. UNCLEAR — fallback ─────────────────────────────────────────────
  return { type: 'BOOKING_UNCLEAR' };
}

// ============================================================================
// INTERNAL MATCHERS
// ============================================================================

/**
 * Check if input matches abort phrases.
 */
function _isAbort(lc) {
  return ABORT_PHRASES.some(phrase => {
    if (phrase.includes(' ')) {
      return lc.includes(phrase);
    }
    // Single-word: whole-word boundary match
    return new RegExp(`\\b${phrase}\\b`).test(lc);
  });
}

/**
 * Check if input matches correction patterns.
 */
function _isCorrect(lc) {
  return CORRECT_TRIGGERS.some(pattern => pattern.test(lc));
}

/**
 * Check if input is a side question (knowledge question, not booking data).
 */
function _isSideQuestion(lc, wordCount, currentStep) {
  // Explicit question mark → strong signal
  if (lc.includes('?')) return true;

  // Pricing/cost keywords → always a question
  if (PRICING_PATTERN.test(lc)) return true;

  // Known question lead-ins
  if (QUESTION_SIGNALS.some(signal => lc.includes(signal))) return true;

  // Long utterance at a data-collection step (6+ words and not a confirmation)
  // Data entries are short: "Mark", "555-1234", "123 Main St"
  // Long sentences are questions or comments, not booking data
  if (wordCount >= 6 && !_isConfirm(lc, wordCount)) return true;

  return false;
}

/**
 * Check if input matches confirm phrases.
 */
function _isConfirm(lc, wordCount) {
  // Short confirmations only — long sentences with "yes" embedded are not pure confirms
  // e.g., "yes but how much does it cost" is NOT a confirm
  if (wordCount > 4) return false;

  return CONFIRM_PHRASES.some(phrase => {
    if (phrase.includes(' ')) {
      return lc.includes(phrase);
    }
    return new RegExp(`\\b${phrase}\\b`).test(lc);
  });
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  classify,
  // Exported for testing
  CONFIRM_PHRASES,
  ABORT_PHRASES,
  QUESTION_SIGNALS,
  CORRECT_TRIGGERS,
};
