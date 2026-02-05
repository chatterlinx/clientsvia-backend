/**
 * ============================================================================
 * BOOKING SLOT VALIDATOR - V96k
 * ============================================================================
 * 
 * Positive allowlist validation for booking slots.
 * 
 * PRINCIPLE: Don't just reject bad patterns - explicitly accept good ones.
 * 
 * For TIME slots:
 * - MUST match one of the valid time patterns (positive allowlist)
 * - MUST NOT contain street/address tokens
 * - MUST NOT match the current address value
 * 
 * For NAME slots:
 * - MUST NOT look like a phone number
 * 
 * This is Layer 1 defense: validation at write-time.
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');

// ============================================================================
// TIME SLOT VALIDATION
// ============================================================================

/**
 * Valid time patterns - positive allowlist
 * A time value MUST match at least one of these to be valid
 */
const VALID_TIME_PATTERNS = [
    // Time of day
    /\b(morning|afternoon|evening|tonight)\b/i,
    
    // Urgency phrases - CRITICAL: these are valid time answers!
    /\b(asap|a\.?s\.?a\.?p\.?)\b/i,
    /\b(as\s+early\s+as\s+possible|as\s+soon\s+as\s+possible)\b/i,
    /\b(earliest|soonest|first\s+available|next\s+available)\b/i,
    /\b(right\s+away|immediately)\b/i,
    
    // Specific time ranges (common HVAC booking slots)
    /\b(8|9|10|11|12|1|2|3|4|5|6|7)[-–—]\s*(8|9|10|11|12|1|2|3|4|5|6|7)\b/i,  // 8-10, 10-12, 12-2, 2-4
    
    // Clock times
    /\b\d{1,2}:\d{2}\s*(am|pm)?\b/i,  // 10:30, 3:15pm
    /\b\d{1,2}\s*(am|pm)\b/i,          // 3pm, 10am
    
    // Days
    /\b(today|tomorrow)\b/i,
    /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
    
    // Dates (basic patterns)
    /\b\d{1,2}\/\d{1,2}\b/,  // 2/15, 12/5
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{1,2}\b/i
];

/**
 * Invalid patterns for time slots - things that indicate contamination
 */
const TIME_REJECT_PATTERNS = {
    // Street/address tokens
    streetTokens: [
        'street', 'st', 'avenue', 'ave', 'road', 'rd', 'boulevard', 'blvd',
        'lane', 'ln', 'drive', 'dr', 'court', 'ct', 'place', 'pl',
        'parkway', 'pkwy', 'way', 'circle', 'cir', 'terrace', 'ter',
        'highway', 'hwy', 'freeway', 'expressway', 'alley', 'trail'
    ],
    
    // Pure numbers without time context (like "12155")
    pureNumber: /^\d{3,}$/,
    
    // House/building numbers with street pattern
    addressPattern: /\b\d{2,6}\s+[a-z]+\b/i
};

/**
 * Validate a time slot value
 * 
 * @param {string} value - The time value to validate
 * @param {Object} state - Current booking state (for cross-slot checks)
 * @returns {Object} { valid: boolean, reason?: string, matchedPattern?: string }
 */
