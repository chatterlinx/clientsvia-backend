/**
 * ============================================================================
 * BRAIN-1 RUNTIME - Complete Orchestrator
 * ============================================================================
 * 
 * THE SINGLE RUNTIME ENTRYPOINT FOR ALL CALL TURNS
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * RUNTIME CONTRACT (NON-NEGOTIABLE):
 * ════════════════════════════════════════════════════════════════════════════
 * 
 *   INPUT:  Non-empty transcript string from caller
 *   OUTPUT: Non-empty response.text AND an action
 *   
 *   IT IS ILLEGAL FOR THIS FUNCTION TO RETURN EMPTY TEXT.
 *   
 *   If normal logic fails, we go down the fallback ladder:
 *     1. Normal path (LLM-0 + Triage + Scenario + ResponseConstructor)
 *     2. Tier-3 clarifier (if response fails validation)
 *     3. Hard bailout (company bailout message + transfer/message)
 *   
 *   SILENCE IS A BUG. This runtime enforces "no dead air, ever."
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * This ties together:
 * 1. FrontlineIntelEngine (Brain-1 decision making)
 * 2. TriageRouter (routing Brain-1 decisions)
 * 3. Brain-2 (AIBrain3tierllm for scenarios)
 * 4. Transfer Handler
 * 5. Booking Handler
 * 6. Guardrails
 * 7. ResponseValidator (quality gate)
 * 
 * FLOW:
 *   Caller → Brain-1 (FrontlineIntelEngine.runTurn())
 *         → Triage Router
 *         → Brain-2 (if SCENARIO_ENGINE) OR Transfer/Booking/End
 *         → Guardrails
 *         → ResponseValidator (quality check)
 *         → Fallback ladder if needed
 *         → Response (ALWAYS non-empty)
 * 
 * CALLED BY: v2AIAgentRuntime.processUserInput()
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const Brain1Trace = require('../../../models/Brain1Trace');
const { runTurn } = require('./FrontlineIntelEngine');
const { route } = require('../triage/TriageRouter');
const AIBrain3tierllm = require('../../../services/AIBrain3tierllm');
const Company = require('../../../models/v2Company');

// ═══════════════════════════════════════════════════════════════════════════
// 📼 BLACK BOX RECORDER - Enterprise Call Flight Recorder
// ═══════════════════════════════════════════════════════════════════════════
let BlackBoxLogger;
try {
    BlackBoxLogger = require('../../../services/BlackBoxLogger');
} catch (err) {
    BlackBoxLogger = null;
    logger.warn('[BRAIN-1 RUNTIME] BlackBoxLogger not available', { error: err.message });
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLE VOICE ARCHITECTURE - ResponseConstructor is THE ONLY SPEAKER
// ═══════════════════════════════════════════════════════════════════════════
const { buildFinalResponse, buildSimpleResponse } = require('../../../services/ResponseConstructor');
const { analyzeBehavior, getDefaultBehavior } = require('../../../services/LLM0BehaviorAnalyzer');

// ═══════════════════════════════════════════════════════════════════════════
// LOOP DETECTOR - Safety net to prevent infinite generic response loops
// ═══════════════════════════════════════════════════════════════════════════
const LoopDetector = require('./LoopDetector');

// ═══════════════════════════════════════════════════════════════════════════
// RESPONSE VALIDATOR - Quality gate enforcing "no silence, no dead-ends"
// ═══════════════════════════════════════════════════════════════════════════
const { validateAndLog } = require('./ResponseValidator');

// ═══════════════════════════════════════════════════════════════════════════
// TIER-3 CLARIFIER - Fallback ladder step 1: Generate contextual question
// ═══════════════════════════════════════════════════════════════════════════
const { generateClarifyingQuestion } = require('./Tier3Clarifier');

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT BAILOUT - Used when all else fails (can be overridden per company)
// ═══════════════════════════════════════════════════════════════════════════
// Action-aligned messages: say what you're actually doing, never lie to the caller
const DEFAULT_BAILOUT_MESSAGES = {
    TRANSFER: "I'm having a bit of trouble on my end. Let me connect you with someone who can help you right away.",
    MESSAGE: "Let me take down a quick message so someone from the team can follow up with you.",
    HANGUP: "I'm going to end the call now. Thank you for contacting us."
};
const DEFAULT_BAILOUT_ACTION = 'TRANSFER';

/**
 * Get the appropriate bailout message for the action
 * If company set a custom message, use it. Otherwise, use action-aligned default.
 */
function getBailoutMessage(company, action) {
    // If company has a custom message, always use it (they know what they're saying)
    if (company?.settings?.bailoutMessage) {
        return company.settings.bailoutMessage;
    }
    // Otherwise, use the action-aligned default
    return DEFAULT_BAILOUT_MESSAGES[action] || DEFAULT_BAILOUT_MESSAGES.TRANSFER;
}

