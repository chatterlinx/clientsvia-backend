/**
 * ═══════════════════════════════════════════════════════════════════════════
 * PLATFORM DEFAULT TRIGGERS - V116
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Industry-agnostic detection trigger defaults that work across all trades.
 * These are used as fallbacks when company config has empty arrays.
 * 
 * USAGE PATTERN:
 * const triggers = companyTriggers.length > 0 
 *     ? companyTriggers 
 *     : PLATFORM_DEFAULTS.describingProblem;
 * 
 * ARCHITECTURE NOTE:
 * These defaults come from proven patterns in Agent 2.0 trigger cards and real-world
 * call analysis. They're intentionally generic to work across HVAC, dental,
 * plumbing, legal, medical, and other industries.
 * ☢️ NUKED Feb 22, 2026: ConsentGate.js deleted - Agent 2.0 handles consent via trigger cards
 * 
 * Company-specific triggers can extend (not replace) these via UI config.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

'use strict';

const PLATFORM_DEFAULTS = {
    /**
     * describingProblem - Phrases indicating caller is describing a service issue
     * 
     * Triggers: Activate scenario matching, populate call_reason_detail
     * 
     * Generic patterns that work across trades:
     * - "not working" (universal)
     * - "broken" (universal)
     * - "problem is" (universal)
     * 
     * Trade-agnostic symptom indicators:
     * - Temperature issues (HVAC, appliances)
     * - Operational failures (any equipment)
     * - Sensory symptoms (smell, sound, visual)
     */
    describingProblem: [
        // Operational failures (universal)
        'not working',
        'not cool',
        'not cooling',
        'not heating',
        'not heat',
        'broken',
        'stopped',
        'stopped working',
        'won\'t turn',
        'won\'t turn on',
        'won\'t start',
        'doesn\'t work',
        'isn\'t working',
        
        // Problem indicators
        'problem is',
        'issue is',
        'trouble with',
        'having trouble',
        'having issues',
        'issue with',
        
        // System failures
        'no power',
        'no air',
        'no heat',
        'no cold',
        'no water',
        
        // Sensory symptoms
        'leaking',
        'leak',
        'drip',
        'dripping',
        'making noise',
        'making sound',
        'loud noise',
        'strange sound',
        'smell',
        'burning smell',
        'odor',
        
        // Temperature issues
        'too hot',
        'too cold',
        'not cold enough',
        'not hot enough',
        'blowing hot',
        'blowing warm',
        'froze',
        'frozen',
        'iced up',
        
        // Physical damage
        'cracked',
        'dented',
        'damaged',
        'fell off'
    ],
    
    /**
     * trustConcern - Caller questions if AI can actually help
     * 
     * Triggers: Activate empathy mode, add reassurance layer
     * 
     * Common patterns:
     * - "Are you AI" / "Real person" questions
     * - Competence questions ("can you actually fix")
     * - Authority questions ("who am I talking to")
     */
    trustConcern: [
        // AI identity questions
        'are you ai',
        'are you a robot',
        'are you real',
        'real person',
        'actual person',
        'who am i talking to',
        'what are you',
        
        // Competence questions
        'can you actually',
        'can you really',
        'are you able',
        'qualified',
        'certified',
        'licensed',
        'know what you\'re doing',
        'sure you can',
        'you guys any good',
        
        // Capability questions
        'can you do',
        'can you handle',
        'can you fix',
        'able to fix',
        'able to help',
        'this going to work',
        'will this work'
    ],
    
    /**
     * callerFeelsIgnored - Caller explicitly says AI isn't listening
     * 
     * Triggers: Add acknowledgment, repeat back what they said
     * 
     * Frustration indicators:
     * - "Not listening" accusations
     * - "Didn't hear" complaints
     * - Repetition requests
     */
    callerFeelsIgnored: [
        // Not listening
        'you\'re not listening',
        'not listening',
        'you\'re ignoring',
        'ignoring me',
        'didn\'t listen',
        'won\'t listen',
        
        // Didn't hear
        'you didn\'t hear',
        'didn\'t hear me',
        'you missed',
        'missed what i said',
        'you don\'t get it',
        'don\'t understand',
        
        // Repetition
        'that\'s not what i said',
        'i already told you',
        'i just said',
        'i said',
        'are you listening',
        'hello',
        'hello?',
        'did you hear me',
        'are you there',
        
        // Frustration
        'pay attention',
        'focus',
        'listen to me'
    ],
    
    /**
     * refusedSlot - Caller refuses to provide information
     * 
     * Triggers: Graceful skip (don't loop), mark slot as optional
     * 
     * Refusal patterns:
     * - Direct refusal ("don't want to")
     * - Privacy concerns ("why do you need")
     * - Inability ("don't have it", "forgot")
     */
    refusedSlot: [
        // Direct refusal
        'don\'t want to',
        'i don\'t want to',
        'not going to',
        'not gonna',
        'won\'t give',
        'won\'t share',
        'don\'t want to give',
        'don\'t want to share',
        
        // Privacy/comfort
        'not comfortable',
        'rather not',
        'prefer not to',
        'why do you need',
        'why you need',
        'do you need that',
        'is that necessary',
        
        // Inability
        'don\'t have it',
        'don\'t know',
        'forgot',
        'can\'t remember',
        'not sure',
        'don\'t remember',
        
        // Defer
        'later',
        'give it later',
        'tell you later',
        'skip that'
    ],
    
    /**
     * wantsBooking - Explicit booking intent
     * 
     * Triggers: Activate booking lane, may bypass consent
     * ☢️ NUKED Feb 22, 2026: ConsentGate deleted - Agent 2.0 handles via trigger cards
     */
    wantsBooking: [
        'schedule',
        'book',
        'appointment',
        'send someone',
        'send somebody',
        'get someone out',
        'come out',
        'need service',
        'asap',
        'emergency',
        'urgent',
        'right away',
        'fix it'
    ],
    
    /**
     * directIntentPatterns - Strong explicit intent (bypasses consent)
     * 
     * Triggers: Bypass consent gate, go straight to booking
     * 
     * Note: These are regex patterns, not strings.
     * ☢️ NUKED Feb 22, 2026: ConsentGate deleted - patterns moved to Agent 2.0 trigger cards
     */
    directIntentPatterns: [
        // Documented for reference only
        'i want to schedule',
        'i need to schedule',
        'can you schedule',
        'book an appointment',
        'please schedule'
    ]
};

