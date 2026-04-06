'use strict';

/**
 * ============================================================================
 * UTTERANCE ACT PARSER  (v3.0 — Fuzzy Recovery)
 * ============================================================================
 *
 * PURPOSE:
 *   Zero-latency Layer 1 intent classifier. Parses a caller utterance into
 *   a ParsedUtterance with containerId + sectionIdx + confidence score
 *   using rule-based phrase matching against callerPhrases from BridgeService.
 *
 *   If Layer 1 confidence >= threshold -> routes directly to KC section.
 *   If Layer 1 miss -> KCDiscoveryRunner falls through to Gate 2.8 semantic
 *   then Gate 3 keyword scoring.
 *
 * PARSED UTTERANCE SCHEMA:
 *   {
 *     containerId:   string | null,  // KC container ObjectId
 *     sectionIdx:    number | null,   // index into container.sections[]
 *     sectionLabel:  string | null,   // section label for logging
 *     confidence:    number,          // 0.0-1.0
 *     matchedPhrase: string | null,   // the normalised phrase that triggered
 *     matchType:     string,          // 'EXACT' | 'PARTIAL' | 'WORD_OVERLAP' | 'SYNONYM' | 'FUZZY_PHONETIC' | 'NONE'
 *     anchorWords:   string[],        // normalised anchor words for the matched phrase ([] = no gate)
 *     topicWords:    string[],        // significant words extracted from utterance (for Gate 3 + Logic 2)
 *     rawInput:      string,
 *     normInput:     string,
 *   }
 *
 * 6-PASS MATCHING PIPELINE:
 *   Pass 1: EXACT         -> 0.95  (substring match of entire callerPhrase)
 *   Pass 2: PARTIAL       -> 0.80  (all phrase words found in input)
 *   Pass 3: WORD_OVERLAP  -> 0.70/0.50  (weighted word coverage)
 *   Pass 4A: SYNONYM      -> 0.75  (expand input via GlobalShare synonyms, re-run 1-3)
 *   Pass 4B: FUZZY_PHONETIC -> 0.65/0.70  (Double Metaphone phonetic matching)
 *
 * DATA SOURCE: section.callerPhrases via BridgeService (v3 — includes phoneticIndex).
 *
 * ============================================================================
 */

const BridgeService         = require('./BridgeService');
const PhraseReducerService  = require('../../phraseIntelligence/PhraseReducerService');
const { doubleMetaphone }   = require('../../../utils/stringDistance');
const logger                = require('../../../utils/logger');

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
  CONFIDENCE: {
    EXACT:             0.95,
    PARTIAL:           0.80,
    SYNONYM:           0.75,
    WORD_OVERLAP_HIGH: 0.70,
    PHONETIC_HIGH:     0.70,
    PHONETIC_LOW:      0.65,
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
// CORE MATCHING — Passes 1-3 extracted for reuse by synonym expansion
// ============================================================================

/**
 * _runPasses — Execute EXACT / PARTIAL / WORD_OVERLAP against a normalised input.
 * Returns { phrase, confidence, matchType } or null.
 */
function _runPasses(normInput, phrases, phraseIndex) {
  // ── Pass 1: EXACT match ──────────────────────────────────────────────
  let bestExact    = null;
  let bestExactLen = 0;

  for (const phrase of phrases) {
    if (normInput.includes(phrase) && phrase.length > bestExactLen) {
      bestExact    = phrase;
      bestExactLen = phrase.length;
    }
  }

  if (bestExact) {
    return { phrase: bestExact, confidence: CONFIG.CONFIDENCE.EXACT, matchType: 'EXACT' };
  }

  // ── Pass 2: PARTIAL match ────────────────────────────────────────────
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
    return { phrase: bestPartial, confidence: CONFIG.CONFIDENCE.PARTIAL, matchType: 'PARTIAL' };
  }

  // ── Pass 3: WORD_OVERLAP ─────────────────────────────────────────────
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
    return { phrase: bestOverlapPhrase, confidence, matchType: 'WORD_OVERLAP' };
  }

  return null;
}

// ============================================================================
// PASS 4A — SYNONYM EXPANSION
// ============================================================================

/**
 * Expand input words using synonym groups (synonym -> canonical token).
 * Returns the expanded string, or the same string if no synonyms matched.
 */
function _applySynonyms(normInput, synonymGroups) {
  // Build reverse lookup: synonym -> canonical token
  const lookup = {};
  for (const { token, synonyms } of synonymGroups) {
    const canonical = (token || '').toLowerCase();
    for (const syn of (synonyms || [])) {
      lookup[syn.toLowerCase()] = canonical;
    }
  }

  const words = normInput.split(/\s+/);
  const expanded = words.map(w => lookup[w] || w);
  return expanded.join(' ');
}

// ============================================================================
// PASS 4B — PHONETIC MATCHING
// ============================================================================

/**
 * Score caller input against phoneticIndex via Double Metaphone.
 * Returns { phrase, overlapScore } or null.
 */