/**
 * ============================================================================
 * MAIN ENTRYPOINT: Process a complete turn through the brain architecture
 * ============================================================================
 * 
 * @param {string} companyId - Company ID
 * @param {string} callId - Twilio Call SID
 * @param {string} userInput - Raw STT text
 * @param {Object} callState - Current call state
 * @returns {Promise<Object>} Result with text, action, callState
 */
async function processTurn(companyId, callId, userInput, callState) {
    const startTime = Date.now();
    
    logger.info('[BRAIN-1 RUNTIME] Processing turn', {
        companyId,
        callId,
        inputLength: userInput?.length,
        turn: (callState?.turnCount || 0) + 1
    });
    
    try {
        // ====================================================================
        // STEP 1: RUN BRAIN-1 (FrontlineIntelEngine)
        // ====================================================================
        const { updatedCallState, decision, trace } = await runTurn({
            companyId,
            callId,
            text: userInput,
            callState
        });
        
        // ====================================================================
        // STEP 2: LOAD COMPANY
        // ====================================================================
        const company = await Company.findById(companyId).lean();
        if (!company) {
            throw new Error('Company not found');
        }
        
        // ====================================================================
        // STEP 2.5 + 3: PARALLEL EXECUTION - Behavior + Triage simultaneously
        // ====================================================================
        // CRITICAL OPTIMIZATION: These two operations don't depend on each other
        // - LLM-0 Behavior: analyzes caller mood (50-150ms if LLM, 0ms if rules)
        // - Triage Router: routes decision to handler (1-5ms typically)
        // 
        // Running in parallel saves 50-150ms per turn!
        // ====================================================================
        const parallelStart = Date.now();
        
        // Wrap behavior analysis in a function that handles errors
        const behaviorPromise = (async () => {
            const behaviorStart = Date.now();
            try {
                const result = await analyzeBehavior({
                    context: {
                        callId,
                        companyId,
                        turnNumber: (callState?.turnCount || 0) + 1,
                        callerUtterance: userInput
                    },
                    previousBehavior: callState?.llm0Behavior || null
                });
                return { 
                    behavior: result, 
                    success: true, 
                    ms: Date.now() - behaviorStart 
                };
            } catch (err) {
                logger.warn('[BRAIN-1 RUNTIME] LLM-0 behavior analysis failed (using defaults)', {
                    companyId,
                    callId,
                    error: err.message
                });
                return { 
                    behavior: getDefaultBehavior(), 
                    success: false, 
                    error: err.message,
                    ms: Date.now() - behaviorStart 
                };
            }
        })();
        
        // Wrap triage in a function
        const triagePromise = (async () => {
            const triageStart = Date.now();
            const currentTurn = (callState?.turnCount || 0) + 1;
            const result = await route(decision, company, { callId, turn: currentTurn });
            return { 
                triage: result, 
                ms: Date.now() - triageStart 
            };
        })();
        
        // Execute both in parallel
        const [behaviorResult, triageResultData] = await Promise.all([
            behaviorPromise,
            triagePromise
        ]);
        
        const parallelMs = Date.now() - parallelStart;
        
        // Extract results
        const llm0Behavior = behaviorResult.behavior;
        const triageResult = triageResultData.triage;
        
        // Update trace with behavior result
        trace.llm0 = behaviorResult.success ? {
            analyzed: true,
            mood: llm0Behavior.mood.current,
            tone: llm0Behavior.style.tone,
            suggestedFiller: llm0Behavior.suggestedFiller,
            analysisMs: behaviorResult.ms
        } : {
            analyzed: false,
            error: behaviorResult.error,
            analysisMs: behaviorResult.ms
        };
        trace.performance.llm0Ms = behaviorResult.ms;
        
        // Update trace with triage result
        trace.triage = {
            route: triageResult.route,
            matchedCardId: triageResult.matchedCardId,
            matchedCardName: triageResult.matchedCardName,
            openingLine: triageResult.openingLine || null,
            reason: triageResult.reason
        };
        trace.performance.triageMs = triageResultData.ms;
        trace.performance.parallelMs = parallelMs;
        
        logger.info('[BRAIN-1 RUNTIME] ⚡ Parallel execution complete', {
            companyId,
            callId,
            behaviorMs: behaviorResult.ms,
            triageMs: triageResultData.ms,
            parallelMs,
            savedMs: Math.max(behaviorResult.ms, triageResultData.ms) < parallelMs ? 0 : 
                     behaviorResult.ms + triageResultData.ms - parallelMs,
            route: triageResult.route,
            matchedCard: triageResult.matchedCardName,
            mood: llm0Behavior.mood.current
        });
        
        // ====================================================================
        // STEP 4: EXECUTE BASED ON ROUTE (Handlers return content, not final text)
        // ====================================================================
        let handlerResult;
        
        switch (triageResult.route) {
            case 'SCENARIO_ENGINE':
                handlerResult = await handleScenarioEngine({
                    company,
                    callState: updatedCallState,
                    userInput,
                    decision,
                    triageResult,
                    trace
                });
                break;
                
            case 'TRANSFER':
                handlerResult = await handleTransfer({
                    company,
                    callState: updatedCallState,
                    decision,
                    triageResult
                });
                break;
                
            case 'BOOKING_FLOW':
                handlerResult = await handleBooking({
                    company,
                    callState: updatedCallState,
                    decision
                });
                break;
                
            case 'END_CALL':
                handlerResult = handleEndCall({
                    decision,
                    callState: updatedCallState
                });
                break;
            
            case 'VENDOR_HANDLING':
                handlerResult = await handleVendorCall({
                    company,
                    callState: updatedCallState,
                    decision,
                    trace
                });
                break;
                
            case 'MESSAGE_ONLY':
            default:
                handlerResult = handleMessageOnly({
                    decision,
                    callState: updatedCallState,
                    triageResult  // Pass triage result to use matched card's content
                });
                break;
        }
        
        // ====================================================================
        // STEP 5: BUILD FINAL RESPONSE VIA RESPONSECONSTRUCTOR
        // ====================================================================
        // ResponseConstructor is THE ONLY place that builds spoken text.
        // It combines: LLM-0 filler + Triage openingLine + Handler content
        // ====================================================================
        const isFirstTurnForScenario = !callState?.currentScenarioId || 
            callState.currentScenarioId !== handlerResult.scenarioId;
        
        const finalResponse = buildFinalResponse({
            context: {
                callId,
                companyId,
                turnNumber: (callState?.turnCount || 0) + 1
            },
            llm0Behavior,
            triage: triageResult,
            scenario: {
                response: {
                    full: handlerResult.text
                },
                scenarioId: handlerResult.scenarioId || triageResult.matchedCardId,
                scenarioName: handlerResult.scenarioName || triageResult.matchedCardName
            },
            isFirstTurnForScenario
        });
        
        // Build result with ResponseConstructor output
        const result = {
            text: finalResponse.text,
            ssml: finalResponse.ssml,
            action: handlerResult.action,
            shouldTransfer: handlerResult.shouldTransfer,
            shouldHangup: handlerResult.shouldHangup,
            callState: {
                ...handlerResult.callState,
                llm0Behavior,
                currentScenarioId: handlerResult.scenarioId || triageResult.matchedCardId
            }
        };
        
        logger.info('[BRAIN-1 RUNTIME] 🎯 Response built via ResponseConstructor', {
            companyId,
            callId,
            textLength: result.text.length,
            sources: finalResponse.meta.sources,
            constructionMs: finalResponse.meta.constructionMs
        });
        
        // ====================================================================
        // STEP 5.5: APPLY GUARDRAILS TO FINAL TEXT
        // ====================================================================
        result.text = applyGuardrails(result.text, company);
        
        // ====================================================================
        // STEP 5.6: VARIABLE SUBSTITUTION (Call Center V2)
        // ====================================================================
        // Replace {customerName}, {companyName}, etc. with actual values
        // Combines: company placeholders + customer context variables
        const { fullSubstitution, buildSubstitutionContext } = require('../../../utils/responseVariableSubstitution');
        const substitutionContext = buildSubstitutionContext(updatedCallState, company);
        result.text = fullSubstitution(result.text, substitutionContext);
        
        // ====================================================================
        // STEP 5.7: RECORD RESPONSE FOR LOOP DETECTION
        // ====================================================================
        // P0 FIX: Track responses to detect infinite loops
        LoopDetector.recordResponse(callId, result.text);
        
        // ====================================================================
        // STEP 6: UPDATE TRACE AND PERSIST
        // ====================================================================
        trace.output = {
            spokenText: result.text,
            action: result.action,
            nextState: result.callState?.currentIntent
        };
        trace.performance.totalMs = Date.now() - startTime;
        trace.timestamps.responded = new Date();
        
        Brain1Trace.logTurn(trace).catch(err => {
            logger.error('[BRAIN-1 RUNTIME] Failed to update trace', {
                callId,
                error: err.message
            });
        });
        
        // ====================================================================
        // STEP 7: RETURN RESULT
        // ====================================================================
        // ====================================================================
        // STEP 7: ENRICH CUSTOMER WITH EXTRACTED DATA (Call Center V2)
        // ====================================================================
        // If Brain-1 extracted entities (name, address, etc.), save them
        if (updatedCallState.customerId && decision.entities) {
            const hasExtractedData = 
                decision.entities.contact?.name ||
                decision.entities.location?.addressLine1 ||
                decision.entities.contact?.email;
            
            if (hasExtractedData) {
                try {
                    const CustomerLookup = require('../../../services/CustomerLookup');
                    await CustomerLookup.enrichCustomer(companyId, updatedCallState.customerId, {
                        name: decision.entities.contact?.name,
                        firstName: decision.entities.contact?.firstName,
                        address: decision.entities.location ? {
                            street: decision.entities.location.addressLine1,
                            city: decision.entities.location.city,
                            state: decision.entities.location.state,
                            zip: decision.entities.location.zip
                        } : undefined,
                        email: decision.entities.contact?.email,
                        preferredTimeOfDay: decision.entities.scheduling?.preferredWindow,
                        specialInstructions: decision.entities.problem?.summary
                    });
                    
                    logger.info('[BRAIN-1 RUNTIME] Customer enriched with extracted data', {
                        companyId,
                        callId,
                        customerId: updatedCallState.customerId,
                        extractedFields: Object.keys(decision.entities)
                    });
                } catch (enrichErr) {
                    // Non-blocking: Don't fail the call if enrichment fails
                    logger.warn('[BRAIN-1 RUNTIME] Customer enrichment failed (non-blocking)', {
                        error: enrichErr.message,
                        customerId: updatedCallState.customerId
                    });
                }
            }
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // STEP 7: RESPONSE VALIDATION GATE
        // ════════════════════════════════════════════════════════════════════════════
        // Enforce the runtime contract: no silence, no dead-ends, no loops
        // If validation fails, we go down the fallback ladder
        // ════════════════════════════════════════════════════════════════════════════
        
        // Pass turnNumber so validator knows not to trigger dead-end patterns on early turns
        const turnNumber = updatedCallState.turnCount || 1;
        const validation = validateAndLog(result.text, callId, 'processTurn.normal', turnNumber);
        
        // 📼 BLACK BOX: Log response validation result
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId,
                companyId,
                type: 'AGENT_RESPONSE_VALIDATED',
                turn: turnNumber,
                data: {
                    usable: validation.usable,
                    reason: validation.reason,
                    responseLength: result.text?.length || 0
                }
            }).catch(() => {});
        }
        
        if (!validation.usable) {
            logger.warn('[BRAIN-1 RUNTIME] ⚠️ RESPONSE VALIDATION FAILED - Entering fallback ladder', {
                companyId,
                callId,
                reason: validation.reason,
                originalText: result.text?.substring(0, 50)
            });
            
            // ════════════════════════════════════════════════════════════════════════════
            // FALLBACK LADDER STEP 1: Try Tier-3 Clarifier
            // ════════════════════════════════════════════════════════════════════════════
            // Uses company data (trade, serviceTypes) to generate contextual question
            // No hardcoded business logic - all meaning from DB
            
            let tier3Success = false;
            
            try {
                logger.info('[BRAIN-1 RUNTIME] 🔄 Attempting Tier-3 Clarifier...', {
                    companyId,
                    callId,
                    reason: validation.reason
                });
                
                const clarifierResult = await generateClarifyingQuestion({
                    userText: userInput,
                    company,
                    callId,
                    turnNumber: updatedCallState.turnCount
                });
                
                if (clarifierResult.success && clarifierResult.text) {
                    // Validate the clarifier's output too (same turn-awareness)
                    const clarifierValidation = validateAndLog(
                        clarifierResult.text, 
                        callId, 
                        'processTurn.tier3Clarifier',
                        turnNumber
                    );
                    
                    if (clarifierValidation.usable) {
                        logger.info('[BRAIN-1 RUNTIME] ✅ Tier-3 Clarifier succeeded', {
                            companyId,
                            callId,
                            question: clarifierResult.text.substring(0, 50),
                            source: clarifierResult.source,
                            elapsedMs: clarifierResult.elapsedMs
                        });
                        
                        result.text = clarifierResult.text;
                        result.action = 'continue';
                        result.shouldTransfer = false;
                        result.shouldHangup = false;
                        result.tier3Clarified = true;
                        result.tier3Source = clarifierResult.source;
                        tier3Success = true;
                    } else {
                        logger.warn('[BRAIN-1 RUNTIME] ⚠️ Tier-3 Clarifier output also failed validation', {
                            callId,
                            clarifierOutput: clarifierResult.text?.substring(0, 50),
                            reason: clarifierValidation.reason
                        });
                    }
                }
            } catch (clarifierError) {
                logger.warn('[BRAIN-1 RUNTIME] ⚠️ Tier-3 Clarifier failed', {
                    callId,
                    error: clarifierError.message
                });
            }
            
            // ════════════════════════════════════════════════════════════════════════════
            // FALLBACK LADDER STEP 2: Bailout (only if Tier-3 also failed)
            // ════════════════════════════════════════════════════════════════════════════
            // 
            // Two types of bailout:
            // - HARD: LOOP_DETECTED or DEAD_END_PATTERN → Transfer to human
            // - SOFT: EMPTY or TOO_SHORT → Try to recover the conversation
            // ════════════════════════════════════════════════════════════════════════════
            
            if (!tier3Success) {
                const isHardFailure = (validation.reason === 'LOOP_DETECTED' || validation.reason === 'DEAD_END_PATTERN');
                
                if (isHardFailure) {
                    // ════════════════════════════════════════════════════════════════════════════
                    // HARD BAILOUT: Logic failure → Transfer to human (or take message)
                    // ════════════════════════════════════════════════════════════════════════════
                    const bailoutAction = company?.settings?.bailoutAction || DEFAULT_BAILOUT_ACTION;
                    const bailoutMessage = getBailoutMessage(company, bailoutAction);
                    
                    // Map action to internal values
                    let action = 'take_message';
                    if (bailoutAction === 'TRANSFER') action = 'transfer';
                    else if (bailoutAction === 'HANGUP') action = 'hangup';
                    
                    logger.warn('[BRAIN-1 RUNTIME] 🚨 HARD BAILOUT (Loop/Dead-end)', {
                        companyId,
                        callId,
                        reason: validation.reason,
                        turnNumber,
                        bailoutAction,
                        message: bailoutMessage.substring(0, 50)
                    });
                    
                    result.text = bailoutMessage;
                    result.action = action;
                    result.shouldTransfer = (action === 'transfer');
                    result.shouldHangup = (action === 'hangup');
                    result.bailoutTriggered = true;
                    result.bailoutReason = validation.reason;
                    result.bailoutType = 'hard';
                    
                    // 📼 BLACK BOX: Log hard bailout
                    if (BlackBoxLogger) {
                        BlackBoxLogger.logEvent({
                            callId,
                            companyId,
                            type: 'BAILOUT_TRIGGERED',
                            turn: turnNumber,
                            data: {
                                bailoutType: 'HARD',
                                reason: validation.reason,
                                action: bailoutAction
                            }
                        }).catch(() => {});
                    }
                } else {
                    // ════════════════════════════════════════════════════════════════════════════
                    // SOFT BAILOUT: Generation failure → Try to recover conversation
                    // ════════════════════════════════════════════════════════════════════════════
                    // 
                    // IMPORTANT: Don't say "I can't hear you" - that blames the caller.
                    // The AI generated garbage, not an audio problem.
                    // Say "let me rephrase" or "could you tell me more" instead.
                    // ════════════════════════════════════════════════════════════════════════════
                    
                    logger.warn('[BRAIN-1 RUNTIME] ⚠️ SOFT BAILOUT (Empty/Short)', {
                        companyId,
                        callId,
                        reason: validation.reason,
                        turnNumber,
                        originalLength: result.text?.length
                    });
                    
                    // Honest recovery message - admits we need to retry
                    result.text = "Let me try that again. Could you tell me a little more about what you need help with?";
                    result.action = 'continue';  // Keep the call alive
                    result.shouldTransfer = false;
                    result.shouldHangup = false;
                    result.bailoutTriggered = true;
                    result.bailoutReason = validation.reason;
                    result.bailoutType = 'soft';
                    
                    // 📼 BLACK BOX: Log soft bailout
                    if (BlackBoxLogger) {
                        BlackBoxLogger.logEvent({
                            callId,
                            companyId,
                            type: 'BAILOUT_TRIGGERED',
                            turn: turnNumber,
                            data: {
                                bailoutType: 'SOFT',
                                reason: validation.reason,
                                action: 'continue'
                            }
                        }).catch(() => {});
                    }
                }
            }
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // FINAL GATE: ABSOLUTE NO-SILENCE ENFORCEMENT
        // ════════════════════════════════════════════════════════════════════════════
        // This is the last line of defense. If ANYTHING got through with empty text,
        // we override it here. This should never happen, but we're bulletproof.
        // ════════════════════════════════════════════════════════════════════════════
        
        if (!result.text || result.text.trim() === '') {
            // Use action-aligned message for the emergency transfer
            const emergencyAction = company?.settings?.bailoutAction || DEFAULT_BAILOUT_ACTION;
            const emergencyMessage = getBailoutMessage(company, emergencyAction);
            
            logger.error('[BRAIN-1 RUNTIME] ⛔ CRITICAL: Empty response at final gate!', {
                companyId,
                callId,
                shouldNeverHappen: true,
                emergencyAction
            });
            
            result.text = emergencyMessage;
            result.action = emergencyAction === 'TRANSFER' ? 'transfer' : 'take_message';
            result.shouldTransfer = emergencyAction === 'TRANSFER';
            result.bailoutTriggered = true;
            result.bailoutReason = 'FINAL_GATE_EMPTY';
        }
        
        logger.info('[BRAIN-1 RUNTIME] ✅ Turn complete', {
            companyId,
            callId,
            route: triageResult.route,
            action: result.action,
            totalMs: Date.now() - startTime,
            brain2Called: trace.brain2?.called,
            bailoutTriggered: result.bailoutTriggered || false
        });
        
        return result;
        
    } catch (error) {
        logger.error('[BRAIN-1 RUNTIME] ❌ Fatal error', {
            companyId,
            callId,
            error: error.message,
            stack: error.stack
        });
        
        // Use action-aligned message for error fallback
        const errorAction = company?.settings?.bailoutAction || DEFAULT_BAILOUT_ACTION;
        const errorMessage = getBailoutMessage(company, errorAction);
        
        // Emergency fallback via ResponseConstructor - ALSO must be non-empty
        const errorResponse = buildSimpleResponse({
            context: { callId, companyId, turnNumber: (callState?.turnCount || 0) + 1 },
            text: errorMessage,
            source: 'brain1.error.fallback'
        });
        
        // Error response also enforces no-silence contract
        return {
            text: errorResponse.text || errorMessage,
            ssml: errorResponse.ssml,
            action: errorAction === 'TRANSFER' ? 'transfer' : 'take_message',
            shouldTransfer: errorAction === 'TRANSFER',
            shouldHangup: errorAction === 'HANGUP',
            bailoutTriggered: true,
            bailoutReason: 'FATAL_ERROR',
            callState: {
                ...callState,
                turnCount: (callState?.turnCount || 0) + 1,
                lastError: error.message
            }
        };
    }
}

