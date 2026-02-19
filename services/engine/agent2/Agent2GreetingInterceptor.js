/**
 * ============================================================================
 * AGENT 2.0 GREETING INTERCEPTOR (V122 - Short-Only Gate)
 * ============================================================================
 *
 * Handles caller greetings ("hi", "good morning") with strict gating to prevent
 * hijacking real intent.
 *
 * GOLDEN RULE:
 * When Agent 2.0 is enabled, ONLY this interceptor is used.
 * Legacy greeting rules are IGNORED.
 *
 * SHORT-ONLY GATE (non-negotiable):
 * - Greeting rules ONLY fire if:
 *   1. wordCount ≤ maxWordsToQualify (default 2)
 *   2. Input does NOT contain any intentWords
 *   3. Match mode requirements are met (EXACT = full match)
 *
 * RUNTIME BEHAVIOR:
 * - Runs BEFORE trigger cards
 * - If it fires → returns immediately, ends the turn
 * - If blocked → emits proof event with reason
 *
 * PROOF EVENTS:
 * - A2_GREETING_EVALUATED: Every turn (shows if interceptor was considered)
 * - A2_GREETING_INTERCEPTED: When greeting fires
 *
 * ============================================================================
 */

const logger = require('../../../utils/logger');

// ────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────────────────────

const MATCH_MODES = {
  EXACT: 'EXACT',
  FUZZY: 'FUZZY'
};

const BLOCK_REASONS = {
  DISABLED: 'DISABLED',
  ALREADY_GREETED: 'ALREADY_GREETED',  // V124: One-shot guard
  TOO_LONG: 'TOO_LONG',
  INTENT_WORD_PRESENT: 'INTENT_WORD_PRESENT',
  NO_MATCH: 'NO_MATCH'
};

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

function safeArr(v) {
  return Array.isArray(v) ? v : [];
}

function safeObj(v, fallback = {}) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
}

function normalizeText(text) {
  return `${text || ''}`.toLowerCase().trim();
}

function clip(text, n) {
  const s = `${text || ''}`;
  return s.length > n ? s.substring(0, n) + '...' : s;
}

/**
 * Count words in text (splits on whitespace).
 */
function countWords(text) {
  const cleaned = normalizeText(text).replace(/[^\w\s]/g, '');
  const words = cleaned.split(/\s+/).filter(w => w.length > 0);
  return words.length;
}

/**
 * Check if text contains any of the intent words.
 * Uses word boundary matching to avoid false positives.
 */
