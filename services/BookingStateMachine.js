/**
 * ============================================================================
 * BOOKING STATE MACHINE
 * ============================================================================
 * 
 * DETERMINISTIC slot collection - NO LLM involvement in flow decisions.
 * 
 * This is the AUTHORITATIVE controller for booking flow.
 * The LLM has NO say in what gets asked next - only this state machine decides.
 * 
 * ARCHITECTURE:
 * - State machine OWNS the conversation flow
 * - Reads exact questions from UI config (frontDeskBehavior.bookingSlots)
 * - Tracks ask counts to prevent infinite loops
 * - Escalates after 3 failed attempts per slot
 * 
 * BENEFITS:
 * - 0 tokens for slot collection
 * - 100% reliable slot order
 * - No "dumb moments" or re-asking
 * - Exact questions from UI config used every time
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

class BookingStateMachine {
    /**
     * Initialize state machine for a session
     * @param {Object} session - ConversationSession document
     * @param {Object} company - Company document with aiAgentSettings
     */
    constructor(session, company) {
        this.session = session;
        this.company = company;
        
        // Current slot values
        this.slots = { ...(session.collectedSlots || {}) };
        
        // Booking config from UI
        this.bookingConfig = company.aiAgentSettings?.frontDeskBehavior?.bookingSlots || [];
        
        // State tracking for loop prevention
        this.lastAction = session.stateMachine?.lastAction || null;
        this.askCount = { ...(session.stateMachine?.askCount || {}) };
        this.state = session.stateMachine?.state || 'INIT';
        
        // Recovery messages from UI config
        this.recoveryMessages = company.aiAgentSettings?.frontDeskBehavior?.recoveryMessages || {};
        
        logger.info('[STATE MACHINE] Initialized', {
            sessionId: session._id,
            state: this.state,
            slotsHave: Object.keys(this.slots).filter(k => this.slots[k]),
            askCount: this.askCount
        });
    }
    
    /**
     * ════════════════════════════════════════════════════════════════════════
     * CORE: Get next action - 100% DETERMINISTIC
     * ════════════════════════════════════════════════════════════════════════
     * 
     * Returns a structured action object, NEVER raw text.
     * The ResponseRenderer will convert this to human-friendly speech.
     * 
     * @returns {Object} Action object with: action, slotId, exactQuestion, trace
     */
    getNextAction() {
        // Fixed slot order - NEVER changes
        const slotOrder = ['name', 'phone', 'address', 'time'];
        
        for (const slotId of slotOrder) {
            // Find slot config from UI
            const slotConfig = this.bookingConfig.find(s => 
                (s.slotId || s.id) === slotId
            );
            
            // Skip if already collected
            if (this.slots[slotId]) {
                continue;
            }
            
            // Skip if optional and not required
            if (slotConfig?.required === false) {
                continue;
            }
            
            // Check loop breaker - how many times have we asked?
            const timesAsked = this.askCount[slotId] || 0;
            
            // ══════════════════════════════════════════════════════════════
            // 3-STRIKE RULE: Escalate after 3 failed attempts
            // ══════════════════════════════════════════════════════════════
            if (timesAsked >= 3) {
                logger.warn('[STATE MACHINE] ESCALATE - 3 strikes', { slotId, timesAsked });
                return {
                    action: 'ESCALATE',
                    reason: `Failed to collect ${slotId} after 3 attempts`,
                    slotId,
                    trace: { 
                        timesAsked, 
                        state: this.state,
                        rule: '3-strike escalation'
                    }
                };
            }
            
            // ══════════════════════════════════════════════════════════════
            // 2-STRIKE RULE: Clarify mode after 2 failed attempts
            // ══════════════════════════════════════════════════════════════
            if (timesAsked >= 2) {
                logger.info('[STATE MACHINE] CLARIFY mode - 2nd attempt failed', { slotId, timesAsked });
                return {
                    action: 'CLARIFY',
                    slotId,
                    exactQuestion: slotConfig?.question || this.getDefaultQuestion(slotId),
                    clarifyPhrase: this.getClarifyPhrase(slotId),
                    expecting: slotId,
                    trace: { 
                        timesAsked, 
                        state: this.state,
                        rule: '2-strike clarify'
                    }
                };
            }
            
            // ══════════════════════════════════════════════════════════════
            // NORMAL: Ask for this slot
            // ══════════════════════════════════════════════════════════════
            logger.info('[STATE MACHINE] ASK_SLOT', { slotId, timesAsked });
            return {
                action: 'ASK_SLOT',
                slotId,
                exactQuestion: slotConfig?.question || this.getDefaultQuestion(slotId),
                expecting: slotId,
                trace: { 
                    timesAsked, 
                    state: this.state,
                    configSource: slotConfig ? 'UI' : 'default'
                }
            };
        }
        
        // ══════════════════════════════════════════════════════════════════
        // ALL SLOTS COLLECTED - Ready to confirm
        // ══════════════════════════════════════════════════════════════════
        logger.info('[STATE MACHINE] CONFIRM_BOOKING - All slots collected', { slots: this.slots });
        return {
            action: 'CONFIRM_BOOKING',
            slots: this.slots,
            trace: { 
                state: 'COMPLETE',
                slotsCollected: Object.keys(this.slots).filter(k => this.slots[k])
            }
        };
    }
    
    /**
     * Record that we asked for a slot (for loop prevention)
     * @param {string} slotId - The slot we're asking for
     */
    recordAsk(slotId) {
        if (!slotId) return;
        
        this.askCount[slotId] = (this.askCount[slotId] || 0) + 1;
        this.lastAction = `ASK_${slotId.toUpperCase()}`;
        this.state = 'COLLECTING';
        
        logger.info('[STATE MACHINE] Recorded ask', { 
            slotId, 
            askCount: this.askCount[slotId],
            lastAction: this.lastAction
        });
    }
    
    /**
     * Update slots with newly extracted data
     * @param {Object} extractedSlots - { name, phone, address, time }
     */
    updateSlots(extractedSlots) {
        if (!extractedSlots) return;
        
        for (const [key, value] of Object.entries(extractedSlots)) {
            if (value && !this.slots[key]) {
                this.slots[key] = value;
                logger.info('[STATE MACHINE] Slot filled', { slotId: key, value });
            }
        }
    }
    
    /**
     * Get state to persist to session
     * @returns {Object} State machine state for session.stateMachine
     */
    getStateForSession() {
        return {
            lastAction: this.lastAction,
            askCount: this.askCount,
            state: this.state
        };
    }
    
    /**
     * ════════════════════════════════════════════════════════════════════════
     * CHECK: Does this input need LLM interpretation?
     * ════════════════════════════════════════════════════════════════════════
     * 
     * Returns TRUE only if:
     * - User is asking a question
     * - User said something completely unexpected
     * - Extraction failed and we need smarter parsing
     * 
     * @param {string} userInput - What the user said
     * @param {Object} extractedSlots - What we extracted this turn
     * @returns {boolean} True if LLM should be called
     */
    needsLLMInterpretation(userInput, extractedSlots) {
        if (!userInput) return false;
        
        const input = userInput.toLowerCase().trim();
        
        // ══════════════════════════════════════════════════════════════════
        // RULE 1: If we got what we asked for, NO LLM needed
        // ══════════════════════════════════════════════════════════════════
        const expecting = this.lastAction?.replace('ASK_', '').toLowerCase();
        if (expecting && extractedSlots[expecting]) {
            logger.info('[STATE MACHINE] Got expected slot, no LLM needed', { expecting });
            return false;
        }
        
        // ══════════════════════════════════════════════════════════════════
        // RULE 2: User is asking a question - need LLM to answer
        // ══════════════════════════════════════════════════════════════════
        if (input.includes('?')) {
            logger.info('[STATE MACHINE] Question detected, LLM needed');
            return true;
        }
        
        // Question patterns without question mark
        const questionPatterns = /^(what|when|where|how|why|do you|can you|is there|are you|will you|could you|would you)/i;
        if (questionPatterns.test(input)) {
            logger.info('[STATE MACHINE] Question pattern detected, LLM needed');
            return true;
        }
        
        // ══════════════════════════════════════════════════════════════════
        // RULE 3: User wants to talk to human
        // ══════════════════════════════════════════════════════════════════
        const humanPatterns = /\b(human|person|real person|agent|representative|operator|speak to someone|talk to someone)\b/i;
        if (humanPatterns.test(input)) {
            logger.info('[STATE MACHINE] Human request detected, LLM needed for handoff');
            return true;
        }
        
        // ══════════════════════════════════════════════════════════════════
        // RULE 4: Extraction failed after we already asked - try LLM
        // ══════════════════════════════════════════════════════════════════
        if (expecting && !extractedSlots[expecting] && (this.askCount[expecting] || 0) >= 1) {
            logger.info('[STATE MACHINE] Extraction failed, trying LLM', { expecting, askCount: this.askCount[expecting] });
            return true;
        }
        
        // ══════════════════════════════════════════════════════════════════
        // RULE 5: First turn - need LLM to understand intent
        // SKIP if session is already in booking phase (booking already started)
        // ══════════════════════════════════════════════════════════════════
        if (this.state === 'INIT' && !this.lastAction && this.session.phase !== 'booking') {
            // Check if this is clearly booking intent
            const bookingIntent = /\b(appointment|schedule|book|service|repair|fix|broken|not working|need help)\b/i;
            if (!bookingIntent.test(input)) {
                logger.info('[STATE MACHINE] First turn, unclear intent, LLM needed');
                return true;
            }
        }
        
        // If session is in booking phase, state machine can handle slot collection
        if (this.session.phase === 'booking') {
            logger.info('[STATE MACHINE] Session in booking phase, state machine handles it');
            return false;
        }
        
        // Default: State machine can handle it
        return false;
    }
    
    /**
     * Check if we're in booking mode (should use state machine)
     * @returns {boolean} True if booking flow is active
     */
    isInBookingMode() {
        // We're in booking mode if:
        // 1. We've started collecting slots, OR
        // 2. Session phase is 'booking'
        const hasAnySlot = Object.values(this.slots).some(v => v);
        const hasAskedAnything = Object.keys(this.askCount).length > 0;
        const sessionInBooking = this.session.phase === 'booking';
        
        return hasAnySlot || hasAskedAnything || sessionInBooking;
    }
    
    // ════════════════════════════════════════════════════════════════════════
    // V36 NUKE: NO HARDCODED FALLBACKS - UI must be configured
    // ════════════════════════════════════════════════════════════════════════
    
    getDefaultQuestion(slotId) {
        // 🚨 PROMPT AS LAW: This should NEVER be called if UI is configured
        // All booking prompts must come from Front Desk Behavior → Booking Prompts
        console.error(`[BOOKING STATE MACHINE] 🚨 PROMPT AS LAW VIOLATION: No UI config for slot "${slotId}"`);
        return `What is your ${slotId}?`; // Generic - should never be used
    }
    
    // ════════════════════════════════════════════════════════════════════════
    // CLARIFY PHRASES (2nd attempt - uses UI recovery messages if available)
    // ════════════════════════════════════════════════════════════════════════
    
    getClarifyPhrase(slotId) {
        // Try UI-configured recovery message first (PROMPT AS LAW)
        if (this.recoveryMessages.choppyConnection) {
            return this.recoveryMessages.choppyConnection;
        }
        
        // V36: Slot-specific clarify phrases - these are OK as they're recovery/error handling
        // NOT the primary booking prompts (which must come from UI)
        const phrases = {
            name: "I didn't quite catch that. Could you tell me your name again?",
            phone: "Sorry, I missed part of that. Can you repeat the phone number for me?",
            address: "I want to make sure I have the right address. Can you say it one more time?",
            time: "Just to clarify - would morning or afternoon work better for you?"
        };
        return phrases[slotId] || "I'm sorry, could you repeat that?";
    }
    
    // ════════════════════════════════════════════════════════════════════════
    // BOOKING CONFIRMATION
    // ════════════════════════════════════════════════════════════════════════
    
    buildConfirmation() {
        const { name, phone, address, time } = this.slots;
        
        let confirmation = `Let me confirm: I have ${name || 'your name'}`;
        if (phone) confirmation += ` at ${phone}`;
        if (address) confirmation += `, service address ${address}`;
        if (time) confirmation += `, and you'd like ${time}`;
        confirmation += `. Is that correct?`;
        
        return confirmation;
    }
}

module.exports = BookingStateMachine;

