/**
 * ============================================================================
 * TRIGGER CARD MATCHER (V2 - Word-Based Matching)
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
 *
 * Matching Logic (in order):
 * 1. Check if card is enabled
 * 2. Check negative keywords — if ANY match, skip this card
 * 3. Check keywords (WORD-BASED) — ALL words in keyword must appear in input
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
 * This allows admins to write natural keywords without predicting exact phrasing.
 *
 * ============================================================================
 */

const logger = require('../../../utils/logger');

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
 * Word-based matching: ALL words in the keyword must appear in the input.
 * Words can have other words in between — flexible natural language matching.
 *
 * @param {string} input - The caller's utterance (normalized)
 * @param {string} keyword - The keyword to match (normalized)
 * @returns {boolean} - True if all keyword words found in input
 */
function matchesAllWords(input, keyword) {
  const inputWords = new Set(extractWords(input));
  const keywordWords = extractWords(keyword);
  
  // All keyword words must be present in input
  if (keywordWords.length === 0) return false;
  return keywordWords.every(kw => inputWords.has(kw));
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

class TriggerCardMatcher {
  /**
   * Match caller input against a list of trigger cards.
   *
   * @param {string} inputText - The caller's utterance
   * @param {Array} cards - Array of trigger card objects
   * @returns {TriggerMatchResult}
   */
  static match(inputText, cards) {
    const input = normalizeText(inputText);
    const cardList = safeArr(cards);

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
      negativeBlocked: 0
    };

    if (!input) {
      logger.debug('[TriggerCardMatcher] Empty input, no match');
      return result;
    }

    if (cardList.length === 0) {
      logger.debug('[TriggerCardMatcher] No cards to match against');
      return result;
    }

    // Sort by priority (lower number = higher priority, default 100)
    const sorted = [...cardList].sort((a, b) => {
      const pA = typeof a.priority === 'number' ? a.priority : 100;
      const pB = typeof b.priority === 'number' ? b.priority : 100;
      return pA - pB;
    });

    for (const card of sorted) {
      const cardEval = {
        cardId: card.id || null,
        cardLabel: card.label || null,
        priority: typeof card.priority === 'number' ? card.priority : 100,
        enabled: card.enabled !== false,
        skipped: false,
        skipReason: null,
        negativeHit: null,
        keywordHit: null,
        phraseHit: null,
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

      // ─────────────────────────────────────────────────────────────────────
      // NEGATIVE KEYWORDS (word-based) — if ALL words found, block this card
      // ─────────────────────────────────────────────────────────────────────
      const negKeywords = safeArr(card.match?.negativeKeywords)
        .map(normalizeText)
        .filter(Boolean);

      const negativeHit = negKeywords.find((nk) => matchesAllWords(input, nk));
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
      const keywords = safeArr(card.match?.keywords)
        .map(normalizeText)
        .filter(Boolean);

      const keywordHit = keywords.find((kw) => matchesAllWords(input, kw));
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

      const phraseHit = phrases.find((ph) => matchesSubstring(input, ph));
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

        logger.info('[TriggerCardMatcher] Matched card via phrase (substring)', {
          cardId: card.id,
          phrase: phraseHit,
          inputPreview: clip(input, 80)
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
}

module.exports = { TriggerCardMatcher };
