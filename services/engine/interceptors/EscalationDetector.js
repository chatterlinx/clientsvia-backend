/**
 * ════════════════════════════════════════════════════════════════════════════
 * ESCALATION DETECTOR (S2.5)
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * Detects when caller wants human assistance and should bypass all AI flows.
 * This has HIGHEST PRIORITY - runs before greeting, discovery, booking.
 * 
 * Config: frontDeskBehavior.escalation.triggerPhrases
 * 
 * Examples:
 *   "I want to speak to a manager" → ESCALATE
 *   "Can I talk to a real person" → ESCALATE
 *   "Transfer me to someone" → ESCALATE
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

const DEFAULT_TRIGGERS = [
    'manager', 'supervisor', 'real person', 'human', 
    'someone else', 'speak to a person', 'talk to someone',
    'talk to a human', 'speak to a human', 'transfer me',
    'connect me', 'actual person'
];

/**
 * Check if input contains escalation intent
 * 
 * @param {string} inputText - User's utterance
 * @param {Object} config - Company escalation config
 * @returns {Object} { triggered, matchedTrigger, message, transferNumber }
 */
function detect(inputText, config = {}) {
    const enabled = config.enabled !== false; // Default enabled
    const triggers = Array.isArray(config.triggerPhrases) && config.triggerPhrases.length > 0
        ? config.triggerPhrases
        : DEFAULT_TRIGGERS;
    const escalationMessage = config.escalationMessage || 
        "I understand you'd like to speak with someone. Let me transfer you right away.";
    const transferNumber = config.transferNumber || null;
    
    if (!enabled || !inputText) {
        return { triggered: false, matchedTrigger: null };
    }
    
    const inputLower = inputText.toLowerCase().trim();
    
    for (const trigger of triggers) {
        const triggerLower = trigger.toLowerCase().trim();
        if (inputLower.includes(triggerLower)) {
            return {
                triggered: true,
                matchedTrigger: trigger,
                message: escalationMessage,
                transferNumber
            };
        }
    }
    
    return { triggered: false, matchedTrigger: null };
}

module.exports = {
    detect,
    DEFAULT_TRIGGERS
};
