/**
 * ============================================================================
 * AGENT 2.0 VOCABULARY ENGINE (V1 - UI-Controlled Normalization + Hints)
 * ============================================================================
 *
 * Single-responsibility module for vocabulary processing in Agent 2.0 Discovery.
 * 
 * TWO MODES:
 * 1. HARD_NORMALIZE: Replace mishears/misspellings with correct terms
 *    - "acee" → "ac"
 *    - "tstat" → "thermostat"
 *    - Modifies the text BEFORE trigger card matching
 * 
 * 2. SOFT_HINT: Add contextual hints WITHOUT modifying text
 *    - "thingy on the wall" → hint: "maybe_thermostat"
 *    - "box outside" → hint: "maybe_outdoor_unit"
 *    - Hints are passed to TriggerCardMatcher as priority boosts
 *
 * Design Principles:
 * - Zero LLM dependency — pure string/regex matching
 * - UI-controlled — entries stored in company.aiAgentSettings.agent2.discovery.vocabulary
 * - Transparent — emits proof events for every normalization/hint
 * - Priority-based — lower priority number = evaluated first
 * - Safe — never aggressive, only applies explicitly configured entries
 *
 * Config Shape (lives under Agent 2.0 ONLY):
 * company.aiAgentSettings.agent2.discovery.vocabulary = {
 *   enabled: true,
 *   entries: [
 *     { enabled: true, priority: 10, type: "HARD_NORMALIZE", matchMode: "EXACT", from: "acee", to: "ac" },
 *     { enabled: true, priority: 20, type: "SOFT_HINT", matchMode: "CONTAINS", from: "thingy on the wall", to: "maybe_thermostat" }
 *   ]
 * }
 *
 * HARD RULE: This engine does NOT touch legacy frontDeskBehavior.callerVocabulary.
 * That system is separate and handled by legacy code paths.
 *
 * ============================================================================
 */

const logger = require('../../../utils/logger');

// ────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────────────────────

const VOCABULARY_TYPES = {
  HARD_NORMALIZE: 'HARD_NORMALIZE',
  SOFT_HINT: 'SOFT_HINT'
};

const MATCH_MODES = {
  EXACT: 'EXACT',
  CONTAINS: 'CONTAINS'
};

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────

function safeArr(v) {
  return Array.isArray(v) ? v : (v ? [v] : []);
}

function safeObj(v, fallback = {}) {
  return v && typeof v === 'object' && !Array.isArray(v) ? v : fallback;
}

function normalizeText(text) {
  return `${text || ''}`.toLowerCase().trim();
}

function clip(text, n) {
  return `${text || ''}`.substring(0, n);
}

/**
 * Escape special regex characters for safe use in RegExp constructor.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check if a pattern matches in text based on match mode.
 * 
 * @param {string} text - The text to search in (normalized)
 * @param {string} pattern - The pattern to match (normalized)
 * @param {string} matchMode - 'EXACT' or 'CONTAINS'
 * @returns {{ matched: boolean, index: number, length: number }}
 */
function findMatch(text, pattern, matchMode) {
  if (!text || !pattern) return { matched: false, index: -1, length: 0 };
  
  const textNorm = normalizeText(text);
  const patternNorm = normalizeText(pattern);
  
  if (matchMode === MATCH_MODES.EXACT) {
    // Word boundary match: pattern must be a complete word/phrase
    // "acee" should match "acee" but not "racee" or "aceee"
    const regex = new RegExp(`\\b${escapeRegex(patternNorm)}\\b`, 'i');
    const match = textNorm.match(regex);
    if (match) {
      return { matched: true, index: match.index, length: patternNorm.length };
    }
    return { matched: false, index: -1, length: 0 };
  }
  
  if (matchMode === MATCH_MODES.CONTAINS) {
    // Substring match: pattern can appear anywhere
    const idx = textNorm.indexOf(patternNorm);
    if (idx >= 0) {
      return { matched: true, index: idx, length: patternNorm.length };
    }
    return { matched: false, index: -1, length: 0 };
  }
  
  // Default to CONTAINS if unknown mode
  const idx = textNorm.indexOf(patternNorm);
  if (idx >= 0) {
    return { matched: true, index: idx, length: patternNorm.length };
  }
  return { matched: false, index: -1, length: 0 };
}

/**
 * Apply a HARD_NORMALIZE replacement to text while preserving case structure.
 * 
 * @param {string} text - Original text
 * @param {string} from - Pattern to replace
 * @param {string} to - Replacement text
 * @param {string} matchMode - 'EXACT' or 'CONTAINS'
 * @returns {{ result: string, replaced: boolean, count: number }}
 */
