/**
 * ============================================================================
 * SLOT EXTRACTOR
 * ============================================================================
 * 
 * THE UNIVERSAL SLOT EXTRACTION ENGINE
 * 
 * This service runs BEFORE any routing (scenarios, LLM, booking) and extracts
 * slots from ANY utterance - discovery, booking, or random conversation.
 * 
 * WHY THIS MATTERS:
 * When caller says "Hi I'm Mark" in discovery, we capture the name NOW.
 * Later, when booking starts, we already have the name - no re-asking.
 * 
 * SLOT METADATA:
 * Each slot has:
 * - value: The extracted value
 * - confidence: 0.0 - 1.0
 * - source: 'caller_id' | 'utterance' | 'manual' | 'crm'
 * - turn: Which turn this was captured
 * - confirmed: Whether user confirmed this value
 * 
 * MERGE RULES:
 * - Never overwrite high-confidence slot with low confidence
 * - If user corrects ("no it's Mike not Mark"), allow overwrite
 * - Caller ID slots start at 0.7 confidence (need confirmation)
 * - Explicit utterance slots are 0.9 confidence
 * - Confirmed slots are 1.0 confidence
 * 
 * AW INTEGRATION (Phase 6b):
 * Config reads go through AWConfigReader when available in context.
 * This enables CONFIG_READ tracing and AW ⇄ RE marriage.
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');

// AWConfigReader for traced config reads (Phase 6b)
let AWConfigReader;
try {
    AWConfigReader = require('../../wiring/AWConfigReader');
} catch (e) {
    logger.warn('[SLOT EXTRACTOR] AWConfigReader not available - direct config access');
}

// V96g: BlackBoxLogger for slot extraction tracing
let BlackBoxLogger;
try {
    BlackBoxLogger = require('../../BlackBoxLogger');
} catch (e) {
    logger.warn('[SLOT EXTRACTOR] BlackBoxLogger not available - tracing disabled');
}

/**
 * Confidence thresholds
 */
const CONFIDENCE = {
    CALLER_ID: 0.7,        // From phone metadata - needs confirmation
    UTTERANCE_LOW: 0.6,    // Extracted but uncertain
    UTTERANCE_HIGH: 0.9,   // Extracted with strong pattern match
    CONFIRMED: 1.0,        // User explicitly confirmed
    MANUAL: 1.0,           // Entered by human agent
    CRM: 0.85              // From CRM lookup
};

/**
 * ============================================================================
 * GREETING DEDUPLICATION (Feb 2026)
 * ============================================================================
 * Prevents "Hi Mark" on every turn. Tracks when name has been used in greeting.
 * 
 * Rules:
 * - First time name is available → allow one greeting (e.g., "Hi Mark!")
 * - After that → state.meta.greetedFirstNameOnce = true
 * - All subsequent turns → don't repeat name in greeting
 */
const GreetingTracker = {
    /**
     * Check if we should greet by name this turn
     * @returns {boolean} true if we can use name in greeting
     */
    shouldGreetByName(state) {
        return state?.slots?.name?.value && !state?.meta?.greetedFirstNameOnce;
    },
    
    /**
     * Mark that we've greeted by name
     */
    markGreeted(state) {
        state.meta = state.meta || {};
        state.meta.greetedFirstNameOnce = true;
        state.meta.greetedAtTurn = state.turnCount || 1;
        return state;
    },
    
    /**
     * Get the first name for greeting (from various slot formats)
     */
    getFirstName(state) {
        const nameSlot = state?.slots?.name || state?.slots?.firstName;
        if (!nameSlot?.value) return null;
        
        const fullName = nameSlot.value;
        // Extract first name (first word)
        return fullName.split(' ')[0];
    },
    
    /**
     * Build a natural greeting if appropriate
     * Returns empty string if we've already greeted
     */
    buildGreeting(state) {
        if (!this.shouldGreetByName(state)) {
            return '';
        }
        
        const firstName = this.getFirstName(state);
        if (!firstName) return '';
        
        // Mark that we've greeted
        this.markGreeted(state);
        
        return `Hi ${firstName}! `;
    }
};

/**
 * Slot sources
 */
const SOURCE = {
    CALLER_ID: 'caller_id',
    UTTERANCE: 'utterance',
    MANUAL: 'manual',
    CRM: 'crm'
};

