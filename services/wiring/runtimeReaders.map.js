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
    // ☢️ NUKED Feb 2026: ALL frontDesk.* entries removed
    // =========================================================================
    // The following legacy frontDesk paths have been completely removed:
    // - frontDesk.aiName → now in Agent 2.0
    // - frontDesk.conversationStyle → now in Agent 2.0
    // - frontDesk.styleAcknowledgments → now in Agent 2.0
    // - frontDesk.conversationStyle.openers → now in Agent 2.0
    // - frontDesk.discoveryResponseTemplates → now in Agent 2.0
    // - frontDesk.personality.warmth → now in Agent 2.0
    // - frontDesk.personality.speakingPace → now in Agent 2.0
    // - frontDesk.greetingResponses → now in Agent 2.0
    // - frontDesk.discoveryConsent.* → now in Agent 2.0
    // - frontDesk.sttProtectedWords → now in Agent 2.0
    // - frontDesk.discoveryFlow.* → now in Agent 2.0
    // - frontDesk.detectionTriggers.* → now in Agent 2.0
    // - frontDesk.bookingEnabled → now in Agent 2.0
    // - frontDesk.common*Names → now in Agent 2.0
    // - frontDesk.nameSpellingVariants.* → now in Agent 2.0
    // - frontDesk.offRailsRecovery.* → now in Agent 2.0
    // - frontDesk.confirmationRequests → now in Agent 2.0
    // - frontDesk.fastPathBooking.* → now in Agent 2.0
    // - frontDesk.vocabulary → now in Agent 2.0
    // - frontDesk.escalation.* → now in Agent 2.0
    // - frontDesk.emotions → now in Agent 2.0
    // - frontDesk.frustration → now in Agent 2.0
    // - frontDesk.forbiddenPhrases → now in Agent 2.0
    // - frontDesk.loopPrevention → now in Agent 2.0
    // - frontDesk.fallbackResponses → now in Agent 2.0
    // - frontDesk.businessHours → now in Agent 2.0
    // =========================================================================

    // =========================================================================
    // ☢️ NUKED Feb 2026: All frontDesk.* entries below this point removed
    // All discovery, consent, booking intent, and response template configs 
    // have been migrated to Agent 2.0 namespace
    // =========================================================================

    // ☢️ NUKED Feb 2026: frontDesk.detectionTriggers.*, frontDesk.bookingEnabled, 
    // frontDesk.commonFirstNames all removed - migrated to Agent 2.0

    // =========================================================================
    // COMMON NAMES — GLOBAL (AdminSettings)
    // =========================================================================
    // ☢️ NUKED Feb 2026: frontDesk.commonLastNames, frontDesk.nameStopWords, 
    // frontDesk.nameSpellingVariants.* all removed - migrated to Agent 2.0
    // Global name lists remain in AdminSettings (not frontDesk namespace)
    // =========================================================================
    'global.commonLastNames': {
        readers: [
            {
                file: 'services/engine/booking/BookingLogicEngine.js',
                function: 'extractSingleNameToken (lastName)',
                description: 'Last name recognition and confidence scoring',
                required: false
            }
        ],
        dbPath: 'AdminSettings.commonLastNames',
        scope: 'global',
        defaultValue: []
    },

    'global.nameStopWords': {
        readers: [
            {
                file: 'utils/IdentitySlotFirewall.js',
                function: 'validateName',
                description: 'Global stopwords for name validation',
                required: false
            }
        ],
        dbPath: 'AdminSettings.nameStopWords',
        scope: 'global',
        defaultValue: []
    },
    
    // ☢️ NUKED Feb 2026: frontDesk.nameSpellingVariants.* removed - migrated to Agent 2.0

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
        // ☢️ NUKED Feb 2026: frontDeskBehavior path removed
        dbPath: 'company.aiAgentSettings.booking.nameParsing',
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
        // ☢️ NUKED Feb 2026: frontDeskBehavior path removed
        dbPath: 'company.aiAgentSettings.booking.nameParsing.acceptLastNameOnly',
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
        // ☢️ NUKED Feb 2026: frontDeskBehavior path removed
        dbPath: 'company.aiAgentSettings.booking.nameParsing.lastNameOnlyPrompt',
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
                file: 'services/engine/booking/BookingLogicEngine.js',
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
                file: 'services/engine/booking/BookingLogicEngine.js',
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
        // ☢️ NUKED Feb 2026: frontDeskBehavior path removed
        dbPath: 'company.aiAgentSettings.booking.addressVerification.enabled',
        scope: 'company',
        defaultValue: true
    },

    'booking.addressVerification.provider': {
        readers: [
            {
                file: 'services/engine/booking/BookingLogicEngine.js',
                function: 'runStep',
                line: 510,
                description: 'Geocoding provider (google_geocode | none)',
                required: false
            }
        ],
        // ☢️ NUKED Feb 2026: frontDeskBehavior path removed
        dbPath: 'company.aiAgentSettings.booking.addressVerification.provider',
        scope: 'company',
        defaultValue: 'google_geocode'
    },

    'booking.addressVerification.requireCity': {
        readers: [
            {
                file: 'services/engine/booking/BookingLogicEngine.js',
                function: 'runStep',
                line: 515,
                description: 'Require city before confirming address',
                required: false
            }
        ],
        // ☢️ NUKED Feb 2026: frontDeskBehavior path removed
        dbPath: 'company.aiAgentSettings.booking.addressVerification.requireCity',
        scope: 'company',
        defaultValue: true
    },

    // V93: Default false - don't ask state unless offered or business requires
    'booking.addressVerification.requireState': {
        readers: [
            {
                file: 'services/engine/booking/BookingLogicEngine.js',
                function: 'runStep',
                line: 520,
                description: 'Require state before confirming address',
                required: false
            }
        ],
        // ☢️ NUKED Feb 2026: frontDeskBehavior path removed
        dbPath: 'company.aiAgentSettings.booking.addressVerification.requireState',
        scope: 'company',
        defaultValue: false // V93: Don't ask state unless business requires (geo can infer from city)
    },

    'booking.addressVerification.requireZip': {
        readers: [
            {
                file: 'services/engine/booking/BookingLogicEngine.js',
                function: 'runStep',
                line: 525,
                description: 'Require ZIP code before confirming address (optional)',
                required: false
            }
        ],
        // ☢️ NUKED Feb 2026: frontDeskBehavior path removed
        dbPath: 'company.aiAgentSettings.booking.addressVerification.requireZip',
        scope: 'company',
        defaultValue: false
    },

    'booking.addressVerification.requireUnitQuestion': {
        readers: [
            {
                file: 'services/engine/booking/BookingLogicEngine.js',
                function: 'runStep',
                line: 530,
                description: 'Always ask "Is this a house or unit/suite?" even if no apt mentioned',
                required: false
            }
        ],
        // ☢️ NUKED Feb 2026: frontDeskBehavior path removed
        dbPath: 'company.aiAgentSettings.booking.addressVerification.requireUnitQuestion',
        scope: 'company',
        defaultValue: true
    },

    'booking.addressVerification.unitQuestionMode': {
        readers: [
            {
                file: 'services/engine/booking/BookingLogicEngine.js',
                function: 'runStep',
                line: 535,
                description: 'Unit question mode: house_or_unit | always_ask | smart',
                required: false
            }
        ],
        // ☢️ NUKED Feb 2026: frontDeskBehavior path removed
        dbPath: 'company.aiAgentSettings.booking.addressVerification.unitQuestionMode',
        scope: 'company',
        defaultValue: 'house_or_unit'
    },

    'booking.addressVerification.missingCityStatePrompt': {
        readers: [
            {
                file: 'services/engine/booking/BookingLogicEngine.js',
                function: 'runStep',
                line: 540,
                description: 'Prompt when city/state missing from address',
                required: false
            }
        ],
        // ☢️ NUKED Feb 2026: frontDeskBehavior path removed
        dbPath: 'company.aiAgentSettings.booking.addressVerification.missingCityStatePrompt',
        scope: 'company',
        defaultValue: "Got it — what city and state is that in?"
    },

    'booking.addressVerification.unitTypePrompt': {
        readers: [
            {
                file: 'services/engine/booking/BookingLogicEngine.js',
                function: 'runStep',
                line: 545,
                description: 'Prompt to ask about house vs unit',
                required: false
            }
        ],
        // ☢️ NUKED Feb 2026: frontDeskBehavior path removed
        dbPath: 'company.aiAgentSettings.booking.addressVerification.unitTypePrompt',
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

    // ☢️ NUKED Feb 2026: frontDesk.offRailsRecovery.bridgeBack.resumeBooking removed

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
            },
            {
                file: 'services/engine/booking/BookingLogicEngine.js',
                function: 'run',
                description: 'Booking owner uses loop prevention settings during step execution',
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
    // ☢️ NUKED Feb 2026: loopDetection, spamFilter - never consumed at runtime
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
    // ☢️ NUKED Feb 2026: bailoutRules, confidenceThresholds - never consumed at runtime

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
 * @param {string} configPath - e.g., 'booking.addressVerification'
 * ☢️ NUKED Feb 2026: frontDesk.* paths removed - use Agent 2.0 paths
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

