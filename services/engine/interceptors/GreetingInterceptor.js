/**
 * ════════════════════════════════════════════════════════════════════════════
 * GREETING INTERCEPTOR
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Handles instant responses to simple greetings like "good morning", "hi", etc.
 * Configured via: frontDeskBehavior.conversationStages.greetingRules
 * 
 * Why this exists:
 * - Eliminates LLM latency for simple greetings
 * - Ensures consistent, professional greetings
 * - Configurable per company via UI
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

const FUZZY_PATTERNS = {
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

const FILLER_PREFIXES = /^(yes|yeah|yep|yup|uh|um|uh\s*huh|ok|okay|sure|well|so|right|alright|,|\s)+/i;

/**
 * Check if text is JUST a greeting (not "hi I need help with my AC")
 */
function isShortGreeting(text) {
    const cleaned = text.toLowerCase().replace(FILLER_PREFIXES, '').trim();
    const isShort = cleaned.length < 40;
    const startsWithGreeting = /^(good\s*(morning|afternoon|evening)|hi|hello|hey|howdy|yo|sup|what'?s\s*up|greetings?|morning|afternoon|evening|gm)\b/i.test(cleaned);
    return isShort && startsWithGreeting;
}

/**
 * Try to intercept a greeting and return instant response
 * 
 * @param {string} userText - The user's input
 * @param {Object} company - Company config with greetingRules
 * @param {Object} state - Call state
 * @returns {Object|null} { response, matchedTrigger, matchType } or null if not a greeting
 */
function tryIntercept(userText, company, state) {
    if (!userText) return null;
    
    const userTextLower = userText.toLowerCase().trim();
    
    // Skip if this isn't a short greeting-like message
    if (!isShortGreeting(userText)) {
        return null;
    }
    
    // Skip if we've already greeted (existing session beyond turn 1)
    const hasExistingSession = (state?.turnCount || 0) > 1;
    if (hasExistingSession) {
        return null;
    }
    
    // Get greeting rules from company config (Personality tab)
    const greetingRules = company?.aiAgentSettings?.frontDeskBehavior?.conversationStages?.greetingRules || [];
    
    if (greetingRules.length === 0) {
        return null;
    }
    
    // Sort rules by trigger length (longest first) to prioritize specific matches
    const sortedRules = [...greetingRules].sort((a, b) => 
        (b.trigger?.length || 0) - (a.trigger?.length || 0)
    );
    
    for (const rule of sortedRules) {
        if (!rule.trigger || !rule.response) continue;
        
        const trigger = rule.trigger.toLowerCase().trim();
        
        if (rule.fuzzy) {
            // Fuzzy matching - use pattern if available, otherwise contains check
            const pattern = FUZZY_PATTERNS[trigger];
            if (pattern && pattern.test(userTextLower)) {
                return {
                    response: rule.response,
                    matchedTrigger: trigger,
                    matchType: 'fuzzy-pattern'
                };
            } else if (userTextLower.includes(trigger)) {
                return {
                    response: rule.response,
                    matchedTrigger: trigger,
                    matchType: 'fuzzy-contains'
                };
            }
        } else {
            // EXACT matching - trigger must appear as whole phrase
            const exactPattern = new RegExp(`\\b${trigger.replace(/\s+/g, '\\s+')}\\b`, 'i');
            if (exactPattern.test(userTextLower)) {
                return {
                    response: rule.response,
                    matchedTrigger: trigger,
                    matchType: 'exact-phrase'
                };
            }
        }
    }
    
    return null;
}

module.exports = {
    tryIntercept,
    isShortGreeting,
    FUZZY_PATTERNS,
    FILLER_PREFIXES
};