const CALL_REASON_PATTERNS = [
    { regex: /not\s+cool|no\s+cool|warm\s+air|hot\s+air/i, label: 'AC not cooling' },
    { regex: /not\s+heat|no\s+heat/i, label: 'not heating' },
    { regex: /not\s+turn|not\s+run|system\s+dead|thermostat.*blank/i, label: 'system not running' },
    { regex: /not\s+work|not\s+working|isn'?t\s+work|isn'?t\s+working|stopped\s+working|won'?t\s+work/i, label: 'system not working' },
    { regex: /leak|drip|water/i, label: 'water leak' },
    { regex: /noise|loud|bang|rattle|squeal|buzz/i, label: 'unusual noise' },
    { regex: /smell|burning|smoke/i, label: 'burning smell' },
    { regex: /frozen|ice|frost/i, label: 'frozen unit' },
    { regex: /maintenance|tune[\s-]?up|check[\s-]?up|inspection/i, label: 'maintenance request' },
    { regex: /schedule|appointment|book|send\s+someone|get\s+someone\s+out/i, label: 'service request' }
];

function stripCallReasonIntro(text) {
    let t = `${text || ''}`.trim();
    if (!t) return '';

    // Remove leading greeting.
    t = t.replace(/^(hi|hello|hey)\b[,\s]*/i, '');

    // Remove common "my name is X" intro (keep the remainder).
    t = t.replace(/\bmy\s+name\s+is\s+[a-zA-Z'\-]{2,25}[,\s]*/i, '');

    // Remove "I'm a longtime customer..." style fluff.
    t = t.replace(/\bi\s*(?:am|'m)\s+(?:a\s+)?long[-\s]?time\s+customer\b[^.?!]*[.?!]\s*/i, '');

    // Remove repeated filler.
    t = t.replace(/\b(um|uh)\b[,\s]*/gi, '');

    return t.trim();
}

/**
 * Correction detection patterns
 */
const CORRECTION_PATTERNS = [
    /\bno\s*,?\s*(it'?s?|my\s+name\s+is|i'?m|i\s+am|actually)\s+/i,
    /\bactually\s*(it'?s?|my\s+name\s+is|i'?m|i\s+am)\s+/i,
    /\bsorry\s*,?\s*(it'?s?|my\s+name\s+is|i'?m)\s+/i,
    /\bnot\s+(\w+)\s*,?\s*(it'?s?|my\s+name\s+is|i'?m)\s+/i,
    /\bi\s+said\s+/i,
    /\bspelled\s+/i,
    /\bwith\s+a\s+[a-z]\b/i  // "Mark with a k"
];

/**
 * Name stop words (filter out)
 */
const NAME_STOP_WORDS = new Set([
    'is', 'are', 'was', 'were', 'be', 'been', 'am',
    'the', 'my', 'its', "it's", 'a', 'an', 'name', 'last', 'first',
    'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'no', 'nope',
    'hi', 'hello', 'hey', 'please', 'thanks', 'thank', 'you',
    'it', 'that', 'this', 'what', 'and', 'or', 'but', 'to', 'for', 'with',
    'got', 'two', 'there', 'uh', 'um', 'yup', 'so', 'well', 'just',
    'actually', 'really', 'like', 'know', 'think', 'need', 'want',
    // FEB 2026: Meta-statement words (not actual names)
    // "I just TOLD you my name" → "told" is not a name!
    'told', 'said', 'gave', 'already', 'mentioned', 'repeat',
    // FEB 2026 V92: POISON WORDS - tenure/relationship words misread as names
    // "I am a LONGTIME customer" → "Longtime" is NOT a name!
    'longtime', 'long-time', 'longstanding', 'regular', 'repeat', 'returning',
    'customer', 'client', 'homeowner', 'resident', 'tenant', 'owner', 'caller',
    'sir', 'maam', 'ma\'am', 'mr', 'mrs', 'ms', 'miss', 'mister',
    // FEB 2026 V92: Time-related words misread as names
    // "good MORNING" → "Morning" is NOT a name!
    'morning', 'afternoon', 'evening', 'night', 'today', 'tomorrow',
    // FEB 2026 V92: Business/service words misread as names
    'service', 'appointment', 'schedule', 'scheduling', 'technician', 'tech',
    'visit', 'company', 'business', 'help', 'support', 'assistance',
    'again', 'same', 'correct', 'wrong', 'information',
    // FEB 2026: Question words and common phrases (not names!)
    // "HOW SOON can you get here?" → "How Soon" is NOT a name!
    'how', 'soon', 'when', 'where', 'why', 'which', 'who', 'whom',
    'can', 'could', 'would', 'should', 'will', 'shall', 'may', 'might',
    'get', 'somebody', 'someone', 'something', 'possible', 'good', 'great',
    // FEB 2026 #2: More false positive words found in traces
    // "as EARLY as possible" → "As Early" is NOT a name!
    // "I'm NOT sure" → "Not" is NOT a name!
    // FEB 2026 V92: Confirmation/acknowledgment words
    // "I'm READY" → "Ready" is NOT a name!
    'ready', 'done', 'finished', 'okay', 'alright', 'fine', 'perfect',
    'right', 'correct', 'understood', 'got', 'gotcha',
    // FEB 2026 V92 #2: COMMON VERBS - "I'm HAVING issues" → "Having" is NOT a name!
    // These verbs commonly follow "I'm" but are NOT names
    'having', 'calling', 'looking', 'trying', 'needing', 'wanting',
    'experiencing', 'dealing', 'getting', 'seeing', 'hearing', 'feeling',
    'wondering', 'thinking', 'asking', 'waiting', 'sitting', 'standing',
    'working', 'living', 'staying', 'running', 'going', 'coming',
    // Also add common nouns that follow "I'm a/an"
    'issues', 'issue', 'problem', 'problems', 'trouble',
    // "I'm HERE" → "Here" is NOT a name!
    'early', 'not', 'here', 'there', 'now', 'later', 'then', 'still',
    'case', 'time', 'thing', 'stuff', 'way', 'going', 'come', 'coming',
    'creepy', 'voice', 'said', 'listening', 'help', 'ahead',
    // FEB 2026 #3: Common adjectives mistaken for names
    // "my name is SMART um, and Mark" → "smart" is NOT a name!
    'smart', 'fast', 'slow', 'quick', 'nice', 'kind', 'friendly',
    'long', 'short', 'big', 'small', 'old', 'new', 'young',
    // ═══════════════════════════════════════════════════════════════════════════
    // V94 FIX: INTENSIFIER ADJECTIVES - "it's SUPER hot" → "Super" is NOT a name!
    // This was the exact bug: caller said "my name is Mark... it's super hot"
    // and the extractor grabbed "Super" as the name, overwriting "Mark"
    // ═══════════════════════════════════════════════════════════════════════════
    'super', 'extremely', 'very', 'really', 'pretty', 'quite', 'fairly',
    'totally', 'absolutely', 'completely', 'entirely', 'utterly',
    'seriously', 'literally', 'basically', 'honestly', 'actually',
    'terrible', 'awful', 'horrible', 'amazing', 'incredible', 'fantastic',
    'uncomfortable', 'unbearable', 'ridiculous', 'crazy', 'insane',
    // FEB 2026 #3: Address/street components (NOT names!)
    // "12155 METRO PARKWAY" → "Metro Parkway" is NOT a name!
    'street', 'st', 'avenue', 'ave', 'road', 'rd', 'drive', 'dr',
    'lane', 'ln', 'boulevard', 'blvd', 'court', 'ct', 'circle', 'cir',
    'way', 'place', 'pl', 'parkway', 'pkwy', 'highway', 'hwy',
    'north', 'south', 'east', 'west', 'metro', 'main', 'center',
    'suite', 'apt', 'apartment', 'unit', 'floor', 'building',
    // ═══════════════════════════════════════════════════════════════════════════
    // V92 FIX: VERBS - "it's RUNNING but not cooling" → "Running" is NOT a name!
    // These are action/state words that should NEVER be extracted as names
    // ═══════════════════════════════════════════════════════════════════════════
    'running', 'cooling', 'heating', 'working', 'blowing', 'making',
    'calling', 'trying', 'having', 'being', 'doing', 'going', 'coming',
    'starting', 'stopping', 'turning', 'clicking', 'buzzing', 'humming',
    'leaking', 'dripping', 'freezing', 'defrosting', 'cycling', 'shutting',
    'broken', 'fixed', 'repaired', 'installed', 'replaced', 'checked',
    'looked', 'told', 'called', 'scheduled', 'booked', 'confirmed',
    // V92 FIX: HVAC/Problem descriptors - NOT names!
    // "the system is BLANK" → "Blank" is NOT a name!
    'blank', 'dead', 'frozen', 'stuck', 'loud', 'quiet', 'warm', 'hot', 'cold',
    'problem', 'issue', 'trouble', 'error', 'system', 'unit', 'equipment',
    // ═══════════════════════════════════════════════════════════════════════════
    // FEB 2026 V96m FIX: WATER/LEAK WORDS - NOT names!
    // BUG: "that is water leakage" was extracting "Water Leakage" as a name
    // because "water" and "leakage" weren't in stop words.
    // ═══════════════════════════════════════════════════════════════════════════
    'water', 'leakage', 'leak', 'leaking', 'leaks', 'leaked',
    'flooding', 'flooded', 'flood', 'dripping', 'drip', 'drips',
    'moisture', 'condensation', 'puddle', 'wet', 'damp', 'soggy',
    'thermostat', 'filter', 'vent', 'duct', 'coil', 'compressor', 'condenser',
    'furnace', 'heater', 'ac', 'hvac', 'air', 'conditioning', 'heat', 'pump',
    // ═══════════════════════════════════════════════════════════════════════════
    // V92 FIX: TEMPERATURE/MEASUREMENT WORDS - NOT names!
    // "it's 80 DEGREES IN the house" → "Degrees In" is NOT a name!
    // This was the exact bug: caller said "80 degrees in the house" and 
    // NER extracted "Degrees In" as a name, overwriting the real name "Mark"
    // ═══════════════════════════════════════════════════════════════════════════
    'degrees', 'degree', 'fahrenheit', 'celsius', 'temperature', 'temp',
    'percent', 'percentage', 'humidity', 'pressure', 'psi',
    'inside', 'outside', 'indoor', 'outdoor', 'house', 'home', 'room', 'upstairs', 'downstairs',
    // V92 FIX: Pronouns and articles that slip through
    'its', "it's", 'they', 'them', 'their', 'we', 'our', 'us',
    'one', 'some', 'any', 'all', 'none', 'each', 'every', 'both',
    // V92 FIX: Negation and affirmation words
    'nothing', 'everything', 'anything', 'something', 'never', 'always', 'ever',
    // ═══════════════════════════════════════════════════════════════════════════
    // V96 FIX: ADVERBS AND STATE WORDS - NOT names!
    // ═══════════════════════════════════════════════════════════════════════════
    // BUG: "it's currently not working" was extracting "Currently" as a name
    // because the correction pattern "it's X" matched and "currently" wasn't
    // in the stop words list. The user said "my name is Mark" but the system
    // extracted "Currently" instead.
    // ═══════════════════════════════════════════════════════════════════════════
    'currently', 'presently', 'usually', 'normally', 'typically', 'generally',
    'occasionally', 'sometimes', 'often', 'rarely', 'frequently', 'constantly',
    'definitely', 'certainly', 'probably', 'possibly', 'likely', 'unlikely',
    'apparently', 'obviously', 'clearly', 'simply', 'merely', 'just',
    'finally', 'eventually', 'immediately', 'suddenly', 'gradually', 'slowly',
    'quickly', 'lately', 'recently', 'formerly', 'previously', 'originally',
    // V96: More state/situation words
    'still', 'already', 'yet', 'anymore', 'either', 'neither', 'also', 'too',
    'even', 'almost', 'nearly', 'barely', 'hardly', 'only', 'mostly', 'mainly'
]);

/**
 * ============================================================================
 * V96e: IDENTITY SLOT VALIDATORS
 * ============================================================================
 * 
 * Comprehensive validation to prevent identity slot contamination.
 * These validators ensure:
 * 1. Phone numbers can NEVER be names
 * 2. Names must pass structural validation
 * 3. Typed fields cannot cross-contaminate
 * 
 * This is the PERMANENT fix for the "ANI → lastName" and similar bugs.
 * ============================================================================
 */
const IdentityValidators = {
    /**
     * Check if a string looks like a phone number
     * Used to prevent ANI/phone from contaminating name fields
     */
    looksLikePhone(str) {
        if (!str) return false;
        const digitsOnly = str.replace(/\D/g, '');
        // If >50% digits and has 7+ digits, it's phone-shaped
        const digitRatio = digitsOnly.length / str.length;
        return digitRatio > 0.5 && digitsOnly.length >= 7;
    },
    
    /**
     * Check if a string is valid as a name component
     * Rejects: phone numbers, pure digits, too short, special chars
     */
    isValidNameComponent(str) {
        if (!str || typeof str !== 'string') return false;
        
        const cleaned = str.trim();
        
        // Too short
        if (cleaned.length < 2) return false;
        
        // Too long for a name (probably an address or sentence)
        if (cleaned.length > 50) return false;
        
        // Mostly digits (phone number shaped)
        if (this.looksLikePhone(cleaned)) {
            logger.warn('[IDENTITY VALIDATOR] ❌ Rejected phone-shaped string as name', { value: cleaned });
            return false;
        }
        
        // Contains special characters that names don't have
        if (/[#$%^&*()+=\[\]{}|\\<>?/~`@]/.test(cleaned)) return false;
        
        // Is a stop word
        if (NAME_STOP_WORDS.has(cleaned.toLowerCase())) return false;
        
        // All digits
        if (/^\d+$/.test(cleaned)) return false;
        
        // Must have at least one letter
        if (!/[a-zA-Z]/.test(cleaned)) return false;
        
        return true;
    },
    
    /**
     * Validate and sanitize a name value
     * Returns sanitized name or null if invalid
     */
    sanitizeName(value) {
        if (!value || typeof value !== 'string') return null;
        
        // Split into parts and validate each
        const parts = value.trim().split(/\s+/);
        const validParts = parts.filter(p => this.isValidNameComponent(p));
        
        if (validParts.length === 0) {
            logger.warn('[IDENTITY VALIDATOR] ❌ No valid name parts', { original: value, parts });
            return null;
        }
        
        // Reconstruct with valid parts only
        return validParts.join(' ');
    },
    
    /**
     * Check if a phone number is valid
     */
    isValidPhone(str) {
        if (!str) return false;
        const digits = str.replace(/\D/g, '');
        // Must have 10-15 digits (US phone to international)
        return digits.length >= 10 && digits.length <= 15;
    }
};

/**
 * ============================================================================
 * SLOT EXTRACTOR CLASS
 * ============================================================================
 */
class SlotExtractor {
    
    /**
     * ========================================================================
     * EXTRACT ALL - Main entry point
     * ========================================================================
     * 
     * Extracts all possible slots from an utterance.
     * 
     * @param {string} utterance - The user's speech input
     * @param {Object} context - Additional context
     * @param {number} context.turnCount - Current turn number
     * @param {string} context.callerPhone - Caller's phone number (caller ID)
     * @param {Object} context.existingSlots - Already collected slots
     * @param {Object} context.company - Company document (for custom patterns)
     * 
     * @returns {Object} Extracted slots with metadata:
     * {
     *     name: { value: 'John Smith', confidence: 0.9, source: 'utterance', turn: 3 },
     *     phone: { value: '(555) 123-4567', confidence: 0.7, source: 'caller_id', turn: 1 },
     *     ...
     * }
     */
    static extractAll(utterance, context = {}) {
        const { turnCount = 1, callerPhone, existingSlots = {}, company } = context;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FEB 2026 FIX: BOOKING STEP GATING
        // ═══════════════════════════════════════════════════════════════════════════
        // When we're in a specific booking step, DON'T extract irrelevant slots!
        // This prevents "Metro Parkway" becoming a name during address collection.
        // ═══════════════════════════════════════════════════════════════════════════
        const currentBookingStep = context.expectingSlot || context.currentBookingStep || null;
        const confirmedSlots = context.confirmedSlots || {};
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V110: DISCOVERY MODE SLOT GATING — UI IS LAW
        // ═══════════════════════════════════════════════════════════════════════════
        // Slot extraction in discovery mode is controlled by slotRegistry config.
        // If discoveryFillAllowed === false, block extraction.
        // If discoveryFillAllowed === true (or undefined), allow extraction.
        // ═══════════════════════════════════════════════════════════════════════════
        const bookingModeLocked = context.bookingModeLocked === true;
        const sessionMode = context.sessionMode || 'DISCOVERY';
        const isBookingActive = bookingModeLocked || sessionMode === 'BOOKING';
        
        const slotRegistry = context.slotRegistry || company?.aiAgentSettings?.frontDeskBehavior?.slotRegistry;
        const slots = slotRegistry?.slots || [];
        const slotConfigMap = new Map(slots.map(s => [s.id, s]));
        
        const shouldExtract = (slotKey) => {
            if (confirmedSlots[slotKey] === true) {
                return false;
            }
            
            // Discovery mode: check slotRegistry.discoveryFillAllowed
            if (!isBookingActive && !currentBookingStep) {
                const slotConfig = slotConfigMap.get(slotKey);
                if (slotKey === 'call_reason_detail' && !slotConfig) {
                    return false;
                }
                if (slotConfig?.discoveryFillAllowed === false) {
                    logger.debug('[SLOT EXTRACTOR] Skipping slot (discoveryFillAllowed=false)', { slotKey });
                    return false;
                }
            }
            
            // Booking step gating: prevent cross-contamination between slot types
            if (currentBookingStep) {
                switch (currentBookingStep) {
                    case 'address':
                        if (slotKey === 'name' || slotKey === 'time') return false;
                        break;
                    case 'name':
                    case 'lastName':
                        if (slotKey === 'address') return false;
                        break;
                    case 'phone':
                        if (slotKey === 'name' || slotKey === 'address') return false;
                        break;
                    case 'time':
                        if (slotKey === 'name' || slotKey === 'address') return false;
                        break;
                }
            }
            
            return true;
        };
        
        const extracted = {};
        const text = (utterance || '').trim();
        
        if (!text && !callerPhone) {
            return extracted;
        }
        
        // Detect if this is a correction
        const isCorrection = this.isCorrection(text);
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FEB 2026 FIX: GREETING DETECTION (global, before any extraction)
        // ═══════════════════════════════════════════════════════════════════════════
        // If utterance is ONLY a greeting, skip time extraction entirely
        // "Good afternoon" should NOT extract time: "Afternoon"
        // ═══════════════════════════════════════════════════════════════════════════
        const normalizedText = text.toLowerCase().replace(/^[\s.,;:]+/g, '').trim();
        const isGreetingOnly = /^(good\s+)?(morning|afternoon|evening)[.!?,]*$/i.test(normalizedText) ||
                               /^(hi|hello|hey)[.!?,]*$/i.test(normalizedText) ||
                               /^(yes[,.]?\s*)?(good\s+)?(morning|afternoon|evening)[.!?,]*$/i.test(normalizedText);
        
        // Extract each slot type (with gating)
        if (shouldExtract('name')) {
            const nameResult = this.extractName(text, context);
            if (nameResult) {
                extracted.name = {
                    ...nameResult,
                    turn: turnCount,
                    isCorrection
                };
            }
        } else {
            logger.debug('[SLOT EXTRACTOR] Skipping name extraction (gated)', { currentBookingStep });
        }
        
        if (shouldExtract('phone')) {
            const phoneResult = this.extractPhone(text, callerPhone, context);
            if (phoneResult) {
                extracted.phone = {
                    ...phoneResult,
                    turn: turnCount,
                    isCorrection
                };
            }
        }
        
        if (shouldExtract('address')) {
            const addressResult = this.extractAddress(text, context);
            if (addressResult) {
                extracted.address = {
                    ...addressResult,
                    turn: turnCount,
                    isCorrection
                };
            }
        }

        if (shouldExtract('call_reason_detail')) {
            const callReasonResult = this.extractCallReasonDetail(text);
            if (callReasonResult) {
                extracted.call_reason_detail = {
                    ...callReasonResult,
                    turn: turnCount,
                    isCorrection
                };
            }
        }
        
        // Time extraction: skip if greeting-only OR gated by booking step
        if (shouldExtract('time') && !isGreetingOnly) {
            const timeResult = this.extractTime(text, context);
            if (timeResult) {
                extracted.time = {
                    ...timeResult,
                    turn: turnCount,
                    isCorrection
                };
            }
        } else if (isGreetingOnly) {
            logger.debug('[SLOT EXTRACTOR] Skipping time extraction (greeting-only utterance)');
        }
        
        if (shouldExtract('email')) {
            const emailResult = this.extractEmail(text, context);
            if (emailResult) {
                extracted.email = {
                    ...emailResult,
                    turn: turnCount,
                    isCorrection
                };
            }
        }
        
        // Log extraction results
        if (Object.keys(extracted).length > 0) {
            logger.info('[SLOT EXTRACTOR] Slots extracted from utterance', {
                turnCount,
                currentBookingStep,
                isGreetingOnly,
                extracted: Object.fromEntries(
                    Object.entries(extracted).map(([k, v]) => [k, { value: v.value, confidence: v.confidence }])
                ),
                isCorrection
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V96g: EMIT SLOTS_EXTRACTED EVENT TO BLACK BOX
        // ═══════════════════════════════════════════════════════════════════════════
        // This provides deep visibility into WHY slots were/weren't extracted.
        // Every slot extraction decision is now visible in raw-events.
        // ═══════════════════════════════════════════════════════════════════════════
        if (BlackBoxLogger && context.callId && context.companyId) {
            const extractionTrace = {
                utterance: text.substring(0, 100),
                turnCount,
                currentBookingStep,
                bookingModeLocked,
                sessionMode,
                isBookingActive,
                isCorrection,
                isGreetingOnly,
                extractedSlots: Object.fromEntries(
                    Object.entries(extracted).map(([k, v]) => [k, {
                        value: k === 'phone' ? '***MASKED***' : v.value,
                        confidence: v.confidence,
                        source: v.source,
                        patternSource: v.patternSource,
                        nameLocked: v.nameLocked,
                        extractedViaExplicitPhrase: v.extractedViaExplicitPhrase
                    }])
                ),
                slotsSkipped: {
                    address: !shouldExtract('address') ? 'skipped_discovery_mode' : null,
                    time: !shouldExtract('time') ? 'skipped_discovery_mode' : null,
                    name: !shouldExtract('name') ? 'skipped_step_gating' : null
                },
                confirmedSlotsProtected: Object.keys(confirmedSlots).filter(k => confirmedSlots[k] === true)
            };
            
            BlackBoxLogger.logEvent({
                callId: context.callId,
                companyId: context.companyId,
                type: 'SLOTS_EXTRACTED',
                turn: turnCount,
                data: extractionTrace
            }).catch(() => {}); // Silent fail - never let tracing kill the call
        }
        
        return extracted;
    }
    
    /**
     * ========================================================================
     * MERGE SLOTS - Merge new extractions with existing slots
     * ========================================================================
     * 
     * CANONICAL MERGE RULES (deterministic, no exceptions):
     * 
     * 1. Never overwrite `confirmed=true` unless isCorrection
     * 2. If isCorrection → overwrite and mark correctedByCaller
     * 3. V92 NAME PROTECTION: Never overwrite high-confidence name unless explicit name phrase
     * 4. If new confidence > existing → overwrite
     * 5. If similar confidence but different values → keep existing, mark conflict
     * 6. Track history for debugging
     * 
     * SLOT SHAPE (canonical):
     * - value: string | object
     * - confidence: 0.0 - 1.0
     * - source: 'utterance' | 'caller_id' | 'crm' | 'agent_override'
     * - turn: number
     * - updatedAt: ISO string
     * - confirmed: boolean
     * - needsConfirmation: boolean
     * - conflict: boolean (when values differ but confidence similar)
     * - correctedByCaller: boolean
     * - history: array (previous values for debugging)
     */
    static mergeSlots(existingSlots, newSlots, options = {}) {
        const merged = { ...existingSlots };
        const now = new Date().toISOString();
        
        // V96g: Track merge decisions for tracing
        const mergeDecisions = [];
        
        for (const [key, newSlot] of Object.entries(newSlots)) {
            const existing = merged[key];
            
            // ═══════════════════════════════════════════════════════════════════════════
            // V96e: IDENTITY FIELD VALIDATION - Reject contaminated values EARLY
            // ═══════════════════════════════════════════════════════════════════════════
            // This is the PERMANENT guard against:
            // - Phone numbers becoming names
            // - ANI/caller ID leaking into lastName  
            // - Non-name strings (adverbs, service types) contaminating name fields
            // ═══════════════════════════════════════════════════════════════════════════
            if ((key === 'name' || key === 'firstName' || key === 'lastName' || key === 'partialName') && newSlot.value) {
                const validatedName = IdentityValidators.sanitizeName(newSlot.value);
                if (!validatedName) {
                    logger.warn('[SLOT EXTRACTOR] ❌ V96e: REJECTED contaminated identity slot', {
                        key,
                        rejectedValue: newSlot.value,
                        source: newSlot.source,
                        confidence: newSlot.confidence,
                        reason: 'failed_identity_validation'
                    });
                    // V96g: Track rejection decision
                    mergeDecisions.push({
                        slot: key,
                        action: 'REJECTED',
                        reason: 'failed_identity_validation',
                        rejectedValue: newSlot.value,
                        source: newSlot.source
                    });
                    // Skip this contaminated slot entirely
                    continue;
                }
                // Use sanitized value
                newSlot.value = validatedName;
            }
            
            // Add updatedAt to new slot
            newSlot.updatedAt = now;
            
            if (!existing) {
                // No existing slot - add new one with full metadata
                // V96g: Track new slot addition
                mergeDecisions.push({
                    slot: key,
                    action: 'ADDED',
                    reason: 'new_slot',
                    value: key === 'phone' ? '***MASKED***' : newSlot.value,
                    confidence: newSlot.confidence,
                    source: newSlot.source
                });
                merged[key] = {
                    ...newSlot,
                    confirmed: newSlot.confirmed || false,
                    needsConfirmation: newSlot.needsConfirmation ?? (newSlot.source === SOURCE.CALLER_ID),
                    conflict: false,
                    history: []
                };
                continue;
            }
            
            // ═══════════════════════════════════════════════════════════════════════════
            // RULE 0: V96e IMMUTABILITY CHECK (strongest protection)
            // ═══════════════════════════════════════════════════════════════════════════
            // If a slot is marked immutable (caller confirmed it), it CANNOT be changed
            // unless the caller EXPLICITLY corrects it with a correction phrase.
            // This is the PERMANENT fix for "confirmed name still gets overwritten".
            // ═══════════════════════════════════════════════════════════════════════════
            if (existing.immutable === true) {
                if (newSlot.isCorrection && newSlot.extractedViaExplicitPhrase) {
                    // Caller explicitly corrected with "actually my name is X"
                    logger.info('[SLOT EXTRACTOR] ⚠️ V96e: Unlocking immutable slot due to EXPLICIT correction', {
                        key,
                        oldValue: existing.value,
                        newValue: newSlot.value,
                        correctionPhrase: true
                    });
                    // V96g: Track correction acceptance
                    mergeDecisions.push({
                        slot: key,
                        action: 'UNLOCKED_AND_UPDATED',
                        reason: 'explicit_correction_unlocked_immutable',
                        oldValue: existing.value,
                        newValue: newSlot.value,
                        wasImmutable: true
                    });
                    merged[key] = {
                        ...newSlot,
                        confirmed: false,
                        immutable: false,  // V96e: Correction removes immutability
                        needsConfirmation: true,
                        correctedByCaller: true,
                        conflict: false,
                        history: [...(existing.history || []), { 
                            value: existing.value, 
                            confidence: existing.confidence,
                            turn: existing.turn,
                            reason: 'unlocked_by_explicit_correction',
                            confirmedAt: existing.confirmedAt
                        }]
                    };
                } else {
                    logger.debug('[SLOT EXTRACTOR] ⛔ V96e: Rejected change to IMMUTABLE slot', {
                        key,
                        immutableValue: existing.value,
                        rejectedValue: newSlot.value,
                        confirmedAt: existing.confirmedAt
                    });
                    // V96g: Track immutable rejection
                    mergeDecisions.push({
                        slot: key,
                        action: 'REJECTED',
                        reason: 'immutable_slot_protected',
                        protectedValue: existing.value,
                        rejectedValue: newSlot.value,
                        confirmedAt: existing.confirmedAt
                    });
                }
                continue;
            }
            
            // RULE 1: If existing is confirmed (1.0), never overwrite unless correction
            if (existing.confirmed === true || existing.confidence >= CONFIDENCE.CONFIRMED) {
                if (newSlot.isCorrection) {
                    logger.info('[SLOT EXTRACTOR] Overwriting confirmed slot due to correction', {
                        key,
                        oldValue: existing.value,
                        newValue: newSlot.value
                    });
                    merged[key] = {
                        ...newSlot,
                        confirmed: false,
                        needsConfirmation: true,
                        correctedByCaller: true,
                        conflict: false,
                        history: [...(existing.history || []), { 
                            value: existing.value, 
                            confidence: existing.confidence,
                            turn: existing.turn,
                            reason: 'overwritten_by_correction'
                        }]
                    };
                }
                continue;
            }
            
            // ═══════════════════════════════════════════════════════════════════════════
            // V96 RULE 1: NAME LOCK (HARD PROTECTION) - ENHANCED
            // ═══════════════════════════════════════════════════════════════════════════
            // If the existing name was extracted from a PRIMARY explicit pattern 
            // ("my name is X", "this is X", "call me X"), it is LOCKED and cannot be 
            // overwritten by SECONDARY patterns ("it's X", "that's X").
            //
            // Pattern hierarchy:
            //   PRIMARY (cannot be overwritten by secondary):
            //     - "my name is X" (patternSource: 'explicit_my_name_is')
            //     - "this is X" / "call me X" (patternSource: 'explicit_this_is')
            //   
            //   SECONDARY (can override unlocked names, but NOT primary locks):
            //     - "it's X" / "that's X" (patternSource: 'correction' or undefined)
            //
            // This prevents: "my name is Mark... it's currently not working" from
            // overwriting "Mark" with "Currently" even though both set 
            // extractedViaExplicitPhrase: true.
            // ═══════════════════════════════════════════════════════════════════════════
            const PRIMARY_PATTERNS = new Set(['explicit_my_name_is', 'explicit_this_is']);
            
            if (key === 'name' && existing.nameLocked === true && !newSlot.isCorrection) {
                const existingIsPrimary = PRIMARY_PATTERNS.has(existing.patternSource);
                const newIsPrimary = PRIMARY_PATTERNS.has(newSlot.patternSource);
                
                // If existing is from PRIMARY pattern, only allow override by another PRIMARY
                if (existingIsPrimary && !newIsPrimary) {
                    logger.warn('[SLOT EXTRACTOR] ❌ V96: REJECTED - PRIMARY NAME LOCK', {
                        lockedName: existing.value,
                        lockedVia: existing.patternSource,
                        rejectedCandidate: newSlot.value,
                        rejectedPatternSource: newSlot.patternSource || 'secondary',
                        rejectedReason: 'primary_name_locked'
                    });
                    // V96g: Track primary name lock rejection
                    mergeDecisions.push({
                        slot: key,
                        action: 'REJECTED',
                        reason: 'primary_name_locked',
                        protectedValue: existing.value,
                        protectedPattern: existing.patternSource,
                        rejectedValue: newSlot.value,
                        rejectedPattern: newSlot.patternSource || 'secondary'
                    });
                    // Keep existing locked name, record rejection in history
                    merged[key] = {
                        ...existing,
                        rejectedCandidates: [...(existing.rejectedCandidates || []), {
                            value: newSlot.value,
                            confidence: newSlot.confidence,
                            turn: newSlot.turn,
                            rejectedReason: 'primary_name_locked',
                            patternSource: newSlot.patternSource || 'unknown'
                        }]
                    };
                    continue;
                }
                
                // Original V94 check: Non-explicit can never override locked
                if (!newSlot.extractedViaExplicitPhrase) {
                    logger.warn('[SLOT EXTRACTOR] ❌ V94: REJECTED - NAME IS LOCKED', {
                        lockedName: existing.value,
                        lockedVia: existing.patternSource || 'explicit_pattern',
                        rejectedCandidate: newSlot.value,
                        rejectedPatternSource: newSlot.patternSource || 'fallback',
                        rejectedReason: 'nameLocked'
                    });
                    // V96g: Track nameLocked rejection
                    mergeDecisions.push({
                        slot: key,
                        action: 'REJECTED',
                        reason: 'name_locked',
                        protectedValue: existing.value,
                        protectedPattern: existing.patternSource || 'explicit_pattern',
                        rejectedValue: newSlot.value,
                        rejectedPattern: newSlot.patternSource || 'fallback'
                    });
                    merged[key] = {
                        ...existing,
                        rejectedCandidates: [...(existing.rejectedCandidates || []), {
                            value: newSlot.value,
                            confidence: newSlot.confidence,
                            turn: newSlot.turn,
                            rejectedReason: 'nameLocked',
                            patternSource: newSlot.patternSource || 'unknown'
                        }]
                    };
                    continue;
                }
            }
            
            // ═══════════════════════════════════════════════════════════════════════════
            // V92 RULE 1.5: NAME SLOT PROTECTION (fallback for unlocked names)
            // ═══════════════════════════════════════════════════════════════════════════
            // If we already have a name with confidence >= 0.8, NEVER overwrite it
            // unless the new extraction contains explicit name phrases like:
            //   - "my name is X"
            //   - "this is X"
            //   - "it's X calling"
            // OR it's marked as a correction
            //
            // BUG FIXED: "80 degrees in the house" was extracting "Degrees In" as a name
            // and overwriting the correct name "Mark"
            // ═══════════════════════════════════════════════════════════════════════════
            if (key === 'name' && existing.confidence >= 0.8 && !newSlot.isCorrection) {
                // Check if new extraction has explicit name intent
                const hasExplicitNamePhrase = newSlot.extractedViaExplicitPhrase === true;
                
                if (!hasExplicitNamePhrase) {
                    logger.warn('[SLOT EXTRACTOR] ❌ V92: REJECTED - HIGH CONFIDENCE NAME EXISTS', {
                        existingName: existing.value,
                        existingConfidence: existing.confidence,
                        rejectedCandidate: newSlot.value,
                        rejectedConfidence: newSlot.confidence,
                        rejectedReason: 'high_confidence_name_exists'
                    });
                    // V96g: Track high confidence rejection
                    mergeDecisions.push({
                        slot: key,
                        action: 'REJECTED',
                        reason: 'high_confidence_name_exists',
                        protectedValue: existing.value,
                        protectedConfidence: existing.confidence,
                        rejectedValue: newSlot.value,
                        rejectedConfidence: newSlot.confidence
                    });
                    // Keep existing, record the rejected candidate in history
                    merged[key] = {
                        ...existing,
                        rejectedCandidates: [...(existing.rejectedCandidates || []), {
                            value: newSlot.value,
                            confidence: newSlot.confidence,
                            turn: newSlot.turn,
                            rejectedReason: 'high_confidence_name_exists'
                        }]
                    };
                    continue;
                }
            }
            
            // RULE 2: If new slot is a correction, overwrite
            if (newSlot.isCorrection) {
                logger.info('[SLOT EXTRACTOR] Overwriting slot due to correction', {
                    key,
                    oldValue: existing.value,
                    newValue: newSlot.value
                });
                // V96g: Track correction acceptance
                mergeDecisions.push({
                    slot: key,
                    action: 'ACCEPTED',
                    reason: 'explicit_correction',
                    oldValue: existing.value,
                    newValue: newSlot.value
                });
                merged[key] = {
                    ...newSlot,
                    confirmed: false,
                    needsConfirmation: true,
                    correctedByCaller: true,
                    conflict: false,
                    history: [...(existing.history || []), {
                        value: existing.value,
                        confidence: existing.confidence,
                        turn: existing.turn,
                        reason: 'corrected_by_caller'
                    }]
                };
                continue;
            }
            
            // RULE 3: Only overwrite if new confidence > existing
            if (newSlot.confidence > existing.confidence) {
                logger.info('[SLOT EXTRACTOR] Overwriting slot with higher confidence', {
                    key,
                    oldValue: existing.value,
                    oldConfidence: existing.confidence,
                    newValue: newSlot.value,
                    newConfidence: newSlot.confidence
                });
                // V96g: Track higher confidence acceptance
                mergeDecisions.push({
                    slot: key,
                    action: 'ACCEPTED',
                    reason: 'higher_confidence',
                    oldValue: existing.value,
                    oldConfidence: existing.confidence,
                    newValue: newSlot.value,
                    newConfidence: newSlot.confidence
                });
                merged[key] = {
                    ...newSlot,
                    confirmed: existing.confirmed || false,
                    needsConfirmation: existing.needsConfirmation ?? false,
                    conflict: false,
                    history: [...(existing.history || []), {
                        value: existing.value,
                        confidence: existing.confidence,
                        turn: existing.turn,
                        reason: 'replaced_by_higher_confidence'
                    }]
                };
                continue;
            }
            
            // RULE 4: Similar confidence but different value → mark conflict
            const confidenceDiff = Math.abs(newSlot.confidence - existing.confidence);
            const valuesDiffer = newSlot.value !== existing.value;
            
            if (valuesDiffer && confidenceDiff <= 0.15) {
                // Keep existing but mark conflict and save new in history
                logger.warn('[SLOT EXTRACTOR] Conflict detected - different values with similar confidence', {
                    key,
                    existingValue: existing.value,
                    existingConfidence: existing.confidence,
                    newValue: newSlot.value,
                    newConfidence: newSlot.confidence
                });
                // V96g: Track conflict
                mergeDecisions.push({
                    slot: key,
                    action: 'CONFLICT',
                    reason: 'similar_confidence_different_value',
                    keptValue: existing.value,
                    keptConfidence: existing.confidence,
                    conflictValue: newSlot.value,
                    conflictConfidence: newSlot.confidence
                });
                merged[key] = {
                    ...existing,
                    conflict: true,
                    conflictValue: newSlot.value,
                    conflictConfidence: newSlot.confidence,
                    conflictTurn: newSlot.turn,
                    history: [...(existing.history || []), {
                        value: newSlot.value,
                        confidence: newSlot.confidence,
                        turn: newSlot.turn,
                        reason: 'conflict_not_merged'
                    }]
                };
            } else if (!valuesDiffer || newSlot.confidence <= existing.confidence) {
                // V96g: Track kept existing (lower/equal confidence or same value)
                mergeDecisions.push({
                    slot: key,
                    action: 'KEPT_EXISTING',
                    reason: valuesDiffer ? 'lower_confidence' : 'same_value',
                    keptValue: existing.value,
                    keptConfidence: existing.confidence,
                    attemptedValue: newSlot.value,
                    attemptedConfidence: newSlot.confidence
                });
            }
        }
        
        // V96g: Return merge decisions for tracing
        merged._mergeDecisions = mergeDecisions;
        
        return merged;
    }
    
    /**
     * ========================================================================
     * DETECT CORRECTION
     * ========================================================================
     */
    static isCorrection(text) {
        if (!text) return false;
        return CORRECTION_PATTERNS.some(pattern => pattern.test(text));
    }
    
    /**
     * ========================================================================
     * EXTRACT NAME
     * ========================================================================
     * Uses global name lists from AdminSettings (via AWConfigReader):
     *   - commonFirstNames: SSA 10K names (96.7% US coverage)
     *   - commonLastNames: Census 50K surnames (~83% US coverage)
     * Used for disambiguation, confidence scoring, and STT validation.
     * 
     * - If name is in commonFirstNames → isLikelyFirstName: true
     * - If name is in commonLastNames → isKnownLastName: true (confidence boost)
     * - If name is NOT in either list → isLikelyFirstName: false (assume last name)
     * - If lists are empty → isLikelyFirstName: true (safe default)
     */
    static extractName(text, context = {}) {
        if (!text) return null;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V96e: EARLY REJECTION - If text looks like a phone number, don't extract name
        // ═══════════════════════════════════════════════════════════════════════════
        // Prevents ANI/phone contamination into name fields
        if (IdentityValidators.looksLikePhone(text)) {
            logger.warn('[SLOT EXTRACTOR] ❌ V96e: Rejecting phone-shaped text as name source', {
                text: text.substring(0, 30)
            });
            return null;
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V93: Load commonFirstNames via AWConfigReader (AW ⇄ RE marriage)
        // If awReader is passed in context, use it for traced config reads.
        // Otherwise fall back to direct access (backward compat).
        // ═══════════════════════════════════════════════════════════════════════════
        // ═══════════════════════════════════════════════════════════════════════════
        // GLOBAL NAME LISTS — Single source via AWConfigReader
        // First names: SSA Baby Names (10,000 names, 96.7% US coverage)
        // Last names: US Census surnames (50,000 names, ~83% US coverage)
        // No per-company fallback — AdminSettings is the single source of truth.
        // ═══════════════════════════════════════════════════════════════════════════
        let commonFirstNames = [];
        if (context.awReader && typeof context.awReader.getArray === 'function') {
            context.awReader.setReaderId('SlotExtractor.extractName');
            commonFirstNames = context.awReader.getArray('frontDesk.commonFirstNames');
        } else {
            commonFirstNames = AWConfigReader.getGlobalFirstNames();
        }
        const commonFirstNamesSet = new Set(commonFirstNames.map(n => String(n).toLowerCase()));
        const hasNameList = commonFirstNames.length > 0;
        
        let commonLastNames = [];
        if (context.awReader && typeof context.awReader.getArray === 'function') {
            commonLastNames = context.awReader.getArray('frontDesk.commonLastNames');
        } else {
            commonLastNames = AWConfigReader.getGlobalLastNames();
        }
        const commonLastNamesSet = new Set(commonLastNames.map(n => String(n).toLowerCase()));
        const hasLastNameList = commonLastNames.length > 0;
        
        /**
         * Check if a single name is likely a first name based on commonFirstNames list
         */
        const isLikelyFirstName = (name) => {
            if (!hasNameList) return true; // No list = assume first name (safe default)
            return commonFirstNamesSet.has(String(name).toLowerCase());
        };
        
        /**
         * V111: Check if a name is a known last name from the Census list.
         * Returns true if found in commonLastNames. Used for:
         * - Confidence boost when last name is recognized
         * - Disambiguation: if word is in BOTH lists, first name wins
         * - If word is in last name list but NOT first name list → definite last name
         */
        const isKnownLastName = (name) => {
            if (!hasLastNameList) return false;
            return commonLastNamesSet.has(String(name).toLowerCase());
        };
        
        /**
         * V111: Enrich a name extraction result with last name recognition metadata.
         * Called on every result before returning. Adds:
         *   - isKnownLastName: boolean (last name found in Census list)
         *   - lastNameConfidenceBoost: boolean (last name recognized → higher trust)
         *
         * This is a POST-PROCESSING step so we don't repeat logic in every pattern.
         */
        const enrichWithLastNameData = (res) => {
            if (!res) return res;
            
            // Check the lastName field if present
            const ln = res.lastName || (res.isLikelyFirstName === false ? res.value : null);
            if (ln) {
                // For multi-word last names like "De La Cruz", check the full string
                const knownLast = isKnownLastName(ln);
                res.isKnownLastName = knownLast;
                if (knownLast) {
                    res.lastNameConfidenceBoost = true;
                    // V111: Boost confidence when last name is in Census list
                    if (res.confidence && res.confidence < 0.95) {
                        res.confidence = Math.min(res.confidence + 0.1, 0.99);
                    }
                }
            }
            
            // For single-word names not in first name list:
            // If it IS in the last name list → stronger signal it's a last name
            if (res.value && !res.firstName && !res.lastName) {
                const singleWord = res.value.split(/\s+/);
                if (singleWord.length === 1) {
                    const knownLast = isKnownLastName(res.value);
                    const knownFirst = isLikelyFirstName(res.value);
                    res.isKnownLastName = knownLast;
                    if (knownLast && !knownFirst) {
                        // Definitely a last name — in Census list but not first name list
                        res.lastName = res.value;
                        res.isLikelyFirstName = false;
                        res.needsFirstName = true;
                        res.lastNameConfidenceBoost = true;
                    }
                }
            }
            
            return res;
        };
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FEB 2026 FIX: STT preprocessing lowercases everything, so patterns must
        // use [a-zA-Z] instead of [A-Z][a-z] to match both cases.
        // The cleanName() function will title-case the result.
        // ═══════════════════════════════════════════════════════════════════════════
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FEB 2026 FIX #2: CORRECTION PATTERNS (SECONDARY PRIORITY)
        // ═══════════════════════════════════════════════════════════════════════════
        // When someone says "my name is X um, and mark that's Mark Gonzales"
        // The "that's Mark Gonzales" is the REAL name, not "X"
        // 
        // V96k FIX: Made correction patterns much more restrictive!
        // BUG: "I'm seeing that there is water leakage" was extracting "water leakage" as a name
        // because the pattern "that's X" at end of sentence was too broad.
        //
        // Now correction patterns are VERY specific and only match explicit name corrections.
        // ═══════════════════════════════════════════════════════════════════════════
        // ═══════════════════════════════════════════════════════════════════════════
        // V96m FIX: CORRECTION PATTERNS - EXTREMELY RESTRICTIVE
        // ═══════════════════════════════════════════════════════════════════════════
        // BUG (FEB 2026): "i'm seeing that is water leakage" was extracting "Water Leakage"
        // because the old pattern /(?:that\s+is)\s+([a-zA-Z]+\s+[a-zA-Z]+)/i was too broad.
        //
        // FIX: Only match corrections that are CLEARLY name corrections:
        // - Must follow with ", and" or be at END of sentence
        // - Must NOT have continuing phrases after the "name"
        // - REMOVED the unrestricted two-word pattern entirely
        // ═══════════════════════════════════════════════════════════════════════════
        const correctionPatterns = [
            // "that's Mark Gonzales, and..." OR "that's Mark Gonzales." (end of sentence)
            // The (?:,?\s*and|[.!?]?\s*$) ensures it's followed by "and" or sentence end
            /(?:that'?s|that\s+is|actually|i\s+mean|well\s+that'?s)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s*(?:,?\s*and|[.!?]?\s*$)/i
            // REMOVED: /(?:that'?s|that\s+is|actually|i\s+mean)\s+([a-zA-Z]+\s+[a-zA-Z]+)/i
            // This pattern was WAY too broad - matched "that is water leakage in my garage"
        ];
        
        for (const pattern of correctionPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const name = this.cleanName(match[1]);
                if (name && name.length >= 2 && !NAME_STOP_WORDS.has(name.toLowerCase())) {
                    // Validate that at least one word isn't a stop word
                    const nameParts = name.split(/\s+/);
                    const validParts = nameParts.filter(p => !NAME_STOP_WORDS.has(p.toLowerCase()));
                    if (validParts.length >= 1) {
                        const isSingleWord = nameParts.length === 1;
                        const likelyFirst = isSingleWord ? isLikelyFirstName(name) : true;
                        
                        logger.debug('[SLOT EXTRACTOR] Name matched via CORRECTION pattern', {
                            raw: match[1],
                            cleaned: name,
                            pattern: pattern.source.substring(0, 50),
                            isSingleWord,
                            likelyFirst
                        });
                        
                        const result = {
                            value: name,
                            confidence: CONFIDENCE.UTTERANCE_HIGH,
                            source: SOURCE.UTTERANCE,
                            extractedViaExplicitPhrase: true,  // V92: Correction = explicit name statement
                            patternSource: 'correction',  // V96: SECONDARY pattern - cannot override PRIMARY locks
                            nameLocked: false  // V96: Corrections don't lock (user might correct again)
                        };
                        
                        // V92: Add first/last name metadata
                        if (isSingleWord) {
                            result.isLikelyFirstName = likelyFirst;
                            if (likelyFirst) {
                                result.firstName = name;
                            } else {
                                result.lastName = name;
                                result.needsFirstName = true;
                            }
                        } else if (nameParts.length >= 2) {
                            result.firstName = nameParts[0];
                            result.lastName = nameParts.slice(1).join(' ');
                        }
                        
                        return enrichWithLastNameData(result);
                    }
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V92 FIX: PRIORITIZED NAME PATTERNS
        // ═══════════════════════════════════════════════════════════════════════════
        // PROBLEM: "I'm having issues... my name is Mark" was extracting "Issues" 
        // because "i'm" pattern matched "I'm having issues" FIRST in the text.
        // 
        // FIX: Search for "my name is" patterns FIRST (most explicit), then fall 
        // back to more ambiguous patterns only if no explicit match found.
        // ═══════════════════════════════════════════════════════════════════════════
        
        // PRIORITY 1: "My name is X" / "First name is X" - Most explicit, search ANYWHERE in text
        // Uses matchAll to find ALL occurrences and pick the best one
        // ═══════════════════════════════════════════════════════════════════════════
        // FEB 2026 FIX: Added "first name is X" patterns
        // User said "first name is Mark" and it wasn't being captured.
        // Also handles: "my first name is X", "the first name is X"
        // ═══════════════════════════════════════════════════════════════════════════
        const myNameIsPatterns = [
            // "my name is mark gonzales" OR "my name is mark, gonzales" 
            /my\s+name\s+is\s+([a-zA-Z]+)[,\s]+([a-zA-Z]+)/gi,
            // Single name: "my name is mark"
            /my\s+name\s+is\s+([a-zA-Z]+)(?:\s|$|[.,!?])/gi,
            // FEB 2026: "first name is mark" - explicit first name statement
            /(?:my\s+)?first\s+name\s+is\s+([a-zA-Z]+)(?:\s|$|[.,!?])/gi,
            // FEB 2026: "the first name is mark" 
            /the\s+first\s+name\s+is\s+([a-zA-Z]+)(?:\s|$|[.,!?])/gi,
            // FEB 2026: Handles "it's ... first name is mark" (user was frustrated)
            /first\s+name\s+is\s+([a-zA-Z]+)(?:\s|$|[.,!?])/gi
        ];
        
        for (const pattern of myNameIsPatterns) {
            const matches = [...text.matchAll(pattern)];
            if (matches.length > 0) {
                // Take the LAST match (most likely to be the final/corrected name)
                const match = matches[matches.length - 1];
                let name;
                if (match[2] && !NAME_STOP_WORDS.has(match[2].toLowerCase())) {
                    name = this.cleanName(match[1] + ' ' + match[2]);
                } else {
                    name = this.cleanName(match[1]);
                }
                
                // V94: Check for stop words and log rejection
                if (name && NAME_STOP_WORDS.has(name.toLowerCase())) {
                    logger.warn('[SLOT EXTRACTOR] ❌ V94: REJECTED "my name is" candidate (stopWord)', {
                        rejected: name,
                        raw: match[0],
                        rejectedReason: 'stopWord'
                    });
                    // Continue to next pattern
                }
                
                if (name && !NAME_STOP_WORDS.has(name.toLowerCase())) {
                    const nameParts = name.split(/\s+/);
                    const isSingleWord = nameParts.length === 1;
                    const likelyFirst = isSingleWord ? isLikelyFirstName(name) : true;
                    
                    // ═══════════════════════════════════════════════════════════════════════════
                    // V94: EXPLICIT PATTERN = LOCKED NAME
                    // Once extracted from "my name is X", the name is LOCKED.
                    // Future candidates will be rejected unless explicit correction.
                    // ═══════════════════════════════════════════════════════════════════════════
                    logger.info('[SLOT EXTRACTOR] ✅ V94 NAME LOCKED via "my name is" (PRIORITY 1)', {
                        raw: match[0],
                        cleaned: name,
                        matchCount: matches.length,
                        patternSource: 'explicit_my_name_is',
                        locked: true
                    });
                    
                    const result = {
                        value: name,
                        confidence: CONFIDENCE.UTTERANCE_HIGH,
                        source: SOURCE.UTTERANCE,
                        extractedViaExplicitPhrase: true,  // V92: Marks this as explicit name statement
                        patternSource: 'explicit_my_name_is',  // V94: Track which pattern matched
                        nameLocked: true  // V94: HARD LOCK - refuse overwrites unless correction
                    };
                    
                    if (isSingleWord) {
                        result.isLikelyFirstName = likelyFirst;
                        if (likelyFirst) {
                            result.firstName = name;
                        } else {
                            result.lastName = name;
                            result.needsFirstName = true;
                        }
                    } else if (nameParts.length >= 2) {
                        result.firstName = nameParts[0];
                        result.lastName = nameParts.slice(1).join(' ');
                    }
                    
                    return enrichWithLastNameData(result);
                }
            }
        }
        
        // PRIORITY 2: "This is X" / "Call me X" - Less ambiguous than "I'm"
        const explicitPatterns = [
            /(?:this\s+is|call\s+me|they\s+call\s+me)\s+([a-zA-Z]+)[,\s]+([a-zA-Z]+)/i,
            /(?:this\s+is|call\s+me|they\s+call\s+me)\s+([a-zA-Z]+)(?:\s|$|[.,!?])/i
        ];
        
        for (const pattern of explicitPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                // Check if we captured both first and last name (pattern with comma/space)
                let name;
                if (match[2] && !NAME_STOP_WORDS.has(match[2].toLowerCase())) {
                    // Two-part match: "mark, gonzales" or "mark gonzales"
                    name = this.cleanName(match[1] + ' ' + match[2]);
                } else {
                    // Single part match
                    name = this.cleanName(match[1]);
                }
                
                if (name && !NAME_STOP_WORDS.has(name.toLowerCase())) {
                    // V92: Determine if single-word name is first or last using commonFirstNames
                    const nameParts = name.split(/\s+/);
                    const isSingleWord = nameParts.length === 1;
                    const likelyFirst = isSingleWord ? isLikelyFirstName(name) : true;
                    
                    // ═══════════════════════════════════════════════════════════════════════════
                    // V94: EXPLICIT PATTERN = LOCKED NAME
                    // ═══════════════════════════════════════════════════════════════════════════
                    logger.info('[SLOT EXTRACTOR] ✅ V94 NAME LOCKED via explicit pattern (PRIORITY 2)', {
                        raw: match[0],
                        cleaned: name,
                        pattern: pattern.source.substring(0, 50),
                        hasTwoParts: !!match[2],
                        isSingleWord,
                        likelyFirst,
                        hasNameList,
                        patternSource: 'explicit_this_is',
                        locked: true
                    });
                    
                    const result = {
                        value: name,
                        confidence: CONFIDENCE.UTTERANCE_HIGH,
                        source: SOURCE.UTTERANCE,
                        extractedViaExplicitPhrase: true,  // V92: "this is X" = explicit name statement
                        patternSource: 'explicit_this_is',  // V94: Track which pattern matched
                        nameLocked: true  // V94: HARD LOCK - refuse overwrites unless correction
                    };
                    
                    // V92: Add first/last name metadata for single-word names
                    if (isSingleWord) {
                        result.isLikelyFirstName = likelyFirst;
                        if (likelyFirst) {
                            result.firstName = name;
                        } else {
                            result.lastName = name;
                            result.needsFirstName = true;
                        }
                    } else if (nameParts.length >= 2) {
                        result.firstName = nameParts[0];
                        result.lastName = nameParts.slice(1).join(' ');
                    }
                    
                    return enrichWithLastNameData(result);
                }
            }
        }
        
        // Pattern 2: "Hi [Name]" / "Hello [Name]" at start
        const greetingMatch = text.match(/^(?:hi|hello|hey)\s+([a-zA-Z]+)/i);
        if (greetingMatch && greetingMatch[1]) {
            const name = this.cleanName(greetingMatch[1]);
            if (name && !NAME_STOP_WORDS.has(name.toLowerCase())) {
                const likelyFirst = isLikelyFirstName(name);
                const result = {
                    value: name,
                    confidence: CONFIDENCE.UTTERANCE_LOW,
                    source: SOURCE.UTTERANCE,
                    isLikelyFirstName: likelyFirst
                };
                if (likelyFirst) {
                    result.firstName = name;
                } else {
                    result.lastName = name;
                    result.needsFirstName = true;
                }
                return enrichWithLastNameData(result);
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V94 FIX: Pattern 3 is DISABLED for non-explicit contexts
        // ═══════════════════════════════════════════════════════════════════════════
        // PROBLEM: "it's super hot" was matching "Super Hot" as a two-word name
        // and overwriting the real name "Mark" extracted from "my name is Mark".
        //
        // FIX: Only use fallback two-word pattern when:
        // 1. We're explicitly expecting a name (context.expectingSlot === 'name')
        // 2. AND the first word is in commonFirstNames (validates as a real name)
        //
        // Without this, we'd grab random adjective pairs as names.
        // ═══════════════════════════════════════════════════════════════════════════
        if (context.expectingSlot === 'name') {
            const fullNameMatch = text.match(/\b([a-zA-Z]{2,})\s+([a-zA-Z]{2,})\b/i);
            if (fullNameMatch) {
                const first = this.cleanName(fullNameMatch[1]);
                const last = this.cleanName(fullNameMatch[2]);
                
                // V94: Validate first word against commonFirstNames
                const firstLower = first?.toLowerCase();
                const isValidFirstName = hasNameList ? commonFirstNamesSet.has(firstLower) : true;
                
                // V94: Check stop words first and log rejection
                const firstIsStopWord = NAME_STOP_WORDS.has(first?.toLowerCase());
                const lastIsStopWord = NAME_STOP_WORDS.has(last?.toLowerCase());
                
                if (firstIsStopWord || lastIsStopWord) {
                    logger.warn('[SLOT EXTRACTOR] ❌ V94: REJECTED two-word candidate (stopWord)', {
                        rejected: `${first} ${last}`,
                        firstWord: first,
                        lastWord: last,
                        firstIsStopWord,
                        lastIsStopWord,
                        rejectedReason: 'stopWord'
                    });
                } else if (!isValidFirstName) {
                    logger.warn('[SLOT EXTRACTOR] ❌ V94: REJECTED two-word candidate (not in commonFirstNames)', {
                        rejected: `${first} ${last}`,
                        firstWord: first,
                        rejectedReason: 'notInCommonFirstNames'
                    });
                } else if (first && last && isValidFirstName) {
                    logger.info('[SLOT EXTRACTOR] ✅ Name matched via two-word pattern (FALLBACK - validated)', {
                        raw: fullNameMatch[0],
                        first,
                        last,
                        validatedAgainstCommonNames: isValidFirstName,
                        patternSource: 'fallback_two_word'
                    });
                    
                    return enrichWithLastNameData({
                        value: `${first} ${last}`,
                        confidence: CONFIDENCE.UTTERANCE_HIGH,
                        source: SOURCE.UTTERANCE,
                        firstName: first,
                        lastName: last,
                        patternSource: 'fallback_two_word'  // V94: Track source
                    });
                }
            }
        }
        
        // Pattern 4: Standalone name (if context suggests we're asking for name)
        if (context.expectingSlot === 'name') {
            const words = text.split(/\s+/)
                .map(w => this.cleanName(w))
                .filter(w => w && w.length >= 2)
                .filter(w => !NAME_STOP_WORDS.has(w.toLowerCase()));
            
            if (words.length >= 1) {
                const name = words.slice(0, 2).join(' ');
                const isSingleWord = words.length === 1;
                const likelyFirst = isSingleWord ? isLikelyFirstName(words[0]) : true;
                
                const result = {
                    value: name,
                    confidence: CONFIDENCE.UTTERANCE_HIGH,
                    source: SOURCE.UTTERANCE
                };
                
                // V92: Add first/last name metadata
                if (isSingleWord) {
                    result.isLikelyFirstName = likelyFirst;
                    if (likelyFirst) {
                        result.firstName = words[0];
                    } else {
                        result.lastName = words[0];
                        result.needsFirstName = true;
                    }
                } else if (words.length >= 2) {
                    result.firstName = words[0];
                    result.lastName = words.slice(1).join(' ');
                }
                
                return enrichWithLastNameData(result);
            }
        }
        
        return null;
    }
    
    /**
     * ========================================================================
     * EXTRACT PHONE
     * ========================================================================
     */
    static extractPhone(text, callerPhone, context = {}) {
        // First, try to extract from utterance
        if (text) {
            // Pattern: phone number digits
            const phoneMatch = text.match(/(\d[\d\-\.\(\)\s]{8,}\d)/);
            if (phoneMatch) {
                const digits = phoneMatch[1].replace(/\D/g, '');
                if (digits.length >= 10) {
                    const formatted = this.formatPhone(digits);
                    return {
                        value: formatted,
                        confidence: CONFIDENCE.UTTERANCE_HIGH,
                        source: SOURCE.UTTERANCE
                    };
                }
            }
            
            // Pattern: "use this number" / "this number is good" (confirm caller ID)
            const confirmPatterns = [
                /\b(this|that)\s+(number|one)\s+(is\s+)?(good|fine|ok|okay|works|correct)\b/i,
                /\buse\s+(this|that|the\s+same)\s+(number|one)\b/i,
                /\b(yes|yeah|yep|correct|right)\b.*\bnumber\b/i,
                /\bnumber\b.*\b(yes|yeah|yep|correct|right|good|fine)\b/i
            ];
            
            if (callerPhone && confirmPatterns.some(p => p.test(text))) {
                const formatted = this.formatPhone(callerPhone);
                return {
                    value: formatted,
                    confidence: CONFIDENCE.CONFIRMED,
                    source: SOURCE.CALLER_ID,
                    confirmed: true
                };
            }
        }
        
        // If no utterance extraction, use caller ID (needs confirmation)
        if (callerPhone && context.turnCount === 1 && !context.existingSlots?.phone) {
            const digits = callerPhone.replace(/\D/g, '');
            if (digits.length >= 10) {
                const formatted = this.formatPhone(digits);
                return {
                    value: formatted,
                    confidence: CONFIDENCE.CALLER_ID,
                    source: SOURCE.CALLER_ID,
                    needsConfirmation: true
                };
            }
        }
        
        return null;
    }
    
    /**
     * ========================================================================
     * EXTRACT ADDRESS
     * ========================================================================
     */
    static extractAddress(text, context = {}) {
        if (!text) return null;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V116 FIX: STRIP EXPLICIT ADDRESS PHRASES BEFORE PATTERN MATCHING
        // ═══════════════════════════════════════════════════════════════════════════
        // BUG: Caller says "the address is 12155 Metro Parkway" but patterns expect
        // number at start. The prefix "the address is" blocks the match.
        //
        // FIX: Strip explicit address introduction phrases FIRST, then match.
        // ═══════════════════════════════════════════════════════════════════════════
        let cleanedText = text
            .replace(/^(?:my\s+address\s+is|the\s+address\s+is|address\s+is|it's\s+at|its\s+at|that's\s+at|i'm\s+at|i\s+am\s+at|we're\s+at|we\s+are\s+at|it's|its|that's|that\s+is|at|um|uh|well|so|yeah|yes|yep|sure|okay|ok)\s*/i, '')
            .replace(/^[,.\s\-:;]+/, '')  // Remove leading punctuation after phrase stripping
            .trim();
        
        // If stripping left us with nothing, fall back to original
        if (!cleanedText) cleanedText = text;
        
        logger.debug('[SLOT EXTRACTOR] V116: Address extraction preprocessing', {
            original: text.substring(0, 50),
            cleaned: cleanedText.substring(0, 50),
            expectingSlot: context.expectingSlot
        });
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FEB 2026 FIX: Use case-insensitive patterns that work with lowercased STT
        // The STT preprocessor lowercases everything, so [A-Z][a-z]+ won't match
        // Use [a-zA-Z]+ instead to match any case
        // ═══════════════════════════════════════════════════════════════════════════
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V92 FIX: REJECT TIME PHRASES THAT LOOK LIKE ADDRESSES
        // "2 weeks ago" matched as address because it's "number + words"
        // These are CATEGORICALLY NOT addresses - reject them first
        // ═══════════════════════════════════════════════════════════════════════════
        const TIME_PHRASE_BLOCKLIST = /\b\d+\s*(weeks?|days?|months?|years?|hours?|minutes?)\s*(ago|later|from now|back|prior|before|since|now)\b/i;
        const TIME_WORDS_BLOCKLIST = /\b(yesterday|today|tomorrow|ago|since|later|earlier|recently|before|after|last|next|past|week|month|year|day)\b/i;
        
        if (TIME_PHRASE_BLOCKLIST.test(cleanedText)) {
            logger.debug('[SLOT EXTRACTOR] Address rejected: matches time phrase pattern', { text: cleanedText.substring(0, 50) });
            return null;
        }
        
        // Complete list of street type suffixes
        const streetSuffixes = '(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|way|court|ct|circle|cir|place|pl|parkway|pkwy|highway|hwy|terrace|ter|trail|trl|path|plaza|square|sq)';
        
        // Pattern: Street address (number + street name + optional suffix)
        const addressPatterns = [
            // "123 Main Street" / "12155 metro parkway"
            new RegExp(`(\\d{1,5}\\s+[a-zA-Z]+(?:\\s+[a-zA-Z]+)*\\s+${streetSuffixes}\\.?)`, 'i'),
            // "123 Main St, Apt 4" / "456 Oak Drive Unit 2B"
            new RegExp(`(\\d{1,5}\\s+[a-zA-Z]+(?:\\s+[a-zA-Z]+)*\\s+${streetSuffixes}\\.?,?\\s*(?:apt|unit|suite|#)?\\s*\\d*[a-zA-Z]?)`, 'i')
            // V92 FIX: REMOVED lenient "number + words" pattern - it was matching "2 weeks ago"
            // Addresses MUST have a street suffix to be extracted without explicit context
        ];
        
        for (const pattern of addressPatterns) {
            const match = cleanedText.match(pattern);
            if (match && match[1].length >= 10) {
                const candidate = match[1].trim();
                
                // V92 FIX: Double-check the candidate doesn't contain time words
                if (TIME_WORDS_BLOCKLIST.test(candidate)) {
                    logger.debug('[SLOT EXTRACTOR] Address candidate rejected: contains time words', { candidate });
                    continue;
                }
                
                logger.info('[SLOT EXTRACTOR] V116: ✅ Address extracted', {
                    candidate: candidate.substring(0, 40),
                    pattern: 'strict_suffix_pattern',
                    confidence: CONFIDENCE.UTTERANCE_HIGH
                });
                
                return {
                    value: candidate,
                    confidence: CONFIDENCE.UTTERANCE_HIGH,
                    source: SOURCE.UTTERANCE
                };
            }
        }
        
        // If we're expecting address, be more lenient BUT still validate
        if (context.expectingSlot === 'address') {
            // Look for number + words pattern (use cleanedText)
            const lenientMatch = cleanedText.match(/(\d{1,5}\s+[A-Za-z].*)/);
            if (lenientMatch && lenientMatch[1].length >= 8) {
                const candidate = lenientMatch[1].trim();
                
                // V92 FIX: Even in lenient mode, reject obvious time phrases
                if (TIME_WORDS_BLOCKLIST.test(candidate) || TIME_PHRASE_BLOCKLIST.test(candidate)) {
                    logger.debug('[SLOT EXTRACTOR] Lenient address rejected: contains time words', { candidate });
                    return null;
                }
                
                // FEB 2026 FIX: Increase confidence when user is directly providing address
                // They were asked for address and gave something that looks like one
                return {
                    value: candidate,
                    confidence: CONFIDENCE.UTTERANCE_HIGH,  // Was UTTERANCE_LOW (0.6)
                    source: SOURCE.UTTERANCE
                };
            }
        }
        
        return null;
    }
    
    /**
     * ========================================================================
     * EXTRACT TIME
     * ========================================================================
     */
    static extractTime(text, context = {}) {
        if (!text) return null;
        
        const lowerText = text.toLowerCase();
        
        // FEB 2026 FIX: Skip greeting patterns that are NOT time preferences!
        // "Good morning", "Good afternoon", "Good evening" are greetings, not scheduling requests
        const isGreeting = /^(good\s+)?(morning|afternoon|evening)[.!,]?\s*$/i.test(text.trim()) ||
                           /^(good\s+)(morning|afternoon|evening)/i.test(text.trim());
        if (isGreeting) {
            return null;
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V92 FIX: ASAP patterns - require scheduling context for ambiguous words
        // ═══════════════════════════════════════════════════════════════════════
        // Bug: "but now the system is not cooling" was matching "now" as ASAP
        // "now" in that context means temporal ("currently"), not scheduling ("send someone now")
        //
        // Strong ASAP indicators (always match):
        //   - "asap", "as soon as possible", "right away", "immediately"
        // Weak indicators (require scheduling context):
        //   - "now", "today", "soon"
        // ═══════════════════════════════════════════════════════════════════════
        
        // Strong ASAP indicators - always match
        if (/\b(asap|as soon as possible|right away|immediately)\b/i.test(lowerText)) {
            return {
                value: 'ASAP',
                confidence: CONFIDENCE.UTTERANCE_HIGH,
                source: SOURCE.UTTERANCE
            };
        }
        
        // Weak indicators - require explicit scheduling context
        // "send someone now" = ASAP, "but now the system..." = NOT ASAP
        const schedulingContext = /\b(send|come|get|schedule|book|dispatch|need someone|available|can someone|appointment|service call)\b/i;
        if (schedulingContext.test(lowerText) && /\b(now|today|soon)\b/i.test(lowerText)) {
            return {
                value: 'ASAP',
                confidence: CONFIDENCE.UTTERANCE_MEDIUM,
                source: SOURCE.UTTERANCE
            };
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V117: NUMERIC HOUR RANGE → Morning/Afternoon mapping
        // ═══════════════════════════════════════════════════════════════════════
        // Handles: "8 to 10", "8-10", "10 to 12", "12 to 2", "2 to 4"
        // Also: "eight to ten", spoken number words
        // ═══════════════════════════════════════════════════════════════════════
        const WORD_TO_NUM = {
            'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5,
            'six': 6, 'seven': 7, 'eight': 8, 'nine': 9, 'ten': 10,
            'eleven': 11, 'twelve': 12
        };
        
        const rangeMatch = lowerText.match(/\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\s*(?:to|-|through|thru)\s*(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/i);
        if (rangeMatch) {
            const startHour = WORD_TO_NUM[rangeMatch[1]] || parseInt(rangeMatch[1], 10);
            const endHour = WORD_TO_NUM[rangeMatch[2]] || parseInt(rangeMatch[2], 10);
            
            if (startHour >= 1 && startHour <= 12 && endHour >= 1 && endHour <= 12) {
                const isMorning = startHour >= 6 && startHour < 12;
                const timeOfDay = isMorning ? 'Morning' : 'Afternoon';
                const windowLabel = `${startHour}-${endHour}`;
                
                return {
                    value: `${timeOfDay} (${windowLabel})`,
                    confidence: CONFIDENCE.UTTERANCE_HIGH,
                    source: SOURCE.UTTERANCE
                };
            }
        }
        
        // "first slot" / "earliest" → Morning
        if (/\b(first\s+(?:slot|one|available)|earliest)\b/i.test(lowerText)) {
            return {
                value: 'Morning (earliest)',
                confidence: CONFIDENCE.UTTERANCE_HIGH,
                source: SOURCE.UTTERANCE
            };
        }
        // "last slot" / "latest" → Afternoon
        if (/\b(last\s+(?:slot|one|available)|latest)\b/i.test(lowerText)) {
            return {
                value: 'Afternoon (latest)',
                confidence: CONFIDENCE.UTTERANCE_HIGH,
                source: SOURCE.UTTERANCE
            };
        }
        
        // Morning/afternoon/evening (but ONLY if it's a time preference, not a greeting)
        // FEB 2026 V92 FIX: Require explicit scheduling context, NOT just long text!
        // Bug: "I am a longtime customer" was matching "am" as a time indicator
        // Bug: "good evening" in a long utterance was matching "evening" as a time preference
        const timeContextPatterns = /\b(in the|prefer|works|would be|sometime|available|free|can do|schedule for|book for|want|need|around|about)\s+(morning|afternoon|evening)/i;
        const hasExplicitTimePreference = timeContextPatterns.test(lowerText);
        
        // FEB 2026 V92: Only extract time window if EXPLICITLY stated as a preference
        // "good morning" = greeting, NOT a time preference
        // "prefer morning" = time preference
        // "I am a customer" does NOT contain time preference (bug fix: "am" ≠ AM time)
        if (hasExplicitTimePreference) {
            if (/\b(morning|before noon)\b/.test(lowerText)) {
                return {
                    value: 'Morning',
                    confidence: CONFIDENCE.UTTERANCE_HIGH,
                    source: SOURCE.UTTERANCE
                };
            }
            if (/\b(afternoon|after lunch|after noon)\b/.test(lowerText)) {
                return {
                    value: 'Afternoon',
                    confidence: CONFIDENCE.UTTERANCE_HIGH,
                    source: SOURCE.UTTERANCE
                };
            }
            if (/\b(evening|after work|after 5)\b/.test(lowerText)) {
                return {
                    value: 'Evening',
                    confidence: CONFIDENCE.UTTERANCE_HIGH,
                    source: SOURCE.UTTERANCE
                };
            }
        }
        
        // FEB 2026 V92: Only match "am" when it's a time suffix (10am, 11 am), NOT the verb "I am"
        // And only match "pm" when it's a time suffix, not a random word
        // This is handled by the specific time pattern below (with digits)
        
        // Specific day
        const dayMatch = lowerText.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/);
        if (dayMatch) {
            const timeOfDayMatch = lowerText.match(/\b(morning|afternoon|evening)\b/);
            const value = timeOfDayMatch 
                ? `${this.titleCase(dayMatch[1])} ${this.titleCase(timeOfDayMatch[1])}`
                : this.titleCase(dayMatch[1]);
            
            return {
                value,
                confidence: CONFIDENCE.UTTERANCE_HIGH,
                source: SOURCE.UTTERANCE
            };
        }
        
        // Specific time pattern (10am, 3:30 pm)
        // FEB 2026 FIX: Require am/pm suffix OR colon (3:30) to avoid matching "2 weeks ago"
        // Pattern must have either:
        // - am/pm suffix (required for standalone numbers like "2pm")
        // - colon with minutes (like "3:30")
        // - "at" or "around" prefix (like "at 2" or "around 3")
        const timeWithAmPmMatch = text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
        if (timeWithAmPmMatch) {
            return {
                value: timeWithAmPmMatch[1],
                confidence: CONFIDENCE.UTTERANCE_HIGH,
                source: SOURCE.UTTERANCE
            };
        }
        
        // Time with colon (like "3:30")
        const timeWithColonMatch = text.match(/\b(\d{1,2}:\d{2})\b/);
        if (timeWithColonMatch) {
            return {
                value: timeWithColonMatch[1],
                confidence: CONFIDENCE.UTTERANCE_HIGH,
                source: SOURCE.UTTERANCE
            };
        }
        
        // Time with "at" or "around" prefix (like "at 2" or "around 3 o'clock")
        const timeWithPrefixMatch = text.match(/\b(?:at|around)\s+(\d{1,2}(?:\s*o'?clock)?)\b/i);
        if (timeWithPrefixMatch) {
            return {
                value: timeWithPrefixMatch[1],
                confidence: CONFIDENCE.UTTERANCE_MEDIUM,
                source: SOURCE.UTTERANCE
            };
        }
        
        return null;
    }
    
    /**
     * ========================================================================
     * EXTRACT EMAIL
     * ========================================================================
     */
    static extractEmail(text, context = {}) {
        if (!text) return null;
        
        const emailMatch = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        if (emailMatch) {
            return {
                value: emailMatch[0].toLowerCase(),
                confidence: CONFIDENCE.UTTERANCE_HIGH,
                source: SOURCE.UTTERANCE
            };
        }
        
        return null;
    }

    static extractCallReasonDetail(text) {
        const cleaned = (text || '').trim();
        if (!cleaned) {
            return null;
        }

        const normalized = cleaned.toLowerCase();
        if (/^(hi|hello|hey|good (morning|afternoon|evening))[.!?,\s]*$/i.test(normalized)) {
            return null;
        }

        const stripped = stripCallReasonIntro(cleaned);
        const sourceText = stripped || cleaned;

        const matchedLabels = [];
        for (const pattern of CALL_REASON_PATTERNS) {
            if (pattern.regex.test(sourceText)) {
                matchedLabels.push(pattern.label);
            }
        }

        const uniqueLabels = [...new Set(matchedLabels)];
        if (uniqueLabels.length > 0) {
            return {
                value: uniqueLabels.join('; '),
                confidence: 0.82,
                source: SOURCE.UTTERANCE,
                patternSource: 'call_reason_patterns'
            };
        }

        // Keep this conservative so random short replies do not contaminate the slot.
        const tokenCount = sourceText.split(/\s+/).length;
        if (tokenCount < 4) {
            return null;
        }

        return {
            value: sourceText.substring(0, 160),
            confidence: 0.55,
            source: SOURCE.UTTERANCE,
            patternSource: 'call_reason_fallback_utterance'
        };
    }
    
    /**
     * ========================================================================
     * HELPERS
     * ========================================================================
     */
    static cleanName(name) {
        if (!name) return null;
        
        // Early rejection if phone-shaped
        if (IdentityValidators.looksLikePhone(name)) {
            logger.warn('[SLOT EXTRACTOR] cleanName rejected phone-shaped input', { name });
            return null;
        }
        
        const words = name
            .split(/\s+/)
            .filter(w => !NAME_STOP_WORDS.has(w.toLowerCase()) && w.length > 1)
            .map(w => this.titleCase(w.replace(/[^A-Za-z\-']/g, '')))  // Strip ALL punctuation including periods
            .filter(w => w.length > 0);  // Remove empty strings after stripping
        
        // Deduplicate consecutive identical words ("Gonzalez Gonzalez" → "Gonzalez")
        const deduped = words.filter((w, i) => i === 0 || w.toLowerCase() !== words[i - 1].toLowerCase());
        
        if (deduped.length !== words.length) {
            logger.info('[SLOT EXTRACTOR] Collapsed duplicate name words', {
                original: words.join(' '),
                deduped: deduped.join(' ')
            });
        }
        
        const cleaned = deduped.join(' ').trim() || null;
        
        // Final validation - ensure result is a valid name component
        if (cleaned && !IdentityValidators.isValidNameComponent(cleaned.split(/\s+/)[0])) {
            logger.warn('[SLOT EXTRACTOR] cleanName rejected invalid result', { 
                original: name, 
                cleaned 
            });
            return null;
        }
        
        return cleaned;
    }
    
    static titleCase(str) {
        if (!str) return str;
        return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
    }
    
    static formatPhone(digits) {
        const clean = digits.replace(/\D/g, '');
        if (clean.length === 11 && clean.startsWith('1')) {
            return `(${clean.slice(1, 4)}) ${clean.slice(4, 7)}-${clean.slice(7)}`;
        }
        if (clean.length >= 10) {
            const last10 = clean.slice(-10);
            return `(${last10.slice(0, 3)}) ${last10.slice(3, 6)}-${last10.slice(6)}`;
        }
        return digits;
    }
    
    /**
     * ========================================================================
     * MARK SLOT CONFIRMED
     * ========================================================================
     * 
     * Call this when user confirms a slot value.
     */
    static confirmSlot(slots, slotKey, turnCount) {
        if (!slots[slotKey]) return slots;
        
        // V96e: Add confirmedAt timestamp for sticky slots
        // Once a slot is confirmed, it becomes immutable unless explicitly corrected
        const now = new Date().toISOString();
        
        return {
            ...slots,
            [slotKey]: {
                ...slots[slotKey],
                confirmed: true,
                confidence: CONFIDENCE.CONFIRMED,
                confirmedAtTurn: turnCount,
                confirmedAt: now,  // V96e: Timestamp for immutability tracking
                immutable: true    // V96e: Flag to prevent accidental overwrites
            }
        };
    }
    
    /**
     * ========================================================================
     * GET UNCONFIRMED SLOTS
     * ========================================================================
     * 
     * Returns slots that need confirmation (confidence < 1.0).
     */
    static getUnconfirmedSlots(slots) {
        const unconfirmed = {};
        for (const [key, slot] of Object.entries(slots || {})) {
            if (slot && slot.confidence < CONFIDENCE.CONFIRMED && !slot.confirmed) {
                unconfirmed[key] = slot;
            }
        }
        return unconfirmed;
    }
    
    /**
     * ========================================================================
     * GET SLOT VALUES (simple key-value map)
     * ========================================================================
     * 
     * Returns just the values without metadata.
     */
    static getSlotValues(slots) {
        const values = {};
        for (const [key, slot] of Object.entries(slots || {})) {
            if (slot && slot.value) {
                values[key] = slot.value;
            }
        }
        return values;
    }
}

module.exports = SlotExtractor;
module.exports.CONFIDENCE = CONFIDENCE;
module.exports.SOURCE = SOURCE;
module.exports.GreetingTracker = GreetingTracker;
