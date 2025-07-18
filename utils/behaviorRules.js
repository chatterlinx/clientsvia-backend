// utils/behaviorRules.js
// Enhanced AI Behavior Engine for real-time call management with session tracking

const geminiLLM = require('./geminiLLM'); // LLM fallback for advanced sentiment analysis

const defaultBehaviorRules = {
  politeGreeting: true,
  alwaysAcknowledge: true,
  silenceLimitSeconds: 8,
  fallbackResponse: "I'm here to help — how can I assist you today?",
  escalationTriggers: ["talk to a person", "speak to someone", "transfer me", "supervisor", "human"],
  frustrationTriggers: ["frustrated", "frustrating", "this is ridiculous", "angry", "upset", "annoyed", "waited forever", "terrible service"],
  technicianNames: ["Dustin", "Marcello", "Steve"],
  transferToAdvisorOnFrustration: true,
  systemDelayWarningSeconds: 2,
  robotDetectionKeywords: ["are you real", "robot", "machine", "not a human", "fake voice", "automated", "bot"],
  offTopicKeywords: ["viagra", "loan", "politics", "weather", "sports", "unrelated", "spam"],
  repetitionLimit: 3,
  useLLMForSentiment: false,
  afterHours: {
    enabled: true,
    hours: { start: 7, end: 19 }, // 7 AM to 7 PM Eastern
    messageOption: true,
    timezone: "America/New_York"
  },
  maxSilenceWarnings: 2,
  enableSmartEscalation: true,
  conversationTimeout: 300, // 5 minutes
  behaviors: {
    frustrationKeywords: ["frustrated", "annoyed", "upset", "angry", "ridiculous", "terrible"],
    silenceThreshold: 8,
    repetitionLimit: 3,
    offTopicKeywords: ["spam", "unrelated", "politics"],
    useLLMForSentiment: false
  }
};

/**
 * Enhanced behavior evaluation with session tracking and trace logging
 * @param {Object} params - { query, agentSetup, session, context }
 * @returns {Object|null} - Behavior response or null if no behavior detected
 */
async function evaluateBehavior({ query, agentSetup, session = {}, context = {} }) {
  const behaviorsConfig = agentSetup?.behaviors || defaultBehaviorRules.behaviors;
  const traceDetails = [];
  
  // Initialize session tracking
  if (!session.queryHistory) session.queryHistory = [];
  if (!session.silenceCount) session.silenceCount = 0;
  if (!session.frustrationCount) session.frustrationCount = 0;
  
  console.log(`[BEHAVIOR ENGINE] Evaluating query: "${query}" with config:`, behaviorsConfig);
  
  // RULE 1: Frustration Detection (Priority: HIGH)
  const frustrationKeywords = behaviorsConfig.frustrationKeywords || defaultBehaviorRules.frustrationTriggers;
  const hasFrustration = frustrationKeywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()));
  
  if (hasFrustration) {
    const matchedKeywords = frustrationKeywords.filter(kw => query.toLowerCase().includes(kw.toLowerCase()));
    traceDetails.push(`Frustration detected - Keywords: ${matchedKeywords.join(', ')}`);
    session.frustrationCount++;
    
    // Optional LLM sentiment confirmation
    if (behaviorsConfig.useLLMForSentiment) {
      try {
        const sentiment = await geminiLLM.analyzeText(`Analyze sentiment of: "${query}". Is it negative/frustrated? Respond with yes/no only.`);
        if (sentiment.toLowerCase().includes('yes')) {
          traceDetails.push('LLM confirmed negative sentiment');
        } else {
          traceDetails.push('LLM disagreed with keyword match - skipping');
          return null;
        }
      } catch (error) {
        traceDetails.push('LLM sentiment check failed - using keyword match');
      }
    }
    
    return {
      action: 'de-escalate',
      priority: 'high',
      message: "I understand your frustration, and I sincerely apologize for any inconvenience. Let me connect you with one of our service specialists who can resolve this immediately.",
      trace: traceDetails,
      transferReason: 'customer_frustration',
      flags: ['frustration_detected']
    };
  }
  
  // RULE 2: Direct Escalation Requests (Priority: HIGH)
  const escalationTriggers = behaviorsConfig.escalationTriggers || defaultBehaviorRules.escalationTriggers;
  const hasEscalationRequest = escalationTriggers.some(trigger => query.toLowerCase().includes(trigger.toLowerCase()));
  
  if (hasEscalationRequest) {
    const matchedTriggers = escalationTriggers.filter(trigger => query.toLowerCase().includes(trigger.toLowerCase()));
    traceDetails.push(`Escalation request - Triggers: ${matchedTriggers.join(', ')}`);
    
    return {
      action: 'escalate_to_human',
      priority: 'high',
      message: "Of course! I'll connect you with one of our specialists right away.",
      trace: traceDetails,
      transferReason: 'customer_request',
      flags: ['escalation_requested']
    };
  }
  
  // RULE 3: Silence Detection (Priority: MEDIUM)
  const silenceThreshold = behaviorsConfig.silenceThreshold || defaultBehaviorRules.silenceLimitSeconds;
  if (!query || query.trim() === '' || context.silenceDuration >= silenceThreshold) {
    session.silenceCount++;
    traceDetails.push(`Silence detected - Count: ${session.silenceCount}, Duration: ${context.silenceDuration}s`);
    
    if (session.silenceCount >= 2) {
      traceDetails.push('Maximum silence warnings reached - escalating');
      return {
        action: 'escalate_silence',
        priority: 'medium',
        message: "I want to make sure I can help you properly. Let me connect you with one of our team members who can assist you directly.",
        trace: traceDetails,
        transferReason: 'silence_timeout',
        flags: ['silence_escalation']
      };
    }
    
    return {
      action: 'prompt_engagement',
      priority: 'medium',
      message: "I'm here to help! Are you looking for information about our HVAC services, or would you like to schedule an appointment?",
      trace: traceDetails,
      flags: ['silence_prompt']
    };
  }
  
  // RULE 4: Repetition Detection (Priority: MEDIUM)
  session.queryHistory.push(query);
  if (session.queryHistory.length > 10) {
    session.queryHistory = session.queryHistory.slice(-10); // Keep last 10 queries
  }
  
  const repetitionLimit = behaviorsConfig.repetitionLimit || defaultBehaviorRules.repetitionLimit;
  const recentQueries = session.queryHistory.slice(-repetitionLimit);
  
  if (recentQueries.length >= repetitionLimit) {
    const uniqueQueries = new Set(recentQueries.map(q => q.toLowerCase().trim()));
    const isRepetitive = uniqueQueries.size <= 1;
    
    if (isRepetitive) {
      traceDetails.push(`Repetition detected - Same query repeated ${recentQueries.length} times`);
      return {
        action: 'clarify_understanding',
        priority: 'medium',
        message: "I notice we're covering the same topic. Let me try to help in a different way, or would you prefer to speak with one of our specialists?",
        trace: traceDetails,
        flags: ['repetition_detected']
      };
    }
  }
  
  // RULE 5: Off-Topic Detection (Priority: LOW)
  const offTopicKeywords = behaviorsConfig.offTopicKeywords || defaultBehaviorRules.offTopicKeywords;
  const isOffTopic = offTopicKeywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()));
  
  if (isOffTopic) {
    const matchedKeywords = offTopicKeywords.filter(kw => query.toLowerCase().includes(kw.toLowerCase()));
    traceDetails.push(`Off-topic content detected - Keywords: ${matchedKeywords.join(', ')}`);
    
    return {
      action: 'redirect_conversation',
      priority: 'low',
      message: "I'd be happy to help you with your HVAC needs! How can I assist you with heating, cooling, or air quality services today?",
      trace: traceDetails,
      flags: ['off_topic_redirect']
    };
  }
  
  // RULE 6: Robot Detection (Priority: HIGH)
  const robotKeywords = behaviorsConfig.robotKeywords || defaultBehaviorRules.robotDetectionKeywords;
  const hasRobotDetection = robotKeywords.some(kw => query.toLowerCase().includes(kw.toLowerCase()));
  
  if (hasRobotDetection) {
    const matchedKeywords = robotKeywords.filter(kw => query.toLowerCase().includes(kw.toLowerCase()));
    traceDetails.push(`Robot detection - Keywords: ${matchedKeywords.join(', ')}`);
    
    return {
      action: 'humanize_response',
      priority: 'high',
      message: "I'm here to help you personally! You can speak to me naturally about your HVAC needs. What specific service can I help you with today?",
      trace: traceDetails,
      flags: ['robot_detection']
    };
  }
  
  // No behavior detected
  traceDetails.push('No behavior patterns detected - proceeding normally');
  return null;
}

