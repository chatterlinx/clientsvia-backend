/**
 * ============================================================================
 * CONVERSATION STATE MACHINE - Enterprise Flow Controller
 * ============================================================================
 * 
 * This is the BRAIN that controls the conversation flow.
 * 
 * ARCHITECTURE:
 * - Deterministic Core: 95% of interactions (0 tokens, 100% reliable)
 * - LLM Fallback: 5% for off-rails recovery only
 * 
 * STAGES:
 * 1. GREETING - Fixed responses, detect time of day
 * 2. DISCOVERY - Capture issue, context, call type, mood
 * 3. TRIAGE - Diagnostic questions from triage cards
 * 4. BOOKING - Fixed slot questions from UI config
 * 5. CONFIRMATION - Summarize everything, confirm
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
    ESCALATED: 'escalated'
};

const BOOKING_STEPS = {
    ASK_NAME: 'ASK_NAME',
    ASK_PHONE: 'ASK_PHONE',
    ASK_ADDRESS: 'ASK_ADDRESS',
    ASK_TIME: 'ASK_TIME',
    CONFIRM: 'CONFIRM'
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
        
        // Current state from session
        this.currentStage = session.conversationMemory?.currentStage || STAGES.GREETING;
        this.currentStep = session.conversationMemory?.currentStep || null;
        
        // Discovery data
        this.discovery = session.discovery || {};
        
        // Triage state
        this.triageState = session.triageState || {};
        
        // Collected slots
        this.slots = { ...(session.collectedSlots || {}) };
        
        // Memory
        this.memory = session.conversationMemory || {};
        
        logger.info('[STATE MACHINE] Initialized', {
            sessionId: session._id,
            currentStage: this.currentStage,
            currentStep: this.currentStep,
            hasIssue: !!this.discovery.issue,
            slotsCollected: Object.keys(this.slots).filter(k => this.slots[k])
        });
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
        
        logger.info('[STATE MACHINE] Processing input', {
            stage: this.currentStage,
            step: this.currentStep,
            inputPreview: input.substring(0, 50),
            extracted: Object.keys(extracted)
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 1: Check for off-rails (before anything else)
        // ═══════════════════════════════════════════════════════════════════
        const offRailsCheck = this.checkOffRails(inputLower);
        if (offRailsCheck.isOffRails) {
            logger.info('[STATE MACHINE] 🚨 OFF-RAILS DETECTED', {
                trigger: offRailsCheck.trigger,
                type: offRailsCheck.type
            });
            
            return {
                action: 'LLM_FALLBACK',
                stage: this.currentStage,
                step: this.currentStep,
                offRails: offRailsCheck,
                returnToQuestion: this.getCurrentQuestion(),
                context: this.buildLLMContext()
            };
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 2: Update state with extracted data
        // ═══════════════════════════════════════════════════════════════════
        this.updateFromExtracted(extracted);
        
        // ═══════════════════════════════════════════════════════════════════
        // STEP 3: Route to current stage handler
        // ═══════════════════════════════════════════════════════════════════
        switch (this.currentStage) {
            case STAGES.GREETING:
                return this.handleGreeting(input, inputLower);
                
            case STAGES.DISCOVERY:
                return this.handleDiscovery(input, inputLower, extracted);
                
            case STAGES.TRIAGE:
                return this.handleTriage(input, inputLower, extracted);
                
            case STAGES.BOOKING:
                return this.handleBooking(input, inputLower, extracted);
                
            case STAGES.CONFIRMATION:
                return this.handleConfirmation(input, inputLower);
                
            case STAGES.COMPLETE:
                return this.handleComplete(input, inputLower);
                
            default:
                logger.warn('[STATE MACHINE] Unknown stage, defaulting to greeting', { stage: this.currentStage });
                this.currentStage = STAGES.GREETING;
                return this.handleGreeting(input, inputLower);
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // STAGE HANDLERS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * GREETING STAGE - Fixed responses, 0 tokens
     */
    handleGreeting(input, inputLower) {
        // Check if this is a greeting
        const isGreeting = this.isGreeting(inputLower);
        
        if (isGreeting) {
            // Respond with time-appropriate greeting
            const response = this.getGreetingResponse();
            
            // Stay in greeting, waiting for them to explain why they called
            // Actually, move to DISCOVERY since we've greeted them
            this.currentStage = STAGES.DISCOVERY;
            
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
        this.currentStage = STAGES.DISCOVERY;
        return this.handleDiscovery(input, inputLower, {});
    }
    
    /**
     * DISCOVERY STAGE - Capture issue, context, call type
     */
    handleDiscovery(input, inputLower, extracted) {
        // ═══════════════════════════════════════════════════════════════════
        // Extract issue and context from what they said
        // ═══════════════════════════════════════════════════════════════════
        const issueExtraction = this.extractIssue(input);
        const contextExtraction = this.extractContext(input);
        const moodDetection = this.detectMood(inputLower);
        const callTypeDetection = this.detectCallType(inputLower);
        
        // Update discovery
        if (issueExtraction.issue && !this.discovery.issue) {
            this.discovery.issue = issueExtraction.issue;
            this.discovery.issueCapturedAtTurn = this.session.metrics?.totalTurns || 0;
            logger.info('[STATE MACHINE] 📋 Issue captured', { issue: this.discovery.issue });
        }
        
        if (contextExtraction.context && !this.discovery.context) {
            this.discovery.context = contextExtraction.context;
            logger.info('[STATE MACHINE] 📋 Context captured', { context: this.discovery.context });
        }
        
        if (moodDetection.mood !== 'neutral') {
            this.discovery.mood = moodDetection.mood;
        }
        
        if (callTypeDetection.callType !== 'unknown') {
            this.discovery.callType = callTypeDetection.callType;
        }
        
        // Check for urgency
        const urgencyCheck = this.checkUrgency(inputLower);
        if (urgencyCheck.isUrgent) {
            this.discovery.urgency = urgencyCheck.level;
        }
        
        // Check for repeat visit
        const repeatCheck = this.checkRepeatVisit(inputLower);
        if (repeatCheck.isRepeat) {
            this.discovery.urgency = 'repeat_issue';
            if (!this.discovery.context) {
                this.discovery.context = repeatCheck.context;
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // Determine next stage
        // ═══════════════════════════════════════════════════════════════════
        
        // If we have an issue, acknowledge and decide next step
        if (this.discovery.issue) {
            // Build acknowledgment
            let acknowledgment = '';
            
            // Acknowledge repeat visit if detected
            if (repeatCheck.isRepeat) {
                acknowledgment = this.contextConfig.repeatVisitAcknowledgment || 
                    "I see we've been out before. I apologize that the issue is continuing.";
            }
            // Acknowledge urgency if detected
            else if (urgencyCheck.isUrgent) {
                acknowledgment = this.contextConfig.urgencyAcknowledgment ||
                    "I understand this is urgent. Let me get someone out to you as quickly as possible.";
            }
            // Standard issue acknowledgment
            else if (this.stagesConfig.triageSettings?.acknowledgeIssueFirst) {
                acknowledgment = this.stagesConfig.triageSettings?.issueAcknowledgment ||
                    "I'm sorry to hear that. Let me help you get this resolved.";
            }
            
            // Decide: TRIAGE or straight to BOOKING?
            const shouldTriage = this.stagesConfig.triageSettings?.enabled && 
                                 this.stagesConfig.triageSettings?.autoTriageOnIssue &&
                                 this.discovery.callType === 'service_issue';
            
            if (shouldTriage) {
                // Move to triage
                this.currentStage = STAGES.TRIAGE;
                this.discovery.completedAt = new Date();
                
                // Get first triage question (if we have a matched card)
                const triageQuestion = this.getNextTriageQuestion();
                
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
            
            // No triage or no triage card - go straight to booking
            this.currentStage = STAGES.BOOKING;
            this.currentStep = BOOKING_STEPS.ASK_NAME;
            this.discovery.completedAt = new Date();
            
            // Get transition to booking + first booking question
            const transitionMsg = this.stagesConfig.bookingSettings?.transitionToBooking ||
                "Let's get you scheduled.";
            const firstQuestion = this.getBookingQuestion('name');
            
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
    handleTriage(input, inputLower, extracted) {
        // Record answer to previous question
        if (this.triageState.questionsAsked?.length > 0) {
            const lastQuestion = this.triageState.questionsAsked[this.triageState.questionsAsked.length - 1];
            
            if (!this.triageState.answersReceived) {
                this.triageState.answersReceived = [];
            }
            
            this.triageState.answersReceived.push({
                question: lastQuestion.question,
                answer: input,
                turnNumber: this.session.metrics?.totalTurns || 0,
                receivedAt: new Date()
            });
        }
        
        // Check if we've asked enough questions
        const maxQuestions = this.stagesConfig.triageSettings?.maxDiagnosticQuestions || 3;
        const questionsAsked = this.triageState.questionsAsked?.length || 0;
        
        if (questionsAsked >= maxQuestions) {
            // Move to booking
            this.currentStage = STAGES.BOOKING;
            this.currentStep = BOOKING_STEPS.ASK_NAME;
            this.triageState.completedAt = new Date();
            this.triageState.outcome = 'needs_technician';
            
            const transitionMsg = this.stagesConfig.bookingSettings?.transitionToBooking ||
                "Let's get you scheduled.";
            const firstQuestion = this.getBookingQuestion('name');
            
            return {
                action: 'RESPOND',
                stage: STAGES.TRIAGE,
                response: `${transitionMsg} ${firstQuestion}`,
                nextStage: STAGES.BOOKING,
                nextStep: BOOKING_STEPS.ASK_NAME,
                tokensUsed: 0,
                source: 'STATE_MACHINE_TRIAGE',
                triageComplete: true,
                triageState: this.triageState
            };
        }
        
        // Get next triage question
        const nextQuestion = this.getNextTriageQuestion();
        
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
        this.currentStage = STAGES.BOOKING;
        this.currentStep = BOOKING_STEPS.ASK_NAME;
        this.triageState.completedAt = new Date();
        
        const transitionMsg = this.stagesConfig.bookingSettings?.transitionToBooking ||
            "Let's get you scheduled.";
        const firstQuestion = this.getBookingQuestion('name');
        
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
     */
    handleBooking(input, inputLower, extracted) {
        // Update slots from extracted data
        if (extracted.name) this.slots.name = extracted.name;
        if (extracted.phone) this.slots.phone = extracted.phone;
        if (extracted.address) this.slots.address = extracted.address;
        if (extracted.time) this.slots.time = extracted.time;
        
        // Determine what slot we need next
        const slotOrder = ['name', 'phone', 'address', 'time'];
        
        for (const slotId of slotOrder) {
            // Find slot config
            const slotConfig = this.bookingSlots.find(s => 
                (s.id || s.slotId) === slotId
            );
            
            // Skip if already collected
            if (this.slots[slotId]) {
                continue;
            }
            
            // Skip if optional and not required
            if (slotConfig?.required === false) {
                continue;
            }
            
            // This is the slot we need - ask for it
            const question = this.getBookingQuestion(slotId);
            this.currentStep = `ASK_${slotId.toUpperCase()}`;
            
            // Build acknowledgment for what we just got
            let ack = '';
            if (extracted.name) ack = `Thanks, ${extracted.name}!`;
            else if (extracted.phone) ack = 'Got it!';
            else if (extracted.address) ack = 'Perfect!';
            
            const response = ack ? `${ack} ${question}` : question;
            
            return {
                action: 'RESPOND',
                stage: STAGES.BOOKING,
                step: this.currentStep,
                response: response,
                nextStage: STAGES.BOOKING,
                nextStep: this.currentStep,
                tokensUsed: 0,
                source: 'STATE_MACHINE_BOOKING',
                slotsCollected: this.slots
            };
        }
        
        // All slots collected - move to confirmation
        this.currentStage = STAGES.CONFIRMATION;
        this.currentStep = null;
        
        const confirmationMsg = this.buildConfirmation();
        
        return {
            action: 'RESPOND',
            stage: STAGES.BOOKING,
            response: confirmationMsg,
            nextStage: STAGES.CONFIRMATION,
            tokensUsed: 0,
            source: 'STATE_MACHINE_BOOKING',
            slotsCollected: this.slots,
            bookingComplete: true
        };
    }
    
    /**
     * CONFIRMATION STAGE - Summarize and confirm
     */
    handleConfirmation(input, inputLower) {
        // Check for confirmation
        const isConfirmed = this.isConfirmation(inputLower);
        const isDenied = this.isDenial(inputLower);
        
        if (isConfirmed) {
            this.currentStage = STAGES.COMPLETE;
            
            const completeMsg = this.frontDeskConfig.bookingTemplates?.completeTemplate ||
                "You're all set! You'll receive a confirmation shortly. Is there anything else?";
            
            // Replace placeholders
            const response = this.replacePlaceholders(completeMsg);
            
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
            // They said no - need to figure out what's wrong
            // Use LLM to handle this
            return {
                action: 'LLM_FALLBACK',
                stage: STAGES.CONFIRMATION,
                reason: 'confirmation_denied',
                context: this.buildLLMContext()
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
    handleComplete(input, inputLower) {
        // Check if they have more questions
        const hasMore = inputLower.includes('yes') || 
                       inputLower.includes('actually') ||
                       inputLower.includes('one more') ||
                       inputLower.includes('question');
        
        if (hasMore) {
            // They have more - use LLM to handle
            return {
                action: 'LLM_FALLBACK',
                stage: STAGES.COMPLETE,
                reason: 'follow_up_question',
                context: this.buildLLMContext()
            };
        }
        
        // They're done
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
    // HELPER METHODS
    // ═══════════════════════════════════════════════════════════════════════════
    
    /**
     * Check if input is a greeting
     */
    isGreeting(inputLower) {
        const greetingPatterns = [
            /^(hi|hello|hey|yo|howdy)[\s\.\!\?]*$/,
            /^good\s+(morning|afternoon|evening)[\s\.\!\?]*$/,
            /^(hi|hello|hey)\s+good\s+(morning|afternoon|evening)/,
            /^(hi|hello|hey)\s+there/,
            /^(hi|hello|hey)[\s,]+how are you/
        ];
        
        return greetingPatterns.some(p => p.test(inputLower));
    }
    
    /**
     * Get time-appropriate greeting response from UI config
     */
    getGreetingResponse() {
        const hour = new Date().getHours();
        const greetings = this.stagesConfig.greetingResponses || {};
        
        if (hour < 12) {
            return greetings.morning || "Good morning! How can I help you today?";
        } else if (hour < 17) {
            return greetings.afternoon || "Good afternoon! How can I help you today?";
        } else {
            return greetings.evening || "Good evening! How can I help you today?";
        }
    }
    
    /**
     * Extract issue from user input
     */
    extractIssue(input) {
        // Look for problem indicators
        const problemPatterns = [
            /(?:my|the|our)\s+(\w+(?:\s+\w+)?)\s+(?:is|isn't|isnt|are|aren't|arent)\s+(\w+)/i,
            /(?:having|have)\s+(?:a\s+)?(?:problem|issue|trouble)\s+(?:with\s+)?(?:my|the|our)?\s*(\w+)/i,
            /(\w+(?:\s+\w+)?)\s+(?:not working|broken|acting up|making noise|leaking)/i,
            /(?:need|want)\s+(?:to\s+)?(?:fix|repair|replace|check)\s+(?:my|the|our)?\s*(\w+)/i
        ];
        
        for (const pattern of problemPatterns) {
            const match = input.match(pattern);
            if (match) {
                // Clean up the extracted issue
                const issue = match[0].replace(/^(my|the|our)\s+/i, '').trim();
                return { issue, confidence: 0.8 };
            }
        }
        
        // Check for service keywords
        const serviceKeywords = [
            'thermostat', 'ac', 'air conditioning', 'heat', 'heating', 'furnace',
            'cooling', 'hvac', 'unit', 'system', 'compressor', 'duct', 'vent',
            'plumbing', 'pipe', 'drain', 'faucet', 'toilet', 'water heater'
        ];
        
        const inputLower = input.toLowerCase();
        for (const keyword of serviceKeywords) {
            if (inputLower.includes(keyword)) {
                return { issue: input.substring(0, 100), confidence: 0.6 };
            }
        }
        
        return { issue: null, confidence: 0 };
    }
    
    /**
     * Extract context from user input
     */
    extractContext(input) {
        const contextPatterns = [
            /you\s+(?:guys\s+)?(?:were|came)\s+(?:here|out)\s+(\w+)/i,
            /(?:technician|tech|someone)\s+(?:was|came)\s+(?:here|out)\s+(\w+)/i,
            /(?:had|have)\s+(?:this|it)\s+(?:fixed|repaired|looked at)\s+(\w+)/i,
            /(?:same|this)\s+problem\s+(?:again|before)/i,
            /(?:happening|happened)\s+(?:again|before)/i
        ];
        
        for (const pattern of contextPatterns) {
            const match = input.match(pattern);
            if (match) {
                return { context: match[0], isRepeatVisit: true };
            }
        }
        
        return { context: null, isRepeatVisit: false };
    }
    
    /**
     * Detect caller mood
     */
    detectMood(inputLower) {
        const moodIndicators = {
            frustrated: ['frustrated', 'annoyed', 'ridiculous', 'unbelievable', 'again', 'still', 'keeps happening'],
            angry: ['angry', 'furious', 'unacceptable', 'terrible', 'worst', 'sue', 'lawyer', 'complaint'],
            anxious: ['worried', 'concerned', 'scared', 'dangerous', 'emergency', 'urgent', 'asap'],
            confused: ['confused', 'don\'t understand', 'what do you mean', 'not sure']
        };
        
        for (const [mood, indicators] of Object.entries(moodIndicators)) {
            if (indicators.some(ind => inputLower.includes(ind))) {
                return { mood, confidence: 0.7 };
            }
        }
        
        return { mood: 'neutral', confidence: 1.0 };
    }
    
    /**
     * Detect call type
     */
    detectCallType(inputLower) {
        if (inputLower.includes('question') || inputLower.includes('wondering') || inputLower.includes('?')) {
            return { callType: 'question' };
        }
        
        if (inputLower.includes('bill') || inputLower.includes('invoice') || inputLower.includes('payment') || inputLower.includes('charge')) {
            return { callType: 'billing' };
        }
        
        if (inputLower.includes('complaint') || inputLower.includes('unhappy') || inputLower.includes('not satisfied')) {
            return { callType: 'complaint' };
        }
        
        if (inputLower.includes('schedule') || inputLower.includes('appointment') || inputLower.includes('book')) {
            return { callType: 'booking' };
        }
        
        // Default to service issue if they mention a problem
        const problemWords = ['broken', 'not working', 'issue', 'problem', 'trouble', 'acting up', 'leaking', 'noise'];
        if (problemWords.some(w => inputLower.includes(w))) {
            return { callType: 'service_issue' };
        }
        
        return { callType: 'unknown' };
    }
    
    /**
     * Check for urgency indicators
     */
    checkUrgency(inputLower) {
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
    
    /**
     * Check for repeat visit indicators
     */
    checkRepeatVisit(inputLower) {
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
    
    /**
     * Check if input indicates off-rails
     */
    checkOffRails(inputLower) {
        if (!this.offRailsConfig.enabled) {
            return { isOffRails: false };
        }
        
        // Check frustration triggers
        const frustrationTriggers = this.offRailsConfig.defaultTriggers?.frustration || [];
        for (const trigger of frustrationTriggers) {
            if (inputLower.includes(trigger.toLowerCase())) {
                return { isOffRails: true, type: 'frustrated', trigger };
            }
        }
        
        // Check problem question triggers
        const problemTriggers = this.offRailsConfig.defaultTriggers?.problemQuestions || [];
        for (const trigger of problemTriggers) {
            if (inputLower.includes(trigger.toLowerCase())) {
                return { isOffRails: true, type: 'problemQuestion', trigger };
            }
        }
        
        // Check human request triggers
        const humanTriggers = this.offRailsConfig.defaultTriggers?.humanRequest || [];
        for (const trigger of humanTriggers) {
            if (inputLower.includes(trigger.toLowerCase())) {
                return { isOffRails: true, type: 'humanRequest', trigger };
            }
        }
        
        // Check confusion triggers
        const confusionTriggers = this.offRailsConfig.defaultTriggers?.confusion || [];
        for (const trigger of confusionTriggers) {
            if (inputLower.includes(trigger.toLowerCase())) {
                return { isOffRails: true, type: 'confused', trigger };
            }
        }
        
        return { isOffRails: false };
    }
    
    /**
     * Get booking question for a slot from UI config
     */
    getBookingQuestion(slotId) {
        const slot = this.bookingSlots.find(s => (s.id || s.slotId) === slotId);
        
        if (slot?.question) {
            return slot.question;
        }
        
        // Fallback defaults (should never need these if UI is configured)
        const defaults = {
            name: "May I have your name please?",
            phone: "What's the best phone number to reach you?",
            address: "What's the service address?",
            time: "When works best for you?"
        };
        
        return defaults[slotId] || `What is your ${slotId}?`;
    }
    
    /**
     * Get next triage question
     */
    getNextTriageQuestion() {
        // TODO: Integrate with triage cards
        // For now, return null to skip triage
        return null;
    }
    
    /**
     * Get current question for the current stage/step
     */
    getCurrentQuestion() {
        switch (this.currentStage) {
            case STAGES.DISCOVERY:
                return this.stagesConfig.discoveryPrompts?.needMoreInfo ||
                    "Can you tell me more about what's going on?";
                
            case STAGES.BOOKING:
                if (this.currentStep) {
                    const slotId = this.currentStep.replace('ASK_', '').toLowerCase();
                    return this.getBookingQuestion(slotId);
                }
                return this.getBookingQuestion('name');
                
            case STAGES.CONFIRMATION:
                return "Does that all sound correct?";
                
            default:
                return "How can I help you?";
        }
    }
    
    /**
     * Build confirmation message
     */
    buildConfirmation() {
        const template = this.stagesConfig.confirmationSettings?.template ||
            this.frontDeskConfig.bookingTemplates?.confirmTemplate ||
            "Let me confirm: I have {name} at {phone}, service address {address}. Is that correct?";
        
        return this.replacePlaceholders(template);
    }
    
    /**
     * Replace placeholders in template
     */
    replacePlaceholders(template) {
        let result = template;
        
        // Replace slot placeholders
        result = result.replace(/{name}/g, this.slots.name || 'your name');
        result = result.replace(/{phone}/g, this.slots.phone || 'your phone');
        result = result.replace(/{address}/g, this.slots.address || 'the address');
        result = result.replace(/{time}/g, this.slots.time || 'the scheduled time');
        
        // Replace discovery placeholders
        result = result.replace(/{issue}/g, this.discovery.issue || 'your issue');
        result = result.replace(/{context}/g, this.discovery.context || '');
        
        // Clean up empty context
        result = result.replace(/\s+\./g, '.').replace(/\s{2,}/g, ' ').trim();
        
        return result;
    }
    
    /**
     * Check if input is a confirmation
     */
    isConfirmation(inputLower) {
        const confirmWords = ['yes', 'yeah', 'yep', 'correct', 'right', 'that\'s right', 'sounds good', 'perfect'];
        return confirmWords.some(w => inputLower.includes(w));
    }
    
    /**
     * Check if input is a denial
     */
    isDenial(inputLower) {
        const denyWords = ['no', 'nope', 'wrong', 'incorrect', 'that\'s not', 'actually'];
        return denyWords.some(w => inputLower.includes(w));
    }
    
    /**
     * Update state from extracted data
     */
    updateFromExtracted(extracted) {
        if (extracted.name && !this.slots.name) {
            this.slots.name = extracted.name;
        }
        if (extracted.phone && !this.slots.phone) {
            this.slots.phone = extracted.phone;
        }
        if (extracted.address && !this.slots.address) {
            this.slots.address = extracted.address;
        }
        if (extracted.time && !this.slots.time) {
            this.slots.time = extracted.time;
        }
    }
    
    /**
     * Build context for LLM fallback
     */
    buildLLMContext() {
        return {
            // Discovery info
            callerIssue: this.discovery.issue,
            callerContext: this.discovery.context,
            callerMood: this.discovery.mood,
            callType: this.discovery.callType,
            urgency: this.discovery.urgency,
            
            // Triage info
            triageOutcome: this.triageState.outcome,
            diagnosisSummary: this.triageState.diagnosisSummary,
            
            // Booking info
            slotsCollected: this.slots,
            
            // Flow info
            currentStage: this.currentStage,
            currentStep: this.currentStep,
            
            // Memory
            discussedTopics: this.memory.discussedTopics,
            keyFacts: this.memory.keyFacts,
            offRailsCount: this.memory.offRailsCount || 0,
            
            // Recovery config
            recoveryResponses: this.offRailsConfig.responses,
            bridgeBackPhrase: this.offRailsConfig.bridgeBack?.transitionPhrase,
            returnToQuestion: this.getCurrentQuestion()
        };
    }
    
    /**
     * Get state to persist to session
     */
    getStateForSession() {
        return {
            discovery: this.discovery,
            triageState: this.triageState,
            collectedSlots: this.slots,
            conversationMemory: {
                ...this.memory,
                currentStage: this.currentStage,
                currentStep: this.currentStep
            }
        };
    }
}

// Export
module.exports = ConversationStateMachine;
module.exports.STAGES = STAGES;
module.exports.BOOKING_STEPS = BOOKING_STEPS;

