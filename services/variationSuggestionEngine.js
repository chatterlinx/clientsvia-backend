/**
 * VARIATION SUGGESTION ENGINE
 * 
 * Purpose: AI-assisted variation suggestions for instant responses
 * - Analyzes existing triggers and suggests variations
 * - Uses in-house NLP and pattern matching (NO EXTERNAL LLMs)
 * - Helps admins expand coverage and improve matching
 * 
 * Features:
 * - Suggest synonyms and related terms from variation dictionary
 * - Detect common misspellings and abbreviations
 * - Identify missing variations in existing triggers
 * - Learn from company's historical queries (future enhancement)
 * 
 * Usage:
 * - Called by frontend to suggest variations when creating/editing responses
 * - API endpoint: POST /api/v2/company/:companyId/instant-responses/suggest-variations
 * 
 * Last Updated: 2025-10-02
 */

const variations = require('../config/instantResponseVariations');

class VariationSuggestionEngine {
  constructor() {
    // Common misspelling patterns
    this.misspellingPatterns = {
      'hours': ['hrs', 'ours', 'houres', 'housr'],
      'location': ['lokation', 'locaton', 'loaction'],
      'pricing': ['pricng', 'prcing', 'prcing'],
      'services': ['servics', 'servises', 'srvices'],
      'available': ['availble', 'availabe', 'avaliable'],
      'appointment': ['apointment', 'appointmnt', 'appt'],
      'emergency': ['emergancy', 'emrgency', 'emergeny']
    };

    // Common abbreviations
    this.abbreviations = {
      'hrs': 'hours',
      'appt': 'appointment',
      'asap': 'as soon as possible',
      'info': 'information',
      'loc': 'location',
      'addr': 'address',
      'tel': 'telephone',
      'ph': 'phone',
      'approx': 'approximately',
      'est': 'estimate',
      'min': 'minimum',
      'max': 'maximum'
    };
  }

  /**
   * Suggest variations for a given trigger
   * @param {String} trigger - Instant response trigger
   * @param {Array} existingTriggers - Company's existing triggers (to avoid duplicates)
   * @returns {Object} - Suggested variations with confidence scores
   */
  suggestVariations(trigger, existingTriggers = []) {
    if (!trigger) {
      return { suggestions: [], metadata: { triggerAnalyzed: null } };
    }

    const normalizedTrigger = trigger.toLowerCase().trim();
    const suggestions = [];

    // Extract key terms from trigger
    const terms = this.extractTerms(normalizedTrigger);

    // 1. Dictionary-based suggestions
    const dictionarySuggestions = this.getDictionarySuggestions(terms);
    suggestions.push(...dictionarySuggestions);

    // 2. Misspelling suggestions
    const misspellingSuggestions = this.getMisspellingSuggestions(terms);
    suggestions.push(...misspellingSuggestions);

    // 3. Abbreviation suggestions
    const abbreviationSuggestions = this.getAbbreviationSuggestions(terms);
    suggestions.push(...abbreviationSuggestions);

    // 4. Pattern-based suggestions
    const patternSuggestions = this.getPatternSuggestions(normalizedTrigger);
    suggestions.push(...patternSuggestions);

    // Remove duplicates and filter out existing triggers
    const uniqueSuggestions = this.deduplicateAndFilter(
      suggestions,
      existingTriggers
    );

    // Sort by confidence score
    uniqueSuggestions.sort((a, b) => b.confidence - a.confidence);

    return {
      suggestions: uniqueSuggestions.slice(0, 20), // Top 20 suggestions
      metadata: {
        triggerAnalyzed: trigger,
        totalSuggestions: uniqueSuggestions.length,
        termsExtracted: terms
      }
    };
  }

  /**
   * Extract key terms from trigger
   * @param {String} trigger - Normalized trigger
   * @returns {Array} - Key terms
   */
  extractTerms(trigger) {
    // Remove common filler words
    const fillerWords = new Set(['what', 'is', 'are', 'the', 'your', 'you', 'do', 'can', 'how']);
    
    return trigger
      .split(/\s+/)
      .filter(term => term.length > 0 && !fillerWords.has(term));
  }