/**
 * ============================================================================
 * ROUTE HANDLERS
 * ============================================================================
 */

/**
 * Handle SCENARIO_ENGINE route - calls Brain-2 (AIBrain3tierllm)
 */
async function handleScenarioEngine({ company, callState, userInput, decision, triageResult, trace }) {
    const companyId = company._id.toString();
    const brain2Start = Date.now();
    
    logger.info('[BRAIN-1 RUNTIME] Calling Brain-2 (Scenario Engine)', {
        companyId,
        scenarioHint: triageResult.scenarioHint,
        triageTag: decision.triageTag
    });
    
    try {
        // Call Brain-2 (3-Tier Intelligence)
        const brain = new AIBrain3tierllm();
        const brain2Result = await brain.query(companyId, userInput, {
            callState,
            routingId: `brain1-${callState.callId || 'unknown'}-${Date.now()}`,
            intent: decision.intentTag,
            triageTag: decision.triageTag,
            scenarioHint: triageResult.scenarioHint
        });
        
        const brain2Ms = Date.now() - brain2Start;
        
        // Update trace with Brain-2 result
        trace.brain2 = {
            called: true,
            tier: brain2Result.metadata?.tier || 0,
            scenarioId: brain2Result.metadata?.scenarioId || null,
            scenarioName: brain2Result.metadata?.scenarioName || null,
            confidence: brain2Result.confidence || 0,
            responseText: brain2Result.response?.substring(0, 500) || null,
            cost: brain2Result.metadata?.cost || 0
        };
        trace.performance.brain2Ms = brain2Ms;
        trace.timestamps.brain2Complete = new Date();
        
        logger.info('[BRAIN-1 RUNTIME] Brain-2 result', {
            companyId,
            tier: trace.brain2.tier,
            scenarioName: trace.brain2.scenarioName,
            confidence: trace.brain2.confidence,
            responseLength: brain2Result.response?.length
        });
        
        // Use Brain-2 response - this will be passed to ResponseConstructor
        const responseText = brain2Result.response || 
            "I can help you with that. Could you tell me a bit more about what's happening?";
        
        return {
            text: responseText,
            scenarioId: brain2Result.metadata?.scenarioId || null,
            scenarioName: brain2Result.metadata?.scenarioName || null,
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState: {
                ...callState,
                lastScenario: trace.brain2.scenarioName,
                lastTier: trace.brain2.tier
            }
        };
        
    } catch (error) {
        logger.error('[BRAIN-1 RUNTIME] Brain-2 call failed', {
            companyId,
            error: error.message
        });
        
        trace.brain2 = {
            called: true,
            tier: 0,
            error: error.message
        };
        
        // Fallback response
        return {
            text: "I understand. Let me help you with that. Could you tell me a bit more about the issue?",
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState
        };
    }
}

