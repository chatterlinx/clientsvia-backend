/**
 * ============================================================================
 * FRONTLINE INTEL ENGINE - BRAIN 1
 * ============================================================================
 * 
 * THE MANDATORY GATEWAY FOR ALL CALLER TURNS
 * 
 * Every user utterance flows through this single orchestrator before 
 * anything else makes decisions. This is the receptionist brain.
 * 
 * RESPONSIBILITIES:
 * 1. Preprocessing (FillerStripper + TranscriptNormalizer)
 * 2. Emotion detection
 * 3. Intent classification
 * 4. Entity extraction
 * 5. Decide action: ROUTE_TO_SCENARIO | TRANSFER | BOOK | ASK_FOLLOWUP | END
 * 6. Log trace for LLM-0 Cortex-Intel
 * 
 * OUTPUTS:
 * - decision: What to do next
 * - updatedCallState: Call state with new entities/flags
 * - trace: Full trace document for debugging
 * 
 * CALLED BY: v2AIAgentRuntime.processUserInput()
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const Brain1Trace = require('../../../models/Brain1Trace');

// Preprocessing
const { 
    preprocessing: { FillerStripper, TranscriptNormalizer },
    intelligence: { EmotionDetector }
} = require('../orchestration');

// OpenAI for orchestration decisions
const openaiClient = require('../../../config/openai');

// Company config loader
const { loadCompanyRuntimeConfig } = require('../companyConfigLoader');

// Circuit breaker for resilience
const { orchestratorCircuitBreaker } = require('../../../services/OpenAICircuitBreaker');

/**
 * ============================================================================
 * MAIN ENTRYPOINT: Run a single turn through Brain-1
 * ============================================================================
 * 
 * @param {Object} params
 * @param {string} params.companyId - Company ID
 * @param {string} params.callId - Twilio Call SID
 * @param {string} params.text - Raw STT text from caller
 * @param {Object} params.callState - Current call state
 * @returns {Promise<{updatedCallState: Object, decision: Object, trace: Object}>}
 */
