/**
 * ============================================================================
 * PHRASE REDUCER SERVICE — 3-Stage Phrase Intelligence Engine
 * ============================================================================
 *
 * Reduces caller phrases to routing-optimised "cores" for embedding comparison.
 *
 * ARCHITECTURE:
 *   Stage 1 — Extract protected domain phrases (bigrams/trigrams from section
 *             content preserved as units, e.g. "service call", "maintenance plan")
 *   Stage 2 — Normalize intent patterns ("how much" → "cost", "do you offer" → "availability")
 *   Stage 3 — Strip remaining stop words (preserve danger words + protected placeholders)
 *
 * OUTPUT:
 *   { raw, protectedEntities[], normalizedPatterns[], core }
 *
 * LAYERS:
 *   Layer 1 (Global)  — intentNormalizers, synonymGroups, stopWords, dangerWords
 *                        from AdminSettings.globalHub.phraseIntelligence
 *   Layer 2 (Company) — protectedPhrases auto-extracted from KC section content
 *                        at score-time (no admin setup)
 *
 * ============================================================================
 */

const logger   = require('../../utils/logger');
const AdminSettings = require('../../models/AdminSettings');

// ── In-memory config cache ──────────────────────────────────────────────────
let _cachedConfig = null;
let _cacheLoadedAt = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// ═════════════════════════════════════════════════════════════════════════════
// DEFAULT SEED DATA — used if AdminSettings has no phraseIntelligence yet
// ═════════════════════════════════════════════════════════════════════════════

const DEFAULT_INTENT_NORMALIZERS = [
  // Cost / pricing
  { pattern: 'how much does it cost', token: 'cost' },
  { pattern: 'how much do you charge', token: 'cost' },
  { pattern: 'what does it cost',     token: 'cost' },
  { pattern: 'what is the price',     token: 'cost' },
  { pattern: 'what do you charge',    token: 'cost' },
  { pattern: 'how much is',           token: 'cost' },
  { pattern: 'how much',              token: 'cost' },
  // Duration
  { pattern: 'how long does it take', token: 'duration' },
  { pattern: 'how long will it take', token: 'duration' },
  { pattern: 'how long',              token: 'duration' },
  // Urgency
  { pattern: 'how soon can you',      token: 'urgency' },
  { pattern: 'how quickly can',       token: 'urgency' },
  { pattern: 'how soon',              token: 'urgency' },
  { pattern: 'how quickly',           token: 'urgency' },
  // Frequency
  { pattern: 'how often',             token: 'frequency' },
  // Location
  { pattern: 'where do i',            token: 'location' },
  { pattern: 'where can i',           token: 'location' },
  { pattern: 'where is',              token: 'location' },
  // Schedule
  { pattern: 'when can i',            token: 'schedule' },
  { pattern: 'when do you',           token: 'schedule' },
  { pattern: 'when will',             token: 'schedule' },
  { pattern: 'when is',               token: 'schedule' },
  // Inclusions
  { pattern: 'what is included',      token: 'inclusions' },
  { pattern: 'what comes with',       token: 'inclusions' },
  { pattern: 'what do i get',         token: 'inclusions' },
  // Coverage
  { pattern: 'is it covered',         token: 'coverage' },
  { pattern: 'does it cover',         token: 'coverage' },
  { pattern: 'is that covered',       token: 'coverage' },
  // Availability
  { pattern: 'do you offer',          token: 'availability' },
  { pattern: 'do you provide',        token: 'availability' },
  { pattern: 'do you have',           token: 'availability' },
  // Requirement
  { pattern: 'do i need to',          token: 'requirement' },
  { pattern: 'what do i need',        token: 'requirement' },
  // Process
  { pattern: 'how does it work',      token: 'process' },
  { pattern: 'how do you',            token: 'process' },
  // Troubleshooting
  { pattern: "why won't",             token: 'troubleshooting' },
  { pattern: 'why does',              token: 'troubleshooting' },
  { pattern: 'why is',                token: 'troubleshooting' },
  // Contact
  { pattern: 'who do i call',         token: 'contact' },
  { pattern: 'who handles',           token: 'contact' },
  // Strip-only (verb already covers the meaning)
  { pattern: 'how do i',              token: '' },
  { pattern: 'how can i',             token: '' },
  { pattern: 'can i',                 token: '' },
  { pattern: 'may i',                 token: '' },
  { pattern: 'what is',               token: '' },
  { pattern: 'what are',              token: '' },
];

const DEFAULT_SYNONYM_GROUPS = [
  { token: 'cost',     synonyms: ['price', 'fee', 'charge', 'rate', 'pricing'] },
  { token: 'fix',      synonyms: ['repair', 'mend', 'restore'] },
  { token: 'schedule', synonyms: ['book', 'appointment', 'reserve'] },
  { token: 'cancel',   synonyms: ['stop', 'end', 'terminate', 'discontinue'] },
];

