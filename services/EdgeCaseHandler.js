/**
 * ═══════════════════════════════════════════════════════════════════════════
 * EDGE CASE HANDLER - V23 Production Edge Cases
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Handle three critical production edge cases:
 *   1. BARGE-IN: User interrupts while TTS is playing
 *   2. UNKNOWN LOOP: Prevent endless "I didn't catch that" loops
 *   3. LATENCY MASKING: Inject filler audio during Tier 3 LLM delay
 * 
 * INTEGRATION: Called from CallFlowExecutor and v2AIAgentRuntime
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Unknown loop prevention
  MAX_CONSECUTIVE_UNKNOWNS: 2,
  
  // Latency masking thresholds (ms)
  LATENCY_THRESHOLD_FOR_FILLER: 800,  // Start filler if >800ms
  
  // Barge-in fragment minimum length
  MIN_BARGE_IN_FRAGMENT_LENGTH: 3,
  
  // Default filler phrases (used when waiting for Tier 3)
  DEFAULT_FILLER_PHRASES: [
    "One moment please.",
    "Let me check on that.",
    "Just a moment.",
    "Let me look into that for you.",
    "One second."
  ],
  
  // Short acknowledgments for partial speech
  BARGE_IN_ACKNOWLEDGMENTS: [
    "I hear you.",
    "Go ahead.",
    "Yes?",
    "I'm listening."
  ]
};

// ═══════════════════════════════════════════════════════════════════════════
// 1. UNKNOWN LOOP PREVENTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Track and prevent "I didn't catch that" loops
 * Returns escalation decision if too many unknowns
 */
function checkUnknownLoop(callState, triageDecision) {
  // Initialize counter if not present
  if (typeof callState.consecutiveUnknowns !== 'number') {
    callState.consecutiveUnknowns = 0;
  }
  
  // Check if current decision is UNKNOWN
  const isUnknown = 
    triageDecision?.intent === 'UNKNOWN' ||
    triageDecision?.matched === false ||
    !triageDecision;
  
  if (isUnknown) {
    callState.consecutiveUnknowns++;
    
    logger.info('[EDGE CASE] Unknown detected', {
      consecutiveUnknowns: callState.consecutiveUnknowns,
      maxAllowed: CONFIG.MAX_CONSECUTIVE_UNKNOWNS
    });
    
    // Check if we need to escalate
    if (callState.consecutiveUnknowns >= CONFIG.MAX_CONSECUTIVE_UNKNOWNS) {
      logger.warn('[EDGE CASE] ⚠️ Unknown loop detected - escalating to human', {
        consecutiveUnknowns: callState.consecutiveUnknowns
      });
      
      return {
        shouldEscalate: true,
        reason: 'UNKNOWN_LOOP',
        response: "I'm having trouble understanding. Let me connect you with someone who can help.",
        action: 'transfer'
      };
    }
    
    // Return progressive clarification responses
    const clarifications = [
      "I didn't quite catch that. Could you say that again?",
      "I'm sorry, I'm still not understanding. Could you tell me what you need help with today?"
    ];
    
    return {
      shouldEscalate: false,
      clarificationResponse: clarifications[callState.consecutiveUnknowns - 1] || clarifications[0]
    };
    
  } else {
    // Reset counter on successful understanding
    if (callState.consecutiveUnknowns > 0) {
      logger.info('[EDGE CASE] Unknown loop reset - understood user');
    }
    callState.consecutiveUnknowns = 0;
    return { shouldEscalate: false };
  }
}

/**
 * Get the current unknown count
 */
function getUnknownCount(callState) {
  return callState.consecutiveUnknowns || 0;
}

/**
 * Reset unknown counter (call when successfully understood)
 */
