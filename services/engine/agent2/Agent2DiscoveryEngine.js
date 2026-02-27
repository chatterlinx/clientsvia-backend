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
 * 1. AC1_CONSENT_DETECTED event
 * 2. AC1_HANDOFF_PAYLOAD_BUILT event
 * 3. AC1_BOOKING_MODE_SET event
 * 4. AC1_BOOKING_NEXT_PROMPT_SPOKEN event
 * 
 * HARD RULES:
 * - Discovery MUST emit payload ONLY when booking consent is explicit
 * - Discovery MUST NOT ask booking questions (phone, address) once consent is met
 * - Discovery MUST set session.mode = 'BOOKING' and NEVER fall back
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const v2Company = require('../../../models/v2Company');

const ENGINE_ID = 'AGENT2_DISCOVERY_ENGINE';
const CONTRACT_VERSION = 'AC1';

/* ============================================================================
   AC1 PROOF EVENTS — These are the gates that verify correct behavior
   ============================================================================ */

const AC1_EVENTS = {
  CONSENT_DETECTED: 'AC1_CONSENT_DETECTED',
  HANDOFF_PAYLOAD_BUILT: 'AC1_HANDOFF_PAYLOAD_BUILT',
  BOOKING_MODE_SET: 'AC1_BOOKING_MODE_SET',
  BOOKING_NEXT_PROMPT_SPOKEN: 'AC1_BOOKING_NEXT_PROMPT_SPOKEN',
  ESCALATION_REQUESTED: 'AC1_ESCALATION_REQUESTED',
  DISCOVERY_TURN_PROCESSED: 'AC1_DISCOVERY_TURN_PROCESSED',
  BOOKING_INTENT_DETECTED: 'AC1_BOOKING_INTENT_DETECTED',
  AWAITING_CONSENT: 'AC1_AWAITING_CONSENT'
};

/* ============================================================================
   DEFAULT CONFIGURATION
   ============================================================================ */

