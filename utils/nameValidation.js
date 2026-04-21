'use strict';

/**
 * ============================================================================
 * NAME VALIDATION — shared sanity guard for caller names
 * ============================================================================
 *
 * Single source of truth for "is this string plausibly a person's name?".
 * Used in two places (and anywhere a third consumer needs it later):
 *
 *   WRITE side — services/engine/CustomerProfileService.stamp()
 *     Before promoting a name to callerProfile.knownNames[].
 *
 *   READ side — services/engine/CallerRecognitionService.preWarm()
 *     Before accepting a knownNames entry (or most-recent temp.firstName)
 *     as a valid pre-warm name. Historical corrupted data (source='confirmed'
 *     entries that were never actually confirmed, e.g. "getting ridiculous")
 *     must be filtered at read time in addition to write time.
 *
 * DESIGN:
 *   - Stateless, pure function
 *   - Returns { ok: boolean, reason: string|null } — reason feeds drift-log
 *   - Conservative: rejects what is almost certainly not a name
 *   - Never throws — observability only, never disrupts a call
 *
 * RULES (rejects if ANY matches):
 *   1. Empty string or non-string
 *   2. Trimmed length < 2 or > 40 chars
 *   3. Contains a stopword substring (emotional / transactional vocabulary)
 *   4. Starts with a gerund prefix (getting, being, feeling, …)
 *
 * KNOWN LIMITATION: does not validate via character set (so it accepts
 * international names, accented characters, hyphens, apostrophes). It only
 * rejects strings that are obviously NOT names.
 *
 * ============================================================================
 */

const KNOWN_NAMES_STOPWORDS = [
  'ridiculous', 'whatever', 'want', 'need', "don't", 'dont',
  'maybe', 'calling', 'waiting', 'annoying', 'crazy', 'stupid',
  'frustrating', 'frustrated', 'upset', 'angry', 'confused',
  'hello', 'hi ', 'hey ',
];

const KNOWN_NAMES_GERUND_PREFIXES = [
  'getting ', 'being ', 'feeling ', 'calling ', 'waiting ',
  'trying ', 'looking ', 'hoping ', 'wanting ', 'needing ',
];

/**
 * isPlausibleName — sanity guard. Returns { ok, reason }.
 *   ok=true  → caller string passes all rejection rules; safe to use.
 *   ok=false → reason tells us which rule fired (fed into log line).
 *
 * @param {string} name
 * @returns {{ok: boolean, reason: string|null}}
 */
function isPlausibleName(name) {
  if (!name || typeof name !== 'string') return { ok: false, reason: 'empty_or_wrong_type' };
  const trimmed = name.trim();
  if (trimmed.length < 2)  return { ok: false, reason: 'too_short' };
  if (trimmed.length > 40) return { ok: false, reason: 'too_long' };

  const lower = trimmed.toLowerCase();

  for (const stopword of KNOWN_NAMES_STOPWORDS) {
    if (lower.includes(stopword)) {
      return { ok: false, reason: 'stopword:' + stopword.trim() };
    }
  }

  for (const prefix of KNOWN_NAMES_GERUND_PREFIXES) {
    if (lower.startsWith(prefix)) {
      return { ok: false, reason: 'gerund_prefix:' + prefix.trim() };
    }
  }

  return { ok: true, reason: null };
}

/**
 * splitFullName — tiny helper for consumers that store knownNames as a
 * single "First Last" string but need to pre-fill discoveryNotes.temp
 * which has separate firstName/lastName fields.
 *
 * @param {string} fullName
 * @returns {{firstName: string|null, lastName: string|null}}
 */
function splitFullName(fullName) {
  if (!fullName || typeof fullName !== 'string') return { firstName: null, lastName: null };
  const parts = fullName.trim().split(/\s+/);
  return {
    firstName: parts[0] || null,
    lastName:  parts.slice(1).join(' ') || null,
  };
}

module.exports = {
  isPlausibleName,
  splitFullName,
  // Exported for testing / inspection
  KNOWN_NAMES_STOPWORDS,
  KNOWN_NAMES_GERUND_PREFIXES,
};