function resetUnknownCounter(callState) {
  callState.consecutiveUnknowns = 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// 2. LATENCY MASKING (Filler Phrases for Tier 3)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get a filler phrase to play while waiting for Tier 3 LLM
 * @param {Object} company - Company object (may have custom fillers)
 * @returns {Object} { text, shouldPlay }
 */
function getLatencyFillerPhrase(company) {
  // Check for company-specific filler phrases
  const customFillers = company?.aiAgentSettings?.latencyFillers || [];
  const fillers = customFillers.length > 0 
    ? customFillers 
    : CONFIG.DEFAULT_FILLER_PHRASES;
  
  // Pick a random filler
  const text = fillers[Math.floor(Math.random() * fillers.length)];
  
  return {
    text,
    shouldPlay: true,
    voiceSettings: company?.aiAgentSettings?.voiceSettings || null
  };
}

/**
 * Check if we should inject a filler phrase based on expected latency
 * @param {number} expectedLatencyMs - Expected latency in milliseconds
 * @returns {boolean}
 */
function shouldInjectFiller(expectedLatencyMs) {
  return expectedLatencyMs > CONFIG.LATENCY_THRESHOLD_FOR_FILLER;
}

/**
 * Create TwiML for latency masking
 * Plays a filler while the real response is being prepared
 */
function createFillerTwiML(fillerText, voiceSettings) {
  // Returns structure for TwiML generation
  return {
    type: 'filler',
    text: fillerText,
    voice: voiceSettings?.voiceId || 'Polly.Joanna',
    pauseAfterMs: 500  // Small pause after filler before real response
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// 3. BARGE-IN HANDLING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle partial speech (barge-in) events
 * Called when user speaks while TTS is playing
 * @param {string} partialText - Fragment of speech detected
 * @param {Object} callState - Current call state
 * @returns {Object} Decision on how to handle the interruption
 */
function handleBargeIn(partialText, callState) {
  // Validate we have meaningful input
  if (!partialText || partialText.trim().length < CONFIG.MIN_BARGE_IN_FRAGMENT_LENGTH) {
    return {
      shouldProcess: false,
      reason: 'Fragment too short',
      action: 'ignore'
    };
  }
  
  const normalized = partialText.toLowerCase().trim();
  
  // Check for common interruption patterns
  const urgentPatterns = [
    'emergency', 'help', 'stop', 'wait', 'hold on', 'actually',
    'no', 'cancel', 'hang up', 'operator', 'person', 'human'
  ];
  
  const isUrgent = urgentPatterns.some(p => normalized.includes(p));
  
  if (isUrgent) {
    logger.info('[EDGE CASE] Urgent barge-in detected', { 
      partialText: normalized,
      matchedPattern: urgentPatterns.find(p => normalized.includes(p))
    });
    
    return {
      shouldProcess: true,
      reason: 'Urgent interruption',
      action: 'stop_tts_and_process',
      text: partialText,
      isUrgent: true
    };
  }
  
  // Non-urgent interruption - queue for processing after current TTS
  return {
    shouldProcess: true,
    reason: 'User interruption',
    action: 'queue_for_processing',
    text: partialText,
    isUrgent: false,
    acknowledgment: getBargeInAcknowledgment()
  };
}

/**
 * Get a short acknowledgment for barge-in situations
 */
function getBargeInAcknowledgment() {
  const acks = CONFIG.BARGE_IN_ACKNOWLEDGMENTS;
  return acks[Math.floor(Math.random() * acks.length)];
}

/**
 * Check if barge-in is enabled for a company
 */
function isBargeInEnabled(company) {
  return company?.aiAgentSettings?.speechDetection?.bargeIn === true ||
         company?.aiSettings?.bargeIn === true;
}

// ═══════════════════════════════════════════════════════════════════════════
// 4. COMBINED EDGE CASE CHECK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run all edge case checks and return combined result
 * Call this at the start of processUserInput
 */
function runEdgeCaseChecks(context) {
  const { callState, triageDecision, userInput, company } = context;
  const results = {
    hasEdgeCase: false,
    unknownLoop: null,
    bargeIn: null,
    needsLatencyMasking: false
  };
  
  // Check for unknown loop
  const unknownCheck = checkUnknownLoop(callState, triageDecision);
  if (unknownCheck.shouldEscalate) {
    results.hasEdgeCase = true;
    results.unknownLoop = unknownCheck;
  }
  
  // Check for barge-in (if partial speech detected)
  if (context.isPartialSpeech) {
    const bargeInCheck = handleBargeIn(userInput, callState);
    if (bargeInCheck.shouldProcess) {
      results.hasEdgeCase = true;
      results.bargeIn = bargeInCheck;
    }
  }
  
  // Log edge case detection
  if (results.hasEdgeCase) {
    logger.info('[EDGE CASE] Edge case detected', {
      unknownLoop: !!results.unknownLoop,
      bargeIn: !!results.bargeIn,
      callId: callState.callId
    });
  }
  
  return results;
}

// ═══════════════════════════════════════════════════════════════════════════
// 5. SILENCE HANDLING (Enhanced)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Handle consecutive silences
 * Returns appropriate response based on silence count
 */
function handleSilence(callState) {
  // Initialize counter if not present
  if (typeof callState.consecutiveSilences !== 'number') {
    callState.consecutiveSilences = 0;
  }
  
  callState.consecutiveSilences++;
  
  const silenceResponses = [
    { count: 1, text: "Are you still there?", action: 'continue' },
    { count: 2, text: "I haven't heard from you. Are you still on the line?", action: 'continue' },
    { count: 3, text: "I'll go ahead and end the call. Please call back when you're ready. Goodbye.", action: 'hangup' }
  ];
  
  const response = silenceResponses.find(r => r.count === callState.consecutiveSilences) 
    || silenceResponses[silenceResponses.length - 1];
  
  logger.info('[EDGE CASE] Silence detected', {
    consecutiveSilences: callState.consecutiveSilences,
    action: response.action
  });
  
  return response;
}

/**
 * Reset silence counter (call when user speaks)
 */
function resetSilenceCounter(callState) {
  callState.consecutiveSilences = 0;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  // Configuration
  CONFIG,
  
  // Unknown loop prevention
  checkUnknownLoop,
  getUnknownCount,
  resetUnknownCounter,
  
  // Latency masking
  getLatencyFillerPhrase,
  shouldInjectFiller,
  createFillerTwiML,
  
  // Barge-in handling
  handleBargeIn,
  getBargeInAcknowledgment,
  isBargeInEnabled,
  
  // Combined check
  runEdgeCaseChecks,
  
  // Silence handling
  handleSilence,
  resetSilenceCounter
};

