/**
 * ============================================================================
 * RUNTIME READERS MAP - Proves what config fields are ACTUALLY read at runtime
 * ============================================================================
 * 
 * This is the MISSING PIECE that makes Wiring Tab a true Source of Truth.
 * 
 * For every config field, we document:
 * - file: The file that reads it
 * - function: The function/method that reads it
 * - line: Approximate line number (for quick navigation)
 * - description: What it's used for
 * - required: Is this field required for the feature to work?
 * 
 * If a UI field is NOT in this map → it's UI_ONLY (dead config)
 * If a field IS in this map but not in UI → it's DEAD_READ (hidden config)
 * 
 * RULES:
 * 1. Every entry must point to REAL code (not aspirational)
 * 2. Update this map when you add new config readers
 * 3. Wiring Tab uses this to prove runtime coverage
 * 
 * ============================================================================
 */

const RUNTIME_READERS_MAP = {
    // =========================================================================
    // FRONT DESK - PERSONALITY
    // =========================================================================
    'frontDesk.aiName': {
        readers: [
            {
                file: 'services/llm/SystemPromptComposer.js',
                function: 'composeSystemPrompt',
                line: 45,
                description: 'Injects AI name into system prompt',
                required: true
            },
            {
                file: 'services/llm/HybridReceptionistLLM.js',
                function: 'generateResponse',
                line: 120,
                description: 'Uses AI name in self-references',
                required: true
            }
        ],
        dbPath: 'company.aiAgentSettings.aiName',
        scope: 'company',
        defaultValue: 'AI Assistant'
    },

    'frontDesk.conversationStyle': {
        readers: [
            {
                file: 'services/llm/HybridReceptionistLLM.js',
                function: 'getStyleModifiers',
                line: 85,
                description: 'Adjusts tone based on style (confident/balanced/polite)',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.conversationStyle',
        scope: 'company',
        defaultValue: 'balanced'
    },

    // =========================================================================
    // FRONT DESK - GREETING RESPONSES
    // =========================================================================
    'frontDesk.greetingResponses': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 2000,
                description: 'Greeting intercept - 0 token fast path',
                checkpoint: 'CHECKPOINT 2.7',
                required: true
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.greetingResponses',
        scope: 'company',
        defaultValue: []
    },

    // =========================================================================
    // FRONT DESK - DISCOVERY & CONSENT (KILL SWITCHES)
    // =========================================================================
    'frontDesk.discoveryConsent.forceLLMDiscovery': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 3200,
                description: 'Kill switch - forces LLM-led discovery, scenarios as tools only',
                checkpoint: 'CHECKPOINT 9a',
                required: true,
                critical: true
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.discoveryConsent.forceLLMDiscovery',
        scope: 'company',
        defaultValue: false
    },

    'frontDesk.discoveryConsent.disableScenarioAutoResponses': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 3205,
                description: 'Kill switch - prevents scenarios from auto-responding',
                checkpoint: 'CHECKPOINT 9a',
                required: true,
                critical: true
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses',
        scope: 'company',
        defaultValue: false
    },

    'frontDesk.discoveryConsent.bookingRequiresExplicitConsent': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 3210,
                description: 'Requires explicit "yes" before entering booking mode',
                checkpoint: 'CHECKPOINT 9a',
                required: true
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.discoveryConsent.bookingRequiresExplicitConsent',
        scope: 'company',
        defaultValue: true
    },

    'frontDesk.discoveryConsent.consentPhrases': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'detectConsent',
                line: 1200,
                description: 'Phrases that trigger consent detection',
                required: true
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.discoveryConsent.consentPhrases',
        scope: 'company',
        defaultValue: ['yes', 'sure', 'okay', 'please', 'go ahead', 'schedule', 'book']
    },

    'frontDesk.discoveryConsent.autoReplyAllowedScenarioTypes': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 3800,
                description: 'Which scenario types can auto-respond without LLM',
                required: true
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.discoveryConsent.autoReplyAllowedScenarioTypes',
        scope: 'company',
        defaultValue: ['FAQ', 'TROUBLESHOOT', 'EMERGENCY']
    },

    // =========================================================================
    // FRONT DESK - BOOKING SLOTS
    // =========================================================================
    'frontDesk.bookingSlots': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 2800,
                description: 'Normalizes and validates booking slots',
                checkpoint: 'CHECKPOINT 8',
                required: true
            },
            {
                file: 'services/booking/BookingEngine.js',
                function: 'normalizeSlots',
                line: 50,
                description: 'Validates slot structure (id, type, question required)',
                required: true
            },
            {
                file: 'services/booking/SlotStateMachine.js',
                function: 'getNextSlot',
                line: 100,
                description: 'Determines which slot to ask next',
                required: true
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.bookingSlots',
        scope: 'company',
        defaultValue: [],
        validators: ['hasId', 'hasType', 'hasQuestion']
    },

    'frontDesk.bookingEnabled': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 2750,
                description: 'Master switch for booking functionality',
                required: true
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.bookingEnabled',
        scope: 'company',
        defaultValue: true
    },

    // =========================================================================
    // FRONT DESK - FAST PATH BOOKING
    // =========================================================================
    'frontDesk.fastPathBooking.enabled': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 3500,
                description: 'Enables immediate booking offer for urgent keywords',
                checkpoint: 'CHECKPOINT 9d.1',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.fastPathBooking.enabled',
        scope: 'company',
        defaultValue: true
    },

    'frontDesk.fastPathBooking.triggerKeywords': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 3510,
                description: 'Keywords that trigger fast-path booking offer',
                checkpoint: 'CHECKPOINT 9d.1',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.fastPathBooking.triggerKeywords',
        scope: 'company',
        defaultValue: ['schedule', 'appointment', 'book', 'come out', 'send someone']
    },

    'frontDesk.fastPathBooking.offerScript': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 3520,
                description: 'Response when fast-path triggers',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.fastPathBooking.offerScript',
        scope: 'company',
        defaultValue: 'Okay. would you like me to schedule that for you now?'
    },

    // =========================================================================
    // FRONT DESK - VOCABULARY
    // =========================================================================
    'frontDesk.vocabulary': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 1900,
                description: 'Translates caller slang to standard terms',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.vocabulary',
        scope: 'company',
        defaultValue: {}
    },

    // =========================================================================
    // FRONT DESK - ESCALATION
    // =========================================================================
    'frontDesk.escalation.enabled': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 2140,
                description: 'Master switch for human transfer triggers',
                required: true
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.escalation.enabled',
        scope: 'company',
        defaultValue: true
    },

    'frontDesk.escalation.triggerPhrases': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 2146,
                description: 'Phrases that trigger human transfer',
                required: true
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.escalation.triggerPhrases',
        scope: 'company',
        defaultValue: ['speak to a human', 'talk to someone', 'real person', 'transfer me']
    },

    'frontDesk.escalation.transferMessage': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 2150,
                description: 'Message played during transfer',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.escalation.transferMessage',
        scope: 'company',
        defaultValue: 'One moment while I transfer you to our team.'
    },

    // =========================================================================
    // FRONT DESK - EMOTIONS
    // =========================================================================
    'frontDesk.emotions': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'detectEmotion',
                line: 1100,
                description: 'Emotion detection configuration',
                checkpoint: 'CHECKPOINT 9d',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.emotions',
        scope: 'company',
        defaultValue: {}
    },

    // =========================================================================
    // FRONT DESK - FRUSTRATION
    // =========================================================================
    'frontDesk.frustration': {
        readers: [
            {
                file: 'services/FrustrationEngine.js',
                function: 'detectFrustration',
                line: 30,
                description: 'Frustration detection and de-escalation',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.frustration',
        scope: 'company',
        defaultValue: {}
    },

    // =========================================================================
    // FRONT DESK - FORBIDDEN PHRASES
    // =========================================================================
    'frontDesk.forbiddenPhrases': {
        readers: [
            {
                file: 'services/llm/HybridReceptionistLLM.js',
                function: 'composeSystemPrompt',
                line: 200,
                description: 'Phrases AI must never say (added to system prompt)',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.forbiddenPhrases',
        scope: 'company',
        defaultValue: []
    },

    // =========================================================================
    // FRONT DESK - LOOP PREVENTION
    // =========================================================================
    'frontDesk.loopPrevention': {
        readers: [
            {
                file: 'services/LoopDetector.js',
                function: 'detectLoop',
                line: 25,
                description: 'Detects and breaks conversation loops',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.loopPrevention',
        scope: 'company',
        defaultValue: {}
    },

    // =========================================================================
    // FRONT DESK - FALLBACKS
    // =========================================================================
    'frontDesk.fallbackResponses': {
        readers: [
            {
                file: 'services/llm/HybridReceptionistLLM.js',
                function: 'getFallbackResponse',
                line: 300,
                description: 'Responses when no match found',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.fallbackResponses',
        scope: 'company',
        defaultValue: {}
    },

    // =========================================================================
    // DATA CONFIG - TEMPLATE REFERENCES (CRITICAL)
    // =========================================================================
    'dataConfig.templateReferences': {
        readers: [
            {
                file: 'services/ScenarioPoolService.js',
                function: 'getScenarioPoolForCompany',
                line: 50,
                description: 'Loads scenario pool from referenced templates',
                required: true,
                critical: true
            },
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 1950,
                description: 'Loads template for vocabulary/synonyms',
                checkpoint: 'CHECKPOINT 2.6',
                required: true
            }
        ],
        dbPath: 'company.aiAgentSettings.templateReferences',
        scope: 'company',
        defaultValue: [],
        validators: ['hasTemplateId', 'templateExists']
    },

    // =========================================================================
    // DATA CONFIG - CHEAT SHEETS
    // =========================================================================
    'dataConfig.cheatSheets': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 1920,
                description: 'Loads cheat sheets for FAQ fallback',
                checkpoint: 'CHECKPOINT 2.5',
                required: false
            },
            {
                file: 'services/CheatSheetRuntimeService.js',
                function: 'getCheatSheetForCompany',
                line: 30,
                description: 'Runtime cheat sheet resolver',
                required: false
            }
        ],
        dbPath: 'CheatSheetVersion collection (companyId filter)',
        scope: 'company',
        defaultValue: null
    },

    // =========================================================================
    // DATA CONFIG - PLACEHOLDERS
    // =========================================================================
    'dataConfig.placeholders': {
        readers: [
            {
                file: 'services/ResponseRenderer.js',
                function: 'renderResponse',
                line: 40,
                description: 'Replaces {companyName}, {phone}, etc. in responses',
                required: false
            }
        ],
        dbPath: 'CompanyPlaceholders collection (companyId filter)',
        scope: 'company',
        defaultValue: {}
    },

    // =========================================================================
    // TRANSFER CALLS
    // =========================================================================
    'transfers.transferTargets': {
        readers: [
            {
                file: 'services/TransferRouter.js',
                function: 'resolveTransferTarget',
                line: 50,
                description: 'Resolves transfer destination',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.transferTargets',
        scope: 'company',
        defaultValue: []
    },

    // =========================================================================
    // DYNAMIC FLOWS
    // =========================================================================
    'dynamicFlow.companyFlows': {
        readers: [
            {
                file: 'services/DynamicFlowEngine.js',
                function: 'processFlows',
                line: 100,
                description: 'Evaluates trigger-action flows each turn',
                checkpoint: 'CHECKPOINT 3 (V41)',
                required: false
            }
        ],
        dbPath: 'DynamicFlow collection (companyId filter, isTemplate=false)',
        scope: 'company',
        defaultValue: []
    },

    // =========================================================================
    // INFRASTRUCTURE - REDIS CACHE
    // =========================================================================
    'infra.scenarioPoolCache': {
        readers: [
            {
                file: 'services/ScenarioPoolService.js',
                function: 'getCachedPool',
                line: 30,
                description: 'Caches scenario pool for 5 minutes',
                required: false
            }
        ],
        dbPath: null,
        redisKey: 'scenario-pool:{companyId}',
        scope: 'company',
        cacheTTL: 300
    },

    // =========================================================================
    // SCENARIOS (from templates)
    // =========================================================================
    'dataConfig.scenarios': {
        readers: [
            {
                file: 'services/HybridScenarioSelector.js',
                function: 'selectBestScenario',
                line: 150,
                description: 'Matches user input to scenarios',
                required: true
            },
            {
                file: 'services/llm/LLMDiscoveryEngine.js',
                function: 'retrieveScenarios',
                line: 80,
                description: 'Retrieves scenarios as LLM tools',
                checkpoint: 'CHECKPOINT 9c',
                required: true
            }
        ],
        dbPath: 'GlobalInstantResponseTemplate.categories[].scenarios[] (via templateReferences)',
        scope: 'global',
        defaultValue: []
    }
};

/**
 * Get runtime readers for a specific config path
 * @param {string} configPath - e.g., 'frontDesk.bookingSlots'
 * @returns {Object|null} Reader info or null if not mapped
 */
function getReaders(configPath) {
    return RUNTIME_READERS_MAP[configPath] || null;
}

/**
 * Check if a config path has runtime readers (not UI_ONLY)
 * @param {string} configPath
 * @returns {boolean}
 */
function hasRuntimeReaders(configPath) {
    const entry = RUNTIME_READERS_MAP[configPath];
    return entry && Array.isArray(entry.readers) && entry.readers.length > 0;
}

/**
 * Get all config paths that are critical
 * @returns {string[]}
 */
function getCriticalPaths() {
    return Object.entries(RUNTIME_READERS_MAP)
        .filter(([_, entry]) => entry.readers?.some(r => r.critical))
        .map(([path]) => path);
}

/**
 * Get all config paths by scope
 * @param {'company'|'global'} scope
 * @returns {string[]}
 */
function getPathsByScope(scope) {
    return Object.entries(RUNTIME_READERS_MAP)
        .filter(([_, entry]) => entry.scope === scope)
        .map(([path]) => path);
}

/**
 * Generate coverage report
 * @param {string[]} uiPaths - Paths discovered in UI
 * @returns {Object} Coverage analysis
 */
function analyzeCoverage(uiPaths) {
    const runtimePaths = Object.keys(RUNTIME_READERS_MAP);
    
    const uiOnly = uiPaths.filter(p => !RUNTIME_READERS_MAP[p]);
    const deadRead = runtimePaths.filter(p => !uiPaths.includes(p));
    const wired = uiPaths.filter(p => RUNTIME_READERS_MAP[p]);
    
    return {
        totalUIPaths: uiPaths.length,
        totalRuntimePaths: runtimePaths.length,
        wiredCount: wired.length,
        uiOnlyCount: uiOnly.length,
        deadReadCount: deadRead.length,
        uiOnlyPaths: uiOnly,
        deadReadPaths: deadRead,
        wiredPaths: wired,
        runtimeCoveragePercent: uiPaths.length > 0 
            ? Math.round((wired.length / uiPaths.length) * 100) 
            : 0
    };
}

module.exports = {
    RUNTIME_READERS_MAP,
    getReaders,
    hasRuntimeReaders,
    getCriticalPaths,
    getPathsByScope,
    analyzeCoverage
};