async function runTurn({ companyId, callId, text, callState }) {
    const startTime = Date.now();
    const turn = (callState.turnCount || 0) + 1;
    
    logger.info('[BRAIN-1] 🧠 Processing turn', {
        companyId,
        callId,
        turn,
        textLength: text?.length || 0
    });
    
    // Initialize trace
    const trace = {
        callId,
        companyId,
        turn,
        input: { rawText: text, normalizedText: '', tokensStripped: 0 },
        emotion: { primary: 'NEUTRAL', intensity: 0, signals: [] },
        decision: { action: 'UNKNOWN', triageTag: null, intentTag: null, confidence: 0, reasoning: null },
        entities: { contact: {}, location: {}, problem: {}, scheduling: {} },
        flags: {},
        brain2: { called: false },
        triage: {},
        output: {},
        performance: {},
        timestamps: { received: new Date() }
    };
    
    try {
        // ====================================================================
        // STEP 1: PREPROCESSING
        // ====================================================================
        const preprocessStart = Date.now();
        
        let normalizedText = text || '';
        let tokensStripped = 0;
        
        if (text && text.trim()) {
            // Strip filler words
            const afterFiller = FillerStripper.clean(text);
            tokensStripped = text.split(/\s+/).length - afterFiller.split(/\s+/).length;
            
            // Normalize transcript
            normalizedText = TranscriptNormalizer.normalize(afterFiller);
        }
        
        trace.input.normalizedText = normalizedText;
        trace.input.tokensStripped = tokensStripped;
        trace.performance.preprocessingMs = Date.now() - preprocessStart;
        trace.timestamps.preprocessed = new Date();
        
        logger.debug('[BRAIN-1] Preprocessing complete', {
            callId,
            turn,
            original: text?.substring(0, 50),
            normalized: normalizedText.substring(0, 50),
            tokensStripped
        });
        
        // ====================================================================
        // STEP 2: EMOTION DETECTION
        // ====================================================================
        const emotionStart = Date.now();
        
        const emotion = EmotionDetector.analyze(normalizedText, callState.turnHistory || []);
        
        trace.emotion = {
            primary: emotion?.primary || 'NEUTRAL',
            intensity: emotion?.intensity || 0,
            signals: emotion?.signals?.map(s => s.emotion || s) || []
        };
        trace.performance.emotionMs = Date.now() - emotionStart;
        
        // Set flags from emotion
        trace.flags.isFrustrated = trace.emotion.primary === 'FRUSTRATED' || trace.emotion.primary === 'ANGRY';
        trace.flags.isEmergency = trace.emotion.primary === 'PANICKED' || 
                                  EmotionDetector.isEmergency?.(normalizedText) || false;
        
        logger.debug('[BRAIN-1] Emotion detected', {
            callId,
            turn,
            primary: trace.emotion.primary,
            intensity: trace.emotion.intensity
        });
        
        // ====================================================================
        // STEP 3: LOAD COMPANY CONFIG
        // ====================================================================
        let config = null;
        try {
            config = await loadCompanyRuntimeConfig({ companyId });
        } catch (configError) {
            logger.error('[BRAIN-1] Failed to load company config', {
                callId,
                companyId,
                error: configError.message
            });
        }
        
        // ====================================================================
        // STEP 4: BRAIN-1 DECISION (LLM-Powered)
        // ====================================================================
        const brain1Start = Date.now();
        
        const decision = await makeBrain1Decision({
            normalizedText,
            callState,
            config,
            emotion: trace.emotion,
            companyId,
            callId,
            turn
        });
        
        trace.decision = decision;
        trace.entities = decision.entities || trace.entities;
        trace.flags = { ...trace.flags, ...decision.flags };
        trace.performance.brain1Ms = Date.now() - brain1Start;
        trace.timestamps.brain1Complete = new Date();
        
        logger.info('[BRAIN-1] 🎯 Decision made', {
            callId,
            turn,
            action: decision.action,
            triageTag: decision.triageTag,
            intentTag: decision.intentTag,
            confidence: decision.confidence
        });
        
        // ====================================================================
        // STEP 5: UPDATE CALL STATE
        // ====================================================================
        const updatedCallState = {
            ...callState,
            turnCount: turn,
            lastIntent: decision.intentTag,
            currentIntent: decision.intentTag || callState.currentIntent,
            emotion: trace.emotion,
            extracted: mergeEntities(callState.extracted, decision.entities),
            flags: {
                ...callState.flags,
                ...trace.flags
            },
            turnHistory: [
                ...(callState.turnHistory || []).slice(-9), // Keep last 10
                {
                    turn,
                    speaker: 'caller',
                    text: normalizedText,
                    timestamp: Date.now(),
                    action: decision.action,
                    emotion: trace.emotion.primary
                }
            ]
        };
        
        // ====================================================================
        // STEP 6: LOG TRACE (fire and forget)
        // ====================================================================
        trace.performance.totalMs = Date.now() - startTime;
        
        Brain1Trace.logTurn(trace).catch(err => {
            logger.error('[BRAIN-1] Failed to log trace (non-fatal)', {
                callId,
                turn,
                error: err.message
            });
        });
        
        logger.info('[BRAIN-1] ✅ Turn complete', {
            callId,
            turn,
            action: decision.action,
            totalMs: trace.performance.totalMs
        });
        
        return {
            updatedCallState,
            decision,
            trace
        };
        
    } catch (error) {
        logger.error('[BRAIN-1] ❌ Fatal error', {
            callId,
            turn,
            error: error.message,
            stack: error.stack
        });
        
        // Emergency fallback decision
        trace.decision = {
            action: 'ASK_FOLLOWUP',
            triageTag: null,
            intentTag: 'error_recovery',
            confidence: 0,
            reasoning: `Brain-1 error: ${error.message}`
        };
        trace.output.spokenText = "I'm here to help. Could you please tell me more about what you need?";
        trace.performance.totalMs = Date.now() - startTime;
        
        // Still log the trace
        Brain1Trace.logTurn(trace).catch(() => {});
        
        return {
            updatedCallState: {
                ...callState,
                turnCount: turn
            },
            decision: trace.decision,
            trace
        };
    }
}