function containsIntentWord(text, intentWords) {
  const textLower = normalizeText(text);
  for (const word of intentWords) {
    const wordLower = normalizeText(word);
    if (!wordLower) continue;
    
    // For multi-word phrases, use simple includes
    if (wordLower.includes(' ')) {
      if (textLower.includes(wordLower)) {
        return { found: true, word: word };
      }
    } else {
      // For single words, use word boundary regex
      const regex = new RegExp(`\\b${wordLower.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
      if (regex.test(textLower)) {
        return { found: true, word: word };
      }
    }
  }
  return { found: false, word: null };
}

/**
 * Check if input matches a greeting rule.
 *
 * @param {string} input - Normalized caller input
 * @param {Object} rule - Greeting rule
 * @returns {{ matched: boolean, trigger: string|null }}
 */
function matchesRule(input, rule) {
  const inputNorm = normalizeText(input);
  const triggers = safeArr(rule.triggers).map(t => normalizeText(t));
  const matchMode = `${rule.matchMode || 'EXACT'}`.toUpperCase();

  for (const trigger of triggers) {
    if (!trigger) continue;

    if (matchMode === MATCH_MODES.EXACT) {
      // EXACT: Input must exactly equal the trigger (after normalization)
      if (inputNorm === trigger) {
        return { matched: true, trigger };
      }
    } else if (matchMode === MATCH_MODES.FUZZY) {
      // FUZZY: Input must contain the trigger as a substring
      if (inputNorm.includes(trigger)) {
        return { matched: true, trigger };
      }
    }
  }

  return { matched: false, trigger: null };
}

// ────────────────────────────────────────────────────────────────────────────
// INTERCEPTOR CLASS
// ────────────────────────────────────────────────────────────────────────────

class Agent2GreetingInterceptor {
  /**
   * Evaluate caller input for greeting interception.
   *
   * @param {Object} params
   * @param {string} params.input - Caller's utterance
   * @param {Object} params.config - Greetings config (agent2.greetings)
   * @param {number} params.turn - Current turn number
   * @param {Object} params.state - Call state (optional, for one-shot guard)
   * @returns {Object} { intercepted, response, proof, stateUpdate }
   */
  static evaluate({ input, config, turn, state }) {
    const inputText = `${input || ''}`.trim();
    const greetingsConfig = safeObj(config, {});
    const interceptorConfig = safeObj(greetingsConfig.interceptor, {});
    const callState = safeObj(state, {});
    const agent2State = safeObj(callState.agent2, {});
    
    // Result structure
    const result = {
      intercepted: false,
      response: null,
      responseSource: null,  // 'audio' or 'tts'
      stateUpdate: null,     // V124: State changes to persist (greeted flag)
      proof: {
        event: 'A2_GREETING_EVALUATED',
        inputPreview: clip(inputText, 60),
        wordCount: 0,
        maxWordsToQualify: 2,
        containsIntentWord: false,
        intentWordFound: null,
        blockedReason: null,
        matchedRuleId: null,
        matchedTrigger: null,
        turn,
        alreadyGreeted: false  // V124: Proof field for one-shot guard
      }
    };

    // ─────────────────────────────────────────────────────────────────────────
    // GATE 0 (V124): ONE-SHOT GUARD — Never re-greet after first response
    // ─────────────────────────────────────────────────────────────────────────
    // If we've already greeted the caller, block ALL greeting cards on
    // subsequent turns. This prevents "hi/yeah/ok" filler from triggering
    // the same greeting response repeatedly.
    // ─────────────────────────────────────────────────────────────────────────
    const alreadyGreeted = agent2State.greeted === true;
    result.proof.alreadyGreeted = alreadyGreeted;
    
    if (alreadyGreeted && typeof turn === 'number' && turn > 1) {
      result.proof.blockedReason = BLOCK_REASONS.ALREADY_GREETED;
      logger.debug('[Agent2GreetingInterceptor] Blocked: ALREADY_GREETED (one-shot guard)', { turn });
      return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GATE 1: Interceptor must be enabled
    // ─────────────────────────────────────────────────────────────────────────
    if (interceptorConfig.enabled !== true) {
      result.proof.blockedReason = BLOCK_REASONS.DISABLED;
      logger.debug('[Agent2GreetingInterceptor] Blocked: DISABLED');
      return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GATE 2: Word count check (short-only gate)
    // ─────────────────────────────────────────────────────────────────────────
    const maxWords = typeof interceptorConfig.maxWordsToQualify === 'number'
      ? interceptorConfig.maxWordsToQualify
      : 2;
    const wordCount = countWords(inputText);
    result.proof.wordCount = wordCount;
    result.proof.maxWordsToQualify = maxWords;

    if (wordCount > maxWords) {
      result.proof.blockedReason = BLOCK_REASONS.TOO_LONG;
      logger.debug('[Agent2GreetingInterceptor] Blocked: TOO_LONG', { wordCount, maxWords });
      return result;
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GATE 3: Intent word check (blocks greeting if real intent detected)
    // ─────────────────────────────────────────────────────────────────────────
    if (interceptorConfig.blockIfContainsIntentWords !== false) {
      const intentWords = safeArr(interceptorConfig.intentWords);
      const intentCheck = containsIntentWord(inputText, intentWords);
      
      if (intentCheck.found) {
        result.proof.containsIntentWord = true;
        result.proof.intentWordFound = intentCheck.word;
        result.proof.blockedReason = BLOCK_REASONS.INTENT_WORD_PRESENT;
        logger.debug('[Agent2GreetingInterceptor] Blocked: INTENT_WORD_PRESENT', {
          word: intentCheck.word
        });
        return result;
      }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // GATE 4: Match against rules (priority order)
    // ─────────────────────────────────────────────────────────────────────────
    const rules = safeArr(interceptorConfig.rules)
      .filter(r => r && r.enabled !== false)
      .sort((a, b) => {
        const pA = typeof a.priority === 'number' ? a.priority : 100;
        const pB = typeof b.priority === 'number' ? b.priority : 100;
        return pA - pB;
      });

    for (const rule of rules) {
      const matchResult = matchesRule(inputText, rule);
      
      if (matchResult.matched) {
        // INTERCEPTED
        result.intercepted = true;
        result.proof.matchedRuleId = rule.id || null;
        result.proof.matchedTrigger = matchResult.trigger;
        result.proof.event = 'A2_GREETING_INTERCEPTED';

        // Determine response source
        if (rule.audioUrl && `${rule.audioUrl}`.trim()) {
          result.response = rule.audioUrl;
          result.responseSource = 'audio';
        } else {
          result.response = rule.responseText || "Hi! How can I help you?";
          result.responseSource = 'tts';
        }

        result.proof.responseSource = result.responseSource;
        result.proof.responsePreview = clip(result.response, 60);

        // V124: Set greeted flag to enable one-shot guard on future turns
        result.stateUpdate = { greeted: true };

        logger.info('[Agent2GreetingInterceptor] INTERCEPTED', {
          ruleId: rule.id,
          trigger: matchResult.trigger,
          responseSource: result.responseSource
        });

        return result;
      }
    }

    // No match found
    result.proof.blockedReason = BLOCK_REASONS.NO_MATCH;
    logger.debug('[Agent2GreetingInterceptor] Blocked: NO_MATCH');
    return result;
  }

  /**
   * Check if greeting interceptor should run (quick pre-check).
   * Use this to avoid unnecessary processing.
   *
   * @param {Object} config - Greetings config
   * @returns {boolean}
   */
  static isEnabled(config) {
    const greetingsConfig = safeObj(config, {});
    const interceptorConfig = safeObj(greetingsConfig.interceptor, {});
    return interceptorConfig.enabled === true;
  }

  /**
   * Get call start greeting (first message when call connects).
   *
   * @param {Object} config - Greetings config
   * @returns {{ enabled: boolean, text: string, audioUrl: string, source: string }}
   */
  static getCallStartGreeting(config) {
    const greetingsConfig = safeObj(config, {});
    const callStart = safeObj(greetingsConfig.callStart, {});

    if (callStart.enabled !== true) {
      return { enabled: false, text: null, audioUrl: null, source: null };
    }

    const hasAudio = callStart.audioUrl && `${callStart.audioUrl}`.trim();
    return {
      enabled: true,
      text: callStart.text || "Thank you for calling. How can I help you today?",
      audioUrl: hasAudio ? callStart.audioUrl : null,
      source: hasAudio ? 'audio' : 'tts'
    };
  }

  /**
   * Validate interceptor configuration.
   *
   * @param {Object} config - Interceptor config
   * @returns {{ valid: boolean, errors: Array<string> }}
   */
  static validateConfig(config) {
    const errors = [];
    const interceptorConfig = safeObj(config?.interceptor, {});

    if (typeof interceptorConfig.maxWordsToQualify !== 'number' ||
        interceptorConfig.maxWordsToQualify < 1 ||
        interceptorConfig.maxWordsToQualify > 10) {
      errors.push('maxWordsToQualify must be a number between 1 and 10');
    }

    const rules = safeArr(interceptorConfig.rules);
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      if (!rule.id) {
        errors.push(`Rule at index ${i} is missing an id`);
      }
      if (!safeArr(rule.triggers).length) {
        errors.push(`Rule "${rule.id || i}" has no triggers`);
      }
      if (!rule.responseText && !rule.audioUrl) {
        errors.push(`Rule "${rule.id || i}" has no response (responseText or audioUrl required)`);
      }
    }

    return { valid: errors.length === 0, errors };
  }
}

module.exports = {
  Agent2GreetingInterceptor,
  MATCH_MODES,
  BLOCK_REASONS
};
