/**
 * MissingNamePartExtractor
 *
 * Purpose: safely extract a missing name part (first/last) ONLY from explicit name phrases,
 * with a hard trade/problem guard. This is used by ConversationEngine booking safety net.
 *
 * Non-goals:
 * - Do not "guess" from generic phrases like "it's X" (too ambiguous).
 * - Do not mutate session/slots here (pure function).
 */

const NAME_STOP_WORDS = new Set([
  'is', 'are', 'was', 'were', 'be', 'been', 'am', 'has', 'have', 'had',
  'the', 'my', 'its', "it's", 'a', 'an', 'name', 'last', 'first',
  'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'no', 'nope',
  'hi', 'hello', 'hey', 'please', 'thanks', 'thank', 'you',
  'it', 'that', 'this', 'what', 'and', 'or', 'but', 'to', 'for', 'with'
]);

const TRADE_WORDS = /\b(unit|ac|a\/c|air\s*con|air\s*condition(?:er|ing)?|cooling|not\s+cool(?:ing)?|heat|heating|furnace|thermostat|compressor|condenser|leak|leaking|drip|dripping|broken|not\s+working|stopped\s+working)\b/i;

function cleanAlphaToken(token) {
  return String(token || '').replace(/[^A-Za-z'-]/g, '').trim();
}

function isValidNameToken(token) {
  const clean = cleanAlphaToken(token);
  if (!clean || clean.length < 2) return false;
  if (NAME_STOP_WORDS.has(clean.toLowerCase())) return false;
  if (/^(do|does|did|will|would|could|should|can|may|might)$/i.test(clean)) return false;
  return true;
}

function titleCase(token) {
  if (!token) return token;
  return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
}

function isTradeProblemSentence(text) {
  return TRADE_WORDS.test(String(text || ''));
}

function extractFromLastNameIs(text) {
  const m = String(text || '').match(/(?:the\s+)?(?:my\s+)?last\s+name\s+(?:is\s+)?([A-Za-z'-]+)/i);
  const token = m ? cleanAlphaToken(m[1]) : null;
  return isValidNameToken(token) ? titleCase(token) : null;
}

function extractFromFirstNameIs(text) {
  const m = String(text || '').match(/(?:the\s+)?(?:my\s+)?first\s+name\s+(?:is\s+)?([A-Za-z'-]+)/i);
  const token = m ? cleanAlphaToken(m[1]) : null;
  return isValidNameToken(token) ? titleCase(token) : null;
}

function extractFullNameFromThisIs(text) {
  // Examples:
  // - "this is John Stevens"
  // - "this is John Stevens speaking"
  const m = String(text || '').match(/\bthis\s+is\s+([A-Za-z'-]+)\s+([A-Za-z'-]+)\b/i);
  if (!m) return null;
  const first = cleanAlphaToken(m[1]);
  const last = cleanAlphaToken(m[2]);
  if (!isValidNameToken(first) || !isValidNameToken(last)) return null;
  return { first: titleCase(first), last: titleCase(last) };
}

function extractBareSingleToken(text) {
  const raw = String(text || '').trim();
  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length !== 1) return null;
  const t = cleanAlphaToken(tokens[0]);
  return isValidNameToken(t) ? titleCase(t) : null;
}

/**
 * Extract missing name part based on explicit patterns.
 *
 * @param {Object} params
 * @param {string} params.userText
 * @param {'FIRST_NAME'|'LAST_NAME'} params.expectingPart
 * @param {boolean} params.recentNamePrompt - true if we just asked a name-related question
 * @param {boolean} params.allowBareToken - allow single-token reply when we just asked
 * @returns {{ extracted: string|null, outcome: string }}
 */
function extractMissingNamePart({ userText, expectingPart, recentNamePrompt, allowBareToken }) {
  const text = String(userText || '').trim();
  if (!text) return { extracted: null, outcome: 'empty' };

  if (isTradeProblemSentence(text)) {
    return { extracted: null, outcome: 'skipped_trade_sentence' };
  }

  if (!recentNamePrompt) {
    return { extracted: null, outcome: 'not_recent_name_prompt' };
  }

  // Explicit full-name phrases (useful when expecting last name too)
  const full = extractFullNameFromThisIs(text);
  if (full) {
    const extracted = expectingPart === 'FIRST_NAME' ? full.first : full.last;
    return { extracted, outcome: 'explicit_full_name' };
  }

  if (expectingPart === 'LAST_NAME') {
    const last = extractFromLastNameIs(text);
    if (last) return { extracted: last, outcome: 'explicit_last_name' };
  }
  if (expectingPart === 'FIRST_NAME') {
    const first = extractFromFirstNameIs(text);
    if (first) return { extracted: first, outcome: 'explicit_first_name' };
  }

  if (allowBareToken) {
    const bare = extractBareSingleToken(text);
    if (bare) return { extracted: bare, outcome: 'bare_token' };
  }

  return { extracted: null, outcome: 'no_match' };
}

module.exports = {
  isTradeProblemSentence,
  extractMissingNamePart
};

