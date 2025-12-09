/**
 * ============================================================================
 * LLM-0 TURN HANDLER - Route LLM-0 Decisions to Execution
 * ============================================================================
 * 
 * POSITION IN ARCHITECTURE:
 *   Brain 1 (LLM-0) → Triage Router → [LLM0 TURN HANDLER] → Execution
 * 
 * This is the execution layer. Once LLM-0 has decided what to do and
 * the Triage Router has determined the route, this handler executes it.
 * 
 * RESPONSIBILITIES:
 * 1. Take LLM-0 decision + Triage route
 * 2. Execute appropriate handler (3-Tier, Booking, Transfer, Message)
 * 3. Return TwiML-ready response
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const TriageRouter = require('./TriageRouter');
const AIBrain3tierllm = require('./AIBrain3tierllm');
const SmartConfirmationService = require('./SmartConfirmationService');
const { DEFAULT_FRONT_DESK_CONFIG } = require('../config/frontDeskPrompt');
const BookingConversationLLM = require('./BookingConversationLLM');
const HybridReceptionistLLM = require('./HybridReceptionistLLM');
const ConversationStateManager = require('./ConversationStateManager');

// ════════════════════════════════════════════════════════════════════════════
// FRONT DESK BEHAVIOR - UI-Controlled Response Text
// ════════════════════════════════════════════════════════════════════════════
// All responses come from company config, not hardcoded text
// Admin can edit every phrase in Control Plane → Live Agent Status → Front Desk
// ════════════════════════════════════════════════════════════════════════════

/**
 * Load and merge Front Desk Behavior config with defaults
 * @param {Object} company - Company document
 * @returns {Object} Merged config
 */
function getFrontDeskConfig(company) {
    const saved = company?.aiAgentSettings?.frontDeskBehavior || {};
    return deepMerge(DEFAULT_FRONT_DESK_CONFIG, saved);
}

/**
 * Deep merge helper
 */
function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source || {})) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(result[key] || {}, source[key]);
        } else if (source[key] !== undefined) {
            result[key] = source[key];
        }
    }
    return result;
}

/**
 * @typedef {Object} TurnResult
 * @property {string} text - What to say to the caller
 * @property {string} action - Final action ('continue'|'transfer'|'hangup')
 * @property {boolean} shouldTransfer - Should transfer to human
 * @property {boolean} shouldHangup - Should end the call
 * @property {Object} callState - Updated call state
 * @property {Object} debug - Debug information
 */

class LLM0TurnHandler {
    