/**
 * Handle TRANSFER route
 */
async function handleTransfer({ company, callState, decision, triageResult }) {
    const isEmergency = decision.flags?.isEmergency;
    const isFrustrated = decision.flags?.isFrustrated;
    
    let transferMessage;
    
    if (isEmergency) {
        transferMessage = "I understand this is urgent. I'm connecting you with our emergency team right now. Please stay on the line.";
    } else if (isFrustrated) {
        transferMessage = "I understand your frustration and I want to make sure you get the help you need. Let me connect you with a supervisor who can assist you.";
    } else {
        transferMessage = "Let me connect you with someone who can help you right away. Please hold for just a moment.";
    }
    
    return {
        text: transferMessage,
        action: 'transfer',
        shouldTransfer: true,
        shouldHangup: false,
        callState: {
            ...callState,
            transferInitiated: true,
            transferReason: triageResult.reason
        }
    };
}

/**
 * Handle BOOKING_FLOW route
 */
async function handleBooking({ company, callState, decision }) {
    const entities = decision.entities || {};
    const callId = callState?.callId;
    const companyId = company?._id?.toString();
    const turnNumber = callState?.turnCount || 1;
    
    // 📼 BLACK BOX: Log booking mode activation (first time entering booking flow)
    const wasInBookingFlow = !!callState?.bookingState;
    if (BlackBoxLogger && callId && !wasInBookingFlow) {
        BlackBoxLogger.logEvent({
            callId,
            companyId,
            type: 'BOOKING_MODE_ACTIVATED',
            turn: turnNumber,
            data: {
                reason: decision.intentTag || 'BOOKING_REQUEST',
                intentConfidence: decision.confidence || 0
            }
        }).catch(() => {});
    }
    
    // Check what info we have
    const hasName = !!entities.contact?.name;
    const hasPhone = !!entities.contact?.phone;
    const hasAddress = !!entities.location?.addressLine1;
    const hasPreferredTime = !!entities.scheduling?.preferredDate || !!entities.scheduling?.preferredWindow;
    
    // Helper to log booking steps
    const logBookingStep = (stepKey, status) => {
        if (BlackBoxLogger && callId) {
            BlackBoxLogger.logEvent({
                callId,
                companyId,
                type: 'BOOKING_STEP',
                turn: turnNumber,
                data: { stepKey, status }
            }).catch(() => {});
        }
    };
    
    // Determine what to ask for
    if (!hasName) {
        logBookingStep('ASK_NAME', 'ASKED');
        return {
            text: "I'd be happy to schedule that for you. May I have your name please?",
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState: {
                ...callState,
                bookingState: 'collecting_name'
            }
        };
    }
    
    if (!hasPhone) {
        logBookingStep('ASK_PHONE', 'ASKED');
        return {
            text: "Thanks, " + entities.contact.name + ". And what's the best phone number to reach you?",
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState: {
                ...callState,
                bookingState: 'collecting_phone'
            }
        };
    }
    
    if (!hasAddress) {
        logBookingStep('ASK_ADDRESS', 'ASKED');
        return {
            text: "Great. What's the service address?",
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState: {
                ...callState,
                bookingState: 'collecting_address'
            }
        };
    }
    
    if (!hasPreferredTime) {
        logBookingStep('ASK_TIME', 'ASKED');
        return {
            text: "When would be a good time for us to come out?",
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState: {
                ...callState,
                bookingState: 'collecting_time'
            }
        };
    }
    
    // Have all info - confirm booking
    logBookingStep('CONFIRM_BOOKING', 'CONFIRMED');
    const timeText = entities.scheduling.preferredDate || entities.scheduling.preferredWindow || 'soon';
    return {
        text: `Perfect! I have ${entities.contact.name} at ${entities.location.addressLine1} for ${timeText}. I'll get that scheduled and someone will confirm with you shortly. Is there anything else I can help you with?`,
        action: 'continue',
        shouldTransfer: false,
        shouldHangup: false,
        callState: {
            ...callState,
            bookingState: 'confirmed',
            bookingReady: true
        }
    };
}