/**
 * ============================================================================
 * BRAIN-1 DECISION ENGINE
 * ============================================================================
 * Uses LLM to determine action, intent, and extract entities
 */
async function makeBrain1Decision({ normalizedText, callState, config, emotion, companyId, callId, turn }) {
    
    // Check for obvious cases first (no LLM needed)
    const quickDecision = checkQuickDecisions(normalizedText, callState, emotion);
    if (quickDecision) {
        return quickDecision;
    }
    
    // Build LLM prompt
    const prompt = buildBrain1Prompt({ normalizedText, callState, config, emotion });
    
    // Call LLM with circuit breaker
    const fallbackDecision = () => ({
        action: 'ASK_FOLLOWUP',
        triageTag: null,
        intentTag: 'unknown',
        confidence: 0.3,
        reasoning: 'LLM fallback - circuit breaker or timeout',
        entities: {},
        flags: { needsKnowledgeSearch: true }
    });
    
    try {
        const llmResult = await orchestratorCircuitBreaker.execute(
            async () => callBrain1LLM(prompt, { companyId, callId, turn }),
            fallbackDecision,
            { companyId, callId }
        );
        
        return llmResult;
        
    } catch (error) {
        logger.error('[BRAIN-1] LLM decision failed', {
            callId,
            turn,
            error: error.message
        });
        return fallbackDecision();
    }
}

/**
 * Check for obvious cases that don't need LLM
 */
function checkQuickDecisions(text, callState, emotion) {
    const lowerText = text.toLowerCase();
    
    // Emergency detection
    const emergencyPatterns = [
        'gas leak', 'smell gas', 'carbon monoxide', 'fire', 'flooding',
        'sparks', 'smoke', 'emergency', 'help now', 'immediate'
    ];
    
    if (emergencyPatterns.some(p => lowerText.includes(p))) {
        return {
            action: 'TRANSFER',
            triageTag: 'EMERGENCY',
            intentTag: 'emergency',
            confidence: 0.95,
            reasoning: 'Emergency keyword detected',
            entities: {},
            flags: { isEmergency: true, wantsHuman: true }
        };
    }
    
    // Wrong number / spam detection
    const wrongNumberPatterns = ['pizza', 'wrong number', 'who is this', 'what company'];
    const spamPatterns = ['press 1', 'warranty', 'social security', 'irs', 'lawsuit'];
    
    if (wrongNumberPatterns.some(p => lowerText.includes(p))) {
        return {
            action: 'END',
            triageTag: 'WRONG_NUMBER',
            intentTag: 'wrong_number',
            confidence: 0.9,
            reasoning: 'Wrong number pattern detected',
            entities: {},
            flags: { isWrongNumber: true }
        };
    }
    
    if (spamPatterns.some(p => lowerText.includes(p))) {
        return {
            action: 'END',
            triageTag: 'SPAM',
            intentTag: 'spam',
            confidence: 0.9,
            reasoning: 'Spam pattern detected',
            entities: {},
            flags: { isSpam: true }
        };
    }
    
    // High frustration with human request
    if ((emotion.primary === 'ANGRY' || emotion.primary === 'FRUSTRATED') && 
        (lowerText.includes('manager') || lowerText.includes('human') || lowerText.includes('person'))) {
        return {
            action: 'TRANSFER',
            triageTag: 'ESCALATION_REQUEST',
            intentTag: 'escalation',
            confidence: 0.9,
            reasoning: 'Frustrated caller requesting human',
            entities: {},
            flags: { isFrustrated: true, wantsHuman: true }
        };
    }
    
    return null; // No quick decision, needs LLM
}

/**
 * Build Brain-1 LLM prompt
 */
