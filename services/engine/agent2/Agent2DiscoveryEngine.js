/**
 * ============================================================================
 * AGENT 2.0 DISCOVERY ENGINE — CLEAN IMPLEMENTATION
 * ClientVia Platform · Agent Console Contract AC1
 * 
 * This is a CLEAN module — NO LEGACY CODE.
 * 
 * Responsibilities:
 * - Greeting
 * - Caller name capture (light)
 * - Intent detection (service / question / book)
 * - Summary building
 * - Consent detection → Handoff payload creation
 * 
 * Handoff Contract:
 * When booking consent is detected:
 * 1. Agent says: "Please hold while I pull up the calendar."
 * 2. Build AC1 payload with assumptions + summary
 * 3. Hand off to Booking Logic
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const v2Company = require('../../../models/v2Company');

const ENGINE_ID = 'AGENT2_DISCOVERY_ENGINE';
const CONTRACT_VERSION = 'AC1';

/* ============================================================================
   DEFAULT CONFIGURATION
   ============================================================================ */

const DEFAULT_CONFIG = {
  greetings: {
    initial: 'Thank you for calling. How can I help you today?',
    returnCaller: 'Welcome back! How can I assist you today?'
  },
  consentPhrases: [
    'yes', 'yeah', 'sure', 'ok', 'okay', 'yes please',
    'that works', 'sounds good', "let's do it", 'absolutely',
    'please', 'go ahead', 'book it', 'schedule it'
  ],
  escalationPhrases: [
    'speak to a human', 'talk to someone', 'real person',
    'operator', 'representative', 'manager', 'supervisor',
    'speak to a person', 'human please'
  ],
  style: {
    ackWord: 'Ok.',
    holdLine: 'Please hold while I pull up the calendar.'
  }
};

/* ============================================================================
   MAIN ENTRY POINT
   ============================================================================ */

/**
 * Process a single discovery turn
 * 
 * @param {Object} params
 * @param {Object} params.session - Current session state
 * @param {string} params.text - Caller's utterance
 * @param {string} params.companyId - Company ID
 * @param {string} params.callSid - Twilio call SID
 * @param {string} params.fromPhone - Caller's phone number
 * @param {boolean} params.isTest - Whether this is a test turn
 * 
 * @returns {Object} { replyText, sessionUpdates, handoffPayload? }
 */
async function processTurn({ session, text, companyId, callSid, fromPhone, isTest = false }) {
  const turnId = `turn_${Date.now()}`;
  
  logger.info(`[${ENGINE_ID}] Processing turn`, {
    turnId,
    companyId,
    callSid,
    mode: session?.mode || 'DISCOVERY',
    textLength: text?.length || 0,
    isTest
  });
  
  try {
    // Load company config
    const config = await loadCompanyConfig(companyId);
    
    // Normalize input
    const normalizedText = normalizeText(text);
    
    // Initialize session if needed
    const currentSession = initializeSession(session);
    
    // Check for escalation first
    if (detectEscalation(normalizedText, config)) {
      logger.info(`[${ENGINE_ID}] Escalation detected`, { turnId, callSid });
      return buildEscalationResponse(currentSession);
    }
    
    // Check for booking consent
    if (currentSession.awaitingBookingConsent && detectConsent(normalizedText, config)) {
      logger.info(`[${ENGINE_ID}] Booking consent detected`, { turnId, callSid });
      return buildHandoffResponse(currentSession, config, companyId, callSid, fromPhone);
    }
    
    // Process based on current state
    const result = await processDiscoveryState(currentSession, normalizedText, config, companyId);
    
    logger.info(`[${ENGINE_ID}] Turn processed`, {
      turnId,
      replyLength: result.replyText?.length || 0,
      hasHandoff: !!result.handoffPayload
    });
    
    return result;
    
  } catch (error) {
    logger.error(`[${ENGINE_ID}] Turn processing failed`, {
      turnId,
      companyId,
      callSid,
      error: error.message,
      stack: error.stack
    });
    
    return {
      replyText: "I'm sorry, I'm having trouble processing that. Could you please repeat?",
      sessionUpdates: session || {},
      error: error.message
    };
  }
}

/* ============================================================================
   CONFIG LOADING
   ============================================================================ */

async function loadCompanyConfig(companyId) {
  try {
    const company = await v2Company.findById(companyId)
      .select('aiAgentSettings.agent2 companyName')
      .lean();
    
    if (!company) {
      logger.warn(`[${ENGINE_ID}] Company not found, using defaults`, { companyId });
      return { ...DEFAULT_CONFIG, companyName: 'our company' };
    }
    
    const agent2 = company.aiAgentSettings?.agent2 || {};
    
    return {
      companyName: company.companyName || 'our company',
      greetings: {
        initial: agent2.greetings?.initial || DEFAULT_CONFIG.greetings.initial,
        returnCaller: agent2.greetings?.returnCaller || DEFAULT_CONFIG.greetings.returnCaller
      },
      consentPhrases: agent2.consentPhrases || DEFAULT_CONFIG.consentPhrases,
      escalationPhrases: agent2.escalationPhrases || DEFAULT_CONFIG.escalationPhrases,
      style: {
        ackWord: agent2.discovery?.style?.ackWord || DEFAULT_CONFIG.style.ackWord,
        holdLine: DEFAULT_CONFIG.style.holdLine
      }
    };
  } catch (error) {
    logger.error(`[${ENGINE_ID}] Config load failed`, { companyId, error: error.message });
    return { ...DEFAULT_CONFIG, companyName: 'our company' };
  }
}

