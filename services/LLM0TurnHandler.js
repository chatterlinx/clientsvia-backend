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
                ignoredDecision: decision.action
            });
            
            // Go straight to slot-filling - no triage, no Brain-2
            const bookingResult = await this.handleBookingSlotFill({
                companyId,
                callId,
                userInput,
                callState,
                turnNumber
            });
            
            return bookingResult;
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
            
            if (confirmResult.confirmed) {
                // User confirmed - proceed with original action
                const clearedState = SmartConfirmationService.clearPendingState(callState);
                callState = clearedState;
                
                // Restore original decision/route
                if (callState.originalDecision) {
                    triageResult.route = this.actionToRoute(callState.originalDecision.action);
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
     * 🔒 HARD LOCK SLOT-FILL (Bypasses EVERYTHING)
     * ════════════════════════════════════════════════════════════════════════════
     * 
     * This is called when bookingModeLocked = true.
     * NO Brain-1, NO triage, NO troubleshooting.
     * Just simple extraction and slot progression.
     * 
     * @private
     */
    static async handleBookingSlotFill({ companyId, callId, userInput, callState, turnNumber }) {
        const currentStep = callState.currentBookingStep || callState.bookingState;
        const collected = { ...callState.bookingCollected } || {};
        
        logger.info('[LLM0 TURN HANDLER] 🔒 SLOT-FILL (Hard Lock Active)', {
            companyId,
            callId,
            turn: turnNumber,
            currentStep,
            userInput: userInput?.substring(0, 50)
        });
        
        // Simple extraction based on current step - NO LLM, NO INTENT
        let newCollected = { ...collected };
        let nextStep = currentStep;
        let responseText = '';
        
        switch (currentStep) {
            case 'ASK_NAME':
            case 'collecting_name':
                const extractedName = this.extractName(userInput);
                if (extractedName) {
                    newCollected.name = extractedName;
                    nextStep = 'ASK_PHONE';
                    responseText = `Thanks, ${extractedName}. And what's the best phone number to reach you?`;
                } else {
                    responseText = "I didn't quite catch that. Could you please tell me your name?";
                }
                break;
                
            case 'ASK_PHONE':
            case 'collecting_phone':
                const extractedPhone = this.extractPhone(userInput);
                if (extractedPhone) {
                    newCollected.phone = extractedPhone;
                    nextStep = 'ASK_ADDRESS';
                    responseText = "Great. What's the service address?";
                } else {
                    responseText = "I need your phone number so we can reach you. What's the best number?";
                }
                break;
                
            case 'ASK_ADDRESS':
            case 'collecting_address':
                const extractedAddress = this.extractAddress(userInput);
                if (extractedAddress) {
                    newCollected.address = extractedAddress;
                    nextStep = 'ASK_TIME';
                    responseText = "When would be a good time for us to come out?";
                } else {
                    responseText = "Could you please repeat the service address?";
                }
                break;
                
            case 'ASK_TIME':
            case 'collecting_time':
                const extractedTime = this.extractTime(userInput);
                if (extractedTime) {
                    newCollected.time = extractedTime;
                    nextStep = 'CONFIRM';
                    responseText = `Perfect! I have ${newCollected.name || 'you'} at ${newCollected.address || 'your location'} for ${extractedTime}. I'll get that scheduled and someone will confirm with you shortly. Is there anything else I can help you with?`;
                } else {
                    responseText = "What day and time works best for you?";
                }
                break;
                
            case 'CONFIRM':
            case 'confirmed':
                responseText = "Is there anything else I can help you with today?";
                nextStep = 'COMPLETE';
                break;
                
            default:
                responseText = "I'd be happy to schedule that for you. May I have your name please?";
                nextStep = 'ASK_NAME';
        }
        
        const isComplete = nextStep === 'CONFIRM' || nextStep === 'COMPLETE';
        
        return {
            text: responseText,
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState: {
                ...callState,
                turnCount: turnNumber,
                // 🔒 Keep lock active until complete
                bookingModeLocked: !isComplete,
                bookingState: nextStep,
                currentBookingStep: nextStep,
                bookingCollected: newCollected,
                bookingReady: isComplete
            },
            debug: {
                route: 'BOOKING_SLOT_FILL',
                hardLocked: !isComplete,
                currentStep: nextStep,
                extracted: Object.keys(newCollected).filter(k => newCollected[k] && !collected[k])
            }
        };
    }
    
    // Simple extraction helpers (no LLM, just patterns)
    static extractName(input) {
        if (!input) return null;
        const cleaned = input.replace(/^(my name is|i'm|i am|it's|this is|hi i'm|hey i'm)\s*/i, '').trim();
        const words = cleaned.split(/\s+/).slice(0, 3);
        if (words.length > 0 && words[0].length > 1) {
            return words.join(' ');
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
        const patterns = [
            /\b(morning|afternoon|evening|tonight|tomorrow|today|asap|as soon as possible)\b/i,
            /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
            /\d{1,2}(:\d{2})?\s*(am|pm)?/i,
            /\b(next week|this week|anytime)\b/i
        ];
        for (const pattern of patterns) {
            if (pattern.test(input)) return input.trim();
        }
        if (input.length > 3) return input.trim();
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

