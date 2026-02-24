/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALL FLOW EXECUTOR
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Purpose: Dynamically execute call flow steps based on callFlowConfig
 * Features:
 * - Respects step order from callFlowConfig
 * - Skips disabled steps
 * - Handles short-circuits (early exits)
 * - Modular step execution
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');
const FrontlineIntel = require('./FrontlineIntel');
// ☢️ NUKED Feb 2026: CheatSheet system completely removed
const BehaviorEngine = require('./BehaviorEngine');
const EdgeCaseHandler = require('./EdgeCaseHandler');
// Use centralized Redis factory - NO db.redisClient
const { getSharedRedisClient, isRedisConfigured } = require('./redisClientFactory');

// Inline default (legacy - this executor is deprecated)
const defaultCallFlowConfig = [
  { id: 'spam-filter', name: 'Spam Filter', enabled: true, locked: true },
  { id: 'frontline-intel', name: 'Frontline Intel', enabled: true, locked: false },
  { id: 'edge-cases', name: 'Edge Cases', enabled: true, locked: false },
  // ☢️ NUKED Feb 2026: cheat-sheet step removed
  { id: 'behavior', name: 'Behavior Engine', enabled: true, locked: false },
  { id: 'llm-response', name: 'LLM Response', enabled: true, locked: true }
];

class CallFlowExecutor {
    
    // Helper to get Redis client from factory (async)
    static async getRedisClient() {
        if (!isRedisConfigured()) return null;
        try {
            return await getSharedRedisClient();
        } catch {
            return null;
        }
    }
    
    /**
     * ═════════════════════════════════════════════════════════════════════
     * ⚠️ LEGACY EXECUTOR - DO NOT USE FOR NEW CODE
     * ═════════════════════════════════════════════════════════════════════
     * 
     * This executor is DEPRECATED as of the Single Voice Architecture refactor.
     * 
     * NEW ARCHITECTURE:
     * - All calls go through: v2AIAgentRuntime → Brain1Runtime
     * - Response built by: ResponseConstructor.js (THE ONLY VOICE)
     * 
     * This legacy executor is kept for backward compatibility only.
     * The v2AIAgentRuntime.js has been updated to skip this executor
     * and always use Brain-1 path.
     * 
     * ═════════════════════════════════════════════════════════════════════
     * Execute steps in order defined by callFlowConfig
     * 
     * @param {Object} params - Execution parameters
     * @param {string} params.userInput - Caller input
     * @param {Object} params.company - Company document
     * @param {Object} params.callState - Current call state
     * @param {string} params.callId - Call ID
     * @param {string} params.companyID - Company ID
     * @param {Function} params.generateV2Response - Response generator function
     * @returns {Object} Execution result
     * @deprecated Use Brain1Runtime.processTurn() instead
     */
    static async execute(params) {
        const { userInput, company, callState, callId, companyID, generateV2Response } = params;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // DEPRECATION WARNING
        // ═══════════════════════════════════════════════════════════════════════════
        logger.warn('[CALL FLOW EXECUTOR] ⚠️ DEPRECATED EXECUTOR CALLED', {
            companyId: companyID,
            callId,
            note: 'This executor is deprecated. Use Brain1Runtime.processTurn() instead.'
        });
        
        // Load call flow configuration
        const callFlowConfig = company.aiAgentSettings?.callFlowConfig || defaultCallFlowConfig;
        
        logger.info(`[CALL FLOW EXECUTOR] 🎯 Executing dynamic call flow (${callFlowConfig.length} steps configured)`);
        
        // Initialize execution context
        const context = {
            userInput,
            processedInput: userInput,  // Will be updated by Frontline-Intel
            company,
            callState,
            callId,
            companyID,
            frontlineIntelResult: null,
            baseResponse: null,
            finalResponse: null,
            finalAction: 'continue',
            shortCircuit: false
            // ☢️ NUKED Feb 2026: cheatSheetMeta removed
        };
        
        // Execute steps in callFlowConfig order
        for (let i = 0; i < callFlowConfig.length; i++) {
            const step = callFlowConfig[i];
            
            // Skip disabled steps
            if (!step.enabled) {
                logger.info(`[CALL FLOW EXECUTOR] ⏭️ Step ${i + 1}/${callFlowConfig.length}: ${step.id} (DISABLED - skipping)`);
                continue;
            }
            
            logger.info(`[CALL FLOW EXECUTOR] ▶️ Step ${i + 1}/${callFlowConfig.length}: ${step.id} (executing...)`);
            
            // Execute step
            const stepResult = await this.executeStep(step, context, generateV2Response);
            
            // ═══════════════════════════════════════════════════════════════════
            // EXPLICIT FIELD MAPPING - Only merge known fields from step results
            // This prevents pollution from unexpected keys and makes debugging easier
            // ═══════════════════════════════════════════════════════════════════
            if (stepResult) {
                // Frontline-Intel outputs
                if (stepResult.frontlineIntelResult !== undefined) {
                    context.frontlineIntelResult = stepResult.frontlineIntelResult;
                }
                if (stepResult.processedInput !== undefined) {
                    context.processedInput = stepResult.processedInput;
                }
                
                // Response outputs
                if (stepResult.baseResponse !== undefined) {
                    context.baseResponse = stepResult.baseResponse;
                }
                if (stepResult.finalResponse !== undefined) {
                    context.finalResponse = stepResult.finalResponse;
                }
                if (stepResult.finalAction !== undefined) {
                    context.finalAction = stepResult.finalAction;
                }
                
                // Flow control
                if (stepResult.shortCircuit !== undefined) {
                    context.shortCircuit = stepResult.shortCircuit;
                }
                if (stepResult.edgeCaseTriggered !== undefined) {
                    context.edgeCaseTriggered = stepResult.edgeCaseTriggered;
                }
                
                // Metadata outputs
                // ☢️ NUKED Feb 2026: cheatSheetMeta handling removed
                if (stepResult.behaviorMeta !== undefined) {
                    context.behaviorMeta = stepResult.behaviorMeta;
                }
            }
            
            // Check for short-circuit (early exit)
            if (context.shortCircuit) {
                logger.info(`[CALL FLOW EXECUTOR] 🛑 Short-circuit detected at step: ${step.id}, ending flow early`);
                break;
            }
        }
        
        logger.info(`[CALL FLOW EXECUTOR] ✅ Call flow execution complete`);
        
        return context;
    }
    
