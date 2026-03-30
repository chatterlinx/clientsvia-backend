'use strict';

/**
 * ============================================================================
 * UTTERANCE ACT PARSER  (v1.0 — Build Step 6)
 * ============================================================================
 *
 * PURPOSE:
 *   Zero-latency Layer 1 intent classifier. Parses a caller utterance into
 *   a ParsedUtterance with a daType (intent category) + confidence score
 *   using rule-based phrase matching against the company's Bridge index.
 *
 *   If Layer 1 confidence ≥ threshold → routes directly to KC container via Bridge.
 *   If Layer 1 miss → KCDiscoveryRunner falls through to Gate 3 keyword scoring.
 *
 * ARCHITECTURE:
 *
 *   Caller utterance
 *     │
 *     ├─ Layer 1 (THIS FILE):
 *     │    Rule-based phrase matching against Bridge.getAllPhrases(companyId)
 *     │    ~0ms — pure in-memory string ops after Bridge is loaded (~1ms Redis)
 *     │    Confidence scoring: exact phrase > partial phrase > word-overlap
 *     │    Target: ~80% hit rate on real calls (calibration from first 500 calls)
 *     │
 *     └─ Layer 2 (future — G5):
 *          Groq semantic fallback when Layer 1 confidence < threshold
 *          Not built yet — KCDiscoveryRunner falls through to keyword scoring
 *
 * PARSED UTTERANCE SCHEMA:
 *   {
 *     daType:        string | null,  // 'PRICING_QUERY', 'AVAILABILITY_QUERY', etc.
 *     daSubTypeKey:  string | null,  // 'FINANCING', 'WARRANTY' etc. — maps to section.daSubTypeKey
 *     confidence:    number,         // 0.0–1.0
 *     matchedPhrase: string | null,  // the exact phrase that triggered the match
 *     matchType:     string,         // 'EXACT' | 'PARTIAL' | 'WORD_OVERLAP' | 'NONE'
 *     topicWords:    string[],       // significant words from utterance (for Gate 3 fallback)
 *     rawInput:      string,         // original utterance
 *     normInput:     string,         // lowercased, punctuation-stripped
 *   }
 *
 * CONFIDENCE THRESHOLDS (G12 — UAP confidence ≥ 0.8 wins, else SPFUQ holds):
 *   EXACT match:        0.95
 *   PARTIAL match:      0.80
 *   WORD_OVERLAP (≥3):  0.70
 *   WORD_OVERLAP (<3):  0.50
 *   NONE:               0.00
 *
 * MULTI-TENANT SAFETY:
 *   All phrase lookups are scoped to companyId via BridgeService.
 *
 * GRACEFUL DEGRADE:
 *   Bridge unavailable → returns {daType: null, confidence: 0, matchType: 'NONE'}
 *   Call continues through Gate 3 keyword scoring — no crash.
 *
 * DIAGNOSTICS:
 *   Every parse result is logged to qaLog[] via _writeDiscoveryNotes in KCDiscoveryRunner.
 *   First 500 real calls = calibration data. Do NOT optimize prematurely.
 *
 * ============================================================================
 */

const BridgeService = require('./BridgeService');
const logger        = require('../../../utils/logger');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  // Confidence thresholds — from G12 design decision
  CONFIDENCE: {
    EXACT:             0.95,  // Full phrase match
    PARTIAL:           0.80,  // Contains the trigger phrase as a substring
    WORD_OVERLAP_HIGH: 0.70,  // ≥3 significant words overlap
    WORD_OVERLAP_LOW:  0.50,  // 1-2 significant words overlap
    NONE:              0.00,
  },

  // Words excluded from word-overlap scoring (too generic to be signal)
  STOP_WORDS: new Set([
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'it', 'its', 'that', 'this',
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'could',
    'should', 'may', 'might', 'can', 'to', 'for', 'of', 'on', 'in', 'at',
    'by', 'with', 'about', 'and', 'or', 'but', 'so', 'if', 'when', 'what',
    'how', 'why', 'who', 'where', 'tell', 'know', 'get', 'want', 'need',
    'help', 'more', 'just', 'please', 'yes', 'no', 'okay', 'yeah', 'hi',
    'hello', 'there', 'here',
  ]),

  // Minimum word length to consider in overlap scoring
  MIN_WORD_LEN: 3,

  // Score multiplier for longer words (rare words carry more signal)
  LONG_WORD_BONUS_THRESHOLD: 7,  // words > 7 chars get a bonus
  LONG_WORD_BONUS_MULTIPLIER: 1.5,
};

