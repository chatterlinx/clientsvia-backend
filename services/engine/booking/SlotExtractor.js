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
    'told', 'said', 'gave', 'already', 'already', 'mentioned', 'repeat',
    'again', 'same', 'correct', 'wrong', 'information'
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
        
        const extracted = {};
        const text = (utterance || '').trim();
        
        if (!text && !callerPhone) {
            return extracted;
        }
        
        // Detect if this is a correction
        const isCorrection = this.isCorrection(text);
        
        // Extract each slot type
        const nameResult = this.extractName(text, context);
        if (nameResult) {
            extracted.name = {
                ...nameResult,
                turn: turnCount,
                isCorrection
            };
        }
        
        const phoneResult = this.extractPhone(text, callerPhone, context);
        if (phoneResult) {
            extracted.phone = {
                ...phoneResult,
                turn: turnCount,
                isCorrection
            };
        }
        
        const addressResult = this.extractAddress(text, context);
        if (addressResult) {
            extracted.address = {
                ...addressResult,
                turn: turnCount,
                isCorrection
            };
        }
        
        const timeResult = this.extractTime(text, context);
        if (timeResult) {
            extracted.time = {
                ...timeResult,
                turn: turnCount,
                isCorrection
            };
        }
        
        const emailResult = this.extractEmail(text, context);
        if (emailResult) {
            extracted.email = {
                ...emailResult,
                turn: turnCount,
                isCorrection
            };
        }
        
        // Log extraction results
        if (Object.keys(extracted).length > 0) {
            logger.info('[SLOT EXTRACTOR] Slots extracted from utterance', {
                turnCount,
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
     */
    static extractName(text, context = {}) {
        if (!text) return null;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FEB 2026 FIX: STT preprocessing lowercases everything, so patterns must
        // use [a-zA-Z] instead of [A-Z][a-z] to match both cases.
        // The cleanName() function will title-case the result.
        // ═══════════════════════════════════════════════════════════════════════════
        
        // Pattern 1: "My name is X" / "I'm X" / "This is X" / "I am X"
        // Note: Capture group allows any case, cleanName will normalize
        const explicitPatterns = [
            /(?:my\s+name\s+is|i'?m|i\s+am|this\s+is|it'?s)\s+([a-zA-Z]+(?:\s+[a-zA-Z]+)?)/i,
            /(?:call\s+me|they\s+call\s+me)\s+([a-zA-Z]+)/i
        ];
        
        for (const pattern of explicitPatterns) {
            const match = text.match(pattern);
            if (match && match[1]) {
                const name = this.cleanName(match[1]);
                if (name && !NAME_STOP_WORDS.has(name.toLowerCase())) {
                    logger.debug('[SLOT EXTRACTOR] Name matched via explicit pattern', {
                        raw: match[1],
                        cleaned: name,
                        pattern: pattern.source.substring(0, 50)
                    });
                    return {
                        value: name,
                        confidence: CONFIDENCE.UTTERANCE_HIGH,
                        source: SOURCE.UTTERANCE
                    };
                }
            }
        }
        
        // Pattern 2: "Hi [Name]" / "Hello [Name]" at start
        const greetingMatch = text.match(/^(?:hi|hello|hey)\s+([a-zA-Z]+)/i);
        if (greetingMatch && greetingMatch[1]) {
            const name = this.cleanName(greetingMatch[1]);
            if (name && !NAME_STOP_WORDS.has(name.toLowerCase())) {
                return {
                    value: name,
                    confidence: CONFIDENCE.UTTERANCE_LOW,
                    source: SOURCE.UTTERANCE
                };
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
                return {
                    value: name,
                    confidence: CONFIDENCE.UTTERANCE_HIGH,
                    source: SOURCE.UTTERANCE
                };
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
        
        // Pattern: Street address (number + street name)
        const addressPatterns = [
            // "123 Main Street"
            /(\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Court|Ct|Circle|Cir|Place|Pl)\.?)/i,
            // "123 Main St, Apt 4"
            /(\d{1,5}\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Boulevard|Blvd|Way|Court|Ct|Circle|Cir|Place|Pl)\.?,?\s*(?:Apt|Unit|Suite|#)?\s*\d*[A-Za-z]?)/i
        ];
        
        for (const pattern of addressPatterns) {
            const match = text.match(pattern);
            if (match) {
                return {
                    value: match[1].trim(),
                    confidence: CONFIDENCE.UTTERANCE_HIGH,
                    source: SOURCE.UTTERANCE
                };
            }
        }
        
        // If we're expecting address, be more lenient
        if (context.expectingSlot === 'address') {
            // Look for number + words pattern
            const lenientMatch = text.match(/(\d{1,5}\s+[A-Za-z].*)/);
            if (lenientMatch && lenientMatch[1].length > 5) {
                return {
                    value: lenientMatch[1].trim(),
                    confidence: CONFIDENCE.UTTERANCE_LOW,
                    source: SOURCE.UTTERANCE,
                    needsValidation: true
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
        
        // ASAP patterns
        if (/\b(asap|as soon as possible|soon|right away|immediately|now|today)\b/.test(lowerText)) {
            return {
                value: 'ASAP',
                confidence: CONFIDENCE.UTTERANCE_HIGH,
                source: SOURCE.UTTERANCE
            };
        }
        
        // Morning/afternoon/evening
        if (/\b(morning|am|before noon)\b/.test(lowerText)) {
            return {
                value: 'Morning',
                confidence: CONFIDENCE.UTTERANCE_HIGH,
                source: SOURCE.UTTERANCE
            };
        }
        if (/\b(afternoon|pm|after lunch|after noon)\b/.test(lowerText)) {
            return {
                value: 'Afternoon',
                confidence: CONFIDENCE.UTTERANCE_HIGH,
                source: SOURCE.UTTERANCE
            };
        }
        if (/\b(evening|night|after work|after 5)\b/.test(lowerText)) {
            return {
                value: 'Evening',
                confidence: CONFIDENCE.UTTERANCE_HIGH,
                source: SOURCE.UTTERANCE
            };
        }
        
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
