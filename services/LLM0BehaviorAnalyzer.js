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
const openaiClient = require('../config/openai');

// Feature flag: Use LLM for behavior analysis (can be toggled)
const USE_LLM_BEHAVIOR = process.env.LLM0_BEHAVIOR_ENABLED !== 'false';

// Ultra-tight prompt for behavior analysis - optimized for speed
const BEHAVIOR_SYSTEM_PROMPT = `You are a behavior analyzer for a phone receptionist. Analyze the caller's utterance and return ONLY a JSON object.

RULES:
- NEVER answer questions about services, pricing, or scheduling
- ONLY analyze mood, tone, and suggest response style
- Keep response under 100 tokens
- Return valid JSON only

OUTPUT FORMAT:
{
  "mood": "neutral|frustrated|confused|happy|anxious",
  "tone": "professional|warm|calming|direct",
  "pace": "normal|slow|fast",
  "flags": {
    "isSmallTalk": false,
    "isConfused": false,
    "isUrgent": false
  },
  "filler": "Okay,|Alright,|I understand.|null"
}`;

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
    const utterance = (context?.callerUtterance || '').trim();
    
    logger.debug('[LLM-0 BEHAVIOR] Analyzing caller behavior', {
        callId: context?.callId,
        turnNumber: context?.turnNumber,
        utteranceLength: utterance.length,
        hasPreviousBehavior: !!previousBehavior,
        useLLM: USE_LLM_BEHAVIOR
    });
    
    // ========================================================================
    // HYBRID APPROACH: Rules first, LLM for edge cases
    // ========================================================================
    // 1. Try fast rule-based detection first (0ms)
    // 2. If rules detect clear signal, use that (skip LLM)
    // 3. If ambiguous, call GPT-mini for nuanced analysis (50-150ms)
    // ========================================================================
    
    const ruleBehavior = detectBehaviorFromText(utterance.toLowerCase(), previousBehavior);
    
    // Check if rules detected a clear signal (non-neutral mood or flags set)
    const rulesFoundSignal = ruleBehavior.mood.current !== 'neutral' ||
                             ruleBehavior.flags.isSmallTalk ||
                             ruleBehavior.flags.isConfused;
    
    let behavior;
    let source = 'rules';
    
    if (rulesFoundSignal || !USE_LLM_BEHAVIOR) {
        // Rules found a signal OR LLM disabled - use rule-based result
        behavior = ruleBehavior;
        source = rulesFoundSignal ? 'rules' : 'rules-fallback';
    } else {
        // Ambiguous - call LLM for nuanced analysis
        try {
            behavior = await callLLMBehaviorAnalysis(utterance, previousBehavior, context);
            source = 'llm';
        } catch (llmError) {
            logger.warn('[LLM-0 BEHAVIOR] LLM call failed, using rules fallback', {
                callId: context?.callId,
                error: llmError.message
            });
            behavior = ruleBehavior;
            source = 'rules-fallback';
        }
    }
    
    const analysisMs = Date.now() - startTime;
    
    logger.info('[LLM-0 BEHAVIOR] ✅ Analysis complete', {
        callId: context?.callId,
        turnNumber: context?.turnNumber,
        mood: behavior.mood.current,
        tone: behavior.style.tone,
        filler: behavior.suggestedFiller,
        source,
        analysisMs
    });
    
    return behavior;
}

/**
 * Call GPT-mini for nuanced behavior analysis
 * Ultra-fast, low-token call for edge cases
 * 
 * @param {string} utterance - Caller utterance
 * @param {LLM0Behavior|null} previousBehavior - Previous behavior
 * @param {Object} context - Call context
 * @returns {Promise<LLM0Behavior>}
 */
async function callLLMBehaviorAnalysis(utterance, previousBehavior, context) {
    const startTime = Date.now();
    
    // Build context hint from previous behavior
    let contextHint = '';
    if (previousBehavior) {
        contextHint = `\nPrevious mood: ${previousBehavior.mood?.current || 'neutral'}`;
    }
    
    const userPrompt = `Caller said: "${utterance}"${contextHint}\n\nAnalyze behavior:`;
    
    const response = await openaiClient.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
            { role: 'system', content: BEHAVIOR_SYSTEM_PROMPT },
            { role: 'user', content: userPrompt }
        ],
        max_tokens: 100,
        temperature: 0.1, // Low temp for consistent behavior detection
        response_format: { type: 'json_object' }
    });
    
    const llmMs = Date.now() - startTime;
    
    logger.debug('[LLM-0 BEHAVIOR] LLM response', {
        callId: context?.callId,
        llmMs,
        tokens: response.usage?.total_tokens || 0
    });
    
    // Parse LLM response
    const content = response.choices[0]?.message?.content || '{}';
    const parsed = JSON.parse(content);
    
    // Map LLM response to our standard behavior object
    return {
        personality: {
            type: mapMoodToPersonality(parsed.mood),
            confidence: 0.85
        },
        mood: {
            current: parsed.mood || 'neutral',
            trend: previousBehavior?.mood?.current === parsed.mood ? 'stable' :
                   parsed.mood === 'frustrated' ? 'declining' : 'stable'
        },
        style: {
            tone: parsed.tone || 'professional',
            pace: parsed.pace || 'normal',
            formality: 'professional'
        },
        flags: {
            isSmallTalk: parsed.flags?.isSmallTalk || false,
            isConfused: parsed.flags?.isConfused || false,
            needsRedirect: false,
            isInterrupting: false
        },
        suggestedFiller: parsed.filler === 'null' ? null : (parsed.filler || 'Okay,')
    };
}

/**
 * Map mood to personality type
 */
function mapMoodToPersonality(mood) {
    const moodMap = {
        'frustrated': 'frustrated',
        'confused': 'confused',
        'happy': 'friendly',
        'anxious': 'business',
        'neutral': 'neutral'
    };
    return moodMap[mood] || 'neutral';
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
    detectBehaviorFromText, // Exported for testing
    callLLMBehaviorAnalysis, // Exported for direct LLM calls if needed
    USE_LLM_BEHAVIOR // Exported for diagnostics
};