// ============================================================================
// PARSING UTILITIES
// ============================================================================

/**
 * _normalise — Lowercase + strip punctuation (keep spaces and alphanumeric).
 */
function _normalise(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * _extractTopicWords — Significant words for Gate 3 fallback / diagnostics.
 * Removes stop words and very short words.
 */
function _extractTopicWords(normInput) {
  return normInput
    .split(/\s+/)
    .filter(w => w.length >= CONFIG.MIN_WORD_LEN && !CONFIG.STOP_WORDS.has(w));
}

/**
 * _wordOverlapScore — Score how many significant words from phrase appear in utterance.
 * Returns a 0–1 score weighted by word length (longer = more specific = higher weight).
 */
function _wordOverlapScore(phraseWords, inputWords) {
  if (!phraseWords.length || !inputWords.length) return 0;

  const inputSet = new Set(inputWords);
  let totalWeight = 0;
  let matchWeight = 0;

  for (const word of phraseWords) {
    if (word.length < CONFIG.MIN_WORD_LEN || CONFIG.STOP_WORDS.has(word)) continue;
    const weight = word.length > CONFIG.LONG_WORD_BONUS_THRESHOLD
      ? CONFIG.LONG_WORD_BONUS_MULTIPLIER
      : 1;
    totalWeight += weight;
    if (inputSet.has(word)) matchWeight += weight;
  }

  return totalWeight > 0 ? matchWeight / totalWeight : 0;
}

// ============================================================================
// PER-CALL PHRASE INDEX CACHE
// ============================================================================
// The Bridge phrase index is loaded once per call (stored on state object)
// and reused for every turn. Loading it fresh each turn would add ~1ms Redis
// latency per turn unnecessarily.

const PHRASE_INDEX_CACHE_TTL = 60 * 60 * 1000; // 1h in ms (gc stale entries)
const _phraseCache = new Map();  // companyId → { index, builtAt }

async function _getPhraseIndex(companyId) {
  const now = Date.now();

  // Check in-process cache first (fastest path — same process instance)
  const cached = _phraseCache.get(companyId);
  if (cached && (now - cached.builtAt) < PHRASE_INDEX_CACHE_TTL) {
    return cached.index;
  }

  // Load from BridgeService (Redis + DB fallback)
  const index = await BridgeService.getAllPhrases(companyId);
  _phraseCache.set(companyId, { index, builtAt: now });
  return index;
}

/**
 * invalidatePhraseCache — Called by BridgeService.invalidate() propagation.
 * Ensures in-process cache doesn't serve stale phrases after UAP/KC update.
 */
function invalidatePhraseCache(companyId) {
  if (companyId) {
    _phraseCache.delete(companyId);
  } else {
    _phraseCache.clear();
  }
}

// ============================================================================
// MAIN PARSER
// ============================================================================

/**
 * parse — Layer 1 utterance classification.
 *
 * @param {string} companyId
 * @param {string} utterance   — raw caller utterance
 * @returns {Promise<ParsedUtterance>}
 */
async function parse(companyId, utterance) {
  const rawInput  = utterance || '';
  const normInput = _normalise(rawInput);
  const topicWords = _extractTopicWords(normInput);

  const empty = {
    daType:        null,
    daSubTypeKey:  null,
    confidence:    CONFIG.CONFIDENCE.NONE,
    matchedPhrase: null,
    matchType:     'NONE',
    topicWords,
    rawInput,
    normInput,
  };

  if (!companyId || !normInput) return empty;

  // ── Load phrase index ────────────────────────────────────────────────────
  let phraseIndex;
  try {
    phraseIndex = await _getPhraseIndex(companyId);
  } catch (err) {
    logger.warn('[UAP] phrase index load error — returning NONE', { companyId, err: err.message });
    return empty;
  }

  const phrases = Object.keys(phraseIndex);
  if (!phrases.length) return empty;

  // ── Pass 1: EXACT match ──────────────────────────────────────────────────
  // Full phrase appears verbatim (normalised) in the utterance.
  // Longer phrase wins ties (more specific = higher confidence).
  let bestExact      = null;
  let bestExactLen   = 0;

  for (const phrase of phrases) {
    if (normInput.includes(phrase) && phrase.length > bestExactLen) {
      bestExact    = phrase;
      bestExactLen = phrase.length;
    }
  }

  if (bestExact) {
    const _entry = phraseIndex[bestExact] || {};
    return {
      daType:        _entry.daType        || null,
      daSubTypeKey:  _entry.daSubTypeKey  || null,
      confidence:    CONFIG.CONFIDENCE.EXACT,
      matchedPhrase: bestExact,
      matchType:     'EXACT',
      topicWords,
      rawInput,
      normInput,
    };
  }

  // ── Pass 2: PARTIAL match ────────────────────────────────────────────────
  // Utterance contains all words of the phrase but not necessarily contiguous.
  // Only consider phrases with ≥ 2 words (single-word partial = too noisy).
  const inputWords = normInput.split(/\s+/);
  const inputSet   = new Set(inputWords);

  let bestPartial     = null;
  let bestPartialCov  = 0;  // word coverage ratio

  for (const phrase of phrases) {
    const pWords = phrase.split(/\s+/).filter(w => w.length >= CONFIG.MIN_WORD_LEN);
    if (pWords.length < 2) continue;  // single-word phrases → word-overlap only

    const matchCount = pWords.filter(w => inputSet.has(w)).length;
    const coverage   = matchCount / pWords.length;

    // Full word coverage AND utterance length close to phrase length (not too diluted)
    if (coverage >= 1.0 && coverage > bestPartialCov) {
      bestPartial    = phrase;
      bestPartialCov = coverage;
    }
  }

  if (bestPartial) {
    const _entry = phraseIndex[bestPartial] || {};
    return {
      daType:        _entry.daType        || null,
      daSubTypeKey:  _entry.daSubTypeKey  || null,
      confidence:    CONFIG.CONFIDENCE.PARTIAL,
      matchedPhrase: bestPartial,
      matchType:     'PARTIAL',
      topicWords,
      rawInput,
      normInput,
    };
  }

  // ── Pass 3: WORD_OVERLAP ─────────────────────────────────────────────────
  // Significant word overlap between utterance and trigger phrase.
  // Used as a soft signal — lower confidence, triggers Gate 3 to confirm.

  let bestOverlapPhrase = null;
  let bestOverlapScore  = 0;

  for (const phrase of phrases) {
    const pWords = phrase.split(/\s+/);
    const score  = _wordOverlapScore(pWords, inputWords);
    if (score > bestOverlapScore) {
      bestOverlapScore  = score;
      bestOverlapPhrase = phrase;
    }
  }

  if (bestOverlapScore > 0) {
    const confidence = bestOverlapScore >= 0.5
      ? CONFIG.CONFIDENCE.WORD_OVERLAP_HIGH
      : CONFIG.CONFIDENCE.WORD_OVERLAP_LOW;

    const _entry = phraseIndex[bestOverlapPhrase] || {};
    return {
      daType:        _entry.daType        || null,
      daSubTypeKey:  _entry.daSubTypeKey  || null,
      confidence,
      matchedPhrase: bestOverlapPhrase,
      matchType:     'WORD_OVERLAP',
      topicWords,
      rawInput,
      normInput,
    };
  }

  // ── NONE — no match ──────────────────────────────────────────────────────
  return empty;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  parse,
  invalidatePhraseCache,
  CONFIG,  // exported for tests and calibration diagnostics
};
