'use strict';

/**
 * ============================================================================
 * KC TRANSFER INTENT DETECTOR — GATE 0.5
 * ============================================================================
 *
 * PURPOSE:
 *   Zero-latency synchronous phrase detector. Runs at GATE 0.5 in the KC
 *   engine — sits BEFORE the booking gate (GATE 1) — to detect whether
 *   a caller wants to be transferred to a human agent or specific person.
 *
 *   No AI, no network, no async — pure O(n) phrase matching.
 *   Performance target: < 1ms.
 *
 * USAGE:
 *   const { isTransferIntent, getTransferHint } = require('./KCTransferIntentDetector');
 *
 *   if (isTransferIntent(userInput)) {
 *     const hint = getTransferHint(userInput);
 *     // hint.personName  — extracted name if caller said "transfer me to John"
 *     // hint.department  — extracted department keyword if detected
 *     // hint.urgency     — 'high' | 'normal'
 *   }
 *
 * GATE POSITION (Agent2DiscoveryRunner.js):
 *
 *   [GATE 0.5]  KCTransferIntentDetector  ← this file
 *   [GATE 1]    KCBookingIntentDetector
 *   [GATE 2]    Load anchor container (discoveryNotes)
 *   [GATE 3]    Container match scoring
 *   [GATE 4]    LLM fallback
 *
 * WHY BEFORE BOOKING (GATE 0.5 not GATE 1.5):
 *   A caller saying "transfer me to service" is a harder signal to ambiguate
 *   than booking. Transfer intent should take full priority — a caller
 *   asking for a human wants a human immediately, not a booking flow.
 *   Booking can always be completed by the human agent post-transfer.
 *
 * PATTERN CATALOGUE:
 *   - Direct transfer requests ("transfer me", "put me through")
 *   - Agent/person request ("speak to someone", "talk to a person")
 *   - Name-directed requests ("transfer me to John", "connect me with sales")
 *   - Urgency signals ("I need to talk to a manager right now")
 *   - Department signals ("billing department", "speak to service")
 *
 * ESCAPE PATTERNS:
 *   Phrases that look like transfer intent but are NOT:
 *   - "transfer my appointment" — booking context, not human request
 *   - "transfer my service" — service transfer, not human agent
 *   These are handled by the NOT_TRANSFER_PATTERNS exclusion list.
 *
 * EXTENSION:
 *   Add phrases to the appropriate arrays below.
 *   No other changes needed — detector auto-picks them up.
 *
 * ============================================================================
 */

// ============================================================================
// PHRASE LISTS
// ============================================================================

/**
 * TRANSFER_PHRASES — Caller signals they want to speak to a human.
 *
 * Matching rules (same as KCBookingIntentDetector):
 *   - Multi-word phrases: substring match on normalized input
 *   - Single words:       whole-word boundary match
 */
const TRANSFER_PHRASES = [

  // ── Direct transfer requests ───────────────────────────────────────────────
  'transfer me',
  'transfer to',
  'transfer me to',
  'transfer me to a',
  'connect me to',
  'connect me with',
  'put me through',
  'put me through to',
  'patch me through',
  'patch me to',
  'forward me to',
  'route me to',

  // ── Request for a human agent ──────────────────────────────────────────────
  'speak to someone',
  'speak with someone',
  'talk to someone',
  'talk with someone',
  'speak to a person',
  'speak with a person',
  'talk to a person',
  'talk with a person',
  'speak to an agent',
  'talk to an agent',
  'speak with an agent',
  'speak to a human',
  'talk to a human',
  'speak to a live',
  'talk to a live',
  'speak to a real',
  'talk to a real',
  'live agent',
  'live person',
  'live representative',
  'live rep',
  'real person',
  'human agent',
  'actual person',

  // ── Representative / staff requests ───────────────────────────────────────
  'speak to a representative',
  'talk to a representative',
  'speak to your representative',
  'speak to staff',
  'speak to an associate',
  'speak to a team member',
  'speak to the team',
  'speak to someone on your team',
  'speak to one of your',
  'get a representative',
  'reach a representative',

  // ── Manager / supervisor requests ─────────────────────────────────────────
  'speak to a manager',
  'talk to a manager',
  'speak to the manager',
  'get a manager',
  'manager please',
  'speak to a supervisor',
  'talk to a supervisor',
  'need a manager',
  'need a supervisor',
  'get me a manager',
  'let me speak to a manager',
  'i want a manager',
  'i want to speak to a manager',
  'i need to speak to a manager',
  'need your manager',
  'speak to your manager',

  // ── Department-directed transfer requests ──────────────────────────────────
  'connect me to billing',
  'connect me to service',
  'connect me to sales',
  'connect me to dispatch',
  'connect me to support',
  'billing department',
  'service department',
  'sales department',
  'speak to billing',
  'talk to billing',
  'speak to service',
  'speak to sales',
  'speak to dispatch',
  'transfer to billing',
  'transfer to service',
  'transfer to sales',

  // ── Urgency + transfer ─────────────────────────────────────────────────────
  'need to speak to someone',
  'need to talk to someone',
  'must speak to someone',
  'have to speak to someone',
  'can i speak to',
  'can i talk to',
  'may i speak to',
  'may i talk to',
  'id like to speak to',
  "i'd like to speak to",
  "i'd like to talk to",
  'id like to talk to',
  'i want to speak to',
  'i want to talk to',
  'i need to speak to',
  'i need to talk to',
  'could i speak to',
  'could i talk to',
  'is there someone i can speak to',
  'is there someone i can talk to',
  'is there anyone i can speak to',

  // ── Operator request ──────────────────────────────────────────────────────
  'operator please',
  'get me an operator',
  'speak to the operator',
  'talk to the operator',
  'zero',  // classic "press 0 for operator" reflex

  // ── Frustration escalation ────────────────────────────────────────────────
  'i want to speak to a real person',
  'just let me talk to someone',
  'stop the recording',
  'i need a real person',
  'stop the automated',
  'this is an emergency',
];

