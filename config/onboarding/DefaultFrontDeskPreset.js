/**
 * DefaultFrontDeskPreset.js
 * V59: COMPREHENSIVE preset for new company onboarding
 * 
 * PHILOSOPHY (per memory 12148303):
 * - NO hardcoded fallbacks in runtime code
 * - ALL AI behavior visible and configurable in UI
 * - This preset seeds COMPLETE config on company creation
 * - If a field is empty at runtime, LOG ERROR (don't silently fallback)
 * 
 * TRADE-SPECIFIC PRESETS:
 * - HVAC, Plumbing, Electrical, Dental, Legal, etc.
 * - Each has appropriate questions and tone
 * - Selected during onboarding based on trade key
 */

const logger = require('../../utils/logger');
const { getPromptPackRegistry } = require('../promptPacks');

// ═══════════════════════════════════════════════════════════════════════════
// UNIVERSAL BOOKING SLOTS PRESET
// Every new company gets these - customize after onboarding
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_BOOKING_SLOTS = [
    {
        id: 'name',
        slotId: 'name',
        label: 'Customer Name',
        type: 'name',
        question: 'May I have your name, please?',
        required: true,
        order: 0,
        enabled: true,
        confirmBack: true,
        // ─────────────────────────────────────────────────────────────
        // V59: ALL name-related questions - NO FALLBACKS IN RUNTIME
        // ─────────────────────────────────────────────────────────────
        askFullName: true,
        useFirstNameOnly: false,
        askMissingNamePart: true,
        firstNameQuestion: "And what's your first name?",
        lastNameQuestion: "And what's your last name?",
        // V85: Duplicate/unclear last-name recovery prompt (UI-controlled)
        // Fired when caller repeats first name as last name (common nervous mistake).
        // Placeholders: {firstName}, {candidate}, {lastNameQuestion}
        duplicateNamePartPrompt: "I just want to make sure I get this right — I have your first name as {firstName}, and I heard {candidate} for your last name. {lastNameQuestion}",
        // Spelling variant handling (Marc vs Mark)
        // V61: CORRECT FIELD NAME - confirmSpelling is what ConversationEngine checks
        confirmSpelling: true,
        spellingVariantPrompt: "Is that {name} with a {variant1} or {variant2}?",
        // Reprompts if user is unclear
        repromptVariants: [
            "I didn't quite catch that. What's your name?",
            "Sorry, could you repeat your name for me?"
        ]
    },
    {
        id: 'phone',
        slotId: 'phone',
        label: 'Phone Number',
        type: 'phone',
        question: "What's the best phone number to reach you?",
        required: true,
        order: 1,
        enabled: true,
        confirmBack: true,
        confirmPrompt: "Just to confirm, that's {value}, correct?",
        // ─────────────────────────────────────────────────────────────
        // V59: ALL phone-related questions - NO FALLBACKS IN RUNTIME
        // ─────────────────────────────────────────────────────────────
        offerCallerId: true,
        callerIdPrompt: "I see you're calling from {callerId} — is that a good number for text confirmations, or would you prefer a different one?",
        callerIdAcceptPhrases: ['yes', 'yeah', 'that works', 'sure', 'correct', "that's fine", 'yep'],
        callerIdDeclinePhrases: ['no', 'different', 'another', 'not that one', 'use a different'],
        // Breakdown prompts for unclear input
        breakDownIfUnclear: true,
        areaCodePrompt: "What's the area code?",
        restOfNumberPrompt: "And the rest of the number?",
        // Validation
        validateFormat: true,
        invalidPhonePrompt: "That doesn't look like a valid phone number. Could you try again?",
        // Reprompts
        repromptVariants: [
            "I didn't catch that. What's a good callback number?",
            "Sorry, could you repeat that phone number?"
        ]
    },
    {
        id: 'address',
        slotId: 'address',
        label: 'Service Address',
        type: 'address',
        question: "What's the address for the service?",
        required: true,
        order: 2,
        enabled: true,
        confirmBack: true,
        confirmPrompt: "Got it, that's {value}. Is that correct?",
        // ─────────────────────────────────────────────────────────────
        // V59: ALL address-related questions - NO FALLBACKS IN RUNTIME
        // ─────────────────────────────────────────────────────────────
        addressConfirmLevel: 'street_city', // street_only, street_city, full
        acceptPartialAddress: true,
        partialAddressPrompt: "I got part of that. Can you give me the full address including city?",
        // Breakdown prompts
        breakDownIfUnclear: true,
        streetBreakdownPrompt: "What's the street address?",
        cityPrompt: "And what city is that in?",
        zipPrompt: "Do you know the zip code?",
        // Reprompts
        repromptVariants: [
            "I didn't quite get the address. Could you repeat it?",
            "Sorry, where will the technician be going?"
        ]
    },
    {
        id: 'time',
        slotId: 'time',
        label: 'Preferred Time',
        type: 'datetime',
        question: "When would be a good time for the technician to come out?",
        required: true,
        order: 3,
        enabled: true,
        confirmBack: true,
        confirmPrompt: "So you're looking at {value}. Does that work?",
        // ─────────────────────────────────────────────────────────────
        // V59: Time-related questions
        // ─────────────────────────────────────────────────────────────
        acceptFlexible: true,
        flexiblePhrases: ['whenever', 'asap', 'as soon as possible', 'any time', 'flexible'],
        flexibleResponse: "Got it, I'll mark you down as flexible. We'll reach out with available times.",
        // Reprompts
        repromptVariants: [
            "When works best for you?",
            "What time frame are you looking at?"
        ]
    }
];

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT GREETING RESPONSES
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_GREETING_RESPONSES = {
    morning: "Good morning! How can I help you today?",
    afternoon: "Good afternoon! How can I help you today?",
    evening: "Good evening! How can I help you today?",
    generic: "Hello! How can I help you today?",
    // Casual greetings
    casual: {
        hi: "Hi there! How can I help you?",
        hey: "Hey! What can I do for you today?",
        hello: "Hello! How can I help you today?"
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT FALLBACK RESPONSES
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_FALLBACK_RESPONSES = {
    generic: "I'm sorry, I didn't quite catch that. Could you say that again?",
    lowConfidence: "I want to make sure I understand correctly. Could you rephrase that?",
    offTopic: "I'm here to help with scheduling and service questions. Is there something specific I can help you with?",
    noScenario: "Let me make sure I can help with that. Could you tell me more about what you need?",
    engineFailure: "I apologize for the technical difficulty. Let me connect you with someone who can help.",
    silenceResponse: "Are you still there? I'm happy to help whenever you're ready."
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT LOOP PREVENTION
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_LOOP_PREVENTION = {
    enabled: true,
    maxSameQuestion: 2,
    rephraseIntro: "Let me try this differently — ",
    escalationThreshold: 3,
    escalationScript: "No problem. If you'd rather, I can transfer you to a service advisor to help get you booked.",
    // V54: Slot-specific nudge prompts
    nudgeNamePrompt: "I just need your name to get started.",
    nudgePhonePrompt: "I just need a good number to reach you at.",
    nudgeAddressPrompt: "I just need the service address."
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT BOOKING OUTCOME SCRIPTS
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_BOOKING_OUTCOME = {
    mode: 'confirmed_on_call',
    scripts: {
        confirmed_on_call: "Perfect! You're all set. A technician will be out {time}. Is there anything else I can help with?",
        callback_promised: "Great! We'll call you back shortly to confirm the appointment. Is there anything else?",
        estimate_first: "Wonderful! Someone will reach out with an estimate, and then we'll get you scheduled. Anything else?",
        message_taken: "Got it! I've taken down your information. Someone will be in touch soon. Is there anything else?"
    },
    // ASAP variants
    asapVariants: {
        confirmed_on_call: "Perfect! You're all set. We'll have a technician out as soon as possible. Is there anything else?",
        callback_promised: "Great! We'll call you back shortly with the first available time. Anything else?"
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT OFF-RAILS RECOVERY (Enterprise)
// ═══════════════════════════════════════════════════════════════════════════
// NOTE: This is protocol-level text (not trade-specific) and is fully editable in UI.
const DEFAULT_OFF_RAILS_RECOVERY = {
    enabled: true,
    bridgeBack: {
        enabled: true,
        transitionPhrase: "Now,",
        maxRecoveryAttempts: 3,
        // V77: Resume Booking Protocol (recap + resume slot)
        resumeBooking: {
            enabled: true,
            includeValues: false,
            template: "Okay — back to booking. I have {collectedSummary}. {nextQuestion}",
            collectedItemTemplate: "{label}",
            collectedItemTemplateWithValue: "{label}: {value}",
            separator: ", ",
            finalSeparator: " and "
        },
        // V92: Booking Clarification (meta questions during slot collection)
        // Example user input: "is that what you want" / "what do you mean"
        // This is NOT a trade Q&A and should NOT go to scenarios.
        // It should clarify what field we need, then immediately re-ask the exact slot question.
        clarification: {
            enabled: true,
            // Phrases that indicate caller is asking for clarification about what we want them to say
            // (Keep these fairly specific to avoid accidentally firing on normal speech.)
            triggers: [
                "is that what you want",
                "is that what you need",
                "what do you want",
                "what do you need",
                "what do you mean",
                "can you explain",
                "sorry what do you mean"
            ],
            // Placeholders: {nextQuestion}, {nextSlotLabel}
            template: "No problem — {nextQuestion}"
        }
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT BOOKING INTERRUPTION BEHAVIOR (UI Controlled)
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_BOOKING_INTERRUPTION = {
    enabled: true,
    oneSlotPerTurn: true,
    forceReturnToQuestionAsLastLine: true,
    allowEmpathyLanguage: false,
    maxSentences: 2,
    shortClarificationPatterns: [
        'mark?',
        'yes?',
        'hello?',
        'what?'
    ]
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT ESCALATION CONFIG
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_ESCALATION = {
    enabled: true,
    triggers: ['talk to someone', 'speak to a person', 'real person', 'human', 'transfer me', 'manager', 'supervisor'],
    transferMessage: "Absolutely, one moment while I transfer you to our team.",
    noAgentAvailableMessage: "I apologize, but no one is available right now. Can I take a message and have someone call you back?"
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT UNIT OF WORK PROMPTS (Multi-location booking)
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_UNIT_OF_WORK = {
    enabled: false,
    maxUnits: 3,
    labelSingular: 'Job',
    labelPlural: 'Jobs',
    askAddAnotherPrompt: "Is this for just this location, or do you have another location to add today?",
    clarifyPrompt: "Just to confirm — do you have another location or job to add today?",
    nextUnitIntro: "Okay — let's get the details for the next one.",
    finalScriptMulti: "Perfect — I've got both locations. Our team will take it from here.",
    yesWords: ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'correct', 'another', 'one more'],
    noWords: ['no', 'nope', 'nah', 'just this', 'only this', "that's it", 'all set']
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT NAME SPELLING VARIANTS
// V61: Global config for spelling variant detection (Marc vs Mark)
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_NAME_SPELLING_VARIANTS = {
    enabled: true,  // Master toggle - ENABLED by default for enterprise quality
    source: 'auto_scan', // Auto-detect variants from commonFirstNames list
    checkMode: '1_char_only', // Only ask if 1 character difference (Mark/Marc, Brian/Bryan)
    maxAsksPerCall: 1, // Only ask once per call to avoid annoying caller
    // Pre-built variant pairs (backup if auto_scan misses any)
    variantGroups: [
        { base: 'Mark', variants: ['Marc'] },
        { base: 'Brian', variants: ['Bryan', 'Bryon'] },
        { base: 'Eric', variants: ['Erik'] },
        { base: 'Steven', variants: ['Stephen'] },
        { base: 'Sara', variants: ['Sarah'] },
        { base: 'John', variants: ['Jon'] },
        { base: 'Kristina', variants: ['Christina'] },
        { base: 'Catherine', variants: ['Katherine', 'Kathryn'] },
        { base: 'Philip', variants: ['Phillip'] },
        { base: 'Jeffrey', variants: ['Geoffrey'] },
        { base: 'Allan', variants: ['Alan', 'Allen'] },
        { base: 'Anne', variants: ['Ann'] }
    ]
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT ACCESS FLOW (Property Type + Gated Access)
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_ACCESS_FLOW = {
    enabled: false,
    tradeApplicability: ['hvac', 'plumbing', 'electrical', 'pest', 'carpet'],
    propertyTypeEnabled: true,
    propertyTypeQuestion: 'Is that a house, condo, apartment, or commercial property?',
    unitQuestion: "Got it. What's the unit number?",
    commercialUnitQuestion: 'Got it. Is that a suite or floor number?',
    accessInstructionsQuestion: 'Do we need a gate code, elevator access, or should we just knock?',
    gatedQuestion: "Thanks. One quick thing so the technician can get in — is that inside a gated community, or is it open access?",
    openAccessFollowupQuestion: 'Got it. Any gate code, building code, or special access we should know about, or just pull up and knock?',
    gateAccessTypeQuestion: 'Perfect. Do you have a gate code, a gate guard, or both?',
    gateCodeQuestion: 'Great, what gate code should the technician use?',
    gateGuardNotifyPrompt: "No problem. Since there’s a gate guard, please let them know {companyName} will be coming during your appointment window so they’ll let our technician in without delays.",
    gateGuardConfirmPrompt: "Perfect. I’ll note that the gate guard has been notified for {companyName}.",
    maxPropertyTypeFollowUps: 1,
    maxUnitFollowUps: 1,
    maxAccessFollowUps: 2
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT SERVICE FLOW (Service-call consent + triage)
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_SERVICE_FLOW = {
    mode: 'hybrid',
    empathyEnabled: false,
    trades: [],
    promptKeysByTrade: {}
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT BOOKING PROMPTS MAP (UI-managed prompt library)
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_BOOKING_PROMPTS_MAP = {};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT PROMPT GUARDS (runtime safety)
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_PROMPT_GUARDS = {
    missingPromptFallbackKey: 'booking.universal.guardrails.missing_prompt_fallback'
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT PROMPT PACK SELECTION (explicit; no magic defaults)
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_PROMPT_PACKS = {
    enabled: true,
    selectedByTrade: {
        universal: 'universal_v1'
    },
    migration: {
        status: 'not_started',
        appliedAt: null,
        appliedBy: null,
        notes: null,
        migratedKeysCount: 0,
        conflictsCount: 0,
        legacyKeysRemaining: 0
    },
    history: []
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT DISCOVERY & CONSENT
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_DISCOVERY_CONSENT = {
    bookingRequiresExplicitConsent: false,
    consentPhrases: [
        'schedule', 'book', 'appointment', 'come out', 'send someone',
        "let's do it", "let's schedule", 'yes please', 'sounds good'
    ],
    persistConsent: true,
    lockModeAfterConsent: true,
    extractIssuesDuringDiscovery: true,
    passIssuesToBooking: true,
    // Kill switches (should be OFF for normal operation)
    forceLLMDiscovery: false,
    disableScenarioAutoResponses: false,
    // Booking intent detection
    bookingIntentPhrases: [
        'schedule', 'appointment', 'book', 'service', 'come out',
        'someone to come', 'technician', 'repair', 'maintenance', 'installation'
    ]
};

// ═══════════════════════════════════════════════════════════════════════════
// TRADE-SPECIFIC PRESETS
// ═══════════════════════════════════════════════════════════════════════════
const TRADE_PRESETS = {
    hvac: {
        name: 'HVAC',
        bookingSlots: DEFAULT_BOOKING_SLOTS.map(slot => {
            if (slot.id === 'time') {
                return { ...slot, question: "When would be a good time for the technician to come take a look?" };
            }
            return slot;
        }),
        greetingResponses: {
            ...DEFAULT_GREETING_RESPONSES,
            // HVAC-specific casual greetings could go here
        }
    },
    plumbing: {
        name: 'Plumbing',
        bookingSlots: DEFAULT_BOOKING_SLOTS.map(slot => {
            if (slot.id === 'time') {
                return { ...slot, question: "When would be a good time for the plumber to come out?" };
            }
            return slot;
        })
    },
    electrical: {
        name: 'Electrical',
        bookingSlots: DEFAULT_BOOKING_SLOTS.map(slot => {
            if (slot.id === 'time') {
                return { ...slot, question: "When would be a good time for the electrician to come by?" };
            }
            return slot;
        })
    },
    dental: {
        name: 'Dental',
        bookingSlots: DEFAULT_BOOKING_SLOTS.map(slot => {
            if (slot.id === 'address') {
                // Dental doesn't need address (patients come to office)
                return { ...slot, required: false, enabled: false };
            }
            if (slot.id === 'time') {
                return { ...slot, question: "What day and time works best for your appointment?" };
            }
            return slot;
        })
    },
    legal: {
        name: 'Legal',
        bookingSlots: DEFAULT_BOOKING_SLOTS.map(slot => {
            if (slot.id === 'address') {
                return { ...slot, required: false, enabled: false };
            }
            if (slot.id === 'time') {
                return { ...slot, question: "When would you like to schedule your consultation?" };
            }
            return slot;
        })
    },
    universal: {
        name: 'Universal',
        bookingSlots: DEFAULT_BOOKING_SLOTS
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN EXPORT: Get complete preset for a trade
// ═══════════════════════════════════════════════════════════════════════════
function getPresetForTrade(tradeKey = 'universal') {
    const normalizedKey = (tradeKey || 'universal').toLowerCase().trim();
    const tradePreset = TRADE_PRESETS[normalizedKey] || TRADE_PRESETS.universal;
    const promptPackRegistry = getPromptPackRegistry();
    const promptPackSelections = { ...DEFAULT_PROMPT_PACKS.selectedByTrade };
    const tradePackOptions = promptPackRegistry.byTrade?.[normalizedKey] || [];
    if (tradePackOptions.length > 0) {
        promptPackSelections[normalizedKey] = tradePackOptions[0];
    }
    
    logger.info('[ONBOARDING PRESET] Loading preset for trade:', {
        requestedTrade: tradeKey,
        normalizedKey,
        usingPreset: tradePreset.name || 'Universal'
    });
    
    return {
        // Core booking config
        bookingSlots: tradePreset.bookingSlots || DEFAULT_BOOKING_SLOTS,
        
        // Greeting responses
        greetingResponses: tradePreset.greetingResponses || DEFAULT_GREETING_RESPONSES,
        
        // Fallback responses
        fallbackResponses: DEFAULT_FALLBACK_RESPONSES,
        
        // Loop prevention
        loopPrevention: DEFAULT_LOOP_PREVENTION,
        
        // Booking outcome
        bookingOutcome: DEFAULT_BOOKING_OUTCOME,
        
        // Escalation
        escalation: DEFAULT_ESCALATION,
        
        // Unit of work
        unitOfWork: DEFAULT_UNIT_OF_WORK,
        
        // Discovery & consent
        discoveryConsent: DEFAULT_DISCOVERY_CONSENT,
        
        // V61: Name spelling variants (global config)
        nameSpellingVariants: DEFAULT_NAME_SPELLING_VARIANTS,

        // Access flow (property type + gated access)
        accessFlow: DEFAULT_ACCESS_FLOW,

        // Service flow (existing unit service)
        serviceFlow: DEFAULT_SERVICE_FLOW,

        // Prompt library (per-company)
        bookingPromptsMap: DEFAULT_BOOKING_PROMPTS_MAP,

        // Prompt guardrails
        promptGuards: DEFAULT_PROMPT_GUARDS,

        // Prompt packs (explicit defaults)
        promptPacks: {
            ...DEFAULT_PROMPT_PACKS,
            selectedByTrade: promptPackSelections
        },

        // V77: Off-rails recovery protocol (resume booking after interrupts)
        offRailsRecovery: DEFAULT_OFF_RAILS_RECOVERY,

        // Booking interruption behavior (slot-safe)
        bookingInterruption: DEFAULT_BOOKING_INTERRUPTION,
        
        // Personality (trade-aware)
        personality: {
            conversationStyle: 'balanced',
            agentName: null, // Set during onboarding
            tone: 'professional_friendly',
            // V79: Style depth controls (UI controlled)
            warmth: 0.6,
            speakingPace: 'normal'
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// Export individual defaults for schema defaults
// ═══════════════════════════════════════════════════════════════════════════
module.exports = {
    getPresetForTrade,
    DEFAULT_BOOKING_SLOTS,
    DEFAULT_GREETING_RESPONSES,
    DEFAULT_FALLBACK_RESPONSES,
    DEFAULT_LOOP_PREVENTION,
    DEFAULT_BOOKING_OUTCOME,
    DEFAULT_ESCALATION,
    DEFAULT_UNIT_OF_WORK,
    DEFAULT_DISCOVERY_CONSENT,
    DEFAULT_NAME_SPELLING_VARIANTS,
    DEFAULT_ACCESS_FLOW,
    DEFAULT_SERVICE_FLOW,
    DEFAULT_BOOKING_PROMPTS_MAP,
    DEFAULT_PROMPT_GUARDS,
    DEFAULT_PROMPT_PACKS,
    DEFAULT_OFF_RAILS_RECOVERY,
    DEFAULT_BOOKING_INTERRUPTION,
    TRADE_PRESETS
};

