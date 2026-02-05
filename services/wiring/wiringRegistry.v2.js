/**
 * ============================================================================
 * AGENT WIRING (AW) REGISTRY - THE ONLY SOURCE OF TRUTH
 * ============================================================================
 * 
 * THE NON-NEGOTIABLE CONTRACT:
 * If a field / rule / prompt / switch / flow step is not in this registry:
 *   - Runtime MUST NOT read it
 *   - Raw Events (RE) MUST NOT claim it happened
 * 
 * This is enforced via:
 *   - One registry (this file)
 *   - One runtime reader map (runtimeReaders.map.js)
 *   - One tracer (CONFIG_READ events in RE)
 * 
 * Each node answers:
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
 *   🟣 UI_ONLY - exists in UI but no runtime read (MUST ELIMINATE)
 *   🟠 DEAD_READ - runtime reads but UI doesn't expose (UNACCEPTABLE)
 *   🧨 TENANT_RISK - unscoped / global when should be company
 * 
 * RULES:
 *   - If a tab exists in UI but not here → wiring failure
 *   - If a field is here but not in UI → dead read
 *   - Update this when adding ANY new feature
 *   - UI_ONLY and DEAD_READ must be driven to ZERO (or explicitly allowlisted)
 * 
 * ============================================================================
 */

const { RUNTIME_READERS_MAP } = require('./runtimeReaders.map');

