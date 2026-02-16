/**
 * ════════════════════════════════════════════════════════════════════════════
 * CALL REASON EXTRACTOR (S5)
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Extracts the caller's reason/problem from their utterance.
 * This is a simple pattern-based extractor - no LLM needed.
 * 
 * Examples:
 *   "My AC isn't cooling" → "AC isn't cooling"
 *   "The heater is broken" → "heater is broken"
 *   "It's 90 degrees in my house" → "90 degrees in house"
 * 
 * Config: frontDeskBehavior (industry-specific patterns can be added)
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

// Problem indicator patterns - these suggest the caller is describing an issue
const PROBLEM_PATTERNS = [
    // HVAC-specific problems
    /(?:my\s+)?(?:ac|a\.?c\.?|air\s*condition(?:er|ing)?)\s+(?:is\s+)?(?:not\s+)?(\w+ing|\w+ed|broken|down|out)/i,
    /(?:my\s+)?(?:heat(?:er|ing)?|furnace)\s+(?:is\s+)?(?:not\s+)?(\w+ing|\w+ed|broken|down|out)/i,
    /(?:my\s+)?(?:unit|system)\s+(?:is\s+)?(?:not\s+)?(\w+ing|\w+ed|broken|down|out)/i,
    
    // Temperature problems
    /(?:it'?s?\s+)?(\d+)\s*degrees/i,
    /(?:too\s+)?(hot|cold|warm|freezing)/i,
    
    // General service problems
    /(?:not\s+)?(?:working|cooling|heating|running|turning\s+on)/i,
    /(?:is\s+)?(?:broken|leaking|making\s+noise|frozen)/i,
    
    // Water/plumbing (if applicable)
    /(?:no\s+)?(?:hot\s+)?water/i,
    /(?:leak(?:ing)?|flood(?:ing)?|clog(?:ged)?|drain)/i
];

/**
 * Extract the call reason from user input
 * Returns a short summary of the problem, or null if no problem detected
 * 
 * @param {string} text - User's utterance
 * @returns {string|null} Short problem summary or null
 */
function extract(text) {
    if (!text || text.length < 10) return null;
    
    const textLower = text.toLowerCase();
    
    // Skip if this is just a greeting or confirmation
    if (/^(yes|no|yeah|yep|nope|ok|okay|sure|hi|hello|good\s+(morning|afternoon|evening))[\s.,!?]*$/i.test(text.trim())) {
        return null;
    }
    
    // Look for problem indicators
    let hasProblem = false;
    for (const pattern of PROBLEM_PATTERNS) {
        if (pattern.test(textLower)) {
            hasProblem = true;
            break;
        }
    }
    
    if (!hasProblem) return null;
    
    // Extract the problem statement
    let reason = null;
    
    // Pattern 1: "my [thing] is [problem]"
    const myThingPattern = /(?:my\s+)?(\w+(?:\s+\w+)?)\s+(?:is\s+)?(?:not\s+)?(working|cooling|heating|running|broken|down|out|leaking|frozen|making\s+noise)/i;
    const myThingMatch = text.match(myThingPattern);
    if (myThingMatch) {
        const thing = myThingMatch[1].replace(/^(the|my|our)\s+/i, '');
        const problem = myThingMatch[2];
        reason = `${thing} ${myThingMatch[0].includes('not') ? 'not ' : ''}${problem}`;
    }
    
    // Pattern 2: Temperature mention
    if (!reason) {
        const tempMatch = text.match(/(?:it'?s?\s+)?(\d+)\s*degrees/i);
        if (tempMatch) {
            reason = `${tempMatch[1]} degrees`;
            if (/hot|warm/i.test(text)) reason += ' (too hot)';
            if (/cold|freezing/i.test(text)) reason += ' (too cold)';
        }
    }
    
    // Pattern 3: Just use the first problem-related phrase
    if (!reason) {
        const problemPhrases = text.match(/(?:not\s+)?(?:working|cooling|heating|broken|leaking|down|out|frozen)/gi);
        if (problemPhrases && problemPhrases.length > 0) {
            reason = problemPhrases[0];
        }
    }
    
    // Fallback: If we detected a problem but couldn't extract specifics,
    // use a truncated version of the input
    if (!reason && hasProblem) {
        const problemStart = text.search(/(?:my\s+)?(?:ac|heat|unit|system|it'?s)/i);
        if (problemStart >= 0) {
            reason = text.substring(problemStart, problemStart + 60).replace(/[.,!?]+$/, '').trim();
        }
    }
    
    return reason ? reason.trim() : null;
}

module.exports = {
    extract,
    PROBLEM_PATTERNS
};