    /**
     * ═════════════════════════════════════════════════════════════════════
     * EXECUTE INDIVIDUAL STEP
     * ═════════════════════════════════════════════════════════════════════
     */
    static async executeStep(step, context, generateV2Response) {
        const startTime = Date.now();
        
        try {
            switch (step.id) {
                case 'spamFilter':
                    return this.executeSpamFilter(step, context);
                    
                case 'edgeCases':
                    return this.executeEdgeCases(step, context);
                    
                case 'transferRules':
                    return this.executeTransferRules(step, context);
                    
                case 'frontlineIntel':
                    return await this.executeFrontlineIntel(step, context);
                    
                case 'scenarioMatching':
                    return await this.executeScenarioMatching(step, context, generateV2Response);
                    
                case 'guardrails':
                    return this.executeGuardrails(step, context);
                    
                case 'behaviorPolish':
                    return this.executeBehaviorPolish(step, context);
                    
                case 'contextInjection':
                    return this.executeContextInjection(step, context);
                    
                default:
                    logger.warn(`[CALL FLOW EXECUTOR] ⚠️ Unknown step: ${step.id}, skipping`);
                    return {};
            }
            
        } catch (error) {
            logger.error(`[CALL FLOW EXECUTOR] ❌ Step ${step.id} failed:`, error.message);
            // Continue execution (graceful degradation)
            return {};
        } finally {
            const duration = Date.now() - startTime;
            logger.info(`[CALL FLOW EXECUTOR] ⏱️ Step ${step.id} completed in ${duration}ms`);
        }
    }
    
    /**
     * ═════════════════════════════════════════════════════════════════════
     * STEP EXECUTORS
     * ═════════════════════════════════════════════════════════════════════
     */
    
