'use strict';

/**
 * ============================================================================
 * KC BOOKING INTENT DETECTOR
 * ============================================================================
 *
 * PURPOSE:
 *   Zero-latency synchronous phrase detector. Runs on every KC engine turn
 *   to check whether the caller has shifted from topic exploration to booking
 *   intent, or is signalling they want to exit the conversation.
 *
 *   No AI, no network, no async — just a clean O(n) phrase match.
 *   Performance target: < 1ms.
 *
 * USAGE:
 *   const { isBookingIntent, isExitIntent } = require('./KCBookingIntentDetector');
 *
 *   if (isBookingIntent(userInput)) { ... }   // → KC_BOOKING_INTENT
 *   if (isExitIntent(userInput))    { ... }   // → topic change or KC_GRACEFUL_ACK
 *
 * EXTENSION:
 *   Add phrases to BOOKING_PHRASES or EXIT_PHRASES arrays below.
 *   No other changes needed — detector auto-picks them up.
 *
 * ============================================================================
 */

// ============================================================================
// PHRASE LISTS
// ============================================================================

/**
 * BOOKING_PHRASES — Caller signals readiness to schedule / book a visit.
 *
 * Matching rules:
 *   - Multi-word phrases: substring match on normalized input
 *   - Single words:       whole-word match (prevents "yes" matching "yesterday")
 *
 * Keep phrases in lowercase. Normalization is applied before matching.
 */
const BOOKING_PHRASES = [
  // ── Direct affirmations (single-word whole-word boundary match) ───────────
  'yes',
  'yeah',
  'yep',
  'yup',
  'sure',
  'ok',
  'okay',
  'alright',
  'absolutely',
  'definitely',
  'of course',
  'for sure',

  // ── Composite affirmations (multi-word substring match) ───────────────────
  'ok go ahead',
  'ok sounds good',
  'okay go ahead',
  'okay sounds good',
  'alright go ahead',
  'alright sounds good',
  'sounds great',
  'that works',
  'works for me',
  'yes please',
  'please do',

  // ── Explicit booking signals ───────────────────────────────────────────────
  'book it',
  'book a visit',
  'book a service',
  'book a service call',
  'book the appointment',
  'book an appointment',
  'schedule',
  'schedule it',
  'schedule a visit',
  'schedule a service',
  'schedule a service call',
  'schedule an appointment',
  'make an appointment',
  'set up a visit',
  'set it up',
  'set an appointment',
  'let\'s do it',
  'let\'s go ahead',
  'go ahead',
  'sounds good',
  'i\'m ready',
  'ready to book',
  'ready to schedule',

  // ── Availability / service visit requests ─────────────────────────────────
  'when can you come',
  'when can someone come',
  'when are you available',
  'when can you come out',
  'send someone out',
  'have someone come out',
  'need someone to come',

  // ── Request forms ──────────────────────────────────────────────────────────
  'please schedule',
  'please book',
  'i want to book',
  'i\'d like to book',
  'i want to schedule',
  'i\'d like to schedule',
  'sign me up',
  'put me down',
  'get me on the schedule',
  'i\'ll take it',
  'we\'ll take it',
];

/**
 * EXIT_PHRASES — Caller wants to end the topic or the call entirely.
 *
 * Used to clear topic anchors and prevent stale topic lock-in.
 */
const EXIT_PHRASES = [
  // Negative / disinterested
  'no',
  'nope',
  'no thanks',
  'no thank you',
  'not interested',
  'not right now',
  'maybe later',
  'not today',

  // Topic abandonment
  'never mind',
  'nevermind',
  'forget it',
  'forget about it',
  'that\'s fine',
  'that\'s ok',
  'that\'s okay',
  'on second thought',
  'actually never mind',
  'don\'t worry about it',

  // Call exit
  'goodbye',
  'bye',
  'bye bye',
  'goodbye for now',
  'have a good day',
  'talk to you later',
  'i\'ll call back',
  'i\'ll call you back',
  'i\'ll think about it',
];

// ============================================================================
// NORMALIZATION
// ============================================================================

/**
 * _normalize — Lowercase + strip punctuation for consistent matching.
 * Preserves spaces. Does NOT strip apostrophes (needed for "let's", "i'd").
 */
function _normalize(input) {
  if (!input) return '';
  return input
    .toLowerCase()
    .replace(/[^a-z'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ============================================================================
// MATCHERS
// ============================================================================

/**
 * _hasPhrase — Test whether a phrase appears in normalized input.
 *
 * Multi-word: substring match.
 * Single-word: whole-word boundary match (split on whitespace).
 *
 * @param {string} norm    — pre-normalized caller input
 * @param {string} phrase  — phrase to look for (already lowercase)
 * @returns {boolean}
 */
function _hasPhrase(norm, phrase) {
  if (phrase.includes(' ')) {
    return norm.includes(phrase);
  }
  return norm.split(/\s+/).includes(phrase);
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * isBookingIntent — Returns true if the caller's input contains a booking signal.
 *
 * @param {string} input — raw caller utterance
 * @returns {boolean}
 */
function isBookingIntent(input) {
  const norm = _normalize(input);
  if (!norm) return false;
  return BOOKING_PHRASES.some(phrase => _hasPhrase(norm, phrase));
}

/**
 * isExitIntent — Returns true if the caller signals they want to leave the topic.
 *
 * @param {string} input — raw caller utterance
 * @returns {boolean}
 */
function isExitIntent(input) {
  const norm = _normalize(input);
  if (!norm) return false;
  return EXIT_PHRASES.some(phrase => _hasPhrase(norm, phrase));
}

// ============================================================================
// RUNTIME OVERRIDE — called by GlobalHubService.loadSignals() at startup
// ============================================================================

/**
 * Replace the active phrase lists with values from GlobalShare.
 * Called once at server startup after signals are loaded from MongoDB.
 * If GlobalShare has no saved phrases, this is never called — hardcoded
 * defaults above remain active.
 *
 * @param {{ bookingPhrases?: string[], exitPhrases?: string[] }} overrides
 */
function initialize({ bookingPhrases, exitPhrases } = {}) {
  if (Array.isArray(bookingPhrases) && bookingPhrases.length > 0) {
    BOOKING_PHRASES.length = 0;
    BOOKING_PHRASES.push(...bookingPhrases);
  }
  if (Array.isArray(exitPhrases) && exitPhrases.length > 0) {
    EXIT_PHRASES.length = 0;
    EXIT_PHRASES.push(...exitPhrases);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  isBookingIntent,
  isExitIntent,
  initialize,
  // Exported for tests
  BOOKING_PHRASES,
  EXIT_PHRASES,
};
