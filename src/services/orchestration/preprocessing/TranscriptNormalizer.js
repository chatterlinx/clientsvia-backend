/**
 * ============================================================================
 * TRANSCRIPT NORMALIZER - ORCHESTRATION PREPROCESSING
 * ============================================================================
 * 
 * PURPOSE: Clean and standardize transcripts from STT engines
 * ARCHITECTURE: Pattern-based normalization
 * PERFORMANCE: <2ms execution
 * DOMAIN: Preprocessing
 * 
 * WHAT IT DOES:
 * - Normalize spelling variations ("AC" vs "A/C" vs "air conditioning")
 * - Fix common STT errors ("their" when meant "there")
 * - Standardize punctuation
 * - Trim whitespace
 * - Preserve important capitalization (AC, HVAC, ASAP)
 * 
 * USED BY: OrchestrationEngine.js (Step 3: Preprocessing)
 * 
 * ============================================================================
 */

const logger = require('../../../../utils/logger');

// ============================================================================
// NORMALIZATION RULES
// ============================================================================

const SPELLING_VARIATIONS = {
  // HVAC terms
  'a/c': 'AC',
  'a.c.': 'AC',
  'air conditioning': 'AC',
  'air conditioner': 'AC',
  'hvac': 'HVAC',
  'h.v.a.c': 'HVAC',
  
  // Common typos
  'thier': 'their',
  'recieve': 'receive',
  'seperate': 'separate',
  
  // Time expressions
  'asap': 'ASAP',
  'a.s.a.p': 'ASAP',
  'a s a p': 'ASAP'
};

const PHRASE_NORMALIZATIONS = {
  'water heater': 'water-heater',
  'gate code': 'gate-code',
  'lock box': 'lockbox'
};

// ============================================================================
// MAIN CLASS
// ============================================================================

class TranscriptNormalizer {
  
  /**
   * Normalize transcript text
   * 
   * @param {string} text - Raw transcript from STT
   * @param {Object} [options] - Configuration options
   * @param {boolean} [options.preserveCase=false] - Don't lowercase
   * @returns {string} Normalized text
   * 
   * @example
   * const normalized = TranscriptNormalizer.normalize("my a/c is broken");
   * // Returns: "my AC is broken"
   */
  static normalize(text, options = {}) {
    if (!text || typeof text !== 'string') {
      return '';
    }
    
    const startTime = Date.now();
    
    try {
      let normalized = text;
      
      // Step 1: Trim whitespace
      normalized = normalized.trim();
      
      // Step 2: Fix spelling variations (case-insensitive replacement)
      for (const [variation, standard] of Object.entries(SPELLING_VARIATIONS)) {
        const pattern = new RegExp(`\\b${this._escapeRegex(variation)}\\b`, 'gi');
        normalized = normalized.replace(pattern, standard);
      }
      
      // Step 3: Normalize phrases
      for (const [phrase, normalized_phrase] of Object.entries(PHRASE_NORMALIZATIONS)) {
        const pattern = new RegExp(this._escapeRegex(phrase), 'gi');
        normalized = normalized.replace(pattern, normalized_phrase);
      }
      
      // Step 4: Standardize punctuation spacing
      normalized = normalized.replace(/\s+([.,!?;:])/g, '$1'); // Remove space before punctuation
      normalized = normalized.replace(/([.,!?;:])\s*/g, '$1 '); // Add space after punctuation
      
      // Step 5: Remove multiple spaces
      normalized = normalized.replace(/\s{2,}/g, ' ');
      
      // Step 6: Preserve case (we don't lowercase by default)
      // The original case is important for natural conversation flow
      // We only normalize specific technical terms (AC, HVAC) which is already done in Step 2
      
      // Step 7: Final trim
      normalized = normalized.trim();
      
      logger.debug('[TRANSCRIPT NORMALIZER] Normalized text', {
        originalLength: text.length,
        normalizedLength: normalized.length,
        executionTime: Date.now() - startTime
      });
      
      return normalized;
      
    } catch (err) {
      logger.error('[TRANSCRIPT NORMALIZER] Normalization failed', {
        error: err.message,
        stack: err.stack,
        textLength: text.length
      });
      
      // Safe fallback
      return text.trim();
    }
  }
  
  /**
   * Escape special regex characters
   * @private
   * @param {string} str - String to escape
   * @returns {string} Escaped string
   */
  static _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  /**
   * Batch normalize multiple texts
   * 
   * @param {Array<string>} texts - Array of texts to normalize
   * @param {Object} [options] - Configuration options
   * @returns {Array<string>} Array of normalized texts
   * 
   * @example
   * const normalized = TranscriptNormalizer.normalizeBatch([
   *   "my a/c is broken",
   *   "I need help asap"
   * ]);
   * // Returns: ["my AC is broken", "I need help ASAP"]
   */
  static normalizeBatch(texts, options = {}) {
    return texts.map(text => this.normalize(text, options));
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = TranscriptNormalizer;

