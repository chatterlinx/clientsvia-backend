/**
 * ============================================================================
 * TRIGGER CARD MATCHER (V3 - Word-Based Matching + Greeting Protection)
 * ============================================================================
 *
 * Deterministic, keyword/phrase-based matching for Agent 2.0 Discovery.
 * Replaces unreliable scenario search with predictable, UI-controlled rules.
 *
 * Design Principles:
 * - Zero LLM dependency — pure string matching
 * - Transparent matching — every decision is logged
 * - Priority-based — higher priority cards evaluated first
 * - Negative keywords — explicit exclusions prevent false positives
 * - GREETING PROTECTION — single-word greetings never hijack real intent
 *
 * Matching Logic (in order):
 * 1. Check if card is enabled
 * 2. Check negative keywords — if ANY match, skip this card
 * 3. Check keywords (WORD-BASED) — ALL words in keyword must appear in input
 *    - GREETING PROTECTION: Single-word greeting keywords ONLY match if the
 *      utterance is JUST that greeting (max 4 words total)
 * 4. Check phrases (SUBSTRING) — exact phrase must appear in input
 * 5. First matching card (by priority) wins
 *
 * WORD-BASED MATCHING (V2):
 * Keywords now use flexible word matching. All words in the keyword must
 * appear in the input, but they can have other words in between.
 *
 * Example:
 *   Keyword: "thermostat blank"
 *   Input: "my thermostat is blank right now" → ✅ MATCH (both words found)
 *   Input: "the blank form" → ❌ NO MATCH (missing "thermostat")
 *
 * GREETING PROTECTION (V3):
 * Single-word greeting keywords ("hi", "hello", "hey", etc.) will ONLY match
 * if the entire utterance is short (≤4 words). This prevents "hi" from matching
 * "Hi, my AC isn't cooling" — that's a real problem, not a greeting.
 *
 * Example:
 *   Keyword: "hi"
 *   Input: "hi" → ✅ MATCH (greeting-only utterance)
 *   Input: "hi there" → ✅ MATCH (short, still greeting-like)
 *   Input: "hi my ac is not cooling" → ❌ NO MATCH (real intent present)
 *
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const { Agent2IntentPriorityGate } = require('./Agent2IntentPriorityGate');

// ────────────────────────────────────────────────────────────────────────────
// GREETING PROTECTION CONSTANTS
// ────────────────────────────────────────────────────────────────────────────
// Single-word greetings like "hi", "hello" should ONLY match if the utterance
// is JUST a greeting. This prevents hijacking real intent like:
//   "Hi, my AC isn't cooling" → should NOT match greeting card
//
// Strategy: If keyword is a single greeting word, require utterance ≤ MAX_GREETING_WORDS

const GREETING_WORDS = new Set([
  'hi', 'hello', 'hey', 'howdy', 'yo', 'sup', 'greetings',
  'morning', 'afternoon', 'evening'
]);

// If the keyword is a greeting word and input has MORE than this many words,
// the greeting keyword will NOT match (prevents hijacking)
const MAX_GREETING_WORDS = 4;

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

function safeArr(v) {
  return Array.isArray(v) ? v : (v ? [v] : []);
}

function normalizeText(text) {
  return `${text || ''}`.toLowerCase().trim();
}

function clip(text, n) {
  return `${text || ''}`.substring(0, n);
}

/**
 * Extract words from text (letters, numbers, apostrophes only).
 * Filters out empty strings and very short words.
 */
function extractWords(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9'\s]/g, ' ')  // Keep letters, numbers, apostrophes
    .split(/\s+/)
    .filter(w => w.length > 0);
}

/**
 * Check if keyword is a single greeting word that needs protection.
 */
function isSingleGreetingWord(keyword) {
  const words = extractWords(keyword);
  if (words.length !== 1) return false;
  return GREETING_WORDS.has(words[0]);
}

/**
 * Check if input is short enough to be a greeting-only utterance.
 */
function isGreetingOnlyUtterance(input) {
  const words = extractWords(input);
  return words.length <= MAX_GREETING_WORDS;
}

