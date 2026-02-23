/**
 * DefaultCallPreset.js
 * ☢️ NUKED Feb 22, 2026: Renamed from DefaultFrontDeskPreset.js
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
// promptPacks REMOVED Jan 2026 - nuked

// ═══════════════════════════════════════════════════════════════════════════
// V110: SLOT REGISTRY - SINGLE SOURCE OF TRUTH FOR ALL SLOTS
// ═══════════════════════════════════════════════════════════════════════════
// Both Discovery and Booking flows reference slots by ID from this registry.
// If a slot isn't here, it doesn't exist at runtime.
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_SLOT_REGISTRY = {
    version: 'v1',
    slots: [
        // ═══════════════════════════════════════════════════════════════════════════
        // CORE BOOKING SLOTS - IDs MUST match what SlotExtractor produces
        // These are auto-populated for all companies. Admins customize labels/prompts.
        // ═══════════════════════════════════════════════════════════════════════════
        {
            id: 'name',  // CANONICAL: matches SlotExtractor output
            type: 'name_first',
            label: 'First Name',
            required: true,
            discoveryFillAllowed: true,
            bookingConfirmRequired: true,
            extraction: { 
                source: ['utterance'], 
                useFirstNameList: true,
                confidenceMin: 0.72
            },
            // ═══════════════════════════════════════════════════════════════
            // V118: NAME EXTRACTION POLICY — UI-truth for how names are parsed
            // ═══════════════════════════════════════════════════════════════
            // This is NOT a confidence booster. This defines the EXTRACTION
            // CONTRACT: what the extractor MUST do before it even looks at
            // the name lists. The lists score AFTER extraction.
            // ═══════════════════════════════════════════════════════════════
            nameExtractionPolicy: {
                singleTokenOnly: true,              // Only accept ONE word as the name
                candidateStrategy: 'rightmost_token', // Take rightmost viable word
                stripPhrases: [
                    "that's", "thats", "its", "it's", "my", "first", "name", "is",
                    "yeah", "yes", "yep", "sure", "ok", "okay", "um", "uh", "well",
                    "so", "actually", "i'm", "call me", "the"
                ],
                stripLeadingPunctuation: true,      // Remove leading , . ; : etc.
                stripTrailingPunctuation: true,      // Remove trailing . , ! ? etc.
                minLength: 2,                        // Reject tokens shorter than 2 chars
                maxLength: 25,                       // Reject tokens longer than 25 chars
                mustBeAlpha: true,                   // Only letters, hyphens, apostrophes
                rejectIfStopWord: true               // Hard-reject affirmations as names
            }
        },
        {
            id: 'lastName',  // CANONICAL: matches SlotExtractor output
            type: 'name_last',
            label: 'Last Name',
            required: false,
            discoveryFillAllowed: true,
            bookingConfirmRequired: true,
            extraction: { 
                source: ['utterance'],
                confidenceMin: 0.72
            },
            // V118: Same extraction policy as firstName (see above for docs)
            nameExtractionPolicy: {
                singleTokenOnly: true,
                candidateStrategy: 'rightmost_token',
                stripPhrases: [
                    "that's", "thats", "its", "it's", "my", "last", "name", "is",
                    "yeah", "yes", "yep", "sure", "ok", "okay", "um", "uh", "well",
                    "so", "actually", "the"
                ],
                stripLeadingPunctuation: true,
                stripTrailingPunctuation: true,
                minLength: 2,
                maxLength: 25,
                mustBeAlpha: true,
                rejectIfStopWord: true
            }
        },
        {
            id: 'phone',  // CANONICAL: matches SlotExtractor output
            type: 'phone',
            label: 'Best Callback Cell',
            required: true,
            discoveryFillAllowed: true,
            bookingConfirmRequired: true,
            extraction: { 
                source: ['caller_id', 'utterance'],
                confidenceMin: 0.65
            }
        },
        {
            id: 'address',  // CANONICAL: matches SlotExtractor output
            type: 'address',
            label: 'Service Address',
            required: true,
            discoveryFillAllowed: true,
            bookingConfirmRequired: true,
            extraction: { 
                source: ['utterance'],
                confidenceMin: 0.70
            },
            addressPolicy: {
                defaultState: 'FL',
                requireCityIfMissing: true,
                requireUnitIfMultiUnit: true,
                geoVerifyEnabled: true,
                unitDetectionKeywords: ['apt', 'apartment', 'unit', 'suite', '#', 'condo', 'bldg']
            }
        },
        {
            id: 'time',  // CANONICAL: matches SlotExtractor output
            type: 'time',
            label: 'Preferred Time',
            required: true,
            discoveryFillAllowed: false,  // Usually only asked during booking
            bookingConfirmRequired: true,
            extraction: { 
                source: ['utterance'],
                confidenceMin: 0.70
            },
            options: ['morning', 'afternoon']
        },
        // ═══════════════════════════════════════════════════════════════════════════
        // V115: CALL REASON DETAIL — Captured by triage, visible in discovery
        // ═══════════════════════════════════════════════════════════════════════════
        // This slot is populated by TriageEngineRouter (not manually extracted).
        // It's the structured "why are you calling?" fact that drives routing
        // and response quality. Without this, triage is a hidden classifier.
        // ═══════════════════════════════════════════════════════════════════════════
        {
            id: 'call_reason_detail',
            type: 'text',
            label: 'Reason for Call',
            required: false,
            discoveryFillAllowed: true,
            bookingConfirmRequired: false,  // Don't re-ask — just acknowledge
            // V119: Write policy — write-once on Turn 1, append on later turns.
            // Confirming long free-text is annoying and creates loops.
            // DiscoveryTruthWriter enforces this; confirmMode: 'never' in discoveryFlow.
            writePolicy: 'write_once_append',
            extraction: {
                source: ['utterance', 'triage', 'discovery_truth'],  // Prefer direct utterance, then triage/truth enrichments
                confidenceMin: 0.40  // Lower threshold — any symptom is useful
            }
        }
    ]
};

// ═══════════════════════════════════════════════════════════════════════════
// V110: DISCOVERY FLOW - Steps for extracting/confirming slots BEFORE booking
// ═══════════════════════════════════════════════════════════════════════════
// Discovery captures slots passively from conversation. When booking starts,
// captured values are promoted and confirmed (not re-asked).
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_DISCOVERY_FLOW = {
    version: 'v1',
    enabled: true,
    steps: [
        // ═══════════════════════════════════════════════════════════════════════════
        // V115: Reason for Call — captured FIRST (caller states problem on Turn 1)
        // Filled by TriageEngineRouter automatically. NEVER confirm — just acknowledge.
        // Confirming a sentence like "AC not cooling and leaking" is awkward,
        // slows calls, and creates reprompt loops. Agent acknowledges in response instead.
        // ═══════════════════════════════════════════════════════════════════════════
        {
            stepId: 'd0',
            slotId: 'call_reason_detail',
            order: 0,
            ask: "Got it.",
            reprompt: "What can I help you with today?",
            repromptVariants: [
                "What can I help you with today?",
                "What seems to be the issue?",
                "What problem are you having today?"
            ],
            confirmMode: 'never'
        },
        { 
            stepId: 'd1', 
            slotId: 'name',  // CANONICAL: matches SlotExtractor
            order: 1,
            // V117: When name is missing, ask directly (no {value} placeholders).
            askMissing: "What's your first name?",
            repromptMissing: "Sorry — what's your first name?",
            // V110: Confirm prompt uses {value} placeholder for captured value
            ask: "Got it — I have your first name as {value}. Is that right?", 
            reprompt: "Did I get your first name right?",
            repromptVariants: [
                "Did I get your first name right?",
                "Was that your first name?",
                "Is that correct?"
            ],
            confirmMode: 'smart_if_captured'
        },
        { 
            stepId: 'd2', 
            slotId: 'phone',  // CANONICAL: matches SlotExtractor
            order: 2,
            // V116: Human-like discovery phone prompt — don't read back the full number.
            // A real receptionist would just ask casually about the calling number.
            ask: "And is the number you're calling from a good one to reach you if we get disconnected?",
            askVariants: [
                "And is the number you're calling from a good one to reach you if we get disconnected?",
                "Can we use this number you're calling from for callbacks and updates?",
                "Is this a good number to reach you at?"
            ],
            reprompt: "What's the best number to reach you?",
            repromptVariants: [
                "What's the best number to reach you?",
                "What number should we use for callbacks?",
                "What's a good number for text updates?"
            ],
            confirmMode: 'confirm_if_from_caller_id'
        },
        { 
            stepId: 'd3', 
            slotId: 'address',  // CANONICAL: matches SlotExtractor
            order: 3,
            // V117: When address is missing, ask directly (no {value} placeholders).
            askMissing: "What's the service address?",
            repromptMissing: "Sorry — what's the service address?",
            ask: "I have your address as {value}. Is that the service location?", 
            reprompt: "What's the service address?",
            repromptVariants: [
                "What's the service address?",
                "Where will we be going?",
                "What address?"
            ],
            confirmMode: 'smart_if_captured'
        }
    ]
};

// ═══════════════════════════════════════════════════════════════════════════
// V110: BOOKING FLOW - Steps for collecting/confirming all required slots
// ═══════════════════════════════════════════════════════════════════════════
// Booking flow confirms captured values first, then asks for missing slots.
// Never restarts if values were already captured in discovery.
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_BOOKING_FLOW = {
    version: 'v1',
    enabled: true,
    confirmCapturedFirst: true,  // Confirm discovery values before asking new
    steps: [
        { 
            stepId: 'b1', 
            slotId: 'name',  // CANONICAL: matches SlotExtractor
            order: 1,
            ask: "What's your first name?", 
            confirmPrompt: "Ok — I assume {value} is your first name, is that correct?",
            reprompt: "What's your first name?",
            repromptVariants: [
                "What's your first name?",
                "And your first name?",
                "Can I get your first name?"
            ],
            confirmRetryPrompt: "Is {value} your first name?",
            correctionPrompt: "No problem — what is your first name?"
        },
        { 
            stepId: 'b1b', 
            slotId: 'lastName',  // CANONICAL: matches SlotExtractor
            order: 2,
            ask: "And what's your last name?", 
            confirmPrompt: "I've got {value} as your last name. Is that right?",
            reprompt: "What's your last name?",
            repromptVariants: [
                "What's your last name?",
                "And your last name?",
                "Your last name?"
            ],
            confirmRetryPrompt: "Is {value} your last name?"
        },
        { 
            stepId: 'b2', 
            slotId: 'phone',  // CANONICAL: matches SlotExtractor
            order: 3,
            // V116: Human-like phone prompt — don't read back the full number from caller ID.
            // A real receptionist doesn't recite the number back — they just ask casually.
            ask: "And is this number you're calling from a good one for the technician to reach you?", 
            askVariants: [
                "And is this number you're calling from a good one for the technician to reach you?",
                "Can we use this number for text confirmations and updates?",
                "Is this the best number to reach you at?"
            ],
            confirmPrompt: "And can we use this number for callbacks and updates?",
            confirmPromptVariants: [
                "And can we use this number for callbacks and updates?",
                "Is this a good number to reach you at?",
                "Can the technician reach you at this number?"
            ],
            reprompt: "What's a good number to reach you?",
            repromptVariants: [
                "What's a good number to reach you?",
                "What number should we use for updates?",
                "Best number to reach you at?"
            ],
            confirmRetryPrompt: "Just making sure — is this the right number?",
            // V116: When phone is from caller_id, use casual language (don't read back number)
            callerIdPrompt: "And is the number you're calling from a good one for callbacks and text updates?",
            callerIdPromptVariants: [
                "And is the number you're calling from a good one for callbacks and text updates?",
                "Can we use this number you're calling from for the technician to reach you?",
                "Is this number good for confirmations and updates?"
            ]
        },
        { 
            stepId: 'b3', 
            slotId: 'address',  // CANONICAL: matches SlotExtractor
            order: 4,
            ask: "What's the full service address, including unit or suite if there is one?", 
            confirmPrompt: "I've got {value}. Is that the correct service address?",
            reprompt: "What's the service address?",
            repromptVariants: [
                "What's the service address?",
                "Where will the technician be going?",
                "What address should we come to?"
            ],
            confirmRetryPrompt: "Is {value} correct?",
            // V110: structuredSubflow for address breakdown - ALL prompts UI-configured
            structuredSubflow: {
                enabled: false,  // Disabled by default - enable when needed
                trigger: 'parse_incomplete_or_geo_ambiguous',
                sequence: ['street', 'city', 'unit'],
                prompts: {
                    'street': "What's the street address?",
                    'city': "And what city is that in?",
                    'unit': "If this is an apartment or unit, what's the number? Otherwise just say house."
                }
            }
        },
        { 
            stepId: 'b4', 
            slotId: 'time',  // CANONICAL: matches SlotExtractor
            order: 5,
            ask: "Do you prefer morning or afternoon? I can offer 8-10, 10-12, 12-2, or 2-4.", 
            confirmPrompt: "Perfect, {value} works. Is that right?",
            // V117: Reprompt MUST include windows too — otherwise the caller gives
            // a window ("8 to 10") and gets "Morning or afternoon?" which feels dumb
            reprompt: "We have 8-10, 10-12, 12-2, or 2-4. Which window works best?",
            repromptVariants: [
                "We have 8-10, 10-12, 12-2, or 2-4. Which works best?",
                "I can offer 8-10, 10-12, 12-2, or 2-4. What time works for you?",
                "Morning or afternoon? Our windows are 8-10, 10-12, 12-2, and 2-4."
            ],
            confirmRetryPrompt: "Is {value} a good time?"
        }
    ],
    completion: {
        reviewAndConfirm: true,
        confirmScript: "Perfect. I have {name} {lastName}, phone {phone}, address {address}, for {time}. Is that all correct?",
        confirmRetryPrompt: "Is all that information correct?",
        correctionPrompt: "What would you like to change?",
        onConfirm: 'finalize_booking_request'
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// V110: POLICIES - Name parsing, address handling, discovery→booking handoff
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_FLOW_POLICIES = {
    nameParsing: {
        useFirstNameList: true,
        confirmIfFirstNameDetected: true,
        // If caller says "no that's my last name" - move value and ask for first
        ifCallerSaysNoThatsMyLastName: { 
            moveValueTo: 'name.last', 
            thenAsk: 'name.first' 
        },
        acceptLastNameOnly: true
    },
    booking: {
        // When booking starts: confirm what we have, then ask what's missing
        whenBookingStarts: 'confirm_discovery_values_then_ask_missing',
        // CRITICAL: Never restart from scratch if we already have values
        neverRestartIfAlreadyCaptured: true
    },
    address: {
        defaultState: 'FL',
        requireCityIfMissing: true,
        requireUnitIfMultiUnit: true,
        geoVerifyEnabled: true,
        unitDetectionKeywords: ['apt', 'apartment', 'unit', 'suite', '#', 'condo', 'bldg', 'lot']
    }
};

// ═══════════════════════════════════════════════════════════════════════════
// UNIVERSAL BOOKING SLOTS PRESET (LEGACY - kept for backward compatibility)
// Use slotRegistry + bookingFlow instead
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
// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT SCHEDULING CONFIG (Phase 1: request_only mode)
// ═══════════════════════════════════════════════════════════════════════════
// This controls HOW time windows are offered to callers.
// Phase 1: request_only = UI-controlled windows, no calendar integration
// Phase 2: google_calendar = real-time availability from Google
// Phase 3: servicetitan = book through ServiceTitan API
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_SCHEDULING = {
    // Provider determines scheduling mode
    provider: 'request_only',  // Phase 1 default
    
    // Time windows to offer callers (used when provider=request_only)
    timeWindows: [
        { label: '8-10am', start: '08:00', end: '10:00' },
        { label: '10am-12pm', start: '10:00', end: '12:00' },
        { label: '12-2pm', start: '12:00', end: '14:00' },
        { label: '2-4pm', start: '14:00', end: '16:00' }
    ],
    
    // Prompts for time selection (UI-controlled)
    morningAfternoonPrompt: 'Do you prefer morning or afternoon?',
    timeWindowPrompt: 'What time works best for you? We have openings in the {windows}.',
    
    // Lead time requirements
    minLeadTimeHours: 2,  // Don't offer times less than 2 hours from now
    
    // Same-day booking
    allowSameDayBooking: true
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT BUSINESS HOURS
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_BUSINESS_HOURS = {
    monday: { open: '08:00', close: '17:00', closed: false },
    tuesday: { open: '08:00', close: '17:00', closed: false },
    wednesday: { open: '08:00', close: '17:00', closed: false },
    thursday: { open: '08:00', close: '17:00', closed: false },
    friday: { open: '08:00', close: '17:00', closed: false },
    saturday: { open: '09:00', close: '14:00', closed: false },
    sunday: { open: null, close: null, closed: true }
};

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
// V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
const DEFAULT_PROMPT_GUARDS = {
    missingPromptFallbackKey: 'booking:universal:guardrails:missing_prompt_fallback'
};

// DEFAULT_PROMPT_PACKS REMOVED Jan 2026 - nuked (static packs = maintenance overhead)

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT DIRECT INTENT PATTERNS (V107 - Secondary booking triggers)
// ═══════════════════════════════════════════════════════════════════════════
// These are ADDITIONAL patterns that bypass consent dialogs.
// Must resolve from companyConfig, NOT globalDefaults (or it shows 0 items on turn 1).
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_DIRECT_INTENT_PATTERNS = [
    'schedule', 'book', 'appointment', 'come out',
    'send someone', 'send somebody', 'get someone out', 'get somebody out',
    'need a tech', 'need someone out', 'dispatch', 'service call',
    // V107: "help" phrases - critical for real customer language
    'help me out', 'need help', 'somebody to help', 'someone to help'
];

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT DETECTION TRIGGERS (V106 - Critical for booking intent detection)
// ═══════════════════════════════════════════════════════════════════════════
// These phrases trigger booking mode when detected in caller speech.
// Without these, callers saying "get someone out" stay stuck in DISCOVERY.
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_DETECTION_TRIGGERS = {
    // Core booking intent phrases - what makes a caller want to BOOK
    // V107: Expanded to match how REAL HUMANS actually ask for service
    wantsBooking: [
        // Direct booking words
        'schedule', 'book', 'appointment', 'dispatch',
        // Service request phrases
        'technician', 'service call', 'service visit',
        // "Send/get someone" variations (normalized: somebody→someone in runtime)
        'send someone', 'send somebody', 'get someone', 'get somebody',
        'send a tech', 'get a tech', 'need someone', 'need somebody',
        // V107: "help me out" variations - EXTREMELY common in real calls
        'help me out', 'help me out here', 'need help', 'i need help',
        'need somebody to help', 'need someone to help',
        // V107: Full phrases that real customers say
        'i need somebody to help me out',
        'i need someone to help me out',
        'can you send someone',
        'can you send somebody',
        'can someone come out',
        'can a tech come out',
        // "Come out" variations
        'come out', 'come over', 'come by',
        // Urgency indicators (direct booking intent)
        'asap', 'right away', 'as soon as possible', 'today', 'emergency', 'urgent',
        // Action requests
        'fix it', 'repair it', 'look at it', 'check it out'
    ],
    // Trust concern detection
    trustConcern: [
        'can you do', 'can you handle', 'can you fix', 'are you able',
        'know what you\'re doing', 'qualified', 'sure you can',
        'is this going to work', 'you guys any good'
    ],
    // Caller feels ignored
    callerFeelsIgnored: [
        'you\'re not listening', 'didn\'t listen', 'you didn\'t hear',
        'you\'re ignoring', 'you don\'t get it', 'that\'s not what I said', 'you missed'
    ],
    // Refused to provide info
    refusedSlot: [
        'i don\'t want to', 'not going to give', 'don\'t want to share',
        'not comfortable', 'rather not'
    ],
    // Describing a problem (discovery, not booking yet)
    describingProblem: [
        'water leak', 'thermostat', 'not cooling', 'not cool',
        'won\'t turn', 'won\'t start', 'making noise', 'making sound',
        'smell', 'broken', 'not working', 'problem is', 'issue is'
    ]
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
    // promptPacks logic REMOVED Jan 2026
    
    logger.info('[ONBOARDING PRESET] Loading preset for trade:', {
        requestedTrade: tradeKey,
        normalizedKey,
        usingPreset: tradePreset.name || 'Universal'
    });
    
    return {
        // V110: NEW CANONICAL STRUCTURES - Enterprise slot/flow architecture
        slotRegistry: DEFAULT_SLOT_REGISTRY,
        discoveryFlow: DEFAULT_DISCOVERY_FLOW,
        bookingFlow: DEFAULT_BOOKING_FLOW,
        policies: DEFAULT_FLOW_POLICIES,
        
        // Core booking config (LEGACY - kept for backward compatibility)
        bookingSlots: tradePreset.bookingSlots || DEFAULT_BOOKING_SLOTS,
        
        // V110: Detection triggers - CRITICAL for booking intent detection
        // Without these, callers saying "get someone out" stay stuck in DISCOVERY
        // IMPORTANT: directIntentPatterns MUST be nested inside detectionTriggers, NOT at top level
        detectionTriggers: {
            ...(tradePreset.detectionTriggers || DEFAULT_DETECTION_TRIGGERS),
            // V110: directIntentPatterns MUST be here (canonical path: frontDesk.detectionTriggers.directIntentPatterns)
            // This is what the runtime reads from: aiAgentSettings.frontDeskBehavior.detectionTriggers.directIntentPatterns
            directIntentPatterns: DEFAULT_DIRECT_INTENT_PATTERNS
        },
        
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
        
        // Phase 1: Scheduling (request_only mode with UI-controlled time windows)
        scheduling: DEFAULT_SCHEDULING,
        
        // Business hours
        businessHours: DEFAULT_BUSINESS_HOURS,
        
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

        // promptPacks REMOVED Jan 2026

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
    // V110: NEW CANONICAL STRUCTURES
    DEFAULT_SLOT_REGISTRY,
    DEFAULT_DISCOVERY_FLOW,
    DEFAULT_BOOKING_FLOW,
    DEFAULT_FLOW_POLICIES,
    // Legacy (kept for backward compatibility)
    DEFAULT_BOOKING_SLOTS,
    DEFAULT_DETECTION_TRIGGERS,  // V106: Critical for booking intent detection
    DEFAULT_DIRECT_INTENT_PATTERNS,  // V107: Must resolve from companyConfig
    DEFAULT_GREETING_RESPONSES,
    DEFAULT_FALLBACK_RESPONSES,
    DEFAULT_LOOP_PREVENTION,
    DEFAULT_BOOKING_OUTCOME,
    DEFAULT_ESCALATION,
    DEFAULT_SCHEDULING,
    DEFAULT_BUSINESS_HOURS,
    DEFAULT_UNIT_OF_WORK,
    DEFAULT_DISCOVERY_CONSENT,
    DEFAULT_NAME_SPELLING_VARIANTS,
    DEFAULT_ACCESS_FLOW,
    DEFAULT_SERVICE_FLOW,
    DEFAULT_BOOKING_PROMPTS_MAP,
    DEFAULT_PROMPT_GUARDS,
    // DEFAULT_PROMPT_PACKS REMOVED Jan 2026
    DEFAULT_OFF_RAILS_RECOVERY,
    DEFAULT_BOOKING_INTERRUPTION,
    TRADE_PRESETS
};

