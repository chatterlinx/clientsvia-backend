/**
 * AI-Powered Keyword Generation Service
 * Enterprise-grade natural language processing for Q&A optimization
 * 
 * 🤖 AI AGENT ROUTING REFERENCE - KEYWORD ENGINE:
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║ SEMANTIC MATCHING ENGINE FOR PRIORITY #1 SOURCE                 ║
 * ╠══════════════════════════════════════════════════════════════════╣
 * ║ Purpose: Generate keywords for Company Q&A semantic search      ║
 * ║ Used by: CompanyQnA model (pre-save middleware)                 ║
 * ║ Called by: CompanyKnowledgeService for query matching           ║
 * ║ AI Impact: Keywords enable fast relevance scoring for routing   ║
 * ╚══════════════════════════════════════════════════════════════════╝
 * 
 * 🔧 KEYWORD GENERATION FEATURES:
 * • Named Entity Recognition (NER) → Extract business entities
 * • Technical term extraction → Industry-specific terminology
 * • Intent analysis → Understand question patterns
 * • Semantic variation generation → Handle synonym matching
 * • Trade-specific enhancement → HVAC, Plumbing, etc.
 * 
 * 🚨 CRITICAL FOR AI ROUTING:
 * - Keywords power fast semantic matching in AI agent queries
 * - Quality keywords = better confidence scores = accurate routing
 * - Trade-specific terms enhance industry relevance
 * - Auto-generated on Q&A save via CompanyQnA model middleware
 */

const natural = require('natural');
const stopwords = require('stopwords').english;

class KeywordGenerationService {
  constructor() {
    this.version = '2.0.0';
    this.stemmer = natural.PorterStemmer;
    this.tokenizer = new natural.WordTokenizer();
    
    // Initialize trade-specific dictionaries
    this.tradeDictionaries = this.initializeTradeDictionaries();
    this.intentPatterns = this.initializeIntentPatterns();
    this.synonymMaps = this.initializeSynonymMaps();
    this.technicalTerms = this.initializeTechnicalTerms();
  }

  /**
   * 🚀 MAIN KEYWORD GENERATION METHOD
   * Generates comprehensive keywords using multiple AI techniques
   */
  async generateAdvancedKeywords(question, answer, context = {}) {
    const combinedText = `${question} ${answer}`.toLowerCase();
    const { tradeCategories = [], companyName = '', businessType = '' } = context;
    
    console.log('🧠 Advanced keyword generation started...');
    
    // 1. Basic tokenization and cleaning
    const tokens = this.cleanAndTokenize(combinedText);
    
    // 2. Named Entity Recognition
    const entities = this.extractNamedEntities(combinedText, companyName);
    
    // 3. Technical term extraction
    const technical = this.extractTechnicalTerms(tokens, tradeCategories);
    
    // 4. Intent analysis
    const intent = this.analyzeIntent(question);
    
    // 5. Semantic variations
    const semantic = this.generateSemanticVariations(tokens);
    
    // 6. Trade-specific enhancement
    const tradeEnhanced = this.enhanceWithTradeContext(tokens, tradeCategories);
    
    // 7. Combine and rank all keywords
    const allKeywords = [
      ...entities,
      ...technical,
      ...intent,
      ...semantic,
      ...tradeEnhanced
    ];
    
    // 8. Score and filter keywords
    const rankedKeywords = this.rankAndFilterKeywords(allKeywords, combinedText);
    
    const result = {
      primary: rankedKeywords.slice(0, 15), // Top 15 for primary matching
      entities: entities.slice(0, 5),
      technical: technical.slice(0, 5),
      intent: intent.slice(0, 3),
      semantic: semantic.slice(0, 10),
      confidence: this.calculateConfidence(rankedKeywords, combinedText)
    };
    
    console.log('✅ Generated', result.primary.length, 'primary keywords:', result.primary.slice(0, 5));
    
    return result;
  }