const DEFAULT_STOP_WORDS = [
  // Pronouns
  'i', 'me', 'my', 'mine', 'we', 'us', 'our', 'you', 'your', 'yours',
  'he', 'she', 'it', 'they', 'them', 'his', 'her', 'its', 'their',
  // Articles / determiners
  'a', 'an', 'the', 'this', 'that', 'these', 'those', 'some', 'any',
  // Prepositions
  'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by', 'about',
  'into', 'through', 'during', 'before', 'after', 'above', 'below',
  'between', 'under', 'over',
  // Conjunctions
  'and', 'but', 'or', 'so', 'yet', 'both', 'either', 'neither',
  // Auxiliary / copula
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'being',
  'do', 'does', 'did', 'have', 'has', 'had', 'having',
  'will', 'would', 'shall', 'should', 'may', 'might', 'can', 'could',
  // Filler
  'just', 'really', 'very', 'also', 'too', 'please', 'thanks',
  'like', 'well', 'right', 'okay', 'ok', 'um', 'uh', 'yeah',
  'gonna', 'wanna', 'gotta', 'kinda', 'sorta',
  // Misc glue
  'get', 'got', 'go', 'going', 'come', 'thing', 'things',
  'there', 'here', 'then', 'now', 'still', 'even', 'already',
];

const DEFAULT_DANGER_WORDS = [
  'not', 'no', 'never', 'none', 'nor', "don't", "doesn't", "didn't",
  "won't", "wouldn't", "can't", "cannot", "shouldn't",
  'emergency', 'urgent', 'cancel', 'refund', 'complaint',
  'without', 'instead', 'only', 'except',
];

// ═════════════════════════════════════════════════════════════════════════════
// CONFIG LOADING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Load phrase intelligence config from MongoDB (with 5-min in-memory cache).
 * Falls back to defaults if nothing is saved yet.
 */
async function _loadConfig() {
  const now = Date.now();
  if (_cachedConfig && (now - _cacheLoadedAt) < CACHE_TTL_MS) {
    return _cachedConfig;
  }

  try {
    const settings = await AdminSettings.getSettings();
    const pi = settings?.globalHub?.phraseIntelligence;

    _cachedConfig = {
      intentNormalizers: (pi?.intentNormalizers?.length > 0) ? pi.intentNormalizers : DEFAULT_INTENT_NORMALIZERS,
      synonymGroups:     (pi?.synonymGroups?.length > 0)     ? pi.synonymGroups     : DEFAULT_SYNONYM_GROUPS,
      stopWords:         (pi?.stopWords?.length > 0)         ? pi.stopWords         : DEFAULT_STOP_WORDS,
      dangerWords:       (pi?.dangerWords?.length > 0)       ? pi.dangerWords       : DEFAULT_DANGER_WORDS,
    };
    _cacheLoadedAt = now;
  } catch (err) {
    logger.warn('[PhraseReducer] Config load failed, using defaults', { error: err.message });
    _cachedConfig = {
      intentNormalizers: DEFAULT_INTENT_NORMALIZERS,
      synonymGroups:     DEFAULT_SYNONYM_GROUPS,
      stopWords:         DEFAULT_STOP_WORDS,
      dangerWords:       DEFAULT_DANGER_WORDS,
    };
    _cacheLoadedAt = now;
  }

  return _cachedConfig;
}

