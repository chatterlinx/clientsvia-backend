/**
 * ============================================================================
 * AGENT WIRING (AW) CONFIG READER - THE SINGLE CHOKEPOINT
 * ============================================================================
 * 
 * THE NON-NEGOTIABLE CONTRACT:
 * Every config read that affects agent behavior MUST go through this service.
 * Every read emits a CONFIG_READ event to Raw Events (Black Box).
 * Every read is validated against the AW Registry.
 * 
 * ENFORCEMENT MODES:
 *   - "off"   : No validation, just read (not recommended)
 *   - "warn"  : Log AW_VIOLATION but allow read (default in prod)
 *   - "throw" : Throw error on unregistered path (default in dev/test)
 * 
 * If runtime reads config without using this service, it's a violation.
 * 
 * USAGE:
 *   const AWConfigReader = require('./services/wiring/AWConfigReader');
 *   
 *   // At call start, initialize with context
 *   const reader = AWConfigReader.forCall({ callId, companyId, turn: 0, runtimeConfig });
 *   
 *   // Read config with automatic CONFIG_READ emission + registry validation
 *   const bookingSlots = reader.get('frontDesk.bookingSlots');
 *   const aiName = reader.get('frontDesk.aiName', 'AI Assistant'); // with default
 * 
 * EVENTS EMITTED:
 *   CONFIG_READ  - Every successful config read
 *   AW_VIOLATION - Unregistered path read attempt (when enforcement active)
 * 
 * ============================================================================
 */

const crypto = require('crypto');
const logger = require('../../utils/logger');

// ============================================================================
// REGISTRY INTEGRATION
// ============================================================================

let wiringRegistryV2;
let RUNTIME_READERS_MAP;
let registryPaths = new Set(); // Cache of valid AW paths

try {
    const registry = require('./wiringRegistry.v2');
    wiringRegistryV2 = registry.wiringRegistryV2;
    RUNTIME_READERS_MAP = require('./runtimeReaders.map').RUNTIME_READERS_MAP;
    
    // Build the set of valid AW paths from registry
    if (wiringRegistryV2?.tabs) {
        extractPathsFromRegistry(wiringRegistryV2);
    }
} catch (e) {
    logger.warn('[AW CONFIG READER] Registry not available - validation disabled', { error: e.message });
}

/**
 * Extract all valid AW paths from the registry structure
 */
function extractPathsFromRegistry(registry) {
    registryPaths.clear();
    
    function extractFromNode(node) {
        if (!node) return;
        
        // Extract id from current node
        if (node.id && typeof node.id === 'string' && !node.id.startsWith('tab.')) {
            registryPaths.add(node.id);
        }
        
        // Recurse into arrays
        if (Array.isArray(node)) {
            node.forEach(extractFromNode);
            return;
        }
        
        // Recurse into nested structures
        if (typeof node === 'object') {
            if (node.tabs) extractFromNode(node.tabs);
            if (node.sections) extractFromNode(node.sections);
            if (node.fields) extractFromNode(node.fields);
            if (node.children) extractFromNode(node.children);
        }
    }
    
    extractFromNode(registry);
    
    // Also add paths from RUNTIME_READERS_MAP
    if (RUNTIME_READERS_MAP) {
        Object.keys(RUNTIME_READERS_MAP).forEach(path => registryPaths.add(path));
    }
    
    logger.info('[AW CONFIG READER] Registry loaded', { 
        validPaths: registryPaths.size 
    });
}

// ============================================================================
// BLACKBOX LOGGER INTEGRATION
// ============================================================================

let BlackBoxLogger;
try {
    BlackBoxLogger = require('../BlackBoxLogger');
} catch (e) {
    logger.warn('[AW CONFIG READER] BlackBoxLogger not available - tracing disabled');
}

// ============================================================================
// ENFORCEMENT CONFIGURATION
// ============================================================================

// Default enforcement mode based on environment
const DEFAULT_ENFORCEMENT_MODE = process.env.NODE_ENV === 'production' ? 'warn' : 'throw';

// Global enforcement override (can be set via env or runtime)
let globalEnforcementMode = process.env.AW_ENFORCEMENT_MODE || DEFAULT_ENFORCEMENT_MODE;

/**
 * Set global enforcement mode
 * @param {'off'|'warn'|'throw'} mode
 */
function setGlobalEnforcementMode(mode) {
    if (['off', 'warn', 'throw'].includes(mode)) {
        globalEnforcementMode = mode;
        logger.info('[AW CONFIG READER] Enforcement mode set', { mode });
    }
}

/**
 * Get current enforcement mode
 */