/**
 * Load behavior rules for a specific company
 * Falls back to defaults if company-specific rules not found
 */
function loadBehaviorRulesForCompany(companyProfile) {
  return {
    ...defaultBehaviorRules,
    ...(companyProfile.behaviorRules || {}),
    behaviors: {
      ...defaultBehaviorRules.behaviors,
      ...(companyProfile.agentSetup?.behaviors || {})
    }
  };
}

/**
 * Legacy compatibility function for existing code
 */
function evaluateBehaviorLegacy({ transcript, detectedIntent, companyProfile, context = {} }) {
  // Convert to new format
  return evaluateBehavior({
    query: transcript,
    agentSetup: companyProfile.agentSetup,
    session: context.session || {},
    context: context
  });
}

/**
 * Create a new behavior session for call tracking
 */
function createBehaviorSession(callerId, companyId) {
  return {
    callerId,
    companyId,
    queryHistory: [],
    silenceCount: 0,
    frustrationCount: 0,
    startTime: new Date(),
    lastActivity: new Date()
  };
}

/**
 * Update session with new activity
 */
function updateBehaviorSession(session, query) {
  session.lastActivity = new Date();
  if (query && query.trim()) {
    session.queryHistory.push(query);
    session.silenceCount = 0; // Reset silence count on activity
  }
  return session;
}

/**
 * Check if behavior configuration is valid
 */
function validateBehaviorConfig(config) {
  const errors = [];
  
  if (config.silenceThreshold && (config.silenceThreshold < 3 || config.silenceThreshold > 30)) {
    errors.push('Silence threshold must be between 3 and 30 seconds');
  }
  
  if (config.repetitionLimit && (config.repetitionLimit < 2 || config.repetitionLimit > 10)) {
    errors.push('Repetition limit must be between 2 and 10');
  }
  
  return errors.length === 0 ? null : errors;
}

// Export functions
module.exports = {
  evaluateBehavior,
  evaluateBehaviorLegacy,
  loadBehaviorRulesForCompany,
  createBehaviorSession,
  updateBehaviorSession,
  validateBehaviorConfig,
  defaultBehaviorRules
};
