/**
 * ============================================================================
 * RESPONSE RENDERER
 * ============================================================================
 * 
 * Human-like phrasing WITHOUT using LLM tokens.
 * 
 * Uses controlled micro-variants for natural variation while staying
 * 100% deterministic (seeded by session ID for consistency).
 * 
 * ARCHITECTURE:
 * - Takes action objects from BookingStateMachine
 * - Renders human-friendly speech with appropriate acknowledgments
 * - Uses exact questions from UI config
 * - Picks style-appropriate variants based on company settings
 * 
 * BENEFITS:
 * - 0 tokens per response
 * - Sounds human through controlled variation
 * - Deterministic (same session = same variant choices)
 * - Uses ALL UI-configured settings
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

class ResponseRenderer {
    /**
     * Initialize renderer for a session
     * @param {Object} session - ConversationSession document
     * @param {Object} company - Company document with aiAgentSettings
     */
    constructor(session, company) {
        this.session = session;
        this.company = company;
        
        // Conversation style from UI
        this.style = company.aiAgentSettings?.frontDeskBehavior?.conversationStyle || 'balanced';
        
        // Style acknowledgments from UI (if configured)
        this.styleAcks = company.aiAgentSettings?.frontDeskBehavior?.styleAcknowledgments || {};
        
        // Recovery messages from UI
        this.recoveryMessages = company.aiAgentSettings?.frontDeskBehavior?.recoveryMessages || {};
        
        // Fallback responses from UI
        this.fallbackResponses = company.aiAgentSettings?.frontDeskBehavior?.fallbackResponses || {};
        
        // Seed for deterministic but varied selection
        // Using session ID ensures same session always gets same variant choices
        this.seed = this.hashString(session._id?.toString() || Date.now().toString());
        
        logger.info('[RESPONSE RENDERER] Initialized', {
            sessionId: session._id,
            style: this.style
        });
    }
    
    /**
     * ════════════════════════════════════════════════════════════════════════
     * MAIN: Render state machine action to human-friendly response
     * ════════════════════════════════════════════════════════════════════════
     * 
     * @param {Object} action - Action from BookingStateMachine.getNextAction()
     * @param {Object} extractedThisTurn - Slots extracted this turn (for acknowledgment)
     * @returns {Object} Structured response with: say, action, expecting, trace, etc.
     */
    render(action, extractedThisTurn = {}) {
        if (!action) {
            logger.error('[RESPONSE RENDERER] No action provided');
            return this.renderError('No action provided');
        }
        
        // Get appropriate acknowledgment for what was just collected
        const ack = this.getAcknowledgment(extractedThisTurn);
        
        switch (action.action) {
            case 'ASK_SLOT':
                return this.renderAskSlot(action, ack);
                
            case 'CLARIFY':
                return this.renderClarify(action);
                
            case 'CONFIRM_BOOKING':
                return this.renderConfirmation(action, ack);
                
            case 'ESCALATE':
                return this.renderEscalation(action);
                
            default:
                logger.warn('[RESPONSE RENDERER] Unknown action', { action: action.action });
                return this.renderFallback();
        }
    }
    
    /**
     * Render ASK_SLOT action
     * Format: [Acknowledgment] + [Exact Question]
     */
    renderAskSlot(action, ack) {
        const say = ack 
            ? `${ack} ${action.exactQuestion}`.trim()
            : action.exactQuestion;
        
        logger.info('[RESPONSE RENDERER] ASK_SLOT rendered', {
            slotId: action.slotId,
            hasAck: !!ack,
            questionSource: action.trace?.configSource || 'unknown'
        });
        
        return {
            say,
            action: 'ASK_SLOT',
            expecting: action.expecting,
            slotId: action.slotId,
            bargeInAllowed: true,
            repromptOnSilence: action.exactQuestion,
            tokensUsed: 0,
            source: 'STATE_MACHINE',
            trace: {
                ...action.trace,
                acknowledgment: ack || '(none)',
                exactQuestion: action.exactQuestion
            }
        };
    }
    
    /**
     * Render CLARIFY action (2nd attempt)
     * Uses clarify phrase, which is more direct
     */
    renderClarify(action) {
        logger.info('[RESPONSE RENDERER] CLARIFY rendered', {
            slotId: action.slotId,
            timesAsked: action.trace?.timesAsked
        });
        
        return {
            say: action.clarifyPhrase,
            action: 'CLARIFY',
            expecting: action.expecting,
            slotId: action.slotId,
            bargeInAllowed: true,
            repromptOnSilence: action.exactQuestion,
            tokensUsed: 0,
            source: 'STATE_MACHINE',
            trace: {
                ...action.trace,
                clarifyPhrase: action.clarifyPhrase
            }
        };
    }
    
    /**
     * Render CONFIRM_BOOKING action
     * Summarizes all collected slots
     */
    renderConfirmation(action, ack) {
        const { name, phone, address, time } = action.slots || {};
        
        // Build confirmation message
        let confirmation = ack ? `${ack} ` : '';
        confirmation += `Let me confirm: I have ${name || 'your information'}`;
        if (phone) confirmation += ` at ${phone}`;
        if (address) confirmation += `, service address ${address}`;
        if (time) confirmation += `, ${time}`;
        confirmation += `. Is that correct?`;
        
        logger.info('[RESPONSE RENDERER] CONFIRM_BOOKING rendered', {
            slotsCount: Object.keys(action.slots || {}).filter(k => action.slots[k]).length
        });
        
        return {
            say: confirmation,
            action: 'CONFIRM_BOOKING',
            expecting: 'confirmation',
            bargeInAllowed: true,
            repromptOnSilence: 'Is that information correct?',
            tokensUsed: 0,
            source: 'STATE_MACHINE',
            slotsCollected: action.slots,
            trace: {
                ...action.trace,
                confirmation
            }
        };
    }
    
    /**
     * Render ESCALATE action (3 strikes - transfer to human)
     */
    renderEscalation(action) {
        const phrase = this.getEscalationPhrase();
        
        logger.warn('[RESPONSE RENDERER] ESCALATE rendered', {
            reason: action.reason,
            slotId: action.slotId
        });
        
        return {
            say: phrase,
            action: 'ESCALATE',
            shouldTransfer: true,
            reason: action.reason,
            tokensUsed: 0,
            source: 'STATE_MACHINE',
            trace: {
                ...action.trace,
                escalationPhrase: phrase
            }
        };
    }
    
    /**
     * Render fallback for unknown actions
     */
    renderFallback() {
        const greeting = this.fallbackResponses.greeting || 'How can I help you today?';
        
        return {
            say: greeting,
            action: 'FALLBACK',
            expecting: null,
            bargeInAllowed: true,
            tokensUsed: 0,
            source: 'STATE_MACHINE',
            trace: { fallback: true }
        };
    }
    
    /**
     * Render error response
     */
    renderError(message) {
        const recovery = this.recoveryMessages.generalError || 
            "I'm sorry, I'm having a little trouble. Could you repeat that?";
        
        return {
            say: recovery,
            action: 'ERROR',
            error: message,
            tokensUsed: 0,
            source: 'STATE_MACHINE',
            trace: { error: message }
        };
    }
    
    /**
     * ════════════════════════════════════════════════════════════════════════
     * ACKNOWLEDGMENT GENERATOR
     * ════════════════════════════════════════════════════════════════════════
     * 
     * Generates human-like acknowledgments based on:
     * 1. What was just collected (personalized)
     * 2. Company's conversation style setting
     * 3. Controlled variation via micro-variants
     */
    getAcknowledgment(extracted) {
        // Personalized acknowledgments based on what was just collected
        if (extracted.name) {
            return this.pickVariant([
                `Thanks, ${extracted.name}!`,
                `Got it, ${extracted.name}.`,
                `Perfect, ${extracted.name}!`,
                `Great, ${extracted.name}!`
            ]);
        }
        
        if (extracted.phone) {
            return this.pickVariant([
                'Got it!',
                'Perfect!',
                'Great, thanks!',
                'Got that down.'
            ]);
        }
        
        if (extracted.address) {
            return this.pickVariant([
                'Got it!',
                'Perfect!',
                'Thanks!',
                'Great!'
            ]);
        }
        
        if (extracted.time) {
            return this.pickVariant([
                'Sounds good!',
                'Perfect!',
                'Great!',
                'That works!'
            ]);
        }
        
        // Style-based acknowledgments (for general responses)
        return this.getStyleAcknowledgment();
    }
    
    /**
     * Get acknowledgment based on conversation style setting
     */
    getStyleAcknowledgment() {
        // Try UI-configured style acknowledgments first
        if (this.styleAcks[this.style]) {
            return this.styleAcks[this.style];
        }
        
        // Fallback to built-in variants by style
        const styleVariants = {
            confident: [
                "I've got you.",
                "Let me help you with that.",
                "Absolutely.",
                "I can take care of that."
            ],
            balanced: [
                "I can help with that!",
                "Sure thing!",
                "Of course!",
                "Happy to help!"
            ],
            polite: [
                "I'd be happy to help.",
                "Certainly!",
                "Of course.",
                "I'd be glad to assist."
            ]
        };
        
        const variants = styleVariants[this.style] || styleVariants.balanced;
        return this.pickVariant(variants);
    }
    
    /**
     * Get escalation phrase (transfer to human)
     */
    getEscalationPhrase() {
        // Try UI-configured recovery message first
        if (this.recoveryMessages.technicalTransfer) {
            return this.recoveryMessages.technicalTransfer;
        }
        
        return this.pickVariant([
            "Let me get someone who can help you better. One moment please.",
            "I want to make sure we get this right. Let me transfer you to our team.",
            "Let me connect you with one of our specialists.",
            "One moment while I transfer you to someone who can help."
        ]);
    }
    
    /**
     * ════════════════════════════════════════════════════════════════════════
     * VARIANT SELECTION (Deterministic but varied)
     * ════════════════════════════════════════════════════════════════════════
     * 
     * Picks from an array of variants using a seeded selection.
     * Same session always gets the same variant choices for consistency.
     */
    pickVariant(variants) {
        if (!variants || variants.length === 0) return '';
        if (variants.length === 1) return variants[0];
        
        // Deterministic selection based on seed
        const index = this.seed % variants.length;
        
        // Advance seed for next selection (simple LCG)
        this.seed = (this.seed * 31 + 17) % 1000000;
        
        return variants[index];
    }
    
    /**
     * Simple string hash for seed generation
     */
    hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash; // Convert to 32-bit integer
        }
        return Math.abs(hash);
    }
    
    /**
     * ════════════════════════════════════════════════════════════════════════
     * GREETING GENERATOR (for first turn)
     * ════════════════════════════════════════════════════════════════════════
     */
    renderGreeting() {
        const companyName = this.company.companyName || this.company.name || 'our company';
        
        const greetings = {
            confident: [
                `Thanks for calling ${companyName}! What can I do for you?`,
                `${companyName}, how can I help?`,
                `Hi there! What do you need help with today?`
            ],
            balanced: [
                `Thanks for calling ${companyName}! How can I help you today?`,
                `Hi! Thanks for calling ${companyName}. How can I help?`,
                `Hello! How can I help you today?`
            ],
            polite: [
                `Thank you for calling ${companyName}. How may I assist you?`,
                `Good day! Thank you for calling ${companyName}. How may I help you?`,
                `Hello, thank you for calling. How may I assist you today?`
            ]
        };
        
        const variants = greetings[this.style] || greetings.balanced;
        
        return {
            say: this.pickVariant(variants),
            action: 'GREETING',
            expecting: null,
            bargeInAllowed: true,
            tokensUsed: 0,
            source: 'STATE_MACHINE',
            trace: { type: 'greeting', style: this.style }
        };
    }
}

module.exports = ResponseRenderer;

