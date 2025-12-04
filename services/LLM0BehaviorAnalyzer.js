/**
 * ============================================================================
 * LLM-0 BEHAVIOR ANALYZER - BEHAVIOR BRAIN ONLY
 * ============================================================================
 * 
 * CRITICAL ARCHITECTURAL RULE:
 * LLM-0 ONLY analyzes caller behavior and mood.
 * It NEVER generates HVAC/business content.
 * It NEVER answers questions about services.
 * 
 * PURPOSE:
 * - Detect caller mood (frustrated, confused, happy, neutral)
 * - Suggest conversation tone (warm, professional, calming)
 * - Provide micro-fillers ("Alright,", "Okay,", "Got it,")
 * - Flag edge cases (isSmallTalk, isConfused, needsRedirect)
 * 
 * ALL BUSINESS CONTENT comes from Brain-2 (3-Tier engine).
 * LLM-0 is the "behavior coach", not the "content brain".
 * 
 * PERFORMANCE TARGET:
 * - 50-150ms typical (fast GPT-mini call)
 * - Runs IN PARALLEL with Triage routing
 * - Ultra-tight prompt, low tokens
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

// Will be wired to OpenAI later
// const openaiClient = require('../config/openai');

/**
 * @typedef {Object} LLM0Behavior
 * @property {Object} personality - Caller personality assessment
 * @property {string} personality.type - 'friendly' | 'business' | 'frustrated' | 'confused' | 'neutral'
 * @property {number} personality.confidence - 0-1
 * @property {Object} mood - Current mood state
 * @property {string} mood.current - 'calm' | 'anxious' | 'angry' | 'happy' | 'confused' | 'neutral'
 * @property {string} mood.trend - 'improving' | 'declining' | 'stable'
 * @property {Object} style - Suggested response style
 * @property {string} style.tone - 'warm' | 'professional' | 'calming' | 'direct'
 * @property {string} style.pace - 'slow' | 'normal' | 'fast'
 * @property {string} style.formality - 'casual' | 'professional' | 'formal'
 * @property {Object} flags - Behavioral flags
 * @property {boolean} flags.isSmallTalk - Caller is making small talk
 * @property {boolean} flags.isConfused - Caller seems confused
 * @property {boolean} flags.needsRedirect - Caller needs to be redirected
 * @property {boolean} flags.isInterrupting - Caller is interrupting
 * @property {string|null} suggestedFiller - Optional micro-filler word
 */

/**
 * Analyze caller behavior and mood
 * 
 * IMPORTANT: This function NEVER returns business content.
 * It only returns behavior metadata for ResponseConstructor.
 * 
 * @param {Object} params
 * @param {Object} params.context - Call context (callId, companyId, turnNumber, callerUtterance)
 * @param {LLM0Behavior|null} params.previousBehavior - Previous turn's behavior (for trend detection)
 * @returns {Promise<LLM0Behavior>}
 */
async function analyzeBehavior({ context, previousBehavior }) {
    const startTime = Date.now();
    
    logger.debug('[LLM-0 BEHAVIOR] Analyzing caller behavior', {
        callId: context?.callId,
        turnNumber: context?.turnNumber,
        utteranceLength: context?.callerUtterance?.length || 0,
        hasPreviousBehavior: !!previousBehavior
    });
    
    // ========================================================================
    // STUB IMPLEMENTATION
    // ========================================================================
    // For now, return a static sensible default.
    // Later, this will call GPT-mini with an ultra-tight prompt.
    // 
    // The stub ensures the contract is stable and ResponseConstructor
    // can be wired without waiting for the full LLM-0 implementation.
    // ========================================================================
    
    const utterance = (context?.callerUtterance || '').toLowerCase();
    
    // Simple rule-based analysis for stub (will be replaced with LLM)
    const behavior = detectBehaviorFromText(utterance, previousBehavior);
    
    const analysisMs = Date.now() - startTime;
    
    logger.info('[LLM-0 BEHAVIOR] ✅ Analysis complete', {
        callId: context?.callId,
        turnNumber: context?.turnNumber,
        mood: behavior.mood.current,
        tone: behavior.style.tone,
        filler: behavior.suggestedFiller,
        analysisMs
    });
    
    return behavior;
}

/**
 * Simple rule-based behavior detection (stub implementation)
 * Will be replaced with GPT-mini call in Phase 3
 * 
 * @param {string} utterance - Caller's utterance (lowercase)
 * @param {LLM0Behavior|null} previousBehavior - Previous behavior
 * @returns {LLM0Behavior}
 */
