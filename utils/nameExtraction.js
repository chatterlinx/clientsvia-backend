/**
 * Deterministic name extraction (no LLM, no env dependencies)
 *
 * Goals:
 * - Be conservative in DISCOVERY (avoid false positives)
 * - Be more permissive in BOOKING when we're expecting a name
 * - Handle human "noise" phrases while still extracting a clean name
 * - Be conservative with ambiguous “it’s …” phrases (trade sentences)
 *
 * NOTE: This is parsing logic, not AI behavior text.
 */

function extractName(text, { expectingName = false, customStopWords = [] } = {}) {
  if (!text || typeof text !== 'string') return null;

  const raw = text.trim();
  if (!raw) return null;

  if (isTradeContextSentence(raw)) {
    return null;
  }

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
    // Generic "noise" adjectives often present in human rambling
    'pretty', 'long', 'short', 'kinda', 'kind', 'sorta', 'sort',
    // Problem-related words (generic)
    'problem', 'problems', 'issue', 'issues', 'trouble', 'wrong', 'weird', 'strange',
    // Question words
    'any', 'some', 'with',
    // Meta-words that appear in rambling but are NOT name parts
    // (prevents false extraction like "Last Name" from "my last name is")
    'name', 'last', 'surname',
    // V37 FIX: Common words that sound like names but aren't
    // "I'm probably going to..." was being extracted as name "Probably"
    'probably', 'maybe', 'perhaps', 'possibly', 'apparently', 'actually',
    'basically', 'literally', 'honestly', 'seriously', 'obviously',
    // Filler words that STT might capitalize
    'along', 'customer', 'res', 'chance'
  ];

  const STOP_WORDS = new Set([
    ...PLATFORM_STOP_WORDS,
    ...(customStopWords || []).map(w => String(w).toLowerCase().trim()).filter(Boolean)
  ]);

  // Contextual stop-word: prevent "a little ..." from being interpreted as a surname in last-name collection.
  // IMPORTANT: We do NOT globally ban "Little" (it is a valid surname). We only suppress it in the common
  // phrase "a little <adjective>" which shows up in human rambling during booking.
  if (expectingName && /\ba\s+little\b/i.test(raw)) {
    STOP_WORDS.add('little');
  }

  // Strict patterns that indicate actual name introduction
  const strictNamePatterns = [
    /\bmy name is\b/i,
    /\bname is\b/i,
    /\bthis is\s+[A-Z]/,
    /\bi am\s+[A-Z]/,
    /\bi'?m\s+[A-Z][a-z]+(?:\s|$|,)/,
    /\bcall me\b/i
  ];
  const hasExplicitNameIntent = strictNamePatterns.some(p => p.test(raw));

  // Trade/problem guard:
  // If we are "expectingName" but the utterance is clearly about HVAC/trade context
  // and does NOT contain explicit name-intent phrases, do not extract.
  // This prevents garbage like lastName="Not" from "it's not cooling".
  const tradeWords = /\b(unit|ac|a\/c|air\s*con|air\s*condition(?:er|ing)?|cooling|not\s+cool(?:ing)?|heat|heating|furnace|thermostat|compressor|condenser|leak|leaking|drip|dripping|broken|not\s+working|stopped\s+working)\b/i;
  if (expectingName && !hasExplicitNameIntent && tradeWords.test(raw)) {
    return null;
  }

  // Gate: Only extract if expecting name OR explicit name intent
  if (!expectingName && !hasExplicitNameIntent) return null;

  if (!hasExplicitNameIntent && /^it'?s\s+\w+/i.test(raw)) {
    return null;
  }

  // Extract the post-intro clause (best-effort)
  //
  // V80 FIX: If the user has multiple "name is ..." clauses (human ramble),
  // prefer the *last* one. Example:
  // "my name is kind of complicated ... my name is Gonzalez" → "Gonzalez"
  //
  // We do this via lastIndexOf() on the normalized string (regex $-anchoring
  // is too brittle for rambling).
  const lower = raw.toLowerCase();
  const intros = [
    'my name is',
    'name is',
    'this is',
    "i'm",
    'i am',
    'call me'
  ];

  let candidate = null;
  let bestIdx = -1;
  let bestIntro = null;
  for (const intro of intros) {
    const idx = lower.lastIndexOf(intro);
    if (idx > bestIdx) {
      bestIdx = idx;
      bestIntro = intro;
    }
  }

  if (bestIdx >= 0 && bestIntro) {
    candidate = raw.slice(bestIdx + bestIntro.length).trim();
  }
  if (!candidate && expectingName) candidate = raw;
  if (!candidate) return null;

  // Special-case: caller explicitly references last name / surname in a sentence,
  // and ends with the actual last name token.
  // Example:
  // "my last name is a little complicated ... Gonzalez" → "Gonzalez"
  // This is common during last-name collection where the caller rambles.
  if (expectingName && /\b(last name|surname)\b/i.test(raw)) {
    const tailToken =
      raw.match(/\b(?:last name is|surname is)\b[\s\S]*?\b([A-Za-z][A-Za-z'\-]{1,})\s*$/i)?.[1] ||
      raw.match(/\b(last name|surname)\b[\s\S]*?\b([A-Za-z][A-Za-z'\-]{1,})\s*$/i)?.[2] ||
      null;
    const cleanedTail = cleanToken(tailToken);
    // If the caller mentioned "last name" but the tail is clearly a descriptor, don't extract junk.
    // Example: "my last name is a little complicated" → null (they haven't given the surname yet)
    const NON_NAME_TAILS = new Set([
      'complicated',
      'difficult',
      'confusing',
      'weird',
      'strange',
      'messy',
      'tricky'
    ]);
    if (cleanedTail && NON_NAME_TAILS.has(cleanedTail.toLowerCase())) {
      return null;
    }

    if (cleanedTail && !STOP_WORDS.has(cleanedTail.toLowerCase())) {
      return titleCase(cleanedTail);
    }
  }

  // Special-case: human ramble where last name is provided after a “but it’s …”
  // Example: "my name is Larry pretty long but it's Gonzalez"
  // We prefer the first meaningful token as first name + explicit tail token as last name.
  if (expectingName && hasExplicitNameIntent) {
    const lastNameFromTail =
      raw.match(/\b(?:last name is|surname is)\s+([A-Za-z][A-Za-z'\-]{1,})\b/i)?.[1] ||
      null;

    if (lastNameFromTail) {
      // Use FIRST intro clause to extract first name (human ramble often puts last name at the end).
      const firstIntroIdx = lower.indexOf('my name is');
      const firstIntroClause = firstIntroIdx >= 0 ? raw.slice(firstIntroIdx + 'my name is'.length).trim() : candidate;
      const firstToken = firstMeaningfulToken(firstIntroClause, STOP_WORDS);
      const lastToken = cleanToken(lastNameFromTail);
      if (firstToken && lastToken && !STOP_WORDS.has(lastToken.toLowerCase())) {
        // Avoid "Gonzalez Gonzalez" if the first token cannot be found and equals the last token.
        if (firstToken.toLowerCase() === lastToken.toLowerCase()) return titleCase(lastToken);
        return `${titleCase(firstToken)} ${titleCase(lastToken)}`.trim();
      }
    }
  }
  // NOTE: We intentionally do NOT use generic “it’s X” heuristics for names.
  // Those phrases are too ambiguous and frequently map to trade/problem statements.

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

function isTradeContextSentence(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  const tradeWords = [
    'unit', 'cooling', 'heat', 'heating', 'leak', 'leaking', 'ac', 'a/c',
    'system', 'compressor', 'thermostat', 'furnace', 'heater', 'evaporator',
    'condenser', 'coil', 'blower', 'filter', 'air handler', 'hvac'
  ];
  const tradeRegex = new RegExp(`\\b(${tradeWords.map(w => w.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')).join('|')})\\b`, 'i');
  return tradeRegex.test(lower);
}

module.exports = { extractName, isTradeContextSentence };

