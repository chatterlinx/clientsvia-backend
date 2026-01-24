/**
 * sanitizeNoNameReply.js
 * 
 * LAZY MIGRATION FALLBACK for replies containing {name} when caller name is unknown.
 * 
 * This is a SEATBELT - it ensures we NEVER speak "{name}" to a caller.
 * Used only when:
 * 1. Caller name is NOT known
 * 2. _noName variant does NOT exist
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * RULES:
 * ═══════════════════════════════════════════════════════════════════════════════
 * 1. Only modifies OUTPUT string (never mutates stored template)
 * 2. Removes {name} placeholder cleanly
 * 3. Fixes punctuation to avoid "Thanks, ." or "Alright , what's going on?"
 * 4. Returns approved fallback if sanitization produces junk
 * 5. Logs usage for traceability (so we know which scenarios need _noName)
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('./logger');

/**
 * Approved generic fallback replies when sanitization produces junk
 * These are short, professional, and work for any scenario
 */
const GENERIC_FALLBACKS = {
    quick: [
        'Alright. What can I help you with?',
        'Got it. What\'s going on?',
        'Understood. How can I help?'
    ],
    full: [
        'Alright. What can I help you with today?',
        'Got it. Tell me what\'s going on.',
        'Understood. How can I help you?'
    ]
};

/**
 * Minimum length for a valid reply after sanitization
 * Anything shorter is probably junk like "." or "Thanks."
 */
const MIN_VALID_LENGTH = 8;

/**
 * Patterns that indicate the reply is too short/awkward after sanitization
 */
const JUNK_PATTERNS = [
    /^\.+$/,                    // Just dots
    /^,+$/,                     // Just commas
    /^\s*$/,                    // Empty or whitespace
    /^thanks\.?$/i,             // Just "Thanks" or "Thanks."
    /^thank you\.?$/i,          // Just "Thank you."
    /^alright\.?$/i,            // Just "Alright."
    /^okay\.?$/i,               // Just "Okay."
    /^ok\.?$/i,                 // Just "Ok."
    /^appreciate it\.?$/i,      // Just "Appreciate it."
    /^got it\.?$/i              // Just "Got it."
];

/**
 * Sanitize a reply that contains {name} when caller name is unknown
 * 
 * @param {string} text - The reply text containing {name}
 * @param {Object} options - Options
 * @param {string} options.type - 'quick' or 'full' (affects fallback selection)
 * @param {string} options.scenarioId - For logging
 * @param {string} options.scenarioName - For logging
 * @returns {string} Sanitized text safe for speaking
 */