  /**
   * 🧹 TOKENIZATION AND CLEANING
   */
  cleanAndTokenize(text) {
    // Remove special characters but keep hyphens and apostrophes
    const cleaned = text
      .replace(/[^\w\s'-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    
    const tokens = this.tokenizer.tokenize(cleaned);
    
    // Filter out stopwords and very short tokens
    return tokens
      .filter(token => 
        token.length >= 2 && 
        !stopwords.includes(token.toLowerCase()) &&
        !/^\d+$/.test(token) // Remove pure numbers
      )
      .map(token => token.toLowerCase());
  }

  /**
   * 🏷️ NAMED ENTITY RECOGNITION
   */
  extractNamedEntities(text, companyName = '') {
    const entities = new Set();
    
    // Extract brand names and product models
    const brandPatterns = [
      /\b(carrier|trane|lennox|goodman|rheem|american standard|york|daikin|mitsubishi|lg|samsung)\b/gi,
      /\b(kohler|moen|delta|american standard|grohe|hansgrohe|pfister)\b/gi,
      /\b(ge|whirlpool|frigidaire|maytag|kenmore|bosch|kitchenaid)\b/gi
    ];
    
    brandPatterns.forEach(pattern => {
      const matches = text.match(pattern) || [];
      matches.forEach(match => entities.add(match.toLowerCase()));
    });
    
    // Extract model numbers
    const modelPattern = /\b[A-Z]{2,}\d{2,}[A-Z0-9]*\b/g;
    const models = text.match(modelPattern) || [];
    models.forEach(model => entities.add(model.toLowerCase()));
    
    // Add company name variations
    if (companyName) {
      entities.add(companyName.toLowerCase());
      // Add abbreviated version
      const words = companyName.split(' ');
      if (words.length > 1) {
        entities.add(words.map(w => w[0]).join('').toLowerCase());
      }
    }
    
    return [...entities];
  }

  /**
   * 🔧 TECHNICAL TERM EXTRACTION
   */
  extractTechnicalTerms(tokens, tradeCategories = []) {
    const technical = new Set();
    
    // General technical terms
    const generalTechnical = this.technicalTerms.general;
    tokens.forEach(token => {
      if (generalTechnical.includes(token)) {
        technical.add(token);
      }
    });
    
    // Trade-specific terms
    tradeCategories.forEach(trade => {
      const tradeKey = trade.toLowerCase().split(' ')[0]; // 'hvac residential' -> 'hvac'
      const tradeTerms = this.technicalTerms[tradeKey] || [];
      
      tokens.forEach(token => {
        if (tradeTerms.includes(token)) {
          technical.add(token);
        }
      });
    });
    
    // Extract compound technical terms
    const compoundTerms = this.extractCompoundTerms(tokens);
    compoundTerms.forEach(term => technical.add(term));
    
    return [...technical];
  }

  /**
   * 🎯 INTENT ANALYSIS
   */
  analyzeIntent(question) {
    const intent = new Set();
    const lowerQuestion = question.toLowerCase();
    
    // Match intent patterns
    Object.entries(this.intentPatterns).forEach(([intentType, patterns]) => {
      patterns.forEach(pattern => {
        if (pattern.test(lowerQuestion)) {
          intent.add(intentType);
          
          // Add related keywords
          const relatedKeywords = this.getIntentKeywords(intentType);
          relatedKeywords.forEach(keyword => intent.add(keyword));
        }
      });
    });
    
    return [...intent];
  }

  /**
   * 🔄 SEMANTIC VARIATION GENERATION
   * FIXED: Removed broken stemming that corrupted words
   */
  generateSemanticVariations(tokens) {
    const variations = new Set();
    
    tokens.forEach(token => {
      // ✅ FIXED: Add the original token (most important!)
      if (token.length >= 3) {
        variations.add(token);
      }
      
      // Add synonyms if available
      const synonyms = this.synonymMaps[token] || [];
      synonyms.forEach(synonym => variations.add(synonym));
      
      // Add related terms if available
      const related = this.getRelatedTerms(token);
      related.forEach(term => variations.add(term));
      
      // Add common variations for business terms
      const businessVariations = this.getBusinessVariations(token);
      businessVariations.forEach(variation => variations.add(variation));
    });
    
    return [...variations];
  }

  /**
   * 🏭 TRADE CONTEXT ENHANCEMENT
   */
  enhanceWithTradeContext(tokens, tradeCategories = []) {
    const enhanced = new Set();
    
    tradeCategories.forEach(trade => {
      const tradeKey = trade.toLowerCase().split(' ')[0];
      const tradeDictionary = this.tradeDictionaries[tradeKey] || {};
      
      // Add direct trade terms
      const tradeTerms = tradeDictionary.terms || [];
      tradeTerms.forEach(term => {
        if (this.isRelevantToTokens(term, tokens)) {
          enhanced.add(term);
        }
      });
      
      // Add contextual enhancements
      const contextual = tradeDictionary.contextual || {};
      Object.entries(contextual).forEach(([trigger, enhancements]) => {
        if (tokens.includes(trigger)) {
          enhancements.forEach(enhancement => enhanced.add(enhancement));
        }
      });
    });
    
    return [...enhanced];
  }

  /**
   * 📊 KEYWORD RANKING AND FILTERING
   */
  rankAndFilterKeywords(keywords, originalText) {
    // Count frequency and calculate relevance scores
    const keywordScores = new Map();
    
    keywords.forEach(keyword => {
      if (!keywordScores.has(keyword)) {
        const frequency = this.countOccurrences(keyword, originalText);
        const relevance = this.calculateRelevanceScore(keyword, originalText);
        const specificity = this.calculateSpecificityScore(keyword);
        
        const totalScore = (frequency * 0.3) + (relevance * 0.5) + (specificity * 0.2);
        keywordScores.set(keyword, totalScore);
      }
    });
    
    // Sort by score and return top keywords
    return [...keywordScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([keyword]) => keyword)
      .filter(keyword => keyword.length >= 2 && keyword.length <= 30);
  }

  /**
   * 📈 CONFIDENCE CALCULATION
   */
  calculateConfidence(keywords, text) {
    const coverage = keywords.length / Math.max(text.split(' ').length * 0.3, 1);
    const diversity = new Set(keywords.map(k => k[0])).size / 26; // Letter diversity
    const technicalDensity = keywords.filter(k => this.isTechnicalTerm(k)).length / keywords.length;
    
    return Math.min((coverage * 0.4) + (diversity * 0.3) + (technicalDensity * 0.3), 1);
  }

  /**
   * 🎨 CONTENT CATEGORIZATION
   */
  detectCategory(question, answer) {
    const combinedText = `${question} ${answer}`.toLowerCase();
    
    const categoryPatterns = {
      emergency: /\b(emergency|urgent|asap|immediate|critical|broken|not working|flooded)\b/,
      pricing: /\b(cost|price|how much|estimate|quote|expensive|cheap|budget)\b/,
      technical: /\b(install|repair|replace|maintenance|service|troubleshoot|diagnose)\b/,
      scheduling: /\b(appointment|schedule|available|when|time|hours|book)\b/,
      warranty: /\b(warranty|guarantee|covered|claim|protection|policy)\b/,
      policies: /\b(policy|terms|conditions|agreement|contract|rules)\b/
    };
    
    for (const [category, pattern] of Object.entries(categoryPatterns)) {
      if (pattern.test(combinedText)) {
        return category;
      }
    }
    
    return 'general';
  }

  /**
   * 🚨 PRIORITY DETECTION
   */
  detectPriority(question, answer) {
    const combinedText = `${question} ${answer}`.toLowerCase();
    
    if (/\b(emergency|urgent|critical|asap|immediate|flooded|fire|gas leak)\b/.test(combinedText)) {
      return 'critical';
    }
    
    if (/\b(important|priority|soon|broken|not working|problem)\b/.test(combinedText)) {
      return 'high';
    }
    
    if (/\b(maintenance|routine|schedule|general|info|information)\b/.test(combinedText)) {
      return 'low';
    }
    
    return 'normal';
  }

  /**
   * 📚 HELPER METHODS
   */
  countOccurrences(keyword, text) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'gi');
    return (text.match(regex) || []).length;
  }