function getEnforcementMode() {
    return globalEnforcementMode;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Hash a value for the trace (don't log full values for security)
 */
function hashValue(value) {
    if (value === undefined || value === null) return 'null';
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    return 'sha256:' + crypto.createHash('sha256').update(str).digest('hex').substring(0, 12);
}

/**
 * Create a preview of the value (safe for logging)
 */
function valuePreview(value) {
    if (value === undefined) return 'undefined';
    if (value === null) return 'null';
    if (typeof value === 'boolean') return String(value);
    if (typeof value === 'number') return String(value);
    if (typeof value === 'string') {
        return value.length > 30 ? `"${value.substring(0, 30)}..."` : `"${value}"`;
    }
    if (Array.isArray(value)) return `[${value.length} items]`;
    if (typeof value === 'object') {
        const keys = Object.keys(value);
        return `{${keys.length} keys}`;
    }
    return String(value).substring(0, 30);
}

/**
 * Resolve value from nested object by path
 */
function getByPath(obj, path) {
    if (!obj || !path) return undefined;
    const parts = path.split('.');
    let current = obj;
    for (const part of parts) {
        if (current == null) return undefined;
        current = current[part];
    }
    return current;
}

/**
 * Determine where the value was resolved from
 */
function determineSource(awPath, value, runtimeConfig) {
    if (runtimeConfig?._isDefault) return 'globalDefaults';
    
    const readerInfo = RUNTIME_READERS_MAP?.[awPath];
    if (readerInfo?.defaultValue !== undefined) {
        const defaultVal = readerInfo.defaultValue;
        const defaultStr = JSON.stringify(defaultVal);
        const valueStr = JSON.stringify(value);
        if (defaultStr === valueStr) {
            return 'globalDefaults';
        }
    }
    
    return 'companyConfig';
}

/**
 * Check if a path is registered in the AW registry
 */
function isPathRegistered(awPath) {
    if (registryPaths.size === 0) return true; // No registry loaded, allow all
    
    // Direct match
    if (registryPaths.has(awPath)) return true;
    
    // Check if it's a child of a registered path (e.g., frontDesk.bookingSlots.0.question)
    // We allow access to sub-properties of registered objects
    const parts = awPath.split('.');
    for (let i = parts.length - 1; i > 0; i--) {
        const parentPath = parts.slice(0, i).join('.');
        if (registryPaths.has(parentPath)) return true;
    }
    
    return false;
}

// ============================================================================
// AW PATH MAPPINGS
// ============================================================================

/**
 * Map AW canonical paths to actual runtime config structure.
 * This is the translation layer between registry and implementation.
 */
const AW_PATH_MAPPINGS = {
    // ─────────────────────────────────────────────────────────────────────────
    // FRONT DESK - Personality
    // ─────────────────────────────────────────────────────────────────────────
    'frontDesk.aiName': 'aiAgentSettings.frontDeskBehavior.aiName',
    'frontDesk.conversationStyle': 'aiAgentSettings.frontDeskBehavior.conversationStyle',
    'frontDesk.styleAcknowledgments': 'aiAgentSettings.frontDeskBehavior.styleAcknowledgments',
    'frontDesk.personality.warmth': 'aiAgentSettings.frontDeskBehavior.personality.warmth',
    'frontDesk.personality.speakingPace': 'aiAgentSettings.frontDeskBehavior.personality.speakingPace',
    
    // ─────────────────────────────────────────────────────────────────────────
    // FRONT DESK - Greetings
    // ─────────────────────────────────────────────────────────────────────────
    'frontDesk.greetingResponses': 'aiAgentSettings.frontDeskBehavior.conversationStages.greetingResponses',
    'frontDesk.greetingRules': 'aiAgentSettings.frontDeskBehavior.conversationStages.greetingRules',
    
    // ─────────────────────────────────────────────────────────────────────────
    // FRONT DESK - Discovery & Consent
    // ─────────────────────────────────────────────────────────────────────────
    'frontDesk.discoveryConsent': 'aiAgentSettings.frontDeskBehavior.discoveryConsent',
    'frontDesk.discoveryConsent.forceLLMDiscovery': 'aiAgentSettings.frontDeskBehavior.discoveryConsent.forceLLMDiscovery',
    'frontDesk.discoveryConsent.disableScenarioAutoResponses': 'aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses',
    'frontDesk.discoveryConsent.bookingRequiresExplicitConsent': 'aiAgentSettings.frontDeskBehavior.discoveryConsent.bookingRequiresExplicitConsent',
    'frontDesk.discoveryConsent.consentPhrases': 'aiAgentSettings.frontDeskBehavior.discoveryConsent.consentPhrases',
    'frontDesk.discoveryConsent.autoReplyAllowedScenarioTypes': 'aiAgentSettings.frontDeskBehavior.discoveryConsent.autoReplyAllowedScenarioTypes',
    'frontDesk.discoveryConsent.techNameExcludeWords': 'aiAgentSettings.frontDeskBehavior.discoveryConsent.techNameExcludeWords',
    'frontDesk.discoveryConsent.minDiscoveryFieldsBeforeConsent': 'aiAgentSettings.frontDeskBehavior.discoveryConsent.minDiscoveryFieldsBeforeConsent',
    'frontDesk.discoveryConsent.issueCaptureMinConfidence': 'aiAgentSettings.frontDeskBehavior.discoveryConsent.issueCaptureMinConfidence',
    'frontDesk.discoveryConsent.autoInjectConsentInScenarios': 'aiAgentSettings.frontDeskBehavior.discoveryConsent.autoInjectConsentInScenarios',
    'frontDesk.discoveryConsent.clarifyingQuestions': 'aiAgentSettings.frontDeskBehavior.discoveryConsent.clarifyingQuestions',
    'frontDesk.discoveryConsent.clarifyingQuestions.enabled': 'aiAgentSettings.frontDeskBehavior.discoveryConsent.clarifyingQuestions.enabled',
    'frontDesk.discoveryConsent.clarifyingQuestions.vaguePatterns': 'aiAgentSettings.frontDeskBehavior.discoveryConsent.clarifyingQuestions.vaguePatterns',
    
    // ─────────────────────────────────────────────────────────────────────────
    // FRONT DESK - Business Hours
    // ─────────────────────────────────────────────────────────────────────────
    'frontDesk.businessHours': 'aiAgentSettings.frontDeskBehavior.businessHours',
    
    // ─────────────────────────────────────────────────────────────────────────
    // FRONT DESK - Booking
    // ─────────────────────────────────────────────────────────────────────────
    'frontDesk.bookingEnabled': 'aiAgentSettings.frontDeskBehavior.bookingEnabled',
    'frontDesk.bookingSlots': 'aiAgentSettings.frontDeskBehavior.bookingSlots',
    'frontDesk.bookingOutcome': 'aiAgentSettings.frontDeskBehavior.bookingOutcome',
    'frontDesk.bookingAbortPhrases': 'aiAgentSettings.frontDeskBehavior.bookingAbortPhrases',
    'frontDesk.commonFirstNames': 'aiAgentSettings.frontDeskBehavior.commonFirstNames',
    'frontDesk.nameSpellingVariants': 'aiAgentSettings.frontDeskBehavior.nameSpellingVariants',
    'frontDesk.addressValidation': 'aiAgentSettings.frontDeskBehavior.bookingSlots.addressValidation',
    'booking.addressVerification': 'aiAgentSettings.frontDesk.booking.addressVerification',
    'booking.addressVerification': 'aiAgentSettings.frontDesk.booking.addressVerification',
    'booking.addressVerification.enabled': 'aiAgentSettings.frontDesk.booking.addressVerification.enabled',
    'booking.addressVerification.provider': 'aiAgentSettings.frontDesk.booking.addressVerification.provider',
    'booking.addressVerification.requireCity': 'aiAgentSettings.frontDesk.booking.addressVerification.requireCity',
    'booking.addressVerification.requireState': 'aiAgentSettings.frontDesk.booking.addressVerification.requireState',
    'booking.addressVerification.requireZip': 'aiAgentSettings.frontDesk.booking.addressVerification.requireZip',
    'booking.addressVerification.requireUnitQuestion': 'aiAgentSettings.frontDesk.booking.addressVerification.requireUnitQuestion',
    'booking.addressVerification.unitQuestionMode': 'aiAgentSettings.frontDesk.booking.addressVerification.unitQuestionMode',
    'booking.addressVerification.missingCityStatePrompt': 'aiAgentSettings.frontDesk.booking.addressVerification.missingCityStatePrompt',
    'booking.addressVerification.unitTypePrompt': 'aiAgentSettings.frontDesk.booking.addressVerification.unitTypePrompt',
    
    // Name Parsing (last-name-first support)
    'booking.nameParsing': 'aiAgentSettings.frontDeskBehavior.booking.nameParsing',
    'booking.nameParsing.acceptLastNameOnly': 'aiAgentSettings.frontDeskBehavior.booking.nameParsing.acceptLastNameOnly',
    'booking.nameParsing.lastNameOnlyPrompt': 'aiAgentSettings.frontDeskBehavior.booking.nameParsing.lastNameOnlyPrompt',
    
    // Google Geo Integration (V93)
    'integrations.googleGeo': 'integrations.googleGeo',
    'integrations.googleGeo.enabled': 'integrations.googleGeo.enabled',
    'integrations.googleGeo.verificationMode': 'integrations.googleGeo.verificationMode',
    'integrations.googleGeo.minConfidence': 'integrations.googleGeo.minConfidence',
    
    // ─────────────────────────────────────────────────────────────────────────
    // SLOT EXTRACTION - Name stop words, merge rules, confidence thresholds
    // ─────────────────────────────────────────────────────────────────────────
    'slotExtraction.nameStopWords': 'aiAgentSettings.nameStopWords',
    'slotExtraction.nameStopWords.enabled': 'aiAgentSettings.nameStopWords.enabled',
    'slotExtraction.nameStopWords.custom': 'aiAgentSettings.nameStopWords.custom',
    
    // Merge rules (V92 name protection, conflict detection)
    'slotExtraction.mergeRules': 'aiAgentSettings.slotExtraction.mergeRules',
    'slotExtraction.mergeRules.nameProtectionThreshold': 'aiAgentSettings.slotExtraction.mergeRules.nameProtectionThreshold', // Default 0.8
    'slotExtraction.mergeRules.conflictDiffThreshold': 'aiAgentSettings.slotExtraction.mergeRules.conflictDiffThreshold', // Default 0.15
    'slotExtraction.mergeRules.requireExplicitPhraseForOverwrite': 'aiAgentSettings.slotExtraction.mergeRules.requireExplicitPhraseForOverwrite',
    
    // Confidence constants (can be overridden per company)
    'slotExtraction.confidence.callerId': 'aiAgentSettings.slotExtraction.confidence.callerId', // Default 0.7
    'slotExtraction.confidence.utteranceLow': 'aiAgentSettings.slotExtraction.confidence.utteranceLow', // Default 0.6
    'slotExtraction.confidence.utteranceHigh': 'aiAgentSettings.slotExtraction.confidence.utteranceHigh', // Default 0.9
    'slotExtraction.confidence.confirmed': 'aiAgentSettings.slotExtraction.confidence.confirmed', // Default 1.0
    
    // Correction phrase patterns
    'slotExtraction.correctionPhrases': 'aiAgentSettings.slotExtraction.correctionPhrases',
    
    // ─────────────────────────────────────────────────────────────────────────
    // FRONT DESK - Greeting Rules (legacy and new)
    // ─────────────────────────────────────────────────────────────────────────
    'frontDesk.conversationStages': 'aiAgentSettings.frontDeskBehavior.conversationStages',
    'frontDesk.conversationStages.greetingRules': 'aiAgentSettings.frontDeskBehavior.conversationStages.greetingRules',
    'frontDesk.conversationStages.greetingResponses': 'aiAgentSettings.frontDeskBehavior.conversationStages.greetingResponses',
    
    // ─────────────────────────────────────────────────────────────────────────
    // FRONT DESK - Booking Continuity
    // ─────────────────────────────────────────────────────────────────────────
    'frontDesk.offRailsRecovery.bridgeBack.resumeBooking': 'aiAgentSettings.frontDeskBehavior.offRailsRecovery.bridgeBack.resumeBooking',
    'frontDesk.confirmationRequests': 'aiAgentSettings.frontDeskBehavior.confirmationRequests',
    
    // ─────────────────────────────────────────────────────────────────────────
    // FRONT DESK - Fast Path Booking
    // ─────────────────────────────────────────────────────────────────────────
    'frontDesk.fastPathBooking': 'aiAgentSettings.frontDeskBehavior.fastPathBooking',
    'frontDesk.fastPathBooking.enabled': 'aiAgentSettings.frontDeskBehavior.fastPathBooking.enabled',
    'frontDesk.fastPathBooking.triggerKeywords': 'aiAgentSettings.frontDeskBehavior.fastPathBooking.triggerKeywords',
    'frontDesk.fastPathBooking.offerScript': 'aiAgentSettings.frontDeskBehavior.fastPathBooking.offerScript',
    
    // ─────────────────────────────────────────────────────────────────────────
    // FRONT DESK - Vocabulary & Language
    // ─────────────────────────────────────────────────────────────────────────
    'frontDesk.vocabulary': 'aiAgentSettings.frontDeskBehavior.vocabulary',
    'frontDesk.callerVocabulary': 'aiAgentSettings.frontDeskBehavior.callerVocabulary',
    'frontDesk.fillerWordsEnabled': 'aiAgentSettings.frontDeskBehavior.fillerWordsEnabled',
    
    // ─────────────────────────────────────────────────────────────────────────
    // FRONT DESK - Escalation
    // ─────────────────────────────────────────────────────────────────────────
    'frontDesk.escalation': 'aiAgentSettings.frontDeskBehavior.escalation',
    'frontDesk.escalation.enabled': 'aiAgentSettings.frontDeskBehavior.escalation.enabled',
    'frontDesk.escalation.triggerPhrases': 'aiAgentSettings.frontDeskBehavior.escalation.triggerPhrases',
    'frontDesk.escalation.transferMessage': 'aiAgentSettings.frontDeskBehavior.escalation.transferMessage',
    
    // ─────────────────────────────────────────────────────────────────────────
    // FRONT DESK - Emotions & Frustration
    // ─────────────────────────────────────────────────────────────────────────
    'frontDesk.emotions': 'aiAgentSettings.frontDeskBehavior.emotionResponses',
    'frontDesk.emotionResponses': 'aiAgentSettings.frontDeskBehavior.emotionResponses',
    'frontDesk.frustration': 'aiAgentSettings.frontDeskBehavior.frustrationTriggers',
    'frontDesk.frustrationTriggers': 'aiAgentSettings.frontDeskBehavior.frustrationTriggers',
    'frontDesk.detectionTriggers': 'aiAgentSettings.frontDeskBehavior.detectionTriggers',
    
    // ─────────────────────────────────────────────────────────────────────────
    // FRONT DESK - Loops & Fallbacks
    // ─────────────────────────────────────────────────────────────────────────
    'frontDesk.loopPrevention': 'aiAgentSettings.frontDeskBehavior.loopPrevention',
    'frontDesk.fallbackResponses': 'aiAgentSettings.frontDeskBehavior.fallbackResponses',
    'frontDesk.forbiddenPhrases': 'aiAgentSettings.frontDeskBehavior.forbiddenPhrases',
    
    // ─────────────────────────────────────────────────────────────────────────
    // VOICE SETTINGS
    // ─────────────────────────────────────────────────────────────────────────
    'voice.silenceHandling': 'aiAgentSettings.voiceSettings.silenceHandling',
    'voice.silencePrompts': 'aiAgentSettings.voiceSettings.silenceHandling.silencePrompts',
    
    // ─────────────────────────────────────────────────────────────────────────
    // DATA CONFIG
    // ─────────────────────────────────────────────────────────────────────────
    'dataConfig.templateReferences': 'aiAgentSettings.templateReferences',
    
    // ─────────────────────────────────────────────────────────────────────────
    // CALL FLOW ENGINE
    // ─────────────────────────────────────────────────────────────────────────
    'callFlowEngine': 'aiAgentSettings.callFlowEngine',
    'callFlowEngine.enabled': 'aiAgentSettings.callFlowEngine.enabled',
    'callFlowEngine.triageCards': 'aiAgentSettings.callFlowEngine.triageCards',
    'callFlowEngine.quickAnswers': 'aiAgentSettings.callFlowEngine.quickAnswers',
    'callFlowEngine.transferRules': 'aiAgentSettings.callFlowEngine.transferRules',
    
    // ─────────────────────────────────────────────────────────────────────────
    // INFRASTRUCTURE
    // ─────────────────────────────────────────────────────────────────────────
    'infra.scenarioPoolCache': 'aiAgentSettings.scenarioPoolCache',
    'infra.debugLogging': 'aiAgentSettings.debugLogging',
    
    // ─────────────────────────────────────────────────────────────────────────
    // ROUTING - Services, Cheat Sheet
    // ─────────────────────────────────────────────────────────────────────────
    'routing.services': 'aiAgentSettings.services',
    'routing.fillerWords': 'aiAgentSettings.fillerWords',
    'routing.fillerWords.custom': 'aiAgentSettings.fillerWords.custom',
    'routing.cheatSheet': 'aiAgentSettings.cheatSheet',
    'routing.cheatSheet.frontlineIntel': 'aiAgentSettings.cheatSheet.frontlineIntel',
    'routing.cheatSheet.behaviorRules': 'aiAgentSettings.cheatSheet.behaviorRules',
    
    // ─────────────────────────────────────────────────────────────────────────
    // ROUTING - Scenario matching thresholds (HybridScenarioSelector)
    // ─────────────────────────────────────────────────────────────────────────
    'routing.scenario': 'aiAgentSettings.routing.scenario',
    'routing.scenario.minConfidenceDefault': 'aiAgentSettings.routing.scenario.minConfidenceDefault', // Default 0.45
    'routing.scenario.negativeTriggerPenalty': 'aiAgentSettings.routing.scenario.negativeTriggerPenalty', // Default -1.0
    'routing.scenario.emergencyHardThreshold': 'aiAgentSettings.routing.scenario.emergencyHardThreshold', // Default 0.70
    'routing.scenario.decisiveRoutingDelta': 'aiAgentSettings.routing.scenario.decisiveRoutingDelta', // Default 0.15
    'routing.scenario.intentBonuses': 'aiAgentSettings.routing.scenario.intentBonuses',
    'routing.scenario.intentBonuses.EMERGENCY': 'aiAgentSettings.routing.scenario.intentBonuses.EMERGENCY', // Default 0.50
    'routing.scenario.intentBonuses.BOOKING': 'aiAgentSettings.routing.scenario.intentBonuses.BOOKING',
    
    // Tier thresholds (IntelligentRouter)
    'routing.tier1Threshold': 'aiAgentSettings.routing.tier1Threshold', // Default 0.80
    'routing.tier2Threshold': 'aiAgentSettings.routing.tier2Threshold', // Default 0.60
    
    // ─────────────────────────────────────────────────────────────────────────
    // INFRASTRUCTURE - AW Enforcement (Phase 6h)
    // ─────────────────────────────────────────────────────────────────────────
    'infra.aw.enforcementMode': 'aiAgentSettings.infra.aw.enforcementMode' // off | warn | throw
};

// ============================================================================
// V93: LEGACY BRIDGES (GhostBuster)
// ============================================================================
// When a new AW path doesn't exist in DB, check legacy paths.
// This allows gradual migration from old slot-level configs to new AW paths.
// If legacy is used, emit LEGACY_PATH_USED warning so we can track migration progress.
// ============================================================================
const LEGACY_BRIDGES = {
    // ─────────────────────────────────────────────────────────────────────────
    // Address Verification: New AW paths → Legacy slot-level configs
    // UI writes to bookingSlots[address].* but we read from booking.addressVerification.*
    // ─────────────────────────────────────────────────────────────────────────
    'booking.addressVerification.enabled': {
        legacyPath: 'aiAgentSettings.frontDeskBehavior.bookingSlots',
        legacyExtractor: (slots) => {
            // Find address slot and check useGoogleMapsValidation
            if (!Array.isArray(slots)) return undefined;
            const addressSlot = slots.find(s => (s.slotId || s.id || s.type) === 'address');
            return addressSlot?.useGoogleMapsValidation;
        },
        legacyDescription: 'bookingSlots[address].useGoogleMapsValidation',
        migrationNote: 'Move to booking.addressVerification.enabled via AW Cockpit'
    },
    
    'booking.addressVerification.requireUnitQuestion': {
        legacyPath: 'aiAgentSettings.frontDeskBehavior.bookingSlots',
        legacyExtractor: (slots) => {
            if (!Array.isArray(slots)) return undefined;
            const addressSlot = slots.find(s => (s.slotId || s.id || s.type) === 'address');
            // Legacy: unitNumberMode !== 'never' means ask unit question
            if (!addressSlot?.unitNumberMode) return undefined;
            return addressSlot.unitNumberMode !== 'never';
        },
        legacyDescription: 'bookingSlots[address].unitNumberMode !== "never"',
        migrationNote: 'Move to booking.addressVerification.requireUnitQuestion'
    },
    
    'booking.addressVerification.unitQuestionMode': {
        legacyPath: 'aiAgentSettings.frontDeskBehavior.bookingSlots',
        legacyExtractor: (slots) => {
            if (!Array.isArray(slots)) return undefined;
            const addressSlot = slots.find(s => (s.slotId || s.id || s.type) === 'address');
            return addressSlot?.unitNumberMode;
        },
        legacyDescription: 'bookingSlots[address].unitNumberMode',
        migrationNote: 'Move to booking.addressVerification.unitQuestionMode'
    },
    
    'booking.addressVerification.unitTypePrompt': {
        legacyPath: 'aiAgentSettings.frontDeskBehavior.bookingSlots',
        legacyExtractor: (slots) => {
            if (!Array.isArray(slots)) return undefined;
            const addressSlot = slots.find(s => (s.slotId || s.id || s.type) === 'address');
            return addressSlot?.unitNumberPrompt;
        },
        legacyDescription: 'bookingSlots[address].unitNumberPrompt',
        migrationNote: 'Move to booking.addressVerification.unitTypePrompt'
    }
};

// ============================================================================
// AWCONFIGREADER CLASS
// ============================================================================

/**
 * AWConfigReader - Per-call config reader with trace emission and registry validation
 */
class AWConfigReader {
    /**
     * Create a reader for a specific call context
     * @param {Object} context
     * @param {string} context.callId - Call ID for trace correlation
     * @param {string} context.companyId - Company ID
     * @param {number} context.turn - Current turn number
     * @param {Object} context.runtimeConfig - The loaded company document or runtime config
     * @param {string} [context.readerId] - Identifier for the calling service
     * @param {string} [context.enforcementMode] - Override enforcement mode for this reader
     * @param {string} [context.awHash] - AW effective config hash (from CALL_START)
     * @param {string} [context.traceRunId] - Trace run ID (from CALL_START)
     */
    constructor({ callId, companyId, turn = 0, runtimeConfig, readerId = 'unknown', enforcementMode = null, awHash = null, traceRunId = null }) {
        this.callId = callId;
        this.companyId = companyId;
        this.turn = turn;
        this.runtimeConfig = runtimeConfig || {};
        this.readerId = readerId;
        
        // Enforcement mode priority: param > company config > global > env default
        // Check company-specific enforcement first (Phase 6h)
        const companyEnforcement = getByPath(runtimeConfig, 'aiAgentSettings.infra.aw.enforcementMode');
        this.enforcementMode = enforcementMode || companyEnforcement || globalEnforcementMode;
        
        // AW ⇄ RE correlation keys (for every CONFIG_READ)
        this.awHash = awHash || this._computeAwHash();
        this.traceRunId = traceRunId || `tr-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        // Track reads for this call (for debugging/analysis)
        this.reads = [];
        this.violations = [];
        this.readPaths = new Set(); // Track which paths were read
        
        // Enable/disable tracing (can be toggled for performance)
        this.tracingEnabled = true;
    }
    
    /**
     * Compute AW hash from effective config
     * @private
     */
    _computeAwHash() {
        try {
            const configStr = JSON.stringify(this.runtimeConfig?.aiAgentSettings || {});
            return 'sha256:' + crypto.createHash('sha256').update(configStr).digest('hex').substring(0, 16);
        } catch (e) {
            return null;
        }
    }
    
    /**
     * Static factory for creating per-call readers
     */
    static forCall({ callId, companyId, turn = 0, runtimeConfig, readerId = 'unknown', enforcementMode = null, awHash = null, traceRunId = null }) {
        return new AWConfigReader({ callId, companyId, turn, runtimeConfig, readerId, enforcementMode, awHash, traceRunId });
    }
    
    /**
     * Update the turn number (call between turns)
     */
    setTurn(turn) {
        this.turn = turn;
        return this;
    }
    
    /**
     * Set the reader ID (which service is reading)
     */
    setReaderId(readerId) {
        this.readerId = readerId;
        return this;
    }
    
    /**
     * Read a config value by AW path
     * @param {string} awPath - Canonical AW path (e.g., 'frontDesk.bookingSlots')
     * @param {*} [defaultValue] - Default if not found
     * @returns {*} The config value
     */
    get(awPath, defaultValue = undefined) {
        // ─────────────────────────────────────────────────────────────────────
        // STEP 1: REGISTRY VALIDATION (Phase 6)
        // ─────────────────────────────────────────────────────────────────────
        if (this.enforcementMode !== 'off') {
            const isRegistered = isPathRegistered(awPath);
            
            if (!isRegistered) {
                this._handleViolation(awPath, 'UNREGISTERED_AW_PATH');
                
                if (this.enforcementMode === 'throw') {
                    throw new Error(`[AW_VIOLATION] Unregistered AW path: ${awPath}. Add to wiringRegistry.v2.js first.`);
                }
            }
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // STEP 2: RESOLVE VALUE
        // ─────────────────────────────────────────────────────────────────────
        const value = this._resolveValue(awPath) ?? defaultValue;
        
        // ─────────────────────────────────────────────────────────────────────
        // STEP 3: EMIT CONFIG_READ EVENT (Phase 3)
        // ─────────────────────────────────────────────────────────────────────
        if (this.tracingEnabled && this.callId && this.companyId) {
            this._emitConfigRead(awPath, value);
        }
        
        return value;
    }
    
    /**
     * Read multiple values at once (batch for performance)
     * @param {string[]} awPaths - Array of AW paths
     * @returns {Object} Map of path -> value
     */
    getMany(awPaths) {
        const result = {};
        for (const path of awPaths) {
            result[path] = this.get(path);
        }
        return result;
    }
    
    /**
     * Check if a config value exists and is truthy
     * @param {string} awPath - AW path
     * @returns {boolean}
     */
    isEnabled(awPath) {
        const value = this.get(awPath);
        return value === true || value === 'true' || value === 1;
    }
    
    /**
     * Check if a config value is explicitly false (not just missing)
     * @param {string} awPath - AW path
     * @returns {boolean}
     */
    isDisabled(awPath) {
        const value = this.get(awPath);
        return value === false || value === 'false' || value === 0;
    }
    
    /**
     * Get raw access to a sub-object (for complex reads)
     * Still validates the base path and emits CONFIG_READ
     * @param {string} awPath - AW path to the object
     * @returns {Object}
     */
    getObject(awPath) {
        return this.get(awPath, {});
    }
    
    /**
     * Get array access (for iteration)
     * @param {string} awPath - AW path to the array
     * @returns {Array}
     */
    getArray(awPath) {
        return this.get(awPath, []);
    }
    
    /**
     * Handle registry violation
     * @private
     */
    _handleViolation(awPath, kind) {
        const violation = {
            type: 'AW_VIOLATION',
            ts: new Date().toISOString(),
            turn: this.turn,
            data: {
                kind,
                awPath,
                readerId: this.readerId,
                enforcementMode: this.enforcementMode
            }
        };
        
        // Track locally
        this.violations.push(violation);
        
        // Log warning
        logger.warn('[AW CONFIG READER] 🚨 AW_VIOLATION', violation.data);
        
        // Emit to Black Box
        if (BlackBoxLogger?.logEvent && this.callId && this.companyId) {
            try {
                BlackBoxLogger.logEvent({
                    callId: this.callId,
                    companyId: this.companyId,
                    type: 'AW_VIOLATION',
                    turn: this.turn,
                    data: violation.data
                }).catch(() => {}); // Silent fail
            } catch (err) {
                // Silent fail - never let tracing kill the call
            }
        }
    }
    
    /**
     * Resolve value from runtime config using AW path mapping
     * V93: Now includes LEGACY_BRIDGES fallback for gradual migration
     * @private
     */
    _resolveValue(awPath) {
        // ─────────────────────────────────────────────────────────────────────
        // STEP 1: Try the canonical AW path mapping first
        // ─────────────────────────────────────────────────────────────────────
        const runtimePath = AW_PATH_MAPPINGS[awPath];
        
        if (runtimePath) {
            const value = getByPath(this.runtimeConfig, runtimePath);
            if (value !== undefined) return value;
        }
        
        // Fallback: Try common patterns
        let value = getByPath(this.runtimeConfig, awPath);
        if (value !== undefined) return value;
        
        value = getByPath(this.runtimeConfig, `aiAgentSettings.frontDeskBehavior.${awPath}`);
        if (value !== undefined) return value;
        
        value = getByPath(this.runtimeConfig, `aiAgentSettings.${awPath}`);
        if (value !== undefined) return value;
        
        // ─────────────────────────────────────────────────────────────────────
        // STEP 2: V93 LEGACY BRIDGE (GhostBuster)
        // If canonical path returned undefined, check if there's a legacy bridge
        // ─────────────────────────────────────────────────────────────────────
        const bridge = LEGACY_BRIDGES[awPath];
        if (bridge) {
            const legacyData = getByPath(this.runtimeConfig, bridge.legacyPath);
            if (legacyData !== undefined) {
                const legacyValue = bridge.legacyExtractor(legacyData);
                if (legacyValue !== undefined) {
                    // ⚠️ LEGACY PATH USED - emit warning for tracking
                    this._emitLegacyWarning(awPath, bridge);
                    return legacyValue;
                }
            }
        }
        
        return undefined;
    }
    
    /**
     * Emit LEGACY_PATH_USED warning to Raw Events
     * This helps track which legacy paths are still being used
     * @private
     */
    _emitLegacyWarning(awPath, bridge) {
        if (!this.tracingEnabled || !this.callId || !this.companyId) return;
        
        const warning = {
            type: 'LEGACY_PATH_USED',
            ts: new Date().toISOString(),
            turn: this.turn,
            data: {
                awPath,
                legacyPath: bridge.legacyDescription,
                migrationNote: bridge.migrationNote,
                readerId: this.readerId,
                traceRunId: this.traceRunId
            }
        };
        
        // Log locally
        logger.warn('[AW CONFIG READER] ⚠️ LEGACY_PATH_USED', warning.data);
        
        // Emit to Black Box
        if (BlackBoxLogger?.logEvent) {
            try {
                BlackBoxLogger.logEvent({
                    callId: this.callId,
                    companyId: this.companyId,
                    type: 'LEGACY_PATH_USED',
                    turn: this.turn,
                    data: warning.data
                }).catch(() => {}); // Silent fail
            } catch (err) {
                // Silent fail
            }
        }
    }
    
    /**
     * Emit CONFIG_READ event to Black Box
     * Every CONFIG_READ now includes awHash + traceRunId for full correlation
     * @private
     */
    async _emitConfigRead(awPath, value) {
        // Track which paths were read (for call summary)
        this.readPaths.add(awPath);
        
        const event = {
            type: 'CONFIG_READ',
            ts: new Date().toISOString(),
            turn: this.turn,
            data: {
                awPath,
                readerId: this.readerId,
                resolvedFrom: determineSource(awPath, value, this.runtimeConfig),
                valueHash: hashValue(value),
                valuePreview: valuePreview(value),
                // AW ⇄ RE correlation keys (Phase 6f)
                awHash: this.awHash,
                traceRunId: this.traceRunId
            }
        };
        
        // Track locally
        this.reads.push(event);
        
        // Emit to Black Box (non-blocking, non-fatal)
        if (BlackBoxLogger?.logEvent) {
            try {
                BlackBoxLogger.logEvent({
                    callId: this.callId,
                    companyId: this.companyId,
                    type: 'CONFIG_READ',
                    turn: this.turn,
                    data: event.data
                }).catch(() => {}); // Silent fail
            } catch (err) {
                // Silent fail - never let tracing kill the call
            }
        }
    }
    
    /**
     * Get all reads made by this reader (for debugging)
     */
    getReads() {
        return [...this.reads];
    }
    
    /**
     * Get all violations (for debugging)
     */
    getViolations() {
        return [...this.violations];
    }
    
    /**
     * Get summary of reads (for AW report)
     */
    getReadsSummary() {
        const pathCounts = {};
        const readerCounts = {};
        for (const read of this.reads) {
            const path = read.data.awPath;
            const reader = read.data.readerId;
            pathCounts[path] = (pathCounts[path] || 0) + 1;
            readerCounts[reader] = (readerCounts[reader] || 0) + 1;
        }
        return {
            totalReads: this.reads.length,
            uniquePaths: Object.keys(pathCounts).length,
            pathCounts,
            readerCounts,
            violations: this.violations.length,
            violationDetails: this.violations.map(v => v.data)
        };
    }
    
    /**
     * Emit AW_TURN_SUMMARY event to Black Box (call at end of turn)
     * V93: Renamed from AW_READ_SUMMARY for clarity (turn-level vs call-level)
     * This makes debugging instant without scrolling 400 events.
     */
    async emitSummary() {
        const summary = this.getReadsSummary();
        
        const event = {
            type: 'AW_TURN_SUMMARY',
            ts: new Date().toISOString(),
            turn: this.turn,
            data: {
                totalReads: summary.totalReads,
                uniquePaths: summary.uniquePaths,
                violations: summary.violations,
                topReaders: Object.entries(summary.readerCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5)
                    .map(([reader, count]) => ({ reader, count })),
                topPaths: Object.entries(summary.pathCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([path, count]) => ({ path, count })),
                violationPaths: summary.violationDetails.map(v => v.awPath),
                // Correlation keys
                awHash: this.awHash,
                traceRunId: this.traceRunId
            }
        };
        
        // Emit to Black Box
        if (BlackBoxLogger?.logEvent && this.callId && this.companyId) {
            try {
                await BlackBoxLogger.logEvent({
                    callId: this.callId,
                    companyId: this.companyId,
                    type: 'AW_TURN_SUMMARY',
                    turn: this.turn,
                    data: event.data
                });
                
                logger.info('[AW CONFIG READER] 📊 AW_TURN_SUMMARY emitted', {
                    callId: this.callId,
                    totalReads: summary.totalReads,
                    violations: summary.violations
                });
            } catch (err) {
                logger.warn('[AW CONFIG READER] Failed to emit AW_TURN_SUMMARY', {
                    error: err.message
                });
            }
        }
        
        return event;
    }
    
    /**
     * Emit AW_CALL_SUMMARY event to Black Box (call at END OF CALL - the money shot)
     * This is the ultimate debugging tool:
     * - Shows all reads across all turns
     * - Shows unread-but-wired paths (why didn't it trigger?)
     * - Shows read-but-unwired paths (registry drift - should be 0)
     */
    async emitCallSummary() {
        const summary = this.getReadsSummary();
        
        // Get all wired paths from registry
        const wiredPaths = Array.from(registryPaths);
        const readPathsArray = Array.from(this.readPaths);
        
        // Unread-but-wired: paths in registry that weren't read (why didn't it trigger?)
        const unreadButWired = wiredPaths.filter(p => !this.readPaths.has(p) && !p.startsWith('tab.'));
        
        // Read-but-unwired: paths read that aren't in registry (should be 0 - registry drift)
        const readButUnwired = readPathsArray.filter(p => !registryPaths.has(p));
        
        const event = {
            type: 'AW_CALL_SUMMARY',
            ts: new Date().toISOString(),
            turn: this.turn,
            data: {
                // Core metrics
                totalReads: summary.totalReads,
                uniquePaths: summary.uniquePaths,
                violations: summary.violations,
                
                // Top usage
                topReaders: Object.entries(summary.readerCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 10)
                    .map(([reader, count]) => ({ reader, count })),
                topPaths: Object.entries(summary.pathCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 15)
                    .map(([path, count]) => ({ path, count })),
                
                // Critical for "why didn't it trigger?"
                unreadButWiredCount: unreadButWired.length,
                unreadButWired: unreadButWired.slice(0, 20), // Top 20 for readability
                
                // Critical for registry drift detection (should be 0)
                readButUnwiredCount: readButUnwired.length,
                readButUnwired: readButUnwired,
                
                // Violations
                violationPaths: summary.violationDetails.map(v => v.awPath),
                
                // Correlation keys
                awHash: this.awHash,
                traceRunId: this.traceRunId
            }
        };
        
        // Emit to Black Box
        if (BlackBoxLogger?.logEvent && this.callId && this.companyId) {
            try {
                await BlackBoxLogger.logEvent({
                    callId: this.callId,
                    companyId: this.companyId,
                    type: 'AW_CALL_SUMMARY',
                    turn: this.turn,
                    data: event.data
                });
                
                logger.info('[AW CONFIG READER] 📊 AW_CALL_SUMMARY emitted (the money shot)', {
                    callId: this.callId,
                    totalReads: summary.totalReads,
                    violations: summary.violations,
                    unreadButWired: unreadButWired.length,
                    readButUnwired: readButUnwired.length
                });
            } catch (err) {
                logger.warn('[AW CONFIG READER] Failed to emit AW_CALL_SUMMARY', {
                    error: err.message
                });
            }
        }
        
        return event;
    }
}

// ============================================================================
// STATIC HELPERS
// ============================================================================

/**
 * Create a quick reader for one-off reads outside call context
 * (emits CONFIG_READ with callId='system')
 */
AWConfigReader.quickRead = function(runtimeConfig, awPath, defaultValue) {
    const reader = new AWConfigReader({
        callId: 'system',
        companyId: runtimeConfig?.companyId || runtimeConfig?._id?.toString() || 'unknown',
        turn: 0,
        runtimeConfig,
        readerId: 'AWConfigReader.quickRead',
        enforcementMode: 'warn' // Always warn for system reads
    });
    reader.tracingEnabled = false; // Don't trace system reads to Black Box
    return reader.get(awPath, defaultValue);
};

/**
 * Check if a path is in the registry (for external validation)
 */
AWConfigReader.isRegistered = isPathRegistered;

/**
 * Get all registered paths (for debugging/reporting)
 */
AWConfigReader.getRegisteredPaths = function() {
    return Array.from(registryPaths).sort();
};

/**
 * Enforcement mode management
 */
AWConfigReader.setEnforcementMode = setGlobalEnforcementMode;
AWConfigReader.getEnforcementMode = getEnforcementMode;

module.exports = AWConfigReader;