    /**
     * Process an LLM-0 decision through triage and execute the appropriate handler
     * 
     * @param {Object} params
     * @param {import('./orchestration/LLM0Contracts').LLM0Decision} params.decision - LLM-0's decision
     * @param {Object} params.company - Company document
     * @param {Object} params.callState - Current call state
     * @param {string} params.userInput - Original caller input
     * @returns {Promise<TurnResult>}
     */
    static async handle({ decision, company, callState, userInput }) {
        const startTime = Date.now();
        const companyId = company._id?.toString() || company.companyId;
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🚀 HYBRID FAST PATH - Use smart LLM for ALL turns (Dec 2025)
        // ════════════════════════════════════════════════════════════════════════════
        // Instead of slow legacy routing, use HybridReceptionistLLM for everything.
        // This gives us: fast responses, name capture, smart conversation, empathy.
        // The LLM handles free talk, booking, triage - all modes.
        // ════════════════════════════════════════════════════════════════════════════
        const useHybridForAll = company?.aiAgentSettings?.callFlowEngine?.enabled !== false;
        
        if (useHybridForAll) {
            try {
                return await this.handleWithHybridLLM({
                    company,
                    callState,
                    userInput,
                    decision,
                    startTime
                });
            } catch (hybridError) {
                logger.error('[LLM0 TURN HANDLER] Hybrid path failed, falling back to legacy', {
                    error: hybridError.message,
                    stack: hybridError.stack?.substring(0, 500)
                });
                // Fall through to legacy path
            }
        }
        const callId = callState?.callId || callState?.CallSid;
        const turnNumber = (callState?.turnCount || 0) + 1;
        
        logger.info('[LLM0 TURN HANDLER] Processing turn', {
            companyId,
            callId,
            action: decision.action,
            intentTag: decision.intentTag,
            bookingModeLocked: !!callState?.bookingModeLocked
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🚫 SPAM DETECTION (Layer 3) - Check before any other processing
        // ════════════════════════════════════════════════════════════════════════════
        // Uses configurable LLM-0 Controls for spam phrase detection
        // If spam detected: dismiss politely and log to Black Box
        // ════════════════════════════════════════════════════════════════════════════
        const llm0Controls = callState?.llm0Controls;
        if (llm0Controls?.spamFilter?.enabled && userInput) {
            const LLM0ControlsLoader = require('./LLM0ControlsLoader');
            
            if (LLM0ControlsLoader.isSpamPhrase(userInput, llm0Controls)) {
                logger.info('[LLM0 TURN HANDLER] 🚫 SPAM DETECTED - Telemarketer phrase matched', {
                    companyId,
                    callId,
                    turn: turnNumber,
                    input: userInput.substring(0, 100),
                    action: llm0Controls.spamFilter.onSpamDetected
                });
                
                // Log to Black Box
                if (llm0Controls.spamFilter.logToBlackBox) {
                    try {
                        const BlackBoxLogger = require('./BlackBoxLogger');
                        await BlackBoxLogger.logEvent({
                            callId,
                            companyId,
                            type: 'SPAM_DETECTED',
                            turn: turnNumber,
                            data: {
                                input: userInput.substring(0, 200),
                                action: llm0Controls.spamFilter.onSpamDetected,
                                suggestion: 'Add to Edge Cases for Layer 2 blocking (FREE)'
                            }
                        });
                    } catch (logErr) {
                        logger.warn('[LLM0 TURN HANDLER] Failed to log spam to Black Box');
                    }
                }
                
                // Return spam response based on configured action
                if (llm0Controls.spamFilter.onSpamDetected === 'polite_dismiss') {
                    return {
                        text: llm0Controls.spamFilter.dismissMessage,
                        action: 'hangup',
                        shouldHangup: true,
                        shouldTransfer: false,
                        callState: { ...callState, spamDetected: true },
                        debug: {
                            route: 'SPAM_FILTER',
                            reason: 'Telemarketer phrase detected - polite dismiss'
                        }
                    };
                } else if (llm0Controls.spamFilter.onSpamDetected === 'silent_hangup') {
                    return {
                        text: '',
                        action: 'hangup',
                        shouldHangup: true,
                        shouldTransfer: false,
                        callState: { ...callState, spamDetected: true },
                        debug: {
                            route: 'SPAM_FILTER',
                            reason: 'Telemarketer phrase detected - silent hangup'
                        }
                    };
                }
                // 'flag_only' continues processing
            }
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🔒 BOOKING HARD LOCK - MUST BE FIRST CHECK
        // ════════════════════════════════════════════════════════════════════════════
        // Once bookingModeLocked = true, we BYPASS:
        //   - LLM-0 decision (already analyzed, ignore it)
        //   - Triage routing (booking owns the conversation)
        //   - All other handlers
        // 
        // We go STRAIGHT to BookingSlotFill for simple extraction.
        // This prevents troubleshooting from hijacking the booking flow.
        // ════════════════════════════════════════════════════════════════════════════
        if (callState?.bookingModeLocked && callState?.bookingState) {
            logger.info('[LLM0 TURN HANDLER] 🔒 BOOKING HARD LOCK ACTIVE - Bypassing all routing', {
                companyId,
                callId,
                turn: turnNumber,
                bookingState: callState.bookingState,
                currentStep: callState.currentBookingStep,
                ignoredDecision: decision.action,
                userInputPreview: userInput?.substring(0, 50)
            });
            
            try {
                // Go straight to slot-filling - no triage, no Brain-2
                const bookingResult = await this.handleBookingSlotFill({
                    companyId,
                    callId,
                    userInput,
                    callState,
                    turnNumber
                });
                
                logger.info('[LLM0 TURN HANDLER] ✅ SLOT-FILL COMPLETED', {
                    companyId,
                    callId,
                    responsePreview: bookingResult.text?.substring(0, 80),
                    nextStep: bookingResult.callState?.currentBookingStep,
                    extractedName: bookingResult.callState?.bookingCollected?.name
                });
                
                return bookingResult;
            } catch (slotFillError) {
                // 🚨 CRITICAL: Log the exact error so we can fix it!
                logger.error('[LLM0 TURN HANDLER] 🔴 SLOT-FILL ERROR - This is causing generic fallback!', {
                    companyId,
                    callId,
                    errorMessage: slotFillError.message,
                    errorStack: slotFillError.stack?.substring(0, 500),
                    userInput: userInput?.substring(0, 100),
                    bookingState: callState.bookingState,
                    currentStep: callState.currentBookingStep
                });
                
                // Log to Black Box for visibility
                try {
                    const BlackBoxLogger = require('./BlackBoxLogger');
                    await BlackBoxLogger.logEvent({
                        callId,
                        companyId,
                        type: 'SLOT_FILL_ERROR',
                        data: {
                            error: slotFillError.message,
                            stack: slotFillError.stack?.substring(0, 300),
                            userInput: userInput?.substring(0, 100),
                            bookingState: callState.bookingState,
                            currentStep: callState.currentBookingStep
                        }
                    });
                } catch (logErr) {}
                
                // Re-throw to let the outer handler deal with it
                throw slotFillError;
            }
        }
        
        // ====================================================================
        // STEP 1: Route through Triage
        // ====================================================================
        let triageResult;
        
        try {
            triageResult = await TriageRouter.route(decision, company);
            
            logger.info('[LLM0 TURN HANDLER] Triage result', {
                companyId,
                callId,
                route: triageResult.route,
                matchedCard: triageResult.matchedCardName,
                reason: triageResult.reason
            });
            
        } catch (triageError) {
            logger.error('[LLM0 TURN HANDLER] Triage failed, using direct action', {
                companyId,
                callId,
                error: triageError.message
            });
            
            // Fallback to direct action mapping
            triageResult = {
                route: this.actionToRoute(decision.action),
                matchedCardId: null,
                matchedCardName: null,
                scenarioKey: decision.scenarioHints?.scenarioKey,
                categoryKey: decision.scenarioHints?.categoryKey,
                transferTarget: null,
                reason: `Fallback from action: ${decision.action}`
            };
        }
        
        // ====================================================================
        // STEP 1.5: SMART CONFIRMATION CHECK (Dec 2025)
        // ====================================================================
        // Check if we're waiting for a confirmation response
        if (callState?.pendingConfirmation && userInput) {
            const confirmResult = SmartConfirmationService.processConfirmationResponse({
                userInput,
                callState,
                llm0Controls
            });
            
            logger.info('[LLM0 TURN HANDLER] ✅ Processing confirmation response', {
                companyId,
                callId,
                confirmed: confirmResult.confirmed,
                nextAction: confirmResult.nextAction
            });
            
            // 📦 BLACK BOX: Log confirmation response
            try {
                const BlackBoxLogger = require('./BlackBoxLogger');
                await BlackBoxLogger.logEvent({
                    callId,
                    companyId,
                    type: 'SMART_CONFIRMATION_RESPONSE',
                    turn: turnNumber,
                    data: {
                        callerInput: userInput.substring(0, 100),
                        confirmed: confirmResult.confirmed,
                        pendingAction: callState.pendingAction,
                        severity: callState.pendingSeverity,
                        recovery: confirmResult.nextAction,
                        ...confirmResult.debug
                    }
                });
            } catch (logErr) {
                logger.debug('[LLM0 TURN HANDLER] Failed to log confirmation response to Black Box');
            }
            
            if (confirmResult.confirmed) {
                // User confirmed - proceed with original action
                // ⚠️ Extract originalDecision BEFORE clearing state (clearPendingState deletes it!)
                const originalAction = callState.originalDecision?.action;
                const clearedState = SmartConfirmationService.clearPendingState(callState);
                callState = clearedState;
                
                // Restore original decision/route
                if (originalAction) {
                    triageResult.route = this.actionToRoute(originalAction);
                }
            } else {
                // User said NO or was ambiguous
                return {
                    text: confirmResult.responseText,
                    action: 'continue',
                    shouldTransfer: false,
                    shouldHangup: false,
                    callState: SmartConfirmationService.clearPendingState(callState),
                    debug: {
                        route: 'CONFIRMATION_DECLINED',
                        ...confirmResult.debug
                    }
                };
            }
        }
        
        // Check if THIS decision needs confirmation before executing
        const confirmCheck = SmartConfirmationService.checkIfConfirmationNeeded({
            action: triageResult.route,
            confidence: decision.confidence || 0.5,
            llm0Controls,
            callState
        });
        
        if (confirmCheck.needsConfirmation) {
            logger.info('[LLM0 TURN HANDLER] ✅ Confirmation required before action', {
                companyId,
                callId,
                route: triageResult.route,
                severity: confirmCheck.severity
            });
            
            // 📦 BLACK BOX: Log confirmation question
            try {
                const BlackBoxLogger = require('./BlackBoxLogger');
                await BlackBoxLogger.logEvent({
                    callId,
                    companyId,
                    type: 'SMART_CONFIRMATION_ASKED',
                    turn: turnNumber,
                    data: {
                        pendingAction: confirmCheck.pendingAction,
                        severity: confirmCheck.severity,
                        confidence: decision.confidence,
                        reason: confirmCheck.reason || `${confirmCheck.pendingAction} requires confirmation`,
                        phrase: confirmCheck.confirmationPhrase.substring(0, 100),
                        originalRoute: triageResult.route
                    }
                });
            } catch (logErr) {
                logger.debug('[LLM0 TURN HANDLER] Failed to log confirmation question to Black Box');
            }
            
            return {
                text: confirmCheck.confirmationPhrase,
                action: 'continue',  // Stay on line, wait for yes/no
                shouldTransfer: false,
                shouldHangup: false,
                callState: SmartConfirmationService.buildPendingState(
                    callState, 
                    confirmCheck, 
                    { action: triageResult.route, confidence: decision.confidence }
                ),
                debug: {
                    route: 'CONFIRMATION_REQUIRED',
                    pendingAction: confirmCheck.pendingAction,
                    severity: confirmCheck.severity
                }
            };
        }
        
        // ====================================================================
        // STEP 2: Execute based on route
        // ====================================================================
        let result;
        
        try {
            switch (triageResult.route) {
                case 'SCENARIO_ENGINE':
                    result = await this.handleScenarioEngine({
                        decision,
                        company,
                        callState,
                        userInput,
                        triageResult
                    });
                    break;
                    
                case 'BOOKING':
                    result = await this.handleBooking({
                        decision,
                        company,
                        callState,
                        userInput
                    });
                    break;
                    
                case 'TRANSFER':
                    result = await this.handleTransfer({
                        decision,
                        company,
                        callState,
                        triageResult
                    });
                    break;
                    
                case 'MESSAGE_ONLY':
                    result = await this.handleMessageOnly({
                        decision,
                        company,
                        callState
                    });
                    break;
                    
                case 'END_CALL':
                    result = await this.handleEndCall({
                        decision,
                        company,
                        callState
                    });
                    break;
                    
                case 'UNKNOWN':
                default:
                    // Fallback to scenario engine
                    result = await this.handleScenarioEngine({
                        decision,
                        company,
                        callState,
                        userInput,
                        triageResult
                    });
                    break;
            }
            
        } catch (handlerError) {
            logger.error('[LLM0 TURN HANDLER] Handler execution failed', {
                companyId,
                callId,
                route: triageResult.route,
                error: handlerError.message
            });
            
            // Emergency fallback
            result = {
                text: decision.nextPrompt || "I'm here to help. What can I assist you with?",
                action: 'continue',
                shouldTransfer: false,
                shouldHangup: false,
                callState,
                debug: {
                    error: handlerError.message,
                    route: triageResult.route
                }
            };
        }
        
        // ====================================================================
        // STEP 3: Update call state with LLM-0 decision data
        // ====================================================================
        const updatedCallState = {
            ...callState,
            lastIntent: decision.intentTag,
            lastAction: decision.action,
            entities: {
                ...(callState.entities || {}),
                ...(decision.entities || {})
            },
            flags: {
                ...(callState.flags || {}),
                ...decision.flags
            },
            triageHistory: [
                ...(callState.triageHistory || []),
                {
                    timestamp: Date.now(),
                    route: triageResult.route,
                    matchedCard: triageResult.matchedCardName,
                    action: decision.action
                }
            ].slice(-10) // Keep last 10 triage decisions
        };
        
        result.callState = updatedCallState;
        
        // ====================================================================
        // STEP 4: Log and return
        // ====================================================================
        const duration = Date.now() - startTime;
        
        logger.info('[LLM0 TURN HANDLER] Turn complete', {
            companyId,
            callId,
            route: triageResult.route,
            finalAction: result.action,
            durationMs: duration,
            responseLength: result.text?.length || 0
        });
        
        return result;
    }
    
    /**
     * Handle SCENARIO_ENGINE route - calls Brain 2 (3-Tier)
     * @private
     */
    static async handleScenarioEngine({ decision, company, callState, userInput, triageResult }) {
        const companyId = company._id?.toString() || company.companyId;
        const callId = callState?.callId || callState?.CallSid;
        
        logger.info('[LLM0 TURN HANDLER] Routing to 3-Tier Scenario Engine', {
            companyId,
            callId,
            scenarioHint: triageResult.scenarioKey,
            categoryHint: triageResult.categoryKey
        });
        
        try {
            // Call Brain 2 (3-Tier Intelligence System)
            // AIBrain3tierllm.query(companyId, query, context)
            const brain = new AIBrain3tierllm();
            const brainResult = await brain.query(companyId, userInput, {
                callState,
                routingId: `llm0-${callId}-${Date.now()}`,
                scenarioHints: {
                    scenarioKey: triageResult.scenarioKey,
                    categoryKey: triageResult.categoryKey
                },
                intent: decision.intentTag,
                entities: decision.entities,
                flags: decision.flags
            });
            
            logger.info('[LLM0 TURN HANDLER] 3-Tier result', {
                companyId,
                callId,
                tier: brainResult.tier,
                confidence: brainResult.confidence,
                hasResponse: !!brainResult.response
            });
            
            // Use 3-Tier response if available, otherwise use LLM-0's response
            const responseText = brainResult.response || decision.nextPrompt || 
                "I can help you with that. Could you tell me more?";
            
            return {
                text: responseText,
                action: 'continue',
                shouldTransfer: false,
                shouldHangup: false,
                callState,
                debug: {
                    route: 'SCENARIO_ENGINE',
                    tier: brainResult.tier,
                    confidence: brainResult.confidence,
                    scenarioMatched: brainResult.scenario?.name
                }
            };
            
        } catch (error) {
            logger.error('[LLM0 TURN HANDLER] 3-Tier call failed', {
                companyId,
                callId,
                error: error.message
            });
            
            // Fallback to LLM-0's response
            return {
                text: decision.nextPrompt || "I can help you with that. What would you like to know?",
                action: 'continue',
                shouldTransfer: false,
                shouldHangup: false,
                callState,
                debug: {
                    route: 'SCENARIO_ENGINE',
                    error: error.message,
                    usedFallback: true
                }
            };
        }
    }
    
    /**
     * Handle BOOKING route
     * @private
     */
    static async handleBooking({ decision, company, callState, userInput }) {
        const companyId = company._id?.toString() || company.companyId;
        const callId = callState?.callId || callState?.CallSid;
        
        logger.info('[LLM0 TURN HANDLER] Processing booking request', {
            companyId,
            callId,
            hasContact: !!decision.entities?.contact,
            hasLocation: !!decision.entities?.location,
            hasScheduling: !!decision.entities?.scheduling
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🔧 SERVICE TYPE CLARIFICATION - REMOVED Dec 2025
        // This was redundant with Triage. Triage handles intent clarification.
        // ════════════════════════════════════════════════════════════════════════════
        
        // ServiceTypeClarifier REMOVED - Triage handles this now
        const stConfig = null; // Disabled
        
        // Check if service type already determined (from previous turn or clear keywords)
        if (!callState?.serviceTypeDetected) {
            const clarifyResult = ServiceTypeClarifier.shouldClarify(userInput, stConfig);
            
            // 🔍 LOG ALL SERVICE TYPE DECISIONS for debugging
            logger.info('[LLM0 TURN HANDLER] 🔧 SERVICE TYPE CHECK', {
                companyId,
                callId,
                userInput: userInput?.substring(0, 100),
                needsClarification: clarifyResult.needsClarification,
                reason: clarifyResult.reason,
                matchedPhrase: clarifyResult.matchedPhrase,
                detectedType: clarifyResult.detectedType?.key,
                configEnabled: stConfig?.enabled !== false,
                hasAmbiguousPhrases: stConfig?.ambiguousPhrases?.length || 'using defaults'
            });
            
            // Log to Black Box for ALL decisions (not just when clarification needed)
            try {
                const BlackBoxLogger = require('./BlackBoxLogger');
                await BlackBoxLogger.logEvent({
                    callId,
                    companyId,
                    type: 'SERVICE_TYPE_CHECK',
                    data: {
                        userInput: userInput?.substring(0, 100),
                        needsClarification: clarifyResult.needsClarification,
                        reason: clarifyResult.reason,
                        matchedPhrase: clarifyResult.matchedPhrase,
                        detectedType: clarifyResult.detectedType?.key || null,
                        configPresent: !!stConfig,
                        configEnabled: stConfig?.enabled !== false
                    }
                });
            } catch (logErr) {
                logger.debug('[LLM0 TURN HANDLER] Black Box log failed');
            }
            
            if (clarifyResult.needsClarification) {
                // Service type is ambiguous - ask for clarification
                const question = ServiceTypeClarifier.getClarificationQuestion(stConfig);
                
                logger.info('[LLM0 TURN HANDLER] 🔧 SERVICE TYPE CLARIFICATION NEEDED', {
                    companyId,
                    callId,
                    reason: clarifyResult.reason,
                    matchedPhrase: clarifyResult.matchedPhrase
                });
                
                // Log to Black Box
                try {
                    const BlackBoxLogger = require('./BlackBoxLogger');
                    await BlackBoxLogger.logEvent({
                        callId,
                        companyId,
                        type: 'SERVICE_TYPE_CLARIFICATION_ASKED',
                        data: {
                            userInput: userInput?.substring(0, 100),
                            reason: clarifyResult.reason,
                            matchedPhrase: clarifyResult.matchedPhrase
                        }
                    });
                } catch (logErr) {
                    logger.debug('[LLM0 TURN HANDLER] Black Box log failed');
                }
                
                return {
                    text: question,
                    action: 'continue',
                    shouldTransfer: false,
                    shouldHangup: false,
                    callState: {
                        ...callState,
                        // Mark that we're waiting for service type clarification
                        serviceTypeClarificationAsked: true,
                        bookingState: 'ASK_SERVICE_TYPE',
                        currentBookingStep: 'ASK_SERVICE_TYPE'
                    },
                    debug: {
                        route: 'BOOKING',
                        awaitingServiceType: true,
                        clarificationReason: clarifyResult.reason
                    }
                };
            }
            
            // Check if we can detect service type from the input (clear keywords)
            const detected = clarifyResult.detectedType || ServiceTypeClarifier.detectServiceType(userInput, stConfig);
            if (detected) {
                logger.info('[LLM0 TURN HANDLER] 🔧 SERVICE TYPE AUTO-DETECTED', {
                    companyId,
                    callId,
                    serviceType: detected.key,
                    matchedKeyword: detected.matchedKeyword
                });
                
                // Store detected service type in callState
                callState.serviceTypeDetected = detected;
                
                // Log to Black Box
                try {
                    const BlackBoxLogger = require('./BlackBoxLogger');
                    await BlackBoxLogger.logEvent({
                        callId,
                        companyId,
                        type: 'SERVICE_TYPE_DETECTED',
                        data: {
                            serviceType: detected.key,
                            label: detected.label,
                            matchedKeyword: detected.matchedKeyword,
                            calendarId: detected.calendarId,
                            source: 'auto_detection'
                        }
                    });
                } catch (logErr) {
                    logger.debug('[LLM0 TURN HANDLER] Black Box log failed');
                }
            }
        }
        
        // Check if we have minimum required info for booking
        const contact = decision.entities?.contact || {};
        const location = decision.entities?.location || {};
        const scheduling = decision.entities?.scheduling || {};
        
        const hasMinimumInfo = contact.name && (contact.phone || contact.email) &&
                              location.addressLine1 && scheduling.preferredDate;
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🔒 CRITICAL: Set HARD LOCK immediately upon entering booking
        // This prevents ALL subsequent turns from going through triage/Brain-1
        // ════════════════════════════════════════════════════════════════════════════
        
        // Determine which slot to ask for next
        let currentStep = 'ASK_NAME';
        let prompt = "I'd be happy to schedule that for you. May I have your name please?";
        
        // Build initial collected data
        const bookingCollected = {
            name: contact.name || null,
            phone: contact.phone || null,
            address: location.addressLine1 || null,
            time: scheduling.preferredDate || scheduling.preferredWindow || null
        };
        
        // Determine next step based on what we have
        if (!contact.name) {
            currentStep = 'ASK_NAME';
            prompt = "I'd be happy to schedule that for you. May I have your name please?";
        } else if (!contact.phone) {
            currentStep = 'ASK_PHONE';
            prompt = `Thanks, ${contact.name}. And what's the best phone number to reach you?`;
        } else if (!location.addressLine1) {
            currentStep = 'ASK_ADDRESS';
            prompt = "Great. What's the service address?";
        } else if (!scheduling.preferredDate && !scheduling.preferredWindow) {
            currentStep = 'ASK_TIME';
            prompt = "When would be a good time for us to come out?";
        } else {
            currentStep = 'CONFIRM';
            const timeText = scheduling.preferredDate || scheduling.preferredWindow || 'soon';
            prompt = `Perfect! I have ${contact.name} at ${location.addressLine1} for ${timeText}. I'll get that scheduled and someone will confirm with you shortly. Is there anything else I can help you with?`;
        }
        
        const slotsRemaining = [
            !bookingCollected.name,
            !bookingCollected.phone,
            !bookingCollected.address,
            !bookingCollected.time
        ].filter(Boolean).length;
        
        logger.info('[LLM0 TURN HANDLER] 🔒 BOOKING HARD LOCK ENGAGED', {
            companyId,
            callId,
            currentStep,
            slotsRemaining,
            collected: Object.keys(bookingCollected).filter(k => bookingCollected[k])
        });
        
        return {
            text: prompt,
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState: {
                ...callState,
                // 🔒 THE HARD LOCK
                bookingModeLocked: true,
                bookingState: currentStep,
                currentBookingStep: currentStep,
                bookingCollected,
                bookingReady: currentStep === 'CONFIRM'
            },
            debug: {
                route: 'BOOKING',
                hardLocked: true,
                currentStep,
                slotsRemaining
            }
        };
    }
    
    /**
     * ════════════════════════════════════════════════════════════════════════════
     * 🧠 HYBRID RECEPTIONIST - The REAL AI Brain
     * ════════════════════════════════════════════════════════════════════════════
     * 
     * This is what makes the AI "worth paying for."
     * 
     * The LLM gets:
     *   - Full conversation history
     *   - All known slots
     *   - Current mode (free/booking/rescue)
     *   - Behavior rules
     * 
     * The LLM returns:
     *   - Natural conversational reply
     *   - Updated slots
     *   - Next goal
     *   - Signals (frustrated, wants human, etc.)
     * 
     * We TRUST the LLM's reply and send it to TTS.
     * No more overriding with templates.
     * 
     * @private
     */
    static async handleBookingSlotFill({ companyId, callId, userInput, callState, turnNumber }) {
        const currentStep = callState.currentBookingStep || callState.bookingState || 'free';
        const existingSlots = { ...callState.bookingCollected } || {};
        
        logger.info('[LLM0 TURN HANDLER] 🧠 HYBRID RECEPTIONIST ENGAGED', {
            companyId,
            callId,
            turn: turnNumber,
            currentStep,
            existingSlots: Object.keys(existingSlots).filter(k => existingSlots[k]),
            userInput: userInput?.substring(0, 60)
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // 📋 LOAD COMPANY AND BEHAVIOR CONFIG
        // ════════════════════════════════════════════════════════════════════════════
        let frontDeskConfig = DEFAULT_FRONT_DESK_CONFIG;
        let company = null;
        
        try {
            const v2Company = require('../models/v2Company');
            company = await v2Company.findById(companyId).lean();
            frontDeskConfig = getFrontDeskConfig(company);
        } catch (e) {
            logger.warn('[LLM0 TURN HANDLER] Could not load company config, using defaults');
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 💬 GET CONVERSATION HISTORY
        // ════════════════════════════════════════════════════════════════════════════
        const conversationState = await ConversationStateManager.getState(callId);
        const conversationHistory = conversationState.history || [];
        
        // Add caller's current input to history
        await ConversationStateManager.addTurn(callId, 'caller', userInput);
        
        // ════════════════════════════════════════════════════════════════════════════
        // 😤 FRUSTRATION, TRUST CONCERN & "FEELS IGNORED" DETECTION
        // ════════════════════════════════════════════════════════════════════════════
        // These signals change behavior dramatically:
        // - FRUSTRATED: Generic complaint, move to rescue mode
        // - TRUST_CONCERN: "can you even do the job?" - needs reassurance
        // - FEELS_IGNORED: "you didn't listen" - must reference their specific words
        // ════════════════════════════════════════════════════════════════════════════
        let currentMode = callState.conversationMode || 'booking';
        const lowerInput = userInput.toLowerCase();
        
        const isFrustrated = HybridReceptionistLLM.detectFrustration(userInput);
        
        // TRUST CONCERN: Caller questions our competence
        const trustConcern = /can you (do|handle|fix)|are you able|know what you'?re doing|qualified|sure you can|is this going to work|you guys any good/i.test(userInput);
        
        // FEELS IGNORED: Caller explicitly says we're not listening
        const callerFeelsIgnored = /you'?re not listen|didn'?t listen|you didn'?t (hear|understand|acknowledge|sympathize)|you'?re ignoring|you don'?t get it|that'?s not what i (said|meant)|you missed|you'?re not getting/i.test(userInput);
        
        // REFUSED SLOT: Caller is refusing to give info we asked for
        const refusedSlot = /i don'?t (want to|wanna)|not going to (give|tell)|don'?t want to share|not comfortable|rather not/i.test(userInput);
        
        // DESCRIBING PROBLEM: Caller is giving issue details (not answering booking question)
        const describingProblem = /water (leak|dripping)|thermostat|not cool|no cool|won'?t (turn|start)|making (noise|sound)|smell|broken|not working|problem is|issue is|been here before|came out|was here|technician.*before/i.test(userInput);
        
        // Track last question we asked for don't-repeat rule
        const lastAskField = callState.lastAskField || null;
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🔓 AUTO-UNLOCK BOOKING: When caller clearly switches to triage
        // ════════════════════════════════════════════════════════════════════════════
        let shouldUnlockBooking = false;
        let unlockReason = null;
        
        if (callState.bookingModeLocked) {
            // Unlock conditions
            if ((isFrustrated || callerFeelsIgnored) && describingProblem) {
                shouldUnlockBooking = true;
                unlockReason = 'FRUSTRATED_WITH_PROBLEM_DESCRIPTION';
            } else if (refusedSlot && describingProblem) {
                shouldUnlockBooking = true;
                unlockReason = 'REFUSED_SLOT_THEN_DESCRIBED_PROBLEM';
            } else if (callerFeelsIgnored) {
                shouldUnlockBooking = true;
                unlockReason = 'CALLER_FEELS_IGNORED';
            } else if (trustConcern) {
                shouldUnlockBooking = true;
                unlockReason = 'TRUST_CONCERN_DETECTED';
            }
            
            if (shouldUnlockBooking) {
                logger.info('[LLM0 TURN HANDLER] 🔓 AUTO-UNLOCK: Switching from booking to triage/rescue', {
                    companyId, callId, reason: unlockReason
                });
                
                currentMode = callerFeelsIgnored || isFrustrated ? 'rescue' : 'triage';
                
                // Log to Black Box
                try {
                    const BlackBoxLogger = require('./BlackBoxLogger');
                    await BlackBoxLogger.logEvent({
                        callId, companyId,
                        type: 'BOOKING_AUTO_UNLOCK',
                        turn: turnNumber,
                        data: {
                            reason: unlockReason,
                            previousStep: currentStep,
                            newMode: currentMode,
                            isFrustrated,
                            trustConcern,
                            callerFeelsIgnored,
                            describingProblem
                        }
                    });
                } catch (logErr) {}
            }
        }
        
        if (isFrustrated || callerFeelsIgnored) {
            currentMode = 'rescue';
            const frustrationCount = await ConversationStateManager.markFrustrated(callId);
            
            logger.info('[LLM0 TURN HANDLER] 😤 FRUSTRATION/IGNORED DETECTED - Switching to rescue mode', {
                companyId, callId, frustrationCount, callerFeelsIgnored
            });
            
            // Log to Black Box
            try {
                const BlackBoxLogger = require('./BlackBoxLogger');
                await BlackBoxLogger.logEvent({
                    callId, companyId,
                    type: callerFeelsIgnored ? 'CALLER_FEELS_IGNORED' : 'FRUSTRATION_DETECTED',
                    turn: turnNumber,
                    data: {
                        userInput: userInput?.substring(0, 100),
                        frustrationCount,
                        callerFeelsIgnored,
                        trustConcern,
                        switchedToRescue: true,
                        lastAskField
                    }
                });
            } catch (logErr) {}
            
            // If frustrated too many times, offer human
            if (frustrationCount >= 3) {
                return {
                    text: "I can tell this has been frustrating. Would you like me to connect you with someone who can help directly?",
                    action: 'continue',
                    shouldTransfer: false,
                    shouldHangup: false,
                    callState: {
                        ...callState,
                        turnCount: turnNumber,
                        offerHumanTransfer: true,
                        conversationMode: 'rescue',
                        bookingModeLocked: shouldUnlockBooking ? false : callState.bookingModeLocked
                    },
                    debug: { route: 'FRUSTRATION_ESCALATION', frustrationCount }
                };
            }
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🤖 CALL THE HYBRID LLM - Full context, natural conversation
        // ════════════════════════════════════════════════════════════════════════════
        const llmResult = await HybridReceptionistLLM.processConversation({
            company: {
                name: company?.name || 'our company',
                trade: company?.trade || 'HVAC',
                serviceAreas: company?.serviceAreas || [],
                id: company?._id || company?.id
            },
            callContext: {
                callId,
                companyId: company?._id || company?.id,
                turnCount: turnNumber,
                // Pass full customer context for empathy
                customerContext: {
                    isReturning: callState.customerContext?.isReturning || false,
                    totalCalls: callState.customerContext?.totalCalls || 0,
                    customerName: callState.customerContext?.customerName || null,
                    lastVisit: callState.customerContext?.lastVisit || null,
                    previousTechs: callState.customerContext?.previousTechs || []
                }
            },
            currentMode,
            knownSlots: existingSlots,
            conversationHistory,
            userInput,
            behaviorConfig: frontDeskConfig
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // 📊 LOG EVERYTHING FOR DEBUGGING
        // ════════════════════════════════════════════════════════════════════════════
        logger.info('[LLM0 TURN HANDLER] 🧠 HYBRID LLM RESULT', {
            companyId, callId,
            mode: llmResult.conversationMode,
            intent: llmResult.intent,
            nextGoal: llmResult.nextGoal,
            latencyMs: llmResult.latencyMs,
            slotsNow: Object.keys(llmResult.filledSlots).filter(k => llmResult.filledSlots[k]),
            signals: llmResult.signals,
            responsePreview: llmResult.reply?.substring(0, 60)
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // 💾 UPDATE CONVERSATION STATE
        // ════════════════════════════════════════════════════════════════════════════
        await ConversationStateManager.addTurn(callId, 'agent', llmResult.reply, {
            mode: llmResult.conversationMode,
            slotsExtracted: Object.keys(llmResult.filledSlots).filter(
                k => llmResult.filledSlots[k] && !existingSlots[k]
            )
        });
        await ConversationStateManager.updateSlots(callId, llmResult.filledSlots);
        await ConversationStateManager.updateMode(callId, llmResult.conversationMode);
        
        // ════════════════════════════════════════════════════════════════════════════
        // 📝 BLACK BOX LOGGING
        // ════════════════════════════════════════════════════════════════════════════
        try {
            const BlackBoxLogger = require('./BlackBoxLogger');
            await BlackBoxLogger.logEvent({
                callId, companyId,
                type: 'HYBRID_LLM_TURN',
                turn: turnNumber,
                data: {
                    mode: llmResult.conversationMode,
                    intent: llmResult.intent,
                    nextGoal: llmResult.nextGoal,
                    latencyMs: llmResult.latencyMs,
                    tokensUsed: llmResult.tokensUsed,
                    slots: {
                        name: llmResult.filledSlots.name || null,
                        phone: llmResult.filledSlots.phone ? 'captured' : null,
                        address: llmResult.filledSlots.address ? 'captured' : null,
                        time: llmResult.filledSlots.time || null,
                        serviceType: llmResult.filledSlots.serviceType || null
                    },
                    signals: llmResult.signals,
                    responsePreview: llmResult.reply?.substring(0, 100),
                    reasoning: llmResult.reasoning
                }
            });
        } catch (logErr) {
            logger.debug('[LLM0 TURN HANDLER] Black Box log failed');
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🎯 DETERMINE NEXT STATE
        // ════════════════════════════════════════════════════════════════════════════
        const isComplete = HybridReceptionistLLM.isBookingComplete(llmResult.filledSlots);
        const nextStep = isComplete ? 'POST_BOOKING' : (llmResult.nextGoal || currentStep);
        
        // Handle human transfer request
        if (llmResult.signals.wantsHuman) {
            return {
                text: "Absolutely, let me connect you with someone. Please hold.",
                action: 'transfer',
                shouldTransfer: true,
                shouldHangup: false,
                callState: {
                    ...callState,
                    turnCount: turnNumber,
                    transferRequested: true
                },
                debug: { route: 'HUMAN_TRANSFER_REQUESTED' }
            };
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // ✅ RETURN THE LLM's NATURAL RESPONSE
        // ════════════════════════════════════════════════════════════════════════════
        return {
            text: llmResult.reply,  // <-- THIS IS THE REAL AI TALKING
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState: {
                ...callState,
                turnCount: turnNumber,
                bookingModeLocked: true,
                bookingState: nextStep,
                currentBookingStep: nextStep,
                bookingCollected: llmResult.filledSlots,
                bookingReady: isComplete,
                conversationMode: llmResult.conversationMode
            },
            debug: {
                route: 'HYBRID_RECEPTIONIST',
                mode: llmResult.conversationMode,
                intent: llmResult.intent,
                nextGoal: llmResult.nextGoal,
                latencyMs: llmResult.latencyMs,
                isComplete
            }
        };
    }
    
    /**
     * Legacy slot-fill for fallback (if hybrid fails)
     * @private
     * @deprecated Use handleBookingSlotFill with HybridReceptionistLLM
     */
    static async handleBookingSlotFillLegacy({ companyId, callId, userInput, callState, turnNumber }) {
        const currentStep = callState.currentBookingStep || callState.bookingState;
        const collected = { ...callState.bookingCollected } || {};
        
        let frontDeskConfig = DEFAULT_FRONT_DESK_CONFIG;
        let company = null;
        let useLLMForConversation = false;
        
        try {
            const v2Company = require('../models/v2Company');
            company = await v2Company.findById(companyId).lean();
            frontDeskConfig = getFrontDeskConfig(company);
            useLLMForConversation = frontDeskConfig.enabled !== false;
        } catch (e) {
            logger.warn('[LLM0 TURN HANDLER] Could not load Front Desk config');
        }
        
        if (useLLMForConversation) {
            try {
                const llmResult = await BookingConversationLLM.generateResponse({
                    userInput,
                    currentStep,
                    collected,
                    frontDeskConfig,
                    companyName: company?.name || 'our company',
                    serviceType: collected.serviceType || 'AC service'
                });
                
                const newCollected = { ...collected };
                if (llmResult.extracted?.name) newCollected.name = llmResult.extracted.name;
                if (llmResult.extracted?.phone) newCollected.phone = llmResult.extracted.phone;
                if (llmResult.extracted?.address) newCollected.address = llmResult.extracted.address;
                if (llmResult.extracted?.time) newCollected.time = llmResult.extracted.time;
                if (llmResult.extracted?.serviceType) newCollected.serviceType = llmResult.extracted.serviceType;
                
                const nextStep = llmResult.nextStep || currentStep;
                const isComplete = (nextStep === 'POST_BOOKING' || nextStep === 'CONFIRM') && 
                    newCollected.name && newCollected.phone && newCollected.address && newCollected.time;
                
                return {
                    text: llmResult.response,
                    action: 'continue',
                    shouldTransfer: false,
                    shouldHangup: false,
                    callState: {
                        ...callState,
                        turnCount: turnNumber,
                        bookingModeLocked: true,
                        bookingState: nextStep,
                        currentBookingStep: nextStep,
                        bookingCollected: newCollected,
                        bookingReady: isComplete
                    },
                    debug: { route: 'BOOKING_LLM_CONVERSATION_LEGACY' }
                };
                
            } catch (llmError) {
                logger.error('[LLM0 TURN HANDLER] Legacy LLM failed', { error: llmError.message });
            }
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 😤 FRUSTRATION DETECTION - Using UI-configured triggers
        // ════════════════════════════════════════════════════════════════════════════
        const lowerInput = userInput?.toLowerCase() || '';
        const matchedFrustration = frustrationTriggers.filter(phrase => 
            phrase && lowerInput.includes(phrase.toLowerCase())
        );
        const isFrustrated = matchedFrustration.length > 0;
        const wantsBooking = /fix|repair|service|appointment|schedule|technician|someone|come out|send/i.test(lowerInput);
        
        if (isFrustrated) {
            logger.info('[LLM0 TURN HANDLER] 😤 FRUSTRATION DETECTED (UI Config)', {
                companyId,
                callId,
                userInput: userInput?.substring(0, 100),
                currentStep,
                wantsBooking,
                matchedTriggers: matchedFrustration
            });
            
            // Log to Black Box
            try {
                const BlackBoxLogger = require('./BlackBoxLogger');
                await BlackBoxLogger.logEvent({
                    callId,
                    companyId,
                    type: 'CUSTOMER_FRUSTRATED',
                    data: {
                        userInput: userInput?.substring(0, 100),
                        currentStep,
                        wantsBooking,
                        matchedPhrases: matchedFrustration,
                        configSource: 'frontDeskBehavior.frustrationTriggers'
                    }
                });
            } catch (logErr) {}
        }
        
        // Simple extraction based on current step - NO LLM, NO INTENT
        let newCollected = { ...collected };
        let nextStep = currentStep;
        let responseText = '';
        
        // ════════════════════════════════════════════════════════════════════════════
        // 💬 UI-CONTROLLED BOOKING PROMPTS & EMPATHETIC RESPONSES
        // ════════════════════════════════════════════════════════════════════════════
        const frustratedConfig = emotionResponses.frustrated || {};
        const frustratedFollowUp = frustratedConfig.followUp || "I'll get someone scheduled right away.";
        const frustratedAcks = frustratedConfig.acknowledgments || ["I completely understand."];
        const randomAck = frustratedAcks[Math.floor(Math.random() * frustratedAcks.length)] || "I understand.";
        
        // Helper for empathetic slot requests when frustrated (using UI config)
        const getEmpathicAsk = (field, customerName) => {
            const name = customerName || collected?.name || '';
            const namePrefix = name ? `${name}, ` : '';
            
            // Use random acknowledgment from UI config + follow-up + the booking prompt
            const ack = isFrustrated ? `${randomAck} ${frustratedFollowUp} ` : '';
            
            switch (field) {
                case 'phone':
                    return `${namePrefix}${ack}${bookingPrompts.askPhone || "What's the best phone number to reach you?"}`;
                case 'address':
                    return `${ack}${bookingPrompts.askAddress || "What's the service address?"}`;
                case 'time':
                    const asapOffer = bookingPrompts.offerAsap !== false 
                        ? ` ${bookingPrompts.asapPhrase || "Or I can send someone as soon as possible."}` 
                        : '';
                    return `${ack}${bookingPrompts.askTime || "When works best for you?"}${asapOffer}`;
                case 'name':
                    return `${ack}${bookingPrompts.askName || "May I have your name?"}`;
                default:
                    return null;
            }
        };
        
        switch (currentStep) {
            // ════════════════════════════════════════════════════════════════════════════
            // 🔧 SERVICE TYPE CLARIFICATION - REMOVED Dec 2025
            // Triage handles intent clarification now. This case should never be reached.
            // ════════════════════════════════════════════════════════════════════════════
            case 'ASK_SERVICE_TYPE':
            case 'service_type_clarification':
                // ServiceTypeClarifier REMOVED - fall through to ask name
                nextStep = 'ASK_NAME';
                responseText = "May I have your name please?";
                break;
                
            // LEGACY CODE BELOW - kept for reference but unreachable
            case '_LEGACY_SERVICE_TYPE_DISABLED':
                const ServiceTypeClarifier = { detectServiceType: () => null }; // stub
                // Get company config - need to load it fresh here
                let stConfig = null;
                try {
                    const v2Company = require('../models/v2Company');
                    const company = await v2Company.findById(companyId).lean();
                    stConfig = company?.aiAgentSettings?.serviceTypeClarification;
                } catch (e) {
                    logger.warn('[LLM0 TURN HANDLER] Could not load company config for service type');
                }
                
                const detectedServiceType = ServiceTypeClarifier.detectServiceType(userInput, stConfig);
                
                if (detectedServiceType) {
                    // Service type detected from their response
                    callState.serviceTypeDetected = detectedServiceType;
                    newCollected.serviceType = detectedServiceType.key;
                    nextStep = 'ASK_NAME';
                    
                    // Use appropriate response based on type
                    const typeLabel = detectedServiceType.label || detectedServiceType.key;
                    responseText = `Got it, I'll schedule a ${typeLabel.toLowerCase()} appointment. May I have your name please?`;
                    
                    logger.info('[LLM0 TURN HANDLER] 🔧 SERVICE TYPE CLARIFIED', {
                        companyId,
                        callId,
                        serviceType: detectedServiceType.key,
                        matchedKeyword: detectedServiceType.matchedKeyword,
                        calendarId: detectedServiceType.calendarId
                    });
                    
                    // Log to Black Box
                    try {
                        const BlackBoxLogger = require('./BlackBoxLogger');
                        await BlackBoxLogger.logEvent({
                            callId,
                            companyId,
                            type: 'SERVICE_TYPE_DETECTED',
                            data: {
                                serviceType: detectedServiceType.key,
                                label: detectedServiceType.label,
                                matchedKeyword: detectedServiceType.matchedKeyword,
                                calendarId: detectedServiceType.calendarId,
                                source: 'clarification_response'
                            }
                        });
                    } catch (logErr) {
                        logger.debug('[LLM0 TURN HANDLER] Black Box log failed');
                    }
                } else {
                    // Still can't determine - ask again more directly
                    responseText = "Just so I put you in the right spot, is this more of a repair issue or a routine maintenance visit?";
                    // Stay on same step
                    logger.debug('[LLM0 TURN HANDLER] Service type still unclear, asking again');
                    
                    // Log to Black Box for training/review
                    try {
                        const BlackBoxLogger = require('./BlackBoxLogger');
                        await BlackBoxLogger.logEvent({
                            callId,
                            companyId,
                            type: 'SERVICE_TYPE_CLARIFICATION_REPEATED',
                            data: {
                                userInput: userInput?.substring(0, 100),
                                reason: 'still_ambiguous',
                                note: 'User response did not match any service type keywords'
                            }
                        });
                    } catch (logErr) {
                        logger.debug('[LLM0 TURN HANDLER] Black Box log failed');
                    }
                }
                break;
            
            case 'ASK_NAME':
            case 'collecting_name':
                logger.info('[LLM0 TURN HANDLER] 📝 ASK_NAME case matched', {
                    companyId,
                    callId,
                    userInput: userInput?.substring(0, 60),
                    isFrustrated
                });
                
                const extractedName = this.extractName(userInput);
                
                logger.info('[LLM0 TURN HANDLER] 📝 Name extraction result', {
                    companyId,
                    callId,
                    extractedName: extractedName || 'null',
                    inputLength: userInput?.length
                });
                
                if (extractedName) {
                    newCollected.name = extractedName;
                    nextStep = 'ASK_PHONE';
                    // If frustrated, acknowledge and move faster
                    if (isFrustrated) {
                        responseText = `Got it ${extractedName}, I'll get someone scheduled for you right away. What's the best phone number to reach you?`;
                    } else {
                        responseText = `Thanks, ${extractedName}. And what's the best phone number to reach you?`;
                    }
                    logger.info('[LLM0 TURN HANDLER] ✅ Name captured successfully', {
                        companyId,
                        callId,
                        name: extractedName,
                        nextStep: 'ASK_PHONE',
                        responsePreview: responseText.substring(0, 60)
                    });
                } else {
                    // No name extracted - use empathetic ask if frustrated
                    responseText = isFrustrated 
                        ? getEmpathicAsk('name')
                        : "I didn't quite catch that. Could you please tell me your name?";
                    logger.info('[LLM0 TURN HANDLER] ⚠️ Name NOT extracted, asking again', {
                        companyId,
                        callId,
                        isFrustrated,
                        responsePreview: responseText.substring(0, 60)
                    });
                }
                break;
                
            case 'ASK_PHONE':
            case 'collecting_phone':
                logger.info('[LLM0 TURN HANDLER] 📞 ASK_PHONE case matched', {
                    companyId,
                    callId,
                    isFrustrated,
                    wantsBooking,
                    collectedName: collected?.name
                });
                
                const extractedPhone = this.extractPhone(userInput);
                if (extractedPhone) {
                    newCollected.phone = extractedPhone;
                    nextStep = 'ASK_ADDRESS';
                    responseText = isFrustrated 
                        ? "Got it. What's the service address?"
                        : "Great. What's the service address?";
                } else {
                    // No phone extracted - if frustrated & wants booking, be empathetic
                    if (isFrustrated && wantsBooking) {
                        responseText = getEmpathicAsk('phone', collected?.name);
                        logger.info('[LLM0 TURN HANDLER] 😤 Using empathetic response for frustrated customer', {
                            companyId,
                            callId,
                            responsePreview: responseText.substring(0, 80)
                        });
                    } else if (isFrustrated) {
                        // Frustrated but no clear booking intent - still be empathetic
                        responseText = getEmpathicAsk('phone', collected?.name);
                    } else {
                        responseText = "I need your phone number so we can reach you. What's the best number?";
                    }
                }
                break;
                
            case 'ASK_ADDRESS':
            case 'collecting_address':
                const extractedAddress = this.extractAddress(userInput);
                if (extractedAddress) {
                    newCollected.address = extractedAddress;
                    nextStep = 'ASK_TIME';
                    responseText = isFrustrated 
                        ? "Got it. When do you need someone there? Or should I send them as soon as possible?"
                        : "When would be a good time for us to come out?";
                } else {
                    responseText = isFrustrated && wantsBooking
                        ? getEmpathicAsk('address')
                        : "Could you please repeat the service address?";
                }
                break;
                
            case 'ASK_TIME':
            case 'collecting_time':
                // ════════════════════════════════════════════════════════════════════════════
                // 💬 HANDLE QUESTIONS DURING BOOKING (Front Desk Behavior)
                // ════════════════════════════════════════════════════════════════════════════
                // If caller asks a question instead of giving a time, ANSWER IT first
                // then ask for the time again. This is conversational, not robotic.
                const isQuestion = /\?|do you know|why are you|what is|who is|how much|how long|when will|will you|can you/i.test(userInput);
                
                if (isQuestion) {
                    const lowerQ = userInput.toLowerCase();
                    const serviceType = newCollected.serviceType || 'AC service';
                    const customerName = newCollected.name || '';
                    
                    // Answer common mid-booking questions
                    if (/why|what.*for|reason|coming out/i.test(lowerQ)) {
                        responseText = `Yes${customerName ? `, ${customerName}` : ''}, for your ${serviceType} request. When would be a good time for the technician to come out?`;
                    } else if (/how much|cost|price|charge/i.test(lowerQ)) {
                        responseText = `The technician will provide you with an estimate on-site before doing any work. When would be a good time for them to come out?`;
                    } else if (/how long|take|duration/i.test(lowerQ)) {
                        responseText = `It typically depends on the issue, but the technician will give you a timeframe when they arrive. When works best for you?`;
                    } else if (/who|which tech|same person/i.test(lowerQ)) {
                        responseText = `A qualified technician will be assigned based on availability. When would you like them to come out?`;
                    } else {
                        // Generic question handling
                        responseText = `Good question! The technician will be able to help with all the details when they arrive. Now, when would be a good time for us to come out?`;
                    }
                    
                    // Stay on ASK_TIME - we haven't collected the time yet
                    nextStep = 'ASK_TIME';
                    
                    logger.info('[LLM0 TURN HANDLER] 💬 Answered question during ASK_TIME, staying on step', {
                        companyId, callId, question: userInput?.substring(0, 50)
                    });
                    break;
                }
                
                let extractedTime = this.extractTime(userInput);
                
                // If frustrated and wants booking but no time extracted, default to ASAP
                if (!extractedTime && isFrustrated && wantsBooking) {
                    extractedTime = 'as soon as possible';
                    logger.info('[LLM0 TURN HANDLER] 😤 Frustrated customer - defaulting to ASAP', { companyId, callId });
                }
                
                if (extractedTime) {
                    newCollected.time = extractedTime;
                    nextStep = 'POST_BOOKING'; // Go to POST_BOOKING to handle follow-ups
                    
                    // Build confirmation using UI-configured template
                    const confirmName = newCollected.name || 'you';
                    const isAsap = /asap|as soon as|urgent|today|immediately|right away|fix it|send someone|possible/i.test(extractedTime);
                    
                    // Use completeTemplate from UI config
                    let completionTemplate = bookingPrompts.completeTemplate || 
                        "You're all set, {name}! A technician will be out {time}. You'll receive a confirmation text shortly.";
                    
                    // Replace placeholders
                    responseText = completionTemplate
                        .replace('{name}', confirmName)
                        .replace('{address}', newCollected.address || '')
                        .replace('{time}', isAsap || isFrustrated ? 'as soon as possible' : extractedTime)
                        .replace('{phone}', newCollected.phone || '');
                    
                    // Add follow-up question
                    responseText += ' Is there anything else I can help with?';
                    
                    // Log booking completion to Black Box
                    try {
                        const BlackBoxLogger = require('./BlackBoxLogger');
                        await BlackBoxLogger.logEvent({
                            callId,
                            companyId,
                            type: 'BOOKING_COMPLETED',
                            data: {
                                collected: {
                                    name: newCollected.name,
                                    phone: newCollected.phone ? 'captured' : null,
                                    address: newCollected.address ? 'captured' : null,
                                    time: newCollected.time
                                },
                                allSlotsCollected: true,
                                transitionTo: 'POST_BOOKING'
                            }
                        });
                    } catch (logErr) {
                        logger.debug('[LLM0 TURN HANDLER] Black Box log failed');
                    }
                } else {
                    responseText = "What day and time works best for you?";
                }
                break;
                
            case 'CONFIRM':
            case 'confirmed':
            case 'COMPLETE':
            case 'POST_BOOKING':
                // ════════════════════════════════════════════════════════════════
                // 🔒 POST-BOOKING HANDLER - Booking is DONE, handle follow-ups
                // ════════════════════════════════════════════════════════════════
                // The caller is asking follow-up questions AFTER booking completed.
                // We should answer their question, NOT restart the booking flow.
                // ════════════════════════════════════════════════════════════════
                
                logger.info('[LLM0 TURN HANDLER] 📋 POST-BOOKING FOLLOW-UP', {
                    companyId,
                    callId,
                    userInput: userInput?.substring(0, 100),
                    previousStep: currentStep,
                    bookingCollected: collected
                });
                
                // Check what the caller is asking about
                const lowerInput = userInput?.toLowerCase() || '';
                
                // Time-related follow-up
                if (/time|when|what time|arrive|coming|be there|get here|show up|schedule|timing/i.test(lowerInput)) {
                    responseText = "Our dispatch team will call you shortly to confirm the exact arrival time. " +
                        "Typically we provide a 2-hour window based on technician availability. " +
                        "Is there anything else I can help you with?";
                }
                // Confirmation/verification
                else if (/confirm|sure|right|correct|got it|verify|booked|appointment/i.test(lowerInput)) {
                    const confirmName = collected?.name || 'you';
                    const confirmAddress = collected?.address ? ` at ${collected.address.substring(0, 50)}` : '';
                    responseText = `Yes ${confirmName}, your service appointment is confirmed${confirmAddress}. ` +
                        "You'll receive a confirmation text shortly. Anything else I can help with?";
                }
                // Technician questions
                else if (/technician|person|who|someone|send|coming out/i.test(lowerInput)) {
                    responseText = "A qualified technician will be dispatched to you. " +
                        "They'll call before arriving. Is there anything else I can help with?";
                }
                // Price/cost questions
                else if (/cost|price|charge|pay|how much|fee/i.test(lowerInput)) {
                    responseText = "The technician will assess the situation on-site and provide you with pricing " +
                        "before doing any work. Is there anything else I can help with?";
                }
                // Generic follow-up (including the "that's all" responses)
                else if (/no|nope|that's all|that is all|nothing|all set|goodbye|bye|thank/i.test(lowerInput)) {
                    responseText = "You're all set! Thank you for calling. Have a great day!";
                    nextStep = 'COMPLETE';
                    break;
                }
                // Any other follow-up
                else {
                    responseText = "Your appointment is all set! Our team will reach out shortly. " +
                        "Is there anything else I can help you with today?";
                }
                
                nextStep = 'POST_BOOKING';
                
                // Log to Black Box
                try {
                    const BlackBoxLogger = require('./BlackBoxLogger');
                    await BlackBoxLogger.logEvent({
                        callId,
                        companyId,
                        type: 'POST_BOOKING_FOLLOWUP',
                        data: {
                            userInput: userInput?.substring(0, 100),
                            responseType: 'follow_up_handled',
                            bookingDataPreserved: true,
                            collected: {
                                name: collected?.name,
                                phone: collected?.phone ? 'captured' : null,
                                address: collected?.address ? 'captured' : null,
                                time: collected?.time
                            }
                        }
                    });
                } catch (logErr) {
                    logger.debug('[LLM0 TURN HANDLER] Black Box log failed');
                }
                break;
                
            default:
                responseText = "I'd be happy to schedule that for you. May I have your name please?";
                nextStep = 'ASK_NAME';
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🔒 LOCK MANAGEMENT - Keep locked even after completion to prevent restart
        // ════════════════════════════════════════════════════════════════════════════
        const isBookingComplete = nextStep === 'CONFIRM' || nextStep === 'COMPLETE' || nextStep === 'POST_BOOKING';
        // Only fully unlock when caller says goodbye (nextStep === 'COMPLETE')
        const shouldKeepLocked = nextStep !== 'COMPLETE';
        
        return {
            text: responseText,
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState: {
                ...callState,
                turnCount: turnNumber,
                // 🔒 Keep lock active to prevent booking restart!
                bookingModeLocked: shouldKeepLocked,
                bookingComplete: isBookingComplete, // Track completion state
                bookingState: nextStep,
                currentBookingStep: nextStep,
                bookingCollected: newCollected,
                bookingReady: isBookingComplete
            },
            debug: {
                route: 'BOOKING_SLOT_FILL',
                hardLocked: !isBookingComplete,  // FIX: was !isComplete (undefined variable!)
                currentStep: nextStep,
                extracted: Object.keys(newCollected).filter(k => newCollected[k] && !collected[k])
            }
        };
    }
    
    // Simple extraction helpers (no LLM, just patterns)
    static extractName(input) {
        if (!input) return null;
        
        // Normalize input
        const normalized = input.toLowerCase().trim();
        
        // Pattern 1: "my name is X" or "i'm X" anywhere in the string
        const namePatterns = [
            /(?:my name is|my name's|i'm|i am|it's|this is|call me|they call me)\s+([a-z]+(?:\s+[a-z]+)?)/i,
            /(?:sure,?\s*)?(?:my name is|i'm|i am)\s+([a-z]+)/i,
            /(?:yes,?\s*)?(?:my name is|i'm|i am)\s+([a-z]+)/i,
            /(?:hi,?\s*)?(?:my name is|i'm|i am)\s+([a-z]+)/i,
            /(?:hey,?\s*)?(?:my name is|i'm|i am)\s+([a-z]+)/i,
        ];
        
        for (const pattern of namePatterns) {
            const match = input.match(pattern);
            if (match && match[1]) {
                const name = match[1].trim();
                // Capitalize first letter
                return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
            }
        }
        
        // Pattern 2: If input starts with a clean name (e.g., "Mark", "John Smith")
        // Only use this if input is SHORT (likely just a name response)
        if (input.length < 30) {
            const cleaned = input.replace(/^(sure|yes|hi|hey|okay|ok|um|uh|well|so)[,.\s]*/i, '').trim();
            // Check if it looks like just a name (1-3 words, no common sentence words)
            const words = cleaned.split(/\s+/).filter(w => w.length > 1);
            if (words.length >= 1 && words.length <= 3) {
                const firstWord = words[0].toLowerCase();
                // Skip if it's clearly not a name
                const notNames = ['i', 'my', 'the', 'a', 'an', 'it', 'this', 'that', 'need', 'want', 'can', 'could'];
                if (!notNames.includes(firstWord)) {
                    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                }
            }
        }
        
        return null;
    }
    
    static extractPhone(input) {
        if (!input) return null;
        const digits = input.replace(/\D/g, '');
        if (digits.length >= 10 && digits.length <= 11) {
            return digits.length === 11 ? digits : '1' + digits;
        }
        return null;
    }
    
    static extractAddress(input) {
        if (!input) return null;
        if (/\d/.test(input) && input.length > 5) return input.trim();
        if (/\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|way|place|pl)\b/i.test(input)) {
            return input.trim();
        }
        if (input.length > 10) return input.trim();
        return null;
    }
    
    static extractTime(input) {
        if (!input) return null;
        
        const lowerInput = input.toLowerCase();
        
        // Check if this is a QUESTION (not a time)
        if (/\?|do you|why|what|when will|how long|who is/i.test(input)) {
            return null; // This is a question, not a time
        }
        
        // Time patterns
        const patterns = [
            /\b(morning|afternoon|evening|tonight|tomorrow|today|asap|as soon as possible)\b/i,
            /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
            /\d{1,2}(:\d{2})?\s*(am|pm)/i,  // Must have am/pm if using numbers
            /\b(next week|this week|anytime|whenever|earliest|soonest)\b/i,
            /\b(as soon as|right away|immediately|urgent|now)\b/i
        ];
        
        for (const pattern of patterns) {
            const match = input.match(pattern);
            if (match) {
                // Return the matched time expression, not the full input
                return match[0].trim();
            }
        }
        
        // DON'T default to accepting any input - only accept actual times
        return null;
    }
    
    /**
     * Handle TRANSFER route
     * @private
     */
    static async handleTransfer({ decision, company, callState, triageResult }) {
        const companyId = company._id?.toString() || company.companyId;
        const callId = callState?.callId || callState?.CallSid;
        
        logger.info('[LLM0 TURN HANDLER] Initiating transfer', {
            companyId,
            callId,
            isEmergency: decision.flags?.isEmergency,
            isFrustrated: decision.flags?.isFrustrated,
            transferTarget: triageResult.transferTarget?.type
        });
        
        // Build transfer message
        let transferMessage = decision.nextPrompt || 
            "Let me connect you with someone who can help you right away.";
        
        if (decision.flags?.isEmergency) {
            transferMessage = "I understand this is urgent. I'm connecting you with our emergency team right now.";
        } else if (decision.flags?.isFrustrated) {
            transferMessage = "I understand your frustration and I want to make sure you get the help you need. Let me connect you with a supervisor.";
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
            },
            debug: {
                route: 'TRANSFER',
                reason: triageResult.reason,
                isEmergency: decision.flags?.isEmergency
            }
        };
    }
    
    /**
     * Handle MESSAGE_ONLY route
     * @private
     */
    static async handleMessageOnly({ decision, company, callState }) {
        // Simply speak the message and continue
        return {
            text: decision.nextPrompt || "I'm here to help. What can I do for you?",
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState,
            debug: {
                route: 'MESSAGE_ONLY',
                action: decision.action
            }
        };
    }
    
    /**
     * Handle END_CALL route
     * @private
     */
    static async handleEndCall({ decision, company, callState }) {
        const isSpam = decision.flags?.isSpam;
        const isWrongNumber = decision.flags?.isWrongNumber;
        
        let endMessage = decision.nextPrompt || "Thank you for calling. Goodbye!";
        
        if (isSpam) {
            endMessage = "Goodbye.";
        } else if (isWrongNumber) {
            endMessage = "It seems you may have reached us by mistake. Have a great day!";
        }
        
        return {
            text: endMessage,
            action: 'hangup',
            shouldTransfer: false,
            shouldHangup: true,
            callState: {
                ...callState,
                callEnded: true,
                endReason: isSpam ? 'spam' : isWrongNumber ? 'wrong_number' : 'normal'
            },
            debug: {
                route: 'END_CALL',
                isSpam,
                isWrongNumber
            }
        };
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // 🚀 HYBRID FAST PATH - Smart LLM for ALL turns
    // ════════════════════════════════════════════════════════════════════════════
    
    /**
     * Handle ALL turns with HybridReceptionistLLM - smarter, faster, more human
     * 
     * @param {Object} params
     * @returns {Promise<TurnResult>}
     */
    static async handleWithHybridLLM({ company, callState, userInput, decision, startTime }) {
        const companyId = company._id?.toString() || company.companyId;
        const callId = callState?.callId || callState?.CallSid;
        const turnNumber = (callState?.turnCount || 0) + 1;
        
        // Load or create conversation state
        let convState = await ConversationStateManager.load(callId) || {
            conversationHistory: [],
            collectedSlots: {},
            currentMode: 'free',
            signals: {}
        };
        
        // Add caller input to history
        if (userInput) {
            convState.conversationHistory.push({
                role: 'user',
                content: userInput,
                timestamp: Date.now()
            });
        }
        
        // Get front desk config for personality
        const frontDeskConfig = getFrontDeskConfig(company);
        
        // Get customer context from callState
        const customerContext = {
            isReturning: callState?.isReturning || false,
            totalCalls: callState?.totalCalls || 0,
            customerName: callState?.customerName || convState.collectedSlots?.name,
            lastVisit: callState?.lastVisit
        };
        
        logger.info('[LLM0 TURN HANDLER] 🚀 HYBRID PATH - Processing with smart LLM', {
            companyId,
            callId,
            turn: turnNumber,
            mode: convState.currentMode,
            knownSlots: Object.keys(convState.collectedSlots).filter(k => convState.collectedSlots[k]),
            userInput: userInput?.substring(0, 80)
        });
        
        // 📼 BLACK BOX: Log hybrid turn start
        try {
            const BlackBoxLogger = require('./BlackBoxLogger');
            await BlackBoxLogger.logEvent({
                callId,
                companyId,
                type: 'HYBRID_LLM_TURN_START',
                turn: turnNumber,
                data: {
                    mode: convState.currentMode,
                    knownSlots: convState.collectedSlots,
                    historyLength: convState.conversationHistory.length,
                    userInput: userInput?.substring(0, 100)
                }
            });
        } catch (e) {}
        
        // Call HybridReceptionistLLM
        const llmResult = await HybridReceptionistLLM.processConversation({
            company: {
                name: company?.name || 'our company',
                trade: company?.trade || 'HVAC',
                serviceAreas: company?.serviceAreas || [],
                id: companyId
            },
            callContext: { callId, turnCount: turnNumber },
            currentMode: convState.currentMode,
            knownSlots: convState.collectedSlots,
            conversationHistory: convState.conversationHistory.slice(-4), // Last 4 turns for speed
            userInput,
            behaviorConfig: frontDeskConfig,
            customerContext
        });
        
        const latencyMs = Date.now() - startTime;
        
        logger.info('[LLM0 TURN HANDLER] 🚀 HYBRID RESULT', {
            companyId,
            callId,
            latencyMs,
            reply: llmResult.reply?.substring(0, 80),
            mode: llmResult.conversationMode,
            nextGoal: llmResult.nextGoal,
            filledSlots: llmResult.filledSlots,
            signals: llmResult.signals
        });
        
        // Update conversation state with LLM results
        convState.currentMode = llmResult.conversationMode || convState.currentMode;
        
        // Merge any extracted slots
        if (llmResult.filledSlots) {
            for (const [key, value] of Object.entries(llmResult.filledSlots)) {
                if (value) {
                    convState.collectedSlots[key] = value;
                }
            }
        }
        
        // Add agent response to history
        if (llmResult.reply) {
            convState.conversationHistory.push({
                role: 'assistant',
                content: llmResult.reply,
                timestamp: Date.now()
            });
        }
        
        // Save conversation state
        await ConversationStateManager.save(callId, convState);
        
        // 📼 BLACK BOX: Log hybrid turn complete
        try {
            const BlackBoxLogger = require('./BlackBoxLogger');
            await BlackBoxLogger.logEvent({
                callId,
                companyId,
                type: 'HYBRID_LLM_TURN_COMPLETE',
                turn: turnNumber,
                data: {
                    latencyMs,
                    mode: convState.currentMode,
                    reply: llmResult.reply?.substring(0, 150),
                    filledSlots: llmResult.filledSlots,
                    signals: llmResult.signals,
                    nextGoal: llmResult.nextGoal,
                    fromQuickAnswers: llmResult.fromQuickAnswers || false
                }
            });
        } catch (e) {}
        
        // ════════════════════════════════════════════════════════════════════════════
        // 3-PHASE BOOKING GATE (Dec 2025)
        // ════════════════════════════════════════════════════════════════════════════
        // Only lock booking when ALL conditions are met:
        // 1. Phase is BOOKING (not DISCOVERY or DECISION)
        // 2. wantsBooking is true (caller agreed to schedule)
        // 3. problemSummary exists (we know what's wrong)
        // 4. At least 2 turns have happened (we've had a real conversation)
        // 5. Confidence is high enough (0.75+)
        // ════════════════════════════════════════════════════════════════════════════
        const phase = llmResult.phase || 'DISCOVERY';
        const wantsBooking = llmResult.wantsBooking === true;
        const hasProblemSummary = !!llmResult.problemSummary;
        const hasEnoughTurns = turnNumber >= 2;
        const highConfidence = (llmResult.confidence || 0) >= 0.75;
        
        // Hard gate: ALL conditions must be true to enter booking
        const canEnterBooking = 
            phase === 'BOOKING' &&
            wantsBooking &&
            hasProblemSummary &&
            hasEnoughTurns &&
            highConfidence;
        
        const shouldLockBooking = canEnterBooking && Object.values(convState.collectedSlots).filter(v => v).length >= 1;
        
        // 📼 BLACK BOX: Log phase transition
        try {
            const BlackBoxLogger = require('./BlackBoxLogger');
            if (BlackBoxLogger) {
                await BlackBoxLogger.logEvent({
                    callId,
                    companyId,
                    type: 'PHASE_CHECK',
                    turn: turnNumber,
                    data: {
                        phase,
                        wantsBooking,
                        problemSummary: llmResult.problemSummary?.substring(0, 50),
                        hasEnoughTurns,
                        confidence: llmResult.confidence,
                        canEnterBooking,
                        shouldLockBooking
                    }
                });
            }
        } catch (e) {}
        
        // Build updated call state
        const updatedCallState = {
            ...callState,
            turnCount: turnNumber,
            phase, // NEW: Track current phase
            problemSummary: llmResult.problemSummary || callState?.problemSummary,
            bookingModeLocked: shouldLockBooking,
            bookingState: shouldLockBooking ? 'ACTIVE' : (callState?.bookingState || null),
            currentBookingStep: canEnterBooking ? llmResult.nextGoal : null,
            bookingCollected: {
                name: convState.collectedSlots.name || callState?.bookingCollected?.name,
                phone: convState.collectedSlots.phone || callState?.bookingCollected?.phone,
                address: convState.collectedSlots.address || callState?.bookingCollected?.address,
                time: convState.collectedSlots.time || callState?.bookingCollected?.time,
                serviceType: convState.collectedSlots.serviceType || callState?.bookingCollected?.serviceType
            },
            conversationMode: convState.currentMode,
            lastSignals: llmResult.signals
        };
        
        // Check for escalation signals
        const shouldTransfer = llmResult.signals?.wantsHuman || llmResult.signals?.escalate;
        
        return {
            text: llmResult.reply || "I'm here to help. How can I assist you?",
            response: llmResult.reply, // Alias for some handlers
            action: shouldTransfer ? 'transfer' : 'continue',
            shouldTransfer,
            shouldHangup: false,
            callState: updatedCallState,
            debug: {
                route: 'HYBRID_LLM',
                latencyMs,
                mode: convState.currentMode,
                filledSlots: llmResult.filledSlots,
                fromQuickAnswers: llmResult.fromQuickAnswers || false
            }
        };
    }
    
    /**
     * Convert LLM-0 action to route (fallback)
     * @private
     */
    static actionToRoute(action) {
        const actionRouteMap = {
            'RUN_SCENARIO': 'SCENARIO_ENGINE',
            'BOOK_APPOINTMENT': 'BOOKING',
            'TRANSFER_CALL': 'TRANSFER',
            'ASK_QUESTION': 'MESSAGE_ONLY',
            'MESSAGE_ONLY': 'MESSAGE_ONLY',
            'END_CALL': 'END_CALL',
            'UNKNOWN': 'SCENARIO_ENGINE'
        };
        
        return actionRouteMap[action] || 'SCENARIO_ENGINE';
    }
}

module.exports = LLM0TurnHandler;

