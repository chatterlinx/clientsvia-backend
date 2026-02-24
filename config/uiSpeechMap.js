/**
 * ============================================================================
 * UI SPEECH MAPPING — Backend Speech Sources → UI Editor Fields
 * ============================================================================
 * 
 * This file maps every backend variable that produces agent speech to its
 * corresponding UI editor location in Agent Console.
 * 
 * USAGE:
 * 1. Hardcoded speech scanner uses this to suggest UI locations for violations
 * 2. Compliance checker uses this to verify UI coverage
 * 3. Truth export includes this mapping for auditing
 * 
 * RULE: If a speech source has no UI mapping, it's a compliance violation.
 * 
 * ============================================================================
 */

/**
 * Speech source mappings
 * 
 * Each entry defines:
 * - backendVariable: The variable name used in backend code
 * - backendFiles: Array of files where this variable might appear
 * - dbPath: MongoDB document path where the value is stored
 * - uiPage: Agent Console HTML page with the editor
 * - uiSection: Card/section name in the UI
 * - uiFieldId: DOM element ID for the input field
 * - uiFieldType: Input type (text, textarea, toggle, etc.)
 * - hasUiEditor: Whether the UI editor currently exists
 * - notes: Additional context
 */
const SPEECH_SOURCE_MAPPINGS = {
  
  // ═══════════════════════════════════════════════════════════════════════════
  // GREETINGS (agent2.html)
  // ═══════════════════════════════════════════════════════════════════════════
  
  'greeting.callStart.text': {
    backendVariable: 'callStartGreeting',
    backendFiles: ['routes/v2twilio.js', 'services/engine/agent2/Agent2DiscoveryEngine.js'],
    dbPath: 'aiAgentSettings.agent2.greetings.callStart.text',
    uiPage: 'agent2.html',
    uiSection: 'Call Start Greeting',
    uiFieldId: 'input-greeting-text',
    uiFieldType: 'textarea',
    hasUiEditor: true,
    notes: 'Main greeting spoken at call start'
  },
  
  'greeting.callStart.emergencyFallback': {
    backendVariable: 'emergencyFallback',
    backendFiles: ['routes/v2twilio.js'],
    dbPath: 'aiAgentSettings.agent2.greetings.callStart.emergencyFallback',
    uiPage: 'agent2.html',
    uiSection: 'Call Start Greeting',
    uiFieldId: 'input-emergency-fallback',
    uiFieldType: 'textarea',
    hasUiEditor: false, // VIOLATION - needs UI
    notes: 'Fallback if main greeting fails to load'
  },
  
  'greeting.returnCaller.text': {
    backendVariable: 'returnCallerGreeting',
    backendFiles: ['services/engine/agent2/Agent2DiscoveryEngine.js'],
    dbPath: 'aiAgentSettings.agent2.greetings.returnCaller.text',
    uiPage: 'agent2.html',
    uiSection: 'Return Caller Recognition',
    uiFieldId: 'input-return-caller-text',
    uiFieldType: 'textarea',
    hasUiEditor: false, // VIOLATION - needs UI
    notes: 'Greeting for callers who have called before'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // INTERCEPTOR RULES (agent2.html)
  // ═══════════════════════════════════════════════════════════════════════════
  
  'interceptor.rules[].response': {
    backendVariable: 'interceptorResponse',
    backendFiles: ['services/engine/agent2/GreetingInterceptorEngine.js'],
    dbPath: 'aiAgentSettings.agent2.greetings.interceptor.rules[].response',
    uiPage: 'agent2.html',
    uiSection: 'Greeting Interceptor',
    uiFieldId: 'modal-greeting-rule',
    uiFieldType: 'modal-form',
    hasUiEditor: true,
    notes: 'Per-rule response text in interceptor modal'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // BOOKING PROMPTS (booking.html)
  // ═══════════════════════════════════════════════════════════════════════════
  
  'booking.askName': {
    backendVariable: 'askNamePrompt',
    backendFiles: ['services/engine/booking/BookingLogicEngine.js'],
    dbPath: 'aiAgentSettings.agent2.bookingPrompts.askName',
    uiPage: 'booking.html',
    uiSection: 'Booking Prompts',
    uiFieldId: 'input-booking-ask-name',
    uiFieldType: 'textarea',
    hasUiEditor: false, // VIOLATION - needs UI
    notes: 'Prompt asking caller for their name'
  },
  
  'booking.askNameRetry': {
    backendVariable: 'askNameRetryPrompt',
    backendFiles: ['services/engine/booking/BookingLogicEngine.js'],
    dbPath: 'aiAgentSettings.agent2.bookingPrompts.askNameRetry',
    uiPage: 'booking.html',
    uiSection: 'Booking Prompts',
    uiFieldId: 'input-booking-ask-name-retry',
    uiFieldType: 'textarea',
    hasUiEditor: false, // VIOLATION - needs UI
    notes: 'Retry prompt if name not understood'
  },
  
  'booking.askPhone': {
    backendVariable: 'askPhonePrompt',
    backendFiles: ['services/engine/booking/BookingLogicEngine.js'],
    dbPath: 'aiAgentSettings.agent2.bookingPrompts.askPhone',
    uiPage: 'booking.html',
    uiSection: 'Booking Prompts',
    uiFieldId: 'input-booking-ask-phone',
    uiFieldType: 'textarea',
    hasUiEditor: false, // VIOLATION - needs UI
    notes: 'Prompt asking caller for callback number'
  },
  
  'booking.askPhoneRetry': {
    backendVariable: 'askPhoneRetryPrompt',
    backendFiles: ['services/engine/booking/BookingLogicEngine.js'],
    dbPath: 'aiAgentSettings.agent2.bookingPrompts.askPhoneRetry',
    uiPage: 'booking.html',
    uiSection: 'Booking Prompts',
    uiFieldId: 'input-booking-ask-phone-retry',
    uiFieldType: 'textarea',
    hasUiEditor: false, // VIOLATION - needs UI
    notes: 'Retry prompt if phone not understood'
  },
  
  'booking.confirmSlot': {
    backendVariable: 'confirmSlotPrompt',
    backendFiles: ['services/engine/booking/BookingLogicEngine.js'],
    dbPath: 'aiAgentSettings.agent2.bookingPrompts.confirmSlot',
    uiPage: 'booking.html',
    uiSection: 'Booking Prompts',
    uiFieldId: 'input-booking-confirm-slot',
    uiFieldType: 'textarea',
    hasUiEditor: false, // VIOLATION - needs UI
    notes: 'Prompt confirming selected time slot'
  },
  
  'booking.holdMessage': {
    backendVariable: 'holdMessage',
    backendFiles: ['services/engine/booking/BookingLogicEngine.js', 'services/engine/agent2/Agent2DiscoveryEngine.js'],
    dbPath: 'aiAgentSettings.agent2.discovery.holdMessage',
    uiPage: 'booking.html',
    uiSection: 'Hold Message',
    uiFieldId: 'input-hold-message',
    uiFieldType: 'textarea',
    hasUiEditor: false, // VIOLATION - needs UI
    notes: 'Message while checking calendar availability'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RECOVERY MESSAGES (agent2.html)
  // ═══════════════════════════════════════════════════════════════════════════
  
  'recovery.audioUnclear': {
    backendVariable: 'audioUnclearMessage',
    backendFiles: ['routes/v2twilio.js'],
    dbPath: 'aiAgentSettings.llm0Controls.recoveryMessages.audioUnclear',
    uiPage: 'agent2.html',
    uiSection: 'Recovery Messages',
    uiFieldId: 'input-recovery-audio-unclear',
    uiFieldType: 'textarea',
    hasUiEditor: false, // VIOLATION - needs UI
    notes: 'Message when audio is unclear/garbled'
  },
  
  'recovery.noSpeech': {
    backendVariable: 'noSpeechMessage',
    backendFiles: ['routes/v2twilio.js'],
    dbPath: 'aiAgentSettings.llm0Controls.recoveryMessages.noSpeech',
    uiPage: 'agent2.html',
    uiSection: 'Recovery Messages',
    uiFieldId: 'input-recovery-no-speech',
    uiFieldType: 'textarea',
    hasUiEditor: false, // VIOLATION - needs UI
    notes: 'Message when caller is silent'
  },
  
  'recovery.timeout': {
    backendVariable: 'timeoutMessage',
    backendFiles: ['routes/v2twilio.js'],
    dbPath: 'aiAgentSettings.llm0Controls.recoveryMessages.timeout',
    uiPage: 'agent2.html',
    uiSection: 'Recovery Messages',
    uiFieldId: 'input-recovery-timeout',
    uiFieldType: 'textarea',
    hasUiEditor: false, // VIOLATION - needs UI
    notes: 'Message on speech recognition timeout'
  },
  
  'recovery.maxRetries': {
    backendVariable: 'maxRetriesMessage',
    backendFiles: ['routes/v2twilio.js'],
    dbPath: 'aiAgentSettings.llm0Controls.recoveryMessages.maxRetries',
    uiPage: 'agent2.html',
    uiSection: 'Recovery Messages',
    uiFieldId: 'input-recovery-max-retries',
    uiFieldType: 'textarea',
    hasUiEditor: false, // VIOLATION - needs UI
    notes: 'Message after max retry attempts'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TRIGGER RESPONSES (triggers.html)
  // ═══════════════════════════════════════════════════════════════════════════
  
  'trigger.answerText': {
    backendVariable: 'answerText',
    backendFiles: ['services/engine/agent2/TriggerMatcher.js'],
    dbPath: 'triggers[].answerText',
    uiPage: 'triggers.html',
    uiSection: 'Trigger Editor Modal',
    uiFieldId: 'modal-trigger-edit',
    uiFieldType: 'modal-form',
    hasUiEditor: true,
    notes: 'Response text for matched triggers'
  },
  
  'trigger.followUpQuestion': {
    backendVariable: 'followUpQuestion',
    backendFiles: ['services/engine/agent2/TriggerMatcher.js'],
    dbPath: 'triggers[].followUpQuestion',
    uiPage: 'triggers.html',
    uiSection: 'Trigger Editor Modal',
    uiFieldId: 'modal-trigger-edit',
    uiFieldType: 'modal-form',
    hasUiEditor: true,
    notes: 'Optional follow-up question after trigger response'
  }
};

/**
 * Get all violations (speech sources without UI editors)
 */
function getUiCoverageViolations() {
  return Object.entries(SPEECH_SOURCE_MAPPINGS)
    .filter(([, mapping]) => !mapping.hasUiEditor)
    .map(([key, mapping]) => ({
      sourceKey: key,
      backendVariable: mapping.backendVariable,
      backendFiles: mapping.backendFiles,
      dbPath: mapping.dbPath,
      requiredUi: {
        page: mapping.uiPage,
        section: mapping.uiSection,
        fieldId: mapping.uiFieldId,
        fieldType: mapping.uiFieldType
      },
      notes: mapping.notes
    }));
}

/**
 * Get mapping for a specific backend variable
 */
function getMappingForVariable(variableName) {
  return Object.entries(SPEECH_SOURCE_MAPPINGS)
    .find(([, mapping]) => mapping.backendVariable === variableName)?.[1] || null;
}

/**
 * Get all mappings for a specific UI page
 */
function getMappingsForPage(pageName) {
  return Object.entries(SPEECH_SOURCE_MAPPINGS)
    .filter(([, mapping]) => mapping.uiPage === pageName)
    .reduce((acc, [key, mapping]) => {
      acc[key] = mapping;
      return acc;
    }, {});
}

/**
 * Calculate UI coverage statistics
 */
function getUiCoverageStats() {
  const total = Object.keys(SPEECH_SOURCE_MAPPINGS).length;
  const withUi = Object.values(SPEECH_SOURCE_MAPPINGS).filter(m => m.hasUiEditor).length;
  const violations = total - withUi;
  
  return {
    totalSpeechSources: total,
    sourcesWithUi: withUi,
    sourcesWithoutUi: violations,
    coveragePercent: Math.round((withUi / total) * 100),
    compliant: violations === 0
  };
}

module.exports = {
  SPEECH_SOURCE_MAPPINGS,
  getUiCoverageViolations,
  getMappingForVariable,
  getMappingsForPage,
  getUiCoverageStats
};
