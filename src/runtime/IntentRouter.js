/**
 * IntentRouter.js - Keyword-based intent routing system
 * 
 * Routes user input to appropriate handlers based on detected intent:
 * - booking: Schedule appointments
 * - hours: Business hours inquiry
 * - transfer: Request human transfer
 * - qa: Knowledge base questions
 * - emergency: Urgent service requests
 * - cancel: Cancel existing bookings
 */

const Company = require('../../models/Company');

class IntentRouter {
  /**
   * Route user input to appropriate intent and handler
   * @param {string} companyID - Company identifier
   * @param {string} text - User input text
   * @param {Object} context - Additional context (call state, history, etc.)
   * @returns {Object} Routing result with intent and confidence
   */
  static async route(companyID, text, context = {}) {
    try {
      const company = await Company.findById(companyID);
      if (!company?.aiAgentLogic?.intentRouting) {
        // Fallback to basic intent detection if not configured
        return this.detectBasicIntent(text, context);
      }

      const intentConfig = company.aiAgentLogic.intentRouting;
      const normalizedText = text.toLowerCase().trim();
      
      // Check each configured intent
      for (const intent of intentConfig.intents || []) {
        const score = this.calculateIntentScore(intent, normalizedText, context);
        
        if (score >= (intent.threshold || 0.7)) {
          return {
            intent: intent.name,
            confidence: score,
            handler: intent.handler,
            parameters: this.extractParameters(intent, normalizedText),
            config: intent
          };
        }
      }

      // Fallback intent detection
      const fallbackResult = this.detectBasicIntent(text, context);
      
      return {
        ...fallbackResult,
        isFallback: true
      };
      
    } catch (error) {
      console.error('Error in intent routing:', error);
      return {
        intent: 'qa',
        confidence: 0.5,
        handler: 'knowledge',
        error: error.message
      };
    }
  }

  /**
   * Calculate intent score based on keywords and patterns
   * @param {Object} intent - Intent configuration
   * @param {string} text - Normalized user text
   * @param {Object} context - Additional context
   * @returns {number} Confidence score (0-1)
   */
  static calculateIntentScore(intent, text, context) {
    let score = 0;
    let matchCount = 0;
    const totalFactors = 4; // keywords, phrases, patterns, context

    // 1. Keyword matching (25% weight)
    if (intent.keywords && intent.keywords.length > 0) {
      const keywordMatches = intent.keywords.filter(keyword => 
        text.includes(keyword.toLowerCase())
      ).length;
      
      const keywordScore = Math.min(keywordMatches / intent.keywords.length, 1) * 0.25;
      score += keywordScore;
      
      if (keywordMatches > 0) matchCount++;
    }

    // 2. Phrase matching (35% weight)
    if (intent.phrases && intent.phrases.length > 0) {
      const phraseMatches = intent.phrases.filter(phrase => 
        text.includes(phrase.toLowerCase())
      ).length;
      
      const phraseScore = Math.min(phraseMatches / intent.phrases.length, 1) * 0.35;
      score += phraseScore;
      
      if (phraseMatches > 0) matchCount++;
    }

    // 3. Pattern matching (25% weight)
    if (intent.patterns && intent.patterns.length > 0) {
      const patternMatches = intent.patterns.filter(pattern => {
        try {
          const regex = new RegExp(pattern, 'i');
          return regex.test(text);
        } catch (e) {
          return false;
        }
      }).length;
      
      const patternScore = Math.min(patternMatches / intent.patterns.length, 1) * 0.25;
      score += patternScore;
      
      if (patternMatches > 0) matchCount++;
    }

    // 4. Context boosting (15% weight)
    if (intent.contextBoosts && context) {
      let contextScore = 0;
      
      // Time-based context
      if (intent.contextBoosts.timeOfDay) {
        const hour = new Date().getHours();
        if (this.isInTimeRange(hour, intent.contextBoosts.timeOfDay)) {
          contextScore += 0.05;
        }
      }
      
      // Call history context
      if (intent.contextBoosts.previousIntent && context.previousIntent === intent.contextBoosts.previousIntent) {
        contextScore += 0.05;
      }
      
      // Emotion context
      if (intent.contextBoosts.emotion && context.detectedEmotion === intent.contextBoosts.emotion) {
        contextScore += 0.05;
      }
      
      score += Math.min(contextScore, 0.15);
      
      if (contextScore > 0) matchCount++;
    }

    // Apply minimum match requirement
    const minMatches = intent.minMatches || 1;
    if (matchCount < minMatches) {
      score = 0;
    }

    return Math.min(score, 1);
  }