/**
 * NOT_TRANSFER_PHRASES — Exclusion patterns. Utterances that contain
 * transfer-like words but are NOT actually human-transfer requests.
 * Checked BEFORE TRANSFER_PHRASES — if a match here, intent is NOT transfer.
 */
const NOT_TRANSFER_PHRASES = [
  'transfer my appointment',
  'transfer my call',
  'transfer my number',
  'transfer my service',
  'transfer my account',
  'bank transfer',
  'wire transfer',
  'money transfer',
  'transfer ownership',
  'transfer credit',
  'balance transfer',
  'title transfer',
];

// ── Department keywords (for hint extraction) ─────────────────────────────────

const DEPT_KEYWORDS = [
  'billing', 'service', 'sales', 'dispatch', 'support', 'parts',
  'installation', 'scheduling', 'accounts', 'accounting', 'technical',
  'tech support', 'customer service', 'field service', 'admin'
];

// ============================================================================
// NORMALIZATION
// ============================================================================

/**
 * _normalize — Lowercase + strip punctuation. Preserves apostrophes.
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
 * _hasPhrase — Test whether phrase appears in normalized input.
 * Multi-word: substring. Single-word: whole-word boundary.
 */
function _hasPhrase(norm, phrase) {
  if (phrase.includes(' ')) return norm.includes(phrase);
  return norm.split(/\s+/).includes(phrase);
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * isTransferIntent — Returns true if the caller wants to speak to a human.
 *
 * @param {string} input — raw caller utterance
 * @returns {boolean}
 */
function isTransferIntent(input) {
  const norm = _normalize(input);
  if (!norm) return false;

  // Exclusions first — prevents false positives on "bank transfer" etc.
  if (NOT_TRANSFER_PHRASES.some(phrase => _hasPhrase(norm, phrase))) return false;

  return TRANSFER_PHRASES.some(phrase => _hasPhrase(norm, phrase));
}

/**
 * getTransferHint — Extract routing hints from a transfer-intent utterance.
 *
 * Returns a hint object used by the runtime to pre-select a destination:
 *   personName  — if caller says "connect me to John" → "john"
 *   department  — if caller says "billing please" → "billing"
 *   urgency     — 'high' if urgency/manager/emergency language detected
 *
 * @param {string} input — raw caller utterance (assumed isTransferIntent = true)
 * @returns {{ personName: string|null, department: string|null, urgency: 'high'|'normal' }}
 */
function getTransferHint(input) {
  const norm  = _normalize(input);
  const words = norm.split(/\s+/);

  // ── Department detection ──────────────────────────────────────────────────
  let department = null;
  for (const kw of DEPT_KEYWORDS) {
    if (kw.includes(' ') ? norm.includes(kw) : words.includes(kw)) {
      department = kw;
      break;
    }
  }

  // ── Urgency detection ─────────────────────────────────────────────────────
  const urgencyWords = ['emergency', 'urgent', 'immediately', 'right now', 'asap', 'manager', 'supervisor'];
  const urgency = urgencyWords.some(w => _hasPhrase(norm, w)) ? 'high' : 'normal';

  // ── Person name extraction (heuristic) ────────────────────────────────────
  // Patterns: "connect me to [Name]", "speak to [Name]", "transfer me to [Name]"
  // We extract the word(s) following these phrases if they look like names
  // (capitalisable, not a department keyword, not a stop word).
  let personName = null;

  const connectPrefixes = [
    'connect me to', 'connect me with', 'speak to', 'speak with',
    'talk to', 'talk with', 'transfer me to', 'transfer to',
    'put me through to', 'patch me through to'
  ];

  const STOP_WORDS = new Set([
    'a', 'an', 'the', 'my', 'your', 'our', 'their', 'his', 'her', 'its',
    'someone', 'anyone', 'person', 'agent', 'human', 'representative', 'rep',
    'manager', 'supervisor', 'operator', 'staff', 'team', 'member',
    'please', 'now', 'immediately', 'asap'
  ]);

  for (const prefix of connectPrefixes) {
    const idx = norm.indexOf(prefix);
    if (idx === -1) continue;
    const remainder = norm.slice(idx + prefix.length).trim();
    const candidate = remainder.split(/\s+/)[0];
    if (
      candidate &&
      candidate.length > 1 &&
      !STOP_WORDS.has(candidate) &&
      !DEPT_KEYWORDS.includes(candidate)
    ) {
      personName = candidate;
      break;
    }
  }

  return { personName, department, urgency };
}

// ============================================================================
// RUNTIME OVERRIDE — called by GlobalHubService.loadSignals() at startup
// ============================================================================

/**
 * Replace the active transfer phrase list with values from GlobalShare.
 * Called once at server startup after signals are loaded from MongoDB.
 * If GlobalShare has no saved phrases, this is never called — hardcoded
 * defaults above remain active.
 *
 * @param {{ transferPhrases?: string[] }} overrides
 */
function initialize({ transferPhrases } = {}) {
  if (Array.isArray(transferPhrases) && transferPhrases.length > 0) {
    TRANSFER_PHRASES.length = 0;
    TRANSFER_PHRASES.push(...transferPhrases);
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  isTransferIntent,
  getTransferHint,
  initialize,
  // Exported for tests and seed scripts
  TRANSFER_PHRASES,
  NOT_TRANSFER_PHRASES,
  DEPT_KEYWORDS
};
