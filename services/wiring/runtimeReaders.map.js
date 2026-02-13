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
    
    'frontDesk.styleAcknowledgments': {
        readers: [
            {
                file: 'services/HybridReceptionistLLM.js',
                function: 'generateResponse',
                line: 770,
                description: 'Uses UI-configured styleAcknowledgments when LLM did not provide an acknowledgment (LLMQNA slot turns)',
                required: false
            },
            {
                file: 'services/ResponseRenderer.js',
                function: 'getStyleAcknowledgment',
                line: 304,
                description: 'Uses UI-configured styleAcknowledgments for 0-token deterministic acknowledgments (state machine)',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.styleAcknowledgments',
        scope: 'company',
        defaultValue: {
            confident: "Let's get this taken care of.",
            balanced: 'I can help with that!',
            polite: "I'd be happy to help."
        }
    },

    'frontDesk.personality.warmth': {
        readers: [
            {
                file: 'services/HybridReceptionistLLM.js',
                function: 'buildSystemPrompt',
                line: 1050,
                description: 'Controls how warm/empathetic the assistant sounds (0.0 → 1.0)',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.personality.warmth',
        scope: 'company',
        defaultValue: 0.6
    },

    'frontDesk.personality.speakingPace': {
        readers: [
            {
                file: 'services/HybridReceptionistLLM.js',
                function: 'buildSystemPrompt',
                line: 1050,
                description: 'Controls how quickly the assistant moves through questions (slow/normal/fast)',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.personality.speakingPace',
        scope: 'company',
        defaultValue: 'normal'
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

    // V110: DB path fixed to consentYesWords (matches UI save field)
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
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.discoveryConsent.consentYesWords',
        scope: 'company',
        defaultValue: ['yes', 'yeah', 'yep', 'please', 'sure', 'okay', 'ok']
    },

    // V111: Connection Quality Gate - bad connection / low confidence detection
    'frontDesk.connectionQualityGate': {
        readers: [
            {
                file: 'services/engine/FrontDeskRuntime.js',
                function: 'handleTurn',
                description: 'GATE 1.5: Intercepts low-confidence STT and trouble phrases on early turns',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.connectionQualityGate',
        scope: 'company',
        defaultValue: { enabled: true, confidenceThreshold: 0.72, maxRetries: 3 }
    },

    // V111: Company-configurable protected words for STT filler removal
    'frontDesk.sttProtectedWords': {
        readers: [
            {
                file: 'services/STTPreprocessor.js',
                function: 'stripFillers',
                description: 'Words that are never stripped by filler removal',
                required: false
            },
            {
                file: 'routes/v2twilio.js',
                function: 'handleGather',
                description: 'Passes company protected words to STT preprocessing',
                required: false
            },
            {
                file: 'services/IntelligentRouter.js',
                function: 'route',
                description: 'Passes company protected words to STT preprocessing',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.sttProtectedWords',
        scope: 'company',
        defaultValue: []
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
    // V94: BOOKING INTENT DETECTION (CRITICAL MVA REQUIREMENT)
    // Without these, agent cannot detect "fix my AC" or "not cooling" as booking intent
    // =========================================================================
    'frontDesk.detectionTriggers.wantsBooking': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'ConsentDetector.checkConsent',
                line: 2439,
                description: 'Keywords that trigger booking mode (e.g., "fix", "repair", "not cooling")',
                required: true,
                critical: true,
                checkpoint: 'CONSENT_DETECTION'
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.detectionTriggers.wantsBooking',
        scope: 'company',
        defaultValue: ['fix', 'repair', 'service', 'appointment', 'schedule', 'technician', 'someone', 'come out', 'send', 'broken', 'not working', 'not cooling', 'not heating']
    },

    'booking.directIntentPatterns': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'detectDirectBookingIntent',
                line: 2500,
                description: 'Phrases that skip consent and go directly to booking (e.g., "get somebody out")',
                required: true,
                critical: true,
                checkpoint: 'DIRECT_BOOKING_INTENT'
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.bookingFlow.directIntentPatterns',
        scope: 'company',
        defaultValue: [
            // Explicit service requests
            'get somebody out', 'get someone out', 'get a tech out', 'get a technician out',
            'send someone', 'send somebody out', 'send a tech', 'need someone out',
            // Timing/urgency requests
            'when can you come', 'can you come out', 'how soon can you',
            'come out today', 'come out tomorrow',
            // Urgency indicators
            'asap', 'soonest', 'earliest', 'first available'
        ]
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
        validators: ['hasId', 'hasType', 'hasQuestion'],
        // V54: Per-slot configurable prompts (NO HARDCODES)
        subFields: {
            // Name slot prompts
            'lastNameQuestion': { default: "And what's your last name?", description: 'Prompt when asking for last name after first name' },
            'firstNameQuestion': { default: "And what's your first name?", description: 'Prompt when asking for first name after last name' },
            // Phone slot prompts
            'areaCodePrompt': { default: "Let's go step by step - what's the area code?", description: 'Prompt when breaking down phone number' },
            'restOfNumberPrompt': { default: "Got it. And the rest of the number?", description: 'Prompt after area code collected' },
            // Address slot prompts
            'partialAddressPrompt': { default: "I got part of that. Can you give me the full address including city?", description: 'Prompt when only partial address captured' },
            'streetBreakdownPrompt': { default: "Let's go step by step - what's the street address?", description: 'Prompt when breaking down address' },
            'cityPrompt': { default: "And what city?", description: 'Prompt when asking for city after street' },
            'zipPrompt': { default: "And the zip code?", description: 'Prompt when asking for zip after city' }
        }
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
    // FRONT DESK - SLOT EXTRACTION (Name parsing, stop words, merge rules)
    // =========================================================================
    'frontDesk.commonFirstNames': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 1850,
                description: 'Used by name extraction to recognize common first names vs noise',
                required: false
            },
            {
                file: 'services/engine/booking/SlotExtractor.js',
                function: 'extractName',
                line: 280,
                description: 'Validates extracted names against common first names list',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.commonFirstNames',
        scope: 'company',
        defaultValue: []
    },

    // =========================================================================
    // V111: COMMON LAST NAMES (US Census top 50K surnames)
    // =========================================================================
    // Source: US Census Bureau 2010 Decennial Census (Public Domain)
    // Coverage: ~83% of the US population
    // Seed: data/seeds/censusLastNames.js
    //
    // UI: Front Desk → Booking Prompts → Common Last Names
    // DB: aiAgentSettings.frontDeskBehavior.commonLastNames (array of strings)
    // Runtime: BookingFlowRunner name extraction & STT validation
    // =========================================================================
    'frontDesk.commonLastNames': {
        readers: [
            {
                file: 'services/engine/booking/BookingFlowRunner.js',
                function: 'SlotExtractors.name',
                line: 541,
                description: 'Last name recognition and STT fuzzy-match validation',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.commonLastNames',
        scope: 'company',
        defaultValue: []
    },

    // =========================================================================
    // V111: NAME STOP WORDS (Name Rejection Words)
    // =========================================================================
    // Company-specific words that should NEVER be accepted as a person's name.
    // These EXTEND the system defaults in IdentitySlotFirewall.NAME_STOPWORDS.
    //
    // UI: Front Desk → Booking Prompts → Name Rejection Words
    // DB: aiAgentSettings.frontDeskBehavior.nameStopWords (array of strings)
    // Runtime: IdentitySlotFirewall.validateName() + BookingFlowRunner.isStopWord()
    // =========================================================================
    'frontDesk.nameStopWords': {
        readers: [
            {
                file: 'utils/IdentitySlotFirewall.js',
                function: 'validateName',
                line: 79,
                description: 'Company stopwords merged with system defaults for name validation',
                required: false
            },
            {
                file: 'services/engine/booking/BookingFlowRunner.js',
                function: 'isStopWord',
                line: 756,
                description: 'Company stopwords merged with system defaults for booking name extraction',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.nameStopWords',
        scope: 'company',
        defaultValue: []
    },

    // =========================================================================
    // FRONT DESK - NAME SPELLING VARIANTS (Mark with K or Marc with C?)
    // =========================================================================
    // V94: These fields control spelling confirmation for names with variants.
    // BOTH global and slot-level must be enabled for the feature to fire.
    // =========================================================================
    
    'frontDesk.nameSpellingVariants': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'findSpellingVariant',
                line: 1637,
                description: 'Parent object for spelling variant configuration',
                checkpoint: 'SPELLING_VARIANT_CHECK',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.nameSpellingVariants',
        scope: 'company',
        defaultValue: { enabled: false, mode: '1_char_only', maxAsksPerCall: 1 }
    },
    
    'frontDesk.nameSpellingVariants.enabled': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'findSpellingVariant',
                line: 1640,
                description: 'Global master switch for spelling confirmation (Mark/Marc)',
                checkpoint: 'SPELLING_VARIANT_CHECK',
                required: false
            },
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 7133,
                description: 'Checked before asking spelling variant question',
                checkpoint: 'BOOKING_NAME_SPELLING',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.nameSpellingVariants.enabled',
        scope: 'company',
        defaultValue: false,
        notes: 'OFF by default - only enable for dental/medical/membership where exact spelling matters'
    },
    
    'frontDesk.nameSpellingVariants.mode': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'findSpellingVariant',
                line: 1721,
                description: 'Determines which variants trigger spelling questions',
                checkpoint: 'SPELLING_VARIANT_CHECK',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.nameSpellingVariants.mode',
        scope: 'company',
        defaultValue: '1_char_only',
        notes: 'Options: 1_char_only (Mark/Marc), any_variant (includes Steven/Stephen)'
    },
    
    'frontDesk.nameSpellingVariants.script': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 7400,
                description: 'Template for spelling confirmation prompt',
                checkpoint: 'BOOKING_NAME_SPELLING',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.nameSpellingVariants.script',
        scope: 'company',
        defaultValue: 'Just to confirm — {optionA} with a {letterA} or {optionB} with a {letterB}?',
        notes: 'Placeholders: {optionA}, {optionB} = names, {letterA}, {letterB} = differing letters'
    },
    
    'frontDesk.nameSpellingVariants.maxAsksPerCall': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'findSpellingVariant',
                line: 1645,
                description: 'Limits spelling questions per call to avoid annoyance',
                checkpoint: 'SPELLING_VARIANT_CHECK',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.nameSpellingVariants.maxAsksPerCall',
        scope: 'company',
        defaultValue: 1,
        notes: 'Recommended: 1. Set to 0 for unlimited.'
    },
    
    'frontDesk.nameSpellingVariants.source': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'findSpellingVariant',
                line: 1700,
                description: 'Where variant groups come from: curated_list or auto_scan',
                checkpoint: 'SPELLING_VARIANT_CHECK',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.nameSpellingVariants.source',
        scope: 'company',
        defaultValue: 'curated_list',
        notes: 'Options: curated_list (manual), auto_scan (from commonFirstNames)'
    },
    
    // Slot-level spelling confirmation (on name slot)
    'frontDesk.bookingSlots.name.confirmSpelling': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 7135,
                description: 'Slot-level toggle for spelling confirmation on name slot',
                checkpoint: 'BOOKING_NAME_SPELLING',
                required: false
            },
            {
                file: 'services/ConversationEngine.js',
                function: 'findSpellingVariant',
                line: 1641,
                description: 'Both global AND slot-level must be true for spelling to fire',
                checkpoint: 'SPELLING_VARIANT_CHECK',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.bookingSlots[name].confirmSpelling',
        scope: 'company',
        defaultValue: false,
        notes: 'Must be enabled TOGETHER with global nameSpellingVariants.enabled'
    },

    // =========================================================================
    // FRONT DESK - NAME PARSING (Last-name-first support)
    // =========================================================================
    'booking.nameParsing': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 1900,
                description: 'Name parsing configuration (last-name-first support)',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.nameParsing',
        scope: 'company',
        defaultValue: { acceptLastNameOnly: false }
    },

    'booking.nameParsing.acceptLastNameOnly': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 1905,
                description: 'Accept "My name is Smith" as lastName without firstName (prompts for first)',
                required: false
            },
            {
                file: 'services/engine/booking/SlotExtractor.js',
                function: 'extractName',
                line: 300,
                description: 'If single name given and not in commonFirstNames, treat as lastName',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.nameParsing.acceptLastNameOnly',
        scope: 'company',
        defaultValue: true
    },

    'booking.nameParsing.lastNameOnlyPrompt': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 1910,
                description: 'Prompt when lastName captured without firstName',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.nameParsing.lastNameOnlyPrompt',
        scope: 'company',
        defaultValue: "Thanks — and what's your first name?"
    },

    // =========================================================================
    // FRONT DESK - ADDRESS VERIFICATION POLICY (Google Geocode + completeness gating)
    // V97 FIX: Unified path under frontDeskBehavior for consistency
    // =========================================================================
    'booking.addressVerification': {
        readers: [
            {
                file: 'services/engine/booking/BookingFlowRunner.js',
                function: 'runStep',
                line: 500,
                description: 'Address verification policy object',
                required: false
            }
        ],
        // V97: Canonical path is frontDeskBehavior.booking.addressVerification
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.addressVerification',
        legacyPath: 'company.aiAgentSettings.frontDesk.booking.addressVerification',
        scope: 'company',
        defaultValue: { enabled: true, provider: 'google_geocode' }
    },

    'booking.addressVerification.enabled': {
        readers: [
            {
                file: 'services/engine/booking/BookingFlowRunner.js',
                function: 'runStep',
                line: 505,
                description: 'Master switch for address verification (must be true to enforce completeness)',
                required: false
            },
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 9432,
                description: 'V93: LLM path also reads this for geo validation in discovery mode',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.addressVerification.enabled',
        legacyPath: 'company.aiAgentSettings.frontDesk.booking.addressVerification.enabled',
        scope: 'company',
        defaultValue: true
    },

    'booking.addressVerification.provider': {
        readers: [
            {
                file: 'services/engine/booking/BookingFlowRunner.js',
                function: 'runStep',
                line: 510,
                description: 'Geocoding provider (google_geocode | none)',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.addressVerification.provider',
        legacyPath: 'company.aiAgentSettings.frontDesk.booking.addressVerification.provider',
        scope: 'company',
        defaultValue: 'google_geocode'
    },

    'booking.addressVerification.requireCity': {
        readers: [
            {
                file: 'services/engine/booking/BookingFlowRunner.js',
                function: 'runStep',
                line: 515,
                description: 'Require city before confirming address',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.addressVerification.requireCity',
        legacyPath: 'company.aiAgentSettings.frontDesk.booking.addressVerification.requireCity',
        scope: 'company',
        defaultValue: true
    },

    // V93: Default false - don't ask state unless offered or business requires
    'booking.addressVerification.requireState': {
        readers: [
            {
                file: 'services/engine/booking/BookingFlowRunner.js',
                function: 'runStep',
                line: 520,
                description: 'Require state before confirming address',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.addressVerification.requireState',
        legacyPath: 'company.aiAgentSettings.frontDesk.booking.addressVerification.requireState',
        scope: 'company',
        defaultValue: false // V93: Don't ask state unless business requires (geo can infer from city)
    },

    'booking.addressVerification.requireZip': {
        readers: [
            {
                file: 'services/engine/booking/BookingFlowRunner.js',
                function: 'runStep',
                line: 525,
                description: 'Require ZIP code before confirming address (optional)',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.addressVerification.requireZip',
        legacyPath: 'company.aiAgentSettings.frontDesk.booking.addressVerification.requireZip',
        scope: 'company',
        defaultValue: false
    },

    'booking.addressVerification.requireUnitQuestion': {
        readers: [
            {
                file: 'services/engine/booking/BookingFlowRunner.js',
                function: 'runStep',
                line: 530,
                description: 'Always ask "Is this a house or unit/suite?" even if no apt mentioned',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.addressVerification.requireUnitQuestion',
        legacyPath: 'company.aiAgentSettings.frontDesk.booking.addressVerification.requireUnitQuestion',
        scope: 'company',
        defaultValue: true
    },

    'booking.addressVerification.unitQuestionMode': {
        readers: [
            {
                file: 'services/engine/booking/BookingFlowRunner.js',
                function: 'runStep',
                line: 535,
                description: 'Unit question mode: house_or_unit | always_ask | smart',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.addressVerification.unitQuestionMode',
        legacyPath: 'company.aiAgentSettings.frontDesk.booking.addressVerification.unitQuestionMode',
        scope: 'company',
        defaultValue: 'house_or_unit'
    },

    'booking.addressVerification.missingCityStatePrompt': {
        readers: [
            {
                file: 'services/engine/booking/BookingFlowRunner.js',
                function: 'runStep',
                line: 540,
                description: 'Prompt when city/state missing from address',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.addressVerification.missingCityStatePrompt',
        legacyPath: 'company.aiAgentSettings.frontDesk.booking.addressVerification.missingCityStatePrompt',
        scope: 'company',
        defaultValue: "Got it — what city and state is that in?"
    },

    'booking.addressVerification.unitTypePrompt': {
        readers: [
            {
                file: 'services/engine/booking/BookingFlowRunner.js',
                function: 'runStep',
                line: 545,
                description: 'Prompt to ask about house vs unit',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.booking.addressVerification.unitTypePrompt',
        legacyPath: 'company.aiAgentSettings.frontDesk.booking.addressVerification.unitTypePrompt',
        scope: 'company',
        defaultValue: "Is this a house, or an apartment, suite, or unit? If it's a unit, what's the number?"
    },

    // =========================================================================
    // INTEGRATIONS - GOOGLE GEO (V93)
    // =========================================================================
    'integrations.googleGeo.enabled': {
        readers: [
            {
                file: 'services/AddressValidationService.js',
                function: 'validateAddress',
                line: 80,
                description: 'Master switch for Google Geocoding validation',
                required: false
            }
        ],
        dbPath: 'company.integrations.googleGeo.enabled',
        scope: 'company',
        defaultValue: true
    },

    'integrations.googleGeo.verificationMode': {
        readers: [
            {
                file: 'services/AddressValidationService.js',
                function: 'validateAddress',
                line: 85,
                description: 'Verification mode: STRICT (block on low confidence) | SOFT (warn only)',
                required: false
            }
        ],
        dbPath: 'company.integrations.googleGeo.verificationMode',
        scope: 'company',
        defaultValue: 'SOFT'
    },

    'integrations.googleGeo.minConfidence': {
        readers: [
            {
                file: 'services/AddressValidationService.js',
                function: 'validateAddress',
                line: 90,
                description: 'Minimum confidence threshold (HIGH | MEDIUM | LOW)',
                required: false
            }
        ],
        dbPath: 'company.integrations.googleGeo.minConfidence',
        scope: 'company',
        defaultValue: 'MEDIUM'
    },

    // =========================================================================
    // FRONT DESK - BOOKING CONTINUITY (NO HIDDEN FEATURES)
    // =========================================================================
    'frontDesk.offRailsRecovery.bridgeBack.resumeBooking': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 3380,
                description: 'Appends Resume Booking Protocol after off-rails answers during BOOKING (LLM interruption)',
                checkpoint: 'BOOKING_INTERRUPTION_*',
                required: false
            },
            // V97c: NUKED - utils/resumeBookingProtocol.js deleted, functionality moved to BookingFlowRunner
            // {
            //     file: 'utils/resumeBookingProtocol.js',
            //     function: 'buildResumeBookingBlock',
            //     line: 1,
            //     description: 'Builds the resume block using UI-configured templates and collected slots',
            //     required: false
            // }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.offRailsRecovery.bridgeBack.resumeBooking',
        scope: 'company',
        defaultValue: { enabled: true }
    },

    'frontDesk.confirmationRequests': {
        readers: [
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 2800,
                description: 'Intercepts “did you get my phone/name/address right?” and replies using slot confirmPrompt + captured value',
                checkpoint: 'BOOKING MODE SAFETY NET',
                required: false
            },
            {
                file: 'utils/confirmationRequest.js',
                function: 'detectConfirmationRequest',
                line: 1,
                description: 'Deterministically detects confirmation requests and which slot type is being confirmed',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.confirmationRequests',
        scope: 'company',
        defaultValue: { enabled: true }
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
    // FRONT DESK - EMOTIONS (UI: emotionResponses)
    // =========================================================================
    'frontDesk.emotions': {
        readers: [
            {
                file: 'services/HybridReceptionistLLM.js',
                function: 'getEmotionModifiers',
                line: 1280,
                description: 'Uses emotionResponses toggles to steer tone + friction (no hardcoded scripts)',
                required: false
            },
            {
                file: 'config/frontDeskPrompt.js',
                function: 'buildFrontDeskPrompt',
                line: 1,
                description: 'Injects emotion behavior rules into the LLM prompt',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.emotionResponses',
        scope: 'company',
        defaultValue: {}
    },

    // =========================================================================
    // FRONT DESK - FRUSTRATION (UI: frustrationTriggers)
    // =========================================================================
    'frontDesk.frustration': {
        readers: [
            {
                file: 'services/HybridReceptionistLLM.js',
                function: 'detectFrustrationFromTriggers',
                line: 1300,
                description: 'Matches caller text against frustrationTriggers to reduce friction / de-escalate',
                required: false
            },
            {
                file: 'config/frontDeskPrompt.js',
                function: 'buildFrontDeskPrompt',
                line: 1,
                description: 'Includes frustration trigger guidance in the LLM prompt',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.frustrationTriggers',
        scope: 'company',
        defaultValue: []
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
            },
            {
                file: 'services/ConversationEngine.js',
                function: 'processTurn',
                line: 3600,
                description: 'V54: Reads nudge prompts when caller says "just a second"',
                checkpoint: 'V54_LOOP_NUDGE',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.frontDeskBehavior.loopPrevention',
        scope: 'company',
        defaultValue: {},
        // V54: Configurable nudge prompts when caller pauses (NO HARDCODES)
        subFields: {
            'nudgeNamePrompt': { default: 'Sure — go ahead. ', description: 'Nudge when caller pauses during name collection' },
            'nudgePhonePrompt': { default: 'Sure — go ahead with the area code first. ', description: 'Nudge when caller pauses during phone collection' },
            'nudgeAddressPrompt': { default: 'No problem — go ahead with the street address, and include unit number if you have one. ', description: 'Nudge when caller pauses during address collection' }
        }
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
    // LLM-0 CONTROLS - BRAIN-1 BEHAVIOR (V83)
    // =========================================================================
    'llm0Controls.silenceHandling.enabled': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 120,
                description: 'Enables silence detection and prompts',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.silenceHandling.enabled',
        scope: 'company',
        defaultValue: true
    },
    'llm0Controls.silenceHandling.thresholdSeconds': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 121,
                description: 'Seconds of silence before prompting',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.silenceHandling.thresholdSeconds',
        scope: 'company',
        defaultValue: 5
    },
    'llm0Controls.silenceHandling.maxPrompts': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 122,
                description: 'Max silence prompts before escalation',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.silenceHandling.maxPrompts',
        scope: 'company',
        defaultValue: 3
    },
    'llm0Controls.loopDetection.enabled': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 130,
                description: 'Enables loop detection',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.loopDetection.enabled',
        scope: 'company',
        defaultValue: true
    },
    'llm0Controls.loopDetection.maxRepeatedResponses': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 131,
                description: 'Max repeated responses before action',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.loopDetection.maxRepeatedResponses',
        scope: 'company',
        defaultValue: 3
    },
    'llm0Controls.loopDetection.onLoopAction': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 132,
                description: 'Action on loop detection (escalate/warn/ignore)',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.loopDetection.onLoopAction',
        scope: 'company',
        defaultValue: 'escalate'
    },
    'llm0Controls.spamFilter.enabled': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 140,
                description: 'Enables spam/telemarketer filter',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.spamFilter.enabled',
        scope: 'company',
        defaultValue: true
    },
    'llm0Controls.spamFilter.telemarketerPhrases': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 141,
                description: 'Phrases that trigger spam detection',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.spamFilter.telemarketerPhrases',
        scope: 'company',
        defaultValue: []
    },
    'llm0Controls.spamFilter.onSpamDetected': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 142,
                description: 'Action when spam detected (polite_dismiss/hang_up/escalate)',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.spamFilter.onSpamDetected',
        scope: 'company',
        defaultValue: 'polite_dismiss'
    },
    'llm0Controls.customerPatience.enabled': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 150,
                description: 'Enables customer patience mode',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.customerPatience.enabled',
        scope: 'company',
        defaultValue: true
    },
    'llm0Controls.customerPatience.neverAutoHangup': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 151,
                description: 'Never auto-hangup on customers',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.customerPatience.neverAutoHangup',
        scope: 'company',
        defaultValue: true
    },
    'llm0Controls.bailoutRules.enabled': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 160,
                description: 'Enables bailout/escalation rules',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.bailoutRules.enabled',
        scope: 'company',
        defaultValue: true
    },
    'llm0Controls.bailoutRules.maxTurnsBeforeEscalation': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 161,
                description: 'Max conversation turns before escalating',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.bailoutRules.maxTurnsBeforeEscalation',
        scope: 'company',
        defaultValue: 10
    },
    'llm0Controls.bailoutRules.confusionThreshold': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 162,
                description: 'Confusion score threshold for bailout',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.bailoutRules.confusionThreshold',
        scope: 'company',
        defaultValue: 0.3
    },
    'llm0Controls.confidenceThresholds.highConfidence': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 170,
                description: 'High confidence threshold for decisions',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.confidenceThresholds.highConfidence',
        scope: 'company',
        defaultValue: 0.85
    },
    'llm0Controls.confidenceThresholds.mediumConfidence': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 171,
                description: 'Medium confidence threshold',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.confidenceThresholds.mediumConfidence',
        scope: 'company',
        defaultValue: 0.65
    },
    'llm0Controls.confidenceThresholds.lowConfidence': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 172,
                description: 'Low confidence threshold',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.confidenceThresholds.lowConfidence',
        scope: 'company',
        defaultValue: 0.45
    },
    'llm0Controls.confidenceThresholds.fallbackToLLM': {
        readers: [
            {
                file: 'services/LLM0ControlsLoader.js',
                function: 'load',
                line: 173,
                description: 'Threshold below which to fallback to LLM',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.llm0Controls.confidenceThresholds.fallbackToLLM',
        scope: 'company',
        defaultValue: 0.4
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
    // DATA CONFIG - CHEAT SHEETS (REMOVED Feb 2026 - Tier 2 reserved for future rebuild)
    // =========================================================================

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

    // ☢️ NUKED Feb 2026: dynamicFlow.companyFlows removed - V110 architecture replaces it

    // =========================================================================
    // BUSINESS HOURS (Canonical) - After-hours truth used by multiple subsystems
    // =========================================================================
    'frontDesk.businessHours': {
        readers: [
            {
                file: 'services/hours/AfterHoursEvaluator.js',
                function: 'evaluateAfterHours',
                line: 1,
                description: 'Single source of truth: determines after-hours based on company.aiAgentSettings.businessHours',
                required: false
            },
            // ☢️ NUKED Feb 2026: DynamicFlowEngine reader removed - V110 architecture replaces Dynamic Flows
            {
                file: 'services/AfterHoursCallTurnHandler.js',
                function: 'handleTurn',
                line: 1,
                description: 'After-hours call handler uses AfterHoursEvaluator (no drift)',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.businessHours',
        scope: 'company',
        defaultValue: null
    },

    // =========================================================================
    // GOOGLE CALENDAR INTEGRATION
    // =========================================================================
    'integrations.googleCalendar.connected': {
        readers: [
            {
                file: 'services/GoogleCalendarService.js',
                function: 'getOAuth2ClientForCompany',
                line: 86,
                description: 'Checks if calendar is connected before any calendar operation',
                required: true
            },
            {
                file: 'routes/company/googleCalendar.js',
                function: 'GET /status',
                line: 45,
                description: 'Returns calendar connection status to UI',
                required: false
            }
        ],
        dbPath: 'company.googleCalendar.connected',
        scope: 'company',
        defaultValue: false
    },
    'integrations.googleCalendar.settings': {
        readers: [
            {
                file: 'services/GoogleCalendarService.js',
                function: 'createBookingEvent',
                line: 871,
                description: 'Uses settings for event creation (buffer, duration, templates)',
                required: true
            },
            {
                file: 'services/GoogleCalendarService.js',
                function: 'checkAvailability',
                line: 400,
                description: 'Uses settings for availability windows',
                required: true
            }
        ],
        dbPath: 'company.googleCalendar.settings',
        scope: 'company',
        defaultValue: {}
    },
    'integrations.googleCalendar.eventColors': {
        readers: [
            {
                file: 'services/GoogleCalendarService.js',
                function: 'createBookingEvent',
                line: 912,
                description: 'Maps serviceType to Google Calendar colorId via colorMapping',
                required: false
            }
        ],
        dbPath: 'company.googleCalendar.eventColors',
        scope: 'company',
        defaultValue: { enabled: true, colorMapping: [] }
    },
    'integrations.googleCalendar.colorMapping': {
        readers: [
            {
                file: 'services/GoogleCalendarService.js',
                function: 'createBookingEvent',
                line: 916,
                description: 'Service type to calendar color mapping (canonicalType → colorId)',
                required: false
            },
            {
                file: 'services/ServiceTypeResolver.js',
                function: 'resolveServiceType',
                line: 50,
                description: 'Resolves detected service type to canonical type for color matching',
                required: false
            }
        ],
        dbPath: 'company.googleCalendar.eventColors.colorMapping',
        scope: 'company',
        defaultValue: []
    },

    // =========================================================================
    // SMS NOTIFICATIONS
    // =========================================================================
    'integrations.smsNotifications.enabled': {
        readers: [
            {
                file: 'services/SMSNotificationService.js',
                function: 'sendBookingConfirmation',
                line: 50,
                description: 'Checks if SMS notifications are enabled before sending',
                required: true
            }
        ],
        dbPath: 'company.smsNotifications.enabled',
        scope: 'company',
        defaultValue: false
    },
    'integrations.smsNotifications.templates': {
        readers: [
            {
                file: 'services/SMSNotificationService.js',
                function: 'sendBookingConfirmation',
                line: 80,
                description: 'Uses booking confirmation template with placeholders',
                required: true
            },
            {
                file: 'services/SMSNotificationService.js',
                function: 'sendReminder',
                line: 120,
                description: 'Uses 24h/1h reminder templates',
                required: false
            }
        ],
        dbPath: 'company.smsNotifications.templates',
        scope: 'company',
        defaultValue: {}
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
    // V96j: STRICT CONFIG REGISTRY (Nuke Clean Sweep)
    // =========================================================================
    'infra.strictConfigRegistry': {
        readers: [
            {
                file: 'services/wiring/AWConfigReader.js',
                function: '_handleDeadRead',
                line: 750,
                description: 'When true, DEAD_READs emit CONFIG_REGISTRY_VIOLATION events',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.infra.strictConfigRegistry',
        scope: 'company',
        defaultValue: false
    },
    
    'infra.strictConfigRegistry.blockDeadReads': {
        readers: [
            {
                file: 'services/wiring/AWConfigReader.js',
                function: '_handleDeadRead',
                line: 752,
                description: 'When true (and strict mode enabled), DEAD_READs return undefined instead of reading',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.infra.strictConfigRegistry.blockDeadReads',
        scope: 'company',
        defaultValue: false
    },
    
    'infra.strictConfigRegistry.allowlist': {
        readers: [
            {
                file: 'services/wiring/AWConfigReader.js',
                function: '_handleDeadRead',
                line: 753,
                description: 'Array of AW paths allowed to be read even if not in registry',
                required: false
            }
        ],
        dbPath: 'company.aiAgentSettings.infra.strictConfigRegistry.allowlist',
        scope: 'company',
        defaultValue: []
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

