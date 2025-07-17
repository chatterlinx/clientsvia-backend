// utils/behaviorRules.js
// Production-grade AI Behavior Engine for real-time call management

const defaultBehaviorRules = {
  politeGreeting: true,
  alwaysAcknowledge: true,
  silenceLimitSeconds: 3,
  fallbackResponse: "I'm here to help — how can I assist you today?",
  escalationTriggers: ["talk to a person", "speak to someone", "transfer me", "supervisor"],
  frustrationTriggers: ["frustrated", "frustrating", "this is ridiculous", "angry"],
  technicianNames: ["Dustin", "Marcello", "Steve"],
  transferToAdvisorOnFrustration: true,
  systemDelayWarningSeconds: 2,
  robotDetectionKeywords: ["are you real", "robot", "machine", "not a human", "fake voice", "automated", "bot"],
  afterHours: {
    enabled: true,
    hours: { start: 7, end: 19 }, // 7 AM to 7 PM Eastern
    messageOption: true,
    timezone: "America/New_York"
  },
  maxSilenceWarnings: 2,
  enableSmartEscalation: true,
  conversationTimeout: 300 // 5 minutes
};

/**
 * Load behavior rules for a specific company
 * Falls back to defaults if company-specific rules not found
 */
function loadBehaviorRulesForCompany(companyProfile) {
  return {
    ...defaultBehaviorRules,
    ...(companyProfile.behaviorRules || {})
  };
}

/**
 * Main behavior evaluation engine
 * Analyzes conversation context and returns appropriate actions
 */
function evaluateBehavior({ transcript, detectedIntent, companyProfile, context = {} }) {
  const rules = loadBehaviorRulesForCompany(companyProfile);
  const lowerTranscript = transcript?.toLowerCase() || '';
  
  // Priority 1: Robot detection and humanization (handle first to avoid escalation)
  if (rules.robotDetectionKeywords.some(keyword => lowerTranscript.includes(keyword))) {
    return { 
      action: "humanize_response",
      priority: "high",
      message: "I'm here to help you personally! You can speak to me naturally about your HVAC needs. What can I assist you with today?",
      flags: ["robot_detection"]
    };
  }

  // Priority 2: Direct escalation requests (not robot-related)
  const directEscalationTriggers = ["talk to a person", "speak to someone", "transfer me", "supervisor"];
  if (directEscalationTriggers.some(trigger => lowerTranscript.includes(trigger))) {
    return { 
      action: "escalate_to_service_advisor",
      priority: "high",
      message: "I understand you'd like to speak with someone. Let me transfer you to a service advisor right now.",
      transferReason: "customer_request"
    };
  }

  // Priority 3: Frustration detection (separate from robot detection)
  const frustrationTriggers = ["frustrated", "frustrating", "this is ridiculous", "angry"];
  if (frustrationTriggers.some(trigger => lowerTranscript.includes(trigger))) {
    return { 
      action: "escalate_to_service_advisor",
      priority: "high",
      message: "I understand your frustration. Let me connect you with a service advisor who can help resolve this immediately.",
      transferReason: "customer_frustration"
    };
  }

  // Priority 4: Technician name detection
  const mentionedTechnician = rules.technicianNames.find(name => 
    lowerTranscript.includes(name.toLowerCase())
  );
  if (mentionedTechnician) {
    return { 
      action: "confirm_technician_request",
      priority: "medium",
      message: `Just to confirm, you're looking to work with ${mentionedTechnician}, is that correct?`,
      technician: mentionedTechnician
    };
  }

  // Priority 5: Silence handling
  if (context.silenceDuration >= rules.silenceLimitSeconds) {
    const silenceCount = context.silenceCount || 0;
    
    if (silenceCount >= rules.maxSilenceWarnings) {
      return {
        action: "escalate_due_to_silence",
        priority: "medium",
        message: "It seems like we might have a connection issue. Let me transfer you to someone who can help you directly.",
        transferReason: "silence_timeout"
      };
    }
    
    return { 
      action: "handle_silence",
      priority: "medium",
      message: rules.fallbackResponse,
      silenceCount: silenceCount + 1
    };
  }

  // Priority 6: System delay acknowledgment
  if (context.systemDelay >= rules.systemDelayWarningSeconds) {
    return { 
      action: "apologize_for_delay",
      priority: "low",
      message: "Sorry for the brief pause - I'm processing your request. How can I help you today?"
    };
  }

  // Priority 7: After hours detection
  if (rules.afterHours.enabled && isAfterHours(rules.afterHours)) {
    return {
      action: "after_hours_message",
      priority: "high",
      message: "Thanks for calling! Our office is currently closed, but I can still help you schedule an appointment or take a message. What would you prefer?",
      options: ["schedule", "message", "emergency"]
    };
  }

  // Default: Continue normal conversation flow
  return { 
    action: "continue_normal_flow",
    priority: "normal"
  };
}

/**
 * Check if current time is after business hours
 */
function isAfterHours(afterHoursConfig) {
  const now = new Date();
  const currentHour = now.getHours();
  
  return currentHour < afterHoursConfig.hours.start || currentHour >= afterHoursConfig.hours.end;
}

/**
 * Get company-specific behavior configuration for Penguin Air
 */
function getPenguinAirBehaviorRules() {
  return {
    ...defaultBehaviorRules,
    silenceLimitSeconds: 2,
    escalationTriggers: ["talk to a person", "speak to someone", "transfer me", "supervisor"],
    frustrationTriggers: ["frustrated", "frustrating", "this is ridiculous"],
    robotDetectionKeywords: ["are you real", "robot", "machine", "not a human", "fake voice", "automated", "bot"],
    technicianNames: ["Dustin", "Marcello"],
    afterHours: {
      enabled: true,
      hours: { start: 7, end: 19 },
      messageOption: true,
      timezone: "America/New_York"
    },
    fallbackResponse: "I'm here to help with your heating and cooling needs. What can I assist you with?",
    enableSmartEscalation: true
  };
}

/**
 * Create behavior context object for tracking conversation state
 */
function createBehaviorContext(session = {}) {
  return {
    silenceDuration: session.silenceDuration || 0,
    silenceCount: session.silenceCount || 0,
    systemDelay: session.systemDelay || 0,
    conversationStartTime: session.conversationStartTime || Date.now(),
    robotDetectionCount: session.robotDetectionCount || 0,
    escalationAttempts: session.escalationAttempts || 0
  };
}

module.exports = {
  evaluateBehavior,
  loadBehaviorRulesForCompany,
  getPenguinAirBehaviorRules,
  createBehaviorContext,
  defaultBehaviorRules
};
