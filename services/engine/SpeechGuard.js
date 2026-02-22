/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * SPEECH GUARD - SINGLE CHOKE POINT FOR ALL VOICE OUTPUT
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * V126: Implements the Prime Directive:
 *   "If it's not in the UI, it does not exist"
 * 
 * RULES:
 * 1. No-UI-No-Speak: Every spoken line MUST have a valid uiPath
 * 2. No-UI-No-Execute: Every routing action (transfer, DTMF, voicemail) MUST have uiPath
 * 3. All speech/routing MUST go through this guard - no direct twiml.say/play
 * 4. Violations are BLOCKED and logged as CRITICAL
 * 
 * This is the ONLY place where TwiML speech should be generated.
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../config/logger');

/**
 * SPEECH_REGISTRY: Every allowed speech source MUST be registered here.
 * If a source is not in this registry, it cannot speak.
 * 
 * This is the "whitelist" - if you add a new speech source, you MUST add it here
 * with its corresponding uiPath and uiTab.
 */
const SPEECH_REGISTRY = {
  // ═══════════════════════════════════════════════════════════════════════════
  // AGENT 2.0 SOURCES
  // ═══════════════════════════════════════════════════════════════════════════
  'agent2.greetings.callStart': {
    uiPath: 'aiAgentSettings.agent2.greetings.callStart',
    uiTab: 'Agent 2.0 > Greetings',
    configPath: 'agent2.greetings.callStart.text',
    description: 'Call start greeting'
  },
  'agent2.greetings.interceptor': {
    uiPath: 'aiAgentSettings.agent2.greetings.interceptor.rules[]',
    uiTab: 'Agent 2.0 > Greetings',
    configPath: 'agent2.greetings.interceptor.rules[].responseText',
    description: 'Greeting interceptor response'
  },
  'agent2.discovery.triggerCard': {
    uiPath: 'aiAgentSettings.agent2.discovery.playbook.rules[]',
    uiTab: 'Agent 2.0 > Configuration',
    configPath: 'agent2.discovery.playbook.rules[].answer.answerText',
    description: 'Trigger card answer'
  },
  'agent2.discovery.clarifier': {
    uiPath: 'aiAgentSettings.agent2.discovery.clarifiers',
    uiTab: 'Agent 2.0 > Configuration',
    configPath: 'agent2.discovery.clarifiers[].question',
    description: 'Clarifier question'
  },
  'agent2.discovery.fallback.noMatchAnswer': {
    uiPath: 'aiAgentSettings.agent2.discovery.playbook.fallback.noMatchAnswer',
    uiTab: 'Agent 2.0 > Configuration',
    configPath: 'agent2.discovery.playbook.fallback.noMatchAnswer',
    description: 'Fallback when no trigger matches'
  },
  'agent2.discovery.fallback.noMatchClarifierQuestion': {
    uiPath: 'aiAgentSettings.agent2.discovery.playbook.fallback.noMatchClarifierQuestion',
    uiTab: 'Agent 2.0 > Configuration',
    configPath: 'agent2.discovery.playbook.fallback.noMatchClarifierQuestion',
    description: 'Clarifier question when reason captured'
  },
  'agent2.discovery.fallback.afterAnswerQuestion': {
    uiPath: 'aiAgentSettings.agent2.discovery.playbook.fallback.afterAnswerQuestion',
    uiTab: 'Agent 2.0 > Configuration',
    configPath: 'agent2.discovery.playbook.fallback.afterAnswerQuestion',
    description: 'Follow-up question after answering'
  },
  'agent2.discovery.pendingQuestion.yes': {
    uiPath: 'aiAgentSettings.agent2.discovery.playbook.fallback.pendingYesResponse',
    uiTab: 'Agent 2.0 > Configuration',
    configPath: 'agent2.discovery.playbook.fallback.pendingYesResponse',
    description: 'Response when user says YES to pending question'
  },
  'agent2.discovery.pendingQuestion.no': {
    uiPath: 'aiAgentSettings.agent2.discovery.playbook.fallback.pendingNoResponse',
    uiTab: 'Agent 2.0 > Configuration',
    configPath: 'agent2.discovery.playbook.fallback.pendingNoResponse',
    description: 'Response when user says NO to pending question'
  },
  'agent2.discovery.pendingQuestion.reprompt': {
    uiPath: 'aiAgentSettings.agent2.discovery.playbook.fallback.pendingReprompt',
    uiTab: 'Agent 2.0 > Configuration',
    configPath: 'agent2.discovery.playbook.fallback.pendingReprompt',
    description: 'Reprompt when user response is unclear'
  },
  'agent2.discovery.robotChallenge': {
    uiPath: 'aiAgentSettings.agent2.discovery.style.robotChallenge.line',
    uiTab: 'Agent 2.0 > Configuration',
    configPath: 'agent2.discovery.style.robotChallenge.line',
    description: 'Robot challenge response'
  },
  'agent2.emergencyFallback': {
    uiPath: 'aiAgentSettings.agent2.emergencyFallbackLine.text',
    uiTab: 'Agent 2.0 > Configuration',
    configPath: 'agent2.emergencyFallbackLine.text',
    description: 'Emergency fallback line (last resort)'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CONNECTION RECOVERY SOURCES (connectionQualityGate NUKED Feb 2026)
  // ═══════════════════════════════════════════════════════════════════════════
  'connectionRecovery.choppy': {
    uiPath: 'aiAgentSettings.frontDeskBehavior.recoveryMessages.choppyConnection',
    uiTab: 'LLM-0 Behavior',
    configPath: 'frontDeskBehavior.recoveryMessages.choppyConnection',
    description: 'Choppy connection recovery message'
  },
  'connectionRecovery.silence': {
    uiPath: 'aiAgentSettings.frontDeskBehavior.recoveryMessages.silenceDetected',
    uiTab: 'LLM-0 Behavior',
    configPath: 'frontDeskBehavior.recoveryMessages.silenceDetected',
    description: 'Silence detected recovery message'
  },
  'connectionRecovery.generalError': {
    uiPath: 'aiAgentSettings.frontDeskBehavior.recoveryMessages.generalError',
    uiTab: 'LLM-0 Behavior',
    configPath: 'frontDeskBehavior.recoveryMessages.generalError',
    description: 'General error recovery message'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TRANSFER / ROUTING SOURCES (No-UI-No-Execute applies here too)
  // ═══════════════════════════════════════════════════════════════════════════
  'transfer.message': {
    uiPath: 'aiAgentSettings.transferSettings.transferMessage',
    uiTab: 'Transfer Settings',
    configPath: 'transferSettings.transferMessage',
    description: 'Transfer announcement message'
  },
  'transfer.voicemail': {
    uiPath: 'aiAgentSettings.voicemailSettings.voicemailGreeting',
    uiTab: 'Voicemail Settings',
    configPath: 'voicemailSettings.voicemailGreeting',
    description: 'Voicemail greeting'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // LEGACY / CONNECTION MESSAGES (visible in Connection Messages UI)
  // ═══════════════════════════════════════════════════════════════════════════
  'legacy.greeting': {
    uiPath: 'connectionMessages.greeting',
    uiTab: 'Connection Messages',
    configPath: 'connectionMessages.greeting',
    description: 'Legacy greeting message'
  },
  'legacy.lowConfidence': {
    uiPath: 'aiAgentSettings.lowConfidenceHandling.retryMessage',
    uiTab: 'AI Settings',
    configPath: 'aiAgentSettings.lowConfidenceHandling.retryMessage',
    description: 'Low confidence retry message'
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // SYSTEM MESSAGES (must have UI paths - even error messages)
  // ═══════════════════════════════════════════════════════════════════════════
  'system.accountSuspended': {
    uiPath: 'suspendedAccountMessage',
    uiTab: 'Account Settings',
    configPath: 'suspendedAccountMessage',
    description: 'Account suspended message'
  },
  'system.afterHours': {
    uiPath: 'aiAgentSettings.afterHoursSettings.message',
    uiTab: 'After Hours',
    configPath: 'aiAgentSettings.afterHoursSettings.message',
    description: 'After hours message'
  },
  'system.callForward': {
    uiPath: 'callForwardMessage',
    uiTab: 'Call Forward',
    configPath: 'callForwardMessage',
    description: 'Call forward announcement'
  }
};

/**
 * ROUTING_REGISTRY: Every routing action MUST be registered here.
 * No-UI-No-Execute applies to transfers, DTMF menus, voicemail, etc.
 */
const ROUTING_REGISTRY = {
  'transfer.humanAgent': {
    uiPath: 'aiAgentSettings.transferSettings',
    uiTab: 'Transfer Settings',
    configPath: 'transferSettings.enabled',
    description: 'Transfer to human agent'
  },
  'transfer.voicemail': {
    uiPath: 'aiAgentSettings.voicemailSettings',
    uiTab: 'Voicemail Settings',
    configPath: 'voicemailSettings.enabled',
    description: 'Transfer to voicemail'
  },
  'routing.afterHours': {
    uiPath: 'aiAgentSettings.afterHoursSettings',
    uiTab: 'After Hours',
    configPath: 'afterHoursSettings.enabled',
    description: 'After hours routing'
  }
};

/**
 * Validate that a speech source is allowed to speak.
 * @param {string} sourceId - The source identifier (must be in SPEECH_REGISTRY)
 * @param {string} text - The text to speak
 * @param {Object} options - Additional options
 * @returns {{ allowed: boolean, provenance: Object, error?: string }}
 */
function validateSpeechSource(sourceId, text, options = {}) {
  const registered = SPEECH_REGISTRY[sourceId];
  
  if (!registered) {
    // CRITICAL: Source is not registered - this violates No-UI-No-Speak
    return {
      allowed: false,
      provenance: {
        sourceId,
        uiPath: 'UNREGISTERED',
        uiTab: 'UNKNOWN',
        configPath: 'UNREGISTERED',
        spokenTextPreview: (text || '').substring(0, 120),
        audioUrl: options.audioUrl || null,
        reason: 'BLOCKED: Source not in SPEECH_REGISTRY',
        isFromUiConfig: false,
        blocked: true,
        severity: 'CRITICAL'
      },
      error: `SPEECH_BLOCKED: sourceId "${sourceId}" is not registered in SPEECH_REGISTRY`
    };
  }
  
  // Source is registered - validate that text is not empty
  if (!text && !options.audioUrl) {
    return {
      allowed: false,
      provenance: {
        sourceId,
        uiPath: registered.uiPath,
        uiTab: registered.uiTab,
        configPath: registered.configPath,
        spokenTextPreview: '[EMPTY]',
        audioUrl: null,
        reason: 'BLOCKED: No text or audio provided',
        isFromUiConfig: true,
        blocked: true,
        severity: 'WARNING'
      },
      error: `SPEECH_BLOCKED: sourceId "${sourceId}" has no text or audio`
    };
  }
  
  // Allowed - build provenance
  return {
    allowed: true,
    provenance: {
      sourceId,
      uiPath: registered.uiPath,
      uiTab: registered.uiTab,
      configPath: registered.configPath,
      spokenTextPreview: (text || '').substring(0, 120),
      audioUrl: options.audioUrl || null,
      reason: options.reason || `Speech from ${registered.description}`,
      isFromUiConfig: true,
      blocked: false,
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Validate that a routing action is allowed to execute.
 * @param {string} routingId - The routing identifier (must be in ROUTING_REGISTRY)
 * @param {Object} options - Additional options (targetNumber, etc.)
 * @returns {{ allowed: boolean, provenance: Object, error?: string }}
 */
function validateRoutingAction(routingId, options = {}) {
  const registered = ROUTING_REGISTRY[routingId];
  
  if (!registered) {
    return {
      allowed: false,
      provenance: {
        routingId,
        uiPath: 'UNREGISTERED',
        uiTab: 'UNKNOWN',
        configPath: 'UNREGISTERED',
        targetNumber: options.targetNumber || null,
        reason: 'BLOCKED: Routing action not in ROUTING_REGISTRY',
        isFromUiConfig: false,
        blocked: true,
        severity: 'CRITICAL'
      },
      error: `ROUTING_BLOCKED: routingId "${routingId}" is not registered in ROUTING_REGISTRY`
    };
  }
  
  return {
    allowed: true,
    provenance: {
      routingId,
      uiPath: registered.uiPath,
      uiTab: registered.uiTab,
      configPath: registered.configPath,
      targetNumber: options.targetNumber || null,
      reason: options.reason || `Routing via ${registered.description}`,
      isFromUiConfig: true,
      blocked: false,
      timestamp: new Date().toISOString()
    }
  };
}

/**
 * Build a SPEAK_PROVENANCE event for logging to Call Review.
 */
function buildProvenanceEvent(provenance, turn = null) {
  return {
    type: 'SPEAK_PROVENANCE',
    turn,
    data: provenance
  };
}

/**
 * Build a ROUTING_PROVENANCE event for logging to Call Review.
 */
function buildRoutingProvenanceEvent(provenance, turn = null) {
  return {
    type: 'ROUTING_PROVENANCE',
    turn,
    data: provenance
  };
}

/**
 * Get all registered speech sources (for export/validation).
 */
function getSpeechRegistry() {
  return { ...SPEECH_REGISTRY };
}

/**
 * Get all registered routing actions (for export/validation).
 */
function getRoutingRegistry() {
  return { ...ROUTING_REGISTRY };
}

/**
 * Check if a source is registered.
 */
function isSourceRegistered(sourceId) {
  return !!SPEECH_REGISTRY[sourceId];
}

/**
 * Check if a routing action is registered.
 */
function isRoutingRegistered(routingId) {
  return !!ROUTING_REGISTRY[routingId];
}

module.exports = {
  SPEECH_REGISTRY,
  ROUTING_REGISTRY,
  validateSpeechSource,
  validateRoutingAction,
  buildProvenanceEvent,
  buildRoutingProvenanceEvent,
  getSpeechRegistry,
  getRoutingRegistry,
  isSourceRegistered,
  isRoutingRegistered
};
