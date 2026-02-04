/**
 * ============================================================================
 * DIRECT BOOKING INTENT DETECTOR
 * ============================================================================
 * 
 * Detects when a caller DIRECTLY requests booking without needing to be asked.
 * 
 * EXAMPLES OF DIRECT BOOKING INTENT:
 * - "I need to schedule a repair"
 * - "I want to book an appointment"
 * - "Can you schedule someone to come out?"
 * - "My AC broke, can someone come today?"
 * - "I need service at my house"
 * 
 * WHY THIS MATTERS:
 * Without this, the system asks "Would you like me to schedule?" even when
 * the caller already explicitly requested scheduling. This wastes a turn
 * and feels dumb.
 * 
 * WITH THIS:
 * Caller: "I need to schedule a repair"
 * Agent: "Perfect! Let me get your information. May I have your name?"
 * 
 * NOT:
 * Caller: "I need to schedule a repair"  
 * Agent: "I'd be happy to help. Would you like me to schedule an appointment?"
 * Caller: "...yes, that's what I said"
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');

/**
 * Patterns that indicate DIRECT booking intent (no consent question needed)
 */
const DIRECT_BOOKING_PATTERNS = [
    // Explicit scheduling requests
    /\b(need|want|like)\s+to\s+(schedule|book|make|set\s+up)\s+(a|an)?\s*(appointment|service|repair|call|visit)/i,
    /\b(schedule|book|make)\s+(me|us)?\s*(a|an)?\s*(appointment|service|repair|call|visit)/i,
    /\bcan\s+(you|someone|i)\s+(schedule|book|set\s+up|come\s+out)/i,
    
    // Service requests with urgency
    /\b(need|want)\s+(someone|a\s+tech|a\s+technician|help)\s+to\s+(come|fix|repair|look\s+at)/i,
    /\b(can\s+someone|have\s+someone)\s+(come|come\s+out|fix|repair|look\s+at)/i,
    /\bsend\s+(someone|a\s+tech|a\s+technician)\s+(out|over|to)/i,
    
    // Time-specific requests
    /\b(come|get\s+someone|have\s+someone)\s+(out|over)\s+(today|tomorrow|this\s+week|asap)/i,
    /\bavailable\s+(today|tomorrow|this\s+week)\b.*\b(appointment|service|come\s+out)/i,
    
    // V94 FIX: Urgency phrases that indicate booking intent
    // "as soon as possible" / "ASAP" / "right away" / "immediately" / "soonest"
    // These indicate the caller WANTS scheduling, not just preference capture
    /\bas\s+soon\s+as\s+possible\b/i,
    /\basap\b/i,
    /\bright\s+(away|now)\b/i,
    /\bimmediately\b/i,
    /\bsoonest\b/i,
    /\bearliest\s+(available|time|slot|appointment)\b/i,
    /\bfirst\s+available\b/i,
    /\bnext\s+available\b/i,
    /\bget\s+(somebody|someone)\s+(out|here|over)/i,
    /\bsend\s+(somebody|someone)\s+(out|here|over)/i,
    /\bneed\s+(somebody|someone)\s+(out|here|over)/i,
    /\bwant\s+(somebody|someone)\s+(out|here|over)/i,
    
    // V92 FIX: "how soon can you get somebody out here" patterns
    // These are DIRECT booking intent - caller wants to schedule, not just asking
    /\bhow\s+(soon|fast|quickly)\s+can\s+(you|someone|somebody)\s+(come|get|be)\s+(out|over|here)/i,
    /\bcan\s+you\s+get\s+(someone|somebody)\s+(out|over)\s*(here|today|tomorrow)?/i,
    /\bget\s+(someone|somebody)\s+(out|over)\s+(here|to\s+me|to\s+us)/i,
    /\bwhen\s+can\s+(you|someone|somebody)\s+(come|come\s+out|get\s+here|be\s+here)/i,
    
    // Problem + implicit scheduling
    /\b(broken|not\s+working|stopped\s+working|won't\s+work|doesn't\s+work|isn't\s+working).*\b(need|can|help)/i,
    /\b(my|the|our)\s+(ac|air\s+conditioner|heater|furnace|plumbing|drain|toilet|sink|faucet)\s+(is|isn't|broke|broken|not)/i,
    
    // Appointment confirmation
    /\bset\s+up\s+(an?\s+)?appointment\b/i,
    /\bmake\s+an\s+appointment\b/i,
    /\bbook\s+(a|an)?\s*(time|slot|appointment)\b/i,
    
    // Callback/service requests
    /\bhave\s+(them|someone)\s+call\s+(me|us)\s+back\b/i,
    /\bneed\s+(a|an)\s+(callback|call\s+back|technician|service\s+call)\b/i
];

/**
 * Patterns that indicate the caller is NOT making a direct booking request
 * (questions, general inquiries, etc.)
 */
const NON_BOOKING_PATTERNS = [
    /\bhow\s+much\s+(does|do|will|would)/i,       // Pricing questions
    /\bwhat\s+(is|are)\s+(your|the)\s+(hours|price|cost|rate)/i,
    /\bdo\s+you\s+(offer|provide|have|service|work)/i,  // Service inquiries
    /\b(just|only)\s+(have\s+a\s+)?(question|asking|wondering)/i,
    /\bi('m|am)\s+(just|only)\s+(calling|checking|inquiring)/i,
    /\bquote\s+for\b/i,
    /\bestimate\s+for\b/i
];

/**
 * Trade-specific booking phrases (enhance detection)
 */
const TRADE_PATTERNS = {
    hvac: [
        /\b(ac|air\s+conditioner|air\s+conditioning|heater|furnace|hvac)\s+(repair|service|check|tune\s*up)/i,
        /\b(ac|heater)\s+(is|isn't|not)\s+(working|cooling|heating|blowing)/i,
        /\bno\s+(heat|ac|air|cooling)\b/i
    ],
    plumbing: [
        /\b(leak|clogged|backed\s+up|flooding|burst|broken)\s*(pipe|drain|toilet|sink|faucet|water)/i,
        /\b(toilet|sink|drain|pipe|faucet)\s+(is|won't|doesn't|isn't)\s+(flushing|draining|working)/i,
        /\bno\s+(hot\s+)?water\b/i
    ],
    electrical: [
        /\b(outlet|switch|light|breaker|electrical)\s+(not\s+working|broken|tripped)/i,
        /\bno\s+(power|electricity)\b/i,
        /\bsparks?\s+(from|coming)/i
    ],
    appliance: [
        /\b(washer|dryer|dishwasher|refrigerator|fridge|oven|stove)\s+(broken|not\s+working|won't)/i,
        /\bfix\s+(my|the|our)\s+(washer|dryer|dishwasher|refrigerator|fridge)/i
    ]
};

class DirectBookingIntentDetector {
    
    /**
     * ========================================================================
     * DETECT - Check if utterance contains direct booking intent
     * ========================================================================
     * 
     * @param {string} utterance - User's speech input
     * @param {Object} context - Additional context
     * @param {string} context.trade - Company's trade (hvac, plumbing, etc.)
     * @param {Object} context.company - Company document
     * 
     * @returns {Object} Detection result:
     * {
     *     hasDirectIntent: boolean,
     *     confidence: 0.0 - 1.0,
     *     matchedPattern: string,
     *     reason: string
     * }
     */
    static detect(utterance, context = {}) {
        if (!utterance || typeof utterance !== 'string') {
            return { hasDirectIntent: false, confidence: 0, reason: 'empty_input' };
        }
        
        const text = utterance.trim();
        
        // Check for non-booking patterns first (questions, inquiries)
        for (const pattern of NON_BOOKING_PATTERNS) {
            if (pattern.test(text)) {
                logger.debug('[DIRECT BOOKING] Non-booking pattern detected', {
                    pattern: pattern.toString(),
                    text: text.substring(0, 50)
                });
                return { hasDirectIntent: false, confidence: 0, reason: 'non_booking_inquiry' };
            }
        }
        
        // Check trade-specific patterns (higher confidence)
        const trade = (context.trade || context.company?.trade || context.company?.tradeType || '').toLowerCase();
        if (trade && TRADE_PATTERNS[trade]) {
            for (const pattern of TRADE_PATTERNS[trade]) {
                if (pattern.test(text)) {
                    logger.info('[DIRECT BOOKING] Trade-specific intent detected', {
                        trade,
                        pattern: pattern.toString(),
                        text: text.substring(0, 50)
                    });
                    return {
                        hasDirectIntent: true,
                        confidence: 0.95,
                        matchedPattern: pattern.toString(),
                        reason: 'trade_specific_request',
                        trade
                    };
                }
            }
        }
        
        // Check general booking patterns
        for (const pattern of DIRECT_BOOKING_PATTERNS) {
            if (pattern.test(text)) {
                logger.info('[DIRECT BOOKING] Direct intent detected', {
                    pattern: pattern.toString(),
                    text: text.substring(0, 50)
                });
                return {
                    hasDirectIntent: true,
                    confidence: 0.9,
                    matchedPattern: pattern.toString(),
                    reason: 'direct_booking_request'
                };
            }
        }
        
        // Check for implicit booking intent (problem description with service need)
        if (this.hasImplicitBookingIntent(text)) {
            return {
                hasDirectIntent: true,
                confidence: 0.75,
                matchedPattern: 'implicit_intent',
                reason: 'problem_with_service_need'
            };
        }
        
        return { hasDirectIntent: false, confidence: 0, reason: 'no_booking_intent' };
    }
    
    /**
     * ========================================================================
     * HAS IMPLICIT BOOKING INTENT
     * ========================================================================
     * 
     * Detects cases where the caller describes a problem and implies
     * they need service, even without explicit "schedule" language.
     * 
     * Example: "My AC stopped working and it's 100 degrees"
     * → Clearly needs service, even though they didn't say "schedule"
     */
    static hasImplicitBookingIntent(text) {
        const lowerText = text.toLowerCase();
        
        // Must have a problem indicator
        const problemIndicators = [
            /\b(broken|broke|stopped|won't|doesn't|isn't|not)\s+(working|work)/i,
            /\b(leaking|flooding|clogged|backed\s+up|overflowing)/i,
            /\bno\s+(heat|air|power|water|cooling|hot\s+water)/i,
            /\b(emergency|urgent|asap|right\s+away|today|immediately)/i
        ];
        
        const hasProblem = problemIndicators.some(p => p.test(text));
        if (!hasProblem) return false;
        
        // Must have some indication they want help (not just reporting)
        const helpIndicators = [
            /\b(need|help|fix|repair|can|someone|please)\b/i,
            /\bwhat\s+(should|can|do)\s+i\s+do\b/i,
            /\bhow\s+(soon|quickly|fast)\s+can\b/i
        ];
        
        return helpIndicators.some(p => p.test(text));
    }
    
    /**
     * ========================================================================
     * SHOULD SKIP CONSENT QUESTION
     * ========================================================================
     * 
     * Convenience method: Returns true if we should skip asking
     * "Would you like to schedule?" and go directly to booking.
     */
    static shouldSkipConsentQuestion(utterance, context = {}) {
        const result = this.detect(utterance, context);
        return result.hasDirectIntent && result.confidence >= 0.75;
    }
}

module.exports = DirectBookingIntentDetector;
module.exports.DIRECT_BOOKING_PATTERNS = DIRECT_BOOKING_PATTERNS;
module.exports.TRADE_PATTERNS = TRADE_PATTERNS;
