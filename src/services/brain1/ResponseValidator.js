/**
 * ============================================================================
 * RESPONSE VALIDATOR - QUALITY GATE (PRODUCTION-READY)
 * ============================================================================
 * 
 * Validates that AI responses are usable before sending to caller.
 * Part of the "No Silence Ever" runtime contract.
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * KEY DESIGN DECISIONS:
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * 1. ANCHORED REGEXES: Dead-end patterns are anchored to END of string ($)
 *    - "Goodbye, we'll get you scheduled" → VALID (not at end)
 *    - "Have a great day." → DEAD-END (at end, closing phrase)
 * 
 * 2. TURN-AWARE: Dead-end patterns only checked on Turn 3+
 *    - Turn 1-2: Immunity from dead-end patterns (avoid killing valid follow-ups)
 *    - Turn 3+: Check for closing phrases that shouldn't happen mid-call
 * 
 * 3. HONEST MESSAGING: Soft bailout says "let me rephrase" not "I can't hear you"
 *    - AI generation failure ≠ caller audio problem
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * MULTI-TENANT SAFE:
 * - Uses only generic English patterns (no domain terms)
 * - All patterns are configurable, not hardcoded
 * - No HVAC, dental, barber, or any trade-specific logic
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const LoopDetector = require('./LoopDetector');

// ════════════════════════════════════════════════════════════════════════════
// DEAD-END PATTERNS - ANCHORED TO END OF STRING ($)
// ════════════════════════════════════════════════════════════════════════════
// 
// These catch "conversation closers" that the AI accidentally uses mid-call.
// The $ anchor ensures we only catch phrases AT THE END of the response,
// not mid-sentence uses like "Goodbye, I'll get you scheduled now."
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

// LATE-TURN dead-ends (Turn 3+) - closing phrases AT THE END of response
const LATE_TURN_DEAD_END_PATTERNS = [
    // "Is there anything else I/we can help you with?" at the end
    /(is there anything else (I|we) can (help|assist)( you)?( with)?)[.!?"]*\s*$/i,
    
    // "Anything else for you today?" at the end
    /(anything else for you today)[.!?"]*\s*$/i,

    // Hard closing / goodbye sequences at the end only
    /(have a great day)[.!?"]*\s*$/i,
    /(thanks for calling|thank you for calling)[.!?"]*\s*$/i,
    /(goodbye|good bye)[.!?"]*\s*$/i,
    
    // Generic "how can I help" at end (indicates lost context)
    /(how can (I|we) help you( today)?)[.!?"]*\s*$/i,
    /(what can (I|we) (help|do for) you( with)?( today)?)[.!?"]*\s*$/i,
];

// Configurable thresholds
const CONFIG = {
    minResponseLength: 10,              // Lowered to 10 to allow "Okay, sure."
    minTurnForDeadEndCheck: 3,          // Only check late-turn patterns on Turn 3+
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
    // Ensure turnNumber is valid
    const turn = (typeof turnNumber === 'number' && turnNumber > 0) ? turnNumber : 1;
    
    // ════════════════════════════════════════════════════════════════════════════
    // CHECK 1: Not empty or null
    // ════════════════════════════════════════════════════════════════════════════
    if (!responseText || typeof responseText !== 'string') {
        return {
            usable: false,
            reason: 'EMPTY',
            details: { received: typeof responseText, turnNumber: turn }
        };
    }
    
    const trimmed = responseText.trim();
    
    // ════════════════════════════════════════════════════════════════════════════
    // CHECK 2: Minimum length (too short = not substantive)
    // Lowered to 10 to allow short valid confirmations like "Okay, sure."
    // ════════════════════════════════════════════════════════════════════════════
    if (trimmed.length < CONFIG.minResponseLength) {
        return {
            usable: false,
            reason: 'TOO_SHORT',
            details: { 
                length: trimmed.length, 
                minimum: CONFIG.minResponseLength,
                text: trimmed,
                turnNumber: turn
            }
        };
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // CHECK 3: Not looping (same response 2+ times in a row)
    // This is the smartest check - catches repetitive AI behavior
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
                    turnNumber: turn
                }
            };
        }
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // CHECK 4A: ALWAYS dead-end patterns (zero-substance responses)
    // These have no business being said at any turn
    // ════════════════════════════════════════════════════════════════════════════
    for (const pattern of CONFIG.patterns.always) {
        if (pattern.test(trimmed)) {
            return {
                usable: false,
                reason: 'DEAD_END_PATTERN',
                details: { 
                    matchedPattern: pattern.toString(),
                    text: trimmed.substring(0, 50),
                    patternType: 'always',
                    turnNumber: turn
                }
            };
        }
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // CHECK 4B: LATE-TURN dead-end patterns (only on Turn 3+)
    // ════════════════════════════════════════════════════════════════════════════
    // 
    // TRADEOFF: We allow potential closers on Turn 1-2 to avoid the 
    // "instantly transferred" bug. It's highly unlikely a caller wants 
    // to end the call on Turn 1.
    // 
    // The $ anchor in patterns ensures we only catch phrases at the END
    // of the response, not mid-sentence uses.
    // ════════════════════════════════════════════════════════════════════════════
    
    if (turn >= CONFIG.minTurnForDeadEndCheck) {
        for (const pattern of CONFIG.patterns.lateTurn) {
            if (pattern.test(trimmed)) {
                logger.info('[RESPONSE VALIDATOR] Late-turn dead-end detected', {
                    callId: callId?.substring(0, 12),
                    turnNumber: turn,
                    pattern: pattern.toString().substring(0, 50),
                    text: trimmed.substring(0, 50)
                });
                
                return {
                    usable: false,
                    reason: 'DEAD_END_PATTERN',
                    details: { 
                        matchedPattern: pattern.toString(),
                        text: trimmed.substring(0, 50),
                        patternType: 'lateTurn',
                        turnNumber: turn
                    }
                };
            }
        }
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // ALL CHECKS PASSED
    // ════════════════════════════════════════════════════════════════════════════
    return {
        usable: true,
        reason: null,
        details: { length: trimmed.length, turnNumber: turn }
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
