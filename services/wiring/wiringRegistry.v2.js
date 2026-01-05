/**
 * ============================================================================
 * WIRING REGISTRY V2 - SOURCE OF TRUTH
 * ============================================================================
 * 
 * This registry defines EVERY capability the platform claims to support.
 * Each node answers:
 * 
 *   1. Where is this configured? (UI path)
 *   2. Where is it stored? (DB collection + field path)
 *   3. Where is it read? (runtime readers map)
 *   4. What scope? (company vs global)
 *   5. What validation? (deterministic checks)
 *   6. What dependencies? (other nodes required)
 * 
 * STATUS CODES:
 *   ✅ WIRED - UI exists + DB saved + runtime reads + passes validation
 *   ⚠️ PARTIAL - some subfields ok, others missing
 *   🔴 MISCONFIGURED - enabled but invalid data
 *   ⬜ NOT_CONFIGURED - optional feature not set
 *   🟣 UI_ONLY - exists in UI but no runtime read
 *   🟠 DEAD_READ - runtime reads but UI doesn't expose
 *   🧨 TENANT_RISK - unscoped / global when should be company
 * 
 * RULES:
 *   - If a tab exists in UI but not here → wiring failure
 *   - If a field is here but not in UI → dead read
 *   - Update this when adding ANY new feature
 * 
 * ============================================================================
 */

const { RUNTIME_READERS_MAP } = require('./runtimeReaders.map');

const WIRING_SCHEMA_VERSION = 'WIRING_REGISTRY_V2.0';

/**
 * VALIDATORS - Reusable validation functions
 */
const VALIDATORS = {
    // Array validators
    isNonEmptyArray: (val) => Array.isArray(val) && val.length > 0,
    hasMinItems: (min) => (val) => Array.isArray(val) && val.length >= min,
    
    // Object validators
    isNonEmptyObject: (val) => val && typeof val === 'object' && Object.keys(val).length > 0,
    hasRequiredKeys: (keys) => (val) => val && keys.every(k => val[k] !== undefined),
    
    // String validators
    isNonEmptyString: (val) => typeof val === 'string' && val.trim().length > 0,
    
    // Boolean validators
    isTrue: (val) => val === true,
    isFalse: (val) => val === false,
    
    // Booking slot validators
    slotHasQuestion: (slot) => slot && (slot.question || slot.prompt),
    slotHasId: (slot) => slot && (slot.id || slot.slotId),
    slotHasType: (slot) => slot && (slot.type || slot.slotType),
    allSlotsValid: (slots) => {
        if (!Array.isArray(slots)) return false;
        return slots.every(s => 
            VALIDATORS.slotHasId(s) && 
            VALIDATORS.slotHasType(s) && 
            VALIDATORS.slotHasQuestion(s)
        );
    },
    
    // Template reference validators
    templateRefHasId: (ref) => ref && ref.templateId,
    templateRefEnabled: (ref) => ref && ref.enabled !== false,
    
    // Scenario validators
    scenarioHasTriggers: (s) => s && Array.isArray(s.triggers) && s.triggers.length > 0,
    scenarioHasReplies: (s) => s && (
        (Array.isArray(s.quickReplies) && s.quickReplies.length > 0) ||
        (Array.isArray(s.fullReplies) && s.fullReplies.length > 0)
    )
};

/**
 * REGISTRY STRUCTURE
 */
