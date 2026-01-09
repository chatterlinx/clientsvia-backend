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
const SessionService = require('./SessionService');
const RunningSummaryService = require('./RunningSummaryService');
const HybridReceptionistLLM = require('./HybridReceptionistLLM');
const BookingScriptEngine = require('./BookingScriptEngine');
const BookingStateMachine = require('./BookingStateMachine');
const ResponseRenderer = require('./ResponseRenderer');
const ConversationStateMachine = require('./ConversationStateMachine');
const LLMDiscoveryEngine = require('./LLMDiscoveryEngine');
const AddressValidationService = require('./AddressValidationService');
const DynamicFlowEngine = require('./DynamicFlowEngine');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// VERSION BANNER - Proves this code is deployed
// CHECK THIS IN DEBUG TO VERIFY DEPLOYMENT
// ═══════════════════════════════════════════════════════════════════════════
const ENGINE_VERSION = 'V41-DYNAMIC-FLOW-ENGINE';  // <-- CHANGE THIS EACH DEPLOY
logger.info(`[CONVERSATION ENGINE] 🧠 LOADED VERSION: ${ENGINE_VERSION}`, {
    features: [
        '✅ V22: LLM-LED DISCOVERY ARCHITECTURE',
        '✅ LLM is PRIMARY BRAIN (not fallback)',
        '✅ Scenarios are TOOLS (not scripts)',
        '✅ Booking is DETERMINISTIC (consent-gated)',
        '✅ No triage gates, no pre-routing',
        '✅ V35: Google Maps address validation (toggle per company)',
        '✅ V35: World-class unit/apt detection (smart/always/never modes)',
        '✅ session.mode = DISCOVERY | SUPPORT | BOOKING | COMPLETE',
        '✅ Consent detection via UI-configured phrases',
        '✅ Latency target: < 1.2s per turn',
        '✅ V23: CHEAT SHEETS integrated as fallback knowledge',
        '✅ V23: Booking interrupts use cheat sheets then resume slot',
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
//   company.aiAgentSettings.frontDeskBehavior.bookingSlots[].question
//   company.aiAgentSettings.frontDeskBehavior.bookingSlots[].confirmPrompt
//   company.aiAgentSettings.frontDeskBehavior.bookingSlots[].repromptVariants
//
// These are ONLY used for discovery mode (before booking starts)
// ═══════════════════════════════════════════════════════════════════════════
const DEFAULT_PROMPT_VARIANTS = {
    // Empathy variants for discovery (NOT booking prompts)
    empathy: [
        "I understand how frustrating that can be.",
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
        'slot_question': `What is your ${fieldName || 'information'}?`,
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
        'confirmPrompt': "Just to confirm, {value}. Is that right?"
    };
    
    return safeDefaults[configType] || safeDefaults[fieldName] || `[CONFIG MISSING: ${configType}]`;
}

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
// 🆕 CHEAT SHEET SEARCH - Find relevant content from cheat sheets
// ═══════════════════════════════════════════════════════════════════════════
// Used for:
// - DISCOVERY: Fallback after 3-tier scenarios
// - BOOKING: Interrupt question answers ONLY
// ═══════════════════════════════════════════════════════════════════════════
function searchCheatSheets(cheatSheetConfig, query) {
    if (!cheatSheetConfig || !query) return null;
    
    const queryLower = query.toLowerCase().trim();
    const queryWords = queryLower.split(/\s+/).filter(w => w.length > 2);
    
    let bestMatch = null;
    let bestScore = 0;
    
    // Search through all categories in cheat sheet config
    // Expected structure: { category: { items: [{ question, answer }] } }
    // or: { categories: [{ name, items: [...] }] }
    const categories = cheatSheetConfig.categories || 
                       Object.entries(cheatSheetConfig).map(([name, data]) => ({ name, ...data }));
    
    for (const category of categories) {
        const items = category.items || category.scenarios || category.entries || [];
        
        for (const item of items) {
            // Match against question/trigger text
            const searchText = (item.question || item.trigger || item.title || '').toLowerCase();
            const answerText = item.answer || item.response || item.content || '';
            
            // Simple keyword matching score
            let score = 0;
            for (const word of queryWords) {
                if (searchText.includes(word)) score += 2;
                if (answerText.toLowerCase().includes(word)) score += 1;
            }
            
            // Boost for exact phrase match
            if (searchText.includes(queryLower)) score += 5;
            
            if (score > bestScore && score >= 3) {  // Minimum threshold
                bestScore = score;
                bestMatch = {
                    category: category.name || category.category,
                    question: item.question || item.trigger || item.title,
                    answer: answerText,
                    score: score,
                    title: item.title || item.question
                };
            }
        }
    }
    
    return bestMatch;
}

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
        'need', 'want', 'get', 'got',
        'know', 'think', 'say', 'tell', 'ask', 'call',
        
        // Confirmations (critical for consent detection)
        'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay', 'alright', 'absolutely',
        'no', 'nope', 'nah',
        
        // Question words
        'what', 'when', 'where', 'why', 'how', 'which', 'who',
        
        // Numbers (critical for phone/address)
        'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'zero'
    ]);
    
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
function findSpellingVariant(name, config, commonFirstNames = []) {
    if (!name || !config?.enabled) return null;
    
    const nameLower = name.toLowerCase();
    const mode = config.mode || '1_char_only';
    const source = config.source || 'curated_list';
    
    // Get variant groups - RUNTIME ONLY READS, NEVER COMPUTES
    let variantGroups = {};
    
    if (source === 'curated_list') {
        // Use manually curated variant groups from config
        const rawGroups = config.variantGroups || {};
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
    
    // Check if the name has variants - O(1) lookup
    const variants = variantGroups[nameLower];
    if (!variants || variants.length === 0) return null;
    
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
                unit: slots.address?.unit || null
            },
            time: {
                preference: timePreference || null,
                window: slots.time?.window || null,
                isAsap: isAsap
            },
            custom: {}
        };
        
        // Add any custom slots
        const standardSlots = ['name', 'phone', 'address', 'time', 'partialName'];
        for (const [key, value] of Object.entries(slots)) {
            if (!standardSlots.includes(key) && value) {
                bookingSlots.custom.set ? bookingSlots.custom.set(key, value) : (bookingSlots.custom[key] = value);
            }
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
        const bookingRequest = new BookingRequest({
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
// ═══════════════════════════════════════════════════════════════════════════
const ConsentDetector = {
    /**
     * Check if user input contains explicit booking consent
     * @param {string} text - User input
     * @param {Object} company - Company config with detectionTriggers
     * @param {Object} session - Session with consent state
     * @returns {Object} { hasConsent, matchedPhrase, reason }
     */
    checkForConsent(text, company, session) {
        if (!text || typeof text !== 'string') {
            return { hasConsent: false, matchedPhrase: null, reason: 'no_input' };
        }
        
        const textLower = text.toLowerCase().trim();
        const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};
        const discoveryConsent = frontDesk.discoveryConsent || {};
        const detectionTriggers = frontDesk.detectionTriggers || {};
        
        // Check if consent is required (default: true for Option 1)
        const requiresExplicitConsent = discoveryConsent.bookingRequiresExplicitConsent !== false;
        
        if (!requiresExplicitConsent) {
            // Legacy mode: consent not required (not recommended)
            return { hasConsent: true, matchedPhrase: 'legacy_mode', reason: 'consent_not_required' };
        }
        
        // Get UI-configured consent phrases
        const consentPhrases = detectionTriggers.wantsBooking || [];
        // Extended yes words - includes "absolutely", "definitely", "sounds good", etc.
        const consentYesWords = discoveryConsent.consentYesWords || [
            'yes', 'yeah', 'yep', 'please', 'sure', 'okay', 'ok', 'alright',
            'absolutely', 'definitely', 'certainly', 'of course', 'sounds good',
            'that would be great', 'let\'s do it', 'go ahead', 'perfect'
        ];
        const requiresYesAfterPrompt = discoveryConsent.consentRequiresYesAfterPrompt !== false;
        
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
        
        // Check if last AI response asked about scheduling
        const lastTurns = session?.turns || [];
        const lastAssistantTurn = [...lastTurns].reverse().find(t => t.role === 'assistant');
        const lastAssistantText = (lastAssistantTurn?.content || '').toLowerCase();
        const askedAboutScheduling = lastAssistantText.includes('schedule') || 
                                     lastAssistantText.includes('appointment') ||
                                     lastAssistantText.includes('technician') ||
                                     lastAssistantText.includes('come out') ||
                                     session.conversationMemory?.askedConsentQuestion;
        
        if (askedAboutScheduling) {
            // Check for yes words anywhere in the response
            for (const yesWord of consentYesWords) {
                // More flexible matching: "yes", "yes please", "yes can you", etc.
                if (textLower.includes(yesWord)) {
                    // Make sure it's not a negative context like "yes but no" or "not yes"
                    const negatives = ['no', 'not', "don't", "can't", 'never'];
                    const hasNegative = negatives.some(neg => textLower.includes(neg));
                    
                    if (!hasNegative) {
                        return { 
                            hasConsent: true, 
                            matchedPhrase: yesWord, 
                            reason: 'yes_after_scheduling_offer' 
                        };
                    }
                }
            }
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
        if (!text || typeof text !== 'string') return null;
        
        const raw = text.trim();
        const lower = raw.toLowerCase();
        
        // ═══════════════════════════════════════════════════════════════════
        // V32: STOP WORDS - Words that are NEVER part of a name
        // V36: Platform defaults + company custom stop words (from UI)
        // These block extraction entirely if the candidate is just stop words
        // ═══════════════════════════════════════════════════════════════════
        const PLATFORM_STOP_WORDS = [
            // Greetings & fillers
            'hi', 'hello', 'hey', 'good', 'morning', 'afternoon', 'evening', 'night',
            'uh', 'um', 'erm', 'hmm', 'ah', 'oh', 'well', 'so', 'like', 'just',
            // Confirmations - CRITICAL: "go ahead", "yes", "sure" are NOT names!
            'yeah', 'yes', 'sure', 'okay', 'ok', 'alright', 'right', 'yep', 'yup',
            'go', 'ahead', 'absolutely', 'definitely', 'certainly', 'perfect', 'sounds',
            // Common words & auxiliary verbs
            'the', 'that', 'this', 'what', 'please', 'thanks', 'thank', 'you',
            'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am', 'has', 'have', 'had',
            'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can', 'may', 'might',
            'it', 'its', 'my', 'your', 'our', 'their', 'his', 'her', 'a', 'an', 'and', 'or', 'but',
            // V36 FIX: Add "to" and "see" - "I am trying to see if..." should NOT extract "to see" as name
            'to', 'see', 'if', 'we', 'get', 'somebody', 'someone', 'here', 'there', 'today', 'now',
            // Common verbs
            'having', 'doing', 'calling', 'looking', 'trying', 'getting', 'going', 'coming',
            'waiting', 'hoping', 'thinking', 'wondering', 'needing', 'wanting', 'asking',
            'dealing', 'experiencing', 'seeing', 'feeling', 'hearing', 'running', 'working',
            // Problem-related words
            'failing', 'broken', 'leaking', 'stopped', 'making', 'noise', 'noisy', 'loud',
            'not', 'wont', 'doesnt', 'isnt', 'cant', 'problem', 'problems', 'issue', 'issues',
            'trouble', 'troubles', 'wrong', 'weird', 'strange', 'acting', 'up', 'down', 'out',
            // Adjectives/states
            'great', 'fine', 'bad', 'hot', 'cold', 'here', 'there', 'back', 'home',
            'interested', 'concerned', 'worried', 'happy', 'sorry', 'glad',
            // SERVICE/TRADE WORDS - V36 FIX: Added "conditioner", "heater", "cooler"
            'service', 'services', 'repair', 'repairs', 'maintenance', 'install', 'installation',
            'conditioning', 'conditioner', 'air', 'ac', 'hvac', 'heating', 'heater', 'cooling', 'cooler',
            'plumbing', 'plumber', 'electrical', 'electrician', 'unit', 'system', 'systems', 
            'equipment', 'furnace', 'thermostat', 'duct', 'ducts', 'filter', 'filters', 'vent', 'vents',
            'appointment', 'schedule', 'scheduling', 'book', 'booking', 'call', 'help',
            'need', 'needs', 'want', 'wants', 'get', 'fix', 'check', 'look', 'today', 'tomorrow',
            // V36 FIX: Common verbs that appear in "I'm looking for..."
            'looking', 'for', 'about', 'regarding', 'concerning',
            // TIME/URGENCY words
            'soon', 'possible', 'asap', 'now', 'immediately', 'urgent', 'urgently',
            'available', 'earliest', 'soonest', 'first', 'next', 'whenever',
            'somebody', 'someone', 'anybody', 'anyone', 'technician', 'tech',
            // V37 FIX: Time-related words that appear in "last week", "out here", etc.
            'last', 'week', 'month', 'year', 'ago', 'before', 'recently', 'just',
            'guys', 'were', 'out', 'still', 'again', 'already', 'yet',
            // Question words
            'any', 'some', 'with'
        ];
        
        // V36: Merge platform defaults with company custom stop words (from UI)
        const STOP_WORDS = new Set([
            ...PLATFORM_STOP_WORDS,
            ...(customStopWords || []).map(w => w.toLowerCase().trim())
        ]);
        
        // ═══════════════════════════════════════════════════════════════════
        // V32: NAME INTENT DETECTION
        // Only extract if explicit name phrase OR we're expecting a name
        // This prevents "go ahead" from becoming a name in discovery
        // V36 FIX: "I'm looking for..." should NOT trigger name extraction
        // Must be followed by a capitalized word (likely a name)
        // ═══════════════════════════════════════════════════════════════════
        // Strict patterns that indicate actual name introduction:
        const strictNamePatterns = [
            /\bmy name is\b/i,
            /\bname is\b/i,
            /\bthis is\s+[A-Z]/,  // "this is Mark" (capitalized)
            /\bi am\s+[A-Z]/,     // "I am Mark" (capitalized)
            /\bi'?m\s+[A-Z][a-z]+(?:\s|$|,)/,  // "I'm Mark" followed by space/end/comma, NOT "I'm looking"
            /\bit'?s\s+[A-Z]/,    // "it's Mark" (capitalized)
            /\bcall me\b/i
        ];
        const hasNameIntent = strictNamePatterns.some(p => p.test(raw));
        
        // Gate: Only extract if expecting name OR explicit name intent
        if (!expectingName && !hasNameIntent) {
            return null;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // V32: PATTERN MATCHING WITH CLAUSE BOUNDARY CUTOFF
        // Extract candidate, then cut at clause boundaries (and, but, do, etc.)
        // ═══════════════════════════════════════════════════════════════════
        const patterns = [
            /\bmy name is\s+(.+)$/i,
            /\bname is\s+(.+)$/i,
            /\bthis is\s+(.+)$/i,
            /\bi am\s+(.+)$/i,
            /\bi'?m\s+(.+)$/i,
            /\bit'?s\s+(.+)$/i,
            /\bcall me\s+(.+)$/i
        ];
        
        let candidate = null;
        for (const re of patterns) {
            const m = raw.match(re);
            if (m && m[1]) {
                candidate = m[1];
                break;
            }
        }
        
        // If expecting name but no phrase matched, try whole utterance as candidate
        if (!candidate && expectingName) {
            candidate = raw;
        }
        
        if (!candidate) return null;
        
        // ═══════════════════════════════════════════════════════════════════
        // V37: CUT AT CLAUSE BOUNDARIES
        // "Mark do you have any issues" → "Mark"
        // "John Smith and I need help" → "John Smith"
        // "Mark you guys were out here" → "Mark" (V37: added "you")
        // ═══════════════════════════════════════════════════════════════════
        candidate = candidate.split(/(?:\band\b|\bbut\b|\bso\b|\bdo\b|\bcan\b|\bwill\b|\bhave\b|\bi\b|\byou\b|\bwe\b|\bthey\b|,|\?|\.|!)/i)[0].trim();
        
        // ═══════════════════════════════════════════════════════════════════
        // V32: TOKENIZE AND FILTER
        // Only keep tokens that look like name parts (not stop words)
        // ═══════════════════════════════════════════════════════════════════
        const cleanToken = (t) => t.replace(/[^a-zA-Z'\-]/g, '').trim();
        const looksLikeNameToken = (t) => {
            if (!t || t.length < 2) return false;
            if (STOP_WORDS.has(t.toLowerCase())) return false;
            return /^[A-Za-z][A-Za-z'\-]+$/.test(t);
        };
        
        const tokens = candidate
            .split(/\s+/)
            .map(cleanToken)
            .filter(Boolean)
            .filter(looksLikeNameToken);
        
        if (tokens.length === 0) return null;
        
        // Take first two meaningful tokens (first name + optional last name)
        const firstName = tokens[0];
        const lastName = tokens.length >= 2 ? tokens[1] : null;
        
        // Title case
        const titleCase = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
        const name = lastName 
            ? `${titleCase(firstName)} ${titleCase(lastName)}`
            : titleCase(firstName);
        
        return name;
    },
    
    /**
     * Extract phone number from user input
     * V37 FIX: More forgiving - handle typos, extra digits, 7-digit local numbers
     */
    extractPhone(text) {
        if (!text || typeof text !== 'string') return null;
        
        // Remove common words that might confuse extraction
        let cleaned = text.replace(/\b(phone|number|is|my|the|at|reach|me|call)\b/gi, ' ');
        
        // Extract all digits
        const digits = cleaned.replace(/\D/g, '');
        
        // V37: Log what we're working with
        logger.debug('[PHONE EXTRACT] V37:', { raw: text, digits, length: digits.length });
        
        // 10 digits - perfect US phone number
        if (digits.length === 10) {
            return digits.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
        }
        
        // 11 digits starting with 1 - US with country code
        if (digits.length === 11 && digits.startsWith('1')) {
            return digits.substring(1).replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
        }
        
        // V37 FIX: 11 digits NOT starting with 1 - likely typo, take last 10
        // Example: "23933333747" → probably meant "2393337747" 
        if (digits.length === 11 && !digits.startsWith('1')) {
            logger.info('[PHONE EXTRACT] V37: 11 digits without country code - taking last 10 (possible typo)');
            const last10 = digits.substring(1);
            return last10.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
        }
        
        // V37 FIX: 12+ digits - smart reconstruction
        // People usually get area code (first 3) and last 4 digits correct
        // Extra digits are typically typos in the middle (repeated keys)
        // Example: "23933333 7747" → "239333337747" (12 digits)
        //   - Area code: 239 (first 3)
        //   - Last 4: 7747 (last 4)  
        //   - Middle: 333337 (6 digits, need 3) → take last 3 = "337"
        //   - Result: 239-337-7747
        // Wait, that's still wrong. Let's just take first 3 + middle 3 + last 4
        // For 12 digits: positions 0-2 (area) + positions 3-5 (exchange) + positions 8-11 (last 4)
        if (digits.length === 12) {
            logger.info('[PHONE EXTRACT] V37: 12 digits - reconstructing', { digits });
            const areaCode = digits.substring(0, 3);      // First 3
            const exchange = digits.substring(3, 6);       // Next 3 (positions 3-5)
            const lastFour = digits.substring(8, 12);      // Last 4 (positions 8-11)
            const reconstructed = areaCode + exchange + lastFour;
            logger.info('[PHONE EXTRACT] V37: 12 digit result', { 
                areaCode, exchange, lastFour, reconstructed 
            });
            return reconstructed.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
        }
        
        // 13+ digits - too many, don't auto-correct (will trigger breakdown)
        if (digits.length >= 13) {
            logger.info('[PHONE EXTRACT] V37: 13+ digits - too many, not extracting');
            return null;
        }
        
        // V37 FIX: 7 digits - local number (missing area code)
        // Don't format, just return as-is so confirmBack can ask for area code
        if (digits.length === 7) {
            logger.info('[PHONE EXTRACT] V37: 7 digits - local number, may need area code');
            return digits.replace(/(\d{3})(\d{4})/, '$1-$2');
        }
        
        // 8-9 digits - partial, don't extract (will trigger breakdown)
        if (digits.length >= 8 && digits.length <= 9) {
            logger.info('[PHONE EXTRACT] V37: 8-9 digits - partial, not extracting');
            return null;
        }
        
        return null;
    },
    
    /**
     * Extract address from user input
     * V34 FIX: Accept FULL addresses with city/state/zip in one shot
     * "12155 Metro Parkway Fort Myers Florida 33966" → complete address
     */
    extractAddress(text) {
        if (!text || typeof text !== 'string') return null;
        
        const lower = text.toLowerCase();
        
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
        
        // Clean up common prefixes
        fullAddress = fullAddress.replace(/^(my\s+)?(address\s+is|it'?s|that'?s)\s*/i, '');
        fullAddress = fullAddress.replace(/^(the\s+)?address\s*:?\s*/i, '');
        
        // If we have a complete address (has zip OR state), return the whole thing
        if (hasZip || hasState) {
            logger.debug('[ADDRESS EXTRACTOR] V34: Complete address detected', { 
                address: fullAddress, 
                hasZip, 
                hasState 
            });
            return fullAddress;
        }
        
        // Otherwise, extract just the street portion
        const addressPattern = /\b(\d{1,5}\s+[\w\s]+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|loop|alley|aly|path|crossing|xing|square|sq|plaza|plz|commons|point|pt|ridge|run|pass|grove|park|estates|meadow|meadows|valley|hills|heights|view|vista|landing|springs|creek|glen|cove|bay|beach|shore|pointe)[\w\s,]*)/i;
        const match = text.match(addressPattern);
        
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
    forceNewSession = false  // For Test Console - always create fresh session
}) {
    const startTime = Date.now();
    const debugLog = [];

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
            flow = null,
            scenarios = null,
            blackBox = null,
            // V51: Add templateReferences for wiring diagnostic
            templateReferences = null,
            scenarioCount = null
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
                extractedThisTurn: extractedThisTurn || {}
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
            scenarioCount: typeof scenarioCount === 'number' ? scenarioCount : 0
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
        // STEP 1: Load company
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 2: Loading company...');
        const company = await Company.findById(companyId);
        
        if (!company) {
            throw new Error(`Company not found: ${companyId}`);
        }
        log('CHECKPOINT 2: ✅ Company loaded', { name: company.companyName });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1.5: Load Cheat Sheets (PHASE 1 - Runtime Integration)
        // ═══════════════════════════════════════════════════════════════════
        // Cheat sheets are loaded alongside company config for:
        // - DISCOVERY: Fallback knowledge after 3-tier scenarios
        // - BOOKING: Interrupt question answers ONLY (then resume slot)
        // ═══════════════════════════════════════════════════════════════════
        let cheatSheetConfig = null;
        try {
            const { CheatSheetRuntimeService } = require('./cheatsheet');
            const cheatSheetResult = await CheatSheetRuntimeService.getLiveConfig(companyId);
            if (cheatSheetResult && cheatSheetResult.config) {
                cheatSheetConfig = cheatSheetResult.config;
                log('CHECKPOINT 2.5: ✅ Cheat sheets loaded', { 
                    versionId: cheatSheetResult.versionId,
                    hasConfig: !!cheatSheetConfig,
                    categories: Object.keys(cheatSheetConfig || {}).length
                });
            } else {
                log('CHECKPOINT 2.5: ⚠️ No cheat sheets available (non-fatal)', { companyId });
            }
        } catch (cheatSheetErr) {
            // Non-fatal - system works without cheat sheets
            log('CHECKPOINT 2.5: ⚠️ Cheat sheet load failed (non-fatal)', { 
                error: cheatSheetErr.message 
            });
        }
        
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
        const isShortMessage = userTextLower.length < 30;
        const startsWithGreeting = /^(good\s*(morning|afternoon|evening)|hi|hello|hey|howdy|yo|sup|what'?s\s*up|greetings?|morning|afternoon|evening|gm)\b/i.test(userTextLower);
        
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
            
            log('CHECKPOINT 2.7: ✅ GREETING INTERCEPT - 0 tokens!', {
                userText,
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
        const escalationCfg = company.aiAgentSettings?.frontDeskBehavior?.escalation || {};
        const escalationEnabled = escalationCfg.enabled !== false;
        const escalationPhrases = Array.isArray(escalationCfg.triggerPhrases) ? escalationCfg.triggerPhrases : [];
        if (escalationEnabled && escalationPhrases.length > 0) {
            const matched = escalationPhrases.find(p => p && userTextLower.includes(String(p).toLowerCase()));
            if (matched) {
                const transferMsg =
                    escalationCfg.transferMessage ||
                    company.connectionMessages?.voice?.transferMessage ||
                    "DEFAULT - OVERRIDE IN UI: One moment while I transfer you to our team.";

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
        // The Dynamic Flow Engine evaluates triggers BEFORE AI processing.
        // It can:
        // - Activate flows based on triggers (phrases, keywords, slots, etc.)
        // - Execute actions (mode transitions, set flags, send responses)
        // - Apply guardrails (no re-greet, no restart booking)
        // - Log trace for debugging
        // ═══════════════════════════════════════════════════════════════════
        let dynamicFlowResult = null;
        try {
            const flowStartTime = Date.now();
            
            dynamicFlowResult = await DynamicFlowEngine.processTurn({
                companyId,
                session,
                userText,
                slots: session.collectedSlots || {},
                customer,
                company
            });
            
            const flowLatency = Date.now() - flowStartTime;
            
            log('🧠 PHASE 3: Dynamic Flow Engine processed', {
                latencyMs: flowLatency,
                triggersEvaluated: dynamicFlowResult.triggersEvaluated?.length || 0,
                triggersFired: dynamicFlowResult.triggersFired?.length || 0,
                flowsActivated: dynamicFlowResult.flowsActivated?.length || 0,
                actionsExecuted: dynamicFlowResult.actionsExecuted?.length || 0,
                stateChanges: dynamicFlowResult.stateChanges
            });
            
            // Apply state changes from flow engine
            if (dynamicFlowResult.stateChanges?.mode) {
                log('🧠 PHASE 3: Mode changed by flow engine', {
                    from: session.mode,
                    to: dynamicFlowResult.stateChanges.mode
                });
                session.mode = dynamicFlowResult.stateChanges.mode;
            }
            
            // Check for pending responses from flows (prepend to AI response)
            const flowResponses = dynamicFlowResult.actionsExecuted
                ?.filter(a => a.type === 'send_response' && a.response)
                ?.map(a => a.response) || [];
                
            if (flowResponses.length > 0) {
                log('🧠 PHASE 3: Flow generated responses', { count: flowResponses.length });
            }
            
        } catch (flowErr) {
            // Non-fatal - system works without dynamic flows
            log('⚠️ PHASE 3: Dynamic Flow Engine failed (non-fatal)', { 
                error: flowErr.message 
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 4: Build customer context for AI
        // ═══════════════════════════════════════════════════════════════════
        log('CHECKPOINT 5: Building customer context...');
        let customerContext;
        try {
            customerContext = customer 
                ? CustomerService.buildContextForAI(customer)
                : { isKnown: false, summary: `New ${channel} visitor` };
        } catch (ctxErr) {
            customerContext = { isKnown: false, summary: `New ${channel} visitor` };
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
                'having some', 'having issues', 'having problems'
            ];
            
            // Words that should NEVER be in a name
            const invalidWords = [
                'having', 'doing', 'calling', 'looking', 'trying', 'getting', 'going',
                'coming', 'waiting', 'hoping', 'thinking', 'wondering', 'needing',
                'wanting', 'asking', 'dealing', 'experiencing', 'just', 'some',
                'issues', 'problems', 'trouble', 'great', 'fine', 'good', 'bad',
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
        
        // Copy other slots as-is (address, time, etc.)
        if (rawSlots.address) currentSlots.address = rawSlots.address;
        if (rawSlots.time) currentSlots.time = rawSlots.time;
        if (rawSlots.partialName) currentSlots.partialName = rawSlots.partialName;
        
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
        
        // Get booking config for askMissingNamePart setting
        const bookingConfig = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: session?.flags || {} });
        
        // 🔍 DIAGNOSTIC: Log booking config to debug NOT_CONFIGURED issue
        const rawBookingSlots = company?.aiAgentSettings?.frontDeskBehavior?.bookingSlots || [];
        log('📋 BOOKING CONFIG DIAGNOSTIC', {
            source: bookingConfig.source,
            isConfigured: bookingConfig.isConfigured,
            slotCount: bookingConfig.slots?.length || 0,
            slotIds: bookingConfig.slots?.map(s => s.slotId) || [],
            companyHasFrontDesk: !!company?.aiAgentSettings?.frontDeskBehavior,
            companyHasBookingSlots: !!company?.aiAgentSettings?.frontDeskBehavior?.bookingSlots,
            rawBookingSlotsLength: rawBookingSlots.length,
            // 🔍 V42: Show what fields each raw slot has to debug normalization rejection
            rawSlotSample: rawBookingSlots.slice(0, 3).map(s => ({
                hasId: !!s?.id,
                idValue: s?.id,
                hasSlotId: !!s?.slotId,
                slotIdValue: s?.slotId,
                hasKey: !!s?.key,
                keyValue: s?.key,
                hasQuestion: !!s?.question,
                questionPreview: s?.question?.substring?.(0, 30),
                allKeys: s ? Object.keys(s) : []
            }))
        });
        // Find name slot by TYPE (not by slotId) - Type dropdown determines behavior
        const nameSlotConfig = bookingConfig.slots.find(s => s.type === 'name' || s.slotId === 'name' || s.id === 'name');
        const askMissingNamePart = nameSlotConfig?.askMissingNamePart === true;
        
        // Extract name
        // ═══════════════════════════════════════════════════════════════════════
        // NAME CORRECTION LOGIC: Allow explicit "my name is X" to override
        // even if a name was already extracted (could have been wrong)
        // ═══════════════════════════════════════════════════════════════════════
        if (userText) {
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
            const expectingName = session.mode === 'BOOKING' && (session.booking?.activeSlotType === 'name' || session.booking?.activeSlot === 'name');
            const customStopWords = company?.aiAgentSettings?.nameStopWords?.custom || [];
            const stopWordsEnabled = company?.aiAgentSettings?.nameStopWords?.enabled !== false;
            let extractedName = SlotExtractors.extractName(userText, { 
                expectingName, 
                customStopWords: stopWordsEnabled ? customStopWords : []
            });
            log('🔍 V36 Extraction result:', extractedName || '(none)', { expectingName, customStopWordsCount: customStopWords.length });
            
            // ═══════════════════════════════════════════════════════════════════
            // V29 FIX: Context-aware name extraction
            // When we're in BOOKING mode and actively asking for name, be more aggressive
            // "yes it's Mark" / "Mark" / "yes, Mark" should all work
            // ═══════════════════════════════════════════════════════════════════
            if (!extractedName && session.mode === 'BOOKING' && (session.booking?.activeSlotType === 'name' || session.booking?.activeSlot === 'name')) {
                log('🔍 V29: Context-aware name extraction (activeSlot=name)');
                
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
                const alreadyAskedForMissingPart = session.askedForMissingNamePart === true;
                
                if (askMissingNamePart && isPartialName && !alreadyAskedForMissingPart) {
                    // Store partial, let AI ask for full name
                    currentSlots.partialName = extractedName;
                    extractedThisTurn.partialName = extractedName;
                    log('Partial name detected (will ask for full)', { partialName: extractedName });
                } else {
                    // Accept name as-is
                    if (currentSlots.partialName && isPartialName) {
                        // V37 FIX: Don't merge if extracted name is same as partial (prevents "Mark Mark")
                        const partialLower = currentSlots.partialName.toLowerCase();
                        const extractedLower = extractedName.toLowerCase();
                        if (partialLower === extractedLower) {
                            // Same name repeated - just keep the partial, don't duplicate
                            currentSlots.name = currentSlots.partialName;
                            log('📝 V37: Same name repeated, not duplicating', { name: currentSlots.name });
                        } else {
                            // Different names - merge as first + last
                            currentSlots.name = `${currentSlots.partialName} ${extractedName}`;
                            log('📝 V37: Merging partial + new as full name', { name: currentSlots.name });
                        }
                        delete currentSlots.partialName;
                    } else {
                        currentSlots.name = extractedName;
                    }
                    extractedThisTurn.name = currentSlots.name;
                    log('Name extracted', { name: currentSlots.name });
                }
            } else if (currentSlots.partialName) {
                // Accept partial as complete (only ask once)
                currentSlots.name = currentSlots.partialName;
                delete currentSlots.partialName;
                extractedThisTurn.name = currentSlots.name;
                log('Accepting partial name as complete', { name: currentSlots.name });
                }
            }
        }
        
        // Extract phone
        if (!currentSlots.phone && userText) {
            const extractedPhone = SlotExtractors.extractPhone(userText);
            if (extractedPhone) {
                currentSlots.phone = extractedPhone;
                extractedThisTurn.phone = extractedPhone;
                log('Phone extracted', { phone: extractedPhone });
            }
        }
        
        // Extract address
        if (!currentSlots.address && userText) {
            const extractedAddress = SlotExtractors.extractAddress(userText);
            if (extractedAddress) {
                currentSlots.address = extractedAddress;
                extractedThisTurn.address = extractedAddress;
                log('Address extracted', { address: extractedAddress });
            }
        }
        
        // Extract time preference
        if (!currentSlots.time && userText) {
            const extractedTime = SlotExtractors.extractTime(userText);
            if (extractedTime) {
                currentSlots.time = extractedTime;
                extractedThisTurn.time = extractedTime;
                log('Time extracted', { time: extractedTime });
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
                // Mark it as extracted so the safety net knows to handle it
                extractedThisTurn.name = currentSlots.partialName;
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
        // Priority: COMPLETE > BOOKING (if consent given) > DISCOVERY
        // ═══════════════════════════════════════════════════════════════════════
        if (session.booking.completedAt || session.mode === 'COMPLETE') {
            // 🔒 COMPLETE MODE LOCK: Booking already finalized
            // Never re-ask slots after completion
            session.mode = 'COMPLETE';
            log('✅ MODE RESTORED: Booking already COMPLETE - will not re-ask slots');
        } else if (session.booking.consentGiven) {
            session.mode = 'BOOKING';
            log('📋 MODE RESTORED: Consent was given previously, restoring BOOKING mode');
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
        // CONSENT DETECTION - Check if caller explicitly wants to book
        // ═══════════════════════════════════════════════════════════════════════
        const consentCheck = ConsentDetector.checkForConsent(userText, company, session);
        
        if (consentCheck.hasConsent && !session.booking.consentGiven) {
            // 🎯 CONSENT GIVEN - Transition to BOOKING mode
            session.booking.consentGiven = true;
            session.booking.consentPhrase = consentCheck.matchedPhrase;
            session.booking.consentTurn = (session.metrics?.totalTurns || 0) + 1;
            session.booking.consentTimestamp = new Date();
            session.mode = 'BOOKING';
            
            // Store discovery summary before switching to booking
            session.discoverySummary = session.discovery?.issue || 
                                       session.conversationMemory?.summary || 
                                       'Caller wants to schedule service';
            
            log('🎯 CONSENT DETECTED - Transitioning to BOOKING mode', {
                matchedPhrase: consentCheck.matchedPhrase,
                reason: consentCheck.reason,
                turn: session.booking.consentTurn,
                discoverySummary: session.discoverySummary
            });
            
            // ═══════════════════════════════════════════════════════════════════
            // BOOKING SNAP: Return first booking question IMMEDIATELY
            // ═══════════════════════════════════════════════════════════════════
            // This is the "clipboard snap" - we don't let LLM freestyle anymore.
            // We use the EXACT question from the booking panel.
            // ═══════════════════════════════════════════════════════════════════
            const bookingConfigSnap = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: session?.flags || {} });
            const bookingSlotsSnap = bookingConfigSnap.slots || [];
            
            // Find first required slot that's not collected
            const firstMissingSlot = bookingSlotsSnap.find(slot => {
                const slotId = slot.slotId || slot.id || slot.type;
                const isCollected = currentSlots[slotId] || currentSlots[slot.type];
                return slot.required && !isCollected;
            });
            
            if (firstMissingSlot) {
                const slotId = firstMissingSlot.slotId || firstMissingSlot.id || firstMissingSlot.type;
                session.booking.currentSlotId = slotId;
                
                // ═══════════════════════════════════════════════════════════════
                // V31: Use prompt variant for natural phrasing
                // ═══════════════════════════════════════════════════════════════
                // Track asked count for rotation
                session.booking.meta = session.booking.meta || {};
                session.booking.meta[slotId] = session.booking.meta[slotId] || {};
                const askedCount = session.booking.meta[slotId].askedCount || 0;
                
                // Get variant (UI-configured or fallback)
                let exactQuestion = getSlotPromptVariant(firstMissingSlot, slotId, askedCount);
                
                // Loop prevention (UI-controlled): rephrase intro if we're repeating the same slot too many times
                const lp = company.aiAgentSettings?.frontDeskBehavior?.loopPrevention || {};
                const lpEnabled = lp.enabled !== false;
                const maxSame = typeof lp.maxSameQuestion === 'number' ? lp.maxSameQuestion : 2;
                // V59 NUKE: UI-configured rephrase intro ONLY
                const rephraseIntro = (lp.rephraseIntro || getMissingConfigPrompt('rephrase_intro', 'loopPrevention')).toString();
                if (lpEnabled && askedCount >= maxSame) {
                    exactQuestion = `${rephraseIntro}${exactQuestion}`.replace(/\s{2,}/g, ' ').trim();
                    log('🔁 LOOP PREVENTION: Rephrasing intro applied (booking snap)', { slotId, askedCount, maxSame });
                }
                session.booking.currentSlotQuestion = exactQuestion;
                session.booking.meta[slotId].askedCount = askedCount + 1;
                
                // Build acknowledgment + exact question
                const ack = "Perfect! Let me get your information.";
            
            aiLatencyMs = Date.now() - aiStartTime;
            
                log('📋 BOOKING SNAP: Asking first slot immediately', {
                    slotId,
                    question: exactQuestion
                });
                
                aiResult = {
                    reply: `${ack} ${exactQuestion}`,
                    conversationMode: 'booking',
                    intent: 'booking',
                    nextGoal: `COLLECT_${slotId.toUpperCase()}`,
                    filledSlots: currentSlots,
                    signals: { 
                        wantsBooking: true,
                        consentGiven: true,
                        bookingJustStarted: true
                    },
                    latencyMs: aiLatencyMs,
                    tokensUsed: 0,  // 🎯 0 tokens - deterministic!
                    fromStateMachine: true,
                    mode: 'BOOKING',
                    debug: {
                        source: 'BOOKING_SNAP',
                        stage: 'booking',
                        step: slotId,
                        firstSlotQuestion: exactQuestion
                    }
                };
            }
        }
        
        log('CHECKPOINT 9a: Mode state', {
            mode: session.mode,
            consentGiven: session.booking?.consentGiven,
            consentPhrase: session.booking?.consentPhrase,
            consentCheck,
            bookingSnapTriggered: !!aiResult
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // V22 KILL SWITCHES - Read from company config (UI-controlled)
        // ═══════════════════════════════════════════════════════════════════════
        const discoveryConsent = company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
        const autoReplyAllowedScenarioTypes = Array.isArray(discoveryConsent.autoReplyAllowedScenarioTypes)
            ? discoveryConsent.autoReplyAllowedScenarioTypes.map(t => (t || '').toString().trim().toUpperCase()).filter(Boolean)
            : [];
        const killSwitches = {
            // If true: Booking REQUIRES explicit consent (default: true)
            bookingRequiresConsent: discoveryConsent.bookingRequiresExplicitConsent !== false,
            // If true: LLM ALWAYS speaks during discovery (default: true)
            forceLLMDiscovery: discoveryConsent.forceLLMDiscovery !== false,
            // If true: Scenarios are context only by default (exceptions may be allowed via allowlist)
            disableScenarioAutoResponses: discoveryConsent.disableScenarioAutoResponses !== false,
            // Consent Split: types allowed to be used verbatim before consent (trade-agnostic)
            autoReplyAllowedScenarioTypes
        };
        
        log('CHECKPOINT 9a: 🔒 Kill switches loaded', killSwitches);
        
        // ═══════════════════════════════════════════════════════════════════════
        // BOOKING SNAP CHECK - If we already have a response from consent snap, skip AI
        // ═══════════════════════════════════════════════════════════════════════
        // KILL SWITCH ENFORCEMENT: If bookingRequiresConsent is ON, 
        // booking mode is ONLY allowed if consent was explicitly given
        const canEnterBooking = !killSwitches.bookingRequiresConsent || session.booking?.consentGiven;
        
        if (aiResult && aiResult.debug?.source === 'BOOKING_SNAP') {
            log('⚡ BOOKING SNAP: Skipping AI routing - using snap response');
            // aiResult is already set, skip to save/return
        }
        // ═══════════════════════════════════════════════════════════════════════
        // COMPLETE MODE - Booking already finalized, handle post-completion Q&A
        // ═══════════════════════════════════════════════════════════════════════
        else if (session.mode === 'COMPLETE') {
            log('✅ COMPLETE MODE: Booking already finalized, handling post-completion');
            
            // Check if user wants to start a NEW booking
            const wantsNewBooking = /\b(another|new|different|schedule|book)\s*(appointment|service|call)?\b/i.test(userText);
            
            if (wantsNewBooking) {
                // Reset for new booking
                log('🔄 COMPLETE MODE: User wants NEW booking, resetting');
                session.mode = 'DISCOVERY';
                session.booking = { consentGiven: false };
                // Fall through to discovery mode
            } else {
                // Answer post-completion questions using LLM + scenarios/cheat sheets
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
            // ═══════════════════════════════════════════════════════════════════
            // BOOKING MODE - Deterministic clipboard (consent already given)
            // ═══════════════════════════════════════════════════════════════════
            // In V22, we DO NOT use the state machine for booking responses.
            // The state machine was generating bad responses like "I'm sorry to hear that"
            // which is discovery language, not booking language.
            // 
            // Instead, we use the BOOKING SAFETY NET directly which:
            // 1. Reads the booking slot config from UI
            // 2. Uses the exact questions and confirmBack templates
            // 3. Handles name slot with askFullName logic
            // 4. Never re-asks the same slot
            // ═══════════════════════════════════════════════════════════════════
            log('CHECKPOINT 9b: 📋 BOOKING MODE (deterministic - no state machine)');

            // ═══════════════════════════════════════════════════════════════════
            // 📦 UNIT OF WORK (UoW) - Multi-location / multi-job (UI-controlled)
            // ═══════════════════════════════════════════════════════════════════
            // Enterprise-safe behavior:
            // - Default: 1 unit per call
            // - Only add another after explicit confirmation
            const uowConfig = company.aiAgentSettings?.frontDeskBehavior?.unitOfWork || {};
            const uowEnabled = uowConfig.enabled === true;
            const uowAllowMultiple = uowConfig.allowMultiplePerCall === true;
            const uowMaxUnits = typeof uowConfig.maxUnitsPerCall === 'number' ? uowConfig.maxUnitsPerCall : 3;
            const uowPerUnitSlotIds = Array.isArray(uowConfig.perUnitSlotIds) && uowConfig.perUnitSlotIds.length > 0
                ? uowConfig.perUnitSlotIds
                : ['address'];
            const uowConfirm = uowConfig.confirmation || {};

            if (uowEnabled) {
                session.unitOfWork = session.unitOfWork || {
                    activeUnitIndex: 0,
                    units: [{ index: 1, createdAt: new Date(), bookingRequestId: null, finalScript: null }],
                    awaitingAddAnother: false
                };

                // If we are waiting for the caller to confirm whether there is another unit,
                // handle that deterministically BEFORE any slot logic.
                if (session.unitOfWork.awaitingAddAnother === true) {
                    const yesWords = Array.isArray(uowConfirm.yesWords) ? uowConfirm.yesWords : [];
                    const noWords = Array.isArray(uowConfirm.noWords) ? uowConfirm.noWords : [];
                    const normalized = (userText || '').toLowerCase();

                    const saysYes = yesWords.some(w => w && normalized.includes(String(w).toLowerCase()));
                    const saysNo = noWords.some(w => w && normalized.includes(String(w).toLowerCase()));

                    log('📦 UOW: Awaiting add-another confirmation', {
                        saysYes,
                        saysNo,
                        activeUnitIndex: session.unitOfWork.activeUnitIndex,
                        units: session.unitOfWork.units?.length || 0
                    });

                    if (saysYes && !saysNo) {
                        // Start next unit (clear per-unit slots, keep global slots like name/phone)
                        const nextIndex = (session.unitOfWork.units?.length || 1);
                        if (nextIndex >= uowMaxUnits) {
                            // Cannot add more
                            session.unitOfWork.awaitingAddAnother = false;
                            session.markModified('unitOfWork');
                            aiResult = {
                                reply: uowConfirm.clarifyPrompt || "I can only take one more request at a time. Let’s finish what we have.",
                                conversationMode: 'booking',
                                intent: 'uow_max_reached',
                                nextGoal: 'CONTINUE_BOOKING',
                                filledSlots: currentSlots,
                                signals: { wantsBooking: true, consentGiven: true },
                                latencyMs: Date.now() - aiStartTime,
                                tokensUsed: 0,
                                fromStateMachine: true,
                                mode: 'BOOKING',
                                debug: { source: 'UOW_MAX_REACHED' }
                            };
                        } else {
                            // Append unit and clear per-unit slots
                            session.unitOfWork.awaitingAddAnother = false;
                            session.unitOfWork.activeUnitIndex = nextIndex;
                            session.unitOfWork.units = session.unitOfWork.units || [];
                            session.unitOfWork.units.push({ index: nextIndex + 1, createdAt: new Date(), bookingRequestId: null, finalScript: null });

                            // Clear per-unit slot values + meta so they are re-asked
                            session.collectedSlots = session.collectedSlots || {};
                            session.booking.meta = session.booking.meta || {};
                            for (const slotId of uowPerUnitSlotIds) {
                                delete session.collectedSlots[slotId];
                                if (session.booking.meta[slotId]) {
                                    delete session.booking.meta[slotId];
                                }
                            }
                            session.markModified('collectedSlots');
                            session.markModified('booking');
                            session.markModified('unitOfWork');

                            // Ask the first missing required slot now
                            const bookingConfigUow = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: session?.flags || {} });
                            const bookingSlotsUow = bookingConfigUow.slots || [];
                            const firstMissing = bookingSlotsUow.find(slot => {
                                const slotId = slot.slotId || slot.id || slot.type;
                                const val = (session.collectedSlots || {})[slotId] || (session.collectedSlots || {})[slot.type];
                                return slot.required && !val;
                            });
                            const slotId = firstMissing ? (firstMissing.slotId || firstMissing.id || firstMissing.type) : null;
                            const question = firstMissing ? getSlotPromptVariant(firstMissing, slotId, 0) : null;
                            // V59 NUKE: UI-configured unit of work intro ONLY
                            const intro = uowConfirm.nextUnitIntro || getMissingConfigPrompt('next_unit_intro', 'unitOfWork');
                            const reply = question ? `${intro} ${question}` : intro;

                            aiResult = {
                                reply,
                                conversationMode: 'booking',
                                intent: 'uow_next_unit_started',
                                nextGoal: slotId ? `COLLECT_${slotId.toUpperCase()}` : 'CONTINUE_BOOKING',
                                filledSlots: session.collectedSlots || {},
                                signals: { wantsBooking: true, consentGiven: true },
                                latencyMs: Date.now() - aiStartTime,
                                tokensUsed: 0,
                                fromStateMachine: true,
                                mode: 'BOOKING',
                                debug: { source: 'UOW_NEXT_UNIT', nextSlot: slotId }
                            };
                        }

                        // Skip remaining booking logic if we produced a response
                        if (aiResult) {
                            session.mode = 'BOOKING';
                            session.markModified('mode');
                            break BOOKING_MODE;
                        }
                    } else if (saysNo && !saysYes) {
                        // Close booking (single vs multi final script)
                        session.unitOfWork.awaitingAddAnother = false;
                        session.markModified('unitOfWork');

                        const unitCount = session.unitOfWork.units?.length || 1;
                        const lastUnit = (session.unitOfWork.units || [])[unitCount - 1] || {};
                        // V59 NUKE: UI-configured final scripts ONLY
                        const finalScript = unitCount > 1
                            ? (uowConfirm.finalScriptMulti || lastUnit.finalScript || getMissingConfigPrompt('final_script', 'unitOfWork'))
                            : (lastUnit.finalScript || getMissingConfigPrompt('final_script', 'unitOfWork'));

                        session.mode = 'COMPLETE';
                        session.booking.completedAt = new Date();
                        session.booking.bookingRequestId = lastUnit.bookingRequestId || session.booking.bookingRequestId || null;
                        session.booking.bookingRequestIds = (session.unitOfWork.units || [])
                            .map(u => u.bookingRequestId)
                            .filter(Boolean);
                        session.markModified('booking');
                        session.markModified('mode');

                        aiResult = {
                            reply: finalScript,
                            conversationMode: 'complete',
                            intent: 'booking_complete_multi_uow',
                            nextGoal: 'END_CALL',
                            filledSlots: currentSlots,
                            signals: { wantsBooking: true, consentGiven: true, bookingComplete: true, uowCount: unitCount },
                            latencyMs: Date.now() - aiStartTime,
                            tokensUsed: 0,
                            fromStateMachine: true,
                            mode: 'COMPLETE',
                            debug: { source: 'UOW_COMPLETE', unitCount }
                        };

                        break BOOKING_MODE;
                    } else {
                        // Ambiguous, ask clarify prompt
                        // V59 NUKE: UI-configured clarify prompt ONLY
                        const clarify = uowConfirm.clarifyPrompt || getMissingConfigPrompt('clarify_prompt', 'unitOfWork');
                        aiResult = {
                            reply: clarify,
                            conversationMode: 'booking',
                            intent: 'uow_clarify_add_another',
                            nextGoal: 'UOW_CONFIRM',
                            filledSlots: currentSlots,
                            signals: { wantsBooking: true, consentGiven: true },
                            latencyMs: Date.now() - aiStartTime,
                            tokensUsed: 0,
                            fromStateMachine: true,
                            mode: 'BOOKING',
                            debug: { source: 'UOW_CLARIFY' }
                        };
                        break BOOKING_MODE;
                    }
                }
            }
            
            // ═══════════════════════════════════════════════════════════════════
            // STRICT INTERRUPT DETECTION (from brainstorming doc)
            // ═══════════════════════════════════════════════════════════════════
            // Must be a REAL question, not just containing "is" or "can"
            // "My name is John" should NOT trigger interrupt
            // "What's the soonest?" SHOULD trigger interrupt
            // ═══════════════════════════════════════════════════════════════════
            const userTextTrimmed = userText.trim();
            const userTextLower = userTextTrimmed.toLowerCase();
            
            // Rule 1: Contains question mark = definitely a question
            const hasQuestionMark = userTextTrimmed.endsWith('?');
            
            // Rule 2: Starts with question words (but NOT "is" alone - too broad)
            const startsWithQuestionWord = /^(what|when|where|why|how|can you|could you|do you|does|are you|will you)\b/i.test(userTextTrimmed);
            
            // Rule 3: Contains booking-interrupt keywords (pricing, availability, etc.)
            const hasInterruptKeywords = /\b(soonest|earliest|available|price|cost|how much|warranty|hours|open|close)\b/i.test(userTextLower);
            
            // Rule 4: EXCLUDE if it looks like a slot answer
            const looksLikeSlotAnswer = /^(my name|name is|i'm|it's|call me|yes|yeah|no|nope)/i.test(userTextTrimmed) ||
                                        /^\d{3}[-.\s]?\d{3}[-.\s]?\d{4}/.test(userTextTrimmed) || // phone
                                        /^\d+\s+\w+/.test(userTextTrimmed); // address
            
            const looksLikeQuestion = (hasQuestionMark || startsWithQuestionWord || hasInterruptKeywords) && !looksLikeSlotAnswer;
            
            log('📝 INTERRUPT CHECK', {
                userText: userTextTrimmed.substring(0, 50),
                hasQuestionMark,
                startsWithQuestionWord,
                hasInterruptKeywords,
                looksLikeSlotAnswer,
                looksLikeQuestion
            });
            
            if (looksLikeQuestion && !extractedThisTurn.name && !extractedThisTurn.phone && 
                !extractedThisTurn.address && !extractedThisTurn.time) {
                // Caller went off-rails during booking (asked a question, etc.)
                // LLM handles it, then returns to booking slot
                log('CHECKPOINT 9c: 🔄 Booking interruption - checking cheat sheets first');
                
                // Get the next slot question for bridging back (MUST RESUME THIS EXACT PROMPT)
                const bookingConfigInt = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: session?.flags || {} });
                const bookingSlotsInt = bookingConfigInt.slots || [];
                const nextMissingSlotInt = bookingSlotsInt.find(slot => {
                    const slotId = slot.slotId || slot.id || slot.type;
                    const isCollected = currentSlots[slotId] || currentSlots[slot.type];
                    return slot.required && !isCollected;
                });
                // V59 NUKE: Slot question must come from UI config
                const nextSlotQuestion = nextMissingSlotInt?.question || getMissingConfigPrompt('slot_question', nextMissingSlotInt?.id || 'unknown');
                
                // ═══════════════════════════════════════════════════════════════════
                // PHASE 1: CHEAT SHEET FOR BOOKING INTERRUPTS
                // ═══════════════════════════════════════════════════════════════════
                // Pattern: Answer from cheat sheet → Resume EXACT slot prompt
                // Cheat sheets MUST NOT:
                // - Change slot order
                // - Introduce new questions
                // - Skip required slots
                // ═══════════════════════════════════════════════════════════════════
                let bookingInterruptCheatSheet = null;
                let bookingCheatSheetUsed = false;
                
                if (cheatSheetConfig) {
                    bookingInterruptCheatSheet = searchCheatSheets(cheatSheetConfig, userText);
                    if (bookingInterruptCheatSheet) {
                        bookingCheatSheetUsed = true;
                        log('CHECKPOINT 9c.1: 📋 Cheat sheet found for booking interrupt', {
                            question: bookingInterruptCheatSheet.question,
                            category: bookingInterruptCheatSheet.category,
                            willResumeSlot: nextSlotQuestion.substring(0, 50)
                        });
                        
                        // FAST PATH: Use cheat sheet answer directly + resume slot
                        // This is faster than LLM and more predictable
                        const cheatSheetAnswer = bookingInterruptCheatSheet.answer;
                        const finalReply = `${cheatSheetAnswer}\n\n${nextSlotQuestion}`;
                        
                        aiResult = {
                            reply: finalReply,
                            conversationMode: 'booking',
                            intent: 'booking_interrupt_cheatsheet',
                            nextGoal: `COLLECT_${(nextMissingSlotInt?.slotId || nextMissingSlotInt?.id || 'INFO').toUpperCase()}`,
                            filledSlots: currentSlots,
                            signals: { 
                                wantsBooking: true,
                                consentGiven: true
                            },
                            latencyMs: Date.now() - aiStartTime,
                            tokensUsed: 0,  // No LLM used!
                            fromStateMachine: true,
                            mode: 'BOOKING',
                            debug: {
                                source: 'BOOKING_INTERRUPT_CHEATSHEET',
                                cheatSheetUsed: true,
                                cheatSheetReason: 'booking_interrupt',
                                cheatSheetCategory: bookingInterruptCheatSheet.category,
                                resumedSlot: nextMissingSlotInt?.slotId || nextMissingSlotInt?.id,
                                resumedPrompt: nextSlotQuestion
                            }
                        };
                        
                        log('CHECKPOINT 9c.2: ✅ Cheat sheet interrupt handled, resuming slot', {
                            cheatSheetUsed: true,
                            resumedSlot: nextMissingSlotInt?.slotId,
                            replyPreview: finalReply.substring(0, 100)
                        });
                    }
                }
                
                // If no cheat sheet match, fall back to LLM
                if (!bookingCheatSheetUsed) {
                    log('CHECKPOINT 9c.3: 📝 No cheat sheet match, using LLM for interrupt');
                
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
                        // V22 INTERRUPT CONTEXT - Pass discovery summary + key facts
                        enterpriseContext: {
                            mode: 'BOOKING_INTERRUPTION',
                            discoverySummary: session.discoverySummary || session.discovery?.issue || 'Scheduling service',
                            keyFacts: session.keyFacts || [],
                            collectedSlots: currentSlots,
                            nextSlotQuestion: nextSlotQuestion,
                            // Tell LLM to bridge back after answering
                            bridgeBackRequired: true
                        },
                        returnToQuestion: nextSlotQuestion,
                        mode: 'BOOKING_INTERRUPTION'
                    },
                    currentMode: 'booking',
                    knownSlots: currentSlots,
                    conversationHistory,
                    userInput: userText,
                    behaviorConfig: company.aiAgentSettings?.frontDeskBehavior || {}
                });
                
                // Bridge back to booking slot after LLM response
                const bridgePhrase = company.aiAgentSettings?.frontDeskBehavior?.offRailsRecovery?.bridgeBack?.transitionPhrase || 'Now,';
                let finalReply = llmResult.reply || '';
                
                if (nextSlotQuestion) {
                    finalReply = `${finalReply} ${bridgePhrase} ${nextSlotQuestion}`;
                }
                
                aiLatencyMs = Date.now() - aiStartTime;
                
                aiResult = {
                    reply: finalReply,
                    conversationMode: 'booking',
                    intent: 'booking_interruption',
                    nextGoal: 'RESUME_BOOKING',
                    filledSlots: currentSlots,
                    signals: { 
                        wantsBooking: true,
                        consentGiven: true,
                        bookingInterruption: true
                    },
                    latencyMs: aiLatencyMs,
                    tokensUsed: llmResult.tokensUsed || 0,
                    fromStateMachine: false,
                    mode: 'BOOKING',
                    debug: {
                        source: 'BOOKING_INTERRUPTION_LLM',
                        returnToQuestion: nextSlotQuestion,
                        cheatSheetUsed: false,
                        cheatSheetReason: null
                    }
                };
                }  // End of if (!bookingCheatSheetUsed)
            } else {
                // ═══════════════════════════════════════════════════════════════════
                // BOOKING MODE SAFETY NET - Deterministic slot collection
                // ═══════════════════════════════════════════════════════════════════
                // This handles:
                // 1. ConfirmBack - Use the configured template from UI
                // 2. Partial name - Ask for missing last name if askFullName enabled
                // 3. Never re-ask same slot - If we have data, move forward
                // ═══════════════════════════════════════════════════════════════════
                log('⚠️ BOOKING MODE SAFETY NET: Computing next action');
                
                const bookingConfigSafe = BookingScriptEngine.getBookingSlotsFromCompany(company, { contextFlags: session?.flags || {} });
                const bookingSlotsSafe = bookingConfigSafe.slots || [];
                
                // V65 FIX: Track if we ask spelling variant THIS TURN
                // This prevents the V51 handler from processing user input as an "answer" 
                // in the same turn we ask the question
                let askedSpellingVariantThisTurn = false;
                
                // Initialize booking meta state for tracking confirmations
                // V38 FIX: Initialize ALL slot metas at the start of booking mode
                session.booking.meta = session.booking.meta || {};
                session.booking.meta.name = session.booking.meta.name || {
                    first: null,
                    last: null,
                    needsLastName: false,
                    lastConfirmed: false,      // Did user confirm the partial name?
                    askedMissingPartOnce: false,
                    assumedSingleTokenAs: null,  // "first" | "last"
                    // V31: Spelling variant tracking
                    askedSpellingVariant: false,
                    spellingVariantAnswer: null  // "optionA" | "optionB" | null
                };
                // V38 FIX: Initialize phone, address, time, email metas early
                session.booking.meta.phone = session.booking.meta.phone || { 
                    pendingConfirm: false, 
                    confirmed: false,
                    offeredCallerId: false,
                    breakdownStep: null
                };
                session.booking.meta.address = session.booking.meta.address || { 
                    pendingConfirm: false, 
                    confirmed: false,
                    breakdownStep: null
                };
                session.booking.meta.time = session.booking.meta.time || { 
                    pendingConfirm: false, 
                    confirmed: false,
                    offeredAsap: false
                };
                session.booking.meta.email = session.booking.meta.email || { 
                    pendingConfirm: false, 
                    confirmed: false,
                    spelledOut: false
                };
                
                // ═══════════════════════════════════════════════════════════════════
                // V36 FIX: Initialize nameMeta.first from discovery name IMMEDIATELY
                // This must happen BEFORE any checks so hasName/needsConfirmBack work
                // ═══════════════════════════════════════════════════════════════════
                if (!session.booking.meta.name.first && !session.booking.meta.name.last) {
                    const discoveryName = currentSlots.partialName || currentSlots.name;
                    if (discoveryName && !discoveryName.includes(' ')) {
                        // Single name from discovery - assume it's first name
                        session.booking.meta.name.first = discoveryName;
                        session.booking.meta.name.assumedSingleTokenAs = 'first';
                        log('📝 V36: Initialized nameMeta.first from discovery', { discoveryName });
                    } else if (discoveryName && discoveryName.includes(' ')) {
                        // Full name from discovery
                        const parts = discoveryName.split(' ');
                        session.booking.meta.name.first = parts[0];
                        session.booking.meta.name.last = parts.slice(1).join(' ');
                        log('📝 V36: Initialized nameMeta from full discovery name', { 
                            first: session.booking.meta.name.first, 
                            last: session.booking.meta.name.last 
                        });
                    }
                }
                
                // 🔍 DEBUG: Log nameMeta state at start of turn (V62: Added spelling variant fields)
                log('📝 NAME META STATE AT TURN START', {
                    'nameMeta.first': session.booking.meta.name.first,
                    'nameMeta.last': session.booking.meta.name.last,
                    'nameMeta.lastConfirmed': session.booking.meta.name.lastConfirmed,
                    'nameMeta.askedMissingPartOnce': session.booking.meta.name.askedMissingPartOnce,
                    'nameMeta.assumedSingleTokenAs': session.booking.meta.name.assumedSingleTokenAs,
                    // V62: Spelling variant state (CRITICAL for debugging loops)
                    'nameMeta.askedSpellingVariant': session.booking.meta.name.askedSpellingVariant,
                    'nameMeta.spellingVariantAnswer': session.booking.meta.name.spellingVariantAnswer,
                    'nameMeta.pendingSpellingVariant': session.booking.meta.name.pendingSpellingVariant ? 'SET' : 'NOT SET',
                    'currentSlots.partialName': currentSlots.partialName,
                    'currentSlots.name': currentSlots.name
                });
                
                // ═══════════════════════════════════════════════════════════════════════════
                // V42 FIX: Build slot type map - maps TYPE to actual slot ID
                // This allows slots with custom IDs (custom_xxx) to work properly
                // The Type dropdown determines behavior, not the Slot ID
                // ═══════════════════════════════════════════════════════════════════════════
                if (!session.booking.slotTypeMap) {
                    session.booking.slotTypeMap = {};
                    for (const slot of bookingSlotsSafe) {
                        const slotId = slot.slotId || slot.id;
                        const slotType = slot.type || 'text';
                        // Store the first slot of each type (in order)
                        if (!session.booking.slotTypeMap[slotType] && slotId) {
                            session.booking.slotTypeMap[slotType] = slotId;
                        }
                    }
                    log('📋 V42: Built slot type map', session.booking.slotTypeMap);
                }
                
                // Helper to get actual slot ID from type
                const getSlotIdByType = (type) => session.booking.slotTypeMap[type] || type;
                
                // Get name slot config for special handling
                // CRITICAL: Find by TYPE first (UI sets type dropdown), then fall back to ID
                const nameSlotConfig = bookingSlotsSafe.find(s => s.type === 'name') || 
                                       bookingSlotsSafe.find(s => (s.slotId || s.id) === 'name');
                
                // Track active slot for deterministic flow
                // Use the ACTUAL slot ID (could be custom_xxx), not hardcoded 'name'
                const nameSlotId = getSlotIdByType('name');
                session.booking.activeSlot = session.booking.activeSlot || nameSlotId;
                session.booking.activeSlotType = session.booking.activeSlotType || 'name';
                
                // ═══════════════════════════════════════════════════════════════════
                // V36 FIX: PROMPT AS LAW - Even if name was captured in discovery,
                // we MUST still follow the booking flow (confirmBack, askFullName)
                // Only skip if ALL requirements are met:
                // 1. Name exists AND
                // 2. confirmBack is OFF or already confirmed AND
                // 3. askFullName is OFF or we have full name (first + last)
                // ═══════════════════════════════════════════════════════════════════
                const nameMeta = session.booking.meta.name;
                const confirmBackEnabled = nameSlotConfig?.confirmBack === true || nameSlotConfig?.confirmBack === 'true';
                // V36 FIX: Check both boolean and string values (UI might save as string)
                const askFullNameEnabled = nameSlotConfig?.askFullName === true || nameSlotConfig?.askFullName === 'true' ||
                                          nameSlotConfig?.requireFullName === true || nameSlotConfig?.requireFullName === 'true' ||
                                          nameSlotConfig?.nameOptions?.askFullName === true || nameSlotConfig?.nameOptions?.askFullName === 'true';
                const hasName = currentSlots.name || currentSlots.partialName;
                const hasFullName = currentSlots.name && currentSlots.name.includes(' ');
                const nameConfirmed = nameMeta?.confirmed === true;
                
                // V36: Check if we need to do confirmBack or askFullName
                const needsConfirmBack = confirmBackEnabled && hasName && !nameConfirmed && !nameMeta?.lastConfirmed;
                const needsLastName = askFullNameEnabled && hasName && !hasFullName && !nameMeta?.last;
                
                // V43: Check if spelling variant check is needed
                // V53 FIX: If we already have BOTH first AND last name, skip spelling check entirely
                // Spelling variants only matter for single-word names (Mark vs Marc)
                // Once we have "Mark Gonzales", the first name spelling is locked in
                // V64 FIX: Check BOTH global AND slot-level spelling settings!
                const spellingConfig = company.aiAgentSettings?.frontDeskBehavior?.nameSpellingVariants || {};
                const globalSpellingEnabled = spellingConfig.enabled === true;
                const slotLevelSpellingEnabled = nameSlotConfig?.confirmSpelling === true;  // V64: Check slot-level too!
                const spellingEnabled = globalSpellingEnabled || slotLevelSpellingEnabled;  // V64: Either enables it
                const hasFullNameFromMeta = nameMeta?.first && nameMeta?.last;
                const needsSpellingVariantCheck = spellingEnabled && hasName && !hasFullNameFromMeta && !nameMeta?.askedSpellingVariant && !nameMeta?.spellingVariantAnswer;
                
                if (hasName && (session.booking.activeSlotType === 'name' || session.booking.activeSlot === 'name')) {
                    if (needsConfirmBack || needsLastName || needsSpellingVariantCheck) {
                        // DON'T skip - we need to confirm, get last name, or check spelling variant
                        log('📝 V36: Name from discovery needs processing', {
                            name: currentSlots.name || currentSlots.partialName,
                            needsConfirmBack,
                            needsLastName,
                            needsSpellingVariantCheck,
                            confirmBackEnabled,
                            askFullNameEnabled,
                            spellingEnabled
                        });
                        
                        // If we have a partial name from discovery and need to confirm/get last name,
                        // set up the state for the name flow to handle it
                        if (!nameMeta.first && (currentSlots.partialName || currentSlots.name)) {
                            const discoveredName = currentSlots.partialName || currentSlots.name;
                            if (!discoveredName.includes(' ')) {
                                // Single name - assume it's first name
                                nameMeta.first = discoveredName;
                                nameMeta.assumedSingleTokenAs = 'first';
                            }
                        }
                    } else {
                        // All requirements met - skip to phone
                        log('✅ V36: Name complete from discovery (all requirements met), skipping to phone', {
                            name: currentSlots.name,
                            confirmBackEnabled,
                            nameConfirmed,
                            askFullNameEnabled,
                            hasFullName,
                            spellingEnabled,
                            spellingVariantAsked: !!nameMeta?.askedSpellingVariant,
                            spellingVariantAnswered: !!nameMeta?.spellingVariantAnswer
                        });
                        // V42: Use slotTypeMap to get actual phone slot ID
                        session.booking.activeSlot = getSlotIdByType('phone');
                        session.booking.activeSlotType = 'phone';
                    }
                }
                
                // 🎯 PROMPT AS LAW: Default askFullName to FALSE
                // Only ask for last name if UI explicitly requires it
                // CHECK BOTH: Direct property (UI saves here) AND nested nameOptions (legacy)
                // V36 FIX: Check both boolean and string values (UI might save as string)
                const askFullName = nameSlotConfig?.askFullName === true || nameSlotConfig?.askFullName === 'true' ||
                                    nameSlotConfig?.requireFullName === true || nameSlotConfig?.requireFullName === 'true' ||
                                    nameSlotConfig?.nameOptions?.askFullName === true || nameSlotConfig?.nameOptions?.askFullName === 'true' ||
                                    nameSlotConfig?.nameOptions?.requireFullName === true || nameSlotConfig?.nameOptions?.requireFullName === 'true';
                const nameOptions = nameSlotConfig?.nameOptions || {};
                const askOnceForMissingPart = nameOptions.askOnceForMissingPart !== false;
                // V36: confirmBackEnabled already declared above at line 2707
                const confirmBackTemplate = nameSlotConfig?.confirmPrompt || 'Got it, {value}. Did I get that right?';
                
                // 🔍 DEBUG: Log askFullName and confirmBackTemplate evaluation
                log('📝 NAME CONFIG DEBUG (V37)', {
                    askFullName,
                    askFullNameEnabled,
                    'nameSlotConfig.askFullName': nameSlotConfig?.askFullName,
                    'nameSlotConfig.requireFullName': nameSlotConfig?.requireFullName,
                    'nameSlotConfig.confirmPrompt': nameSlotConfig?.confirmPrompt,
                    confirmBackTemplate,
                    confirmBackEnabled,
                    activeSlot: session.booking.activeSlot,
                    templateIncludesLastName: confirmBackTemplate.toLowerCase().includes('last name')
                });
                
                aiLatencyMs = Date.now() - aiStartTime;
                let finalReply = '';
                let nextSlotId = null;
                
                // ═══════════════════════════════════════════════════════════════════
                // NAME SLOT STATE MACHINE (from brainstorming doc)
                // ═══════════════════════════════════════════════════════════════════
                // States:
                // 1. No name → Ask for name
                // 2. partialName (single token) → Confirm back, then ask missing part
                // 3. firstName + lastName → Complete, move to phone
                // ═══════════════════════════════════════════════════════════════════
                // V36: nameMeta, hasName, hasFullName already declared above at line 2706-2712
                const hasPartialName = currentSlots.partialName || extractedThisTurn.name;
                
                // ═══════════════════════════════════════════════════════════════════
                // V33 FIX: Initialize nameMeta.first from partialName if not set
                // This handles the case where name was captured in discovery mode
                // but nameMeta.first was never set before entering booking mode
                // ═══════════════════════════════════════════════════════════════════
                if (hasPartialName && !nameMeta.first && !nameMeta.last) {
                    const partialName = currentSlots.partialName || extractedThisTurn.name;
                    const commonFirstNames = company.aiAgentSettings?.frontDeskBehavior?.commonFirstNames || [];
                    const commonFirstNamesSet = new Set(commonFirstNames.map(n => n.toLowerCase()));
                    const listIsEmpty = commonFirstNames.length === 0;
                    const isCommonFirstName = listIsEmpty || commonFirstNamesSet.has(partialName.toLowerCase());
                    
                    if (isCommonFirstName) {
                        nameMeta.first = partialName;
                        nameMeta.assumedSingleTokenAs = 'first';
                        log('📝 V33 FIX: Initialized nameMeta.first from partialName', { 
                            partialName, 
                            reason: listIsEmpty ? 'list_empty_default' : 'in_common_names_list' 
                        });
                    } else {
                        nameMeta.last = partialName;
                        nameMeta.assumedSingleTokenAs = 'last';
                        log('📝 V33 FIX: Initialized nameMeta.last from partialName', { 
                            partialName, 
                            reason: 'not_in_common_names_list' 
                        });
                    }
                }
                
                const hasBothParts = nameMeta.first && nameMeta.last;
                
                log('📝 NAME SLOT STATE', {
                    activeSlot: session.booking.activeSlot,
                    hasPartialName,
                    hasFullName,
                    hasBothParts,
                    nameMeta,
                    extractedThisTurn: extractedThisTurn.name,
                    currentSlotsName: currentSlots.name,
                    currentSlotsPartialName: currentSlots.partialName
                });
                
                // ═══════════════════════════════════════════════════════════════════
                // V36 FIX: DISCOVERY NAME NEEDS CONFIRM/LAST NAME
                // If we have a name from discovery but haven't confirmed it yet,
                // ASK the confirmBack question NOW (first turn of booking mode)
                // ═══════════════════════════════════════════════════════════════════
                const discoveryNameNeedsProcessing = hasPartialName && !hasFullName && !nameMeta.lastConfirmed && (session.booking.activeSlotType === 'name' || session.booking.activeSlot === 'name');
                
                if (discoveryNameNeedsProcessing && confirmBackEnabled) {
                    const nameToConfirm = currentSlots.partialName || nameMeta.first || currentSlots.name;
                    
                    if (nameToConfirm && !nameToConfirm.includes(' ')) {
                        // ═══════════════════════════════════════════════════════════════════
                        // V46: CHECK SPELLING VARIANT - reads from SLOT config first
                        // nameSlotConfig.confirmSpelling = TRUE enables the check
                        // Falls back to global nameSpellingVariants.enabled if not set on slot
                        // ═══════════════════════════════════════════════════════════════════
                        const spellingConfigV45 = company.aiAgentSettings?.frontDeskBehavior?.nameSpellingVariants || {};
                        
                        // V46: Check slot-level setting FIRST, then fall back to global
                        const slotLevelSpellingEnabled = nameSlotConfig?.confirmSpelling === true;
                        const globalSpellingEnabled = spellingConfigV45.enabled === true;
                        const spellingEnabledV45 = slotLevelSpellingEnabled || globalSpellingEnabled;
                        
                        const shouldCheckSpellingV45 = spellingEnabledV45 && 
                                                       !nameMeta.askedSpellingVariant && 
                                                       (nameMeta.spellingAsksCount || 0) < (spellingConfigV45.maxAsksPerCall || 1);
                        
                        log('📝 V46: Spelling variant check in discovery path', {
                            nameToConfirm,
                            slotLevelSpellingEnabled,
                            globalSpellingEnabled,
                            spellingEnabledV45,
                            shouldCheckSpellingV45,
                            askedSpellingVariant: nameMeta.askedSpellingVariant,
                            hasPrecomputedMap: !!(spellingConfigV45.precomputedVariantMap),
                            source: spellingConfigV45.source
                        });
                        
                        if (shouldCheckSpellingV45) {
                            const commonFirstNamesV45 = company.aiAgentSettings?.frontDeskBehavior?.commonFirstNames || [];
                            const variantV45 = findSpellingVariant(nameToConfirm, spellingConfigV45, commonFirstNamesV45);
                            
                            log('📝 V45: Spelling variant result', {
                                name: nameToConfirm,
                                variantFound: !!(variantV45 && variantV45.hasVariant),
                                variant: variantV45 ? { optionA: variantV45.optionA, optionB: variantV45.optionB } : null
                            });
                            
                            if (variantV45 && variantV45.hasVariant) {
                                // ASK SPELLING VARIANT FIRST - don't ask for last name yet
                                nameMeta.askedSpellingVariant = true;
                                nameMeta.spellingAsksCount = (nameMeta.spellingAsksCount || 0) + 1;
                                nameMeta.pendingSpellingVariant = variantV45;
                                
                                // V65 FIX: Mark that we asked THIS TURN - prevents V51 handler from 
                                // processing user's name as a "spelling variant answer" in the same turn
                                askedSpellingVariantThisTurn = true;
                                
                                // V62 FIX: Mark booking as modified so Mongoose persists spelling variant state
                                session.markModified('booking');
                                
                                // V59 NUKE: UI-configured spelling variant script ONLY
                                const scriptV45 = spellingConfigV45.script || 'Is that {optionA} with a {letterA} or {optionB} with a {letterB}?';
                                finalReply = scriptV45
                                    .replace('{optionA}', variantV45.optionA)
                                    .replace('{optionB}', variantV45.optionB)
                                    .replace('{letterA}', variantV45.letterA)
                                    .replace('{letterB}', variantV45.letterB);
                                nextSlotId = 'name';
                                // DON'T set lastConfirmed yet - we're asking about spelling first
                                
                                log('📝 V65 SPELLING VARIANT: Asking question THIS TURN (will skip V51 handler)', {
                                    name: nameToConfirm,
                                    optionA: variantV45.optionA,
                                    optionB: variantV45.optionB,
                                    script: finalReply
                                });
                            } else {
                                // No variant found - proceed with normal confirm
                                nameMeta.lastConfirmed = true;
                                nameMeta.askedSpellingVariant = true; // Mark as checked
                                nameMeta.spellingVariantAnswer = 'no_variant'; // V48 FIX: Must set this to prevent isNameSlotComplete from blocking!
                                const confirmText = confirmBackTemplate.replace('{value}', nameToConfirm);
                                finalReply = confirmText;
                                nextSlotId = 'name';
                                
                                log('📝 V45: No spelling variant, confirming discovery name + asking for last name', {
                                    nameToConfirm,
                                    confirmBackTemplate,
                                    askFullName
                                });
                            }
                        } else {
                            // Spelling variants disabled or already checked - proceed with normal confirm
                            nameMeta.lastConfirmed = true;
                            const confirmText = confirmBackTemplate.replace('{value}', nameToConfirm);
                            finalReply = confirmText;
                            nextSlotId = 'name';
                            
                            log('📝 V36: Confirming discovery name + asking for last name', {
                                nameToConfirm,
                                confirmBackTemplate,
                                askFullName
                            });
                        }
                    }
                }
                // If we have discovery name but confirmBack is OFF, still ask for last name if needed
                else if (discoveryNameNeedsProcessing && !confirmBackEnabled && askFullName) {
                    const nameToUse = currentSlots.partialName || nameMeta.first || currentSlots.name;
                    
                    if (nameToUse && !nameToUse.includes(' ')) {
                        // V59 NUKE: Use UI-configured last name question ONLY
                        const lastNameQuestion = nameSlotConfig?.lastNameQuestion || getMissingConfigPrompt('lastNameQuestion', 'name');
                        const lastNameQuestionFormatted = lastNameQuestion.replace('{firstName}', nameToUse);
                        
                        // V36 PROMPT AS LAW: Use UI template if it asks for last name, otherwise use configured lastNameQuestion
                        const templateAsksForLastName = confirmBackTemplate.toLowerCase().includes('last name');
                        if (templateAsksForLastName) {
                            finalReply = confirmBackTemplate.replace('{value}', nameToUse);
                        } else {
                            finalReply = `Got it, ${nameToUse}. ${lastNameQuestionFormatted}`;
                        }
                        nextSlotId = 'name';
                        nameMeta.askedMissingPartOnce = true;
                        nameMeta.lastConfirmed = true; // Mark that we've asked
                        
                        log('📝 V47: Discovery name - asking for last name (UI configured)', {
                            nameToUse,
                            askFullName,
                            lastNameQuestion,
                            templateAsksForLastName
                        });
                    }
                }
                
                // ═══════════════════════════════════════════════════════════════════
                // NAME CONFIRMATION HANDLING (V27)
                // Handle "yes" and "no" responses to name confirmBack
                // ═══════════════════════════════════════════════════════════════════
                // V37 FIX: Added "absolutely", "definitely", "certainly", "perfect", "exactly", etc.
                // V38 FIX: But DON'T match if followed by "my name is" - that's a name statement, not a confirmation
                const userTextTrimmed = userText.trim();
                const startsWithYes = /^(yes|yeah|yep|correct|that's right|right|yup|uh huh|mhm|affirmative|sure|ok|okay|absolutely|definitely|certainly|perfect|exactly|that's it|you got it|sounds good|that works)/i.test(userTextTrimmed);
                const hasNameStatement = /\b(my name is|name is|i'm|i am|call me)\b/i.test(userTextTrimmed);
                const userSaysYesForName = startsWithYes && !hasNameStatement; // Don't treat "sure my name is Mark" as confirmation
                const userSaysNo = /^(no|nope|nah|that's wrong|wrong|incorrect|not right)/i.test(userTextTrimmed);
                
                log('📝 V38 NAME CONFIRMATION CHECK', {
                    userText: userTextTrimmed.substring(0, 50),
                    startsWithYes,
                    hasNameStatement,
                    userSaysYesForName,
                    lastConfirmed: nameMeta.lastConfirmed,
                    askedMissingPartOnce: nameMeta.askedMissingPartOnce
                });
                
                // Handle "YES" to name confirmBack - need to check if we should ask for last name
                if (userSaysYesForName && nameMeta.lastConfirmed && !nameMeta.askedMissingPartOnce && askFullName && (session.booking.activeSlotType === 'name' || session.booking.activeSlot === 'name')) {
                    // User confirmed partial name, now ask for missing part
                    nameMeta.askedMissingPartOnce = true;
                    
                    // V37 PROMPT AS LAW: User said "yes" to confirmBack, now ask for missing part
                    // Since they already confirmed, just ask for the missing part directly
                    const firstName = nameMeta.first || currentSlots.partialName || '';
                    
                    // V47: Use UI-configured questions - NOT hardcoded
                    // V59 NUKE: UI-configured questions ONLY
                    const lastNameQ = nameSlotConfig?.lastNameQuestion || getMissingConfigPrompt('lastNameQuestion', 'name');
                    const firstNameQ = nameSlotConfig?.firstNameQuestion || getMissingConfigPrompt('firstNameQuestion', 'name');
                    
                    if (nameMeta.assumedSingleTokenAs === 'last') {
                        // We have last name, need first
                        finalReply = firstName 
                            ? `Perfect, ${firstName}. ${firstNameQ.replace('{firstName}', firstName)}`
                            : firstNameQ;
                    } else {
                        // We have first name, need last - they already confirmed, so just ask
                        finalReply = firstName 
                            ? `Perfect, ${firstName}. ${lastNameQ.replace('{firstName}', firstName)}`
                            : lastNameQ;
                    }
                    nextSlotId = 'name'; // Still on name
                    
                    log('📝 V47: User confirmed partial, asking for missing part (UI configured)', {
                        assumedAs: nameMeta.assumedSingleTokenAs,
                        first: nameMeta.first,
                        last: nameMeta.last,
                        askingFor: nameMeta.assumedSingleTokenAs === 'last' ? 'first' : 'last',
                        questionUsed: nameMeta.assumedSingleTokenAs === 'last' ? firstNameQ : lastNameQ
                    });
                }
                // Handle "YES" to name confirmBack when askFullName is OFF - accept and move on
                else if (userSaysYesForName && nameMeta.lastConfirmed && !askFullName && (session.booking.activeSlotType === 'name' || session.booking.activeSlot === 'name')) {
                    // Accept partial name as complete
                    const partialName = currentSlots.partialName || nameMeta.first || nameMeta.last;
                    currentSlots.name = partialName;
                    session.booking.activeSlot = getSlotIdByType('phone'); session.booking.activeSlotType = 'phone';
                    
                    const displayName = nameMeta.first || partialName;
                    finalReply = `Got it, ${displayName}. `;
                    nextSlotId = null; // Will find phone below
                    
                    log('📝 NAME: User confirmed, askFullName OFF, moving to phone (V27)', { name: currentSlots.name });
                }
                // Handle "NO" to name confirmBack - reset and re-ask
                else if (userSaysNo && nameMeta.lastConfirmed && !nameMeta.askedMissingPartOnce) {
                    // User denied the confirmBack - reset name state
                    log('📝 NAME: User denied confirmation, resetting');
                    nameMeta.first = null;
                    nameMeta.last = null;
                    nameMeta.lastConfirmed = false;
                    nameMeta.askedMissingPartOnce = false;
                    nameMeta.assumedSingleTokenAs = null;
                    currentSlots.partialName = null;
                    currentSlots.name = null;
                    
                    // Ask for name again cleanly
                    const nameSlotConfig = bookingSlotsSafe.find(s => 
                        (s.slotId || s.id || s.type) === 'name'
                    );
                    // V59 NUKE: UI-configured question ONLY
                    finalReply = "I apologize for the confusion. " + (nameSlotConfig?.question || getMissingConfigPrompt('slot_question', 'name'));
                    nextSlotId = 'name';
                }
                // Check if name slot is already complete
                // V44: BUT don't skip if spelling variant check is still needed!
                // V62 FIX: ALSO don't skip if we're waiting for spelling variant ANSWER
                else if ((hasFullName || hasBothParts) && !needsSpellingVariantCheck && 
                         !(nameMeta?.askedSpellingVariant && nameMeta?.pendingSpellingVariant && !nameMeta?.spellingVariantAnswer)) {
                    // Name is complete AND no spelling variant check needed AND not waiting for spelling answer, move to next slot
                    if (hasBothParts && !currentSlots.name) {
                        // Build full name safely (no undefined)
                        const firstName = nameMeta.first || '';
                        const lastName = nameMeta.last || '';
                        currentSlots.name = `${firstName} ${lastName}`.trim();
                    }
                    // V53 FIX: Sync extractedThisTurn and clear partialName
                    if (currentSlots.name) {
                        extractedThisTurn.name = currentSlots.name;
                        delete currentSlots.partialName;
                        delete extractedThisTurn.partialName;
                    }
                    session.booking.activeSlot = getSlotIdByType('phone'); session.booking.activeSlotType = 'phone';
                    log('📝 NAME COMPLETE, moving to phone', { name: currentSlots.name });
                }
                // V44: Name parts exist but spelling variant check is still needed
                else if ((hasFullName || hasBothParts) && needsSpellingVariantCheck) {
                    const nameToCheck = nameMeta.first || currentSlots.partialName || currentSlots.name?.split(' ')[0];
                    
                    log('📝 V44: Name exists but spelling variant check needed', {
                        nameToCheck,
                        nameMeta,
                        needsSpellingVariantCheck
                    });
                    
                    // V44: Actually RUN the spelling variant check here
                    const spellingConfigV44 = company.aiAgentSettings?.frontDeskBehavior?.nameSpellingVariants || {};
                    const commonFirstNamesV44 = company.aiAgentSettings?.frontDeskBehavior?.commonFirstNames || [];
                    const variantV44 = findSpellingVariant(nameToCheck, spellingConfigV44, commonFirstNamesV44);
                    
                    log('📝 V44 SPELLING VARIANT CHECK RESULT', {
                        nameToCheck,
                        variantFound: !!(variantV44 && variantV44.hasVariant),
                        variant: variantV44 ? { optionA: variantV44.optionA, optionB: variantV44.optionB } : null,
                        hasPrecomputedMap: !!(spellingConfigV44.precomputedVariantMap),
                        source: spellingConfigV44.source
                    });
                    
                    if (variantV44 && variantV44.hasVariant) {
                        // Ask about spelling variant
                        nameMeta.askedSpellingVariant = true;
                        nameMeta.spellingAsksCount = (nameMeta.spellingAsksCount || 0) + 1;
                        nameMeta.pendingSpellingVariant = variantV44;
                        
                        // V65 FIX: Mark that we asked THIS TURN - prevents V51 handler from 
                        // processing user's name as a "spelling variant answer" in the same turn
                        askedSpellingVariantThisTurn = true;
                        
                        // V62 FIX: Mark booking as modified so Mongoose persists spelling variant state
                        session.markModified('booking');
                        
                        // V59 NUKE: UI-configured spelling variant script ONLY
                        const scriptV44 = spellingConfigV44.script || 'Is that {optionA} with a {letterA} or {optionB} with a {letterB}?';
                        finalReply = scriptV44
                            .replace('{optionA}', variantV44.optionA)
                            .replace('{optionB}', variantV44.optionB)
                            .replace('{letterA}', variantV44.letterA)
                            .replace('{letterB}', variantV44.letterB);
                        nextSlotId = 'name'; // Still on name
                        
                        log('📝 V65 SPELLING VARIANT: Asking question THIS TURN (V44 path)', {
                            name: nameToCheck,
                            optionA: variantV44.optionA,
                            optionB: variantV44.optionB,
                            script: finalReply
                        });
                    } else {
                        // No variant found or couldn't check - mark as done and move to phone
                        nameMeta.askedSpellingVariant = true; // Mark as checked (even if no variant)
                        nameMeta.spellingVariantAnswer = 'no_variant'; // V48 FIX: Must set this to prevent isNameSlotComplete from blocking!
                        
                        if (!currentSlots.name) {
                            const firstName = nameMeta.first || '';
                            const lastName = nameMeta.last || '';
                            currentSlots.name = `${firstName} ${lastName}`.trim();
                        }
                        // V53 FIX: Sync extractedThisTurn and clear partialName
                        if (currentSlots.name) {
                            extractedThisTurn.name = currentSlots.name;
                            delete currentSlots.partialName;
                            delete extractedThisTurn.partialName;
                        }
                        
                        session.booking.activeSlot = getSlotIdByType('phone'); 
                        session.booking.activeSlotType = 'phone';
                        log('📝 V44: No spelling variant, moving to phone', { name: currentSlots.name });
                    }
                }
            // ═══════════════════════════════════════════════════════════════════
                // V33 FIX: Handle missing name part (last name after first, or vice versa)
                // When we've asked for last name and user says "Walter" or "the last name is Walter"
                // Extract the actual name, not just the first word
            // ═══════════════════════════════════════════════════════════════════
                else if ((session.booking.activeSlotType === 'name' || session.booking.activeSlot === 'name') && nameMeta.askedMissingPartOnce && !hasBothParts) {
                    // 🍿 POPCORN TRAIL: V60 - Extracting MISSING NAME PART
                    log('🍿 [POPCORN] MISSING_NAME_PART_EXTRACTION', {
                        trigger: 'askedMissingPartOnce=true, hasBothParts=false',
                        userText,
                        existingFirst: nameMeta.first,
                        existingLast: nameMeta.last,
                        assumedSingleTokenAs: nameMeta.assumedSingleTokenAs,
                        expectingPart: nameMeta.assumedSingleTokenAs === 'first' ? 'LAST_NAME' : 'FIRST_NAME',
                        activeSlot: session.booking.activeSlot,
                        activeSlotType: session.booking.activeSlotType
                    });
                    
                    // We asked for the missing part - extract name from various phrasings
                    let extractedNamePart = null;
                    
                    // ═══════════════════════════════════════════════════════════════════
                    // V50 FIX: Stop words that are NEVER valid names
                    // Prevents "my last name is" from extracting "is" as the name
                    // ═══════════════════════════════════════════════════════════════════
                    const NAME_STOP_WORDS = new Set([
                        'is', 'are', 'was', 'were', 'be', 'been', 'am', 'has', 'have', 'had',
                        'the', 'my', 'its', "it's", 'a', 'an', 'name', 'last', 'first',
                        'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'no', 'nope',
                        'hi', 'hello', 'hey', 'please', 'thanks', 'thank', 'you',
                        'it', 'that', 'this', 'what', 'and', 'or', 'but', 'to', 'for'
                    ]);
                    
                    // Helper: validate extracted name isn't a stop word or too short
                    const isValidNameExtraction = (name) => {
                        if (!name || name.length < 2) return false;
                        if (NAME_STOP_WORDS.has(name.toLowerCase())) return false;
                        // Also reject if it matches common verbs/articles
                        if (/^(is|are|was|were|be|am|has|have|had|do|does|did|will|would|could|should|can|may|might)$/i.test(name)) return false;
                        return true;
                    };
                    
                    // Pattern 1: "the last name is Walter" / "my last name is Walter" / "last name is Walter"
                    const lastNameIsMatch = userText.match(/(?:the\s+)?(?:my\s+)?last\s+name\s+(?:is\s+)?([A-Za-z]+)/i);
                    if (lastNameIsMatch && lastNameIsMatch[1] && isValidNameExtraction(lastNameIsMatch[1])) {
                        extractedNamePart = lastNameIsMatch[1];
                        log('📝 V33: Extracted from "last name is X" pattern', { extracted: extractedNamePart });
                    }
                    
                    // Pattern 2: "the first name is Mark" / "my first name is Mark"
                    if (!extractedNamePart) {
                        const firstNameIsMatch = userText.match(/(?:the\s+)?(?:my\s+)?first\s+name\s+(?:is\s+)?([A-Za-z]+)/i);
                        if (firstNameIsMatch && firstNameIsMatch[1] && isValidNameExtraction(firstNameIsMatch[1])) {
                            extractedNamePart = firstNameIsMatch[1];
                            log('📝 V33: Extracted from "first name is X" pattern', { extracted: extractedNamePart });
                        }
                    }
                    
                    // Pattern 3: "it's Walter" / "it is Walter"
                    if (!extractedNamePart) {
                        const itsMatch = userText.match(/(?:it'?s|it\s+is)\s+([A-Za-z]+)/i);
                        if (itsMatch && itsMatch[1] && isValidNameExtraction(itsMatch[1])) {
                            extractedNamePart = itsMatch[1];
                            log('📝 V33: Extracted from "it\'s X" pattern', { extracted: extractedNamePart });
                        }
                    }
                    
                    // Pattern 4: Just a single name word (filter out filler words, take LAST meaningful word)
                    if (!extractedNamePart) {
                        const words = userText.trim().split(/\s+/);
                        const nameWords = words.filter(w => {
                            const clean = w.replace(/[^a-zA-Z]/g, '').toLowerCase();
                            return clean.length >= 2 && !NAME_STOP_WORDS.has(clean);
                        });
                        
                        if (nameWords.length > 0) {
                            // Take the last meaningful word (most likely the actual name)
                            const candidate = nameWords[nameWords.length - 1].replace(/[^a-zA-Z]/g, '');
                            if (isValidNameExtraction(candidate)) {
                                extractedNamePart = candidate;
                                log('📝 V33: Extracted last meaningful word', { extracted: extractedNamePart, allWords: nameWords });
                            }
                        }
                    }
                    
                    // V50: Log if extraction was blocked
                    if (!extractedNamePart) {
                        log('📝 V50: No valid name extracted (stop word or incomplete input)', { userText });
                    }
                    
                    if (extractedNamePart && extractedNamePart.length >= 2) {
                        // Title case
                        const formattedName = extractedNamePart.charAt(0).toUpperCase() + extractedNamePart.slice(1).toLowerCase();
                        
                        // 🍿 POPCORN TRAIL: V60 - Storing the extracted name part
                        log('🍿 [POPCORN] NAME_PART_EXTRACTED', {
                            rawInput: userText,
                            extractedNamePart,
                            formattedName,
                            willStoreAs: nameMeta.assumedSingleTokenAs === 'first' ? 'LAST_NAME' : 'FIRST_NAME',
                            existingFirst: nameMeta.first,
                            existingLast: nameMeta.last
                        });
                        
                        if (nameMeta.assumedSingleTokenAs === 'first') {
                            // We had first name (e.g., "Mark"), now got last name
                            nameMeta.last = formattedName;
                            log('📝 V33: Got LAST name after asking', { lastName: formattedName });
        } else {
                            // We had last name (e.g., "Subach"), now got first name
                            nameMeta.first = formattedName;
                            log('📝 V33: Got FIRST name after asking', { firstName: formattedName });
                        }
                        
                        // V52 FIX: Clear spelling variant wait state
                        // If user provided last name instead of answering spelling variant question,
                        // consider the spelling question implicitly resolved
                        if (nameMeta.askedSpellingVariant && !nameMeta.spellingVariantAnswer) {
                            nameMeta.spellingVariantAnswer = 'implicit_resolved';
                            log('📝 V52: Spelling variant implicitly resolved by last name', {
                                first: nameMeta.first,
                                last: formattedName
                            });
                        }
                        
                        // Build full name safely (no undefined)
                        const firstName = nameMeta.first || '';
                        const lastName = nameMeta.last || '';
                        currentSlots.name = `${firstName} ${lastName}`.trim();
                        // V53 FIX: Also update extractedThisTurn so it doesn't overwrite at save time
                        extractedThisTurn.name = currentSlots.name;
                        // V53 FIX: Clear partialName since we now have full name
                        delete currentSlots.partialName;
                        delete extractedThisTurn.partialName;
                        session.booking.activeSlot = getSlotIdByType('phone'); session.booking.activeSlotType = 'phone';
                        
                        // 🎯 DISPLAY NAME: Always use first name for personalization
                        const displayName = nameMeta.first || currentSlots.name.split(' ')[0] || currentSlots.name;
                        finalReply = `Perfect, ${displayName}. `;
                        nextSlotId = null; // Will find next slot below
                        
                        log('📝 V33: NAME COMPLETE after missing part', { 
                            name: currentSlots.name,
                            displayName,
                            first: nameMeta.first,
                            last: nameMeta.last
                        });
                    } else {
                        // Couldn't extract - ask again with reprompt
                        const askingFor = nameMeta.assumedSingleTokenAs === 'first' ? 'last' : 'first';
                        finalReply = `Sorry, I didn't catch that. What's your ${askingFor} name?`;
                        nextSlotId = 'name';
                        log('📝 V33: Could not extract name part, re-asking', { userText, askingFor });
                    }
                }
                // ═══════════════════════════════════════════════════════════════════
                // V51 FIX: SPELLING VARIANT RESPONSE HANDLER (PRIORITY)
                // Must check BEFORE name collection branch to prevent loop
                // When user says "Marc with a C", we should process the variant answer,
                // NOT treat it as a new name being provided
                // 
                // V65 FIX: Skip this handler if we JUST ASKED the spelling variant question
                // THIS TURN. Otherwise we process the user's name as an "answer" immediately!
                // ═══════════════════════════════════════════════════════════════════
                else if (nameMeta?.askedSpellingVariant && nameMeta?.pendingSpellingVariant && !nameMeta?.spellingVariantAnswer && !askedSpellingVariantThisTurn) {
                    const variant = nameMeta.pendingSpellingVariant;
                    const userTextLower = userText.toLowerCase().trim();
                    
                    // Check what the user answered
                    let chosenName = null;
                    
                    log('📝 V51: Processing spelling variant response', {
                        userText,
                        optionA: variant.optionA,
                        optionB: variant.optionB,
                        letterA: variant.letterA,
                        letterB: variant.letterB
                    });
                    
                    // Check for letter answers: "K", "C", "with a K", "the K"
                    const hasLetterA = userTextLower.includes(variant.letterA.toLowerCase());
                    const hasLetterB = userTextLower.includes(variant.letterB.toLowerCase());
                    
                    if (hasLetterB && !hasLetterA) {
                        chosenName = variant.optionB;
                    } else if (hasLetterA && !hasLetterB) {
                        chosenName = variant.optionA;
                    }
                    // Check for name answers: "Mark", "Marc"
                    else if (userTextLower.includes(variant.optionB.toLowerCase())) {
                        chosenName = variant.optionB;
                    } else if (userTextLower.includes(variant.optionA.toLowerCase())) {
                        chosenName = variant.optionA;
                    }
                    // Default to optionA if unclear
                    else {
                        chosenName = variant.optionA;
                        log('📝 V51 SPELLING: Unclear answer, defaulting to optionA', { userText, optionA: variant.optionA });
                    }
                    
                    // Update the name with the correct spelling
                    nameMeta.spellingVariantAnswer = chosenName;
                    nameMeta.first = chosenName;
                    currentSlots.partialName = chosenName;
                    
                    log('📝 V51 SPELLING VARIANT: User chose', { chosenName, userText });
                    
                    // Now proceed to ask for last name or move on
                    if (askFullName) {
                        nameMeta.askedMissingPartOnce = true;
                        // V63: Use UI-configured last name question - NO HARDCODED FALLBACK
                        const lastNameQSpelling = nameSlotConfig?.lastNameQuestion || getMissingConfigPrompt('lastNameQuestion', 'name');
                        finalReply = `Got it, ${chosenName}. ${lastNameQSpelling.replace('{firstName}', chosenName)}`;
                        nextSlotId = 'name';
                    } else {
                        // Accept as complete
                        currentSlots.name = chosenName;
                        session.booking.activeSlot = getSlotIdByType('phone'); session.booking.activeSlotType = 'phone';
                        finalReply = `Got it, ${chosenName}. `;
                        nextSlotId = null;
                    }
                }
                // Check if we're in the middle of name collection
                // V60 FIX: EXCLUDE cases where we're waiting for the MISSING PART (handled by earlier block)
                else if ((session.booking.activeSlotType === 'name' || session.booking.activeSlot === 'name') && hasPartialName && !nameMeta.askedMissingPartOnce) {
                    const extractedName = extractedThisTurn.name || currentSlots.partialName;
                    const hasSpace = extractedName && extractedName.includes(' ');
                    
                    if (hasSpace) {
                        // Full name provided in one go
                        const parts = extractedName.split(' ');
                        nameMeta.first = parts[0];
                        nameMeta.last = parts.slice(1).join(' ');
                        currentSlots.name = extractedName;
                        session.booking.activeSlot = getSlotIdByType('phone'); session.booking.activeSlotType = 'phone';
                        
                        // Confirm and move to phone
                        finalReply = `Got it, ${nameMeta.first}. `;
                        nextSlotId = null; // Will find phone below
                        
                        log('📝 NAME: Full name provided', { name: currentSlots.name });
                    } else if (!nameMeta.lastConfirmed && confirmBackEnabled) {
                        // Single token, need to confirm back first
                        nameMeta.lastConfirmed = true;
            
            // ═══════════════════════════════════════════════════════════════════
                        // SMART NAME DETECTION: Use UI-configurable common first names list
                        // to determine if single token is first or last name
                        // 
                        // UI Location: Front Desk → Booking Prompts → Names tab
                        // Admins can add regional/cultural names specific to their clientele
                        //
                        // FALLBACK: If list is empty, DEFAULT TO FIRST NAME (most common case)
                        // People typically say "my name is John" not "my name is Smith"
            // ═══════════════════════════════════════════════════════════════════
                        const commonFirstNames = company.aiAgentSettings?.frontDeskBehavior?.commonFirstNames || [];
                        const commonFirstNamesSet = new Set(commonFirstNames.map(n => n.toLowerCase()));
                        
                        // If list is empty, default to assuming it's a first name
                        // If list has entries, check if the name is in it
                        const listIsEmpty = commonFirstNames.length === 0;
                        const isInList = commonFirstNamesSet.has(extractedName.toLowerCase());
                        const isCommonFirstName = listIsEmpty || isInList;
                        
                        // 🔍 DEBUG: Log commonFirstNames check
                        log('📝 NAME DETECTION DEBUG', {
                            extractedName,
                            extractedNameLower: extractedName.toLowerCase(),
                            commonFirstNamesCount: commonFirstNames.length,
                            commonFirstNamesSample: commonFirstNames.slice(0, 10),
                            listIsEmpty,
                            isInList,
                            isCommonFirstName,
                            hasMarkInList: commonFirstNamesSet.has('mark'),
                            decision: isCommonFirstName ? 'FIRST_NAME' : 'LAST_NAME'
                        });
                        
                        if (isCommonFirstName) {
                            // "Mark", "John", "Sarah" etc. are clearly first names
                            // OR list is empty so we default to first name
                            nameMeta.assumedSingleTokenAs = 'first';
                            nameMeta.first = extractedName;
                            log('📝 NAME: Detected as FIRST name', { 
                                name: extractedName,
                                reason: listIsEmpty ? 'list_empty_default' : 'in_common_names_list'
                            });
                        } else {
                            // Name is NOT in the common first names list
                            // "Subach", "Patel", "Rodriguez" are likely last names
                            nameMeta.assumedSingleTokenAs = 'last';
                            nameMeta.last = extractedName;
                            log('📝 NAME: Assumed as LAST name (not in common first names list)', { name: extractedName });
                        }
                        currentSlots.partialName = extractedName;
                        
                        // ═══════════════════════════════════════════════════════════════════
                        // V31: SPELLING VARIANT CHECK (Mark with K or Marc with C?)
                        // Only ask if: enabled, not asked yet, max asks not exceeded
                        // ═══════════════════════════════════════════════════════════════════
                        const spellingConfig = company.aiAgentSettings?.frontDeskBehavior?.nameSpellingVariants || {};
                        const spellingEnabled = spellingConfig.enabled === true;
                        const maxSpellingAsks = spellingConfig.maxAsksPerCall || 1;
                        const spellingAsksThisCall = nameMeta.spellingAsksCount || 0;
                        
                        // Only check spelling for first names (most common case for variants)
                        const shouldCheckSpelling = spellingEnabled && 
                                                    !nameMeta.askedSpellingVariant && 
                                                    spellingAsksThisCall < maxSpellingAsks &&
                                                    nameMeta.assumedSingleTokenAs === 'first';
                        
                        // 🍿 POPCORN TRAIL: V60 - Spelling variant decision
                        log('🍿 [POPCORN] SPELLING_VARIANT_CHECK', {
                            name: extractedName,
                            shouldCheckSpelling,
                            WHY_NOT: !shouldCheckSpelling ? {
                                spellingEnabled_is: spellingEnabled,
                                alreadyAsked: nameMeta.askedSpellingVariant,
                                maxAsksReached: spellingAsksThisCall >= maxSpellingAsks,
                                notFirstName: nameMeta.assumedSingleTokenAs !== 'first',
                                FIX: !spellingEnabled ? 'Enable "Confirm spelling variants" in Booking Slot editor' :
                                     nameMeta.askedSpellingVariant ? 'Already asked this call' :
                                     nameMeta.assumedSingleTokenAs !== 'first' ? 'Only checks first names' : 'Unknown'
                            } : null,
                            hasPrecomputedMap: !!(spellingConfig.precomputedVariantMap),
                            precomputedMapKeys: spellingConfig.precomputedVariantMap ? Object.keys(spellingConfig.precomputedVariantMap).slice(0, 10) : []
                        });
                        
                        if (shouldCheckSpelling) {
                            const commonFirstNames = company.aiAgentSettings?.frontDeskBehavior?.commonFirstNames || [];
                            const variant = findSpellingVariant(extractedName, spellingConfig, commonFirstNames);
                            
                            // V44 DEBUG: Log variant result
                            log('📝 V44 SPELLING VARIANT RESULT', {
                                name: extractedName,
                                variantFound: !!(variant && variant.hasVariant),
                                variant: variant ? { optionA: variant.optionA, optionB: variant.optionB } : null
                            });
                            
                            if (variant && variant.hasVariant) {
                                // Ask about spelling variant
                                nameMeta.askedSpellingVariant = true;
                                nameMeta.spellingAsksCount = spellingAsksThisCall + 1;
                                nameMeta.pendingSpellingVariant = variant;
                                
                                // V62 FIX: Mark booking as modified so Mongoose persists spelling variant state
                                session.markModified('booking');
                                
                                // V59 NUKE: UI-configured spelling variant script ONLY
                                const script = spellingConfig.script || 'Is that {optionA} with a {letterA} or {optionB} with a {letterB}?';
                                finalReply = script
                                    .replace('{optionA}', variant.optionA)
                                    .replace('{optionB}', variant.optionB)
                                    .replace('{letterA}', variant.letterA)
                                    .replace('{letterB}', variant.letterB);
                                nextSlotId = 'name'; // Still on name
                                
                                log('📝 V31 SPELLING VARIANT: Asking about variant', {
                                    name: extractedName,
                                    optionA: variant.optionA,
                                    optionB: variant.optionB,
                                    script: finalReply
                                });
                            } else {
                                // No variant found, proceed with normal confirm
                                nameMeta.askedSpellingVariant = true; // V48 FIX: Mark as checked
                                nameMeta.spellingVariantAnswer = 'no_variant'; // V48 FIX: Must set to prevent isNameSlotComplete from blocking!
                                const confirmText = confirmBackTemplate.replace('{value}', extractedName);
                                finalReply = confirmText;
                                nextSlotId = 'name';
                                log('📝 NAME: No spelling variant found, confirming partial name', { partial: extractedName });
                            }
                        } else {
                            // Spelling variants disabled or already asked, proceed with normal confirm
                            const confirmText = confirmBackTemplate.replace('{value}', extractedName);
                            finalReply = confirmText;
                            nextSlotId = 'name';
                            log('📝 NAME: Confirming partial name', { partial: extractedName, spellingEnabled, askedSpellingVariant: nameMeta.askedSpellingVariant });
                        }
                    // ═══════════════════════════════════════════════════════════════════
                    // V31: Handle spelling variant response
                    // User answered "K" or "C" or "Mark" or "Marc"
                    // ═══════════════════════════════════════════════════════════════════
                    } else if (nameMeta.askedSpellingVariant && nameMeta.pendingSpellingVariant && !nameMeta.spellingVariantAnswer) {
                        const variant = nameMeta.pendingSpellingVariant;
                        const userTextLower = userText.toLowerCase().trim();
                        
                        // Check what the user answered
                        let chosenName = null;
                        
                        // Check for letter answers: "K", "C", "with a K", "the K"
                        if (userTextLower.includes(variant.letterA.toLowerCase()) && 
                            !userTextLower.includes(variant.letterB.toLowerCase())) {
                            chosenName = variant.optionA;
                        } else if (userTextLower.includes(variant.letterB.toLowerCase()) && 
                                   !userTextLower.includes(variant.letterA.toLowerCase())) {
                            chosenName = variant.optionB;
                        }
                        // Check for name answers: "Mark", "Marc"
                        else if (userTextLower.includes(variant.optionA.toLowerCase())) {
                            chosenName = variant.optionA;
                        } else if (userTextLower.includes(variant.optionB.toLowerCase())) {
                            chosenName = variant.optionB;
                        }
                        // Default to optionA if unclear
                        else {
                            chosenName = variant.optionA;
                            log('📝 V31 SPELLING: Unclear answer, defaulting to optionA', { userText, optionA: variant.optionA });
                        }
                        
                        // Update the name with the correct spelling
                        nameMeta.spellingVariantAnswer = chosenName;
                        nameMeta.first = chosenName;
                        currentSlots.partialName = chosenName;
                        
                        log('📝 V31 SPELLING VARIANT: User chose', { chosenName, userText });
                        
                        // Now proceed to ask for last name or move on
                        if (askFullName) {
                            nameMeta.askedMissingPartOnce = true;
                            // V63: Use UI-configured last name question - NO HARDCODED FALLBACK
                            const lastNameQSpelling = nameSlotConfig?.lastNameQuestion || getMissingConfigPrompt('lastNameQuestion', 'name');
                            finalReply = `Got it, ${chosenName}. ${lastNameQSpelling.replace('{firstName}', chosenName)}`;
                            nextSlotId = 'name';
                        } else {
                            // Accept as complete
                            currentSlots.name = chosenName;
                            session.booking.activeSlot = getSlotIdByType('phone'); session.booking.activeSlotType = 'phone';
                            finalReply = `Got it, ${chosenName}. `;
                            nextSlotId = null;
                        }
                    } else if (nameMeta.lastConfirmed && !nameMeta.askedMissingPartOnce && askFullName) {
                        // V36 FIX: Check if confirmPrompt ALREADY asked for last name
                        // If so, the user's response IS the last name, not a confirmation
                        const confirmPromptAsksForLastName = confirmBackTemplate.toLowerCase().includes('last name');
                        
                        if (confirmPromptAsksForLastName && extractedName) {
                            // User responded to "Got it, Mark. and may I have your last name?" with their last name
                            // So extractedName IS the last name!
                            nameMeta.last = extractedName;
                            nameMeta.askedMissingPartOnce = true;
                            
                            // Build full name
                            const firstName = nameMeta.first || currentSlots.partialName || '';
                            currentSlots.name = `${firstName} ${extractedName}`.trim();
                            session.booking.activeSlot = getSlotIdByType('phone'); session.booking.activeSlotType = 'phone';
                            
                            finalReply = `Perfect, ${firstName}. `;
                            nextSlotId = null; // Move to phone
                            
                            log('📝 V36: confirmPrompt already asked for last name, extracted it directly', {
                                firstName,
                                lastName: extractedName,
                                fullName: currentSlots.name
                            });
                        } else {
                            // confirmPrompt didn't ask for last name, so ask now
                            // V47: Use UI-configured questions - NOT hardcoded
                            nameMeta.askedMissingPartOnce = true;
                            
                            const firstName = nameMeta.first || currentSlots.partialName || '';
                            // V59 NUKE: UI-configured questions ONLY
                            const lastNameQMissing = nameSlotConfig?.lastNameQuestion || getMissingConfigPrompt('lastNameQuestion', 'name');
                            const firstNameQMissing = nameSlotConfig?.firstNameQuestion || getMissingConfigPrompt('firstNameQuestion', 'name');
                            
                            if (nameMeta.assumedSingleTokenAs === 'last') {
                                finalReply = firstName 
                                    ? `Got it, ${firstName}. ${firstNameQMissing.replace('{firstName}', firstName)}`
                                    : firstNameQMissing;
                            } else {
                                finalReply = firstName 
                                    ? `Got it, ${firstName}. ${lastNameQMissing.replace('{firstName}', firstName)}`
                                    : lastNameQMissing;
                            }
                            nextSlotId = 'name'; // Still on name
                            
                            log('📝 V47: Asking for missing part (UI configured)', {
                                askingFor: nameMeta.assumedSingleTokenAs === 'last' ? 'first' : 'last',
                                questionUsed: nameMeta.assumedSingleTokenAs === 'last' ? firstNameQMissing : lastNameQMissing
                            });
                        }
                    } else if (nameMeta.askedMissingPartOnce) {
                        // User provided the missing part
                        if (nameMeta.assumedSingleTokenAs === 'first') {
                            // We had first name (e.g., "Mark"), now got last name
                            nameMeta.last = extractedName;
                        } else {
                            // We had last name (e.g., "Subach"), now got first name
                            nameMeta.first = extractedName;
                        }
                        
                        // V52 FIX: Clear spelling variant wait state if pending
                        if (nameMeta.askedSpellingVariant && !nameMeta.spellingVariantAnswer) {
                            nameMeta.spellingVariantAnswer = 'implicit_resolved';
                            log('📝 V52: Spelling variant implicitly resolved');
                        }
                        
                        // Build full name safely (no undefined)
                        const firstName = nameMeta.first || '';
                        const lastName = nameMeta.last || '';
                        currentSlots.name = `${firstName} ${lastName}`.trim();
                        // V53 FIX: Also update extractedThisTurn so it doesn't overwrite at save time
                        extractedThisTurn.name = currentSlots.name;
                        // V53 FIX: Clear partialName since we now have full name
                        delete currentSlots.partialName;
                        delete extractedThisTurn.partialName;
                        session.booking.activeSlot = getSlotIdByType('phone'); session.booking.activeSlotType = 'phone';
                        
                        // 🎯 DISPLAY NAME: Always use first name for personalization
                        // Never say "Perfect, Walter" when we have "Mark Walter"
                        const displayName = nameMeta.first || currentSlots.name.split(' ')[0] || currentSlots.name;
                        finalReply = `Perfect, ${displayName}. `;
                        nextSlotId = null; // Will find phone below
                        
                        log('📝 NAME: Got missing part, full name is', { 
                            name: currentSlots.name,
                            displayName,
                            first: nameMeta.first,
                            last: nameMeta.last
                        });
                    } else {
                        // askFullName is off, accept single name as complete
                        nameMeta.first = extractedName;
                        currentSlots.name = extractedName;
                        nameMeta.needsLastName = false;
                        
                        // Confirm and move to next slot
                        const displayName = nameMeta.first || extractedName;
                        finalReply = `Got it, ${displayName}. `;
                        nextSlotId = null; // Will find next slot below
                        
                        log('📝 NAME: Accepted as complete', { name: currentSlots.name });
                    }
                }
                // ═══════════════════════════════════════════════════════════════════
                // COMPREHENSIVE SLOT HANDLING WITH ALL UI-CONFIGURED FEATURES
                // ═══════════════════════════════════════════════════════════════════════
                // This implements ALL booking slot features from the UI:
                // - confirmBack + confirmPrompt (all slots)
                // - skipIfKnown (all slots)
                // - offerCallerId + callerIdPrompt (phone)
                // - acceptTextMe (phone)
                // - breakDownIfUnclear (phone + address)
                // - addressConfirmLevel (address)
                // - acceptPartialAddress (address)
                // - offerAsap + offerMorningAfternoon + asapPhrase (time)
                // - spellOutEmail + offerToSendText (email)
                // - selectOptions + allowOther (select)
                // - yesAction + noAction (yesno)
                // - minValue + maxValue + unit (number)
                // ═══════════════════════════════════════════════════════════════════════
                
                // V37 FIX: Ensure session.booking.meta exists FIRST
                session.booking.meta = session.booking.meta || {};
                
                // Initialize meta tracking for all slots
                session.booking.meta.phone = session.booking.meta.phone || { 
                    pendingConfirm: false, 
                    confirmed: false,
                    offeredCallerId: false,
                    breakdownStep: null // null, 'area_code', 'rest'
                };
                session.booking.meta.address = session.booking.meta.address || { 
                    pendingConfirm: false, 
                    confirmed: false,
                    breakdownStep: null // null, 'street', 'city', 'zip'
                };
                session.booking.meta.time = session.booking.meta.time || { 
                    pendingConfirm: false, 
                    confirmed: false,
                    offeredAsap: false
                };
                session.booking.meta.email = session.booking.meta.email || { 
                    pendingConfirm: false, 
                    confirmed: false,
                    spelledOut: false
                };
                
                // Check if user is responding to a confirmBack question
                // V37 FIX: Added "absolutely", "definitely", "certainly", "perfect", "exactly", "that's it", "you got it"
                const userSaysYes = /^(yes|yeah|yep|correct|that's right|right|yup|uh huh|mhm|affirmative|sure|ok|okay|absolutely|definitely|certainly|perfect|exactly|that's it|you got it|sounds good|that works)/i.test(userText.trim());
                const userSaysNoGeneric = /^(no|nope|nah|that's wrong|wrong|incorrect|not right|that's not right)/i.test(userText.trim());
                const userSaysTextMe = /\b(text\s*me|send\s*(me\s+)?a?\s*text|text\s*(is\s+)?(fine|good|ok|okay))\b/i.test(userText.trim());
                
                // Get caller ID from metadata if available
                const callerId = metadata?.callerPhone || callerPhone || null;
            
            // ═══════════════════════════════════════════════════════════════════
                // PHONE SLOT HANDLING (with offerCallerId, acceptTextMe, breakDownIfUnclear)
            // ═══════════════════════════════════════════════════════════════════
                const phoneSlotConfig = bookingSlotsSafe.find(s => (s.slotId || s.id || s.type) === 'phone');
                const phoneMeta = session.booking.meta.phone;
                
                // Check if we should skip phone (skipIfKnown + returning customer)
                const shouldSkipPhone = phoneSlotConfig?.skipIfKnown && customerContext?.isReturning && customerContext?.phone;
                if (shouldSkipPhone && !currentSlots.phone) {
                    currentSlots.phone = customerContext.phone;
                    phoneMeta.confirmed = true;
                    log('📞 PHONE: Skipped (skipIfKnown + returning customer)', { phone: currentSlots.phone });
                }
                
                if (phoneMeta.pendingConfirm && !phoneMeta.confirmed) {
                    if (userSaysYes) {
                        phoneMeta.confirmed = true;
                        phoneMeta.pendingConfirm = false;
                        session.booking.activeSlot = 'address';
                        // V35 FIX: Set finalReply to ask for address (prevents fall-through to breakdown)
                        const addressSlotConfigForPrompt = bookingSlotsSafe.find(s => (s.slotId || s.id || s.type) === 'address');
                        finalReply = "Perfect. " + (addressSlotConfigForPrompt?.question || "What's the service address?");
                        nextSlotId = 'address';
                        log('📞 PHONE: User confirmed, moving to address');
                    } else if (userSaysNoGeneric) {
                        // V37 FIX: Check if user provided a new number along with "no"
                        // "no that's 2393337747" should extract the new number, not just re-ask
                        if (extractedThisTurn.phone) {
                            currentSlots.phone = extractedThisTurn.phone;
                            phoneMeta.pendingConfirm = true; // Confirm the new number
                            const confirmText = (phoneSlotConfig?.confirmPrompt || "Just to confirm, that's {value}, correct?")
                                .replace('{value}', extractedThisTurn.phone);
                            finalReply = confirmText;
                            nextSlotId = 'phone';
                            log('📞 PHONE: User said no but provided new number, confirming', { phone: extractedThisTurn.phone });
                        } else {
                            currentSlots.phone = null;
                            phoneMeta.pendingConfirm = false;
                            // V59 NUKE: UI-configured question ONLY
                            finalReply = "I apologize. " + (phoneSlotConfig?.question || getMissingConfigPrompt('phone_question', 'phone'));
                            nextSlotId = 'phone';
                            log('📞 PHONE: User denied confirmation, re-asking');
                        }
                    } else if (extractedThisTurn.phone) {
                        currentSlots.phone = extractedThisTurn.phone;
                        phoneMeta.pendingConfirm = false;
                        log('📞 PHONE: User provided new number instead of confirming');
                    }
                }
                // Handle breakDownIfUnclear step-by-step collection
                else if (phoneMeta.breakdownStep === 'area_code' && extractedThisTurn.phone) {
                    // User provided area code, now ask for rest
                    phoneMeta.areaCode = extractedThisTurn.phone;
                    phoneMeta.breakdownStep = 'rest';
                    // V54: Use UI-configured prompt (no hardcodes!)
                    // V59 NUKE: UI-configured phone breakdown prompt ONLY
                    finalReply = phoneSlotConfig?.restOfNumberPrompt || getMissingConfigPrompt('restOfNumberPrompt', 'phone');
                    nextSlotId = 'phone';
                    log('📞 PHONE: Got area code, asking for rest');
                }
                else if (phoneMeta.breakdownStep === 'rest' && extractedThisTurn.phone) {
                    // User provided rest of number, combine
                    const fullPhone = `${phoneMeta.areaCode}${extractedThisTurn.phone}`;
                    currentSlots.phone = fullPhone;
                    phoneMeta.breakdownStep = null;
                    phoneMeta.confirmed = true;
                    session.booking.activeSlot = 'address';
                    finalReply = `Perfect, I have ${fullPhone}. `;
                    log('📞 PHONE: Combined breakdown', { phone: fullPhone });
                }
                // Check for "text me" response (acceptTextMe feature)
                else if (userSaysTextMe && phoneSlotConfig?.acceptTextMe && callerId) {
                    currentSlots.phone = callerId;
                    phoneMeta.confirmed = true;
                    session.booking.activeSlot = 'address';
                    finalReply = "Perfect, I'll use the number you're calling from for texts. ";
                    log('📞 PHONE: Accepted "text me" with caller ID', { phone: callerId });
                }
                // Offer caller ID if configured and available
                else if (!currentSlots.phone && !phoneMeta.offeredCallerId && phoneSlotConfig?.offerCallerId && callerId && session.booking.activeSlot === 'phone') {
                    phoneMeta.offeredCallerId = true;
                    const callerIdPrompt = phoneSlotConfig?.callerIdPrompt || 
                        "I see you're calling from {callerId} - is that a good number for text confirmations, or would you prefer a different one?";
                    finalReply = callerIdPrompt.replace('{callerId}', callerId);
                    nextSlotId = 'phone';
                    log('📞 PHONE: Offering caller ID', { callerId });
                }
                // Handle response to caller ID offer
                else if (phoneMeta.offeredCallerId && !currentSlots.phone && userSaysYes && callerId) {
                    currentSlots.phone = callerId;
                    phoneMeta.confirmed = true;
                    session.booking.activeSlot = 'address';
                    finalReply = "Perfect. ";
                    log('📞 PHONE: User accepted caller ID', { phone: callerId });
                }
                else if (phoneMeta.offeredCallerId && !currentSlots.phone && userSaysNoGeneric) {
                    // V59 NUKE: UI-configured question ONLY
                    finalReply = "No problem. " + (phoneSlotConfig?.question || getMissingConfigPrompt('phone_question', 'phone'));
                    nextSlotId = 'phone';
                    log('📞 PHONE: User declined caller ID, asking for number');
                }
                else if (extractedThisTurn.phone && !phoneMeta.confirmed) {
                    const phoneConfirmBack = phoneSlotConfig?.confirmBack === true || phoneSlotConfig?.confirmBack === 'true';
                    const phoneConfirmPrompt = phoneSlotConfig?.confirmPrompt || "Just to confirm, that's {value}, correct?";
                    
                    if (phoneConfirmBack) {
                        phoneMeta.pendingConfirm = true;
                        const confirmText = phoneConfirmPrompt.replace('{value}', extractedThisTurn.phone);
                        finalReply = confirmText;
                        nextSlotId = 'phone';
                        log('📞 PHONE: Confirming back', { phone: extractedThisTurn.phone });
        } else {
                        phoneMeta.confirmed = true;
                        session.booking.activeSlot = 'address';
                        finalReply = 'Got it. ';
                        log('📞 PHONE: Accepted (no confirmBack)', { phone: extractedThisTurn.phone });
                    }
                }
                // Handle unclear phone - trigger breakdown if configured
                // V36 FIX: Only trigger if finalReply not already set (prevents overwriting name confirmation response)
                else if (!finalReply && session.booking.activeSlot === 'phone' && !currentSlots.phone && !phoneMeta.breakdownStep && 
                         phoneSlotConfig?.breakDownIfUnclear && userText.length > 0 && !extractedThisTurn.phone) {
                    phoneMeta.breakdownStep = 'area_code';
                    // V54: Use UI-configured prompt (no hardcodes!)
                    finalReply = "I didn't quite catch that. " + (phoneSlotConfig?.areaCodePrompt || "Let's go step by step - what's the area code?");
                    nextSlotId = 'phone';
                    log('📞 PHONE: Triggering breakdown due to unclear input');
                }
                
            // ═══════════════════════════════════════════════════════════════════
                // ADDRESS SLOT HANDLING (with addressConfirmLevel, acceptPartialAddress, breakDownIfUnclear)
            // ═══════════════════════════════════════════════════════════════════
                const addressSlotConfig = bookingSlotsSafe.find(s => (s.slotId || s.id || s.type) === 'address');
                const addressMeta = session.booking.meta.address;
                
                // Check if we should skip address (skipIfKnown + returning customer)
                const shouldSkipAddress = addressSlotConfig?.skipIfKnown && customerContext?.isReturning && customerContext?.address;
                if (shouldSkipAddress && !currentSlots.address) {
                    currentSlots.address = customerContext.address;
                    addressMeta.confirmed = true;
                    log('🏠 ADDRESS: Skipped (skipIfKnown + returning customer)', { address: currentSlots.address });
                }
                
                if (addressMeta.pendingConfirm && !addressMeta.confirmed) {
                    if (userSaysYes) {
                        addressMeta.confirmed = true;
                        addressMeta.pendingConfirm = false;
                        session.booking.activeSlot = 'time';
                        // V35 FIX: Set finalReply to ask for time (prevents fall-through to breakdown)
                        const timeSlotConfigForPrompt = bookingSlotsSafe.find(s => (s.slotId || s.id || s.type) === 'time');
                        if (timeSlotConfigForPrompt?.required !== false) {
                            // V59 NUKE: UI-configured time slot question ONLY
                            finalReply = "Perfect. " + (timeSlotConfigForPrompt?.question || getMissingConfigPrompt('slot_question', 'time'));
                            nextSlotId = 'time';
                        } else {
                            // Time is optional - finalize booking
                            finalReply = `Perfect. You're all set. We'll be in touch at ${currentSlots.phone} to confirm your appointment.`;
                        }
                        log('🏠 ADDRESS: User confirmed, moving to time');
                    } else if (userSaysNoGeneric) {
                        // V37 FIX: Check if user provided a new address along with "no"
                        // "no that's 123 Main St" should extract the new address, not just re-ask
                        if (extractedThisTurn.address) {
                            currentSlots.address = extractedThisTurn.address;
                            addressMeta.pendingConfirm = true; // Confirm the new address
                            const confirmText = (addressSlotConfig?.confirmPrompt || "Just to confirm, that's {value}, correct?")
                                .replace('{value}', extractedThisTurn.address);
                            finalReply = confirmText;
                            nextSlotId = 'address';
                            log('🏠 ADDRESS: User said no but provided new address, confirming', { address: extractedThisTurn.address });
                        } else {
                            currentSlots.address = null;
                            addressMeta.pendingConfirm = false;
                            finalReply = "I apologize. " + (addressSlotConfig?.question || "What's the service address?");
                            nextSlotId = 'address';
                            log('🏠 ADDRESS: User denied confirmation, re-asking');
                        }
                    } else if (extractedThisTurn.address) {
                        currentSlots.address = extractedThisTurn.address;
                        addressMeta.pendingConfirm = false;
                        log('🏠 ADDRESS: User provided new address instead of confirming');
                    }
                }
                // V35: Handle unit number response (after Google Maps asked for unit)
                else if (addressMeta.unitAsked && !addressMeta.unitCollected && session.booking.activeSlot === 'address') {
                    const userTextTrimmed = userText.trim();
                    const noUnitPhrases = /\b(no|nope|none|n\/a|na|not applicable|no unit|no apartment|just that|that's it|that's all)\b/i;
                    
                    if (noUnitPhrases.test(userTextTrimmed)) {
                        // No unit needed
                        addressMeta.unitCollected = true;
                        addressMeta.confirmed = true;
                        session.booking.activeSlot = 'time';
                        finalReply = `Perfect, got it. `;
                        log('🏠 ADDRESS: No unit needed, moving to time');
                    } else if (userTextTrimmed.length > 0 && userTextTrimmed.length < 20) {
                        // User provided unit number
                        const unitNumber = userTextTrimmed.replace(/^(apt|apartment|unit|suite|ste|#)\s*/i, '').trim();
                        addressMeta.unit = unitNumber;
                        addressMeta.unitCollected = true;
                        addressMeta.confirmed = true;
                        
                        // Append unit to address
                        if (currentSlots.address && unitNumber) {
                            currentSlots.address = `${currentSlots.address}, Unit ${unitNumber}`;
                        }
                        
                        session.booking.activeSlot = 'time';
                        finalReply = `Got it, Unit ${unitNumber}. `;
                        log('🏠 ADDRESS: Unit collected', { unit: unitNumber, fullAddress: currentSlots.address });
                    }
                }
                // Handle breakDownIfUnclear step-by-step collection
                else if (addressMeta.breakdownStep === 'street' && userText.length > 3) {
                    addressMeta.street = userText.trim();
                    addressMeta.breakdownStep = 'city';
                    // V54: Use UI-configured prompt (no hardcodes!)
                    // V59 NUKE: UI-configured city prompt ONLY
                    finalReply = addressSlotConfig?.cityPrompt || getMissingConfigPrompt('cityPrompt', 'address');
                    nextSlotId = 'address';
                    log('🏠 ADDRESS: Got street, asking for city');
                }
                else if (addressMeta.breakdownStep === 'city' && userText.length > 1) {
                    addressMeta.city = userText.trim();
                    // Check addressConfirmLevel to see if we need zip
                    if (addressSlotConfig?.addressConfirmLevel === 'full') {
                        addressMeta.breakdownStep = 'zip';
                        // V54: Use UI-configured prompt (no hardcodes!)
                        // V59 NUKE: UI-configured zip prompt ONLY
                        finalReply = addressSlotConfig?.zipPrompt || getMissingConfigPrompt('zipPrompt', 'address');
                        nextSlotId = 'address';
                        log('🏠 ADDRESS: Got city, asking for zip');
                    } else {
                        // Combine and finish - V34 FIX: Handle missing street gracefully
                        const street = addressMeta.street || currentSlots.address || '';
                        const city = addressMeta.city || '';
                        currentSlots.address = street && city ? `${street}, ${city}` : (street || city);
                        addressMeta.breakdownStep = null;
                        addressMeta.confirmed = true;
                        session.booking.activeSlot = 'time';
                        finalReply = `Perfect, I have ${currentSlots.address}. `;
                        log('🏠 ADDRESS: Combined breakdown (street_city)', { address: currentSlots.address });
                    }
                }
                else if (addressMeta.breakdownStep === 'zip' && userText.length >= 3) {
                    addressMeta.zip = userText.trim();
                    // V34 FIX: Handle missing parts gracefully
                    const street = addressMeta.street || currentSlots.address || '';
                    const city = addressMeta.city || '';
                    const zip = addressMeta.zip || '';
                    const parts = [street, city, zip].filter(Boolean);
                    currentSlots.address = parts.join(', ').replace(/, (\d{5})/, ' $1'); // Format: "123 Main, City 12345"
                    addressMeta.breakdownStep = null;
                    addressMeta.confirmed = true;
                    session.booking.activeSlot = 'time';
                    finalReply = `Perfect, I have ${currentSlots.address}. `;
                    log('🏠 ADDRESS: Combined breakdown (full)', { address: currentSlots.address });
                }
                else if (extractedThisTurn.address && !addressMeta.confirmed) {
                    const addressConfirmBack = addressSlotConfig?.confirmBack === true || addressSlotConfig?.confirmBack === 'true';
                    const addressConfirmPrompt = addressSlotConfig?.confirmPrompt || "Just to confirm, that's {value}, correct?";
                    
                    // V48 FIX: Better "complete address" detection
                    // An address is COMPLETE if it has:
                    // - A ZIP code (5 digits NOT at the start - that's a street number), OR
                    // - A state name/abbreviation, OR
                    // - 5+ words (likely has city/state)
                    
                    // V48: Don't match 5-digit street numbers as ZIP codes
                    // ZIP codes appear AFTER the street address, not at the beginning
                    // Pattern: Match 5 digits that are NOT followed by a street type word
                    const addressWords = extractedThisTurn.address.split(/\s+/);
                    const firstWord = addressWords[0] || '';
                    const streetTypePattern = /^(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|loop|alley|aly|path|crossing|xing|square|sq|plaza|plz|commons|point|pt|ridge|run|pass|grove|park|estates|meadow|meadows|valley|hills|heights|view|vista|landing|springs|creek|glen|cove|bay|beach|shore|pointe)$/i;
                    
                    // V48: A 5-digit number is a ZIP if:
                    // - It's NOT the first word (street numbers come first)
                    // - OR it comes after a state abbreviation
                    const zipMatches = extractedThisTurn.address.match(/\b(\d{5})(-\d{4})?\b/g) || [];
                    let hasZip = false;
                    for (const zipMatch of zipMatches) {
                        const zipDigits = zipMatch.replace(/-\d{4}$/, '');
                        // If this 5-digit number is the first word, it's a street number, not a ZIP
                        if (firstWord === zipDigits) {
                            continue; // Skip - this is likely a street number
                        }
                        // Check if the word AFTER the zip match is NOT a street type (ZIPs don't have street types after them)
                        const afterZipIndex = extractedThisTurn.address.indexOf(zipMatch) + zipMatch.length;
                        const afterZip = extractedThisTurn.address.substring(afterZipIndex).trim().split(/\s+/)[0] || '';
                        if (!streetTypePattern.test(afterZip)) {
                            hasZip = true;
                            break;
                        }
                    }
                    
                    const hasState = /\b(florida|fl|california|ca|texas|tx|new york|ny|georgia|ga|ohio|oh|michigan|mi|arizona|az|colorado|co|illinois|il|alabama|alaska|arkansas|connecticut|delaware|hawaii|idaho|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|north carolina|north dakota|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|al|ak|ar|ct|de|hi|id|in|ia|ks|ky|la|me|md|ma|mn|ms|mo|mt|ne|nv|nh|nj|nm|nc|nd|ok|or|pa|ri|sc|sd|tn|ut|vt|va|wa|wv|wi|wy)\b/i.test(extractedThisTurn.address);
                    const wordCount = addressWords.length;
                    const isCompleteAddress = hasZip || hasState || wordCount >= 5;
                    
                    // Only consider partial if it's truly incomplete
                    const isPartialAddress = !isCompleteAddress && wordCount < 4;
                    
                    log('🏠 ADDRESS: Checking completeness', {
                        address: extractedThisTurn.address,
                        hasZip,
                        hasState,
                        wordCount,
                        isCompleteAddress,
                        isPartialAddress
                    });
                    
                    // ═══════════════════════════════════════════════════════════════════
                    // V35: GOOGLE MAPS ADDRESS VALIDATION (silent background validation)
                    // ═══════════════════════════════════════════════════════════════════
                    let googleMapsResult = null;
                    let googleMapsConfirmNeeded = false;
                    let unitDetectionResult = null;
                    
                    if (addressSlotConfig?.useGoogleMapsValidation) {
                        try {
                            log('🗺️ GOOGLE MAPS: Validating address...', { raw: extractedThisTurn.address });
                            googleMapsResult = await AddressValidationService.validateAddress(
                                extractedThisTurn.address,
                                { companyId, enabled: true }
                            );
                            
                            if (googleMapsResult.success && googleMapsResult.validated) {
                                // Use normalized address from Google
                                currentSlots.address = googleMapsResult.normalized;
                                addressMeta.validated = true;
                                addressMeta.googleMaps = {
                                    normalized: googleMapsResult.normalized,
                                    confidence: googleMapsResult.confidence,
                                    components: googleMapsResult.components,
                                    location: googleMapsResult.location,
                                    placeId: googleMapsResult.placeId
                                };
                                
                                // Check if confirmation or unit prompt is needed
                                const confirmDecision = AddressValidationService.shouldConfirmAddress(
                                    googleMapsResult,
                                    addressSlotConfig,
                                    extractedThisTurn.address // Pass raw address for unit detection
                                );
                                googleMapsConfirmNeeded = confirmDecision.shouldConfirm;
                                unitDetectionResult = {
                                    shouldAsk: confirmDecision.shouldAskUnit,
                                    reason: confirmDecision.unitReason,
                                    trigger: confirmDecision.unitTrigger
                                };
                                
                                log('🗺️ GOOGLE MAPS: Validation complete', {
                                    normalized: googleMapsResult.normalized,
                                    confidence: googleMapsResult.confidence,
                                    needsConfirm: googleMapsConfirmNeeded,
                                    unitDetection: unitDetectionResult
                                });
                            } else {
                                log('🗺️ GOOGLE MAPS: Validation failed or skipped', {
                                    success: googleMapsResult?.success,
                                    validated: googleMapsResult?.validated,
                                    reason: googleMapsResult?.skipReason || googleMapsResult?.failReason
                                });
                            }
                        } catch (gmError) {
                            log('🗺️ GOOGLE MAPS: Error during validation', { error: gmError.message });
                            // Continue without Google Maps - don't block the conversation
                        }
                    }
                    
                    // V35 WORLD-CLASS: Unit detection even without Google Maps
                    if (!unitDetectionResult && addressSlotConfig?.unitNumberMode !== 'never') {
                        unitDetectionResult = AddressValidationService.shouldAskForUnit(
                            extractedThisTurn.address,
                            googleMapsResult,
                            addressSlotConfig
                        );
                        log('🏢 UNIT DETECTION: Standalone check', unitDetectionResult);
                    }
                    
                    if (isPartialAddress && !addressSlotConfig?.acceptPartialAddress) {
                        // V54: Use UI-configured prompt (no hardcodes!)
                        // V59 NUKE: UI-configured partial address prompt ONLY
                        finalReply = addressSlotConfig?.partialAddressPrompt || getMissingConfigPrompt('partialAddressPrompt', 'address');
                        nextSlotId = 'address';
                        log('🏠 ADDRESS: Partial address not accepted, asking for full');
                    }
                    // ═══════════════════════════════════════════════════════════════════
                    // V61: ENTERPRISE CITY DETECTION
                    // Even if acceptPartialAddress is true, we should ask for city
                    // if the address looks like just a street (no city/state/zip)
                    // ═══════════════════════════════════════════════════════════════════
                    else if (!hasZip && !hasState && !addressMeta.askedForCity && 
                             addressSlotConfig?.addressConfirmLevel !== 'street_only') {
                        // V61: Address looks like just street, ask for city
                        // Store what we have and trigger city prompt
                        addressMeta.street = extractedThisTurn.address;
                        addressMeta.askedForCity = true;
                        addressMeta.breakdownStep = 'city';
                        // V59 NUKE: UI-configured city prompt ONLY
                        finalReply = `Got it — ${extractedThisTurn.address}. ` + 
                            (addressSlotConfig?.cityPrompt || getMissingConfigPrompt('cityPrompt', 'address'));
                        nextSlotId = 'address';
                        log('🏠 ADDRESS V61: Got street, asking for city', { 
                            street: extractedThisTurn.address,
                            hasZip,
                            hasState,
                            addressConfirmLevel: addressSlotConfig?.addressConfirmLevel
                        });
                    }
                    // V35 WORLD-CLASS: Ask for unit if detection says we should
                    else if (unitDetectionResult?.shouldAsk && !addressMeta.unitAsked) {
                        addressMeta.unitAsked = true;
                        addressMeta.unitDetectionReason = unitDetectionResult.reason;
                        
                        // Pick a random prompt variant for natural conversation
                        const promptVariants = addressSlotConfig?.unitPromptVariants || [
                            'Is there an apartment or unit number?',
                            "What's the apartment or suite number?",
                            'Is there a unit or building number I should note?'
                        ];
                        const unitPrompt = promptVariants.length > 0 
                            ? promptVariants[Math.floor(Math.random() * promptVariants.length)]
                            // V59 NUKE: UI-configured unit number prompt ONLY
                            : (addressSlotConfig?.unitNumberPrompt || getMissingConfigPrompt('unitNumberPrompt', 'address'));
                        
                        const displayAddress = googleMapsResult?.components?.street && googleMapsResult?.components?.city
                            ? `${googleMapsResult.components.street} in ${googleMapsResult.components.city}`
                            : (googleMapsResult?.normalized || extractedThisTurn.address);
                        finalReply = `Got it — ${displayAddress}. ${unitPrompt}`;
                        nextSlotId = 'address';
                        log('🏢 UNIT: Asking for unit number', { 
                            reason: unitDetectionResult.reason,
                            trigger: unitDetectionResult.trigger,
                            prompt: unitPrompt
                        });
                    }
                    // V35: Confirm if Google Maps says low confidence
                    else if (googleMapsConfirmNeeded && addressSlotConfig?.googleMapsValidationMode !== 'silent') {
                        addressMeta.pendingConfirm = true;
                        const displayAddress = googleMapsResult?.normalized || extractedThisTurn.address;
                        const city = googleMapsResult?.components?.city;
                        const street = googleMapsResult?.components?.street;
                        if (street && city) {
                            finalReply = `Just to confirm — is that ${street} in ${city}?`;
                        } else {
                            finalReply = `Just to confirm — is that ${displayAddress}?`;
                        }
                        nextSlotId = 'address';
                        log('🏠 ADDRESS: Google Maps low confidence, confirming');
                    }
                    else if (addressConfirmBack) {
                        addressMeta.pendingConfirm = true;
                        const displayAddress = googleMapsResult?.normalized || extractedThisTurn.address;
                        const confirmText = addressConfirmPrompt.replace('{value}', displayAddress);
                        finalReply = confirmText;
                        nextSlotId = 'address';
                        log('🏠 ADDRESS: Confirming back', { address: displayAddress });
                    } else {
                        addressMeta.confirmed = true;
                        session.booking.activeSlot = 'time';
                        const displayAddress = googleMapsResult?.normalized || extractedThisTurn.address;
                        const city = googleMapsResult?.components?.city;
                        const street = googleMapsResult?.components?.street;
                        if (street && city && googleMapsResult?.validated) {
                            finalReply = `Perfect — I've got ${street} in ${city}. `;
                        } else {
                            finalReply = 'Perfect. ';
                        }
                        log('🏠 ADDRESS: Accepted', { address: displayAddress, validated: !!googleMapsResult?.validated });
                    }
                }
                // V34 FIX: Handle "I just told you" / "I already said" frustration
                // If user is frustrated and we're in breakdown mode, use whatever we have
                else if (addressMeta.breakdownStep && /\b(told you|already said|just said|i said|gave you|already gave)\b/i.test(userText.toLowerCase())) {
                    // User is frustrated - use whatever address we have
                    const existingAddress = currentSlots.address || addressMeta.street || '';
                    if (existingAddress) {
                        currentSlots.address = existingAddress;
                        addressMeta.breakdownStep = null;
                        addressMeta.confirmed = true;
                        session.booking.activeSlot = 'time';
                        finalReply = `You're right, I apologize. I have ${existingAddress}. `;
                        log('🏠 ADDRESS: User frustrated, using existing address', { address: existingAddress });
                    } else {
                        // No address captured yet - apologize and ask simply
                        addressMeta.breakdownStep = null;
                        // V54: Use UI-configured prompt (no hardcodes!)
                    finalReply = "I apologize for the confusion. " + (addressSlotConfig?.question || "What's the address for the service?");
                        nextSlotId = 'address';
                        log('🏠 ADDRESS: User frustrated but no address captured, asking simply');
                    }
                }
                // Handle unclear address - trigger breakdown if configured
                // V36 FIX: Only trigger if finalReply not already set (prevents overwriting phone confirmation response)
                else if (!finalReply && session.booking.activeSlot === 'address' && !currentSlots.address && !addressMeta.breakdownStep &&
                         addressSlotConfig?.breakDownIfUnclear && userText.length > 0 && !extractedThisTurn.address) {
                    addressMeta.breakdownStep = 'street';
                    // V54: Use UI-configured prompt (no hardcodes!)
                    finalReply = "I didn't quite catch that. " + (addressSlotConfig?.streetBreakdownPrompt || "Let's go step by step - what's the street address?");
                    nextSlotId = 'address';
                    log('🏠 ADDRESS: Triggering breakdown due to unclear input');
                }
                
                // ═══════════════════════════════════════════════════════════════════
                // TIME SLOT HANDLING (with offerAsap, offerMorningAfternoon, asapPhrase)
                // ═══════════════════════════════════════════════════════════════════
                const timeSlotConfig = bookingSlotsSafe.find(s => (s.slotId || s.id || s.type) === 'time');
                const timeMeta = session.booking.meta.time;
                
                if (timeMeta.pendingConfirm && !timeMeta.confirmed) {
                    if (userSaysYes) {
                        timeMeta.confirmed = true;
                        timeMeta.pendingConfirm = false;
                        log('⏰ TIME: User confirmed');
                    } else if (userSaysNoGeneric) {
                        currentSlots.time = null;
                        timeMeta.pendingConfirm = false;
                        // V59 NUKE: UI-configured time question ONLY
                        finalReply = "No problem. " + (timeSlotConfig?.question || getMissingConfigPrompt('slot_question', 'time'));
                        nextSlotId = 'time';
                        log('⏰ TIME: User denied confirmation, re-asking');
                    } else if (extractedThisTurn.time) {
                        currentSlots.time = extractedThisTurn.time;
                        timeMeta.pendingConfirm = false;
                        log('⏰ TIME: User provided new time instead of confirming');
                    }
                }
                // Handle ASAP / today / tomorrow / morning / afternoon responses
                // V34 FIX: Better time handling that feels like real booking
                else if (session.booking.activeSlot === 'time' && !currentSlots.time) {
                    const userTextLower = userText.toLowerCase().trim();
                    
                    // Day preference detection
                    const wantsToday = /\b(today|asap|as soon as possible|soonest|earliest|first available|urgent|emergency|right away|immediately|now)\b/i.test(userTextLower);
                    const wantsTomorrow = /\b(tomorrow|next day)\b/i.test(userTextLower);
                    const wantsThisWeek = /\b(this week|whenever|any day|flexible)\b/i.test(userTextLower);
                    
                    // Time window detection
                    const wantsMorning = /\b(morning|am|before noon|8|9|10|11)\b/i.test(userTextLower) && !/good morning/i.test(userTextLower);
                    const wantsAfternoon = /\b(afternoon|pm|after noon|evening|12|1|2|3|4)\b/i.test(userTextLower) && !/good afternoon/i.test(userTextLower);
                    
                    // Build the time string that feels real
                    let dayPart = '';
                    let windowPart = '';
                    
                    if (wantsToday) dayPart = 'today';
                    else if (wantsTomorrow) dayPart = 'tomorrow';
                    else if (wantsThisWeek) dayPart = 'this week';
                    
                    if (wantsMorning) windowPart = 'morning';
                    else if (wantsAfternoon) windowPart = 'afternoon';
                    
                    // V34 FIX: Build a realistic time string
                    if (dayPart || windowPart) {
                        if (dayPart && windowPart) {
                            currentSlots.time = `${dayPart} ${windowPart}`;
                        } else if (dayPart) {
                            currentSlots.time = dayPart;
                        } else {
                            currentSlots.time = windowPart;
                        }
                        timeMeta.confirmed = true;
                        
                        // V34: More natural response based on what they said
                        if (wantsToday && (wantsMorning || wantsAfternoon)) {
                            finalReply = `Perfect, I'll get you in for ${currentSlots.time}. `;
                        } else if (wantsToday) {
                            finalReply = `Perfect, I'll get someone out today as soon as possible. `;
                            currentSlots.time = 'today ASAP';
                        } else if (wantsTomorrow) {
                            finalReply = `Perfect, ${currentSlots.time} works. `;
                        } else {
                            finalReply = `Perfect, ${currentSlots.time} works. `;
                        }
                        
                        log('⏰ TIME: Accepted', { time: currentSlots.time, dayPart, windowPart });
                    }
                }
                else if (extractedThisTurn.time && !timeMeta.confirmed) {
                    const timeConfirmBack = timeSlotConfig?.confirmBack === true || timeSlotConfig?.confirmBack === 'true';
                    // V59 NUKE: UI-configured confirm prompt ONLY
                    const timeConfirmPrompt = timeSlotConfig?.confirmPrompt || getMissingConfigPrompt('confirmPrompt', 'time');
                    
                    if (timeConfirmBack) {
                        timeMeta.pendingConfirm = true;
                        const confirmText = timeConfirmPrompt.replace('{value}', extractedThisTurn.time);
                        finalReply = confirmText;
                        nextSlotId = 'time';
                        log('⏰ TIME: Confirming back', { time: extractedThisTurn.time });
                    } else {
                        timeMeta.confirmed = true;
                        finalReply = 'Great. ';
                        log('⏰ TIME: Accepted (no confirmBack)', { time: extractedThisTurn.time });
                    }
                }
                
                // ═══════════════════════════════════════════════════════════════════
                // EMAIL SLOT HANDLING (with spellOutEmail, offerToSendText)
                // ═══════════════════════════════════════════════════════════════════
                const emailSlotConfig = bookingSlotsSafe.find(s => (s.slotId || s.id || s.type) === 'email');
                const emailMeta = session.booking.meta.email;
                
                if (emailMeta && extractedThisTurn.email && !emailMeta.confirmed) {
                    const spellOutEmail = emailSlotConfig?.spellOutEmail !== false;
                    const offerToSendText = emailSlotConfig?.offerToSendText;
                    
                    if (spellOutEmail && !emailMeta.spelledOut) {
                        // Spell out the email for confirmation
                        const spelled = extractedThisTurn.email
                            .replace(/@/g, ' at ')
                            .replace(/\./g, ' dot ')
                            .replace(/_/g, ' underscore ')
                            .replace(/-/g, ' dash ');
                        emailMeta.spelledOut = true;
                        emailMeta.pendingConfirm = true;
                        finalReply = `Just to confirm, that's ${spelled}, correct?`;
                        nextSlotId = 'email';
                        log('📧 EMAIL: Spelling out for confirmation', { email: extractedThisTurn.email });
                    } else if (offerToSendText && callerId) {
                        finalReply = `Got it. Would you like me to text a confirmation to ${callerId}?`;
                        nextSlotId = 'email';
                        log('📧 EMAIL: Offering to send text confirmation');
                    } else {
                        emailMeta.confirmed = true;
                        finalReply = 'Got it. ';
                        log('📧 EMAIL: Accepted', { email: extractedThisTurn.email });
                    }
                }
                // ═══════════════════════════════════════════════════════════════════
                // V27: SLOT REFUSAL HANDLING - "I forgot", "I don't know", "skip"
                // ═══════════════════════════════════════════════════════════════════
                // When customer can't provide a required slot, handle gracefully:
                // 1. If slot is REQUIRED: Offer alternatives or LLM intervention
                // 2. If slot is OPTIONAL: Skip and move on
                // 
                // UI-configurable via frontDeskBehavior.slotRefusalHandling
                // ═══════════════════════════════════════════════════════════════════
                const slotRefusalPhrases = /\b(i forgot|forgot|i don't know|don't know|not sure|can't remember|skip|pass|next|move on|i'm not sure|no idea|don't have it|don't have that)\b/i;
                const userRefusedSlot = slotRefusalPhrases.test(userText.toLowerCase());
                
                if (userRefusedSlot && !extractedThisTurn.name && !extractedThisTurn.phone && 
                    !extractedThisTurn.address && !extractedThisTurn.time && !extractedThisTurn.email) {
                    
                    const activeSlotId = session.booking.activeSlot;
                    const activeSlotConfig = bookingSlotsSafe.find(s => 
                        (s.slotId || s.id || s.type) === activeSlotId
                    );
                    const isRequired = activeSlotConfig?.required !== false;
                    
                    // Get refusal handling config from UI (with defaults)
                    const refusalConfig = company.aiAgentSettings?.frontDeskBehavior?.slotRefusalHandling || {};
                    const maxRetries = refusalConfig.maxRetries || 2;
                    const useAlternativePrompt = refusalConfig.useAlternativePrompt !== false;
                    const allowSkipRequired = refusalConfig.allowSkipRequired || false;
                    const llmIntervention = refusalConfig.llmIntervention !== false;
                    
                    // Track refusal attempts
                    // V38 FIX: Ensure session.booking.meta exists first
                    session.booking.meta = session.booking.meta || {};
                    session.booking.meta[activeSlotId] = session.booking.meta[activeSlotId] || {};
                    const slotMeta = session.booking.meta[activeSlotId];
                    slotMeta.refusalCount = (slotMeta.refusalCount || 0) + 1;
                    
                    log('🚫 SLOT REFUSAL DETECTED (V27)', {
                        activeSlot: activeSlotId,
                        isRequired,
                        refusalCount: slotMeta.refusalCount,
                        maxRetries,
                        userText: userText.substring(0, 50)
                    });
                    
                    if (!isRequired) {
                        // Optional slot - skip it
                        slotMeta.skipped = true;
                        slotMeta.confirmed = true;
                        
                        // Find next slot
                        const nextSlotAfterSkip = bookingSlotsSafe.find(s => {
                            const sId = s.slotId || s.id || s.type;
                            const slotOrder = ['name', 'phone', 'address', 'time', 'email'];
                            return slotOrder.indexOf(sId) > slotOrder.indexOf(activeSlotId) && 
                                   s.required && !currentSlots[sId];
                        });
                        
                        if (nextSlotAfterSkip) {
                            session.booking.activeSlot = nextSlotAfterSkip.slotId || nextSlotAfterSkip.id || nextSlotAfterSkip.type;
                            finalReply = "No problem, we can skip that. " + (nextSlotAfterSkip.question || '');
                        } else {
                            finalReply = "No problem, we can skip that. ";
                        }
                        nextSlotId = session.booking.activeSlot;
                        log('🚫 SLOT REFUSAL: Skipped optional slot', { slot: activeSlotId });
                    }
                    else if (slotMeta.refusalCount <= maxRetries && useAlternativePrompt) {
                        // Required slot - try alternative prompt
                        const alternativePrompts = {
                            address: [
                                "That's okay! Is there a cross street or landmark you can give me so we can find you?",
                                "No worries. Can you give me the city and street name? We can look it up.",
                                "I understand. Can you check your phone for the address? I'll wait."
                            ],
                            phone: [
                                "No problem! Is there another number we could reach you at?",
                                "That's okay. Can I use the number you're calling from?",
                                "Would you like to give us an email instead for confirmation?"
                            ],
                            name: [
                                "That's alright! What should we call you?",
                                "No problem - even a first name works for us."
                            ],
                            time: [
                                "No worries! Would morning or afternoon work better for you?",
                                "That's fine - should we just put you down for the first available?"
                            ]
                        };
                        
                        const altPrompts = alternativePrompts[activeSlotId] || [];
                        const promptIndex = Math.min(slotMeta.refusalCount - 1, altPrompts.length - 1);
                        
                        if (altPrompts[promptIndex]) {
                            finalReply = altPrompts[promptIndex];
                            nextSlotId = activeSlotId;
                            log('🚫 SLOT REFUSAL: Using alternative prompt', { 
                                slot: activeSlotId, 
                                attempt: slotMeta.refusalCount 
                            });
                        } else if (llmIntervention) {
                            // No more alternative prompts, let LLM handle
                            slotMeta.llmIntervention = true;
                            log('🚫 SLOT REFUSAL: LLM intervention needed', { slot: activeSlotId });
                            // Don't set finalReply - let it fall through to LLM
                        }
                    }
                    else if (allowSkipRequired) {
                        // Max retries exceeded but admin allows skipping required
                        slotMeta.skipped = true;
                        slotMeta.confirmed = true;
                        currentSlots[activeSlotId] = '[NOT PROVIDED]';
                        
                        const nextSlotAfterSkip = bookingSlotsSafe.find(s => {
                            const sId = s.slotId || s.id || s.type;
                            const slotOrder = ['name', 'phone', 'address', 'time', 'email'];
                            return slotOrder.indexOf(sId) > slotOrder.indexOf(activeSlotId) && 
                                   s.required && !currentSlots[sId];
                        });
                        
                        if (nextSlotAfterSkip) {
                            session.booking.activeSlot = nextSlotAfterSkip.slotId || nextSlotAfterSkip.id || nextSlotAfterSkip.type;
                            finalReply = "I understand. We'll work with what we have. " + (nextSlotAfterSkip.question || '');
                        } else {
                            finalReply = "I understand. We'll work with what we have. ";
                        }
                        nextSlotId = session.booking.activeSlot;
                        log('🚫 SLOT REFUSAL: Skipped required slot (admin allowed)', { slot: activeSlotId });
                    }
                    else if (llmIntervention) {
                        // Let LLM handle the situation
                        slotMeta.llmIntervention = true;
                        log('🚫 SLOT REFUSAL: LLM intervention triggered', { slot: activeSlotId });
                        // Don't set finalReply - let it fall through to LLM below
                    }
                }
                
                // ═══════════════════════════════════════════════════════════════════
                // PARTIAL ANSWER NUDGE - User started but didn't complete
                // "my service address is" without actual address → gentle nudge
                // CRITICAL: Only trigger if NO actual data was extracted this turn
                // "my name is Mark" should NOT trigger nudge - Mark was extracted!
            // ═══════════════════════════════════════════════════════════════════
                else if (!extractedThisTurn.name && !extractedThisTurn.phone && 
                         !extractedThisTurn.address && !extractedThisTurn.time) {
                    const userTextLower = userText.toLowerCase().trim();
                    
                    // Partial address: "my address is" but no actual address content
                    // Must end with "is" or have very little after it
                    const addressMatch = userTextLower.match(/^(my\s+)?(service\s+)?address\s+(is|would be|at)\s*(.*)$/i);
                    const isPartialAddress = addressMatch && (!addressMatch[4] || addressMatch[4].length < 5);
                    
                    // Partial phone: "my phone is" or "my number is" but no digits
                    const phoneMatch = userTextLower.match(/^(my\s+)?(phone|number|cell)\s+(is|number)\s*(.*)$/i);
                    const isPartialPhone = phoneMatch && (!phoneMatch[4] || !/\d{3,}/.test(phoneMatch[4]));
                    
                    // Partial name: "my name is" but nothing after OR very short (< 2 chars)
                    const nameMatch = userTextLower.match(/^(my\s+)?name\s+(is|would be)\s*(.*)$/i);
                    const isPartialName = nameMatch && (!nameMatch[3] || nameMatch[3].trim().length < 2);
                    
                    // V54: Use UI-configured nudge prompts (no hardcodes!)
                    const loopPrevention = company?.aiAgentSettings?.frontDeskBehavior?.loopPrevention || {};
                    if (isPartialAddress) {
                        finalReply = loopPrevention.nudgeAddressPrompt || "No problem — go ahead with the street address, and include unit number if you have one.";
                        log('📝 NUDGE: Partial address detected, giving gentle nudge');
                    } else if (isPartialPhone) {
                        finalReply = loopPrevention.nudgePhonePrompt || "Sure — go ahead with the area code first.";
                        log('📝 NUDGE: Partial phone detected, giving gentle nudge');
                    } else if (isPartialName) {
                        finalReply = loopPrevention.nudgeNamePrompt || "Sure — go ahead.";
                        log('📝 NUDGE: Partial name detected, giving gentle nudge');
                    }
                }
                
                // ═══════════════════════════════════════════════════════════════════
                // V34: STRICT STATE-DRIVEN SLOT SELECTION (VALUE BEATS META)
                // ═══════════════════════════════════════════════════════════════════
                // Uses helper functions: isSlotComplete(), isNameSlotComplete(), etc.
                // 
                // THE GOLDEN RULE: If we have a value, the slot is complete.
                // 
                // ANTI-REPEAT GUARDRAIL: If user just provided a slot value this turn,
                // that slot is NOT eligible to be asked again.
                // ═══════════════════════════════════════════════════════════════════
                if (nextSlotId === null) {
                    // Log current slot state for debugging
                    log('🔍 V34: COMPUTING NEXT SLOT - Current state:', {
                        'currentSlots.name': currentSlots.name,
                        'currentSlots.partialName': currentSlots.partialName,
                        'currentSlots.phone': currentSlots.phone,
                        'currentSlots.address': currentSlots.address,
                        'currentSlots.time': currentSlots.time,
                        'extractedThisTurn': JSON.stringify(extractedThisTurn),
                        'activeSlot': session.booking.activeSlot
                    });
                    
                    // Build state summary for LLM (prevents goldfish memory)
                    const stateSummary = buildStateSummaryForLLM(currentSlots, bookingSlotsSafe, session);
                    log('📋 V34: State Summary:', { stateSummary });
                    
                    const nextMissingSlotSafe = bookingSlotsSafe.find(slot => {
                        const slotId = slot.slotId || slot.id || slot.type;
                        const slotType = slot.type;
                        
                        // V48: ANTI-REPEAT GUARDRAIL - check BOTH slotId AND type
                        // Data may be stored under type key (name, phone) not custom slot IDs
                        if (extractedThisTurn[slotId] || extractedThisTurn[slotType]) {
                            log(`🚫 V48 ANTI-REPEAT: Slot ${slotType || slotId} was just extracted, skipping`, {
                                value: extractedThisTurn[slotId] || extractedThisTurn[slotType]
                            });
                            return false; // Not eligible
                        }
                        
                        // V34: Use helper function for completion check
                        const isComplete = isSlotComplete(slotId, currentSlots, session, slot);
                        
                        // V48: Log the correct value (check both keys)
                        const slotValue = currentSlots[slotId] || currentSlots[slotType];
                        log(`🔍 V48: Slot ${slotType || slotId} check:`, {
                            slotId,
                            slotType,
                            value: slotValue?.substring?.(0, 20) || slotValue,
                            isComplete,
                            required: slot.required,
                            eligible: slot.required && !isComplete
                        });
                        
                        return slot.required && !isComplete;
                    });
                    
                    // Log the result of slot selection
                    if (nextMissingSlotSafe) {
                        log('✅ V33: NEXT SLOT SELECTED:', {
                            nextSlot: nextMissingSlotSafe.slotId || nextMissingSlotSafe.id || nextMissingSlotSafe.type,
                            reason: 'First required incomplete slot'
                        });
                    } else {
                        log('✅ V33: ALL SLOTS COMPLETE - Ready for finalization');
                    }
                    
                    if (nextMissingSlotSafe) {
                        nextSlotId = nextMissingSlotSafe.slotId || nextMissingSlotSafe.id || nextMissingSlotSafe.type;
                        
                        // ═══════════════════════════════════════════════════════════════
                        // V33: ANTI-LOOP BREAKER + PROMPT VARIANTS
                        // ═══════════════════════════════════════════════════════════════
                        // 1. Track how many times we've asked this slot
                        // 2. Use different phrasing each time (variants)
                        // 3. After max attempts, escalate (transfer offer)
                        // ═══════════════════════════════════════════════════════════════
                        // V38 FIX: Ensure session.booking.meta exists first
                        session.booking.meta = session.booking.meta || {};
                        session.booking.meta[nextSlotId] = session.booking.meta[nextSlotId] || {};
                        const askedCount = session.booking.meta[nextSlotId].askedCount || 0;
                        
                        // Loop prevention (UI-controlled)
                        // DEFAULT - OVERRIDE IN UI: configure in Control Plane → Front Desk → Loops / Escalation
                        const lp = company.aiAgentSettings?.frontDeskBehavior?.loopPrevention || {};
                        const lpEnabled = lp.enabled !== false;
                        const maxAttemptsPerSlot = lpEnabled
                            ? (typeof lp.maxSameQuestion === 'number' ? lp.maxSameQuestion : 2)
                            : 999; // effectively disabled
                        // V59 NUKE: UI-configured rephrase intro ONLY
                        const rephraseIntro = (lp.rephraseIntro || getMissingConfigPrompt('rephrase_intro', 'loopPrevention')).toString();
                        const escalationCfg = company.aiAgentSettings?.frontDeskBehavior?.escalation || {};
                        const escalationScript =
                            lp.onLoop ||
                            escalationCfg.offerMessage ||
                            escalationCfg.transferMessage ||
                            "DEFAULT - OVERRIDE IN UI: No problem — I can connect you to our team or take a message. Which would you prefer?";
                        
                        // Check if we've exceeded max attempts (ANTI-LOOP BREAKER)
                        if (askedCount >= maxAttemptsPerSlot) {
                            log('🚨 V33: ANTI-LOOP BREAKER TRIGGERED', { 
                                slotId: nextSlotId, 
                                askedCount, 
                                maxAttemptsPerSlot 
                            });
                            
                            // Offer escalation/transfer
                            finalReply = escalationScript;
                            session.booking.meta[nextSlotId].escalated = true;
                            
                            // Don't increment askedCount anymore
                        } else {
                            // Use reprompt variant if asked multiple times
                            let exactQuestion;
                            if (askedCount >= 2 && DEFAULT_PROMPT_VARIANTS.reprompt[nextSlotId]) {
                                // Use reprompt variant (more helpful phrasing)
                                exactQuestion = getVariant(DEFAULT_PROMPT_VARIANTS.reprompt[nextSlotId], askedCount - 2);
                                log('📋 V33: Using REPROMPT variant', { slotId: nextSlotId, askedCount });
                            } else if (askedCount >= 1) {
                                // Second ask - use a different variant
                                exactQuestion = getSlotPromptVariant(nextMissingSlotSafe, nextSlotId, askedCount);
                                log('📋 V33: Using variant #' + askedCount, { slotId: nextSlotId });
                            } else {
                                // First ask - use primary prompt from UI
                                exactQuestion = nextMissingSlotSafe.question || 
                                    getSlotPromptVariant(nextMissingSlotSafe, nextSlotId, 0);
                                log('📋 V33: Using PRIMARY prompt from UI', { slotId: nextSlotId });
                            }

                            // Loop prevention (UI-controlled): on reprompts (askedCount >= 1), prepend rephrase intro
                            if (lpEnabled && askedCount >= 1 && rephraseIntro) {
                                exactQuestion = `${rephraseIntro}${exactQuestion}`.replace(/\s{2,}/g, ' ').trim();
                                log('🔁 LOOP PREVENTION: Rephrasing intro applied (booking mode)', { slotId: nextSlotId, askedCount });
                            }
                            session.booking.meta[nextSlotId].askedCount = askedCount + 1;
                            
                            // Check if we're waiting for confirmation (don't re-ask the question)
                            const slotMeta = session.booking.meta[nextSlotId] || {};
                            if (!slotMeta.pendingConfirm) {
                                // Not pending confirm, ask the question
                                finalReply += exactQuestion;
                                log('📋 BOOKING SAFETY NET: Asking next slot', { 
                                    slotId: nextSlotId, 
                                    question: exactQuestion,
                                    askedCount: askedCount + 1,
                                    finalReply
                                });
                            } else {
                                // Pending confirm - don't add question, just use the confirm text already set
                                log('📋 BOOKING SAFETY NET: Slot pending confirmation', { 
                                    slotId: nextSlotId,
                                    finalReply
                                });
                            }
                        }
                    }
                }
                
                if (nextSlotId) {
                    // V37 FIX: Update activeSlot so next turn knows what we're expecting
                    session.booking.activeSlot = nextSlotId;
                    
                    // Save session state before responding (persist mode + booking meta)
                    session.markModified('booking');
                
                aiResult = {
                        reply: finalReply,
                        conversationMode: 'booking',
                        intent: 'booking',
                        nextGoal: `COLLECT_${nextSlotId.toUpperCase()}`,
                    filledSlots: currentSlots,
                        signals: { 
                            wantsBooking: true,
                            consentGiven: true
                        },
                    latencyMs: aiLatencyMs,
                    tokensUsed: 0,
                    fromStateMachine: true,
                        mode: 'BOOKING',
                        debug: {
                            source: 'BOOKING_SAFETY_NET',
                            stage: 'booking',
                            step: nextSlotId,
                            nameMeta: session.booking.meta.name,
                            extractedThisTurn
                        }
                    };
                } else if (bookingSlotsSafe.length === 0) {
                    // ═══════════════════════════════════════════════════════════════
                    // GUARDRAIL: BLOCK FAKE BOOKING WHEN NO SLOTS CONFIGURED
                    // ═══════════════════════════════════════════════════════════════
                    // If bookingSlotsSafe is empty, we can't finalize - the config is broken
                    // This prevents "You're all set!" when booking prompts aren't wired
                    // CRITICAL: Do NOT hardcode any questions here - just acknowledge and hold
                    // The real fix is to configure booking slots in the UI
                    // ═══════════════════════════════════════════════════════════════
                    log('🚫 BOOKING_BLOCKED_NOT_CONFIGURED: Cannot finalize booking - no slots configured', {
                        bookingEnabled: true,
                        effectiveSlotCount: 0,
                        source: bookingConfigSafe.source
                    });
                    
                    // SAFE RESPONSE: Acknowledge but don't ask for anything specific (no hardcoded prompts!)
                    // This is a system error state - booking slots aren't wired correctly
                    aiResult = {
                        reply: "Got it, I have your information. Let me check on availability and someone from our team will follow up with you shortly to confirm the appointment.",
                        conversationMode: 'complete',
                        intent: 'booking_config_error_fallback',
                        nextGoal: 'END_CALL_GRACEFULLY',
                        signals: { 
                            wantsBooking: true,
                            consentGiven: true,
                            bookingBlocked: true,
                            bookingBlockedReason: 'NOT_CONFIGURED'
                        },
                        latencyMs: Date.now() - aiStartTime,
                        tokensUsed: 0,
                        fromStateMachine: true,
                        mode: 'COMPLETE',
                        debug: {
                            source: 'BOOKING_BLOCKED_NOT_CONFIGURED',
                            effectiveSlotCount: 0,
                            configSource: bookingConfigSafe.source,
                            note: 'Admin must configure booking slots in Front Desk > Booking Prompts'
                        }
                    };
                    
                    // Set mode to COMPLETE so we don't loop
                    session.mode = 'COMPLETE';
                    session.markModified('mode');
                } else {
                    // ═══════════════════════════════════════════════════════════════
                    // ALL REQUIRED SLOTS COLLECTED - FINALIZE BOOKING
                    // ═══════════════════════════════════════════════════════════════
                    // Use the configurable Booking Outcome system:
                    // - Creates BookingRequest record
                    // - Returns UI-configured final script
                    // - No hardcoded "technician will reach out" unless enabled
                    // ═══════════════════════════════════════════════════════════════
                    log('✅ BOOKING COMPLETE: All required slots collected - finalizing');

                    // Unit of Work handling (feature flag, UI-controlled)
                    const uowConfig = company.aiAgentSettings?.frontDeskBehavior?.unitOfWork || {};
                    const uowEnabled = uowConfig.enabled === true;
                    const uowAllowMultiple = uowConfig.allowMultiplePerCall === true;
                    const uowConfirm = uowConfig.confirmation || {};
                    const uowMaxUnits = typeof uowConfig.maxUnitsPerCall === 'number' ? uowConfig.maxUnitsPerCall : 3;

                    // Finalize booking with configurable outcome (creates BookingRequest record)
                    const finalizationResult = await finalizeBooking(session, company, currentSlots, {
                        channel,
                        callSid: metadata?.callSid || null,
                        callerPhone: callerPhone || null,
                        serviceType: session.discovery?.serviceType || null
                    });

                    // Persist outcomeMode for KPI trace / audit
                    session.booking.outcomeMode = finalizationResult.outcomeMode;
                    session.markModified('booking');
                    
                    log('📋 BOOKING FINALIZED', {
                        success: finalizationResult.success,
                        bookingRequestId: finalizationResult.bookingRequestId,
                        caseId: finalizationResult.caseId,
                        outcomeMode: finalizationResult.outcomeMode,
                        isAsap: finalizationResult.isAsap,
                        requiresTransfer: finalizationResult.requiresTransfer
                    });

                    if (uowEnabled) {
                        session.unitOfWork = session.unitOfWork || {
                            activeUnitIndex: 0,
                            units: [{ index: 1, createdAt: new Date(), bookingRequestId: null, finalScript: null }],
                            awaitingAddAnother: false
                        };

                        const unitIndex = session.unitOfWork.activeUnitIndex || 0;
                        session.unitOfWork.units = session.unitOfWork.units || [];
                        const unit = session.unitOfWork.units[unitIndex] || { index: unitIndex + 1 };
                        unit.bookingRequestId = finalizationResult.bookingRequestId;
                        unit.finalScript = finalizationResult.finalScript;
                        session.unitOfWork.units[unitIndex] = unit;
                        session.markModified('unitOfWork');

                        const unitCount = session.unitOfWork.units.length;
                        const canAskAddAnother = uowAllowMultiple && unitCount < uowMaxUnits;

                        if (canAskAddAnother) {
                            // Stay in BOOKING mode until caller confirms no more units
                            session.mode = 'BOOKING';
                            session.unitOfWork.awaitingAddAnother = true;
                            session.markModified('mode');
                            session.markModified('unitOfWork');

                            // V59 NUKE: UI-configured ask another prompt ONLY
                            const askAnother = uowConfirm.askAddAnotherPrompt || getMissingConfigPrompt('askAddAnotherPrompt', 'unitOfWork');

                            aiResult = {
                                reply: askAnother,
                                conversationMode: 'booking',
                                intent: 'uow_ask_add_another',
                                nextGoal: 'UOW_CONFIRM',
                                filledSlots: currentSlots,
                                signals: { wantsBooking: true, consentGiven: true, bookingUnitCaptured: true, uowCount: unitCount },
                                latencyMs: Date.now() - aiStartTime,
                                tokensUsed: 0,
                                fromStateMachine: true,
                                mode: 'BOOKING',
                                debug: {
                                    source: 'UOW_UNIT_CAPTURED',
                                    unitIndex: unitIndex + 1,
                                    bookingRequestId: finalizationResult.bookingRequestId
                                }
                            };
                        } else {
                            // Not allowed to add more units; complete now.
                            session.mode = 'COMPLETE';
                            session.booking.completedAt = new Date();
                            session.booking.bookingRequestId = finalizationResult.bookingRequestId;
                            session.booking.bookingRequestIds = (session.unitOfWork.units || [])
                                .map(u => u.bookingRequestId)
                                .filter(Boolean);
                            session.booking.outcomeMode = finalizationResult.outcomeMode;
                            session.markModified('booking');
                            session.markModified('mode');

                            const finalScript = (session.unitOfWork.units.length > 1)
                                ? (uowConfirm.finalScriptMulti || finalizationResult.finalScript)
                                : finalizationResult.finalScript;

                            aiResult = {
                                reply: finalScript,
                                conversationMode: 'complete',
                                intent: 'booking_complete_multi_uow',
                                nextGoal: finalizationResult.requiresTransfer ? 'TRANSFER' : 'END_CALL',
                                filledSlots: currentSlots,
                                signals: { 
                                    wantsBooking: true,
                                    consentGiven: true,
                                    bookingComplete: true,
                                    requiresTransfer: finalizationResult.requiresTransfer,
                                    uowCount: session.unitOfWork.units.length
                                },
                                latencyMs: Date.now() - aiStartTime,
                                tokensUsed: 0,
                                fromStateMachine: true,
                                mode: 'COMPLETE',
                                debug: {
                                    source: 'UOW_BOOKING_COMPLETE_FINALIZED',
                                    bookingRequestId: finalizationResult.bookingRequestId,
                                    caseId: finalizationResult.caseId,
                                    outcomeMode: finalizationResult.outcomeMode
                                }
                            };
                        }
                    } else {
                        // Legacy single-booking completion
                        session.mode = 'COMPLETE';
                        session.booking.completedAt = new Date();
                        session.booking.bookingRequestId = finalizationResult.bookingRequestId;
                        session.booking.outcomeMode = finalizationResult.outcomeMode;
                        session.markModified('booking');
                    
                        aiResult = {
                            reply: finalizationResult.finalScript,
                            conversationMode: 'complete',
                            intent: 'booking_complete',
                            nextGoal: finalizationResult.requiresTransfer ? 'TRANSFER' : 'END_CALL',
                            filledSlots: currentSlots,
                            signals: { 
                                wantsBooking: true,
                                consentGiven: true,
                                bookingComplete: true,
                                requiresTransfer: finalizationResult.requiresTransfer
                            },
                            latencyMs: Date.now() - aiStartTime,
                            tokensUsed: 0,
                            fromStateMachine: true,
                            mode: 'COMPLETE',
                            debug: {
                                source: 'BOOKING_COMPLETE_FINALIZED',
                                stage: 'complete',
                                collectedSlots: Object.keys(currentSlots).filter(k => currentSlots[k]),
                                bookingRequestId: finalizationResult.bookingRequestId,
                                caseId: finalizationResult.caseId,
                                outcomeMode: finalizationResult.outcomeMode,
                                isAsap: finalizationResult.isAsap,
                                status: finalizationResult.status
                            }
                        };
                    }
                }
            }
            } else {
            // ═══════════════════════════════════════════════════════════════════
            // V22: LLM-LED DISCOVERY MODE
            // ═══════════════════════════════════════════════════════════════════
            // 
            // THE GOLDEN RULE: "Nothing should bypass the LLM during discovery."
            // 
            // KILL SWITCH ENFORCEMENT:
            // - forceLLMDiscovery = true → LLM ALWAYS speaks (no state machine)
            // - disableScenarioAutoResponses = true → Scenarios are context only
            // 
            // FLOW:
            // 1. Retrieve relevant scenarios (TOOLS, not scripts)
            // 2. Detect caller emotion (lightweight heuristic)
            // 3. Build LLM prompt with scenario knowledge
            // 4. LLM responds naturally using the knowledge
            // 5. Check for consent (if detected, next turn = BOOKING)
            // 
            // The LLM is the PRIMARY BRAIN. Scenarios are just knowledge tools.
            // ═══════════════════════════════════════════════════════════════════
            
            log('CHECKPOINT 9b: 🧠 V22 LLM-LED DISCOVERY MODE', {
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
                template: activeTemplate
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
            // 🆕 DETERMINISTIC ISSUE CAPTURE (from scenario tools)
            // ═══════════════════════════════════════════════════════════════════
            // If we retrieved a problem scenario, capture the issue in state even if regex keywords fail.
            try {
                const topTool = Array.isArray(scenarioRetrieval.scenarios) ? scenarioRetrieval.scenarios[0] : null;
                const hasTool = !!(topTool?.title && topTool?.scenarioId);
                const scenarioType = String(topTool?.scenarioType || '').toUpperCase();
                const toolLooksLikeProblem = hasTool && !['SMALL_TALK', 'SYSTEM'].includes(scenarioType);
                
                if (toolLooksLikeProblem && !session.discovery?.issue) {
                    session.discovery = session.discovery || {};
                    session.discovery.issue = String(topTool.title).trim();
                    session.discovery.issueConfidence = Number.isFinite(topTool.confidence)
                        ? Math.max(0, Math.min(1, Number(topTool.confidence) / 100))
                        : 0;
                    session.discovery.issueCapturedAtTurn = (session.metrics?.totalTurns || 0) + 1;
                    
                    session.locks.issueCaptured = true;
                    
                    session.memory.facts = session.memory.facts || {};
                    session.memory.facts.issue = session.discovery.issue;
                    
                    log('🧷 DETERMINISTIC ISSUE CAPTURED (scenario tool)', {
                        issue: session.discovery.issue,
                        scenarioId: topTool.scenarioId,
                        confidence: topTool.confidence
                    });
                }
            } catch (e) {
                log('⚠️ Deterministic issue capture failed (non-fatal)', { error: e.message });
            }
            
            // ═══════════════════════════════════════════════════════════════════
            // Step 1.5: CHEAT SHEET FALLBACK (PHASE 1)
            // ═══════════════════════════════════════════════════════════════════
            // Order of precedence for DISCOVERY knowledge:
            // 1. 3-Tier Scenarios (primary)
            // 2. Cheat Sheets (fallback)
            // 3. Generic LLM (last resort)
            // ═══════════════════════════════════════════════════════════════════
            let cheatSheetKnowledge = null;
            let cheatSheetUsed = false;
            let cheatSheetReason = null;
            
            // Only use cheat sheets as fallback if no strong scenario match
            const hasStrongScenarioMatch = scenarioRetrieval.scenarios?.length > 0 && 
                                           scenarioRetrieval.scenarios[0]?.confidence > 0.6;
            
            if (!hasStrongScenarioMatch && cheatSheetConfig) {
                // Search cheat sheets for relevant content
                const cheatSheetMatch = searchCheatSheets(cheatSheetConfig, userText);
                if (cheatSheetMatch) {
                    cheatSheetKnowledge = cheatSheetMatch;
                    cheatSheetUsed = true;
                    cheatSheetReason = 'discovery_fallback';
                    log('CHECKPOINT 9c.1: 📋 Cheat sheet fallback activated', {
                        category: cheatSheetMatch.category,
                        matchedItem: cheatSheetMatch.title || cheatSheetMatch.question,
                        reason: cheatSheetReason
                    });
                }
            }
            
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
            const discoveryConfig = company.aiAgentSettings?.frontDeskBehavior?.discovery || {};
            const maxDiscoveryTurns = discoveryConfig.maxDiscoveryTurns ?? 1;  // Default: 1 turn
            
            // Track discovery turns
            session.discovery = session.discovery || {};
            session.discovery.turnCount = (session.discovery.turnCount || 0) + 1;
            const discoveryTurnCount = session.discovery.turnCount;
            
            // Detect if caller described an issue (service request)
            const issueKeywords = /not (cooling|heating|working)|broken|leaking|won't (turn on|start)|making noise|stopped|no (air|heat|cold)|issues?|problem/i;
            const callerDescribedIssue = issueKeywords.test(userText);
            
            // If issue detected, capture it
            if (callerDescribedIssue && !session.discovery.issue) {
                // Extract a summary of the issue
                const issueMatch = userText.match(issueKeywords);
                session.discovery.issue = userText.substring(0, 100); // First 100 chars as summary
                session.discovery.issueCapturedAtTurn = discoveryTurnCount;
                log('📝 V31: Issue captured from caller', { issue: session.discovery.issue });
            }
            
            // Check if we should auto-offer scheduling
            const hasIssue = !!session.discovery.issue;
            const exceededMaxTurns = discoveryTurnCount > maxDiscoveryTurns;
            const shouldAutoOffer = hasIssue || exceededMaxTurns;
            
            log('CHECKPOINT 9d.0: 🔄 V31 Discovery Turn Check', {
                discoveryTurnCount,
                maxDiscoveryTurns,
                hasIssue,
                exceededMaxTurns,
                shouldAutoOffer,
                callerDescribedIssue
            });
            
            // ═══════════════════════════════════════════════════════════════════
            // V31: AUTO-OFFER SCHEDULING (if issue understood)
            // ═══════════════════════════════════════════════════════════════════
            // Once we understand the issue, don't ask more diagnostic questions.
            // Offer to schedule immediately. Caller can still ask questions.
            // ═══════════════════════════════════════════════════════════════════
            const modeSwitchingCfg = company.aiAgentSettings?.frontDeskBehavior?.modeSwitching || {};
            const minTurnsBeforeBooking = Number.isFinite(modeSwitchingCfg.minTurnsBeforeBooking)
                ? modeSwitchingCfg.minTurnsBeforeBooking
                : 2;

            if (shouldAutoOffer && !session.discovery.offeredScheduling && currentTurnNumber >= minTurnsBeforeBooking) {
                // Get empathy variant
                const empathyVariants = discoveryConfig.empathyVariants || DEFAULT_PROMPT_VARIANTS.empathy;
                const empathyLine = getVariant(empathyVariants);
                
                // Get offer variant
                const offerVariants = discoveryConfig.offerVariants || DEFAULT_PROMPT_VARIANTS.offerScheduling;
                const offerLine = getVariant(offerVariants);
                
                // Build natural response: Empathy + Offer
                const autoOfferResponse = `${empathyLine} ${offerLine}`;
                
                session.discovery.offeredScheduling = true;
                session.lastAgentIntent = 'OFFER_SCHEDULE';
                
                log('🎯 V31 AUTO-OFFER: Offering scheduling after issue understood', {
                    empathyLine,
                    offerLine,
                    discoveryTurnCount,
                    issue: session.discovery.issue?.substring(0, 50)
                });
                
                aiLatencyMs = Date.now() - aiStartTime;
                
                aiResult = {
                    reply: autoOfferResponse,
                    conversationMode: 'discovery',
                    intent: 'auto_offer_scheduling',
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
            const autoRescueOnFrustration = modeSwitchingCfg.autoRescueOnFrustration !== false;
            if (fastPathTriggered || (autoRescueOnFrustration && fastPathEnabled && exceededMaxQuestions && emotion.emotion === 'frustrated')) {
                const offerScript = fastPathConfig.offerScript || 
                    "Got it — I completely understand. We can get someone out to you. Would you like me to schedule a technician now?";
                const oneQuestionScript = fastPathConfig.oneQuestionScript || "";
                
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
                    intent: 'fast_path_offer',
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
            // Step 3: Build discovery prompt with scenario knowledge + cheat sheet fallback
            // V33: Pass collectedSlots so LLM can acknowledge caller's name
            const discoveryPrompt = LLMDiscoveryEngine.buildDiscoveryPrompt({
                company,
                scenarios: scenarioRetrieval.scenarios,
                emotion,
                session: {
                    ...session.toObject ? session.toObject() : session,
                    collectedSlots: currentSlots  // V33: Include current slots for name acknowledgment
                },
                // V23: Pass cheat sheet as fallback knowledge
                cheatSheetKnowledge: cheatSheetKnowledge
            });
            
            // Step 4: Build context for LLM
            // ═══════════════════════════════════════════════════════════════════
            // V31: STATE SUMMARY - Prevents goldfish memory / repetition
            // ═══════════════════════════════════════════════════════════════════
            const stateSummary = {
                problem: session.discovery?.issue || 'Not yet captured',
                collectedSlots: Object.keys(currentSlots).filter(k => currentSlots[k]).map(k => `${k}=${currentSlots[k]}`),
                missingSlots: ['name', 'phone', 'address', 'time'].filter(s => !currentSlots[s]),
                discoveryTurnCount: session.discovery?.turnCount || 0,
                offeredScheduling: session.discovery?.offeredScheduling || false,
                lastAgentIntent: session.lastAgentIntent || null
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

                    // Legacy behavior:
                    // - disableScenarioAutoResponses=false → all scenarios may be used verbatim
                    // - disableScenarioAutoResponses=true  → context-only by default, but allowlist can override per scenario type
                    const getUsageModeForScenario = (s) => {
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
                    defaultMode: killSwitches.disableScenarioAutoResponses ? 'context_only' : 'may_verbatim',
                    allowVerbatimScenarioTypes: Array.isArray(killSwitches.autoReplyAllowedScenarioTypes) ? killSwitches.autoReplyAllowedScenarioTypes : []
                },
                
                // ═══════════════════════════════════════════════════════════════
                // CHEAT SHEET KNOWLEDGE (PHASE 1 - Discovery Fallback)
                // ═══════════════════════════════════════════════════════════════
                cheatSheetKnowledge: cheatSheetKnowledge,
                cheatSheetUsed: cheatSheetUsed,
                cheatSheetReason: cheatSheetReason,
                
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
                
                // V22 Kill Switches (passed to LLM for prompt enforcement)
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
            
            // Step 7: Track if LLM asked the consent question
            const askedConsent = llmResult.reply?.toLowerCase().includes('schedule') && 
                                 llmResult.reply?.toLowerCase().includes('?');
            if (askedConsent) {
                session.conversationMemory = session.conversationMemory || {};
                session.conversationMemory.askedConsentQuestion = true;
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
            
            aiResult = {
                reply: llmResult.reply,
                conversationMode: 'discovery',
                intent: llmResult.intent || 'discovery',
                nextGoal: llmResult.nextGoal || 'UNDERSTAND_CALLER',
                filledSlots: currentSlots,
                signals: { 
                    wantsBooking: false,  // NOT booking until consent
                    consentGiven: false,
                    discoveryComplete: !!session.discovery?.issue
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
                    // V23 Cheat Sheet Debug Info
                    cheatSheetUsed: cheatSheetUsed || false,
                    cheatSheetReason: cheatSheetReason || null,
                    cheatSheetCategory: cheatSheetKnowledge?.category || null,
                    killSwitches: {
                        bookingRequiresExplicitConsent: killSwitches.bookingRequiresExplicitConsent,
                        forceLLMDiscovery: killSwitches.forceLLMDiscovery,
                        disableScenarioAutoResponses: killSwitches.disableScenarioAutoResponses
                    }
                }
            };
            
            log('CHECKPOINT 9d: ✅ LLM response complete (DISCOVERY/SUPPORT)', {
                tokensUsed: llmResult.tokensUsed,
                mode: session.mode,
                hasIssue: !!session.discovery?.issue
            });
            
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
        
        // Keep only last 10 facts to prevent bloat
        if (session.keyFacts.length > 10) {
            session.keyFacts = session.keyFacts.slice(-10);
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
            consentDetected: consentCheck?.hasConsent || false,
            consentPhrase: consentCheck?.matchedPhrase || null,
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
            // V23 CHEAT SHEET TRACKING (PHASE 1)
            // ═══════════════════════════════════════════════════════════════════
            cheatSheetUsed: aiResult?.debug?.cheatSheetUsed || false,
            cheatSheetReason: aiResult?.debug?.cheatSheetReason || null,  // 'discovery_fallback' | 'booking_interrupt'
            cheatSheetCategory: aiResult?.debug?.cheatSheetCategory || null,
            
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
            
            // Safety Flags (V22 Kill Switches)
            killSwitches: {
                bookingRequiresConsent: company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.bookingRequiresExplicitConsent !== false,
                forceLLMDiscovery: company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.forceLLMDiscovery !== false,
                disableScenarioAutoResponses: company.aiAgentSettings?.frontDeskBehavior?.discoveryConsent?.disableScenarioAutoResponses !== false,
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
        }
        
        // Merge extracted slots
        aiResult.filledSlots = { ...(aiResult.filledSlots || {}), ...extractedThisTurn };
        
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
            source: aiResult.fromStateMachine ? 'STATE_MACHINE' : 'LLM',
            latencyMs: aiLatencyMs, 
            tokensUsed: aiResult.tokensUsed,
            mode: aiResult.conversationMode
        });
        
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
        if (aiResponseLower.includes('schedule') || 
            aiResponseLower.includes('appointment') ||
            aiResponseLower.includes('technician') ||
            aiResponseLower.includes('come out') ||
            aiResponseLower.includes('would you like me to')) {
            session.lastAgentIntent = 'OFFER_SCHEDULE';
            session.conversationMemory = session.conversationMemory || {};
            session.conversationMemory.askedConsentQuestion = true;
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
        
        // Persist all session changes
        session.markModified('booking');
        session.markModified('conversationMemory');
        await session.save();
        
        log('CHECKPOINT 10: ✅ Session updated', { phase: newPhase, lastAgentIntent: session.lastAgentIntent });
        
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
        const response = {
            success: true,
            reply: aiResponse,
            sessionId: session._id.toString(),
            phase: newPhase,
            slotsCollected: { ...session.collectedSlots, ...(aiResult.filledSlots || {}) },
            wantsBooking: aiResult.wantsBooking || false,
            conversationMode: aiResult.conversationMode || 'free',
            latencyMs
        };
        
        // Add debug info if requested
        if (includeDebug) {
            // Determine response source for display
            let responseSource = 'LLM';
            if (aiResult.fromStateMachine) {
                responseSource = 'STATE_MACHINE (0 tokens)';
            } else if (aiResult.fromQuickAnswers) {
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
                    whatLLMSaw: currentSlots
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
                stateMachine: aiResult.fromStateMachine ? {
                    action: aiResult.debug?.action,
                    state: aiResult.debug?.stateMachineState,
                    response: aiResult.debug?.response
                } : null,
                // 🧠 LLM BRAIN DEBUG - What the LLM decided (if used)
                llmBrain: !aiResult.fromStateMachine ? (aiResult.debug || null) : null,
                debugLog,
                // ════════════════════════════════════════════════════════════════
                // V22 BLACK BOX - AUTHORITATIVE MODE TRACKING (UI reads this)
                // ════════════════════════════════════════════════════════════════
                v22BlackBox: aiResult.v22BlackBox || {
                    mode: session.mode || 'DISCOVERY',
                    consentGiven: session.booking?.consentGiven || false,
                    consentPhrase: session.booking?.consentPhrase || null,
                    bookingStarted: session.mode === 'BOOKING',
                    responseSource: aiResult?.debug?.source || (aiResult?.fromStateMachine ? 'STATE_MACHINE' : 'LLM')
                },
                // ════════════════════════════════════════════════════════════════
                // 🧠 V41: DYNAMIC FLOW TRACE - What the flow engine decided
                // ════════════════════════════════════════════════════════════════
                dynamicFlow: dynamicFlowResult ? {
                    triggersEvaluated: dynamicFlowResult.triggersEvaluated?.length || 0,
                    triggersFired: dynamicFlowResult.triggersFired || [],
                    flowsActivated: dynamicFlowResult.flowsActivated || [],
                    flowsDeactivated: dynamicFlowResult.flowsDeactivated || [],
                    actionsExecuted: dynamicFlowResult.actionsExecuted || [],
                    guardrailsApplied: dynamicFlowResult.guardrailsApplied || [],
                    stateChanges: dynamicFlowResult.stateChanges || {},
                    trace: dynamicFlowResult.trace,
                    callLedger: session.callLedger || {}
                } : null
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

            // V51: Get templateReferences from company for wiring diagnostic
            const templateRefs = company?.aiAgentSettings?.templateReferences || [];
            const enabledTemplateRefs = templateRefs.filter(ref => ref.enabled !== false);
            
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
                flow: {
                    triggersFired: (dynamicFlowResult?.triggersFired || []).length,
                    flowsActivated: (dynamicFlowResult?.flowsActivated || []).length,
                    actionsExecuted: (dynamicFlowResult?.actionsExecuted || []).length,
                    stateChanges: dynamicFlowResult?.stateChanges || {}
                },
                scenarios: {
                    toolCount: scenarioToolsExpanded.length,
                    tools: scenarioToolsExpanded
                },
                blackBox: { callId: session._id.toString(), source: sourceTruth },
                // V51: Include templateReferences for wiring diagnostic
                templateReferences: enabledTemplateRefs,
                scenarioCount: scenarioToolsExpanded.length
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

                // Log dynamic flow trace for this turn (V1)
                if (dynamicFlowResult?.trace) {
                    await BlackBoxLogger.logDynamicFlowTrace(
                        session._id.toString(),
                        companyId,
                        dynamicFlowResult.trace.turn,
                        {
                            timestamp: dynamicFlowResult.trace.timestamp,
                            inputSnippet: dynamicFlowResult.trace.inputSnippet,
                            triggersEvaluated: dynamicFlowResult.trace.triggersEvaluated,
                            triggersFired: dynamicFlowResult.trace.triggersFired,
                            actionsExecuted: dynamicFlowResult.trace.actionsExecuted,
                            ledgerAppends: dynamicFlowResult.trace.ledgerAppends,
                            modeChange: dynamicFlowResult.trace.modeChange
                        }
                    );
                }
                
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
        
        return response;
        
    } catch (error) {
        // ═══════════════════════════════════════════════════════════════════
        // CRITICAL ERROR LOGGING - This is our main diagnostic point
        // ═══════════════════════════════════════════════════════════════════
        const errorDetails = {
            error: error.message,
            errorType: error.name,
            stack: error.stack?.split('\n').slice(0, 5).join('\n'), // First 5 lines of stack
            companyId,
            channel,
            userTextPreview: userText?.substring(0, 50),
            latencyMs: Date.now() - startTime,
            lastCheckpoint: debugLog[debugLog.length - 1]?.msg || 'unknown'
        };
        
        logger.error('[CONVERSATION ENGINE] ❌ CRITICAL ERROR in processTurn', errorDetails);
        
        // Also log to console for immediate visibility
        console.error('[CONVERSATION ENGINE] ❌ CRITICAL ERROR:', error.message);
        console.error('[CONVERSATION ENGINE] Stack:', error.stack?.split('\n').slice(0, 5).join('\n'));
        console.error('[CONVERSATION ENGINE] Last checkpoint:', errorDetails.lastCheckpoint);
        
        const errResp = {
            success: false,
            error: error.message,
            errorType: error.name,
            reply: "I'm sorry, I'm having trouble right now. Could you repeat that?",
            sessionId: providedSessionId,
            phase: 'error',
            mode: 'ERROR',
            slotsCollected: {},
            wantsBooking: false,
            conversationMode: 'free',
            latencyMs: Date.now() - startTime,
            debug: {
                debugLog,
                error: error.message,
                errorType: error.name,
                lastCheckpoint: errorDetails.lastCheckpoint,
                stackPreview: error.stack?.split('\n').slice(0, 3).join(' | ')
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
    SlotExtractors
};


