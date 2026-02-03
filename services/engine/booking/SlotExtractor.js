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
 * ============================================================================
 */

const logger = require('../../../utils/logger');

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
    'thermostat', 'filter', 'vent', 'duct', 'coil', 'compressor', 'condenser',
    'furnace', 'heater', 'ac', 'hvac', 'air', 'conditioning', 'heat', 'pump',
    // V92 FIX: Pronouns and articles that slip through
    'its', "it's", 'they', 'them', 'their', 'we', 'our', 'us',
    'one', 'some', 'any', 'all', 'none', 'each', 'every', 'both',
    // V92 FIX: Negation and affirmation words
    'nothing', 'everything', 'anything', 'something', 'never', 'always', 'ever'
]);

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
        
        // Determine which extractors should run based on current booking step
        const shouldExtract = (slotKey) => {
            // If this slot is already confirmed, don't extract (except for explicit corrections)
            if (confirmedSlots[slotKey] === true) {
                return false;
            }
            
            // Booking step gating: only extract what's relevant to current step
            if (currentBookingStep) {
                switch (currentBookingStep) {
                    case 'address':
                        // During address collection, DON'T extract name or time
                        // "12155 Metro Parkway" should NOT become name: "Metro Parkway"
                        if (slotKey === 'name') return false;
                        if (slotKey === 'time') return false;
                        break;
                    case 'name':
                        // During name collection, DON'T extract address
                        if (slotKey === 'address') return false;
                        break;
                    case 'phone':
                        // During phone collection, DON'T extract name or address
                        if (slotKey === 'name') return false;
                        if (slotKey === 'address') return false;
                        break;
                    case 'time':
                        // During time collection, DON'T extract name or address
                        if (slotKey === 'name') return false;
                        if (slotKey === 'address') return false;
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
     * 3. If new confidence > existing → overwrite
     * 4. If similar confidence but different values → keep existing, mark conflict
     * 5. Track history for debugging
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
        
        for (const [key, newSlot] of Object.entries(newSlots)) {
            const existing = merged[key];
            
            // Add updatedAt to new slot
            newSlot.updatedAt = now;
            
            if (!existing) {
                // No existing slot - add new one with full metadata
                merged[key] = {
                    ...newSlot,
                    confirmed: newSlot.confirmed || false,
                    needsConfirmation: newSlot.needsConfirmation ?? (newSlot.source === SOURCE.CALLER_ID),
                    conflict: false,
                    history: []
                };
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
            
            // RULE 2: If new slot is a correction, overwrite
            if (newSlot.isCorrection) {
                logger.info('[SLOT EXTRACTOR] Overwriting slot due to correction', {
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
            }
            // Else: keep existing (new confidence is lower or equal)
        }
        
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
     * V92: Uses commonFirstNames list (900+ names) from company config to 
     * determine if a single-word name is likely a first name or last name.
     * 
     * - If name is in commonFirstNames → isLikelyFirstName: true
     * - If name is NOT in list → isLikelyFirstName: false (assume last name)
     * - If list is empty → isLikelyFirstName: true (safe default)
     */
    static extractName(text, context = {}) {
        if (!text) return null;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V92: Load commonFirstNames from company config for first/last name detection
        // ═══════════════════════════════════════════════════════════════════════════
        const commonFirstNames = context.company?.aiAgentSettings?.frontDeskBehavior?.commonFirstNames || [];
        const commonFirstNamesSet = new Set(commonFirstNames.map(n => String(n).toLowerCase()));
        const hasNameList = commonFirstNames.length > 0;
        
        /**
         * Check if a single name is likely a first name based on commonFirstNames list
         */
        const isLikelyFirstName = (name) => {
            if (!hasNameList) return true; // No list = assume first name (safe default)
            return commonFirstNamesSet.has(String(name).toLowerCase());
        };
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FEB 2026 FIX: STT preprocessing lowercases everything, so patterns must
        // use [a-zA-Z] instead of [A-Z][a-z] to match both cases.
        // The cleanName() function will title-case the result.
        // ═══════════════════════════════════════════════════════════════════════════
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FEB 2026 FIX #2: CORRECTION PATTERNS TAKE PRIORITY!
        // When someone says "my name is X um, and mark that's Mark Gonzales"
        // The "that's Mark Gonzales" is the REAL name, not "X"
        // Check for self-correction patterns FIRST
        // ═══════════════════════════════════════════════════════════════════════════
        const correctionPatterns = [
            // "that's Mark Gonzales" / "it's Mark" / "actually Mark" / "I mean Mark"
            /(?:that'?s|that\s+is|it'?s|actually|i\s+mean|well\s+it'?s)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s*[.,]?\s*(?:and|$)/i,
            /(?:that'?s|that\s+is|it'?s|actually|i\s+mean)\s+([a-zA-Z]+\s+[a-zA-Z]+)/i,
            // "[anything] that's X" at end of sentence - the correction is most likely the real name
            /that'?s\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s*[.!?,]*\s*$/i
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
                            source: SOURCE.UTTERANCE
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
                        
                        return result;
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
        
        // PRIORITY 1: "My name is X" - Most explicit, search ANYWHERE in text
        // Uses matchAll to find ALL occurrences and pick the best one
        const myNameIsPatterns = [
            // "my name is mark gonzales" OR "my name is mark, gonzales" 
            /my\s+name\s+is\s+([a-zA-Z]+)[,\s]+([a-zA-Z]+)/gi,
            // Single name: "my name is mark"
            /my\s+name\s+is\s+([a-zA-Z]+)(?:\s|$|[.,!?])/gi
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
                
                if (name && !NAME_STOP_WORDS.has(name.toLowerCase())) {
                    const nameParts = name.split(/\s+/);
                    const isSingleWord = nameParts.length === 1;
                    const likelyFirst = isSingleWord ? isLikelyFirstName(name) : true;
                    
                    logger.info('[SLOT EXTRACTOR] ✅ Name matched via "my name is" (PRIORITY 1)', {
                        raw: match[0],
                        cleaned: name,
                        matchCount: matches.length
                    });
                    
                    const result = {
                        value: name,
                        confidence: CONFIDENCE.UTTERANCE_HIGH,
                        source: SOURCE.UTTERANCE
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
                    
                    return result;
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
                    
                    logger.debug('[SLOT EXTRACTOR] Name matched via explicit pattern', {
                        raw: match[0],
                        cleaned: name,
                        pattern: pattern.source.substring(0, 50),
                        hasTwoParts: !!match[2],
                        isSingleWord,
                        likelyFirst,
                        hasNameList
                    });
                    
                    const result = {
                        value: name,
                        confidence: CONFIDENCE.UTTERANCE_HIGH,
                        source: SOURCE.UTTERANCE
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
                    
                    return result;
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
                return result;
            }
        }
        
        // Pattern 3: First + Last name pattern (two words that look like names)
        // Allow any case, filter by stop words
        const fullNameMatch = text.match(/\b([a-zA-Z]{2,})\s+([a-zA-Z]{2,})\b/i);
        if (fullNameMatch) {
            const first = this.cleanName(fullNameMatch[1]);
            const last = this.cleanName(fullNameMatch[2]);
            if (first && last && 
                !NAME_STOP_WORDS.has(first.toLowerCase()) && 
                !NAME_STOP_WORDS.has(last.toLowerCase())) {
                return {
                    value: `${first} ${last}`,
                    confidence: CONFIDENCE.UTTERANCE_HIGH,
                    source: SOURCE.UTTERANCE,
                    firstName: first,
                    lastName: last
                };
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
                
                return result;
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
        
        if (TIME_PHRASE_BLOCKLIST.test(text)) {
            logger.debug('[SLOT EXTRACTOR] Address rejected: matches time phrase pattern', { text: text.substring(0, 50) });
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
            const match = text.match(pattern);
            if (match && match[1].length >= 10) {
                const candidate = match[1].trim();
                
                // V92 FIX: Double-check the candidate doesn't contain time words
                if (TIME_WORDS_BLOCKLIST.test(candidate)) {
                    logger.debug('[SLOT EXTRACTOR] Address candidate rejected: contains time words', { candidate });
                    continue;
                }
                
                return {
                    value: candidate,
                    confidence: CONFIDENCE.UTTERANCE_HIGH,
                    source: SOURCE.UTTERANCE
                };
            }
        }
        
        // If we're expecting address, be more lenient BUT still validate
        if (context.expectingSlot === 'address') {
            // Look for number + words pattern
            const lenientMatch = text.match(/(\d{1,5}\s+[A-Za-z].*)/);
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
    
    /**
     * ========================================================================
     * HELPERS
     * ========================================================================
     */
    static cleanName(name) {
        if (!name) return null;
        return name
            .split(/\s+/)
            .filter(w => !NAME_STOP_WORDS.has(w.toLowerCase()) && w.length > 1)
            .map(w => this.titleCase(w.replace(/[^A-Za-z\-'\.]/g, '')))
            .join(' ')
            .trim() || null;
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
        
        return {
            ...slots,
            [slotKey]: {
                ...slots[slotKey],
                confirmed: true,
                confidence: CONFIDENCE.CONFIRMED,
                confirmedAtTurn: turnCount
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