/** Force-refresh config cache (call after admin saves changes). */
function invalidateCache() {
  _cachedConfig  = null;
  _cacheLoadedAt = 0;
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 1 — Extract protected domain phrases from section content
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Auto-extract bigrams + trigrams from section content text.
 * These multi-word domain terms are preserved as atomic units during reduction.
 *
 * @param {string} sectionContent — the section's label + content text
 * @returns {string[]} — e.g. ["service call", "maintenance plan", "emergency repair"]
 */
function extractProtectedPhrases(sectionContent) {
  if (!sectionContent) return [];

  const words = sectionContent
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 3);

  const phrases = new Set();

  // Bigrams
  for (let i = 0; i < words.length - 1; i++) {
    const bi = `${words[i]} ${words[i + 1]}`;
    phrases.add(bi);
  }

  // Trigrams
  for (let i = 0; i < words.length - 2; i++) {
    const tri = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
    phrases.add(tri);
  }

  return [...phrases];
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 2 — Normalize intent patterns
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Apply intent normalizers to a phrase. Longest patterns match first.
 *
 * @param {string} phrase — lowercased input
 * @param {Array} normalizers — [{ pattern, token }]
 * @returns {{ text: string, applied: Array }} — text after normalizations, list of applied patterns
 */
function _normalizeIntents(phrase, normalizers) {
  // Sort by pattern length DESC so longer patterns match first
  const sorted = [...normalizers].sort((a, b) => b.pattern.length - a.pattern.length);

  let text = phrase;
  const applied = [];

  for (const { pattern, token } of sorted) {
    if (!pattern) continue;
    const idx = text.indexOf(pattern);
    if (idx !== -1) {
      // Replace the pattern with its token (or remove if token is empty)
      const replacement = token ? ` ${token} ` : ' ';
      text = text.slice(0, idx) + replacement + text.slice(idx + pattern.length);
      text = text.replace(/\s+/g, ' ').trim();
      applied.push({ pattern, token: token || '(stripped)' });
    }
  }

  return { text, applied };
}

// ═════════════════════════════════════════════════════════════════════════════
// STAGE 3 — Strip stop words (preserve danger words + protected entities)
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Strip stop words from a phrase, preserving danger words.
 *
 * @param {string} phrase
 * @param {Set<string>} stopSet
 * @param {Set<string>} dangerSet
 * @returns {string}
 */
function _stripStopWords(phrase, stopSet, dangerSet) {
  const words = phrase.split(/\s+/).filter(Boolean);
  const kept = words.filter(w => {
    const lower = w.toLowerCase();
    // Always keep danger words
    if (dangerSet.has(lower)) return true;
    // Strip if it's a stop word
    if (stopSet.has(lower)) return false;
    // Keep everything else
    return true;
  });
  return kept.join(' ').trim();
}

// ═════════════════════════════════════════════════════════════════════════════
// SYNONYM FOLDING
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Fold synonyms to their canonical token.
 *
 * @param {string} phrase
 * @param {Array} synonymGroups — [{ token, synonyms: string[] }]
 * @returns {string}
 */
function _foldSynonyms(phrase, synonymGroups) {
  // Build reverse lookup: synonym → canonical token
  const lookup = {};
  for (const { token, synonyms } of synonymGroups) {
    for (const syn of synonyms) {
      lookup[syn.toLowerCase()] = token.toLowerCase();
    }
  }

  const words = phrase.split(/\s+/);
  return words.map(w => {
    const lower = w.toLowerCase();
    return lookup[lower] || w;
  }).join(' ');
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN REDUCER — reduce()
// ═════════════════════════════════════════════════════════════════════════════

/**
 * Reduce a caller phrase to its routing-optimised core.
 *
 * @param {string}   rawPhrase       — the original caller phrase
 * @param {string}   sectionContent  — the section's label + content (for protected phrases)
 * @param {Object}   [configOverride] — optional config override (for testing)
 * @returns {Promise<{
 *   raw: string,
 *   protectedEntities: string[],
 *   normalizedPatterns: Array<{pattern: string, token: string}>,
 *   core: string
 * }>}
 */
async function reduce(rawPhrase, sectionContent, configOverride) {
  const config = configOverride || await _loadConfig();

  const raw = (rawPhrase || '').trim();
  if (!raw) return { raw: '', protectedEntities: [], normalizedPatterns: [], core: '' };

  let phrase = raw.toLowerCase().replace(/[^a-z0-9\s'-]/g, ' ').replace(/\s+/g, ' ').trim();

  // ── Stage 1: Extract + protect domain phrases ─────────────────────────
  const protectedPhrases = extractProtectedPhrases(sectionContent || '');
  const protectedEntities = [];
  const placeholders = {};
  let placeholderIdx = 0;

  // Sort by length DESC so longer phrases match first (prevents partial overlap)
  const sortedProtected = [...protectedPhrases].sort((a, b) => b.length - a.length);

  for (const pp of sortedProtected) {
    if (phrase.includes(pp)) {
      const placeholder = `__PROT${placeholderIdx}__`;
      phrase = phrase.replace(pp, placeholder);
      placeholders[placeholder] = pp;
      protectedEntities.push(pp);
      placeholderIdx++;
    }
  }

  // ── Stage 2: Normalize intent patterns ────────────────────────────────
  const { text: afterNorm, applied: normalizedPatterns } = _normalizeIntents(phrase, config.intentNormalizers);
  phrase = afterNorm;

  // ── Synonym folding ───────────────────────────────────────────────────
  phrase = _foldSynonyms(phrase, config.synonymGroups);

  // ── Stage 3: Strip stop words ─────────────────────────────────────────
  const stopSet   = new Set(config.stopWords.map(w => w.toLowerCase()));
  const dangerSet = new Set(config.dangerWords.map(w => w.toLowerCase()));
  phrase = _stripStopWords(phrase, stopSet, dangerSet);

  // ── Restore protected entities ────────────────────────────────────────
  for (const [placeholder, original] of Object.entries(placeholders)) {
    phrase = phrase.replace(placeholder, original);
  }

  // Final cleanup
  const core = phrase.replace(/\s+/g, ' ').trim();

  return { raw, protectedEntities, normalizedPatterns, core };
}

/**
 * Batch-reduce multiple phrases against the same section.
 *
 * @param {string[]} phrases
 * @param {string}   sectionContent
 * @returns {Promise<Object[]>}
 */
async function reduceBatch(phrases, sectionContent) {
  const config = await _loadConfig();
  const results = [];
  for (const p of phrases) {
    results.push(await reduce(p, sectionContent, config));
  }
  return results;
}

// ═════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═════════════════════════════════════════════════════════════════════════════

module.exports = {
  reduce,
  reduceBatch,
  extractProtectedPhrases,
  invalidateCache,
  // Exposed for seeding/admin
  DEFAULT_INTENT_NORMALIZERS,
  DEFAULT_SYNONYM_GROUPS,
  DEFAULT_STOP_WORDS,
  DEFAULT_DANGER_WORDS,
};
