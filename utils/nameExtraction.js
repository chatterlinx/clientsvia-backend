/**
 * Deterministic name extraction (no LLM, no env dependencies)
 *
 * Goals:
 * - Be conservative in DISCOVERY (avoid false positives)
 * - Be more permissive in BOOKING when we're expecting a name
 * - Handle human "noise" phrases while still extracting a clean name
 * - Support patterns like: "my name is Larry ... but it's Gonzalez"
 *
 * NOTE: This is parsing logic, not AI behavior text.
 */

function extractName(text, { expectingName = false, customStopWords = [] } = {}) {
  if (!text || typeof text !== 'string') return null;

  const raw = text.trim();
  if (!raw) return null;

  // STOP WORDS: tokens that should never be treated as name parts
  // This list is intentionally generic and not trade-specific.
  const PLATFORM_STOP_WORDS = [
    // Greetings & fillers
    'hi', 'hello', 'hey', 'good', 'morning', 'afternoon', 'evening', 'night',
    'uh', 'um', 'erm', 'hmm', 'ah', 'oh', 'well', 'so', 'like', 'just',
    // Confirmations
    'yeah', 'yes', 'sure', 'okay', 'ok', 'alright', 'right', 'yep', 'yup',
    'go', 'ahead', 'absolutely', 'definitely', 'certainly', 'perfect', 'sounds',
    // Common words & auxiliary verbs
    'the', 'that', 'this', 'what', 'please', 'thanks', 'thank', 'you',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'has', 'have', 'had',
    'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might',
    'it', 'its', 'my', 'your', 'our', 'their', 'his', 'her', 'a', 'an', 'and', 'or', 'but',
    'to', 'see', 'if', 'we', 'get', 'somebody', 'someone', 'here', 'there', 'today', 'now',
    // Common verbs
    'having', 'doing', 'calling', 'looking', 'trying', 'getting', 'going', 'coming',
    'waiting', 'hoping', 'thinking', 'wondering', 'needing', 'wanting', 'asking',
    'dealing', 'experiencing', 'seeing', 'feeling', 'hearing', 'running', 'working',
    // Generic “noise” adjectives often present in human rambling
    'pretty', 'long', 'short', 'kinda', 'kind', 'sorta', 'sort',
    // Problem-related words (generic)
    'problem', 'problems', 'issue', 'issues', 'trouble', 'wrong', 'weird', 'strange',
    // Question words
    'any', 'some', 'with'
  ];

  const STOP_WORDS = new Set([
    ...PLATFORM_STOP_WORDS,
    ...(customStopWords || []).map(w => String(w).toLowerCase().trim()).filter(Boolean)
  ]);

  // Strict patterns that indicate actual name introduction
  const strictNamePatterns = [
    /\bmy name is\b/i,
    /\bname is\b/i,
    /\bthis is\s+[A-Z]/,
    /\bi am\s+[A-Z]/,
    /\bi'?m\s+[A-Z][a-z]+(?:\s|$|,)/,
    /\bit'?s\s+[A-Z]/,
    /\bcall me\b/i
  ];
  const hasNameIntent = strictNamePatterns.some(p => p.test(raw));

  // Gate: Only extract if expecting name OR explicit name intent
  if (!expectingName && !hasNameIntent) return null;

  // Extract the post-intro clause (best-effort)
  const patterns = [
    /\bmy name is\s+(.+)$/i,
    /\bname is\s+(.+)$/i,
    /\bthis is\s+(.+)$/i,
    /\bi am\s+(.+)$/i,
    /\bi'?m\s+(.+)$/i,
    /\bit'?s\s+(.+)$/i,
    /\bcall me\s+(.+)$/i
  ];

  let candidate = null;
  for (const re of patterns) {
    const m = raw.match(re);
    if (m && m[1]) {
      candidate = m[1];
      break;
    }
  }
  if (!candidate && expectingName) candidate = raw;
  if (!candidate) return null;

  // Special-case: human ramble where last name is provided after a “but it’s …”
  // Example: "my name is Larry pretty long but it's Gonzalez"
  // We prefer the first meaningful token as first name + explicit tail token as last name.
  if (expectingName && hasNameIntent) {
    const lastNameFromTail =
      raw.match(/\b(?:last name is|surname is)\s+([A-Za-z][A-Za-z'\-]{1,})\b/i)?.[1] ||
      raw.match(/\bbut\b[\s\S]*?\b(?:it'?s|it is|its)\s+([A-Za-z][A-Za-z'\-]{1,})\b/i)?.[1] ||
      null;

    if (lastNameFromTail) {
      const firstToken = firstMeaningfulToken(candidate, STOP_WORDS);
      const lastToken = cleanToken(lastNameFromTail);
      if (firstToken && lastToken && !STOP_WORDS.has(lastToken.toLowerCase())) {
        return `${titleCase(firstToken)} ${titleCase(lastToken)}`.trim();
      }
    }
  }

  // Cut at clause boundaries to avoid "Mark do you..." → "Mark"
  //
  // V76: When we're explicitly expecting a name (BOOKING), don't cut on commas.
  // Humans often say "yes, Mark" which would otherwise become just "yes".
  const boundaryRegex = expectingName
    ? /(?:\band\b|\bbut\b|\bso\b|\bdo\b|\bcan\b|\bwill\b|\bhave\b|\bi\b|\byou\b|\bwe\b|\bthey\b|\?|\.|!)/i
    : /(?:\band\b|\bbut\b|\bso\b|\bdo\b|\bcan\b|\bwill\b|\bhave\b|\bi\b|\byou\b|\bwe\b|\bthey\b|,|\?|\.|!)/i;

  candidate = candidate.split(boundaryRegex)[0].trim();

  const tokens = tokenizeName(candidate, STOP_WORDS);
  if (tokens.length === 0) return null;

  // Take first two meaningful tokens (first + optional last)
  const firstName = tokens[0];
  const lastName = tokens.length >= 2 ? tokens[1] : null;

  return lastName ? `${titleCase(firstName)} ${titleCase(lastName)}` : titleCase(firstName);
}

function tokenizeName(candidate, STOP_WORDS) {
  if (!candidate) return [];
  const parts = candidate
    .split(/\s+/)
    .map(cleanToken)
    .filter(Boolean)
    .filter(t => looksLikeNameToken(t, STOP_WORDS));
  return parts;
}

function firstMeaningfulToken(candidate, STOP_WORDS) {
  const tokens = tokenizeName(candidate, STOP_WORDS);
  return tokens[0] || null;
}

function cleanToken(t) {
  return String(t || '').replace(/[^a-zA-Z'\-]/g, '').trim();
}

function looksLikeNameToken(t, STOP_WORDS) {
  if (!t || t.length < 2) return false;
  if (STOP_WORDS.has(t.toLowerCase())) return false;
  return /^[A-Za-z][A-Za-z'\-]+$/.test(t);
}

function titleCase(s) {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

module.exports = { extractName };

