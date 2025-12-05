/**
 * ============================================================================
 * LLM-0 ORCHESTRATOR SERVICE
 * ============================================================================
 * 
 * BRAIN 1: FRONTLINE-INTEL / LLM-0
 * 
 * This is the SINGLE entry point for all LLM-0 decisions.
 * Every caller turn flows through here FIRST before hitting Triage or 3-Tier.
 * 
 * ARCHITECTURE:
 *   Caller → LLM0OrchestratorService.decideNextStep() 
 *          → TriageRouter 
 *          → Brain 2 (3-Tier) OR Booking OR Transfer
 * 
 * RESPONSIBILITIES:
 * 1. Preprocess input (FillerStripper, TranscriptNormalizer)
 * 2. Detect emotion (EmotionDetector)
 * 3. Call LLM to decide action
 * 4. Extract intent, entities, flags
 * 5. Return normalized LLM0Decision conforming to contract
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');
const { 
    normalizeDecision, 
    deriveActionFromFlags, 
    createEmptyDecision 
} = require('./LLM0Contracts');

// Preprocessing (from src/services/orchestration/)
const { 
    preprocessing: { FillerStripper, TranscriptNormalizer },
    intelligence: { EmotionDetector }
} = require('../../src/services/orchestration');

// Core orchestration (existing engine)
const { processCallerTurn } = require('../../src/services/orchestrationEngine');

// Circuit breaker for resilience
const { orchestratorCircuitBreaker } = require('../OpenAICircuitBreaker');

class LLM0OrchestratorService {
    
    /**
     * ========================================================================
     * MAIN ENTRY POINT: Decide what to do with this caller turn
     * ========================================================================
     * 
     * This is Brain 1. The receptionist brain.
     * Every turn flows through here before anything else.
     * 
     * @param {import('./LLM0Contracts').LLM0Input} input
     * @returns {Promise<import('./LLM0Contracts').LLM0Decision>}
     */
    async decideNextStep(input) {
        const startTime = Date.now();
        const { companyId, callId, userInput, callState, turnHistory } = input;
        
        logger.info('[LLM-0] 🧠 Brain 1 processing turn', {
            companyId,
            callId,
            userInputLength: userInput?.length || 0,
            turnNumber: turnHistory?.length || 0,
            bookingModeLocked: !!callState?.bookingModeLocked
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🔒 BOOKING HARD LOCK - SKIP BRAIN-1 ENTIRELY
        // ════════════════════════════════════════════════════════════════════════════
        // When bookingModeLocked = true, we should NOT run any intent detection.
        // Just return a dummy decision - LLM0TurnHandler will intercept and 
        // route directly to slot-filling.
        // ════════════════════════════════════════════════════════════════════════════
        if (callState?.bookingModeLocked && callState?.bookingState) {
            logger.info('[LLM-0] 🔒 BOOKING HARD LOCK - Skipping Brain-1 entirely', {
                companyId,
                callId,
                bookingState: callState.bookingState,
                currentStep: callState.currentBookingStep
            });
            
            // Return a minimal decision - LLM0TurnHandler will handle it
            const bypassDecision = createEmptyDecision();
            bypassDecision.action = 'BOOK';  // Signal to handler
            bypassDecision.intentTag = 'booking_slot_fill';
            bypassDecision.confidence = 1.0;
            bypassDecision.flags.bookingLocked = true;
            bypassDecision.debug.reasoning = 'Booking mode locked - bypassed Brain-1';
            bypassDecision.debug.processingTimeMs = Date.now() - startTime;
            return bypassDecision;
        }
        
        // ====================================================================
        // STEP 1: INPUT VALIDATION
        // ====================================================================
        if (!userInput || typeof userInput !== 'string') {
            logger.warn('[LLM-0] Invalid input, returning ASK_QUESTION', { companyId, callId });
            const decision = createEmptyDecision();
            decision.action = 'ASK_QUESTION';
            decision.nextPrompt = "I'm here to help. Could you please tell me what you need?";
            decision.debug.reasoning = 'Empty or invalid input received';
            return decision;
        }
        
        // ====================================================================
        // STEP 2: PREPROCESSING
        // ====================================================================
        const preprocessStart = Date.now();
        
        let cleanedInput = userInput;
        let tokensRemoved = 0;
        
        try {
            // Strip filler words
            cleanedInput = FillerStripper.clean(userInput);
            tokensRemoved = userInput.split(/\s+/).length - cleanedInput.split(/\s+/).length;
            
            // Normalize transcript
            cleanedInput = TranscriptNormalizer.normalize(cleanedInput);
            
            logger.debug('[LLM-0] Preprocessing complete', {
                callId,
                originalLength: userInput.length,
                cleanedLength: cleanedInput.length,
                tokensRemoved
            });
        } catch (preprocError) {
            logger.error('[LLM-0] Preprocessing failed, using raw input', {
                callId,
                error: preprocError.message
            });
            cleanedInput = userInput;
        }
        
        const preprocessingMs = Date.now() - preprocessStart;
        
        // ====================================================================
        // STEP 3: EMOTION DETECTION
        // ====================================================================
        let emotion = { primary: 'NEUTRAL', intensity: 0, signals: [] };
        
        try {
            emotion = EmotionDetector.analyze(cleanedInput, turnHistory);
            
            logger.debug('[LLM-0] Emotion detected', {
                callId,
                primary: emotion.primary,
                intensity: emotion.intensity
            });
        } catch (emotionError) {
            logger.error('[LLM-0] Emotion detection failed', {
                callId,
                error: emotionError.message
            });
        }
        
        // ====================================================================
        // STEP 4: CALL LLM-0 ORCHESTRATOR (with circuit breaker)
        // ====================================================================
        const llmStart = Date.now();
        let rawDecision = null;
        
        const fallbackDecision = () => {
            logger.warn('[LLM-0] Using fallback decision (circuit breaker or error)');
            return {
                action: 'ASK_QUESTION',
                nextPrompt: "I'm here to help. Could you tell me more about what you need?",
                updatedIntent: 'unknown',
                updates: { extracted: {}, flags: {} },
                debugNotes: 'LLM-0 fallback due to circuit breaker or error'
            };
        };
        
        try {
            rawDecision = await orchestratorCircuitBreaker.execute(
                // Main function
                async () => {
                    return await processCallerTurn({
                        companyId,
                        callId,
                        speaker: 'caller',
                        text: cleanedInput,
                        rawSttMetadata: {}
                    });
                },
                // Fallback
                fallbackDecision,
                // Context
                { companyId, callId }
            );
        } catch (llmError) {
            logger.error('[LLM-0] LLM call failed completely', {
                callId,
                error: llmError.message
            });
            rawDecision = fallbackDecision();
        }
        
        const llmCallMs = Date.now() - llmStart;
        
        // ====================================================================
        // STEP 5: NORMALIZE OUTPUT TO CONTRACT
        // ====================================================================
        let decision = normalizeDecision(rawDecision?.decision || rawDecision || {});
        
        // Inherit nextPrompt from raw if available
        if (!decision.nextPrompt && rawDecision?.nextPrompt) {
            decision.nextPrompt = rawDecision.nextPrompt;
        }
        
        // Derive action from flags if still UNKNOWN
        if (decision.action === 'UNKNOWN') {
            decision.action = deriveActionFromFlags(decision);
        }
        
        // ====================================================================
        // STEP 6: SET FLAGS BASED ON EMOTION
        // ====================================================================
        if (emotion.primary === 'FRUSTRATED' || emotion.primary === 'ANGRY') {
            decision.flags.isFrustrated = true;
        }
        if (emotion.primary === 'PANIC' || emotion.primary === 'FEAR') {
            decision.flags.isEmergency = true;
        }
        if (EmotionDetector.isEmergency && EmotionDetector.isEmergency(cleanedInput)) {
            decision.flags.isEmergency = true;
        }
        
        // ====================================================================
        // STEP 7: POPULATE DEBUG INFO
        // ====================================================================
        const totalMs = Date.now() - startTime;
        
        decision.debug = {
            reasoning: decision.debug.reasoning || rawDecision?.decision?.debugNotes || '',
            emotion: {
                primary: emotion.primary,
                intensity: emotion.intensity
            },
            preprocessing: {
                originalInput: userInput.substring(0, 200),
                cleanedInput: cleanedInput.substring(0, 200),
                tokensRemoved
            },
            performance: {
                preprocessingMs,
                llmCallMs,
                totalMs,
                cost: rawDecision?.decision?.llmCost || 0
            },
            triageNotes: []
        };
        
        // Add triage hints based on intent and flags
        if (decision.flags.isEmergency) {
            decision.debug.triageNotes.push('EMERGENCY_DETECTED');
        }
        if (decision.flags.isFrustrated) {
            decision.debug.triageNotes.push('CALLER_FRUSTRATED');
        }
        if (decision.flags.needsBooking) {
            decision.debug.triageNotes.push('READY_TO_BOOK');
        }
        
        // ====================================================================
        // STEP 8: LOG AND RETURN
        // ====================================================================
        logger.info('[LLM-0] 🧠 Brain 1 decision complete', {
            companyId,
            callId,
            action: decision.action,
            intentTag: decision.intentTag,
            flags: decision.flags,
            totalMs,
            preprocessing: { tokensRemoved, preprocessingMs },
            emotion: emotion.primary
        });
        
        return decision;
    }
    
    /**
     * Get circuit breaker status for health checks
     */
    getCircuitBreakerStatus() {
        return orchestratorCircuitBreaker.getStatus();
    }
}

// Export singleton
const instance = new LLM0OrchestratorService();

module.exports = {
    decideNextStep: instance.decideNextStep.bind(instance),
    getCircuitBreakerStatus: instance.getCircuitBreakerStatus.bind(instance),
    LLM0OrchestratorService
};