/**
 * Merge company triggers with platform defaults.
 * Company triggers EXTEND (not replace) platform defaults.
 * 
 * @param {Array} companyTriggers - Company-configured triggers
 * @param {String} triggerType - Type of trigger (key in PLATFORM_DEFAULTS)
 * @returns {Array} - Merged triggers (company + platform)
 */
function mergeTriggers(companyTriggers, triggerType) {
    const platformDefaults = PLATFORM_DEFAULTS[triggerType] || [];
    const companyArray = Array.isArray(companyTriggers) ? companyTriggers : [];
    
    // Company triggers extend platform defaults (no duplicates)
    const merged = [...new Set([...platformDefaults, ...companyArray])];
    
    return merged;
}

/**
 * Get triggers with fallback to platform defaults.
 * 
 * @param {Object} companyConfig - Company's detectionTriggers config
 * @param {String} triggerType - Type of trigger
 * @param {Boolean} mergeWithDefaults - If true, merge. If false, use company only (with fallback)
 * @returns {Array} - Triggers to use
 */
function getTriggers(companyConfig, triggerType, mergeWithDefaults = false) {
    const companyTriggers = companyConfig?.[triggerType];
    
    if (mergeWithDefaults) {
        // Company triggers EXTEND platform defaults
        return mergeTriggers(companyTriggers, triggerType);
    } else {
        // Company triggers REPLACE platform defaults (with fallback if empty)
        return Array.isArray(companyTriggers) && companyTriggers.length > 0
            ? companyTriggers
            : PLATFORM_DEFAULTS[triggerType] || [];
    }
}

module.exports = {
    PLATFORM_DEFAULTS,
    mergeTriggers,
    getTriggers
};
