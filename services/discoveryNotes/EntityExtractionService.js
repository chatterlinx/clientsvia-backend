'use strict';

/**
 * ============================================================================
 * ENTITY EXTRACTION SERVICE — discoveryNotes Parallel Walk
 * ============================================================================
 *
 * PURPOSE:
 * Regex-first, zero-LLM entity extraction that runs fire-and-forget on EVERY
 * turn — discovery, booking, any mode. Captures names, phone numbers, and
 * addresses from natural caller speech into discoveryNotes.temp.
 *
 * This is what makes discoveryNotes "walk parallel" — entities are captured
 * throughout the entire call, not just during booking collection steps.
 *
 * DESIGN:
 * - Sub-1ms execution — pure regex, no network calls
 * - Confidence scoring: trigger phrase match = 0.90-0.95, isolated pattern = 0.60
 * - High-confidence (≥0.80) extractions push field to doNotReask[]
 * - Writes to discoveryNotes.temp via DiscoveryNotesService.update() (fire-and-forget)
 * - Never overwrites existing higher-confidence values
 *
 * INTEGRATION:
 *   // Fire-and-forget on every turn (never awaited in hot path):
 *   EntityExtractionService.extractAndUpdate(companyId, callSid, utterance).catch(() => {});
 *
 * ============================================================================
 */

const DiscoveryNotesService = require('./DiscoveryNotesService');
const logger = require('../../utils/logger');

const LOG_PREFIX = '[ENTITY_EXTRACTION]';

// ============================================================================
// NAME EXTRACTION
// ============================================================================

