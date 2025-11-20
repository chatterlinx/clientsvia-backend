/**
 * AI-Powered Keyword Generation Service
 * V2-grade natural language processing for Q&A optimization
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

// V2 DELETED: Legacy natural NLP library - using V2 keyword-based system
// const natural = require('natural');
const stopwords = require('stopwords').english;
const logger = require('../../utils/logger.js');


class KeywordGenerationService {
  constructor() {
    this.version = '2.0.0';
    // V2 DELETED: Legacy natural NLP library - using V2 keyword-based system
    // this.stemmer = natural.PorterStemmer;
    // this.tokenizer = new natural.WordTokenizer();
    
    // Initialize trade-specific dictionaries
    this.tradeDictionaries = this.initializeTradeDictionaries();
    this.intentPatterns = this.initializeIntentPatterns();
    this.synonymMaps = this.initializeSynonymMaps();
    this.technicalTerms = this.initializeTechnicalTerms();
  }

  /**
   * 🚀 V3 MAIN KEYWORD GENERATION METHOD
   * Generates FOCUSED, HIGH-QUALITY keywords for precise matching
   * 
   * 🎯 V3 PHILOSOPHY:
   * - LESS IS MORE: 5-8 laser-focused keywords > 15 generic ones
   * - PHRASE EXTRACTION: "how much" > "how" + "much"
   * - INTENT-SPECIFIC: Pricing keywords for pricing Q&As ONLY
   * - NO POLLUTION: No generic keywords that match everything
   */
  async generateAdvancedKeywords(question, answer, context = {}) {
    const combinedText = `${question} ${answer}`.toLowerCase();
    const questionLower = question.toLowerCase();
    const answerLower = answer.toLowerCase();
    const { tradeCategories = [], companyName = '', businessType = '' } = context;
    
    logger.debug('🧠 V3 Advanced keyword generation started...');
    logger.debug('📝 Question:', question);
    logger.debug('📝 Answer:', answer);
    
    // 🎯 STEP 1: Extract EXACT phrases from question (HIGHEST PRIORITY!)
    const exactPhrases = this.extractExactPhrases(questionLower);
    logger.debug('✅ Exact phrases:', exactPhrases);
    
    // 🎯 STEP 2: Detect Q&A intent (pricing, hours, location, etc.)
    const qnaIntent = this.detectQnAIntent(questionLower, answerLower);
    logger.debug('✅ Q&A Intent:', qnaIntent);
    
    // 🎯 STEP 3: Get FOCUSED keywords for this specific intent
    const intentKeywords = this.getFocusedIntentKeywords(qnaIntent, questionLower, answerLower);
    logger.debug('✅ Intent keywords:', intentKeywords);
    
    // 🎯 STEP 4: Extract important nouns/verbs (ONLY if length > 3 chars)
    const importantWords = this.extractImportantWords(questionLower, answerLower);
    logger.security('✅ Important words:', importantWords);
    
    // 🎯 STEP 5: Technical terms ONLY (if relevant to trade)
    const technical = this.extractTechnicalTerms(this.cleanAndTokenize(combinedText), tradeCategories);
    logger.security('✅ Technical terms:', technical);
    
    // 🎯 STEP 6: Combine with STRICT DEDUPLICATION
    const allKeywords = [
      ...exactPhrases,        // Highest priority: exact phrases
      ...intentKeywords,      // Intent-specific keywords
      ...importantWords,      // Important words from Q&A
      ...technical            // Technical terms (if relevant)
    ];
    
    // 🎯 STEP 7: STRICT FILTERING - Remove duplicates, generic words, and pollutants
    const cleanedKeywords = this.strictFilter(allKeywords, qnaIntent);
    logger.debug('✅ After strict filter:', cleanedKeywords);
    
    // 🎯 STEP 8: Rank by relevance and limit to TOP 10
    const rankedKeywords = this.rankKeywordsByRelevance(cleanedKeywords, questionLower, answerLower);
    const finalKeywords = rankedKeywords.slice(0, 10); // MAX 10 keywords for precision + coverage
    
    const result = {
      primary: finalKeywords,
      entities: [],
      technical: technical.slice(0, 3),
      intent: [qnaIntent],
      semantic: intentKeywords.slice(0, 5),
      confidence: this.calculateConfidence(finalKeywords, combinedText)
    };
    
    logger.info('✅ FINAL KEYWORDS (Top 10):', result.primary);
    
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
    
    // V2 SYSTEM: Simple word splitting instead of natural tokenizer
    const tokens = cleaned.toLowerCase().split(/\s+/).filter(word => word.length > 0);
    
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
   * 🔄 ENHANCED SEMANTIC VARIATION GENERATION
   * V2 ENHANCED: Much stronger semantic understanding for AI agent
   */
  generateSemanticVariations(tokens) {
    const variations = new Set();
    
    tokens.forEach(token => {
      // ✅ Add the original token (most important!)
      if (token.length >= 2) {
        variations.add(token);
      }
      
      // 🚀 ENHANCED: Add comprehensive synonyms
      const synonyms = this.getEnhancedSynonyms(token);
      synonyms.forEach(synonym => variations.add(synonym));
      
      // 🚀 ENHANCED: Add contextual variations
      const contextual = this.getContextualVariations(token);
      contextual.forEach(variation => variations.add(variation));
      
      // 🚀 ENHANCED: Add question/answer variations
      const questionVariations = this.getQuestionVariations(token);
      questionVariations.forEach(variation => variations.add(variation));
      
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
   * 🚀 ENHANCED SYNONYM GENERATION
   * V2 ENHANCED: Comprehensive synonym mapping for better AI matching
   */
  getEnhancedSynonyms(token) {
    const enhancedSynonyms = {
      // Time/Schedule related
      hours: ['schedule', 'time', 'availability', 'open', 'operating', 'business'],
      open: ['available', 'operating', 'working', 'hours', 'schedule'],
      schedule: ['hours', 'time', 'availability', 'calendar', 'timing'],
      time: ['hours', 'schedule', 'when', 'availability'],
      when: ['hours', 'time', 'schedule', 'what time'],
      
      // Business related
      business: ['company', 'service', 'work', 'commercial', 'professional'],
      service: ['work', 'repair', 'fix', 'help', 'assistance'],
      company: ['business', 'service', 'firm', 'contractor'],
      work: ['service', 'job', 'repair', 'fix', 'help'],
      
      // Contact related
      phone: ['call', 'number', 'contact', 'reach', 'telephone'],
      call: ['phone', 'contact', 'reach', 'number'],
      contact: ['call', 'phone', 'reach', 'get hold'],
      
      // Location related
      location: ['address', 'where', 'place', 'site', 'area'],
      address: ['location', 'where', 'place', 'directions'],
      where: ['location', 'address', 'place', 'directions'],
      
      // Cost related
      cost: ['price', 'charge', 'fee', 'rate', 'expense'],
      price: ['cost', 'charge', 'fee', 'rate', 'how much'],
      charge: ['cost', 'price', 'fee', 'rate'],
      fee: ['cost', 'price', 'charge', 'rate'],
      
      // Emergency related
      emergency: ['urgent', 'immediate', 'asap', 'rush', 'critical'],
      urgent: ['emergency', 'immediate', 'asap', 'rush'],
      immediate: ['urgent', 'emergency', 'asap', 'now'],
      
      // Common question words
      what: ['which', 'how', 'tell me'],
      how: ['what', 'which', 'tell me'],
      can: ['able', 'possible', 'do you'],
      do: ['can', 'will', 'able'],
      will: ['can', 'do', 'able']
    };
    
    return enhancedSynonyms[token] || [];
  }

  /**
   * 🚀 CONTEXTUAL VARIATIONS
   * V2 ENHANCED: Generate contextual variations based on business context
   */
  getContextualVariations(token) {
    const contextualMaps = {
      hours: ['business hours', 'operating hours', 'open hours', 'work hours', 'service hours'],
      open: ['hours open', 'when open', 'open time', 'availability'],
      schedule: ['work schedule', 'business schedule', 'operating schedule'],
      service: ['services offered', 'what services', 'service types'],
      price: ['pricing', 'cost estimate', 'how much cost', 'rates'],
      location: ['where located', 'address', 'directions to'],
      contact: ['contact info', 'how to contact', 'reach you'],
      emergency: ['emergency service', 'urgent repair', 'after hours']
    };
    
    return contextualMaps[token] || [];
  }

  /**
   * 🚀 QUESTION VARIATIONS
   * V2 ENHANCED: Generate natural question variations
   */
  getQuestionVariations(token) {
    const questionMaps = {
      hours: ['what are your hours', 'when are you open', 'what time open', 'hours of operation'],
      open: ['are you open', 'when open', 'what time open', 'hours open'],
      service: ['what services', 'services offered', 'what do you do', 'types of service'],
      price: ['how much', 'what cost', 'pricing info', 'cost estimate'],
      location: ['where are you', 'your address', 'how to find you'],
      contact: ['how to contact', 'phone number', 'how to reach'],
      emergency: ['emergency service', 'after hours', 'urgent help']
    };
    
    return questionMaps[token] || [];
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
    if (keyword.length >= 8) {return 1.0;}
    if (keyword.length >= 6) {return 0.8;}
    if (keyword.length >= 4) {return 0.6;}
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
    // Trade keywords are now loaded from company.aiAgentSettings.keywordConfiguration.tradeSpecificKeywords per multi-tenant requirements
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
      open: ['hours', 'schedule', 'available'],
      monday: ['weekday', 'business day'],
      address: ['location', 'directions', 'where'],
      phone: ['number', 'contact', 'call'],
      price: ['cost', 'pricing', 'rate'],
      service: ['work', 'job', 'repair'],
      emergency: ['urgent', 'immediate', 'asap'],
      fort: ['ft'],
      myers: ['florida', 'fl'],
      market: ['street', 'st']
    };
    
    return businessTerms[token] || [];
  }
  
  /**
   * 🎯 V3: EXTRACT EXACT PHRASES FROM QUESTION
   * Captures 2-3 word phrases that are highly specific
   */
  extractExactPhrases(question) {
    const phrases = new Set();
    // Strip punctuation from question for cleaner keywords
    const cleanQuestion = question.replace(/[?!.,;:]/g, '').toLowerCase();
    const words = cleanQuestion.split(/\s+/).filter(w => w.length > 0);
    
    // 🚀 BLACKLIST: Generic 2-word phrases that pollute search
    const genericPhraseBlacklist = [
      'can you', 'do you', 'are you', 'will you', 'would you',
      'you help', 'you provide', 'you offer', 'you have', 'you service',
      'are your', 'is your', 'does your', 'do your',
      'we have', 'we are', 'we offer', 'we provide',
      'what are', 'what is', 'how are', 'where are', 'when are'
    ];
    
    // 2-word phrases
    for (let i = 0; i < words.length - 1; i++) {
      const phrase = `${words[i]} ${words[i + 1]}`;
      // Only add if not pure stopwords AND not in generic blacklist
      if (!this.isPureStopwords(phrase) && !genericPhraseBlacklist.includes(phrase)) {
        phrases.add(phrase);
      }
    }
    
    // 3-word phrases for questions starting with "how much", "what are", etc.
    for (let i = 0; i < words.length - 2; i++) {
      const phrase = `${words[i]} ${words[i + 1]} ${words[i + 2]}`;
      if (this.isValuablePhrase(phrase)) {
        phrases.add(phrase);
      }
    }
    
    return [...phrases];
  }
  
  /**
   * 🎯 V3: DETECT Q&A INTENT (FOCUSED)
   * Returns ONE specific intent, not multiple
   */
  detectQnAIntent(question, answer) {
    const combined = `${question} ${answer}`;
    
    // Priority order: Most specific first
    if (/\b(how much|cost|price|charge|fee|rate|\$|dollar|expensive|cheap)\b/.test(combined)) {
      return 'pricing';
    }
    if (/\b(hours|open|closed|schedule|when|time|availability|operating)\b/.test(combined)) {
      return 'hours';
    }
    if (/\b(where|location|address|directions|area|service area|city|county)\b/.test(combined)) {
      return 'location';
    }
    if (/\b(emergency|urgent|24\/7|after hours|asap|immediate)\b/.test(combined)) {
      return 'emergency';
    }
    if (/\b(water pressure|leak|drain|clog|pipe|sewer|faucet|toilet)\b/.test(combined)) {
      return 'plumbing';
    }
    if (/\b(ac|air conditioning|hvac|heat|furnace|thermostat|cooling|heating)\b/.test(combined)) {
      return 'hvac';
    }
    if (/\b(install|installation|new|setup|replace|replacement)\b/.test(combined)) {
      return 'installation';
    }
    if (/\b(repair|fix|broken|not working|problem|issue)\b/.test(combined)) {
      return 'repair';
    }
    if (/\b(appointment|schedule|book|reservation|available)\b/.test(combined)) {
      return 'scheduling';
    }
    
    return 'general';
  }
  
  /**
   * 🎯 V3: GET FOCUSED INTENT KEYWORDS
   * Returns ONLY keywords relevant to this specific intent
   */
  getFocusedIntentKeywords(intent, question, answer) {
    const focused = {
      pricing: ['cost', 'price', 'how much', 'charge', 'fee', 'rate', 'pricing'],
      hours: ['hours', 'open', 'schedule', 'time', 'when', 'availability'],
      location: ['where', 'location', 'address', 'area', 'service area'],
      emergency: ['emergency', 'urgent', '24/7', 'immediate', 'after hours'],
      plumbing: ['plumbing', 'water', 'leak', 'drain', 'pipe'],
      hvac: ['hvac', 'ac', 'air conditioning', 'heat', 'heating', 'cooling'],
      installation: ['install', 'installation', 'new', 'setup'],
      repair: ['repair', 'fix', 'broken', 'problem'],
      scheduling: ['appointment', 'schedule', 'book', 'available'],
      general: []
    };
    
    const keywords = new Set();
    const intentKeywords = focused[intent] || [];
    
    // Only add keywords that ACTUALLY appear in question or answer
    intentKeywords.forEach(keyword => {
      if (question.includes(keyword) || answer.includes(keyword)) {
        keywords.add(keyword);
      }
    });
    
    return [...keywords];
  }
  
  /**
   * 🎯 V3: EXTRACT IMPORTANT WORDS (NOUNS/VERBS ONLY)
   * Filters out generic words like "service", "calls", etc. unless intent-specific
   * 🚀 V3.1: Now extracts CRITICAL answer keywords separately for higher priority
   */
  extractImportantWords(question, answer) {
    const words = new Set();
    
    // Blacklist: Generic words that pollute keyword matching
    const genericBlacklist = [
      'help', 'can', 'you', 'your', 'our', 'are', 'have', 'has', 
      'get', 'make', 'does', 'will', 'would', 'could', 'should', 
      'may', 'might', 'must', 'shall', 'the', 'and', 'for', 'with', 
      'from', 'about', 'into', 'through', 'that', 'this', 'these', 'those'
    ];
    
    // 🎯 CRITICAL: Extract single-word keywords from QUESTION (highest priority)
    const questionTokens = question.toLowerCase().replace(/[?!.,;:]/g, '').split(/\s+/);
    questionTokens.forEach(token => {
      if (token.length >= 3 && !genericBlacklist.includes(token) && !/^\d+$/.test(token)) {
        words.add(token);
      }
    });
    
    // 🎯 CRITICAL: Extract single-word keywords from ANSWER (important details!)
    const answerTokens = answer.toLowerCase().replace(/[?!.,;:]/g, '').split(/\s+/);
    answerTokens.forEach(token => {
      if (token.length >= 3 && !genericBlacklist.includes(token) && !/^\d+$/.test(token)) {
        words.add(token);
      }
    });
    
    // 🎯 SPECIAL: Extract numbers and prices (like "$89", "1-2 hours")
    const priceMatches = answer.match(/\$\d+/g) || [];
    priceMatches.forEach(price => words.add(price));
    
    const timeMatches = answer.match(/\d+-\d+\s+(hours?|minutes?|days?)/gi) || [];
    timeMatches.forEach(time => words.add(time.toLowerCase()));
    
    return [...words];
  }
  
  /**
   * 🎯 V3: STRICT FILTER
   * Removes duplicates, substrings, and intent-polluting keywords
   */
  strictFilter(keywords, intent) {
    const unique = [...new Set(keywords)]; // Deduplicate
    const filtered = [];
    
    for (const keyword of unique) {
      // Skip if empty or too short
      if (!keyword || keyword.trim().length < 2) {continue;}
      
      // Skip if it's a substring of another keyword already added
      const isSubstring = filtered.some(existing => 
        existing.includes(keyword) && existing !== keyword
      );
      if (isSubstring) {continue;}
      
      // Skip generic pollutants
      const pollutants = ['what', 'how', 'can', 'you', 'your', 'our', 'are', 'the'];
      if (pollutants.includes(keyword)) {continue;}
      
      filtered.push(keyword.trim());
    }
    
    return filtered;
  }
  
  /**
   * 🎯 V3: RANK KEYWORDS BY RELEVANCE
   * Prioritizes exact matches in question, then answer, then length
   */
  rankKeywordsByRelevance(keywords, question, answer) {
    const scored = keywords.map(keyword => {
      let score = 0;
      
      // Highest priority: appears in question
      if (question.includes(keyword)) {score += 10;}
      
      // Medium priority: appears in answer
      if (answer.includes(keyword)) {score += 5;}
      
      // Phrase bonus: multi-word keywords are more specific
      if (keyword.includes(' ')) {score += 8;}
      
      // Length bonus: longer keywords are more specific
      score += Math.min(keyword.length / 2, 5);
      
      return { keyword, score };
    });
    
    return scored
      .sort((a, b) => b.score - a.score)
      .map(item => item.keyword);
  }
  
  /**
   * 🎯 V3: CHECK IF PHRASE IS PURE STOPWORDS
   */
  isPureStopwords(phrase) {
    const stopwords = ['the', 'and', 'or', 'but', 'for', 'with', 'from', 'are', 'is', 'was', 'were'];
    const words = phrase.split(' ');
    return words.every(w => stopwords.includes(w));
  }
  
  /**
   * 🎯 V3: CHECK IF PHRASE IS VALUABLE (FOR 3-WORD PHRASES)
   */
  isValuablePhrase(phrase) {
    const valuablePhrases = [
      'how much are', 'what are your', 'can you help', 'do you have',
      'where are you', 'when are you', 'what time do', 'how long does'
    ];
    return valuablePhrases.some(vp => phrase.startsWith(vp));
  }
}

module.exports = KeywordGenerationService;