  calculateRelevanceScore(keyword, text) {
    // More sophisticated relevance calculation
    const position = text.toLowerCase().indexOf(keyword.toLowerCase());
    const positionScore = position === -1 ? 0 : (text.length - position) / text.length;
    const lengthScore = Math.min(keyword.length / 10, 1);
    
    return (positionScore * 0.6) + (lengthScore * 0.4);
  }

  calculateSpecificityScore(keyword) {
    // Longer, more specific terms get higher scores
    if (keyword.length >= 8) return 1.0;
    if (keyword.length >= 6) return 0.8;
    if (keyword.length >= 4) return 0.6;
    return 0.4;
  }

  isTechnicalTerm(keyword) {
    return this.technicalTerms.general.includes(keyword) ||
           Object.values(this.technicalTerms).some(terms => terms.includes(keyword));
  }

  getVersion() {
    return this.version;
  }

  /**
   * 📖 INITIALIZATION METHODS
   */
  initializeTradeDictionaries() {
    // 🚨 REMOVED: Hardcoded trade dictionaries - All trade-specific terms must come from company configuration
    // Trade keywords are now loaded from company.aiAgentLogic.keywordConfiguration.tradeSpecificKeywords per multi-tenant requirements
    return {}; // Empty - trade dictionaries must be configured per company
  }