// Trigger phrases that reliably precede a name
const NAME_TRIGGERS = [
  // "this is Mark"                 → firstName
  // "my name is Mark Johnson"      → firstName + lastName
  // "it's Mark"                    → firstName
  // "I'm Mark"                     → firstName
  // "Mark calling"                 → firstName
  // "my first name is Mark"        → firstName (explicit)
  // "last name is Johnson"         → lastName (explicit)
  /\b(?:this is|my name is|i'm|i am|it's|its)\s+([A-Z][a-z]{1,20})(?:\s+([A-Z][a-z]{1,20}))?\b/i,
  /\b([A-Z][a-z]{1,20})(?:\s+([A-Z][a-z]{1,20}))?\s+(?:calling|here|speaking)\b/i,
  /\bmy (?:first )?name(?:'s| is)\s+([A-Z][a-z]{1,20})\b/i,
  /\blast name(?:'s| is)\s+([A-Z][a-z]{1,20})\b/i,
  /\bcall me\s+([A-Z][a-z]{1,20})\b/i,
];

// Words that look like names but aren't (common false positives from speech)
const NAME_STOPWORDS = new Set([
  'the', 'and', 'but', 'for', 'not', 'you', 'your', 'our', 'yes', 'yeah',
  'sure', 'well', 'just', 'like', 'also', 'about', 'how', 'what', 'when',
  'where', 'why', 'who', 'can', 'could', 'would', 'should', 'have', 'has',
  'had', 'been', 'being', 'was', 'were', 'are', 'that', 'this', 'with',
  'from', 'they', 'them', 'their', 'there', 'here', 'some', 'then', 'than',
  'very', 'really', 'actually', 'basically', 'definitely', 'probably',
  'calling', 'hold', 'wait', 'hello', 'hey', 'morning', 'afternoon',
  'evening', 'today', 'tomorrow', 'monday', 'tuesday', 'wednesday',
  'thursday', 'friday', 'saturday', 'sunday', 'thanks', 'thank',
  'please', 'okay', 'right', 'great', 'good', 'fine', 'cool', 'nice',
  'service', 'maintenance', 'repair', 'system', 'unit', 'cooling',
  'heating', 'problem', 'issue', 'appointment', 'schedule', 'book',
]);

/**
 * Extract name from utterance.
 * @param {string} text Normalized utterance
 * @returns {{ firstName?: string, lastName?: string, confidence: number } | null}
 */
function _extractName(text) {
  for (const pattern of NAME_TRIGGERS) {
    const m = text.match(pattern);
    if (!m) continue;

    // Depending on pattern, m[1] is firstName or lastName
    const isLastNameOnly = /\blast name/i.test(pattern.source);
    let firstName = null;
    let lastName = null;

    if (isLastNameOnly) {
      lastName = m[1];
    } else {
      firstName = m[1];
      lastName = m[2] || null;
    }

    // Validate: reject stopwords
    if (firstName && NAME_STOPWORDS.has(firstName.toLowerCase())) firstName = null;
    if (lastName && NAME_STOPWORDS.has(lastName.toLowerCase())) lastName = null;

    if (!firstName && !lastName) continue;

    // High confidence for explicit trigger phrase match
    const confidence = /\bmy (?:first )?name|this is|i'm|i am/i.test(text) ? 0.95 : 0.85;

    return { firstName, lastName, confidence };
  }

  return null;
}

// ============================================================================
// PHONE EXTRACTION
// ============================================================================

// Match common US phone patterns: 10 digits, 7 digits, with/without separators
// Handles: (239) 555-1234, 239-555-1234, 239.555.1234, 2395551234, 555-1234
const PHONE_PATTERNS = [
  // 10-digit with optional separators: (239) 555-1234, 239-555-1234, 239 555 1234
  /\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}/,
  // spoken digit sequence (10+ digits): "two three nine five five five one two three four"
  // We look for the final numeric result after the regex above, but also handle
  // "my number is 239 565 2202" (space-separated groups)
];

// Context triggers that boost confidence
const PHONE_TRIGGERS = [
  /\bmy (?:phone|number|cell|mobile)\b/i,
  /\bcall (?:me|back) (?:at|on)\b/i,
  /\bnumber is\b/i,
  /\breach (?:me|us) at\b/i,
  /\bphone(?:'s| is)\b/i,
];

/**
 * Extract phone number from utterance.
 * @param {string} text
 * @returns {{ phone: string, confidence: number } | null}
 */
function _extractPhone(text) {
  for (const pattern of PHONE_PATTERNS) {
    const m = text.match(pattern);
    if (!m) continue;

    // Clean to digits only
    const digits = m[0].replace(/\D/g, '');

    // Validate: must be 7 or 10 digits
    if (digits.length !== 7 && digits.length !== 10) continue;

    // Check for trigger phrase to boost confidence
    const hasTrigger = PHONE_TRIGGERS.some(p => p.test(text));
    const confidence = hasTrigger ? 0.95 : 0.75;

    return { phone: digits, confidence };
  }

  return null;
}

// ============================================================================
// ADDRESS EXTRACTION
// ============================================================================

// Common US street suffixes
const STREET_SUFFIXES = '(?:street|st|avenue|ave|boulevard|blvd|drive|dr|road|rd|lane|ln|way|court|ct|circle|cir|place|pl|terrace|ter|trail|trl|parkway|pkwy|highway|hwy)';

// Match: 123 Main Street, 1234 Oak Avenue, etc.
const ADDRESS_PATTERN = new RegExp(
  `\\b(\\d{1,6})\\s+([A-Za-z][A-Za-z\\s]{1,40})\\s+${STREET_SUFFIXES}\\b`,
  'i'
);

// Context triggers
const ADDRESS_TRIGGERS = [
  /\bmy address\b/i,
  /\blive (?:at|on)\b/i,
  /\blocated (?:at|on)\b/i,
  /\baddress is\b/i,
  /\bwe(?:'re| are) (?:at|on)\b/i,
  /\bhouse (?:is )?(?:at|on)\b/i,
  /\bproperty (?:is )?(?:at|on)\b/i,
];

/**
 * Extract address from utterance.
 * @param {string} text
 * @returns {{ address: string, confidence: number } | null}
 */
function _extractAddress(text) {
  const m = text.match(ADDRESS_PATTERN);
  if (!m) return null;

  // Reconstruct clean address
  const address = m[0].trim();

  // Validate: not too short
  if (address.length < 8) return null;

  const hasTrigger = ADDRESS_TRIGGERS.some(p => p.test(text));
  const confidence = hasTrigger ? 0.90 : 0.65;

  return { address, confidence };
}

// ============================================================================
// EMAIL EXTRACTION
// ============================================================================

const EMAIL_PATTERN = /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/;

/**
 * Extract email from utterance.
 * @param {string} text
 * @returns {{ email: string, confidence: number } | null}
 */
function _extractEmail(text) {
  const m = text.match(EMAIL_PATTERN);
  if (!m) return null;
  return { email: m[0].toLowerCase(), confidence: 0.95 };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Extract all entities from an utterance (pure function, no side effects).
 *
 * @param {string} utterance  Raw caller speech
 * @returns {{ firstName?: string, lastName?: string, phone?: string,
 *             address?: string, email?: string, confidence: Object } | null}
 *          Null if nothing extracted.
 */
function extract(utterance) {
  if (!utterance || typeof utterance !== 'string' || utterance.trim().length < 2) {
    return null;
  }

  const text = utterance.trim();
  const result = {};
  const confidence = {};
  let found = false;

  // ── Name ──────────────────────────────────────────────────────────────────
  const nameResult = _extractName(text);
  if (nameResult) {
    if (nameResult.firstName) {
      result.firstName = nameResult.firstName;
      confidence.firstName = nameResult.confidence;
      found = true;
    }
    if (nameResult.lastName) {
      result.lastName = nameResult.lastName;
      confidence.lastName = nameResult.confidence;
      found = true;
    }
  }

  // ── Phone ─────────────────────────────────────────────────────────────────
  const phoneResult = _extractPhone(text);
  if (phoneResult) {
    result.phone = phoneResult.phone;
    confidence.phone = phoneResult.confidence;
    found = true;
  }

  // ── Address ───────────────────────────────────────────────────────────────
  const addressResult = _extractAddress(text);
  if (addressResult) {
    result.address = addressResult.address;
    confidence.address = addressResult.confidence;
    found = true;
  }

  // ── Email ─────────────────────────────────────────────────────────────────
  const emailResult = _extractEmail(text);
  if (emailResult) {
    result.email = emailResult.email;
    confidence.email = emailResult.confidence;
    found = true;
  }

  if (!found) return null;

  result.confidence = confidence;
  return result;
}

/**
 * Extract entities and write to discoveryNotes.temp (fire-and-forget).
 *
 * USAGE: EntityExtractionService.extractAndUpdate(companyId, callSid, utterance).catch(() => {});
 *
 * MERGE RULES:
 * - Only writes fields that are non-null in extraction result
 * - Only overwrites existing values if new confidence > existing confidence
 * - High-confidence (≥0.80) fields push to doNotReask[]
 *
 * @param {string} companyId
 * @param {string} callSid
 * @param {string} utterance
 * @returns {Promise<void>}
 */
async function extractAndUpdate(companyId, callSid, utterance) {
  try {
    const extracted = extract(utterance);
    if (!extracted) return;

    // Load current notes to check existing confidence values
    const currentNotes = await DiscoveryNotesService.load(companyId, callSid);
    if (!currentNotes) return; // No active call session

    const currentConf = currentNotes.temp?.confidence || {};
    const tempPatch = {};
    const confPatch = {};
    const doNotReask = [];
    let hasUpdate = false;

    // Only write fields where new confidence >= existing confidence
    const fields = ['firstName', 'lastName', 'phone', 'address', 'email'];
    for (const field of fields) {
      if (extracted[field] === undefined) continue;

      const newConf = extracted.confidence[field] || 0;
      const existingConf = currentConf[field] || 0;

      // Skip if existing value has higher confidence
      if (currentNotes.temp?.[field] && existingConf > newConf) continue;

      tempPatch[field] = extracted[field];
      confPatch[field] = newConf;
      hasUpdate = true;

      // High-confidence extractions → doNotReask
      if (newConf >= 0.80) {
        doNotReask.push(field);
      }
    }

    if (!hasUpdate) return;

    // Build the patch for DiscoveryNotesService.update()
    const patch = {
      temp: {
        ...tempPatch,
        confidence: confPatch,
      },
    };

    if (doNotReask.length > 0) {
      patch.doNotReask = doNotReask;
    }

    // Fire the update (this is itself fire-and-forget safe)
    await DiscoveryNotesService.update(companyId, callSid, patch);

    logger.info(`${LOG_PREFIX} Entities extracted`, {
      callSid,
      fields: Object.keys(tempPatch),
      confidence: confPatch,
    });

  } catch (err) {
    // Never throw — this is fire-and-forget
    logger.warn(`${LOG_PREFIX} extractAndUpdate failed (non-fatal)`, {
      callSid,
      error: err.message,
    });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  extract,           // Pure function — returns extracted entities (for testing)
  extractAndUpdate,  // Fire-and-forget — extracts + writes to discoveryNotes
};