function _phoneticMatch(inputWords, phoneticIndex) {
  const sigWords = inputWords.filter(w => w.length >= CONFIG.MIN_WORD_LEN && !CONFIG.STOP_WORDS.has(w));
  if (sigWords.length === 0) return null;

  // Collect candidate phrases via phonetic code lookup
  const candidateScores = {}; // { phrase: { matched, total } }

  for (const word of sigWords) {
    const [primary, alternate] = doubleMetaphone(word);
    const candidates = new Set();

    if (primary && phoneticIndex[primary]) {
      for (const rec of phoneticIndex[primary]) candidates.add(rec.phrase);
    }
    if (alternate && alternate !== primary && phoneticIndex[alternate]) {
      for (const rec of phoneticIndex[alternate]) candidates.add(rec.phrase);
    }

    for (const phrase of candidates) {
      if (!candidateScores[phrase]) {
        const phraseWords = phrase.split(/\s+/).filter(w => w.length >= CONFIG.MIN_WORD_LEN && !CONFIG.STOP_WORDS.has(w));
        candidateScores[phrase] = { matched: 0, total: phraseWords.length || 1 };
      }
      candidateScores[phrase].matched++;
    }
  }

  // Find best overlap
  let bestPhrase = null;
  let bestScore  = 0;

  for (const [phrase, { matched, total }] of Object.entries(candidateScores)) {
    const score = matched / total;
    if (score > bestScore) {
      bestScore  = score;
      bestPhrase = phrase;
    }
  }

  if (bestPhrase && bestScore > 0) {
    return { phrase: bestPhrase, overlapScore: bestScore };
  }
  return null;
}

// ============================================================================
// PER-CALL CACHES (phrase index + phonetic index)
// ============================================================================

const PHRASE_INDEX_CACHE_TTL = 60 * 60 * 1000; // 1h
const _phraseCache   = new Map();
const _phoneticCache = new Map();

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

async function _getPhoneticIndex(companyId) {
  const now = Date.now();
  const cached = _phoneticCache.get(companyId);
  if (cached && (now - cached.builtAt) < PHRASE_INDEX_CACHE_TTL) {
    return cached.index;
  }

  const index = await BridgeService.getAllPhonetics(companyId);
  _phoneticCache.set(companyId, { index, builtAt: now });
  return index;
}

function invalidatePhraseCache(companyId) {
  if (companyId) {
    _phraseCache.delete(companyId);
    _phoneticCache.delete(companyId);
  } else {
    _phraseCache.clear();
    _phoneticCache.clear();
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

  // ══════════════════════════════════════════════════════════════════════
  // Passes 1-3: EXACT / PARTIAL / WORD_OVERLAP
  // ══════════════════════════════════════════════════════════════════════
  const hit = _runPasses(normInput, phrases, phraseIndex);
  if (hit) {
    const entry = phraseIndex[hit.phrase] || {};
    return {
      containerId:   entry.containerId  || null,
      sectionIdx:    entry.sectionIdx   ?? null,
      sectionLabel:  entry.sectionLabel || null,
      anchorWords:   entry.anchorWords   || [],
      confidence:    hit.confidence,
      matchedPhrase: hit.phrase,
      matchType:     hit.matchType,
      topicWords,
      rawInput,
      normInput,
    };
  }

  // ══════════════════════════════════════════════════════════════════════
  // Pass 4A: SYNONYM EXPANSION — re-run passes 1-3 on expanded input
  // ══════════════════════════════════════════════════════════════════════
  try {
    const synonymGroups = await PhraseReducerService.getSynonymGroups();
    if (synonymGroups.length > 0) {
      const expandedInput = _applySynonyms(normInput, synonymGroups);
      if (expandedInput !== normInput) {
        const synHit = _runPasses(expandedInput, phrases, phraseIndex);
        if (synHit) {
          const entry = phraseIndex[synHit.phrase] || {};
          return {
            containerId:   entry.containerId  || null,
            sectionIdx:    entry.sectionIdx   ?? null,
            sectionLabel:  entry.sectionLabel || null,
            anchorWords:   entry.anchorWords   || [],
            confidence:    CONFIG.CONFIDENCE.SYNONYM,
            matchedPhrase: synHit.phrase,
            matchType:     'SYNONYM',
            topicWords,
            rawInput,
            normInput,
          };
        }
      }
    }
  } catch (_synErr) {
    logger.debug('[UAP] Synonym expansion error', { companyId, err: _synErr.message });
  }

  // ══════════════════════════════════════════════════════════════════════
  // Pass 4B: PHONETIC MATCHING — Double Metaphone fuzzy recovery
  // ══════════════════════════════════════════════════════════════════════
  try {
    const phoneticIndex = await _getPhoneticIndex(companyId);
    if (Object.keys(phoneticIndex).length > 0) {
      const inputWords = normInput.split(/\s+/);
      const phonHit = _phoneticMatch(inputWords, phoneticIndex);
      if (phonHit) {
        const entry = phraseIndex[phonHit.phrase] || {};
        const confidence = phonHit.overlapScore >= 0.5
          ? CONFIG.CONFIDENCE.PHONETIC_HIGH
          : CONFIG.CONFIDENCE.PHONETIC_LOW;
        return {
          containerId:   entry.containerId  || null,
          sectionIdx:    entry.sectionIdx   ?? null,
          sectionLabel:  entry.sectionLabel || null,
          anchorWords:   entry.anchorWords   || [],
          confidence,
          matchedPhrase: phonHit.phrase,
          matchType:     'FUZZY_PHONETIC',
          topicWords,
          rawInput,
          normInput,
        };
      }
    }
  } catch (_phErr) {
    logger.debug('[UAP] Phonetic match error', { companyId, err: _phErr.message });
  }

  // ── NONE ─────────────────────────────────────────────────────────────
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