  initializeIntentPatterns() {
    return {
      repair: [/\b(fix|repair|broken|not working|problem|issue|troubleshoot)\b/i],
      install: [/\b(install|setup|put in|mount|connect|hook up)\b/i],
      replace: [/\b(replace|change|swap|new|upgrade)\b/i],
      maintenance: [/\b(maintain|service|check|clean|tune)\b/i],
      price: [/\b(cost|price|how much|estimate|quote|charge)\b/i],
      schedule: [/\b(schedule|appointment|book|available|when)\b/i],
      emergency: [/\b(emergency|urgent|asap|immediate|critical)\b/i]
    };
  }

  initializeSynonymMaps() {
    return {
      broken: ['damaged', 'not working', 'malfunctioning', 'failed', 'busted'],
      expensive: ['costly', 'pricey', 'high-priced', 'premium'],
      cheap: ['affordable', 'budget', 'low-cost', 'inexpensive'],
      emergency: ['urgent', 'immediate', 'critical', 'asap'],
      install: ['setup', 'mount', 'put in', 'add', 'connect'],
      repair: ['fix', 'restore', 'service', 'maintenance'],
      replace: ['change', 'swap', 'substitute', 'upgrade'],
      hot: ['warm', 'heated', 'temperature'],
      cold: ['cool', 'chilly', 'temperature'],
      noise: ['sound', 'loud', 'noisy'],
      smell: ['odor', 'scent', 'fragrance']
    };
  }

  initializeTechnicalTerms() {
    return {
      general: [
        'system', 'unit', 'equipment', 'device', 'component', 'part',
        'model', 'brand', 'warranty', 'service', 'maintenance', 'inspection'
      ]
    };
  }

  extractCompoundTerms(tokens) {
    const compounds = [];
    
    for (let i = 0; i < tokens.length - 1; i++) {
      const compound = `${tokens[i]} ${tokens[i + 1]}`;
      if (this.isValidCompound(compound)) {
        compounds.push(compound);
      }
    }
    
    return compounds;
  }

  isValidCompound(compound) {
    const validCompounds = [
      'water heater', 'air conditioning', 'heat pump', 'gas line',
      'electrical panel', 'circuit breaker', 'water pressure'
    ];
    
    return validCompounds.includes(compound.toLowerCase());
  }

  getIntentKeywords(intent) {
    const intentKeywords = {
      repair: ['fix', 'broken', 'problem'],
      install: ['new', 'setup', 'installation'],
      replace: ['change', 'old', 'upgrade'],
      maintenance: ['service', 'check', 'routine'],
      price: ['cost', 'estimate', 'budget'],
      schedule: ['appointment', 'time', 'available'],
      emergency: ['urgent', 'immediate', 'critical']
    };
    
    return intentKeywords[intent] || [];
  }

  getRelatedTerms(token) {
    // Simple related terms mapping
    const related = {
      water: ['plumbing', 'pipes', 'leak'],
      heat: ['heating', 'warm', 'temperature'],
      cool: ['cooling', 'cold', 'ac'],
      electric: ['electrical', 'power', 'wiring']
    };
    
    return related[token] || [];
  }

  isRelevantToTokens(term, tokens) {
    // Check if term is contextually relevant to the tokens
    const termWords = term.split(' ');
    return termWords.some(word => tokens.includes(word.toLowerCase()));
  }
  
  /**
   * 🏢 BUSINESS TERM VARIATIONS
   * Generate common business variations without corrupting words
   */
  getBusinessVariations(token) {
    const variations = [];
    
    // Common business term mappings
    const businessTerms = {
      'open': ['hours', 'schedule', 'available'],
      'monday': ['weekday', 'business day'],
      'address': ['location', 'directions', 'where'],
      'phone': ['number', 'contact', 'call'],
      'price': ['cost', 'pricing', 'rate'],
      'service': ['work', 'job', 'repair'],
      'emergency': ['urgent', 'immediate', 'asap'],
      'fort': ['ft'],
      'myers': ['florida', 'fl'],
      'market': ['street', 'st']
    };
    
    return businessTerms[token] || [];
  }
}

module.exports = KeywordGenerationService;