/**
 * Handle END_CALL route
 */
function handleEndCall({ decision, callState }) {
    let endMessage;
    
    if (decision.flags?.isSpam) {
        endMessage = "Goodbye.";
    } else if (decision.flags?.isWrongNumber) {
        endMessage = "It seems you may have reached us by mistake. Have a great day!";
    } else {
        endMessage = "Thank you for calling! Have a great day. Goodbye!";
    }
    
    return {
        text: endMessage,
        action: 'hangup',
        shouldTransfer: false,
        shouldHangup: true,
        callState: {
            ...callState,
            callEnded: true,
            endReason: decision.flags?.isSpam ? 'spam' : 
                       decision.flags?.isWrongNumber ? 'wrong_number' : 'normal'
        }
    };
}

/**
 * Handle MESSAGE_ONLY route
 */
function handleMessageOnly({ decision, callState, triageResult }) {
    let responseText = '';
    
    // ========================================================================
    // PRIORITY 1: Use matched Triage Card's opening line/response
    // ========================================================================
    // If a card was matched, its openingLine IS the response. 
    // ResponseConstructor will use triageResult.openingLine as the main content.
    // We return empty here to avoid duplication.
    // ========================================================================
    if (triageResult?.matchedCardId && triageResult?.openingLine) {
        logger.debug('[MESSAGE_ONLY] Using triage card response', {
            cardId: triageResult.matchedCardId,
            cardName: triageResult.matchedCardName,
            openingLine: triageResult.openingLine?.substring(0, 50)
        });
        
        // Return empty - ResponseConstructor will use triageResult.openingLine
        // This prevents "double-talk" (card response + generic acknowledgment)
        return {
            text: '',  // Empty! ResponseConstructor uses openingLine instead
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            scenarioId: triageResult.matchedCardId,
            scenarioName: triageResult.matchedCardName,
            callState
        };
    }
    
    // ========================================================================
    // FALLBACK: No card matched - use contextual follow-up questions
    // ========================================================================
    if (decision.action === 'ASK_FOLLOWUP') {
        // Generate contextual follow-up based on what we know
        const hasAnyInfo = callState.extracted?.contact?.name || 
                          callState.extracted?.problem?.summary;
        
        if (!hasAnyInfo) {
            responseText = "I'm here to help. Can you please tell me your name and what you need assistance with?";
        } else if (!callState.extracted?.problem?.summary) {
            responseText = "I'd be happy to help. Can you tell me more about what's going on?";
        } else {
            responseText = "I understand. Is there anything else you'd like to tell me about the issue?";
        }
    } else {
        // MESSAGE_ONLY without card match - just acknowledge
        responseText = "I understand. How can I help you with that?";
    }
    
    logger.debug('[MESSAGE_ONLY] Using fallback response (no card matched)', {
        action: decision.action,
        responsePreview: responseText.substring(0, 50)
    });
    
    return {
        text: responseText,
        action: 'continue',
        shouldTransfer: false,
        shouldHangup: false,
        callState
    };
}

