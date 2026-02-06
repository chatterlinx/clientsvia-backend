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
 * 
 * V96j EXPANSION: Added more natural language patterns based on real call analysis
 * - "early as possible" (not just "as soon as possible")
 * - "not cooling" / "not heating" without explicit "AC" / "heater" prefix
 * - LLM handoff patterns (when LLM offers booking and caller agrees)
 */
const DIRECT_BOOKING_PATTERNS = [
    // ═══════════════════════════════════════════════════════════════════════════
    // EXPLICIT SCHEDULING REQUESTS
    // ═══════════════════════════════════════════════════════════════════════════
    /\b(need|want|like)\s+to\s+(schedule|book|make|set\s+up)\s+(a|an)?\s*(appointment|service|repair|call|visit)/i,
    /\b(schedule|book|make)\s+(me|us)?\s*(a|an)?\s*(appointment|service|repair|call|visit)/i,
    /\bcan\s+(you|someone|i)\s+(schedule|book|set\s+up|come\s+out)/i,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SERVICE REQUESTS WITH URGENCY
    // ═══════════════════════════════════════════════════════════════════════════
    /\b(need|want)\s+(someone|a\s+tech|a\s+technician|help)\s+to\s+(come|fix|repair|look\s+at)/i,
    /\b(can\s+someone|have\s+someone)\s+(come|come\s+out|fix|repair|look\s+at)/i,
    /\bsend\s+(someone|a\s+tech|a\s+technician)\s+(out|over|to)/i,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TIME-SPECIFIC REQUESTS
    // ═══════════════════════════════════════════════════════════════════════════
    /\b(come|get\s+someone|have\s+someone)\s+(out|over)\s+(today|tomorrow|this\s+week|asap)/i,
    /\bavailable\s+(today|tomorrow|this\s+week)\b.*\b(appointment|service|come\s+out)/i,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V96j EXPANDED: URGENCY PHRASES - More natural language variants
    // ═══════════════════════════════════════════════════════════════════════════
    // Original patterns
    /\bas\s+soon\s+as\s+possible\b/i,
    /\basap\b/i,
    /\bright\s+(away|now)\b/i,
    /\bimmediately\b/i,
    /\bsoonest\b/i,
    /\bearliest\s+(available|time|slot|appointment)\b/i,
    /\bfirst\s+available\b/i,
    /\bnext\s+available\b/i,
    
    // V96j NEW: Shortened/natural urgency variants
    /\b(early|earlier)\s+as\s+possible\b/i,               // "early as possible" (not just "earliest")
    /\bearly\s+as\s+you\s+(can|could)\b/i,                // "early as you can"
    /\bsoon\s+as\s+(you\s+)?can\b/i,                      // "soon as you can" or "soon as can"
    /\b(as\s+)?(fast|quick|soon|early)\s+as\s+possible\b/i, // "fast as possible", "quick as possible"
    /\bwhenever\s+(you\s+)?can\b/i,                       // "whenever you can"
    /\bwhenever\s+(is\s+)?(earliest|soonest)\b/i,         // "whenever is earliest"
    /\bwhat('s|s)?\s+(the\s+)?(earliest|soonest)\b/i,     // "what's the earliest"
    
    // ═══════════════════════════════════════════════════════════════════════════
    // SEND SOMEONE / GET SOMEONE
    // ═══════════════════════════════════════════════════════════════════════════
    /\bget\s+(somebody|someone)\s+(out|here|over)/i,
    /\bsend\s+(somebody|someone)\s+(out|here|over)/i,
    /\bneed\s+(somebody|someone)\s+(out|here|over)/i,
    /\bwant\s+(somebody|someone)\s+(out|here|over)/i,
    
    // V92 FIX: "how soon can you get somebody out here" patterns
    /\bhow\s+(soon|fast|quickly)\s+can\s+(you|someone|somebody)\s+(come|get|be)\s+(out|over|here)/i,
    /\bcan\s+you\s+get\s+(someone|somebody)\s+(out|over)\s*(here|today|tomorrow)?/i,
    /\bget\s+(someone|somebody)\s+(out|over)\s+(here|to\s+me|to\s+us)/i,
    /\bwhen\s+can\s+(you|someone|somebody)\s+(come|come\s+out|get\s+here|be\s+here)/i,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PROBLEM + IMPLICIT SCHEDULING
    // ═══════════════════════════════════════════════════════════════════════════
    /\b(broken|not\s+working|stopped\s+working|won't\s+work|doesn't\s+work|isn't\s+working).*\b(need|can|help)/i,
    /\b(my|the|our)\s+(ac|air\s+conditioner|heater|furnace|plumbing|drain|toilet|sink|faucet)\s+(is|isn't|broke|broken|not)/i,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V96j NEW: PROBLEM DESCRIPTIONS WITHOUT EXPLICIT APPLIANCE PREFIX
    // These catch "it's not cooling" without requiring "AC not cooling"
    // ═══════════════════════════════════════════════════════════════════════════
    /\b(it's|its|it\s+is)\s+not\s+(cooling|heating|working|blowing)/i,    // "it's not cooling"
    /\bnot\s+(cooling|heating)\s+(well|properly|right|anymore)/i,          // "not cooling well"
    /\b(stopped|quit)\s+(cooling|heating|working)/i,                        // "stopped cooling"
    /\b(won't|wont)\s+(cool|heat|turn\s+on|start)/i,                       // "won't cool"
    /\b(isn't|isnt)\s+(cooling|heating|working)/i,                          // "isn't cooling"
    
    // ═══════════════════════════════════════════════════════════════════════════
    // APPOINTMENT CONFIRMATION
    // ═══════════════════════════════════════════════════════════════════════════
    /\bset\s+up\s+(an?\s+)?appointment\b/i,
    /\bmake\s+an\s+appointment\b/i,
    /\bbook\s+(a|an)?\s*(time|slot|appointment)\b/i,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // CALLBACK/SERVICE REQUESTS
    // ═══════════════════════════════════════════════════════════════════════════
    /\bhave\s+(them|someone)\s+call\s+(me|us)\s+back\b/i,
    /\bneed\s+(a|an)\s+(callback|call\s+back|technician|service\s+call)\b/i,
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V96j NEW: LLM HANDOFF PATTERNS
    // When the LLM offers to schedule and the caller accepts
    // ═══════════════════════════════════════════════════════════════════════════
    /\b(yes|yeah|yep|sure|okay|ok|please)\s+(schedule|book|set\s+up|do\s+that)/i,  // "yes schedule that"
    /\bthat\s+(would\s+be|works|sounds)\s+(great|good|perfect)/i,                    // "that would be great"
    /\blet's\s+(do\s+it|do\s+that|schedule|book)/i,                                   // "let's do it"
    /\bgo\s+ahead\s+(and\s+)?(schedule|book)/i,                                       // "go ahead and schedule"
    /\b(sounds|that\s+sounds)\s+(good|great|perfect)\b/i                             // "sounds good"
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
 * 
 * V96j EXPANSION: Added patterns that don't require explicit appliance names
 * - "not cooling" / "not heating" (without "AC" or "heater" prefix)
 * - "thermostat blank/dead" patterns
 * - Temperature problem descriptions
 */
const TRADE_PATTERNS = {
    hvac: [
        // Explicit appliance + action
        /\b(ac|air\s+conditioner|air\s+conditioning|heater|furnace|hvac)\s+(repair|service|check|tune\s*up)/i,
        /\b(ac|heater)\s+(is|isn't|not)\s+(working|cooling|heating|blowing)/i,
        /\bno\s+(heat|ac|air|cooling)\b/i,
        
        // V96j NEW: Implicit HVAC problems (no explicit appliance name)
        /\b(not|isn't|isnt)\s+(cooling|heating)\b/i,                              // "it's not cooling"
        /\b(stopped|quit)\s+(cooling|heating)\b/i,                                 // "stopped cooling"
        /\b(won't|wont)\s+(cool|heat|blow)\b/i,                                   // "won't cool"
        /\b(hot|cold)\s+(in|inside)\s+(here|the\s+house|my\s+house)/i,            // "it's hot in here"
        /\b(house|home)\s+(is|feels)\s+(hot|cold|warm|freezing)/i,                // "house is hot"
        /\btemperature\s+(is|won't|not)\s+(right|changing|going)/i,               // "temperature won't change"
        
        // V96j NEW: Thermostat issues (often indicates HVAC problem)
        /\b(thermostat)\s+(is|is\s+now|went)?\s*(blank|dead|off|not\s+working)/i, // "thermostat is blank"
        /\b(thermostat)\s+(screen)?\s*(blank|dead|off)\b/i,                       // "thermostat blank"
        /\b(blank|dead)\s+(thermostat|screen)\b/i,                                // "blank thermostat"
        
        // V96j NEW: System descriptions
        /\b(system|unit)\s+(is|isn't|not)\s+(cooling|heating|working|running)/i,  // "system not cooling"
        /\b(system|unit)\s+(stopped|quit|won't)/i                                  // "unit stopped"
    ],
    plumbing: [
        /\b(leak|clogged|backed\s+up|flooding|burst|broken)\s*(pipe|drain|toilet|sink|faucet|water)/i,
        /\b(toilet|sink|drain|pipe|faucet)\s+(is|won't|doesn't|isn't)\s+(flushing|draining|working)/i,
        /\bno\s+(hot\s+)?water\b/i,
        
        // V96j NEW: Implicit plumbing problems
        /\b(water)\s+(everywhere|flooding|leaking|dripping)\b/i,
        /\b(flooding|backed\s+up|overflow)/i
    ],
    electrical: [
        /\b(outlet|switch|light|breaker|electrical)\s+(not\s+working|broken|tripped)/i,
        /\bno\s+(power|electricity)\b/i,
        /\bsparks?\s+(from|coming)/i,
        
        // V96j NEW: Implicit electrical problems
        /\b(lights)\s+(flickering|flicker|won't\s+turn)/i,
        /\b(breaker)\s+(keeps\s+tripping|tripped|won't\s+reset)/i
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
     * V96j ENHANCEMENT: Now reads patterns from company config if provided
     * via BookingConfigResolver. Configured patterns have higher priority
     * than hardcoded defaults.
     * 
     * @param {string} utterance - User's speech input
     * @param {Object} context - Additional context
     * @param {string} context.trade - Company's trade (hvac, plumbing, etc.)
     * @param {Object} context.company - Company document
     * @param {Object} context.awReader - Optional AWConfigReader for traced config reads
     * @param {Object} context.bookingConfigResolver - Optional BookingConfigResolver
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
        
        // ═══════════════════════════════════════════════════════════════════════
        // V96j: CHECK COMPANY-CONFIGURED PATTERNS FIRST (highest priority)
        // ═══════════════════════════════════════════════════════════════════════
        // If company has configured directIntentPatterns or wantsBooking triggers,
        // check those first. This ensures UI config takes priority over defaults.
        // ═══════════════════════════════════════════════════════════════════════
        const configuredPatterns = this._getConfiguredPatterns(context);
        
        // V96k: Trace event for debugging pattern reads
        let BlackBoxLogger;
        try {
            BlackBoxLogger = require('../../BlackBoxLogger');
        } catch (e) {
            // BlackBoxLogger not available - skip tracing
        }
        if (BlackBoxLogger?.emit) {
            BlackBoxLogger.emit('DIRECT_INTENT_PATTERNS_READ', {
                patternCount: configuredPatterns?.length || 0,
                patterns: configuredPatterns?.slice(0, 5) || [],  // First 5 for brevity
                hasAwReader: !!context.awReader,
                hasCompany: !!context.company,
                source: context.awReader ? 'awReader' : (context.company ? 'company_fallback' : 'none'),
                inputText: text?.substring(0, 50)
            });
        }
        
        if (configuredPatterns && configuredPatterns.length > 0) {
            for (const patternStr of configuredPatterns) {
                try {
                    // Support both regex strings and plain text patterns
                    const pattern = patternStr.startsWith('/') 
                        ? new RegExp(patternStr.slice(1, patternStr.lastIndexOf('/')), patternStr.slice(patternStr.lastIndexOf('/') + 1) || 'i')
                        : new RegExp(`\\b${patternStr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');
                    
                    if (pattern.test(text)) {
                        logger.info('[DIRECT BOOKING] V96j: Config-based intent detected', {
                            pattern: patternStr,
                            text: text.substring(0, 50),
                            source: 'company_config'
                        });
                        return {
                            hasDirectIntent: true,
                            confidence: 0.95,  // High confidence for configured patterns
                            matchedPattern: patternStr,
                            reason: 'configured_direct_intent_pattern',
                            patternSource: 'company_config'
                        };
                    }
                } catch (e) {
                    logger.warn('[DIRECT BOOKING] Invalid pattern in config', { pattern: patternStr, error: e.message });
                }
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
     * V96j: Get configured intent patterns from company config
     * @private
     */
    static _getConfiguredPatterns(context) {
        const patterns = [];
        let source = 'none';
        
        // Try BookingConfigResolver first (preferred)
        if (context.bookingConfigResolver) {
            try {
                const intentPatterns = context.bookingConfigResolver.getIntentPatterns();
                if (intentPatterns?.configured?.length > 0) {
                    patterns.push(...intentPatterns.configured);
                    source = 'bookingConfigResolver';
                    logger.debug('[DIRECT BOOKING] V96k: Patterns from BookingConfigResolver', { count: intentPatterns.configured.length });
                }
            } catch (e) {
                logger.debug('[DIRECT BOOKING] BookingConfigResolver not available', { error: e.message });
            }
        }
        
        // V108: Try AWConfigReader - ALL patterns from frontDesk.detectionTriggers.* (canonical)
        if (patterns.length === 0 && context.awReader && typeof context.awReader.get === 'function') {
            try {
                const wantsBooking = context.awReader.getArray('frontDesk.detectionTriggers.wantsBooking');
                // V108: Read from CANONICAL path first
                const directPatternsCanonical = context.awReader.getArray('frontDesk.detectionTriggers.directIntentPatterns');
                
                if (wantsBooking?.length > 0) {
                    patterns.push(...wantsBooking);
                    source = 'awReader:wantsBooking';
                }
                
                // V108: Check enforcement level for strict mode
                const enforcementLevel = context.awReader.get('frontDesk.enforcement.level', 'warn');
                const isStrictMode = enforcementLevel === 'strict';
                
                if (directPatternsCanonical?.length > 0) {
                    patterns.push(...directPatternsCanonical);
                    source = 'awReader:directIntentPatterns:canonical';
                } else if (!isStrictMode) {
                    // WARN MODE ONLY: Fall back to legacy path
                    const directPatternsLegacy = context.awReader.getArray('booking.directIntentPatterns');
                    if (directPatternsLegacy?.length > 0) {
                        patterns.push(...directPatternsLegacy);
                        source = 'awReader:directIntentPatterns:legacy';
                        logger.warn('[DIRECT BOOKING] V108: Using legacy booking.directIntentPatterns - migrate to frontDesk.detectionTriggers.directIntentPatterns');
                    }
                }
                
                logger.debug('[DIRECT BOOKING] V108: Patterns from AWConfigReader', { 
                    wantsBookingCount: wantsBooking?.length || 0, 
                    directPatternsCount: directPatternsCanonical?.length || 0,
                    source,
                    isStrictMode
                });
            } catch (e) {
                logger.debug('[DIRECT BOOKING] AWConfigReader patterns not available', { error: e.message });
            }
        }
        
        // V108: Fallback - Direct company config read (uses canonical path)
        if (patterns.length === 0 && context.company) {
            const frontDesk = context.company.aiAgentSettings?.frontDeskBehavior || {};
            const wantsBooking = frontDesk.detectionTriggers?.wantsBooking || [];
            // V108: Canonical path: detectionTriggers.directIntentPatterns
            const directPatterns = frontDesk.detectionTriggers?.directIntentPatterns || [];
            if (wantsBooking?.length > 0) patterns.push(...wantsBooking);
            if (directPatterns?.length > 0) patterns.push(...directPatterns);
            if (patterns.length > 0) {
                source = 'company_fallback:canonical';
                logger.debug('[DIRECT BOOKING] V108: Patterns from company fallback', { 
                    wantsBookingCount: wantsBooking?.length || 0, 
                    directPatternsCount: directPatterns?.length || 0 
                });
            }
        }
        
        // Store source for tracing
        patterns._source = source;
        
        return patterns.filter(Boolean);
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
     * 
     * V96j EXPANSION: More permissive detection for problem + time preference
     * Example: "it's not cooling... early as possible"
     * → Clear booking intent even without explicit "schedule"
     */
    static hasImplicitBookingIntent(text) {
        const lowerText = text.toLowerCase();
        
        // ═══════════════════════════════════════════════════════════════════════
        // V96j EXPANDED: Problem indicators (more natural language)
        // ═══════════════════════════════════════════════════════════════════════
        const problemIndicators = [
            // Original patterns
            /\b(broken|broke|stopped|won't|doesn't|isn't|not)\s+(working|work)/i,
            /\b(leaking|flooding|clogged|backed\s+up|overflowing)/i,
            /\bno\s+(heat|air|power|water|cooling|hot\s+water)/i,
            /\b(emergency|urgent|asap|right\s+away|today|immediately)/i,
            
            // V96j NEW: More natural problem descriptions
            /\bnot\s+(cooling|heating|blowing)\b/i,                    // "it's not cooling"
            /\b(stopped|quit)\s+(cooling|heating|working)\b/i,          // "stopped cooling"
            /\b(won't|wont)\s+(cool|heat|turn\s+on|start)\b/i,         // "won't cool"
            /\b(isn't|isnt)\s+(cooling|heating|working|running)\b/i,    // "isn't cooling"
            /\b(blank|dead)\s+(thermostat|screen)\b/i,                  // "blank thermostat"
            /\b(thermostat).*(blank|dead|off)\b/i,                      // "thermostat is blank"
            /\b(hot|cold|freezing)\s+(in|inside)?\s*(here|house|home)?\b/i  // "it's hot in here"
        ];
        
        const hasProblem = problemIndicators.some(p => p.test(text));
        if (!hasProblem) return false;
        
        // ═══════════════════════════════════════════════════════════════════════
        // V96j EXPANDED: Help/urgency indicators (more permissive)
        // ═══════════════════════════════════════════════════════════════════════
        const helpIndicators = [
            // Original patterns
            /\b(need|help|fix|repair|can|someone|please)\b/i,
            /\bwhat\s+(should|can|do)\s+i\s+do\b/i,
            /\bhow\s+(soon|quickly|fast)\s+can\b/i,
            
            // V96j NEW: Time preference indicators (imply wanting scheduling)
            /\b(early|earliest|soon|soonest|asap|today|tomorrow)\b/i,   // Any time preference
            /\b(as\s+)?(soon|early|fast|quick)\s+as\s+(possible|you\s+can)\b/i,
            /\b(when|what\s+time)\s+can\b/i,                            // "when can someone come"
            /\bavailable\b/i,                                           // "when are you available"
            /\bcome\s+(out|over)\b/i,                                   // "can someone come out"
            /\bget\s+(someone|somebody)\b/i                             // "can you get someone"
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
