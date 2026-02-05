/**
 * ============================================================================
 * BOOKING FLOW RUNNER
 * ============================================================================
 * 
 * THE DETERMINISTIC BOOKING ENGINE - No LLM, No Scenarios, No Guesswork.
 * 
 * This is the "state machine" that takes over when bookingModeLocked is true.
 * It executes booking flow steps based on:
 * - The resolved flow (from BookingFlowResolver)
 * - The current step ID (from Redis state)
 * - User input (from STT)
 * 
 * CORE PRINCIPLE:
 * "The state machine is the clipboard. The LLM was the receptionist.
 *  Once we're in booking mode, the clipboard is in charge."
 * 
 * RESPONSIBILITIES:
 * 1. Ask the current step's prompt (if no user input yet)
 * 2. Validate user input against step requirements
 * 3. Extract and store the value
 * 4. Advance to next step or complete the flow
 * 5. Return deterministic response (no LLM needed)
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const BookingFlowResolver = require('./BookingFlowResolver');
const SlotExtractor = require('./SlotExtractor');  // V96f: Single source of truth for slot extraction
const AddressValidationService = require('../../AddressValidationService');
const GoogleCalendarService = require('../../GoogleCalendarService');
const SMSNotificationService = require('../../SMSNotificationService');

// 🔌 AWConfigReader for traced config reads (Phase 6d)
let AWConfigReader;
try {
    AWConfigReader = require('../../wiring/AWConfigReader');
} catch (e) {
    logger.warn('[BOOKING FLOW RUNNER] AWConfigReader not available');
}

// 🔌 BlackBoxLogger for ADDRESS_VALIDATION_RESULT events (V93)
let BlackBoxLogger;
try {
    BlackBoxLogger = require('../../BlackBoxLogger');
} catch (e) {
    logger.warn('[BOOKING FLOW RUNNER] BlackBoxLogger not available');
}

/**
 * ============================================================================
 * V96f: SAFE SLOT WRITE FIREWALL
 * ============================================================================
 * 
 * ALL slot writes MUST go through this function. This is the single point of
 * enforcement for:
 * - Phone-shaped string rejection for name fields
 * - Stop word rejection
 * - Immutability protection for confirmed slots
 * - Audit logging for accept/reject decisions
 * 
 * RULE: No direct assignment to bookingCollected.name/firstName/lastName.
 * ============================================================================
 */
const IDENTITY_SLOTS = new Set(['name', 'firstName', 'lastName', 'partialName', 'fullName']);

