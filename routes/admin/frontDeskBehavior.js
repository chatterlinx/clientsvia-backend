/**
 * ============================================================================
 * FRONT DESK BEHAVIOR - Admin API Routes
 * ============================================================================
 * 
 * Manage all LLM-0 conversation behavior settings through the UI.
 * Everything is visible and editable - no hidden controls.
 * 
 * ENDPOINTS:
 * - GET    /:companyId           - Get current config
 * - PATCH  /:companyId           - Update config
 * - POST   /:companyId/reset     - Reset to defaults
 * - POST   /:companyId/test      - Test a phrase with current settings
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const v2Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { DEFAULT_FRONT_DESK_CONFIG } = require('../../config/frontDeskPrompt');

// ============================================================================
// DEFAULT VALUES (Shown in UI, can be customized per company)
// ============================================================================

const UI_DEFAULTS = {
    // 🎯 Conversation Style - How AI approaches booking
    // confident: "Let's get you scheduled" - assumptive, guides caller
    // balanced: "I can help with that" - friendly, universal default
    // polite: "Would you like me to...?" - deferential, respects autonomy
    conversationStyle: 'balanced',
    personality: {
        tone: 'warm',
        verbosity: 'concise',
        maxResponseWords: 30,
        useCallerName: true
    },
    bookingPrompts: {
        askName: "May I have your name?",
        askPhone: "What's the best phone number to reach you?",
        askAddress: "What's the service address?",
        askTime: "When works best for you - morning or afternoon?",
        confirmTemplate: "So I have {name} at {address}, {time}. Does that sound right?",
        completeTemplate: "You're all set, {name}! A technician will be out {time}. You'll receive a confirmation text shortly.",
        offerAsap: true,
        asapPhrase: "Or I can send someone as soon as possible."
    },
    emotionResponses: {
        stressed: {
            enabled: true,
            acknowledgments: [
                "I understand, that sounds stressful.",
                "That must be really uncomfortable.",
                "I can hear this is frustrating."
            ],
            followUp: "Let me help you get this taken care of."
        },
        frustrated: {
            enabled: true,
            acknowledgments: [
                "I completely understand.",
                "I hear you, let's get this sorted.",
                "I get it - let's just get this done."
            ],
            followUp: "I'll get someone scheduled right away.",
            reduceFriction: true
        },
        angry: {
            enabled: true,
            acknowledgments: [
                "I'm really sorry you're dealing with this.",
                "I understand you're upset.",
                "I apologize for the frustration."
            ],
            followUp: "Let me make this right.",
            offerEscalation: true,
            maxTriesBeforeEscalate: 2
        },
        friendly: {
            enabled: true,
            allowSmallTalk: true,
            smallTalkLimit: 1
        }
    },
    frustrationTriggers: [
        "i don't care",
        "just send someone",
        "this is ridiculous",
        "you're not listening",
        "i already told you",
        "stop asking",
        "forget it",
        "whatever"
    ],
    escalation: {
        enabled: true,
        maxLoopsBeforeOffer: 3,
        triggerPhrases: ["manager", "supervisor", "real person", "human"],
        offerMessage: "I can connect you to someone directly or take a message for a manager. Which would you prefer?",
        transferMessage: "Let me connect you to our team now."
    },
    loopPrevention: {
        enabled: true,
        maxSameQuestion: 2,
        onLoop: 'rephrase',
        rephraseIntro: "Let me try this differently - "
    },
    forbiddenPhrases: [
        // Generic robot phrases that kill trust
        "tell me more about what you need",
        "what specific issues are you experiencing",
        "I'm sorry, I didn't understand",
        "let me clarify",
        "I'm here to help. Can you please tell me",
        "I understand. I can help you with that",
        "let me get some details",
        "can you please provide more information",
        "I need more information",
        "what exactly do you need",
        "could you be more specific",
        // Avoid these hedging phrases
        "I think",
        "I'm not sure but",
        "probably",
        "maybe I can",
        // These sound robotic
        "processing your request",
        "one moment please",
        "please hold while I"
    ],
    // Service area responses (admin-editable)
    serviceAreaResponses: {
        confirm: "Yes, we absolutely service {city} and all of Southwest Florida! We've been taking care of customers there for years.",
        ask: "We service most of Southwest Florida. What city or area are you located in?",
        decline: "I'm sorry, we don't currently service that area."
    },
    // Inquiry responses for common questions
    inquiryResponses: {
        ductCleaning: "Absolutely! Duct cleaning is one of our specialties. It helps improve air quality and system efficiency.",
        thermostatUpgrade: "Great choice! A new thermostat can save you money and make your home more comfortable. We install all major brands.",
        generalService: "We'd be happy to help! Let me get you scheduled with one of our technicians.",
        pricingInfo: "I'd be happy to get you a quote. Our pricing depends on the specific work needed - let me get your information and have someone reach out with details."
    },
    // 👤 Common First Names - UI-configurable name recognition
    // Empty by default - companies add their own common names
    commonFirstNames: [],
    // 🎯 Booking Outcome - What AI says when all slots collected
    // Default: "Confirmed on Call" - no callbacks unless explicitly enabled
    bookingOutcome: {
        mode: 'confirmed_on_call',
        useAsapVariant: true,
        finalScripts: {},
        asapVariantScript: null,
        customFinalScript: null
    }
};

// ============================================================================
// GET - Fetch current config
// ============================================================================
router.get('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const company = await v2Company.findById(companyId).lean();
        if (!company) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        // Merge saved config with defaults
        const saved = company.aiAgentSettings?.frontDeskBehavior || {};
        
        // 👤 DEBUG: Log RAW saved data before merge
        logger.info('[FRONT DESK BEHAVIOR] 👤 CHECKPOINT: RAW SAVED commonFirstNames:', {
            companyId,
            rawCount: (saved.commonFirstNames || []).length,
            rawSample: (saved.commonFirstNames || []).slice(0, 10),
            hasRawCommonFirstNames: !!saved.commonFirstNames,
            savedKeys: Object.keys(saved)
        });
        
        const config = deepMerge(UI_DEFAULTS, saved);
        
        // 🔍 DEBUG: Log what we're returning AFTER merge
        logger.info('[FRONT DESK BEHAVIOR] 👤 CHECKPOINT: AFTER MERGE commonFirstNames:', {
            companyId,
            count: (config.commonFirstNames || []).length,
            sample: (config.commonFirstNames || []).slice(0, 10),
            hasCommonFirstNames: !!config.commonFirstNames
        });
        
        if (config.bookingSlots) {
            logger.info('[FRONT DESK BEHAVIOR] GET - Returning bookingSlots:', {
                companyId,
                slotCount: config.bookingSlots.length,
                slots: config.bookingSlots.map(s => ({
                    id: s.id,
                    type: s.type,
                    askFullName: s.askFullName,
                    useFirstNameOnly: s.useFirstNameOnly,
                    askMissingNamePart: s.askMissingNamePart
                }))
            });
        } else {
            logger.info('[FRONT DESK BEHAVIOR] GET - No bookingSlots saved', { companyId });
        }
        
        // Ensure enabled defaults to true
        if (config.enabled === undefined) {
            config.enabled = true;
        }
        
        res.json({
            success: true,
            data: {
                enabled: config.enabled,
                // 🎯 Conversation Style - confident/balanced/polite
                conversationStyle: config.conversationStyle || 'balanced',
                // 💬 Style Acknowledgments - custom phrases per style
                styleAcknowledgments: config.styleAcknowledgments || null,
                personality: config.personality,
                // 🚨 Dynamic booking slots (new system)
                bookingSlots: config.bookingSlots || null,
                bookingTemplates: config.bookingTemplates || null,
                // Legacy booking prompts (for backward compatibility)
                bookingPrompts: config.bookingPrompts,
                emotionResponses: config.emotionResponses,
                frustrationTriggers: config.frustrationTriggers,
                escalation: config.escalation,
                loopPrevention: config.loopPrevention,
                forbiddenPhrases: config.forbiddenPhrases,
                // New UI-controlled fields
                detectionTriggers: config.detectionTriggers || null,
                fallbackResponses: config.fallbackResponses || null,
                modeSwitching: config.modeSwitching || null,
                serviceAreaResponses: config.serviceAreaResponses || null,
                inquiryResponses: config.inquiryResponses || null,
                // V22: Discovery & Consent Gate
                discoveryConsent: config.discoveryConsent || null,
                // V22: Vocabulary Guardrails (AI output)
                vocabularyGuardrails: config.vocabularyGuardrails || null,
                // 🔤 V26: Caller Vocabulary (Industry slang translation - caller input)
                callerVocabulary: config.callerVocabulary || null,
                // 🚀 V25: Fast-Path Booking - Respect caller urgency
                fastPathBooking: config.fastPathBooking || null,
                // 👤 Common First Names - UI-configurable name recognition
                commonFirstNames: config.commonFirstNames || [],
                // ✏️ V30: Name Spelling Variants - "Mark with K or C?"
                nameSpellingVariants: config.nameSpellingVariants || null,
                // 🎯 Booking Outcome - What AI says when all slots collected
                bookingOutcome: config.bookingOutcome || {
                    mode: 'confirmed_on_call',
                    useAsapVariant: true,
                    finalScripts: {},
                    asapVariantScript: null,
                    customFinalScript: null
                },
                // 👋 V32: Conversation Stages (includes greetingRules)
                conversationStages: config.conversationStages || null,
                // 🔇 V36: Filler Words (company-specific custom fillers)
                fillerWords: company.aiAgentSettings?.fillerWords || { inherited: [], custom: [] },
                fillerWordsEnabled: config.fillerWordsEnabled !== false, // Default to true
                // 🚫 V36: Name Stop Words (words that should NEVER be extracted as names)
                nameStopWords: company.aiAgentSettings?.nameStopWords || { enabled: true, custom: [] },
                nameStopWordsEnabled: config.nameStopWordsEnabled !== false, // Default to true
                lastUpdated: saved.lastUpdated || null
            }
        });
        
    } catch (error) {
        logger.error('[FRONT DESK BEHAVIOR] Get error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// PATCH - Update config
// ============================================================================
router.patch('/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const updates = req.body;
        
        logger.info('[FRONT DESK BEHAVIOR] Updating config', {
            companyId,
            fieldsUpdated: Object.keys(updates)
        });
        
        // 👤 DEBUG: Log commonFirstNames received from frontend
        logger.info('[FRONT DESK BEHAVIOR] 👤 CHECKPOINT: commonFirstNames RECEIVED:', {
            companyId,
            hasCommonFirstNames: updates.commonFirstNames !== undefined,
            count: (updates.commonFirstNames || []).length,
            sample: (updates.commonFirstNames || []).slice(0, 5),
            rawValue: updates.commonFirstNames
        });
        
        // Build the update object
        const updateObj = {};
        
        if (updates.enabled !== undefined) {
            updateObj['aiAgentSettings.frontDeskBehavior.enabled'] = updates.enabled;
        }
        
        if (updates.personality) {
            Object.entries(updates.personality).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.personality.${key}`] = value;
            });
        }
        
        if (updates.bookingPrompts) {
            Object.entries(updates.bookingPrompts).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.bookingPrompts.${key}`] = value;
            });
        }
        
        if (updates.emotionResponses) {
            Object.entries(updates.emotionResponses).forEach(([emotion, settings]) => {
                Object.entries(settings).forEach(([key, value]) => {
                    updateObj[`aiAgentSettings.frontDeskBehavior.emotionResponses.${emotion}.${key}`] = value;
                });
            });
        }
        
        if (updates.frustrationTriggers) {
            updateObj['aiAgentSettings.frontDeskBehavior.frustrationTriggers'] = updates.frustrationTriggers;
        }
        
        // 🎯 CONVERSATION STYLE - How AI approaches booking (confident/balanced/polite)
        if (updates.conversationStyle) {
            updateObj['aiAgentSettings.frontDeskBehavior.conversationStyle'] = updates.conversationStyle;
            logger.info('[FRONT DESK BEHAVIOR] 🎯 Saving conversationStyle:', updates.conversationStyle);
        }
        
        // 💬 STYLE ACKNOWLEDGMENTS - Custom phrases for each conversation style
        if (updates.styleAcknowledgments) {
            updateObj['aiAgentSettings.frontDeskBehavior.styleAcknowledgments'] = updates.styleAcknowledgments;
            logger.info('[FRONT DESK BEHAVIOR] 💬 Saving styleAcknowledgments:', updates.styleAcknowledgments);
        }
        
        if (updates.escalation) {
            Object.entries(updates.escalation).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.escalation.${key}`] = value;
            });
        }
        
        if (updates.loopPrevention) {
            Object.entries(updates.loopPrevention).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.loopPrevention.${key}`] = value;
            });
        }
        
        if (updates.forbiddenPhrases) {
            updateObj['aiAgentSettings.frontDeskBehavior.forbiddenPhrases'] = updates.forbiddenPhrases;
        }
        
        // 🚨 CRITICAL: Save dynamic booking slots
        if (updates.bookingSlots) {
            updateObj['aiAgentSettings.frontDeskBehavior.bookingSlots'] = updates.bookingSlots;
            logger.info('[FRONT DESK BEHAVIOR] Saving bookingSlots', {
                companyId,
                slotCount: updates.bookingSlots.length,
                slots: updates.bookingSlots.map(s => ({ 
                    id: s.id, 
                    question: s.question?.substring(0, 30),
                    askFullName: s.askFullName,
                    useFirstNameOnly: s.useFirstNameOnly,
                    askMissingNamePart: s.askMissingNamePart  // Log this specifically
                }))
            });
        }
        
        // Save booking templates
        if (updates.bookingTemplates) {
            Object.entries(updates.bookingTemplates).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.bookingTemplates.${key}`] = value;
            });
        }
        
        // Save detection triggers
        if (updates.detectionTriggers) {
            Object.entries(updates.detectionTriggers).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.detectionTriggers.${key}`] = value;
            });
        }
        
        // Save fallback responses
        if (updates.fallbackResponses) {
            Object.entries(updates.fallbackResponses).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.fallbackResponses.${key}`] = value;
            });
        }
        
        // Save mode switching
        if (updates.modeSwitching) {
            Object.entries(updates.modeSwitching).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.modeSwitching.${key}`] = value;
            });
        }
        
        // Save service area responses
        if (updates.serviceAreaResponses) {
            Object.entries(updates.serviceAreaResponses).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.serviceAreaResponses.${key}`] = value;
            });
        }
        
        // Save inquiry responses
        if (updates.inquiryResponses) {
            Object.entries(updates.inquiryResponses).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.inquiryResponses.${key}`] = value;
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // V22: Discovery & Consent Gate Settings
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.discoveryConsent) {
            Object.entries(updates.discoveryConsent).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.discoveryConsent.${key}`] = value;
            });
            logger.info('[FRONT DESK BEHAVIOR] 🧠 V22 Saving discoveryConsent:', updates.discoveryConsent);
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // V22: Vocabulary Guardrails Settings
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.vocabularyGuardrails) {
            Object.entries(updates.vocabularyGuardrails).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.vocabularyGuardrails.${key}`] = value;
            });
            logger.info('[FRONT DESK BEHAVIOR] 📝 V22 Saving vocabularyGuardrails:', updates.vocabularyGuardrails);
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🔤 V26: Caller Vocabulary - Industry Slang Translation
        // ════════════════════════════════════════════════════════════════════════════
        // When caller says "not pulling", AI understands "not cooling" (HVAC)
        // This is for INPUT (what caller says), not OUTPUT (what AI says)
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.callerVocabulary) {
            Object.entries(updates.callerVocabulary).forEach(([key, value]) => {
                updateObj[`aiAgentSettings.frontDeskBehavior.callerVocabulary.${key}`] = value;
            });
            logger.info('[FRONT DESK BEHAVIOR] 🔤 V26 Saving callerVocabulary:', {
                companyId,
                enabled: updates.callerVocabulary.enabled,
                synonymCount: updates.callerVocabulary.synonymMap ? Object.keys(updates.callerVocabulary.synonymMap).length : 0
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 👤 Common First Names - UI-Configurable Name Recognition
        // ════════════════════════════════════════════════════════════════════════════
        // Used to detect if a single name token is a first name or last name
        // When caller says "Mark", system checks this list to know it's a first name
        // Then asks "And what's your last name?" instead of "first name"
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.commonFirstNames !== undefined) {
            // Accept both arrays and empty arrays (allow clearing the list)
            updateObj['aiAgentSettings.frontDeskBehavior.commonFirstNames'] = updates.commonFirstNames || [];
            logger.info('[FRONT DESK BEHAVIOR] 👤 CHECKPOINT: Saving commonFirstNames', {
                companyId,
                count: (updates.commonFirstNames || []).length,
                sample: (updates.commonFirstNames || []).slice(0, 10),
                fullList: updates.commonFirstNames
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // ✏️ V30: Name Spelling Variants - "Mark with K or C?"
        // ════════════════════════════════════════════════════════════════════════════
        // Optional feature for dental/medical/membership contexts.
        // OFF by default - only enable when exact spelling matters for record lookup.
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.nameSpellingVariants) {
            if (updates.nameSpellingVariants.enabled !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.nameSpellingVariants.enabled'] = updates.nameSpellingVariants.enabled;
            }
            if (updates.nameSpellingVariants.source !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.nameSpellingVariants.source'] = updates.nameSpellingVariants.source;
            }
            if (updates.nameSpellingVariants.mode !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.nameSpellingVariants.mode'] = updates.nameSpellingVariants.mode;
            }
            if (updates.nameSpellingVariants.script !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.nameSpellingVariants.script'] = updates.nameSpellingVariants.script;
            }
            if (updates.nameSpellingVariants.maxAsksPerCall !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.nameSpellingVariants.maxAsksPerCall'] = updates.nameSpellingVariants.maxAsksPerCall;
            }
            if (updates.nameSpellingVariants.variantGroups !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.nameSpellingVariants.variantGroups'] = updates.nameSpellingVariants.variantGroups;
            }
            logger.info('[FRONT DESK BEHAVIOR] ✏️ V30 Saving nameSpellingVariants:', {
                companyId,
                enabled: updates.nameSpellingVariants.enabled,
                source: updates.nameSpellingVariants.source,
                mode: updates.nameSpellingVariants.mode,
                variantGroupCount: updates.nameSpellingVariants.variantGroups ? Object.keys(updates.nameSpellingVariants.variantGroups).length : 0
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🎯 Booking Outcome - What AI says when all slots collected
        // ════════════════════════════════════════════════════════════════════════════
        // DEFAULT: "Confirmed on Call" - no callbacks unless explicitly enabled
        // Modes: confirmed_on_call, pending_dispatch, callback_required, 
        //        transfer_to_scheduler, after_hours_hold
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.bookingOutcome) {
            if (updates.bookingOutcome.mode !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.bookingOutcome.mode'] = updates.bookingOutcome.mode;
            }
            if (updates.bookingOutcome.useAsapVariant !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.bookingOutcome.useAsapVariant'] = updates.bookingOutcome.useAsapVariant;
            }
            if (updates.bookingOutcome.asapVariantScript !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.bookingOutcome.asapVariantScript'] = updates.bookingOutcome.asapVariantScript;
            }
            if (updates.bookingOutcome.customFinalScript !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.bookingOutcome.customFinalScript'] = updates.bookingOutcome.customFinalScript;
            }
            if (updates.bookingOutcome.finalScripts) {
                Object.entries(updates.bookingOutcome.finalScripts).forEach(([mode, script]) => {
                    updateObj[`aiAgentSettings.frontDeskBehavior.bookingOutcome.finalScripts.${mode}`] = script;
                });
            }
            logger.info('[FRONT DESK BEHAVIOR] 🎯 Saving bookingOutcome:', {
                companyId,
                mode: updates.bookingOutcome.mode,
                useAsapVariant: updates.bookingOutcome.useAsapVariant,
                hasCustomScript: !!updates.bookingOutcome.customFinalScript
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🚀 V25: Fast-Path Booking - Respect caller urgency
        // ════════════════════════════════════════════════════════════════════════════
        // When caller says "I need you out here", skip troubleshooting and offer scheduling.
        // Does NOT auto-book - still requires explicit consent.
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.fastPathBooking) {
            if (updates.fastPathBooking.enabled !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.fastPathBooking.enabled'] = updates.fastPathBooking.enabled;
            }
            if (updates.fastPathBooking.triggerKeywords !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.fastPathBooking.triggerKeywords'] = updates.fastPathBooking.triggerKeywords;
            }
            if (updates.fastPathBooking.offerScript !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.fastPathBooking.offerScript'] = updates.fastPathBooking.offerScript;
            }
            if (updates.fastPathBooking.oneQuestionScript !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.fastPathBooking.oneQuestionScript'] = updates.fastPathBooking.oneQuestionScript;
            }
            if (updates.fastPathBooking.maxDiscoveryQuestions !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.fastPathBooking.maxDiscoveryQuestions'] = updates.fastPathBooking.maxDiscoveryQuestions;
            }
            logger.info('[FRONT DESK BEHAVIOR] 🚀 Saving fastPathBooking:', {
                companyId,
                enabled: updates.fastPathBooking.enabled,
                keywordCount: updates.fastPathBooking.triggerKeywords?.length,
                maxQuestions: updates.fastPathBooking.maxDiscoveryQuestions
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 👋 V32: Conversation Stages (includes greetingRules)
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.conversationStages) {
            // Save greetingRules array (new V32 format)
            if (updates.conversationStages.greetingRules !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.conversationStages.greetingRules'] = updates.conversationStages.greetingRules;
            }
            // Save legacy greetingResponses (for backward compat)
            if (updates.conversationStages.greetingResponses) {
                Object.entries(updates.conversationStages.greetingResponses).forEach(([key, value]) => {
                    updateObj[`aiAgentSettings.frontDeskBehavior.conversationStages.greetingResponses.${key}`] = value;
                });
            }
            // Save other conversationStages settings if present
            if (updates.conversationStages.enabled !== undefined) {
                updateObj['aiAgentSettings.frontDeskBehavior.conversationStages.enabled'] = updates.conversationStages.enabled;
            }
            logger.info('[FRONT DESK BEHAVIOR] 👋 V32 Saving conversationStages:', {
                companyId,
                greetingRulesCount: updates.conversationStages.greetingRules?.length || 0,
                hasLegacyResponses: !!updates.conversationStages.greetingResponses
            });
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🔇 V36: Custom Filler Words (Company-Specific)
        // These are saved to aiAgentSettings.fillerWords.custom (NOT frontDeskBehavior)
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.fillerWords) {
            if (updates.fillerWords.custom !== undefined) {
                updateObj['aiAgentSettings.fillerWords.custom'] = updates.fillerWords.custom;
            }
            logger.info('[FRONT DESK BEHAVIOR] 🔇 V36 Saving custom fillers:', {
                companyId,
                customCount: (updates.fillerWords.custom || []).length,
                customFillers: updates.fillerWords.custom || []
            });
        }
        
        // 🔇 V36: Filler words enabled toggle
        if (updates.fillerWordsEnabled !== undefined) {
            updateObj['aiAgentSettings.frontDeskBehavior.fillerWordsEnabled'] = updates.fillerWordsEnabled;
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🚫 V36: Name Stop Words (Words that should NEVER be extracted as names)
        // These are saved to aiAgentSettings.nameStopWords (NOT frontDeskBehavior)
        // ════════════════════════════════════════════════════════════════════════════
        if (updates.nameStopWords) {
            if (updates.nameStopWords.enabled !== undefined) {
                updateObj['aiAgentSettings.nameStopWords.enabled'] = updates.nameStopWords.enabled;
            }
            if (updates.nameStopWords.custom !== undefined) {
                updateObj['aiAgentSettings.nameStopWords.custom'] = updates.nameStopWords.custom;
            }
            logger.info('[FRONT DESK BEHAVIOR] 🚫 V36 Saving name stop words:', {
                companyId,
                enabled: updates.nameStopWords.enabled,
                customCount: (updates.nameStopWords.custom || []).length,
                customWords: updates.nameStopWords.custom || []
            });
        }
        
        // 🚫 V36: Name stop words enabled toggle
        if (updates.nameStopWordsEnabled !== undefined) {
            updateObj['aiAgentSettings.frontDeskBehavior.nameStopWordsEnabled'] = updates.nameStopWordsEnabled;
        }
        
        updateObj['aiAgentSettings.frontDeskBehavior.lastUpdated'] = new Date();
        updateObj['aiAgentSettings.frontDeskBehavior.updatedBy'] = req.user?.email || 'admin';
        
        const result = await v2Company.findByIdAndUpdate(
            companyId,
            { $set: updateObj },
            { new: true }
        );
        
        if (!result) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        // 🔍 DEBUG: Log what was actually saved to MongoDB
        const savedSlots = result.aiAgentSettings?.frontDeskBehavior?.bookingSlots;
        if (savedSlots) {
            const nameSlot = savedSlots.find(s => s.id === 'name');
            logger.info('[FRONT DESK BEHAVIOR] ✅ SAVED TO MONGODB - Name slot:', {
                companyId,
                id: nameSlot?.id,
                type: nameSlot?.type,
                askMissingNamePart: nameSlot?.askMissingNamePart,
                askMissingNamePartType: typeof nameSlot?.askMissingNamePart
            });
        }
        
        // 👤 DEBUG: Log commonFirstNames that was saved
        const savedCommonFirstNames = result.aiAgentSettings?.frontDeskBehavior?.commonFirstNames;
        logger.info('[FRONT DESK BEHAVIOR] 👤 CHECKPOINT: commonFirstNames SAVED TO MONGODB:', {
            companyId,
            count: (savedCommonFirstNames || []).length,
            sample: (savedCommonFirstNames || []).slice(0, 10),
            hasCommonFirstNames: !!savedCommonFirstNames
        });
        
        // Clear Redis cache
        try {
            const redis = require('../../config/redis');
            if (redis?.client) {
                await redis.client.del(`company:${companyId}`);
                await redis.client.del(`company:${companyId}:frontDeskBehavior`);
            }
        } catch (cacheErr) {
            logger.debug('[FRONT DESK BEHAVIOR] Cache clear failed (non-critical)');
        }
        
        res.json({
            success: true,
            message: 'Front Desk Behavior updated',
            data: result.aiAgentSettings?.frontDeskBehavior
        });
        
    } catch (error) {
        logger.error('[FRONT DESK BEHAVIOR] Update error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// POST - Reset to defaults
// ============================================================================
router.post('/:companyId/reset', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        const result = await v2Company.findByIdAndUpdate(
            companyId,
            { 
                $set: { 
                    'aiAgentSettings.frontDeskBehavior': {
                        enabled: true,
                        ...UI_DEFAULTS,
                        lastUpdated: new Date(),
                        updatedBy: req.user?.email || 'admin'
                    }
                }
            },
            { new: true }
        );
        
        if (!result) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }
        
        res.json({
            success: true,
            message: 'Reset to defaults',
            data: result.aiAgentSettings?.frontDeskBehavior
        });
        
    } catch (error) {
        logger.error('[FRONT DESK BEHAVIOR] Reset error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// POST - Test a phrase with FULL analysis and suggested response
// ============================================================================
router.post('/:companyId/test-emotion', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { phrase } = req.body;
        
        if (!phrase) {
            return res.status(400).json({ success: false, message: 'Phrase is required' });
        }
        
        const company = await v2Company.findById(companyId).lean();
        const config = company?.aiAgentSettings?.frontDeskBehavior || UI_DEFAULTS;
        
        const lowerPhrase = phrase.toLowerCase();
        
        // ════════════════════════════════════════════════════════════════════
        // 1. EMOTION DETECTION
        // ════════════════════════════════════════════════════════════════════
        const frustrationTriggers = config.frustrationTriggers || UI_DEFAULTS.frustrationTriggers;
        const matchedFrustration = frustrationTriggers.filter(t => lowerPhrase.includes(t.toLowerCase()));
        
        const escalationTriggers = config.escalation?.triggerPhrases || UI_DEFAULTS.escalation.triggerPhrases;
        const matchedEscalation = escalationTriggers.filter(t => lowerPhrase.includes(t.toLowerCase()));
        
        let detectedEmotion = 'neutral';
        if (matchedFrustration.length > 0) detectedEmotion = 'frustrated';
        if (matchedEscalation.length > 0) detectedEmotion = 'angry';
        
        // ════════════════════════════════════════════════════════════════════
        // 2. INTENT DETECTION - What does the caller want?
        // ════════════════════════════════════════════════════════════════════
        let detectedIntent = 'unknown';
        let intentKeywords = [];
        
        // Hours/Schedule questions
        if (/hours|open|close|available|when.*open|schedule/i.test(lowerPhrase)) {
            detectedIntent = 'hours_inquiry';
            intentKeywords = lowerPhrase.match(/hours|open|close|available|schedule/gi) || [];
        }
        // Pricing questions
        else if (/price|cost|how much|charge|fee|rate|estimate|quote/i.test(lowerPhrase)) {
            detectedIntent = 'pricing_inquiry';
            intentKeywords = lowerPhrase.match(/price|cost|how much|charge|fee|rate|estimate|quote/gi) || [];
        }
        // Service area questions
        else if (/service.*area|do you (service|cover|come to)|in my area|fort myers|naples|cape coral/i.test(lowerPhrase)) {
            detectedIntent = 'service_area';
            intentKeywords = lowerPhrase.match(/service|area|fort myers|naples|cape coral/gi) || [];
        }
        // Booking intent
        else if (/schedule|appointment|book|come out|send someone|technician|need service/i.test(lowerPhrase)) {
            detectedIntent = 'booking';
            intentKeywords = lowerPhrase.match(/schedule|appointment|book|come out|technician/gi) || [];
        }
        // Emergency
        else if (/emergency|urgent|right now|immediately|asap|leak|flood|no (heat|ac|air)/i.test(lowerPhrase)) {
            detectedIntent = 'emergency';
            intentKeywords = lowerPhrase.match(/emergency|urgent|leak|flood|no heat|no ac/gi) || [];
        }
        // General question
        else if (/\?$|what|how|why|can you|do you/i.test(lowerPhrase)) {
            detectedIntent = 'general_question';
        }
        
        // ════════════════════════════════════════════════════════════════════
        // 3. SUGGESTED RESPONSE - What should the AI say?
        // ════════════════════════════════════════════════════════════════════
        let suggestedResponse = '';
        let suggestion = '';
        let needsConfiguration = false;
        
        const inquiryResponses = config.inquiryResponses || UI_DEFAULTS.inquiryResponses || {};
        
        switch (detectedIntent) {
            case 'hours_inquiry':
                if (company?.businessHours) {
                    suggestedResponse = `Our office is open ${company.businessHours}. How can I help you today?`;
                } else {
                    suggestedResponse = "We're available Monday through Friday. Would you like to schedule a service?";
                    suggestion = "💡 Add business hours to Company Settings for automatic response";
                    needsConfiguration = true;
                }
                break;
                
            case 'pricing_inquiry':
                suggestedResponse = inquiryResponses.pricingInfo || 
                    "Pricing depends on the specific work needed. I'd be happy to get you a quote - may I have your name?";
                break;
                
            case 'service_area':
                const serviceAreaResponses = config.serviceAreaResponses || UI_DEFAULTS.serviceAreaResponses || {};
                suggestedResponse = serviceAreaResponses.confirm?.replace('{city}', 'your area') || 
                    "Yes, we service most of Southwest Florida! May I have your address to confirm?";
                break;
                
            case 'booking':
                const bookingPrompts = config.bookingPrompts || UI_DEFAULTS.bookingPrompts || {};
                suggestedResponse = `I can definitely help with that! ${bookingPrompts.askName || "May I have your name?"}`;
                break;
                
            case 'emergency':
                suggestedResponse = "I understand this is urgent. Let me get your information so we can send someone right away. What's your name and address?";
                break;
                
            case 'general_question':
                suggestedResponse = "I'd be happy to help! Let me get your information first - what's your name?";
                suggestion = "💡 Consider adding a specific response for this type of question in the Forbidden tab or creating a Triage Card";
                needsConfiguration = true;
                break;
                
            default:
                suggestedResponse = "I can help you with that! May I have your name to get started?";
                suggestion = "💡 This phrase didn't match any known patterns. Consider adding it to a Scenario or Triage Card.";
                needsConfiguration = true;
        }
        
        // ════════════════════════════════════════════════════════════════════
        // 4. RESPONSE
        // ════════════════════════════════════════════════════════════════════
        const emotionConfig = config.emotionResponses?.[detectedEmotion] || {};
        
        res.json({
            success: true,
            data: {
                phrase,
                // Emotion analysis
                detectedEmotion,
                matchedFrustration,
                matchedEscalation,
                // Intent analysis
                detectedIntent,
                intentKeywords,
                // What AI would say
                suggestedResponse,
                suggestion,
                needsConfiguration,
                // Emotion-specific behavior
                wouldAcknowledge: (emotionConfig.acknowledgments || []).length > 0,
                sampleAcknowledgment: (emotionConfig.acknowledgments || [])[0] || null,
                followUp: emotionConfig.followUp || '',
                reduceFriction: emotionConfig.reduceFriction || false,
                offerEscalation: emotionConfig.offerEscalation || false
            }
        });
        
    } catch (error) {
        logger.error('[FRONT DESK BEHAVIOR] Test emotion error:', error);
        res.status(500).json({ success: false, message: error.message });
    }
});

// ============================================================================
// HELPER: Deep merge objects
// ============================================================================
function deepMerge(target, source) {
    const result = { ...target };
    
    for (const key of Object.keys(source)) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(result[key] || {}, source[key]);
        } else if (source[key] !== undefined) {
            result[key] = source[key];
        }
    }
    
    return result;
}

module.exports = router;

