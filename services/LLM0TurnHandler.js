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
        
        logger.info('[LLM0 TURN HANDLER] Processing turn', {
            companyId,
            callId,
            action: decision.action,
            intentTag: decision.intentTag
        });
        
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
        
        if (!hasMinimumInfo) {
            // Need more info for booking
            const missing = [];
            if (!contact.name) missing.push('your name');
            if (!contact.phone && !contact.email) missing.push('a phone number');
            if (!location.addressLine1) missing.push('the service address');
            if (!scheduling.preferredDate) missing.push('when you\'d like us to come');
            
            const prompt = missing.length > 0 
                ? `I just need ${missing.join(' and ')} to get that scheduled for you.`
                : decision.nextPrompt || "Let me get that scheduled for you.";
            
            return {
                text: prompt,
                action: 'continue',
                shouldTransfer: false,
                shouldHangup: false,
                callState: {
                    ...callState,
                    bookingInProgress: true,
                    missingFields: missing
                },
                debug: {
                    route: 'BOOKING',
                    missingInfo: missing,
                    hasMinimum: false
                }
            };
        }
        
        // We have enough info - confirm and proceed
        // TODO: Integrate with actual booking service
        const confirmationPrompt = decision.nextPrompt || 
            `Perfect! I have ${contact.name} at ${location.addressLine1} for ${scheduling.preferredDate}. Let me confirm that booking for you.`;
        
        return {
            text: confirmationPrompt,
            action: 'continue',
            shouldTransfer: false,
            shouldHangup: false,
            callState: {
                ...callState,
                bookingInProgress: true,
                bookingReady: true
            },
            debug: {
                route: 'BOOKING',
                hasMinimum: true,
                contact: contact.name,
                location: location.addressLine1
            }
        };
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