    static executeSpamFilter(step, context) {
        // Spam filter runs in routes/calls.js (Layer 0 - before runtime)
        logger.info(`[CALL FLOW EXECUTOR] ✅ Spam Filter (already executed at Layer 0)`);
        return {};
    }
    
    static executeEdgeCases(step, context) {
        // ☢️ NUKED Feb 2026: CheatSheet-based edge cases removed
        logger.info(`[CALL FLOW EXECUTOR] ℹ️ Edge Cases (legacy - no-op)`);
        return {};
    }
    
    static executeTransferRules(step, context) {
        // ☢️ NUKED Feb 2026: CheatSheet-based transfer rules removed
        logger.info(`[CALL FLOW EXECUTOR] ℹ️ Transfer Rules (legacy - no-op)`);
        return {};
    }
    
    static async executeFrontlineIntel(step, context) {
        logger.info(`[CALL FLOW EXECUTOR] 🧠 Executing: Frontline-Intel (THE BODY)`);
        
        try {
            const callerPhone = context.callState.from || context.callState.callerPhone;
            const frontlineIntelResult = await FrontlineIntel.run(
                context.userInput,
                context.company,
                callerPhone
            );
            
            logger.info(`[CALL FLOW EXECUTOR] ✅ Frontline-Intel complete`, {
                intent: frontlineIntelResult.detectedIntent,
                confidence: frontlineIntelResult.confidence,
                shortCircuit: frontlineIntelResult.shouldShortCircuit
            });
            
            // 📊 STRUCTURED LOG 2: Frontline Triage Decision
            logger.info('[FRONTLINE]', {
                companyId: context.company._id.toString(),
                callSid: context.callState.callSid || context.callId,
                triageAction: frontlineIntelResult.triageDecision?.action || 'NONE',
                matchedRuleId: frontlineIntelResult.triageDecision?.ruleId || null,
                matchedCategory: frontlineIntelResult.triageDecision?.categorySlug || null,
                shouldShortCircuit: frontlineIntelResult.shouldShortCircuit,
                timestamp: new Date().toISOString()
            });
            
            // Check for short-circuit (wrong number, wrong service, etc.)
            if (frontlineIntelResult.shouldShortCircuit) {
                logger.warn(`[CALL FLOW EXECUTOR] 🛑 Frontline-Intel short-circuit detected`);
                return {
                    frontlineIntelResult,
                    finalResponse: frontlineIntelResult.shortCircuitResponse,
                    finalAction: frontlineIntelResult.callValidation?.correctService === false ? 'hangup' : 'continue',
                    shortCircuit: true
                };
            }
            
            // ═════════════════════════════════════════════════════════════════
            // 🚨 V23 EDGE CASE: Unknown Loop Prevention
            // ═════════════════════════════════════════════════════════════════
            const unknownCheck = EdgeCaseHandler.checkUnknownLoop(
                context.callState, 
                frontlineIntelResult.triageDecision
            );
            
            if (unknownCheck.shouldEscalate) {
                logger.warn(`[CALL FLOW EXECUTOR] ⚠️ Unknown loop detected - escalating to human`);
                return {
                    frontlineIntelResult,
                    finalResponse: unknownCheck.response,
                    finalAction: unknownCheck.action,
                    shortCircuit: true,
                    edgeCaseTriggered: 'UNKNOWN_LOOP'
                };
            }
            
            // If we got a clarification needed but not escalation
            if (unknownCheck.clarificationResponse && !frontlineIntelResult.triageDecision?.matched) {
                logger.info(`[CALL FLOW EXECUTOR] 🔄 Requesting clarification (attempt ${context.callState.consecutiveUnknowns})`);
                // Don't short-circuit, let the normal flow handle it with the clarification
                frontlineIntelResult.needsClarification = true;
                frontlineIntelResult.clarificationResponse = unknownCheck.clarificationResponse;
            }
            
            // ═════════════════════════════════════════════════════════════════
            // 🧠 THE BRAIN: Execute Triage Action (if present)
            // ═════════════════════════════════════════════════════════════════
            if (frontlineIntelResult.triageDecision) {
                const triage = frontlineIntelResult.triageDecision;
                
                logger.info(`[CALL FLOW EXECUTOR] 🧠 THE BRAIN: Executing triage action`, {
                    action: triage.action,
                    serviceType: triage.serviceType,
                    categorySlug: triage.categorySlug
                });
                
                // Execute action based on THE BRAIN's decision
                switch (triage.action) {
                    case 'ESCALATE_TO_HUMAN':
                        logger.info(`[CALL FLOW EXECUTOR] 🧠 THE BRAIN → ESCALATE_TO_HUMAN`);
                        return {
                            frontlineIntelResult,
                            finalResponse: `I understand. Let me transfer you to someone who can assist with that right away. Please hold.`,
                            finalAction: 'transfer',
                            shortCircuit: true
                        };
                    
                    case 'TAKE_MESSAGE':
                        logger.info(`[CALL FLOW EXECUTOR] 🧠 THE BRAIN → TAKE_MESSAGE`);
                        return {
                            frontlineIntelResult,
                            finalResponse: `I'd be happy to take a message. Could you please provide your name and phone number, and I'll make sure someone gets back to you?`,
                            finalAction: 'continue',
                            shortCircuit: true
                        };
                    
                    case 'END_CALL_POLITE':
                        logger.info(`[CALL FLOW EXECUTOR] 🧠 THE BRAIN → END_CALL_POLITE`);
                        return {
                            frontlineIntelResult,
                            finalResponse: `Thank you for calling. Have a great day!`,
                            finalAction: 'hangup',
                            shortCircuit: true
                        };
                    
                    case 'EXPLAIN_AND_PUSH':
                    case 'DIRECT_TO_3TIER':
                    default:
                        logger.info(`[CALL FLOW EXECUTOR] 🧠 THE BRAIN → ${triage.action} (continue to scenario matching)`);
                        // Store triage decision, continue to scenario matching
                        context.callState.triageDecision = triage;
                        context.callState.triageAction = triage.action;
                        break;
                }
            }
            
            // Use cleaned input for further processing
            const processedInput = frontlineIntelResult.cleanedInput || context.userInput;
            
            return {
                frontlineIntelResult,
                processedInput
            };
            
        } catch (error) {
            logger.error(`[CALL FLOW EXECUTOR] ❌ Frontline-Intel failed:`, error.message);
            // Continue with raw input (graceful degradation)
            return { processedInput: context.userInput };
        }
    }
    
