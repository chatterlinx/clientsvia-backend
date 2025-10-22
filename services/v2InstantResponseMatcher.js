/**
 * INSTANT RESPONSE MATCHER SERVICE
 * 
 * Purpose: Match incoming queries to instant responses
 * - Uses in-house variation dictionary for semantic matching
 * - Supports fuzzy matching, synonyms, and misspellings
 * - Returns best match with confidence score
 * - NO EXTERNAL LLMs - 100% in-house logic
 * 
 * Performance Target: < 5ms per query
 * 
 * Matching Strategy:
 * 1. Normalize query (lowercase, trim, remove filler words)
 * 2. Extract key terms using variation dictionary
 * 3. Score each instant response trigger against normalized query
 * 4. Return best match if confidence > threshold
 * 
 * Usage:
 * - Called by v2priorityDrivenKnowledgeRouter.js as Priority 0
 * - Invoked before any other knowledge sources
 * - Returns null if no confident match found
 * 
 * Last Updated: 2025-10-02
 */

const variations = require('../config/instantResponseVariations');

class InstantResponseMatcher {
  constructor() {
    // Configuration
    this.confidenceThreshold = 0.6; // Minimum confidence score to return match (lowered from 0.7)
    this.fuzzyMatchThreshold = 0.75; // Levenshtein similarity threshold (lowered from 0.85)
    
    // Filler words to remove during normalization
    this.fillerWords = new Set([
      'um', 'uh', 'like', 'you', 'know', 'i', 'mean', 'basically',
      'actually', 'so', 'well', 'okay', 'alright', 'right', 'the',
      'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
      'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
      'did', 'will', 'would', 'should', 'could', 'can', 'may',
      'might', 'must', 'what', 'when', 'where', 'who', 'how', 'why'
    ]);
  }

  /**
   * Match query to instant responses
   * @param {String} query - Incoming user query
   * @param {Array} instantResponses - Company's instant responses
   * @returns {Object|null} - Best match or null if no confident match
   */
  match(query, instantResponses) {
    if (!query || !instantResponses || instantResponses.length === 0) {
      return null;
    }

    const startTime = Date.now();

    // Normalize query
    const normalizedQuery = this.normalizeQuery(query);
    
    // Extract key terms
    const queryTerms = this.extractKeyTerms(normalizedQuery);

    // Score all instant responses
    let bestMatch = null;
    let bestScore = 0;

    for (const response of instantResponses) {
      // Skip disabled responses
      if (response.enabled === false) {
        continue;
      }

      // Normalize trigger
      const normalizedTrigger = this.normalizeQuery(response.trigger);
      const triggerTerms = this.extractKeyTerms(normalizedTrigger);

      // Calculate match score
      const score = this.calculateScore(queryTerms, triggerTerms, normalizedQuery, normalizedTrigger);

      // Update best match
      if (score > bestScore) {
        bestScore = score;
        bestMatch = {
          response: response.response,
          trigger: response.trigger,
          category: response.category,
          score,
          responseId: response._id || response.trigger,
          matchedAt: new Date()
        };
      }
    }

    const elapsed = Date.now() - startTime;

    // Return match if confidence threshold met
    if (bestMatch && bestScore >= this.confidenceThreshold) {
      bestMatch.matchTimeMs = elapsed;
      return bestMatch;
    }

    return null;
  }

  /**
   * Normalize query for matching
   * @param {String} query - Raw query
   * @returns {String} - Normalized query
   */
  normalizeQuery(query) {
    if (!query) {return '';}

    return query
      .toLowerCase()
      .trim()
      .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
      .replace(/\s+/g, ' ') // Collapse multiple spaces
      .trim();
  }

  /**
   * Extract key terms from normalized query
   * @param {String} normalizedQuery - Normalized query
   * @returns {Array} - Array of key terms
   */
  extractKeyTerms(normalizedQuery) {
    if (!normalizedQuery) {return [];}

    // Split into words
    const words = normalizedQuery.split(' ');

    // Remove filler words
    const keyWords = words.filter(word => !this.fillerWords.has(word) && word.length > 0);

    return keyWords;
  }