const AW_REGISTRY_VERSION = 'AW_REGISTRY_V2.0';
// Backward compat alias
const WIRING_SCHEMA_VERSION = AW_REGISTRY_VERSION;

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
    ),

    // Booking continuity validators
    // If enabled, template must be non-empty. If disabled, it's valid without template.
    resumeBookingHasTemplate: (val) => {
        if (!val || typeof val !== 'object') return false;
        const enabled = val.enabled !== false;
        if (!enabled) return true;
        return typeof val.template === 'string' && val.template.trim().length > 0;
    },
    confirmationRequestsHasTriggers: (val) => {
        if (!val || typeof val !== 'object') return false;
        const enabled = val.enabled !== false;
        const triggers = Array.isArray(val.triggers) ? val.triggers : (Array.isArray(val?.triggers?.default) ? val.triggers.default : null);
        // If disabled, it's valid without triggers. If enabled, require at least 2 triggers.
        if (!enabled) return true;
        return Array.isArray(triggers) ? triggers.filter(Boolean).length >= 2 : false;
    }
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
                        },
                        {
                            id: 'frontDesk.styleAcknowledgments',
                            label: 'Style Acknowledgments',
                            ui: { inputId: 'styleAcknowledgments', path: 'Front Desk → Personality → Style Acknowledgments' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.styleAcknowledgments' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.styleAcknowledgments'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: {
                                confident: "Let's get this taken care of.",
                                balanced: 'I can help with that!',
                                polite: "I'd be happy to help."
                            }
                        },
                        {
                            id: 'frontDesk.personality.warmth',
                            label: 'Warmth',
                            ui: { inputId: 'warmth', path: 'Front Desk → Personality → Warmth' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.personality.warmth' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.personality.warmth'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 0.6
                        },
                        {
                            id: 'frontDesk.personality.speakingPace',
                            label: 'Speaking Pace',
                            ui: { inputId: 'speakingPace', path: 'Front Desk → Personality → Speaking Pace' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.personality.speakingPace' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.personality.speakingPace'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'normal',
                            allowedValues: ['slow', 'normal', 'fast']
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
                        },
                        // ═══════════════════════════════════════════════════════════════════════════
                        // V94: BOOKING INTENT DETECTION (CRITICAL MVA REQUIREMENT)
                        // Without these, agent cannot detect "fix my AC" as booking intent
                        // ═══════════════════════════════════════════════════════════════════════════
                        {
                            id: 'frontDesk.detectionTriggers.wantsBooking',
                            label: 'Booking Intent Keywords',
                            ui: { inputId: 'wantsBookingKeywords', path: 'Front Desk → Discovery & Consent → Booking Intent Keywords' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.detectionTriggers.wantsBooking' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.detectionTriggers.wantsBooking'],
                            scope: 'company',
                            required: true,
                            critical: true,
                            tier: 'MVA',
                            validators: [VALIDATORS.isNonEmptyArray],
                            defaultValue: ['fix', 'repair', 'service', 'appointment', 'schedule', 'technician', 'someone', 'come out', 'send', 'broken', 'not working', 'not cooling', 'not heating'],
                            notes: 'Keywords that trigger booking mode. Without these, agent stays in discovery even when caller clearly needs service.'
                        }
                    ]
                },
                
                // ═══════════════════════════════════════════════════════════════════════════
                // V94: DIRECT BOOKING INTENT PATTERNS (CRITICAL MVA REQUIREMENT)
                // Detects "get somebody out here" as immediate booking (skip consent)
                // ═══════════════════════════════════════════════════════════════════════════
                {
                    id: 'frontDesk.bookingIntentDetection',
                    label: 'Booking Intent Detection',
                    description: 'Patterns that detect direct booking intent (skip consent question)',
                    critical: true,
                    tier: 'MVA',
                    ui: {
                        sectionId: 'booking-intent-detection',
                        path: 'Front Desk → Booking Intent Detection'
                    },
                    fields: [
                        {
                            id: 'booking.directIntentPatterns',
                            label: 'Direct Booking Patterns',
                            ui: { inputId: 'directIntentPatterns', path: 'Front Desk → Booking → Direct Intent Patterns' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.bookingFlow.directIntentPatterns' },
                            runtime: RUNTIME_READERS_MAP['booking.directIntentPatterns'],
                            scope: 'company',
                            required: true,
                            critical: true,
                            tier: 'MVA',
                            validators: [VALIDATORS.isNonEmptyArray],
                            defaultValue: ['get somebody out', 'get someone out', 'how soon can you', 'when can you come', 'send someone', 'send a tech', 'need someone out', 'come out today', 'come out tomorrow'],
                            notes: 'Phrases that indicate caller wants immediate booking (skip consent question). E.g., "how soon can you get somebody out here"'
                        }
                    ]
                },

                // BUSINESS HOURS (CANONICAL)
                {
                    id: 'frontDesk.hoursAvailability',
                    label: 'Hours & Availability',
                    description: 'Canonical business hours used for after-hours routing',
                    ui: {
                        sectionId: 'hours-availability',
                        path: 'Front Desk → Hours & Availability'
                    },
                    fields: [
                        {
                            id: 'frontDesk.businessHours',
                            label: 'Business Hours',
                            ui: { inputId: 'businessHours', path: 'Front Desk → Hours & Availability → Business Hours' },
                            db: { path: 'aiAgentSettings.businessHours' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.businessHours'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: null,
                            notes: 'Used by AfterHoursEvaluator and DynamicFlowEngine trigger after_hours'
                        }
                    ]
                },
                
                // SLOT EXTRACTION (Name parsing, stop words - prevents "Degrees In" bug)
                {
                    id: 'frontDesk.slotExtraction',
                    label: 'Slot Extraction',
                    description: 'Name parsing, stop words, and extraction rules (critical for V92 name protection)',
                    critical: true,
                    ui: {
                        sectionId: 'slotExtraction',
                        path: 'Front Desk → Slot Extraction'
                    },
                    fields: [
                        {
                            id: 'frontDesk.commonFirstNames',
                            label: 'Common First Names',
                            ui: { inputId: 'commonFirstNames', path: 'Front Desk → Slot Extraction → Common First Names' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.commonFirstNames' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.commonFirstNames'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: [],
                            notes: 'Used by name extraction to recognize common first names vs noise (e.g., trade terms)'
                        },
                        {
                            id: 'slotExtraction.nameStopWords',
                            label: 'Name Stop Words',
                            ui: { inputId: 'nameStopWords', path: 'Front Desk → Slot Extraction → Name Stop Words' },
                            db: { path: 'aiAgentSettings.nameStopWords' },
                            runtime: RUNTIME_READERS_MAP['slotExtraction.nameStopWords'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: { enabled: true, custom: [] },
                            notes: 'Parent object for name stop words configuration'
                        },
                        {
                            id: 'slotExtraction.nameStopWords.enabled',
                            label: 'Name Stop Words Enabled',
                            ui: { inputId: 'nameStopWordsEnabled', path: 'Front Desk → Slot Extraction → Stop Words Enabled' },
                            db: { path: 'aiAgentSettings.nameStopWords.enabled' },
                            runtime: RUNTIME_READERS_MAP['slotExtraction.nameStopWords.enabled'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: true,
                            notes: 'Master switch for name stop words filtering (prevents "Degrees In" bug)'
                        },
                        {
                            id: 'slotExtraction.nameStopWords.custom',
                            label: 'Custom Stop Words',
                            ui: { inputId: 'nameStopWordsCustom', path: 'Front Desk → Slot Extraction → Custom Stop Words' },
                            db: { path: 'aiAgentSettings.nameStopWords.custom' },
                            runtime: RUNTIME_READERS_MAP['slotExtraction.nameStopWords.custom'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: [],
                            notes: 'Custom stop words to filter from name extraction (company-specific noise)'
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
                            defaultValue: [],
                            // V54: Per-slot configurable prompts - ALL prompts must come from here, NO HARDCODES
                            subFieldsDoc: `
                                Per-slot V54 configurable fields (stored in each slot object):
                                - question: Main prompt for this slot (REQUIRED)
                                - lastNameQuestion: "And what's your last name?" (name slots only)
                                - firstNameQuestion: "And what's your first name?" (name slots only)
                                - areaCodePrompt: "Let's go step by step - what's the area code?" (phone slots only)
                                - restOfNumberPrompt: "Got it. And the rest of the number?" (phone slots only)
                                - partialAddressPrompt: "I got part of that. Can you give me the full address including city?" (address slots only)
                                - streetBreakdownPrompt: "Let's go step by step - what's the street address?" (address slots only)
                                - cityPrompt: "And what city?" (address slots only)
                                - zipPrompt: "And the zip code?" (address slots only)
                                
                                RULE: If ConversationEngine needs a prompt string, it MUST read from bookingSlots[].field
                                      NEVER hardcode text in code. Use || fallback ONLY as schema default reference.
                            `
                        }
                    ]
                },

                // NAME PARSING (Last-name-first support)
                {
                    id: 'frontDesk.nameParsing',
                    label: 'Name Parsing',
                    description: 'How names are parsed (supports last-name-first callers like "My name is Smith")',
                    critical: true,
                    ui: {
                        sectionId: 'nameParsing',
                        path: 'Front Desk → Booking → Name Parsing'
                    },
                    fields: [
                        // V96j: Parent object field (runtime reads this directly)
                        {
                            id: 'booking.nameParsing',
                            label: 'Name Parsing Config (Parent)',
                            description: 'Parent object containing all name parsing settings',
                            ui: { inputId: 'nameParsingConfig', path: 'Front Desk → Booking → Name Parsing' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.booking.nameParsing' },
                            runtime: RUNTIME_READERS_MAP['booking.nameParsing'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: { acceptLastNameOnly: false },
                            notes: 'Parent config object - runtime often reads this whole object'
                        },
                        {
                            id: 'booking.nameParsing.acceptLastNameOnly',
                            label: 'Accept Last Name Only',
                            ui: { inputId: 'acceptLastNameOnly', path: 'Front Desk → Booking → Name Parsing → Accept Last Name Only' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.booking.nameParsing.acceptLastNameOnly' },
                            runtime: RUNTIME_READERS_MAP['booking.nameParsing.acceptLastNameOnly'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: true,
                            notes: 'If caller says "My name is Smith" and Smith is not in commonFirstNames, treat as lastName and prompt for firstName'
                        },
                        {
                            id: 'booking.nameParsing.lastNameOnlyPrompt',
                            label: 'Last Name Only Prompt',
                            ui: { inputId: 'lastNameOnlyPrompt', path: 'Front Desk → Booking → Name Parsing → Last Name Only Prompt' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.booking.nameParsing.lastNameOnlyPrompt' },
                            runtime: RUNTIME_READERS_MAP['booking.nameParsing.lastNameOnlyPrompt'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: "Thanks — and what's your first name?"
                        }
                    ]
                },

                // ═══════════════════════════════════════════════════════════════════
                // NAME SPELLING VARIANTS (Mark with K or Marc with C?)
                // V94: Asks caller to confirm spelling for names with common variants
                // REQUIRES BOTH: global enabled + slot-level confirmSpelling
                // ═══════════════════════════════════════════════════════════════════
                {
                    id: 'frontDesk.nameSpellingVariants',
                    label: 'Name Spelling Variants',
                    description: 'Confirm spelling for names like Mark/Marc, Brian/Bryan, Eric/Erik',
                    critical: false,
                    tier: 'ADVANCED',
                    ui: {
                        sectionId: 'nameSpellingVariants',
                        path: 'Front Desk → Booking Prompts → Name Spelling Variants'
                    },
                    fields: [
                        // V96j: Parent object field (runtime reads this directly)
                        {
                            id: 'frontDesk.nameSpellingVariants',
                            label: 'Name Spelling Variants Config (Parent)',
                            description: 'Parent object containing all spelling variant settings',
                            ui: { inputId: 'nameSpellingVariantsConfig', path: 'Front Desk → Booking Prompts → Name Spelling Variants' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.nameSpellingVariants' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.nameSpellingVariants'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: { enabled: false, mode: '1_char_only', maxAsksPerCall: 1 },
                            notes: 'Parent config object - runtime often reads this whole object'
                        },
                        {
                            id: 'frontDesk.nameSpellingVariants.enabled',
                            label: 'Spelling Confirmation Enabled',
                            ui: { inputId: 'fdb-spelling-enabled', path: 'Front Desk → Booking Prompts → Name Spelling Variants → Enable' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.nameSpellingVariants.enabled' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.nameSpellingVariants.enabled'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: false,
                            notes: 'Global master switch. OFF by default — only enable for dental/medical/membership where exact spelling matters.'
                        },
                        {
                            id: 'frontDesk.nameSpellingVariants.mode',
                            label: 'Variant Mode',
                            ui: { inputId: 'spelling-mode', path: 'Front Desk → Booking Prompts → Name Spelling Variants → Mode' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.nameSpellingVariants.mode' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.nameSpellingVariants.mode'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: '1_char_only',
                            notes: 'Options: 1_char_only (Mark/Marc, Eric/Erik), any_variant (includes Steven/Stephen, Sean/Shawn)'
                        },
                        {
                            id: 'frontDesk.nameSpellingVariants.script',
                            label: 'Spelling Prompt Template',
                            ui: { inputId: 'fdb-spelling-script', path: 'Front Desk → Booking Prompts → Name Spelling Variants → Script' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.nameSpellingVariants.script' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.nameSpellingVariants.script'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'Just to confirm — {optionA} with a {letterA} or {optionB} with a {letterB}?',
                            notes: 'Placeholders: {optionA}, {optionB} = name options, {letterA}, {letterB} = differing letters'
                        },
                        {
                            id: 'frontDesk.nameSpellingVariants.maxAsksPerCall',
                            label: 'Max Asks Per Call',
                            ui: { inputId: 'fdb-spelling-max-asks', path: 'Front Desk → Booking Prompts → Name Spelling Variants → Max Asks' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.nameSpellingVariants.maxAsksPerCall' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.nameSpellingVariants.maxAsksPerCall'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 1,
                            notes: 'Recommended: 1. Set to 0 for unlimited (not recommended).'
                        },
                        {
                            id: 'frontDesk.nameSpellingVariants.source',
                            label: 'Variant Source',
                            ui: { inputId: 'spelling-source', path: 'Front Desk → Booking Prompts → Name Spelling Variants → Source' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.nameSpellingVariants.source' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.nameSpellingVariants.source'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'curated_list',
                            notes: 'Options: curated_list (manual groups), auto_scan (from commonFirstNames list)'
                        },
                        {
                            id: 'frontDesk.bookingSlots.name.confirmSpelling',
                            label: 'Confirm Spelling (Name Slot)',
                            ui: { inputId: 'slot-confirmSpelling', path: 'Front Desk → Booking Prompts → Name Slot → Confirm Spelling' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.bookingSlots[name].confirmSpelling' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.bookingSlots.name.confirmSpelling'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: false,
                            notes: 'SLOT-LEVEL toggle. Must be ON together with global nameSpellingVariants.enabled for spelling to fire.'
                        }
                    ]
                },

                // ADDRESS VERIFICATION POLICY (Google Geocode + completeness gating)
                {
                    id: 'frontDesk.addressVerification',
                    label: 'Address Verification Policy',
                    description: 'Controls address completeness enforcement (city, state, unit questions)',
                    critical: true,
                    ui: {
                        sectionId: 'addressVerification',
                        path: 'Front Desk → Booking → Address Verification'
                    },
                    fields: [
                        // V96j: Parent object field (runtime reads this directly)
                        {
                            id: 'booking.addressVerification',
                            label: 'Address Verification Config (Parent)',
                            description: 'Parent object containing all address verification settings',
                            ui: { inputId: 'addressVerificationConfig', path: 'Front Desk → Booking → Address Verification' },
                            db: { path: 'aiAgentSettings.frontDesk.booking.addressVerification' },
                            runtime: RUNTIME_READERS_MAP['booking.addressVerification'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: { enabled: true, provider: 'google_geocode' },
                            notes: 'Parent config object - runtime often reads this whole object'
                        },
                        {
                            id: 'booking.addressVerification.enabled',
                            label: 'Address Verification Enabled',
                            ui: { inputId: 'addressVerificationEnabled', path: 'Front Desk → Booking → Address Verification → Enabled' },
                            db: { path: 'aiAgentSettings.frontDesk.booking.addressVerification.enabled' },
                            runtime: RUNTIME_READERS_MAP['booking.addressVerification.enabled'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: true,
                            notes: 'Master switch for address completeness enforcement'
                        },
                        {
                            id: 'booking.addressVerification.provider',
                            label: 'Geocoding Provider',
                            ui: { inputId: 'addressVerificationProvider', path: 'Front Desk → Booking → Address Verification → Provider' },
                            db: { path: 'aiAgentSettings.frontDesk.booking.addressVerification.provider' },
                            runtime: RUNTIME_READERS_MAP['booking.addressVerification.provider'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'google_geocode',
                            notes: 'Geocoding provider: google_geocode | none'
                        },
                        {
                            id: 'booking.addressVerification.requireCity',
                            label: 'Require City',
                            ui: { inputId: 'requireCity', path: 'Front Desk → Booking → Address Verification → Require City' },
                            db: { path: 'aiAgentSettings.frontDesk.booking.addressVerification.requireCity' },
                            runtime: RUNTIME_READERS_MAP['booking.addressVerification.requireCity'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: true,
                            notes: 'Do not confirm address until city is captured'
                        },
                        {
                            id: 'booking.addressVerification.requireState',
                            label: 'Require State',
                            ui: { inputId: 'requireState', path: 'Front Desk → Booking → Address Verification → Require State' },
                            db: { path: 'aiAgentSettings.frontDesk.booking.addressVerification.requireState' },
                            runtime: RUNTIME_READERS_MAP['booking.addressVerification.requireState'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: false, // Don't ask unless business requires - geo can infer from city
                            notes: 'Only enable for multi-state businesses. Geo infers state from city most of the time.'
                        },
                        {
                            id: 'booking.addressVerification.requireZip',
                            label: 'Require ZIP',
                            ui: { inputId: 'requireZip', path: 'Front Desk → Booking → Address Verification → Require ZIP' },
                            db: { path: 'aiAgentSettings.frontDesk.booking.addressVerification.requireZip' },
                            runtime: RUNTIME_READERS_MAP['booking.addressVerification.requireZip'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: false,
                            notes: 'Do not confirm address until ZIP is captured (optional)'
                        },
                        {
                            id: 'booking.addressVerification.requireUnitQuestion',
                            label: 'Require Unit Question',
                            ui: { inputId: 'requireUnitQuestion', path: 'Front Desk → Booking → Address Verification → Require Unit Question' },
                            db: { path: 'aiAgentSettings.frontDesk.booking.addressVerification.requireUnitQuestion' },
                            runtime: RUNTIME_READERS_MAP['booking.addressVerification.requireUnitQuestion'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: true,
                            notes: 'Always ask "Is this a house or unit?" even if no apt/suite mentioned'
                        },
                        {
                            id: 'booking.addressVerification.unitQuestionMode',
                            label: 'Unit Question Mode',
                            ui: { inputId: 'unitQuestionMode', path: 'Front Desk → Booking → Address Verification → Unit Question Mode' },
                            db: { path: 'aiAgentSettings.frontDesk.booking.addressVerification.unitQuestionMode' },
                            runtime: RUNTIME_READERS_MAP['booking.addressVerification.unitQuestionMode'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'house_or_unit',
                            notes: 'Unit question mode: house_or_unit | always_ask | smart'
                        },
                        {
                            id: 'booking.addressVerification.missingCityStatePrompt',
                            label: 'Missing City/State Prompt',
                            ui: { inputId: 'missingCityStatePrompt', path: 'Front Desk → Booking → Address Verification → Missing City/State Prompt' },
                            db: { path: 'aiAgentSettings.frontDesk.booking.addressVerification.missingCityStatePrompt' },
                            runtime: RUNTIME_READERS_MAP['booking.addressVerification.missingCityStatePrompt'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: "Got it — what city and state is that in?"
                        },
                        {
                            id: 'booking.addressVerification.unitTypePrompt',
                            label: 'Unit Type Prompt',
                            ui: { inputId: 'unitTypePrompt', path: 'Front Desk → Booking → Address Verification → Unit Type Prompt' },
                            db: { path: 'aiAgentSettings.frontDesk.booking.addressVerification.unitTypePrompt' },
                            runtime: RUNTIME_READERS_MAP['booking.addressVerification.unitTypePrompt'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: "Is this a house, or an apartment, suite, or unit? If it's a unit, what's the number?"
                        }
                    ]
                },

                // GOOGLE GEO INTEGRATION (V93 - for address validation)
                {
                    id: 'frontDesk.googleGeo',
                    label: 'Google Geo Integration',
                    description: 'Google Geocoding API for address validation and normalization',
                    critical: false,
                    ui: {
                        sectionId: 'googleGeo',
                        path: 'Front Desk → Integrations → Google Geo'
                    },
                    fields: [
                        {
                            id: 'integrations.googleGeo.enabled',
                            label: 'Google Geo Enabled',
                            ui: { inputId: 'googleGeoEnabled', path: 'Integrations → Google Geo → Enabled' },
                            db: { path: 'integrations.googleGeo.enabled' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleGeo.enabled'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: true,
                            notes: 'Master switch for Google Geocoding validation'
                        },
                        {
                            id: 'integrations.googleGeo.verificationMode',
                            label: 'Verification Mode',
                            ui: { inputId: 'googleGeoMode', path: 'Integrations → Google Geo → Mode' },
                            db: { path: 'integrations.googleGeo.verificationMode' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleGeo.verificationMode'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'SOFT',
                            notes: 'STRICT = block on low confidence, SOFT = warn only'
                        },
                        {
                            id: 'integrations.googleGeo.minConfidence',
                            label: 'Minimum Confidence',
                            ui: { inputId: 'googleGeoMinConfidence', path: 'Integrations → Google Geo → Min Confidence' },
                            db: { path: 'integrations.googleGeo.minConfidence' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleGeo.minConfidence'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'MEDIUM',
                            notes: 'Minimum confidence threshold: HIGH | MEDIUM | LOW'
                        }
                    ]
                },

                // BOOKING CONTINUITY (NO HIDDEN FEATURES)
                {
                    id: 'frontDesk.bookingContinuity',
                    label: 'Booking Continuity',
                    description: 'How booking survives interruptions and confirmation questions',
                    ui: {
                        sectionId: 'bookingContinuity',
                        path: 'Front Desk → Personality → Booking Continuity'
                    },
                    fields: [
                        {
                            id: 'frontDesk.offRailsRecovery.bridgeBack.resumeBooking',
                            label: 'Resume Booking Protocol',
                            ui: { inputId: 'resumeBooking', path: 'Front Desk → Personality → Resume Booking Protocol' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.offRailsRecovery.bridgeBack.resumeBooking' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.offRailsRecovery.bridgeBack.resumeBooking'],
                            scope: 'company',
                            required: false,
                            validators: [
                                { fn: VALIDATORS.isNonEmptyObject, message: 'resumeBooking must be an object' },
                                { fn: VALIDATORS.resumeBookingHasTemplate, message: 'resumeBooking.template is required when enabled' }
                            ],
                            defaultValue: { enabled: true }
                        },
                        {
                            id: 'frontDesk.confirmationRequests',
                            label: 'Confirmation Requests',
                            ui: { inputId: 'confirmationRequests', path: 'Front Desk → Personality → Confirmation Requests' },
                            db: { path: 'aiAgentSettings.frontDeskBehavior.confirmationRequests' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.confirmationRequests'],
                            scope: 'company',
                            required: false,
                            validators: [
                                { fn: VALIDATORS.isNonEmptyObject, message: 'confirmationRequests must be an object' },
                                { fn: VALIDATORS.confirmationRequestsHasTriggers, message: 'confirmationRequests.triggers must have at least 2 entries when enabled' }
                            ],
                            defaultValue: { enabled: true }
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
                            db: { path: 'aiAgentSettings.frontDeskBehavior.emotionResponses' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.emotions'],
                            scope: 'company',
                            required: false,
                            validators: [
                                { fn: VALIDATORS.isNonEmptyObject, message: 'emotionResponses must be an object' }
                            ],
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
                            db: { path: 'aiAgentSettings.frontDeskBehavior.frustrationTriggers' },
                            runtime: RUNTIME_READERS_MAP['frontDesk.frustration'],
                            scope: 'company',
                            required: false,
                            validators: [
                                { fn: VALIDATORS.isNonEmptyArray, message: 'frustrationTriggers must be a non-empty array' },
                                { fn: VALIDATORS.hasMinItems(2), message: 'frustrationTriggers should include at least 2 phrases' }
                            ],
                            defaultValue: []
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
                            defaultValue: {},
                            // V54: Configurable nudge prompts - NO HARDCODES
                            subFieldsDoc: `
                                V54 nudge prompts (when caller says "just a second" or pauses):
                                - nudgeNamePrompt: "Sure — go ahead." (during name collection)
                                - nudgePhonePrompt: "Sure — go ahead with the area code first." (during phone collection)
                                - nudgeAddressPrompt: "No problem — go ahead with the street address, and include unit number if you have one." (during address collection)
                                
                                RULE: ConversationEngine MUST read from loopPrevention.nudge*Prompt
                                      NEVER hardcode nudge text in code.
                            `
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
                // NOTE: CheatSheets has its own editor at frontline-intel-editor.html
                // Nav targets templates section as fallback - cheatSheets UI not in Data & Config yet
                {
                    id: 'dataConfig.cheatSheets',
                    label: 'Cheat Sheets',
                    description: 'FAQ knowledge base (edit via Frontline Intel Editor)',
                    ui: { sectionId: 'templateReferences', path: 'Data & Config → Templates' },
                    fields: [
                        {
                            id: 'dataConfig.cheatSheets',
                            label: 'Cheat Sheet Config',
                            ui: { inputId: 'templateReferences', path: 'Data & Config → Templates (Cheat Sheet Editor separate)' },
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
                    // IMPORTANT: Match ControlPlaneNav deep-link contract
                    // section=company-flows (URL / Wiring Next Actions)
                    ui: { sectionId: 'company-flows', path: 'Dynamic Flow → Company Flows' },
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
        // INTEGRATIONS TAB (Company Profile → Configuration)
        // ---------------------------------------------------------------------
        // ⚠️ DEPRECATED: Google Calendar + SMS integrations are UI_ONLY poison.
        // These fields exist in UI but runtime readers don't match registry IDs.
        // DECISION (Feb 2026): Hide UI until properly wired with CONFIG_READ traces.
        // When ready to wire: add proper runtime readers, add CONFIG_READ checkpoints,
        // then remove deprecated flag.
        // ---------------------------------------------------------------------
        {
            id: 'tab.integrations',
            label: 'Integrations',
            description: 'Third-party integrations (Google Calendar, SMS) - DEPRECATED',
            ui: { tabId: 'integrations', navSelector: '[data-tab="configuration"]' },
            db: { collection: 'companies', basePath: 'googleCalendar' },
            scope: 'company',
            deprecated: true,
            deprecatedReason: 'UI_ONLY fields - runtime readers not properly wired to registry. Hidden until fixed.',
            deprecatedAt: '2026-02-04',
            sections: [
                // GOOGLE CALENDAR
                {
                    id: 'integrations.googleCalendar',
                    label: 'Google Calendar Integration',
                    description: 'Real-time availability checking and automatic appointment creation',
                    ui: {
                        sectionId: 'google-calendar',
                        path: 'Company Profile → Configuration → Google Calendar Integration'
                    },
                    fields: [
                        {
                            id: 'integrations.googleCalendar.enabled',
                            label: 'Google Calendar Enabled',
                            ui: { inputId: 'gcEnabled', path: 'Configuration → Google Calendar → Enabled Toggle' },
                            db: { path: 'googleCalendar.enabled' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleCalendar.connected'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: false
                        },
                        {
                            id: 'integrations.googleCalendar.connected',
                            label: 'Calendar Connected',
                            ui: { inputId: 'gcConnected', path: 'Configuration → Google Calendar → Connection Status' },
                            db: { path: 'googleCalendar.connected' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleCalendar.connected'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: false,
                            notes: 'Set automatically via OAuth2 callback'
                        },
                        {
                            id: 'integrations.googleCalendar.calendarId',
                            label: 'Calendar ID',
                            ui: { inputId: 'gcCalendarId', path: 'Configuration → Google Calendar → Calendar Selection' },
                            db: { path: 'googleCalendar.calendarId' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleCalendar.settings'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'primary'
                        },
                        {
                            id: 'integrations.googleCalendar.bufferMinutes',
                            label: 'Buffer Before First Slot',
                            ui: { inputId: 'gcBufferMinutes', path: 'Configuration → Google Calendar → Booking Settings → Buffer' },
                            db: { path: 'googleCalendar.settings.bufferMinutes' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleCalendar.settings'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 60
                        },
                        {
                            id: 'integrations.googleCalendar.defaultDuration',
                            label: 'Default Appointment Duration',
                            ui: { inputId: 'gcDefaultDuration', path: 'Configuration → Google Calendar → Booking Settings → Duration' },
                            db: { path: 'googleCalendar.settings.defaultDurationMinutes' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleCalendar.settings'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 60
                        },
                        {
                            id: 'integrations.googleCalendar.maxDaysAhead',
                            label: 'Max Booking Days Ahead',
                            ui: { inputId: 'gcMaxDaysAhead', path: 'Configuration → Google Calendar → Booking Settings → Max Days' },
                            db: { path: 'googleCalendar.settings.maxBookingDaysAhead' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleCalendar.settings'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 30
                        },
                        {
                            id: 'integrations.googleCalendar.fallbackMode',
                            label: 'Fallback Mode',
                            ui: { inputId: 'gcFallbackMode', path: 'Configuration → Google Calendar → Fallback Mode' },
                            db: { path: 'googleCalendar.settings.fallbackMode' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleCalendar.settings'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'capture_preference',
                            allowedValues: ['capture_preference', 'message_only', 'transfer']
                        },
                        {
                            id: 'integrations.googleCalendar.eventTitleTemplate',
                            label: 'Event Title Template',
                            ui: { inputId: 'gcEventTitleTemplate', path: 'Configuration → Google Calendar → Event Title Template' },
                            db: { path: 'googleCalendar.settings.eventTitleTemplate' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleCalendar.settings'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: '{serviceType} - {customerName}',
                            notes: 'Placeholders: {customerName}, {serviceType}, {companyName}'
                        }
                    ]
                },
                
                // SERVICE TYPE TAGS (Color Mapping)
                {
                    id: 'integrations.serviceTypeTags',
                    label: 'Service Type Tags',
                    description: 'Map service types to calendar colors and scheduling rules',
                    ui: {
                        sectionId: 'service-type-tags',
                        path: 'Company Profile → Configuration → Service Type Tags'
                    },
                    fields: [
                        {
                            id: 'integrations.googleCalendar.colorCodingEnabled',
                            label: 'Enable Color Coding',
                            ui: { inputId: 'gcColorCodingEnabled', path: 'Configuration → Service Type Tags → Enable' },
                            db: { path: 'googleCalendar.eventColors.enabled' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleCalendar.eventColors'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: true
                        },
                        {
                            id: 'integrations.googleCalendar.colorMapping',
                            label: 'Service Type Color Mapping',
                            ui: { inputId: 'gcColorMapping', path: 'Configuration → Service Type Tags → Color Mapping' },
                            db: { path: 'googleCalendar.eventColors.colorMapping' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleCalendar.colorMapping'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: [],
                            notes: 'Array of {serviceType, canonicalType, colorId, label, scheduling}'
                        },
                        {
                            id: 'integrations.googleCalendar.defaultColor',
                            label: 'Default Color (Unknown Type)',
                            ui: { inputId: 'gcDefaultColor', path: 'Configuration → Service Type Tags → Default Color' },
                            db: { path: 'googleCalendar.eventColors.defaultColorId' },
                            runtime: RUNTIME_READERS_MAP['integrations.googleCalendar.eventColors'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: '7',
                            notes: 'Google Calendar colorId (1-11): 7=Peacock'
                        }
                    ]
                },
                
                // SMS NOTIFICATIONS
                {
                    id: 'integrations.smsNotifications',
                    label: 'SMS Notifications',
                    description: 'Booking confirmations and appointment reminders via SMS',
                    ui: {
                        sectionId: 'sms-notifications',
                        path: 'Company Profile → Configuration → SMS Notifications'
                    },
                    fields: [
                        {
                            id: 'integrations.smsNotifications.enabled',
                            label: 'SMS Notifications Enabled',
                            ui: { inputId: 'smsEnabled', path: 'Configuration → SMS Notifications → Enabled' },
                            db: { path: 'smsNotifications.enabled' },
                            runtime: RUNTIME_READERS_MAP['integrations.smsNotifications.enabled'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: false
                        },
                        {
                            id: 'integrations.smsNotifications.bookingConfirmation',
                            label: 'Booking Confirmation Template',
                            ui: { inputId: 'smsBookingConfirmation', path: 'Configuration → SMS Notifications → Booking Confirmation' },
                            db: { path: 'smsNotifications.templates.bookingConfirmation' },
                            runtime: RUNTIME_READERS_MAP['integrations.smsNotifications.templates'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'Hi {customerName}! Your appointment with {companyName} is confirmed for {appointmentTime}.',
                            notes: 'Placeholders: {customerName}, {companyName}, {appointmentTime}, {customerAddress}, {serviceType}'
                        },
                        {
                            id: 'integrations.smsNotifications.reminder24h',
                            label: '24-Hour Reminder Template',
                            ui: { inputId: 'smsReminder24h', path: 'Configuration → SMS Notifications → 24h Reminder' },
                            db: { path: 'smsNotifications.templates.reminder24h' },
                            runtime: RUNTIME_READERS_MAP['integrations.smsNotifications.templates'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'Reminder: Your appointment with {companyName} is tomorrow at {appointmentTime}.'
                        },
                        {
                            id: 'integrations.smsNotifications.reminder1h',
                            label: '1-Hour Reminder Template',
                            ui: { inputId: 'smsReminder1h', path: 'Configuration → SMS Notifications → 1h Reminder' },
                            db: { path: 'smsNotifications.templates.reminder1h' },
                            runtime: RUNTIME_READERS_MAP['integrations.smsNotifications.templates'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: 'Heads up! Your technician from {companyName} will arrive in about 1 hour.'
                        },
                        {
                            id: 'integrations.smsNotifications.quietHoursStart',
                            label: 'Quiet Hours Start',
                            ui: { inputId: 'smsQuietHoursStart', path: 'Configuration → SMS Notifications → Quiet Hours Start' },
                            db: { path: 'smsNotifications.quietHours.start' },
                            runtime: RUNTIME_READERS_MAP['integrations.smsNotifications.enabled'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: '21:00'
                        },
                        {
                            id: 'integrations.smsNotifications.quietHoursEnd',
                            label: 'Quiet Hours End',
                            ui: { inputId: 'smsQuietHoursEnd', path: 'Configuration → SMS Notifications → Quiet Hours End' },
                            db: { path: 'smsNotifications.quietHours.end' },
                            runtime: RUNTIME_READERS_MAP['integrations.smsNotifications.enabled'],
                            scope: 'company',
                            required: false,
                            validators: [],
                            defaultValue: '08:00'
                        }
                    ]
                }
            ]
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
        },
        
        // ---------------------------------------------------------------------
        // INFRASTRUCTURE TAB (V96j)
        // ---------------------------------------------------------------------
        {
            id: 'tab.infra',
            label: 'Infrastructure',
            description: 'Platform infrastructure settings (strict mode, tracing, caching)',
            ui: { tabId: 'infrastructure', navSelector: '[data-tab="infrastructure"]' },
            db: { collection: 'companies', basePath: 'aiAgentSettings.infra' },
            scope: 'company',
            sections: [
                // ═══════════════════════════════════════════════════════════════
                // V96j: STRICT CONFIG REGISTRY (Nuke Clean Sweep)
                // ═══════════════════════════════════════════════════════════════
                {
                    id: 'infra.strictConfig',
                    label: 'Strict Config Registry',
                    description: 'Enforcement mode for config registry validation',
                    fields: [
                        {
                            id: 'infra.strictConfigRegistry',
                            label: 'Strict Config Registry',
                            description: 'When enabled, any DEAD_READ (runtime reads config path not in registry) emits CONFIG_REGISTRY_VIOLATION. Enable for specific companies to catch legacy readers.',
                            db: { path: 'aiAgentSettings.infra.strictConfigRegistry' },
                            runtime: RUNTIME_READERS_MAP['infra.strictConfigRegistry'],
                            scope: 'company',
                            required: false,
                            defaultValue: false
                        },
                        {
                            id: 'infra.strictConfigRegistry.blockDeadReads',
                            label: 'Block Dead Reads',
                            description: 'When strict mode is enabled AND this is true, DEAD_READs return undefined instead of reading the unregistered path.',
                            db: { path: 'aiAgentSettings.infra.strictConfigRegistry.blockDeadReads' },
                            runtime: RUNTIME_READERS_MAP['infra.strictConfigRegistry.blockDeadReads'],
                            scope: 'company',
                            required: false,
                            defaultValue: false
                        },
                        {
                            id: 'infra.strictConfigRegistry.allowlist',
                            label: 'Dead Read Allowlist',
                            description: 'Array of AW paths that are allowed to be read even if not in registry (for gradual migration).',
                            db: { path: 'aiAgentSettings.infra.strictConfigRegistry.allowlist' },
                            runtime: RUNTIME_READERS_MAP['infra.strictConfigRegistry.allowlist'],
                            scope: 'company',
                            required: false,
                            defaultValue: []
                        }
                    ]
                },
                // ═══════════════════════════════════════════════════════════════
                // Scenario Pool Cache
                // ═══════════════════════════════════════════════════════════════
                {
                    id: 'infra.caching',
                    label: 'Caching',
                    description: 'Redis cache settings',
                    fields: [
                        {
                            id: 'infra.scenarioPoolCache',
                            label: 'Scenario Pool Cache',
                            description: 'Caches scenario pool per company for 5 minutes',
                            db: { path: null }, // Redis-based, no DB path
                            runtime: RUNTIME_READERS_MAP['infra.scenarioPoolCache'],
                            scope: 'company',
                            required: false,
                            defaultValue: null
                        }
                    ]
                }
            ]
        }
    ],
    
    // =========================================================================
    // INFRASTRUCTURE
    // =========================================================================
    infrastructure: [
        {
            // ID must match runtimeReaders.map.js key for proper wiring detection
            id: 'infra.scenarioPoolCache',
            label: 'Scenario Pool Cache (Redis)',
            description: 'Caches scenario pool per company for 5 minutes',
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
        },
        // ═══════════════════════════════════════════════════════════════════════
        // V96j: STRICT CONFIG REGISTRY (Nuke Clean Sweep)
        // ═══════════════════════════════════════════════════════════════════════
        {
            id: 'infra.strictConfigRegistry',
            label: 'Strict Config Registry',
            description: 'When enabled, any DEAD_READ (runtime reads config path not in registry) emits CONFIG_REGISTRY_VIOLATION. Enable for specific companies to catch legacy readers.',
            db: { path: 'aiAgentSettings.infra.strictConfigRegistry' },
            scope: 'company',
            critical: false,
            defaultValue: false
        },
        {
            id: 'infra.strictConfigRegistry.blockDeadReads',
            label: 'Block Dead Reads',
            description: 'When strict mode is enabled AND this is true, DEAD_READs return undefined instead of reading the unregistered path.',
            db: { path: 'aiAgentSettings.infra.strictConfigRegistry.blockDeadReads' },
            scope: 'company',
            critical: false,
            defaultValue: false
        },
        {
            id: 'infra.strictConfigRegistry.allowlist',
            label: 'Dead Read Allowlist',
            description: 'Array of AW paths that are allowed to be read even if not in registry (for gradual migration).',
            db: { path: 'aiAgentSettings.infra.strictConfigRegistry.allowlist' },
            scope: 'company',
            critical: false,
            defaultValue: []
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
 * @param {Object} options
 * @param {boolean} options.includeDeprecated - Include deprecated tabs/fields (default: true for backward compat)
 */
function getAllFields(options = {}) {
    const { includeDeprecated = true } = options;
    const fields = [];
    for (const tab of wiringRegistryV2.tabs) {
        // V93: Skip deprecated tabs unless explicitly requested
        if (!includeDeprecated && tab.deprecated === true) {
            continue;
        }
        for (const section of (tab.sections || [])) {
            // Skip deprecated sections
            if (!includeDeprecated && section.deprecated === true) {
                continue;
            }
            for (const field of (section.fields || [])) {
                // Skip deprecated fields
                if (!includeDeprecated && field.deprecated === true) {
                    continue;
                }
                fields.push({
                    ...field,
                    tabId: tab.id,
                    sectionId: section.id,
                    // Mark if parent tab or section is deprecated
                    _tabDeprecated: tab.deprecated === true,
                    _sectionDeprecated: section.deprecated === true
                });
            }
        }
    }
    return fields;
}

/**
 * Get active fields only (excludes deprecated)
 * V93: Use this for coverage calculations
 */
function getActiveFields() {
    return getAllFields({ includeDeprecated: false });
}

/**
 * Get deprecated fields only (for reporting in separate bucket)
 */
function getDeprecatedFields() {
    const deprecated = [];
    for (const tab of wiringRegistryV2.tabs) {
        if (tab.deprecated === true) {
            // Entire tab is deprecated - collect all its fields
            for (const section of (tab.sections || [])) {
                for (const field of (section.fields || [])) {
                    deprecated.push({
                        ...field,
                        tabId: tab.id,
                        sectionId: section.id,
                        deprecatedReason: tab.deprecatedReason || 'Tab deprecated',
                        deprecatedAt: tab.deprecatedAt
                    });
                }
            }
        } else {
            // Check for deprecated sections or fields within non-deprecated tab
            for (const section of (tab.sections || [])) {
                if (section.deprecated === true) {
                    for (const field of (section.fields || [])) {
                        deprecated.push({
                            ...field,
                            tabId: tab.id,
                            sectionId: section.id,
                            deprecatedReason: section.deprecatedReason || 'Section deprecated',
                            deprecatedAt: section.deprecatedAt
                        });
                    }
                } else {
                    for (const field of (section.fields || [])) {
                        if (field.deprecated === true) {
                            deprecated.push({
                                ...field,
                                tabId: tab.id,
                                sectionId: section.id,
                                deprecatedReason: field.deprecatedReason || 'Field deprecated',
                                deprecatedAt: field.deprecatedAt
                            });
                        }
                    }
                }
            }
        }
    }
    return deprecated;
}

/**
 * Get critical fields that block operation if missing
 */
function getCriticalFields() {
    return getActiveFields().filter(f => f.critical);
}

/**
 * Get kill switch fields
 */
function getKillSwitchFields() {
    return getActiveFields().filter(f => f.killSwitch);
}

module.exports = {
    wiringRegistryV2,
    AW_REGISTRY_VERSION,
    WIRING_SCHEMA_VERSION, // Backward compat alias
    VALIDATORS,
    getAllFields,
    getActiveFields,       // V93: Excludes deprecated - use for coverage calculations
    getDeprecatedFields,   // V93: Get deprecated fields for separate bucket
    getCriticalFields,
    getKillSwitchFields
};