  /**
   * Extract parameters from user text based on intent configuration
   * @param {Object} intent - Intent configuration
   * @param {string} text - User input text
   * @returns {Object} Extracted parameters
   */
  static extractParameters(intent, text) {
    const parameters = {};
    
    if (!intent.parameters) return parameters;
    
    for (const param of intent.parameters) {
      const value = this.extractParameter(param, text);
      if (value !== null) {
        parameters[param.name] = value;
      }
    }
    
    return parameters;
  }

  /**
   * Extract single parameter value
   * @param {Object} param - Parameter configuration
   * @param {string} text - User input text
   * @returns {*} Extracted value or null
   */
  static extractParameter(param, text) {
    switch (param.type) {
      case 'time':
        return this.extractTimeParameter(text, param);
      case 'date':
        return this.extractDateParameter(text, param);
      case 'service':
        return this.extractServiceParameter(text, param);
      case 'urgency':
        return this.extractUrgencyParameter(text, param);
      case 'number':
        return this.extractNumberParameter(text, param);
      case 'confirmation':
        return this.extractConfirmationParameter(text, param);
      default:
        return this.extractTextParameter(text, param);
    }
  }

  /**
   * Basic intent detection fallback
   * @param {string} text - User input
   * @param {Object} context - Context
   * @returns {Object} Intent result
   */
  static detectBasicIntent(text, context) {
    const normalizedText = text.toLowerCase();
    
    // Booking intent keywords
    const bookingKeywords = [
      'schedule', 'appointment', 'book', 'reserve', 'set up',
      'need service', 'fix', 'repair', 'install', 'maintenance',
      'come out', 'send someone', 'visit'
    ];
    
    // Hours intent keywords
    const hoursKeywords = [
      'hours', 'open', 'closed', 'business hours', 'what time',
      'when are you', 'operating hours', 'available'
    ];
    
    // Transfer intent keywords
    const transferKeywords = [
      'human', 'person', 'representative', 'agent', 'manager',
      'supervisor', 'talk to someone', 'speak to', 'transfer'
    ];
    
    // Emergency intent keywords
    const emergencyKeywords = [
      'emergency', 'urgent', 'asap', 'immediately', 'right now',
      'no heat', 'no hot water', 'leak', 'flooding', 'broken'
    ];
    
    // Cancel intent keywords
    const cancelKeywords = [
      'cancel', 'reschedule', 'change appointment', 'move appointment',
      'different time', 'not available'
    ];
    
    // Check for emergency first (highest priority)
    if (this.containsKeywords(normalizedText, emergencyKeywords)) {
      return {
        intent: 'emergency',
        confidence: 0.9,
        handler: 'emergency',
        priority: 'urgent'
      };
    }
    
    // Check for transfer request
    if (this.containsKeywords(normalizedText, transferKeywords)) {
      return {
        intent: 'transfer',
        confidence: 0.85,
        handler: 'transfer'
      };
    }
    
    // Check for booking
    if (this.containsKeywords(normalizedText, bookingKeywords)) {
      return {
        intent: 'booking',
        confidence: 0.8,
        handler: 'booking'
      };
    }
    
    // Check for cancel/reschedule
    if (this.containsKeywords(normalizedText, cancelKeywords)) {
      return {
        intent: 'cancel',
        confidence: 0.8,
        handler: 'booking_management'
      };
    }
    
    // Check for hours inquiry
    if (this.containsKeywords(normalizedText, hoursKeywords)) {
      return {
        intent: 'hours',
        confidence: 0.75,
        handler: 'information'
      };
    }
    
    // Default to QA
    return {
      intent: 'qa',
      confidence: 0.6,
      handler: 'knowledge'
    };
  }

  /**
   * Check if text contains any of the given keywords
   * @param {string} text - Text to check
   * @param {Array} keywords - Keywords to look for
   * @returns {boolean} True if any keyword is found
   */
  static containsKeywords(text, keywords) {
    return keywords.some(keyword => text.includes(keyword.toLowerCase()));
  }

  /**
   * Extract time parameter
   */
  static extractTimeParameter(text, param) {
    const timePatterns = [
      /(\d{1,2}):(\d{2})\s*(am|pm)/i,
      /(\d{1,2})\s*(am|pm)/i,
      /(\d{1,2}):(\d{2})/
    ];

    for (const pattern of timePatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[0];
      }
    }
    