const wiringRegistryV2 = {
    schemaVersion: WIRING_SCHEMA_VERSION,
    generatedAt: null, // Set at runtime
    
    // =========================================================================
    // TABS - Top level UI tabs
    // =========================================================================
    tabs: [
        // ---------------------------------------------------------------------
        // FRONT DESK TAB
        // ---------------------------------------------------------------------
        {
            id: 'tab.frontDesk',
            label: 'Front Desk',
            description: 'Controls how AI talks to callers',
            ui: {
                tabId: 'front-desk',
                navSelector: '[data-tab="front-desk"]'
            },
            db: {
                collection: 'companies',
                basePath: 'aiAgentSettings.frontDeskBehavior'
            },
            scope: 'company',
            critical: true,
            sections: [
                // PERSONALITY
                {
                    id: 'frontDesk.personality',
                    label: 'Personality Settings',
                    description: 'AI name, tone, professionalism',
                    ui: {
                        sectionId: 'personality',
                        path: 'Front Desk → Personality'
                    },
                    fields: [
                        {
                            id: 'frontDesk.aiName',
                            label: 'AI Name',
                            ui: { inputId: 'aiName', path: 'Front Desk → Personality → AI Name' },
                            db: { path: 'aiAgentSettings.aiName' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.aiName'],
                            scope: 'company',
                            required: true,
                            validators: [{ fn: VALIDATORS.isNonEmptyString, message: 'AI name is required' }],
                            defaultValue: 'AI Assistant'
                        },
                        {
                            id: 'frontDesk.conversationStyle',
                            label: 'Conversation Style',
                            ui: { inputId: 'conversationStyle', path: 'Front Desk → Personality → Conversation Style' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.conversationStyle' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.conversationStyle'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'balanced',
                            allowedValues: ['confident', 'balanced', 'polite']
                        }
                    ]
                },
                
                // GREETING RESPONSES
                {
                    id: 'frontDesk.greetings',
                    label: 'Greeting Responses',
                    description: '0-token instant responses to greetings',
                    ui: {
                        sectionId: 'greetings',
                        path: 'Front Desk → Greetings'
                    },
                    fields: [
                        {
                            id: 'frontDesk.greetingResponses',
                            label: 'Greeting Responses',
                            ui: { inputId: 'greetingResponses', path: 'Front Desk → Greetings → Responses' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.greetingResponses' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.greetingResponses'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: []
                        }
                    ]
                },
                
                // DISCOVERY & CONSENT (KILL SWITCHES)
                {
                    id: 'frontDesk.discoveryConsent',
                    label: 'Discovery & Consent',
                    description: 'Kill switches and consent gate',
                    critical: true,
                    ui: {
                        sectionId: 'discoveryConsent',
                        path: 'Front Desk → Discovery & Consent'
                    },
                    fields: [
                        {
                            id: 'frontDesk.discoveryConsent.forceLLMDiscovery',
                            label: 'Force LLM Discovery',
                            ui: { inputId: 'forceLLMDiscovery', path: 'Front Desk → Discovery & Consent → Force LLM Discovery' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.forceLLMDiscovery' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.discoveryConsent.forceLLMDiscovery'],
                            scope: 'company',
                            required: true,
                            critical: true,
                            validators: [],
                            defaultValue: false,
                            killSwitch: true,
                            killSwitchEffect: 'When true, scenarios become tools only - LLM speaks first'
                        },
                        {
                            id: 'frontDesk.discoveryConsent.disableScenarioAutoResponses',
                            label: 'Disable Scenario Auto-Responses',
                            ui: { inputId: 'disableScenarioAutoResponses', path: 'Front Desk → Discovery & Consent → Disable Auto-Responses' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.disableScenarioAutoResponses' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.discoveryConsent.disableScenarioAutoResponses'],
                            scope: 'company',
                            required: true,
                            critical: true,
                            validators: [],
                            defaultValue: false,
                            killSwitch: true,
                            killSwitchEffect: 'When true, scenarios matched but cannot auto-respond'
                        },
                        {
                            id: 'frontDesk.discoveryConsent.bookingRequiresExplicitConsent',
                            label: 'Booking Requires Consent',
                            ui: { inputId: 'bookingRequiresExplicitConsent', path: 'Front Desk → Discovery & Consent → Booking Consent' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.bookingRequiresExplicitConsent' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.discoveryConsent.bookingRequiresExplicitConsent'],
                            scope: 'company',
                            required: true,
                            validators: [],
                            defaultValue: true
                        },
                        {
                            id: 'frontDesk.discoveryConsent.consentPhrases',
                            label: 'Consent Phrases',
                            ui: { inputId: 'consentPhrases', path: 'Front Desk → Discovery & Consent → Consent Phrases' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.consentPhrases' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.discoveryConsent.consentPhrases'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: ['yes', 'sure', 'okay', 'please', 'go ahead', 'schedule', 'book']
                        },
                        {
                            id: 'frontDesk.discoveryConsent.autoReplyAllowedScenarioTypes',
                            label: 'Auto-Reply Allowed Types',
                            ui: { inputId: 'autoReplyAllowedScenarioTypes', path: 'Front Desk → Discovery & Consent → Allowed Types' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.discoveryConsent.autoReplyAllowedScenarioTypes' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.discoveryConsent.autoReplyAllowedScenarioTypes'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: ['FAQ', 'TROUBLESHOOT', 'EMERGENCY']
                        }
                    ]
                },
                
                // BOOKING PROMPTS
                {
                    id: 'frontDesk.bookingPrompts',
                    label: 'Booking Prompts',
                    description: 'Slot definitions for booking flow',
                    critical: true,
                    ui: {
                        sectionId: 'bookingPrompts',
                        path: 'Front Desk → Booking Prompts'
                    },
                    fields: [
                        {
                            id: 'frontDesk.bookingEnabled',
                            label: 'Booking Enabled',
                            ui: { inputId: 'bookingEnabled', path: 'Front Desk → Booking Prompts → Enabled' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.bookingEnabled' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.bookingEnabled'],
                            scope: 'company',
                            required: true,
                            validators: [],
                            defaultValue: true
                        },
                        {
                            id: 'frontDesk.bookingSlots',
                            label: 'Booking Slots',
                            ui: { inputId: 'bookingSlots', path: 'Front Desk → Booking Prompts → Slots' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.bookingSlots' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.bookingSlots'],
                            scope: 'company',
                            required: true,
                            validators: [
                                { fn: VALIDATORS.isNonEmptyArray, message: 'At least one booking slot required' },
                                { fn: VALIDATORS.allSlotsValid, message: 'All slots must have id, type, and question' }
                            ],
                            defaultValue: []
                        }
                    ]
                },
                
                // FAST PATH BOOKING
                {
                    id: 'frontDesk.fastPath',
                    label: 'Fast-Path Booking',
                    description: 'Immediate booking offer for urgent keywords',
                    ui: {
                        sectionId: 'fastPath',
                        path: 'Front Desk → Fast-Path'
                    },
                    fields: [
                        {
                            id: 'frontDesk.fastPathBooking.enabled',
                            label: 'Fast-Path Enabled',
                            ui: { inputId: 'fastPathEnabled', path: 'Front Desk → Fast-Path → Enabled' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.fastPathBooking.enabled' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.fastPathBooking.enabled'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: true
                        },
                        {
                            id: 'frontDesk.fastPathBooking.triggerKeywords',
                            label: 'Trigger Keywords',
                            ui: { inputId: 'fastPathKeywords', path: 'Front Desk → Fast-Path → Keywords' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.fastPathBooking.triggerKeywords' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.fastPathBooking.triggerKeywords'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: ['schedule', 'appointment', 'book', 'come out', 'send someone']
                        },
                        {
                            id: 'frontDesk.fastPathBooking.offerScript',
                            label: 'Offer Script',
                            ui: { inputId: 'fastPathScript', path: 'Front Desk → Fast-Path → Script' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.fastPathBooking.offerScript' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.fastPathBooking.offerScript'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'Okay. would you like me to schedule that for you now?'
                        }
                    ]
                },
                
                // VOCABULARY
                {
                    id: 'frontDesk.vocabulary',
                    label: 'Vocabulary',
                    description: 'Word replacements and translations',
                    ui: {
                        sectionId: 'vocabulary',
                        path: 'Front Desk → Vocabulary'
                    },
                    fields: [
                        {
                            id: 'frontDesk.vocabulary',
                            label: 'Vocabulary Map',
                            ui: { inputId: 'vocabulary', path: 'Front Desk → Vocabulary → Mappings' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.vocabulary' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.vocabulary'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: {}
                        }
                    ]
                },
                
                // ESCALATION
                {
                    id: 'frontDesk.escalation',
                    label: 'Escalation',
                    description: 'Human transfer triggers',
                    ui: {
                        sectionId: 'escalation',
                        path: 'Front Desk → Escalation'
                    },
                    fields: [
                        {
                            id: 'frontDesk.escalation.enabled',
                            label: 'Escalation Enabled',
                            ui: { inputId: 'escalationEnabled', path: 'Front Desk → Escalation → Enabled' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.escalation.enabled' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.escalation.enabled'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: true
                        },
                        {
                            id: 'frontDesk.escalation.triggerPhrases',
                            label: 'Trigger Phrases',
                            ui: { inputId: 'escalationPhrases', path: 'Front Desk → Escalation → Phrases' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.escalation.triggerPhrases' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.escalation.triggerPhrases'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: ['speak to a human', 'talk to someone', 'real person', 'transfer me']
                        },
                        {
                            id: 'frontDesk.escalation.transferMessage',
                            label: 'Transfer Message',
                            ui: { inputId: 'escalationMessage', path: 'Front Desk → Escalation → Message' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.escalation.transferMessage' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.escalation.transferMessage'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'One moment while I transfer you to our team.'
                        }
                    ]
                },
                
                // EMOTIONS
                {
                    id: 'frontDesk.emotions',
                    label: 'Emotions',
                    description: 'Emotion detection settings',
                    ui: { sectionId: 'emotions', path: 'Front Desk → Emotions' },
                    fields: [
                        {
                            id: 'frontDesk.emotions',
                            label: 'Emotion Config',
                            ui: { inputId: 'emotions', path: 'Front Desk → Emotions → Config' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.emotions' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.emotions'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: {}
                        }
                    ]
                },
                
                // FRUSTRATION
                {
                    id: 'frontDesk.frustration',
                    label: 'Frustration',
                    description: 'Frustration detection and handling',
                    ui: { sectionId: 'frustration', path: 'Front Desk → Frustration' },
                    fields: [
                        {
                            id: 'frontDesk.frustration',
                            label: 'Frustration Config',
                            ui: { inputId: 'frustration', path: 'Front Desk → Frustration → Config' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.frustration' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.frustration'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: {}
                        }
                    ]
                },
                
                // FORBIDDEN PHRASES
                {
                    id: 'frontDesk.forbidden',
                    label: 'Forbidden Phrases',
                    description: 'Phrases AI must never say',
                    ui: { sectionId: 'forbidden', path: 'Front Desk → Forbidden' },
                    fields: [
                        {
                            id: 'frontDesk.forbiddenPhrases',
                            label: 'Forbidden Phrases',
                            ui: { inputId: 'forbiddenPhrases', path: 'Front Desk → Forbidden → Phrases' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.forbiddenPhrases' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.forbiddenPhrases'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: []
                        }
                    ]
                },
                
                // LOOP PREVENTION
                {
                    id: 'frontDesk.loops',
                    label: 'Loop Prevention',
                    description: 'Loop detection and recovery',
                    ui: { sectionId: 'loops', path: 'Front Desk → Loops' },
                    fields: [
                        {
                            id: 'frontDesk.loopPrevention',
                            label: 'Loop Prevention Config',
                            ui: { inputId: 'loopPrevention', path: 'Front Desk → Loops → Config' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.loopPrevention' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.loopPrevention'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: {}
                        }
                    ]
                },
                
                // FALLBACKS
                {
                    id: 'frontDesk.fallbacks',
                    label: 'Fallback Responses',
                    description: 'Default responses when no match',
                    ui: { sectionId: 'fallbacks', path: 'Front Desk → Fallbacks' },
                    fields: [
                        {
                            id: 'frontDesk.fallbackResponses',
                            label: 'Fallback Responses',
                            ui: { inputId: 'fallbackResponses', path: 'Front Desk → Fallbacks → Responses' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.fallbackResponses' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.fallbackResponses'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: {}
                        }
                    ]
                }
            ]
        },
        
        // ---------------------------------------------------------------------
        // DATA & CONFIG TAB
        // ---------------------------------------------------------------------
        {
            id: 'tab.dataConfig',
            label: 'Data & Config',
            description: 'Templates, scenarios, placeholders',
            ui: { tabId: 'data-config', navSelector: '[data-tab="data-config"]' },
            db: { collection: 'companies', basePath: 'aiAgentSettings' },
            scope: 'company',
            critical: true,
            sections: [
                // TEMPLATE REFERENCES (CRITICAL)
                {
                    id: 'dataConfig.templateReferences',
                    label: 'Template References',
                    description: 'Links company to global templates',
                    critical: true,
                    ui: { sectionId: 'templateReferences', path: 'Data & Config → Templates' },
                    fields: [
                        {
                            id: 'dataConfig.templateReferences',
                            label: 'Template References',
                            ui: { inputId: 'templateReferences', path: 'Data & Config → Templates → References' },
                            db: { path: 'aiAgentSettings.templateReferences' },
                            runtime: RUNTIME_READERS_MAP['dataConfig.templateReferences'],
                            scope: 'company',
                            required: true,
                            critical: true,
                            validators: [
                                { fn: VALIDATORS.isNonEmptyArray, message: 'At least one template must be linked' }
                            ],
                            defaultValue: [],
                            notes: 'If empty, scenarioCount=0 at runtime'
                        }
                    ]
                },
                
                // SCENARIOS (from templates - GLOBAL DERIVED, not company field)
                {
                    id: 'dataConfig.scenarios',
                    label: 'Scenarios',
                    description: 'Trade knowledge scenarios from templates',
                    ui: { sectionId: 'scenarios', path: 'Data & Config → Scenarios' },
                    fields: [
                        {
                            id: 'dataConfig.scenarios',
                            label: 'Scenario Pool',
                            ui: { inputId: 'scenarios', path: 'Data & Config → Scenarios → Pool' },
                            // CRITICAL: This is NOT a company field - it's derived from global templates
                            db: null, // No direct DB path on company doc
                            source: 'GLOBAL_TEMPLATE_DERIVED',
                            derivation: {
                                method: 'Load templates from company.aiAgentSettings.templateReferences[]',
                                templateCollection: 'globalinstantresponsetemplates',
                                templatePath: 'categories[].scenarios[]',
                                dependsOn: ['dataConfig.templateReferences']
                            },
                            runtime: RUNTIME_READERS_MAP['dataConfig.scenarios'],
                            scope: 'global',
                            required: false, // Not required on company doc - derived from templates
                            isDerived: true, // Flag for report generator to handle differently
                            validators: [],
                            defaultValue: [],
                            tenantRule: 'Scenarios MUST come from global templates only. Company doc MUST NOT contain scenario text.',
                            fixInstructions: {
                                noTemplateRefs: 'Select templates in Data & Config → Template References',
                                templatesMissing: 'Global templates not found in DB (restore templates)',
                                scenariosEmpty: 'Template contains 0 scenarios (add scenarios to template)'
                            }
                        }
                    ]
                },
                
                // CHEAT SHEETS
                {
                    id: 'dataConfig.cheatSheets',
                    label: 'Cheat Sheets',
                    description: 'FAQ knowledge base',
                    ui: { sectionId: 'cheatSheets', path: 'Data & Config → Cheat Sheets' },
                    fields: [
                        {
                            id: 'dataConfig.cheatSheets',
                            label: 'Cheat Sheet Config',
                            ui: { inputId: 'cheatSheets', path: 'Data & Config → Cheat Sheets → Config' },
                            db: { collection: 'cheatsheetversions', path: '(companyId filter)' },
                            runtime: RUNTIME_READERS_MAP['dataConfig.cheatSheets'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: null
                        }
                    ]
                },
                
                // PLACEHOLDERS
                {
                    id: 'dataConfig.placeholders',
                    label: 'Placeholders',
                    description: 'Dynamic tokens like {companyName}',
                    ui: { sectionId: 'placeholders', path: 'Data & Config → Placeholders' },
                    fields: [
                        {
                            id: 'dataConfig.placeholders',
                            label: 'Placeholder Values',
                            ui: { inputId: 'placeholders', path: 'Data & Config → Placeholders → Values' },
                            db: { collection: 'companyplaceholders', path: '(companyId filter)' },
                            runtime: RUNTIME_READERS_MAP['dataConfig.placeholders'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: {}
                        }
                    ]
                }
            ]
        },
        
        // ---------------------------------------------------------------------
        // DYNAMIC FLOW TAB
        // ---------------------------------------------------------------------
        {
            id: 'tab.dynamicFlow',
            label: 'Dynamic Flow',
            description: 'Trigger-based conversation flows',
            ui: { tabId: 'dynamic-flow', navSelector: '[data-tab="dynamic-flow"]' },
            db: { collection: 'dynamicflows', basePath: '' },
            scope: 'company',
            sections: [
                {
                    id: 'dynamicFlow.companyFlows',
                    label: 'Company Flows',
                    description: 'Active flows for this company',
                    ui: { sectionId: 'companyFlows', path: 'Dynamic Flow → Company Flows' },
                    fields: [
                        {
                            id: 'dynamicFlow.companyFlows',
                            label: 'Company Flows',
                            ui: { inputId: 'companyFlows', path: 'Dynamic Flow → Company Flows → List' },
                            db: { collection: 'dynamicflows', path: '(companyId filter, isTemplate=false)' },
                            runtime: RUNTIME_READERS_MAP['dynamicFlow.companyFlows'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: []
                        }
                    ]
                }
            ]
        },
        
        // ---------------------------------------------------------------------
        // TRANSFER CALLS TAB
        // ---------------------------------------------------------------------
        {
            id: 'tab.transfers',
            label: 'Transfer Calls',
            description: 'Transfer targets and rules',
            ui: { tabId: 'transfer-calls', navSelector: '[data-tab="transfer-calls"]' },
            db: { collection: 'companies', basePath: 'aiAgentSettings' },
            scope: 'company',
            sections: [
                {
                    id: 'transfers.directory',
                    label: 'Transfer Directory',
                    description: 'Available transfer targets',
                    ui: { sectionId: 'transferDirectory', path: 'Transfer Calls → Directory' },
                    fields: [
                        {
                            id: 'transfers.transferTargets',
                            label: 'Transfer Targets',
                            ui: { inputId: 'transferTargets', path: 'Transfer Calls → Directory → Targets' },
                            db: { path: 'aiAgentSettings.transferTargets' },
                            runtime: RUNTIME_READERS_MAP['transfers.transferTargets'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: []
                        }
                    ]
                }
            ]
        },
        
        // ---------------------------------------------------------------------
        // CALL PROTECTION TAB
        // ---------------------------------------------------------------------
        {
            id: 'tab.callProtection',
            label: 'Call Protection',
            description: 'Pre-answer filters',
            ui: { tabId: 'call-protection', navSelector: '[data-tab="call-protection"]' },
            db: { collection: 'cheatsheetversions', basePath: 'config.edgeCases' },
            scope: 'company',
            sections: []
        },
        
        // ---------------------------------------------------------------------
        // FLOW TREE TAB
        // ---------------------------------------------------------------------
        {
            id: 'tab.flowTree',
            label: 'Flow Tree',
            description: 'AI decision visualization',
            ui: { tabId: 'flow-tree', navSelector: '[data-tab="flow-tree"]' },
            db: { collection: null, basePath: null },
            scope: 'company',
            sections: []
        },
        
        // ---------------------------------------------------------------------
        // CALL CENTER TAB
        // ---------------------------------------------------------------------
        {
            id: 'tab.callCenter',
            label: 'Call Center',
            description: 'Call handling settings',
            ui: { tabId: 'call-center', navSelector: '[data-tab="call-center"]' },
            db: { collection: 'companies', basePath: 'aiAgentSettings.callCenter' },
            scope: 'company',
            sections: []
        },
        
        // ---------------------------------------------------------------------
        // COMPANY CONTACTS TAB
        // ---------------------------------------------------------------------
        {
            id: 'tab.companyContacts',
            label: 'Company Contacts',
            description: 'Contact directory',
            ui: { tabId: 'company-contacts', navSelector: '[data-tab="company-contacts"]' },
            db: { collection: 'companies', basePath: 'contacts' },
            scope: 'company',
            sections: []
        },
        
        // ---------------------------------------------------------------------
        // LINKS TAB
        // ---------------------------------------------------------------------
        {
            id: 'tab.links',
            label: 'Links',
            description: 'External links configuration',
            ui: { tabId: 'links', navSelector: '[data-tab="links"]' },
            db: { collection: 'companies', basePath: 'links' },
            scope: 'company',
            sections: []
        },
        
        // ---------------------------------------------------------------------
        // VERSION HISTORY TAB
        // ---------------------------------------------------------------------
        {
            id: 'tab.versionHistory',
            label: 'Version History',
            description: 'Config version history',
            ui: { tabId: 'version-history', navSelector: '[data-tab="version-history"]' },
            db: { collection: 'configaudits', basePath: '(companyId filter)' },
            scope: 'company',
            sections: []
        },
        
        // ---------------------------------------------------------------------
        // WIRING TAB (META!)
        // ---------------------------------------------------------------------
        {
            id: 'tab.wiring',
            label: 'Wiring',
            description: 'Platform wiring source of truth',
            ui: { tabId: 'wiring', navSelector: '[data-tab="wiring"]' },
            db: { collection: null, basePath: null },
            scope: 'company',
            sections: []
        },
        
        // ---------------------------------------------------------------------
        // LEGACY TAB
        // ---------------------------------------------------------------------
        {
            id: 'tab.legacy',
            label: 'Legacy',
            description: 'Legacy features (deprecated)',
            ui: { tabId: 'legacy', navSelector: '[data-tab="legacy"]' },
            db: { collection: null, basePath: null },
            scope: 'company',
            sections: []
        }
    ],
    
    // =========================================================================
    // INFRASTRUCTURE
    // =========================================================================
    infrastructure: [
        {
            id: 'infra.redis',
            label: 'Redis Cache',
            description: 'Scenario pool caching',
            runtime: RUNTIME_READERS_MAP['infra.scenarioPoolCache'],
            cacheKey: 'scenario-pool:{companyId}',
            cacheTTL: 300,
            scope: 'company',
            critical: true
        },
        {
            id: 'infra.mongodb',
            label: 'MongoDB',
            description: 'Primary database',
            scope: 'system',
            critical: true
        }
    ],
    
    // =========================================================================
    // TENANT SAFETY RULES
    // =========================================================================
    tenantRules: [
        {
            id: 'TENANT_RULE_COMPANY_SCOPE',
            description: 'All company config reads/writes MUST include companyId',
            severity: 'CRITICAL'
        },
        {
            id: 'TENANT_RULE_GLOBAL_TEMPLATES',
            description: 'Scenarios/templates are GLOBAL - companies only reference template IDs',
            severity: 'CRITICAL'
        },
        {
            id: 'TENANT_RULE_NO_SCENARIO_IN_COMPANY',
            description: 'Company documents MUST NOT contain scenario text - only templateReferences',
            severity: 'CRITICAL'
        },
        {
            id: 'TENANT_RULE_CACHE_SCOPED',
            description: 'All Redis cache keys MUST include companyId',
            severity: 'CRITICAL'
        }
    ],
    
    // =========================================================================
    // GUARDRAILS
    // =========================================================================
    guardrails: [
        { id: 'GR_NO_TENANT_HARDCODE', severity: 'CRITICAL', description: 'No hardcoded tenant logic' },
        { id: 'GR_NO_TRADE_ASSUMPTIONS', severity: 'CRITICAL', description: 'No trade-specific assumptions' },
        { id: 'GR_NO_SILENT_FALLBACKS', severity: 'HIGH', description: 'No silent fallback when misconfigured' },
        { id: 'GR_NO_UI_ONLY_ENABLED', severity: 'HIGH', description: 'No UI-only enabled features' },
        { id: 'GR_SCENARIOS_GLOBAL_ONLY', severity: 'CRITICAL', description: 'Scenarios in templates only' }
    ]
};

/**
 * Get all fields from the registry (flattened)
 */
function getAllFields() {
    const fields = [];
    for (const tab of wiringRegistryV2.tabs) {
        for (const section of (tab.sections || [])) {
            for (const field of (section.fields || [])) {
                fields.push({
                    ...field,
                    tabId: tab.id,
                    sectionId: section.id
                });
            }
        }
    }
    return fields;
}

/**
 * Get critical fields that block operation if missing
 */
function getCriticalFields() {
    return getAllFields().filter(f => f.critical);
}

/**
 * Get kill switch fields
 */
function getKillSwitchFields() {
    return getAllFields().filter(f => f.killSwitch);
}

module.exports = {
    wiringRegistryV2,
    WIRING_SCHEMA_VERSION,
    VALIDATORS,
    getAllFields,
    getCriticalFields,
    getKillSwitchFields
};

