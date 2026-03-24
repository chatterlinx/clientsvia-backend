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
 *   if (isExitIntent(userInput))    { ... }   // → KC_TOPIC_HOP or KC_GRACEFUL_ACK
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
  // Direct affirmations
  'yes',
  'yeah',
  'yep',
  'yup',
  'sure',
  'absolutely',
  'definitely',
  'of course',
  'for sure',

  // Explicit booking signals
  'book it',
  'book the appointment',
  'book an appointment',
  'schedule',
  'schedule it',
  'schedule a visit',
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
  'when can you come',
  'when can someone come',
  'when are you available',
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
 * Used to clear SPFUQ anchors and prevent stale topic lock-in.
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
// EXPORTS
// ============================================================================

module.exports = {
  isBookingIntent,
  isExitIntent,
  // Exported for tests
  BOOKING_PHRASES,
  EXIT_PHRASES,
};