function sanitizeNoNameReply(text, options = {}) {
    const { type = 'quick', scenarioId = 'unknown', scenarioName = 'unknown' } = options;
    
    if (!text || typeof text !== 'string') {
        return getGenericFallback(type);
    }
    
    // Start with the original text
    let result = text;
    
    // ========================================================================
    // STEP 1: Remove {name} and common variants with surrounding punctuation
    // ========================================================================
    
    // Pattern explanations:
    // - ", {name}" → "" (comma before name)
    // - "{name}," → "" (comma after name)
    // - " {name}" → "" (space before name)
    // - "{name} " → "" (space after name)
    // - "{name}" → "" (standalone)
    
    // Handle ", {name}" patterns (most common: "Thanks, {name}.")
    result = result.replace(/,\s*\{name\}/gi, '');
    
    // Handle "{name}," patterns
    result = result.replace(/\{name\}\s*,/gi, '');
    
    // Handle "{name}." at end of sentence
    result = result.replace(/\{name\}\s*\./gi, '.');
    
    // Handle "{name}!" at end of sentence
    result = result.replace(/\{name\}\s*!/gi, '!');
    
    // Handle "{name}?" at end of sentence
    result = result.replace(/\{name\}\s*\?/gi, '?');
    
    // Handle " — {name}" or "{name} —" (em dash patterns)
    result = result.replace(/\s*—\s*\{name\}/gi, ' —');
    result = result.replace(/\{name\}\s*—\s*/gi, '— ');
    
    // Handle "{name}," at start of sentence
    result = result.replace(/^\{name\}\s*,\s*/gi, '');
    
    // Handle any remaining {name} (standalone)
    result = result.replace(/\{name\}/gi, '');
    
    // ========================================================================
    // STEP 2: Clean up punctuation artifacts
    // ========================================================================
    
    // Fix double punctuation (e.g., ".." or "!." or "?.")
    result = result.replace(/([.!?])\s*([.!?])/g, '$1');
    
    // Fix ", ." or ", !" patterns
    result = result.replace(/,\s*([.!?])/g, '$1');
    
    // Fix double commas
    result = result.replace(/,\s*,/g, ',');
    
    // Fix leading comma
    result = result.replace(/^\s*,\s*/g, '');
    
    // Fix multiple spaces
    result = result.replace(/\s{2,}/g, ' ');
    
    // Fix space before punctuation
    result = result.replace(/\s+([.!?,])/g, '$1');
    
    // Trim
    result = result.trim();
    
    // Capitalize first letter if it became lowercase after stripping {name}
    if (result.length > 0) {
        result = result.charAt(0).toUpperCase() + result.slice(1);
    }
    
    // ========================================================================
    // STEP 3: Validate result is speakable
    // ========================================================================
    
    // Check if result is too short
    if (result.length < MIN_VALID_LENGTH) {
        logger.warn('[SANITIZE] Result too short after sanitization', {
            original: text,
            sanitized: result,
            scenarioId,
            scenarioName,
            fallbackUsed: true
        });
        return getGenericFallback(type);
    }
    
    // Check if result matches junk patterns
    for (const pattern of JUNK_PATTERNS) {
        if (pattern.test(result)) {
            logger.warn('[SANITIZE] Result matches junk pattern after sanitization', {
                original: text,
                sanitized: result,
                pattern: pattern.toString(),
                scenarioId,
                scenarioName,
                fallbackUsed: true
            });
            return getGenericFallback(type);
        }
    }
    
    // ========================================================================
    // STEP 4: Log successful sanitization (traceable debt)
    // ========================================================================
    
    logger.info('[SANITIZE] Sanitized reply (lazy noName fallback)', {
        original: text,
        sanitized: result,
        scenarioId,
        scenarioName,
        lazyNoNameFallbackUsed: true
    });
    
    return result;
}

/**
 * Sanitize an array of replies
 * 
 * @param {string[]} replies - Array of reply texts
 * @param {Object} options - Options (type, scenarioId, scenarioName)
 * @returns {string[]} Array of sanitized replies
 */
function sanitizeNoNameReplies(replies, options = {}) {
    if (!Array.isArray(replies) || replies.length === 0) {
        return [getGenericFallback(options.type || 'quick')];
    }
    
    return replies.map(reply => {
        // Handle both string and {text, weight} formats
        if (typeof reply === 'object' && reply.text) {
            return {
                ...reply,
                text: sanitizeNoNameReply(reply.text, options)
            };
        }
        return sanitizeNoNameReply(reply, options);
    });
}

/**
 * Get a generic fallback reply
 * 
 * @param {string} type - 'quick' or 'full'
 * @returns {string} A generic approved fallback
 */
function getGenericFallback(type = 'quick') {
    const fallbacks = GENERIC_FALLBACKS[type] || GENERIC_FALLBACKS.quick;
    return fallbacks[Math.floor(Math.random() * fallbacks.length)];
}

/**
 * Check if a reply contains {name} placeholder
 * 
 * @param {string|string[]} reply - Reply text or array
 * @returns {boolean} True if contains {name}
 */
function containsNamePlaceholder(reply) {
    if (Array.isArray(reply)) {
        return reply.some(r => containsNamePlaceholder(r));
    }
    if (typeof reply === 'object' && reply.text) {
        return containsNamePlaceholder(reply.text);
    }
    if (typeof reply !== 'string') return false;
    return /\{name\}/i.test(reply);
}

module.exports = {
    sanitizeNoNameReply,
    sanitizeNoNameReplies,
    getGenericFallback,
    containsNamePlaceholder,
    
    // Export for testing
    GENERIC_FALLBACKS,
    MIN_VALID_LENGTH,
    JUNK_PATTERNS
};