/**
 * ============================================================================
 * GUARDRAILS
 * ============================================================================
 */

/**
 * Apply guardrails to response text
 */
function applyGuardrails(text, company) {
    if (!text) return text;
    
    let safeText = text;
    
    // Price guardrail - don't quote specific prices unless configured
    const pricePattern = /\$\d+(\.\d{2})?/g;
    // Check for price variables in company configuration (could be object, array, or Map)
    const variables = company?.configuration?.variables || company?.aiAgentSettings?.variables || {};
    const hasPriceConfig = (typeof variables === 'object') 
        ? (variables['serviceCallPrice'] || variables['diagnosticFee'] || 
           variables.serviceCallPrice || variables.diagnosticFee)
        : false;
    
    if (!hasPriceConfig && pricePattern.test(safeText)) {
        logger.warn('[GUARDRAILS] Price pattern detected without config, softening', {
            companyId: company?._id
        });
        safeText = safeText.replace(pricePattern, 'a competitive rate');
    }
    
    // Time promise guardrail - don't promise specific arrival times
    const timePromisePatterns = [
        /we'll be there in \d+ (minutes|hours)/gi,
        /someone will be out in \d+/gi,
        /technician will arrive in \d+/gi
    ];
    
    for (const pattern of timePromisePatterns) {
        if (pattern.test(safeText)) {
            safeText = safeText.replace(pattern, "we'll get someone out to you as soon as possible");
        }
    }
    
    return safeText;
}