function safeSetSlot(state, slotName, value, options = {}) {
    const { source = 'unknown', confidence = 0.8, isCorrection = false } = options;
    
    // V96h: Get trace context from state for SLOT_WRITE_FIREWALL events
    const traceCallSid = state?._traceContext?.callSid;
    const traceCompanyId = state?._traceContext?.companyId;
    const traceLevel = state?._traceContext?.traceLevel || 'normal';
    
    // V96h: Helper to emit SLOT_WRITE_FIREWALL event (only in 'debug' trace level)
    const emitFirewallEvent = (accepted, reason, valueMasked) => {
        // SLOT_WRITE_FIREWALL only emits when traceLevel is 'debug'
        if (traceLevel !== 'debug') return;
        
        if (BlackBoxLogger?.logEvent && traceCallSid && traceCompanyId) {
            BlackBoxLogger.logEvent({
                callId: traceCallSid,
                companyId: traceCompanyId,
                type: 'SLOT_WRITE_FIREWALL',
                data: {
                    writer: 'BookingFlowRunner.safeSetSlot',
                    slot: slotName,
                    valueMasked: slotName === 'phone' 
                        ? '***' + String(valueMasked || '').slice(-4)
                        : (typeof valueMasked === 'string' ? valueMasked.substring(0, 30) : valueMasked),
                    accepted,
                    reason,
                    source,
                    confidence,
                    isCorrection
                }
            }).catch(() => {});
        }
    };
    
    if (!value) {
        logger.debug('[SAFE SET SLOT] Skipped null/empty value', { slotName, source });
        emitFirewallEvent(false, 'empty_value', null);
        return { accepted: false, reason: 'empty_value' };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // IDENTITY SLOT VALIDATION (name, firstName, lastName, etc.)
    // ═══════════════════════════════════════════════════════════════════════════
    if (IDENTITY_SLOTS.has(slotName)) {
        // Use SlotExtractor's IdentityValidators via cleanName
        const validated = SlotExtractor.cleanName ? SlotExtractor.cleanName(value) : value;
        
        if (!validated) {
            logger.warn('[SAFE SET SLOT] ❌ REJECTED identity slot (failed validation)', {
                slotName,
                rejectedValue: value,
                source,
                reason: 'failed_identity_validation'
            });
            emitFirewallEvent(false, 'failed_identity_validation', value);
            return { accepted: false, reason: 'failed_identity_validation', rejectedValue: value };
        }
        
        // Use validated value
        value = validated;
        
        // Check immutability - confirmed slots cannot be changed unless explicit correction
        const existingMeta = state.slotMetadata?.[slotName];
        if (existingMeta?.immutable === true && !isCorrection) {
            logger.warn('[SAFE SET SLOT] ⛔ REJECTED change to IMMUTABLE slot', {
                slotName,
                immutableValue: state.bookingCollected[slotName],
                rejectedValue: value,
                confirmedAt: existingMeta.confirmedAt
            });
            emitFirewallEvent(false, 'immutable_slot_protected', value);
            return { 
                accepted: false, 
                reason: 'immutable_slot', 
                currentValue: state.bookingCollected[slotName] 
            };
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // WRITE THE SLOT
    // ═══════════════════════════════════════════════════════════════════════════
    const previousValue = state.bookingCollected[slotName];
    state.bookingCollected[slotName] = value;
    
    // Update metadata
    state.slotMetadata = state.slotMetadata || {};
    state.slotMetadata[slotName] = {
        ...(state.slotMetadata[slotName] || {}),
        value,
        source,
        confidence,
        updatedAt: new Date().toISOString(),
        previousValue: previousValue !== value ? previousValue : undefined
    };
    
    logger.info('[SAFE SET SLOT] ✅ ACCEPTED slot write', {
        slotName,
        value: typeof value === 'string' ? value.substring(0, 30) : value,
        source,
        confidence,
        wasOverwrite: !!previousValue && previousValue !== value
    });
    
    // V96h: Emit firewall event for accepted writes too
    emitFirewallEvent(true, previousValue ? 'overwrite' : 'new_slot', value);
    
    return { accepted: true, value, previousValue };
}

/**
 * V96f: Mark a slot as confirmed (immutable until explicit correction)
 */
function markSlotConfirmed(state, slotName) {
    if (!state.bookingCollected[slotName]) return;
    
    state.slotMetadata = state.slotMetadata || {};
    state.slotMetadata[slotName] = {
        ...(state.slotMetadata[slotName] || {}),
        confirmed: true,
        immutable: true,
        confirmedAt: new Date().toISOString()
    };
    
    state.confirmedSlots = state.confirmedSlots || {};
    state.confirmedSlots[slotName] = true;
    
    logger.info('[SAFE SET SLOT] 🔒 Slot marked CONFIRMED (immutable)', { slotName });
}

/**
 * Slot extractors - deterministic extraction for each slot type
 */
const SlotExtractors = {
    /**
     * Extract name from user input
     * V96f: DELEGATE TO MAIN SlotExtractor - Single source of truth
     * 
     * This ensures all name extraction goes through the same validation:
     * - Phone-shaped rejection
     * - Stop word filtering
     * - Pattern hierarchy (PRIMARY vs SECONDARY)
     */
    name: (input, step, context = {}) => {
        if (!input) return null;
        
        // V96f: Use the main SlotExtractor for name extraction
        // This ensures consistent validation across the entire platform
        const result = SlotExtractor.extractName(input, context);
        
        if (result) {
            // SlotExtractor returns { value, confidence, ... } object
            const name = result.value || result;
            logger.debug('[BOOKING FLOW RUNNER] Name extracted via SlotExtractor', {
                input: input.substring(0, 30),
                extracted: name,
                patternSource: result.patternSource
            });
            return typeof name === 'string' ? name : null;
        }
        
        // Fallback: simple word extraction for direct name responses
        // (when user just says "Mark" in response to "What's your name?")
        const text = input.trim();
        const words = text.split(/\s+/)
            .filter(w => !isStopWord(w.toLowerCase()))
            .filter(w => /^[A-Za-z][A-Za-z\-'\.]*$/.test(w));
        
        if (words.length === 0) return null;
        
        // Run through cleanName for final validation
        return cleanName(words.join(' '));
    },
    
    /**
     * Extract phone number from user input
     */
    phone: (input, step, context = {}) => {
        if (!input) return null;
        
        // Remove all non-digit characters
        const digits = input.replace(/\D/g, '');
        
        // Must have at least 10 digits for a valid phone number
        if (digits.length < 10) return null;
        
        // Take last 10 digits (handles "1" country code prefix)
        const phone = digits.slice(-10);
        
        // Format as (XXX) XXX-XXXX for readability
        return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
    },
    
    /**
     * Extract address from user input
     * Note: For complex address validation, use Google Maps API (separate service)
     */
    address: (input, step, context = {}) => {
        if (!input) return null;
        
        const text = input.trim();
        
        // Basic validation - should contain some address-like content
        // (number + street name pattern)
        const hasAddressPattern = /\d+\s+[A-Za-z]/.test(text);
        
        if (!hasAddressPattern && text.length < 5) {
            return null;
        }
        
        // Clean up common speech artifacts
        let address = text
            .replace(/^(?:my address is|the address is|it's|its|at)\s+/i, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        return address;
    },
    
    /**
     * Extract time/date preference from user input
     */
    time: (input, step, context = {}) => {
        if (!input) return null;
        
        const text = input.toLowerCase().trim();
        
        // 🚫 Guard: never treat an address-like utterance as time
        if (looksLikeAddress(text)) {
            logger.debug('[BOOKING FLOW RUNNER] Time rejected: looks like address', { text: text.substring(0, 60) });
            return null;
        }
        
        // ASAP patterns
        if (/\b(asap|as soon as possible|soon|right away|immediately|now)\b/.test(text)) {
            return 'ASAP';
        }
        
        // Explicit time of day preferences (non-greeting)
        if (/\b(morning|before noon)\b/.test(text)) {
            return 'Morning';
        }
        if (/\b(afternoon|after lunch)\b/.test(text)) {
            return 'Afternoon';
        }
        if (/\b(evening|night|after work|after 5)\b/.test(text)) {
            return 'Evening';
        }
        
        // Day patterns
        const dayMatch = text.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|weekend|next week|this week)\b/i);
        if (dayMatch) {
            return titleCase(dayMatch[1]);
        }
        
        // Specific time patterns
        if (/\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(text)) {
            return input.trim();
        }
        if (/\b(at|around)\s+\d{1,2}(?::\d{2})?\b/i.test(text)) {
            return input.trim();
        }
        
        // Explicit preference indicators
        if (/\b(prefer|works|available|free|sometime|anytime|no preference|whenever)\b/i.test(text)) {
            return input.trim();
        }
        
        return null;
    },
    
    /**
     * Extract email from user input
     */
    email: (input, step, context = {}) => {
        if (!input) return null;
        
        // Try to find email pattern
        const emailMatch = input.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        if (emailMatch) {
            return emailMatch[0].toLowerCase();
        }
        
        return null;
    },
    
    /**
     * Extract service type from user input
     */
    serviceType: (input, step, context = {}) => {
        if (!input) return null;
        return input.trim();
    },
    
    /**
     * Default extractor - just return the trimmed input
     */
    default: (input, step, context = {}) => {
        if (!input) return null;
        return input.trim();
    }
};

/**
 * Helper functions
 */
const STATE_PATTERN = /\b(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|al|ak|az|ar|ca|co|ct|de|fl|ga|hi|id|il|in|ia|ks|ky|la|me|md|ma|mi|mn|ms|mo|mt|ne|nv|nh|nj|nm|ny|nc|nd|oh|ok|or|pa|ri|sc|sd|tn|tx|ut|vt|va|wa|wv|wi|wy)\b/i;
const ZIP_PATTERN = /\b\d{5}(?:-\d{4})?\b/;
const UNIT_PATTERN = /\b(?:apt|apartment|unit|suite|ste|#)\s*[\w\-]+/i;
const STREET_SUFFIX_PATTERN = /\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|boulevard|blvd|way|place|pl|circle|cir|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|loop|alley|aly|path|crossing|xing|square|sq|plaza|plz|commons|point|pt|ridge|run|pass|grove|park|estates|meadow|meadows|valley|hills|heights|view|vista|landing|springs|creek|glen|cove|bay|beach|shore|pointe)\b/i;

function looksLikeAddress(text) {
    if (!text) return false;
    const hasNumber = /\b\d{1,6}\b/.test(text);
    return hasNumber && STREET_SUFFIX_PATTERN.test(text);
}

function detectAddressParts(rawAddress) {
    const text = (rawAddress || '').toString().toLowerCase();
    return {
        hasCity: STATE_PATTERN.test(text) || (rawAddress || '').includes(','),
        hasState: STATE_PATTERN.test(text),
        hasZip: ZIP_PATTERN.test(text),
        hasUnit: UNIT_PATTERN.test(text)
    };
}
function isStopWord(word) {
    // V96e: Comprehensive stop words - sync with SlotExtractor.NAME_STOP_WORDS
    const stopWords = new Set([
        'is', 'are', 'was', 'were', 'be', 'been', 'am',
        'the', 'my', 'its', "it's", 'a', 'an', 'name', 'last', 'first',
        'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'no', 'nope',
        'hi', 'hello', 'hey', 'please', 'thanks', 'thank', 'you',
        'it', 'that', 'this', 'what', 'and', 'or', 'but', 'to', 'for', 'with',
        'got', 'two', 'there', 'uh', 'um', 'yup', 'so', 'well', 'just',
        // V96e: Adverbs and state words that caused "currently" as name bug
        'currently', 'presently', 'actually', 'basically', 'usually', 'normally',
        'typically', 'generally', 'still', 'already', 'always', 'never', 'ever',
        'now', 'today', 'recently', 'sometimes', 'often', 'really', 'very',
        'nothing', 'everything', 'anything', 'something',
        // Service/trade words
        'service', 'services', 'repair', 'repairs', 'maintenance', 'conditioning',
        'air', 'ac', 'hvac', 'heating', 'cooling', 'plumbing', 'electrical'
    ]);
    return stopWords.has(word);
}

/**
 * V96e: Check if string looks like a phone number
 * Used to prevent ANI/phone contamination into name fields
 */
function looksLikePhone(str) {
    if (!str) return false;
    const digitsOnly = str.replace(/\D/g, '');
    const digitRatio = digitsOnly.length / str.length;
    return digitRatio > 0.5 && digitsOnly.length >= 7;
}

function titleCase(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function cleanName(name) {
    if (!name) return null;
    
    // V96e: Reject phone-shaped strings early
    if (looksLikePhone(name)) {
        logger.warn('[BOOKING FLOW RUNNER] ❌ V96e: Rejected phone-shaped string as name', { name });
        return null;
    }
    
    const cleaned = name
        .split(/\s+/)
        .filter(w => !isStopWord(w.toLowerCase()) && w.length > 1)
        .map(w => titleCase(w.replace(/[^A-Za-z\-'\.]/g, '')))
        .join(' ')
        .trim() || null;
    
    // V96e: Final validation - must have at least one letter
    if (cleaned && !/[a-zA-Z]/.test(cleaned)) {
        logger.warn('[BOOKING FLOW RUNNER] ❌ V96e: Rejected name with no letters', { cleaned });
        return null;
    }
    
    return cleaned;
}

/**
 * V92: Check if a name needs spelling confirmation
 * Names that sound similar (Mark/Marc, John/Jon, etc.) should be spelled out
 * to avoid booking under wrong name.
 */
const SIMILAR_NAME_GROUPS = [
    ['mark', 'marc', 'marcus'],
    ['john', 'jon', 'jonathan', 'jonathon'],
    ['steven', 'stephen', 'steve'],
    ['michael', 'micheal', 'mike'],
    ['brian', 'bryan', 'bryon'],
    ['eric', 'erik', 'erick'],
    ['jason', 'jayson'],
    ['jeffrey', 'geoffrey', 'geoff', 'jeff'],
    ['kris', 'chris', 'kristopher', 'christopher'],
    ['shawn', 'sean', 'shaun'],
    ['alan', 'allan', 'allen'],
    ['anne', 'ann', 'anna'],
    ['cathy', 'kathy', 'catherine', 'katherine'],
    ['sara', 'sarah'],
    ['lindsey', 'lindsay'],
    ['tracy', 'tracey'],
    ['brittany', 'britney', 'brittney'],
    ['ashley', 'ashlee', 'ashleigh'],
    ['megan', 'meghan', 'meagan'],
    ['rachel', 'rachael'],
    ['nicole', 'nichole'],
    ['teresa', 'theresa'],
    ['carl', 'karl'],
    ['gary', 'garry'],
    ['jerry', 'gerry'],
    ['phil', 'phillip', 'philip'],
    ['tony', 'toni', 'anthony']
];

function needsSpellingCheck(name) {
    if (!name) return false;
    
    const nameLower = name.toLowerCase().trim();
    const firstName = nameLower.split(/\s+/)[0]; // Check first name only
    
    // Check if first name is in any similar-sounding group
    for (const group of SIMILAR_NAME_GROUPS) {
        if (group.includes(firstName)) {
            return true;
        }
    }
    
    // Also check for very short names (3 letters or less) - easy to mishear
    if (firstName.length <= 3) {
        return true;
    }
    
    return false;
}

/**
 * ============================================================================
 * BOOKING FLOW RUNNER
 * ============================================================================
 */
class BookingFlowRunner {
    
    /**
     * ========================================================================
     * RUN STEP - The main entry point
     * ========================================================================
     * 
     * Called from v2twilio.js when bookingModeLocked is true.
     * 
     * KEY FEATURE: CONFIRM-VS-COLLECT LOGIC
     * - If slot already exists (from discovery, caller ID, etc.), CONFIRM it
     * - If slot missing, COLLECT it
     * - Never re-ask for information we already have!
     * 
     * @param {Object} params
     * @param {Object} params.flow - The resolved booking flow
     * @param {Object} params.state - Current booking state from Redis
     * @param {string} params.userInput - User's speech input (may be empty on first entry)
     * @param {Object} params.company - Company document
     * @param {Object} params.session - ConversationSession document
     * @param {Object} params.slots - Pre-extracted slots with confidence metadata
     * 
     * @returns {Object} Result:
     * {
     *     reply: 'What is the service address?',
     *     state: { currentStepId, bookingCollected, ... },
     *     isComplete: false,
     *     action: 'CONTINUE' | 'COMPLETE' | 'ESCALATE',
     *     debug: { ... }
     * }
     */
    static async runStep({ flow, state, userInput, company, session, callSid, slots = {}, awReader: passedAwReader = null }) {
        const startTime = Date.now();
        
        // V96h: Store callSid, companyId, and traceLevel in state for SLOT_WRITE_FIREWALL tracing
        state._traceContext = {
            callSid: callSid || state._traceContext?.callSid,
            companyId: company?._id?.toString() || state._traceContext?.companyId,
            traceLevel: company?.aiAgentSettings?.traceLevel || state._traceContext?.traceLevel || 'normal'
        };
        
        // 🔌 AW MIGRATION: Create or use AWConfigReader for traced config reads
        const awReader = passedAwReader || (AWConfigReader && company ? AWConfigReader.forCall({
            callId: callSid || 'booking-step',
            companyId: company._id?.toString() || 'unknown',
            turn: session?.metrics?.totalTurns || 0,
            runtimeConfig: company,
            readerId: 'BookingFlowRunner.runStep'
        }) : null);
        
        logger.info('[BOOKING FLOW RUNNER] Running step', {
            flowId: flow?.flowId,
            currentStepId: state?.currentStepId,
            hasUserInput: !!userInput,
            inputPreview: userInput?.substring(0, 50),
            existingSlots: Object.keys(slots || {}),
            hasAWReader: !!awReader
        });
        
        // Validate inputs
        if (!flow || !flow.steps || flow.steps.length === 0) {
            logger.error('[BOOKING FLOW RUNNER] Invalid flow - no steps', { flowId: flow?.flowId });
            return this.buildErrorResponse('Invalid booking flow configuration', state);
        }
        
        // Initialize state if needed
        state = this.initializeState(state, flow, slots);
        
        // V92: Store companyId in state for later use in buildCompletion (SMS)
        if (company?._id && !state.companyId) {
            state.companyId = company._id.toString();
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V94: BOOKING_PROMPT_RESOLVED - Prove where booking config came from
        // ═══════════════════════════════════════════════════════════════════════════
        // This event is emitted ONCE when booking mode starts. It proves:
        // 1. Which config paths were read (Booking Prompt tab vs legacy)
        // 2. The exact slot configuration being used
        // 3. The resolution status (company_config vs default fallback)
        // 
        // This ends the "ghost legacy" debugging problem - you can now see in raw
        // events exactly where the booking prompts came from.
        // ═══════════════════════════════════════════════════════════════════════════
        if (!state.flowResolutionEmitted && BlackBoxLogger && callSid && company?._id) {
            state.flowResolutionEmitted = true;
            
            const resolution = flow.resolution || {};
            const stepSources = (flow.steps || []).map(step => ({
                slotId: step.id || step.fieldKey,
                promptSource: step.promptSource || 'unknown',
                hasCustomPrompt: !!(step.prompt && step.prompt !== step.defaultPrompt),
                required: step.required
            }));
            
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: company._id.toString(),
                type: 'BOOKING_PROMPT_RESOLVED',
                turn: session?.metrics?.totalTurns || 0,
                data: {
                    source: resolution.source || flow.source || 'unknown',
                    status: resolution.status || 'OK',
                    flowId: flow.flowId,
                    slotCount: flow.steps?.length || 0,
                    resolvedPaths: resolution.checkedPaths || [],
                    hasFrontDeskSlots: resolution.hasFrontDeskSlots || false,
                    hasLegacySlots: resolution.hasLegacySlots || false,
                    stepSources,
                    // Include first 3 slot prompts for quick verification
                    promptSamples: (flow.steps || []).slice(0, 3).map(s => ({
                        slot: s.id || s.fieldKey,
                        prompt: (s.prompt || '').substring(0, 100)
                    }))
                }
            }).catch(err => {
                logger.warn('[BOOKING FLOW RUNNER] Failed to emit BOOKING_PROMPT_RESOLVED', { error: err.message });
            });
            
            logger.info('[BOOKING FLOW RUNNER] V94: BOOKING_PROMPT_RESOLVED emitted', {
                flowId: flow.flowId,
                source: resolution.source || flow.source,
                slotCount: flow.steps?.length || 0
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // MERGE PRE-EXTRACTED SLOTS INTO BOOKING COLLECTED
        // ═══════════════════════════════════════════════════════════════════
        // Slots from SlotExtractor (caller ID, discovery phase) are merged here.
        // This is how we avoid re-asking for "Hi I'm Mark" later.
        // ═══════════════════════════════════════════════════════════════════
        
        // FEB 2026 FIX: Track slots that were just collected THIS turn
        // This prevents immediately asking for confirmation of a value the user just gave
        const slotsCollectedThisTurn = new Set();
        
        if (slots && Object.keys(slots).length > 0) {
            for (const [key, slotData] of Object.entries(slots)) {
                if (slotData?.value && !state.bookingCollected[key]) {
                    // V96f: Use safeSetSlot for identity slots, direct for others
                    if (IDENTITY_SLOTS.has(key)) {
                        const setResult = safeSetSlot(state, key, slotData.value, {
                            source: slotData.source || 'pre_extracted',
                            confidence: slotData.confidence || 0.8
                        });
                        if (!setResult.accepted) {
                            logger.warn('[BOOKING FLOW RUNNER] V96f: Pre-extracted identity slot rejected', {
                                key,
                                reason: setResult.reason,
                                value: slotData.value
                            });
                            continue;
                        }
                    } else {
                        state.bookingCollected[key] = slotData.value;
                        state.slotMetadata = state.slotMetadata || {};
                        state.slotMetadata[key] = slotData;
                    }
                    slotsCollectedThisTurn.add(key);
                    logger.info('[BOOKING FLOW RUNNER] Merged pre-extracted slot', {
                        key,
                        value: slotData.value,
                        confidence: slotData.confidence,
                        source: slotData.source,
                        collectedThisTurn: true
                    });
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: VALIDATE PRE-EXTRACTED ADDRESS WITH GOOGLE GEO
        // ═══════════════════════════════════════════════════════════════════════
        // When address comes from SlotExtractor (not handleCollectMode), we still
        // need to validate it with Google Geo to:
        // 1. Normalize the address
        // 2. Detect if unit number is needed
        // 3. Set up conditional steps for propertyType/gateAccess
        // ═══════════════════════════════════════════════════════════════════════
        if (slotsCollectedThisTurn.has('address') && state.bookingCollected.address && !state.addressValidation) {
            try {
                const companyId = company?._id?.toString() || 'unknown';
                // 🔌 AW MIGRATION: Read address verification config via AWConfigReader
                let geoEnabled;
                if (awReader) {
                    awReader.setReaderId('BookingFlowRunner.addressValidation.preExtracted');
                    geoEnabled = awReader.get('booking.addressVerification.enabled', true) !== false;
                } else {
                    geoEnabled = company?.aiAgentSettings?.frontDesk?.booking?.addressVerification?.enabled !== false;
                }
                
                // V93: Pass callId for GEO_LOOKUP events in Raw Events
                const addressValidation = await AddressValidationService.validateAddress(
                    state.bookingCollected.address,
                    { companyId, callId: callSid, enabled: geoEnabled }
                );
                
                if (addressValidation.success && addressValidation.validated) {
                    // Use formatted address from Google
                    const formattedAddress = addressValidation.formattedAddress || addressValidation.normalized;
                    if (formattedAddress) {
                        state.bookingCollected.address = formattedAddress;
                        if (state.slotMetadata?.address) {
                            state.slotMetadata.address.value = formattedAddress;
                        }
                    }
                    
                    // Store validation metadata for conditional steps
                    state.addressValidation = {
                        raw: slots.address?.value,
                        formatted: formattedAddress,
                        confidence: addressValidation.confidence,
                        placeId: addressValidation.placeId,
                        location: addressValidation.location,
                        needsUnit: addressValidation.needsUnit,
                        unitDetection: addressValidation.unitDetection
                    };
                    
                    // Set flag for conditional step evaluation
                    if (addressValidation.needsUnit) {
                        state.addressNeedsUnit = true;
                    }
                    
                    logger.info('[BOOKING FLOW RUNNER] Address validated (pre-extracted)', {
                        raw: slots.address?.value,
                        formatted: formattedAddress,
                        confidence: addressValidation.confidence,
                        needsUnit: addressValidation.needsUnit
                    });
                }
            } catch (geoError) {
                logger.warn('[BOOKING FLOW RUNNER] Address validation error (non-blocking)', {
                    error: geoError.message,
                    address: state.bookingCollected.address
                });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: HANDLE PENDING SPELLING CONFIRMATION
        // ═══════════════════════════════════════════════════════════════════════
        // If we asked user to confirm spelling and they responded, process it here.
        // User can say: "yes", "correct", "no", "wrong", or provide a corrected name.
        // ═══════════════════════════════════════════════════════════════════════
        if (state.pendingSpellingConfirm && userInput && userInput.trim()) {
            const confirmResult = this.parseConfirmationResponse(userInput);
            const { fieldKey, value, step: stepId } = state.pendingSpellingConfirm;
            
            if (confirmResult.confirmed) {
                // Spelling confirmed - mark as confirmed and proceed
                state.spellingConfirmed = true;
                delete state.pendingSpellingConfirm;
                
                logger.info('[BOOKING FLOW RUNNER] V92: Spelling confirmed', {
                    fieldKey,
                    value
                });
                
                // Continue to next step - fall through
            } else if (confirmResult.denied) {
                // User said spelling is wrong - ask for correct spelling
                delete state.pendingSpellingConfirm;
                delete state.bookingCollected[fieldKey];
                if (state.confirmedSlots) delete state.confirmedSlots[fieldKey];
                state.spellingConfirmed = false;
                
                logger.info('[BOOKING FLOW RUNNER] V92: Spelling denied - re-asking', {
                    fieldKey,
                    originalValue: value
                });
                
                return {
                    reply: "I apologize. Could you please spell your name for me?",
                    state,
                    isComplete: false,
                    action: 'RE_COLLECT_NAME',
                    currentStep: stepId,
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: Date.now() - startTime,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        mode: 'RE_COLLECT_NAME_AFTER_SPELLING_DENIED'
                    }
                };
            } else if (confirmResult.newValue) {
                // User provided a corrected name
                // V96f: Use safeSetSlot for identity field protection
                const setResult = safeSetSlot(state, fieldKey, confirmResult.newValue, {
                    source: 'spelling_correction',
                    confidence: 0.95,
                    isCorrection: true
                });
                if (!setResult.accepted) {
                    logger.warn('[BOOKING FLOW RUNNER] V96f: Spelling correction rejected', {
                        fieldKey,
                        reason: setResult.reason
                    });
                }
                state.spellingConfirmed = true;
                delete state.pendingSpellingConfirm;
                
                logger.info('[BOOKING FLOW RUNNER] V92: New name provided after spelling check', {
                    fieldKey,
                    oldValue: value,
                    newValue: confirmResult.newValue
                });
                
                // Continue to next step - fall through
            }
        }
        
        // Get current step
        const currentStep = flow.steps.find(s => s.id === state.currentStepId);
        
        // ═══════════════════════════════════════════════════════════════════
        // FEB 2026 FIX: Auto-confirm slots collected THIS turn
        // ═══════════════════════════════════════════════════════════════════
        // When user gives a value (e.g., "12155 Metro Parkway"), don't immediately
        // ask "Is that correct?" - accept it and move on. Only ask for confirmation
        // if value came from a PREVIOUS turn or from caller ID.
        // ═══════════════════════════════════════════════════════════════════
        if (slotsCollectedThisTurn.size > 0) {
            state.confirmedSlots = state.confirmedSlots || {};
            for (const key of slotsCollectedThisTurn) {
                // Only auto-confirm if it's the current step we were asking about
                if (key === state.currentStepId) {
                    state.confirmedSlots[key] = true;
                    if (state.slotMetadata?.[key]) {
                        state.slotMetadata[key].confirmed = true;
                    }
                    logger.info('[BOOKING FLOW RUNNER] Auto-confirmed slot collected this turn', {
                        key,
                        reason: 'USER_JUST_PROVIDED_VALUE'
                    });
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // FIND NEXT STEP NEEDING ACTION (CONFIRM OR COLLECT)
        // ═══════════════════════════════════════════════════════════════════
        const nextAction = this.determineNextAction(flow, state, slots);
        
        if (!nextAction) {
            // All required steps confirmed - go to final confirmation
            logger.info('[BOOKING FLOW RUNNER] All slots ready - building final confirmation', {
                collected: state.bookingCollected
            });
            return this.buildConfirmation(flow, state);
        }
        
        // Update current step to the one needing action
        if (nextAction.step.id !== state.currentStepId) {
            state.currentStepId = nextAction.step.id;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // HANDLE CONFIRMATION MODE (slot exists, needs confirmation)
        // ═══════════════════════════════════════════════════════════════════
        if (nextAction.mode === 'CONFIRM') {
            return this.handleConfirmMode(nextAction, state, flow, userInput, startTime);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // HANDLE COLLECT MODE (slot missing, need to ask)
        // ═══════════════════════════════════════════════════════════════════
        return await this.handleCollectMode(nextAction, state, flow, userInput, company, startTime);
    }
    
    /**
     * ========================================================================
     * DETERMINE NEXT ACTION - Confirm vs Collect decision
     * ========================================================================
     * 
     * For each required step, determine if we need to:
     * - CONFIRM: Slot exists (from caller ID, discovery, etc.) - ask user to confirm
     * - COLLECT: Slot missing - ask user to provide it
     * - SKIP: Slot confirmed (confidence = 1.0) - move to next
     * 
     * @returns {Object|null} { step, mode: 'CONFIRM'|'COLLECT', existingValue }
     */
    static determineNextAction(flow, state, slots = {}) {
        const collected = state.bookingCollected || {};
        const slotMetadata = state.slotMetadata || {};
        const confirmedSlots = state.confirmedSlots || new Set();
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FEB 2026 FIX: Track current step position to prevent going backwards
        // ═══════════════════════════════════════════════════════════════════════════
        // If we're at step "address", don't return to "name" for confirmation.
        // The flow should only move FORWARD, not backwards.
        // ═══════════════════════════════════════════════════════════════════════════
        const currentStepId = state.currentStepId;
        const currentStepIndex = currentStepId 
            ? flow.steps.findIndex(s => (s.fieldKey || s.id) === currentStepId)
            : -1;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // AUTO-CONFIRM THRESHOLD: 0.85 for utterance-sourced slots
        // ═══════════════════════════════════════════════════════════════════════════
        // When caller explicitly says "my name is Mark", confidence is 0.9.
        // This is high enough to auto-confirm without asking again.
        // Only caller ID (0.7) and low-confidence extractions need confirmation.
        // ═══════════════════════════════════════════════════════════════════════════
        const AUTO_CONFIRM_THRESHOLD = 0.85;
        
        for (let i = 0; i < flow.steps.length; i++) {
            const step = flow.steps[i];
            if (!step.required) continue;
            
            // ═══════════════════════════════════════════════════════════════════════
            // V92: CONDITIONAL STEP EVALUATION
            // ═══════════════════════════════════════════════════════════════════════
            // Steps can have a `condition` object that determines if they should run.
            // Conditions check state values like addressValidation.needsUnit
            // ═══════════════════════════════════════════════════════════════════════
            if (step.condition && !this.evaluateCondition(step.condition, state, collected)) {
                logger.debug('[BOOKING FLOW] Skipping conditional step', {
                    stepId: step.id,
                    condition: step.condition,
                    reason: 'CONDITION_NOT_MET'
                });
                continue;
            }
            
            const fieldKey = step.fieldKey || step.id;
            const existingValue = collected[fieldKey];
            const metadata = slotMetadata[fieldKey] || slots[fieldKey];
            
            // Already confirmed by user - skip
            if (confirmedSlots.has?.(fieldKey) || state.confirmedSlots?.[fieldKey]) {
                continue;
            }
            
            // ═══════════════════════════════════════════════════════════════════════
            // FEB 2026 FIX: Don't go backwards in the flow
            // ═══════════════════════════════════════════════════════════════════════
            // If we've passed this step (current step is later), auto-confirm it
            // This prevents: collect address → go back to confirm name
            // ═══════════════════════════════════════════════════════════════════════
            if (currentStepIndex > i && existingValue) {
                logger.debug('[BOOKING FLOW] Auto-confirming passed step', {
                    fieldKey,
                    currentStepId,
                    reason: 'FLOW_MOVED_FORWARD'
                });
                // Mark as confirmed so we don't return to it
                state.confirmedSlots = state.confirmedSlots || {};
                state.confirmedSlots[fieldKey] = true;
                continue;
            }
            
            // If no value, need to COLLECT
            if (!existingValue) {
                return {
                    step,
                    mode: 'COLLECT',
                    existingValue: null
                };
            }
            
            // ═══════════════════════════════════════════════════════════════════════
            // FEB 2026 FIX: Auto-confirm high-confidence utterance slots
            // ═══════════════════════════════════════════════════════════════════════
            // If caller said "my name is Mark" (confidence 0.9, source: utterance),
            // don't ask them to confirm it again - that's annoying!
            // Only ask for confirmation on low-confidence or caller_id slots.
            // ═══════════════════════════════════════════════════════════════════════
            const isUtteranceSource = metadata?.source === 'utterance';
            const hasHighConfidence = metadata?.confidence >= AUTO_CONFIRM_THRESHOLD;
            
            if (metadata?.confirmed === true || (isUtteranceSource && hasHighConfidence)) {
                // Auto-confirm and skip
                state.confirmedSlots = state.confirmedSlots || {};
                state.confirmedSlots[fieldKey] = true;
                logger.debug('[BOOKING FLOW] Auto-confirming high-confidence slot', {
                    fieldKey,
                    confidence: metadata?.confidence,
                    source: metadata?.source
                });
                continue;
            }
            
            // Value exists but low confidence or caller_id - need to CONFIRM
            if (metadata?.needsConfirmation || 
                (metadata?.confidence && metadata.confidence < AUTO_CONFIRM_THRESHOLD) ||
                metadata?.source === 'caller_id') {
                return {
                    step,
                    mode: 'CONFIRM',
                    existingValue,
                    metadata
                };
            }
            
            // Value exists without metadata - treat as needing confirmation if it's phone from caller ID
            if (fieldKey === 'phone' && !metadata) {
                return {
                    step,
                    mode: 'CONFIRM',
                    existingValue,
                    metadata: { source: 'unknown', confidence: 0.7 }
                };
            }
            
            // Value exists with metadata, not explicitly needing confirmation - skip
            continue;
        }
        
        return null; // All required steps handled
    }
    
    /**
     * ========================================================================
     * HANDLE CONFIRM MODE - Ask user to confirm existing value
     * ========================================================================
     */
    static handleConfirmMode(action, state, flow, userInput, startTime) {
        const { step, existingValue, metadata } = action;
        const fieldKey = step.fieldKey || step.id;
        
        // First entry or no input - ask confirmation question
        if (!userInput || userInput.trim() === '') {
            const confirmPrompt = this.buildConfirmPrompt(step, existingValue);
            
            state.pendingConfirmation = {
                fieldKey,
                value: existingValue,
                step: step.id
            };
            
            logger.info('[BOOKING FLOW RUNNER] CONFIRM MODE - Asking to confirm', {
                stepId: step.id,
                fieldKey,
                value: existingValue,
                source: metadata?.source
            });
            
            return {
                reply: confirmPrompt,
                state,
                isComplete: false,
                action: 'CONFIRM_SLOT',
                currentStep: step.id,
                slotToConfirm: fieldKey,
                existingValue,
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'CONFIRM',
                    fieldKey,
                    existingValue,
                    confidence: metadata?.confidence
                }
            };
        }
        
        // User responded - check if confirmed or denied
        const confirmResult = this.parseConfirmationResponse(userInput);
        
        if (confirmResult.confirmed) {
            // User confirmed - mark slot as confirmed and advance
            state.confirmedSlots = state.confirmedSlots || {};
            state.confirmedSlots[fieldKey] = true;
            
            if (state.slotMetadata?.[fieldKey]) {
                state.slotMetadata[fieldKey].confirmed = true;
                state.slotMetadata[fieldKey].confidence = 1.0;
            }
            
            delete state.pendingConfirmation;
            
            logger.info('[BOOKING FLOW RUNNER] Slot confirmed by user', {
                fieldKey,
                value: existingValue
            });
            
            // Find next action
            const nextAction = this.determineNextAction(flow, state, {});
            
            if (!nextAction) {
                return this.buildConfirmation(flow, state);
            }
            
            state.currentStepId = nextAction.step.id;
            
            // Build acknowledgment + next prompt
            const ack = 'Perfect.';
            let nextPrompt;
            
            if (nextAction.mode === 'CONFIRM') {
                nextPrompt = this.buildConfirmPrompt(nextAction.step, nextAction.existingValue);
                state.pendingConfirmation = {
                    fieldKey: nextAction.step.fieldKey || nextAction.step.id,
                    value: nextAction.existingValue,
                    step: nextAction.step.id
                };
            } else {
                nextPrompt = nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`;
            }
            
            return {
                reply: `${ack} ${nextPrompt}`,
                state,
                isComplete: false,
                action: 'CONTINUE',
                stepCompleted: step.id,
                nextStep: nextAction.step.id,
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'CONFIRMED',
                    confirmedField: fieldKey,
                    nextMode: nextAction.mode
                }
            };
        } else if (confirmResult.denied) {
            // User said no - switch to COLLECT mode for this slot
            delete state.bookingCollected[fieldKey];
            delete state.pendingConfirmation;
            
            if (state.slotMetadata?.[fieldKey]) {
                delete state.slotMetadata[fieldKey];
            }
            
            logger.info('[BOOKING FLOW RUNNER] User denied - switching to collect mode', {
                fieldKey,
                deniedValue: existingValue
            });
            
            const collectPrompt = step.prompt || `What is your ${step.label || step.id}?`;
            
            return {
                reply: `No problem. ${collectPrompt}`,
                state,
                isComplete: false,
                action: 'COLLECT_AFTER_DENY',
                currentStep: step.id,
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'COLLECT_AFTER_DENY',
                    fieldKey,
                    deniedValue: existingValue
                }
            };
        } else if (confirmResult.newValue) {
            // User provided a new value - use it
            // V96f: Use safeSetSlot for identity field protection
            const setResult = safeSetSlot(state, fieldKey, confirmResult.newValue, {
                source: 'user_correction_during_confirm',
                confidence: 0.95,
                isCorrection: true
            });
            if (setResult.accepted) {
                markSlotConfirmed(state, fieldKey);
            }
            delete state.pendingConfirmation;
            
            logger.info('[BOOKING FLOW RUNNER] User provided new value during confirm', {
                fieldKey,
                oldValue: existingValue,
                newValue: confirmResult.newValue
            });
            
            // Advance to next
            const nextAction = this.determineNextAction(flow, state, {});
            
            if (!nextAction) {
                return this.buildConfirmation(flow, state);
            }
            
            state.currentStepId = nextAction.step.id;
            
            const ack = 'Got it.';
            const nextPrompt = nextAction.mode === 'CONFIRM'
                ? this.buildConfirmPrompt(nextAction.step, nextAction.existingValue)
                : (nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`);
            
            return {
                reply: `${ack} ${nextPrompt}`,
                state,
                isComplete: false,
                action: 'CONTINUE',
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'NEW_VALUE_PROVIDED',
                    fieldKey,
                    newValue: confirmResult.newValue
                }
            };
        }
        
        // Unclear response - re-ask confirmation
        return {
            reply: "I'm sorry, I didn't catch that. Is that information correct? Please say yes or no.",
            state,
            isComplete: false,
            action: 'CONFIRM_RETRY',
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: Date.now() - startTime,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                mode: 'CONFIRM_RETRY',
                fieldKey,
                userInput
            }
        };
    }
    
    /**
     * ========================================================================
     * HANDLE COLLECT MODE - Ask user to provide missing value
     * ========================================================================
     */
    static async handleCollectMode(action, state, flow, userInput, company, startTime) {
        const { step } = action;
        const fieldKey = step.fieldKey || step.id;
        
        // First entry or no input - ask the question
        if (!userInput || userInput.trim() === '') {
            logger.info('[BOOKING FLOW RUNNER] COLLECT MODE - Asking for slot', {
                stepId: step.id,
                prompt: step.prompt?.substring(0, 50)
            });
            return this.askStep(step, state, flow);
        }
        
        // User responded - extract value
        const extractResult = this.extractValue(userInput, step, state, company);
        
        if (!extractResult.isValid) {
            // Invalid input - reprompt
            state.askCount = state.askCount || {};
            state.askCount[step.id] = (state.askCount[step.id] || 0) + 1;
            
            // ═══════════════════════════════════════════════════════════════
            // MAX ATTEMPTS: Read from step config (UI-driven), default to 3
            // ═══════════════════════════════════════════════════════════════
            const maxAttempts = step.maxAttempts || step.options?.maxAttempts || 3;
            
            if (state.askCount[step.id] >= maxAttempts) {
                logger.warn('[BOOKING FLOW RUNNER] Max attempts reached - escalating', {
                    stepId: step.id,
                    askCount: state.askCount[step.id],
                    maxAttempts
                });
                return this.buildEscalation(step, state, flow, 
                    `Unable to collect ${step.label || step.id} after ${maxAttempts} attempts`);
            }
            
            return this.repromptStep(step, state, flow, extractResult.reason);
        }
        
        // Valid input - store and advance
        let valueToStore = extractResult.value;
        let addressValidation = null;
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: GOOGLE GEO VALIDATION FOR ADDRESS
        // ═══════════════════════════════════════════════════════════════════════
        // When collecting address, validate with Google Maps API:
        // - If HIGH confidence → use formatted address
        // - If needsUnit → ask for unit number
        // - If LOW confidence → ask for clarification
        // ═══════════════════════════════════════════════════════════════════════
        if ((fieldKey === 'address' || step.type === 'address') && extractResult.value) {
            try {
                const companyId = company?._id?.toString() || 'unknown';
                // 🔌 AW MIGRATION: Read address verification config via AWConfigReader
                let geoEnabled;
                if (awReader) {
                    awReader.setReaderId('BookingFlowRunner.addressValidation.collect');
                    geoEnabled = awReader.get('booking.addressVerification.enabled', true) !== false;
                } else {
                    geoEnabled = company?.aiAgentSettings?.frontDesk?.booking?.addressVerification?.enabled !== false;
                }
                
                // V93: Pass callId for GEO_LOOKUP events in Raw Events
                addressValidation = await AddressValidationService.validateAddress(
                    extractResult.value,
                    { companyId, callId: callSid, enabled: geoEnabled }
                );
                
                // ═══════════════════════════════════════════════════════════════
                // V93: ADDRESS COMPLETENESS POLICY (always read, even if geo skipped)
                // ═══════════════════════════════════════════════════════════════
                let requireCity = true, requireState = true, requireZip = false;
                let requireUnitQuestion = true, unitQuestionMode = 'house_or_unit';
                let missingCityStatePrompt = "Got it — what city and state is that in?";
                let unitTypePrompt = "Is this a house, or an apartment, suite, or unit? If it's a unit, what's the number?";
                
                if (awReader) {
                    awReader.setReaderId('BookingFlowRunner.addressCompleteness');
                    requireCity = awReader.get('booking.addressVerification.requireCity', true) !== false;
                    requireState = awReader.get('booking.addressVerification.requireState', true) !== false;
                    requireZip = awReader.get('booking.addressVerification.requireZip', false) === true;
                    requireUnitQuestion = awReader.get('booking.addressVerification.requireUnitQuestion', true) !== false;
                    unitQuestionMode = awReader.get('booking.addressVerification.unitQuestionMode', 'house_or_unit');
                    missingCityStatePrompt = awReader.get('booking.addressVerification.missingCityStatePrompt', missingCityStatePrompt);
                    unitTypePrompt = awReader.get('booking.addressVerification.unitTypePrompt', unitTypePrompt);
                }
                
                // Use the formatted address when available, otherwise raw
                valueToStore = addressValidation.formattedAddress || addressValidation.normalized || extractResult.value;
                
                if (addressValidation.success && addressValidation.validated) {
                    // Parse address components from Google response
                    const components = addressValidation.components || {};
                    const hasCity = !!(components.locality || components.sublocality || components.postal_town);
                    const hasState = !!(components.administrative_area_level_1);
                    const hasZip = !!(components.postal_code);
                    const hasUnit = !!(components.subpremise || state.bookingCollected?.unit);
                    
                    // Determine what's missing
                    const missing = [];
                    if (requireCity && !hasCity) missing.push('city');
                    if (requireState && !hasState) missing.push('state');
                    if (requireZip && !hasZip) missing.push('zip');
                    
                    // Store validation metadata for later use (including missing components)
                    state.addressValidation = {
                        raw: extractResult.value,
                        formatted: valueToStore,
                        confidence: addressValidation.confidence,
                        placeId: addressValidation.placeId,
                        location: addressValidation.location,
                        needsUnit: addressValidation.needsUnit,
                        unitDetection: addressValidation.unitDetection,
                        components,
                        missing,
                        hasCity,
                        hasState,
                        hasZip,
                        hasUnit
                    };
                    
                    // Emit ADDRESS_VALIDATION_RESULT for debugging (V93)
                    if (BlackBoxLogger?.logEvent && callSid) {
                        BlackBoxLogger.logEvent({
                            callId: callSid,
                            companyId: companyId,
                            type: 'ADDRESS_VALIDATION_RESULT',
                            turn: state.turn || 0,
                            data: {
                                raw: extractResult.value,
                                normalizedPreview: valueToStore,
                                confidence: addressValidation.confidence,
                                missing,
                                hasCity,
                                hasState,
                                hasZip,
                                hasUnit,
                                placeId: addressValidation.placeId,
                                status: 'VALIDATED'
                            }
                        }).catch(() => {}); // Non-blocking
                    }
                    
                    logger.info('[BOOKING FLOW RUNNER] V93 Address validation result', {
                        raw: extractResult.value,
                        formatted: valueToStore,
                        confidence: addressValidation.confidence,
                        missing,
                        hasCity,
                        hasState,
                        hasUnit,
                        needsUnit: addressValidation.needsUnit
                    });
                    
                    // ═══════════════════════════════════════════════════════════════
                    // GATE 1: Missing city/state - ask follow-up BEFORE confirmation
                    // ═══════════════════════════════════════════════════════════════
                    if (missing.length > 0) {
                        state.bookingCollected[fieldKey] = valueToStore;
                        state.addressIncomplete = true;
                        state.addressMissing = missing;
                        
                        logger.warn('[BOOKING FLOW RUNNER] V93: Address incomplete, asking for missing components', {
                            missing,
                            address: valueToStore
                        });
                        
                        return {
                            reply: missingCityStatePrompt,
                            state,
                            isComplete: false,
                            action: 'COLLECT_CITY_STATE',
                            currentStep: 'city_state',
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'ADDRESS_INCOMPLETE',
                                missing,
                                addressValidation: state.addressValidation
                            }
                        };
                    }
                    
                    // ═══════════════════════════════════════════════════════════════
                    // GATE 2: Unit question (house_or_unit mode)
                    // ═══════════════════════════════════════════════════════════════
                    // If requireUnitQuestion and not yet asked, ask now
                    const alreadyAskedUnit = state.addressUnitAsked === true;
                    const shouldAskUnit = (
                        requireUnitQuestion && 
                        !alreadyAskedUnit && 
                        !hasUnit &&
                        (unitQuestionMode === 'always_ask' || 
                         (unitQuestionMode === 'house_or_unit') ||
                         (unitQuestionMode === 'smart' && addressValidation.needsUnit))
                    );
                    
                    if (shouldAskUnit) {
                        state.bookingCollected[fieldKey] = valueToStore;
                        state.addressNeedsUnit = true;
                        state.addressUnitAsked = true;
                        
                        // Use Google's hint if available, otherwise use policy prompt
                        const prompt = addressValidation.needsUnit
                            ? `I found ${valueToStore}. It looks like this might be a ${addressValidation.unitDetection?.buildingLabel || 'building'}. What's the apartment or unit number?`
                            : unitTypePrompt;
                        
                        logger.info('[BOOKING FLOW RUNNER] V93: Asking unit question per policy', {
                            address: valueToStore,
                            unitQuestionMode,
                            needsUnit: addressValidation.needsUnit
                        });
                        
                        return {
                            reply: prompt,
                            state,
                            isComplete: false,
                            action: 'COLLECT_UNIT',
                            currentStep: 'unit',
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'GEO_NEEDS_UNIT',
                                addressValidation: state.addressValidation
                            }
                        };
                    }
                    
                    // Address is complete - proceed with flow
                    logger.info('[BOOKING FLOW RUNNER] V93: Address complete, proceeding', {
                        address: valueToStore,
                        hasCity,
                        hasState,
                        hasUnit
                    });
                } else {
                    // Fallback gating when geo is skipped or fails
                    const fallbackParts = detectAddressParts(extractResult.value);
                    const hasCity = fallbackParts.hasCity;
                    const hasState = fallbackParts.hasState;
                    const hasZip = fallbackParts.hasZip;
                    const hasUnit = fallbackParts.hasUnit || !!state.bookingCollected?.unit;
                    
                    const missing = [];
                    if (requireCity && !hasCity) missing.push('city');
                    if (requireState && !hasState) missing.push('state');
                    if (requireZip && !hasZip) missing.push('zip');
                    
                    state.addressValidation = {
                        raw: extractResult.value,
                        formatted: valueToStore,
                        confidence: addressValidation.confidence,
                        placeId: addressValidation.placeId || null,
                        location: addressValidation.location || null,
                        needsUnit: addressValidation.needsUnit || false,
                        unitDetection: addressValidation.unitDetection || null,
                        components: null,
                        missing,
                        hasCity,
                        hasState,
                        hasZip,
                        hasUnit,
                        validated: false,
                        skipped: !!addressValidation.skipped,
                        skipReason: addressValidation.skipReason || addressValidation.failReason || null
                    };
                    
                    if (BlackBoxLogger?.logEvent && callSid) {
                        BlackBoxLogger.logEvent({
                            callId: callSid,
                            companyId: companyId,
                            type: 'ADDRESS_VALIDATION_RESULT',
                            turn: state.turn || 0,
                            data: {
                                raw: extractResult.value,
                                normalizedPreview: valueToStore,
                                confidence: addressValidation.confidence,
                                missing,
                                hasCity,
                                hasState,
                                hasZip,
                                hasUnit,
                                status: addressValidation.skipped ? 'SKIPPED' : (addressValidation.success ? 'UNVALIDATED' : 'FAILED'),
                                skipReason: addressValidation.skipReason || addressValidation.failReason || null
                            }
                        }).catch(() => {});
                    }
                    
                    if (missing.length > 0) {
                        state.bookingCollected[fieldKey] = valueToStore;
                        state.addressIncomplete = true;
                        state.addressMissing = missing;
                        
                        logger.warn('[BOOKING FLOW RUNNER] V93: Address incomplete (no geo), asking for missing components', {
                            missing,
                            address: valueToStore
                        });
                        
                        return {
                            reply: missingCityStatePrompt,
                            state,
                            isComplete: false,
                            action: 'COLLECT_CITY_STATE',
                            currentStep: 'city_state',
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'ADDRESS_INCOMPLETE_FALLBACK',
                                missing,
                                addressValidation: state.addressValidation
                            }
                        };
                    }
                    
                    const alreadyAskedUnit = state.addressUnitAsked === true;
                    const shouldAskUnit = (
                        requireUnitQuestion &&
                        !alreadyAskedUnit &&
                        !hasUnit &&
                        (unitQuestionMode === 'always_ask' ||
                         (unitQuestionMode === 'house_or_unit') ||
                         (unitQuestionMode === 'smart' && addressValidation.needsUnit))
                    );
                    
                    if (shouldAskUnit) {
                        state.bookingCollected[fieldKey] = valueToStore;
                        state.addressNeedsUnit = true;
                        state.addressUnitAsked = true;
                        
                        logger.info('[BOOKING FLOW RUNNER] V93: Asking unit question (no geo) per policy', {
                            address: valueToStore,
                            unitQuestionMode
                        });
                        
                        return {
                            reply: unitTypePrompt,
                            state,
                            isComplete: false,
                            action: 'COLLECT_UNIT',
                            currentStep: 'unit',
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'UNIT_REQUIRED_FALLBACK',
                                addressValidation: state.addressValidation
                            }
                        };
                    }
                    
                    if (addressValidation.confidence === 'LOW' || !addressValidation.success) {
                        logger.warn('[BOOKING FLOW RUNNER] Address validation low confidence or failed', {
                            raw: extractResult.value,
                            confidence: addressValidation.confidence,
                            reason: addressValidation.reason || addressValidation.failReason || addressValidation.skipReason
                        });
                        state.addressLowConfidence = true;
                    }
                }
            } catch (geoError) {
                logger.warn('[BOOKING FLOW RUNNER] Address validation error (non-blocking)', {
                    error: geoError.message,
                    address: extractResult.value
                });
                // Continue with raw value if Google validation fails
                valueToStore = extractResult.value;
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: GOOGLE CALENDAR INTEGRATION FOR TIME SLOT
        // ═══════════════════════════════════════════════════════════════════════
        // When collecting time/dateTime preference, check Google Calendar for
        // available slots and offer choices. Handles "ASAP", "morning", "tomorrow", etc.
        // Falls back gracefully if calendar not connected or unavailable.
        // ═══════════════════════════════════════════════════════════════════════
        if ((fieldKey === 'time' || fieldKey === 'dateTime' || step.type === 'time' || step.type === 'dateTime') && extractResult.value) {
            const calendarEnabled = company?.integrations?.googleCalendar?.enabled;
            const calendarConnected = company?.integrations?.googleCalendar?.connected;
            const companyId = company?._id?.toString();
            
            if (calendarEnabled && calendarConnected && companyId) {
                try {
                    const userPreference = extractResult.value; // e.g., "ASAP", "tomorrow morning", "Friday"
                    
                    // Get available slots based on user preference
                    const availableSlots = await GoogleCalendarService.findAvailableSlots(
                        companyId,
                        new Date(), // Start from now
                        step.serviceType || 'default'
                    );
                    
                    if (availableSlots && availableSlots.slots && availableSlots.slots.length > 0) {
                        // Filter slots based on user preference if possible
                        const topSlots = availableSlots.slots.slice(0, 3);
                        
                        // Format slot options for user
                        const slotChoices = topSlots.map((slot, idx) => {
                            const start = new Date(slot.start);
                            const dayName = start.toLocaleDateString('en-US', { weekday: 'long' });
                            const date = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                            const time = start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                            return `${dayName} ${date} at ${time}`;
                        });
                        
                        // Store slots for selection
                        state.availableSlots = topSlots;
                        state.awaitingSlotSelection = true;
                        
                        const choicesFormatted = slotChoices.length === 1 
                            ? slotChoices[0]
                            : slotChoices.slice(0, -1).join(', ') + ', or ' + slotChoices[slotChoices.length - 1];
                        
                        logger.info('[BOOKING FLOW RUNNER] V92: Offering calendar slots', {
                            userPreference,
                            slotsFound: topSlots.length,
                            choices: slotChoices
                        });
                        
                        return {
                            reply: `I have the following available: ${choicesFormatted}. Which works best for you?`,
                            state,
                            isComplete: false,
                            action: 'OFFER_TIME_SLOTS',
                            currentStep: step.id,
                            availableSlots: slotChoices,
                            matchSource: 'BOOKING_FLOW_RUNNER',
                            tier: 'tier1',
                            tokensUsed: 0,
                            latencyMs: Date.now() - startTime,
                            debug: {
                                source: 'BOOKING_FLOW_RUNNER',
                                flowId: flow.flowId,
                                mode: 'CALENDAR_SLOT_SELECTION',
                                userPreference,
                                slotsOffered: slotChoices.length
                            }
                        };
                    } else if (availableSlots?.fallback) {
                        // Calendar returned fallback mode (e.g., service not available same-day)
                        logger.info('[BOOKING FLOW RUNNER] V92: Calendar fallback mode', {
                            message: availableSlots.message,
                            reason: availableSlots.reason
                        });
                        // Store preference and let human schedule
                        valueToStore = userPreference;
                    } else {
                        // No slots available - store preference for human to handle
                        logger.warn('[BOOKING FLOW RUNNER] V92: No calendar slots available', {
                            userPreference
                        });
                        valueToStore = userPreference;
                    }
                } catch (calendarError) {
                    // Calendar error - fall back to preference capture
                    logger.warn('[BOOKING FLOW RUNNER] V92: Calendar lookup failed (non-blocking)', {
                        error: calendarError.message,
                        preference: extractResult.value
                    });
                    // Continue with user's stated preference
                    valueToStore = extractResult.value;
                }
            } else {
                // Calendar not enabled - use preference capture mode
                logger.info('[BOOKING FLOW RUNNER] V92: Calendar not enabled, using preference', {
                    calendarEnabled,
                    calendarConnected,
                    preference: extractResult.value
                });
                valueToStore = extractResult.value;
            }
        }
        
        // 🚫 Address plausibility guard: reject junk when not validated
        if ((fieldKey === 'address' || step.type === 'address') && extractResult.value) {
            const validated = addressValidation?.validated === true || state.addressValidation?.validated === true;
            const plausible = looksLikeAddress(extractResult.value);
            if (!validated && !plausible) {
                state.askCount = state.askCount || {};
                state.askCount[step.id] = (state.askCount[step.id] || 0) + 1;
                logger.warn('[BOOKING FLOW RUNNER] Address rejected: not plausible and not validated', {
                    input: extractResult.value,
                    validated,
                    askCount: state.askCount[step.id]
                });
                return this.repromptStep(step, state, flow, 'address_not_plausible');
            }
        }
        
        // V96f: Use safeSetSlot for identity fields, direct write for others
        if (IDENTITY_SLOTS.has(fieldKey)) {
            const setResult = safeSetSlot(state, fieldKey, valueToStore, {
                source: 'direct_collection',
                confidence: 0.9
            });
            if (setResult.accepted) {
                markSlotConfirmed(state, fieldKey);
            } else {
                logger.warn('[BOOKING FLOW RUNNER] V96f: Identity slot rejected during collection', {
                    fieldKey,
                    reason: setResult.reason,
                    value: valueToStore
                });
                return this.repromptStep(step, state, flow, `invalid_${fieldKey}`);
            }
        } else {
            // Non-identity slots (address, time, etc.) - direct write
            state.bookingCollected[fieldKey] = valueToStore;
            state.confirmedSlots = state.confirmedSlots || {};
            state.confirmedSlots[fieldKey] = true;
        }
        state.lastExtracted = { [fieldKey]: valueToStore };
        
        if (state.askCount) {
            delete state.askCount[step.id];
        }
        
        logger.info('[BOOKING FLOW RUNNER] Value collected', {
            stepId: step.id,
            fieldKey,
            value: valueToStore,
            geoValidated: addressValidation?.success || false
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: FULL NAME HANDLING - Wire askFullName, lastNameQuestion, etc.
        // ═══════════════════════════════════════════════════════════════════════
        // If name slot has askFullName: true and askMissingNamePart: true,
        // and user only gave first name, ask for last name before advancing
        // NOTE: Options are in step.options (from BookingFlowResolver)
        // ═══════════════════════════════════════════════════════════════════════
        const slotOptions = step.options || {};
        const askFullName = slotOptions.askFullName || step.askFullName;
        const askMissingNamePart = slotOptions.askMissingNamePart || step.askMissingNamePart;
        
        if ((fieldKey === 'name' || step.type === 'name') && askFullName && askMissingNamePart) {
            const nameParts = (valueToStore || '').trim().split(/\s+/);
            const hasLastName = nameParts.length >= 2;
            
            if (!hasLastName && !state.askedForLastName) {
                // User only gave first name - ask for last name
                const firstName = nameParts[0] || valueToStore;
                state.firstNameCollected = firstName;
                state.askedForLastName = true;
                
                // Use configured lastNameQuestion or default
                const lastNameQuestion = slotOptions.lastNameQuestion || step.lastNameQuestion || "And what's your last name?";
                const ack = `Got it, ${firstName}.`;
                
                logger.info('[BOOKING FLOW RUNNER] V92: Asking for last name', {
                    firstName,
                    askFullName,
                    askMissingNamePart,
                    lastNameQuestion,
                    slotOptionsPresent: !!step.options
                });
                
                return {
                    reply: `${ack} ${lastNameQuestion}`,
                    state,
                    isComplete: false,
                    action: 'COLLECT_LAST_NAME',
                    currentStep: step.id,
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: Date.now() - startTime,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        mode: 'ASK_LAST_NAME',
                        firstName,
                        askFullName,
                        slotOptions: Object.keys(slotOptions)
                    }
                };
            } else if (state.firstNameCollected && state.askedForLastName) {
                // This is the last name response - combine with first name
                const lastName = valueToStore;
                const fullName = `${state.firstNameCollected} ${lastName}`;
                
                // V96f: Use safeSetSlot for combined name
                const setResult = safeSetSlot(state, fieldKey, fullName, {
                    source: 'combined_first_last',
                    confidence: 0.95
                });
                if (setResult.accepted) {
                    markSlotConfirmed(state, fieldKey);
                    valueToStore = fullName;
                } else {
                    logger.warn('[BOOKING FLOW RUNNER] V96f: Combined name rejected', {
                        fullName,
                        reason: setResult.reason
                    });
                }
                
                // Clear flags
                delete state.firstNameCollected;
                delete state.askedForLastName;
                
                logger.info('[BOOKING FLOW RUNNER] V92: Combined full name', {
                    fullName,
                    firstName: state.firstNameCollected,
                    lastName
                });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: CONFIRM SPELLING FOR NAME - Wire confirmSpelling from booking prompts
        // ═══════════════════════════════════════════════════════════════════════
        // If name slot has confirmSpelling: true, spell back the name letter-by-letter
        // for similar-sounding names (Mark/Marc, John/Jon, etc.) before proceeding.
        // This addresses the "Biggest current bug" from wiring analysis.
        // ═══════════════════════════════════════════════════════════════════════
        const confirmSpelling = slotOptions.confirmSpelling || step.confirmSpelling;
        
        if ((fieldKey === 'name' || step.type === 'name') && confirmSpelling && !state.spellingConfirmed) {
            const nameToSpell = valueToStore || state.bookingCollected[fieldKey];
            
            if (nameToSpell && this.needsSpellingCheck(nameToSpell)) {
                // Spell out the name letter by letter
                const spelled = nameToSpell.toUpperCase().split('').join(' - ');
                const spellingPrompt = slotOptions.spellingConfirmPrompt || step.spellingConfirmPrompt || 
                    `Let me confirm the spelling: ${spelled}. Is that correct?`;
                
                state.pendingSpellingConfirm = {
                    fieldKey,
                    value: nameToSpell,
                    step: step.id
                };
                
                logger.info('[BOOKING FLOW RUNNER] V92: Asking spelling confirmation', {
                    name: nameToSpell,
                    spelled,
                    confirmSpelling: true
                });
                
                return {
                    reply: spellingPrompt,
                    state,
                    isComplete: false,
                    action: 'CONFIRM_SPELLING',
                    currentStep: step.id,
                    matchSource: 'BOOKING_FLOW_RUNNER',
                    tier: 'tier1',
                    tokensUsed: 0,
                    latencyMs: Date.now() - startTime,
                    debug: {
                        source: 'BOOKING_FLOW_RUNNER',
                        flowId: flow.flowId,
                        mode: 'CONFIRM_SPELLING',
                        nameToSpell,
                        spelled
                    }
                };
            } else {
                // Name doesn't need spelling check (common/unique enough)
                state.spellingConfirmed = true;
            }
        }
        
        // Find next action
        const nextAction = this.determineNextAction(flow, state, {});
        
        if (!nextAction) {
            return this.buildConfirmation(flow, state);
        }
        
        state.currentStepId = nextAction.step.id;
        
        const ack = this.buildAcknowledgment(step, extractResult.value);
        let nextPrompt;
        
        if (nextAction.mode === 'CONFIRM') {
            nextPrompt = this.buildConfirmPrompt(nextAction.step, nextAction.existingValue);
            state.pendingConfirmation = {
                fieldKey: nextAction.step.fieldKey || nextAction.step.id,
                value: nextAction.existingValue,
                step: nextAction.step.id
            };
        } else {
            nextPrompt = nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`;
        }
        
        const reply = ack ? `${ack} ${nextPrompt}` : nextPrompt;
        
        return {
            reply,
            state,
            isComplete: false,
            action: 'CONTINUE',
            stepCompleted: step.id,
            nextStep: nextAction.step.id,
            nextMode: nextAction.mode,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: Date.now() - startTime,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stepCompleted: step.id,
                nextStep: nextAction.step.id,
                nextMode: nextAction.mode,
                extracted: extractResult.value,
                bookingCollected: state.bookingCollected
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD CONFIRM PROMPT - Use slot config from booking prompt tab
     * ========================================================================
     * V92 FIX: Wire confirmPrompt, askFullName, lastNameQuestion, etc.
     * from the booking prompt tab configuration instead of hardcoded defaults
     * NOTE: Options may be in step.options (from BookingFlowResolver)
     * ========================================================================
     */
    static buildConfirmPrompt(step, existingValue) {
        const type = step.type || step.id;
        const options = step.options || {};
        
        // ═══════════════════════════════════════════════════════════════════
        // V92: Use slot's confirmPrompt from booking prompt tab if available
        // Check both step.confirmPrompt and step.options.confirmPrompt
        // ═══════════════════════════════════════════════════════════════════
        const confirmPrompt = options.confirmPrompt || step.confirmPrompt;
        if (confirmPrompt) {
            // Replace {value} placeholder with actual value
            return confirmPrompt
                .replace(/\{value\}/gi, existingValue || '')
                .replace(/\{name\}/gi, existingValue || '')
                .replace(/\{address\}/gi, existingValue || '')
                .replace(/\{phone\}/gi, existingValue || '')
                .replace(/\{time\}/gi, existingValue || '');
        }
        
        // Fallback to defaults if no custom prompt configured
        switch (type) {
            case 'phone':
                return `I can send confirmations to ${existingValue}. Is this the best number to reach you?`;
            case 'name':
                return `I have your name as ${existingValue}. Is that correct?`;
            case 'address':
                return `The service address I have is ${existingValue}. Is that right?`;
            case 'email':
                return `I have your email as ${existingValue}. Is that correct?`;
            case 'time':
                return `I have you down for ${existingValue}. Does that work?`;
            default:
                return `I have ${existingValue} for your ${step.label || type}. Is that correct?`;
        }
    }
    
    /**
     * ========================================================================
     * PARSE CONFIRMATION RESPONSE
     * ========================================================================
     */
    static parseConfirmationResponse(input) {
        // V92 FIX: Strip punctuation before matching
        // "yep." should match as "yep"
        const text = (input || '').toLowerCase().trim().replace(/[.,!?]+$/, '');
        
        // Positive confirmations
        const positivePatterns = [
            /^(yes|yeah|yep|yup|correct|right|sure|ok|okay|uh huh|mhm|affirmative|absolutely|definitely)$/,
            /\b(yes|yeah|correct|right)\b.*\b(it is|that's|is)\b/,
            /\b(that's?|it's?|is)\s+(correct|right|good|fine|perfect)\b/,
            /\b(this|that)\s+(number|one)\s+(is\s+)?(good|fine|ok|correct|works)\b/,
            /\buse\s+(this|that|the same)\b/,
            /\bsounds?\s+(good|great|fine|correct)\b/
        ];
        
        if (positivePatterns.some(p => p.test(text))) {
            return { confirmed: true };
        }
        
        // Negative / denial
        const negativePatterns = [
            /^(no|nope|nah|wrong|incorrect|negative|nah)$/,
            /\b(no|not)\s+(correct|right|that's not)\b/,
            /\bthat's?\s+(wrong|incorrect|not right)\b/,
            /\bwrong\s+(number|address|name)\b/,
            /\bchange\s+(it|that)\b/,
            /\bdifferent\s+(number|one)\b/
        ];
        
        if (negativePatterns.some(p => p.test(text))) {
            return { denied: true };
        }
        
        // Check if user provided a new phone number
        const phoneMatch = input.match(/(\d[\d\-\.\(\)\s]{8,}\d)/);
        if (phoneMatch) {
            const digits = phoneMatch[1].replace(/\D/g, '');
            if (digits.length >= 10) {
                const formatted = `(${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-${digits.slice(-4)}`;
                return { newValue: formatted };
            }
        }
        
        // FEB 2026 FIX: Check if user provided an ADDRESS
        // Address pattern: number + street name (with optional street type suffix)
        // "12155 Metro Parkway", "123 Main Street", "456 Oak Drive Apt 2"
        const addressPattern = /^\d+\s+[a-zA-Z]+(?:\s+[a-zA-Z]+)*(?:\s+(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|court|ct|circle|cir|way|place|pl|parkway|pkwy|highway|hwy))?/i;
        if (addressPattern.test(input.trim())) {
            // User provided an address directly - use it as new value
            return { newValue: input.trim(), isAddress: true };
        }
        
        // Check if user provided what looks like a name
        // FEB 2026 FIX: Also allow lowercase names (after STT preprocessing)
        const namePattern = /^([a-zA-Z]{2,}(?:\s+[a-zA-Z]{2,})?)$/i;
        const nameMatch = input.match(namePattern);
        if (nameMatch) {
            // Title case the name
            const titleCased = nameMatch[1].split(/\s+/).map(w => 
                w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
            ).join(' ');
            return { newValue: titleCased };
        }
        
        return { unclear: true };
    }
    
    /**
     * ========================================================================
     * INITIALIZE STATE
     * ========================================================================
     */
    static initializeState(state, flow, slots = {}) {
        const initialized = {
            bookingModeLocked: true,
            bookingFlowId: flow.flowId,
            currentStepId: state?.currentStepId || flow.steps[0]?.id,
            bookingCollected: state?.bookingCollected || {},
            slotMetadata: state?.slotMetadata || {},
            confirmedSlots: state?.confirmedSlots || {},
            askCount: state?.askCount || {},
            startedAt: state?.startedAt || new Date().toISOString(),
            ...state
        };
        
        // Merge slot metadata from pre-extracted slots
        if (slots && Object.keys(slots).length > 0) {
            for (const [key, slotData] of Object.entries(slots)) {
                if (slotData && !initialized.slotMetadata[key]) {
                    initialized.slotMetadata[key] = slotData;
                }
            }
        }
        
        return initialized;
    }
    
    /**
     * ========================================================================
     * EXTRACT VALUE - Use slot-specific extractor
     * ========================================================================
     */
    static extractValue(input, step, state, company) {
        const type = step.type || step.id;
        const extractor = SlotExtractors[type] || SlotExtractors.default;
        
        const value = extractor(input, step, { state, company });
        
        if (!value) {
            return {
                isValid: false,
                value: null,
                reason: `Could not extract ${step.label || step.id} from input`
            };
        }
        
        // Validate extracted value
        const validation = step.validation || {};
        
        if (validation.minLength && value.length < validation.minLength) {
            return {
                isValid: false,
                value: null,
                reason: `${step.label || step.id} must be at least ${validation.minLength} characters`
            };
        }
        
        if (validation.minDigits && type === 'phone') {
            const digits = value.replace(/\D/g, '');
            if (digits.length < validation.minDigits) {
                return {
                    isValid: false,
                    value: null,
                    reason: `Phone number must have at least ${validation.minDigits} digits`
                };
            }
        }
        
        if (validation.pattern && typeof validation.pattern === 'string') {
            const regex = new RegExp(validation.pattern);
            if (!regex.test(value)) {
                return {
                    isValid: false,
                    value: null,
                    reason: `${step.label || step.id} format is invalid`
                };
            }
        }
        
        return {
            isValid: true,
            value,
            reason: null
        };
    }
    
    /**
     * ========================================================================
     * FIND NEXT REQUIRED STEP - Skip already-collected steps
     * ========================================================================
     */
    static findNextRequiredStep(flow, state) {
        const collected = state.bookingCollected || {};
        
        for (const step of flow.steps) {
            // Skip optional steps
            if (!step.required) continue;
            
            const fieldKey = step.fieldKey || step.id;
            
            // Skip if already collected
            if (collected[fieldKey]) continue;
            
            return step;
        }
        
        return null; // All required steps collected
    }
    
    /**
     * ========================================================================
     * ASK STEP - Build response to ask for a step
     * ========================================================================
     */
    static askStep(step, state, flow) {
        const prompt = step.prompt || `What is your ${step.label || step.id}?`;
        
        // Track ask count
        state.askCount = state.askCount || {};
        state.askCount[step.id] = (state.askCount[step.id] || 0) + 1;
        
        return {
            reply: prompt,
            state,
            isComplete: false,
            action: 'CONTINUE',
            currentStep: step.id,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                currentStep: step.id,
                askCount: state.askCount[step.id]
            }
        };
    }
    
    /**
     * ========================================================================
     * REPROMPT STEP - Ask again with clarification
     * ========================================================================
     */
    static repromptStep(step, state, flow, reason) {
        const reprompt = step.reprompt || 
            `I didn't quite catch that. ${step.prompt || `What is your ${step.label || step.id}?`}`;
        
        return {
            reply: reprompt,
            state,
            isComplete: false,
            action: 'REPROMPT',
            currentStep: step.id,
            repromptReason: reason,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                currentStep: step.id,
                repromptReason: reason,
                askCount: state.askCount?.[step.id] || 0
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD ACKNOWLEDGMENT - Short ack for collected value
     * ========================================================================
     */
    static buildAcknowledgment(step, value) {
        const type = step.type || step.id;
        
        const acks = {
            name: ['Got it.', 'Perfect.', 'Thank you.'],
            phone: ['Great.', 'Got it.', 'Perfect.'],
            address: ['Got it.', 'Thank you.', 'Perfect.'],
            time: ['Great.', 'Perfect.', 'Sounds good.'],
            default: ['Got it.', 'Thank you.', 'Perfect.']
        };
        
        const options = acks[type] || acks.default;
        return options[Math.floor(Math.random() * options.length)];
    }
    
    /**
     * ========================================================================
     * BUILD CONFIRMATION - All required data collected
     * ========================================================================
     */
    static buildConfirmation(flow, state) {
        const collected = state.bookingCollected || {};
        
        // Build confirmation message from template
        let confirmation = flow.confirmationTemplate || 
            "Let me confirm: I have {name} at {phone}, service address {address}. Is that correct?";
        
        // Replace placeholders - strip trailing punctuation to avoid double periods
        confirmation = confirmation.replace(/\{(\w+)\}/g, (match, key) => {
            const value = collected[key] || match;
            // Strip trailing punctuation from values to avoid "address 123 Main St.." issues
            if (typeof value === 'string') {
                return value.replace(/[.,!?]+$/, '').trim();
            }
            return value;
        });
        
        // Mark flow as awaiting confirmation
        state.awaitingConfirmation = true;
        state.currentStepId = 'CONFIRMATION';
        
        return {
            reply: confirmation,
            state,
            isComplete: false,
            action: 'CONFIRM',
            bookingCollected: collected,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stage: 'CONFIRMATION',
                bookingCollected: collected
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD COMPLETION - Booking finalized
     * ========================================================================
     * V92: Added SMS notification on booking complete
     * ========================================================================
     */
    static buildCompletion(flow, state, company = null) {
        const completion = flow.completionTemplate ||
            "Your appointment has been scheduled. Is there anything else I can help you with?";
        
        // Unlock booking mode
        state.bookingModeLocked = false;
        state.bookingComplete = true;
        state.completedAt = new Date().toISOString();
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92: SEND SMS CONFIRMATION (fire-and-forget, non-blocking)
        // ═══════════════════════════════════════════════════════════════════════
        // If company has SMS notifications enabled, send booking confirmation.
        // This runs async and doesn't block the completion response.
        // ═══════════════════════════════════════════════════════════════════════
        const collected = state.bookingCollected || {};
        const companyId = company?._id?.toString() || state.companyId;
        const smsEnabled = company?.integrations?.smsNotifications?.enabled;
        const customerPhone = collected.phone;
        
        if (smsEnabled && companyId && customerPhone) {
            // Fire-and-forget SMS - don't block completion
            const bookingData = {
                customerName: collected.name || 'Customer',
                customerPhone: customerPhone,
                appointmentTime: collected.time || collected.dateTime || 'TBD',
                serviceAddress: collected.address || 'N/A',
                serviceType: collected.serviceType || flow.serviceType || 'service',
                companyName: company?.companyName || company?.name || 'Us',
                bookingId: state.bookingId || `BK-${Date.now()}`
            };
            
            SMSNotificationService.sendBookingConfirmation(companyId, bookingData)
                .then(result => {
                    logger.info('[BOOKING FLOW RUNNER] V92: SMS confirmation sent', {
                        companyId,
                        phone: customerPhone,
                        success: result?.success,
                        method: result?.method
                    });
                })
                .catch(smsError => {
                    logger.warn('[BOOKING FLOW RUNNER] V92: SMS confirmation failed (non-blocking)', {
                        companyId,
                        phone: customerPhone,
                        error: smsError.message
                    });
                });
            
            // Also schedule reminders if configured
            SMSNotificationService.scheduleReminders(companyId, bookingData)
                .catch(reminderError => {
                    logger.warn('[BOOKING FLOW RUNNER] V92: Reminder scheduling failed', {
                        companyId,
                        error: reminderError.message
                    });
                });
        } else {
            logger.info('[BOOKING FLOW RUNNER] V92: SMS notifications skipped', {
                smsEnabled,
                hasCompanyId: !!companyId,
                hasPhone: !!customerPhone
            });
        }
        
        return {
            reply: completion,
            state,
            isComplete: true,
            action: 'COMPLETE',
            bookingCollected: state.bookingCollected,
            smsSent: smsEnabled && !!customerPhone,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stage: 'COMPLETE',
                bookingCollected: state.bookingCollected,
                smsAttempted: smsEnabled && !!customerPhone
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD ESCALATION - Failed to collect after 3 attempts
     * ========================================================================
     */
    static buildEscalation(step, state, flow, reason) {
        // Unlock booking mode and signal transfer
        state.bookingModeLocked = false;
        state.escalated = true;
        state.escalationReason = reason;
        
        return {
            reply: "I'm having trouble getting that information. Let me connect you with someone who can help.",
            state,
            isComplete: false,
            action: 'ESCALATE',
            requiresTransfer: true,
            transferReason: reason,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stage: 'ESCALATE',
                failedStep: step.id,
                reason,
                askCount: state.askCount?.[step.id] || 0
            }
        };
    }
    
    /**
     * ========================================================================
     * V92: EVALUATE CONDITIONAL STEP
     * ========================================================================
     * Checks if a step's condition is met based on current state.
     * 
     * Supported conditions:
     * - { stateKey: 'addressValidation.needsUnit', equals: true }
     * - { stateKey: 'collected.propertyType', in: ['apartment', 'condo'] }
     * - { stateKey: 'addressNeedsUnit', equals: true }
     * 
     * @param {Object} condition - The condition object from step definition
     * @param {Object} state - Current booking state
     * @param {Object} collected - Collected slot values
     * @returns {boolean} True if condition is met, step should run
     */
    static evaluateCondition(condition, state, collected) {
        if (!condition) return true; // No condition = always run
        
        const { stateKey, equals, in: inArray, notNull } = condition;
        
        // Get the value from state or collected using dot notation
        let value;
        if (stateKey?.startsWith('collected.')) {
            const key = stateKey.replace('collected.', '');
            value = collected[key];
        } else {
            // Navigate nested state keys like 'addressValidation.needsUnit'
            value = stateKey?.split('.').reduce((obj, key) => obj?.[key], state);
        }
        
        // Evaluate condition type
        if (typeof equals !== 'undefined') {
            return value === equals;
        }
        
        if (Array.isArray(inArray)) {
            return inArray.includes(value);
        }
        
        if (notNull) {
            return value != null;
        }
        
        // Default: truthy check
        return !!value;
    }
    
    /**
     * ========================================================================
     * BUILD ERROR RESPONSE
     * ========================================================================
     */
    static buildErrorResponse(error, state) {
        return {
            reply: "I apologize, but I'm having trouble with the booking system. Let me connect you with someone who can help.",
            state: {
                ...state,
                bookingModeLocked: false,
                error
            },
            isComplete: false,
            action: 'ERROR',
            requiresTransfer: true,
            transferReason: error,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                stage: 'ERROR',
                error
            }
        };
    }
    
    /**
     * ========================================================================
     * HANDLE CONFIRMATION RESPONSE - Process yes/no to confirmation
     * ========================================================================
     * V92: Added company parameter for SMS notifications on completion
     * ========================================================================
     */
    static handleConfirmationResponse(userInput, flow, state, company = null) {
        const input = (userInput || '').toLowerCase().trim();
        
        // Check for confirmation
        const confirmPatterns = /^(yes|yeah|yep|yup|correct|that's right|that's correct|right|affirmative|absolutely|sure|ok|okay)$/i;
        const denyPatterns = /^(no|nope|wrong|incorrect|that's wrong|not right|change|fix|redo)$/i;
        
        if (confirmPatterns.test(input) || input.includes('yes') || input.includes('correct')) {
            // Confirmed - complete the booking
            logger.info('[BOOKING FLOW RUNNER] Confirmation received - completing booking');
            return this.buildCompletion(flow, state, company);
        }
        
        if (denyPatterns.test(input) || input.includes('no') || input.includes('wrong')) {
            // Denied - need to re-collect
            logger.info('[BOOKING FLOW RUNNER] Confirmation denied - user wants to change');
            
            // For now, just ask what they want to change
            // Future: Parse which field they want to change
            state.awaitingConfirmation = false;
            
            return {
                reply: "What would you like to change?",
                state,
                isComplete: false,
                action: 'CHANGE_REQUESTED',
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    stage: 'CHANGE_REQUESTED'
                }
            };
        }
        
        // Unclear response - ask again
        return {
            reply: "I'm sorry, I didn't catch that. Is the information I read back correct? Please say yes or no.",
            state,
            isComplete: false,
            action: 'CONFIRM_RETRY',
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stage: 'CONFIRM_RETRY',
                userInput: input
            }
        };
    }
}

module.exports = BookingFlowRunner;
module.exports.SlotExtractors = SlotExtractors;
