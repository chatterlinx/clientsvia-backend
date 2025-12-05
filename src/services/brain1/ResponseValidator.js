/**
 * ============================================================================
 * RESPONSE VALIDATOR - QUALITY GATE (TURN-AWARE)
 * ============================================================================
 * 
 * Validates that AI responses are usable before sending to caller.
 * Part of the "No Silence Ever" runtime contract.
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * CRITICAL FIX (2025-12-05):
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Dead-end patterns MUST be turn-aware. Example:
 * 
 *   Turn 1: "Is there anything else you'd like to tell me about the issue?"
 *   → This is a VALID follow-up question asking for more details!
 *   
 *   Turn 5: "Is there anything else I can help you with today?"
 *   → This is a dead-end closing phrase.
 * 
 * The difference:
 * - "tell me about the issue" = asking for info (VALID)
 * - "help you with today" = wrapping up (DEAD-END)
 * 
 * Solution: Only apply dead-end detection on Turn 3+, and use specific
 * patterns that target actual closing phrases, not follow-up questions.
 * 
 * ============================================================================
 * MULTI-TENANT SAFE:
 * - Uses only generic English patterns (no domain terms)
 * - All patterns are configurable, not hardcoded
 * - No HVAC, dental, barber, or any trade-specific logic
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const LoopDetector = require('./LoopDetector');

// ════════════════════════════════════════════════════════════════════════════
// DEAD-END PATTERNS - SPLIT BY WHEN THEY APPLY
// ════════════════════════════════════════════════════════════════════════════

// ALWAYS dead-ends (even on Turn 1) - response has zero substance
const ALWAYS_DEAD_END_PATTERNS = [
    /^i understand\.?\s*$/i,           // Just "I understand." and nothing else
    /^okay\.?\s*$/i,                   // Just "Okay." and nothing else
    /^i see\.?\s*$/i,                  // Just "I see." and nothing else
    /^got it\.?\s*$/i,                 // Just "Got it." and nothing else
    /^sure\.?\s*$/i,                   // Just "Sure." and nothing else
    /^alright\.?\s*$/i,                // Just "Alright." and nothing else
];

// LATE-TURN dead-ends (Turn 3+) - typical closing/wrap-up phrases
// These are FINE on early turns when asking for more info
const LATE_TURN_DEAD_END_PATTERNS = [
    // Closing phrases that wrap up calls
    /anything else (i|we) can (help|assist) (you )?(with|today)/i,
    /is there anything else for you today/i,
    /anything else before (i|we) (go|wrap|finish)/i,
    /will that be all/i,
    /is that everything/i,
    
    // Generic dead-ends with no context
    /^how can i help you\??$/i,        // ONLY if it's the entire response
    /^what can i help you with\??$/i,  // ONLY if it's the entire response
];

// Configurable thresholds
const CONFIG = {
    minResponseLength: 20,              // Minimum chars for a response (lowered from 25)
    minTurnForDeadEndCheck: 3,         // Only check late-turn patterns on Turn 3+
    patterns: {
        always: ALWAYS_DEAD_END_PATTERNS,
        lateTurn: LATE_TURN_DEAD_END_PATTERNS
    }
};

/**
 * Check if a response is usable (not empty, not dead-end, not looping)
 * 
 * NOW TURN-AWARE: Dead-end patterns only apply on later turns.
 * 
 * @param {string} responseText - The AI response text
 * @param {string} callId - The call SID for loop detection
 * @param {number} turnNumber - Current turn in the conversation (1-indexed)
 * @returns {Object} { usable: boolean, reason: string|null, details: Object }
 */