const DEFAULT_CONFIG = {
  greetings: {
    initial: 'Thank you for calling. How can I help you today?',
    returnCaller: ''
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
 * @returns {Object} { replyText, sessionUpdates, handoffPayload?, events[] }
 */
async function processTurn({ session, text, companyId, callSid, fromPhone, isTest = false }) {
  const turnId = `turn_${Date.now()}`;
  const events = [];
  
  logger.info(`[${ENGINE_ID}] Processing turn`, {
    turnId,
    companyId,
    callSid,
    mode: session?.mode || 'DISCOVERY',
    textLength: text?.length || 0,
    isTest
  });
  
  try {
    const config = await loadCompanyConfig(companyId);
    const normalizedText = normalizeText(text);
    const currentSession = initializeSession(session);
    
    // GATE: Check for escalation first
    if (detectEscalation(normalizedText, config)) {
      events.push({ type: AC1_EVENTS.ESCALATION_REQUESTED, timestamp: Date.now(), callSid });
      logger.info(`[${ENGINE_ID}] Escalation detected`, { turnId, callSid });
      
      const result = buildEscalationResponse(currentSession);
      return { ...result, events };
    }
    
    // GATE: Check for booking consent (ONLY if we were awaiting it)
    if (currentSession.awaitingBookingConsent && detectConsent(normalizedText, config)) {
      // ═══════════════════════════════════════════════════════════════════════
      // AC1 HANDOFF SEQUENCE — These events MUST fire in order
      // ═══════════════════════════════════════════════════════════════════════
      
      // 1. Consent detected
      events.push({ 
        type: AC1_EVENTS.CONSENT_DETECTED, 
        timestamp: Date.now(), 
        callSid,
        consentText: normalizedText
      });
      logger.info(`[${ENGINE_ID}] AC1_CONSENT_DETECTED`, { turnId, callSid, text: normalizedText });
      
      // 2. Build handoff payload
      const handoffPayload = buildHandoffPayload(currentSession, companyId, callSid, fromPhone);
      events.push({ 
        type: AC1_EVENTS.HANDOFF_PAYLOAD_BUILT, 
        timestamp: Date.now(), 
        callSid,
        payloadVersion: CONTRACT_VERSION,
        hasFirstName: !!handoffPayload.assumptions.firstName,
        hasSummary: !!handoffPayload.summary.issue
      });
      logger.info(`[${ENGINE_ID}] AC1_HANDOFF_PAYLOAD_BUILT`, { turnId, callSid });
      
      // 3. Set booking mode (IRREVERSIBLE within this call)
      const sessionUpdates = {
        ...currentSession,
        mode: 'BOOKING',
        awaitingBookingConsent: false,
        handoffTimestamp: Date.now()
      };
      events.push({ 
        type: AC1_EVENTS.BOOKING_MODE_SET, 
        timestamp: Date.now(), 
        callSid,
        previousMode: currentSession.mode
      });
      logger.info(`[${ENGINE_ID}] AC1_BOOKING_MODE_SET`, { turnId, callSid });
      
      // 4. Speak the hold line
      const replyText = config.style.holdLine;
      events.push({ 
        type: AC1_EVENTS.BOOKING_NEXT_PROMPT_SPOKEN, 
        timestamp: Date.now(), 
        callSid,
        prompt: replyText
      });
      logger.info(`[${ENGINE_ID}] AC1_BOOKING_NEXT_PROMPT_SPOKEN`, { turnId, callSid });
      
      return {
        replyText,
        sessionUpdates,
        handoffPayload,
        events
      };
    }
    
    // GATE: Normal discovery processing
    const result = await processDiscoveryState(currentSession, normalizedText, config, companyId, events);
    
    events.push({ 
      type: AC1_EVENTS.DISCOVERY_TURN_PROCESSED, 
      timestamp: Date.now(),
      turn: result.sessionUpdates.turn,
      intent: result.sessionUpdates.intent
    });
    
    logger.info(`[${ENGINE_ID}] Turn processed`, {
      turnId,
      replyLength: result.replyText?.length || 0,
      hasHandoff: !!result.handoffPayload,
      eventsCount: events.length
    });
    
    return { ...result, events };
    
  } catch (error) {
    logger.error(`[${ENGINE_ID}] Turn processing failed`, {
      turnId,
      companyId,
      callSid,
      error: error.message,
      stack: error.stack
    });
    
    events.push({ type: 'AC1_ERROR', error: error.message, timestamp: Date.now() });
    
    return {
      replyText: "I'm sorry, I'm having trouble processing that. Could you please repeat?",
      sessionUpdates: session || {},
      error: error.message,
      events
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
        returnCaller: typeof agent2.greetings?.returnCaller === 'object'
          ? (agent2.greetings?.returnCaller?.text || '')
          : (agent2.greetings?.returnCaller || DEFAULT_CONFIG.greetings.returnCaller)
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

// ☢️ DELETED - Name extraction moved to ScrabEngine Stage 4
// Names now extracted in ScrabEngine.EntityExtractionEngine
// Agent2DiscoveryRunner uses scrabResult.entities.firstName directly

/* ============================================================================
   DISCOVERY STATE PROCESSING
   ============================================================================ */

async function processDiscoveryState(session, text, config, companyId, events) {
  const sessionUpdates = { ...session };
  sessionUpdates.turn = (session.turn || 0) + 1;
  
  // ☢️ DELETED - Name extraction now handled by ScrabEngine Stage 4
  // Names come from Agent2DiscoveryRunner via scrabResult.entities
  
  // Detect booking intent → set awaitingBookingConsent flag
  if (detectBookingIntent(text)) {
    sessionUpdates.intent = 'booking';
    sessionUpdates.awaitingBookingConsent = true;
    sessionUpdates.summary = { issue: text, serviceType: 'service', urgency: 'routine' };
    
    events.push({ 
      type: AC1_EVENTS.BOOKING_INTENT_DETECTED, 
      timestamp: Date.now(),
      issue: text.slice(0, 100)
    });
    events.push({ 
      type: AC1_EVENTS.AWAITING_CONSENT, 
      timestamp: Date.now()
    });
    
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

function buildHandoffPayload(session, companyId, callSid, fromPhone) {
  return {
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
}

/* ============================================================================
   EXPORTS
   ============================================================================ */

module.exports = {
  processTurn,
  CONTRACT_VERSION,
  ENGINE_ID,
  AC1_EVENTS
};
