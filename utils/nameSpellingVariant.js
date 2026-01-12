/**
 * Name spelling-variant utilities
 * 
 * Purpose:
 * - Parse an assistant spelling-variant prompt like:
 *   "Mark with a K or Marc with a C?"
 * - Parse a user response and determine which option they chose
 * 
 * NOTE:
 * - This is NOT AI behavior text; it is deterministic parsing of user input
 * - We avoid guessing. If unclear, return null so the caller can fall back safely.
 */

/**
 * Attempt to parse an assistant spelling-variant prompt.
 * 
 * Supported examples:
 * - "Mark with a K or Marc with a C?"
 * - "Is that Mark with a K or Marc with a C"
 * - "Mark with K or Marc with C"
 *
 * @param {string} text
 * @returns {{ hasVariant: true, optionA: string, optionB: string, letterA: string, letterB: string } | null}
 */
function parseSpellingVariantPrompt(text) {
  if (!text || typeof text !== 'string') return null;

  const raw = text.trim();
  if (!raw) return null;

  // Capture: "<NameA> with (a|the)? <LetterA> ... or ... <NameB> with (a|the)? <LetterB>"
  // Name tokens: letters + apostrophes/hyphens (keep it human-name friendly)
  const re = /\b([A-Za-z][A-Za-z'\-]{1,})\b\s+with\s+(?:a\s+|the\s+)?([A-Za-z])\b[\s\S]*?\bor\b[\s\S]*?\b([A-Za-z][A-Za-z'\-]{1,})\b\s+with\s+(?:a\s+|the\s+)?([A-Za-z])\b/i;
  const m = raw.match(re);
  if (!m) return null;

  const optionA = titleCase(m[1]);
  const letterA = String(m[2] || '').toUpperCase();
  const optionB = titleCase(m[3]);
  const letterB = String(m[4] || '').toUpperCase();

  if (!optionA || !optionB || !letterA || !letterB) return null;

  return { hasVariant: true, optionA, optionB, letterA, letterB };
}

/**
 * Determine which spelling option a user selected.
 * 
 * Rules:
 * - Prefer explicit letter patterns: "with a C", "the K", "C", "K please"
 * - Else prefer exact name matches (word boundaries)
 * - Else accept "first/second" or "option 1/option 2"
 * - Otherwise return null (do not guess)
 *
 * @param {string} userText
 * @param {{ optionA: string, optionB: string, letterA: string, letterB: string }} variant
 * @returns {string | null} chosenName
 */
function parseSpellingVariantResponse(userText, variant) {
  if (!userText || typeof userText !== 'string') return null;
  if (!variant || !variant.optionA || !variant.optionB || !variant.letterA || !variant.letterB) return null;

  const text = userText.toLowerCase().trim();
  if (!text) return null;

  const letterALower = variant.letterA.toLowerCase();
  const letterBLower = variant.letterB.toLowerCase();

  // Compact form (letters only) catches common no-space inputs like "withac"
  // Example: "Mark with AC" -> "markwithac" (treat as "with a c")
  const compact = text.replace(/[^a-z]/g, '');

  // "with a c", "with the c", "the c", "a c", or just "c" with boundaries
  const hasLetterAPattern = new RegExp(`(?:\\bwith\\s+(?:a|the)\\s+|\\bthe\\s+|\\ba\\s+|^)${escapeRegExp(letterALower)}(?:$|\\s|\\.|,|!|\\?)`, 'i').test(text);
  const hasLetterBPattern = new RegExp(`(?:\\bwith\\s+(?:a|the)\\s+|\\bthe\\s+|\\ba\\s+|^)${escapeRegExp(letterBLower)}(?:$|\\s|\\.|,|!|\\?)`, 'i').test(text);

  // Compact variants: "withac" / "withthec" / "withc"
  const hasLetterACompact =
    compact.includes(`witha${letterALower}`) ||
    compact.includes(`withthe${letterALower}`) ||
    compact.includes(`with${letterALower}`);
  const hasLetterBCompact =
    compact.includes(`witha${letterBLower}`) ||
    compact.includes(`withthe${letterBLower}`) ||
    compact.includes(`with${letterBLower}`);

  const hasAByLetter = hasLetterAPattern || hasLetterACompact;
  const hasBByLetter = hasLetterBPattern || hasLetterBCompact;

  if (hasAByLetter && !hasBByLetter) return variant.optionA;
  if (hasBByLetter && !hasAByLetter) return variant.optionB;

  const a = variant.optionA.toLowerCase();
  const b = variant.optionB.toLowerCase();
  const hasA = new RegExp(`\\b${escapeRegExp(a)}\\b`, 'i').test(text);
  const hasB = new RegExp(`\\b${escapeRegExp(b)}\\b`, 'i').test(text);

  if (hasA && !hasB) return variant.optionA;
  if (hasB && !hasA) return variant.optionB;

  if (/\b(first|option 1|number 1|1st|the first)\b/i.test(text)) return variant.optionA;
  if (/\b(second|option 2|number 2|2nd|the second)\b/i.test(text)) return variant.optionB;

  return null;
}

function titleCase(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = {
  parseSpellingVariantPrompt,
  parseSpellingVariantResponse
};