/**
 * Word-based matching: ALL words in the keyword must appear in the input.
 * Words can have other words in between — flexible natural language matching.
 *
 * GREETING PROTECTION: If keyword is a single greeting word (hi, hello, etc.),
 * it will ONLY match if the utterance is short (≤4 words). This prevents
 * greeting keywords from hijacking real intent.
 *
 * @param {string} input - The caller's utterance (normalized)
 * @param {string} keyword - The keyword to match (normalized)
 * @returns {{ matches: boolean, blocked: string|null }} - Match result with block reason
 */
function matchesAllWords(input, keyword) {
  const inputWords = new Set(extractWords(input));
  const keywordWords = extractWords(keyword);
  
  // All keyword words must be present in input
  if (keywordWords.length === 0) return { matches: false, blocked: null };
  
  const allWordsFound = keywordWords.every(kw => inputWords.has(kw));
  if (!allWordsFound) return { matches: false, blocked: null };
  
  // GREETING PROTECTION: Block single greeting words if utterance is too long
  if (isSingleGreetingWord(keyword) && !isGreetingOnlyUtterance(input)) {
    return { 
      matches: false, 
      blocked: 'GREETING_PROTECTION' 
    };
  }
  
  return { matches: true, blocked: null };
}

/**
 * Substring matching: exact phrase must appear in input.
 * Used for phrases where word order matters.
 *
 * @param {string} input - The caller's utterance (normalized)
 * @param {string} phrase - The phrase to match (normalized)
 * @returns {boolean} - True if phrase is substring of input
 */
function matchesSubstring(input, phrase) {
  return input.includes(phrase);
}

// ────────────────────────────────────────────────────────────────────────────
// MATCH RESULT STRUCTURE
// ────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} TriggerMatchResult
 * @property {boolean} matched - Whether a card matched
 * @property {Object|null} card - The matched card (or null)
 * @property {string|null} matchType - 'KEYWORD' | 'PHRASE' | null
 * @property {string|null} matchedOn - The specific keyword/phrase that matched
 * @property {string|null} cardId - ID of matched card
 * @property {string|null} cardLabel - Label of matched card
 * @property {Array} evaluated - Debug info for all cards evaluated
 * @property {number} totalCards - Total cards in pool
 * @property {number} enabledCards - Cards that were enabled
 * @property {number} negativeBlocked - Cards blocked by negative keywords
 */

// ────────────────────────────────────────────────────────────────────────────
// TRIGGER CARD MATCHER CLASS
// ────────────────────────────────────────────────────────────────────────────

// ────────────────────────────────────────────────────────────────────────────
// HINT-TO-CARD MAPPING (for vocabulary boost system)
// ────────────────────────────────────────────────────────────────────────────
// Maps vocabulary hints (e.g., "maybe_thermostat") to card categories that
// should be boosted in priority when those hints are active.
// This allows soft hints to influence matching without forcing wrong matches.
const HINT_TO_CARD_BOOST_MAP = {
  'maybe_thermostat': ['thermostat', 'tstat', 'display', 'screen', 'temperature'],
  'maybe_outdoor_unit': ['outdoor', 'outside', 'condenser', 'compressor', 'unit outside'],
  'maybe_air_handler': ['air handler', 'indoor unit', 'attic', 'blower', 'furnace']
};

// Priority boost applied when a hint matches (lower = higher priority)
const HINT_BOOST_AMOUNT = -5;