function detectBehaviorFromText(utterance, previousBehavior) {
    // Default behavior
    let mood = 'neutral';
    let trend = 'stable';
    let tone = 'professional';
    let pace = 'normal';
    let filler = 'Okay,';
    let isSmallTalk = false;
    let isConfused = false;
    let isInterrupting = false;
    
    // ========================================================================
    // FRUSTRATION DETECTION
    // ========================================================================
    const frustrationSignals = [
        'frustrated', 'angry', 'ridiculous', 'terrible', 'awful',
        'waited', 'waiting', 'forever', 'nobody', 'no one',
        'sick of', 'tired of', 'fed up', 'unbelievable', 'unacceptable',
        'what the', 'seriously', 'come on', 'are you kidding'
    ];
    
    if (frustrationSignals.some(signal => utterance.includes(signal))) {
        mood = 'frustrated';
        tone = 'calming';
        pace = 'slow';
        filler = 'I completely understand.';
        trend = previousBehavior?.mood?.current === 'frustrated' ? 'stable' : 'declining';
    }
    
    // ========================================================================
    // CONFUSION DETECTION
    // ========================================================================
    const confusionSignals = [
        'confused', 'don\'t understand', 'what do you mean', 'huh',
        'i\'m not sure', 'not sure what', 'wait what', 'sorry what',
        'can you repeat', 'say that again', 'didn\'t catch'
    ];
    
    if (confusionSignals.some(signal => utterance.includes(signal))) {
        mood = 'confused';
        isConfused = true;
        tone = 'warm';
        pace = 'slow';
        filler = 'Let me clarify.';
    }
    
    // ========================================================================
    // SMALL TALK DETECTION
    // ========================================================================
    const smallTalkSignals = [
        'how are you', 'how\'s it going', 'nice day', 'weather',
        'thank you so much', 'you\'re so nice', 'appreciate it',
        'have a great', 'take care', 'bless you'
    ];
    
    if (smallTalkSignals.some(signal => utterance.includes(signal))) {
        isSmallTalk = true;
        tone = 'warm';
        filler = null; // No filler for small talk, let scenario handle it
    }
    
    // ========================================================================
    // HAPPY/POSITIVE DETECTION
    // ========================================================================
    const happySignals = [
        'thank you', 'thanks', 'appreciate', 'wonderful', 'great',
        'perfect', 'excellent', 'awesome', 'fantastic'
    ];
    
    if (happySignals.some(signal => utterance.includes(signal)) && mood === 'neutral') {
        mood = 'happy';
        tone = 'warm';
        filler = null; // No filler needed for happy callers
    }
    
    // ========================================================================
    // URGENCY DETECTION
    // ========================================================================
    const urgencySignals = [
        'emergency', 'urgent', 'asap', 'right now', 'immediately',
        'gas leak', 'smell gas', 'no heat', 'freezing', 'flooding'
    ];
    
    if (urgencySignals.some(signal => utterance.includes(signal))) {
        mood = 'anxious';
        tone = 'direct';
        pace = 'fast';
        filler = null; // Get to the point for emergencies
    }
    
    // ========================================================================
    // BUILD FINAL BEHAVIOR OBJECT
    // ========================================================================
    return {
        personality: {
            type: mood === 'frustrated' ? 'frustrated' : 
                  mood === 'confused' ? 'confused' : 
                  mood === 'happy' ? 'friendly' : 'neutral',
            confidence: 0.75 // Stub confidence
        },
        mood: {
            current: mood,
            trend: trend
        },
        style: {
            tone: tone,
            pace: pace,
            formality: 'professional'
        },
        flags: {
            isSmallTalk: isSmallTalk,
            isConfused: isConfused,
            needsRedirect: false,
            isInterrupting: isInterrupting
        },
        suggestedFiller: filler
    };
}

/**
 * Get default behavior for fallback scenarios
 * 
 * @returns {LLM0Behavior}
 */
function getDefaultBehavior() {
    return {
        personality: { type: 'neutral', confidence: 1.0 },
        mood: { current: 'neutral', trend: 'stable' },
        style: { tone: 'professional', pace: 'normal', formality: 'professional' },
        flags: {
            isSmallTalk: false,
            isConfused: false,
            needsRedirect: false,
            isInterrupting: false
        },
        suggestedFiller: 'Okay,'
    };
}

module.exports = {
    analyzeBehavior,
    getDefaultBehavior,
    detectBehaviorFromText // Exported for testing
};