function applyNormalization(text, from, to, matchMode) {
  if (!text || !from) return { result: text, replaced: false, count: 0 };
  
  const fromNorm = normalizeText(from);
  const toNorm = normalizeText(to);
  
  let result = text;
  let count = 0;
  
  if (matchMode === MATCH_MODES.EXACT) {
    // Word boundary replacement
    const regex = new RegExp(`\\b${escapeRegex(fromNorm)}\\b`, 'gi');
    result = text.replace(regex, (match) => {
      count++;
      // Preserve capitalization: if original was capitalized, capitalize replacement
      if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
        return toNorm.charAt(0).toUpperCase() + toNorm.slice(1);
      }
      return toNorm;
    });
  } else {
    // CONTAINS: Replace all occurrences (case-insensitive)
    const regex = new RegExp(escapeRegex(fromNorm), 'gi');
    result = text.replace(regex, (match) => {
      count++;
      if (match[0] === match[0].toUpperCase() && match[0] !== match[0].toLowerCase()) {
        return toNorm.charAt(0).toUpperCase() + toNorm.slice(1);
      }
      return toNorm;
    });
  }
  
  return { result, replaced: count > 0, count };
}

// ────────────────────────────────────────────────────────────────────────────
// VOCABULARY ENGINE CLASS
// ────────────────────────────────────────────────────────────────────────────

class Agent2VocabularyEngine {
  /**
   * Process user input through the vocabulary system.
   * 
   * @param {Object} params
   * @param {string} params.userInput - The caller's utterance
   * @param {Object} params.state - Current call state (for accessing agent2 namespace)
   * @param {Object} params.config - Vocabulary config (agent2.discovery.vocabulary)
   * @returns {Object} { normalizedText, hints[], applied[], stats }
   */
  static process({ userInput, state, config }) {
    const input = `${userInput || ''}`.trim();
    const vocabConfig = safeObj(config, {});
    const enabled = vocabConfig.enabled === true;
    const entries = safeArr(vocabConfig.entries);
    
    // Result structure
    const result = {
      normalizedText: input,
      hints: [],
      applied: [],
      stats: {
        inputLength: input.length,
        entriesEvaluated: 0,
        normalizeApplied: 0,
        hintsAdded: 0,
        skippedDisabled: 0
      }
    };
    
    // Early exit if disabled or no entries
    if (!enabled || entries.length === 0) {
      logger.debug('[Agent2VocabularyEngine] Vocabulary disabled or no entries', {
        enabled,
        entryCount: entries.length
      });
      return result;
    }
    
    // Sort entries by priority (lower number = higher priority, default 100)
    const sorted = [...entries].sort((a, b) => {
      const pA = typeof a.priority === 'number' ? a.priority : 100;
      const pB = typeof b.priority === 'number' ? b.priority : 100;
      return pA - pB;
    });
    
    let currentText = input;
    const hintsSet = new Set(safeArr(state?.agent2?.hints || [])); // Preserve existing hints
    
    for (const entry of sorted) {
      result.stats.entriesEvaluated++;
      
      // Skip disabled entries
      if (entry.enabled === false) {
        result.stats.skippedDisabled++;
        continue;
      }
      
      const entryType = `${entry.type || ''}`.toUpperCase();
      const matchMode = `${entry.matchMode || 'CONTAINS'}`.toUpperCase();
      const from = normalizeText(entry.from);
      const to = `${entry.to || ''}`.trim();
      
      if (!from || !to) {
        logger.debug('[Agent2VocabularyEngine] Skipping invalid entry', {
          entryId: entry.id,
          from: entry.from,
          to: entry.to
        });
        continue;
      }
      
      // Check if pattern matches current text
      const match = findMatch(currentText, from, matchMode);
      
      if (!match.matched) {
        continue;
      }
      
      // ─────────────────────────────────────────────────────────────────────
      // HARD_NORMALIZE: Replace text
      // ─────────────────────────────────────────────────────────────────────
      if (entryType === VOCABULARY_TYPES.HARD_NORMALIZE) {
        const { result: normalized, replaced, count } = applyNormalization(
          currentText, from, to, matchMode
        );
        
        if (replaced) {
          result.applied.push({
            type: VOCABULARY_TYPES.HARD_NORMALIZE,
            from: entry.from,
            to: entry.to,
            matchMode,
            replacements: count,
            priority: entry.priority || 100
          });
          result.stats.normalizeApplied++;
          currentText = normalized;
          
          logger.info('[Agent2VocabularyEngine] Applied HARD_NORMALIZE', {
            from: entry.from,
            to: entry.to,
            count,
            resultPreview: clip(normalized, 60)
          });
        }
      }
      
      // ─────────────────────────────────────────────────────────────────────
      // SOFT_HINT: Add hint without modifying text
      // ─────────────────────────────────────────────────────────────────────
      else if (entryType === VOCABULARY_TYPES.SOFT_HINT) {
        // Only add hint if not already present
        if (!hintsSet.has(to)) {
          hintsSet.add(to);
          result.hints.push(to);
          result.applied.push({
            type: VOCABULARY_TYPES.SOFT_HINT,
            from: entry.from,
            to: entry.to,
            matchMode,
            priority: entry.priority || 100
          });
          result.stats.hintsAdded++;
          
          logger.info('[Agent2VocabularyEngine] Added SOFT_HINT', {
            from: entry.from,
            hint: to,
            inputPreview: clip(input, 60)
          });
        }
      }
    }
    
    result.normalizedText = currentText;
    result.hints = Array.from(hintsSet); // Deduplicated hints
    
    return result;
  }
  
