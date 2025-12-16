/**
 * ============================================================================
 * CONVERSATION STATE MACHINE - Enterprise Flow Controller V2
 * ============================================================================
 * 
 * This is the BRAIN that controls the conversation flow.
 * 
 * ARCHITECTURE (Enterprise-Grade):
 * - Deterministic Core: 95% of interactions (0 tokens, 100% reliable)
 * - LLM Fallback: 5% for off-rails recovery only
 * - Continuous Persistence: Every turn saved to CallRecord
 * - Audit Trail: Complete history of extractions and decisions
 * 
 * STAGES:
 * 1. GREETING - Fixed responses, detect time of day
 * 2. DISCOVERY - Capture issue, context, call type, mood
 * 3. TRIAGE - Diagnostic questions from triage cards
 * 4. BOOKING - Fixed slot questions from UI config
 * 5. CONFIRMATION - Summarize everything, confirm
 * 
 * ENTERPRISE FEATURES:
 * - missingSlots[] array for deterministic slot collection
 * - isFallbackActive flag for LLM mode tracking
 * - Confidence scoring on all extractions
 * - Stuck detection (max turns per stage)
 * - Audit trail with timestamps
 * 
 * RULES:
 * - State machine OWNS the flow - LLM cannot advance stages
 * - All responses come from UI config - nothing hardcoded
 * - LLM only activates when off-rails detected
 * - After LLM recovery, MUST return to current stage's question
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════════
// STAGE DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════════

const STAGES = {
    GREETING: 'greeting',
    DISCOVERY: 'discovery',
    TRIAGE: 'triage',
    BOOKING: 'booking',
    CONFIRMATION: 'confirmation',
    COMPLETE: 'complete',
    ESCALATED: 'escalated',
    STALLED: 'stalled'  // New: When stuck too long
};

const BOOKING_STEPS = {
    ASK_NAME: 'ASK_NAME',
    ASK_PHONE: 'ASK_PHONE',
    ASK_ADDRESS: 'ASK_ADDRESS',
    ASK_TIME: 'ASK_TIME',
    CONFIRM: 'CONFIRM'
};

// Enterprise config defaults
const ENTERPRISE_CONFIG = {
    MAX_TURNS_PER_STAGE: 5,         // Stuck detection
    MAX_OFF_RAILS_ATTEMPTS: 3,      // Before escalation
    MIN_CONFIDENCE_THRESHOLD: 0.7,  // For extractions
    MAX_TOTAL_TURNS: 20             // Absolute limit
};

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN CLASS
// ═══════════════════════════════════════════════════════════════════════════════

class ConversationStateMachine {
    
    /**
     * Initialize state machine for a session
     * @param {Object} session - ConversationSession document
     * @param {Object} company - Company document with aiAgentSettings
     */
    constructor(session, company) {
        this.session = session;
        this.company = company;
        
        // Get UI config
        this.frontDeskConfig = company.aiAgentSettings?.frontDeskBehavior || {};
        this.stagesConfig = this.frontDeskConfig.conversationStages || {};
        this.offRailsConfig = this.frontDeskConfig.offRailsRecovery || {};
        this.contextConfig = this.frontDeskConfig.contextRecognition || {};
        this.bookingSlots = this.frontDeskConfig.bookingSlots || [];
        
        // ═══════════════════════════════════════════════════════════════════════
        // 🔍 BOOKING SLOTS DEBUG - Verify UI config is being used
        // ═══════════════════════════════════════════════════════════════════════
        logger.info('[STATE MACHINE] 📋 BOOKING SLOTS LOADED FROM UI:', {
            companyId: company._id,
            companyName: company.companyName,
            slotsCount: this.bookingSlots.length,
            source: this.bookingSlots.length > 0 ? 'frontDeskBehavior.bookingSlots (UI)' : 'EMPTY - NO UI CONFIG',
            slots: this.bookingSlots.map(s => ({
                id: s.id || s.slotId,
                question: s.question?.substring(0, 40) + '...',
                required: s.required
            }))
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // ENTERPRISE: Flow State
        // ═══════════════════════════════════════════════════════════════════════
        this.flow = {
            currentStage: session.conversationMemory?.currentStage || STAGES.GREETING,
            currentStep: session.conversationMemory?.currentStep || null,
            turnsInCurrentStage: session.conversationMemory?.turnsInCurrentStage || 0,
            totalTurns: session.metrics?.totalTurns || 0,
            isFallbackActive: session.conversationMemory?.isFallbackActive || false,
            offRailsCount: session.conversationMemory?.offRailsCount || 0,
            lastSystemPrompt: session.conversationMemory?.lastSystemPrompt || null
        };
        
        // Shortcuts for backward compatibility
        this.currentStage = this.flow.currentStage;
        this.currentStep = this.flow.currentStep;
        
        // ═══════════════════════════════════════════════════════════════════════
        // ENTERPRISE: Discovery State with Confidence
        // ═══════════════════════════════════════════════════════════════════════
        this.discovery = {
            issue: session.discovery?.issue || null,
            issueConfidence: session.discovery?.issueConfidence || 0,
            context: session.discovery?.context || null,
            contextConfidence: session.discovery?.contextConfidence || 0,
            callType: session.discovery?.callType || null,
            callTypeConfidence: session.discovery?.callTypeConfidence || 0,
            urgency: session.discovery?.urgency || 'normal',
            mood: session.discovery?.mood || 'neutral',
            moodConfidence: session.discovery?.moodConfidence || 0,
            completedAt: session.discovery?.completedAt || null
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // ENTERPRISE: Triage State
        // ═══════════════════════════════════════════════════════════════════════
        this.triage = {
            activeCardId: session.triageState?.activeCardId || null,
            currentQuestionId: session.triageState?.currentQuestionId || null,
            questionsAsked: session.triageState?.questionsAsked || [],
            answers: session.triageState?.answers || {},
            outcome: session.triageState?.outcome || null,
            completedAt: session.triageState?.completedAt || null
        };
        
        // ═══════════════════════════════════════════════════════════════════════
        // ENTERPRISE: Booking State with missingSlots
        // ═══════════════════════════════════════════════════════════════════════
        // ═══════════════════════════════════════════════════════════════════════
        // ENTERPRISE: Booking State with missingSlots
        // Note: partialName counts as name (first name only is acceptable)
        // ═══════════════════════════════════════════════════════════════════════
        const collectedName = session.collectedSlots?.name || session.collectedSlots?.partialName || null;
        
        this.booking = {
            collectedSlots: {
                name: collectedName,
                phone: session.collectedSlots?.phone || null,
                address: session.collectedSlots?.address || null,
                time: session.collectedSlots?.time || null
            },
            // Also track partialName separately for display
            partialName: session.collectedSlots?.partialName || null,
            missingSlots: [],  // Computed below
            confirmed: session.conversationMemory?.bookingConfirmed || false
        };
        
        // Compute missing slots
        this._computeMissingSlots();
        
        // ═══════════════════════════════════════════════════════════════════════
        // ENTERPRISE: Audit Trail
        // ═══════════════════════════════════════════════════════════════════════
        this.auditTrail = session.conversationMemory?.auditTrail || [];
        
        // ═══════════════════════════════════════════════════════════════════════
        // ENTERPRISE: Conversation Memory
        // ═══════════════════════════════════════════════════════════════════════
        this.memory = {
            discussedTopics: session.conversationMemory?.discussedTopics || [],
            keyFacts: session.conversationMemory?.keyFacts || [],
            recoveryAttempts: session.conversationMemory?.recoveryAttempts || []
        };
        
        logger.info('[STATE MACHINE V2] Initialized', {
            sessionId: session._id,
            stage: this.flow.currentStage,
            step: this.flow.currentStep,
            turnsInStage: this.flow.turnsInCurrentStage,
            totalTurns: this.flow.totalTurns,
            hasIssue: !!this.discovery.issue,
            missingSlots: this.booking.missingSlots,
            offRailsCount: this.flow.offRailsCount
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ENTERPRISE: Compute Missing Slots
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Compute which slots are still needed
     * Uses bookingSlots config to determine required slots
     */
    _computeMissingSlots() {
        const missing = [];
        const slotOrder = ['name', 'phone', 'address', 'time'];
        
        for (const slotId of slotOrder) {
            // Check if slot is required
            const slotConfig = this.bookingSlots.find(s => 
                (s.id || s.slotId) === slotId
            );
            
            // Skip if not required
            if (slotConfig?.required === false) {
                continue;
            }
            
            // Add to missing if not collected
            if (!this.booking.collectedSlots[slotId]) {
                missing.push(slotId);
            }
        }
        
        this.booking.missingSlots = missing;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ENTERPRISE: Add to Audit Trail
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Add an entry to the audit trail
     */
    _addAuditEntry(type, data) {
        this.auditTrail.push({
            turn: this.flow.totalTurns,
            timestamp: new Date().toISOString(),
            stage: this.flow.currentStage,
            step: this.flow.currentStep,
            type,
            data
        });
        
        // Keep audit trail bounded
        if (this.auditTrail.length > 50) {
            this.auditTrail = this.auditTrail.slice(-50);
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // MAIN ENTRY POINT: Process a turn
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Process user input and determine next action
     * 
     * @param {string} userInput - What the caller said
     * @param {Object} extracted - Programmatically extracted data (slots, etc.)
     * @returns {Object} Action to take
     */
    processInput(userInput, extracted = {}) {
        const input = userInput?.trim() || '';
        const inputLower = input.toLowerCase();
        
        // Increment turn counters
        this.flow.totalTurns++;
        this.flow.turnsInCurrentStage++;
        
        logger.info('[STATE MACHINE V2] Processing turn', {
            turn: this.flow.totalTurns,
            stage: this.flow.currentStage,
            step: this.flow.currentStep,
            turnsInStage: this.flow.turnsInCurrentStage,
            inputPreview: input.substring(0, 50),
            isFallbackActive: this.flow.isFallbackActive
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 0: Check for stuck/timeout
        // ═══════════════════════════════════════════════════════════════════
        const stuckCheck = this._checkStuck();
        if (stuckCheck.isStuck) {
            logger.warn('[STATE MACHINE V2] 🚨 STUCK DETECTED', stuckCheck);
            this._addAuditEntry('STUCK_DETECTED', stuckCheck);
            
            return {
                action: 'ESCALATE',
                stage: this.flow.currentStage,
                reason: stuckCheck.reason,
                response: this._getEscalationResponse(stuckCheck.reason),
                tokensUsed: 0,
                source: 'STATE_MACHINE_STUCK'
            };
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Check for off-rails (before anything else)
        // ═══════════════════════════════════════════════════════════════════
        const offRailsCheck = this._checkOffRails(inputLower);
        if (offRailsCheck.isOffRails) {
            this.flow.offRailsCount++;
            this.flow.isFallbackActive = true;
            
            logger.info('[STATE MACHINE V2] 🚨 OFF-RAILS DETECTED', {
                trigger: offRailsCheck.trigger,
                type: offRailsCheck.type,
                offRailsCount: this.flow.offRailsCount
            });
            
            this._addAuditEntry('OFF_RAILS', {
                trigger: offRailsCheck.trigger,
                type: offRailsCheck.type,
                count: this.flow.offRailsCount
            });
            
            // Check if too many off-rails attempts
            if (this.flow.offRailsCount >= ENTERPRISE_CONFIG.MAX_OFF_RAILS_ATTEMPTS) {
                return {
                    action: 'ESCALATE',
                    stage: this.flow.currentStage,
                    reason: 'max_off_rails_exceeded',
                    response: this._getEscalationResponse('frustrated_caller'),
                    tokensUsed: 0,
                    source: 'STATE_MACHINE_ESCALATE'
                };
            }
            
            return {
                action: 'LLM_FALLBACK',
                stage: this.flow.currentStage,
                step: this.flow.currentStep,
                offRails: offRailsCheck,
                returnToQuestion: this._getCurrentQuestion(),
                context: this._buildLLMContext(),
                isFallbackActive: true
            };
        }
        
        // Clear fallback flag if we're back on rails
        if (this.flow.isFallbackActive) {
            this.flow.isFallbackActive = false;
            logger.info('[STATE MACHINE V2] ✅ Back on rails');
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Update state with extracted data
        // ═══════════════════════════════════════════════════════════════════
        this._updateFromExtracted(extracted);
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: Route to current stage handler
        // ═══════════════════════════════════════════════════════════════════
        let result;
        
        switch (this.flow.currentStage) {
            case STAGES.GREETING:
                result = this._handleGreeting(input, inputLower);
                break;
                
            case STAGES.DISCOVERY:
                result = this._handleDiscovery(input, inputLower, extracted);
                break;
                
            case STAGES.TRIAGE:
                result = this._handleTriage(input, inputLower, extracted);
                break;
                
            case STAGES.BOOKING:
                result = this._handleBooking(input, inputLower, extracted);
                break;
                
            case STAGES.CONFIRMATION:
                result = this._handleConfirmation(input, inputLower);
                break;
                
            case STAGES.COMPLETE:
                result = this._handleComplete(input, inputLower);
                break;
                
            default:
                logger.warn('[STATE MACHINE V2] Unknown stage, defaulting to greeting', { 
                    stage: this.flow.currentStage 
                });
                this.flow.currentStage = STAGES.GREETING;
                this.flow.turnsInCurrentStage = 0;
                result = this._handleGreeting(input, inputLower);
        }
        
        // Update current stage/step shortcuts
        this.currentStage = this.flow.currentStage;
        this.currentStep = this.flow.currentStep;
        
        // Record last system prompt
        if (result.response) {
            this.flow.lastSystemPrompt = result.response;
        }
        
        // Add to audit trail
        this._addAuditEntry('RESPONSE', {
            action: result.action,
            nextStage: result.nextStage,
            nextStep: result.nextStep,
            responsePreview: result.response?.substring(0, 100)
        });
        
        return result;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ENTERPRISE: Stuck Detection
    // ═══════════════════════════════════════════════════════════════════════════
    
    _checkStuck() {
        // Check turns in current stage
        if (this.flow.turnsInCurrentStage >= ENTERPRISE_CONFIG.MAX_TURNS_PER_STAGE) {
            return {
                isStuck: true,
                reason: 'max_turns_in_stage',
                stage: this.flow.currentStage,
                turns: this.flow.turnsInCurrentStage
            };
        }
        
        // Check total turns
        if (this.flow.totalTurns >= ENTERPRISE_CONFIG.MAX_TOTAL_TURNS) {
            return {
                isStuck: true,
                reason: 'max_total_turns',
                totalTurns: this.flow.totalTurns
            };
        }
        
        return { isStuck: false };
    }
    
    _getEscalationResponse(reason) {
        const responses = this.offRailsConfig.responses || {};
        
        switch (reason) {
            case 'max_turns_in_stage':
                return responses.stalled || 
                    "I apologize, we seem to be having some difficulty. Let me connect you with someone who can help directly.";
            case 'max_total_turns':
                return responses.longCall || 
                    "I want to make sure we get this right. Let me have a team member call you back to complete this.";
            case 'frustrated_caller':
                return responses.frustrated || 
                    "I completely understand your frustration. Let me get you to someone who can help right away.";
            case 'max_off_rails_exceeded':
                return responses.humanRequest || 
                    "I understand. Let me connect you with a team member who can assist you directly.";
            default:
                return "Let me connect you with someone who can help.";
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STAGE HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * GREETING STAGE - Fixed responses, 0 tokens
     * 
     * SMART GREETING LOGIC:
     * - If caller says "good morning" and it IS morning → respond "Good morning!"
     * - If caller says "good morning" but it's afternoon → respond "Good afternoon!" (politely correct)
     * - If caller just says "hi/hello" → use current time of day
     */
    _handleGreeting(input, inputLower) {
        const isGreeting = this._isGreeting(inputLower);
        
        if (isGreeting) {
            // Detect what time of day the caller mentioned (if any)
            const callerTimeOfDay = this._detectCallerTimeOfDay(inputLower);
            
            // Get the ACTUAL time of day from server
            const actualTimeOfDay = this._getActualTimeOfDay();
            
            // Build response using smart logic
            const response = this._buildSmartGreetingResponse(callerTimeOfDay, actualTimeOfDay);
            
            logger.info('[STATE MACHINE] 🌅 Greeting processed', {
                callerSaid: input,
                callerTimeOfDay,
                actualTimeOfDay,
                response: response.substring(0, 50)
            });
            
            // Move to DISCOVERY
            this._transitionTo(STAGES.DISCOVERY);
            
            return {
                action: 'RESPOND',
                stage: STAGES.GREETING,
                response: response,
                nextStage: STAGES.DISCOVERY,
                tokensUsed: 0,
                source: 'STATE_MACHINE_GREETING'
            };
        }
        
        // Not a greeting - they're explaining why they called
        // Move to discovery and process there
        this._transitionTo(STAGES.DISCOVERY);
        return this._handleDiscovery(input, inputLower, {});
    }
    
    /**
     * Detect what time of day the caller mentioned
     * @returns {string|null} 'morning', 'afternoon', 'evening', or null if not mentioned
     */
    _detectCallerTimeOfDay(inputLower) {
        if (/good\s+morning/.test(inputLower)) return 'morning';
        if (/good\s+afternoon/.test(inputLower)) return 'afternoon';
        if (/good\s+evening/.test(inputLower)) return 'evening';
        return null; // Caller just said "hi", "hello", etc.
    }
    
    /**
     * Get the actual time of day based on server time
     * @returns {string} 'morning', 'afternoon', or 'evening'
     */
    _getActualTimeOfDay() {
        const hour = new Date().getHours();
        if (hour < 12) return 'morning';
        if (hour < 17) return 'afternoon';
        return 'evening';
    }
    
    /**
     * Build smart greeting response
     * - Uses actual time of day (politely corrects caller if wrong)
     * - Falls back to UI-configured greetings
     */
    _buildSmartGreetingResponse(callerTimeOfDay, actualTimeOfDay) {
        const greetings = this.stagesConfig.greetingResponses || {};
        
        // Always use the ACTUAL time of day for our response
        // This politely corrects the caller if they're wrong
        switch (actualTimeOfDay) {
            case 'morning':
                return greetings.morning || "Good morning! How can I help you today?";
            case 'afternoon':
                return greetings.afternoon || "Good afternoon! How can I help you today?";
            case 'evening':
                return greetings.evening || "Good evening! How can I help you today?";
            default:
                return greetings.generic || "Hi there! How can I help you today?";
        }
    }
    
    /**
     * DISCOVERY STAGE - Capture issue, context, call type
     */
    _handleDiscovery(input, inputLower, extracted) {
        // ═══════════════════════════════════════════════════════════════════
        // Extract with confidence scoring
        // ═══════════════════════════════════════════════════════════════════
        const issueExtraction = this._extractIssue(input);
        const contextExtraction = this._extractContext(input);
        const moodDetection = this._detectMood(inputLower);
        const callTypeDetection = this._detectCallType(inputLower);
        const urgencyCheck = this._checkUrgency(inputLower);
        const repeatCheck = this._checkRepeatVisit(inputLower);
        
        // Update discovery with confidence
        if (issueExtraction.issue && issueExtraction.confidence >= ENTERPRISE_CONFIG.MIN_CONFIDENCE_THRESHOLD) {
            if (!this.discovery.issue) {
                this.discovery.issue = issueExtraction.issue;
                this.discovery.issueConfidence = issueExtraction.confidence;
                
                // Add to key facts
                this.memory.keyFacts.push(`Issue: ${issueExtraction.issue}`);
                
                logger.info('[STATE MACHINE V2] 📋 Issue captured', { 
                    issue: this.discovery.issue,
                    confidence: this.discovery.issueConfidence
                });
            }
        }
        
        if (contextExtraction.context && contextExtraction.confidence >= ENTERPRISE_CONFIG.MIN_CONFIDENCE_THRESHOLD) {
            if (!this.discovery.context) {
                this.discovery.context = contextExtraction.context;
                this.discovery.contextConfidence = contextExtraction.confidence;
                
                this.memory.keyFacts.push(`Context: ${contextExtraction.context}`);
            }
        }
        
        if (moodDetection.mood !== 'neutral') {
            this.discovery.mood = moodDetection.mood;
            this.discovery.moodConfidence = moodDetection.confidence;
        }
        
        if (callTypeDetection.callType !== 'unknown') {
            this.discovery.callType = callTypeDetection.callType;
            this.discovery.callTypeConfidence = callTypeDetection.confidence;
        }
        
        if (urgencyCheck.isUrgent) {
            this.discovery.urgency = urgencyCheck.level;
        }
        
        if (repeatCheck.isRepeat) {
            this.discovery.urgency = 'repeat_issue';
            if (!this.discovery.context) {
                this.discovery.context = repeatCheck.context;
            }
        }
        
        // Add to discussed topics
        if (this.discovery.issue) {
            this.memory.discussedTopics.push({
                topic: 'caller_issue',
                turnNumber: this.flow.totalTurns,
                resolved: false
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // Determine next stage
        // ═══════════════════════════════════════════════════════════════════
        
        if (this.discovery.issue) {
            // Build acknowledgment
            let acknowledgment = '';
            
            if (repeatCheck.isRepeat) {
                acknowledgment = this.contextConfig.repeatVisitAcknowledgment || 
                    "I see we've been out before. I apologize that the issue is continuing.";
            } else if (urgencyCheck.isUrgent) {
                acknowledgment = this.contextConfig.urgencyAcknowledgment ||
                    "I understand this is urgent. Let me get someone out to you as quickly as possible.";
            } else if (this.stagesConfig.triageSettings?.acknowledgeIssueFirst) {
                acknowledgment = this.stagesConfig.triageSettings?.issueAcknowledgment ||
                    "I'm sorry to hear that. Let me help you get this resolved.";
            }
            
            // Mark discovery complete
            this.discovery.completedAt = new Date();
            
            // Decide: TRIAGE or straight to BOOKING?
            const shouldTriage = this.stagesConfig.triageSettings?.enabled && 
                                 this.stagesConfig.triageSettings?.autoTriageOnIssue &&
                                 this.discovery.callType === 'service_issue';
            
            if (shouldTriage) {
                this._transitionTo(STAGES.TRIAGE);
                
                const triageQuestion = this._getNextTriageQuestion();
                
                if (triageQuestion) {
                    const response = acknowledgment 
                        ? `${acknowledgment} ${triageQuestion}`
                        : triageQuestion;
                    
                    return {
                        action: 'RESPOND',
                        stage: STAGES.DISCOVERY,
                        response: response,
                        nextStage: STAGES.TRIAGE,
                        tokensUsed: 0,
                        source: 'STATE_MACHINE_DISCOVERY',
                        discoveryComplete: true,
                        discovery: this.discovery
                    };
                }
            }
            
            // No triage - go straight to booking
            this._transitionTo(STAGES.BOOKING, 'ASK_NAME');
            
            const transitionMsg = this.stagesConfig.bookingSettings?.transitionToBooking ||
                "Let's get you scheduled.";
            const firstQuestion = this._getBookingQuestion('name');
            
            const response = acknowledgment
                ? `${acknowledgment} ${transitionMsg} ${firstQuestion}`
                : `${transitionMsg} ${firstQuestion}`;
            
            return {
                action: 'RESPOND',
                stage: STAGES.DISCOVERY,
                response: response,
                nextStage: STAGES.BOOKING,
                nextStep: BOOKING_STEPS.ASK_NAME,
                tokensUsed: 0,
                source: 'STATE_MACHINE_DISCOVERY',
                discoveryComplete: true,
                discovery: this.discovery
            };
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // No issue captured yet - ask for more info
        // ═══════════════════════════════════════════════════════════════════
        const discoveryPrompt = this.stagesConfig.discoveryPrompts?.needMoreInfo ||
            "Can you tell me a little more about what's going on?";
        
        return {
            action: 'RESPOND',
            stage: STAGES.DISCOVERY,
            response: discoveryPrompt,
            nextStage: STAGES.DISCOVERY,
            tokensUsed: 0,
            source: 'STATE_MACHINE_DISCOVERY'
        };
    }
    
    /**
     * TRIAGE STAGE - Diagnostic questions from triage cards
     */
    _handleTriage(input, inputLower, extracted) {
        // Record answer to previous question
        if (this.triage.questionsAsked.length > 0) {
            const lastQuestion = this.triage.questionsAsked[this.triage.questionsAsked.length - 1];
            
            // Store answer
            this.triage.answers[lastQuestion.id || `q${this.triage.questionsAsked.length}`] = input;
        }
        
        // Check if we've asked enough questions
        const maxQuestions = this.stagesConfig.triageSettings?.maxDiagnosticQuestions || 3;
        
        if (this.triage.questionsAsked.length >= maxQuestions) {
            // Move to booking
            this._transitionTo(STAGES.BOOKING, 'ASK_NAME');
            this.triage.completedAt = new Date();
            this.triage.outcome = 'needs_technician';
            
            const transitionMsg = this.stagesConfig.bookingSettings?.transitionToBooking ||
                "Let's get you scheduled.";
            const firstQuestion = this._getBookingQuestion('name');
            
            return {
                action: 'RESPOND',
                stage: STAGES.TRIAGE,
                response: `${transitionMsg} ${firstQuestion}`,
                nextStage: STAGES.BOOKING,
                nextStep: BOOKING_STEPS.ASK_NAME,
                tokensUsed: 0,
                source: 'STATE_MACHINE_TRIAGE',
                triageComplete: true,
                triageState: this.triage
            };
        }
        
        // Get next triage question
        const nextQuestion = this._getNextTriageQuestion();
        
        if (nextQuestion) {
            return {
                action: 'RESPOND',
                stage: STAGES.TRIAGE,
                response: nextQuestion,
                nextStage: STAGES.TRIAGE,
                tokensUsed: 0,
                source: 'STATE_MACHINE_TRIAGE'
            };
        }
        
        // No more triage questions - move to booking
        this._transitionTo(STAGES.BOOKING, 'ASK_NAME');
        this.triage.completedAt = new Date();
        
        const transitionMsg = this.stagesConfig.bookingSettings?.transitionToBooking ||
            "Let's get you scheduled.";
        const firstQuestion = this._getBookingQuestion('name');
        
        return {
            action: 'RESPOND',
            stage: STAGES.TRIAGE,
            response: `${transitionMsg} ${firstQuestion}`,
            nextStage: STAGES.BOOKING,
            nextStep: BOOKING_STEPS.ASK_NAME,
            tokensUsed: 0,
            source: 'STATE_MACHINE_TRIAGE',
            triageComplete: true
        };
    }
    
    /**
     * BOOKING STAGE - Fixed slot questions from UI config
     * Uses missingSlots[] for deterministic collection
     */
    _handleBooking(input, inputLower, extracted) {
        // Update slots from extracted data
        // Update slots from extracted data (handle both name and partialName)
        if (extracted.name) {
            this.booking.collectedSlots.name = extracted.name;
        } else if (extracted.partialName && !this.booking.collectedSlots.name) {
            // Accept partial name (first name only) as the name
            this.booking.collectedSlots.name = extracted.partialName;
            this.booking.partialName = extracted.partialName;
        }
        if (extracted.phone) this.booking.collectedSlots.phone = extracted.phone;
        if (extracted.address) this.booking.collectedSlots.address = extracted.address;
        if (extracted.time) this.booking.collectedSlots.time = extracted.time;
        
        // Recompute missing slots
        this._computeMissingSlots();
        
        logger.info('[STATE MACHINE V2] 📊 Booking state', {
            collected: this.booking.collectedSlots,
            missing: this.booking.missingSlots,
            partialName: this.booking.partialName
        });
        
        // Check if we have all slots
        if (this.booking.missingSlots.length === 0) {
            // All slots collected - move to confirmation
            this._transitionTo(STAGES.CONFIRMATION);
            
            const confirmationMsg = this._buildConfirmation();
            
            return {
                action: 'RESPOND',
                stage: STAGES.BOOKING,
                response: confirmationMsg,
                nextStage: STAGES.CONFIRMATION,
                tokensUsed: 0,
                source: 'STATE_MACHINE_BOOKING',
                slotsCollected: this.booking.collectedSlots,
                bookingComplete: true
            };
        }
        
        // Get next missing slot
        const nextSlot = this.booking.missingSlots[0];
        const question = this._getBookingQuestion(nextSlot);
        this.flow.currentStep = `ASK_${nextSlot.toUpperCase()}`;
        
        // Build acknowledgment for what we just got
        let ack = '';
        const nameCollected = extracted.name || extracted.partialName;
        if (nameCollected) ack = `Thanks, ${nameCollected}!`;
        else if (extracted.phone) ack = 'Got it!';
        else if (extracted.address) ack = 'Perfect!';
        else if (extracted.time) ack = 'Great!';
        
        const response = ack ? `${ack} ${question}` : question;
        
        return {
            action: 'RESPOND',
            stage: STAGES.BOOKING,
            step: this.flow.currentStep,
            response: response,
            nextStage: STAGES.BOOKING,
            nextStep: this.flow.currentStep,
            tokensUsed: 0,
            source: 'STATE_MACHINE_BOOKING',
            slotsCollected: this.booking.collectedSlots,
            missingSlots: this.booking.missingSlots
        };
    }
    
    /**
     * CONFIRMATION STAGE - Summarize and confirm
     */
    _handleConfirmation(input, inputLower) {
        const isConfirmed = this._isConfirmation(inputLower);
        const isDenied = this._isDenial(inputLower);
        
        if (isConfirmed) {
            this._transitionTo(STAGES.COMPLETE);
            this.booking.confirmed = true;
            
            const completeMsg = this.frontDeskConfig.bookingTemplates?.completeTemplate ||
                "You're all set! You'll receive a confirmation shortly. Is there anything else?";
            
            const response = this._replacePlaceholders(completeMsg);
            
            return {
                action: 'RESPOND',
                stage: STAGES.CONFIRMATION,
                response: response,
                nextStage: STAGES.COMPLETE,
                tokensUsed: 0,
                source: 'STATE_MACHINE_CONFIRMATION',
                outcome: 'booked'
            };
        }
        
        if (isDenied) {
            // They said no - use LLM to figure out what's wrong
            this.flow.isFallbackActive = true;
            
            return {
                action: 'LLM_FALLBACK',
                stage: STAGES.CONFIRMATION,
                reason: 'confirmation_denied',
                context: this._buildLLMContext(),
                isFallbackActive: true
            };
        }
        
        // Unclear response - ask again
        return {
            action: 'RESPOND',
            stage: STAGES.CONFIRMATION,
            response: "I just want to make sure I have everything right. Does that all sound correct?",
            nextStage: STAGES.CONFIRMATION,
            tokensUsed: 0,
            source: 'STATE_MACHINE_CONFIRMATION'
        };
    }
    
    /**
     * COMPLETE STAGE - Handle follow-up questions
     */
    _handleComplete(input, inputLower) {
        const hasMore = inputLower.includes('yes') || 
                       inputLower.includes('actually') ||
                       inputLower.includes('one more') ||
                       inputLower.includes('question');
        
        if (hasMore) {
            this.flow.isFallbackActive = true;
            
            return {
                action: 'LLM_FALLBACK',
                stage: STAGES.COMPLETE,
                reason: 'follow_up_question',
                context: this._buildLLMContext(),
                isFallbackActive: true
            };
        }
        
        return {
            action: 'RESPOND',
            stage: STAGES.COMPLETE,
            response: "Thank you for calling! Have a great day!",
            nextStage: STAGES.COMPLETE,
            tokensUsed: 0,
            source: 'STATE_MACHINE_COMPLETE',
            callComplete: true
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STAGE TRANSITION
    // ═══════════════════════════════════════════════════════════════════════════
    
    _transitionTo(newStage, newStep = null) {
        const oldStage = this.flow.currentStage;
        
        this.flow.currentStage = newStage;
        this.flow.currentStep = newStep;
        this.flow.turnsInCurrentStage = 0;  // Reset counter
        
        // Update shortcuts
        this.currentStage = newStage;
        this.currentStep = newStep;
        
        logger.info('[STATE MACHINE V2] 🔄 Stage transition', {
            from: oldStage,
            to: newStage,
            step: newStep
        });
        
        this._addAuditEntry('STAGE_TRANSITION', {
            from: oldStage,
            to: newStage,
            step: newStep
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // EXTRACTION HELPERS WITH CONFIDENCE
    // ═══════════════════════════════════════════════════════════════════════════
    
    _isGreeting(inputLower) {
        const greetingPatterns = [
            /^(hi|hello|hey|yo|howdy)[\s\.\!\?]*$/,
            /^good\s+(morning|afternoon|evening)[\s\.\!\?]*$/,
            /^(hi|hello|hey)\s+good\s+(morning|afternoon|evening)/,
            /^(hi|hello|hey)\s+there/,
            /^(hi|hello|hey)[\s,]+how are you/
        ];
        
        return greetingPatterns.some(p => p.test(inputLower));
    }
    
    // _getGreetingResponse() - REPLACED by _buildSmartGreetingResponse() above
    // The new method handles caller's time of day vs actual time of day
    
    _extractIssue(input) {
        const inputLower = input.toLowerCase();
        
        // ═══════════════════════════════════════════════════════════════════════
        // TIER 1: Strong problem patterns (high confidence)
        // These are UNIVERSAL patterns that work for ANY industry
        // ═══════════════════════════════════════════════════════════════════════
        const strongPatterns = [
            // "my X is Y", "the X isn't working"
            { pattern: /(?:my|the|our)\s+(\w+(?:\s+\w+)?)\s+(?:is|isn't|isnt|are|aren't|arent)\s+(\w+)/i, confidence: 0.9 },
            // "having issues with X", "have a problem with X"
            { pattern: /(?:having|have)\s+(?:a\s+)?(?:problem|issue|trouble|issues)\s+(?:with\s+)?(?:my|the|our)?\s*(.+)/i, confidence: 0.9 },
            // "X not working", "X broken"
            { pattern: /(\w+(?:\s+\w+)?)\s+(?:not working|broken|acting up|making noise|leaking|stopped)/i, confidence: 0.9 },
            // "need to fix X"
            { pattern: /(?:need|want)\s+(?:to\s+)?(?:fix|repair|replace|check|look at)\s+(?:my|the|our)?\s*(.+)/i, confidence: 0.85 },
            // "X appears to be Y", "X seems to be broken"
            { pattern: /(\w+(?:\s+\w+)?)\s+(?:appears|seems|looks)\s+(?:to be\s+)?(\w+)/i, confidence: 0.9 },
            // "something wrong with X"
            { pattern: /(?:something|anything)\s+wrong\s+(?:with\s+)?(?:my|the|our)?\s*(.+)/i, confidence: 0.85 },
            // "X is blank/dead/off"
            { pattern: /(\w+)\s+is\s+(blank|dead|off|frozen|stuck|broken|hurting|painful)/i, confidence: 0.9 },
            // "no heat", "no power", "no service"
            { pattern: /no\s+(\w+)/i, confidence: 0.85 },
            // "won't turn on", "doesn't work"
            { pattern: /(?:won't|wont|doesn't|doesnt|can't|cant)\s+(turn on|work|start|stop|open|close)/i, confidence: 0.85 },
            // "I need X", "looking for X"
            { pattern: /(?:i\s+)?(?:need|looking for|want|require)\s+(?:a\s+)?(.+)/i, confidence: 0.8 }
        ];
        
        for (const { pattern, confidence } of strongPatterns) {
            const match = input.match(pattern);
            if (match) {
                // Clean up the captured issue
                let issue = match[0].replace(/^(my|the|our)\s+/i, '').trim();
                // Limit length
                if (issue.length > 100) issue = issue.substring(0, 100);
                return { issue, confidence };
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // TIER 2: Industry-specific keywords from company config
        // These come from: triage cards, service types, and trade categories
        // ═══════════════════════════════════════════════════════════════════════
        const industryKeywords = this._getIndustryKeywords();
        
        for (const keyword of industryKeywords) {
            if (inputLower.includes(keyword.toLowerCase())) {
                // They mentioned industry-specific term - this IS their issue
                return { issue: input.substring(0, 100), confidence: 0.8 };
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // TIER 3: Universal problem words (lower confidence)
        // ═══════════════════════════════════════════════════════════════════════
        const problemWords = [
            'issue', 'problem', 'trouble', 'wrong', 'broken', 'not working',
            'help', 'emergency', 'urgent', 'asap', 'appointment', 'schedule',
            'service', 'repair', 'fix', 'check', 'inspect'
        ];
        
        for (const word of problemWords) {
            if (inputLower.includes(word)) {
                return { issue: input.substring(0, 100), confidence: 0.75 };
            }
        }
        
        return { issue: null, confidence: 0 };
    }
    
    /**
     * Get industry-specific keywords from company configuration
     * Sources: triage cards, service types, trade categories
     * This ensures we're NOT hardcoded to any specific industry
     */
    _getIndustryKeywords() {
        const keywords = new Set();
        
        // ═══════════════════════════════════════════════════════════════════════
        // SOURCE 1: Triage cards (most specific to this company)
        // ═══════════════════════════════════════════════════════════════════════
        const triageCards = this.company.aiAgentSettings?.triageCards || [];
        for (const card of triageCards) {
            // Add card keywords
            if (card.keywords && Array.isArray(card.keywords)) {
                card.keywords.forEach(k => keywords.add(k.toLowerCase()));
            }
            // Add trigger phrases
            if (card.triggerPhrases && Array.isArray(card.triggerPhrases)) {
                card.triggerPhrases.forEach(p => {
                    // Extract key words from phrases
                    p.toLowerCase().split(/\s+/).forEach(word => {
                        if (word.length > 3) keywords.add(word);
                    });
                });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // SOURCE 2: Service types from company config
        // ═══════════════════════════════════════════════════════════════════════
        const serviceTypes = this.company.aiAgentSettings?.serviceTypeClarification?.serviceTypes || [];
        for (const st of serviceTypes) {
            if (st.label) keywords.add(st.label.toLowerCase());
            if (st.keywords && Array.isArray(st.keywords)) {
                st.keywords.forEach(k => keywords.add(k.toLowerCase()));
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // SOURCE 3: Trade categories (high level)
        // ═══════════════════════════════════════════════════════════════════════
        const tradeCategories = this.company.tradeCategories || [];
        for (const trade of tradeCategories) {
            keywords.add(trade.toLowerCase());
            // Add common variations
            const tradeKeywords = this._getTradeKeywords(trade);
            tradeKeywords.forEach(k => keywords.add(k));
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // SOURCE 4: Discovery keywords from UI config (if configured)
        // ═══════════════════════════════════════════════════════════════════════
        const discoveryKeywords = this.stagesConfig.discoverySettings?.industryKeywords || [];
        discoveryKeywords.forEach(k => keywords.add(k.toLowerCase()));
        
        // If no keywords configured, return empty (Tier 1 patterns will still work)
        if (keywords.size === 0) {
            logger.warn('[STATE MACHINE V2] No industry keywords configured - using universal patterns only');
        }
        
        return Array.from(keywords);
    }
    
    /**
     * Get common keywords for a trade category
     * This is a fallback for companies that haven't configured detailed keywords
     */
    _getTradeKeywords(trade) {
        const tradeLower = trade.toLowerCase();
        
        // Common keywords by trade (fallback only)
        const tradeKeywordMap = {
            'hvac': ['thermostat', 'ac', 'air conditioning', 'furnace', 'heat', 'cooling', 'duct', 'vent', 'compressor'],
            'plumbing': ['pipe', 'drain', 'faucet', 'toilet', 'water heater', 'leak', 'clog', 'sewer'],
            'electrical': ['outlet', 'switch', 'breaker', 'wiring', 'light', 'power', 'circuit'],
            'dental': ['tooth', 'teeth', 'cleaning', 'cavity', 'filling', 'crown', 'extraction', 'pain'],
            'medical': ['appointment', 'doctor', 'checkup', 'prescription', 'symptoms', 'pain'],
            'legal': ['case', 'lawyer', 'attorney', 'consultation', 'lawsuit', 'contract'],
            'automotive': ['car', 'vehicle', 'oil change', 'brake', 'tire', 'engine', 'transmission'],
            'landscaping': ['lawn', 'tree', 'garden', 'mowing', 'trimming', 'irrigation'],
            'cleaning': ['clean', 'maid', 'housekeeping', 'deep clean', 'carpet'],
            'pest control': ['pest', 'bug', 'insect', 'rodent', 'termite', 'ant', 'roach'],
            'roofing': ['roof', 'shingle', 'leak', 'gutter', 'flashing'],
            'appliance': ['refrigerator', 'washer', 'dryer', 'dishwasher', 'oven', 'microwave']
        };
        
        return tradeKeywordMap[tradeLower] || [];
    }
    
    _extractContext(input) {
        const contextPatterns = [
            { pattern: /you\s+(?:guys\s+)?(?:were|came)\s+(?:here|out)\s+(\w+)/i, confidence: 0.9 },
            { pattern: /(?:technician|tech|someone)\s+(?:was|came)\s+(?:here|out)\s+(\w+)/i, confidence: 0.9 },
            { pattern: /(?:had|have)\s+(?:this|it)\s+(?:fixed|repaired|looked at)\s+(\w+)/i, confidence: 0.85 },
            { pattern: /(?:same|this)\s+problem\s+(?:again|before)/i, confidence: 0.95 },
            { pattern: /(?:happening|happened)\s+(?:again|before)/i, confidence: 0.85 }
        ];
        
        for (const { pattern, confidence } of contextPatterns) {
            const match = input.match(pattern);
            if (match) {
                return { context: match[0], confidence, isRepeatVisit: true };
            }
        }
        
        return { context: null, confidence: 0, isRepeatVisit: false };
    }
    
    _detectMood(inputLower) {
        const moodIndicators = {
            frustrated: { 
                keywords: ['frustrated', 'annoyed', 'ridiculous', 'unbelievable', 'again', 'still', 'keeps happening'],
                confidence: 0.8
            },
            angry: { 
                keywords: ['angry', 'furious', 'unacceptable', 'terrible', 'worst', 'sue', 'lawyer', 'complaint'],
                confidence: 0.9
            },
            anxious: { 
                keywords: ['worried', 'concerned', 'scared', 'dangerous', 'emergency', 'urgent', 'asap'],
                confidence: 0.85
            },
            confused: { 
                keywords: ['confused', 'don\'t understand', 'what do you mean', 'not sure'],
                confidence: 0.75
            }
        };
        
        for (const [mood, { keywords, confidence }] of Object.entries(moodIndicators)) {
            if (keywords.some(ind => inputLower.includes(ind))) {
                return { mood, confidence };
            }
        }
        
        return { mood: 'neutral', confidence: 1.0 };
    }
    
    _detectCallType(inputLower) {
        if (inputLower.includes('question') || inputLower.includes('wondering') || inputLower.includes('?')) {
            return { callType: 'question', confidence: 0.8 };
        }
        
        if (inputLower.includes('bill') || inputLower.includes('invoice') || inputLower.includes('payment') || inputLower.includes('charge')) {
            return { callType: 'billing', confidence: 0.9 };
        }
        
        if (inputLower.includes('complaint') || inputLower.includes('unhappy') || inputLower.includes('not satisfied')) {
            return { callType: 'complaint', confidence: 0.85 };
        }
        
        if (inputLower.includes('schedule') || inputLower.includes('appointment') || inputLower.includes('book')) {
            return { callType: 'booking', confidence: 0.9 };
        }
        
        const problemWords = ['broken', 'not working', 'issue', 'problem', 'trouble', 'acting up', 'leaking', 'noise'];
        if (problemWords.some(w => inputLower.includes(w))) {
            return { callType: 'service_issue', confidence: 0.85 };
        }
        
        return { callType: 'unknown', confidence: 0 };
    }
    
    _checkUrgency(inputLower) {
        const patterns = this.contextConfig.urgencyPatterns || [
            'emergency', 'no heat', 'no ac', 'flooding', 'gas smell', 'smoke', 'sparking'
        ];
        
        for (const pattern of patterns) {
            if (inputLower.includes(pattern.toLowerCase())) {
                return { isUrgent: true, level: 'emergency', trigger: pattern };
            }
        }
        
        return { isUrgent: false, level: 'normal' };
    }
    
    _checkRepeatVisit(inputLower) {
        const patterns = this.contextConfig.repeatVisitPatterns || [
            'you were here', 'you guys came', 'technician was here', 'same problem again'
        ];
        
        for (const pattern of patterns) {
            if (inputLower.includes(pattern.toLowerCase())) {
                return { isRepeat: true, context: pattern };
            }
        }
        
        return { isRepeat: false };
    }
    
    _checkOffRails(inputLower) {
        if (!this.offRailsConfig.enabled) {
            return { isOffRails: false };
        }
        
        const triggerCategories = [
            { key: 'frustration', type: 'frustrated' },
            { key: 'problemQuestions', type: 'problemQuestion' },
            { key: 'humanRequest', type: 'humanRequest' },
            { key: 'confusion', type: 'confused' }
        ];
        
        for (const { key, type } of triggerCategories) {
            const triggers = this.offRailsConfig.defaultTriggers?.[key] || [];
            for (const trigger of triggers) {
                if (inputLower.includes(trigger.toLowerCase())) {
                    return { isOffRails: true, type, trigger };
                }
            }
        }
        
        return { isOffRails: false };
    }
    
    _getBookingQuestion(slotId) {
        const slot = this.bookingSlots.find(s => (s.id || s.slotId) === slotId);
        
        if (slot?.question) {
            // ✅ USING UI-CONFIGURED QUESTION
            logger.info('[STATE MACHINE] 📋 BOOKING QUESTION FROM UI:', {
                slotId,
                question: slot.question,
                source: 'UI_CONFIG ✅'
            });
            return slot.question;
        }
        
        // ⚠️ FALLBACK - UI config missing for this slot
        const defaults = {
            name: "May I have your name please?",
            phone: "What's the best phone number to reach you?",
            address: "What's the service address?",
            time: "When works best for you?"
        };
        
        const fallbackQuestion = defaults[slotId] || `What is your ${slotId}?`;
        
        logger.warn('[STATE MACHINE] ⚠️ BOOKING QUESTION FALLBACK:', {
            slotId,
            question: fallbackQuestion,
            source: 'HARDCODED_DEFAULT ⚠️',
            reason: 'No UI config found for this slot',
            availableSlots: this.bookingSlots.map(s => s.id || s.slotId)
        });
        
        return fallbackQuestion;
    }
    
    _getNextTriageQuestion() {
        // TODO: Integrate with triage cards
        return null;
    }
    
    _getCurrentQuestion() {
        switch (this.flow.currentStage) {
            case STAGES.DISCOVERY:
                return this.stagesConfig.discoveryPrompts?.needMoreInfo ||
                    "Can you tell me more about what's going on?";
                
            case STAGES.BOOKING:
                if (this.booking.missingSlots.length > 0) {
                    return this._getBookingQuestion(this.booking.missingSlots[0]);
                }
                return this._getBookingQuestion('name');
                
            case STAGES.CONFIRMATION:
                return "Does that all sound correct?";
                
            default:
                return "How can I help you?";
        }
    }
    
    _buildConfirmation() {
        const template = this.stagesConfig.confirmationSettings?.template ||
            this.frontDeskConfig.bookingTemplates?.confirmTemplate ||
            "Let me confirm: I have {name} at {phone}, service address {address}. Is that correct?";
        
        return this._replacePlaceholders(template);
    }
    
    _replacePlaceholders(template) {
        let result = template;
        
        result = result.replace(/{name}/g, this.booking.collectedSlots.name || 'your name');
        result = result.replace(/{phone}/g, this.booking.collectedSlots.phone || 'your phone');
        result = result.replace(/{address}/g, this.booking.collectedSlots.address || 'the address');
        result = result.replace(/{time}/g, this.booking.collectedSlots.time || 'the scheduled time');
        result = result.replace(/{issue}/g, this.discovery.issue || 'your issue');
        result = result.replace(/{context}/g, this.discovery.context || '');
        
        result = result.replace(/\s+\./g, '.').replace(/\s{2,}/g, ' ').trim();
        
        return result;
    }
    
    _isConfirmation(inputLower) {
        const confirmWords = ['yes', 'yeah', 'yep', 'correct', 'right', 'that\'s right', 'sounds good', 'perfect'];
        return confirmWords.some(w => inputLower.includes(w));
    }
    
    _isDenial(inputLower) {
        const denyWords = ['no', 'nope', 'wrong', 'incorrect', 'that\'s not', 'actually'];
        return denyWords.some(w => inputLower.includes(w));
    }
    
    _updateFromExtracted(extracted) {
        // Handle name - accept either full name or partialName (first name only)
        if (!this.booking.collectedSlots.name) {
            if (extracted.name) {
                this.booking.collectedSlots.name = extracted.name;
                logger.info('[STATE MACHINE V2] 📝 Name collected', { name: extracted.name });
            } else if (extracted.partialName) {
                // Accept partial name (first name only) as the name
                this.booking.collectedSlots.name = extracted.partialName;
                this.booking.partialName = extracted.partialName;
                logger.info('[STATE MACHINE V2] 📝 Partial name accepted as name', { partialName: extracted.partialName });
            }
        }
        
        if (extracted.phone && !this.booking.collectedSlots.phone) {
            this.booking.collectedSlots.phone = extracted.phone;
            logger.info('[STATE MACHINE V2] 📝 Phone collected', { phone: extracted.phone });
        }
        if (extracted.address && !this.booking.collectedSlots.address) {
            this.booking.collectedSlots.address = extracted.address;
            logger.info('[STATE MACHINE V2] 📝 Address collected', { address: extracted.address });
        }
        if (extracted.time && !this.booking.collectedSlots.time) {
            this.booking.collectedSlots.time = extracted.time;
            logger.info('[STATE MACHINE V2] 📝 Time collected', { time: extracted.time });
        }
        
        // Recompute missing slots after updates
        this._computeMissingSlots();
        
        logger.info('[STATE MACHINE V2] 📊 After extraction update', {
            collectedSlots: this.booking.collectedSlots,
            missingSlots: this.booking.missingSlots
        });
    }
    
    _buildLLMContext() {
        return {
            // Flow state
            currentStage: this.flow.currentStage,
            currentStep: this.flow.currentStep,
            turnsInStage: this.flow.turnsInCurrentStage,
            totalTurns: this.flow.totalTurns,
            isFallbackActive: this.flow.isFallbackActive,
            offRailsCount: this.flow.offRailsCount,
            lastSystemPrompt: this.flow.lastSystemPrompt,
            
            // Discovery
            callerIssue: this.discovery.issue,
            callerContext: this.discovery.context,
            callerMood: this.discovery.mood,
            callType: this.discovery.callType,
            urgency: this.discovery.urgency,
            
            // Triage
            triageOutcome: this.triage.outcome,
            triageAnswers: this.triage.answers,
            
            // Booking
            slotsCollected: this.booking.collectedSlots,
            missingSlots: this.booking.missingSlots,
            
            // Memory
            discussedTopics: this.memory.discussedTopics,
            keyFacts: this.memory.keyFacts,
            
            // Recovery config
            recoveryResponses: this.offRailsConfig.responses,
            bridgeBackPhrase: this.offRailsConfig.bridgeBack?.transitionPhrase,
            returnToQuestion: this._getCurrentQuestion()
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STATE EXPORT FOR SESSION PERSISTENCE
    // ═══════════════════════════════════════════════════════════════════════════
    
    getStateForSession() {
        return {
            // Discovery
            discovery: {
                ...this.discovery
            },
            
            // Triage
            triageState: {
                activeCardId: this.triage.activeCardId,
                currentQuestionId: this.triage.currentQuestionId,
                questionsAsked: this.triage.questionsAsked,
                answers: this.triage.answers,
                outcome: this.triage.outcome,
                completedAt: this.triage.completedAt
            },
            
            // Booking slots (flat for backward compatibility)
            collectedSlots: this.booking.collectedSlots,
            
            // Conversation memory (includes flow state)
            conversationMemory: {
                currentStage: this.flow.currentStage,
                currentStep: this.flow.currentStep,
                turnsInCurrentStage: this.flow.turnsInCurrentStage,
                isFallbackActive: this.flow.isFallbackActive,
                offRailsCount: this.flow.offRailsCount,
                lastSystemPrompt: this.flow.lastSystemPrompt,
                bookingConfirmed: this.booking.confirmed,
                missingSlots: this.booking.missingSlots,
                discussedTopics: this.memory.discussedTopics,
                keyFacts: this.memory.keyFacts,
                recoveryAttempts: this.memory.recoveryAttempts,
                auditTrail: this.auditTrail
            }
        };
    }
}

// Export
module.exports = ConversationStateMachine;
module.exports.STAGES = STAGES;
module.exports.BOOKING_STEPS = BOOKING_STEPS;
module.exports.ENTERPRISE_CONFIG = ENTERPRISE_CONFIG;