function buildBrain1Prompt({ normalizedText, callState, config, emotion }) {
    const companyName = config?.name || 'the company';
    const trade = config?.trade || 'service';
    
    const systemPrompt = `You are Brain-1, the frontline AI for ${companyName}, a ${trade} company.

YOUR ROLE: Decide what ACTION to take and extract STRUCTURED DATA. You do NOT generate conversational responses yet.

ACTIONS YOU CAN TAKE:
- ROUTE_TO_SCENARIO: Caller needs factual knowledge (hours, pricing, services, troubleshooting). Route to Brain-2.
- TRANSFER: Caller explicitly wants human OR emergency situation. Escalate immediately.
- BOOK: Caller wants to schedule appointment. Have enough info OR need to collect it.
- ASK_FOLLOWUP: Need more information before deciding. Ask a clarifying question.
- MESSAGE_ONLY: Simple acknowledgment, greeting, or small talk. No routing needed.
- END: Wrong number, spam, or call resolution. Politely close.

CURRENT CALL STATE:
- Turn: ${callState.turnCount || 1}
- Current Intent: ${callState.currentIntent || 'unknown'}
- Emotion: ${emotion.primary} (intensity: ${emotion.intensity})
- Extracted So Far: ${JSON.stringify(callState.extracted || {})}

CALLER SAID: "${normalizedText}"

RESPOND WITH ONLY VALID JSON:
{
  "action": "ROUTE_TO_SCENARIO|TRANSFER|BOOK|ASK_FOLLOWUP|MESSAGE_ONLY|END",
  "triageTag": "SMELL_OF_GAS|NO_COOL|NO_HEAT|MAINTENANCE|PRICING|HOURS|...",
  "intentTag": "emergency|booking|troubleshooting|info|billing|greeting|other",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "entities": {
    "contact": { "name": "...", "phone": "..." },
    "location": { "addressLine1": "...", "city": "...", "state": "...", "zip": "..." },
    "problem": { "summary": "...", "category": "cooling|heating|plumbing|electrical", "urgency": "normal|urgent|emergency" },
    "scheduling": { "preferredDate": "...", "preferredWindow": "morning|afternoon|evening|asap" }
  },
  "flags": {
    "needsKnowledgeSearch": true/false,
    "readyToBook": true/false,
    "wantsHuman": true/false
  }
}`;

    return {
        system: systemPrompt,
        user: `Caller: "${normalizedText}"\n\nDecide the action and extract any entities.`
    };
}

/**
 * Call Brain-1 LLM
 */
async function callBrain1LLM(prompt, metadata) {
    if (!openaiClient) {
        throw new Error('OpenAI client not initialized');
    }
    
    const response = await openaiClient.chat.completions.create({
        model: process.env.LLM_MODEL || 'gpt-4o-mini',
        temperature: 0.2,
        max_tokens: 600,
        messages: [
            { role: 'system', content: prompt.system },
            { role: 'user', content: prompt.user }
        ]
    });
    
    const rawContent = response.choices[0]?.message?.content || '';
    
    // Parse JSON
    try {
        const jsonMatch = rawContent.match(/```json\s*([\s\S]*?)\s*```/) || 
                         rawContent.match(/\{[\s\S]*\}/);
        const jsonString = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : rawContent;
        const decision = JSON.parse(jsonString);
        
        // Validate action
        const validActions = ['ROUTE_TO_SCENARIO', 'TRANSFER', 'BOOK', 'ASK_FOLLOWUP', 'MESSAGE_ONLY', 'END'];
        if (!validActions.includes(decision.action)) {
            decision.action = 'ASK_FOLLOWUP';
        }
        
        return decision;
        
    } catch (parseError) {
        logger.error('[BRAIN-1] Failed to parse LLM response', {
            ...metadata,
            rawContent: rawContent.substring(0, 500)
        });
        throw parseError;
    }
}

/**
 * Merge entities (new values override old)
 */
function mergeEntities(existing = {}, updates = {}) {
    return {
        contact: { ...(existing.contact || {}), ...(updates.contact || {}) },
        location: { ...(existing.location || {}), ...(updates.location || {}) },
        problem: { ...(existing.problem || {}), ...(updates.problem || {}) },
        scheduling: { ...(existing.scheduling || {}), ...(updates.scheduling || {}) }
    };
}

module.exports = {
    runTurn
};