class TriggerCardMatcher {
  /**
   * Match caller input against a list of trigger cards.
   *
   * @param {string} inputText - The caller's utterance
   * @param {Array} cards - Array of trigger card objects
   * @param {Object} options - Optional matching options
   * @param {Array<string>} options.hints - Active vocabulary hints (e.g., ["maybe_thermostat"])
   * @param {Object} options.locks - Active component locks (e.g., { component: "thermostat" })
   * @param {Object} options.intentGateConfig - UI config for Intent Priority Gate
   * @param {Array<string>} options.globalNegativeKeywords - Global negatives that block ALL cards
   * @returns {TriggerMatchResult}
   */
  static match(inputText, cards, options = {}) {
    const input = normalizeText(inputText);
    const cardList = safeArr(cards);
    const hints = safeArr(options.hints || []);
    const locks = options.locks && typeof options.locks === 'object' ? options.locks : {};
    const intentGateConfig = options.intentGateConfig || {};
    const globalNegativeKeywords = safeArr(options.globalNegativeKeywords || [])
      .map(normalizeText)
      .filter(Boolean);
    
    // ════════════════════════════════════════════════════════════════════════
    // 🔍 SCRABENGINE INTEGRATION - Use expanded tokens for flexible matching
    // ════════════════════════════════════════════════════════════════════════
    const expandedTokens = safeArr(options.expandedTokens || []);
    const originalTokens = safeArr(options.originalTokens || []);
    const expansionMap = options.expansionMap || {};
    const useExpandedTokens = expandedTokens.length > 0;
    
    // Create enhanced input text that includes expanded tokens
    // This allows matching against synonyms WITHOUT replacing original words
    const enhancedInput = useExpandedTokens 
      ? `${input} ${expandedTokens.join(' ')}`  // Original + expanded tokens
      : input;

    const result = {
      matched: false,
      card: null,
      matchType: null,
      matchedOn: null,
      cardId: null,
      cardLabel: null,
      evaluated: [],
      totalCards: cardList.length,
      enabledCards: 0,
      negativeBlocked: 0,
      intentGateBlocked: 0,
      globalNegativeBlocked: false,
      globalNegativeHit: null,
      hintBoostApplied: false,
      lockBoostApplied: false,
      intentGateResult: null,
      // ScrabEngine integration metadata
      scrabEngineUsed: useExpandedTokens,
      originalTokenCount: originalTokens.length,
      expandedTokenCount: expandedTokens.length,
      expansionsApplied: Object.keys(expansionMap).length
    };

    if (!input) {
      logger.debug('[TriggerCardMatcher] Empty input, no match');
      return result;
    }

    if (cardList.length === 0) {
      logger.debug('[TriggerCardMatcher] No cards to match against');
      return result;
    }
    
    // ─────────────────────────────────────────────────────────────────────────
    // V4: GLOBAL NEGATIVE KEYWORDS - Block ALL cards if any match
    // ─────────────────────────────────────────────────────────────────────────
    // Check global negatives FIRST. If any match, no cards will be evaluated.
    // This prevents spam, job seekers, etc. from triggering any card.
    if (globalNegativeKeywords.length > 0) {
      const globalHit = globalNegativeKeywords.find((gnk) => matchesAllWords(input, gnk).matches);
      if (globalHit) {
        result.globalNegativeBlocked = true;
        result.globalNegativeHit = globalHit;
        logger.info('[TriggerCardMatcher] Global negative keyword blocked all cards', {
          globalNegativeHit: globalHit,
          inputPreview: clip(input, 60)
        });
        return result;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTENT PRIORITY GATE (V4): Detect service-down/emergency intent
    // ─────────────────────────────────────────────────────────────────────────
    // Run BEFORE card matching. If service-down detected, FAQ/sales cards
    // get disqualified or heavily penalized to prevent false positives.
    let gateResult = null;
    if (intentGateConfig.enabled !== false) {
      gateResult = Agent2IntentPriorityGate.evaluate(input, intentGateConfig);
      result.intentGateResult = gateResult;
      
      if (gateResult.serviceDownDetected) {
        logger.info('[TriggerCardMatcher] Intent gate detected service-down', {
          urgencyScore: gateResult.urgencyScore,
          isEmergency: gateResult.emergencyDetected,
          matchedPatterns: gateResult.matchedPatterns.length,
          disqualifiedCategories: gateResult.disqualifiedCategories.length
        });
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // PRIORITY ADJUSTMENT: Apply hint/lock boosts before sorting
    // ─────────────────────────────────────────────────────────────────────────
    // If hints are active (e.g., "maybe_thermostat"), boost priority of cards
    // that match those hint categories. This makes them more likely to match.
    // If a lock is active (user confirmed via clarifier), boost even more.
    const boostedCards = cardList.map(card => {
      let effectivePriority = typeof card.priority === 'number' ? card.priority : 100;
      let boostReasons = [];
      let gateInfo = null;
      
      // Apply Intent Gate penalties/disqualification
      if (gateResult && gateResult.serviceDownDetected) {
        const gateCheck = Agent2IntentPriorityGate.checkCard(card, gateResult);
        if (gateCheck.disqualified) {
          gateInfo = { disqualified: true, reason: gateCheck.reason };
        } else if (gateCheck.penalty > 0) {
          effectivePriority += gateCheck.penalty;
          boostReasons.push(`gate_penalty:${gateCheck.penalty}`);
          gateInfo = { penalty: gateCheck.penalty, reason: gateCheck.reason };
        }
      }
      
      // Check for lock-based boost (strongest)
      if (locks.component) {
        const cardIdLower = (card.id || '').toLowerCase();
        const cardLabelLower = (card.label || '').toLowerCase();
        const lockLower = locks.component.toLowerCase();
        
        if (cardIdLower.includes(lockLower) || cardLabelLower.includes(lockLower)) {
          effectivePriority += HINT_BOOST_AMOUNT * 2; // Double boost for locked
          boostReasons.push(`lock:${locks.component}`);
          result.lockBoostApplied = true;
        }
      }
      
      // Check for hint-based boost
      for (const hint of hints) {
        const boostKeywords = HINT_TO_CARD_BOOST_MAP[hint] || [];
        const cardIdLower = (card.id || '').toLowerCase();
        const cardLabelLower = (card.label || '').toLowerCase();
        const cardKeywords = safeArr(card.match?.keywords).map(k => normalizeText(k));
        
        const matchesHint = boostKeywords.some(bk => 
          cardIdLower.includes(bk) || 
          cardLabelLower.includes(bk) ||
          cardKeywords.some(ck => ck.includes(bk))
        );
        
        if (matchesHint) {
          effectivePriority += HINT_BOOST_AMOUNT;
          boostReasons.push(`hint:${hint}`);
          result.hintBoostApplied = true;
        }
      }
      
      return {
        ...card,
        _effectivePriority: effectivePriority,
        _boostReasons: boostReasons,
        _gateInfo: gateInfo
      };
    });

    // Sort by effective priority (lower number = higher priority)
    const sorted = [...boostedCards].sort((a, b) => {
      return a._effectivePriority - b._effectivePriority;
    });

    for (const card of sorted) {
      const cardEval = {
        cardId: card.id || null,
        cardLabel: card.label || null,
        priority: typeof card.priority === 'number' ? card.priority : 100,
        effectivePriority: card._effectivePriority || (typeof card.priority === 'number' ? card.priority : 100),
        boostReasons: card._boostReasons || [],
        gateInfo: card._gateInfo || null,
        enabled: card.enabled !== false,
        skipped: false,
        skipReason: null,
        negativeHit: null,
        keywordHit: null,
        phraseHit: null,
        greetingBlocked: null,
        intentGateBlocked: false,
        matched: false
      };

      // Skip disabled cards
      if (card.enabled === false) {
        cardEval.skipped = true;
        cardEval.skipReason = 'DISABLED';
        result.evaluated.push(cardEval);
        continue;
      }

      result.enabledCards++;
      
      // V4: Skip cards disqualified by Intent Gate (emergency mode)
      if (card._gateInfo && card._gateInfo.disqualified) {
        cardEval.skipped = true;
        cardEval.skipReason = 'INTENT_GATE_DISQUALIFIED';
        cardEval.intentGateBlocked = true;
        result.intentGateBlocked++;
        result.evaluated.push(cardEval);
        logger.debug('[TriggerCardMatcher] Card disqualified by Intent Gate', {
          cardId: card.id,
          reason: card._gateInfo.reason
        });
        continue;
      }

      // ─────────────────────────────────────────────────────────────────────
      // NEGATIVE KEYWORDS (word-based) — if ALL words found, block this card
      // ─────────────────────────────────────────────────────────────────────
      const negKeywords = safeArr(card.match?.negativeKeywords)
        .map(normalizeText)
        .filter(Boolean);

      const negativeHit = negKeywords.find((nk) => matchesAllWords(input, nk).matches);
      if (negativeHit) {
        cardEval.negativeHit = negativeHit;
        cardEval.skipped = true;
        cardEval.skipReason = 'NEGATIVE_KEYWORD';
        result.negativeBlocked++;
        result.evaluated.push(cardEval);
        continue;
      }

      // ─────────────────────────────────────────────────────────────────────
      // KEYWORDS (word-based) — ALL words in keyword must appear in input
      // ─────────────────────────────────────────────────────────────────────
      // This allows flexible matching where words can have other words between.
      // Example: keyword "ac not cooling" matches "my ac is not cooling well"
      //
      // GREETING PROTECTION: Single greeting keywords (hi, hello) only match
      // if utterance is short (≤4 words). Prevents hijacking real intent.
      const keywords = safeArr(card.match?.keywords)
        .map(normalizeText)
        .filter(Boolean);

      let keywordHit = null;
      let greetingBlocked = false;
      let blockedKeyword = null;
      
      for (const kw of keywords) {
        // 🔍 SCRABENGINE: Check against BOTH original input AND expanded tokens
        const inputToCheck = useExpandedTokens ? enhancedInput : input;
        const result_kw = matchesAllWords(inputToCheck, kw);
        if (result_kw.matches) {
          keywordHit = kw;
          // Log if match came from expanded tokens (ScrabEngine synonym)
          if (useExpandedTokens && !matchesAllWords(input, kw).matches) {
            cardEval.matchedViaExpansion = true;
            cardEval.expansionUsed = 'synonym_token';
          }
          break;
        } else if (result_kw.blocked === 'GREETING_PROTECTION') {
          // Track that we blocked a greeting — log but don't match
          greetingBlocked = true;
          blockedKeyword = kw;
        }
      }
      
      // Log greeting protection if triggered
      if (greetingBlocked && !keywordHit) {
        cardEval.greetingBlocked = blockedKeyword;
        logger.debug('[TriggerCardMatcher] Greeting protection blocked keyword', {
          cardId: card.id,
          blockedKeyword,
          inputWordCount: extractWords(input).length,
          maxAllowed: MAX_GREETING_WORDS
        });
      }
      
      if (keywordHit) {
        cardEval.keywordHit = keywordHit;
        cardEval.matched = true;
        result.matched = true;
        result.card = card;
        result.matchType = 'KEYWORD';
        result.matchedOn = keywordHit;
        result.cardId = card.id || null;
        result.cardLabel = card.label || null;
        result.evaluated.push(cardEval);

        logger.info('[TriggerCardMatcher] Matched card via keyword (word-based)', {
          cardId: card.id,
          keyword: keywordHit,
          inputPreview: clip(input, 80)
        });

        return result;
      }

      // ─────────────────────────────────────────────────────────────────────
      // PHRASES (substring) — exact phrase must appear in input
      // ─────────────────────────────────────────────────────────────────────
      // Use phrases when word ORDER matters (e.g., "how much" vs "much how")
      const phrases = safeArr(card.match?.phrases)
        .map(normalizeText)
        .filter(Boolean);

      // 🔍 SCRABENGINE: Check phrases against BOTH original input AND expanded tokens
      const inputToCheckPhrases = useExpandedTokens ? enhancedInput : input;
      const phraseHit = phrases.find((ph) => matchesSubstring(inputToCheckPhrases, ph));
      if (phraseHit) {
        cardEval.phraseHit = phraseHit;
        cardEval.matched = true;
        result.matched = true;
        result.card = card;
        result.matchType = 'PHRASE';
        result.matchedOn = phraseHit;
        result.cardId = card.id || null;
        result.cardLabel = card.label || null;
        result.evaluated.push(cardEval);
        
        // Log if match came from expanded tokens
        if (useExpandedTokens && !matchesSubstring(input, phraseHit)) {
          cardEval.matchedViaExpansion = true;
          cardEval.expansionUsed = 'synonym_phrase';
        }

        logger.info('[TriggerCardMatcher] Matched card via phrase (substring)', {
          cardId: card.id,
          phrase: phraseHit,
          inputPreview: clip(input, 80),
          usedExpansion: cardEval.matchedViaExpansion || false
        });

        return result;
      }

      // No match on this card
      result.evaluated.push(cardEval);
    }

    logger.debug('[TriggerCardMatcher] No card matched', {
      totalCards: result.totalCards,
      enabledCards: result.enabledCards,
      inputPreview: clip(input, 80)
    });

    return result;
  }

  /**
   * Validate a single trigger card structure.
   * Returns array of validation errors (empty = valid).
   *
   * @param {Object} card
   * @returns {Array<string>}
   */
  static validateCard(card) {
    const errors = [];

    if (!card) {
      errors.push('Card is null or undefined');
      return errors;
    }

    if (!card.id || typeof card.id !== 'string') {
      errors.push('Card missing valid id');
    }

    if (!card.match || typeof card.match !== 'object') {
      errors.push('Card missing match configuration');
    } else {
      const keywords = safeArr(card.match.keywords);
      const phrases = safeArr(card.match.phrases);
      if (keywords.length === 0 && phrases.length === 0) {
        errors.push('Card has no keywords or phrases — will never match');
      }
    }

    if (!card.answer || typeof card.answer !== 'object') {
      errors.push('Card missing answer configuration');
    } else {
      const hasText = !!(card.answer.answerText || '').trim();
      const hasAudio = !!(card.answer.audioUrl || '').trim();
      if (!hasText && !hasAudio) {
        errors.push('Card has no answerText or audioUrl — nothing to respond with');
      }
    }

    return errors;
  }

  /**
   * Validate an array of trigger cards.
   * Returns object with valid cards, invalid cards, and all errors.
   *
   * @param {Array} cards
   * @returns {{ valid: Array, invalid: Array, errors: Array<{cardId: string, errors: Array}> }}
   */
  static validateCards(cards) {
    const cardList = safeArr(cards);
    const valid = [];
    const invalid = [];
    const allErrors = [];

    for (const card of cardList) {
      const errors = this.validateCard(card);
      if (errors.length === 0) {
        valid.push(card);
      } else {
        invalid.push(card);
        allErrors.push({ cardId: card?.id || 'unknown', errors });
      }
    }

    return { valid, invalid, errors: allErrors };
  }

  /**
   * Get a summary of trigger card pool health.
   *
   * @param {Array} cards
   * @returns {Object}
   */
  static getPoolStats(cards) {
    const cardList = safeArr(cards);
    const enabled = cardList.filter((c) => c.enabled !== false);
    const withKeywords = enabled.filter((c) => safeArr(c.match?.keywords).length > 0);
    const withPhrases = enabled.filter((c) => safeArr(c.match?.phrases).length > 0);
    const withAnswerText = enabled.filter((c) => !!(c.answer?.answerText || '').trim());
    const withAudioUrl = enabled.filter((c) => !!(c.answer?.audioUrl || '').trim());
    const withNegatives = enabled.filter((c) => safeArr(c.match?.negativeKeywords).length > 0);

    return {
      total: cardList.length,
      enabled: enabled.length,
      disabled: cardList.length - enabled.length,
      withKeywords: withKeywords.length,
      withPhrases: withPhrases.length,
      withAnswerText: withAnswerText.length,
      withAudioUrl: withAudioUrl.length,
      withNegatives: withNegatives.length,
      avgKeywordsPerCard: enabled.length > 0
        ? Math.round(enabled.reduce((sum, c) => sum + safeArr(c.match?.keywords).length, 0) / enabled.length * 10) / 10
        : 0
    };
  }

  /**
   * Load and match triggers for a company using the new global/local system.
   * Falls back to legacy config if no global group is selected.
   *
   * @param {string} companyId - The company ID
   * @param {string} inputText - The caller's utterance
   * @param {Object} legacyConfig - Legacy agent2 config for fallback
   * @param {Object} options - Matching options
   * @returns {Promise<TriggerMatchResult>}
   */
  static async matchForCompany(companyId, inputText, legacyConfig = null, options = {}) {
    try {
      const TriggerService = require('./TriggerService');
      
      const triggers = await TriggerService.loadTriggersWithLegacyFallback(companyId, legacyConfig);
      
      return this.match(inputText, triggers, options);
    } catch (error) {
      logger.warn('[TriggerCardMatcher] Failed to load triggers, using legacy fallback', {
        companyId,
        error: error.message
      });
      
      const legacyCards = legacyConfig?.discovery?.playbook?.rules || [];
      return this.match(inputText, legacyCards, options);
    }
  }

  /**
   * Get compiled triggers for a company (for external use/debugging).
   *
   * @param {string} companyId
   * @param {Object} legacyConfig - Legacy config for fallback
   * @returns {Promise<Array>}
   */
  static async getCompiledTriggers(companyId, legacyConfig = null) {
    try {
      const TriggerService = require('./TriggerService');
      return await TriggerService.loadTriggersWithLegacyFallback(companyId, legacyConfig);
    } catch (error) {
      logger.warn('[TriggerCardMatcher] Failed to load triggers', {
        companyId,
        error: error.message
      });
      return legacyConfig?.discovery?.playbook?.rules || [];
    }
  }
}

module.exports = { TriggerCardMatcher };