  /**
   * Calculate match score between query and trigger
   * @param {Array} queryTerms - Query key terms
   * @param {Array} triggerTerms - Trigger key terms
   * @param {String} normalizedQuery - Full normalized query
   * @param {String} normalizedTrigger - Full normalized trigger
   * @returns {Number} - Match score (0-1)
   */
  calculateScore(queryTerms, triggerTerms, normalizedQuery, normalizedTrigger) {
    let score = 0;
    const weights = {
      exactMatch: 1.0,
      variationMatch: 0.9,
      fuzzyMatch: 0.8,
      partialMatch: 0.6,
      termOverlap: 0.5
    };

    // 1. Exact match
    if (normalizedQuery === normalizedTrigger) {
      return 1.0;
    }

    // 2. Exact substring match
    if (normalizedQuery.includes(normalizedTrigger) || normalizedTrigger.includes(normalizedQuery)) {
      score += weights.exactMatch * 0.9;
    }

    // 3. Variation-based matching
    const variationScore = this.calculateVariationScore(queryTerms, triggerTerms);
    score += variationScore * weights.variationMatch;

    // 4. Fuzzy matching (Levenshtein distance)
    const fuzzyScore = this.calculateFuzzyScore(normalizedQuery, normalizedTrigger);
    if (fuzzyScore >= this.fuzzyMatchThreshold) {
      score += fuzzyScore * weights.fuzzyMatch;
    } else {
      // Even if below threshold, add partial credit
      score += fuzzyScore * weights.partialMatch;
    }

    // 5. Term overlap
    const overlapScore = this.calculateTermOverlap(queryTerms, triggerTerms);
    score += overlapScore * weights.termOverlap;

    // Normalize score to 0-1 range
    return Math.min(score, 1.0);
  }

  /**
   * Calculate variation-based match score
   * @param {Array} queryTerms - Query terms
   * @param {Array} triggerTerms - Trigger terms
   * @returns {Number} - Variation score (0-1)
   */
  calculateVariationScore(queryTerms, triggerTerms) {
    let matchCount = 0;
    const totalTerms = Math.max(queryTerms.length, triggerTerms.length);

    if (totalTerms === 0) {return 0;}

    for (const queryTerm of queryTerms) {
      for (const triggerTerm of triggerTerms) {
        // Check if terms are related via variation dictionary
        if (variations.areRelated(queryTerm, triggerTerm)) {
          matchCount++;
          break;
        }
      }
    }

    return matchCount / totalTerms;
  }

  /**
   * Calculate fuzzy match score using Levenshtein distance
   * @param {String} str1 - First string
   * @param {String} str2 - Second string
   * @returns {Number} - Similarity score (0-1)
   */
  calculateFuzzyScore(str1, str2) {
    const distance = this.levenshteinDistance(str1, str2);
    const maxLength = Math.max(str1.length, str2.length);
    
    if (maxLength === 0) {return 1.0;}
    
    return 1 - (distance / maxLength);
  }

  /**
   * Calculate Levenshtein distance between two strings
   * @param {String} str1 - First string
   * @param {String} str2 - Second string
   * @returns {Number} - Edit distance
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];

    // Initialize matrix
    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }
    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    // Fill matrix
    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
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

    return matrix[str2.length][str1.length];
  }

  /**
   * Calculate term overlap score
   * @param {Array} queryTerms - Query terms
   * @param {Array} triggerTerms - Trigger terms
   * @returns {Number} - Overlap score (0-1)
   */
  calculateTermOverlap(queryTerms, triggerTerms) {
    const querySet = new Set(queryTerms);
    const triggerSet = new Set(triggerTerms);
    
    let intersection = 0;
    for (const term of querySet) {
      if (triggerSet.has(term)) {
        intersection++;
      }
    }

    const union = new Set([...querySet, ...triggerSet]).size;
    
    if (union === 0) {return 0;}
    
    return intersection / union;
  }

  /**
   * Batch match multiple queries (for testing/benchmarking)
   * @param {Array} queries - Array of query strings
   * @param {Array} instantResponses - Company's instant responses
   * @returns {Array} - Array of match results
   */
  batchMatch(queries, instantResponses) {
    return queries.map(query => ({
      query,
      match: this.match(query, instantResponses)
    }));
  }

  /**
   * Get matcher statistics
   * @returns {Object} - Matcher configuration and stats
   */
  getStats() {
    return {
      confidenceThreshold: this.confidenceThreshold,
      fuzzyMatchThreshold: this.fuzzyMatchThreshold,
      fillerWordsCount: this.fillerWords.size,
      variationsLoaded: variations.getAllConcepts().length
    };
  }
}

// Export singleton instance
module.exports = new InstantResponseMatcher();