    static async executeScenarioMatching(step, context, generateV2Response) {
        logger.info(`[CALL FLOW EXECUTOR] 🎯 Executing: Scenario Matching (3-Tier Intelligence)`);
        
        try {
            const baseResponse = await generateV2Response(
                context.processedInput,
                context.company,
                context.callState
            );
            
            logger.info(`[CALL FLOW EXECUTOR] ✅ Scenario Matching complete: "${baseResponse.text?.substring(0, 100)}..."`);
            
            // 📊 STRUCTURED LOG 3: 3-Tier Intelligence Result
            logger.info('[3TIER]', {
                companyId: context.company._id.toString(),
                callSid: context.callState.callSid || context.callId,
                tierUsed: baseResponse.metadata?.trace?.tierUsed || 'UNKNOWN',
                source: baseResponse.source || null,
                confidence: baseResponse.confidence || null,
                scenarioId: baseResponse.metadata?.scenarioId || null,
                scenarioCategory: baseResponse.metadata?.category || null,
                timestamp: new Date().toISOString()
            });
            
            // ☢️ NUKED Feb 2026: CheatSheet system completely removed
            let finalResponse = baseResponse.text;
            let finalAction = baseResponse.action || 'continue';
            
            // ═════════════════════════════════════════════════════════════════
            // 🎭 BEHAVIOR ENGINE: Apply HYBRID tone styling (V23)
            // ═════════════════════════════════════════════════════════════════
            let behaviorTone = 'NEUTRAL';
            let styleInstructions = null;
            let behaviorSignals = null;
            
            const behaviorProfile = context.company?.aiAgentSettings?.behaviorProfile;
            
            if (behaviorProfile && behaviorProfile.mode === 'HYBRID') {
                try {
                    logger.info(`[CALL FLOW EXECUTOR] 🎭 Applying BehaviorEngine (HYBRID mode)...`);
                    
                    // Build context for BehaviorEngine
                    const behaviorContext = {
                        company: context.company,
                        companyId: context.companyID,
                        tradeKey: context.company?.trade || context.callState?.triageDecision?.tradeKey,
                        triageDecision: context.callState?.triageDecision || frontlineIntelResult?.triageDecision,
                        latestUserMessage: context.userInput
                    };
                    
                    const behaviorResult = BehaviorEngine.applyHybridStyle(behaviorContext, finalResponse);
                    
                    behaviorTone = behaviorResult.tone || 'NEUTRAL';
                    styleInstructions = behaviorResult.styleInstructions || null;
                    behaviorSignals = behaviorResult.signals || null;
                    
                    // 📊 STRUCTURED LOG 5: Behavior Engine Decision
                    logger.info('[BEHAVIOR]', {
                        companyId: context.company._id.toString(),
                        callSid: context.callState.callSid || context.callId,
                        mode: 'HYBRID',
                        tone: behaviorTone,
                        signals: {
                            hasEmergency: behaviorSignals?.hasEmergency || false,
                            hasBillingConflict: behaviorSignals?.hasBillingConflict || false,
                            userIsJoking: behaviorSignals?.userIsJoking || false
                        },
                        intent: behaviorContext.triageDecision?.intent || 'UNKNOWN',
                        humorLevel: styleInstructions?.humorLevel || 0,
                        timestamp: new Date().toISOString()
                    });
                    
                    logger.info(`[CALL FLOW EXECUTOR] ✅ BehaviorEngine applied → tone: ${behaviorTone}`);
                    
                    // ═════════════════════════════════════════════════════════════════
                    // 🎙️ LLM-C VOICE STYLING (Optional - if styleInstructions present)
                    // ═════════════════════════════════════════════════════════════════
                    // TODO: Future enhancement - call LLM-C to restyle the response
                    // based on styleInstructions. For now, we just log the decision.
                    // The response text remains as-is, but tone/style metadata is captured.
                    //
                    // When ready to enable LLM-C styling:
                    // if (styleInstructions && finalResponse) {
                    //     finalResponse = await callLLMC({
                    //         companyName: context.company.companyName,
                    //         responseTemplate: finalResponse,
                    //         styleInstructions
                    //     });
                    // }
                    // ═════════════════════════════════════════════════════════════════
                    
                } catch (behaviorErr) {
                    logger.error(`[CALL FLOW EXECUTOR] ❌ BehaviorEngine failed:`, behaviorErr.message);
                    // Continue without behavior styling (graceful degradation)
                }
            }
            
            return {
                baseResponse,
                finalResponse,
                finalAction,
                // ☢️ NUKED Feb 2026: cheatSheetMeta removed
                // V23: Behavior Engine metadata
                behaviorMeta: behaviorProfile?.mode === 'HYBRID' ? {
                    tone: behaviorTone,
                    styleInstructions,
                    signals: behaviorSignals
                } : null
            };
            
        } catch (error) {
            logger.error(`[CALL FLOW EXECUTOR] ❌ Scenario Matching failed:`, error.message);
            return {
                finalResponse: "I'm not sure how to help with that. Let me transfer you to someone who can assist.",
                finalAction: 'transfer'
            };
        }
    }
    
    static executeGuardrails(step, context) {
        // ☢️ NUKED Feb 2026: CheatSheet guardrails removed
        logger.info(`[CALL FLOW EXECUTOR] ℹ️ Guardrails (legacy - no-op)`);
        return {};
    }
    
    static executeBehaviorPolish(step, context) {
        // ☢️ NUKED Feb 2026: CheatSheet behavior polish removed
        logger.info(`[CALL FLOW EXECUTOR] ℹ️ Behavior Polish (legacy - no-op)`);
        return {};
    }
    
    static executeContextInjection(step, context) {
        // Context Injection happens as part of response generation
        logger.info(`[CALL FLOW EXECUTOR] ℹ️ Context Injection (handled by response generator)`);
        return {};
    }
}

module.exports = CallFlowExecutor;