function isUsable(responseText, callId, turnNumber = 1) {
    // ════════════════════════════════════════════════════════════════════════════
    // CHECK 1: Not empty or null
    // ════════════════════════════════════════════════════════════════════════════
    if (!responseText || typeof responseText !== 'string') {
        return {
            usable: false,
            reason: 'EMPTY',
            details: { received: typeof responseText }
        };
    }
    
    const trimmed = responseText.trim();
    
    // ════════════════════════════════════════════════════════════════════════════
    // CHECK 2: Minimum length (too short = not substantive)
    // ════════════════════════════════════════════════════════════════════════════
    if (trimmed.length < CONFIG.minResponseLength) {
        return {
            usable: false,
            reason: 'TOO_SHORT',
            details: { 
                length: trimmed.length, 
                minimum: CONFIG.minResponseLength,
                text: trimmed
            }
        };
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // CHECK 3A: ALWAYS dead-end patterns (zero-substance responses)
    // ════════════════════════════════════════════════════════════════════════════
    for (const pattern of CONFIG.patterns.always) {
        if (pattern.test(trimmed)) {
            return {
                usable: false,
                reason: 'DEAD_END_PATTERN',
                details: { 
                    matchedPattern: pattern.toString(),
                    text: trimmed.substring(0, 50),
                    patternType: 'always'
                }
            };
        }
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // CHECK 3B: LATE-TURN dead-end patterns (only on Turn 3+)
    // ════════════════════════════════════════════════════════════════════════════
    // 
    // CRITICAL: On early turns (1-2), phrases like "is there anything else you'd 
    // like to tell me about the issue?" are VALID follow-up questions!
    // We only treat them as dead-ends on later turns when they become wrap-ups.
    // ════════════════════════════════════════════════════════════════════════════
    
    if (turnNumber >= CONFIG.minTurnForDeadEndCheck) {
        for (const pattern of CONFIG.patterns.lateTurn) {
            if (pattern.test(trimmed)) {
                logger.info('[RESPONSE VALIDATOR] Late-turn dead-end detected', {
                    callId: callId?.substring(0, 12),
                    turnNumber,
                    pattern: pattern.toString().substring(0, 40)
                });
                
                return {
                    usable: false,
                    reason: 'DEAD_END_PATTERN',
                    details: { 
                        matchedPattern: pattern.toString(),
                        text: trimmed.substring(0, 50),
                        patternType: 'lateTurn',
                        turnNumber
                    }
                };
            }
        }
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // CHECK 4: Not looping (same response 2+ times in a row)
    // ════════════════════════════════════════════════════════════════════════════
    if (callId) {
        const loopCheck = LoopDetector.checkForLoop(callId, trimmed);
        if (loopCheck.isLooping) {
            return {
                usable: false,
                reason: 'LOOP_DETECTED',
                details: {
                    loopCount: loopCheck.loopCount,
                    signature: loopCheck.signature?.substring(0, 30),
                    turnNumber
                }
            };
        }
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // ALL CHECKS PASSED
    // ════════════════════════════════════════════════════════════════════════════
    return {
        usable: true,
        reason: null,
        details: { length: trimmed.length, turnNumber }
    };
}

/**
 * Validate a response and log the result (TURN-AWARE)
 * 
 * @param {string} responseText - The AI response text
 * @param {string} callId - The call SID
 * @param {string} context - Where this is being called from (for logging)
 * @param {number} turnNumber - Current turn in the conversation
 * @returns {Object} Validation result
 */
function validateAndLog(responseText, callId, context = 'unknown', turnNumber = 1) {
    const result = isUsable(responseText, callId, turnNumber);
    
    if (!result.usable) {
        logger.warn('[RESPONSE VALIDATOR] ⚠️ Response failed validation', {
            callId: callId?.substring(0, 12),
            context,
            reason: result.reason,
            turnNumber,
            details: result.details
        });
    } else {
        logger.debug('[RESPONSE VALIDATOR] ✅ Response passed validation', {
            callId: callId?.substring(0, 12),
            context,
            turnNumber,
            length: result.details.length
        });
    }
    
    return result;
}

/**
 * Update configuration at runtime
 * Useful for A/B testing or per-environment tuning
 * 
 * @param {Object} newConfig - Partial config to merge
 */
function updateConfig(newConfig) {
    if (newConfig.minResponseLength !== undefined) {
        CONFIG.minResponseLength = newConfig.minResponseLength;
    }
    if (newConfig.minTurnForDeadEndCheck !== undefined) {
        CONFIG.minTurnForDeadEndCheck = newConfig.minTurnForDeadEndCheck;
    }
    if (newConfig.patterns !== undefined) {
        CONFIG.patterns = newConfig.patterns;
    }
    logger.info('[RESPONSE VALIDATOR] Config updated', { 
        minResponseLength: CONFIG.minResponseLength,
        minTurnForDeadEndCheck: CONFIG.minTurnForDeadEndCheck,
        alwaysPatternsCount: CONFIG.patterns.always.length,
        lateTurnPatternsCount: CONFIG.patterns.lateTurn.length
    });
}

/**
 * Get current configuration (for diagnostics)
 */
function getConfig() {
    return {
        minResponseLength: CONFIG.minResponseLength,
        minTurnForDeadEndCheck: CONFIG.minTurnForDeadEndCheck,
        alwaysPatternsCount: CONFIG.patterns.always.length,
        lateTurnPatternsCount: CONFIG.patterns.lateTurn.length
    };
}

module.exports = {
    isUsable,
    validateAndLog,
    updateConfig,
    getConfig,
    // Expose for testing
    ALWAYS_DEAD_END_PATTERNS,
    LATE_TURN_DEAD_END_PATTERNS
};
