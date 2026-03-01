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
 * Calculate Levenshtein edit distance between two strings.
 * Used for fuzzy matching.
 */
function levenshteinDistance(a, b) {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  
  const matrix = [];
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Common greeting variations - maps canonical triggers to acceptable variants.
 * Used for FUZZY matching to handle "hi" → "hey", "hiya", "howdy", etc.
 */
const GREETING_VARIANTS = {
  'hi': ['hey', 'hiya', 'heya', 'yo', 'hii', 'hiii', 'hiiii', 'sup', 'wassup', 'whats up'],
  'hello': ['helo', 'helloo', 'hellooo', 'hullo', 'hallo', 'ello', 'allo'],
  'hey': ['hi', 'hiya', 'heya', 'hay', 'heyy', 'heyyy'],
  'good morning': ['morning', 'mornin', 'good mornin', 'gm', 'g morning'],
  'good afternoon': ['afternoon', 'good aft', 'g afternoon'],
  'good evening': ['evening', 'evenin', 'good evenin', 'g evening'],
  'howdy': ['howdee', 'howdie', 'hi', 'hey'],
  'greetings': ['greeting', 'greets'],
  'whats up': ['wassup', 'wazzup', 'sup', 'what up', 'whatsup']
};

/**
 * Check if two words are fuzzy matches.
 * Uses Levenshtein distance and known greeting variants.
 * 
 * @param {string} input - The input word (normalized)
 * @param {string} trigger - The trigger word (normalized)
 * @returns {boolean} True if fuzzy match
 */
function isFuzzyMatch(input, trigger) {
  // Exact match
  if (input === trigger) return true;
  
  // Check if input is a known variant of the trigger
  const variants = GREETING_VARIANTS[trigger];
  if (variants && variants.includes(input)) return true;
  
  // Check if trigger is a known variant of input (reverse lookup)
  for (const [canonical, variantList] of Object.entries(GREETING_VARIANTS)) {
    if (variantList.includes(trigger) && (input === canonical || variantList.includes(input))) {
      return true;
    }
  }
  
  // Levenshtein distance: allow 1 edit for short words, 2 for longer
  const maxDistance = trigger.length <= 3 ? 1 : 2;
  const distance = levenshteinDistance(input, trigger);
  if (distance <= maxDistance) return true;
  
  // Input contains trigger (handles "hiiii" → "hi")
  if (input.includes(trigger) || trigger.includes(input)) {
    // But only if the lengths are reasonably close
    const lengthRatio = Math.min(input.length, trigger.length) / Math.max(input.length, trigger.length);
    if (lengthRatio >= 0.5) return true;
  }
  
  return false;
}

/**
 * Check if input matches a greeting rule.
 *
 * @param {string} input - Normalized caller input
 * @param {Object} rule - Greeting rule
 * @returns {{ matched: boolean, trigger: string|null, matchMethod: string|null }}
 */
function matchesRule(input, rule) {
  const inputNorm = normalizeText(input);
  const triggers = safeArr(rule.triggers).map(t => normalizeText(t));
  // V2 Schema Update (Feb 2026): matchMode → matchType
  const matchType = `${rule.matchType || rule.matchMode || 'EXACT'}`.toUpperCase();

  for (const trigger of triggers) {
    if (!trigger) continue;

    if (matchType === 'EXACT' || matchType === MATCH_MODES.EXACT) {
      // EXACT: Input must exactly equal the trigger (after normalization)
      if (inputNorm === trigger) {
        return { matched: true, trigger, matchMethod: 'EXACT' };
      }
    } else if (matchType === 'FUZZY' || matchType === MATCH_MODES.FUZZY) {
      // FUZZY: Smart matching using variants and Levenshtein distance
      // For multi-word inputs, check each word against trigger
      const inputWords = inputNorm.split(/\s+/).filter(w => w.length > 0);
      const triggerWords = trigger.split(/\s+/).filter(w => w.length > 0);
      
      if (triggerWords.length === 1) {
        // Single-word trigger: check if any input word fuzzy-matches
        for (const inputWord of inputWords) {
          if (isFuzzyMatch(inputWord, triggerWords[0])) {
            return { matched: true, trigger, matchMethod: 'FUZZY' };
          }
        }
      } else {
        // Multi-word trigger: all trigger words must fuzzy-match input words in order
        let matchCount = 0;
        for (const triggerWord of triggerWords) {
          for (const inputWord of inputWords) {
            if (isFuzzyMatch(inputWord, triggerWord)) {
              matchCount++;
              break;
            }
          }
        }
        if (matchCount === triggerWords.length) {
          return { matched: true, trigger, matchMethod: 'FUZZY' };
        }
      }
    } else if (matchType === 'CONTAINS') {
      // CONTAINS: Input must contain the trigger as a substring
      if (inputNorm.includes(trigger)) {
        return { matched: true, trigger, matchMethod: 'CONTAINS' };
      }
    } else if (matchType === 'REGEX') {
      // REGEX: Advanced pattern matching
      try {
        const regex = new RegExp(trigger, 'i');
        if (regex.test(inputNorm)) {
          return { matched: true, trigger, matchMethod: 'REGEX' };
        }
      } catch (err) {
        logger.warn('[Agent2GreetingInterceptor] Invalid regex in rule', { trigger });
      }
    }
  }

  return { matched: false, trigger: null, matchMethod: null };
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
   * @param {string} params.callerName - Caller's first name (optional, for {name} replacement)
   * @returns {Object} { intercepted, response, proof, stateUpdate }
   */
  static evaluate({ input, config, turn, state, callerName }) {
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
    // V2 Schema Update (Feb 2026): maxWordsToQualify → shortOnlyGate.maxWords
    const shortOnlyGate = safeObj(interceptorConfig.shortOnlyGate, {});
    const maxWords = typeof shortOnlyGate.maxWords === 'number'
      ? shortOnlyGate.maxWords
      : (typeof interceptorConfig.maxWordsToQualify === 'number' ? interceptorConfig.maxWordsToQualify : 2);
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
    // V2 Schema Update (Feb 2026): blockIfContainsIntentWords → shortOnlyGate.blockIfIntentWords
    const blockIfIntentWords = shortOnlyGate.blockIfIntentWords !== false
      ? true
      : (interceptorConfig.blockIfContainsIntentWords !== false);
    
    if (blockIfIntentWords) {
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
        // V2 Schema Update (Feb 2026): rule.id → rule.ruleId
        result.proof.matchedRuleId = rule.ruleId || rule.id || null;
        result.proof.matchedTrigger = matchResult.trigger;
        result.proof.event = 'A2_GREETING_INTERCEPTED';

        // Determine response source
        if (rule.audioUrl && `${rule.audioUrl}`.trim()) {
          result.response = rule.audioUrl;
          result.responseSource = 'audio';
        } else {
          // V2 Schema Update (Feb 2026): rule.responseText → rule.response
          let responseText = rule.response || rule.responseText || "Hi! How can I help you?";
          
          // ═══════════════════════════════════════════════════════════════
          // {name} PLACEHOLDER REPLACEMENT (V126 - Greeting Consolidation)
          // ═══════════════════════════════════════════════════════════════
          // Replace {name} with caller's first name if available.
          // If no name: remove {name} cleanly without extra spaces.
          // 
          // Examples:
          //   "Good morning{name}!" + name="John" → "Good morning, John!"
          //   "Good morning{name}!" + no name    → "Good morning!"
          //   "Hi{name}, thanks!"   + name="Sarah" → "Hi, Sarah, thanks!"
          // ═══════════════════════════════════════════════════════════════
          if (responseText.includes('{name}')) {
            if (callerName && callerName.trim()) {
              // With name: add comma + name
              responseText = responseText.replace(/\{name\}/g, `, ${callerName.trim()}`);
            } else {
              // Without name: remove {name} placeholder
              responseText = responseText.replace(/\{name\}/g, '');
            }
            
            // Clean up any double spaces or awkward punctuation
            responseText = responseText
              .replace(/\s+/g, ' ')           // Multiple spaces → single space
              .replace(/\s,/g, ',')            // Space before comma → no space
              .replace(/,\s*,/g, ',')          // Double commas → single comma
              .replace(/^,\s*/g, '')           // Leading comma → remove
              .trim();
          }
          
          result.response = responseText;
          result.responseSource = 'tts';
        }

        result.proof.responseSource = result.responseSource;
        result.proof.responsePreview = clip(result.response, 60);

        // V124: Set greeted flag to enable one-shot guard on future turns
        result.stateUpdate = { greeted: true };

        logger.info('[Agent2GreetingInterceptor] INTERCEPTED', {
          ruleId: rule.ruleId || rule.id,
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
    const shortOnlyGate = safeObj(interceptorConfig.shortOnlyGate, {});

    // V2 Schema Update (Feb 2026): maxWordsToQualify → shortOnlyGate.maxWords
    const maxWords = shortOnlyGate.maxWords || interceptorConfig.maxWordsToQualify;
    if (typeof maxWords !== 'number' || maxWords < 1 || maxWords > 10) {
      errors.push('maxWords must be a number between 1 and 10');
    }

    const rules = safeArr(interceptorConfig.rules);
    for (let i = 0; i < rules.length; i++) {
      const rule = rules[i];
      // V2 Schema Update (Feb 2026): rule.id → rule.ruleId
      const ruleId = rule.ruleId || rule.id;
      if (!ruleId) {
        errors.push(`Rule at index ${i} is missing a ruleId`);
      }
      if (!safeArr(rule.triggers).length) {
        errors.push(`Rule "${ruleId || i}" has no triggers`);
      }
      // V2 Schema Update (Feb 2026): rule.responseText → rule.response
      const response = rule.response || rule.responseText;
      if (!response && !rule.audioUrl) {
        errors.push(`Rule "${ruleId || i}" has no response (response or audioUrl required)`);
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
