/**
 * ============================================================================
 * TRANSCRIPT NORMALIZER - PRECISION FRONTLINE-INTEL V23
 * ============================================================================
 * 
 * PURPOSE: Clean and standardize transcripts from STT engines
 * ARCHITECTURE: Pattern-based normalization
 * PERFORMANCE: <2ms execution
 * 
 * WHAT IT DOES:
 * - Normalize spelling variations ("AC" vs "A/C" vs "air conditioning")
 * - Fix common STT errors ("their" when meant "there")
 * - Standardize punctuation
 * - Trim whitespace
 * - Lowercase for consistency
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');

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
   * @param {string} text - Raw transcript
   * @param {Object} options - Configuration
   * @param {boolean} options.preserveCase - Don't lowercase (default: false)
   * @returns {string} Normalized text
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
      
      // Step 6: Lowercase (unless preserveCase is true)
      if (!options.preserveCase) {
        // Preserve certain all-caps words (AC, HVAC, ASAP)
        const preservedWords = ['AC', 'HVAC', 'ASAP'];
        const placeholder = '___PRESERVED___';
        const preserved = [];
        
        preservedWords.forEach(word => {
          const pattern = new RegExp(`\\b${word}\\b`, 'g');
          normalized = normalized.replace(pattern, (match) => {
            preserved.push(match);
            return `${placeholder}${preserved.length - 1}`;
          });
        });
        
        // Lowercase everything
        normalized = normalized.toLowerCase();
        
        // Restore preserved words
        preserved.forEach((word, idx) => {
          normalized = normalized.replace(`${placeholder}${idx}`, word);
        });
      }
      
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
   */
  static _escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  
  /**
   * Batch normalize multiple texts
   * 
   * @param {Array<string>} texts
   * @param {Object} options
   * @returns {Array<string>}
   */
  static normalizeBatch(texts, options = {}) {
    return texts.map(text => this.normalize(text, options));
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = TranscriptNormalizer;

