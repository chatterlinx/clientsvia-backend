/**
 * ============================================================================
 * CONVERSATION ENGINE - Unified AI Brain for ALL Channels
 * ============================================================================
 * 
 * This is THE SINGLE ENTRY POINT for all conversation processing.
 * Every channel (phone, SMS, website, test console) calls this engine.
 * 
 * WHAT THIS ENGINE DOES:
 * 1. Loads company config (RuntimeConfigLoader pattern)
 * 2. Gets/creates session (SessionService - MongoDB)
 * 3. Builds customer context (CustomerService)
 * 4. Builds running summary (RunningSummaryService)
 * 5. Extracts slots from user input (programmatic)
 * 6. Calls AI brain (HybridReceptionistLLM)
 * 7. Applies guards (forbidden phrases, phase rules)
 * 8. Saves turn to session
 * 9. Returns unified response
 * 
 * WHAT CHANNELS DO (adapters only):
 * - Phone: TwiML formatting, STT/TTS, Twilio callbacks
 * - Chat/Website: JSON formatting, debug payloads
 * - SMS: Plain text in/out
 * 
 * CRITICAL RULES:
 * - ALL AI behavior changes go HERE, never in channel routes
 * - Same persona, same prompts, same phase logic across channels
 * - If you're editing AI logic in v2twilio.js or chat.js, STOP - edit here
 * 
 * MULTI-TENANT: All operations require companyId for isolation.
 * 
 * ============================================================================
 */

const Company = require('../models/v2Company');
const BookingRequest = require('../models/BookingRequest');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const CustomerService = require('./CustomerService');
const CustomerContextLoader = require('./CustomerContextLoader');
const SessionService = require('./SessionService');
const RunningSummaryService = require('./RunningSummaryService');
const HybridReceptionistLLM = require('./HybridReceptionistLLM');
const BookingScriptEngine = require('./BookingScriptEngine');
const ResponseRenderer = require('./ResponseRenderer');
const LLMDiscoveryEngine = require('./LLMDiscoveryEngine');
const AddressValidationService = require('./AddressValidationService');
const DiscoveryExtractor = require('./engine/booking/DiscoveryExtractor');
// ☢️ NUKED Feb 2026: DynamicFlowEngine removed - V110 architecture replaces it
// const DynamicFlowEngine = require('./DynamicFlowEngine');
const GoogleCalendarService = require('./GoogleCalendarService');
const SMSNotificationService = require('./SMSNotificationService');
const PricingPolicyResponder = require('./pricing/PricingPolicyResponder');
const logger = require('../utils/logger');
const { parseSpellingVariantPrompt, parseSpellingVariantResponse } = require('../utils/nameSpellingVariant');
const { extractName: extractNameDeterministic, isTradeContextSentence } = require('../utils/nameExtraction');
const { isSuspiciousDuplicateName } = require('../utils/nameGuards');
const { normalizeCityStatePhrase, parseCityStatePhrase, combineAddressParts } = require('../utils/addressNormalization');
const {
    isAffirmative: isAffirmativeAccess,
    isNegative: isNegativeAccess,
    normalizePropertyType,
    parseGateAccessType,
    normalizeUnitValue,
    buildAccessSnapshot
} = require('../utils/accessFlow');
// V97f: buildResumeBookingBlock, detectBookingClarification NUKED - BookingFlowRunner handles
const { detectConfirmationRequest } = require('../utils/confirmationRequest');
const { findFirstMatchingRule, recordRuleFired } = require('../utils/slotMidCallRules');
const { classifyServiceUrgency } = require('../utils/serviceUrgency');
const { checkCompliance, buildComplianceSummary } = require('../utils/complianceChecker');
// PromptResolver REMOVED Jan 2026 - nuked (static packs = maintenance overhead)
const BlackBoxLogger = require('./BlackBoxLogger');
const AWConfigReader = require('./wiring/AWConfigReader');

// ═══════════════════════════════════════════════════════════════════════════
// V115 TRIAGE: Single entrypoint — TriageEngineRouter
// ═══════════════════════════════════════════════════════════════════════════
// RULE: No other triage import is allowed. If you see one, it's a bug.
// Gate: frontDesk.triage.enabled (per company)
// Old gate (returnLane.enabled) is NO LONGER consulted for triage.
// ═══════════════════════════════════════════════════════════════════════════
const TriageEngineRouter = require('../triage/TriageEngineRouter');

// V1 RETURN LANE - Post-Response Behavior System (separate from triage)
const ReturnLaneService = require('./ReturnLaneService');
// Legacy TriageService kept ONLY for ReturnLaneService card lookups (read-only)
const TriageService = require('./TriageService');

// ═══════════════════════════════════════════════════════════════════════════
// VERSION BANNER - Proves this code is deployed
// CHECK THIS IN DEBUG TO VERIFY DEPLOYMENT
// ═══════════════════════════════════════════════════════════════════════════
const ENGINE_VERSION = 'V115-TRIAGE-NUKE';  // <-- CHANGE THIS EACH DEPLOY

// ═══════════════════════════════════════════════════════════════════════════
// V92: NAME STOP WORDS - Words that are NEVER valid names (for acknowledgment check)
// ═══════════════════════════════════════════════════════════════════════════
const NAME_STOP_WORDS_ENGINE = new Set([
    'issues', 'issue', 'problem', 'problems', 'trouble', 'having', 'calling',
    'is', 'are', 'was', 'were', 'be', 'been', 'am', 'the', 'a', 'an',
    'yes', 'yeah', 'no', 'nope', 'okay', 'ok', 'sure', 'thanks', 'thank',
    'ready', 'done', 'right', 'correct', 'wrong', 'good', 'great', 'fine',
    'morning', 'afternoon', 'evening', 'night', 'today', 'tomorrow',
    'customer', 'client', 'homeowner', 'resident', 'tenant', 'owner'
]);
logger.info(`[CONVERSATION ENGINE] 🧠 LOADED VERSION: ${ENGINE_VERSION}`, {
    features: [
        '✅ V84.3: SCENARIO-FIRST ARCHITECTURE',
        '✅ Scenarios are PRIMARY BRAIN (LLM is fallback)',
        '✅ Tier 1: Direct scenario response (~50ms, $0)',
        '✅ Booking is DETERMINISTIC (consent-gated)',
        '✅ No triage gates, no pre-routing',
        '✅ V35: Google Maps address validation (toggle per company)',
        '✅ V35: World-class unit/apt detection (smart/always/never modes)',
        '✅ session.mode = DISCOVERY | SUPPORT | BOOKING | COMPLETE',
        '✅ Consent detection via UI-configured phrases',
        '✅ Latency target: < 1.2s per turn',
        '✅ V23: Cheat sheets REMOVED Feb 2026 - Tier 2 slot reserved for future rebuild',
        '✅ V24: COMPLETE mode lock - no re-asking slots after booking',
        '✅ V24: askFullName defaults FALSE (prompt as law)',
        '✅ V24: displayName uses first name, never lastName alone',
        '✅ V24: Slot state debug snapshot each turn',
        '✅ V25: FAST-PATH BOOKING - respects caller urgency',
        '✅ V25: "I need you out here" → immediate offer (no troubleshooting)',
        '✅ V25: UI-configurable trigger keywords + offer script',
        '✅ V25: Still requires explicit consent to enter BOOKING',
        '✅ V26: CALLER VOCABULARY - Translates industry slang',
        '✅ V26: "not pulling" → "not cooling" (HVAC)',
        '✅ V26: Uses template nlpConfig.synonyms + company callerVocabulary',
        '✅ V26: LLM receives translated text for better understanding',
        '✅ V27: NAME CONFIRM YES HANDLING - Fixed askFullName flow',
        '✅ V27: When user says "yes" to confirm Mark → asks for last name',
        '✅ V27: SLOT REFUSAL HANDLING - "I forgot", "I don\'t know"',
        '✅ V27: Alternative prompts, max retries, LLM intervention',
        '✅ V27: UI-configurable slotRefusalHandling settings',
        '✅ V31: DISCOVERY TURN LIMIT - Max 1 discovery turn before offer',
        '✅ V31: AUTO-OFFER after issue understood (no endless troubleshooting)',
        '✅ V31: PROMPT VARIANTS - Rotate phrasing to avoid repetition',
        '✅ V31: STATE SUMMARY to LLM - Prevents goldfish memory',
        '✅ V31: ANTI-LOOP BREAKER - Escalate after repeated failures',
        '✅ V34: VALUE BEATS META - If slot has value, it\'s complete',
        '✅ V34: isSlotComplete() helper functions for consistent checks',
        '✅ V34: ANTI-REPEAT GUARDRAIL - Never ask slot just extracted',
        '✅ V34: buildStateSummaryForLLM() for context awareness',
        '✅ V40: PHASE 1 - STATE + LOCKS (Deterministic Control Layer)',
        '✅ V40: session.locks = { greeted, issueCaptured, bookingStarted, bookingLocked, askedSlots }',
        '✅ V40: session.memory = { rollingSummary, facts, acknowledgedClaims }',
        '✅ V40: NO RE-GREET after Turn 1',
        '✅ V40: NO RE-ASK collected slots',
        '✅ V40: NO RESTART booking once started',
        '✅ V40: Rolling summary prevents goldfish memory',
        '✅ V40: PHASE 2 - BLACK BOX UNIFICATION',
        '✅ V40: Test Console calls → Black Box (source: test)',
        '✅ V40: SMS calls → Black Box (source: sms)',
        '✅ V40: Web chat → Black Box (source: web)',
        '✅ V40: Session snapshot (phase, mode, locks, memory) persisted each turn',
        '✅ V41: PHASE 3 - DYNAMIC FLOW ENGINE',
        '✅ V41: Trigger → Event → State → Action system',
        '✅ V41: Flow evaluation each turn',
        '✅ V41: Flow trace in Test Console + Black Box'
    ]
});

// ═══════════════════════════════════════════════════════════════════════════
// V31: PROMPT VARIANT POOLS - Rotate phrasing to sound natural
// ═══════════════════════════════════════════════════════════════════════════
// V36 NUKE: REMOVED ALL HARDCODED BOOKING PROMPTS
// ═══════════════════════════════════════════════════════════════════════════
// PROMPT AS LAW: All booking prompts MUST come from UI config:
//   V110: company.aiAgentSettings.frontDeskBehavior.bookingFlow.steps[].ask
//   V110: company.aiAgentSettings.frontDeskBehavior.bookingFlow.steps[].confirmPrompt
//   V110: company.aiAgentSettings.frontDeskBehavior.bookingFlow.steps[].repromptVariants
//
// These are ONLY used for discovery mode (before booking starts)
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_PROMPT_VARIANTS = {
    // Empathy variants for discovery (NOT booking prompts)
    empathy: [
        "I'm sorry to hear that.",
        "Sorry to hear that — let's get this sorted.",
        "I hear you — that sounds uncomfortable.",
        "Got it — we can definitely help with that."
    ],
    // Offer scheduling variants (NOT booking prompts - just offers)
    offerScheduling: [
        "Would you like me to schedule a technician?",
        "I can get someone out to you. Would you like to schedule?",
        "Want me to set up an appointment?",
        "Let me get you scheduled. Sound good?"
    ]
    // 🚫 NUKED: slots{} and reprompt{} - ALL booking prompts come from UI now
};

// ═══════════════════════════════════════════════════════════════════════════
// V92 FIX: URGENCY NORMALIZER
// ═══════════════════════════════════════════════════════════════════════════
// ConversationSession.discovery.urgency schema ONLY allows:
// ['normal', 'repeat_issue', 'urgent', 'emergency']
// 
// This normalizer prevents Mongoose ValidationError from crashing the turn:
// "discovery.urgency: `high` is not a valid enum value"
// 
// Real-world urgency synonyms handled:
// - EMERGENCY: 'emergency', 'critical', 'life_threatening', 'danger'
// - URGENT: 'high', 'asap', 'soon', 'important', 'priority'
// - REPEAT_ISSUE: 'repeat', 'callback', 'followup', 'recurring', 'same_issue'
// - NORMAL: 'low', 'medium', 'routine', 'standard', 'whenever'
// ═══════════════════════════════════════════════════════════════════════════
const VALID_URGENCY_VALUES = new Set(['normal', 'repeat_issue', 'urgent', 'emergency']);

// Emergency-level keywords (life/safety concerns)
const EMERGENCY_KEYWORDS = new Set([
    'emergency', 'critical', 'life_threatening', 'danger', 'dangerous',
    'gas_leak', 'gas leak', 'fire', 'smoke', 'carbon_monoxide', 'co_alarm',
    'flooding', 'flooded', 'electrical_fire', 'sparking'
]);

// Urgent-level keywords (needs prompt attention)
const URGENT_KEYWORDS = new Set([
    'high', 'asap', 'soon', 'important', 'priority', 'immediate',
    'right_away', 'today', 'now', 'quickly', 'fast',
    'no_cooling', 'no_heat', 'no_ac', 'not_working', 'broken'
]);

// Repeat issue keywords
const REPEAT_KEYWORDS = new Set([
    'repeat', 'repeat_issue', 'callback', 'call_back', 
    'followup', 'follow-up', 'follow_up', 'recurring', 'same_issue',
    'again', 'still_broken', 'didnt_fix', 'not_fixed'
]);

function normalizeUrgency(rawUrgency) {
    if (!rawUrgency) return 'normal';
    
    const u = String(rawUrgency).toLowerCase().trim();
    
    // Direct match to valid enum values
    if (VALID_URGENCY_VALUES.has(u)) {
        return u;
    }
    
    // Check emergency keywords
    if (EMERGENCY_KEYWORDS.has(u) || EMERGENCY_KEYWORDS.has(u.replace(/\s+/g, '_'))) {
        return 'emergency';
    }
    
    // Check urgent keywords
    if (URGENT_KEYWORDS.has(u) || URGENT_KEYWORDS.has(u.replace(/\s+/g, '_'))) {
        return 'urgent';
    }
    
    // Check repeat issue keywords
    if (REPEAT_KEYWORDS.has(u) || REPEAT_KEYWORDS.has(u.replace(/\s+/g, '_'))) {
        return 'repeat_issue';
    }
    
    // Low/routine → normal
    if (['low', 'medium', 'routine', 'standard', 'whenever', 'anytime'].includes(u)) {
        return 'normal';
    }
    
    // Unknown value - default to normal (safe)
    logger.warn('[URGENCY NORMALIZER] Unknown urgency value, defaulting to normal', { 
        rawUrgency, 
        defaultingTo: 'normal' 
    });
    return 'normal';
}

/**
 * Test-only helper to validate name slot behavior deterministically.
 * Mirrors booking name extraction + askFullName handling in isolation.
 */
function __testHandleNameSlotTurn({
    userText,
    company = {},
    nameSlotConfig = {},
    nameMeta: nameMetaInput = {},
    currentSlots: currentSlotsInput = {},
    activeSlot: activeSlotInput = 'name',
    phoneQuestion = null,
    abortReply = null
}) {
    const nameMeta = {
        first: null,
        last: null,
        lastConfirmed: false,
        askedMissingPartOnce: false,
        assumedSingleTokenAs: null,
        confirmed: false,
        ...nameMetaInput
    };

    const currentSlots = { ...currentSlotsInput };
    const extractedThisTurn = {};
    const setExtractedSlotIfChanged = (slotKey, value) => {
        if (value === undefined || value === null) return;
        const previous = currentSlots[slotKey];
        if (String(previous || '') !== String(value || '')) {
            extractedThisTurn[slotKey] = value;
        }
    };

    const confirmBackEnabled = nameSlotConfig?.confirmBack === true || nameSlotConfig?.confirmBack === 'true';
    const askFullNameEnabled = nameSlotConfig?.askFullName === true || nameSlotConfig?.askFullName === 'true' ||
        nameSlotConfig?.requireFullName === true || nameSlotConfig?.requireFullName === 'true' ||
        nameSlotConfig?.nameOptions?.askFullName === true || nameSlotConfig?.nameOptions?.askFullName === 'true';
    const askMissingNamePart = nameSlotConfig?.askMissingNamePart === true;

    // Name stop words are GLOBAL — read from AdminSettings via AWConfigReader.
    // No per-company fallback. Single source of truth.
    const customStopWords = AWConfigReader.getGlobalStopWords();
    const stopWordsEnabled = true; // Always enabled — control via the word list itself

    const normalizedInput = String(userText || '').trim();
    const lowerInput = normalizedInput.toLowerCase();
    const isYes = /^(yes|yeah|yep|correct|that's right|right)\b/i.test(lowerInput);
    const isNo = /^(no|nope|nah)\b/i.test(lowerInput);
    const confirmBackTemplate = nameSlotConfig?.confirmPrompt || getMissingConfigPrompt('confirmPrompt', 'name');
    const lastNameQuestion = nameSlotConfig?.lastNameQuestion || getMissingConfigPrompt('lastNameQuestion', 'name');
    const phonePrompt = phoneQuestion || getMissingConfigPrompt('slot_question', 'phone');
    const abortScript = abortReply || getMissingConfigPrompt('booking_abort', 'bookingOutcome.scripts.message_taken');
    let activeSlot = activeSlotInput;

    if (activeSlot === 'name' && currentSlots.name && confirmBackEnabled && !nameMeta.confirmed) {
        if (!normalizedInput) {
            nameMeta.confirmSilenceCount = Number.isFinite(nameMeta.confirmSilenceCount) ? nameMeta.confirmSilenceCount : 0;
            nameMeta.confirmSilenceCount += 1;
            if (nameMeta.confirmSilenceCount <= 1) {
                const reply = String(confirmBackTemplate).replace('{value}', currentSlots.name).trim();
                return {
                    reply,
                    state: {
                        slots: currentSlots,
                        extractedThisTurn,
                        nameMeta,
                        activeSlot: 'name',
                        nextSlotAfterConfirm: 'phone'
                    }
                };
            }
            return {
                reply: abortScript,
                state: {
                    slots: currentSlots,
                    extractedThisTurn,
                    nameMeta,
                    activeSlot: null,
                    nextSlotAfterConfirm: null,
                    bookingAborted: true
                }
            };
        }

        if (detectBookingAbortIntent(userText, company)) {
            return {
                reply: abortScript,
                state: {
                    slots: currentSlots,
                    extractedThisTurn,
                    nameMeta,
                    activeSlot: null,
                    nextSlotAfterConfirm: null,
                    bookingAborted: true
                }
            };
        }

        if (isYes) {
            nameMeta.confirmed = true;
            activeSlot = 'phone';
            return {
                reply: String(phonePrompt).trim(),
                state: {
                    slots: currentSlots,
                    extractedThisTurn,
                    nameMeta,
                    activeSlot,
                    nextSlotAfterConfirm: 'phone'
                }
            };
        }

        if (isNo) {
            // Caller is correcting the captured name. Common forms:
            // - "no, it's Mark Johnson"
            // - "no it's Mark"
            // - "no, actually it's Mark"
            // We must strip the negation + filler prefixes before name extraction.
            const correctionText = normalizedInput
                .replace(/^(no|nope|nah)[,\s]+/i, '')
                .replace(/^(actually|sorry|i mean)[,\s]+/i, '')
                .replace(/^(it'?s|it is|its)[,\s]+/i, '')
                .trim();
            const correctedName = SlotExtractors.extractName(correctionText, {
                expectingName: true,
                customStopWords: stopWordsEnabled ? customStopWords : []
            }) || '';
            if (correctedName) {
                currentSlots.name = correctedName;
                setExtractedSlotIfChanged('name', correctedName);
                nameMeta.confirmed = false;
                if (correctedName.includes(' ')) {
                    const parts = correctedName.split(/\s+/);
                    nameMeta.first = parts[0];
                    nameMeta.last = parts.slice(1).join(' ');
                } else {
                    nameMeta.first = correctedName;
                    nameMeta.last = null;
                }
                const reply = String(confirmBackTemplate).replace('{value}', correctedName).trim();
                return {
                    reply,
                    state: {
                        slots: currentSlots,
                        extractedThisTurn,
                        nameMeta,
                        activeSlot: 'name',
                        nextSlotAfterConfirm: 'phone'
                    }
                };
            }
        }
    }

    let extractedName = SlotExtractors.extractName(userText || '', {
        expectingName: true,
        customStopWords: stopWordsEnabled ? customStopWords : []
    });

    if (!extractedName && userText) {
        const words = userText.trim().split(/\s+/);
        const cleanWords = words.filter(w => {
            const lower = w.toLowerCase();
            const skipWords = ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'no', 'nope',
                'it', 'is', 'its', "it's", 'my', 'name', 'the', 'a', 'an',
                'please', 'hi', 'hello', 'hey'];
            return !skipWords.includes(lower) && /^[a-zA-Z]+$/.test(w) && w.length >= 2;
        });

        if (cleanWords.length === 1 || cleanWords.length === 2) {
            extractedName = cleanWords
                .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                .join(' ');
        }
    }

    if (extractedName) {
        const isPartialName = !extractedName.includes(' ');
        const alreadyAskedForMissingPart = nameMeta.askedMissingPartOnce === true;

        // ════════════════════════════════════════════════════════════════════════
        // V84 FIX: LAST NAME CAPTURE
        // ════════════════════════════════════════════════════════════════════════
        // When we already asked "what's your last name?" and user responds with
        // a single name like "Gonzales", we need to COMBINE it with the first name,
        // NOT replace the first name!
        // 
        // BEFORE (BUG): "Mark" → ask last name → "Gonzales" → name = "Gonzales" ❌
        // AFTER (FIX):  "Mark" → ask last name → "Gonzales" → name = "Mark Gonzales" ✅
        // ════════════════════════════════════════════════════════════════════════
        if (alreadyAskedForMissingPart && isPartialName && (currentSlots.partialName || nameMeta.first)) {
            // This is the ANSWER to "what's your last name?" - combine with first name
            const firstName = nameMeta.first || currentSlots.partialName || '';
            const lastName = extractedName;
            currentSlots.name = `${firstName} ${lastName}`.trim();
            setExtractedSlotIfChanged('name', currentSlots.name);
            nameMeta.last = lastName;
            nameMeta.first = firstName;
            // Clear partialName since we now have full name
            delete currentSlots.partialName;
        } else if (askFullNameEnabled && isPartialName && !alreadyAskedForMissingPart) {
            currentSlots.partialName = extractedName;
            setExtractedSlotIfChanged('partialName', extractedName);
        } else if (askMissingNamePart && isPartialName && !alreadyAskedForMissingPart) {
            currentSlots.partialName = extractedName;
            setExtractedSlotIfChanged('partialName', extractedName);
        } else {
            currentSlots.name = extractedName;
            setExtractedSlotIfChanged('name', extractedName);
        }
    }

    // Initialize nameMeta from captured data
    if (currentSlots.name && currentSlots.name.includes(' ')) {
        const parts = currentSlots.name.split(/\s+/);
        nameMeta.first = parts[0];
        nameMeta.last = parts.slice(1).join(' ');
    } else if (currentSlots.partialName && !nameMeta.first && !nameMeta.last) {
        const partialName = currentSlots.partialName;
        // V84+: Read from global AdminSettings cache (NOT per-company)
        const commonFirstNames = AWConfigReader.getGlobalFirstNames();
        const commonFirstNamesSet = new Set(commonFirstNames.map(n => n.toLowerCase()));
        const listIsEmpty = commonFirstNames.length === 0;
        const isCommonFirstName = listIsEmpty || commonFirstNamesSet.has(partialName.toLowerCase());
        if (isCommonFirstName) {
            nameMeta.first = partialName;
            nameMeta.assumedSingleTokenAs = 'first';
        } else {
            nameMeta.last = partialName;
            nameMeta.assumedSingleTokenAs = 'last';
        }
    } else if (currentSlots.name && !currentSlots.name.includes(' ')) {
        nameMeta.first = currentSlots.name;
        nameMeta.last = null;
    }

    let reply = '';
    const nextSlotAfterConfirm = 'phone';

    if (askFullNameEnabled && currentSlots.partialName && !currentSlots.name) {
        nameMeta.askedMissingPartOnce = true;
        reply = String(lastNameQuestion).replace('{firstName}', nameMeta.first || currentSlots.partialName || '').trim();
        activeSlot = 'name';
    } else if (currentSlots.name) {
        reply = String(confirmBackTemplate).replace('{value}', currentSlots.name).trim();
        activeSlot = confirmBackEnabled ? 'name' : 'phone';
    }

    return {
        reply,
        state: {
            slots: currentSlots,
            extractedThisTurn,
            nameMeta,
            activeSlot,
            nextSlotAfterConfirm
        }
    };
}

/**
 * Test-only helper to validate confirmBack behavior for non-name slots.
 */
function __testHandleConfirmSlotTurn({
    slotType,
    userText,
    company = {},
    slotConfig = {},
    slotMeta: slotMetaInput = {},
    currentSlots: currentSlotsInput = {},
    extractedValue = null,
    nextSlotType = null,
    nextQuestion = '',
    reaskPrefix = '',
    abortReply = null,
    decisionTrace = null,
    decisionTraceContext = null
}) {
    const slotMeta = {
        pendingConfirm: true,
        confirmed: false,
        confirmSilenceCount: 0,
        ...slotMetaInput
    };
    const currentSlots = { ...currentSlotsInput };
    const extractedThisTurn = {};
    const setExtractedSlotIfChanged = (slotKey, value) => {
        if (value === undefined || value === null) return;
        const previous = currentSlots[slotKey];
        if (String(previous || '') !== String(value || '')) {
            extractedThisTurn[slotKey] = value;
        }
    };

    const abortScript = abortReply || getMissingConfigPrompt('booking_abort', 'bookingOutcome.scripts.message_taken');
    const trimmed = String(userText || '').trim();
    const lower = trimmed.toLowerCase();
    const userSaysYes = /^(yes|yeah|yep|correct|that's right|right|yup|uh huh|mhm|affirmative|sure|ok|okay|absolutely|definitely|certainly|perfect|exactly|that's it|you got it|sounds good|that works)/i.test(trimmed);
    const userSaysNoGeneric = /^(no|nope|nah|that's wrong|wrong|incorrect|not right|that's not right)/i.test(trimmed);

    if (!trimmed) {
        slotMeta.confirmSilenceCount = Number.isFinite(slotMeta.confirmSilenceCount)
            ? slotMeta.confirmSilenceCount
            : 0;
        slotMeta.confirmSilenceCount += 1;
        if (slotMeta.confirmSilenceCount <= 1) {
            const confirmPrompt = slotConfig?.confirmPrompt || getMissingConfigPrompt('confirmPrompt', slotType);
            const value = currentSlots[slotType] || extractedValue || '';
            const reply = value
                ? String(confirmPrompt).replace('{value}', String(value))
                : String(slotConfig?.question || getMissingConfigPrompt('slot_question', slotType));
            recordConfirmBackTrace(decisionTrace, {
                slot: slotType,
                userReplyType: 'SILENCE',
                outcome: 'SILENCE_REPROMPT',
                context: decisionTraceContext
            });
            return {
                reply,
                state: { slots: currentSlots, slotMeta, extractedThisTurn, confirmBackTrace: decisionTrace, activeSlot: slotType }
            };
        }
        recordConfirmBackTrace(decisionTrace, {
            slot: slotType,
            userReplyType: 'SILENCE',
            outcome: 'SILENCE_ABORT',
            context: decisionTraceContext
        });
        return {
            reply: abortScript,
            state: { slots: currentSlots, slotMeta, extractedThisTurn, confirmBackTrace: decisionTrace, activeSlot: null, bookingAborted: true }
        };
    }

    if (detectBookingAbortIntent(lower, company)) {
        recordConfirmBackTrace(decisionTrace, {
            slot: slotType,
            userReplyType: 'ABORT',
            outcome: 'ABORTED',
            context: decisionTraceContext
        });
        return {
            reply: abortScript,
            state: { slots: currentSlots, slotMeta, extractedThisTurn, confirmBackTrace: decisionTrace, activeSlot: null, bookingAborted: true }
        };
    }

    const confirmResult = handleConfirmBackForSlot({
        slotType,
        slotConfig,
        slotMeta,
        currentSlots,
        extractedValue,
        userSaysYes,
        userSaysNoGeneric,
        reaskPrefix,
        decisionTrace,
        decisionTraceContext,
        onConfirmYes: () => ({
            reply: nextQuestion,
            nextSlotId: nextSlotType
        })
    });

    if (confirmResult.handled) {
        if (extractedValue) {
            currentSlots[slotType] = extractedValue;
            setExtractedSlotIfChanged(slotType, extractedValue);
        }
        return {
            reply: confirmResult.reply,
            state: {
                slots: currentSlots,
                slotMeta,
                extractedThisTurn,
                confirmBackTrace: decisionTrace,
                activeSlot: confirmResult.nextSlotId || null,
                nextSlotId: confirmResult.nextSlotId || null
            }
        };
    }

    return {
        reply: '',
        state: { slots: currentSlots, slotMeta, extractedThisTurn, confirmBackTrace: decisionTrace, activeSlot: slotType }
    };
}

const SERVICE_TRADE_KEYS = ['hvac', 'plumbing', 'electrical', 'appliance'];

function normalizeTradeKey(value) {
    return String(value || '').trim().toLowerCase();
}

function isServiceTrade(tradeKey) {
    const normalized = normalizeTradeKey(tradeKey);
    return SERVICE_TRADE_KEYS.includes(normalized);
}

function stripServiceEmpathyPreamble(reply, tradeKey, isServiceCall) {
    if (!reply || !isServiceCall || !isServiceTrade(tradeKey)) return reply;
    const patterns = [
        /^sorry to hear that[.,!\s-]*/i,
        /^i'?m sorry to hear that[.,!\s-]*/i,
        /^i'?m sorry you'?re dealing with that[.,!\s-]*/i,
        /^(that must be frustrating|i understand how frustrating)[.,!\s-]*/i
    ];

    let cleaned = reply.trim();
    for (const pattern of patterns) {
        cleaned = cleaned.replace(pattern, '').trim();
    }

    return cleaned;
}

function isExistingUnitServiceRequest(text = '') {
    const normalized = String(text || '').toLowerCase();
    const newSystemKeywords = [
        'new system', 'replace', 'replacement', 'install', 'installation', 'quote',
        'estimate', 'new ac', 'new a/c', 'new unit'
    ];
    const serviceKeywords = [
        'service', 'repair', 'fix', 'maintenance', 'tune', 'check', 'inspect',
        'ac service', 'a/c service', 'hvac service', 'need service', 'need someone',
        'look at', 'come out'
    ];

    if (newSystemKeywords.some(k => normalized.includes(k))) {
        return false;
    }

    return serviceKeywords.some(k => normalized.includes(k));
}

function resolveTenantPromptOrFallback({ company, promptKey, contextLabel, session, tradeKey }) {
    const prompt = resolveBookingPrompt(company, promptKey, { tradeKey });
    if (prompt) return prompt;

    const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};
    // V83 FIX: Use colons instead of dots - Mongoose Maps don't allow dots in keys
    const fallbackKey = frontDesk.promptGuards?.missingPromptFallbackKey || 'booking:universal:guardrails:missing_prompt_fallback';

    if (session) {
        session.memory = session.memory || {};
        session.memory.promptGuards = session.memory.promptGuards || {};
        session.memory.promptGuards.missingPrompts = session.memory.promptGuards.missingPrompts || [];
        session.memory.promptGuards.missingPrompts.push({
            key: promptKey || null,
            context: contextLabel || null,
            turn: (session.metrics?.totalTurns || 0) + 1
        });
        session.memory.promptGuards.lastMissingPromptKey = promptKey || null;
        session.memory.promptGuards.lastMissingPromptContext = contextLabel || null;
    }

    logger.error('[PROMPT GUARD] Missing tenant prompt', {
        promptKey,
        fallbackKey,
        context: contextLabel || null,
        companyId: company?._id || null
    });

    const fallbackPrompt = resolveBookingPrompt(company, fallbackKey, { tradeKey: 'universal' });
    if (fallbackPrompt) return fallbackPrompt;

    return getMissingConfigPrompt('missing_tenant_prompt', promptKey, {
        fallbackKey,
        context: contextLabel || null
    });
}

// Helper: Get random variant from pool
function getVariant(pool, index = null) {
    if (!pool || pool.length === 0) return null;
    const idx = index !== null ? (index % pool.length) : Math.floor(Math.random() * pool.length);
    return pool[idx];
}

// Helper: Get slot prompt variant (UI config ONLY - no hardcoded fallbacks)
// V36 NUKE: PROMPT AS LAW - UI-configured question is the ONLY source
function getSlotPromptVariant(slotConfig, slotId, askedCount = 0) {
    // 🎯 PROMPT AS LAW: UI-configured question is the ONLY source
    // This is what the admin set in Front Desk Behavior → Booking Prompts
    
    // Priority 1: UI-configured question (MUST exist)
    if (slotConfig?.question) {
        // First ask: use exact UI question
        if (askedCount === 0) {
            logger.debug(`[PROMPT AS LAW] Using UI question for ${slotId}:`, slotConfig.question);
            return slotConfig.question;
        }
        // Reprompts: try UI-configured reprompt variants
        const uiRepromptVariants = slotConfig?.repromptVariants;
        if (uiRepromptVariants && uiRepromptVariants.length > 0) {
            const variant = uiRepromptVariants[(askedCount - 1) % uiRepromptVariants.length];
            logger.debug(`[PROMPT AS LAW] Using UI reprompt variant for ${slotId}:`, variant);
            return variant;
        }
        // No reprompt variants configured, use the main question again
        return slotConfig.question;
    }
    
    // Priority 2: UI-configured prompt variants (legacy support)
    const uiVariants = slotConfig?.promptVariants;
    if (uiVariants && uiVariants.length > 0) {
        return uiVariants[askedCount % uiVariants.length];
    }
    
    // 🚨 V59 NUKE: NO FALLBACKS - Log error and use getMissingConfigPrompt
    return getMissingConfigPrompt('slot_question', slotId, { slotId });
}

// ═══════════════════════════════════════════════════════════════════════════
// V59 NUKE: Missing Config Handler - NO SILENT FALLBACKS
// ═══════════════════════════════════════════════════════════════════════════
// PHILOSOPHY: If config is missing, it's a BUG that must be fixed.
// We log loudly and return a generic prompt so the call doesn't break,
// but the error log makes it IMPOSSIBLE to miss the issue.
// ═══════════════════════════════════════════════════════════════════════════
function getMissingConfigPrompt(configType, fieldName, context = {}) {
    const errorId = `MISSING_CONFIG_${Date.now()}`;
    
    logger.error(`[V59 NUKE] 🚨 MISSING UI CONFIG - This should NEVER happen in production!`, {
        errorId,
        configType,
        fieldName,
        context,
        fix: `Configure this in Control Plane → Front Desk Behavior → Booking Prompts`,
        urgency: 'HIGH - Company onboarding incomplete or config was deleted'
    });
    
    // Return a safe generic prompt - but the error log above will alert us
    const safeDefaults = {
        // Slot questions
        // IMPORTANT: Never surface "unknown" to callers ("What is your unknown?").
        // This string is only a safety net when UI config is missing.
        'slot_question': (() => {
            const safeField = (fieldName && String(fieldName).toLowerCase() !== 'unknown')
                ? fieldName
                : 'information';
            return `What is your ${safeField}?`;
        })(),
        'firstNameQuestion': "And your first name?",
        'lastNameQuestion': "And your last name?",
        'phone_question': "What's a good callback number?",
        'address_question': "What's the service address?",
        // Phone breakdown
        'areaCodePrompt': "What's the area code?",
        'restOfNumberPrompt': "And the rest of the number?",
        // Address breakdown
        'cityPrompt': "And what city?",
        'zipPrompt': "And the zip code?",
        'partialAddressPrompt': "Can you give me the full address?",
        'unitNumberPrompt': "Is there a unit number?",
        // Greeting responses
        'greeting_morning': "Good morning! How can I help?",
        'greeting_afternoon': "Good afternoon! How can I help?",
        'greeting_evening': "Good evening! How can I help?",
        'greeting_generic': "Hello! How can I help?",
        // Fallbacks
        'fallback_generic': "I'm sorry, could you repeat that?",
        'transfer_message': "One moment while I transfer you.",
        // Loop prevention
        'rephrase_intro': "Let me try this differently — ",
        // Unit of work
        'clarify_prompt': "Do you have another request?",
        'next_unit_intro': "Let's get the next one.",
        'final_script': "You're all set.",
        'askAddAnotherPrompt': "Is there anything else?",
        // Confirm prompts
        'confirmPrompt': "Just to confirm, {value}. Is that right?",
        // Resume booking protocol
        'resumeBookingTemplate': "Okay — back to booking. I have {collectedSummary}. {nextQuestion}",
        // Booking clarification (meta questions during booking)
        'bookingClarificationTemplate': "No problem — {nextQuestion}"
    };
    
    return safeDefaults[configType] || safeDefaults[fieldName] || `[CONFIG MISSING: ${configType}]`;
}

function detectBookingAbortIntent(userText, company = {}) {
    const text = String(userText || '').toLowerCase().trim();
    if (!text) return false;

    const uiPhrases = company.aiAgentSettings?.frontDeskBehavior?.bookingAbortPhrases || [];
    const phrases = Array.isArray(uiPhrases) && uiPhrases.length > 0
        ? uiPhrases
        : [
            'never mind',
            'nevermind',
            'forget it',
            'cancel',
            'cancel it',
            'cancel the appointment',
            'dont want to schedule',
            "don't want to schedule",
            'do not want to schedule',
            'dont want to book',
            "don't want to book",
            'do not want to book',
            'i dont want',
            "i don't want",
            'no thanks',
            'ill call back',
            "i'll call back",
            'call back',
            'stop this',
            'stop now'
        ];

    return phrases.some(phrase => phrase && text.includes(String(phrase).toLowerCase()));
}

function recordConfirmBackTrace(decisionTrace, { slot, userReplyType, outcome, context = null }) {
    if (!decisionTrace) return;
    const traceContext = context || {};
    decisionTrace.push({
        phase: 'bookingConfirmBack',
        slot,
        userReplyType,
        outcome,
        companyId: traceContext.companyId || null,
        tradeKey: traceContext.tradeKey || null,
        callSessionId: traceContext.callSessionId || null,
        ts: new Date().toISOString()
    });
}

function handleConfirmBackForSlot({
    slotType,
    slotConfig,
    slotMeta,
    currentSlots,
    extractedValue,
    userSaysYes,
    userSaysNoGeneric,
    onConfirmYes,
    reaskPrefix = '',
    decisionTrace = null,
    decisionTraceContext = null
}) {
    if (!slotMeta?.pendingConfirm || slotMeta.confirmed) {
        return { handled: false };
    }

    const confirmPrompt = slotConfig?.confirmPrompt || getMissingConfigPrompt('confirmPrompt', slotType);
    const questionPrompt = slotConfig?.question || getMissingConfigPrompt('slot_question', slotType);

    if (userSaysYes) {
        slotMeta.confirmed = true;
        slotMeta.pendingConfirm = false;
        const confirmYesResult = onConfirmYes ? onConfirmYes() : null;
        recordConfirmBackTrace(decisionTrace, {
            slot: slotType,
            userReplyType: 'YES',
            outcome: 'CONFIRMED',
            context: decisionTraceContext
        });
        return {
            handled: true,
            reply: confirmYesResult?.reply || '',
            nextSlotId: confirmYesResult?.nextSlotId || null
        };
    }

    if (userSaysNoGeneric) {
        if (extractedValue) {
            currentSlots[slotType] = extractedValue;
            slotMeta.pendingConfirm = true;
            recordConfirmBackTrace(decisionTrace, {
                slot: slotType,
                userReplyType: 'NO',
                outcome: 'CORRECTION',
                context: decisionTraceContext
            });
            return {
                handled: true,
                reply: String(confirmPrompt).replace('{value}', extractedValue),
                nextSlotId: slotType
            };
        }
        currentSlots[slotType] = null;
        slotMeta.pendingConfirm = false;
        recordConfirmBackTrace(decisionTrace, {
            slot: slotType,
            userReplyType: 'NO',
            outcome: 'CORRECTION',
            context: decisionTraceContext
        });
        return {
            handled: true,
            reply: `${reaskPrefix}${questionPrompt}`.trim(),
            nextSlotId: slotType
        };
    }

    if (extractedValue) {
        currentSlots[slotType] = extractedValue;
        slotMeta.pendingConfirm = true;
        recordConfirmBackTrace(decisionTrace, {
            slot: slotType,
            userReplyType: 'UNKNOWN',
            outcome: 'CORRECTION',
            context: decisionTraceContext
        });
        return {
            handled: true,
            reply: String(confirmPrompt).replace('{value}', extractedValue),
            nextSlotId: slotType
        };
    }

    return { handled: false };
}

function extractExplicitNamePartsFromText(text) {
    if (!text || typeof text !== 'string') return null;
    const raw = text.trim();
    if (!raw) return null;

    // Pattern 1: "last name is [name]" or "my last name is [name]"
    const lastNameMatch = raw.match(/(?:my\s+)?last\s+name\s+(?:is\s+)?([A-Za-z][A-Za-z'\-]{1,})\b/i);
    if (lastNameMatch?.[1]) {
        return { last: lastNameMatch[1], matchedPattern: 'last_name' };
    }

    // Pattern 2: "first name is [name]" or "my first name is [name]"
    const firstNameMatch = raw.match(/(?:my\s+)?first\s+name\s+(?:is\s+)?([A-Za-z][A-Za-z'\-]{1,})\b/i);
    if (firstNameMatch?.[1]) {
        return { first: firstNameMatch[1], matchedPattern: 'first_name' };
    }

    // Pattern 3: "this is [first] [last]" - full name
    const fullNameMatch = raw.match(/\bthis\s+is\s+([A-Za-z][A-Za-z'\-]{1,})\s+([A-Za-z][A-Za-z'\-]{1,})\b/i);
    if (fullNameMatch?.[1] && fullNameMatch?.[2]) {
        return { first: fullNameMatch[1], last: fullNameMatch[2], matchedPattern: 'this_is_full' };
    }

    // Pattern 4: "that's [name]" or "it's [name]" - common response to "what's your last name?"
    // V80 FIX: Handles "That's Walter", "It's Walter", "That is Walter"
    const thatsNameMatch = raw.match(/^(?:that'?s?|it'?s?|thats?)\s+([A-Za-z][A-Za-z'\-]{1,})\b\.?$/i);
    if (thatsNameMatch?.[1]) {
        // When user says "that's [name]" after being asked for last name, it IS the last name
        return { last: thatsNameMatch[1], matchedPattern: 'thats_name' };
    }

    // Pattern 5: Just a single name word (after stripping common prefixes)
    // Handles: "Walter", "walter.", "It's Walter", "Yeah, Walter"
    // V80 FIX: Extract the actual name from common response patterns
    const singleNameMatch = raw.match(/^(?:(?:it'?s?|that'?s?|yeah|yes|sure)[,.\s]*)?([A-Za-z][A-Za-z'\-]{1,})\.?$/i);
    if (singleNameMatch?.[1]) {
        // Return as a generic name - context will determine if it's first or last
        return { name: singleNameMatch[1], matchedPattern: 'single_name' };
    }

    return null;
}

// V97f: buildBookingResumeBlock NUKED - BookingFlowRunner handles resume

// ═══════════════════════════════════════════════════════════════════════════
// V34: SLOT COMPLETION GATES - "Value beats meta"
// ═══════════════════════════════════════════════════════════════════════════
// These functions determine if a slot is COMPLETE and should NOT be asked again.
// The golden rule: If we have a value, the slot is complete.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Check if NAME slot is complete
 * @param {Object} currentSlots - Current slot values
 * @param {Object} nameMeta - session.booking.meta.name
 * @param {Object} slotConfig - Name slot configuration
 * @returns {boolean} True if name is complete
 */
function isNameSlotComplete(currentSlots, nameMeta, slotConfig) {
    const nameValue = (currentSlots?.name || '').trim();
    const partialName = (currentSlots?.partialName || '').trim();
    const first = nameMeta?.first || '';
    const last = nameMeta?.last || '';
    
    // V36 FIX: Check if we're still waiting for confirmation or spelling variant
    // If so, the name is NOT complete yet - we need to finish the interaction
    const confirmBackEnabled = slotConfig?.confirmBack === true || slotConfig?.confirmBack === 'true';
    const waitingForConfirmation = nameMeta?.lastConfirmed === true && !nameMeta?.askedMissingPartOnce && 
                                   !currentSlots?.name; // Confirmed but not yet accepted
    const waitingForSpellingVariant = nameMeta?.askedSpellingVariant === true && !nameMeta?.spellingVariantAnswer;
    
    // If we're in the middle of a confirmation flow, name is NOT complete
    if (waitingForSpellingVariant) {
        logger.debug('[SLOT COMPLETE] Name NOT complete: waiting for spelling variant answer');
        return false;
    }
    
    // V34 FIX: THE GOLDEN RULE - If we have ANY name value, it's complete
    // The askFullName setting controls WHETHER to ask for last name during collection,
    // NOT whether to re-ask a name we already have.
    
    // 1. Full name in meta (first AND last)
    if (first && last) {
        logger.debug('[SLOT COMPLETE] Name complete: meta has first+last', { first, last });
        return true;
    }
    
    // 2. Full name in string (contains space = "Mark Walter")
    if (nameValue && nameValue.includes(' ')) {
        logger.debug('[SLOT COMPLETE] Name complete: string has space', { nameValue });
        return true;
    }
    
    // 3. V36 FIX: Only consider single-word name complete if:
    //    - confirmBack is disabled OR we've already confirmed
    //    - AND we're not waiting for askFullName response
    // V36 FIX: Check both boolean and string values
    const askFullName = slotConfig?.askFullName === true || slotConfig?.askFullName === 'true' ||
                       slotConfig?.requireFullName === true || slotConfig?.requireFullName === 'true';
    const needsLastName = askFullName && !last && first;
    
    if (nameValue && !needsLastName) {
        // V36: Check if confirmBack flow is complete
        if (confirmBackEnabled && !nameMeta?.lastConfirmed && !nameMeta?.askedMissingPartOnce) {
            // We have a name but haven't confirmed it yet - NOT complete
            logger.debug('[SLOT COMPLETE] Name NOT complete: confirmBack enabled but not confirmed yet', { nameValue });
            return false;
        }
        logger.debug('[SLOT COMPLETE] Name complete: has value and no pending interactions', { nameValue });
        return true;
    }
    
    // 4. If we have a partialName, promote it and consider complete
    if (partialName) {
        logger.debug('[SLOT COMPLETE] Name complete: has partialName', { partialName });
        return true;
    }
    
    // 5. If we have first name in meta, it's complete
    if (first) {
        logger.debug('[SLOT COMPLETE] Name complete: has meta.first', { first });
        return true;
    }
    
    // Not complete - no name value at all
    logger.debug('[SLOT COMPLETE] Name NOT complete: no value', { 
        nameValue, partialName, first, last 
    });
    return false;
}

/**
 * Check if a confirmBack slot (phone, address) is complete
 * @param {string} value - Slot value
 * @param {Object} slotMeta - session.booking.meta[slotId]
 * @param {Object} slotConfig - Slot configuration
 * @returns {boolean} True if slot is complete
 */
function isConfirmBackSlotComplete(value, slotMeta, slotConfig) {
    const hasValue = !!(value && value.trim && value.trim());
    const isConfirmed = slotMeta?.confirmed === true;
    const isPending = slotMeta?.pendingConfirm === true;
    const needsConfirmBack = slotConfig?.confirmBack === true || slotConfig?.confirmBack === 'true';
    
    // V37 DEBUG: Log all inputs
    logger.info('[SLOT COMPLETE] V37 DEBUG:', {
        value: typeof value === 'string' ? value.substring(0, 20) : value,
        hasValue,
        slotMeta: slotMeta ? { confirmed: slotMeta.confirmed, pendingConfirm: slotMeta.pendingConfirm } : 'undefined',
        needsConfirmBack,
        slotConfigConfirmBack: slotConfig?.confirmBack
    });
    
    // If no value, not complete
    if (!hasValue) {
        logger.debug('[SLOT COMPLETE] ConfirmBack NOT complete: no value');
        return false;
    }
    
    // If doesn't need confirmBack, value is enough
    if (!needsConfirmBack) {
        logger.debug('[SLOT COMPLETE] ConfirmBack complete: no confirmBack required', { value });
        return true;
    }
    
    // V34 RULE: Value + (confirmed OR not pending) = complete
    // If we have a value and we're NOT waiting for confirmation, it was confirmed previously
    const isComplete = isConfirmed || !isPending;
    
    logger.info('[SLOT COMPLETE] V37 RESULT:', { 
        isConfirmed, 
        isPending, 
        isComplete,
        reason: isConfirmed ? 'confirmed=true' : (!isPending ? 'not pending' : 'pending and not confirmed')
    });
    
    return isComplete;
}

/**
 * Master function: Check if ANY slot is complete
 * @param {string} slotId - Slot identifier
 * @param {Object} currentSlots - Current slot values
 * @param {Object} session - Session object with booking.meta
 * @param {Object} slotConfig - Slot configuration
 * @returns {boolean} True if slot is complete
 */
function isSlotComplete(slotId, currentSlots, session, slotConfig) {
    const slotMeta = session?.booking?.meta?.[slotId] || {};
    const value = currentSlots?.[slotId] || currentSlots?.[slotConfig?.type] || '';
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V49 FIX: Name slot detection - check multiple indicators
    // The slot might have:
    //   - type: "name" (correct semantic type)
    //   - type: "text" with id: "firstName" or "lastName" (UI config)
    //   - slotId: "name" (legacy format)
    // Data is ALWAYS stored under currentSlots.name, not currentSlots.firstName
    // ═══════════════════════════════════════════════════════════════════════════
    const isNameSlot = 
        slotConfig?.type === 'name' || 
        slotId === 'name' ||
        slotId === 'firstName' ||
        slotId === 'lastName' ||
        (slotId && slotId.toLowerCase().includes('name'));
    
    if (isNameSlot) {
        const nameMeta = session?.booking?.meta?.name || {};
        // V49: For name slots, also check currentSlots.name directly
        const hasNameValue = currentSlots?.name || currentSlots?.[slotId] || currentSlots?.[slotConfig?.type];
        if (hasNameValue && isNameSlotComplete(currentSlots, nameMeta, slotConfig)) {
            return true;
        }
        return isNameSlotComplete(currentSlots, nameMeta, slotConfig);
    }
    
    // For confirmBack slots (phone, address, etc.)
    return isConfirmBackSlotComplete(value, slotMeta, slotConfig);
}

/**
 * Build state summary for LLM to prevent "goldfish memory"
 * @param {Object} currentSlots - Current slot values
 * @param {Array} bookingSlots - Slot configurations
 * @param {Object} session - Session object
 * @returns {string} State summary string
 */
function buildStateSummaryForLLM(currentSlots, bookingSlots, session) {
    const collected = [];
    const missing = [];
    
    for (const slot of bookingSlots) {
        const slotId = slot.slotId || slot.id || slot.type;
        // V48 FIX: Check both slotId AND type for slot values
        // Data is stored under TYPE key (name, phone, address) not custom slot IDs
        const value = currentSlots[slotId] || currentSlots[slot.type];
        const isComplete = isSlotComplete(slotId, currentSlots, session, slot);
        
        if (isComplete && value) {
            const displayValue = slotId === 'phone' || slot.type === 'phone' ? value : (value.substring ? value.substring(0, 30) : String(value));
            collected.push(`${slot.type || slotId}="${displayValue}" (complete)`);
        } else if (slot.required) {
            missing.push(slot.type || slotId);
        }
    }
    
    const nextSlot = missing[0] || 'NONE';
    const askedCounts = {};
    for (const slotId of missing) {
        askedCounts[slotId] = session?.booking?.meta?.[slotId]?.askedCount || 0;
    }
    
    return `
State Summary (DO NOT ASK COMPLETED SLOTS):
  Collected: ${collected.join(', ') || 'none'}
  Missing: ${missing.join(', ') || 'none'}
  Next: ${nextSlot}
  Asked: ${JSON.stringify(askedCounts)}
`.trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// TIER 2 PLACEHOLDER - Reserved for future rebuild
// ═══════════════════════════════════════════════════════════════════════════
// Cheat sheets (V23) REMOVED Feb 2026 - entire system nuked.
// Tier 2 slot in the cascade is reserved for a future knowledge layer.
// When rebuilt, it should sit between Scenario matching (Tier 1) and LLM (Tier 3).
// ═══════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════
// 🆕 V26: CALLER VOCABULARY TRANSLATION
// ═══════════════════════════════════════════════════════════════════════════
// Translates industry slang in caller input to standard terms.
// Example: "not pulling" → "not cooling" (HVAC)
// 
// Uses TWO sources (merged):
// 1. Template-level synonymMap (from Global AI Brain) OR nlpConfig.synonyms (legacy)
// 2. Company-level callerVocabulary.synonymMap (Front Desk UI)
// 
// This helps the LLM understand what the caller means.
// ═══════════════════════════════════════════════════════════════════════════
async function translateCallerVocabulary(userText, company, template) {
    if (!userText || typeof userText !== 'string') return { translated: userText, replacements: [] };
    
    const replacements = [];
    let translated = userText;

    // 🚨 SAFETY GUARDRAILS (DEFAULT - OVERRIDE IN UI)
    // Some synonym keys are too generic and will corrupt meaning if replaced globally.
    // Example: "air" → "air conditioner" causes "air conditioner conditioner".
    // These are blocked unless you explicitly add a safer, phrase-level synonym (e.g., "a/c" → "air conditioner").
    const DANGEROUS_GENERIC_KEYS = new Set([
        'air',
        'heat',
        'heating',
        'cool',
        'cooling',
        'system'
    ]);
    const SHORT_KEY_ALLOWLIST = new Set(['ac', 'a/c']);
    
    function isUnsafeSynonymKey(slangKey) {
        const k = String(slangKey || '').toLowerCase().trim();
        if (!k) return true;
        if (DANGEROUS_GENERIC_KEYS.has(k)) return true;
        if (k.length < 3 && !SHORT_KEY_ALLOWLIST.has(k)) return true;
        return false;
    }
    
    function wouldCascadeInsideReplacement(slangKey, meaningValue) {
        const k = String(slangKey || '').toLowerCase().trim();
        const m = String(meaningValue || '').toLowerCase().trim();
        if (!k || !m) return false;
        // If the meaning contains the slang token as a whole word, later passes can duplicate it.
        // Example: slang "air", meaning "air conditioner".
        const re = new RegExp(`\\b${escapeRegex(k)}\\b`, 'i');
        return re.test(m);
    }
    
    // Build merged synonym map (template + company)
    const synonymMap = new Map();
    
    // Source 1: Template-level synonyms
    // V36: Check BOTH locations - synonymMap (Global AI Brain) and nlpConfig.synonyms (legacy)
    // Format: { "technical_term": ["variant1", "variant2"] }
    
    // Priority 1: template.synonymMap (Global AI Brain - current location)
    if (template?.synonymMap) {
        const templateSynonyms = template.synonymMap instanceof Map 
            ? template.synonymMap 
            : new Map(Object.entries(template.synonymMap || {}));
        
        for (const [technical, variants] of templateSynonyms.entries()) {
            if (Array.isArray(variants)) {
                for (const variant of variants) {
                    const slang = String(variant || '').toLowerCase().trim();
                    const meaning = String(technical || '').trim();
                    if (!slang || !meaning) continue;
                    if (isUnsafeSynonymKey(slang) || wouldCascadeInsideReplacement(slang, meaning)) {
                        continue;
                    }
                    synonymMap.set(slang, meaning);
                }
            }
        }
        console.log('[VOCABULARY] 🔤 Loaded from template.synonymMap:', synonymMap.size, 'mappings');
    }
    
    // Priority 2: template.nlpConfig.synonyms (legacy location - fallback)
    if (template?.nlpConfig?.synonyms && synonymMap.size === 0) {
        const templateSynonyms = template.nlpConfig.synonyms instanceof Map 
            ? template.nlpConfig.synonyms 
            : new Map(Object.entries(template.nlpConfig.synonyms || {}));
        
        for (const [technical, variants] of templateSynonyms.entries()) {
            if (Array.isArray(variants)) {
                for (const variant of variants) {
                    const slang = String(variant || '').toLowerCase().trim();
                    const meaning = String(technical || '').trim();
                    if (!slang || !meaning) continue;
                    if (isUnsafeSynonymKey(slang) || wouldCascadeInsideReplacement(slang, meaning)) {
                        continue;
                    }
                    synonymMap.set(slang, meaning);
                }
            }
        }
        console.log('[VOCABULARY] 🔤 Loaded from template.nlpConfig.synonyms (legacy):', synonymMap.size, 'mappings');
    }
    
    // Source 2: Company-level callerVocabulary.synonymMap (Front Desk UI)
    // Format: { "slang": "standard_meaning" }
    const callerVocab = company?.aiAgentSettings?.frontDeskBehavior?.callerVocabulary;
    if (callerVocab?.enabled !== false && callerVocab?.synonymMap) {
        const companyMap = callerVocab.synonymMap instanceof Map 
            ? callerVocab.synonymMap 
            : new Map(Object.entries(callerVocab.synonymMap || {}));
        
        for (const [slang, meaning] of companyMap.entries()) {
            // Company overrides template
            const k = String(slang || '').toLowerCase().trim();
            const v = String(meaning || '').trim();
            if (!k || !v) continue;
            if (isUnsafeSynonymKey(k) || wouldCascadeInsideReplacement(k, v)) {
                continue;
            }
            synonymMap.set(k, v);
        }
    }
    
    // Apply translations (longest match first to handle phrases)
    const sortedEntries = [...synonymMap.entries()].sort((a, b) => b[0].length - a[0].length);
    
    for (const [slang, meaning] of sortedEntries) {
        // Use word boundary matching for safety
        const regex = new RegExp(`\\b${escapeRegex(slang)}\\b`, 'gi');
        
        if (regex.test(translated)) {
            const before = translated;
            translated = translated.replace(regex, meaning);
            
            if (before !== translated) {
                replacements.push({ from: slang, to: meaning });
            }
        }
    }
    
    // Log if translations occurred
    if (replacements.length > 0) {
        logger.info('[CALLER VOCAB] 🔤 Translated caller slang', {
            original: userText,
            translated,
            replacements,
            companyId: company?._id?.toString()
        });
    }
    
    return { translated, replacements, original: userText };
}

// Helper: Escape regex special characters
function escapeRegex(string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ═══════════════════════════════════════════════════════════════════════════
// V36: STRIP FILLER WORDS FROM USER INPUT
// ═══════════════════════════════════════════════════════════════════════════
// Uses TWO sources (merged):
// 1. Template-level fillerWords (from Global AI Brain)
// 2. Company-level fillerWords.custom (Front Desk UI)
// 
// This cleans up "um", "uh", "like", "you know" etc. before processing.
// ═══════════════════════════════════════════════════════════════════════════
function stripFillerWords(userText, company, template) {
    if (!userText || typeof userText !== 'string') return { cleaned: userText, removed: [] };
    
    const removed = [];
    let cleaned = userText;
    
    // Build merged filler set (template + company custom)
    const fillerSet = new Set();
    
    // Source 1: Template-level fillerWords (from Global AI Brain)
    if (template?.fillerWords && Array.isArray(template.fillerWords)) {
        template.fillerWords.forEach(f => fillerSet.add(f.toLowerCase().trim()));
    }
    
    // Source 2: Company-level custom fillers (Front Desk UI)
    const customFillers = company?.aiAgentSettings?.fillerWords?.custom;
    if (customFillers && Array.isArray(customFillers)) {
        customFillers.forEach(f => fillerSet.add(f.toLowerCase().trim()));
    }
    
    // Check if filler stripping is enabled (default: true)
    const fillerEnabled = company?.aiAgentSettings?.frontDeskBehavior?.fillerWordsEnabled !== false;
    
    if (!fillerEnabled || fillerSet.size === 0) {
        return { cleaned: userText, removed: [], enabled: fillerEnabled, fillerCount: fillerSet.size };
    }
    
    // ════════════════════════════════════════════════════════════════════════
    // PROTECTED WORDS - NEVER STRIP THESE REGARDLESS OF FILLER LIST
    // These are critical for understanding caller intent
    // ════════════════════════════════════════════════════════════════════════
    const PROTECTED_WORDS = new Set([
        // Names and pronouns
        'i', 'me', 'my', 'you', 'your', 'we', 'our', 'they', 'them', 'their',
        'he', 'she', 'it', 'his', 'her', 'its',
        
        // Critical verbs
        'is', 'are', 'was', 'were', 'be', 'been', 'being',
        'have', 'has', 'had', 'do', 'does', 'did',
        'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must',
        'need', 'want', 'get', 'got', 'like',  // V88: "like" = "want" in "I like somebody here"
        'know', 'think', 'say', 'tell', 'ask', 'call',
        
        // Confirmations (critical for consent detection)
        'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'alright', 'absolutely',
        'no', 'nope', 'nah',
        
        // Question words
        'what', 'when', 'where', 'why', 'how', 'which', 'who',
        
        // Numbers (critical for phone/address)
        'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'zero',
        
        // V88 FIX: Commonly mis-tagged as fillers but are NOT fillers
        'there',   // "There's nothing happening" - existential pronoun, NOT a filler
        'please',  // "Yes, please" - politeness marker, NOT a filler
        'thanks',  // "Thanks" - gratitude expression, NOT a filler
        'thank',   // "Thank you" - gratitude expression, NOT a filler
        'hi',      // "Hi, I need help" - greeting, often has semantic meaning
        'hello',   // "Hello, is this..." - greeting with semantic meaning
        'well'     // "It's working well" - adverb, NOT a filler in most contexts
    ]);
    
    // V111: Merge company-configured protected words from UI
    const companyProtected = company?.aiAgentSettings?.frontDeskBehavior?.sttProtectedWords;
    if (companyProtected && Array.isArray(companyProtected)) {
        for (const item of companyProtected) {
            const word = (typeof item === 'string' ? item : item?.word || '').toLowerCase().trim();
            if (word) PROTECTED_WORDS.add(word);
        }
    }
    
    // Sort fillers by length (longest first) to handle multi-word fillers
    const sortedFillers = [...fillerSet]
        .filter(f => !PROTECTED_WORDS.has(f.toLowerCase()))
        .sort((a, b) => b.length - a.length);
    
    for (const filler of sortedFillers) {
        // Build regex that matches whole words/phrases
        const escaped = escapeRegex(filler);
        const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
        
        const matches = cleaned.match(regex);
        if (matches) {
            removed.push({
                phrase: filler,
                count: matches.length
            });
            cleaned = cleaned.replace(regex, ' ');
        }
    }
    
    // Clean up extra whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    // ════════════════════════════════════════════════════════════════════════
    // V87 P1: FIX STT PUNCTUATION CORRUPTION
    // ════════════════════════════════════════════════════════════════════════
    // After filler removal, we can have broken punctuation patterns like:
    // - ", and ," (orphaned commas with just conjunctions)
    // - ", , ," (multiple adjacent commas)
    // - ".. ." (adjacent periods)
    // - Leading punctuation at start of text
    // This step normalizes grammar while preserving natural sentence structure.
    // ════════════════════════════════════════════════════════════════════════
    
    // Remove duplicate consecutive punctuation (, , or . . or , .)
    cleaned = cleaned.replace(/,\s*,+/g, ',');
    cleaned = cleaned.replace(/\.\s*\.+/g, '.');
    cleaned = cleaned.replace(/[,;]\s*\./g, '.');
    cleaned = cleaned.replace(/\.\s*,/g, '.');
    
    // Remove comma-only fragments (", and ,")
    cleaned = cleaned.replace(/,\s*(and|or|but)\s*,/gi, ' $1');
    
    // Remove comma after conjunction only (", and" at start → "and")
    cleaned = cleaned.replace(/^,\s*/g, '');
    
    // Remove trailing comma before period
    cleaned = cleaned.replace(/,\s*\./g, '.');
    
    // Remove double spaces again after punctuation cleanup
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    // Capitalize first letter if it exists
    if (cleaned.length > 0) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    }
    
    // Log if fillers were removed
    if (removed.length > 0) {
        console.log('[FILLER] 🔇 Stripped filler words:', {
            original: userText,
            cleaned,
            removed: removed.map(r => `${r.phrase} (${r.count}x)`),
            templateFillers: template?.fillerWords?.length || 0,
            customFillers: customFillers?.length || 0,
            totalFillers: fillerSet.size
        });
    }
    
    return { 
        cleaned, 
        removed, 
        original: userText,
        enabled: true,
        fillerCount: fillerSet.size
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// V31: NAME SPELLING VARIANT HELPER
// Checks if a name has common spelling variants (Mark/Marc, Brian/Bryan)
// Returns { hasVariant, optionA, optionB, letterA, letterB } or null
//
// CRITICAL PERF FIX: Runtime should NEVER do O(n²) auto-scan!
// - Precomputed variants are stored in config.precomputedVariantMap (from Admin UI)
// - Runtime only does O(1) map lookup
// ═══════════════════════════════════════════════════════════════════════════
function findSpellingVariant(name, config, commonFirstNames = [], slotLevelEnabled = false) {
    // V75: Deterministic gating — require BOTH:
    // - Global master toggle (Front Desk → Booking Prompts → Name Spelling Variants)
    // - Slot-level checkbox (bookingSlots[].confirmSpelling)
    // This prevents the agent (LLM or deterministic layer) from asking spelling questions "without basis".
    const effectiveEnabled = config?.enabled === true && slotLevelEnabled === true;
    
    // V66 DEBUG: Log inputs to trace spelling variant issues
    logger.info('[SPELLING VARIANT] 🔍 V67 findSpellingVariant called', {
        name,
        hasConfig: !!config,
        configEnabled: config?.enabled,
        slotLevelEnabled,
        effectiveEnabled,
        configSource: config?.source,
        configMode: config?.mode,
        hasVariantGroups: !!config?.variantGroups,
        variantGroupsKeys: config?.variantGroups ? Object.keys(config.variantGroups).slice(0, 5) : []
    });
    
    if (!name || !effectiveEnabled) {
        logger.info('[SPELLING VARIANT] ❌ V67 Early return', { reason: !name ? 'no_name' : 'not_enabled', configEnabled: config?.enabled, slotLevelEnabled });
        return null;
    }
    
    const nameLower = name.toLowerCase();
    const mode = config.mode || '1_char_only';
    const source = config.source || 'curated_list';
    
    // Get variant groups - RUNTIME ONLY READS, NEVER COMPUTES
    let variantGroups = {};
    
    if (source === 'curated_list') {
        // Use manually curated variant groups from config
        // V69 FIX: Mongoose stores variantGroups as a subdocument, NOT a plain object!
        // We must convert to plain object first using toObject() or JSON parse/stringify
        let rawGroups = config.variantGroups || {};
        
        // V69: Convert Mongoose subdocument to plain object
        if (rawGroups && typeof rawGroups.toObject === 'function') {
            rawGroups = rawGroups.toObject();
        } else if (rawGroups && rawGroups.$__parent) {
            // Mongoose Map/subdoc detection - convert via JSON
            try {
                rawGroups = JSON.parse(JSON.stringify(rawGroups));
            } catch (e) {
                logger.warn('[SPELLING VARIANT] Failed to convert Mongoose subdoc:', e.message);
                rawGroups = {};
            }
        }
        
        // V68 DEBUG: Log raw groups to see what we're receiving
        logger.info('[SPELLING VARIANT] 🔍 V69 RAW GROUPS DEBUG', {
            hasVariantGroups: !!config.variantGroups,
            rawGroupsType: typeof rawGroups,
            isMap: rawGroups instanceof Map,
            rawGroupsKeys: Object.keys(rawGroups),
            sampleKey: Object.keys(rawGroups)[0],
            sampleValue: rawGroups[Object.keys(rawGroups)[0]]
        });
        
        // Handle both Map and plain object
        if (rawGroups instanceof Map) {
            rawGroups.forEach((variants, key) => {
                variantGroups[key.toLowerCase()] = variants.map(v => v.toLowerCase());
            });
        } else {
            Object.entries(rawGroups).forEach(([key, variants]) => {
                variantGroups[key.toLowerCase()] = Array.isArray(variants) 
                    ? variants.map(v => v.toLowerCase())
                    : [variants.toLowerCase()];
            });
        }
    } else if (source === 'auto_scan' || source === 'auto_scan_common_first_names') {
        // ═══════════════════════════════════════════════════════════════════
        // CRITICAL PERF FIX: Use PRECOMPUTED map from Admin UI
        // The O(n²) scan was computed when admin clicked "Scan Names" and saved
        // Runtime just reads the cached result - O(1) lookup!
        // ═══════════════════════════════════════════════════════════════════
        if (config.precomputedVariantMap && typeof config.precomputedVariantMap === 'object') {
            // Use precomputed map - instant O(1) lookup
            Object.entries(config.precomputedVariantMap).forEach(([key, variants]) => {
                variantGroups[key.toLowerCase()] = Array.isArray(variants)
                    ? variants.map(v => v.toLowerCase())
                    : [variants.toLowerCase()];
            });
        } else {
            // No precomputed map - admin hasn't run "Scan Names" yet
            // Fall back to empty (don't ask about variants)
            // Log warning for debugging
            console.warn('[SPELLING VARIANT] ⚠️ auto_scan mode but no precomputedVariantMap! Admin should click "Scan Names" in UI.');
            // DO NOT compute O(n²) at runtime - that blocks the call!
            return null;
        }
    }
    
    // V66 DEBUG: Log the processed variant groups
    logger.info('[SPELLING VARIANT] 🔍 V66 Variant groups processed', {
        nameLower,
        source,
        processedGroupsCount: Object.keys(variantGroups).length,
        processedGroupsKeys: Object.keys(variantGroups).slice(0, 10),
        lookingForKey: nameLower,
        hasKeyInGroups: !!variantGroups[nameLower]
    });
    
    // Check if the name has variants - O(1) lookup
    const variants = variantGroups[nameLower];
    if (!variants || variants.length === 0) {
        logger.info('[SPELLING VARIANT] ❌ V66 No variants found', { nameLower, variants });
        return null;
    }
    
    logger.info('[SPELLING VARIANT] ✅ V66 Variants found for name', { nameLower, variants });
    
    // Find the first variant that matches the mode criteria
    for (const variant of variants) {
        const distance = levenshteinDistance(nameLower, variant);
        
        // Mode check
        if (mode === '1_char_only' && distance !== 1) continue;
        // 'any_variant' accepts all variants in the list
        
        // Find the differing letters
        const { letterA, letterB } = findDifferingLetters(name, variant);
        
        return {
            hasVariant: true,
            optionA: name.charAt(0).toUpperCase() + name.slice(1).toLowerCase(),
            optionB: variant.charAt(0).toUpperCase() + variant.slice(1).toLowerCase(),
            letterA: letterA?.toUpperCase() || '',
            letterB: letterB?.toUpperCase() || ''
        };
    }
    
    return null;
}

// Helper: Calculate Levenshtein distance between two strings
function levenshteinDistance(a, b) {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    
    const matrix = [];
    for (let i = 0; i <= b.length; i++) matrix[i] = [i];
    for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
    
    for (let i = 1; i <= b.length; i++) {
        for (let j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j - 1] + 1,
                    matrix[i][j - 1] + 1,
                    matrix[i - 1][j] + 1
                );
            }
        }
    }
    return matrix[b.length][a.length];
}

// Helper: Find the differing letters between two similar names
function findDifferingLetters(name1, name2) {
    const a = name1.toLowerCase();
    const b = name2.toLowerCase();
    
    // Simple case: same length, one substitution
    if (a.length === b.length) {
        for (let i = 0; i < a.length; i++) {
            if (a[i] !== b[i]) {
                return { letterA: a[i], letterB: b[i] };
            }
        }
    }
    
    // Different lengths: find insertion/deletion
    const longer = a.length > b.length ? a : b;
    const shorter = a.length > b.length ? b : a;
    
    for (let i = 0; i < longer.length; i++) {
        if (shorter[i] !== longer[i]) {
            if (a.length > b.length) {
                return { letterA: longer[i], letterB: '' };
            } else {
                return { letterA: '', letterB: longer[i] };
            }
        }
    }
    
    // Last character is different
    return { letterA: longer[longer.length - 1], letterB: '' };
}

// ═══════════════════════════════════════════════════════════════════════════
// 🆕 FINALIZE BOOKING - Creates booking record and returns final script
// ═══════════════════════════════════════════════════════════════════════════
// Called when ALL required slots are collected and confirmed.
// Creates a BookingRequest record and returns the appropriate final script.
// 
// CORE PRINCIPLE: The AI must never imply a follow-up action
// the company did not explicitly enable.
// DEFAULT: "Confirmed on Call" - no callback assumed.
// ═══════════════════════════════════════════════════════════════════════════
async function finalizeBooking(session, company, slots, metadata = {}) {
    const log = (msg, data = {}) => {
        logger.info(`[FINALIZE BOOKING] ${msg}`, data);
    };
    
    log('🎯 Starting booking finalization', {
        sessionId: session._id?.toString(),
        companyId: company._id?.toString(),
        slots: Object.keys(slots || {}).filter(k => slots[k])
    });
    
    try {
        // ═══════════════════════════════════════════════════════════════════
        // IDEMPOTENCY GUARD: Prevent duplicate bookings from retries/replays
        // ═══════════════════════════════════════════════════════════════════
        // Check if this session already has a BookingRequest.
        // This prevents:
        // - Duplicate BookingRequest records
        // - Duplicate calendar events
        // - Wasted API calls from Twilio retries, STT replays, etc.
        // ═══════════════════════════════════════════════════════════════════
        if (session._id) {
            const existingBooking = await BookingRequest.findOne({
                sessionId: session._id,
                status: { $ne: 'CANCELLED' }
            }).lean();
            
            if (existingBooking) {
                log('⚠️ IDEMPOTENCY: Session already has booking - returning existing', {
                    existingBookingId: existingBooking._id.toString(),
                    caseId: existingBooking.caseId,
                    calendarEventId: existingBooking.calendarEventId || null,
                    createdAt: existingBooking.createdAt
                });
                
                // 🔍 BLACK BOX: Log duplicate blocked (app-level guard)
                await BlackBoxLogger.addEvent(session._id?.toString(), 'BOOKING_FINALIZE_DUPLICATE_BLOCKED', {
                    idempotentSource: 'app_level_guard',
                    existingBookingId: existingBooking._id.toString(),
                    existingCaseId: existingBooking.caseId,
                    existingCalendarEventId: existingBooking.calendarEventId || null,
                    companyId: company._id?.toString(),
                    sessionId: session._id?.toString(),
                    callSid: metadata?.callSid || null
                });
                
                // Return the existing booking result
                return {
                    success: true,
                    bookingRequestId: existingBooking._id.toString(),
                    caseId: existingBooking.caseId,
                    outcomeMode: existingBooking.outcomeMode,
                    isAsap: existingBooking.urgency === 'urgent',
                    requiresTransfer: existingBooking.outcomeMode === 'transfer_to_scheduler',
                    calendarEventId: existingBooking.calendarEventId || null,
                    calendarEventCreated: !!existingBooking.calendarEventId,
                    finalScript: existingBooking.finalScriptUsed,
                    idempotent: true,
                    idempotentSource: 'app_level_guard'
                };
            }
        }
        
        // Get booking outcome config
        const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};
        const bookingOutcome = frontDesk.bookingOutcome || {};
        const outcomeMode = bookingOutcome.mode || 'confirmed_on_call';
        
        // Determine if ASAP variant should be used
        const timePreference = slots.time?.preference || slots.time || '';
        const isAsap = typeof timePreference === 'string' && 
                       /\b(asap|urgent|emergency|today|soonest|earliest)\b/i.test(timePreference);
        const useAsapVariant = bookingOutcome.useAsapVariant !== false && isAsap;
        
        log('📋 Outcome config', {
            outcomeMode,
            isAsap,
            useAsapVariant
        });
        
        // Build slots structure for BookingRequest
        // V90: Include access data from session.booking.meta.address
        const addressMeta = session?.booking?.meta?.address || {};
        const accessData = addressMeta.access || {};
        
        const bookingSlots = {
            name: {
                first: slots.name?.first || null,
                last: slots.name?.last || null,
                full: slots.name?.full || slots.name || null
            },
            phone: slots.phone || null,
            address: {
                full: slots.address?.full || slots.address || null,
                street: slots.address?.street || null,
                city: slots.address?.city || null,
                unit: slots.address?.unit || addressMeta.unit || null,
                // V90: Property and verification fields
                propertyType: addressMeta.propertyType || null,
                unitNotApplicable: addressMeta.unitNotApplicable || false,
                // Geo verification (if available)
                formatted: addressMeta.formatted || null,
                placeId: addressMeta.placeId || null,
                lat: addressMeta.lat || null,
                lng: addressMeta.lng || null,
                verified: addressMeta.verified || false,
                verifyConfidence: addressMeta.verifyConfidence || null
            },
            // V90: Access instructions for technician dispatch
            access: {
                gatedCommunity: accessData.gatedCommunity ?? null,
                gateAccessType: Array.isArray(accessData.gateAccessType) ? accessData.gateAccessType : [],
                gateCode: accessData.gateCode || null,
                gateGuardNotifyRequired: accessData.gateGuardNotifyRequired || false,
                gateGuardNotes: accessData.gateGuardNotes || null,
                callboxName: accessData.callboxName || null,
                accessInstructions: addressMeta.accessInstructions || null,
                additionalInstructions: accessData.additionalInstructions || null,
                unitResolution: accessData.unitResolution || null,
                accessResolution: accessData.accessResolution || null
            },
            time: {
                preference: timePreference || null,
                window: slots.time?.window || null,
                isAsap: isAsap
            },
            custom: {}
        };
        
        // Add any custom slots
        const standardSlots = ['name', 'phone', 'address', 'time', 'partialName', 'access', 'propertyType', 'unit', 'unitNotApplicable', 'accessInstructions'];
        for (const [key, value] of Object.entries(slots)) {
            if (!standardSlots.includes(key) && value) {
                bookingSlots.custom.set ? bookingSlots.custom.set(key, value) : (bookingSlots.custom[key] = value);
            }
        }
        
        // 🔍 BLACK BOX: Log access snapshot for audit
        const hasAccessData = bookingSlots.access.gatedCommunity !== null || 
                              bookingSlots.access.gateCode || 
                              bookingSlots.access.accessInstructions ||
                              bookingSlots.address.propertyType;
        if (hasAccessData) {
            await BlackBoxLogger.addEvent(session._id?.toString(), 'BOOKING_ACCESS_SNAPSHOT_SAVED', {
                propertyType: bookingSlots.address.propertyType,
                unit: bookingSlots.address.unit,
                unitNotApplicable: bookingSlots.address.unitNotApplicable,
                gatedCommunity: bookingSlots.access.gatedCommunity,
                gateAccessType: bookingSlots.access.gateAccessType,
                hasGateCode: !!bookingSlots.access.gateCode,
                hasAccessInstructions: !!bookingSlots.access.accessInstructions
            });
        }
        
        // Generate case ID
        const caseId = BookingRequest.generateCaseId();
        
        // Map outcome mode to status
        const statusMap = {
            'confirmed_on_call': 'FAKE_CONFIRMED',
            'pending_dispatch': 'PENDING_DISPATCH',
            'callback_required': 'CALLBACK_QUEUED',
            'transfer_to_scheduler': 'TRANSFERRED',
            'after_hours_hold': 'AFTER_HOURS'
        };
        
        // Create BookingRequest record
        // ═══════════════════════════════════════════════════════════════════
        // RACE CONDITION SAFETY: Wrap in try-catch for E11000 duplicate key
        // Even with app-level guard, two requests can race past it.
        // The unique index will reject one - we catch that and return existing.
        // ═══════════════════════════════════════════════════════════════════
        let bookingRequest;
        
        try {
            bookingRequest = new BookingRequest({
                companyId: company._id,
                sessionId: session._id,
                customerId: session.customerId || null,
                ruleId: metadata.ruleId || null,
                trade: company.trade || null,
                serviceType: metadata.serviceType || null,
                status: statusMap[outcomeMode] || 'FAKE_CONFIRMED',
                outcomeMode: outcomeMode,
                slots: bookingSlots,
                issue: session.discovery?.issue || null,
                issueSummary: session.discoverySummary || null,
                urgency: isAsap ? 'urgent' : 'normal',
                caseId: caseId,
                channel: metadata.channel || 'phone',
                callSid: metadata.callSid || null,
                callerPhone: metadata.callerPhone || null,
                createdAt: new Date(),
                completedAt: new Date()
            });
            
            await bookingRequest.save();
            
            log('✅ BookingRequest created', {
                bookingRequestId: bookingRequest._id.toString(),
                caseId: caseId,
                status: bookingRequest.status,
                outcomeMode: outcomeMode
            });
            
        } catch (saveErr) {
            // ═══════════════════════════════════════════════════════════════
            // E11000: Duplicate key error from unique index
            // This means another request already created a booking for this session
            // ═══════════════════════════════════════════════════════════════
            if (saveErr?.code === 11000 && saveErr?.keyPattern?.sessionId) {
                log('⚠️ IDEMPOTENCY(DB): Duplicate key prevented by index - fetching existing booking', {
                    sessionId: session._id?.toString(),
                    errorCode: saveErr.code
                });
                
                const existingBooking = await BookingRequest.findOne({
                    sessionId: session._id,
                    status: { $ne: 'CANCELLED' }
                }).lean();
                
                if (existingBooking) {
                    // 🔍 BLACK BOX: Log duplicate blocked (DB-level guard / race condition)
                    await BlackBoxLogger.addEvent(session._id?.toString(), 'BOOKING_FINALIZE_DUPLICATE_BLOCKED', {
                        idempotentSource: 'db_unique_index',
                        raceConditionCaught: true,
                        existingBookingId: existingBooking._id?.toString(),
                        existingCaseId: existingBooking.caseId,
                        existingCalendarEventId: existingBooking.calendarEventId || null,
                        companyId: company._id?.toString(),
                        sessionId: session._id?.toString(),
                        callSid: metadata?.callSid || null,
                        mongoErrorCode: 11000
                    });
                    
                    return {
                        success: true,
                        bookingRequestId: existingBooking._id?.toString(),
                        caseId: existingBooking.caseId || null,
                        outcomeMode: existingBooking.outcomeMode || null,
                        isAsap: existingBooking.urgency === 'urgent',
                        requiresTransfer: existingBooking.outcomeMode === 'transfer_to_scheduler',
                        calendarEventId: existingBooking.calendarEventId || null,
                        calendarEventLink: existingBooking.calendarEventLink || null,
                        calendarEventCreated: !!existingBooking.calendarEventId,
                        finalScript: existingBooking.finalScriptUsed || null,
                        idempotent: true,
                        idempotentSource: 'db_unique_index'
                    };
                }
            }
            
            // Not a duplicate key error - rethrow
            throw saveErr;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // 📅 GOOGLE CALENDAR INTEGRATION - V88 (Jan 2026)
        // Create calendar event if calendar is connected and enabled
        // ═══════════════════════════════════════════════════════════════════
        // 📅 GOOGLE CALENDAR EVENT CREATION
        // ═══════════════════════════════════════════════════════════════════
        let calendarResult = null;
        const calendarConfig = company.googleCalendar;
        
        // 🔍 BLACK BOX: Log calendar config check
        await BlackBoxLogger.addEvent(session._id?.toString(), 'CALENDAR_CHECK', {
            enabled: calendarConfig?.enabled || false,
            connected: calendarConfig?.connected || false,
            calendarId: calendarConfig?.calendarId || 'primary',
            hasAccessToken: !!calendarConfig?.accessToken,
            connectedAt: calendarConfig?.connectedAt || null,
            willAttemptCreate: !!(calendarConfig?.enabled && calendarConfig?.connected)
        });
        
        if (calendarConfig?.enabled && calendarConfig?.connected) {
            log('📅 Creating Google Calendar event...');
            try {
                // Determine appointment time
                // V88: Use confirmed calendar slot if available
                let appointmentTime = null;
                let timeSource = 'fallback_next_business_day';
                const bookingMeta = session?.booking?.meta?.time || {};
                
                if (bookingMeta.calendarSlot?.start) {
                    // Real-time confirmed slot from calendar
                    appointmentTime = new Date(bookingMeta.calendarSlot.start);
                    timeSource = 'confirmed_calendar_slot';
                    log('📅 Using confirmed calendar slot', { start: appointmentTime });
                } else if (session?.booking?.confirmedSlot?.start) {
                    // Alternative location for confirmed slot
                    appointmentTime = new Date(session.booking.confirmedSlot.start);
                    timeSource = 'session_confirmed_slot';
                    log('📅 Using session confirmed slot', { start: appointmentTime });
                } else if (slots.time?.confirmedSlot) {
                    appointmentTime = new Date(slots.time.confirmedSlot);
                    timeSource = 'slots_confirmed_slot';
                } else {
                    // Use next available business day at 9 AM as placeholder
                    // The real time will be confirmed by human
                    const tomorrow = new Date();
                    tomorrow.setDate(tomorrow.getDate() + 1);
                    tomorrow.setHours(9, 0, 0, 0);
                    // Skip weekends
                    while (tomorrow.getDay() === 0 || tomorrow.getDay() === 6) {
                        tomorrow.setDate(tomorrow.getDate() + 1);
                    }
                    appointmentTime = tomorrow;
                }
                
                // Build event data
                // V90: Include access info for technician dispatch
                const eventData = {
                    customerName: bookingSlots.name?.full || `${bookingSlots.name?.first || ''} ${bookingSlots.name?.last || ''}`.trim() || 'Customer',
                    customerPhone: bookingSlots.phone || metadata.callerPhone || null,
                    customerEmail: slots.email || null,
                    customerAddress: bookingSlots.address?.full || null,
                    serviceType: metadata.serviceType || session.discovery?.issue || 'Service Call',
                    serviceNotes: session.discovery?.summary || session.discoverySummary || null,
                    startTime: appointmentTime,
                    // V90: Access data for technician
                    accessInfo: {
                        unit: bookingSlots.address?.unit || null,
                        propertyType: bookingSlots.address?.propertyType || null,
                        gatedCommunity: bookingSlots.access?.gatedCommunity,
                        gateCode: bookingSlots.access?.gateCode || null,
                        gateAccessType: bookingSlots.access?.gateAccessType || [],
                        accessInstructions: bookingSlots.access?.accessInstructions || null,
                        additionalInstructions: bookingSlots.access?.additionalInstructions || null
                    }
                };
                
                // 🔍 BLACK BOX: Log calendar event attempt
                await BlackBoxLogger.addEvent(session._id?.toString(), 'CALENDAR_EVENT_ATTEMPT', {
                    companyId: company._id.toString(),
                    timeSource,
                    appointmentTime: appointmentTime?.toISOString(),
                    eventData: {
                        customerName: eventData.customerName,
                        customerPhone: eventData.customerPhone ? '***' + eventData.customerPhone.slice(-4) : null,
                        customerAddress: eventData.customerAddress,
                        serviceType: eventData.serviceType,
                        hasNotes: !!eventData.serviceNotes
                    }
                });
                
                calendarResult = await GoogleCalendarService.createBookingEvent(
                    company._id.toString(),
                    eventData
                );
                
                if (calendarResult.success) {
                    log('📅 ✅ Calendar event created', {
                        eventId: calendarResult.eventId,
                        start: calendarResult.start
                    });
                    
                    // 🔍 BLACK BOX: Log success
                    await BlackBoxLogger.addEvent(session._id?.toString(), 'CALENDAR_EVENT_CREATED', {
                        success: true,
                        eventId: calendarResult.eventId,
                        eventLink: calendarResult.eventLink,
                        start: calendarResult.start,
                        end: calendarResult.end,
                        colorId: calendarResult.colorId
                    });
                    
                    // Store calendar event reference in booking request
                    bookingRequest.calendarEventId = calendarResult.eventId;
                    bookingRequest.calendarEventLink = calendarResult.eventLink;
                    bookingRequest.calendarEventStart = calendarResult.start;
                    bookingRequest.calendarEventEnd = calendarResult.end;
                    bookingRequest.calendarCreatedAt = new Date();
                    await bookingRequest.save();
                } else {
                    log('📅 ⚠️ Calendar event creation failed (will use fallback)', {
                        error: calendarResult.error,
                        fallback: calendarResult.fallback
                    });
                    
                    // 🔍 BLACK BOX: Log failure
                    await BlackBoxLogger.addEvent(session._id?.toString(), 'CALENDAR_EVENT_FAILED', {
                        success: false,
                        error: calendarResult.error,
                        fallback: calendarResult.fallback,
                        willContinueWithoutCalendar: true
                    });
                }
            } catch (calendarError) {
                log('📅 ❌ Calendar integration error (continuing without calendar)', {
                    error: calendarError.message
                });
                // Don't fail the booking - just continue without calendar event
            }
        }
        
        // Get the final script
        let finalScript;
        
        // Check for custom override first
        if (bookingOutcome.customFinalScript) {
            finalScript = bookingOutcome.customFinalScript;
        }
        // Check for ASAP variant
        else if (useAsapVariant && bookingOutcome.asapVariantScript) {
            finalScript = bookingOutcome.asapVariantScript;
        }
        // Use mode-specific script
        else {
            const finalScripts = bookingOutcome.finalScripts || {};
            finalScript = finalScripts[outcomeMode] || getDefaultFinalScript(outcomeMode);
        }
        
        // Populate placeholders in final script
        const populatedScript = bookingRequest.populateFinalScript(finalScript);
        
        // Store final script used for audit
        bookingRequest.finalScriptUsed = populatedScript;
        await bookingRequest.save();
        
        log('📝 Final script generated', {
            outcomeMode,
            useAsapVariant,
            scriptPreview: populatedScript.substring(0, 100)
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // 📱 SMS NOTIFICATIONS - V88 (Jan 2026)
        // Send confirmation SMS and schedule reminders (non-blocking)
        // ═══════════════════════════════════════════════════════════════════
        const smsConfig = company.smsNotifications;
        
        // 🔍 BLACK BOX: Log SMS config
        BlackBoxLogger.addEvent(session._id?.toString(), 'SMS_CHECK', {
            enabled: smsConfig?.enabled || false,
            confirmationEnabled: smsConfig?.confirmation?.enabled || false,
            hasTwilioCredentials: !!(company.twilioConfig?.accountSid),
            customerPhone: bookingSlots.phone ? '***' + bookingSlots.phone.slice(-4) : null
        }).catch(() => {});
        
        (async () => {
            try {
                // Send confirmation SMS
                const confirmResult = await SMSNotificationService.sendBookingConfirmation(
                    company._id.toString(),
                    bookingRequest
                );
                
                if (confirmResult.success && !confirmResult.skipped) {
                    log('📱 ✅ Confirmation SMS sent', { messageId: confirmResult.messageId });
                    BlackBoxLogger.addEvent(session._id?.toString(), 'SMS_SENT', {
                        type: 'confirmation', messageId: confirmResult.messageId
                    }).catch(() => {});
                } else if (confirmResult.scheduled) {
                    log('📱 ⏰ Confirmation SMS scheduled (quiet hours)', { 
                        scheduledFor: confirmResult.scheduledFor 
                    });
                    BlackBoxLogger.addEvent(session._id?.toString(), 'SMS_SCHEDULED', {
                        type: 'confirmation', scheduledFor: confirmResult.scheduledFor
                    }).catch(() => {});
                } else if (confirmResult.skipped) {
                    BlackBoxLogger.addEvent(session._id?.toString(), 'SMS_SKIPPED', {
                        reason: confirmResult.reason || 'disabled'
                    }).catch(() => {});
                }
                
                // Schedule reminders if we have an appointment time
                if (bookingRequest.calendarEventStart || bookingSlots.time?.confirmedSlot) {
                    const reminderResult = await SMSNotificationService.scheduleReminders(
                        company._id.toString(),
                        bookingRequest
                    );
                    
                    if (reminderResult.success) {
                        log('📱 ✅ Reminders scheduled', { 
                            reminders: reminderResult.scheduled 
                        });
                        BlackBoxLogger.addEvent(session._id?.toString(), 'SMS_REMINDERS_SCHEDULED', {
                            count: reminderResult.scheduled?.length || 0
                        }).catch(() => {});
                    }
                }
            } catch (smsErr) {
                // Don't fail booking if SMS fails
                log('📱 ⚠️ SMS notification error (non-blocking)', { 
                    error: smsErr.message 
                });
                BlackBoxLogger.addEvent(session._id?.toString(), 'SMS_ERROR', {
                    error: smsErr.message
                }).catch(() => {});
            }
        })();
        
        // 🔍 BLACK BOX: Final booking summary
        await BlackBoxLogger.addEvent(session._id?.toString(), 'BOOKING_FINALIZED', {
            success: true,
            bookingRequestId: bookingRequest._id.toString(),
            caseId: caseId,
            status: bookingRequest.status,
            outcomeMode: outcomeMode,
            isAsap: isAsap,
            calendarEventCreated: !!calendarResult?.success,
            calendarEventId: calendarResult?.eventId || null,
            slotsCollected: {
                name: !!bookingSlots.name?.full || !!bookingSlots.name?.first,
                phone: !!bookingSlots.phone,
                address: !!bookingSlots.address?.full,
                time: !!bookingSlots.time?.full || !!bookingSlots.time?.preference
            }
        });
        
        return {
            success: true,
            bookingRequestId: bookingRequest._id.toString(),
            caseId: caseId,
            status: bookingRequest.status,
            outcomeMode: outcomeMode,
            finalScript: populatedScript,
            isAsap: isAsap,
            // For transfer mode, include transfer flag
            requiresTransfer: outcomeMode === 'transfer_to_scheduler'
        };
        
    } catch (error) {
        log('❌ Booking finalization failed', {
            error: error.message,
            stack: error.stack
        });
        
        // Return a safe fallback
        return {
            success: false,
            error: error.message,
            finalScript: "Thank you for your information. We'll be in touch shortly.",
            outcomeMode: 'confirmed_on_call',
            requiresTransfer: false
        };
    }
}

function mapOutcomeModeToKpiBookingOutcome(outcomeMode) {
    const mode = (outcomeMode || '').toString();
    // MVP: we treat "confirmed_on_call" and similar as a CONFIRMED_REQUEST (revenue-safe).
    // If/when you add real calendar scheduling, map those modes to SCHEDULED.
    if (['confirmed_on_call', 'pending_dispatch', 'after_hours_hold', 'callback_required'].includes(mode)) {
        return 'CONFIRMED_REQUEST';
    }
    return 'NONE';
}

// Default final scripts (LAST-RESORT SAFETY NET)
// DEFAULT - OVERRIDE IN UI:
// Configure these in Control Plane → Front Desk → Booking Prompts → Booking Outcome.
function getDefaultFinalScript(mode) {
    const defaults = {
        'confirmed_on_call': "Perfect, {name}. You're all set. Your appointment is scheduled for {timePreference}. If anything changes, you can call us back anytime. Is there anything else I can help you with today?",
        'pending_dispatch': "Thanks, {name}. I've logged everything and sent it to dispatch. They'll review and confirm the time shortly. Anything else I can help with?",
        'callback_required': "Thanks, {name}. A team member will reach out shortly to finalize your appointment. Is there anything else?",
        'transfer_to_scheduler': "I'm going to transfer you now to our scheduler to get this confirmed.",
        'after_hours_hold': "We're currently closed, but I've captured your request. We'll follow up first thing when we open. If this is urgent, I can transfer you now."
    };
    return defaults[mode] || defaults['confirmed_on_call'];
}

// ═══════════════════════════════════════════════════════════════════════════
// 🆕 CONSENT DETECTOR - Checks if caller explicitly wants to book
// ═══════════════════════════════════════════════════════════════════════════
// Uses ONLY UI-configured phrases from detectionTriggers.wantsBooking[]
// Does NOT use hardcoded regex (broken/fix/need help are DISCOVERY, not consent)
// V94: Now uses AWConfigReader for traced reads (CONFIG_READ events)
// ═══════════════════════════════════════════════════════════════════════════
const ConsentDetector = {
    /**
     * Check if user input contains explicit booking consent
     * @param {string} text - User input
     * @param {Object} company - Company config with detectionTriggers
     * @param {Object} session - Session with consent state
     * @param {Object} [awReader] - V94: AWConfigReader for traced config reads
     * @returns {Object} { hasConsent, matchedPhrase, reason }
     */
    checkForConsent(text, company, session, awReader = null) {
        if (!text || typeof text !== 'string') {
            return { hasConsent: false, matchedPhrase: null, reason: 'no_input' };
        }
        
        const textLower = text.toLowerCase().trim();
        
        // ═══════════════════════════════════════════════════════════════════════
        // V94: Use AWConfigReader for traced reads (CONFIG_READ events)
        // This enables AW ⇄ RE marriage for consent detection
        // ═══════════════════════════════════════════════════════════════════════
        let requiresExplicitConsent, consentPhrases;
        
        // V96j: All config reads via AWConfigReader for single config gate compliance
        let consentYesWordsCustom = [];
        let requiresYesAfterPrompt = true;
        
        if (awReader && typeof awReader.get === 'function') {
            awReader.setReaderId('ConsentDetector.checkForConsent');
            requiresExplicitConsent = awReader.get('frontDesk.discoveryConsent.bookingRequiresExplicitConsent', true);
            consentPhrases = awReader.getArray('frontDesk.detectionTriggers.wantsBooking');
            consentYesWordsCustom = awReader.getArray('frontDesk.discoveryConsent.consentYesWords');
            requiresYesAfterPrompt = awReader.get('frontDesk.discoveryConsent.consentRequiresYesAfterPrompt', true) !== false;
        } else {
            // Fallback: direct access (no tracing) - V96j: Log warning for DEAD_READ tracking
            logger.warn('[CONSENT DETECTOR] ⚠️ No AWConfigReader - using fallback (untraced reads)', {
                callId: session?.callId || 'unknown'
            });
            const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};
            const discoveryConsent = frontDesk.discoveryConsent || {};
            const detectionTriggers = frontDesk.detectionTriggers || {};
            requiresExplicitConsent = discoveryConsent.bookingRequiresExplicitConsent !== false;
            consentPhrases = detectionTriggers.wantsBooking || [];
            consentYesWordsCustom = Array.isArray(discoveryConsent.consentYesWords) ? discoveryConsent.consentYesWords : [];
            requiresYesAfterPrompt = discoveryConsent.consentRequiresYesAfterPrompt !== false;
        }
        
        if (!requiresExplicitConsent) {
            // Legacy mode: consent not required (not recommended)
            return { hasConsent: true, matchedPhrase: 'legacy_mode', reason: 'consent_not_required' };
        }
        
        // ═══════════════════════════════════════════════════════════════
        // V110: Consent = the caller saying "yes" to the scheduling offer
        // ═══════════════════════════════════════════════════════════════
        // In V110, scenarios offer scheduling. The caller must accept.
        // This consent detector works exactly as designed — it detects
        // "yes", "schedule", "book it", "please do", etc.
        // No bypass needed. The consent mechanism IS the scheduling
        // acceptance detector.
        // ═══════════════════════════════════════════════════════════════
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: DEFAULT CONSENT YES WORDS (ALWAYS included, can be extended by config)
        // ═══════════════════════════════════════════════════════════════════════
        // These are the baseline agreement words that should ALWAYS work.
        // Company config can ADD to this list but never fully override it.
        const DEFAULT_CONSENT_YES_WORDS = [
            'yes', 'yeah', 'yep', 'please', 'sure', 'okay', 'ok', 'alright',
            'absolutely', 'definitely', 'certainly', 'of course', 'sounds good',
            'that would be great', 'let\'s do it', 'go ahead', 'perfect',
            // FEB 2026: More natural agreement phrases
            'smart idea', 'good idea', 'great idea', 'that works', 'works for me',
            'i think so', 'think so', 'i agree', 'that\'d be', 'that would be',
            'right', 'right away', 'asap', 'soon as possible', 'as soon as'
        ];
        
        // V96j: Use consentYesWordsCustom already read via AWConfigReader above
        const consentYesWords = [...new Set([...DEFAULT_CONSENT_YES_WORDS, ...consentYesWordsCustom])];
        // Note: requiresYesAfterPrompt already set above via AWConfigReader
        
        // Check for explicit booking phrases from UI config
        for (const phrase of consentPhrases) {
            if (phrase && textLower.includes(phrase.toLowerCase())) {
                return { 
                    hasConsent: true, 
                    matchedPhrase: phrase, 
                    reason: 'explicit_consent_phrase' 
                };
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // SMART YES DETECTION - Check if caller is saying "yes" to booking
        // ═══════════════════════════════════════════════════════════════════
        // This catches: "yes", "yes please", "yes can you please", "yeah", etc.
        // We check if the AI just asked about scheduling in the last turn
        // ═══════════════════════════════════════════════════════════════════
        
        // V81 FIX: If user is ASKING A QUESTION, don't treat acknowledgments as consent
        // "Okay, do you know who was out here?" → NOT consent, it's a question!
        const userAskedQuestion = textLower.trim().endsWith('?');
        if (userAskedQuestion) {
            // User is asking a question - "okay" at the start is just conversational
            return { hasConsent: false, matchedPhrase: null, reason: 'user_asked_question' };
        }
        
        // V81 FIX: If user says "okay" but then has 10+ more words, they're not consenting
        // They're acknowledging and then saying something else
        const words = textLower.split(/\s+/).filter(w => w.length > 0);
        const firstWord = words[0] || '';
        const acknowledgmentWords = ['okay', 'ok', 'alright', 'sure'];
        const isJustAcknowledgment = acknowledgmentWords.includes(firstWord) && words.length > 8;
        if (isJustAcknowledgment) {
            return { hasConsent: false, matchedPhrase: null, reason: 'acknowledgment_with_followup' };
        }
        
        // Check if last AI response asked about/offered scheduling
        const lastTurns = session?.turns || [];
        const lastAssistantTurn = [...lastTurns].reverse().find(t => t.role === 'assistant');
        const lastAssistantText = (lastAssistantTurn?.content || '').toLowerCase();
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: DIAGNOSTIC LOGGING - WHY ISN'T CONSENT DETECTED?
        // ═══════════════════════════════════════════════════════════════════════
        const logger = require('../utils/logger');
        logger.debug('[CONSENT CHECK] Checking consent...', {
            userInput: textLower.substring(0, 50),
            turnsCount: lastTurns.length,
            lastAssistantTextPreview: lastAssistantText.substring(0, 100),
            hasAskedConsentQuestion: session.conversationMemory?.askedConsentQuestion
        });
        
        // FEB 2026 FIX: Expanded booking offer detection phrases
        const askedAboutScheduling = lastAssistantText.includes('schedule') || 
                                     lastAssistantText.includes('appointment') ||
                                     lastAssistantText.includes('technician') ||
                                     lastAssistantText.includes('come out') ||
                                     lastAssistantText.includes('back out') ||  // "get someone back out"
                                     lastAssistantText.includes('send') ||       // "send a tech"
                                     lastAssistantText.includes('get someone') || // "let me get someone"
                                     lastAssistantText.includes('set up') ||     // "get that set up"
                                     lastAssistantText.includes('book') ||       // "book a visit"
                                     session.conversationMemory?.askedConsentQuestion;
        
        logger.debug('[CONSENT CHECK] Scheduling offer check', {
            askedAboutScheduling,
            hasSchedule: lastAssistantText.includes('schedule'),
            hasBackOut: lastAssistantText.includes('back out'),
            hasGetSomeone: lastAssistantText.includes('get someone'),
            hasTechnician: lastAssistantText.includes('technician'),
            hasComeOut: lastAssistantText.includes('come out')
        });
        
        if (askedAboutScheduling) {
            // Check for yes words anywhere in the response
            for (const yesWord of consentYesWords) {
                // More flexible matching: "yes", "yes please", "yes can you", etc.
                if (textLower.includes(yesWord)) {
                    // Make sure it's not a negative context like "yes but no" or "not yes"
                    const negatives = ['no', 'not', "don't", "can't", 'never'];
                    const hasNegative = negatives.some(neg => textLower.includes(neg));
                    
                    if (!hasNegative) {
                        logger.info('[CONSENT CHECK] ✅ CONSENT DETECTED!', {
                            matchedPhrase: yesWord,
                            userInput: textLower,
                            lastAssistantTextPreview: lastAssistantText.substring(0, 100)
                        });
                        return { 
                            hasConsent: true, 
                            matchedPhrase: yesWord, 
                            reason: 'yes_after_scheduling_offer' 
                        };
                    }
                }
            }
            logger.debug('[CONSENT CHECK] No yes word match in consent check', {
                userInput: textLower,
                yesWordsChecked: consentYesWords.length,
                hasRight: textLower.includes('right'),
                hasYes: textLower.includes('yes')
            });
        } else {
            logger.debug('[CONSENT CHECK] Not checking yes words - no scheduling offer detected', {
                lastAssistantTextPreview: lastAssistantText.substring(0, 100)
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // IMPORTANT: No hardcoded booking-consent triggers.
        // If you want phrases like "ASAP" or "send someone" to count as consent,
        // add them to UI → Discovery & Consent Gate → Consent Phrases.
        // ═══════════════════════════════════════════════════════════════════
        
        return { hasConsent: false, matchedPhrase: null, reason: 'no_consent_detected' };
    },
    
    /**
     * Check if minimum discovery fields are met before asking consent
     * @param {Object} session - Session with discovery data
     * @param {Object} company - Company config
     * @returns {boolean}
     */
    canAskConsentQuestion(session, company) {
        const discoveryConsent = company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
        const minFields = discoveryConsent.minDiscoveryFieldsBeforeConsent || ['issueSummary'];
        
        for (const field of minFields) {
            switch (field) {
                case 'issueSummary':
                    if (!session.discovery?.issue) return false;
                    break;
                case 'serviceType':
                    if (!session.discovery?.callType || session.discovery.callType === 'unknown') return false;
                    break;
                case 'urgency':
                    if (!session.discovery?.urgency) return false;
                    break;
                case 'existingCustomer':
                    if (!session.customerId) return false;
                    break;
            }
        }
        return true;
    }
};

/**
 * Parse user's selection from offered time slots (V88 Google Calendar)
 * Handles: "the first one", "tomorrow", "2pm", "Monday at 10", etc.
 * @param {string} userText - User's response
 * @param {Array} offeredSlots - Previously offered slots [{start, end, display}]
 * @returns {Object|null} Selected slot or null if no match
 */
function parseSlotSelection(userText, offeredSlots) {
    if (!userText || !offeredSlots || offeredSlots.length === 0) return null;
    
    const lower = userText.toLowerCase().trim();
    
    // V88 FIX: Handle "you just said it", "that's the earliest", "that one"
    // These indicate user wants the first/most-recently-mentioned slot
    const firstSlotConfirmations = [
        'you just said', 'you said it', 'that\'s the earliest', 'the earliest',
        'that one', 'that time', 'that works', 'let\'s do that', 'sounds good',
        'perfect', 'yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'great'
    ];
    
    // If only one slot offered, any confirmation selects it
    if (offeredSlots.length === 1 && firstSlotConfirmations.some(p => lower.includes(p))) {
        return offeredSlots[0];
    }
    
    // "earliest" or "soonest" = first slot (slots are in chronological order)
    if (/\b(earliest|soonest|first available)\b/.test(lower)) {
        return offeredSlots[0];
    }
    
    // Ordinal selection: "the first one", "second", "number 3"
    const ordinalMap = {
        'first': 0, '1st': 0, 'one': 0, 'first one': 0, 'option 1': 0, 'number 1': 0,
        'second': 1, '2nd': 1, 'two': 1, 'second one': 1, 'option 2': 1, 'number 2': 1,
        'third': 2, '3rd': 2, 'three': 2, 'third one': 2, 'option 3': 2, 'number 3': 2,
        'last': offeredSlots.length - 1, 'last one': offeredSlots.length - 1
    };
    
    for (const [phrase, index] of Object.entries(ordinalMap)) {
        if (lower.includes(phrase) && offeredSlots[index]) {
            return offeredSlots[index];
        }
    }
    
    // Day matching: "today", "tomorrow", "monday"
    const dayKeywords = {
        'today': 'today',
        'tomorrow': 'tomorrow',
        'monday': 'monday', 'tuesday': 'tuesday', 'wednesday': 'wednesday',
        'thursday': 'thursday', 'friday': 'friday', 'saturday': 'saturday', 'sunday': 'sunday'
    };
    
    for (const [keyword, dayPart] of Object.entries(dayKeywords)) {
        if (lower.includes(keyword)) {
            const match = offeredSlots.find(s => 
                s.display.toLowerCase().includes(dayPart)
            );
            if (match) return match;
        }
    }
    
    // Time matching (STRICT):
    // Only treat something as a time if caller used:
    // - explicit AM/PM (e.g., "10am", "2 pm")
    // - a colon time (e.g., "12:15")
    // - or a context word like "at/around/by" before the number
    //
    // This prevents catastrophic false positives from addresses like "12155..."
    const explicitTimeMatch =
        lower.match(/\b(\d{1,2})(?::(\d{2}))\s*(am|pm)?\b/) ||
        lower.match(/\b(\d{1,2})\s*(am|pm)\b/) ||
        lower.match(/\b(?:at|around|by)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/);

    if (explicitTimeMatch) {
        // Normalize capture groups across patterns
        const hourStr = explicitTimeMatch[1];
        const minuteStr = explicitTimeMatch[2] && /^\d{2}$/.test(explicitTimeMatch[2]) ? explicitTimeMatch[2] : null;
        const periodStr = explicitTimeMatch[3] || explicitTimeMatch[2]; // handles pattern 2 where [2] is am/pm

        const hour = parseInt(hourStr, 10);
        if (Number.isFinite(hour) && hour >= 1 && hour <= 12) {
            const period = periodStr ? String(periodStr).toLowerCase() : null;
            const isPm = period === 'pm';
            const searchHour = isPm && hour < 12 ? hour + 12 : (!isPm && hour === 12 ? 0 : hour);

            const match = offeredSlots.find(s => {
                const slotHour = s.start.getHours();
                if (minuteStr) {
                    const slotMin = s.start.getMinutes();
                    return slotHour === searchHour && slotMin === parseInt(minuteStr, 10);
                }
                return slotHour === searchHour;
            });
            if (match) return match;
        }
    }
    
    // Generic affirmative for single slot
    if (offeredSlots.length === 1) {
        const affirmatives = ['yes', 'yeah', 'sure', 'ok', 'okay', 'sounds good', 'that works', 'perfect', 'great'];
        if (affirmatives.some(a => lower.includes(a))) {
            return offeredSlots[0];
        }
    }
    
    // Direct display match
    for (const slot of offeredSlots) {
        const displayLower = slot.display.toLowerCase();
        // Check if the user repeated part of the display text
        const displayParts = displayLower.split(/\s+at\s+|\s+/);
        for (const part of displayParts) {
            if (part.length > 3 && lower.includes(part)) {
                return slot;
            }
        }
    }
    
    return null;
}

/**
 * Programmatic slot extraction helpers
 * These extract obvious data (name, phone, address) before LLM processing
 */
const SlotExtractors = {
    /**
     * Extract name from user input
     * V32: Robust extraction from sentences + stop word filtering
     * V36: Now accepts customStopWords from company config (UI-controlled)
     * Handles: "hi my name is Mark do you have any issues" → "Mark"
     * Blocks: "yes go ahead" → null (not a name)
     */
    extractName(text, { expectingName = false, customStopWords = [] } = {}) {
        return extractNameDeterministic(text, { expectingName, customStopWords });
    },
    
    /**
     * Extract phone number from user input
     * V37 FIX: More forgiving - handle typos, extra digits, 7-digit local numbers
     */
    extractPhone(text) {
        const { extractPhoneFromText } = require('../utils/phone');
        const extracted = extractPhoneFromText(text);
        if (extracted) {
            logger.info('[PHONE EXTRACT] ✅ Extracted phone', { raw: text?.substring?.(0, 80) || text, extracted });
        }
        return extracted;
    },
    
    /**
     * Extract address from user input
     * V34 FIX: Accept FULL addresses with city/state/zip in one shot
     * "12155 Metro Parkway Fort Myers Florida 33966" → complete address
     */
    extractAddress(text) {
        if (!text || typeof text !== 'string') return null;
        
        const lower = text.toLowerCase();
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V92 FIX: REJECT TIME PHRASES THAT LOOK LIKE ADDRESSES
        // "2 weeks ago" matched as address because it's "number + words"
        // These are CATEGORICALLY NOT addresses - reject them FIRST
        // ═══════════════════════════════════════════════════════════════════════════
        const TIME_PHRASE_BLOCKLIST = /\b\d+\s*(weeks?|days?|months?|years?|hours?|minutes?)\s*(ago|later|from now|back|prior|before|since|now)\b/i;
        if (TIME_PHRASE_BLOCKLIST.test(text)) {
            logger.debug('[SLOT EXTRACTORS] Address rejected: matches time phrase pattern', { text: text.substring(0, 50) });
            return null;
        }
        
        // Also reject if it contains obvious time context words
        const TIME_CONTEXT_WORDS = ['yesterday', 'today', 'tomorrow', 'ago', 'since', 'later', 'earlier', 'recently', 'last week', 'last month', 'last year'];
        for (const timeWord of TIME_CONTEXT_WORDS) {
            if (lower.includes(timeWord)) {
                logger.debug('[SLOT EXTRACTORS] Address rejected: contains time context word', { text: text.substring(0, 50), timeWord });
                return null;
            }
        }
        
        // Filter out common complaint phrases that might have numbers
        const complaintPhrases = ['not cooling', 'not working', 'system', 'unit', 'years old', 'degrees', 'broken', 'issue'];
        for (const phrase of complaintPhrases) {
            if (lower.includes(phrase)) {
                return null;
            }
        }
        
        // Must have a street number
        const hasStreetNumber = /\b\d{1,5}\s+\w+/.test(text);
        if (!hasStreetNumber) return null;
        
        // Street types (comprehensive)
        const streetTypes = /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|loop|alley|aly|path|crossing|xing|square|sq|plaza|plz|commons|point|pt|ridge|run|pass|grove|park|estates|meadow|meadows|valley|hills|heights|view|vista|landing|springs|creek|glen|cove|bay|beach|shore|pointe)\b/i;
        
        // Check for street type
        if (!streetTypes.test(text)) return null;
        
        // V48 FIX: Check for ZIP code (but NOT street numbers!)
        // A street number like "12155" should not be detected as a ZIP code
        const words = text.split(/\s+/);
        const firstWord = words[0] || '';
        const zipMatches = text.match(/\b(\d{5})(-\d{4})?\b/g) || [];
        let hasZip = false;
        for (const zipMatch of zipMatches) {
            const zipDigits = zipMatch.replace(/-\d{4}$/, '');
            // If this 5-digit number is the first word, it's likely a street number
            if (firstWord === zipDigits) {
                continue; // Skip - street number, not ZIP
            }
            hasZip = true;
            break;
        }
        
        // V34 FIX: Check for state (indicates complete address)
        const statePattern = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i;
        const hasState = statePattern.test(text);
        
        // V34 FIX: Extract the full address including city/state/zip
        // Pattern: number + street name + street type + optional city/state/zip
        let fullAddress = text.trim();
        
        // V83 FIX: Clean up ALL common prefixes (including fillers like "yeah", "uh")
        // This was only applying to full addresses, but should apply to ALL extractions
        fullAddress = fullAddress.replace(/^(yeah|yes|yep|uh|um|ok|okay|so|well)[,.\s]+/i, '');
        // V84 FIX: Handle "here in the address is", "the address is", etc.
        fullAddress = fullAddress.replace(/^(here|over here|we'?re at|i'?m at|located at)\s*(in)?\s*/i, '');
        fullAddress = fullAddress.replace(/^(my\s+)?(the\s+)?(address\s+is|it'?s|that'?s)\s*/i, '');
        fullAddress = fullAddress.replace(/^(the\s+)?address\s*:?\s*(is)?\s*/i, '');
        fullAddress = fullAddress.replace(/^(it\s+is|that\s+is|it's|that's)\s*/i, '');
        // Remove trailing punctuation
        fullAddress = fullAddress.replace(/[.!?,]+$/, '').trim();
        
        // If we have a complete address (has zip OR state), return the whole thing
        if (hasZip || hasState) {
            logger.debug('[ADDRESS EXTRACTOR] V83: Complete address detected', { 
                address: fullAddress, 
                hasZip, 
                hasState 
            });
            return fullAddress;
        }
        
        // V83 FIX: Use cleaned fullAddress for pattern matching, not raw text
        // Otherwise, extract just the street portion
        const addressPattern = /\b(\d{1,5}\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|loop|alley|aly|path|crossing|xing|square|sq|plaza|plz|commons|point|pt|ridge|run|pass|grove|park|estates|meadow|meadows|valley|hills|heights|view|vista|landing|springs|creek|glen|cove|bay|beach|shore|pointe)[\w\s,]*)/i;
        const match = fullAddress.match(addressPattern);
        
        if (match && match[1] && match[1].length > 10) {
            return match[1].trim();
        }
        
        return null;
    },
    
    /**
     * Extract time preference from user input
     * Catches: morning, afternoon, asap, specific times, etc.
     */
    extractTime(text) {
        if (!text || typeof text !== 'string') return null;
        
        const lower = text.toLowerCase().trim();
        
        // ═══════════════════════════════════════════════════════════════════
        // FALSE POSITIVE CHECK - Don't extract time from greetings!
        // "good afternoon" is a GREETING, not a time preference
        // ═══════════════════════════════════════════════════════════════════
        const greetingPatterns = [
            /^(hi|hello|hey|howdy|yo)\s+(good\s+)?(morning|afternoon|evening)/i,
            /^good\s+(morning|afternoon|evening)/i,
            /good\s+(morning|afternoon|evening)[\s\.\!\?]*$/i  // ends with greeting
        ];
        
        if (greetingPatterns.some(p => p.test(lower))) {
            return null; // Don't extract time from greetings
        }
        
        // ASAP / Urgency patterns - STRICT DETECTION
        // "today" alone is too aggressive - "issues today" is NOT a time request
        // Only trigger ASAP for explicit urgency phrases
        // 
        // CRITICAL: "what is as soon as possible" is a QUESTION, not a time preference!
        // Don't extract time from questions about time terminology
        const isQuestionAboutTime = /^(what|when|how|does|is|can)\s+(is|does|do|exactly|does that mean)\s/i.test(lower) ||
                                    /^what\s+(is|does)\s/i.test(lower);
        
        if (isQuestionAboutTime) {
            return null; // Don't extract time from questions ABOUT time
        }
        
        const asapPatterns = [
            /as soon as possible/,
            /\basap\b/,
            /right away/,
            /right now/,
            /immediately/,
            /\burgent\b/,
            /\burgently\b/,
            /earliest\s+(?:appointment|available|time|slot)/,
            // Preference questions that still clearly mean ASAP
            /earliest\s+you\s+can/,
            /soonest\s+you\s+can/,
            /how\s+soon\s+can\s+you/,
            /how\s+fast\s+can\s+you/,
            /how\s+quickly\s+can\s+you/,
            /what'?s\s+the\s+(earliest|soonest)/,
            /when'?s\s+the\s+(earliest|soonest)/,
            /first\s+available/,
            /next\s+available/,
            /soonest\s+(?:appointment|available|time|slot)/,
            /need\s+(?:someone|service|help)\s+today/,
            /come\s+(?:out\s+)?today/,
            /(?:schedule|book).*today/,
            /today\s+(?:if\s+possible|please|would\s+be)/
        ];
        
        if (asapPatterns.some(p => p.test(lower))) {
            return 'ASAP';
        }
        
        // Time of day patterns - only if NOT part of greeting
        if (/\bmorning\b/.test(lower) && !/good\s+morning/i.test(lower)) return 'morning';
        if (/\bafternoon\b/.test(lower) && !/good\s+afternoon/i.test(lower)) return 'afternoon';
        if (/\bevening\b/.test(lower) && !/good\s+evening/i.test(lower)) return 'evening';
        
        // ═══════════════════════════════════════════════════════════════════
        // PHONE NUMBER FILTER - Don't extract time from phone numbers!
        // "239-565-2202" should NOT extract "23:00 PM"
        // ═══════════════════════════════════════════════════════════════════
        const hasPhonePattern = /\d{3}[-.\s]?\d{3}[-.\s]?\d{4}|\(\d{3}\)\s*\d{3}[-.\s]?\d{4}/.test(text);
        if (hasPhonePattern) {
            // Don't extract time from messages containing phone numbers
            return null;
        }
        
        // Specific time patterns (e.g., "3pm", "3:00", "at 3")
        // MUST have am/pm OR be preceded by "at" or "around" to be a valid time
        const specificTimeWithPeriod = lower.match(/\b(\d{1,2})\s*(?::|\.)?\s*(\d{2})?\s*(am|pm|a\.m\.|p\.m\.)/);
        const specificTimeWithContext = lower.match(/(?:at|around|by)\s+(\d{1,2})(?:\s*(?::|\.)?\s*(\d{2}))?/);
        
        if (specificTimeWithPeriod) {
            const hour = parseInt(specificTimeWithPeriod[1]);
            if (hour >= 1 && hour <= 12) { // Valid 12-hour time
                const minutes = specificTimeWithPeriod[2] || '00';
                const period = specificTimeWithPeriod[3].toUpperCase().replace(/\./g, '');
                return `${hour}:${minutes} ${period}`;
            }
        }
        
        if (specificTimeWithContext) {
            const hour = parseInt(specificTimeWithContext[1]);
            if (hour >= 1 && hour <= 12) { // Valid 12-hour time
                const minutes = specificTimeWithContext[2] || '00';
                const period = hour < 12 ? 'AM' : 'PM';
                return `${hour}:${minutes} ${period}`;
            }
        }
        
        // Relative day patterns
        if (/\btomorrow\b/.test(lower)) return 'tomorrow';
        if (/\btoday\b/.test(lower)) return 'today';
        if (/\bthis week\b/.test(lower)) return 'this week';
        if (/\bnext week\b/.test(lower)) return 'next week';
        
        // Day of week
        const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        for (const day of days) {
            if (lower.includes(day)) return day.charAt(0).toUpperCase() + day.slice(1);
        }
        
        return null;
    }
};

/**
 * ════════════════════════════════════════════════════════════════════════════
 * MAIN ENTRY POINT: processTurn
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Call this for EVERY user message, regardless of channel.
 * 
 * @param {Object} params
 * @param {string} params.companyId - Required: Company ID for multi-tenant isolation
 * @param {string} params.channel - Required: 'phone' | 'sms' | 'website' | 'test'
 * @param {string} params.userText - Required: What the user said/typed
 * @param {string} params.sessionId - Optional: Existing session ID (creates new if not provided)
 * @param {string} params.callerPhone - Optional: Caller's phone number (for phone/sms)
 * @param {string} params.callSid - Optional: Twilio Call SID (for phone)
 * @param {Object} params.visitorInfo - Optional: Website visitor info { ip, userAgent, pageUrl }
 * @param {Object} params.metadata - Optional: Additional metadata (STT confidence, etc.)
 * @param {boolean} params.includeDebug - Optional: Include debug info in response
 * @param {boolean} params.debug - Optional alias for includeDebug (backward-compatible)
 * 
 * @returns {Object} {
 *   success: boolean,
 *   reply: string,              // AI response text
 *   sessionId: string,          // Session ID for continuity
 *   phase: string,              // Current phase: 'greeting' | 'discovery' | 'booking' | 'complete'
 *   slotsCollected: Object,     // { name, phone, address, ... }
 *   wantsBooking: boolean,      // Caller wants to schedule
 *   conversationMode: string,   // 'free' | 'booking'
 *   debug?: Object              // Debug info (if includeDebug: true)
 * }
 */
async function processTurn({
    companyId,
    channel,
    userText,
    sessionId: providedSessionId = null,
    callerPhone = null,
    callSid = null,
    visitorInfo = {},
    metadata = {},
    includeDebug = false,
    debug = false,
    forceNewSession = false,  // For Test Console - always create fresh session
    preExtractedSlots = {},   // 🎯 FEB 2026: Slots pre-extracted by v2twilio (from Redis state)
    // V97 FIX: Consent pending flag from Redis (not MongoDB session)
    // BUG: When consent question was asked on Turn 2, the pending flag was only
    // in MongoDB. Turn 3 loaded from Redis which had no record of the pending consent.
    bookingConsentPending: paramBookingConsentPending = false,
    // V116: Discovery truth from DiscoveryTruthWriter — contains first_utterance,
    // call_reason_detail, call_intent_guess. Used to inject caller context into
    // scenario matching and LLM prompt so the agent never has "amnesia".
    discoveryTruth = null
}) {
    const startTime = Date.now();
        const debugLog = [];
        const confirmBackTrace = [];
        let confirmBackTraceContext = null;

    // ═══════════════════════════════════════════════════════════════════════════
    // V115 TRIAGE + RETURN LANE: Function-level variables
    // ═══════════════════════════════════════════════════════════════════════════
    let triageResult = null;       // V115: Result from TriageEngineRouter
    let triageCardMatch = null;    // Legacy: kept for ReturnLaneService compatibility
    let matchedTriageCard = null;  // Legacy: kept for ReturnLaneService compatibility
    let companyReturnLaneEnabled = false;

    // Backward-compatible alias: many callers pass debug:true.
    // Treat either flag as “include debug payload in response”.
    includeDebug = Boolean(includeDebug || debug);

    // ════════════════════════════════════════════════════════════════════════
    // PRIORITY A: DEBUG SNAPSHOT FLIGHT RECORDER (V1)
    // ════════════════════════════════════════════════════════════════════════
    // Non-negotiables:
    // - If includeDebug=true => debugSnapshot MUST exist on EVERY return path
    // - Built from final mutated truth only (no recompute)
    // - Keys are standardized and always present (null allowed)
    function buildDebugSnapshotV1(truth = {}) {
        const {
            session = null,
            companyId: cid = companyId,
            channel: ch = channel,
            turnNumber = null,
            isSessionReused = null,
            phase = null,
            mode = null,
            locks = null,
            memory = null,
            effectiveConfigVersion = null,
            lastAgentIntent = null,
            responseSource = null,
            bookingRequiresConsent = null,
            consentGiven = null,
            consentPhrase = null,
            bookingSnapTriggered = null,
            activeSlotId = null,
            slotIds = null,
            currentSlots = null,
            extractedThisTurn = null,
            nameTrace = null,
            confirmBackTrace = null,
            flow = null,
            scenarios = null,
            blackBox = null,
            // V51: Add templateReferences for wiring diagnostic
            templateReferences = null,
            scenarioCount = null,
            scenarioPoolCount = null,
            scenarioToolCount = null,
            killSwitches = null,
            // V68: Add spelling variant debug for troubleshooting
            spellingVariantDebug = null,
            promptGuards = null
            // promptPacks REMOVED Jan 2026
        } = truth;

        // Always return required shape, with nulls if missing.
        return {
            sessionId: session?._id?.toString?.() || truth.sessionId || null,
            companyId: cid ? String(cid) : null,
            channel: ch || null,
            turnNumber: Number.isFinite(turnNumber) ? turnNumber : null,
            isSessionReused: typeof isSessionReused === 'boolean' ? isSessionReused : null,

            phase: phase || session?.phase || null,
            mode: mode || session?.mode || null,

            locks: locks || session?.locks || null,
            memory: memory || session?.memory || null,

            effectiveConfigVersion: effectiveConfigVersion || null,

            routing: {
                lastAgentIntent: lastAgentIntent || session?.lastAgentIntent || null,
                responseSource: responseSource || null
            },

            booking: {
                bookingRequiresConsent: typeof bookingRequiresConsent === 'boolean' ? bookingRequiresConsent : null,
                consentGiven: typeof consentGiven === 'boolean' ? consentGiven : (session?.booking?.consentGiven ?? null),
                consentPhrase: consentPhrase ?? session?.booking?.consentPhrase ?? null,

                bookingSnapTriggered: typeof bookingSnapTriggered === 'boolean' ? bookingSnapTriggered : null,

                activeSlotId: activeSlotId ?? session?.booking?.currentSlotId ?? session?.booking?.activeSlot ?? null,
                slotIds: Array.isArray(slotIds) ? slotIds : [],

                currentSlots: currentSlots || session?.collectedSlots || {},
                extractedThisTurn: extractedThisTurn || {},
                nameTrace: nameTrace || session?.booking?.meta?.name?.nameTrace || null,
                confirmBackTrace: confirmBackTrace || [],
                property: buildAccessSnapshot(session?.booking?.meta?.address || {}).property,
                access: buildAccessSnapshot(session?.booking?.meta?.address || {}).access
            },

            flow: {
                triggersFired: flow?.triggersFired ?? 0,
                flowsActivated: flow?.flowsActivated ?? 0,
                actionsExecuted: flow?.actionsExecuted ?? 0,
                stateChanges: flow?.stateChanges ?? {}
            },

            scenarios: {
                toolCount: scenarios?.toolCount ?? 0,
                tools: Array.isArray(scenarios?.tools) ? scenarios.tools : []
            },

            blackBox: {
                callId: blackBox?.callId ?? (session?._id?.toString?.() || truth.sessionId || null),
                source: blackBox?.source ?? null
            },
            
            // V51: Template references for wiring diagnostic
            // This allows WiringDiagnosticService to see actual template state
            templateReferences: Array.isArray(templateReferences) ? templateReferences : [],
            scenarioCount: typeof scenarioCount === 'number' ? scenarioCount : 0,
            scenarioPoolCount: Number.isFinite(scenarioPoolCount) ? scenarioPoolCount : null,
            scenarioToolCount: Number.isFinite(scenarioToolCount)
                ? scenarioToolCount
                : (Number.isFinite(scenarios?.toolCount) ? scenarios.toolCount : null),
            killSwitches: killSwitches || null,
            
            // V68: Spelling variant debug info for troubleshooting
            spellingVariantDebug: spellingVariantDebug || null,
            promptGuards: promptGuards || null
            // promptPacks REMOVED Jan 2026
        };
    }

    function safeBuildDebugSnapshotV1(truth) {
        try {
            return buildDebugSnapshotV1(truth);
        } catch (err) {
            return { error: 'snapshot_build_failed', message: err?.message || String(err) };
        }
    }

    function sourceFromChannel(ch) {
        if (ch === 'website') return 'web';
        if (ch === 'sms') return 'sms';
        if (ch === 'test') return 'test';
        if (ch === 'phone' || ch === 'voice') return 'voice';
        return 'unknown';
    }
    
    const log = (msg, data = {}) => {
        const entry = { ts: Date.now() - startTime, msg, ...data };
        debugLog.push(entry);
        logger.info(`[CONVERSATION ENGINE] ${msg}`, data);
    };
    
    // V68: Spelling variant debug data - captured during booking mode and included in response
    let spellingVariantDebugData = null;
    
    try {
        // ═══════════════════════════════════════════════════════════════════
        // VALIDATION
        // ═══════════════════════════════════════════════════════════════════
        if (!companyId) {
            throw new Error('companyId is required');
        }
        
        if (!channel || !['phone', 'voice', 'sms', 'website', 'test'].includes(channel)) {
            throw new Error('channel must be one of: phone, voice, sms, website, test');
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // CHANNEL NORMALIZATION - Map 'phone' to 'voice' for database compatibility
        // The ConversationSession model uses enum ['voice', 'sms', 'website']
        // but callers may use 'phone' which is more intuitive
        // ═══════════════════════════════════════════════════════════════════
        const originalChannel = channel;
        const normalizedChannel = (channel === 'phone' || channel === 'test') ? 'voice' : channel;
        
        if (!userText || typeof userText !== 'string') {
            userText = ''; // Allow empty for silence/timeout handling
        }
        
        log('CHECKPOINT 1: Starting processTurn', { 
            companyId, 
            channel: originalChannel, 
            normalizedChannel,
            textLength: userText.length 
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Load company (with Redis caching for speed)
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 2: Loading company...');
        
        // 🚀 SPEED OPTIMIZATION (Jan 18, 2026): Cache company in Redis
        // Company config rarely changes but is loaded on EVERY turn
        // Cache saves 30-50ms per turn (MongoDB query latency)
        const COMPANY_CACHE_TTL = 60; // 1 minute TTL (balance between speed and freshness)
        const companyCacheKey = `company:${companyId}`;
        let company = null;
        let companyFromCache = false;
        
        try {
            const { redisClient } = require('../db');
            if (redisClient && typeof redisClient.get === 'function') {
                const cached = await redisClient.get(companyCacheKey);
                if (cached) {
                    company = JSON.parse(cached);
                    companyFromCache = true;
                    log('CHECKPOINT 2: ✅ Company loaded from REDIS cache', { name: company.companyName });
                }
            }
        } catch (cacheErr) {
            // Cache miss or error - fall back to MongoDB
            log('⚠️ Company cache miss/error, falling back to MongoDB');
        }
        
        // If not in cache, load from MongoDB and cache it
        if (!company) {
            company = await Company.findById(companyId);
            
            if (!company) {
                throw new Error(`Company not found: ${companyId}`);
            }
            
            // Cache for future requests
            try {
                const { redisClient } = require('../db');
                if (redisClient && typeof redisClient.setEx === 'function') {
                    // Convert to plain object for caching (Mongoose doc → JSON)
                    const companyJson = company.toObject ? company.toObject() : company;
                    await redisClient.setEx(companyCacheKey, COMPANY_CACHE_TTL, JSON.stringify(companyJson));
                    log('💾 Company cached in Redis (TTL: 60s)');
                }
            } catch (cacheWriteErr) {
                // Non-critical - continue without caching
            }
            
            log('CHECKPOINT 2: ✅ Company loaded from MongoDB', { name: company.companyName });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1.1: CREATE AW CONFIG READER (Phase 6 - Registry Gate)
        // ═══════════════════════════════════════════════════════════════════
        // The AWConfigReader is THE SINGLE CHOKEPOINT for all config reads.
        // Every read is validated against the AW registry and logged to Raw Events.
        // This enables the AW ⇄ RE marriage: instant debugging, zero guessing.
        // ═══════════════════════════════════════════════════════════════════
        const awReader = AWConfigReader.forCall({
            callId: callSid || `test-${Date.now()}`,
            companyId: companyId.toString(),
            turn: 0, // Will be updated as turns progress
            runtimeConfig: company,
            readerId: 'ConversationEngine.processTurn'
        });
        log('CHECKPOINT 2.05: ✅ AWConfigReader initialized', {
            enforcementMode: awReader.enforcementMode,
            registeredPaths: AWConfigReader.getRegisteredPaths().length
        });
        
        // 🔴 CRITICAL DEBUG: Verify commonFirstNames is loaded (via AWConfigReader)
        const _cfn = awReader.getArray('frontDesk.commonFirstNames');
        log('CHECKPOINT 2.1: 👤 COMMON_FIRST_NAMES_LOADED', {
            count: _cfn.length,
            sample: _cfn.slice(0, 10).join(', '),
            hasMarkLower: _cfn.map(n => String(n).toLowerCase()).includes('mark'),
            source: companyFromCache ? 'REDIS' : 'MONGODB',
            readViaAW: true
        });
        
        // STEP 1.5: Cheat Sheets REMOVED Feb 2026 — Tier 2 reserved for future rebuild
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1.6: V26 - Load Template + Translate Caller Vocabulary
        // ═══════════════════════════════════════════════════════════════════
        // Load the active template to get NLP config (synonyms, fillers)
        // Translate caller slang to standard terms BEFORE processing
        // Example: "not pulling" → "not cooling" (HVAC)
        // ═══════════════════════════════════════════════════════════════════
        let activeTemplate = null;
        let vocabularyTranslation = { translated: userText, replacements: [], original: userText };
        
        try {
            const templateRefs = company.aiAgentSettings?.templateReferences || [];
            const activeRef = templateRefs.find(ref => ref.enabled !== false);
            
            if (activeRef?.templateId) {
                activeTemplate = await GlobalInstantResponseTemplate.findById(activeRef.templateId)
                    .select('_id name nlpConfig categories synonymMap fillerWords')
                    .lean();
                
                if (activeTemplate) {
                    log('CHECKPOINT 2.6: ✅ Template loaded', { 
                        templateId: activeRef.templateId,
                        templateName: activeTemplate.name,
                        hasSynonyms: !!(activeTemplate.nlpConfig?.synonyms),
                        synonymCount: activeTemplate.nlpConfig?.synonyms ? Object.keys(activeTemplate.nlpConfig.synonyms).length : 0
                    });
                    
                    // Translate caller vocabulary
                    vocabularyTranslation = await translateCallerVocabulary(userText, company, activeTemplate);
                    
                    if (vocabularyTranslation.replacements.length > 0) {
                        log('CHECKPOINT 2.6: 🔤 VOCABULARY TRANSLATED', {
                            original: userText,
                            translated: vocabularyTranslation.translated,
                            replacements: vocabularyTranslation.replacements
                        });
                        // Use translated text for all downstream processing
                        userText = vocabularyTranslation.translated;
                    }
                    
                    // ═══════════════════════════════════════════════════════════════════
                    // V36: STRIP FILLER WORDS - Clean up "um", "uh", "like" etc.
                    // Uses template fillers + company custom fillers
                    // ═══════════════════════════════════════════════════════════════════
                    const fillerResult = stripFillerWords(userText, company, activeTemplate);
                    
                    if (fillerResult.removed.length > 0) {
                        log('CHECKPOINT 2.7: 🔇 FILLERS STRIPPED', {
                            original: userText,
                            cleaned: fillerResult.cleaned,
                            removed: fillerResult.removed,
                            templateFillers: activeTemplate?.fillerWords?.length || 0,
                            customFillers: company?.aiAgentSettings?.fillerWords?.custom?.length || 0
                        });
                        // Use cleaned text for all downstream processing
                        userText = fillerResult.cleaned;
                    }
                } else {
                    log('CHECKPOINT 2.6: ⚠️ Template not found (non-fatal)', { templateId: activeRef.templateId });
                }
            } else {
                log('CHECKPOINT 2.6: ⚠️ No active template reference (non-fatal)');
            }
        } catch (templateErr) {
            log('CHECKPOINT 2.6: ⚠️ Template load failed (non-fatal)', { error: templateErr.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // V32: GREETING INTERCEPT - 0 tokens, no LLM needed!
        // Uses UI-configured greetingRules with exact/fuzzy matching
        // 
        // V34 FIX: CONTEXT-AWARE GREETING DETECTION
        // "morning" is a greeting ONLY at the start of the call
        // After that, "morning" means TIME PREFERENCE (not greeting!)
        // RULE: Slot-resolver beats intent classifier. Always.
        // 
        // NOTE: Session is NOT loaded yet at this point, so we use providedSessionId
        // to determine if this is a new session (no ID = first turn = greeting OK)
        // ═══════════════════════════════════════════════════════════════════
        const userTextLower = userText.toLowerCase().trim();
        
        // V34: Determine context WITHOUT session (session loaded later)
        // If no sessionId provided, this is likely a new conversation = treat as greeting
        // If sessionId exists, we need to be careful about ambiguous words
        // FIX (Jan 2026): "fresh-*" IDs from chat widget indicate NEW sessions, not existing
        const hasExistingSession = !!providedSessionId && !String(providedSessionId).startsWith('fresh-');
        
        // V34: Words that are BOTH greetings AND time preferences
        const ambiguousTimeWords = ['morning', 'afternoon', 'evening'];
        const isAmbiguousTimeWord = ambiguousTimeWords.some(w => userTextLower === w || userTextLower === `good ${w}`);
        
        // V34: If this looks like a time preference answer AND we have an existing session,
        // DON'T treat as greeting - let normal processing handle it
        // For new sessions (no providedSessionId), always treat ambiguous words as greetings
        const shouldTreatAsTimePreference = isAmbiguousTimeWord && hasExistingSession;
        
        if (shouldTreatAsTimePreference) {
            log('🕐 V34: Ambiguous word in existing session, skipping greeting intercept', {
                userText,
                hasExistingSession,
                providedSessionId
            });
            // Fall through to normal processing - don't intercept as greeting
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // 🆕 PHASE 1 GUARDRAIL: NO RE-GREET AFTER TURN 1
        // ═══════════════════════════════════════════════════════════════════
        // If we have an existing session, we've already greeted - don't greet again
        // This prevents the "goldfish memory" problem of re-greeting mid-conversation
        // ═══════════════════════════════════════════════════════════════════
        const shouldSkipGreetingDueToLock = hasExistingSession; // If session exists, we've greeted
        
        // Get UI-configured greeting rules (V32 format)
        const greetingRules = company.aiAgentSettings?.frontDeskBehavior?.conversationStages?.greetingRules || [];
        const legacyResponses = company.aiAgentSettings?.frontDeskBehavior?.conversationStages?.greetingResponses || {};
        
        // Fuzzy matching patterns for common greetings (used when fuzzy=true)
        const fuzzyPatterns = {
            'good morning': /^(good\s*morning|morning|gm)\b/i,
            'morning': /^(good\s*morning|morning|gm)\b/i,
            'good afternoon': /^(good\s*afternoon|afternoon)\b/i,
            'afternoon': /^(good\s*afternoon|afternoon)\b/i,
            'good evening': /^(good\s*evening|evening)\b/i,
            'evening': /^(good\s*evening|evening)\b/i,
            'hi': /^(hi|hello|hey|howdy|yo|sup|what'?s\s*up|greetings?)\b/i,
            'hello': /^(hi|hello|hey|howdy|yo|sup|what'?s\s*up|greetings?)\b/i,
            'hey': /^(hi|hello|hey|howdy|yo|sup|what'?s\s*up|greetings?)\b/i
        };
        
        // Check if this is JUST a greeting (not "hi I need help with my AC")
        // Short message + starts with greeting-like word
        const isShortMessage = userTextLower.length < 40; // Increased to handle "yes, good morning"
        
        // ════════════════════════════════════════════════════════════════════════
        // 🆕 FIX (Jan 18, 2026): Strip filler words before checking for greeting
        // "yes, good morning" → "good morning" → GREETING INTERCEPT!
        // This saves 2-4 seconds and 0 tokens vs going to LLM
        // ════════════════════════════════════════════════════════════════════════
        const FILLER_PREFIXES = /^(yes|yeah|yep|yup|uh|um|uh\s*huh|ok|okay|sure|well|so|right|alright|,|\s)+/i;
        const textWithoutFillers = userTextLower.replace(FILLER_PREFIXES, '').trim();
        
        const startsWithGreeting = /^(good\s*(morning|afternoon|evening)|hi|hello|hey|howdy|yo|sup|what'?s\s*up|greetings?|morning|afternoon|evening|gm)\b/i.test(textWithoutFillers);
        
        // V34: Only intercept as greeting if NOT a time preference
        // 🆕 PHASE 1: Also skip if we've already greeted (existing session)
        if (isShortMessage && startsWithGreeting && !shouldTreatAsTimePreference && !shouldSkipGreetingDueToLock) {
            let greetingResponse = null;
            let matchedTrigger = null;
            let matchType = null;
            
            // V35: Smart greeting matching - prioritize LONGER matches first
            // This handles "hi good afternoon" → should match "good afternoon" not "hi"
            if (greetingRules.length > 0) {
                // Sort rules by trigger length (longest first) to prioritize specific matches
                const sortedRules = [...greetingRules].sort((a, b) => 
                    (b.trigger?.length || 0) - (a.trigger?.length || 0)
                );
                
                for (const rule of sortedRules) {
                    if (!rule.trigger || !rule.response) continue;
                    
                    const trigger = rule.trigger.toLowerCase().trim();
                    
                    if (rule.fuzzy) {
                        // Fuzzy matching - use pattern if available, otherwise contains check
                        const pattern = fuzzyPatterns[trigger];
                        if (pattern && pattern.test(userTextLower)) {
                            greetingResponse = rule.response;
                            matchedTrigger = trigger;
                            matchType = 'fuzzy-pattern';
                            break;
                        } else if (userTextLower.includes(trigger)) {
                            greetingResponse = rule.response;
                            matchedTrigger = trigger;
                            matchType = 'fuzzy-contains';
                            break;
                        }
                    } else {
                        // EXACT matching - trigger must appear as whole phrase
                        // "hi good afternoon" contains "good afternoon" as exact phrase
                        // But "morning appointment" should NOT match "morning" (that's a time, not greeting)
                        const exactPattern = new RegExp(`\\b${trigger.replace(/\s+/g, '\\s+')}\\b`, 'i');
                        if (exactPattern.test(userTextLower)) {
                            greetingResponse = rule.response;
                            matchedTrigger = trigger;
                            matchType = 'exact-phrase';
                            break;
                        }
                    }
                }
                
                log('GREETING RULES CHECK', {
                    userText: userTextLower,
                    rulesChecked: sortedRules.length,
                    matched: matchedTrigger,
                    matchType,
                    response: greetingResponse?.substring(0, 50)
                });
            }
            
            // Fallback to legacy format if no rule matched
            if (!greetingResponse) {
                const hour = new Date().getHours();
                // V59 NUKE: Use UI-configured greetings ONLY (no hardcoded fallbacks)
                // Check for time-of-day keywords ANYWHERE in the greeting, not just at start
                if (/\b(good\s*morning|morning)\b/i.test(userTextLower)) {
                    greetingResponse = legacyResponses.morning || getMissingConfigPrompt('greeting_morning', 'greeting');
                    matchedTrigger = 'morning (legacy)';
                } else if (/\b(good\s*afternoon|afternoon)\b/i.test(userTextLower)) {
                    greetingResponse = legacyResponses.afternoon || getMissingConfigPrompt('greeting_afternoon', 'greeting');
                    matchedTrigger = 'afternoon (legacy)';
                } else if (/\b(good\s*evening|evening)\b/i.test(userTextLower)) {
                    greetingResponse = legacyResponses.evening || getMissingConfigPrompt('greeting_evening', 'greeting');
                    matchedTrigger = 'evening (legacy)';
                } else {
                    // Generic greeting (hi, hello, hey) - MIRROR the caller's greeting style
                    if (/^(hi|hello|hey)\b/i.test(userTextLower)) {
                        greetingResponse = legacyResponses.generic || getMissingConfigPrompt('greeting_generic', 'greeting');
                        matchedTrigger = 'generic-hello (legacy)';
                    } else {
                        // Truly generic - use time-appropriate
                        if (hour < 12) {
                            greetingResponse = legacyResponses.morning || getMissingConfigPrompt('greeting_morning', 'greeting');
                        } else if (hour < 17) {
                            greetingResponse = legacyResponses.afternoon || getMissingConfigPrompt('greeting_afternoon', 'greeting');
                        } else {
                            greetingResponse = legacyResponses.evening || getMissingConfigPrompt('greeting_evening', 'greeting');
                        }
                        matchedTrigger = 'time-based (legacy)';
                    }
                }
                matchType = 'legacy';
            }
            
            // Apply {time} placeholder if present
            if (greetingResponse && greetingResponse.includes('{time}')) {
                const hour = new Date().getHours();
                const timeOfDay = hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening';
                greetingResponse = greetingResponse.replace(/{time}/gi, timeOfDay);
            }
            
            // V130 FIX: Run greeting through full placeholder replacement.
            // Previously only {time} was replaced — {companyName}, {serviceAreas}, etc.
            // were left as raw braces (e.g. caller heard "{Penguin Air}" instead of "Penguin Air").
            if (greetingResponse) {
                const { replacePlaceholders } = require('../utils/placeholderReplacer');
                greetingResponse = replacePlaceholders(greetingResponse, company);
            }
            
            log('CHECKPOINT 2.7: ✅ GREETING INTERCEPT - 0 tokens!', {
                userText,
                textWithoutFillers: textWithoutFillers !== userTextLower ? textWithoutFillers : undefined,
                matchedTrigger,
                matchType,
                rulesCount: greetingRules.length,
                response: greetingResponse
            });
            
            // Return immediately without LLM - 0 tokens!
            const resp = {
                success: true,
                reply: greetingResponse,
                response: greetingResponse,
                sessionId: providedSessionId || `greeting-${Date.now()}`,
                phase: 'DISCOVERY',
                mode: 'DISCOVERY',
                conversationMode: 'DISCOVERY',
                emotion: { emotion: 'neutral', confidence: 1.0 },
                tokensUsed: 0,
                llmUsed: false,
                source: 'GREETING_INTERCEPT',
                matchSource: 'GREETING_INTERCEPT',  // 🎯 BlackBox source tracking
                tier: 'tier1',  // 🎯 Tier1 = deterministic, no LLM
                latencyMs: Date.now() - startTime,
                slotsCollected: {},
                debug: includeDebug ? {
                    latencyMs: Date.now() - startTime,
                    tokensUsed: 0,
                    responseSource: 'GREETING_INTERCEPT',
                    v22BlackBox: {
                        mode: 'DISCOVERY',
                        greetingIntercept: true,
                        tokensUsed: 0,
                        llmCalled: false,
                        matchedTrigger,
                        matchType,
                        rulesCount: greetingRules.length
                    },
                    log: debugLog
                } : undefined
            };
            if (includeDebug) {
                resp.debugSnapshot = safeBuildDebugSnapshotV1({
                    sessionId: resp.sessionId,
                    companyId,
                    channel,
                    turnNumber: 1,
                    isSessionReused: false,
                    phase: resp.phase,
                    mode: resp.mode,
                    effectiveConfigVersion: null,
                    lastAgentIntent: 'DISCOVERY',
                    responseSource: 'GREETING_INTERCEPT',
                    bookingRequiresConsent: null,
                    consentGiven: false,
                    consentPhrase: null,
                    bookingSnapTriggered: false,
                    activeSlotId: null,
                    slotIds: [],
                    currentSlots: {},
                    extractedThisTurn: {},
                    flow: { triggersFired: 0, flowsActivated: 0, actionsExecuted: 0, stateChanges: {} },
                    scenarios: { toolCount: 0, tools: [] },
                    blackBox: { callId: resp.sessionId, source: sourceFromChannel(channel) }
                });
            }
            return resp;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // ESCALATION INTERCEPT (UI-CONTROLLED) - "Can I talk to a human?"
        // ═══════════════════════════════════════════════════════════════════
        // This is intentionally BEFORE session/customer work:
        // - Fast response
        // - Clean transfer behavior
        // - No LLM needed
        // 🔌 AW MIGRATION: Using AWConfigReader for traced config reads
        awReader.setReaderId('ConversationEngine.escalationIntercept');
        const escalationCfg = awReader.getObject('frontDesk.escalation');
        const escalationEnabled = escalationCfg.enabled !== false;
        const escalationPhrases = Array.isArray(escalationCfg.triggerPhrases) ? escalationCfg.triggerPhrases : [];
        if (escalationEnabled && escalationPhrases.length > 0) {
            const matched = escalationPhrases.find(p => p && userTextLower.includes(String(p).toLowerCase()));
            if (matched) {
                // FEB 2026 FIX: Remove debug prefix from fallback - it was being spoken aloud!
                const transferMsg =
                    escalationCfg.transferMessage ||
                    company.connectionMessages?.voice?.transferMessage ||
                    "One moment while I transfer you to our team.";

                log('🧑‍💼 ESCALATION INTERCEPT - transfer requested (0 tokens)', {
                    matchedPhrase: matched,
                    hasFrontDeskTransferMessage: !!escalationCfg.transferMessage,
                    hasCompanyTransferMessage: !!company.connectionMessages?.voice?.transferMessage
                });

                const resp = {
                    success: true,
                    reply: transferMsg,
                    response: transferMsg,
                    sessionId: providedSessionId || `escalation-${Date.now()}`,
                    phase: 'DISCOVERY',
                    mode: 'DISCOVERY',
                    conversationMode: 'DISCOVERY',
                    emotion: { emotion: 'neutral', confidence: 1.0 },
                    tokensUsed: 0,
                    llmUsed: false,
                    source: 'ESCALATION_INTERCEPT',
                    matchSource: 'ESCALATION_INTERCEPT',  // 🎯 BlackBox source tracking
                    tier: 'tier1',  // 🎯 Tier1 = deterministic, no LLM
                    latencyMs: Date.now() - startTime,
                    slotsCollected: {},
                    requiresTransfer: true,
                    transferReason: 'caller_requested_human'
                };
                if (includeDebug) {
                    resp.debugSnapshot = safeBuildDebugSnapshotV1({
                        sessionId: resp.sessionId,
                        companyId,
                        channel,
                        turnNumber: 1,
                        isSessionReused: false,
                        phase: resp.phase,
                        mode: resp.mode,
                        effectiveConfigVersion: null,
                        lastAgentIntent: 'DISCOVERY',
                        responseSource: 'ESCALATION_INTERCEPT',
                        bookingRequiresConsent: null,
                        consentGiven: false,
                        consentPhrase: null,
                        bookingSnapTriggered: false,
                        activeSlotId: null,
                        slotIds: [],
                        currentSlots: {},
                        extractedThisTurn: {},
                        flow: { triggersFired: 0, flowsActivated: 0, actionsExecuted: 0, stateChanges: {} },
                        scenarios: { toolCount: 0, tools: [] },
                        blackBox: { callId: resp.sessionId, source: sourceFromChannel(channel) }
                    });
                }
                return resp;
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Find or create customer
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 3: Customer lookup...');
        let customer = null;
        let isNewCustomer = false;
        
        // Generate session ID if not provided
        const sessionId = providedSessionId || 
            (channel === 'phone' && callSid) ? `call-${callSid}` :
            `${channel}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            const identifier = callerPhone || visitorInfo.phone || visitorInfo.email;
            if (identifier) {
                const result = await CustomerService.findOrCreate(
                    companyId,
                    {
                        phone: callerPhone || visitorInfo.phone,
                        email: visitorInfo.email,
                        name: visitorInfo.name,
                        sessionId
                    },
                    normalizedChannel  // Use 'voice' for phone/test channels
                );
                customer = result.customer;
                isNewCustomer = result.isNew;
            }
        } catch (custErr) {
            log('Customer lookup failed (non-fatal)', { error: custErr.message });
        }
        
        log('CHECKPOINT 3: ✅ Customer done', { hasCustomer: !!customer, isNew: isNewCustomer });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: Get or create session
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 4: Session management...');
        
        // Build identifiers based on original channel type (phone/sms/website)
        const identifiers = (channel === 'phone' || channel === 'test')
            ? { callSid, callerPhone, calledNumber: metadata.calledNumber }
            : channel === 'sms'
            ? { smsPhone: callerPhone }
            : { sessionId, ip: visitorInfo.ip, userAgent: visitorInfo.userAgent, pageUrl: visitorInfo.pageUrl };
        
        // Use normalizedChannel for database operations (voice/sms/website)
        const session = await SessionService.getOrCreate({
            companyId,
            channel: normalizedChannel,  // 'voice' for phone/test, 'sms', or 'website'
            identifiers,
            customer,
            forceNewSession  // Test Console can force fresh session
        });

        const sessionWasReused = (session.metrics?.totalTurns || 0) > 0;
        
        log('CHECKPOINT 4: ✅ Session ready', { 
            sessionId: session._id, 
            turns: session.metrics?.totalTurns || 0,
            phase: session.phase,
            // 🔍 DIAGNOSTIC: Show what slots were already saved in this session
            existingSlots: JSON.stringify(session.collectedSlots || {}),
            isSessionReused: sessionWasReused
        });

        confirmBackTraceContext = {
            companyId: companyId?.toString?.() || company?._id?.toString?.() || null,
            tradeKey: normalizeTradeKey(company?.trade || company?.tradeType || ''),
            callSessionId: session?._id?.toString?.() || null
        };
        
        // ═══════════════════════════════════════════════════════════════════
        // 🆕 PHASE 1: INITIALIZE STATE + LOCKS (Deterministic Control Layer)
        // ═══════════════════════════════════════════════════════════════════
        // These locks prevent the "goldfish memory" problem:
        // - No re-greet after Turn 1
        // - No re-ask collected slots
        // - No restart booking once started
        // - Always acknowledge what caller said
        // ═══════════════════════════════════════════════════════════════════
        // NOTE: ConversationSession schema defines locks + memory. Never reset them on reuse.
        // If missing (legacy sessions), initialize once; if reused, backfill invariants.
        session.locks = session.locks || {
            greeted: false,
            issueCaptured: false,
            bookingStarted: false,
            bookingLocked: false,
            askedSlots: {},
            flowAcked: {}
        };
        
        session.memory = session.memory || {
            rollingSummary: '',
            facts: {},
            lastUserIntent: null,
            lastUserNeed: null,
            acknowledgedClaims: []
        };

        session.pricingPolicy = session.pricingPolicy || {
            transferOfferPending: false,
            offerToken: null,
            offerMode: null,
            offeredAt: null,
            lastDecision: null,
            lastDecisionAt: null
        };
        
        if (sessionWasReused) {
            // If the session has turns, the agent has already spoken.
            session.locks.greeted = true;
            
            if (session.discovery?.issue) {
                session.locks.issueCaptured = true;
            }
            
            if (session.mode === 'BOOKING') {
                session.locks.bookingStarted = true;
            }
            
            if (session.mode === 'COMPLETE' || session.booking?.consentGiven) {
                session.locks.bookingLocked = true;
            }
            
            // If memory was never populated, derive rolling summary from runningSummary.
            if (!session.memory.rollingSummary) {
                const lastBullet = Array.isArray(session.runningSummary) ? session.runningSummary[session.runningSummary.length - 1] : null;
                if (lastBullet) {
                    session.memory.rollingSummary = String(lastBullet).trim();
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // 🆕 BLACK BOX - ENSURE RECORDING EARLY (before any LLM calls)
        // ═══════════════════════════════════════════════════════════════════
        // LLM Registry logs LLM_RESPONSE events during the OpenAI call. If we
        // only initialize Black Box at the end of processTurn, those events
        // are dropped as "recording not found".
        if (channel === 'test' || channel === 'website' || channel === 'sms') {
            try {
                const BlackBoxLogger = require('./BlackBoxLogger');
                const sourceType = channel === 'test' ? 'test' : channel === 'sms' ? 'sms' : 'web';
                
                await BlackBoxLogger.ensureCall({
                    callId: session._id.toString(),
                    companyId,
                    from: callerPhone || visitorInfo?.ip || 'test-console',
                    to: company.companyName || 'AI Agent',
                    source: sourceType,
                    sessionSnapshot: {
                        phase: session.phase,
                        mode: session.mode,
                        locks: session.locks,
                        memory: session.memory
                    }
                });
                
                log('📼 PHASE 2: Black Box recording ensured (early)', { source: sourceType });
            } catch (bbInitErr) {
                log('⚠️ Black Box ensureCall failed (non-fatal)', { error: bbInitErr.message });
            }
        }

        // ═══════════════════════════════════════════════════════════════════
        // DETECTION TRIGGERS → FLAGS (UI-CONTROLLED, NO TEXT)
        // ═══════════════════════════════════════════════════════════════════
        // Purpose: turn caller phrases into session.flags for routing/contract decisions.
        // This does NOT generate language; it only sets state.
        // Example usage: Booking Contract V2 slotGroups.when can key off session.flags.
        const detectionTriggers = company.aiAgentSettings?.frontDeskBehavior?.detectionTriggers || {};
        session.flags = session.flags || {};
        const setFlagIfMatched = (flagKey, phrases) => {
            if (!Array.isArray(phrases) || phrases.length === 0) return;
            const matched = phrases.find(p => p && userTextLower.includes(String(p).toLowerCase()));
            if (matched) {
                session.flags[flagKey] = true;
                log('🎯 DETECTION FLAG SET', { flagKey, matched });
            }
        };
        setFlagIfMatched('trustConcern', detectionTriggers.trustConcern);
        setFlagIfMatched('callerFeelsIgnored', detectionTriggers.callerFeelsIgnored);
        setFlagIfMatched('refusedSlot', detectionTriggers.refusedSlot);
        setFlagIfMatched('describingProblem', detectionTriggers.describingProblem);
        
        // Track turn number for locks
        const currentTurnNumber = (session.metrics?.totalTurns || 0) + 1;
        
        // 📊 PHASE 1 DEBUG: Log locks state
        log('🔒 PHASE 1: Locks state', {
            locks: session.locks,
            memory: {
                rollingSummary: session.memory?.rollingSummary?.substring(0, 50),
                factsCount: Object.keys(session.memory?.facts || {}).length,
                acknowledgedClaims: session.memory?.acknowledgedClaims?.length || 0
            },
            turnNumber: currentTurnNumber
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // 🆕 PHASE 3: DYNAMIC FLOW ENGINE - Trigger → Event → State → Action
        // ═══════════════════════════════════════════════════════════════════
        // ☢️ NUKED Feb 2026: Dynamic Flow Engine (Phase 3) removed
        // V110 architecture (Slot Registry + Discovery Flow + Booking Flow) replaces it
        // Routing now handled by:
        // - Scenario matching (HybridScenarioSelector)
        // - Consent gate logic
        // - Booking mode triggers
        // ═══════════════════════════════════════════════════════════════════
        // ☢️ NUKED Feb 2026: dynamicFlowResult removed - V110 architecture replaces Dynamic Flows
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Build customer context for AI
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 5: Building customer context...');
        let customerContext;
        try {
            // V76: Load FULL customer intelligence (past calls, transcripts, equipment, notes)
            if (customer && customer._id) {
                // Load comprehensive context for returning customers
                const fullContext = await CustomerContextLoader.loadCustomerContext(
                    company._id, 
                    customer._id
                );
                
                if (fullContext.hasContext) {
                    // Rich context with past transcripts, service visits, equipment
                    customerContext = {
                        ...CustomerService.buildContextForAI(customer),
                        ...fullContext,
                        // Preserve both isKnown and hasContext flags
                        isKnown: true
                    };
                    log('📚 CUSTOMER INTELLIGENCE LOADED', {
                        name: fullContext.identity?.name?.displayName,
                        totalCalls: fullContext.metrics?.totalCalls,
                        pastTranscripts: fullContext.pastTranscripts?.length || 0,
                        serviceVisits: fullContext.serviceVisits?.length || 0,
                        equipment: fullContext.equipment?.length || 0,
                        loadTimeMs: fullContext.loadTimeMs
                    });
                } else {
                    // Fallback to basic context
                    customerContext = CustomerService.buildContextForAI(customer);
                }
            } else {
                customerContext = { isKnown: false, summary: `New ${channel} visitor` };
            }
        } catch (ctxErr) {
            log('⚠️ Customer context load failed (using basic)', { error: ctxErr.message });
            customerContext = customer 
                ? CustomerService.buildContextForAI(customer)
                : { isKnown: false, summary: `New ${channel} visitor` };
        }
        log('CHECKPOINT 5: ✅ Customer context built');
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 5: Build running summary (conversation memory)
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 6: Building running summary...');
        let summaryBullets = [];
        let summaryFormatted = '';
        try {
            const summaryResult = RunningSummaryService.buildAndFormat({
                previousSummary: session.runningSummary || [],
                customerContext,
                currentTurn: { userMessage: userText },
                conversationState: {
                    phase: session.phase || 'greeting',
                    knownSlots: session.collectedSlots || {},
                    signals: session.signals || {},
                    // 🆕 Include discovery and triage data for AI context
                    discovery: session.discovery || {},
                    triageState: session.triageState || {},
                    currentStage: session.conversationMemory?.currentStage || 'greeting'
                },
                company
            });
            summaryBullets = summaryResult.bullets;
            summaryFormatted = summaryResult.formatted;
        } catch (sumErr) {
            log('Running summary failed (non-fatal)', { error: sumErr.message });
        }
        log('CHECKPOINT 6: ✅ Running summary built', { bullets: summaryBullets.length });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 6: Get conversation history
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 7: Getting conversation history...');
        let conversationHistory = [];
        try {
            conversationHistory = session.getHistoryForAI ? session.getHistoryForAI() : [];
        } catch (histErr) {
            log('getHistoryForAI failed (non-fatal)', { error: histErr.message });
        }
        log('CHECKPOINT 7: ✅ History retrieved', { turns: conversationHistory.length });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 7: Extract slots programmatically
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 8: Extracting slots...');
        
        // ════════════════════════════════════════════════════════════════════
        // 🎯 FEB 2026 FIX: Merge pre-extracted slots from v2twilio (Redis state)
        // ════════════════════════════════════════════════════════════════════
        // CRITICAL: v2twilio.js extracts slots and stores them in Redis (callState.slots).
        // Session.collectedSlots is from MongoDB and may not have these slots yet.
        // Merge them here so BOOKING_SNAP sees all collected slots.
        // 
        // V95 FIX: For critical identity slots (name, phone), preExtractedSlots 
        // should OVERRIDE session values because v2twilio's SlotExtractor has 
        // validation rules that prevent extracting invalid values.
        // ════════════════════════════════════════════════════════════════════
        const CRITICAL_OVERRIDE_SLOTS = new Set(['name', 'phone', 'partialName']);
        
        if (preExtractedSlots && Object.keys(preExtractedSlots).length > 0) {
            session.collectedSlots = session.collectedSlots || {};
            for (const [key, value] of Object.entries(preExtractedSlots)) {
                if (!value) continue;
                
                const shouldOverride = CRITICAL_OVERRIDE_SLOTS.has(key);
                const existingValue = session.collectedSlots[key];
                
                if (shouldOverride && existingValue !== value) {
                    // Critical slot - allow override with better value
                    log('🎯 V95: PRE-EXTRACTED CRITICAL SLOT OVERRIDE', { 
                        key, 
                        oldValue: existingValue?.substring?.(0, 20) || existingValue,
                        newValue: value?.substring?.(0, 20) || value
                    });
                    session.collectedSlots[key] = value;
                } else if (!existingValue) {
                    // Non-critical slot - only set if not already present
                    session.collectedSlots[key] = value;
                    log('🎯 PRE-EXTRACTED SLOT MERGED', { key, value: typeof value === 'string' ? value.substring(0, 20) : value });
                }
            }
        }
        
        // ════════════════════════════════════════════════════════════════════
        // SLOT VALIDATOR - Clean up obviously invalid stored values
        // This catches corrupted data from old sessions or bad extractions
        // ════════════════════════════════════════════════════════════════════
        const rawSlots = { ...(session.collectedSlots || {}) };
        const currentSlots = {};
        
        // Validate name - reject greetings, verbs, common phrases
        if (rawSlots.name) {
            const nameLower = rawSlots.name.toLowerCase().trim();
            
            // Direct invalid names
            const invalidNames = [
                'good morning', 'good afternoon', 'good evening', 'good night',
                'hi', 'hello', 'hey', 'hi there', 'hello there', 'good',
                'morning', 'afternoon', 'evening', 'yes', 'no', 'yeah', 'yep',
                'thanks', 'thank you', 'okay', 'ok', 'sure', 'please',
                'having just', 'doing great', 'doing good', 'doing fine',
                'having some', 'having issues', 'having problems',
                // V81: Question words that get misheard as names
                'what', 'who', 'where', 'when', 'why', 'how',
                'that', 'this', 'which', 'whose'
            ];
            
            // Words that should NEVER be in a name
            const invalidWords = [
                'having', 'doing', 'calling', 'looking', 'trying', 'getting', 'going',
                'coming', 'waiting', 'hoping', 'thinking', 'wondering', 'needing',
                'wanting', 'asking', 'dealing', 'experiencing', 'just', 'some',
                'issues', 'problems', 'trouble', 'great', 'fine', 'good', 'bad',
                // V96e: Adverbs and state words that contaminated names
                'currently', 'presently', 'actually', 'basically', 'usually', 'normally',
                'typically', 'generally', 'still', 'already', 'always', 'never', 'ever',
                'now', 'today', 'recently', 'sometimes', 'often', 'really', 'very',
                // Service/trade words
                'service', 'services', 'repair', 'repairs', 'maintenance', 'conditioning',
                'air', 'ac', 'hvac', 'heating', 'cooling', 'plumbing', 'electrical',
                'appointment', 'schedule', 'booking', 'unit', 'system'
            ];
            
            // Check if name contains any invalid word
            const nameWords = nameLower.split(/\s+/);
            const hasInvalidWord = nameWords.some(w => invalidWords.includes(w));
            
            if (invalidNames.includes(nameLower) || nameLower.length < 2 || hasInvalidWord) {
                log('🚨 INVALID NAME DETECTED - clearing:', rawSlots.name);
                // Don't copy invalid name
            } else {
                currentSlots.name = rawSlots.name;
            }
        }
        
        // Validate phone - must have at least 7 digits
        if (rawSlots.phone) {
            const digitsOnly = rawSlots.phone.replace(/\D/g, '');
            if (digitsOnly.length >= 7) {
                currentSlots.phone = rawSlots.phone;
            } else {
                log('🚨 INVALID PHONE DETECTED - clearing:', rawSlots.phone);
            }
        }
        
        // V83 FIX: Clean address before copying - remove prefixes like "yeah, my address is"
        if (rawSlots.address) {
            let cleanedAddress = String(rawSlots.address).trim();
            // Remove common speech prefixes that shouldn't be part of the address
            cleanedAddress = cleanedAddress.replace(/^(yeah|yes|yep|uh|um|ok|okay|so|well)[,.\s]+/i, '');
            cleanedAddress = cleanedAddress.replace(/^(my\s+)?(address\s+is|it'?s|that'?s)\s*/i, '');
            cleanedAddress = cleanedAddress.replace(/^(the\s+)?address\s*:?\s*/i, '');
            cleanedAddress = cleanedAddress.replace(/^(it\s+is|that\s+is|it's|that's)\s*/i, '');
            cleanedAddress = cleanedAddress.replace(/[.!?,]+$/, '').trim();
            
            // Only store if it still looks like an address (has numbers and street words)
            if (/\d/.test(cleanedAddress) && cleanedAddress.length > 5) {
                currentSlots.address = cleanedAddress;
                log('📍 ADDRESS CLEANED', { raw: rawSlots.address, cleaned: cleanedAddress });
            } else {
                currentSlots.address = rawSlots.address; // Keep original if cleaning failed
            }
        }
        if (rawSlots.time) currentSlots.time = rawSlots.time;
        if (rawSlots.partialName) {
            const pn = String(rawSlots.partialName || '').trim();
            const pnLower = pn.toLowerCase();
            const invalidPartial = new Set(['last', 'name', 'surname']);
            if (pn.length < 2 || invalidPartial.has(pnLower)) {
                log('🚨 INVALID PARTIAL NAME DETECTED - clearing:', rawSlots.partialName);
            } else {
                currentSlots.partialName = rawSlots.partialName;
            }
        }
        
        // Copy any other custom slots
        for (const key of Object.keys(rawSlots)) {
            if (!['name', 'phone', 'address', 'time', 'partialName'].includes(key)) {
                currentSlots[key] = rawSlots[key];
            }
        }
        
        log('CHECKPOINT 8a: Slots after validation', { 
            raw: JSON.stringify(rawSlots), 
            validated: JSON.stringify(currentSlots) 
        });
        
        // If validation cleared any invalid slots, update the session to persist the cleanup
        const slotsWereCleaned = JSON.stringify(rawSlots) !== JSON.stringify(currentSlots);
        if (slotsWereCleaned) {
            log('🧹 CLEANING SESSION - Invalid slots were removed');
            session.collectedSlots = currentSlots;
            // Save immediately so the cleanup persists
            try {
                await session.save();
                log('✅ Session cleaned and saved');
            } catch (saveErr) {
                log('⚠️ Failed to save cleaned session (non-fatal)', { error: saveErr.message });
            }
        }
        
        const extractedThisTurn = {};
        const initialSlotsSnapshot = { ...currentSlots };
        const setExtractedSlotIfChanged = (slotKey, value) => {
            if (value === undefined || value === null) return;
            const previous = initialSlotsSnapshot[slotKey];
            if (String(previous || '') !== String(value || '')) {
                extractedThisTurn[slotKey] = value;
            }
        };
        
        // Get booking config for askMissingNamePart setting
        const bookingConfig = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: session?.flags || {} });
        
        // DIAGNOSTIC: Log V110 booking config
        const frontDeskBehavior = company?.aiAgentSettings?.frontDeskBehavior || {};
        const v110SlotRegistry = frontDeskBehavior.slotRegistry || {};
        const v110BookingFlow = frontDeskBehavior.bookingFlow || {};
        
        log('BOOKING CONFIG DIAGNOSTIC (V110)', {
            source: bookingConfig.source,
            isConfigured: bookingConfig.isConfigured,
            slotCount: bookingConfig.slots?.length || 0,
            slotIds: bookingConfig.slots?.map(s => s.slotId) || [],
            v110: {
                hasSlotRegistry: !!v110SlotRegistry.slots?.length,
                slotRegistryCount: v110SlotRegistry.slots?.length || 0,
                hasBookingFlow: !!v110BookingFlow.steps?.length,
                bookingFlowStepCount: v110BookingFlow.steps?.length || 0,
                isV110Active: bookingConfig.source === 'V110_SLOT_REGISTRY'
            },
            companyHasFrontDesk: !!company?.aiAgentSettings?.frontDeskBehavior,
            // 🔍 V42: Show what fields each raw slot has to debug normalization rejection
            rawSlotSample: bookingConfig.slots?.slice(0, 3).map(s => ({
                hasId: !!s?.id,
                idValue: s?.id,
                hasSlotId: !!s?.slotId,
                slotIdValue: s?.slotId,
                hasKey: !!s?.key,
                keyValue: s?.key,
                hasQuestion: !!s?.question,
                questionPreview: s?.question?.substring?.(0, 30),
                _v110: s?._v110 || false,
                allKeys: s ? Object.keys(s) : []
            }))
        });
        // Find name slot by TYPE (not by slotId) - Type dropdown determines behavior
        const nameSlotConfig = bookingConfig.slots.find(s => s.type === 'name' || s.slotId === 'name' || s.id === 'name');
        const askMissingNamePart = nameSlotConfig?.askMissingNamePart === true;

        // ═══════════════════════════════════════════════════════════════════
        // V75: SPELLING VARIANT ANSWER CAPTURE (pre-LLM, deterministic)
        // ═══════════════════════════════════════════════════════════════════
        // If the prior assistant message asked a spelling-variant question like:
        // "Mark with a K or Marc with a C?"
        // and the user replies "with a C" (or "who is Marc with a C"),
        // we MUST write the chosen spelling into the slot immediately so:
        // - Booking can proceed deterministically
        // - The inspector reflects the corrected spelling
        //
        // GATING: require BOTH UI toggles:
        // - frontDeskBehavior.nameSpellingVariants.enabled
        // - bookingSlots(name).confirmSpelling
        const spellingConfigPre = company.aiAgentSettings?.frontDeskBehavior?.nameSpellingVariants || {};
        const spellingEnabledPre = spellingConfigPre.enabled === true && nameSlotConfig?.confirmSpelling === true;
        if (spellingEnabledPre && userText) {
            const lastAssistantMsg = [...(conversationHistory || [])].reverse().find(t => t.role === 'assistant')?.content || '';
            const inferredVariant = parseSpellingVariantPrompt(lastAssistantMsg);
            const inferredChoice = inferredVariant ? parseSpellingVariantResponse(userText, inferredVariant) : null;
            
            if (inferredVariant && inferredChoice) {
                // Persist as the current "best" name spelling (single-token name)
                currentSlots.name = inferredChoice;
                currentSlots.partialName = inferredChoice;
                setExtractedSlotIfChanged('name', inferredChoice);
                setExtractedSlotIfChanged('partialName', inferredChoice);
                
                log('📝 V75: Captured spelling-variant choice during slot extraction', {
                    lastAssistantMsg: lastAssistantMsg.substring(0, 80),
                    inferredVariant,
                    userText: userText.substring(0, 80),
                    chosenName: inferredChoice
                });
            }
        }
        
        // Extract name
        // ═══════════════════════════════════════════════════════════════════════
        // NAME CORRECTION LOGIC: Allow explicit "my name is X" to override
        // even if a name was already extracted (could have been wrong)
        // ═══════════════════════════════════════════════════════════════════════
        const bookingConfigCheck = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: session?.flags || {} });
        const nameSlotCheck = (bookingConfigCheck.slots || []).find(s =>
            (s.slotId || s.id || s.type) === 'name'
        );
        // 🎯 PROMPT AS LAW: Default askFullName to FALSE
        // Only ask for last name if UI explicitly requires it
        // CHECK BOTH: Direct property (UI saves here) AND nested nameOptions (legacy)
        // V36 FIX: Check both boolean and string values
        const askFullNameEnabled = nameSlotCheck?.askFullName === true || nameSlotCheck?.askFullName === 'true' ||
                                   nameSlotCheck?.requireFullName === true || nameSlotCheck?.requireFullName === 'true' ||
                                   nameSlotCheck?.nameOptions?.askFullName === true || nameSlotCheck?.nameOptions?.askFullName === 'true' ||
                                   nameSlotCheck?.nameOptions?.requireFullName === true || nameSlotCheck?.nameOptions?.requireFullName === 'true';

        // ═══════════════════════════════════════════════════════════════════════
        // V96n FIX: TRUST PRE-EXTRACTED SLOTS - DO NOT RE-EXTRACT!
        // ═══════════════════════════════════════════════════════════════════════
        // BUG (FEB 2026): preExtractedSlots from v2twilio correctly had name="Mark",
        // but internal extraction on "my name is Mark... air conditioning problems"
        // was extracting "Air Conditioning" and overwriting the correct value.
        //
        // FIX: If preExtractedSlots.name exists and currentSlots.name matches it,
        // SKIP internal extraction entirely. The external SlotExtractor already
        // validated this name using proper patterns.
        // ═══════════════════════════════════════════════════════════════════════
        const hasValidPreExtractedName = preExtractedSlots?.name && 
            currentSlots.name === preExtractedSlots.name;
        
        if (hasValidPreExtractedName) {
            log('📝 V96n: TRUSTING pre-extracted name from v2twilio - skipping internal extraction', {
                name: currentSlots.name,
                reason: 'preExtractedSlots matched currentSlots'
            });
        } else if (userText) {
            const userTextLower = userText.toLowerCase();
            const isExplicitNameStatement = /my name is|name is|i'm called|call me/i.test(userText);
            
            if (currentSlots.name && !isExplicitNameStatement) {
                // Name already collected and user is NOT explicitly stating their name
            log('📝 Name already collected:', currentSlots.name);
            } else {
            log('🔍 Attempting name extraction from:', userText.substring(0, 50));
                if (currentSlots.name && isExplicitNameStatement) {
                    log('🔄 User explicitly stating name - will override previous:', currentSlots.name);
                }
                
            // V32: Pass expectingName flag - true if we're in BOOKING mode and asking for name
            // V36: Pass custom stop words from company config (UI-controlled)
            // Check activeSlotType (the TYPE, not the custom ID) to see if we're asking for name
            const nameSlotAsked = session?.locks?.askedSlots?.name === true || session?.booking?.askedSlots?.name === true;
            const expectingName = session.mode === 'BOOKING' && (
                session.booking?.activeSlotType === 'name' ||
                session.booking?.activeSlot === 'name' ||
                (nameSlotAsked && !currentSlots.name && !currentSlots.partialName)
            );
            // V111: Read company name stop words via AWConfigReader (canonical path)
            awReader.setReaderId('ConversationEngine.slotExtraction.name');
            const customStopWords = awReader.getArray('frontDesk.nameStopWords');
            let extractedName = SlotExtractors.extractName(userText, { 
                expectingName, 
                customStopWords
            });
            log('🔍 V36 Extraction result (via AW):', extractedName || '(none)', { expectingName, nameSlotAsked, customStopWordsCount: customStopWords.length });
            
            // ═══════════════════════════════════════════════════════════════════
            // V29 FIX: Context-aware name extraction
            // When we're in BOOKING mode and actively asking for name, be more aggressive
            // "yes it's Mark" / "Mark" / "yes, Mark" should all work
            // ═══════════════════════════════════════════════════════════════════
            if (!extractedName && expectingName) {
                log('🔍 V29: Context-aware name extraction (expectingName=true)');
                
                // Try to extract a capitalized word from short responses
                const words = userText.trim().split(/\s+/);
                const cleanWords = words.filter(w => {
                    const lower = w.toLowerCase();
                    // Filter out common non-name words
                    const skipWords = ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'no', 'nope', 
                                       'it', 'is', 'its', "it's", 'my', 'name', 'the', 'a', 'an',
                                       'please', 'hi', 'hello', 'hey'];
                    return !skipWords.includes(lower) && /^[a-zA-Z]+$/.test(w) && w.length >= 2;
                });
                
                if (cleanWords.length === 1 || cleanWords.length === 2) {
                    // Title case the name(s)
                    extractedName = cleanWords
                        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
                        .join(' ');
                    log('🔍 V29: Context-extracted name:', extractedName);
                }
            }
                
            if (extractedName) {
                const isPartialName = !extractedName.includes(' ');
                const alreadyAskedForMissingPart = session.askedForMissingNamePart === true || 
                    session.booking?.meta?.name?.askedMissingPartOnce === true;

                // ════════════════════════════════════════════════════════════════════════
                // V85 FIX: LAST NAME CAPTURE
                // ════════════════════════════════════════════════════════════════════════
                // When we already have a partialName AND get another partial name,
                // this is the LAST NAME response - combine them!
                // 
                // BEFORE (BUG): "Mark" → ask last name → "Gonzales" → partialName = "Gonzales" ❌
                // AFTER (FIX):  "Mark" → ask last name → "Gonzales" → name = "Mark Gonzales" ✅
                // ════════════════════════════════════════════════════════════════════════
                if (currentSlots.partialName && isPartialName) {
                    // We already have first name, this must be last name
                    const partialLower = currentSlots.partialName.toLowerCase();
                    const extractedLower = extractedName.toLowerCase();
                    
                    if (partialLower === extractedLower) {
                        // Same name repeated - just promote to full name
                        currentSlots.name = currentSlots.partialName;
                        log('📝 V85: Same name repeated, promoting partial', { name: currentSlots.name });
                    } else {
                        // Different names - combine as first + last
                        currentSlots.name = `${currentSlots.partialName} ${extractedName}`;
                        log('📝 V85: LAST NAME CAPTURED - Combined first + last', { 
                            first: currentSlots.partialName, 
                            last: extractedName,
                            fullName: currentSlots.name 
                        });
                    }
                    delete currentSlots.partialName;
                    setExtractedSlotIfChanged('name', currentSlots.name);
                }
                // Full-name mode: capture FIRST single-token as PARTIAL (only if no partial yet)
                else if (askFullNameEnabled && isPartialName && !currentSlots.partialName) {
                    currentSlots.partialName = extractedName;
                    setExtractedSlotIfChanged('partialName', extractedName);
                    log('📝 PARTIAL NAME: askFullName enabled, captured first name only', {
                        partialName: extractedName
                    });
                } else if (askMissingNamePart && isPartialName && !alreadyAskedForMissingPart && !currentSlots.partialName) {
                    // Store partial, let AI ask for full name
                    currentSlots.partialName = extractedName;
                    setExtractedSlotIfChanged('partialName', extractedName);
                    log('Partial name detected (will ask for full)', { partialName: extractedName });
                } else {
                    // Accept name as-is (either full name or single name when askFullName is OFF)
                    currentSlots.name = extractedName;
                    setExtractedSlotIfChanged('name', currentSlots.name);
                    log('Name extracted', { name: currentSlots.name });
                }
            } else if (currentSlots.partialName) {
                // Accept partial as complete (only ask once)
                currentSlots.name = currentSlots.partialName;
                delete currentSlots.partialName;
                setExtractedSlotIfChanged('name', currentSlots.name);
                log('Accepting partial name as complete', { name: currentSlots.name });
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V92 FIX: SLOT PERSISTENCE GATING
        // ═══════════════════════════════════════════════════════════════════════════
        // Only persist phone/address/time slots when BOOKING IS ACTIVE or agent asked.
        // DISCOVERY mode should NOT write booking slots from free-form speech.
        // 
        // Bug example: "we've had this problem like 2 weeks ago" → address = "2 weeks ago"
        // This happened because extraction ran during DISCOVERY with no gating.
        // 
        // Rule: Only persist if:
        // (a) bookingModeLocked === true, OR
        // (b) session.mode === 'BOOKING', OR
        // (c) agent explicitly asked for that slot (currentBookingStep matches)
        // ═══════════════════════════════════════════════════════════════════════════
        const isBookingActive = session.bookingModeLocked === true || 
                               session.mode === 'BOOKING' ||
                               session.booking?.consentGiven === true;
        const currentStep = session.currentBookingStep || session.booking?.currentStep || null;
        
        // Extract phone - always allowed (phone is often from caller_id, not speech)
        if (!currentSlots.phone && userText) {
            const extractedPhone = SlotExtractors.extractPhone(userText);
            if (extractedPhone) {
                currentSlots.phone = extractedPhone;
                extractedThisTurn.phone = extractedPhone;
                log('Phone extracted', { phone: extractedPhone });
            }
        }
        
        // Extract address - ONLY if booking is active OR agent asked for address
        const addressAsked = currentStep?.toLowerCase()?.includes('address') || 
                            session.booking?.activeSlotType === 'address' ||
                            session.booking?.askedSlots?.address === true;
        if (!currentSlots.address && userText) {
            const extractedAddress = SlotExtractors.extractAddress(userText);
            if (extractedAddress) {
                // ═══════════════════════════════════════════════════════════════════
                // V92 FIX: ADDRESS VALIDATION - Reject questions and garbage input
                // ═══════════════════════════════════════════════════════════════════
                // WIRED: frontDesk.addressValidation.rejectQuestions
                // Bug: "what was before? i'm not sure what you said." was stored as address
                // ═══════════════════════════════════════════════════════════════════
                const addressValidation = company.aiAgentSettings?.frontDesk?.booking?.addressVerification || {};
                const rejectQuestions = addressValidation.rejectQuestions !== false; // Default true
                
                const isQuestion = userText.trim().endsWith('?');
                const looksLikeGarbage = /\b(what|i'm not sure|don't know|didn't|couldn't|can you|could you|repeat|say again)\b/i.test(extractedAddress);
                const tooShort = extractedAddress.replace(/\s/g, '').length < 5;
                
                const addressRejected = rejectQuestions && (isQuestion || looksLikeGarbage || tooShort);
                
                if (addressRejected) {
                    log('⚠️ V92: Address REJECTED (validation failed)', {
                        extractedAddress: extractedAddress.substring(0, 50),
                        isQuestion,
                        looksLikeGarbage,
                        tooShort,
                        reason: isQuestion ? 'IS_QUESTION' : (looksLikeGarbage ? 'GARBAGE_TEXT' : 'TOO_SHORT')
                    });
                    // Don't store - let the agent re-ask for address
                } else if (isBookingActive || addressAsked) {
                    currentSlots.address = extractedAddress;
                    extractedThisTurn.address = extractedAddress;
                    log('Address extracted (booking active or asked)', { address: extractedAddress });
                } else {
                    // Store as candidate but don't persist to slot
                    session.candidateSlots = session.candidateSlots || {};
                    session.candidateSlots.address = extractedAddress;
                    log('⚠️ V92: Address candidate stored (NOT persisted - discovery mode)', { 
                        address: extractedAddress,
                        reason: 'SLOT_GATING_DISCOVERY_MODE'
                    });
                }
            }
        }
        
        // Extract time preference - ONLY if booking is active OR agent asked for time
        const timeAsked = currentStep?.toLowerCase()?.includes('time') ||
                         session.booking?.activeSlotType === 'time' ||
                         session.booking?.askedSlots?.time === true;
        if (!currentSlots.time && userText) {
            const extractedTime = SlotExtractors.extractTime(userText);
            if (extractedTime) {
                if (isBookingActive || timeAsked) {
                    currentSlots.time = extractedTime;
                    extractedThisTurn.time = extractedTime;
                    log('Time extracted (booking active or asked)', { time: extractedTime });
                } else {
                    // Store as candidate but don't persist to slot
                    session.candidateSlots = session.candidateSlots || {};
                    session.candidateSlots.time = extractedTime;
                    log('⚠️ V92: Time candidate stored (NOT persisted - discovery mode)', { 
                        time: extractedTime,
                        reason: 'SLOT_GATING_DISCOVERY_MODE'
                    });
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // PARTIAL NAME HANDLING - Check booking config for askFullName setting
        // ═══════════════════════════════════════════════════════════════════════
        // If askFullName is enabled in booking config, we DON'T auto-promote
        // partial names. Instead, the booking safety net will ask for last name.
        // ═══════════════════════════════════════════════════════════════════════
        // V34 FIX: Renamed to avoid duplicate declaration with greeting intercept
        const inBookingModeForName = session.mode === 'BOOKING' || session.booking?.consentGiven;
        
        // Check if askFullName is enabled in booking config
        
        if (currentSlots.partialName && !currentSlots.name) {
            if (inBookingModeForName && !askFullNameEnabled) {
                // In booking mode with askFullName OFF: promote partial to full name
                currentSlots.name = currentSlots.partialName;
                extractedThisTurn.name = currentSlots.partialName;
                log('📝 PARTIAL NAME PROMOTED: askFullName is OFF, accepting partial', {
                    partialName: currentSlots.partialName,
                    promotedTo: currentSlots.name
                });
            } else if (inBookingModeForName && askFullNameEnabled) {
                // In booking mode with askFullName ON: keep as partial, will ask for last name
                // V88 FIX: Only set extractedThisTurn.partialName, NOT extractedThisTurn.name!
                // Setting extractedThisTurn.name here was causing filledSlots to show
                // name="Mark" even though we only have a partial name, which prevented
                // the last name "Gonzales" from being combined properly.
                extractedThisTurn.partialName = currentSlots.partialName;
                // DO NOT set extractedThisTurn.name - that happens after we get the last name!
                log('📝 PARTIAL NAME: askFullName is ON, will ask for last name', {
                    partialName: currentSlots.partialName
                });
            }
            // In discovery mode: keep as partial, will ask for full name later
        }
        
        const willAskForMissingNamePart = currentSlots.partialName && !currentSlots.name && !inBookingModeForName;
        log('CHECKPOINT 8: ✅ Slots extracted', { 
            currentSlots: JSON.stringify(currentSlots),
            extractedThisTurn: JSON.stringify(extractedThisTurn),
            willAskForMissingNamePart,
            inBookingModeForName
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // STEP 8: OPTION 1 - LLM SPEAKS UNTIL CONSENT
        // ═══════════════════════════════════════════════════════════════════════
        // 
        // ARCHITECTURE (V8 - OPTION 1):
        // - session.mode = DISCOVERY | SUPPORT | BOOKING | COMPLETE | ERROR
        // - DISCOVERY/SUPPORT: LLM ALWAYS SPEAKS (state machine provides guidance)
        // - BOOKING: Only after explicit consent (deterministic prompts)
        // - Consent detected via UI-configured phrases (detectionTriggers.wantsBooking[])
        // 
        // THE CORE PRINCIPLE:
        // "The LLM is the receptionist. The booking system is the clipboard.
        //  The clipboard stays hidden until the caller asks for it."
        // ═══════════════════════════════════════════════════════════════════════
        log('CHECKPOINT 9: Option 1 Mode Control...');
        
        // Initialize session.booking if not set
        if (!session.booking) {
            session.booking = { consentGiven: false };
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // MODE RESTORATION - Restore mode from session state
        // Priority: COMPLETE > BOOKING (if consent given OR pending confirmations) > DISCOVERY
        // V37 FIX: Also restore BOOKING mode if any slot has pendingConfirm
        // ═══════════════════════════════════════════════════════════════════════
        
        // V37 FIX: Check for pending confirmations (phone, address, etc.)
        const hasPendingConfirm = 
            session.booking?.meta?.phone?.pendingConfirm === true ||
            session.booking?.meta?.address?.pendingConfirm === true ||
            session.booking?.meta?.time?.pendingConfirm === true ||
            session.booking?.meta?.email?.pendingConfirm === true ||
            session.booking?.meta?.serviceType?.pendingConfirm === true;
        
        if (session.booking.completedAt || session.mode === 'COMPLETE') {
            // 🔒 COMPLETE MODE LOCK: Booking already finalized
            // Never re-ask slots after completion
            session.mode = 'COMPLETE';
            log('✅ MODE RESTORED: Booking already COMPLETE - will not re-ask slots');
        } else if (session.booking.consentGiven || hasPendingConfirm) {
            session.mode = 'BOOKING';
            // ═══════════════════════════════════════════════════════════════════════════
            // V97 FIX: RESTORE bookingModeLocked WHEN RESTORING BOOKING MODE
            // ═══════════════════════════════════════════════════════════════════════════
            // BUG: Mode was restored but bookingModeLocked wasn't, causing the guard
            // at line ~6310 to fail and competing handlers to fire.
            // FIX: When consent was previously given, always lock booking mode.
            // ═══════════════════════════════════════════════════════════════════════════
            session.bookingModeLocked = true;
            if (hasPendingConfirm && !session.booking.consentGiven) {
                // V37: Force consent if we have pending confirmations (safety net)
                session.booking.consentGiven = true;
                log('📋 MODE RESTORED: Pending slot confirmation detected - forcing BOOKING mode', {
                    phonePending: session.booking?.meta?.phone?.pendingConfirm,
                    addressPending: session.booking?.meta?.address?.pendingConfirm,
                    bookingModeLocked: true  // V97
                });
            } else {
                log('📋 MODE RESTORED: Consent was given previously, restoring BOOKING mode', {
                    bookingModeLocked: true  // V97
                });
            }
        } else if (!session.mode) {
            session.mode = 'DISCOVERY';
            log('🔍 MODE INITIALIZED: Starting in DISCOVERY mode');
        }
        
        // 📊 DEBUG SNAPSHOT: Log slot state at start of turn
        log('📊 SLOT STATE SNAPSHOT (start of turn)', {
            mode: session.mode,
            activeSlot: session.booking?.activeSlot,
            slotsNormalized: currentSlots,
            nameMeta: session.booking?.meta?.name,
            consentGiven: session.booking?.consentGiven,
            completedAt: session.booking?.completedAt
        });
        
        // Declare aiResult early so booking snap can set it
        let aiResult = null;
        let aiLatencyMs = 0;
        // Scenario tools retrieval result (only set in DISCOVERY/SUPPORT turns; used for debugSnapshot)
        let scenarioRetrieval = null;
            const aiStartTime = Date.now();
        
        // ═══════════════════════════════════════════════════════════════════════
        // V87 P0 CRITICAL: SILENCE/EMPTY INPUT GATE - NEVER Tier-3!
        // ═══════════════════════════════════════════════════════════════════════
        // When caller doesn't say anything (timeout, silence, background noise),
        // use a DETERMINISTIC prompt instead of expensive LLM.
        // This saves 3-5s latency + token cost on every silence event!
        // ═══════════════════════════════════════════════════════════════════════
        // V92 FIX: Also catch FILLER-ONLY utterances that get cleaned to punctuation
        // WIRED: emptyUtteranceGuard
        // Bug: "uh," cleaned to "," → still triggered LLM fallback (820 tokens!)
        // Now: Punctuation-only inputs route to silence handler (0 tokens)
        // ═══════════════════════════════════════════════════════════════════════
        const userTextTrimmed = (userText || '').trim();
        const userTextAlphanumOnly = userTextTrimmed.replace(/[^a-zA-Z0-9]/g, '');
        const isEmptyInput = !userText || userTextTrimmed === '' || userText === '[silence]';
        const isPunctuationOnly = userTextTrimmed.length > 0 && userTextAlphanumOnly.length === 0;
        const isFillerOnly = userTextTrimmed.length > 0 && userTextAlphanumOnly.length < 2; // Single char like "a" or empty
        
        const shouldTreatAsSilence = isEmptyInput || isPunctuationOnly || isFillerOnly;
        
        if (shouldTreatAsSilence) {
            log('🔇 V92: EMPTY/SILENCE/FILLER INPUT DETECTED - Using deterministic prompt (NO Tier-3!)', {
                userTextTrimmed: userTextTrimmed.substring(0, 20),
                isEmptyInput,
                isPunctuationOnly,
                isFillerOnly,
                alphanumLength: userTextAlphanumOnly.length
            });
            
            // ═══════════════════════════════════════════════════════════════════════
            // FEB 2026 FIX: SMART SILENCE HANDLING
            // ═══════════════════════════════════════════════════════════════════════
            // If agent just offered booking ("let me get some info"), silence = implicit YES
            // → Continue with booking questions instead of asking "are you still there?"
            // 
            // Examples:
            // Agent: "We'll send a tech. Let me get some information to book."
            // Caller: [silence]
            // Agent: "What's the service address?" ← Continue, don't ask if they're there!
            // ═══════════════════════════════════════════════════════════════════════
            const lastAgentResponse = session.history?.slice(-1)?.[0]?.agent || '';
            const bookingOfferPatterns = [
                /let me get.*(?:info|information|details)/i,
                /get.*(?:scheduled|booked)/i,
                /book.*(?:appointment|visit|service)/i,
                /schedule.*(?:appointment|service|tech)/i,
                /get.*(?:tech|technician|someone).*out/i
            ];
            const agentJustOfferedBooking = bookingOfferPatterns.some(p => p.test(lastAgentResponse));
            
            // Also check if we have enough slots to start booking (name at minimum)
            const hasName = !!currentSlots.name;
            
            if (agentJustOfferedBooking && hasName) {
                log('🔇 FEB 2026: Agent just offered booking + silence = IMPLICIT CONSENT → Start booking');
                
                // Set up booking consent as if user said "yes"
                session.booking = session.booking || {};
                session.booking.consentGiven = true;
                session.booking.consentTurn = (session.metrics?.totalTurns || 0) + 1;
                session.booking.consentReason = 'SILENCE_AFTER_BOOKING_OFFER';
                session.booking.consentPhrase = '[implicit consent - silence after booking offer]';
                
                // DON'T set aiResult here - let the normal booking trigger logic handle it
                // by treating this as an implicit "yes" and continuing with normal flow
                log('🔇 Silence after booking offer → treating as implicit yes, continuing to booking trigger');
                
                // Reset silence count since this isn't a real silence issue
                session.metrics = session.metrics || {};
                session.metrics.silenceCount = 0;
                
                // DON'T set aiResult - fall through to normal processing which will detect consent
            } else {
                // Normal silence handling
                const silenceConfig = company.aiAgentSettings?.voiceSettings?.silenceHandling || {};
                const silencePrompts = silenceConfig.silencePrompts || [
                    "Are you still there?",
                    "I'm still here whenever you're ready.",
                    "Take your time - I'm listening.",
                    "Hello? Can you hear me?"
                ];
                
                // Rotate through silence prompts based on turn count
                const silenceCount = session.metrics?.silenceCount || 0;
                const silenceReply = silencePrompts[silenceCount % silencePrompts.length];
                
                // Track silence count for escalation
                session.metrics = session.metrics || {};
                session.metrics.silenceCount = silenceCount + 1;
                
                // If too many consecutive silences, offer transfer
                const maxSilences = silenceConfig.maxSilencesBeforeTransfer || 3;
                let finalSilenceReply = silenceReply;
                
                if (silenceCount >= maxSilences - 1) {
                    finalSilenceReply = silenceConfig.transferPrompt || 
                        "I'm having trouble hearing you. Would you like me to transfer you to someone who can help?";
                }
                
                aiResult = {
                    reply: finalSilenceReply,
                    conversationMode: session.mode || 'DISCOVERY',
                    filledSlots: currentSlots,
                    signals: { isSilence: true },
                    latencyMs: Date.now() - aiStartTime,
                    tokensUsed: 0,  // NO LLM cost!
                    fromStateMachine: true,
                    matchSource: 'SILENCE_HANDLER',
                    tier: 'tier1',
                    mode: session.mode || 'DISCOVERY',
                    debug: {
                        source: 'SILENCE_DETERMINISTIC',
                        silenceCount: silenceCount + 1,
                        maxSilences
                    }
                };
                
                // Log to Black Box
                if (BlackBoxLogger) {
                    BlackBoxLogger.logEvent({
                        callId: session._id?.toString(),
                        companyId,
                        type: 'SILENCE_HANDLED_TIER1',
                        data: {
                            silenceCount: silenceCount + 1,
                            maxSilences,
                            reply: finalSilenceReply,
                            latencyMs: Date.now() - aiStartTime
                        }
                    }).catch(() => {});
                }
                
                log('🔇 V87: SILENCE RESPONSE (instant, no LLM)', { 
                    silenceCount: silenceCount + 1, 
                    reply: finalSilenceReply 
                });
            }
            // Skip all other processing if aiResult was set
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // 🎯 V94 P0: BOOKING INTENT GATE - RUNS BEFORE META INTENTS!
        // ═══════════════════════════════════════════════════════════════════════
        // CRITICAL FIX: Booking intent detection MUST run FIRST so that:
        // - "as soon as possible" → triggers booking, not REPAIR_CONVERSATION
        // - "i said i need service" → triggers booking, not REPAIR_CONVERSATION
        // 
        // The meta intent patterns (especially REPAIR_CONVERSATION with /i said/)
        // were catching booking utterances before booking detection could run.
        // Now booking intent runs FIRST with highest priority via MINIMAL BOOKING DETECTION.
        // ═══════════════════════════════════════════════════════════════════════
        
        // AW wiring: Read config for explicit consent requirement
        const bookingRequiresExplicitConsent = awReader 
            ? awReader.get('frontDesk.discoveryConsent.bookingRequiresExplicitConsent')
            : (company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.bookingRequiresExplicitConsent ?? false);
        
        // ═══════════════════════════════════════════════════════════════════════
        // 🎯 MINIMAL BOOKING DETECTION (Clean Sweep - Feb 2026)
        // ═══════════════════════════════════════════════════════════════════════
        // ═══════════════════════════════════════════════════════════════════════
        // SCHEDULING ACCEPTANCE DETECTOR
        // ═══════════════════════════════════════════════════════════════════════
        // Detects caller intent to schedule/book via:
        //   1. Explicit consent ("yes", "go ahead") when consentPending
        //   2. Explicit booking keywords ("schedule", "book", "appointment")
        //   3. Implicit service requests ("I need service", "send someone")
        //
        // In V110, this feeds signals.deferToBookingRunner which causes
        // FrontDeskRuntime to set schedulingAccepted (not bookingModeLocked).
        // ConversationEngine never locks booking — FrontDeskRuntime decides.
        //
        // Patterns are config-driven via Control Plane Wiring:
        //   frontDesk.detectionTriggers.directIntentPatterns
        //   frontDesk.detectionTriggers.wantsBooking
        //   frontDesk.detectionTriggers.implicitConsentPhrases
        // ═══════════════════════════════════════════════════════════════════════
        const strictModeEnabled = awReader 
            ? awReader.get('frontDesk.enforcement.level', 'warn') === 'strict'
            : (company?.aiAgentSettings?.frontDesk?.enforcement?.level === 'strict' ||
               company?.aiAgentSettings?.frontDeskBehavior?.enforcement?.level === 'strict');
        
        // V110 detection: check if Discovery Flow is configured
        const discoverySteps = awReader 
            ? awReader.get('frontDesk.discoveryFlow.steps', [])
            : (company?.aiAgentSettings?.frontDesk?.discoveryFlow?.steps || []);
        const hasDiscoveryFlow = Array.isArray(discoverySteps) && discoverySteps.length > 0;
        
        let bookingIntentDetected = false;
        let bookingConsentPending = session.booking?.consentPending || paramBookingConsentPending || false;
        let consentGivenThisTurn = false;
        
        // ═══════════════════════════════════════════════════════════════════════
        // BOOKING INTENT DETECTION — Runs in ALL modes (including V110)
        // ═══════════════════════════════════════════════════════════════════════
        // In V110, this detects implicit consent ("I need service", "send someone")
        // and explicit consent ("yes", "schedule"). FrontDeskRuntime handles the
        // difference: V110 sets schedulingAccepted instead of bookingModeLocked.
        //
        // This is the "scheduling acceptance detector" that makes V110 work:
        //   Caller: "I need AC service" → bookingIntentDetected = true
        //   → signals.deferToBookingRunner → FrontDeskRuntime sets schedulingAccepted
        //   → Info collection begins on next turn
        // ═══════════════════════════════════════════════════════════════════════
        
        if (!aiResult && userText && userText.length > 0 && !session.bookingModeLocked) {
            log('📋 BOOKING_INTENT_DETECTION running', {
                strictModeEnabled,
                v110Active: hasDiscoveryFlow,
                userTextPreview: userText.substring(0, 50)
            });
            
            // ═══════════════════════════════════════════════════════════════════
            // V98c: READ PATTERNS FROM CONTROL PLANE (UI-configurable)
            // ═══════════════════════════════════════════════════════════════════
            const defaultConsentPhrases = ['yes', 'yeah', 'yep', 'yup', 'sure', 'okay', 'ok', 'please', 
                'go ahead', 'sounds good', 'that works', "let's do it", 'absolutely', 'definitely'];
            const defaultUrgencyPhrases = ['as soon as possible', 'asap', 'today', 'right away', 'right now',
                'immediately', 'this morning', 'this afternoon', 'this evening', 'earliest', 
                'first available', 'next available', 'send someone', 'get someone out', 'come out'];
            const defaultBookingKeywords = ['schedule', 'book', 'appointment', 'technician', 
                'send someone', 'get someone', 'come out', 'when can you', 'how soon can you'];
            
            // Read from Control Plane via AWConfigReader
            let consentPhrases, urgencyPhrases, bookingKeywords;
            if (awReader) {
                awReader.setReaderId('ConversationEngine.minimalBookingDetection');
                consentPhrases = awReader.get('frontDesk.discoveryConsent.consentPhrases', defaultConsentPhrases);
                // Urgency is part of wantsBooking triggers
                const wantsBooking = awReader.get('frontDesk.detectionTriggers.wantsBooking', []);
                urgencyPhrases = wantsBooking.filter(p => 
                    /asap|soon|today|immediate|earliest|first available|right away/i.test(p)
                );
                if (urgencyPhrases.length === 0) urgencyPhrases = defaultUrgencyPhrases;
                
                // V110: Booking keywords from frontDesk.detectionTriggers.* (sole source)
                const directIntentPatterns = awReader.get('frontDesk.detectionTriggers.directIntentPatterns', []);
                
                bookingKeywords = [...new Set([...directIntentPatterns, ...wantsBooking])];
                if (bookingKeywords.length === 0) bookingKeywords = defaultBookingKeywords;
            } else {
                // Fallback to defaults (no AWConfigReader available)
                consentPhrases = defaultConsentPhrases;
                urgencyPhrases = defaultUrgencyPhrases;
                bookingKeywords = defaultBookingKeywords;
            }
            
            // Build regex patterns from arrays
            const escapeRegex = (str) => str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const consentRegex = new RegExp(`^(${consentPhrases.map(escapeRegex).join('|')})[\\s.,!]*$`, 'i');
            const urgencyRegex = new RegExp(`\\b(${urgencyPhrases.map(escapeRegex).join('|')})\\b`, 'i');
            const bookingRegex = new RegExp(`\\b(${bookingKeywords.map(escapeRegex).join('|')})\\b`, 'i');
        
            // Now check for booking intent (same level - inside the strictMode check)
            const lowerText = (userText || '').toLowerCase().trim();
            
            // V110: Strip STT artifact punctuation for consent matching.
            // STT filler removal can leave orphaned punctuation (e.g., "Uh, yes, please." → ", yes, .")
            // The ^-anchored consentRegex needs a clean start-of-string to match.
            const cleanedForConsent = lowerText
                .replace(/^[\s,.:;!?]+/, '')   // strip leading punctuation from filler removal
                .replace(/[\s,.:;!?]+$/, '');   // strip trailing punctuation
            
            // ═══════════════════════════════════════════════════════════════════
            // V98 FIX 1: Check if agent offered scheduling and caller responded
            // ═══════════════════════════════════════════════════════════════════
            // If consentPending=true (agent asked "would you like to schedule?"),
            // treat affirmative and urgency phrases as YES → start booking
            // ═══════════════════════════════════════════════════════════════════
            if (bookingConsentPending) {
                let isAffirmative = consentRegex.test(cleanedForConsent) || urgencyRegex.test(lowerText);
                
                // ═══════════════════════════════════════════════════════════════
                // V116 FIX: Accept leading affirmative + additional content
                // ═══════════════════════════════════════════════════════════════
                // PROBLEM: consentRegex uses ^..$ anchors requiring the ENTIRE
                // input to be a consent phrase. When a caller says:
                //   "Yep. It's 12155 Metro Parkway"
                // The "Yep" is clearly consent, but "It's 12155..." makes the
                // full-match regex fail. Caller consents AND provides info.
                //
                // FIX: When consentPending=true, also check if input STARTS WITH
                // an affirmative word. This is safe because consentPending is only
                // true when we explicitly offered booking on the previous turn.
                // ═══════════════════════════════════════════════════════════════
                if (!isAffirmative) {
                    const LEADING_AFFIRMATIVE = /^(yes|yeah|yep|yup|sure|ok|okay|absolutely|definitely|please|of course|go ahead|sounds good|that works|that would be great|uh\s*huh|mm\s*hmm)\b/i;
                    if (LEADING_AFFIRMATIVE.test(cleanedForConsent)) {
                        isAffirmative = true;
                        log('📅 V116: LEADING AFFIRMATIVE detected in consent-pending response', {
                            userText: userText.substring(0, 60),
                            leadingWord: cleanedForConsent.match(LEADING_AFFIRMATIVE)?.[0],
                            reason: 'caller_consents_and_provides_info'
                        });
                    }
                }
                
                if (isAffirmative) {
                    log('📅 V98: CONSENT DETECTED - Affirmative/urgency response to booking offer', {
                        userText: userText.substring(0, 60),
                        consentPending: true,
                        matchType: consentRegex.test(cleanedForConsent) ? 'affirmative' 
                            : urgencyRegex.test(lowerText) ? 'urgency' 
                            : 'leading_affirmative',
                        source: awReader ? 'control_plane' : 'defaults'
                    });
                    bookingIntentDetected = true;
                    consentGivenThisTurn = true;
                }
            }
            
            // ═══════════════════════════════════════════════════════════════════
            // FIX 2: Explicit booking keywords (UI-configurable)
            // ═══════════════════════════════════════════════════════════════════
            // These words explicitly request scheduling regardless of consentPending
            // ═══════════════════════════════════════════════════════════════════
            if (!bookingIntentDetected && userText.length > 3) {
                bookingIntentDetected = bookingRegex.test(userText);
                
                if (bookingIntentDetected) {
                    log('📅 BOOKING_INTENT: Keyword match detected', {
                        userText: userText.substring(0, 60),
                        matchedKeyword: userText.match(bookingRegex)?.[0],
                        source: awReader ? 'control_plane' : 'defaults'
                    });
                }
            }
            
            // ═══════════════════════════════════════════════════════════════════
            // V110: IMPLICIT CONSENT DETECTION
            // ═══════════════════════════════════════════════════════════════════
            // When a caller says "I need service" or "send someone out" that IS
            // consent. They don't need to be asked "would you like to schedule?"
            //
            // Config-driven: frontDesk.detectionTriggers.implicitConsentPhrases
            // Defaults cover common service-trade phrases.
            //
            // This only fires when V110 is active (hasDiscoveryFlow = true).
            // It sets consentGivenThisTurn so FrontDeskRuntime sets
            // schedulingAccepted instead of wasting a turn asking.
            // ═══════════════════════════════════════════════════════════════════
            if (!bookingIntentDetected && hasDiscoveryFlow) {
                const defaultImplicitPhrases = [
                    'need service', 'need ac service', 'need hvac service',
                    'need a service call', 'need someone to come out',
                    'send someone', 'send someone out', 'send a tech',
                    'send a technician', 'get someone out', 'get someone out here',
                    'come out', 'come take a look', 'come check',
                    'need repair', 'need a repair', 'need it fixed',
                    'need this fixed', 'fix it', 'fix this',
                    'need help', 'need someone to help',
                    'can you come out', 'can someone come out',
                    'i need a technician', 'i need a tech',
                    'need an appointment', 'want an appointment',
                    'need it looked at', 'need someone to look at'
                ];
                
                const implicitPhrases = awReader 
                    ? awReader.get('frontDesk.detectionTriggers.implicitConsentPhrases', defaultImplicitPhrases)
                    : defaultImplicitPhrases;
                
                const implicitRegex = new RegExp(
                    `\\b(${implicitPhrases.map(escapeRegex).join('|')})\\b`, 'i'
                );
                
                if (implicitRegex.test(lowerText)) {
                    bookingIntentDetected = true;
                    consentGivenThisTurn = true;
                    
                    log('📅 V110_IMPLICIT_CONSENT: Service request detected as scheduling acceptance', {
                        userText: userText.substring(0, 80),
                        matchedPhrase: lowerText.match(implicitRegex)?.[0],
                        source: awReader ? 'control_plane' : 'defaults',
                        reason: 'Caller explicitly requested service — implicit consent to schedule'
                    });
                }
            }

            // ═══════════════════════════════════════════════════════════════════
            // BOOKING INTENT HANDOFF — signal to FrontDeskRuntime
            // ═══════════════════════════════════════════════════════════════════
            // V110: ConversationEngine signals intent but does NOT lock booking.
            //   FrontDeskRuntime checks discoveryComplete and decides.
            //   If discovery slots are still missing → schedulingAccepted = true,
            //   info collection continues in DISCOVERY lane.
            //
            // Legacy: ConversationEngine locks booking immediately.
            // ═══════════════════════════════════════════════════════════════════
            if (bookingIntentDetected) {
                // Compute diagnostic reason codes for full visibility
                const implicitMatch = lowerText.match(new RegExp(
                    `\\b(${(awReader 
                        ? awReader.get('frontDesk.detectionTriggers.implicitConsentPhrases', [])
                        : []).concat([
                        'need service', 'send someone', 'come out', 'need repair',
                        'need a repair', 'need it fixed', 'need this fixed'
                    ]).map(escapeRegex).join('|')})\\b`, 'i'
                ));
                
                const bookingTriggerReason = consentGivenThisTurn 
                    ? (bookingConsentPending 
                        ? (consentRegex.test(lowerText) ? 'consent_pending_affirmative' : 'consent_pending_urgency')
                        : 'implicit_service_request')
                    : 'explicit_booking_keyword';
                const yesEquivalentMatched = consentGivenThisTurn 
                    ? (userText.match(consentRegex)?.[0] || userText.match(urgencyRegex)?.[0] || implicitMatch?.[0] || userText)
                    : null;
                const explicitKeywordMatched = !consentGivenThisTurn 
                    ? userText.match(bookingRegex)?.[0] 
                    : null;
                const bookingOfferOpenTurn = session.booking?.consentPendingTurn || null;
                const bookingTriggerTurn = session.metrics?.totalTurns || 0;
                
                log('📅 BOOKING_INTENT_HANDOFF: Signaling to FrontDeskRuntime', {
                    userText: userText.substring(0, 60),
                    bookingTriggerReason,
                    yesEquivalentMatched,
                    explicitKeywordMatched,
                    bookingOfferOpenTurn,
                    bookingTriggerTurn,
                    consentPendingWas: bookingConsentPending,
                    v110Active: hasDiscoveryFlow
                });
                
                // Emit BOOKING_TRIGGER event with full diagnostic details
                if (BlackBoxLogger && sessionId && companyId) {
                    BlackBoxLogger.logEvent({
                        callId: sessionId,
                        companyId,
                        type: 'BOOKING_TRIGGER',
                        turn: bookingTriggerTurn,
                        data: {
                            bookingTriggerReason,
                            yesEquivalentMatched,
                            explicitKeywordMatched,
                            bookingOfferOpenTurn,
                            bookingTriggerTurn,
                            consentPendingWas: bookingConsentPending,
                            userTextPreview: userText.substring(0, 60),
                            patternsSource: awReader ? 'controlPlane' : 'globalDefaults',
                            v110Active: hasDiscoveryFlow
                        }
                    }).catch(() => {});
                }

                // Set booking consent state
                session.booking = session.booking || {};
                session.booking.consentGiven = true;
                session.booking.consentPending = false;
                session.booking.consentTurn = bookingTriggerTurn;
                session.booking.consentReason = bookingTriggerReason;
                session.booking.consentPhrase = userText;
                session.booking.yesEquivalentMatched = yesEquivalentMatched;
                
                // ───────────────────────────────────────────────────
                // V110: Do NOT lock booking — FrontDeskRuntime decides
                // based on discoveryComplete. Just signal intent.
                // ───────────────────────────────────────────────────
                // Legacy: Lock booking immediately (no Discovery Flow)
                // ───────────────────────────────────────────────────
                if (!hasDiscoveryFlow) {
                    session.bookingModeLocked = true;
                    session.mode = 'BOOKING';
                }

                // ───────────────────────────────────────────────────────
                // V110: Do NOT set aiResult — let scenarios speak first.
                // Store scheduling signals as deferred; they'll be merged
                // into the final response after scenarios/LLM run.
                // ───────────────────────────────────────────────────────
                // Legacy: Set aiResult immediately (short-circuit scenarios)
                // ───────────────────────────────────────────────────────
                const bookingSignals = {
                    deferToBookingRunner: true,
                    bookingModeLocked: !hasDiscoveryFlow,
                    schedulingAccepted: hasDiscoveryFlow,
                    minimalDetection: true,
                    consentGivenThisTurn,
                    bookingTriggerReason,
                    implicitConsent: bookingTriggerReason === 'implicit_service_request'
                };
                
                if (hasDiscoveryFlow) {
                    // V110: Defer signals — scenarios must acknowledge first
                    // The deferred signals will be injected into the final
                    // aiResult AFTER scenario matching / LLM runs.
                    session._deferredBookingSignals = bookingSignals;
                    
                    log('📅 V110_DEFERRED: Scheduling detected — scenarios will speak first, signals deferred', {
                        bookingTriggerReason,
                        implicitConsent: bookingTriggerReason === 'implicit_service_request',
                        capturedSlots: Object.keys(currentSlots).filter(k => currentSlots[k])
                    });
                } else {
                    // Legacy: Set bookingFlowState for Redis persistence
                    session.bookingFlowState = {
                        bookingModeLocked: true,
                        bookingFlowId: 'minimal_booking_detection',
                        currentStepId: 'name',
                        bookingCollected: { ...currentSlots },
                        bookingState: 'ACTIVE'
                    };
                    
                    aiResult = {
                        reply: null,
                        conversationMode: 'BOOKING',
                        filledSlots: currentSlots,
                        latencyMs: Date.now() - aiStartTime,
                        tokensUsed: 0,
                        fromStateMachine: false,
                        matchSource: 'BOOKING_INTENT_DETECTION',
                        tier: 'tier1',
                        mode: 'BOOKING',
                        bookingFlowState: session.bookingFlowState,
                        signals: bookingSignals,
                        debug: {
                            source: 'BOOKING_INTENT_DETECTION',
                            reason: consentGivenThisTurn 
                                ? 'Consent response to booking offer' 
                                : 'Explicit booking keyword',
                            userText: userText.substring(0, 100),
                            consentPendingWas: bookingConsentPending,
                            v110Active: false
                        }
                    };
                    
                    log('📅 LEGACY_BOOKING_LOCKED: Booking locked, deferring to BookingFlowRunner');
                }
            }
        }
            
        // ═══════════════════════════════════════════════════════════════════════
        // V86 P0: UNIVERSAL META INTENT INTERCEPTOR
        // ═══════════════════════════════════════════════════════════════════════
        // These intents MUST resolve Tier-1 (instant, no LLM) regardless of mode:
        // - "repeat that" / "say that again" / "I didn't hear you"
        // - "what address do you have?" / "do you have an address for me?"
        // - "what number is that?" / "repeat the phone number"
        // - "can you confirm" / "read that back"
        //
        // This runs BEFORE mode-specific handlers to catch all cases.
        // V87: Skip if silence handler already handled this turn
        // V94: Skip if booking intent already handled this turn!
        // ═══════════════════════════════════════════════════════════════════════
        const metaIntentCheck = aiResult ? null : (() => {
            const lowerText = (userText || '').toLowerCase().trim();
            if (!lowerText) return null;
            
            // === REPEAT / DIDN'T HEAR ===
            const repeatPatterns = [
                /\brepeat\b.*\b(that|it|please)\b/i,
                /\bsay\b.*\b(again|that again)\b/i,
                /\bdidn'?t\b.*\b(hear|catch|get)\b.*\b(that|you)\b/i,
                /\bi\s+(didn'?t|couldn'?t)\b.*\bhear\b/i,
                /\b(what|huh)\s*\?\s*$/i,
                /\b(sorry|pardon)\b.*\bwhat\b/i,
                /\bone more time\b/i,
                /\bcome again\b/i
            ];
            
            // === CONFIRM / READ BACK ===
            const confirmPatterns = [
                /\b(can you|could you)\b.*\b(confirm|read back)\b/i,
                /\b(read|say)\b.*\bback\b.*\b(to me)?\b/i,
                /\blet me\b.*\b(make sure|verify|confirm)\b/i
            ];
            
            // === WHAT ADDRESS/PHONE DO YOU HAVE ===
            const addressQueryPatterns = [
                /\b(do you have|what)\b.*\baddress\b.*\b(for me|on file)?\b/i,
                /\baddress\b.*\b(do you|you)\b.*\bhave\b/i,
                /\bwhat\b.*\baddress\b.*\bhave\b/i
            ];
            const phoneQueryPatterns = [
                /\b(do you have|what)\b.*\b(phone|number)\b.*\b(for me|on file)?\b/i,
                /\b(phone|number)\b.*\b(do you|you)\b.*\bhave\b/i,
                /\bwhat\b.*\b(number|phone)\b.*\bhave\b/i,
                /\bwhat\b.*\bnumber\b.*\b(is that|again)\b/i
            ];
            const nameQueryPatterns = [
                /\b(do you have|what)\b.*\bname\b.*\b(for me|on file)?\b/i,
                /\bname\b.*\b(do you|you)\b.*\bhave\b/i,
                /\bwhat\b.*\bname\b.*\bhave\b/i
            ];
            
            // === V87 P0: SERVICE HISTORY / TECHNICIAN IDENTITY ===
            // "who was the technician" / "who came out" / "last visit"
            // These MUST be Tier-1 - don't waste 4s on LLM!
            const techIdentityPatterns = [
                /\bwho\b.*\b(was|is)\b.*\b(the\s+)?(tech|technician|guy|person|man|woman)\b/i,
                /\bwho\b.*\b(came|came out|was here|was out|showed up)\b/i,
                /\b(tech|technician)\b.*\bname\b/i,
                /\bname\s+of\b.*\b(tech|technician)\b/i,
                /\bwho\b.*\bsent\b/i,
                /\blast\b.*\b(visit|service|appointment|time)\b/i,
                /\bwhen\b.*\b(were you|was someone|did someone)\b.*\b(here|out)\b/i
            ];
            
            // === V87 P0: YOU DIDN'T ANSWER / REPAIR BEHAVIOR ===
            // Caller is frustrated - need fast deterministic recovery
            // V94 FIX: Made patterns MORE SPECIFIC to avoid matching booking intent
            // OLD: /\bi\s+(just\s+)?(asked|said|told)\b/i matched "i said as soon as possible"
            // NEW: Require frustration indicators (didn't, again, already, etc.)
            const repairPatterns = [
                /\byou\b.*\bdidn'?t\b.*\b(answer|respond|help|listen)\b/i,
                /\bthat'?s\b.*\bnot\b.*\b(what i|what I)\b.*\b(asked|said|meant)\b/i,
                /\blisten\b.*\b(to me|to what)\b/i,
                // V94 FIX: Must have frustration marker, not just "i said/asked/told"
                /\bi\s+(just|already)\s+(asked|said|told)\s+(you|that)\b/i,  // "i already told you", "i just said that"
                /\bi\s+(asked|said|told)\s+(you|that)\s+(already|before|earlier)\b/i,  // "i said that already"
                /\bcan you\b.*\b(hear|understand)\b.*\bme\b/i,
                /\byou'?re\b.*\bnot\b.*\b(listening|hearing|understanding)\b/i,
                /\bi\s+said\b.*\bdidn'?t\s+(you|hear)\b/i,  // "i said... didn't you hear?"
                /\bwhy\b.*\bi\s+have\s+to\s+repeat\b/i  // "why do i have to repeat"
            ];
            
            // Check patterns
            if (repeatPatterns.some(p => p.test(lowerText))) {
                return { intent: 'REPEAT_LAST', patterns: 'repeat' };
            }
            if (confirmPatterns.some(p => p.test(lowerText))) {
                return { intent: 'CONFIRM_INFO', patterns: 'confirm' };
            }
            if (addressQueryPatterns.some(p => p.test(lowerText)) && currentSlots.address) {
                return { intent: 'QUERY_ADDRESS', value: currentSlots.address };
            }
            if (phoneQueryPatterns.some(p => p.test(lowerText)) && (currentSlots.phone || session._callerPhone)) {
                return { intent: 'QUERY_PHONE', value: currentSlots.phone || session._callerPhone };
            }
            if (nameQueryPatterns.some(p => p.test(lowerText)) && currentSlots.name) {
                return { intent: 'QUERY_NAME', value: currentSlots.name };
            }
            
            // V87 P0: Technician identity / service history
            if (techIdentityPatterns.some(p => p.test(lowerText))) {
                // Check if we have any tech info from discovery or customer context
                const techName = session.discovery?.mentionedTechName || 
                                customerContext?.history?.lastTechnicianName ||
                                null;
                const lastVisit = session.discovery?.previousVisitTime || 
                                 customerContext?.history?.recentVisits?.[0]?.date ||
                                 null;
                return { 
                    intent: 'QUERY_TECH_HISTORY', 
                    techName, 
                    lastVisit,
                    patterns: 'tech_identity' 
                };
            }
            
            // V87 P0: Repair behavior - caller frustrated with agent
            if (repairPatterns.some(p => p.test(lowerText))) {
                return { intent: 'REPAIR_CONVERSATION', patterns: 'repair' };
            }
            
            return null;
        })();
        
        if (metaIntentCheck) {
            log('🚀 V86: META INTENT INTERCEPTED (Tier-1, no LLM)', metaIntentCheck);
            
            let metaReply = '';
            switch (metaIntentCheck.intent) {
                case 'REPEAT_LAST':
                    // Get last agent response from session
                    const lastResponse = session.conversationHistory?.slice(-2)?.[0]?.content ||
                                        session.lastAgentResponse ||
                                        "I'm here to help - what would you like to know?";
                    metaReply = lastResponse;
                    break;
                    
                case 'CONFIRM_INFO':
                    // Read back all collected info
                    const parts = [];
                    if (currentSlots.name) parts.push(`name: ${currentSlots.name}`);
                    if (currentSlots.phone) parts.push(`phone: ${currentSlots.phone}`);
                    if (currentSlots.address) parts.push(`address: ${currentSlots.address}`);
                    if (currentSlots.time) parts.push(`time: ${currentSlots.time}`);
                    metaReply = parts.length > 0 
                        ? `Sure! I have: ${parts.join(', ')}. Is that correct?`
                        : "I don't have any information saved yet. What would you like to provide?";
                    break;
                    
                case 'QUERY_ADDRESS':
                    metaReply = `The address I have is ${metaIntentCheck.value}. Is that correct?`;
                    break;
                    
                case 'QUERY_PHONE':
                    const digits = String(metaIntentCheck.value).replace(/\D/g, '');
                    const cleanPhone = digits.length >= 10 
                        ? `${digits.slice(-10, -7)}-${digits.slice(-7, -4)}-${digits.slice(-4)}`
                        : metaIntentCheck.value;
                    metaReply = `The number I have is ${cleanPhone}. Is that correct?`;
                    break;
                    
                case 'QUERY_NAME':
                    metaReply = `The name I have is ${metaIntentCheck.value}. Is that correct?`;
                    break;
                    
                case 'QUERY_TECH_HISTORY':
                    // V87 P0: Handle technician identity / service history queries
                    if (metaIntentCheck.techName) {
                        metaReply = `Based on the notes, it looks like ${metaIntentCheck.techName} was the technician.`;
                        if (metaIntentCheck.lastVisit) {
                            metaReply += ` They were out on ${metaIntentCheck.lastVisit}.`;
                        }
                        metaReply += ` How can I help you today?`;
                    } else {
                        // No tech info available - acknowledge and pivot to helping
                        metaReply = "I don't have specific technician information in front of me right now. " +
                                   "Let me help you with what you need today - are you looking to schedule a follow-up service?";
                    }
                    break;
                    
                case 'REPAIR_CONVERSATION':
                    // V87 P0: Repair behavior - acknowledge frustration and try again
                    metaReply = "I apologize for any confusion. Let me make sure I understand - " +
                               "what specifically can I help you with right now?";
                    break;
                    
                // URGENCY_SCHEDULING and CLARIFY_BOOKING_SLOT removed - booking handled by minimal detection
            }
            
            if (metaReply) {
                aiResult = {
                    reply: metaReply,
                    conversationMode: session.mode || 'DISCOVERY',
                    filledSlots: currentSlots,
                    signals: {},
                    latencyMs: Date.now() - aiStartTime,
                    tokensUsed: 0,  // No LLM cost - instant Tier-1!
                    fromStateMachine: true,
                    mode: session.mode || 'DISCOVERY',
                    debug: {
                        source: 'META_INTENT_TIER1',
                        intent: metaIntentCheck.intent,
                        interceptedAt: 'UNIVERSAL_HANDLER'
                    }
                };
                
                // Log to Black Box
                if (BlackBoxLogger) {
                    BlackBoxLogger.logEvent({
                        callId: session._id?.toString(),
                        companyId,
                        type: 'META_INTENT_TIER1',
                        data: {
                            intent: metaIntentCheck.intent,
                            pattern: metaIntentCheck.patterns || null,
                            value: metaIntentCheck.value || null,
                            reply: metaReply,
                            latencyMs: Date.now() - aiStartTime
                        }
                    }).catch(() => {});
                }
                
                log('🚀 V86: META INTENT RESPONSE (instant)', { intent: metaIntentCheck.intent, reply: metaReply });
                // Skip to response building
            }
        }
            
        // ═══════════════════════════════════════════════════════════════════════
        // 🔍 V92: DISCOVERY EXTRACTION - Extract context BEFORE generating response
        // ═══════════════════════════════════════════════════════════════════════
        // This runs deterministically (0 tokens) to capture:
        // - Issue/symptom (not cooling, 80 degrees)
        // - Tech mention (Peter came out)
        // - Tenure (longtime customer)
        // - Equipment (AC system)
        // So responses can ACKNOWLEDGE what the caller said!
        // ═══════════════════════════════════════════════════════════════════════
        let discoveryFacts = null;
        if (!aiResult && userText && userText.length > 10) {
            discoveryFacts = DiscoveryExtractor.extract(userText, {
                trade: company?.trade || company?.tradeType,
                techRoster: company?.employees?.map(e => e.name) || []
            });
            
            if (discoveryFacts.hasDiscovery) {
                // Store discovery facts in session
                session.discovery = session.discovery || {};
                if (discoveryFacts.issue && !session.discovery.issue) {
                    session.discovery.issue = discoveryFacts.issue;
                }
                if (discoveryFacts.urgency && discoveryFacts.urgency !== 'normal') {
                    // V92 FIX: Normalize urgency to prevent Mongoose ValidationError
                    // Store both raw (for debugging) and normalized (for schema)
                    const normalizedUrgency = normalizeUrgency(discoveryFacts.urgency);
                    session.discovery.urgency = normalizedUrgency;
                    session.discovery.urgencyRaw = discoveryFacts.urgency; // Debug: original value before normalization
                    
                    if (normalizedUrgency !== discoveryFacts.urgency) {
                        logger.debug('[URGENCY NORMALIZED]', {
                            raw: discoveryFacts.urgency,
                            normalized: normalizedUrgency,
                            sessionId: session._id?.toString()
                        });
                    }
                }
                if (discoveryFacts.techMentioned) {
                    // ═══════════════════════════════════════════════════════════════
                    // V92 FIX: TECH NAME EXCLUSION - Filter out common false positives
                    // ═══════════════════════════════════════════════════════════════
                    // WIRED: discovery.techNameExcludeWords
                    // Bug: "system was working fine" → "System" extracted as tech name
                    // ═══════════════════════════════════════════════════════════════
                    const techNameExcludeWords = company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.techNameExcludeWords || 
                        ['system', 'unit', 'equipment', 'machine', 'device', 'thermostat', 'furnace', 'ac', 'hvac', 'air', 'conditioner', 'heater'];
                    
                    const techNameLower = discoveryFacts.techMentioned.toLowerCase().trim();
                    const isExcluded = techNameExcludeWords.some(word => techNameLower === word.toLowerCase());
                    
                    if (isExcluded) {
                        log('⚠️ V92: Tech name EXCLUDED (false positive)', {
                            techMentioned: discoveryFacts.techMentioned,
                            reason: 'IN_EXCLUSION_LIST',
                            exclusionList: techNameExcludeWords.slice(0, 5).join(', ') + '...'
                        });
                    } else {
                        session.discovery.techMentioned = discoveryFacts.techMentioned;
                    }
                }
                if (discoveryFacts.tenure) {
                    session.discovery.tenure = discoveryFacts.tenure;
                }
                if (discoveryFacts.temperature) {
                    session.discovery.temperature = discoveryFacts.temperature;
                }
                if (discoveryFacts.equipment?.length > 0) {
                    session.discovery.equipment = discoveryFacts.equipment;
                }
                session.discovery.recentVisit = discoveryFacts.recentVisit || false;
                
                log('🔍 DISCOVERY EXTRACTED', {
                    issue: discoveryFacts.issue,
                    urgency: discoveryFacts.urgency,
                    techMentioned: discoveryFacts.techMentioned,
                    tenure: discoveryFacts.tenure,
                    temperature: discoveryFacts.temperature,
                    symptomCount: discoveryFacts.symptoms?.length || 0
                });
                
                // BlackBox telemetry
                try {
                    await BlackBoxLogger.addEvent(session._id?.toString(), 'DISCOVERY_FACTS_EXTRACTED', {
                        issue: discoveryFacts.issue,
                        urgency: discoveryFacts.urgency,
                        techMentioned: discoveryFacts.techMentioned,
                        tenure: discoveryFacts.tenure,
                        temperature: discoveryFacts.temperature,
                        symptomCount: discoveryFacts.symptoms?.length || 0,
                        equipmentCount: discoveryFacts.equipment?.length || 0,
                        recentVisit: discoveryFacts.recentVisit
                    });
                } catch {}
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: PRE-CONSENT CHECK DIAGNOSTICS
        // ═══════════════════════════════════════════════════════════════════════
        // Log the full context BEFORE consent check runs so we can trace failures
        const debugLogging = company.aiAgentSettings?.debugLogging === true;
        const askedConsentQuestionFlag = session.conversationMemory?.askedConsentQuestion || false;
        
        log('🔍 V92: ENTERING CONSENT CHECK', {
            sessionId: session._id?.toString(),
            turn: session.metrics?.totalTurns || 0,
            userInputPreview: (userText || '').substring(0, 50),
            userInputLength: (userText || '').length,
            // Critical flags
            askedConsentQuestion: askedConsentQuestionFlag,
            consentAlreadyGiven: session.booking?.consentGiven || false,
            sessionMode: session.mode,
            aiResultAlreadySet: !!aiResult,
            aiResultSource: aiResult?.debug?.source || null,
            // Session memory state (for persistence debugging)
            conversationMemoryExists: !!session.conversationMemory,
            conversationMemoryKeys: session.conversationMemory ? Object.keys(session.conversationMemory) : []
        });
        
        // V86: Skip if meta intent already handled
        // V94: Also skip if early booking intent detection already handled
        if (aiResult) {
            log('⏭️ V86: Skipping consent detection - already handled', {
                aiResultSource: aiResult?.debug?.source,
                aiResultMode: aiResult?.mode,
                aiResultReplyPreview: (aiResult?.reply || '').substring(0, 50)
            });
        }
        
        // Booking is handled by MINIMAL BOOKING DETECTION at line ~4831
        // which sets bookingModeLocked=true and defers to BookingFlowRunner
        
        log('CHECKPOINT 9a: Mode state', {
            mode: session.mode,
            consentGiven: session.booking?.consentGiven,
            consentPhrase: session.booking?.consentPhrase,
            bookingModeLocked: session.bookingModeLocked || false,
            aiResultSet: !!aiResult
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // V110 OWNER PRIORITY — Replaces kill-switch architecture
        // ═══════════════════════════════════════════════════════════════════════
        //
        // OLD MODEL (kill switches):
        //   bookingRequiresExplicitConsent, forceLLMDiscovery,
        //   disableScenarioAutoResponses — toggles that muzzle the agent
        //
        // NEW MODEL (owner priority):
        //   1. Discovery owns the mic until required slots are captured
        //   2. In Discovery: scenarios are ENRICHMENT (tags, call_reason_detail,
        //      routing hints). They inform the LLM but do NOT output booking
        //      prompts or scheduling questions.
        //   3. After discovery completion, Booking owns the mic
        //   4. Discovery completion IS consent — no separate consent gate
        //
        // Non-V110 companies still use legacy kill switches for backward compat.
        // ═══════════════════════════════════════════════════════════════════════
        awReader.setReaderId('ConversationEngine.ownerPolicy');
        const v110DiscoverySteps = awReader.getArray('frontDesk.discoveryFlow.steps') || [];
        const hasV110DiscoveryFlow = v110DiscoverySteps.length > 0;
        
        // Legacy kill switches — only consulted for non-V110 companies
        const bookingRequiresConsentAW = awReader.get('frontDesk.discoveryConsent.bookingRequiresExplicitConsent', true);
        const forceLLMDiscoveryAW = awReader.get('frontDesk.discoveryConsent.forceLLMDiscovery', false);
        const disableScenarioAutoResponsesAW = awReader.get('frontDesk.discoveryConsent.disableScenarioAutoResponses', false);
        const autoReplyAllowedTypesRaw = awReader.getArray('frontDesk.discoveryConsent.autoReplyAllowedScenarioTypes');
        const autoReplyAllowedScenarioTypes = autoReplyAllowedTypesRaw
            .map(t => (t || '').toString().trim().toUpperCase())
            .filter(Boolean);
        
        // ═══════════════════════════════════════════════════════════════════════
        // V120 FIX: RESPECT UI KILL SWITCHES FOR V110 COMPANIES
        // ═══════════════════════════════════════════════════════════════════════
        // BEFORE: V110 companies had kill switches HARDCODED to off, ignoring
        // the UI settings entirely. This meant flipping "Scenarios as Context Only"
        // or "Force LLM Discovery" in the UI had ZERO effect at runtime.
        //
        // NOW: V110 companies use the SAME UI-driven kill switches as everyone.
        // The UI is law. If the admin sets disableScenarioAutoResponses=true,
        // scenarios become context-only and the discovery flow steps speak.
        // ═══════════════════════════════════════════════════════════════════════
        const killSwitches = {
            bookingRequiresConsent: bookingRequiresConsentAW !== false,
            forceLLMDiscovery: forceLLMDiscoveryAW === true,
            disableScenarioAutoResponses: disableScenarioAutoResponsesAW === true,
            autoReplyAllowedScenarioTypes,
            // V110 flag — tells downstream code that V110 flow is active
            v110OwnerPriority: hasV110DiscoveryFlow
        };
        
        log('CHECKPOINT 9a: 🔒 Owner policy loaded', {
            v110: hasV110DiscoveryFlow,
            ownerPriority: killSwitches.v110OwnerPriority,
            bookingRequiresConsent: killSwitches.bookingRequiresConsent,
            forceLLMDiscovery: killSwitches.forceLLMDiscovery,
            disableScenarioAutoResponses: killSwitches.disableScenarioAutoResponses
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // BOOKING ENTRY — Determined by V110 state or legacy consent gate
        // ═══════════════════════════════════════════════════════════════════════
        // V110: FrontDeskRuntime already decided the lane. If mode=BOOKING,
        //       it means discovery slots are complete. Honor that decision.
        // Non-V110: Legacy consent gate still applies.
        // ═══════════════════════════════════════════════════════════════════════
        // V110: Caller must say "yes" to scheduling offer (consent detection works as designed)
        // Non-V110: Same legacy consent gate
        const canEnterBooking = !killSwitches.bookingRequiresConsent || session.booking?.consentGiven;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V97: SKIP MODE ROUTING IF aiResult ALREADY SET WITH DEFER SIGNAL
        // ═══════════════════════════════════════════════════════════════════════════
        // If V96o/V96p already set aiResult with deferToBookingRunner=true, skip all
        // mode-based routing. v2twilio.js will handle calling BookingFlowRunner.
        // ═══════════════════════════════════════════════════════════════════════════
        const shouldSkipModeRouting = aiResult && (
            aiResult.debug?.source === 'BOOKING_SNAP' ||
            aiResult.signals?.deferToBookingRunner === true
        );
        
        if (shouldSkipModeRouting) {
            log('⚡ V97: SKIPPING MODE ROUTING - aiResult already set', {
                source: aiResult.debug?.source,
                deferToBookingRunner: aiResult.signals?.deferToBookingRunner
            });
            // aiResult is already set, skip to save/return
        }
        // ═══════════════════════════════════════════════════════════════════════
        // COMPLETE MODE - Booking already finalized, handle post-completion Q&A
        // ═══════════════════════════════════════════════════════════════════════
        else if (session.mode === 'COMPLETE') {
            log('✅ COMPLETE MODE: Booking already finalized, handling post-completion');
            
            // Check if user wants to start a NEW booking
            const wantsNewBooking = /\b(another|new|different|schedule|book)\s*(appointment|service|call)?\b/i.test(userText);
            
            // ═══════════════════════════════════════════════════════════════════════
            // V85: READ BACK HANDLER - If user asks about collected booking info
            // "What is the address?" / "What name do you have?" / "What time?"
            // Answer directly from filledSlots instead of going to LLM
            // ═══════════════════════════════════════════════════════════════════════
            const lowerUserText = (userText || '').toLowerCase();
            // ═══════════════════════════════════════════════════════════════════════
            // V38 FIX: Enhanced patterns for read-back detection
            // Handle: "Do you know my address?" → "do my address?" (filler stripped)
            // Handle: "What's my name?" / "my address" / "what address"
            // ═══════════════════════════════════════════════════════════════════════
            const asksAboutAddress = /\b(what|which)\b.*\b(address|location|where)\b.*\b(have|got|on file|saved|recorded|booked)\b/i.test(userText) ||
                                     /\b(address|location)\b.*\b(we|you|i)\b.*\b(have)\b/i.test(userText) ||
                                     /\bdo\s+my\s+address\b/i.test(userText) ||  // V38: "do my address?" (filler-stripped)
                                     /\bwhat('?s?|is)?\s+(my|the)\s+address\b/i.test(userText) ||  // "what's my address"
                                     /\b(my|the)\s+address\s*\??$/i.test(userText.trim());  // "my address?"
            const asksAboutName = /\b(what|which)\b.*\b(name)\b.*\b(have|got|on file|saved|recorded)\b/i.test(userText) ||
                                  /\b(name)\b.*\b(we|you|i)\b.*\b(have)\b/i.test(userText) ||
                                  /\bdo\s+my\s+name\b/i.test(userText) ||  // V38: "do my name?" (filler-stripped)
                                  /\bwhat('?s?|is)?\s+(my|the)\s+name\b/i.test(userText) ||  // "what's my name"
                                  /\b(my|the)\s+name\s*\??$/i.test(userText.trim());  // "my name?"
            const asksAboutPhone = /\b(what|which)\b.*\b(phone|number|cell)\b.*\b(have|got|on file|saved|recorded)\b/i.test(userText) ||
                                   /\b(phone|number)\b.*\b(we|you|i)\b.*\b(have)\b/i.test(userText) ||
                                   /\bdo\s+my\s+(phone|number)\b/i.test(userText) ||  // V38: "do my phone?" (filler-stripped)
                                   /\bwhat('?s?|is)?\s+(my|the)\s+(phone|number)\b/i.test(userText) ||  // "what's my phone"
                                   /\b(my|the)\s+(phone|number)\s*\??$/i.test(userText.trim());  // "my phone?"
            const asksAboutTime = /\b(what|which)\b.*\b(time|when|appointment)\b.*\b(have|got|on file|saved|scheduled|booked)\b/i.test(userText) ||
                                  /\b(time|when)\b.*\b(booked|scheduled)\b/i.test(userText) ||
                                  /\bdo\s+my\s+(time|appointment)\b/i.test(userText) ||  // V38: "do my time?" (filler-stripped)
                                  /\bwhat('?s?|is)?\s+(my|the)\s+(time|appointment)\b/i.test(userText) ||  // "what's my time"
                                  /\b(my|the)\s+(time|appointment)\s*\??$/i.test(userText.trim());  // "my time?"
            const asksAboutBooking = /\b(what|can you|could you)\b.*\b(booking|appointment|info|information|details)\b.*\b(have|read|tell|confirm)\b/i.test(userText) ||
                                     /\b(confirm|read back|repeat)\b.*\b(booking|appointment|info)\b/i.test(userText);
            
            if (asksAboutAddress || asksAboutName || asksAboutPhone || asksAboutTime || asksAboutBooking) {
                log('📋 V85: READ BACK REQUEST DETECTED', { 
                    asksAboutAddress, asksAboutName, asksAboutPhone, asksAboutTime, asksAboutBooking,
                    currentSlots
                });
                
                let readBackReply = '';
                
                if (asksAboutBooking) {
                    // Read back ALL collected info
                    const parts = [];
                    if (currentSlots.name) parts.push(`name: ${currentSlots.name}`);
                    if (currentSlots.phone) {
                        // Format phone friendly
                        const digits = String(currentSlots.phone).replace(/\D/g, '');
                        const cleaned = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
                        const friendlyPhone = cleaned.length === 10 
                            ? `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
                            : currentSlots.phone;
                        parts.push(`phone: ${friendlyPhone}`);
                    }
                    if (currentSlots.address) parts.push(`address: ${currentSlots.address}`);
                    if (currentSlots.time) parts.push(`time: ${currentSlots.time}`);
                    
                    if (parts.length > 0) {
                        readBackReply = `Sure! I have: ${parts.join(', ')}. Is there anything else I can help with?`;
                    } else {
                        readBackReply = "I don't seem to have the booking details saved. Is there anything else I can help with?";
                    }
                } else if (asksAboutAddress && currentSlots.address) {
                    readBackReply = `The address I have on file is ${currentSlots.address}. Is there anything else?`;
                } else if (asksAboutName && currentSlots.name) {
                    readBackReply = `The name I have is ${currentSlots.name}. Is there anything else?`;
                } else if (asksAboutPhone && currentSlots.phone) {
                    const digits = String(currentSlots.phone).replace(/\D/g, '');
                    const cleaned = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
                    const friendlyPhone = cleaned.length === 10 
                        ? `${cleaned.slice(0, 3)}-${cleaned.slice(3, 6)}-${cleaned.slice(6)}`
                        : currentSlots.phone;
                    readBackReply = `The phone number I have is ${friendlyPhone}. Is there anything else?`;
                } else if (asksAboutTime && currentSlots.time) {
                    readBackReply = `The appointment time is ${currentSlots.time}. Is there anything else?`;
                } else {
                    // They asked about something we don't have
                    readBackReply = "I don't have that information on file. Is there anything else I can help with?";
                }
                
                aiResult = {
                    reply: readBackReply,
                    conversationMode: 'complete',
                    intent: 'read_back',
                    nextGoal: 'END_CALL',
                    filledSlots: currentSlots,
                    signals: { bookingComplete: true },
                    latencyMs: Date.now() - aiStartTime,
                    tokensUsed: 0,
                    fromStateMachine: true,
                    mode: 'COMPLETE',
                    debug: {
                        source: 'READ_BACK_HANDLER',
                        stage: 'complete',
                        requested: { asksAboutAddress, asksAboutName, asksAboutPhone, asksAboutTime, asksAboutBooking }
                    }
                };
                log('📋 V85: READ BACK RESPONSE', { reply: readBackReply });
            } else if (wantsNewBooking) {
                // Reset for new booking
                log('🔄 COMPLETE MODE: User wants NEW booking, resetting');
                session.mode = 'DISCOVERY';
                session.booking = { consentGiven: false };
                // Fall through to discovery mode
            } else {
                // Answer post-completion questions using LLM + scenarios
                // But NEVER re-ask booking slots
                const llmResult = await HybridReceptionistLLM.processConversation({
                    company,
                    callContext: {
                        callId: session._id.toString(),
                        companyId,
                        customerContext,
                        runningSummary: summaryFormatted,
                        turnCount: (session.metrics?.totalTurns || 0) + 1,
                        channel,
                        enterpriseContext: {
                            mode: 'POST_BOOKING_QA',
                            bookingComplete: true,
                            collectedSlots: currentSlots
                        }
                    },
                    currentMode: 'complete',
                    knownSlots: currentSlots,
                    conversationHistory,
                    userInput: userText,
                    behaviorConfig: company.aiAgentSettings?.frontDeskBehavior || {}
                });
                
                aiResult = {
                    // V59 NUKE: LLM response should always have reply, but keep minimal fallback
                    reply: llmResult.reply || getMissingConfigPrompt('fallback_generic', 'response'),
                    conversationMode: 'complete',
                    intent: 'post_booking_qa',
                    nextGoal: 'END_CALL',
                    filledSlots: currentSlots,
                    signals: { bookingComplete: true },
                    latencyMs: Date.now() - aiStartTime,
                    tokensUsed: llmResult.tokensUsed || 0,
                    fromStateMachine: false,
                    mode: 'COMPLETE',
                    debug: {
                        source: 'POST_BOOKING_QA',
                        stage: 'complete'
                    }
                };
            }
        }
        // ═══════════════════════════════════════════════════════════════════════
        // MODE-BASED ROUTING (THE CORE OF OPTION 1)
        // ═══════════════════════════════════════════════════════════════════════
        else if (session.mode === 'BOOKING' && canEnterBooking) BOOKING_MODE: {
            // ═══════════════════════════════════════════════════════════════════════════
            // V97d: ALWAYS DEFER TO BOOKING FLOW RUNNER
            // ═══════════════════════════════════════════════════════════════════════════
            // SIMPLIFICATION: When mode is BOOKING, BookingFlowRunner is the ONLY owner.
            // ConversationEngine does NOT generate booking questions - period.
            // 
            // This eliminates thousands of lines of competing booking logic that was
            // causing agent confusion and inconsistent responses.
            // 
            // BookingFlowRunner reads prompts from UI config → single source of truth.
            // ═══════════════════════════════════════════════════════════════════════════
            
            // Ensure booking is locked so BookingFlowRunner takes over
            session.bookingModeLocked = true;
            session.bookingFlowState = session.bookingFlowState || {
                bookingModeLocked: true,
                bookingFlowId: 'conversation_engine_deferred',
                currentStepId: session.currentBookingStep || 'name',
                bookingCollected: currentSlots,
                bookingState: 'ACTIVE'
            };
            session.bookingFlowState.bookingModeLocked = true;
            
            log('🔒 V97d: BOOKING MODE → ALWAYS DEFER to BookingFlowRunner', {
                sessionMode: session.mode,
                currentSlots: Object.keys(currentSlots).filter(k => currentSlots[k]),
                reason: 'SINGLE_OWNER_SIMPLIFICATION'
            });
            
            aiResult = {
                text: null,
                reply: null,
                mode: 'BOOKING',
                action: 'defer_to_booking_runner',
                bookingFlowState: session.bookingFlowState,
                fromStateMachine: false,
                signals: {
                    deferToBookingRunner: true,
                    bookingModeLocked: true
                },
                debug: {
                    source: 'V97d_ALWAYS_DEFER',
                    reason: 'ConversationEngine simplified - BookingFlowRunner is single owner'
                }
            };
            break BOOKING_MODE;
            // V97f: 4,870 lines of dead booking code NUKED here
            // BookingFlowRunner is now the SINGLE OWNER of booking responses
        }
        else {
            // ═══════════════════════════════════════════════════════════════════
            // V84.3: SCENARIO-FIRST DISCOVERY MODE
            // ═══════════════════════════════════════════════════════════════════
            // 
            // THE GOLDEN RULE: "Use scenario responses directly when confident."
            // 
            // PRIORITY ORDER:
            // 1. Tier 1: Scenario match ≥ threshold → respond directly (0 tokens, ~50ms)
            // 2. Cheat Sheets: Knowledge fallback (0 tokens, ~100ms)
            // 3. LLM: Last resort when no scenario matches (~$0.04, ~1200ms)
            // 
            // FLOW:
            // 1. Retrieve and score relevant scenarios via HybridScenarioSelector
            // 2. If high-confidence match: use scenario's quickReply/fullReply directly
            // 3. If no match: fall through to LLM as last resort
            // 4. Booking is still consent-gated (bookingRequiresConsent stays true)
            // 
            // Scenarios are the PRIMARY BRAIN. LLM is the safety net.
            // ═══════════════════════════════════════════════════════════════════
            
            log('CHECKPOINT 9b: 🎯 V84.3 SCENARIO-FIRST DISCOVERY MODE', {
                forceLLMDiscovery: killSwitches.forceLLMDiscovery,
                disableScenarioAutoResponses: killSwitches.disableScenarioAutoResponses
            });
            
            // Step 1: Retrieve relevant scenarios as knowledge tools
            const templateRefs = company.aiAgentSettings?.templateReferences || [];
            const activeTemplate = templateRefs.find(ref => ref.enabled !== false);
            
            scenarioRetrieval = await LLMDiscoveryEngine.retrieveRelevantScenarios({
                companyId,
                trade: company.trade || 'HVAC',
                utterance: userText,
                template: activeTemplate,
                // V119: Pass callSid for SCENARIO_POOL_LOADED trace event
                callSid: callSid || session?._id?.toString() || null
            });
            
            log('CHECKPOINT 9c: 📚 Scenarios retrieved as tools', {
                count: scenarioRetrieval.scenarios?.length || 0,
                retrievalTimeMs: scenarioRetrieval.retrievalTimeMs,
                topScenario: scenarioRetrieval.scenarios?.[0]?.title,
                effectiveConfigVersion: scenarioRetrieval.effectiveConfigVersion || null,
                selectedScenarios: Array.isArray(scenarioRetrieval.scenarios)
                    ? scenarioRetrieval.scenarios.slice(0, 3).map(s => ({
                        scenarioId: s.scenarioId || null,
                        templateId: s.templateId || null,
                        title: s.title || null,
                        confidence: s.confidence ?? null
                    }))
                    : []
            });
            
            // ═══════════════════════════════════════════════════════════════════
            // 🎯 TURN TRACE ID - Correlation key for matching + execution events
            // ═══════════════════════════════════════════════════════════════════
            const turnNumber = session.metrics?.totalTurns || 0;
            const turnTraceId = `${session._id?.toString()}-t${turnNumber}-${Date.now()}`;
            
            // ═══════════════════════════════════════════════════════════════════
            // 🎯 BLACK BOX: MATCHING_PIPELINE - Prove fast lookup is working
            // ═══════════════════════════════════════════════════════════════════
            // This is the critical trace that proves:
            // 1. Fast lookup is available and used
            // 2. Candidate reduction is happening
            // 3. Scenario capabilities are tracked (what the scenario CAN use)
            // 4. Latency breakdown is recorded
            //
            // NOTE: scenarioCapabilities = what the matched scenario is CAPABLE of using
            // (based on scenario's needs flags). For actual execution proof in
            // ResponseEngine paths, see executionTrace returned from buildResponse().
            // ═══════════════════════════════════════════════════════════════════
            if (scenarioRetrieval.matchingTrace) {
                const trace = scenarioRetrieval.matchingTrace;
                await BlackBoxLogger.logEvent({
                    callId: session._id?.toString(),
                    companyId,
                    type: 'MATCHING_PIPELINE',
                    turn: turnNumber,
                    turnTraceId,  // 🔗 Correlation ID
                    data: {
                        // Fast lookup proof
                        fastLookupAvailable: trace.fastLookupAvailable,
                        fastLookupMethod: trace.fastLookupMethod,
                        usedFastCandidates: trace.usedFastCandidates,
                        
                        // Match details
                        matchMethod: trace.matchMethod,
                        scenarioIdMatched: trace.scenarioIdMatched,
                        scenarioNameMatched: trace.scenarioNameMatched,
                        matchConfidence: trace.matchConfidence,
                        
                        // Performance proof
                        candidateCount: trace.candidateCount,
                        totalPoolSize: trace.totalPoolSize,
                        candidateReduction: trace.candidateReduction,
                        
                        // Scenario capabilities (what the matched scenario CAN use)
                        // NOTE: This is capability, not execution proof
                        scenarioCapabilities: trace.appliedSettings,
                        scenarioCapabilitiesCount: trace.appliedSettings?.length || 0,
                        
                        // Latency breakdown
                        timingMs: trace.timingMs,
                        matchTimeMs: trace.timingMs?.total || 0
                    }
                }).catch(err => {
                    logger.warn('[CONVERSATION ENGINE] Failed to log MATCHING_PIPELINE event', { error: err.message });
                });
            }

            // ═══════════════════════════════════════════════════════════════════
            // 🆕 DETERMINISTIC ISSUE CAPTURE (from scenario tools)
            // ═══════════════════════════════════════════════════════════════════
            // V92 FIX: Only capture issue from scenario tools when confidence is HIGH enough.
            // Otherwise wrong scenario titles (e.g., "New AC/Heating System Quote") get stored
            // as the issue even when caller said something different ("AC issues").
            // 
            // WIRED: discovery.issueCaptureMinConfidence (default 0.5)
            // ═══════════════════════════════════════════════════════════════════
            try {
                const topTool = Array.isArray(scenarioRetrieval.scenarios) ? scenarioRetrieval.scenarios[0] : null;
                const hasTool = !!(topTool?.title && topTool?.scenarioId);
                const scenarioType = String(topTool?.scenarioType || '').toUpperCase();
                const toolLooksLikeProblem = hasTool && !['SMALL_TALK', 'SYSTEM'].includes(scenarioType);
                
                // V92: Get confidence threshold from wiring (default 0.5 = 50%)
                const issueCaptureMinConfidence = company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.issueCaptureMinConfidence ?? 0.5;
                const toolConfidence = Number.isFinite(topTool?.confidence) ? topTool.confidence : 0;
                const meetsConfidenceThreshold = toolConfidence >= (issueCaptureMinConfidence * 100); // confidence is 0-100 scale
                
                if (toolLooksLikeProblem && !session.discovery?.issue && meetsConfidenceThreshold) {
                    session.discovery = session.discovery || {};
                    session.discovery.issue = String(topTool.title).trim();
                    session.discovery.issueConfidence = Math.max(0, Math.min(1, toolConfidence / 100));
                    session.discovery.issueCapturedAtTurn = (session.metrics?.totalTurns || 0) + 1;
                    
                    session.locks.issueCaptured = true;
                    
                    session.memory.facts = session.memory.facts || {};
                    session.memory.facts.issue = session.discovery.issue;
                    
                    log('🧷 DETERMINISTIC ISSUE CAPTURED (scenario tool)', {
                        issue: session.discovery.issue,
                        scenarioId: topTool.scenarioId,
                        confidence: toolConfidence,
                        threshold: issueCaptureMinConfidence * 100
                    });
                } else if (toolLooksLikeProblem && !session.discovery?.issue && !meetsConfidenceThreshold) {
                    log('⚠️ V92: Skipped issue capture - confidence too low', {
                        scenarioTitle: topTool?.title,
                        confidence: toolConfidence,
                        threshold: issueCaptureMinConfidence * 100,
                        reason: 'Will use caller words instead when available'
                    });
                }
            } catch (e) {
                log('⚠️ Deterministic issue capture failed (non-fatal)', { error: e.message });
            }
            
            // ═══════════════════════════════════════════════════════════════════
            // V115: TRIAGE ENGINE ROUTER — Single triage entrypoint
            // ═══════════════════════════════════════════════════════════════════
            // Gate: frontDesk.triage.enabled (NOT returnLane.enabled)
            // Output: { intentGuess, confidence, callReasonDetail, matchedCardId, signals }
            // Triage does NOT speak to the caller — it produces signals only.
            // ═══════════════════════════════════════════════════════════════════
            try {
                triageResult = await TriageEngineRouter.runTriage(userText, {
                    company,
                    companyId,
                    callSid: session._id?.toString() || 'unknown',
                    turnNumber: session.metrics?.totalTurns || 0,
                    session
                });

                // Store triage result in session discovery for downstream use
                if (triageResult?._triageRan && triageResult.callReasonDetail) {
                    session.discovery = session.discovery || {};
                    if (!session.discovery.issue) {
                        session.discovery.issue = triageResult.callReasonDetail;
                        session.discovery.issueCapturedAtTurn = (session.metrics?.totalTurns || 0) + 1;
                        session.discovery.issueConfidence = triageResult.confidence;
                        session.markModified('discovery');
                        log('📋 V115: Triage captured issue into discovery', {
                            issue: triageResult.callReasonDetail,
                            intentGuess: triageResult.intentGuess,
                            confidence: triageResult.confidence
                        });
                    }
                    if (!session.discovery.callType || session.discovery.callType === 'unknown') {
                        const intentToCallType = {
                            service_request: 'service_issue',
                            pricing: 'question',
                            status: 'followup',
                            complaint: 'complaint'
                        };
                        session.discovery.callType = intentToCallType[triageResult.intentGuess] || 'unknown';
                        session.markModified('discovery');
                    }

                    // V115: Write triage result into slot system (call_reason_detail)
                    // This makes it a visible fact in the discovery flow, not a hidden classifier.
                    if (session.slots && !session.slots.call_reason_detail?.value) {
                        session.slots.call_reason_detail = {
                            value: triageResult.callReasonDetail,
                            confidence: triageResult.confidence,
                            source: 'triage_v110',
                            capturedAt: new Date().toISOString(),
                            needsConfirmation: false,
                            immutable: false
                        };
                        session.markModified('slots');
                        log('📋 V115: Wrote call_reason_detail to slot system', {
                            value: triageResult.callReasonDetail,
                            confidence: triageResult.confidence
                        });
                    }
                }

                // Bridge to ReturnLane (backward compat): if triage matched a card, load it
                if (triageResult?.matchedCardId) {
                    try {
                        matchedTriageCard = await TriageService.getTriageCardById(triageResult.matchedCardId);
                        triageCardMatch = {
                            matched: true,
                            triageCardId: triageResult.matchedCardId,
                            triageLabel: matchedTriageCard?.triageLabel || null,
                            action: matchedTriageCard?.quickRuleConfig?.action || null
                        };
                    } catch (cardErr) {
                        log('⚠️ V115: Card lookup failed (non-fatal)', { error: cardErr.message });
                    }
                }
            } catch (triageErr) {
                log('⚠️ V115: TriageEngineRouter error (non-fatal)', { error: triageErr.message });
            }
            
            // ReturnLane still checks its own gate (separate subsystem)
            companyReturnLaneEnabled = company?.aiAgentSettings?.returnLane?.enabled === true;
            
            // ═══════════════════════════════════════════════════════════════════
            // 🎯 V84.3: TIER-1 SCENARIO SHORT-CIRCUIT (ZERO TOKENS!)
            // ═══════════════════════════════════════════════════════════════════
            // Scenario-First Architecture: When HybridScenarioSelector finds a
            // HIGH-CONFIDENCE match, use the scenario response directly.
            // No LLM call = 0 tokens, ~50ms response.
            //
            // Threshold priority:
            //   1. Global Settings UI → AdminSettings.globalProductionIntelligence.thresholds.tier1
            //   2. Company override → aiAgentSettings.productionIntelligence.thresholds.tier1
            //   3. Legacy path → aiAgentSettings.thresholds.tier1DirectMatch
            //   4. Hardcoded default → 0.65
            // ═══════════════════════════════════════════════════════════════════
            const useGlobalIntelligence = company.aiAgentSettings?.useGlobalIntelligence !== false;
            let tier1Threshold;
            if (useGlobalIntelligence) {
                // Read from cached global intelligence (AWConfigReader already caches AdminSettings)
                try {
                    const AdminSettings = require('../models/AdminSettings');
                    const adminSettings = await AdminSettings.findOne().select('globalProductionIntelligence.thresholds.tier1').lean();
                    tier1Threshold = adminSettings?.globalProductionIntelligence?.thresholds?.tier1;
                } catch (e) { /* fallback below */ }
            }
            if (!tier1Threshold) {
                tier1Threshold = company.aiAgentSettings?.productionIntelligence?.thresholds?.tier1
                    ?? company.aiAgentSettings?.thresholds?.tier1DirectMatch
                    ?? 0.65;
            }
            const tier1Match = scenarioRetrieval.topMatch;
            const tier1Confidence = scenarioRetrieval.topMatchConfidence ?? 0;
            // V110: Scenarios are the PRIMARY brain — always allowed to respond.
            //   They acknowledge the problem and funnel toward scheduling.
            //   Booking-time prompts (morning/afternoon) are stripped downstream.
            // Non-V110: Legacy kill switch behavior preserved.
            const allowTier1AutoResponse = killSwitches.v110OwnerPriority
                ? true  // V110: scenarios are PRIMARY brain (acknowledge + funnel)
                : (killSwitches.disableScenarioAutoResponses !== true && killSwitches.forceLLMDiscovery !== true);
            
            log('CHECKPOINT 9c.0: 🎯 Tier-1 Short-Circuit Check', {
                tier1Threshold,
                tier1Confidence,
                hasMatch: !!tier1Match,
                matchName: tier1Match?.name || null,
                allowAutoResponse: allowTier1AutoResponse,
                v110OwnerPriority: killSwitches.v110OwnerPriority || false,
                triggersMatched: tier1Match?.triggers?.slice(0, 5) || []
            });
            
            if (tier1Match && tier1Confidence >= tier1Threshold && allowTier1AutoResponse) {
                // Use scenario response directly - NO LLM!
                const quickReplies = tier1Match.quickReplies || [];
                const fullReplies = tier1Match.fullReplies || [];
                
                // ═══════════════════════════════════════════════════════════════
                // V82 FIX: Smart reply selection based on caller input complexity
                // ═══════════════════════════════════════════════════════════════
                // PROBLEM: quickReplies are too short for detailed caller descriptions
                // Example: Caller describes AC issue for 30 seconds, agent says only
                //          "Let me help you identify the issue." - this is BAD!
                //
                // SOLUTION: Use fullReplies for complex/detailed inputs:
                // - More than 30 words = caller gave detailed description
                // - Contains issue keywords (not cooling, broken, problem, etc.)
                // - Uses quickReplies only for very simple inputs (<15 words)
                // ═══════════════════════════════════════════════════════════════
                const wordCount = (userText || '').split(/\s+/).filter(w => w.length > 0).length;
                const hasDetailedIssue = /not (cool|heat|work)|broken|problem|issue|temperature|thermostat|leak|noise|smell/i.test(userText);
                const useFullReply = fullReplies.length > 0 && (wordCount > 30 || (wordCount > 15 && hasDetailedIssue));
                
                // ═══════════════════════════════════════════════════════════════
                // V114 FIX: Filter inappropriate responses for problem descriptions
                // ═══════════════════════════════════════════════════════════════
                // PROBLEM: "Sounds good" is appropriate for confirmations, NOT for
                // when a caller describes a problem. Saying "Sounds good" when
                // someone says "My AC is broken" is tone-deaf and insulting.
                //
                // SOLUTION: When caller describes a problem (hasDetailedIssue),
                // filter out replies starting with positive affirmation phrases
                // that imply the problem is "good".
                // ═══════════════════════════════════════════════════════════════
                const inappropriateForProblems = /^(sounds? good|great!?|perfect!?|wonderful!?|awesome!?)/i;
                
                const filterInappropriate = (replies, isForProblem) => {
                    if (!isForProblem || !replies || replies.length <= 1) return replies;
                    const filtered = replies.filter(r => {
                        const text = typeof r === 'string' ? r : r?.text;
                        return !inappropriateForProblems.test((text || '').trim());
                    });
                    // If ALL replies are inappropriate, return original (better than nothing)
                    return filtered.length > 0 ? filtered : replies;
                };
                
                const filteredQuickReplies = filterInappropriate(quickReplies, hasDetailedIssue);
                const filteredFullReplies = filterInappropriate(fullReplies, hasDetailedIssue);
                
                let selectedReply = null;
                
                if (useFullReply) {
                    // Caller provided detailed description - use thorough fullReply
                    const idx = Math.floor(Math.random() * filteredFullReplies.length);
                    selectedReply = typeof filteredFullReplies[idx] === 'string' 
                        ? filteredFullReplies[idx] 
                        : filteredFullReplies[idx]?.text;
                    log('📋 V82: Using FULL reply for detailed input', { wordCount, hasDetailedIssue, filteredOut: fullReplies.length - filteredFullReplies.length });
                } else if (filteredQuickReplies.length > 0) {
                    // Simple/short input - use quickReply
                    const idx = Math.floor(Math.random() * filteredQuickReplies.length);
                    selectedReply = typeof filteredQuickReplies[idx] === 'string' 
                        ? filteredQuickReplies[idx] 
                        : filteredQuickReplies[idx]?.text;
                    log('⚡ V82: Using QUICK reply for simple input', { wordCount, hasDetailedIssue, filteredOut: quickReplies.length - filteredQuickReplies.length });
                } else if (filteredFullReplies.length > 0) {
                    // No quickReplies available, use fullReply as fallback
                    const idx = Math.floor(Math.random() * filteredFullReplies.length);
                    selectedReply = typeof filteredFullReplies[idx] === 'string' 
                        ? filteredFullReplies[idx] 
                        : filteredFullReplies[idx]?.text;
                }
                
                if (selectedReply && selectedReply.trim()) {
                    aiLatencyMs = Date.now() - aiStartTime;
                    
                    // ═══════════════════════════════════════════════════════════════
                    // V115: ACKNOWLEDGE SYMPTOMS BEFORE SCHEDULING
                    // ═══════════════════════════════════════════════════════════════
                    // RULE: If triage captured callReasonDetail, the response MUST
                    // acknowledge the problem before jumping to scheduling questions.
                    // This is router-level, not scenario-level.
                    // ═══════════════════════════════════════════════════════════════
                    if (triageResult?._triageRan && triageResult.callReasonDetail && hasDetailedIssue) {
                        const symptoms = triageResult.callReasonDetail;
                        const alreadyAcknowledges = /sorry|understand|hear that|that sounds|sounds like|dealing with/i.test(selectedReply);
                        
                        if (!alreadyAcknowledges) {
                            // Prepend empathetic acknowledgment of the specific symptoms
                            const urgency = triageResult.signals?.urgency || 'normal';
                            let ack;
                            if (urgency === 'emergency') {
                                ack = `I understand this is urgent — ${symptoms}.`;
                            } else if (urgency === 'urgent') {
                                ack = `I'm sorry to hear about that — ${symptoms}. Let's get this taken care of.`;
                            } else {
                                ack = `I understand — ${symptoms}.`;
                            }
                            selectedReply = ack + ' ' + selectedReply;
                            log('📋 V115: Prepended symptom acknowledgment to Tier-1 response', {
                                symptoms, urgency, originalReplyStart: selectedReply.substring(0, 60)
                            });
                        }
                    }
                    
                    // ═══════════════════════════════════════════════════════════════
                    // V92: USE EXISTING PLACEHOLDER SYSTEM - NO HARDCODING!
                    // ═══════════════════════════════════════════════════════════════
                    // Scenarios already support {callerName} placeholder.
                    // Use the centralized replacePlaceholders utility with runtime vars.
                    //
                    // This is MULTI-TENANT SAFE because:
                    // - Scenarios are per-company (with {callerName} in their text)
                    // - Placeholders come from company config
                    // - Runtime vars (callerName) passed as additionalVars
                    // ═══════════════════════════════════════════════════════════════
                    
                    // ═══════════════════════════════════════════════════════════════
                    // V110 OWNER PRIORITY: Scenario output constraints in Discovery
                    // ═══════════════════════════════════════════════════════════════
                    // When V110 Discovery Flow is active and we're in Discovery lane,
                    // scenarios are ENRICHMENT: they can acknowledge the issue, provide
                    // context, but must NOT inject consent questions or scheduling
                    // prompts. Discovery owns the mic — only discovery prompts speak.
                    //
                    // Non-V110: Legacy consent injection behavior preserved.
                    // ═══════════════════════════════════════════════════════════════
                    const discoveryBehavior = company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
                    const schedulingPatterns = /\b(we'?ll\s+(send|get|have|schedule)|send\s+a?\s*tech|get\s+a?\s*tech|schedule\s+a?\s*(tech|appointment|visit)|let\s+me\s+get)/i;
                    const impliesScheduling = schedulingPatterns.test(selectedReply);
                    
                    let finalReply = selectedReply;
                    let addedConsentQuestion = false;
                    
                    // ═══════════════════════════════════════════════════════════════
                    // V116 FIX: Hoist consent variables so they're available in BOTH paths
                    // ═══════════════════════════════════════════════════════════════
                    // BUG (Feb 2026): consentAlreadyGiven and autoInjectConsent were only
                    // defined inside the else block (non-V110), but referenced after the
                    // if/else at lines 6314, 6412, 6419, 6448. This caused:
                    //   - ReferenceError: consentAlreadyGiven is not defined
                    //   - SYSTEM_ERROR_FALLBACK with tokensUsed=0
                    //
                    // FIX: Define these before the if/else so they're always in scope.
                    // ═══════════════════════════════════════════════════════════════
                    const consentAlreadyGiven = session.booking?.consentGiven === true;
                    const autoInjectConsent = discoveryBehavior.autoInjectConsentInScenarios !== false;
                    
                    if (killSwitches.v110OwnerPriority && session.mode !== 'BOOKING') {
                        // ─────────────────────────────────────────────────────
                        // V110: Scenarios speak freely — acknowledge + funnel
                        // ─────────────────────────────────────────────────────
                        // Scenario Response Contract:
                        //   A. Reassure / answer the problem
                        //   B. Optional safety clarifier
                        //   C. Funnel: "Would you like me to schedule a service call?"
                        //
                        // Scheduling language stays IN the response — that's the funnel.
                        // Consent detection will catch the caller's "yes" on next turn.
                        //
                        // Hard rule: In Discovery, scenario responses must NOT ask
                        // about morning/afternoon, time windows, appointment dates,
                        // or pricing deep dives. Those belong in Booking only.
                        // ─────────────────────────────────────────────────────
                        const bookingTimePatterns = /\b(morning|afternoon|evening|what time|which day|what day|available.*slot|time.*work|prefer.*time)/i;
                        if (bookingTimePatterns.test(selectedReply)) {
                            // Strip booking-time prompts (these belong in Booking flow, not Discovery)
                            finalReply = selectedReply.replace(
                                /\.\s*[^.]*\b(morning|afternoon|evening|what time|which day|what day|available.*slot|time.*work|prefer.*time)[^.]*\.?$/i,
                                '.'
                            ).trim();
                            log('📋 V110: Stripped booking-time prompt from scenario (belongs in Booking only)', {
                                stripped: selectedReply.substring(Math.max(0, selectedReply.length - 80))
                            });
                        }
                        // Scheduling offers STAY — that's the funnel question
                    } else {
                        // ─────────────────────────────────────────────────────
                        // Non-V110 (legacy): Consent injection as before
                        // ─────────────────────────────────────────────────────
                        // V116: autoInjectConsent and consentAlreadyGiven now hoisted above
                        const consentQuestionTemplate = discoveryBehavior.consentQuestionTemplate || 
                            "Would you like me to schedule an appointment for you?";
                        
                        if (autoInjectConsent && impliesScheduling && !consentAlreadyGiven) {
                            log('🔄 V92: Scenario implies scheduling but no consent - modifying response', {
                                companyId: company._id,
                                autoInjectConsent,
                                consentQuestionTemplate: consentQuestionTemplate.substring(0, 50)
                            });
                            
                            finalReply = selectedReply.replace(
                                /\.\s*(we'?ll\s+(send|get|have|schedule)|I'?ll\s+(send|get|have|schedule)|let\s+me\s+get)[^.]*\.?$/i,
                                '. ' + consentQuestionTemplate
                            );
                            
                            if (finalReply === selectedReply) {
                                if (!finalReply.trim().endsWith('?')) {
                                    finalReply = finalReply.trim() + ' ' + consentQuestionTemplate;
                                }
                            }
                            
                            addedConsentQuestion = true;
                            
                            session.conversationMemory = session.conversationMemory || {};
                            session.conversationMemory.askedConsentQuestion = true;
                            session.markModified('conversationMemory');
                        }
                    }
                    
                    // ═══════════════════════════════════════════════════════════════
                    // V116 FIX: Set consentPending when scenario implies scheduling
                    // ═══════════════════════════════════════════════════════════════
                    // CRITICAL BUG FIX: The scenario path detected scheduling language
                    // (impliesScheduling=true) and set conversationMemory flags, but
                    // NEVER set session.booking.consentPending. This meant:
                    //   Turn N:   Scenario offers scheduling → consentPending stays FALSE
                    //   Turn N+1: Scenario fails to match → falls to LLM_FALLBACK
                    //             LLM has no signal that booking was offered → asks AGAIN
                    //   Turn N+2: Caller frustrated: "I thought we just went through that"
                    //
                    // FIX: Set consentPending when scenario response implies scheduling,
                    // REGARDLESS of whether the consent question text was actually appended.
                    // This signals the booking state machine on the next turn.
                    // ═══════════════════════════════════════════════════════════════
                    if (impliesScheduling && !consentAlreadyGiven) {
                        session.booking = session.booking || {};
                        session.booking.consentPending = true;
                        session.booking.consentPendingTurn = session.metrics?.totalTurns || 0;
                        session.markModified('booking');
                        
                        log('✅ V116: SCENARIO implies scheduling — consentPending=true', {
                            scenarioId: tier1Match.scenarioId,
                            scenarioName: tier1Match.name,
                            impliesScheduling,
                            addedConsentQuestion,
                            consentPendingTurn: session.booking.consentPendingTurn
                        });
                    }
                    
                    // ═══════════════════════════════════════════════════════════════
                    // V92: REPLACE PLACEHOLDERS USING EXISTING SYSTEM
                    // ═══════════════════════════════════════════════════════════════
                    // Scenarios use {callerName} placeholder - fill it with runtime data
                    // Also handles {companyName}, {serviceAreas}, etc. from company config
                    // ═══════════════════════════════════════════════════════════════
                    
                    // ═══════════════════════════════════════════════════════════════
                    // V96n FIX: PRIORITY ORDER FOR CALLER NAME
                    // ═══════════════════════════════════════════════════════════════
                    // BUG (FEB 2026): currentSlots.name had "Air Conditioning" instead 
                    // of "Mark" because internal extraction corrupted the value.
                    // 
                    // FIX: Use preExtractedSlots.name FIRST if available, as it was
                    // validated by v2twilio's SlotExtractor.
                    // ═══════════════════════════════════════════════════════════════
                    const callerName = preExtractedSlots?.name || currentSlots.name;
                    const runtimeVars = {};
                    
                    // ═══════════════════════════════════════════════════════════════
                    // V96n: ENHANCED NAME VALIDATION - Block service/trade words
                    // ═══════════════════════════════════════════════════════════════
                    // Additional check beyond NAME_STOP_WORDS_ENGINE to catch:
                    // - "Air Conditioning" (contains 'air' and 'conditioning')
                    // - "HVAC Service" (contains 'hvac' and 'service')
                    // ═══════════════════════════════════════════════════════════════
                    const SERVICE_WORDS_FOR_NAME_CHECK = new Set([
                        'air', 'conditioning', 'conditioner', 'ac', 'hvac', 'heating', 'cooling',
                        'plumbing', 'electrical', 'service', 'services', 'repair', 'repairs',
                        'maintenance', 'unit', 'system', 'technician', 'tech', 'appointment',
                        'problem', 'problems', 'issue', 'issues', 'trouble'
                    ]);
                    
                    const isValidCallerName = (name) => {
                        if (!name) return false;
                        if (NAME_STOP_WORDS_ENGINE.has(name.toLowerCase())) return false;
                        // Check if ANY word in the name is a service word
                        const nameWords = name.toLowerCase().split(/\s+/);
                        return !nameWords.some(w => SERVICE_WORDS_FOR_NAME_CHECK.has(w));
                    };
                    
                    // Only set callerName if we have a valid name
                    if (isValidCallerName(callerName)) {
                        runtimeVars.callerName = callerName;
                        runtimeVars.callerFirstName = callerName; // Alias for compatibility
                        runtimeVars.name = callerName; // Another common alias
                    } else if (callerName) {
                        log('🚨 V96n: BLOCKED invalid name from placeholder:', {
                            blockedName: callerName,
                            reason: 'contains_service_word_or_stop_word'
                        });
                    }
                    
                    // Apply placeholder replacement (handles {callerName}, {companyName}, etc.)
                    const { replacePlaceholders } = require('../utils/placeholderReplacer');
                    const beforePlaceholders = finalReply;
                    finalReply = replacePlaceholders(finalReply, company, runtimeVars);
                    
                    // If {callerName} wasn't replaced (no name available), clean up gracefully
                    // Pattern: "Thanks, {callerName}." → "Thanks."
                    // Pattern: "{callerName}, we can help" → "We can help"
                    finalReply = finalReply
                        .replace(/,?\s*\{callerName\}[,.]?\s*/gi, ' ')
                        .replace(/\{callerFirstName\}/gi, '')
                        .replace(/\{name\}/gi, '')
                        .replace(/\s{2,}/g, ' ')
                        .trim();
                    
                    const placeholdersReplaced = beforePlaceholders !== finalReply;
                    if (placeholdersReplaced) {
                        log('🔄 V92: Placeholders replaced in scenario response', {
                            hadCallerName: !!runtimeVars.callerName,
                            callerName: runtimeVars.callerName || null
                        });
                    }
                    
                    log('🎯 TIER-1 SCENARIO MATCHED! (0 tokens, deterministic)', {
                        scenarioId: tier1Match.scenarioId,
                        scenarioName: tier1Match.name,
                        confidence: tier1Confidence,
                        replyPreview: finalReply.substring(0, 80),
                        latencyMs: aiLatencyMs,
                        addedConsentQuestion,
                        modifiedForConsent: impliesScheduling && !consentAlreadyGiven && autoInjectConsent,
                        placeholdersReplaced,
                        hadCallerName: !!runtimeVars.callerName
                    });
                    
                    // V116: Build signals for scenario response
                    const scenarioSignals = {};
                    if (impliesScheduling && !consentAlreadyGiven) {
                        scenarioSignals.setConsentPending = true;
                        // V98 compat: Also propagate via bookingConsentPending for Redis persistence
                        scenarioSignals.bookingConsentPending = true;
                    }
                    
                    aiResult = {
                        reply: finalReply,
                        conversationMode: 'discovery',
                        intent: 'scenario_matched',
                        nextGoal: addedConsentQuestion ? 'AWAIT_CONSENT' : 'CONTINUE_DISCOVERY',
                        filledSlots: currentSlots,
                        signals: scenarioSignals,
                        latencyMs: aiLatencyMs,
                        tokensUsed: 0,  // 🎯 ZERO TOKENS! This is the whole point.
                        fromStateMachine: true,  // For backwards compat (tier1 = deterministic)
                        mode: 'DISCOVERY',
                        tier: 'tier1',
                        matchSource: 'SCENARIO_MATCHED',
                        debug: {
                            source: 'TIER1_SCENARIO_MATCH',
                            scenarioId: tier1Match.scenarioId,
                            scenarioName: tier1Match.name,
                            categoryName: tier1Match.categoryName,
                            confidence: tier1Confidence,
                            threshold: tier1Threshold,
                            scenarioType: tier1Match.scenarioType,
                            triggersUsed: tier1Match.triggers?.slice(0, 3) || [],
                            addedConsentQuestion,
                            autoInjectConsent,
                            placeholdersReplaced,
                            callerName: runtimeVars.callerName || null,
                            originalReply: (impliesScheduling && autoInjectConsent) ? selectedReply.substring(0, 50) : null
                        }
                    };
                } else {
                    log('⚠️ TIER-1 match found but no reply available, falling through to LLM', {
                        scenarioId: tier1Match.scenarioId,
                        quickRepliesCount: quickReplies.length,
                        fullRepliesCount: fullReplies.length
                    });
                }
            }
            
            // Step 1.5: Tier 2 (cheat sheets) REMOVED Feb 2026 — reserved for future rebuild
            // Order of precedence for DISCOVERY knowledge:
            // 1. Scenarios (Tier 1 — primary)
            // 2. [RESERVED] Future Tier 2 knowledge layer
            // 3. LLM (Tier 3 — last resort)
            
            // Step 2: Detect caller emotion (lightweight, no LLM)
            const emotion = LLMDiscoveryEngine.detectEmotion(userText);
            
            log('CHECKPOINT 9d: 😊 Emotion detected', {
                emotion: emotion.emotion,
                confidence: emotion.confidence
            });
            
            // ═══════════════════════════════════════════════════════════════════
            // V31: DISCOVERY TURN LIMIT + AUTO-OFFER
            // ═══════════════════════════════════════════════════════════════════
            // RULE: After caller describes issue, don't keep asking symptoms.
            // Instead: 1 empathy line + offer scheduling immediately.
            // This prevents the robotic "tell me more" loop.
            // ═══════════════════════════════════════════════════════════════════
            const frontDeskBehavior = company.aiAgentSettings?.frontDeskBehavior || {};
            const discoveryConfig = frontDeskBehavior.discovery || {};
            const serviceFlowConfig = frontDeskBehavior.serviceFlow || {};
            const tradeKey = normalizeTradeKey(company.trade || company.tradeType || '');
            const serviceFlowTrades = Array.isArray(serviceFlowConfig.trades)
                ? serviceFlowConfig.trades.map(normalizeTradeKey).filter(Boolean)
                : [];
            const serviceFlowEnabled = serviceFlowConfig.mode !== 'off' &&
                serviceFlowTrades.length > 0 &&
                serviceFlowTrades.includes(tradeKey);
            const serviceFlowPromptKeys = (() => {
                if (!serviceFlowEnabled) return null;
                const byTrade = serviceFlowConfig.promptKeysByTrade || {};
                const tradeConfig = typeof byTrade.get === 'function' ? byTrade.get(tradeKey) : byTrade[tradeKey];
                return tradeConfig || null;
            })();
            const resolveServiceFlowPrompt = (promptField, contextLabel) => {
                if (!serviceFlowPromptKeys || !serviceFlowPromptKeys[promptField]) {
                    return resolveTenantPromptOrFallback({
                        company,
                        promptKey: serviceFlowPromptKeys?.[promptField],
                        contextLabel,
                        session,
                        tradeKey
                    });
                }
                return resolveTenantPromptOrFallback({
                    company,
                    promptKey: serviceFlowPromptKeys[promptField],
                    contextLabel,
                    session,
                    tradeKey
                });
            };
            const isServiceCall = isExistingUnitServiceRequest(userText) && isServiceTrade(tradeKey);
            const maxDiscoveryTurns = discoveryConfig.maxDiscoveryTurns ?? 1;  // Default: 1 turn
            
            // Track discovery turns
            session.discovery = session.discovery || {};
            session.discovery.turnCount = (session.discovery.turnCount || 0) + 1;
            const discoveryTurnCount = session.discovery.turnCount;
            
            // ═══════════════════════════════════════════════════════════════════════
            // V81: ENTITY EXTRACTION - Capture context for smart conversations
            // ═══════════════════════════════════════════════════════════════════════
            // Extract tech name mentioned: "his name was Dustin", "Dustin was here", "guy named Dustin"
            const techNamePatterns = [
                /(?:his|her|the)\s+name\s+(?:was|is)\s+(\w+)/i,
                /(?:guy|tech|technician|person)\s+(?:named?|called)\s+(\w+)/i,
                /(\w+)\s+(?:was|came)\s+(?:here|out)/i,
                /(?:same|same guy|prefer)\s+(\w+)/i
            ];
            for (const pattern of techNamePatterns) {
                const match = userText.match(pattern);
                if (match && match[1] && match[1].length > 2 && !/^(the|was|out|here|guy|came)$/i.test(match[1])) {
                    if (!session.discovery.mentionedTechName) {
                        session.discovery.mentionedTechName = match[1];
                        log('📝 V81: Tech name extracted', { techName: match[1], pattern: pattern.toString() });
                    }
                    break;
                }
            }
            
            // Extract previous visit timeframe: "a week ago", "2 weeks ago", "last week", "recently"
            const visitTimePatterns = [
                /(\d+)\s*(?:days?|weeks?|months?)\s+ago/i,
                /(last|past)\s+(week|month|few days)/i,
                /(yesterday|recently|other day)/i
            ];
            for (const pattern of visitTimePatterns) {
                const match = userText.match(pattern);
                if (match) {
                    if (!session.discovery.previousVisitTime) {
                        session.discovery.previousVisitTime = match[0];
                        log('📝 V81: Previous visit time extracted', { visitTime: match[0] });
                    }
                    break;
                }
            }
            
            // Extract equipment mentioned: "thermostat", "AC unit", "system", "furnace"
            const equipmentMatch = userText.match(/\b(thermostat|ac unit|ac|air conditioner|system|furnace|heat pump|condenser|handler|blower)\b/i);
            if (equipmentMatch && !session.discovery.mentionedEquipment) {
                session.discovery.mentionedEquipment = equipmentMatch[1];
                log('📝 V81: Equipment extracted', { equipment: equipmentMatch[1] });
            }
            
            // Build discovery context summary for LLM
            const discoveryContext = [];
            if (session.discovery.mentionedTechName) {
                discoveryContext.push(`Tech mentioned: ${session.discovery.mentionedTechName}`);
            }
            if (session.discovery.previousVisitTime) {
                discoveryContext.push(`Previous visit: ${session.discovery.previousVisitTime}`);
            }
            if (session.discovery.mentionedEquipment) {
                discoveryContext.push(`Equipment: ${session.discovery.mentionedEquipment}`);
            }
            if (discoveryContext.length > 0) {
                session.discovery.contextSummary = discoveryContext.join(', ');
                log('📝 V81: Discovery context built', { context: session.discovery.contextSummary });
            }
            
            // V88 FIX: CRITICAL - Must mark discovery as modified for Mongoose to persist!
            // Without this, technician names, previous visits, and equipment are LOST!
            session.markModified('discovery');
            // ═══════════════════════════════════════════════════════════════════════
            
            // Detect if caller described an issue (service request)
            const issueKeywords = /not (cooling|heating|working)|broken|leaking|won't (turn on|start)|making noise|stopped|no (air|heat|cold)|issues?|problem/i;
            const callerDescribedIssue = issueKeywords.test(userText);
            
            // If issue detected, capture it
            if (callerDescribedIssue && !session.discovery.issue) {
                // Extract a summary of the issue
                const issueMatch = userText.match(issueKeywords);
                session.discovery.issue = userText.substring(0, 100); // First 100 chars as summary
                session.discovery.issueCapturedAtTurn = discoveryTurnCount;
                session.markModified('discovery'); // V88: Ensure persistence!
                log('📝 V31: Issue captured from caller', { issue: session.discovery.issue });
            }
            
            // Check if we should auto-offer scheduling
            // V81 FIX: Only auto-offer if:
            // 1. We've ALREADY checked scenarios and have no match
            // 2. AND issue has been captured
            // 3. AND we haven't already offered
            // 4. AND caller hasn't asked a question (detected by ending with ?)
            const hasIssue = !!session.discovery.issue;
            const exceededMaxTurns = discoveryTurnCount > maxDiscoveryTurns;
            const userAskedQuestion = userText.trim().endsWith('?');
            // V81: Don't auto-offer if user is asking a question - let scenarios/LLM answer first
            const shouldAutoOffer = hasIssue && !userAskedQuestion && exceededMaxTurns;
            
            log('CHECKPOINT 9d.0: 🔄 V31 Discovery Turn Check', {
                discoveryTurnCount,
                maxDiscoveryTurns,
                hasIssue,
                exceededMaxTurns,
                shouldAutoOffer,
                callerDescribedIssue
            });

            if (!aiResult && isServiceCall && serviceFlowEnabled && serviceFlowPromptKeys) {
                if (session.lastAgentIntent === 'ASK_SERVICE_TRIAGE') {
                    const postTriagePrompt = resolveServiceFlowPrompt('postTriageConsent', 'serviceFlow.postTriageConsent');
                    if (postTriagePrompt) {
                        session.lastAgentIntent = 'ASK_SERVICE_CONSENT';
                        session.memory = session.memory || {};
                        session.memory.lastServiceUrgency = session.memory.lastServiceUrgency || 'urgent';

                        aiLatencyMs = Date.now() - aiStartTime;
                        aiResult = {
                            reply: postTriagePrompt,
                            conversationMode: 'discovery',
                            intent: 'service_post_triage_consent',
                            nextGoal: 'AWAIT_CONSENT',
                            filledSlots: currentSlots,
                            signals: { wantsBooking: false },
                            latencyMs: aiLatencyMs,
                            tokensUsed: 0,
                            fromStateMachine: true,
                            mode: 'DISCOVERY',
                            debug: {
                                source: 'SERVICE_FLOW_POST_TRIAGE',
                                trade: tradeKey
                            }
                        };
                    }
                }
            }
            
            // ═══════════════════════════════════════════════════════════════════
            // V92: DISCOVERY CLARIFICATION - Ask follow-up questions for vague issues
            // ═══════════════════════════════════════════════════════════════════
            // WIRED: discovery.clarifyingQuestions.enabled, discovery.clarifyingQuestions.vaguePatterns
            // Before offering to schedule, check if issue is clear.
            // If caller said "AC problems" or "not working" without specifying
            // cooling/heating, ask a clarifying question first.
            // ═══════════════════════════════════════════════════════════════════
            const clarifyingQuestionsConfig = company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.clarifyingQuestions || {};
            const clarifyingEnabled = clarifyingQuestionsConfig.enabled !== false; // Default true
            const vaguePatterns = clarifyingQuestionsConfig.vaguePatterns || [
                'not working', 'problems', 'issues', 'something wrong', 'acting up', 
                'broken', 'wont turn on', 'keeps shutting off', 'stops working',
                'having trouble', 'giving me problems', 'not right'
            ];
            
            // Check if caller's issue description is vague (needs clarification)
            const discoveryIssue = session.discovery?.issue || '';
            const userTextLower = userText.toLowerCase();
            const issueIsVague = clarifyingEnabled && 
                !session.discovery?.askedClarifyingQuestion && 
                vaguePatterns.some(pattern => userTextLower.includes(pattern.toLowerCase()));
            
            // Check if we already have a clear issue classification
            const hasSpecificIssue = discoveryIssue && (
                /not cooling|no cool|ac not/i.test(discoveryIssue) ||
                /not heating|no heat|furnace not/i.test(discoveryIssue) ||
                /thermostat|blank|display/i.test(discoveryIssue) ||
                /leak|water|refrigerant/i.test(discoveryIssue) ||
                /noise|loud|rattling|grinding/i.test(discoveryIssue)
            );
            
            const needsClarification = issueIsVague && !hasSpecificIssue;
            
            if (!aiResult && needsClarification) {
                // Ask clarifying question instead of offering to schedule
                const callerName = currentSlots.name || currentSlots.partialName;
                const tradeType = (company?.trade || company?.tradeType || 'hvac').toLowerCase();
                
                // Build clarifying question based on trade
                let clarifyingQuestion;
                if (tradeType === 'hvac' || tradeType.includes('air') || tradeType.includes('heat')) {
                    clarifyingQuestion = callerName 
                        ? `${callerName}, is it not cooling, not heating, or something else?`
                        : `Is it not cooling, not heating, or something else?`;
                } else if (tradeType === 'plumbing') {
                    clarifyingQuestion = callerName
                        ? `${callerName}, is it a leak, a clog, or something else?`
                        : `Is it a leak, a clog, or something else?`;
                } else if (tradeType === 'electrical') {
                    clarifyingQuestion = callerName
                        ? `${callerName}, is it no power, flickering lights, or something else?`
                        : `Is it no power, flickering lights, or something else?`;
                } else {
                    clarifyingQuestion = callerName
                        ? `${callerName}, can you tell me a bit more about what's happening?`
                        : `Can you tell me a bit more about what's happening?`;
                }
                
                session.discovery.askedClarifyingQuestion = true;
                session.lastAgentIntent = 'ASK_CLARIFICATION';
                
                log('🔍 V92: DISCOVERY CLARIFICATION - Asking follow-up for vague issue', {
                    userText: userText.substring(0, 50),
                    issueDetected: discoveryIssue,
                    matchedPattern: vaguePatterns.find(p => userTextLower.includes(p.toLowerCase())),
                    clarifyingQuestion: clarifyingQuestion.substring(0, 60)
                });
                
                aiLatencyMs = Date.now() - aiStartTime;
                aiResult = {
                    reply: clarifyingQuestion,
                    conversationMode: 'discovery',
                    intent: 'clarification',
                    nextGoal: 'UNDERSTAND_ISSUE',
                    filledSlots: currentSlots,
                    signals: { 
                        needsClarification: true,
                        vagueIssueDetected: true
                    },
                    latencyMs: aiLatencyMs,
                    tokensUsed: 0,  // No LLM used!
                    fromStateMachine: true,
                    mode: 'DISCOVERY',
                    tier: 'tier1',
                    matchSource: 'CLARIFICATION_QUESTION'
                };
            }
            
            // ═══════════════════════════════════════════════════════════════════
            // V31: AUTO-OFFER SCHEDULING (if issue understood)
            // ═══════════════════════════════════════════════════════════════════
            // Once we understand the issue, don't ask more diagnostic questions.
            // Offer to schedule immediately. Caller can still ask questions.
            // ═══════════════════════════════════════════════════════════════════
            const modeSwitchingCfg = company.aiAgentSettings?.frontDeskBehavior?.modeSwitching || {};
            // V81 FIX: Increase default from 2 to 3 to give scenarios/LLM more chances
            const minTurnsBeforeBooking = Number.isFinite(modeSwitchingCfg.minTurnsBeforeBooking)
                ? modeSwitchingCfg.minTurnsBeforeBooking
                : 3;

            // V81 FIX: Also check that we don't have an aiResult already (scenario might have matched)
            if (!aiResult && shouldAutoOffer && !session.discovery.offeredScheduling && currentTurnNumber >= minTurnsBeforeBooking) {
                let autoOfferResponse = null;
                let autoOfferIntent = 'auto_offer_scheduling';

                if (isServiceCall && serviceFlowEnabled && serviceFlowPromptKeys) {
                    const urgency = classifyServiceUrgency(userText);
                    session.memory = session.memory || {};
                    session.memory.lastServiceUrgency = urgency;

                    if (urgency === 'urgent' && serviceFlowConfig.mode === 'hybrid') {
                        autoOfferResponse = resolveServiceFlowPrompt('urgentTriageQuestion', 'serviceFlow.urgentTriageQuestion');
                        session.lastAgentIntent = 'ASK_SERVICE_TRIAGE';
                        autoOfferIntent = 'service_triage';
                    } else {
                        autoOfferResponse = resolveServiceFlowPrompt('nonUrgentConsent', 'serviceFlow.nonUrgentConsent');
                        session.lastAgentIntent = 'ASK_SERVICE_CONSENT';
                        autoOfferIntent = 'service_consent';
                    }
                } else {
                    // ═══════════════════════════════════════════════════════════════
                    // V92: CONTEXT-AWARE AUTO-OFFER RESPONSE
                    // Instead of generic empathy + offer, acknowledge what caller said
                    // ═══════════════════════════════════════════════════════════════
                    const discovery = session.discovery || {};
                    const callerName = currentSlots.name || currentSlots.partialName;
                    
                    if (discovery.issue || discovery.techMentioned || discovery.temperature) {
                        // Build context-aware acknowledgment
                        const parts = [];
                        
                        if (callerName) {
                            parts.push(`Got it, ${callerName}`);
                        } else {
                            parts.push('Got it');
                        }
                        
                        // Acknowledge issue + temperature
                        if (discovery.issue && discovery.temperature && discovery.temperature >= 80) {
                            parts.push(`${discovery.issue} and it's ${discovery.temperature}° in the house`);
                        } else if (discovery.issue) {
                            parts.push(discovery.issue);
                        }
                        
                        // Acknowledge tech mention and recent visit
                        if (discovery.techMentioned && discovery.recentVisit) {
                            parts.push(`You mentioned ${discovery.techMentioned} was out recently`);
                        } else if (discovery.techMentioned) {
                            parts.push(`I see ${discovery.techMentioned} was there before`);
                        }
                        
                        // Acknowledge tenure
                        if (discovery.tenure === 'longtime_customer') {
                            parts.push(`I appreciate you being a long-time customer`);
                        }
                        
                        // Join and add scheduling offer
                        autoOfferResponse = parts.join(' — ') + '. Would you like me to schedule a technician?';
                        
                        log('🎯 V92: Context-aware auto-offer response built', {
                            hasName: !!callerName,
                            hasIssue: !!discovery.issue,
                            hasTech: !!discovery.techMentioned,
                            hasTemp: !!discovery.temperature
                        });
                    } else {
                        // Fallback to generic empathy + offer
                        const empathyVariants = discoveryConfig.empathyVariants || DEFAULT_PROMPT_VARIANTS.empathy;
                        const empathyLine = getVariant(empathyVariants);
                        
                        const offerVariants = discoveryConfig.offerVariants || DEFAULT_PROMPT_VARIANTS.offerScheduling;
                        const offerLine = getVariant(offerVariants);
                        
                        autoOfferResponse = `${empathyLine} ${offerLine}`;
                        autoOfferResponse = stripServiceEmpathyPreamble(autoOfferResponse, tradeKey, isServiceCall && !serviceFlowConfig.empathyEnabled);
                    }
                    session.lastAgentIntent = 'OFFER_SCHEDULE';
                }
                
                session.discovery.offeredScheduling = true;
                
                log('🎯 V31 AUTO-OFFER: Offering scheduling after issue understood', {
                    responsePreview: autoOfferResponse?.substring(0, 60),
                    discoveryTurnCount,
                    issue: session.discovery.issue?.substring(0, 50),
                    contextAware: !!(session.discovery?.issue || session.discovery?.techMentioned)
                });
                
                aiLatencyMs = Date.now() - aiStartTime;
                
                aiResult = {
                    reply: autoOfferResponse,
                    conversationMode: 'discovery',
                    intent: autoOfferIntent,
                    nextGoal: 'AWAIT_CONSENT',
                    filledSlots: currentSlots,
                    signals: { 
                        wantsBooking: false,  // Not yet - waiting for consent
                        autoOfferTriggered: true,
                        offeredScheduling: true,
                        issueUnderstood: hasIssue
                    },
                    latencyMs: aiLatencyMs,
                    tokensUsed: 0,  // No LLM used!
                    fromStateMachine: true,
                    mode: 'DISCOVERY',
                    debug: {
                        source: 'V31_AUTO_OFFER',
                        stage: 'discovery',
                        discoveryTurnCount,
                        maxDiscoveryTurns,
                        issue: session.discovery.issue,
                        lastAgentIntent: session.lastAgentIntent
                    }
                };
            }
            
            // ═══════════════════════════════════════════════════════════════════
            // 🚀 FAST-PATH BOOKING DETECTION (V24)
            // ═══════════════════════════════════════════════════════════════════
            // When caller clearly wants service NOW ("I need you out here"),
            // skip troubleshooting and offer scheduling immediately.
            // Does NOT switch to BOOKING - just changes what DISCOVERY says.
            // Booking only starts after explicit consent ("yes please").
            // ═══════════════════════════════════════════════════════════════════
            const fastPathConfig = company.aiAgentSettings?.frontDeskBehavior?.fastPathBooking || {};
            const fastPathEnabled = fastPathConfig.enabled !== false;
            
            // ═══════════════════════════════════════════════════════════════════
            // COMPREHENSIVE URGENCY KEYWORDS (loaded from UI, with fallbacks)
            // These detect when caller is DONE troubleshooting and wants service
            // ═══════════════════════════════════════════════════════════════════
            const fastPathKeywords = fastPathConfig.triggerKeywords || [
                // Direct booking requests (with need/want variations)
                "send someone", "send somebody", 
                "get someone out", "get somebody out",
                "need you out", "need someone out", "need somebody out",
                "want someone out", "want somebody out", "want you out",
                "come out", "come out here", "come today", "come out today",
                "schedule", "book", "appointment", "technician",
                // Frustration / done troubleshooting
                "fix it", "just fix it", "just want it fixed", "sick of it", "sick of this",
                "don't want to troubleshoot", "done troubleshooting", "stop asking",
                "don't care what it is", "I don't care", "just send", "just book",
                // Urgency
                "need service", "need help now", "as soon as possible", "asap",
                "emergency", "urgent", "right away", "immediately", "today",
                // Refusal to continue discovery
                "I'm done", "enough questions", "stop with the questions",
                "just get someone", "just get somebody"
            ];
            
            // Check if user text contains any fast-path trigger keywords
            // Use flexible matching: normalize "somebody/someone", "out/over"
            const userTextLowerFP = userText.toLowerCase()
                .replace(/somebody/g, 'someone')  // Normalize somebody → someone
                .replace(/over here/g, 'out here'); // Normalize "over here" → "out here"
            
            const fastPathTriggered = fastPathEnabled && fastPathKeywords.some(keyword => {
                const normalizedKeyword = keyword.toLowerCase()
                    .replace(/somebody/g, 'someone')
                    .replace(/over here/g, 'out here');
                return userTextLowerFP.includes(normalizedKeyword);
            });
            
            // Track discovery question count for max-questions gate
            const discoveryQuestionCount = session.discovery?.questionCount || 0;
            const maxDiscoveryQuestions = fastPathConfig.maxDiscoveryQuestions || 2;
            const exceededMaxQuestions = discoveryQuestionCount >= maxDiscoveryQuestions;
            
            log('CHECKPOINT 9d.1: 🚀 Fast-Path Check', {
                fastPathEnabled,
                fastPathTriggered,
                matchedKeyword: fastPathTriggered ? fastPathKeywords.find(k => userTextLowerFP.includes(k.toLowerCase())) : null,
                discoveryQuestionCount,
                maxDiscoveryQuestions,
                exceededMaxQuestions
            });
            
            // If fast-path triggered, respond with offer script instead of LLM
            // V81 FIX: Only trigger auto-rescue if:
            // 1. Fast-path keyword EXPLICITLY triggered (caller said "schedule", "send someone", etc.)
            // 2. NOT if user asked a question (let scenarios/LLM answer questions first!)
            // 3. NOT if we already have an aiResult from scenarios
            const autoRescueOnFrustration = modeSwitchingCfg.autoRescueOnFrustration !== false;
            const shouldFastPath = fastPathTriggered && !userAskedQuestion;
            const shouldAutoRescue = autoRescueOnFrustration && fastPathEnabled && exceededMaxQuestions && emotion.emotion === 'frustrated' && !userAskedQuestion;
            if (!aiResult && (shouldFastPath || shouldAutoRescue)) {
                let offerScript = fastPathConfig.offerScript || 
                    "Got it — I completely understand. We can get someone out to you. Would you like me to schedule a technician now?";
                const oneQuestionScript = fastPathConfig.oneQuestionScript || "";
                let fastPathIntent = 'fast_path_offer';

                if (isServiceCall && serviceFlowEnabled && serviceFlowPromptKeys) {
                    const urgency = classifyServiceUrgency(userText);
                    session.memory = session.memory || {};
                    session.memory.lastServiceUrgency = urgency;

                    if (urgency === 'urgent' && serviceFlowConfig.mode === 'hybrid' && !session.discovery?.fastPathOneQuestionAsked) {
                        offerScript = resolveServiceFlowPrompt('urgentTriageQuestion', 'serviceFlow.urgentTriageQuestion');
                        session.lastAgentIntent = 'ASK_SERVICE_TRIAGE';
                        fastPathIntent = 'service_triage';
                    } else {
                        offerScript = resolveServiceFlowPrompt('nonUrgentConsent', 'serviceFlow.nonUrgentConsent');
                        session.lastAgentIntent = 'ASK_SERVICE_CONSENT';
                        fastPathIntent = 'service_consent';
                    }
                } else {
                    // ═══════════════════════════════════════════════════════════════
                    // V92: CONTEXT-AWARE FAST-PATH RESPONSE
                    // Instead of generic "Would you like to schedule?", acknowledge
                    // what the caller said (issue, tech, temperature, tenure)
                    // ═══════════════════════════════════════════════════════════════
                    const discovery = session.discovery || {};
                    const callerName = currentSlots.name || currentSlots.partialName;
                    
                    if (discovery.issue || discovery.techMentioned || discovery.temperature) {
                        // Build context-aware acknowledgment
                        const parts = [];
                        
                        if (callerName) {
                            parts.push(`Got it, ${callerName}`);
                        } else {
                            parts.push('Got it');
                        }
                        
                        // Acknowledge issue + temperature
                        if (discovery.issue && discovery.temperature && discovery.temperature >= 80) {
                            parts.push(`${discovery.issue} and it's ${discovery.temperature}° in the house`);
                        } else if (discovery.issue) {
                            parts.push(discovery.issue);
                        }
                        
                        // Acknowledge tech mention and recent visit
                        if (discovery.techMentioned && discovery.recentVisit) {
                            parts.push(`You mentioned ${discovery.techMentioned} was out recently and it still isn't fixed`);
                        } else if (discovery.techMentioned) {
                            parts.push(`I see ${discovery.techMentioned} was there before`);
                        } else if (discovery.recentVisit) {
                            parts.push(`I see someone was out recently`);
                        }
                        
                        // Acknowledge tenure
                        if (discovery.tenure === 'longtime_customer') {
                            parts.push(`I appreciate you being a long-time customer`);
                        }
                        
                        // Join and add scheduling offer
                        offerScript = parts.join(' — ') + '. Let me get you taken care of — would you like me to schedule a technician?';
                        
                        log('🎯 V92: Context-aware fast-path response built', {
                            hasName: !!callerName,
                            hasIssue: !!discovery.issue,
                            hasTech: !!discovery.techMentioned,
                            hasTemp: !!discovery.temperature,
                            responsePreview: offerScript.substring(0, 80)
                        });
                    } else {
                        offerScript = stripServiceEmpathyPreamble(offerScript, tradeKey, isServiceCall && !serviceFlowConfig.empathyEnabled);
                    }
                }
                
                // Determine response: one-question first, or straight to offer
                let fastPathResponse;
                const askedOneQuestion = session.discovery?.fastPathOneQuestionAsked;
                
                if (oneQuestionScript && !askedOneQuestion) {
                    // Ask the optional pre-question first
                    fastPathResponse = oneQuestionScript;
                    session.discovery = session.discovery || {};
                    session.discovery.fastPathOneQuestionAsked = true;
                    log('🚀 FAST-PATH: Asking pre-question before offer');
            } else {
                    // Go straight to offer
                    fastPathResponse = offerScript;
                    session.lastAgentIntent = 'OFFER_SCHEDULE';
                    log('🚀 FAST-PATH: Offering scheduling immediately');
                }
                
                aiLatencyMs = Date.now() - aiStartTime;
                
                aiResult = {
                    reply: fastPathResponse,
                    conversationMode: 'discovery',
                    intent: fastPathIntent,
                    nextGoal: 'AWAIT_CONSENT',
                    filledSlots: currentSlots,
                    signals: { 
                        wantsBooking: false,  // Not yet - waiting for consent
                        fastPathTriggered: true,
                        offeredScheduling: true
                    },
                    latencyMs: aiLatencyMs,
                    tokensUsed: 0,  // No LLM used!
                    fromStateMachine: true,
                    mode: 'DISCOVERY',
                    debug: {
                        source: 'FAST_PATH_BOOKING',
                        stage: 'discovery',
                        fastPathReason: fastPathTriggered ? 'keyword_match' : 'max_questions_exceeded',
                        matchedKeyword: fastPathKeywords.find(k => userTextLowerFP.includes(k.toLowerCase())),
                        lastAgentIntent: session.lastAgentIntent
                    }
                };
                
                // Skip LLM call - we have our response
                log('🚀 FAST-PATH ACTIVATED: Skipping LLM, using offer script', {
                    response: fastPathResponse.substring(0, 50)
                });
            }
            
            // Only proceed with LLM if fast-path didn't trigger
            if (!aiResult) {
            // Step 3: Build discovery prompt with scenario knowledge
            // V33: Pass collectedSlots so LLM can acknowledge caller's name
            const discoveryPrompt = LLMDiscoveryEngine.buildDiscoveryPrompt({
                company,
                scenarios: scenarioRetrieval.scenarios,
                emotion,
                session: {
                    ...session.toObject ? session.toObject() : session,
                    collectedSlots: currentSlots  // V33: Include current slots for name acknowledgment
                }
            });
            
            // Step 4: Build context for LLM
            // ═══════════════════════════════════════════════════════════════════
            // V31: STATE SUMMARY - Prevents goldfish memory / repetition
            // ═══════════════════════════════════════════════════════════════════
            // V116: Use discovery truth to fill problem if session.discovery.issue is empty
            const truthProblem = discoveryTruth?.call_reason_detail || null;
            const sessionProblem = session.discovery?.issue || null;
            
            const stateSummary = {
                problem: sessionProblem || truthProblem || 'Not yet captured',
                collectedSlots: Object.keys(currentSlots).filter(k => currentSlots[k]).map(k => `${k}=${currentSlots[k]}`),
                missingSlots: ['name', 'phone', 'address', 'time'].filter(s => !currentSlots[s]),
                discoveryTurnCount: session.discovery?.turnCount || 0,
                offeredScheduling: session.discovery?.offeredScheduling || false,
                lastAgentIntent: session.lastAgentIntent || null,
                // V116: Discovery truth data
                firstUtterance: discoveryTruth?.first_utterance || null,
                callReasonDetail: truthProblem,
                callIntentGuess: discoveryTruth?.call_intent_guess || null
            };
            
            log('CHECKPOINT 9d.2: 📊 V31 State Summary for LLM', stateSummary);
            
            const llmContext = {
                // V22: LLM-led mode
                mode: 'LLM_LED_DISCOVERY',
                
                // ═══════════════════════════════════════════════════════════════
                // V31: STATE SUMMARY - Prevents repetition
                // ═══════════════════════════════════════════════════════════════
                stateSummary,
                
                // Scenario knowledge (tools, not scripts)
                // Consent Split: allow specific scenarioTypes to be used verbatim before consent, while BOOKING stays consent-gated.
                scenarioKnowledge: (() => {
                    const scenarios = Array.isArray(scenarioRetrieval.scenarios) ? scenarioRetrieval.scenarios : [];
                    const allowTypes = Array.isArray(killSwitches.autoReplyAllowedScenarioTypes) ? killSwitches.autoReplyAllowedScenarioTypes : [];

                    // V110: Scenarios are the PRIMARY brain in Discovery.
                    //   They can be used verbatim (acknowledge + funnel).
                    //   LLM should use scenario knowledge to inform its response.
                    //
                    // Non-V110 (legacy):
                    //   disableScenarioAutoResponses=false → may_verbatim
                    //   disableScenarioAutoResponses=true  → context_only (with allowlist override)
                    const getUsageModeForScenario = (s) => {
                        if (killSwitches.v110OwnerPriority) {
                            // V110: Scenarios are PRIMARY — LLM can use them verbatim
                            return 'may_verbatim';
                        }
                        const type = (s?.scenarioType || 'UNKNOWN').toString().trim().toUpperCase();
                        if (killSwitches.disableScenarioAutoResponses !== true) return 'may_verbatim';
                        return allowTypes.includes(type) ? 'may_verbatim' : 'context_only';
                    };

                    return scenarios.map(s => ({
                        ...s,
                        usageMode: getUsageModeForScenario(s)
                    }));
                })(),
                scenarioUsagePolicy: {
                    defaultMode: killSwitches.v110OwnerPriority
                        ? 'may_verbatim'  // V110: scenarios are PRIMARY brain
                        : (killSwitches.disableScenarioAutoResponses ? 'context_only' : 'may_verbatim'),
                    allowVerbatimScenarioTypes: Array.isArray(killSwitches.autoReplyAllowedScenarioTypes) ? killSwitches.autoReplyAllowedScenarioTypes : [],
                    v110OwnerPriority: !!killSwitches.v110OwnerPriority
                },
                
                // Caller emotion
                callerEmotion: emotion.emotion,
                
                // What has been discovered so far
                discovery: session.discovery || {},
                
                // Company variables for natural speech
                companyVars: LLMDiscoveryEngine.getCompanyVariables(company),
                
                // Custom system prompt for discovery
                customSystemPrompt: discoveryPrompt,
                
                // Collected slots (for context, NOT for asking)
                collectedSlots: currentSlots,
                
                // ═══════════════════════════════════════════════════════════
                // V116: DISCOVERY TRUTH — Immutable caller context
                // ═══════════════════════════════════════════════════════════
                discoveryTruth: discoveryTruth || null,
                
                // ═══════════════════════════════════════════════════════════
                // V110: SCHEDULING STATE + CONFIRM POLICY
                // ═══════════════════════════════════════════════════════════
                // When schedulingAccepted=true, the LLM should:
                //   - CONFIRM captured slots ("I have X as {value}")
                //   - ASK only missing slots ("What's the service address?")
                //   - NEVER re-ask captured slots
                // When schedulingAccepted=false, the LLM should:
                //   - Acknowledge the caller's issue (scenario-driven)
                //   - Offer scheduling (funnel question)
                // ═══════════════════════════════════════════════════════════
                schedulingAccepted: session.booking?.consentGiven === true || 
                                   session._deferredBookingSignals?.schedulingAccepted === true,
                confirmPolicy: {
                    rule: 'If captured, confirm — if missing, ask — never re-ask',
                    capturedSlots: Object.keys(currentSlots).filter(k => currentSlots[k]),
                    missingSlots: (() => {
                        const dSteps = awReader 
                            ? awReader.get('frontDesk.discoveryFlow.steps', [])
                            : (company?.aiAgentSettings?.frontDesk?.discoveryFlow?.steps || []);
                        return (dSteps || [])
                            .filter(s => s.slotId && s.slotId !== 'call_reason_detail')
                            .filter(s => !currentSlots[s.slotId])
                            .map(s => s.slotId);
                    })()
                },
                
                // Kill switches (prompt enforcement)
                killSwitches
            };
            
            log('CHECKPOINT 9e: 🎯 LLM context built for discovery', {
                scenarioCount: llmContext.scenarioKnowledge?.length || 0,
                emotion: llmContext.callerEmotion,
                hasDiscoveryIssue: !!llmContext.discovery?.issue
            });
            
            // Step 5: Call LLM - it is the PRIMARY BRAIN
            const llmResult = await HybridReceptionistLLM.processConversation({
                    company,
                    callContext: {
                        callId: session._id.toString(),
                        companyId,
                        customerContext,
                        runningSummary: summaryFormatted,
                        turnCount: (session.metrics?.totalTurns || 0) + 1,
                        channel,
                    partialName: currentSlots.partialName || null,
                    enterpriseContext: llmContext,
                    mode: 'LLM_LED_DISCOVERY'
                    },
                currentMode: 'discovery',
                    knownSlots: currentSlots,
                    conversationHistory,
                    userInput: userText,
                    behaviorConfig: company.aiAgentSettings?.frontDeskBehavior || {}
                });
                
                aiLatencyMs = Date.now() - aiStartTime;
                
            log('CHECKPOINT 9f: 🗣️ LLM response generated', {
                latencyMs: aiLatencyMs,
                tokensUsed: llmResult.tokensUsed || 0,
                replyPreview: llmResult.reply?.substring(0, 50)
            });
            
            // Step 6: Update discovery state from LLM extraction
            if (llmResult.extractedIssue && !session.discovery?.issue) {
                session.discovery = session.discovery || {};
                session.discovery.issue = llmResult.extractedIssue;
                session.discovery.issueCapturedAtTurn = (session.metrics?.totalTurns || 0) + 1;
            }
            
            // ═══════════════════════════════════════════════════════════════
            // V92 FIX: LLM responses ALSO need consent injection!
            // ═══════════════════════════════════════════════════════════════
            // The old code only checked for "schedule" + "?" which missed phrases like
            // "get a technician out there" - same patterns as Tier-1 scenarios
            // ═══════════════════════════════════════════════════════════════
            const discoveryBehaviorLLM = company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
            const autoInjectConsentLLM = discoveryBehaviorLLM.autoInjectConsentInScenarios !== false;
            const consentAlreadyGivenLLM = session.booking?.consentGiven === true;
            const alreadyAskedConsentLLM = session.conversationMemory?.askedConsentQuestion === true;
            
            // Same robust pattern as Tier-1 scenarios (catches "get a technician", "send someone", etc.)
            const llmSchedulingPatterns = /\b(we'?ll\s+(send|get|have|schedule)|send\s+(a\s+)?(tech|someone)|get\s+(a\s+)?(tech|technician|someone)\s+(out|to)|schedule\s+(a\s+)?(tech|appointment|visit|service)|let\s+me\s+(get|send|schedule)|come\s+(out|take\s+a\s+look)|take\s+a\s+look)/i;
            const llmImpliesScheduling = llmSchedulingPatterns.test(llmResult.reply || '');
            
            // Also check if LLM explicitly asked a scheduling question
            const llmAskedSchedulingQuestion = (llmResult.reply || '').toLowerCase().includes('schedule') && 
                                               (llmResult.reply || '').includes('?');
            
            log('🔍 V92: LLM RESPONSE CONSENT CHECK', {
                llmReplyPreview: (llmResult.reply || '').substring(0, 80),
                llmImpliesScheduling,
                llmAskedSchedulingQuestion,
                autoInjectConsentLLM,
                consentAlreadyGivenLLM,
                alreadyAskedConsentLLM
            });
            
            // Inject consent question if LLM implies scheduling but hasn't asked yet
            // V82 FIX: Also check if LLM already asked in THIS response (llmAskedSchedulingQuestion)
            if (autoInjectConsentLLM && llmImpliesScheduling && !consentAlreadyGivenLLM && !alreadyAskedConsentLLM && !llmAskedSchedulingQuestion) {
                const consentQuestionLLM = discoveryBehaviorLLM.consentQuestionTemplate || 
                    "Would you like me to schedule an appointment for you?";
                
                // Append consent question to LLM response
                llmResult.reply = (llmResult.reply || '').trim() + ' ' + consentQuestionLLM;
                
                session.conversationMemory = session.conversationMemory || {};
                session.conversationMemory.askedConsentQuestion = true;
                session.markModified('conversationMemory');
                
                // V98 FIX: Set consentPending so next turn's affirmative = booking
                // V98e: Also track which turn the offer was made
                session.booking = session.booking || {};
                session.booking.consentPending = true;
                session.booking.consentPendingTurn = session.metrics?.totalTurns || 0;
                session.markModified('booking');
                
                log('✅ V92/V98: CONSENT QUESTION INJECTED - consentPending=true', {
                    consentQuestion: consentQuestionLLM,
                    fullReplyPreview: llmResult.reply.substring(0, 100),
                    consentPendingSet: true,
                    consentPendingTurn: session.booking.consentPendingTurn
                });
            } else if (llmAskedSchedulingQuestion && !alreadyAskedConsentLLM) {
                // LLM organically asked about scheduling
                session.conversationMemory = session.conversationMemory || {};
                session.conversationMemory.askedConsentQuestion = true;
                session.markModified('conversationMemory');
                
                // V98 FIX: Set consentPending so next turn's affirmative = booking
                // V98e: Also track which turn the offer was made
                session.booking = session.booking || {};
                session.booking.consentPending = true;
                session.booking.consentPendingTurn = session.metrics?.totalTurns || 0;
                session.markModified('booking');
                
                log('✅ V92/V98: LLM ORGANICALLY ASKED CONSENT - consentPending=true', {
                    replyPreview: (llmResult.reply || '').substring(0, 80),
                    consentPendingSet: true,
                    consentPendingTurn: session.booking.consentPendingTurn
                });
            }
            
            // Step 8: Store scenarios consulted for debugging
            if (scenarioRetrieval.scenarios?.length > 0) {
                session.conversationMemory = session.conversationMemory || {};
                session.conversationMemory.scenariosConsulted = scenarioRetrieval.scenarios.map(s => s.scenarioId);
                
                // ═══════════════════════════════════════════════════════════════
                // FIX 3: Populate callLedger.activeScenarios when scenarios used
                // ═══════════════════════════════════════════════════════════════
                // Initialize callLedger if not present
                session.callLedger = session.callLedger || { activeScenarios: [], entries: [], facts: {} };
                
                // Dedup push scenario keys to activeScenarios
                for (const scenario of scenarioRetrieval.scenarios) {
                    const scenarioKey = scenario.scenarioId || scenario.name;
                    if (scenarioKey && !session.callLedger.activeScenarios.includes(scenarioKey)) {
                        session.callLedger.activeScenarios.push(scenarioKey);
                        
                        // Append ledger entry for scenario usage
                        session.callLedger.entries.push({
                            turn: session.metrics?.totalTurns || 1,
                            timestamp: new Date(),
                            type: 'SCENARIO_USED',
                            key: scenarioKey,
                            note: `Scenario "${scenario.title || scenarioKey}" served during discovery`,
                            flowKey: null
                        });
                    }
                }
            }
            
            // ═══════════════════════════════════════════════════════════════
            // V92: REPLACE PLACEHOLDERS IN LLM RESPONSES TOO
            // ═══════════════════════════════════════════════════════════════
            // LLM may include {callerName} from scenario examples it saw
            // Also ensures consistency if LLM echoes template text
            // Uses existing placeholder system - multi-tenant safe
            // ═══════════════════════════════════════════════════════════════
            const callerNameForLLM = currentSlots.name || currentSlots.partialName;
            const llmRuntimeVars = {};
            
            if (callerNameForLLM && !NAME_STOP_WORDS_ENGINE.has(callerNameForLLM.toLowerCase())) {
                llmRuntimeVars.callerName = callerNameForLLM;
                llmRuntimeVars.callerFirstName = callerNameForLLM.split(' ')[0];
                llmRuntimeVars.name = callerNameForLLM;
            }
            
            const { replacePlaceholders: llmReplacePlaceholders } = require('../utils/placeholderReplacer');
            let llmFinalReply = llmReplacePlaceholders(llmResult.reply, company, llmRuntimeVars);
            
            // Clean up any unreplaced placeholders gracefully
            llmFinalReply = llmFinalReply
                .replace(/,?\s*\{callerName\}[,.]?\s*/gi, ' ')
                .replace(/\{callerFirstName\}/gi, '')
                .replace(/\{name\}/gi, '')
                .replace(/\s{2,}/g, ' ')
                .trim();
            
            const llmPlaceholdersReplaced = llmFinalReply !== llmResult.reply;
            if (llmPlaceholdersReplaced) {
                log('🔄 V92: Placeholders replaced in LLM response', {
                    hadCallerName: !!llmRuntimeVars.callerName,
                    callerName: llmRuntimeVars.callerName || null
                });
            }
            
            aiResult = {
                reply: llmFinalReply,
                conversationMode: 'discovery',
                intent: llmResult.intent || 'discovery',
                nextGoal: llmResult.nextGoal || 'UNDERSTAND_CALLER',
                filledSlots: currentSlots,
                signals: { 
                    wantsBooking: false,  // NOT booking until consent
                    consentGiven: false,
                    discoveryComplete: !!session.discovery?.issue,
                    // V98 FIX: Propagate consentPending to Redis so next turn can detect consent
                    bookingConsentPending: session.booking?.consentPending === true
                },
                latencyMs: aiLatencyMs,
                tokensUsed: llmResult.tokensUsed || 0,
                fromStateMachine: false,
                mode: session.mode,
                debug: {
                    source: 'OPTION1_LLM_SPEAKS',
                    stage: llmContext.stage,
                    canAskConsent: llmContext.canAskConsent,
                    discoveryIssue: llmContext.discovery?.issue,
                    // V22 Debug Info
                    scenariosRetrieved: scenarioRetrieval.scenarios?.map(s => s.title) || [],
                    scenarioCount: scenarioRetrieval.scenarios?.length || 0,
                    // V92: Placeholder replacement in LLM path
                    llmPlaceholdersReplaced,
                    llmHadCallerName: !!llmRuntimeVars.callerName,
                    ownerPolicy: {
                        v110OwnerPriority: killSwitches.v110OwnerPriority || false,
                        bookingRequiresConsent: killSwitches.bookingRequiresConsent,
                        forceLLMDiscovery: killSwitches.forceLLMDiscovery,
                        disableScenarioAutoResponses: killSwitches.disableScenarioAutoResponses
                    }
                }
            };

            if (isServiceCall && serviceFlowConfig.empathyEnabled !== true) {
                const stripped = stripServiceEmpathyPreamble(aiResult.reply, tradeKey, true);
                if (stripped) {
                    aiResult.reply = stripped;
                } else if (serviceFlowPromptKeys) {
                    aiResult.reply = resolveServiceFlowPrompt('nonUrgentConsent', 'serviceFlow.nonUrgentConsent');
                    session.lastAgentIntent = 'ASK_SERVICE_CONSENT';
                }
            }
            
            log('CHECKPOINT 9d: ✅ LLM response complete (DISCOVERY/SUPPORT)', {
                tokensUsed: llmResult.tokensUsed,
                mode: session.mode,
                hasIssue: !!session.discovery?.issue
            });
            
            // ═══════════════════════════════════════════════════════════════════
            // 🎯 BLACK BOX: RESPONSE_EXECUTION - Truthful execution trace
            // ═══════════════════════════════════════════════════════════════════
            // This is the EXECUTION proof (vs MATCHING_PIPELINE's capability list).
            // Tracks what was ACTUALLY used to generate the response.
            // ═══════════════════════════════════════════════════════════════════
            const executionTrace = [];
            
            // Track what context was actually provided to LLM
            if (llmContext.scenarioKnowledge?.length > 0) executionTrace.push('scenarioContext_provided');
            if (llmContext.callerName) executionTrace.push('callerName_provided');
            if (llmContext.callerEmotion && llmContext.callerEmotion !== 'neutral') executionTrace.push('emotionContext_provided');
            if (llmContext.discovery?.issue) executionTrace.push('discoveryIssue_provided');
            if (killSwitches?.v110OwnerPriority) executionTrace.push('v110_owner_priority');
            else if (killSwitches?.bookingRequiresConsent) executionTrace.push('consentGate_enforced');
            
            // Track what came back from LLM
            if (llmResult.reply) executionTrace.push('reply_generated');
            if (llmResult.extractedIssue) executionTrace.push('issue_extracted');
            
            // ═══════════════════════════════════════════════════════════════════
            // 🎯 COMPLIANCE CHECK - Did LLM follow the rules?
            // ═══════════════════════════════════════════════════════════════════
            // Deterministic checks on LLM output - NO extra LLM calls needed.
            // This is the "proof" that scenario settings shaped the output.
            // 
            // HARD FAIL RULES:
            // - {name} placeholder leak → score capped at 40
            // - Banned phrase detected → score capped at 50
            // 
            // MODE-AWARE BOOKING MOMENTUM:
            // - Only require booking momentum when session.mode === 'BOOKING'
            // - NOT for: message-taking, transfer, emergency, discovery, support
            // ═══════════════════════════════════════════════════════════════════
            
            // Determine call mode for compliance context
            // Split into primaryMode (what the call IS) vs handoffMode (how it ends)
            // This prevents emergencies from vanishing into "transfer" in analytics
            const sessionMode = (session.mode || 'DISCOVERY').toUpperCase();
            const isBookingMode = sessionMode === 'BOOKING';
            const isTransferMode = session.requiresTransfer || session.transferRequested;
            const isMessageTakeMode = session.booking?.outcome === 'message_taken' || 
                                      session.conversationState?.outcomeMode === 'message_take';
            const isEmergencyMode = session.discovery?.urgency === 'urgent' || 
                                    session.discovery?.isEmergency ||
                                    scenarioRetrieval?.scenarios?.[0]?.scenarioType === 'EMERGENCY';
            
            // PRIMARY MODE: What the call fundamentally IS (for analytics/reporting)
            // Emergencies are still emergencies even if they end in transfer
            let primaryMode = 'DISCOVERY';
            if (isEmergencyMode) primaryMode = 'EMERGENCY';
            else if (isBookingMode) primaryMode = 'BOOKING';
            else if (isMessageTakeMode) primaryMode = 'MESSAGE_TAKE';
            else if (sessionMode === 'SUPPORT') primaryMode = 'SUPPORT';
            else if (sessionMode === 'COMPLETE') primaryMode = 'COMPLETE';
            
            // HANDOFF MODE: How the call is being handled (for compliance gating)
            // Transfer mode skips booking momentum checks
            const handoffMode = isTransferMode ? 'TRANSFER' : 'NONE';
            
            // EFFECTIVE MODE: For compliance (combines primary + handoff)
            // Transfer overrides for compliance purposes (no booking momentum needed)
            const effectiveMode = isTransferMode ? 'TRANSFER' : primaryMode;
            
            // Determine booking phase (only relevant when effectiveMode === 'BOOKING')
            let bookingPhase = null;
            if (effectiveMode === 'BOOKING') {
                // Determine phase based on what slots we have
                const hasConsent = session.locks?.consentGiven || session.conversationState?.consentGiven;
                const hasTimeSlot = currentSlots?.preferredTime || currentSlots?.appointmentTime;
                const hasAddress = currentSlots?.address || currentSlots?.serviceAddress;
                
                if (!hasConsent) {
                    bookingPhase = 'CLASSIFICATION'; // Still classifying/getting consent
                } else if (!hasTimeSlot) {
                    bookingPhase = 'SCHEDULING'; // Scheduling time
                } else if (!hasAddress) {
                    bookingPhase = 'SCHEDULING'; // Still need address
                } else {
                    bookingPhase = 'CONFIRMATION'; // Confirming details
                }
            }
            // For non-BOOKING modes, bookingPhase stays null → no booking momentum required
            
            const complianceResult = checkCompliance(llmResult.reply, {
                company,
                callerName: llmContext.callerName || currentSlots?.name || null,
                scenarioType: scenarioRetrieval?.scenarios?.[0]?.scenarioType || null,
                bookingPhase,
                effectiveMode  // NEW: Pass mode for context
            });
            
            // Add compliance to execution trace
            if (complianceResult.hardFail) {
                executionTrace.push('compliance_hard_fail');
                executionTrace.push(`hard_fail_${complianceResult.hardFailReason}`);
            } else if (!complianceResult.passed) {
                executionTrace.push('compliance_failed');
            } else {
                executionTrace.push('compliance_passed');
            }
            
            // Track specific violations
            if (complianceResult.checks.troubleshooting && !complianceResult.checks.troubleshooting.passed) {
                executionTrace.push('troubleshooting_detected');
            }
            if (complianceResult.checks.bannedPhrases && !complianceResult.checks.bannedPhrases.passed) {
                executionTrace.push('banned_phrase_detected');
            }
            if (complianceResult.checks.verbosity && !complianceResult.checks.verbosity.passed) {
                executionTrace.push('verbosity_exceeded');
            }
            if (complianceResult.checks.nameUsage?.reason === 'placeholder_leaked') {
                executionTrace.push('name_placeholder_leaked');
            }
            
            // Build compact compliance summary for logging
            const complianceSummary = buildComplianceSummary(complianceResult);
            
            // Log truthful execution trace (sample: always for now, downsample later)
            // Get scenarioId from matching trace for correlation
            const matchedScenarioId = scenarioRetrieval?.matchingTrace?.scenarioIdMatched 
                || scenarioRetrieval?.scenarios?.[0]?.scenarioId 
                || null;
            
            await BlackBoxLogger.logEvent({
                callId: session._id?.toString(),
                companyId,
                type: 'RESPONSE_EXECUTION',
                turn: turnNumber,
                turnTraceId,  // 🔗 Correlation ID - links to MATCHING_PIPELINE
                data: {
                    responseSource: 'LLM',
                    scenarioIdMatched: matchedScenarioId,  // 🔗 Correlation with matched scenario
                    executionTrace,
                    executionTraceCount: executionTrace.length,
                    // Mode context (split for analytics vs compliance)
                    primaryMode,    // What the call IS (EMERGENCY/BOOKING/etc.) - for analytics
                    handoffMode,    // How it's ending (TRANSFER/NONE) - for compliance
                    effectiveMode,  // Combined for compliance checks
                    bookingPhase,
                    // LLM context
                    scenarioCountProvided: llmContext.scenarioKnowledge?.length || 0,
                    hasCallerName: !!llmContext.callerName,
                    emotion: llmContext.callerEmotion || 'neutral',
                    llmLatencyMs: aiLatencyMs,
                    tokensUsed: llmResult.tokensUsed || 0,
                    replyLength: llmResult.reply?.length || 0,
                    // 🎯 COMPLIANCE: Did LLM follow the rules?
                    compliance: complianceSummary
                }
            }).catch(err => {
                logger.warn('[CONVERSATION ENGINE] Failed to log RESPONSE_EXECUTION event', { error: err.message });
            });
            
            // ═══════════════════════════════════════════════════════════════════
            // COMPLIANCE LOGGING - with first-hard-fail-per-call gate
            // ═══════════════════════════════════════════════════════════════════
            // - First hard fail per call: ERROR (high signal)
            // - Subsequent hard fails: WARN (avoid spam)
            // - Soft fails: WARN (always)
            // ═══════════════════════════════════════════════════════════════════
            if (!complianceResult.passed) {
                // Track hard fails per call session (first one gets ERROR, rest get WARN)
                session._complianceHardFailCount = session._complianceHardFailCount || 0;
                const isFirstHardFail = complianceResult.hardFail && session._complianceHardFailCount === 0;
                
                if (complianceResult.hardFail) {
                    session._complianceHardFailCount++;
                }
                
                // First hard fail → ERROR (high signal), subsequent → WARN (reduce spam)
                const logLevel = isFirstHardFail ? 'error' : 'warn';
                const prefix = isFirstHardFail ? '🚨 HARD FAIL' : 
                              (complianceResult.hardFail ? '⚠️ HARD FAIL (repeat)' : '⚠️');
                
                logger[logLevel](`[CONVERSATION ENGINE] ${prefix} LLM compliance check failed`, {
                    callId: session._id?.toString(),
                    companyId,
                    turn: turnNumber,
                    turnTraceId,
                    scenarioIdMatched: matchedScenarioId,
                    primaryMode,
                    handoffMode,
                    effectiveMode,
                    score: complianceResult.score,
                    hardFail: complianceResult.hardFail,
                    hardFailReason: complianceResult.hardFailReason,
                    hardFailCount: session._complianceHardFailCount,
                    bookingPhase,
                    wordCount: complianceResult.checks.verbosity?.wordCount,
                    violations: complianceResult.violations?.slice(0, 5)
                });
            }
            
            // Increment discovery question count for fast-path gate
            session.discovery = session.discovery || {};
            session.discovery.questionCount = (session.discovery.questionCount || 0) + 1;
            }  // End of if (!aiResult) - fast-path bypass
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // Save state to session (both modes)
        // ═══════════════════════════════════════════════════════════════════
        session.collectedSlots = { ...session.collectedSlots, ...currentSlots };
        
        // ═══════════════════════════════════════════════════════════════════
        // KEY FACTS STORAGE - For interrupt handling context
        // ═══════════════════════════════════════════════════════════════════
        // Store key facts from the conversation so interrupts don't lose context
        // V88 FIX: Include technician name, previous visit, and equipment!
        session.keyFacts = session.keyFacts || [];
        
        // Add new facts from this turn
        if (session.discovery?.issue && !session.keyFacts.includes(`Issue: ${session.discovery.issue}`)) {
            session.keyFacts.push(`Issue: ${session.discovery.issue}`);
        }
        if (currentSlots.name && !session.keyFacts.includes(`Name: ${currentSlots.name}`)) {
            session.keyFacts.push(`Name: ${currentSlots.name}`);
        }
        if (currentSlots.phone && !session.keyFacts.includes(`Phone: ${currentSlots.phone}`)) {
            session.keyFacts.push(`Phone: ${currentSlots.phone}`);
        }
        if (currentSlots.address && !session.keyFacts.includes(`Address: ${currentSlots.address}`)) {
            session.keyFacts.push(`Address: ${currentSlots.address}`);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // V88 FIX: ADD DISCOVERY CONTEXT TO KEY FACTS
        // ═══════════════════════════════════════════════════════════════════
        // These were being extracted but NOT passed to the LLM!
        // Now the AI will know about technician names, previous visits, and equipment
        // ═══════════════════════════════════════════════════════════════════
        if (session.discovery?.mentionedTechName && !session.keyFacts.some(f => f.startsWith('Technician:'))) {
            session.keyFacts.push(`Technician: ${session.discovery.mentionedTechName}`);
            log('📝 V88: Added technician to keyFacts', { techName: session.discovery.mentionedTechName });
        }
        if (session.discovery?.previousVisitTime && !session.keyFacts.some(f => f.startsWith('Previous visit:'))) {
            session.keyFacts.push(`Previous visit: ${session.discovery.previousVisitTime}`);
            log('📝 V88: Added previous visit to keyFacts', { visitTime: session.discovery.previousVisitTime });
        }
        if (session.discovery?.mentionedEquipment && !session.keyFacts.some(f => f.startsWith('Equipment:'))) {
            session.keyFacts.push(`Equipment: ${session.discovery.mentionedEquipment}`);
            log('📝 V88: Added equipment to keyFacts', { equipment: session.discovery.mentionedEquipment });
        }
        
        // Keep only last 15 facts to prevent bloat (increased from 10 for discovery context)
        if (session.keyFacts.length > 15) {
            session.keyFacts = session.keyFacts.slice(-15);
        }
        
        // Update legacy phase for backward compatibility
        if (session.mode === 'BOOKING') {
            session.phase = 'booking';
        } else if (session.mode === 'COMPLETE') {
            session.phase = 'complete';
        } else {
            session.phase = 'discovery';
        }
        
        log('CHECKPOINT 9g: 📊 Session state saved', {
            mode: session.mode,
            phase: session.phase,
            consentGiven: session.booking?.consentGiven,
            hasIssue: !!session.discovery?.issue,
            slotsCount: Object.keys(session.collectedSlots || {}).filter(k => session.collectedSlots[k]).length
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // V22 BLACK BOX LOG - MANDATORY VERIFICATION DATA
        // ═══════════════════════════════════════════════════════════════════════
        // This structured log is REQUIRED for acceptance testing.
        // It proves the system is behaving correctly per V22 architecture.
        // ═══════════════════════════════════════════════════════════════════════
        const v22BlackBoxLog = {
            // Identity
            companyId: companyId?.toString(),
            sessionId: session._id?.toString(),
            turn: (session.metrics?.totalTurns || 0) + 1,
            timestamp: new Date().toISOString(),
            
            // V22 Mode Control (THE CRITICAL DATA)
            mode: session.mode,
            previousMode: session._previousMode || 'DISCOVERY',
            modeTransition: session._previousMode !== session.mode ? `${session._previousMode || 'DISCOVERY'} → ${session.mode}` : 'none',
            
            // Consent Gate (MUST BE EXPLICIT)
            // consentCheck removed - booking now handled by minimal keyword detection
            consentDetected: session.booking?.consentGiven || false,
            consentPhrase: session.booking?.consentPhrase || null,
            consentGiven: session.booking?.consentGiven || false,
            bookingStarted: session.mode === 'BOOKING',
            
            // LLM Control (PROVES LLM SPOKE FIRST)
            llmSpoke: !aiResult?.fromStateMachine,
            llmTokensUsed: aiResult?.tokensUsed || 0,
            responseSource: aiResult?.debug?.source || (aiResult?.fromStateMachine ? 'STATE_MACHINE' : 'LLM'),
            
            // Scenario Tool Usage (NOT SCRIPTS)
            scenariosRetrieved: session.conversationMemory?.scenariosConsulted || [],
            scenarioCount: session.conversationMemory?.scenariosConsulted?.length || 0,
            
            // ═══════════════════════════════════════════════════════════════════
            // V23 BOOKING OUTCOME TRACKING
            // ═══════════════════════════════════════════════════════════════════
            bookingComplete: session.mode === 'COMPLETE',
            bookingRequestId: aiResult?.debug?.bookingRequestId || session.booking?.bookingRequestId || null,
            caseId: aiResult?.debug?.caseId || null,
            outcomeMode: aiResult?.debug?.outcomeMode || null,  // 'confirmed_on_call' | 'pending_dispatch' | etc.
            bookingStatus: aiResult?.debug?.status || null,     // 'FAKE_CONFIRMED' | 'PENDING_DISPATCH' | etc.
            
            // Discovery State
            discoveryIssue: session.discovery?.issue || null,
            callerEmotion: aiResult?.debug?.emotion || 'neutral',
            
            // ═══════════════════════════════════════════════════════════════════
            // V26 CALLER VOCABULARY TRANSLATION
            // ═══════════════════════════════════════════════════════════════════
            vocabularyTranslated: vocabularyTranslation.replacements?.length > 0,
            vocabularyOriginal: vocabularyTranslation.original !== vocabularyTranslation.translated ? vocabularyTranslation.original : null,
            vocabularyReplacements: vocabularyTranslation.replacements?.length > 0 ? vocabularyTranslation.replacements : null,
            
            // Latency (MUST BE MEASURED)
            latencyMs: aiLatencyMs,
            totalTurnLatencyMs: Date.now() - startTime,
            
            // V110: Owner policy (replaces kill switches for V110 companies)
            ownerPolicy: {
                v110OwnerPriority: (company.aiAgentSettings?.frontDeskBehavior?.discoveryFlow?.steps || []).length > 0,
                bookingRequiresConsent: company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.bookingRequiresExplicitConsent !== false,
                forceLLMDiscovery: company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.forceLLMDiscovery === true,
                disableScenarioAutoResponses: company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.disableScenarioAutoResponses === true,
                autoReplyAllowedScenarioTypes: Array.isArray(company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.autoReplyAllowedScenarioTypes)
                    ? company.aiAgentSettings.frontDeskBehavior.discoveryConsent.autoReplyAllowedScenarioTypes
                        .map(t => (t || '').toString().trim().toUpperCase())
                        .filter(Boolean)
                    : []
            },
            
            // Response Preview (for human verification)
            userInput: userText?.substring(0, 100),
            aiResponsePreview: aiResult?.reply?.substring(0, 100)
        };
        
        // Store previous mode for next turn's transition detection
        session._previousMode = session.mode;
        
        // Log to console (structured for parsing)
        logger.info('[V22 BLACK BOX] Turn complete', v22BlackBoxLog);
        
        // Also add to response debug for UI visibility
        if (aiResult) {
            aiResult.v22BlackBox = v22BlackBoxLog;
            
            // Merge extracted slots
            aiResult.filledSlots = { ...(aiResult.filledSlots || {}), ...extractedThisTurn };
            
            // V81 FIX: Validate and sanitize filledSlots.name - prevent invalid names like "Air Conditioner"
            if (aiResult.filledSlots?.name) {
                const nameToCheck = String(aiResult.filledSlots.name).toLowerCase();
                const nameWords = nameToCheck.split(/\s+/);
                const invalidNameWords = [
                    'air', 'ac', 'hvac', 'heating', 'cooling', 'conditioning', 'conditioner',
                    'service', 'services', 'repair', 'repairs', 'maintenance', 'unit', 'system',
                    'plumbing', 'electrical', 'appointment', 'schedule', 'booking',
                    'having', 'doing', 'calling', 'looking', 'trying', 'getting', 'going',
                    'issues', 'problems', 'trouble', 'great', 'fine', 'good', 'bad'
                ];
                const hasInvalidWord = nameWords.some(w => invalidNameWords.includes(w));
                if (hasInvalidWord) {
                    log('🚨 V81 INVALID NAME IN FILLED SLOTS - removing:', { 
                        invalidName: aiResult.filledSlots.name,
                        reason: 'contains_service_word'
                    });
                    delete aiResult.filledSlots.name;
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // CRITICAL: Update session.collectedSlots IMMEDIATELY after extraction
        // This ensures slots persist even if later save operations fail
        // ═══════════════════════════════════════════════════════════════════════
        if (Object.keys(extractedThisTurn).length > 0) {
            session.collectedSlots = { ...session.collectedSlots, ...extractedThisTurn };
            log('CHECKPOINT 9d: 📊 Slots immediately saved to session', {
                extractedThisTurn,
                allSlots: session.collectedSlots
            });
        }
        
        log('CHECKPOINT 9: ✅ Response generated', { 
            source: aiResult?.fromStateMachine ? 'STATE_MACHINE' : 'LLM',
            latencyMs: aiLatencyMs, 
            tokensUsed: aiResult?.tokensUsed || 0,
            mode: aiResult?.conversationMode || 'unknown'
        });

        // ═══════════════════════════════════════════════════════════════════
        // PRICING POLICY: transfer/callback guardrails + placeholder rendering
        // ═══════════════════════════════════════════════════════════════════
        if (aiResult?.reply) {
            const pricingPolicyResult = await PricingPolicyResponder.applyPricingPolicy({
                replyText: aiResult.reply,
                companyId,
                company,
                session,
                userText,
                tradeKey: normalizeTradeKey(company.trade || company.tradeType || '')
            });

            if (pricingPolicyResult?.replyText) {
                aiResult.reply = pricingPolicyResult.replyText;
            }

            if (pricingPolicyResult?.pricingState) {
                session.pricingPolicy = {
                    ...(session.pricingPolicy || {}),
                    ...pricingPolicyResult.pricingState
                };
                session.markModified('pricingPolicy');
            }

            if (pricingPolicyResult?.requiresTransfer) {
                aiResult.debug = aiResult.debug || {};
                aiResult.debug.requiresTransfer = true;
                aiResult.debug.transferReason = 'pricing_policy_transfer';
            }

            if (pricingPolicyResult?.policyEvent) {
                aiResult.debug = aiResult.debug || {};
                aiResult.debug.pricingPolicy = {
                    event: pricingPolicyResult.policyEvent,
                    tokenKey: pricingPolicyResult.tokenKey || null,
                    mode: pricingPolicyResult.policyMode || null
                };
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // 🆕 RETURN LANE: APPLY POST-RESPONSE POLICY (V1 - 2026-02)
        // ═══════════════════════════════════════════════════════════════════
        // After 3-tier response is generated, apply Return Lane policy to:
        // 1. Track lane context (turns in lane, pushes made)
        // 2. Optionally append a "push to booking" prompt
        // 3. Log trace events for debugging
        //
        // KILL SWITCHES (all must be true for policy to apply):
        // - company.aiAgentSettings.returnLane.enabled === true
        // - matchedTriageCard.returnConfig.enabled === true
        // - Session not already in BOOKING mode (unless guardrail disabled)
        // ═══════════════════════════════════════════════════════════════════
        let returnLaneResult = null;
        
        if (companyReturnLaneEnabled && triageCardMatch?.matched && matchedTriageCard) {
            try {
                const responseTier = aiResult?.tier || 'tier3';
                const isAlreadyBooking = session.mode === 'BOOKING' || 
                                         session.phase === 'booking' ||
                                         session.booking?.consentGiven === true;
                
                returnLaneResult = ReturnLaneService.applyPolicy({
                    company,
                    cardMatch: triageCardMatch,
                    card: matchedTriageCard,
                    session,
                    responseTier,
                    isAlreadyBooking
                });
                
                // If policy returned a push prompt, append it to the response
                if (returnLaneResult?.applied && returnLaneResult?.pushPrompt && aiResult?.reply) {
                    const originalReply = aiResult.reply;
                    
                    // Don't append if response already ends with a question about scheduling
                    const alreadyAsksScheduling = /schedul|appointment|technician|come out/i.test(
                        originalReply.slice(-100)
                    );
                    
                    if (!alreadyAsksScheduling) {
                        // Append push prompt with proper spacing
                        aiResult.reply = originalReply.trim() + ' ' + returnLaneResult.pushPrompt;
                        
                        log('🚀 RETURN_LANE: Push prompt appended', {
                            action: returnLaneResult.action,
                            reason: returnLaneResult.reason,
                            pushPromptPreview: returnLaneResult.pushPrompt.substring(0, 50),
                            originalReplyPreview: originalReply.substring(0, 50)
                        });
                    } else {
                        log('📋 RETURN_LANE: Skipped push - response already asks about scheduling');
                    }
                }
                
                // Update lane context in session
                if (returnLaneResult?.laneContext) {
                    session.laneContext = returnLaneResult.laneContext;
                    session.markModified('laneContext');
                }
                
                // Log trace event to Black Box
                if (returnLaneResult?.applied) {
                    await BlackBoxLogger.logEvent({
                        callId: session._id?.toString(),
                        companyId,
                        type: 'LANE_DECISION_SUMMARY',
                        turn: session.metrics?.totalTurns || 0,
                        data: {
                            action: returnLaneResult.action,
                            reason: returnLaneResult.reason,
                            lane: returnLaneResult.laneContext?.currentLane,
                            turnsInLane: returnLaneResult.laneContext?.turnsInLane,
                            pushCount: returnLaneResult.laneContext?.pushCount,
                            cardId: matchedTriageCard?._id?.toString(),
                            cardLabel: triageCardMatch?.triageLabel
                        }
                    }).catch(err => {
                        log('⚠️ RETURN_LANE: Failed to log trace event (non-fatal)', { error: err.message });
                    });
                }
                
            } catch (returnLaneErr) {
                log('⚠️ RETURN_LANE: Policy application failed (non-fatal)', { error: returnLaneErr.message });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 9: Process AI response
        // ═══════════════════════════════════════════════════════════════════
        let aiResponse = (aiResult?.reply || aiResult?.response || '').trim();
        
        // Handle empty response
        if (!aiResponse) {
            log('⚠️ Empty AI response, using fallback');
            aiResponse = "I'm sorry, could you repeat that?";
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // V115: FINAL SAFETY NET — If triage captured symptoms and the 
        // response doesn't acknowledge them, prepend acknowledgment.
        // This catches ALL tiers (scenario, LLM, fallback) and is the
        // router-level enforcement of "acknowledge before scheduling."
        // Only runs on Turn 1 (first substantive caller input).
        // ═══════════════════════════════════════════════════════════════════
        const turnNumber = (session.metrics?.totalTurns || 0) + 1;
        if (turnNumber <= 2 && triageResult?._triageRan && triageResult.callReasonDetail) {
            const alreadyAcknowledges = /sorry|understand|hear that|sounds like|dealing with|i see|got it.*about|calling about/i.test(aiResponse);
            const inappropriateStart = /^(sounds? good|great!?|perfect!?|wonderful!?|awesome!?)/i.test(aiResponse.trim());
            
            if (inappropriateStart || !alreadyAcknowledges) {
                const symptoms = triageResult.callReasonDetail;
                const urgency = triageResult.signals?.urgency || 'normal';
                let ack;
                if (urgency === 'emergency') {
                    ack = `I understand this is urgent — ${symptoms}.`;
                } else if (urgency === 'urgent') {
                    ack = `I'm sorry to hear about that — ${symptoms}. Let's get this taken care of.`;
                } else {
                    ack = `I understand — ${symptoms}.`;
                }
                
                // If response starts inappropriately, strip the bad opening
                let cleanResponse = aiResponse;
                if (inappropriateStart) {
                    cleanResponse = aiResponse.replace(/^(sounds? good|great!?|perfect!?|wonderful!?|awesome!?)[,.\s!]*/i, '').trim();
                    // Capitalize first letter of remaining text
                    if (cleanResponse.length > 0) {
                        cleanResponse = cleanResponse.charAt(0).toUpperCase() + cleanResponse.slice(1);
                    }
                }
                
                aiResponse = ack + ' ' + cleanResponse;
                log('📋 V115: Final safety net — prepended symptom acknowledgment', {
                    symptoms, urgency, inappropriateStart, tier: aiResult?.tier || 'unknown'
                });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 10: Update session
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 10: Updating session...');
        const latencyMs = Date.now() - startTime;
        
        try {
            // Determine response source
            let responseSource = 'llm';
            if (aiResult?.fromStateMachine) {
                responseSource = 'STATE_MACHINE';
            } else if (aiResult?.fromQuickAnswers) {
                responseSource = 'quick_answer';
            }
            
            await SessionService.addTurn({
                session,
                userMessage: userText,
                aiResponse,
                metadata: {
                    latencyMs,
                    tokensUsed: aiResult?.tokensUsed || 0,
                    responseSource,
                    confidence: aiResult?.confidence,
                    slotsExtracted: aiResult?.filledSlots || {},
                    channel,
                    // Include state machine state for debugging
                    stateMachine: aiResult?.debug?.stateMachineState || null
                },
                company
            });
        } catch (turnErr) {
            log('Failed to save turn (non-fatal)', { error: turnErr.message });
        }
        
        // Update phase
        const newPhase = aiResult?.conversationMode === 'booking' ? 'booking' : 
                         aiResult?.conversationMode === 'complete' ? 'complete' : 
                         session.phase || 'greeting';
        
        if (newPhase !== session.phase) {
            await SessionService.updatePhase(session, newPhase);
        }
        
        // Save flags
        if (willAskForMissingNamePart) {
            session.askedForMissingNamePart = true;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // TRACK lastAgentIntent FOR CONTEXT-AWARE CONSENT DETECTION
        // ═══════════════════════════════════════════════════════════════════
        // If the AI response asks about scheduling, mark it so next turn's
        // consent detection knows that "yes" means "yes to scheduling"
        // ═══════════════════════════════════════════════════════════════════
        const aiResponseLower = aiResponse.toLowerCase();
        // V92: Match all scheduling offer phrases (must match consent detection patterns!)
        const offeredScheduling = aiResponseLower.includes('schedule') || 
            aiResponseLower.includes('appointment') ||
            aiResponseLower.includes('technician') ||
            aiResponseLower.includes('come out') ||
            aiResponseLower.includes('back out') ||      // V92: "get someone back out"
            aiResponseLower.includes('send') ||          // V92: "send a tech"
            aiResponseLower.includes('get someone') ||   // V92: "let me get someone"
            aiResponseLower.includes('set up') ||        // V92: "get that set up"
            aiResponseLower.includes('book') ||          // V92: "book a visit"
            aiResponseLower.includes('would you like me to');
        
        if (offeredScheduling) {
            session.lastAgentIntent = 'OFFER_SCHEDULE';
            session.conversationMemory = session.conversationMemory || {};
            session.conversationMemory.askedConsentQuestion = true;
            // V92: Mark the field as modified so Mongoose saves it
            session.markModified('conversationMemory');
            log('📝 INTENT TRACKED: OFFER_SCHEDULE', { response: aiResponse.substring(0, 100) });
        } else if (session.mode === 'BOOKING') {
            session.lastAgentIntent = 'BOOKING_SLOT_QUESTION';
        } else {
            session.lastAgentIntent = 'DISCOVERY';
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // 🆕 PHASE 1: UPDATE LOCKS + ROLLING SUMMARY
        // ═══════════════════════════════════════════════════════════════════
        // Update locks based on what happened this turn
        if (!session.locks) {
            session.locks = { greeted: false, issueCaptured: false, bookingStarted: false, bookingLocked: false, askedSlots: {} };
        }
        
        // Mark as greeted once the conversation has ANY turns.
        // (ConversationSession tracks user+assistant entries; first "turn" will set totalTurns >= 2)
        if ((session.metrics?.totalTurns || 0) > 0) {
            session.locks.greeted = true;
        }
        
        // Mark issue captured if we have discovery data
        if (session.discovery?.issue || currentSlots?.issue) {
            session.locks.issueCaptured = true;
        }
        
        // Mark booking started/locked if in booking mode
        if (session.mode === 'BOOKING') {
            session.locks.bookingStarted = true;
            if (session.booking?.consentGiven) {
                session.locks.bookingLocked = true;
            }
        }
        
        // Track which slots we've asked for (to prevent re-asking)
        if (session.booking?.activeSlot) {
            session.locks.askedSlots = session.locks.askedSlots || {};
            session.locks.askedSlots[session.booking.activeSlot] = true;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // 🆕 PHASE 1: UPDATE ROLLING SUMMARY (Prevents goldfish memory)
        // ═══════════════════════════════════════════════════════════════════
        // Build a 1-2 sentence summary of the conversation so far
        if (!session.memory) {
            session.memory = { rollingSummary: '', facts: {}, acknowledgedClaims: [] };
        }
        
        // Build facts from collected data
        const facts = session.memory.facts || {};
        if (currentSlots?.name || currentSlots?.partialName) {
            facts.callerName = currentSlots.name || currentSlots.partialName;
        }
        if (session.discovery?.issue) {
            facts.issue = session.discovery.issue;
        }
        if (currentSlots?.phone) {
            facts.phoneCollected = true;
        }
        if (currentSlots?.address) {
            facts.addressCollected = true;
        }
        // Merge facts (do not wipe existing)
        session.memory.facts = { ...(session.memory.facts || {}), ...facts };
        
        // Build rolling summary
        const summaryParts = [];
        if (facts.callerName) summaryParts.push(`Caller: ${facts.callerName}`);
        if (facts.issue) summaryParts.push(`Issue: ${facts.issue}`);
        if (session.mode === 'BOOKING') summaryParts.push('Booking in progress');
        if (facts.phoneCollected) summaryParts.push('Phone captured');
        if (facts.addressCollected) summaryParts.push('Address captured');
        
        // Never overwrite a reused session's rolling summary with "New conversation".
        const nextRolling = summaryParts.join('. ');
        const fallbackRolling =
            (session.memory?.rollingSummary && String(session.memory.rollingSummary).trim()) ||
            (Array.isArray(session.runningSummary) && session.runningSummary.length > 0 ? String(session.runningSummary[session.runningSummary.length - 1]).trim() : '') ||
            'New conversation';
        session.memory.rollingSummary = nextRolling || fallbackRolling;
        session.memory.lastUserIntent = aiResult?.intent || 'unknown';
        
        // Mark modified for Mongoose
        session.markModified('locks');
        session.markModified('memory');
        
        log('🔒 PHASE 1: Locks + Memory updated', {
            locks: session.locks,
            rollingSummary: session.memory.rollingSummary,
            factsCount: Object.keys(session.memory.facts).length
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // V87 CRITICAL FIX: Mark 'turns' as modified!
        // Mongoose subdocument arrays don't auto-detect push() changes.
        // Without this, conversation history is NEVER SAVED!
        // ═══════════════════════════════════════════════════════════════════════
        session.markModified('turns');
        session.markModified('runningSummary');
        
        // Persist all session changes
        session.markModified('booking');
        session.markModified('conversationMemory');
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92 FIX: NEVER FAIL THE CALL IF DB SAVE FAILS
        // ═══════════════════════════════════════════════════════════════════════
        // If Mongoose validation fails (e.g., invalid enum value), the turn
        // should NOT die and fall back to "I'm having trouble right now."
        // The agent can still respond to the caller even if state wasn't persisted.
        // ═══════════════════════════════════════════════════════════════════════
        try {
            await session.save();
            log('CHECKPOINT 10: ✅ Session updated', { phase: newPhase, lastAgentIntent: session.lastAgentIntent });
        } catch (saveErr) {
            // Log the error but DO NOT throw - the call must continue
            logger.error('[SESSION_SAVE_FAILED] Non-fatal session save error (call continues)', {
                error: saveErr?.message,
                errorType: saveErr?.name,
                sessionId: session?._id?.toString(),
                phase: newPhase
            });
            
            // Add BlackBox event for monitoring
            try {
                await BlackBoxLogger.addEvent(session._id?.toString(), 'SESSION_SAVE_FAILED', {
                    error: saveErr?.message,
                    errorType: saveErr?.name,
                    phase: newPhase,
                    turnNumber: currentTurnNumber
                });
            } catch (bbErr) {
                // Ignore BlackBox logging errors
            }
            
            log('CHECKPOINT 10: ⚠️ Session save failed (non-fatal, call continues)', { 
                error: saveErr?.message,
                phase: newPhase 
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 10b: Update Call Center Live Progress (Enterprise Flow)
        // ═══════════════════════════════════════════════════════════════════
        // This updates the CallSummary record with real-time progress
        // so supervisors can monitor in-progress calls in Call Center UI
        // ═══════════════════════════════════════════════════════════════════
        if (channel === 'phone' && callSid) {
            try {
                const CallSummary = require('../models/CallSummary');

                // KPI trace snapshot (compact and enforceable)
                // Booking completion % denominator: enteredBooking === true
                // Numerator requires: bookingComplete + missingRequiredSlotsCount=0 + bookingOutcome in {SCHEDULED, CONFIRMED_REQUEST}
                const bookingConfigForKpi = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: session?.flags || {} });
                const bookingSlotsForKpi = bookingConfigForKpi.slots || [];
                const requiredSlots = bookingSlotsForKpi.filter(s => (s?.required !== false));

                const missingRequired = [];
                for (const slot of requiredSlots) {
                    const slotId = slot.slotId || slot.id || slot.key;
                    if (!slotId) continue;
                    try {
                        const complete = isSlotComplete(slotId, session.collectedSlots || {}, session, slot);
                        if (!complete) {
                            missingRequired.push(slotId);
                        }
                    } catch (e) {
                        // If completion check fails, treat as missing (never inflate metrics).
                        missingRequired.push(slotId);
                    }
                }

                const enteredBooking = !!(session.booking?.consentGiven || session.mode === 'BOOKING' || session.booking?.completedAt);
                const enteredBookingTurn = typeof session.booking?.consentTurn === 'number' ? session.booking.consentTurn : null;

                const outcomeMode = session.booking?.outcomeMode || aiResult?.debug?.outcomeMode || null;
                const bookingOutcome = mapOutcomeModeToKpiBookingOutcome(outcomeMode);
                const bookingComplete =
                    !!session.booking?.completedAt &&
                    missingRequired.length === 0 &&
                    (bookingOutcome === 'SCHEDULED' || bookingOutcome === 'CONFIRMED_REQUEST');

                // FailureReason heuristic (small, deterministic, improves over time)
                let failureReason = 'UNKNOWN';
                if (enteredBooking && !bookingComplete) {
                    if (aiResult?.signals?.bookingBlocked === true) failureReason = 'POLICY_BLOCKED';
                    else if ((session.flags && session.flags.refusedSlot) === true) failureReason = 'USER_REFUSED';
                    else if (missingRequired.length > 0) failureReason = 'SLOT_MISSING';
                }
                
                await CallSummary.updateLiveProgress(callSid, {
                    currentStage: session.conversationMemory?.currentStage || newPhase,
                    currentStep: session.conversationMemory?.currentStep,
                    discovery: session.discovery || {},
                    slotsCollected: session.collectedSlots || {},
                    offRailsCount: session.conversationMemory?.offRailsCount || 0,
                    triageOutcome: session.triageState?.outcome,
                    lastResponse: aiResponse.substring(0, 500),
                    turnCount: (session.metrics?.totalTurns || 0) + 1,
                    kpi: {
                        callerType: 'customer',
                        enteredBooking,
                        enteredBookingTurn,
                        bookingOutcome,
                        bookingComplete,
                        missingRequiredSlotsCount: missingRequired.length,
                        missingRequiredSlotsSample: missingRequired.slice(0, 5),
                        failureReason,
                        // bucket + containment set at endCall (duration-based)
                        bucket: enteredBooking ? 'BOOKING' : 'FAQ_ONLY'
                    }
                });
                
                log('CHECKPOINT 10b: 📡 Live progress updated in Call Center');
            } catch (liveErr) {
                // Non-blocking: Don't let live progress failures kill the call
                log('Live progress update failed (non-fatal)', { error: liveErr.message });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 11: Build response
        // ═══════════════════════════════════════════════════════════════════
        
        // ════════════════════════════════════════════════════════════════════════
        // 🎯 RESPONSE SOURCE TRACKING (Jan 18, 2026)
        // Used by BlackBox to show WHERE the response came from
        // This is CRITICAL for debugging - "source: unknown" tells us nothing!
        // V81 FIX: Add null safety for aiResult
        // ════════════════════════════════════════════════════════════════════════
        let matchSource = aiResult?.matchSource || 'LLM_FALLBACK';  // Use aiResult if already set
        let tier = aiResult?.tier || 'tier3';  // Default (LLM)
        
        // Override based on aiResult flags if matchSource wasn't explicitly set
        if (aiResult && !aiResult.matchSource) {
            if (aiResult.fromStateMachine) {
                matchSource = 'STATE_MACHINE';
                tier = 'tier1';
            } else if (aiResult.fromQuickAnswers) {
                matchSource = 'QUICK_ANSWER';
                tier = 'tier1';
            } else if (aiResult.scenarioMatched || aiResult.debug?.scenarioMatched) {
                matchSource = 'SCENARIO_MATCH';
                tier = aiResult.tier || 'tier2';
            } else if (aiResult.triageCardMatched) {
                matchSource = 'TRIAGE_MATCH';
                tier = 'tier1';
            } else if (aiResult.tokensUsed === 0) {
                // No tokens used = rule-based (state machine or scenario)
                matchSource = 'RULE_BASED';
                tier = 'tier1';
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V96i: ENSURE bookingFlowState for ALL booking responses
        // ═══════════════════════════════════════════════════════════════════════
        // Without this, inline booking handlers that don't explicitly set 
        // bookingFlowState will fail to lock the booking mode in Redis.
        // This was causing the booking gate bypass bug.
        // ═══════════════════════════════════════════════════════════════════════
        let finalBookingFlowState = aiResult?.bookingFlowState || session.bookingFlowState || null;
        
        const isBookingMode = aiResult?.mode === 'BOOKING' || 
                              aiResult?.conversationMode === 'booking' ||
                              session.mode === 'BOOKING';
        
        if (isBookingMode && !finalBookingFlowState?.bookingModeLocked) {
            finalBookingFlowState = {
                bookingModeLocked: true,
                bookingFlowId: 'conversation_engine_booking',
                currentStepId: aiResult?.debug?.source || 'collecting',
                bookingCollected: { ...session.collectedSlots, ...(aiResult?.filledSlots || {}) },
                bookingState: session.phase === 'complete' ? 'COMPLETE' : 'COLLECTING'
            };
            log('V96i: ⚡ Auto-created bookingFlowState for booking response', {
                source: aiResult?.debug?.source,
                mode: aiResult?.mode,
                conversationMode: aiResult?.conversationMode,
                sessionMode: session.mode
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // V110: INJECT DEFERRED BOOKING SIGNALS
        // ═══════════════════════════════════════════════════════════════════
        // When booking intent was detected in V110, the detection block
        // deferred signals (didn't set aiResult) so scenarios could speak
        // first. Now that scenarios/LLM have generated the response, we
        // merge the deferred scheduling signals into the final result.
        //
        // This ensures FrontDeskRuntime sees deferToBookingRunner + the
        // scenario's response (acknowledgment + funnel) in the same turn.
        // ═══════════════════════════════════════════════════════════════════
        const deferredSignals = session._deferredBookingSignals || null;
        if (deferredSignals) {
            // Merge into aiResult signals
            if (!aiResult) {
                aiResult = { reply: aiResponse, signals: {} };
            }
            aiResult.signals = { ...(aiResult.signals || {}), ...deferredSignals };
            
            log('📅 V110_DEFERRED_INJECT: Booking signals merged into scenario response', {
                scenarioReply: (aiResponse || '').substring(0, 80),
                signals: Object.keys(deferredSignals)
            });
            
            // Clean up
            delete session._deferredBookingSignals;
        }
        
        const response = {
            success: true,
            reply: aiResponse,
            sessionId: session._id.toString(),
            phase: newPhase,
            slotsCollected: { ...session.collectedSlots, ...(aiResult?.filledSlots || {}) },
            wantsBooking: aiResult?.wantsBooking || false,
            conversationMode: aiResult?.conversationMode || 'free',
            latencyMs,
            matchSource,
            tier,
            tokensUsed: aiResult?.tokensUsed || 0,
            // ═══════════════════════════════════════════════════════════════════
            // BOOKING FLOW STATE — persisted to Redis via v2twilio
            // ═══════════════════════════════════════════════════════════════════
            bookingFlowState: finalBookingFlowState,
            // ═══════════════════════════════════════════════════════════════════
            // SIGNALS — propagated to FrontDeskRuntime / v2twilio
            // ═══════════════════════════════════════════════════════════════════
            // In V110, deferredBookingSignals are merged here so 
            // FrontDeskRuntime sees schedulingAccepted + scenario reply together.
            // ═══════════════════════════════════════════════════════════════════
            signals: aiResult?.signals || {}
        };

        // V93: Allow deterministic mid-call rules (and other protocols) to request transfer in a visible way
        if (aiResult?.debug?.requiresTransfer === true) {
            response.requiresTransfer = true;
            response.transferReason = aiResult.debug.transferReason || 'protocol_requested_transfer';
        }
        
        // Add debug info if requested
        if (includeDebug) {
            // Determine response source for display
            // V81 FIX: Add null safety for aiResult
            let responseSource = 'LLM';
            if (aiResult?.fromStateMachine) {
                responseSource = 'STATE_MACHINE (0 tokens)';
            } else if (aiResult?.fromQuickAnswers) {
                responseSource = 'QUICK_ANSWER';
            }
            
            // ═══════════════════════════════════════════════════════════════════
            // 🎯 DYNAMIC STAGE-AWARE DEBUG DATA
            // Shows what's collected and needed based on CURRENT STAGE
            // ═══════════════════════════════════════════════════════════════════
            const currentStage = session.conversationMemory?.currentStage || 
                                 aiResult.debug?.stage || 
                                 (aiResult.conversationMode === 'booking' ? 'booking' : 'discovery');
            
            // Build stage-specific collected/need data
            const stageData = {
                currentStage,
                currentStep: session.conversationMemory?.currentStep || aiResult.debug?.step || null,
                
                // DISCOVERY STAGE DATA
                discovery: {
                    collected: {},
                    need: ['issue', 'context', 'callType']
                },
                
                // TRIAGE STAGE DATA  
                triage: {
                    collected: {},
                    need: ['diagnosis']
                },
                
                // BOOKING STAGE DATA
                booking: {
                    collected: {},
                    need: []
                }
            };
            
            // Populate DISCOVERY collected
            if (session.discovery?.issue) {
                stageData.discovery.collected.issue = session.discovery.issue;
                stageData.discovery.need = stageData.discovery.need.filter(n => n !== 'issue');
            }
            if (session.discovery?.context) {
                stageData.discovery.collected.context = session.discovery.context;
                stageData.discovery.need = stageData.discovery.need.filter(n => n !== 'context');
            }
            if (session.discovery?.callType && session.discovery.callType !== 'unknown') {
                stageData.discovery.collected.callType = session.discovery.callType;
                stageData.discovery.need = stageData.discovery.need.filter(n => n !== 'callType');
            }
            if (session.discovery?.mood && session.discovery.mood !== 'neutral') {
                stageData.discovery.collected.mood = session.discovery.mood;
            }
            if (session.discovery?.urgency && session.discovery.urgency !== 'normal') {
                stageData.discovery.collected.urgency = session.discovery.urgency;
            }
            
            // Populate TRIAGE collected
            if (session.triageState?.matchedCardName) {
                stageData.triage.collected.matchedCard = session.triageState.matchedCardName;
                stageData.triage.matchReason = session.triageState.matchReason || 'keyword match';
            }
            if (session.triageState?.questionsAsked?.length > 0) {
                stageData.triage.collected.questionsAsked = session.triageState.questionsAsked.length;
            }
            if (session.triageState?.answersReceived?.length > 0) {
                stageData.triage.collected.answersReceived = session.triageState.answersReceived.map(a => ({
                    q: a.question?.substring(0, 30),
                    a: a.answer?.substring(0, 30)
                }));
            }
            if (session.triageState?.diagnosisSummary) {
                stageData.triage.collected.diagnosis = session.triageState.diagnosisSummary;
                stageData.triage.need = [];
            }
            if (session.triageState?.outcome && session.triageState.outcome !== 'pending') {
                stageData.triage.collected.outcome = session.triageState.outcome;
            }
            
            // Populate BOOKING collected from session + current slots
            const allSlots = { ...session.collectedSlots, ...(aiResult.filledSlots || {}) };
            const bookingSlotIds = bookingConfig.slots.map(s => s.slotId || s.id);
            
            for (const slotId of bookingSlotIds) {
                if (allSlots[slotId]) {
                    stageData.booking.collected[slotId] = allSlots[slotId];
                } else {
                    stageData.booking.need.push(slotId);
                }
            }
            
            // Determine what to show in COLLECTED/NEED based on current stage
            let dynamicCollected = {};
            let dynamicNeed = [];
            
            switch (currentStage) {
                case 'greeting':
                case 'discovery':
                    dynamicCollected = stageData.discovery.collected;
                    dynamicNeed = stageData.discovery.need;
                    break;
                case 'triage':
                    dynamicCollected = { 
                        ...stageData.discovery.collected,
                        ...stageData.triage.collected 
                    };
                    dynamicNeed = stageData.triage.need;
                    break;
                case 'booking':
                case 'confirmation':
                    dynamicCollected = {
                        ...stageData.discovery.collected,
                        ...stageData.booking.collected
                    };
                    dynamicNeed = stageData.booking.need;
                    break;
                default:
                    dynamicCollected = allSlots;
                    dynamicNeed = bookingSlotIds.filter(s => !allSlots[s]);
            }
            
            const accessSnapshot = buildAccessSnapshot(session.booking?.meta?.address || {});
            const accessSummary =
                accessSnapshot.access?.gatedCommunity === true
                    ? `gated (${(accessSnapshot.access.gateAccessType || []).join('+') || 'unknown'})`
                    : accessSnapshot.access?.gatedCommunity === false
                        ? 'open_access'
                        : 'unknown';

            const promptGuardState = session.memory?.promptGuards || {};
            // promptPacks snapshot REMOVED Jan 2026 - nuked (static packs = maintenance overhead)
            response.debug = {
                engineVersion: ENGINE_VERSION,
                channel,
                latencyMs,
                aiLatencyMs,
                tokensUsed: aiResult.tokensUsed || 0,
                responseSource,
                confidence: aiResult.confidence,
                
                // ════════════════════════════════════════════════════════════════
                // V22 MODE INFO - Critical for debugging discovery/booking flow
                // ════════════════════════════════════════════════════════════════
                v22: {
                    mode: session.mode || 'DISCOVERY',
                    consentGiven: session.booking?.consentGiven || false,
                    consentPhrase: session.booking?.consentPhrase || null,
                    scenariosRetrieved: session.conversationMemory?.scenariosConsulted || [],
                    scenarioCount: session.conversationMemory?.scenariosConsulted?.length || 0,
                    discoveryIssue: session.discovery?.issue || null,
                    killSwitches: aiResult.debug?.killSwitches || null
                },
                
                // 🎯 DYNAMIC STAGE DATA - What UI should display
                stageInfo: {
                    currentStage,
                    currentStep: stageData.currentStep,
                    collected: dynamicCollected,
                    need: dynamicNeed,
                    // Full stage breakdown for detailed view
                    stages: {
                        discovery: stageData.discovery,
                        triage: stageData.triage,
                        booking: stageData.booking
                    }
                },
                
                customerContext: {
                    isKnown: customerContext.isKnown,
                    isReturning: customerContext.isReturning,
                    name: customerContext.name
                },
                runningSummary: summaryBullets,
                turnNumber: session.metrics?.totalTurns || 0,
                historySent: conversationHistory.length,
                // 🔍 SLOT DIAGNOSTICS - Shows exactly what happened with slots
                slotDiagnostics: {
                    sessionId: session._id.toString(),
                    wasSessionReused: (session.metrics?.totalTurns || 0) > 0,
                    slotsBeforeThisTurn: session.collectedSlots || {},
                    extractedThisTurn: extractedThisTurn,
                    slotsAfterMerge: allSlots,
                    whatLLMSaw: currentSlots,
                    nameTrace: session.booking?.meta?.name?.nameTrace || null
                },
                bookingConfig: {
                    source: bookingConfig.source,
                    isConfigured: bookingConfig.isConfigured,
                    slots: bookingConfig.slots.map(s => ({
                        id: s.slotId,
                        type: s.type,
                        question: s.question,
                        required: s.required,
                        confirmBack: s.confirmBack || false,
                        confirmPrompt: s.confirmPrompt || null
                    }))
                },
                // 🤖 STATE MACHINE DEBUG - What the state machine decided
                // V81 FIX: Add null safety for aiResult
                stateMachine: aiResult?.fromStateMachine ? {
                    action: aiResult?.debug?.action,
                    state: aiResult?.debug?.stateMachineState,
                    response: aiResult?.debug?.response
                } : null,
                // 🧠 LLM BRAIN DEBUG - What the LLM decided (if used)
                llmBrain: !aiResult?.fromStateMachine ? (aiResult?.debug || null) : null,
                debugLog,
                // ════════════════════════════════════════════════════════════════
                // V22 BLACK BOX - AUTHORITATIVE MODE TRACKING (UI reads this)
                // ════════════════════════════════════════════════════════════════
                v22BlackBox: aiResult.v22BlackBox || {
                    mode: session.mode || 'DISCOVERY',
                    consentGiven: session.booking?.consentGiven || false,
                    consentPhrase: session.booking?.consentPhrase || null,
                    bookingStarted: session.mode === 'BOOKING',
                    responseSource: aiResult?.debug?.source || (aiResult?.fromStateMachine ? 'STATE_MACHINE' : 'LLM'),
                    propertyType: accessSnapshot.property.type || null,
                    unit: accessSnapshot.property.unit || null,
                    accessSummary,
                    promptGuards: {
                        missingPromptFallbackKey: company.aiAgentSettings?.frontDeskBehavior?.promptGuards?.missingPromptFallbackKey || null,
                        missingPromptKeys: Array.isArray(promptGuardState.missingPrompts)
                            ? promptGuardState.missingPrompts.map(p => p?.key).filter(Boolean)
                            : [],
                        lastMissingPromptKey: promptGuardState.lastMissingPromptKey || null
                    }
                    // promptPacks REMOVED Jan 2026
                },
                // ☢️ NUKED Feb 2026: dynamicFlow trace removed - V110 architecture replaces Dynamic Flows
                dynamicFlow: null
            };

            // ════════════════════════════════════════════════════════════════
            // 🧾 DEBUG SNAPSHOT (stable keys for shell + Wiring Tab)
            // ════════════════════════════════════════════════════════════════
            // Purpose: provide a compact, stable “truth bundle” without requiring
            // consumers to reverse-engineer nested debug structures.
            // PRIORITY A: debugSnapshot MUST exist, built from final mutated truth (no recompute).
            const v22 = aiResult?.v22BlackBox || null;
            const responseSourceTruth = v22?.responseSource || aiResult?.debug?.source || (aiResult?.fromStateMachine ? 'STATE_MACHINE' : 'LLM');
            const turnNumberTruth = v22?.turn ?? ((session.metrics?.totalTurns || 0) + 1);
            const sourceTruth = sourceFromChannel(channel);

            // Booking slot IDs (in order) from already-computed bookingConfig (no recompute)
            const slotIdsTruth = Array.isArray(bookingConfig?.slots)
                ? bookingConfig.slots.map(s => s?.slotId || s?.id || s?.type).filter(Boolean)
                : [];

            // Expanded scenario tools (already retrieved, no re-fetch)
            const scenarioToolsExpanded = Array.isArray(scenarioRetrieval?.scenarios)
                ? scenarioRetrieval.scenarios.map(s => ({
                    scenarioId: s.scenarioId || null,
                    title: s.title || null,
                    confidence: (typeof s.confidence === 'number') ? s.confidence : null,
                    templateId: s.templateId || null,
                    scenarioType: s.scenarioType || null
                }))
                : [];
            const scenarioToolCount = scenarioToolsExpanded.length;
            const scenarioPoolCount = Number.isFinite(scenarioRetrieval?.totalAvailable)
                ? scenarioRetrieval.totalAvailable
                : null;

            // V51: Get templateReferences from company for wiring diagnostic
            const templateRefs = company?.aiAgentSettings?.templateReferences || [];
            const enabledTemplateRefs = templateRefs.filter(ref => ref.enabled !== false);
            
            const promptGuardsSnapshot = {
                missingPromptFallbackKey: company.aiAgentSettings?.frontDeskBehavior?.promptGuards?.missingPromptFallbackKey || null,
                missingPromptKeys: Array.isArray(promptGuardState.missingPrompts)
                    ? promptGuardState.missingPrompts.map(p => p?.key).filter(Boolean)
                    : [],
                lastMissingPromptKey: promptGuardState.lastMissingPromptKey || null,
                lastMissingPromptContext: promptGuardState.lastMissingPromptContext || null
            };

            response.debugSnapshot = safeBuildDebugSnapshotV1({
                session,
                sessionId: session._id.toString(),
                companyId,
                channel,
                turnNumber: turnNumberTruth,
                // IMPORTANT: "reused" must reflect start-of-turn truth, not end-of-turn metrics.
                // If we compute this from session.metrics.totalTurns at the end of the turn, it
                // will flip to true for every session after the first save (lies to the UI).
                isSessionReused: sessionWasReused,
                phase: session.phase || newPhase,
                mode: session.mode || null,
                locks: session.locks || null,
                memory: session.memory || null,
                effectiveConfigVersion: scenarioRetrieval?.effectiveConfigVersion || null,
                lastAgentIntent: session.lastAgentIntent || null,
                responseSource: responseSourceTruth,
                bookingRequiresConsent: killSwitches?.bookingRequiresConsent ?? null,
                consentGiven: session.booking?.consentGiven ?? null,
                consentPhrase: session.booking?.consentPhrase ?? null,
                bookingSnapTriggered: responseSourceTruth === 'BOOKING_SNAP',
                activeSlotId: session.booking?.currentSlotId ?? session.booking?.activeSlot ?? null,
                slotIds: slotIdsTruth,
                currentSlots: session.collectedSlots || {},
                extractedThisTurn: extractedThisTurn || {},
                nameTrace: session.booking?.meta?.name?.nameTrace || null,
                confirmBackTrace,
                property: buildAccessSnapshot(session.booking?.meta?.address || {}).property,
                access: buildAccessSnapshot(session.booking?.meta?.address || {}).access,
                // ☢️ NUKED Feb 2026: flow trace removed - V110 architecture replaces Dynamic Flows
                flow: { triggersFired: 0, flowsActivated: 0, actionsExecuted: 0, stateChanges: {} },
                scenarios: {
                    toolCount: scenarioToolCount,
                    tools: scenarioToolsExpanded
                },
                blackBox: { callId: session._id.toString(), source: sourceTruth },
                // V51: Include templateReferences for wiring diagnostic
                templateReferences: enabledTemplateRefs,
                scenarioCount: Number.isFinite(scenarioPoolCount) ? scenarioPoolCount : scenarioToolCount,
                scenarioPoolCount,
                scenarioToolCount,
                killSwitches,
                // V68: Include spelling variant debug data
                spellingVariantDebug: spellingVariantDebugData,
                promptGuards: promptGuardsSnapshot
                // promptPacks REMOVED Jan 2026
            });
        }
        
        log('✅ processTurn complete', { responseLength: aiResponse.length, latencyMs });
        
        // ═══════════════════════════════════════════════════════════════════
        // 🆕 PHASE 2: BLACK BOX LOGGING FOR ALL CHANNELS
        // ═══════════════════════════════════════════════════════════════════
        // Log to Black Box for test console, SMS, and web (voice has its own path)
        // This ensures ALL conversations are recorded for debugging
        // ═══════════════════════════════════════════════════════════════════
        if (channel === 'test' || channel === 'website' || channel === 'sms') {
            try {
                const BlackBoxLogger = require('./BlackBoxLogger');
                
                // Determine source type
                const sourceType = channel === 'test' ? 'test' : channel === 'sms' ? 'sms' : 'web';

                // Always ensure the recording exists before writing any events/transcript.
                // "First turn" heuristics are unreliable because a single turn can add multiple transcript entries.
                await BlackBoxLogger.ensureCall({
                    callId: session._id.toString(),
                    companyId,
                    from: callerPhone || visitorInfo?.ip || 'test-console',
                    to: company.companyName || 'AI Agent',
                    source: sourceType,
                    sessionSnapshot: {
                        phase: session.phase,
                        mode: session.mode,
                        locks: session.locks,
                        memory: session.memory
                    }
                });
                
                // Log transcript entries (caller + agent)
                await BlackBoxLogger.addTranscript({
                    callId: session._id.toString(),
                    companyId,
                    speaker: 'caller',
                    turn: session.metrics?.totalTurns || 1,
                    text: userText,
                    confidence: 1.0,
                    source: sourceType
                });
                
                await BlackBoxLogger.addTranscript({
                    callId: session._id.toString(),
                    companyId,
                    speaker: 'agent',
                    turn: session.metrics?.totalTurns || 1,
                    text: aiResponse,
                    source: aiResult?.debug?.source || (aiResult?.fromStateMachine ? 'STATE_MACHINE' : 'LLM')
                });

                // ☢️ NUKED Feb 2026: dynamicFlowTrace logging removed - V110 architecture replaces Dynamic Flows
                
                // Update session snapshot
                await BlackBoxLogger.updateSessionSnapshot(session._id.toString(), companyId, session);
                
                log('📼 PHASE 2: Black Box turn logged', { 
                    source: sourceType, 
                    turn: session.metrics?.totalTurns,
                    mode: session.mode 
                });
                
            } catch (bbErr) {
                // Non-blocking: Don't let Black Box failures kill the conversation
                log('⚠️ Black Box logging failed (non-fatal)', { error: bbErr.message });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V76: SAVE CUSTOMER LEARNINGS (Non-blocking)
        // ═══════════════════════════════════════════════════════════════════════════
        // After each turn, save any new insights back to the customer record.
        // This builds the customer's profile over time for future calls.
        // ═══════════════════════════════════════════════════════════════════════════
        if (session.customerId && extractedThisTurn) {
            try {
                const learnings = {
                    sessionId: session._id
                };
                
                // Save name if extracted this turn
                if (extractedThisTurn.name) {
                    const nameParts = extractedThisTurn.name.split(' ');
                    learnings.name = {
                        full: extractedThisTurn.name,
                        first: nameParts[0] || null,
                        last: nameParts.slice(1).join(' ') || null
                    };
                }
                
                // Save address if extracted this turn
                if (extractedThisTurn.address) {
                    const addrParts = parseCityStatePhrase(extractedThisTurn.address);
                    learnings.address = {
                        street: addrParts?.street || extractedThisTurn.address,
                        city: addrParts?.city || null,
                        state: addrParts?.state || null,
                        zip: addrParts?.zip || null,
                        notes: extractedThisTurn.unit ? `Unit: ${extractedThisTurn.unit}` : null
                    };
                }
                
                // Save notes from discovery
                const notes = [];
                if (session.discovery?.issue) {
                    notes.push(`Issue: ${session.discovery.issue}`);
                }
                if (session.discovery?.symptoms?.length > 0) {
                    notes.push(`Symptoms: ${session.discovery.symptoms.join(', ')}`);
                }
                // Detect preferred technician mention
                const techMatch = userText.match(/(?:want|prefer|like|ask for|request)\s+(?:the same\s+)?(?:technician|tech|guy|person)?\s*(?:named?\s+)?(\w+)/i);
                if (techMatch) {
                    learnings.preferredTechnician = techMatch[1];
                }
                // Detect time preference
                const timeMatch = userText.match(/(?:prefer|need|want|only)\s+(?:in the\s+)?(morning|afternoon|evening|early|late)/i);
                if (timeMatch) {
                    learnings.preferredTime = timeMatch[1];
                }
                
                if (notes.length > 0) {
                    learnings.notes = notes;
                }
                
                // Only save if we have something new
                if (Object.keys(learnings).length > 1) { // More than just sessionId
                    CustomerContextLoader.saveCallLearnings(
                        company._id,
                        session.customerId,
                        learnings
                    ).catch(learnErr => {
                        log('⚠️ Failed to save customer learnings (non-fatal)', { error: learnErr.message });
                    });
                }
            } catch (learnErr) {
                // Non-blocking
                log('⚠️ Customer learning extraction failed (non-fatal)', { error: learnErr.message });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // EMIT AW SUMMARIES (V93 - instant debugging)
        // ═══════════════════════════════════════════════════════════════════
        // At end of turn, emit:
        // - AW_TURN_SUMMARY: per-turn summary (quick view)
        // - AW_CALL_SUMMARY: cumulative call summary (the money shot)
        //   Includes unread-but-wired and read-but-unwired for "why didn't it trigger?"
        if (awReader) {
            if (typeof awReader.emitSummary === 'function') {
                awReader.emitSummary().catch(err => {
                    log('⚠️ AW_TURN_SUMMARY emission failed (non-fatal)', { error: err.message });
                });
            }
            if (typeof awReader.emitCallSummary === 'function') {
                awReader.emitCallSummary().catch(err => {
                    log('⚠️ AW_CALL_SUMMARY emission failed (non-fatal)', { error: err.message });
                });
            }
        }
        
        return response;
        
    } catch (error) {
        // ═══════════════════════════════════════════════════════════════════
        // CRITICAL ERROR LOGGING - This is our main diagnostic point
        // ═══════════════════════════════════════════════════════════════════
        // V116: Enhanced error capture with scenario context
        // When SYSTEM_ERROR_FALLBACK fires, we need to know:
        //   1. What scenario was being rendered (if any)
        //   2. What phase the engine was in (via lastCheckpoint)
        //   3. The actual stack trace for debugging
        // ═══════════════════════════════════════════════════════════════════
        
        // Try to extract scenario context from the error if available
        // (tier1Match is in scope from the try block)
        let scenarioContext = null;
        try {
            if (typeof tier1Match !== 'undefined' && tier1Match) {
                scenarioContext = {
                    scenarioId: tier1Match.scenarioId,
                    scenarioName: tier1Match.name,
                    categoryName: tier1Match.categoryName,
                    scenarioType: tier1Match.scenarioType,
                    hasQuickReplies: Array.isArray(tier1Match.quickReplies) && tier1Match.quickReplies.length > 0,
                    hasFullReplies: Array.isArray(tier1Match.fullReplies) && tier1Match.fullReplies.length > 0
                };
            }
        } catch (contextErr) {
            // Scenario context extraction failed - continue without it
        }
        
        const errorDetails = {
            error: error.message,
            errorType: error.name,
            stack: error.stack?.split('\n').slice(0, 8).join('\n'), // First 8 lines of stack (more context)
            companyId,
            channel,
            userTextPreview: userText?.substring(0, 50),
            latencyMs: Date.now() - startTime,
            lastCheckpoint: debugLog[debugLog.length - 1]?.msg || 'unknown',
            // V116: Scenario render error context
            scenario: scenarioContext,
            turnNumber: session?.metrics?.totalTurns || null,
            sessionMode: session?.mode || null
        };
        
        // V116: SCENARIO_RENDER_ERROR - explicit event for scenario rendering failures
        logger.error('[CONVERSATION ENGINE] ❌ SCENARIO_RENDER_ERROR in processTurn', errorDetails);
        
        // Also log to console for immediate visibility
        console.error('[CONVERSATION ENGINE] ❌ SCENARIO_RENDER_ERROR:', error.message);
        console.error('[CONVERSATION ENGINE] Stack:', error.stack?.split('\n').slice(0, 8).join('\n'));
        console.error('[CONVERSATION ENGINE] Last checkpoint:', errorDetails.lastCheckpoint);
        if (scenarioContext) {
            console.error('[CONVERSATION ENGINE] Scenario context:', JSON.stringify(scenarioContext, null, 2));
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // V116: SMART ERROR FALLBACK - Don't say "repeat that" if we know the intent
        // ═══════════════════════════════════════════════════════════════════
        // POLICY CHANGE:
        //   OLD: Any exception → "Could you repeat that?" (horrible UX)
        //   NEW: If scenario match exists but render threw → give empathetic fallback
        //        Only use "repeat that" if STT was empty/garbled
        //
        // This prevents dead-air / repeat-loop even when something breaks.
        // ═══════════════════════════════════════════════════════════════════
        let fallbackReply;
        let fallbackMatchSource;
        
        const userTextIsEmpty = !userText || userText.trim().length < 3;
        const hadScenarioMatch = scenarioContext && scenarioContext.scenarioId;
        
        if (userTextIsEmpty) {
            // STT was empty/garbled — asking to repeat is appropriate
            fallbackReply = "I'm sorry, I didn't catch that. Could you repeat that?";
            fallbackMatchSource = 'SYSTEM_ERROR_FALLBACK_EMPTY_STT';
        } else if (hadScenarioMatch) {
            // We had a scenario match but render failed — give empathetic fallback with funnel
            // This is WAY better than "repeat that" when caller clearly described an issue
            fallbackReply = "I understand you're having an issue. Let me help you with that — would you like me to schedule a service appointment?";
            fallbackMatchSource = 'SYSTEM_ERROR_FALLBACK_WITH_FUNNEL';
            logger.warn('[CONVERSATION ENGINE] ⚠️ Scenario render failed but recovered with funnel fallback', {
                scenarioId: scenarioContext.scenarioId,
                scenarioName: scenarioContext.scenarioName,
                error: error.message
            });
        } else {
            // Unknown error state — generic but still helpful
            fallbackReply = "I'm here to help. Could you tell me a bit more about what's going on?";
            fallbackMatchSource = 'SYSTEM_ERROR_FALLBACK_GENERIC';
        }
        
        const errResp = {
            success: false,
            error: error.message,
            errorType: error.name,
            reply: fallbackReply,
            sessionId: providedSessionId,
            phase: 'error',
            mode: 'ERROR',
            slotsCollected: {},
            wantsBooking: false,
            conversationMode: 'free',
            latencyMs: Date.now() - startTime,
            // V116: More specific matchSource based on fallback type
            matchSource: fallbackMatchSource,
            tier: 'error',
            tokensUsed: 0,
            llmUsed: false,
            debug: {
                debugLog,
                error: error.message,
                errorType: error.name,
                lastCheckpoint: errorDetails.lastCheckpoint,
                stackPreview: error.stack?.split('\n').slice(0, 5).join(' | '),
                // V116: Scenario context for debugging SCENARIO_RENDER_ERROR
                scenario: scenarioContext,
                turnNumber: errorDetails.turnNumber,
                sessionMode: errorDetails.sessionMode
            }
        };
        if (includeDebug) {
            errResp.debugSnapshot = safeBuildDebugSnapshotV1({
                sessionId: errResp.sessionId,
                companyId,
                channel,
                turnNumber: null,
                isSessionReused: null,
                phase: errResp.phase,
                mode: errResp.mode,
                effectiveConfigVersion: null,
                lastAgentIntent: null,
                responseSource: 'ERROR',
                bookingRequiresConsent: null,
                consentGiven: null,
                consentPhrase: null,
                bookingSnapTriggered: false,
                activeSlotId: null,
                slotIds: [],
                currentSlots: {},
                extractedThisTurn: {},
                flow: { triggersFired: 0, flowsActivated: 0, actionsExecuted: 0, stateChanges: {} },
                scenarios: { toolCount: 0, tools: [] },
                blackBox: { callId: errResp.sessionId, source: sourceFromChannel(channel) }
            });
        }
        return errResp;
    }
}

/**
 * Get session by ID (for reconnecting or debugging)
 */
async function getSession(sessionId) {
    return SessionService.findById(sessionId);
}

/**
 * End a session with outcome
 */
async function endSession(sessionId, outcome = 'no_action') {
    const session = await SessionService.findById(sessionId);
    if (!session) {
        throw new Error('Session not found');
    }
    return SessionService.end(session, outcome);
}

module.exports = {
    processTurn,
    getSession,
    endSession,
    
    // Export version for debugging
    ENGINE_VERSION,
    
    // Export slot extractors for testing
    SlotExtractors,

    // Test-only helper: deterministic name slot handling
    __testHandleNameSlotTurn,
    __testHandleConfirmSlotTurn
};