/**
 * ============================================================================
 * VENDOR CALL HANDLING
 * ============================================================================
 * Handles calls from vendors, suppliers, delivery drivers, etc.
 * These are B2B calls, not customer service calls.
 */
async function handleVendorCall({ company, callState, decision, trace }) {
    const companyId = company._id.toString();
    const vendorInfo = decision.entities?.vendor || {};
    
    logger.info('[BRAIN-1 RUNTIME] Handling vendor call', {
        companyId,
        vendorCompany: vendorInfo.companyName,
        reason: vendorInfo.reason,
        urgency: vendorInfo.urgency
    });
    
    // Try to load Vendor models
    let Vendor, VendorCall;
    try {
        Vendor = require('../../../models/Vendor');
        VendorCall = require('../../../models/VendorCall');
    } catch (err) {
        logger.warn('[BRAIN-1 RUNTIME] Vendor models not available');
    }
    
    // Check if this vendor is already on file
    let existingVendor = null;
    if (Vendor && vendorInfo.companyName) {
        existingVendor = await Vendor.findOne({
            companyId,
            businessName: { $regex: new RegExp(vendorInfo.companyName, 'i') }
        }).lean();
    }
    
    // Log the vendor call
    if (VendorCall) {
        try {
            await VendorCall.create({
                companyId,
                vendorId: existingVendor?._id || null,
                vendorName: vendorInfo.companyName || 'Unknown Vendor',
                contactName: vendorInfo.contactName || null,
                phone: callState.from,
                callSid: callState.callId,
                reason: vendorInfo.reason || 'general inquiry',
                referenceNumber: vendorInfo.referenceNumber || null,
                urgency: vendorInfo.urgency || 'normal',
                status: 'pending',
                handledBy: 'ai_agent',
                notes: `Auto-detected vendor call. Reason: ${vendorInfo.reason || 'not specified'}`
            });
        } catch (err) {
            logger.warn('[BRAIN-1 RUNTIME] Failed to log vendor call', { error: err.message });
        }
    }
    
    // Update trace
    if (trace) {
        trace.vendor = {
            detected: true,
            companyName: vendorInfo.companyName,
            isKnownVendor: !!existingVendor,
            urgency: vendorInfo.urgency
        };
    }
    
    // Generate response based on urgency
    let responseText;
    
    if (vendorInfo.urgency === 'urgent') {
        // Urgent vendor call - offer to transfer
        responseText = `I understand this is urgent. Let me connect you with someone who can help right away. One moment please.`;
        
        return {
            text: responseText,
            action: 'transfer',
            shouldTransfer: true,
            shouldHangup: false,
            transferTarget: company.configuration?.vendorPhone || company.phoneNumber,
            callState: {
                ...callState,
                isVendorCall: true,
                vendorInfo
            }
        };
    } else {
        // Non-urgent - take message
        const vendorName = vendorInfo.companyName || 'your company';
        const contactName = vendorInfo.contactName ? `, ${vendorInfo.contactName}` : '';
        
        responseText = `Thank you for calling from ${vendorName}${contactName}. ` +
            `I've made a note about your call regarding ${vendorInfo.reason || 'your inquiry'}. ` +
            `Someone from our team will get back to you. Is there a reference number I should include?`;
        
        return {
            text: responseText,
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState: {
                ...callState,
                isVendorCall: true,
                vendorInfo,
                awaitingReferenceNumber: !vendorInfo.referenceNumber
            }
        };
    }
}

module.exports = {
    processTurn
};