/* ============================================================================
   SESSION MANAGEMENT
   ============================================================================ */

function initializeSession(session) {
  return {
    mode: session?.mode || 'DISCOVERY',
    turn: session?.turn || 0,
    callerName: session?.callerName || null,
    intent: session?.intent || null,
    summary: session?.summary || null,
    awaitingBookingConsent: session?.awaitingBookingConsent || false,
    ...session
  };
}

/* ============================================================================
   TEXT PROCESSING
   ============================================================================ */

function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text.toLowerCase().trim();
}

/* ============================================================================
   DETECTION FUNCTIONS
   ============================================================================ */

function detectEscalation(text, config) {
  const phrases = config.escalationPhrases || DEFAULT_CONFIG.escalationPhrases;
  return phrases.some(phrase => text.includes(phrase.toLowerCase()));
}

function detectConsent(text, config) {
  const phrases = config.consentPhrases || DEFAULT_CONFIG.consentPhrases;
  return phrases.some(phrase => text.toLowerCase() === phrase.toLowerCase() || text.startsWith(phrase.toLowerCase()));
}

function detectBookingIntent(text) {
  const bookingKeywords = [
    'schedule', 'book', 'appointment', 'come out', 'come by',
    'send someone', 'technician', 'service call', 'available',
    'when can', 'set up', 'arrange'
  ];
  return bookingKeywords.some(keyword => text.includes(keyword));
}

function detectQuestionIntent(text) {
  const questionIndicators = [
    'how much', 'what is', 'do you', 'can you', 'price',
    'cost', 'estimate', 'quote', 'hours', 'open',
    '?'
  ];
  return questionIndicators.some(indicator => text.includes(indicator));
}

function extractCallerName(text) {
  // Simple name extraction patterns
  const patterns = [
    /my name is (\w+)/i,
    /this is (\w+)/i,
    /i'm (\w+)/i,
    /im (\w+)/i,
    /call me (\w+)/i
  ];
  
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      return capitalizeFirst(match[1]);
    }
  }
  
  return null;
}

function capitalizeFirst(str) {
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

/* ============================================================================
   DISCOVERY STATE PROCESSING
   ============================================================================ */

async function processDiscoveryState(session, text, config, companyId) {
  const sessionUpdates = { ...session };
  sessionUpdates.turn = (session.turn || 0) + 1;
  
  // Extract caller name if present
  const detectedName = extractCallerName(text);
  if (detectedName && !sessionUpdates.callerName) {
    sessionUpdates.callerName = detectedName;
  }
  
  // Detect intent
  if (detectBookingIntent(text)) {
    sessionUpdates.intent = 'booking';
    sessionUpdates.awaitingBookingConsent = true;
    sessionUpdates.summary = { issue: text, serviceType: 'service', urgency: 'routine' };
    
    const nameGreeting = sessionUpdates.callerName ? `, ${sessionUpdates.callerName}` : '';
    return {
      replyText: `${config.style.ackWord} I'd be happy to help you schedule a service appointment${nameGreeting}. Would you like me to check our available times?`,
      sessionUpdates
    };
  }
  
  if (detectQuestionIntent(text)) {
    sessionUpdates.intent = 'question';
    return {
      replyText: `${config.style.ackWord} Let me help you with that. Unfortunately, I don't have that specific information available. Would you like to speak with one of our team members, or can I help you schedule an appointment instead?`,
      sessionUpdates
    };
  }
  
  // Default: Ask for clarification
  sessionUpdates.summary = { issue: text, serviceType: 'general', urgency: 'routine' };
  return {
    replyText: `${config.style.ackWord} I understand. Is there something specific I can help you with today, or would you like to schedule a service appointment?`,
    sessionUpdates
  };
}

/* ============================================================================
   RESPONSE BUILDERS
   ============================================================================ */

function buildEscalationResponse(session) {
  return {
    replyText: "I understand you'd like to speak with someone directly. Let me transfer you to our team. Please hold.",
    sessionUpdates: {
      ...session,
      mode: 'ESCALATION',
      escalationRequested: true
    }
  };
}

function buildHandoffResponse(session, config, companyId, callSid, fromPhone) {
  const handoffPayload = {
    handoffContractVersion: CONTRACT_VERSION,
    companyId,
    callSid,
    fromPhone,
    assumptions: {
      firstName: session.callerName?.split(' ')[0] || null,
      lastName: session.callerName?.split(' ').slice(1).join(' ') || null
    },
    summary: session.summary || {
      issue: 'Service request',
      serviceType: 'general',
      urgency: 'routine'
    }
  };
  
  return {
    replyText: config.style.holdLine,
    sessionUpdates: {
      ...session,
      mode: 'BOOKING',
      awaitingBookingConsent: false
    },
    handoffPayload
  };
}

/* ============================================================================
   EXPORTS
   ============================================================================ */

module.exports = {
  processTurn,
  CONTRACT_VERSION,
  ENGINE_ID
};
