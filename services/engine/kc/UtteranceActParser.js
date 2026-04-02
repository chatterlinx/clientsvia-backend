'use strict';

/**
 * ============================================================================
 * UTTERANCE ACT PARSER  (v2.0 — Semantic Section Matching)
 * ============================================================================
 *
 * PURPOSE:
 *   Zero-latency Layer 1 intent classifier. Parses a caller utterance into
 *   a ParsedUtterance with containerId + sectionIdx + confidence score
 *   using rule-based phrase matching against callerPhrases from BridgeService.
 *
 *   If Layer 1 confidence >= threshold → routes directly to KC section.
 *   If Layer 1 miss → KCDiscoveryRunner falls through to Gate 2.8 semantic
 *   then Gate 3 keyword scoring.
 *
 * PARSED UTTERANCE SCHEMA:
 *   {
 *     containerId:   string | null,  // KC container ObjectId
 *     sectionIdx:    number | null,   // index into container.sections[]
 *     sectionLabel:  string | null,   // section label for logging
 *     confidence:    number,          // 0.0–1.0
 *     matchedPhrase: string | null,   // the normalised phrase that triggered
 *     matchType:     string,          // 'EXACT' | 'PARTIAL' | 'WORD_OVERLAP' | 'NONE'
 *     topicWords:    string[],        // significant words (for Gate 3 fallback)
 *     rawInput:      string,
 *     normInput:     string,
 *   }
 *
 * CONFIDENCE THRESHOLDS:
 *   EXACT match:        0.95
 *   PARTIAL match:      0.80
 *   WORD_OVERLAP (>=3): 0.70
 *   WORD_OVERLAP (<3):  0.50
 *   NONE:               0.00
 *
 * ALGORITHM: Same 3-pass rule-based matching as v1 (EXACT → PARTIAL → WORD_OVERLAP).
 * DATA SOURCE CHANGED: v1 read UAPArrays via BridgeService. v2 reads section.callerPhrases.
 *
 * ============================================================================
 */

const BridgeService = require('./BridgeService');
const logger        = require('../../../utils/logger');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  CONFIDENCE: {
    EXACT:             0.95,
    PARTIAL:           0.80,
    WORD_OVERLAP_HIGH: 0.70,
    WORD_OVERLAP_LOW:  0.50,
    NONE:              0.00,
  },

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

  MIN_WORD_LEN: 3,
  LONG_WORD_BONUS_THRESHOLD: 7,
  LONG_WORD_BONUS_MULTIPLIER: 1.5,
};

// ============================================================================
// PARSING UTILITIES
// ============================================================================

function _normalise(str) {
  return (str || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function _extractTopicWords(normInput) {
  return normInput
    .split(/\s+/)
    .filter(w => w.length >= CONFIG.MIN_WORD_LEN && !CONFIG.STOP_WORDS.has(w));
}

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

const PHRASE_INDEX_CACHE_TTL = 60 * 60 * 1000; // 1h
const _phraseCache = new Map();

async function _getPhraseIndex(companyId) {
  const now = Date.now();
  const cached = _phraseCache.get(companyId);
  if (cached && (now - cached.builtAt) < PHRASE_INDEX_CACHE_TTL) {
    return cached.index;
  }

  const index = await BridgeService.getAllPhrases(companyId);
  _phraseCache.set(companyId, { index, builtAt: now });
  return index;
}

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
  const rawInput   = utterance || '';
  const normInput  = _normalise(rawInput);
  const topicWords = _extractTopicWords(normInput);

  const empty = {
    containerId:   null,
    sectionIdx:    null,
    sectionLabel:  null,
    confidence:    CONFIG.CONFIDENCE.NONE,
    matchedPhrase: null,
    matchType:     'NONE',
    topicWords,
    rawInput,
    normInput,
  };

  if (!companyId || !normInput) return empty;

  // ── Load phrase index ──────────────────────────────────────────────────
  let phraseIndex;
  try {
    phraseIndex = await _getPhraseIndex(companyId);
  } catch (err) {
    logger.warn('[UAP] phrase index load error — returning NONE', { companyId, err: err.message });
    return empty;
  }

  const phrases = Object.keys(phraseIndex);
  if (!phrases.length) return empty;

  // ── Pass 1: EXACT match ────────────────────────────────────────────────
  let bestExact    = null;
  let bestExactLen = 0;

  for (const phrase of phrases) {
    if (normInput.includes(phrase) && phrase.length > bestExactLen) {
      bestExact    = phrase;
      bestExactLen = phrase.length;
    }
  }

  if (bestExact) {
    const entry = phraseIndex[bestExact] || {};
    return {
      containerId:   entry.containerId  || null,
      sectionIdx:    entry.sectionIdx   ?? null,
      sectionLabel:  entry.sectionLabel || null,
      confidence:    CONFIG.CONFIDENCE.EXACT,
      matchedPhrase: bestExact,
      matchType:     'EXACT',
      topicWords,
      rawInput,
      normInput,
    };
  }

  // ── Pass 2: PARTIAL match ──────────────────────────────────────────────
  const inputWords = normInput.split(/\s+/);
  const inputSet   = new Set(inputWords);

  let bestPartial    = null;
  let bestPartialCov = 0;

  for (const phrase of phrases) {
    const pWords = phrase.split(/\s+/).filter(w => w.length >= CONFIG.MIN_WORD_LEN);
    if (pWords.length < 2) continue;

    const matchCount = pWords.filter(w => inputSet.has(w)).length;
    const coverage   = matchCount / pWords.length;

    if (coverage >= 1.0 && coverage > bestPartialCov) {
      bestPartial    = phrase;
      bestPartialCov = coverage;
    }
  }

  if (bestPartial) {
    const entry = phraseIndex[bestPartial] || {};
    return {
      containerId:   entry.containerId  || null,
      sectionIdx:    entry.sectionIdx   ?? null,
      sectionLabel:  entry.sectionLabel || null,
      confidence:    CONFIG.CONFIDENCE.PARTIAL,
      matchedPhrase: bestPartial,
      matchType:     'PARTIAL',
      topicWords,
      rawInput,
      normInput,
    };
  }

  // ── Pass 3: WORD_OVERLAP ───────────────────────────────────────────────
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

    const entry = phraseIndex[bestOverlapPhrase] || {};
    return {
      containerId:   entry.containerId  || null,
      sectionIdx:    entry.sectionIdx   ?? null,
      sectionLabel:  entry.sectionLabel || null,
      confidence,
      matchedPhrase: bestOverlapPhrase,
      matchType:     'WORD_OVERLAP',
      topicWords,
      rawInput,
      normInput,
    };
  }

  // ── NONE ───────────────────────────────────────────────────────────────
  return empty;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  parse,
  invalidatePhraseCache,
  CONFIG,
};