    return null;
  }

  /**
   * Extract date parameter
   */
  static extractDateParameter(text, param) {
    const dateKeywords = {
      'today': 0,
      'tomorrow': 1,
      'monday': this.getDaysUntilWeekday(1),
      'tuesday': this.getDaysUntilWeekday(2),
      'wednesday': this.getDaysUntilWeekday(3),
      'thursday': this.getDaysUntilWeekday(4),
      'friday': this.getDaysUntilWeekday(5),
      'saturday': this.getDaysUntilWeekday(6),
      'sunday': this.getDaysUntilWeekday(0)
    };

    for (const [keyword, daysOffset] of Object.entries(dateKeywords)) {
      if (text.includes(keyword)) {
        const date = new Date();
        date.setDate(date.getDate() + daysOffset);
        return date.toISOString().split('T')[0];
      }
    }

    return null;
  }

  /**
   * Extract service type parameter
   */
  static extractServiceParameter(text, param) {
    const serviceKeywords = {
      'hvac': ['hvac', 'heating', 'cooling', 'air conditioning', 'ac', 'furnace'],
      'plumbing': ['plumbing', 'plumber', 'pipe', 'toilet', 'sink', 'water', 'leak'],
      'electrical': ['electrical', 'electrician', 'electric', 'wiring', 'outlet', 'breaker'],
      'appliance': ['appliance', 'washer', 'dryer', 'dishwasher', 'refrigerator', 'oven']
    };

    for (const [service, keywords] of Object.entries(serviceKeywords)) {
      if (keywords.some(keyword => text.includes(keyword))) {
        return service;
      }
    }

    return null;
  }

  /**
   * Extract urgency parameter
   */
  static extractUrgencyParameter(text, param) {
    if (text.includes('emergency') || text.includes('urgent') || text.includes('asap')) {
      return 'urgent';
    } else if (text.includes('soon') || text.includes('quickly')) {
      return 'high';
    } else if (text.includes('no rush') || text.includes('whenever')) {
      return 'low';
    }
    
    return 'normal';
  }

  /**
   * Extract number parameter
   */
  static extractNumberParameter(text, param) {
    const numberMatch = text.match(/\d+/);
    return numberMatch ? parseInt(numberMatch[0]) : null;
  }

  /**
   * Extract confirmation parameter
   */
  static extractConfirmationParameter(text, param) {
    const yesKeywords = ['yes', 'yeah', 'yep', 'correct', 'right', 'confirm', 'ok', 'okay'];
    const noKeywords = ['no', 'nope', 'incorrect', 'wrong', 'cancel'];
    
    const normalized = text.toLowerCase();
    
    if (yesKeywords.some(keyword => normalized.includes(keyword))) {
      return true;
    } else if (noKeywords.some(keyword => normalized.includes(keyword))) {
      return false;
    }
    
    return null;
  }

  /**
   * Extract text parameter
   */
  static extractTextParameter(text, param) {
    if (param.pattern) {
      try {
        const regex = new RegExp(param.pattern, 'i');
        const match = text.match(regex);
        return match ? match[1] || match[0] : null;
      } catch (e) {
        return text.trim();
      }
    }
    
    return text.trim();
  }

  /**
   * Check if current time is in specified range
   */
  static isInTimeRange(hour, timeRange) {
    if (!timeRange || !Array.isArray(timeRange) || timeRange.length !== 2) {
      return false;
    }
    
    const [start, end] = timeRange;
    return hour >= start && hour <= end;
  }

  /**
   * Get days until next occurrence of weekday
   */
  static getDaysUntilWeekday(targetDay) {
    const today = new Date().getDay();
    const daysUntil = (targetDay - today + 7) % 7;
    return daysUntil === 0 ? 7 : daysUntil; // If today, return next week
  }

  /**
   * Get intent confidence threshold for routing decision
   * @param {string} companyID - Company identifier
   * @returns {number} Confidence threshold
   */
  static async getConfidenceThreshold(companyID) {
    try {
      const company = await Company.findById(companyID);
      return company?.aiAgentLogic?.intentRouting?.globalThreshold || 0.7;
    } catch (error) {
      return 0.7; // Default threshold
    }
  }

  /**
   * Log intent routing for analytics
   * @param {string} companyID - Company identifier
   * @param {string} text - User input
   * @param {Object} result - Routing result
   */
  static async logIntentRouting(companyID, text, result) {
    try {
      // This could be enhanced to log to analytics service
      console.log(`Intent routing [${companyID}]: "${text}" -> ${result.intent} (${result.confidence})`);
    } catch (error) {
      console.error('Error logging intent routing:', error);
    }
  }

  /**
   * Get intent routing statistics
   * @param {string} companyID - Company identifier
   * @param {Object} dateRange - Date range for statistics
   * @returns {Object} Intent statistics
   */
  static async getIntentStatistics(companyID, dateRange = {}) {
    // This would typically query a logging/analytics database
    // For now, return placeholder structure
    return {
      totalRequests: 0,
      intentBreakdown: {
        booking: 0,
        qa: 0,
        hours: 0,
        transfer: 0,
        emergency: 0,
        cancel: 0
      },
      averageConfidence: 0,
      fallbackRate: 0
    };
  }
}

module.exports = {
  route: IntentRouter.route.bind(IntentRouter),
  detectBasicIntent: IntentRouter.detectBasicIntent.bind(IntentRouter),
  IntentRouter
};
