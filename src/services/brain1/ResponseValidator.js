/**
 * ============================================================================
 * RESPONSE VALIDATOR - QUALITY GATE
 * ============================================================================
 * 
 * Validates that AI responses are usable before sending to caller.
 * Part of the "No Silence Ever" runtime contract.
 * 
 * MULTI-TENANT SAFE:
 * - Uses only generic English patterns (no domain terms)
 * - All patterns are configurable, not hardcoded
 * - No HVAC, dental, barber, or any trade-specific logic
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const LoopDetector = require('./LoopDetector');

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURABLE PATTERNS (Generic English only - no domain terms)
// ════════════════════════════════════════════════════════════════════════════
// 
// These patterns detect "dead-end" responses that don't move conversation forward.
// They are trade-agnostic - work for HVAC, dental, legal, barber, etc.
// 
// To adjust: Modify this array or load from environment/config
// ════════════════════════════════════════════════════════════════════════════

const DEFAULT_DEAD_END_PATTERNS = [
    // Generic non-helpful responses
    /^i understand\.?\s*$/i,
    /^okay\.?\s*$/i,
    /^i see\.?\s*$/i,
    /^got it\.?\s*$/i,
    
    // Dead-end follow-ups that don't probe for info
    /how can i help you\??$/i,
    /what can i help you with\??$/i,
    /is there anything else/i,
    /can you tell me more\??$/i,
    /let me get some details/i,
    /i'm here to help/i,
    /i'd be happy to help/i,
    
    // Repetitive acknowledgments without substance
    /i understand\.\s*how can i/i,
    /okay,?\s*i understand/i,
    
    // Too vague to be useful
    /what would you like to do/i,
    /what do you need/i,
];

// Configurable thresholds
const CONFIG = {
    minResponseLength: 25,          // Minimum chars for a response to be considered
    maxLoopCount: 2,                // Same response N times = stuck
    patterns: DEFAULT_DEAD_END_PATTERNS,
};

/**
 * Load patterns from environment if available
 * Allows runtime configuration without code changes
 */
function getPatterns() {
    // Future: Could load from process.env.DEAD_END_PATTERNS_JSON
    // For now, use defaults
    return CONFIG.patterns;
}

/**
 * Check if a response is usable (not empty, not dead-end, not looping)
 * 
 * @param {string} responseText - The AI response text
 * @param {string} callId - The call SID for loop detection
 * @returns {Object} { usable: boolean, reason: string|null, details: Object }
 */
function isUsable(responseText, callId) {
    const result = {
        usable: true,
        reason: null,
        details: {}
    };
    
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
    // CHECK 3: Not a dead-end pattern (generic English only)
    // ════════════════════════════════════════════════════════════════════════════
    const patterns = getPatterns();
    for (const pattern of patterns) {
        if (pattern.test(trimmed)) {
            return {
                usable: false,
                reason: 'DEAD_END_PATTERN',
                details: { 
                    matchedPattern: pattern.toString(),
                    text: trimmed.substring(0, 50)
                }
            };
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
                    signature: loopCheck.signature?.substring(0, 30)
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
        details: { length: trimmed.length }
    };
}

/**
 * Validate a response and log the result
 * 
 * @param {string} responseText - The AI response text
 * @param {string} callId - The call SID
 * @param {string} context - Where this is being called from (for logging)
 * @returns {Object} Validation result
 */
function validateAndLog(responseText, callId, context = 'unknown') {
    const result = isUsable(responseText, callId);
    
    if (!result.usable) {
        logger.warn('[RESPONSE VALIDATOR] ⚠️ Response failed validation', {
            callId: callId?.substring(0, 12),
            context,
            reason: result.reason,
            details: result.details
        });
    } else {
        logger.debug('[RESPONSE VALIDATOR] ✅ Response passed validation', {
            callId: callId?.substring(0, 12),
            context,
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
    if (newConfig.maxLoopCount !== undefined) {
        CONFIG.maxLoopCount = newConfig.maxLoopCount;
    }
    if (newConfig.patterns !== undefined) {
        CONFIG.patterns = newConfig.patterns;
    }
    logger.info('[RESPONSE VALIDATOR] Config updated', { 
        minResponseLength: CONFIG.minResponseLength,
        maxLoopCount: CONFIG.maxLoopCount,
        patternCount: CONFIG.patterns.length
    });
}

/**
 * Get current configuration (for diagnostics)
 */
function getConfig() {
    return {
        minResponseLength: CONFIG.minResponseLength,
        maxLoopCount: CONFIG.maxLoopCount,
        patternCount: CONFIG.patterns.length
    };
}

module.exports = {
    isUsable,
    validateAndLog,
    updateConfig,
    getConfig,
    // Expose for testing
    DEFAULT_DEAD_END_PATTERNS
};