  /**
   * Validate a single vocabulary entry.
   * Returns array of validation errors (empty = valid).
   * 
   * @param {Object} entry
   * @returns {Array<string>}
   */
  static validateEntry(entry) {
    const errors = [];
    
    if (!entry) {
      errors.push('Entry is null or undefined');
      return errors;
    }
    
    if (!entry.from || typeof entry.from !== 'string' || !entry.from.trim()) {
      errors.push('Entry missing valid "from" field');
    }
    
    if (!entry.to || typeof entry.to !== 'string' || !entry.to.trim()) {
      errors.push('Entry missing valid "to" field');
    }
    
    const validTypes = Object.values(VOCABULARY_TYPES);
    const entryType = `${entry.type || ''}`.toUpperCase();
    if (!validTypes.includes(entryType)) {
      errors.push(`Invalid type: "${entry.type}". Must be one of: ${validTypes.join(', ')}`);
    }
    
    const validModes = Object.values(MATCH_MODES);
    const matchMode = `${entry.matchMode || 'CONTAINS'}`.toUpperCase();
    if (!validModes.includes(matchMode)) {
      errors.push(`Invalid matchMode: "${entry.matchMode}". Must be one of: ${validModes.join(', ')}`);
    }
    
    if (typeof entry.priority !== 'undefined' && typeof entry.priority !== 'number') {
      errors.push('Priority must be a number');
    }
    
    return errors;
  }
  
  /**
   * Validate an array of vocabulary entries.
   * 
   * @param {Array} entries
   * @returns {{ valid: Array, invalid: Array, errors: Array }}
   */
  static validateEntries(entries) {
    const entryList = safeArr(entries);
    const valid = [];
    const invalid = [];
    const allErrors = [];
    
    for (let i = 0; i < entryList.length; i++) {
      const entry = entryList[i];
      const errors = this.validateEntry(entry);
      if (errors.length === 0) {
        valid.push(entry);
      } else {
        invalid.push(entry);
        allErrors.push({ index: i, from: entry?.from, errors });
      }
    }
    
    return { valid, invalid, errors: allErrors };
  }
  
  /**
   * Get statistics about the vocabulary configuration.
   * 
   * @param {Object} config - Vocabulary config
   * @returns {Object}
   */
  static getStats(config) {
    const vocabConfig = safeObj(config, {});
    const entries = safeArr(vocabConfig.entries);
    const enabled = entries.filter(e => e.enabled !== false);
    
    return {
      enabled: vocabConfig.enabled === true,
      totalEntries: entries.length,
      enabledEntries: enabled.length,
      disabledEntries: entries.length - enabled.length,
      hardNormalizeCount: enabled.filter(e => `${e.type}`.toUpperCase() === VOCABULARY_TYPES.HARD_NORMALIZE).length,
      softHintCount: enabled.filter(e => `${e.type}`.toUpperCase() === VOCABULARY_TYPES.SOFT_HINT).length,
      exactMatchCount: enabled.filter(e => `${e.matchMode}`.toUpperCase() === MATCH_MODES.EXACT).length,
      containsMatchCount: enabled.filter(e => `${e.matchMode || 'CONTAINS'}`.toUpperCase() === MATCH_MODES.CONTAINS).length
    };
  }
}

module.exports = {
  Agent2VocabularyEngine,
  VOCABULARY_TYPES,
  MATCH_MODES
};