  /**
   * Get dictionary-based suggestions
   * @param {Array} terms - Trigger terms
   * @returns {Array} - Suggestions
   */
  getDictionarySuggestions(terms) {
    const suggestions = [];

    for (const term of terms) {
      // Find canonical concept for term
      const canonical = variations.findCanonical(term);
      
      if (canonical) {
        // Get all variations for this concept
        const allVariations = variations.getAllVariations(canonical);
        
        for (const variation of allVariations) {
          if (variation !== term) {
            suggestions.push({
              text: variation,
              type: 'dictionary',
              confidence: 0.9,
              reason: `Synonym for "${term}" (${canonical})`
            });
          }
        }
      }
    }

    return suggestions;
  }

  /**
   * Get misspelling suggestions
   * @param {Array} terms - Trigger terms
   * @returns {Array} - Suggestions
   */
  getMisspellingSuggestions(terms) {
    const suggestions = [];

    for (const term of terms) {
      // Check if term has known misspellings
      if (this.misspellingPatterns[term]) {
        for (const misspelling of this.misspellingPatterns[term]) {
          suggestions.push({
            text: misspelling,
            type: 'misspelling',
            confidence: 0.7,
            reason: `Common misspelling of "${term}"`
          });
        }
      }

      // Reverse lookup: if term is a known misspelling, suggest correct form
      for (const [correct, misspellings] of Object.entries(this.misspellingPatterns)) {
        if (misspellings.includes(term)) {
          suggestions.push({
            text: correct,
            type: 'correction',
            confidence: 0.8,
            reason: `Correct spelling of "${term}"`
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Get abbreviation suggestions
   * @param {Array} terms - Trigger terms
   * @returns {Array} - Suggestions
   */
  getAbbreviationSuggestions(terms) {
    const suggestions = [];

    for (const term of terms) {
      // If term is an abbreviation, suggest full form
      if (this.abbreviations[term]) {
        suggestions.push({
          text: this.abbreviations[term],
          type: 'abbreviation_expansion',
          confidence: 0.85,
          reason: `Full form of "${term}"`
        });
      }

      // If term is a full form, suggest abbreviation
      for (const [abbr, full] of Object.entries(this.abbreviations)) {
        if (full === term || full.includes(term)) {
          suggestions.push({
            text: abbr,
            type: 'abbreviation',
            confidence: 0.75,
            reason: `Abbreviation for "${term}"`
          });
        }
      }
    }

    return suggestions;
  }

  /**
   * Get pattern-based suggestions
   * @param {String} trigger - Normalized trigger
   * @returns {Array} - Suggestions
   */
  getPatternSuggestions(trigger) {
    const suggestions = [];

    // Question pattern variations
    const questionPatterns = [
      { prefix: 'what are your', suffix: '', confidence: 0.8 },
      { prefix: 'what is your', suffix: '', confidence: 0.8 },
      { prefix: 'do you have', suffix: '', confidence: 0.75 },
      { prefix: 'can you tell me your', suffix: '', confidence: 0.75 },
      { prefix: 'what are the', suffix: '', confidence: 0.7 },
      { prefix: '', suffix: '', confidence: 0.6 } // Just the noun
    ];

    // Detect if trigger contains question words
    if (trigger.includes('what') || trigger.includes('how') || trigger.includes('when')) {
      // Extract the main noun/topic
      const mainTopic = this.extractMainTopic(trigger);
      
      if (mainTopic) {
        for (const pattern of questionPatterns) {
          const suggestion = pattern.prefix ? 
            `${pattern.prefix} ${mainTopic}${pattern.suffix}` :
            mainTopic;
          
          if (suggestion !== trigger) {
            suggestions.push({
              text: suggestion,
              type: 'pattern',
              confidence: pattern.confidence,
              reason: 'Alternative question phrasing'
            });
          }
        }
      }
    }

    return suggestions;
  }

  /**
   * Extract main topic from question
   * @param {String} trigger - Trigger text
   * @returns {String|null} - Main topic
   */
  extractMainTopic(trigger) {
    // Simple heuristic: last noun after question word
    const questionWords = ['what', 'how', 'when', 'where', 'who', 'why'];
    const words = trigger.split(/\s+/);
    
    let topicStart = -1;
    for (let i = 0; i < words.length; i++) {
      if (questionWords.includes(words[i])) {
        topicStart = i + 1;
        break;
      }
    }

    if (topicStart >= 0 && topicStart < words.length) {
      // Remove common filler words from start
      const fillers = ['is', 'are', 'the', 'your', 'you'];
      while (topicStart < words.length && fillers.includes(words[topicStart])) {
        topicStart++;
      }
      
      if (topicStart < words.length) {
        return words.slice(topicStart).join(' ');
      }
    }

    return null;
  }

  /**
   * Remove duplicates and filter existing triggers
   * @param {Array} suggestions - Raw suggestions
   * @param {Array} existingTriggers - Existing triggers to exclude
   * @returns {Array} - Filtered suggestions
   */
  deduplicateAndFilter(suggestions, existingTriggers) {
    const seen = new Set();
    const existingSet = new Set(
      existingTriggers.map(t => 
        typeof t === 'string' ? t.toLowerCase().trim() : t.trigger.toLowerCase().trim()
      )
    );

    const filtered = [];

    for (const suggestion of suggestions) {
      const normalizedText = suggestion.text.toLowerCase().trim();
      
      // Skip if already seen or exists in company triggers
      if (seen.has(normalizedText) || existingSet.has(normalizedText)) {
        continue;
      }

      seen.add(normalizedText);
      filtered.push(suggestion);
    }

    return filtered;
  }

  /**
   * Suggest variations for multiple triggers (batch)
   * @param {Array} triggers - Array of triggers
   * @param {Array} existingTriggers - All existing triggers
   * @returns {Array} - Suggestions for each trigger
   */
  batchSuggest(triggers, existingTriggers = []) {
    return triggers.map(trigger => ({
      trigger,
      ...this.suggestVariations(trigger, existingTriggers)
    }));
  }

  /**
   * Analyze coverage gaps in instant responses
   * @param {Array} instantResponses - Company's instant responses
   * @returns {Object} - Coverage analysis with suggestions
   */
  analyzeCoverage(instantResponses) {
    const categories = {};
    const allTriggers = instantResponses.map(r => r.trigger);

    // Group by category
    for (const response of instantResponses) {
      const category = response.category || 'other';
      if (!categories[category]) {
        categories[category] = [];
      }
      categories[category].push(response.trigger);
    }

    // Analyze each category
    const analysis = {};
    for (const [category, triggers] of Object.entries(categories)) {
      const coverage = this.calculateCategoryCoverage(category, triggers);
      analysis[category] = {
        triggerCount: triggers.length,
        coverage: coverage.score,
        missingVariations: coverage.missing,
        suggestions: this.suggestForCategory(category, allTriggers)
      };
    }

    return {
      totalResponses: instantResponses.length,
      categoriesConfigured: Object.keys(categories).length,
      categoryAnalysis: analysis,
      overallCoverage: this.calculateOverallCoverage(analysis)
    };
  }

  /**
   * Calculate coverage for a category
   * @param {String} category - Response category
   * @param {Array} triggers - Triggers in this category
   * @returns {Object} - Coverage score and missing variations
   */
  calculateCategoryCoverage(category, triggers) {
    const canonical = variations.findCanonical(category) || category;
    const allVariations = variations.getAllVariations(canonical);
    
    if (allVariations.length === 0) {
      return { score: 1.0, missing: [] };
    }

    const triggerSet = new Set(
      triggers.map(t => t.toLowerCase().trim())
    );

    const missing = allVariations.filter(v => !triggerSet.has(v));
    const coverage = 1 - (missing.length / allVariations.length);

    return { score: coverage, missing: missing.slice(0, 10) };
  }

  /**
   * Suggest variations for a specific category
   * @param {String} category - Category to suggest for
   * @param {Array} existingTriggers - All existing triggers
   * @returns {Array} - Category-specific suggestions
   */
  suggestForCategory(category, existingTriggers) {
    const canonical = variations.findCanonical(category) || category;
    const allVariations = variations.getAllVariations(canonical);
    
    return this.deduplicateAndFilter(
      allVariations.map(v => ({
        text: v,
        type: 'category_variation',
        confidence: 0.85,
        reason: `Common variation for ${category}`
      })),
      existingTriggers
    ).slice(0, 5);
  }

  /**
   * Calculate overall coverage score
   * @param {Object} analysis - Category analysis
   * @returns {Number} - Overall coverage (0-1)
   */
  calculateOverallCoverage(analysis) {
    const scores = Object.values(analysis).map(a => a.coverage);
    if (scores.length === 0) return 0;
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }
}

// Export singleton instance
module.exports = new VariationSuggestionEngine();