function validateTimeSlot(value, state = {}) {
    if (!value || typeof value !== 'string') {
        return { valid: false, reason: 'empty_or_non_string' };
    }
    
    const valueStr = value.trim().toLowerCase();
    
    // Check 1: Does it match ANY valid time pattern? (POSITIVE ALLOWLIST)
    let matchedPattern = null;
    for (let i = 0; i < VALID_TIME_PATTERNS.length; i++) {
        if (VALID_TIME_PATTERNS[i].test(valueStr)) {
            matchedPattern = VALID_TIME_PATTERNS[i].toString();
            break;
        }
    }
    
    // Check 2: Does it contain street tokens? (NEGATIVE CHECK)
    const hasStreetTokens = TIME_REJECT_PATTERNS.streetTokens.some(token => 
        valueStr.includes(token.toLowerCase())
    );
    
    // Check 3: Is it a pure number? (NEGATIVE CHECK)
    const isPureNumber = TIME_REJECT_PATTERNS.pureNumber.test(valueStr);
    
    // Check 4: Does it match an address pattern? (NEGATIVE CHECK)
    const looksLikeAddress = TIME_REJECT_PATTERNS.addressPattern.test(valueStr);
    
    // Check 5: Does it match the current address value? (CONTAMINATION CHECK)
    const addressValue = String(state.bookingCollected?.address || '').trim().toLowerCase();
    const matchesAddress = addressValue && addressValue.length > 5 && (
        valueStr === addressValue ||
        valueStr.includes(addressValue) ||
        addressValue.includes(valueStr)
    );
    
    // DECISION LOGIC:
    // If it has street tokens, pure number, or matches address → REJECT
    if (hasStreetTokens) {
        return { valid: false, reason: 'contains_street_tokens', rejectedBy: 'negative_check' };
    }
    if (matchesAddress) {
        return { valid: false, reason: 'matches_current_address', rejectedBy: 'contamination_check' };
    }
    if (isPureNumber) {
        return { valid: false, reason: 'pure_number_without_context', rejectedBy: 'negative_check' };
    }
    if (looksLikeAddress) {
        return { valid: false, reason: 'looks_like_address_pattern', rejectedBy: 'negative_check' };
    }
    
    // If it matched a positive pattern → ACCEPT
    if (matchedPattern) {
        return { valid: true, matchedPattern, acceptedBy: 'positive_allowlist' };
    }
    
    // If it's very long and didn't match any pattern → REJECT
    if (valueStr.length > 25) {
        return { valid: false, reason: 'too_long_no_time_pattern', rejectedBy: 'length_check' };
    }
    
    // Ambiguous: didn't match positive allowlist, but also didn't trigger rejections
    // For safety, reject and ask again (better to re-ask than accept garbage)
    return { valid: false, reason: 'no_positive_pattern_match', rejectedBy: 'allowlist_miss' };
}

// ============================================================================
// NAME SLOT VALIDATION
// ============================================================================

/**
 * Validate a name slot value
 * 
 * @param {string} value - The name value to validate
 * @returns {Object} { valid: boolean, reason?: string }
 */
function validateNameSlot(value) {
    if (!value || typeof value !== 'string') {
        return { valid: false, reason: 'empty_or_non_string' };
    }
    
    const valueStr = value.trim();
    
    // Check if it looks like a phone number (digit ratio check)
    const digitsOnly = valueStr.replace(/\D/g, '');
    const digitRatio = valueStr.length > 0 ? digitsOnly.length / valueStr.length : 0;
    const looksLikePhone = digitRatio > 0.5 && digitsOnly.length >= 7;
    
    if (looksLikePhone) {
        return { valid: false, reason: 'looks_like_phone_number' };
    }
    
    // Check if it has at least one letter
    if (!/[a-zA-Z]/.test(valueStr)) {
        return { valid: false, reason: 'no_letters' };
    }
    
    return { valid: true };
}

// ============================================================================
// MAIN VALIDATION DISPATCHER
// ============================================================================

/**
 * Validate a slot value based on its type
 * 
 * @param {string} slotName - The name of the slot (e.g., 'time', 'name', 'address')
 * @param {*} value - The value to validate
 * @param {Object} state - Current booking state
 * @returns {Object} { valid: boolean, reason?: string, matchedPattern?: string }
 */
function validateSlotValue(slotName, value, state = {}) {
    // Route to appropriate validator based on slot name/type
    if (slotName === 'time' || slotName === 'preferredTime') {
        return validateTimeSlot(value, state);
    }
    
    if (slotName === 'name' || slotName === 'firstName' || slotName === 'lastName') {
        return validateNameSlot(value);
    }
    
    // For other slots (phone, address, etc.), accept by default
    // Individual validators can be added as needed
    return { valid: true, reason: 'no_validator_for_type' };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    validateSlotValue,
    validateTimeSlot,
    validateNameSlot,
    VALID_TIME_PATTERNS,
    TIME_REJECT_PATTERNS
};
