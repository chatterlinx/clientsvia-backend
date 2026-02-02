/**
 * ============================================================================
 * BOOKING FLOW RUNNER
 * ============================================================================
 * 
 * THE DETERMINISTIC BOOKING ENGINE - No LLM, No Scenarios, No Guesswork.
 * 
 * This is the "state machine" that takes over when bookingModeLocked is true.
 * It executes booking flow steps based on:
 * - The resolved flow (from BookingFlowResolver)
 * - The current step ID (from Redis state)
 * - User input (from STT)
 * 
 * CORE PRINCIPLE:
 * "The state machine is the clipboard. The LLM was the receptionist.
 *  Once we're in booking mode, the clipboard is in charge."
 * 
 * RESPONSIBILITIES:
 * 1. Ask the current step's prompt (if no user input yet)
 * 2. Validate user input against step requirements
 * 3. Extract and store the value
 * 4. Advance to next step or complete the flow
 * 5. Return deterministic response (no LLM needed)
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const BookingFlowResolver = require('./BookingFlowResolver');

/**
 * Slot extractors - deterministic extraction for each slot type
 */
const SlotExtractors = {
    /**
     * Extract name from user input
     */
    name: (input, step, context = {}) => {
        if (!input) return null;
        
        const text = input.trim();
        
        // Pattern: "My name is X" / "This is X" / "I'm X"
        const nameMatch = text.match(/(?:my name is|this is|i'm|i am|it's|its)\s+(.+)/i);
        if (nameMatch) {
            return cleanName(nameMatch[1]);
        }
        
        // Pattern: "X Y" (first last) or just "X"
        // Filter out common filler words
        const words = text.split(/\s+/)
            .filter(w => !isStopWord(w.toLowerCase()))
            .filter(w => /^[A-Za-z][A-Za-z\-'\.]*$/.test(w));
        
        if (words.length === 0) return null;
        
        // Return cleaned name
        return words.map(w => titleCase(w)).join(' ');
    },
    
    /**
     * Extract phone number from user input
     */
    phone: (input, step, context = {}) => {
        if (!input) return null;
        
        // Remove all non-digit characters
        const digits = input.replace(/\D/g, '');
        
        // Must have at least 10 digits for a valid phone number
        if (digits.length < 10) return null;
        
        // Take last 10 digits (handles "1" country code prefix)
        const phone = digits.slice(-10);
        
        // Format as (XXX) XXX-XXXX for readability
        return `(${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6)}`;
    },
    
    /**
     * Extract address from user input
     * Note: For complex address validation, use Google Maps API (separate service)
     */
    address: (input, step, context = {}) => {
        if (!input) return null;
        
        const text = input.trim();
        
        // Basic validation - should contain some address-like content
        // (number + street name pattern)
        const hasAddressPattern = /\d+\s+[A-Za-z]/.test(text);
        
        if (!hasAddressPattern && text.length < 5) {
            return null;
        }
        
        // Clean up common speech artifacts
        let address = text
            .replace(/^(?:my address is|the address is|it's|its|at)\s+/i, '')
            .replace(/\s+/g, ' ')
            .trim();
        
        return address;
    },
    
    /**
     * Extract time/date preference from user input
     */
    time: (input, step, context = {}) => {
        if (!input) return null;
        
        const text = input.toLowerCase().trim();
        
        // ASAP patterns
        if (/\b(asap|as soon as possible|soon|right away|immediately|now)\b/.test(text)) {
            return 'ASAP';
        }
        
        // Morning/afternoon/evening
        if (/\b(morning|am|before noon)\b/.test(text)) {
            return 'Morning';
        }
        if (/\b(afternoon|pm|after lunch)\b/.test(text)) {
            return 'Afternoon';
        }
        if (/\b(evening|night|after work|after 5)\b/.test(text)) {
            return 'Evening';
        }
        
        // Day patterns
        const dayMatch = text.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
        if (dayMatch) {
            return titleCase(dayMatch[1]);
        }
        
        // If we got something, return it as-is
        if (text.length > 2) {
            return input.trim();
        }
        
        return null;
    },
    
    /**
     * Extract email from user input
     */
    email: (input, step, context = {}) => {
        if (!input) return null;
        
        // Try to find email pattern
        const emailMatch = input.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
        if (emailMatch) {
            return emailMatch[0].toLowerCase();
        }
        
        return null;
    },
    
    /**
     * Extract service type from user input
     */
    serviceType: (input, step, context = {}) => {
        if (!input) return null;
        return input.trim();
    },
    
    /**
     * Default extractor - just return the trimmed input
     */
    default: (input, step, context = {}) => {
        if (!input) return null;
        return input.trim();
    }
};

/**
 * Helper functions
 */
function isStopWord(word) {
    const stopWords = new Set([
        'is', 'are', 'was', 'were', 'be', 'been', 'am',
        'the', 'my', 'its', "it's", 'a', 'an', 'name', 'last', 'first',
        'yes', 'yeah', 'yep', 'sure', 'ok', 'okay', 'no', 'nope',
        'hi', 'hello', 'hey', 'please', 'thanks', 'thank', 'you',
        'it', 'that', 'this', 'what', 'and', 'or', 'but', 'to', 'for', 'with',
        'got', 'two', 'there', 'uh', 'um', 'yup', 'so', 'well', 'just'
    ]);
    return stopWords.has(word);
}

function titleCase(str) {
    if (!str) return str;
    return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

function cleanName(name) {
    if (!name) return null;
    return name
        .split(/\s+/)
        .filter(w => !isStopWord(w.toLowerCase()) && w.length > 1)
        .map(w => titleCase(w.replace(/[^A-Za-z\-'\.]/g, '')))
        .join(' ')
        .trim() || null;
}

/**
 * ============================================================================
 * BOOKING FLOW RUNNER
 * ============================================================================
 */
class BookingFlowRunner {
    
    /**
     * ========================================================================
     * RUN STEP - The main entry point
     * ========================================================================
     * 
     * Called from v2twilio.js when bookingModeLocked is true.
     * 
     * KEY FEATURE: CONFIRM-VS-COLLECT LOGIC
     * - If slot already exists (from discovery, caller ID, etc.), CONFIRM it
     * - If slot missing, COLLECT it
     * - Never re-ask for information we already have!
     * 
     * @param {Object} params
     * @param {Object} params.flow - The resolved booking flow
     * @param {Object} params.state - Current booking state from Redis
     * @param {string} params.userInput - User's speech input (may be empty on first entry)
     * @param {Object} params.company - Company document
     * @param {Object} params.session - ConversationSession document
     * @param {Object} params.slots - Pre-extracted slots with confidence metadata
     * 
     * @returns {Object} Result:
     * {
     *     reply: 'What is the service address?',
     *     state: { currentStepId, bookingCollected, ... },
     *     isComplete: false,
     *     action: 'CONTINUE' | 'COMPLETE' | 'ESCALATE',
     *     debug: { ... }
     * }
     */
    static async runStep({ flow, state, userInput, company, session, callSid, slots = {} }) {
        const startTime = Date.now();
        
        logger.info('[BOOKING FLOW RUNNER] Running step', {
            flowId: flow?.flowId,
            currentStepId: state?.currentStepId,
            hasUserInput: !!userInput,
            inputPreview: userInput?.substring(0, 50),
            existingSlots: Object.keys(slots || {})
        });
        
        // Validate inputs
        if (!flow || !flow.steps || flow.steps.length === 0) {
            logger.error('[BOOKING FLOW RUNNER] Invalid flow - no steps', { flowId: flow?.flowId });
            return this.buildErrorResponse('Invalid booking flow configuration', state);
        }
        
        // Initialize state if needed
        state = this.initializeState(state, flow, slots);
        
        // ═══════════════════════════════════════════════════════════════════
        // MERGE PRE-EXTRACTED SLOTS INTO BOOKING COLLECTED
        // ═══════════════════════════════════════════════════════════════════
        // Slots from SlotExtractor (caller ID, discovery phase) are merged here.
        // This is how we avoid re-asking for "Hi I'm Mark" later.
        // ═══════════════════════════════════════════════════════════════════
        if (slots && Object.keys(slots).length > 0) {
            for (const [key, slotData] of Object.entries(slots)) {
                if (slotData?.value && !state.bookingCollected[key]) {
                    state.bookingCollected[key] = slotData.value;
                    state.slotMetadata = state.slotMetadata || {};
                    state.slotMetadata[key] = slotData;
                    logger.info('[BOOKING FLOW RUNNER] Merged pre-extracted slot', {
                        key,
                        value: slotData.value,
                        confidence: slotData.confidence,
                        source: slotData.source
                    });
                }
            }
        }
        
        // Get current step
        const currentStep = flow.steps.find(s => s.id === state.currentStepId);
        
        // ═══════════════════════════════════════════════════════════════════
        // FIND NEXT STEP NEEDING ACTION (CONFIRM OR COLLECT)
        // ═══════════════════════════════════════════════════════════════════
        const nextAction = this.determineNextAction(flow, state, slots);
        
        if (!nextAction) {
            // All required steps confirmed - go to final confirmation
            logger.info('[BOOKING FLOW RUNNER] All slots ready - building final confirmation', {
                collected: state.bookingCollected
            });
            return this.buildConfirmation(flow, state);
        }
        
        // Update current step to the one needing action
        if (nextAction.step.id !== state.currentStepId) {
            state.currentStepId = nextAction.step.id;
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // HANDLE CONFIRMATION MODE (slot exists, needs confirmation)
        // ═══════════════════════════════════════════════════════════════════
        if (nextAction.mode === 'CONFIRM') {
            return this.handleConfirmMode(nextAction, state, flow, userInput, startTime);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // HANDLE COLLECT MODE (slot missing, need to ask)
        // ═══════════════════════════════════════════════════════════════════
        return this.handleCollectMode(nextAction, state, flow, userInput, company, startTime);
    }
    
    /**
     * ========================================================================
     * DETERMINE NEXT ACTION - Confirm vs Collect decision
     * ========================================================================
     * 
     * For each required step, determine if we need to:
     * - CONFIRM: Slot exists (from caller ID, discovery, etc.) - ask user to confirm
     * - COLLECT: Slot missing - ask user to provide it
     * - SKIP: Slot confirmed (confidence = 1.0) - move to next
     * 
     * @returns {Object|null} { step, mode: 'CONFIRM'|'COLLECT', existingValue }
     */
    static determineNextAction(flow, state, slots = {}) {
        const collected = state.bookingCollected || {};
        const slotMetadata = state.slotMetadata || {};
        const confirmedSlots = state.confirmedSlots || new Set();
        
        // ═══════════════════════════════════════════════════════════════════════════
        // FEB 2026 FIX: Track current step position to prevent going backwards
        // ═══════════════════════════════════════════════════════════════════════════
        // If we're at step "address", don't return to "name" for confirmation.
        // The flow should only move FORWARD, not backwards.
        // ═══════════════════════════════════════════════════════════════════════════
        const currentStepId = state.currentStepId;
        const currentStepIndex = currentStepId 
            ? flow.steps.findIndex(s => (s.fieldKey || s.id) === currentStepId)
            : -1;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // AUTO-CONFIRM THRESHOLD: 0.85 for utterance-sourced slots
        // ═══════════════════════════════════════════════════════════════════════════
        // When caller explicitly says "my name is Mark", confidence is 0.9.
        // This is high enough to auto-confirm without asking again.
        // Only caller ID (0.7) and low-confidence extractions need confirmation.
        // ═══════════════════════════════════════════════════════════════════════════
        const AUTO_CONFIRM_THRESHOLD = 0.85;
        
        for (let i = 0; i < flow.steps.length; i++) {
            const step = flow.steps[i];
            if (!step.required) continue;
            
            const fieldKey = step.fieldKey || step.id;
            const existingValue = collected[fieldKey];
            const metadata = slotMetadata[fieldKey] || slots[fieldKey];
            
            // Already confirmed by user - skip
            if (confirmedSlots.has?.(fieldKey) || state.confirmedSlots?.[fieldKey]) {
                continue;
            }
            
            // ═══════════════════════════════════════════════════════════════════════
            // FEB 2026 FIX: Don't go backwards in the flow
            // ═══════════════════════════════════════════════════════════════════════
            // If we've passed this step (current step is later), auto-confirm it
            // This prevents: collect address → go back to confirm name
            // ═══════════════════════════════════════════════════════════════════════
            if (currentStepIndex > i && existingValue) {
                logger.debug('[BOOKING FLOW] Auto-confirming passed step', {
                    fieldKey,
                    currentStepId,
                    reason: 'FLOW_MOVED_FORWARD'
                });
                // Mark as confirmed so we don't return to it
                state.confirmedSlots = state.confirmedSlots || {};
                state.confirmedSlots[fieldKey] = true;
                continue;
            }
            
            // If no value, need to COLLECT
            if (!existingValue) {
                return {
                    step,
                    mode: 'COLLECT',
                    existingValue: null
                };
            }
            
            // ═══════════════════════════════════════════════════════════════════════
            // FEB 2026 FIX: Auto-confirm high-confidence utterance slots
            // ═══════════════════════════════════════════════════════════════════════
            // If caller said "my name is Mark" (confidence 0.9, source: utterance),
            // don't ask them to confirm it again - that's annoying!
            // Only ask for confirmation on low-confidence or caller_id slots.
            // ═══════════════════════════════════════════════════════════════════════
            const isUtteranceSource = metadata?.source === 'utterance';
            const hasHighConfidence = metadata?.confidence >= AUTO_CONFIRM_THRESHOLD;
            
            if (metadata?.confirmed === true || (isUtteranceSource && hasHighConfidence)) {
                // Auto-confirm and skip
                state.confirmedSlots = state.confirmedSlots || {};
                state.confirmedSlots[fieldKey] = true;
                logger.debug('[BOOKING FLOW] Auto-confirming high-confidence slot', {
                    fieldKey,
                    confidence: metadata?.confidence,
                    source: metadata?.source
                });
                continue;
            }
            
            // Value exists but low confidence or caller_id - need to CONFIRM
            if (metadata?.needsConfirmation || 
                (metadata?.confidence && metadata.confidence < AUTO_CONFIRM_THRESHOLD) ||
                metadata?.source === 'caller_id') {
                return {
                    step,
                    mode: 'CONFIRM',
                    existingValue,
                    metadata
                };
            }
            
            // Value exists without metadata - treat as needing confirmation if it's phone from caller ID
            if (fieldKey === 'phone' && !metadata) {
                return {
                    step,
                    mode: 'CONFIRM',
                    existingValue,
                    metadata: { source: 'unknown', confidence: 0.7 }
                };
            }
            
            // Value exists with metadata, not explicitly needing confirmation - skip
            continue;
        }
        
        return null; // All required steps handled
    }
    
    /**
     * ========================================================================
     * HANDLE CONFIRM MODE - Ask user to confirm existing value
     * ========================================================================
     */
    static handleConfirmMode(action, state, flow, userInput, startTime) {
        const { step, existingValue, metadata } = action;
        const fieldKey = step.fieldKey || step.id;
        
        // First entry or no input - ask confirmation question
        if (!userInput || userInput.trim() === '') {
            const confirmPrompt = this.buildConfirmPrompt(step, existingValue);
            
            state.pendingConfirmation = {
                fieldKey,
                value: existingValue,
                step: step.id
            };
            
            logger.info('[BOOKING FLOW RUNNER] CONFIRM MODE - Asking to confirm', {
                stepId: step.id,
                fieldKey,
                value: existingValue,
                source: metadata?.source
            });
            
            return {
                reply: confirmPrompt,
                state,
                isComplete: false,
                action: 'CONFIRM_SLOT',
                currentStep: step.id,
                slotToConfirm: fieldKey,
                existingValue,
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'CONFIRM',
                    fieldKey,
                    existingValue,
                    confidence: metadata?.confidence
                }
            };
        }
        
        // User responded - check if confirmed or denied
        const confirmResult = this.parseConfirmationResponse(userInput);
        
        if (confirmResult.confirmed) {
            // User confirmed - mark slot as confirmed and advance
            state.confirmedSlots = state.confirmedSlots || {};
            state.confirmedSlots[fieldKey] = true;
            
            if (state.slotMetadata?.[fieldKey]) {
                state.slotMetadata[fieldKey].confirmed = true;
                state.slotMetadata[fieldKey].confidence = 1.0;
            }
            
            delete state.pendingConfirmation;
            
            logger.info('[BOOKING FLOW RUNNER] Slot confirmed by user', {
                fieldKey,
                value: existingValue
            });
            
            // Find next action
            const nextAction = this.determineNextAction(flow, state, {});
            
            if (!nextAction) {
                return this.buildConfirmation(flow, state);
            }
            
            state.currentStepId = nextAction.step.id;
            
            // Build acknowledgment + next prompt
            const ack = 'Perfect.';
            let nextPrompt;
            
            if (nextAction.mode === 'CONFIRM') {
                nextPrompt = this.buildConfirmPrompt(nextAction.step, nextAction.existingValue);
                state.pendingConfirmation = {
                    fieldKey: nextAction.step.fieldKey || nextAction.step.id,
                    value: nextAction.existingValue,
                    step: nextAction.step.id
                };
            } else {
                nextPrompt = nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`;
            }
            
            return {
                reply: `${ack} ${nextPrompt}`,
                state,
                isComplete: false,
                action: 'CONTINUE',
                stepCompleted: step.id,
                nextStep: nextAction.step.id,
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'CONFIRMED',
                    confirmedField: fieldKey,
                    nextMode: nextAction.mode
                }
            };
        } else if (confirmResult.denied) {
            // User said no - switch to COLLECT mode for this slot
            delete state.bookingCollected[fieldKey];
            delete state.pendingConfirmation;
            
            if (state.slotMetadata?.[fieldKey]) {
                delete state.slotMetadata[fieldKey];
            }
            
            logger.info('[BOOKING FLOW RUNNER] User denied - switching to collect mode', {
                fieldKey,
                deniedValue: existingValue
            });
            
            const collectPrompt = step.prompt || `What is your ${step.label || step.id}?`;
            
            return {
                reply: `No problem. ${collectPrompt}`,
                state,
                isComplete: false,
                action: 'COLLECT_AFTER_DENY',
                currentStep: step.id,
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'COLLECT_AFTER_DENY',
                    fieldKey,
                    deniedValue: existingValue
                }
            };
        } else if (confirmResult.newValue) {
            // User provided a new value - use it
            state.bookingCollected[fieldKey] = confirmResult.newValue;
            state.confirmedSlots = state.confirmedSlots || {};
            state.confirmedSlots[fieldKey] = true;
            delete state.pendingConfirmation;
            
            logger.info('[BOOKING FLOW RUNNER] User provided new value during confirm', {
                fieldKey,
                oldValue: existingValue,
                newValue: confirmResult.newValue
            });
            
            // Advance to next
            const nextAction = this.determineNextAction(flow, state, {});
            
            if (!nextAction) {
                return this.buildConfirmation(flow, state);
            }
            
            state.currentStepId = nextAction.step.id;
            
            const ack = 'Got it.';
            const nextPrompt = nextAction.mode === 'CONFIRM'
                ? this.buildConfirmPrompt(nextAction.step, nextAction.existingValue)
                : (nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`);
            
            return {
                reply: `${ack} ${nextPrompt}`,
                state,
                isComplete: false,
                action: 'CONTINUE',
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                latencyMs: Date.now() - startTime,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    mode: 'NEW_VALUE_PROVIDED',
                    fieldKey,
                    newValue: confirmResult.newValue
                }
            };
        }
        
        // Unclear response - re-ask confirmation
        return {
            reply: "I'm sorry, I didn't catch that. Is that information correct? Please say yes or no.",
            state,
            isComplete: false,
            action: 'CONFIRM_RETRY',
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: Date.now() - startTime,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                mode: 'CONFIRM_RETRY',
                fieldKey,
                userInput
            }
        };
    }
    
    /**
     * ========================================================================
     * HANDLE COLLECT MODE - Ask user to provide missing value
     * ========================================================================
     */
    static handleCollectMode(action, state, flow, userInput, company, startTime) {
        const { step } = action;
        const fieldKey = step.fieldKey || step.id;
        
        // First entry or no input - ask the question
        if (!userInput || userInput.trim() === '') {
            logger.info('[BOOKING FLOW RUNNER] COLLECT MODE - Asking for slot', {
                stepId: step.id,
                prompt: step.prompt?.substring(0, 50)
            });
            return this.askStep(step, state, flow);
        }
        
        // User responded - extract value
        const extractResult = this.extractValue(userInput, step, state, company);
        
        if (!extractResult.isValid) {
            // Invalid input - reprompt
            state.askCount = state.askCount || {};
            state.askCount[step.id] = (state.askCount[step.id] || 0) + 1;
            
            // ═══════════════════════════════════════════════════════════════
            // MAX ATTEMPTS: Read from step config (UI-driven), default to 3
            // ═══════════════════════════════════════════════════════════════
            const maxAttempts = step.maxAttempts || step.options?.maxAttempts || 3;
            
            if (state.askCount[step.id] >= maxAttempts) {
                logger.warn('[BOOKING FLOW RUNNER] Max attempts reached - escalating', {
                    stepId: step.id,
                    askCount: state.askCount[step.id],
                    maxAttempts
                });
                return this.buildEscalation(step, state, flow, 
                    `Unable to collect ${step.label || step.id} after ${maxAttempts} attempts`);
            }
            
            return this.repromptStep(step, state, flow, extractResult.reason);
        }
        
        // Valid input - store and advance
        state.bookingCollected[fieldKey] = extractResult.value;
        state.confirmedSlots = state.confirmedSlots || {};
        state.confirmedSlots[fieldKey] = true; // Directly provided = confirmed
        state.lastExtracted = { [fieldKey]: extractResult.value };
        
        if (state.askCount) {
            delete state.askCount[step.id];
        }
        
        logger.info('[BOOKING FLOW RUNNER] Value collected', {
            stepId: step.id,
            fieldKey,
            value: extractResult.value
        });
        
        // Find next action
        const nextAction = this.determineNextAction(flow, state, {});
        
        if (!nextAction) {
            return this.buildConfirmation(flow, state);
        }
        
        state.currentStepId = nextAction.step.id;
        
        const ack = this.buildAcknowledgment(step, extractResult.value);
        let nextPrompt;
        
        if (nextAction.mode === 'CONFIRM') {
            nextPrompt = this.buildConfirmPrompt(nextAction.step, nextAction.existingValue);
            state.pendingConfirmation = {
                fieldKey: nextAction.step.fieldKey || nextAction.step.id,
                value: nextAction.existingValue,
                step: nextAction.step.id
            };
        } else {
            nextPrompt = nextAction.step.prompt || `What is your ${nextAction.step.label || nextAction.step.id}?`;
        }
        
        const reply = ack ? `${ack} ${nextPrompt}` : nextPrompt;
        
        return {
            reply,
            state,
            isComplete: false,
            action: 'CONTINUE',
            stepCompleted: step.id,
            nextStep: nextAction.step.id,
            nextMode: nextAction.mode,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: Date.now() - startTime,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stepCompleted: step.id,
                nextStep: nextAction.step.id,
                nextMode: nextAction.mode,
                extracted: extractResult.value,
                bookingCollected: state.bookingCollected
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD CONFIRM PROMPT - Contextual confirmation questions
     * ========================================================================
     */
    static buildConfirmPrompt(step, existingValue) {
        const type = step.type || step.id;
        
        switch (type) {
            case 'phone':
                return `I can send confirmations to ${existingValue}. Is this the best number to reach you?`;
            case 'name':
                return `I have your name as ${existingValue}. Is that correct?`;
            case 'address':
                return `The service address I have is ${existingValue}. Is that right?`;
            case 'email':
                return `I have your email as ${existingValue}. Is that correct?`;
            case 'time':
                return `I have you down for ${existingValue}. Does that work?`;
            default:
                return `I have ${existingValue} for your ${step.label || type}. Is that correct?`;
        }
    }
    
    /**
     * ========================================================================
     * PARSE CONFIRMATION RESPONSE
     * ========================================================================
     */
    static parseConfirmationResponse(input) {
        const text = (input || '').toLowerCase().trim();
        
        // Positive confirmations
        const positivePatterns = [
            /^(yes|yeah|yep|yup|correct|right|sure|ok|okay|uh huh|mhm|affirmative)$/,
            /\b(yes|yeah|correct|right)\b.*\b(it is|that's|is)\b/,
            /\b(that's?|it's?|is)\s+(correct|right|good|fine|perfect)\b/,
            /\b(this|that)\s+(number|one)\s+(is\s+)?(good|fine|ok|correct|works)\b/,
            /\buse\s+(this|that|the same)\b/,
            /\bsounds?\s+(good|great|fine|correct)\b/
        ];
        
        if (positivePatterns.some(p => p.test(text))) {
            return { confirmed: true };
        }
        
        // Negative / denial
        const negativePatterns = [
            /^(no|nope|nah|wrong|incorrect|negative)$/,
            /\b(no|not)\s+(correct|right|that's not)\b/,
            /\bthat's?\s+(wrong|incorrect|not right)\b/,
            /\bwrong\s+(number|address|name)\b/,
            /\bchange\s+(it|that)\b/,
            /\bdifferent\s+(number|one)\b/
        ];
        
        if (negativePatterns.some(p => p.test(text))) {
            return { denied: true };
        }
        
        // Check if user provided a new phone number
        const phoneMatch = input.match(/(\d[\d\-\.\(\)\s]{8,}\d)/);
        if (phoneMatch) {
            const digits = phoneMatch[1].replace(/\D/g, '');
            if (digits.length >= 10) {
                const formatted = `(${digits.slice(-10, -7)}) ${digits.slice(-7, -4)}-${digits.slice(-4)}`;
                return { newValue: formatted };
            }
        }
        
        // Check if user provided what looks like a name
        const namePattern = /^([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)$/;
        const nameMatch = input.match(namePattern);
        if (nameMatch) {
            return { newValue: nameMatch[1] };
        }
        
        return { unclear: true };
    }
    
    /**
     * ========================================================================
     * INITIALIZE STATE
     * ========================================================================
     */
    static initializeState(state, flow, slots = {}) {
        const initialized = {
            bookingModeLocked: true,
            bookingFlowId: flow.flowId,
            currentStepId: state?.currentStepId || flow.steps[0]?.id,
            bookingCollected: state?.bookingCollected || {},
            slotMetadata: state?.slotMetadata || {},
            confirmedSlots: state?.confirmedSlots || {},
            askCount: state?.askCount || {},
            startedAt: state?.startedAt || new Date().toISOString(),
            ...state
        };
        
        // Merge slot metadata from pre-extracted slots
        if (slots && Object.keys(slots).length > 0) {
            for (const [key, slotData] of Object.entries(slots)) {
                if (slotData && !initialized.slotMetadata[key]) {
                    initialized.slotMetadata[key] = slotData;
                }
            }
        }
        
        return initialized;
    }
    
    /**
     * ========================================================================
     * EXTRACT VALUE - Use slot-specific extractor
     * ========================================================================
     */
    static extractValue(input, step, state, company) {
        const type = step.type || step.id;
        const extractor = SlotExtractors[type] || SlotExtractors.default;
        
        const value = extractor(input, step, { state, company });
        
        if (!value) {
            return {
                isValid: false,
                value: null,
                reason: `Could not extract ${step.label || step.id} from input`
            };
        }
        
        // Validate extracted value
        const validation = step.validation || {};
        
        if (validation.minLength && value.length < validation.minLength) {
            return {
                isValid: false,
                value: null,
                reason: `${step.label || step.id} must be at least ${validation.minLength} characters`
            };
        }
        
        if (validation.minDigits && type === 'phone') {
            const digits = value.replace(/\D/g, '');
            if (digits.length < validation.minDigits) {
                return {
                    isValid: false,
                    value: null,
                    reason: `Phone number must have at least ${validation.minDigits} digits`
                };
            }
        }
        
        if (validation.pattern && typeof validation.pattern === 'string') {
            const regex = new RegExp(validation.pattern);
            if (!regex.test(value)) {
                return {
                    isValid: false,
                    value: null,
                    reason: `${step.label || step.id} format is invalid`
                };
            }
        }
        
        return {
            isValid: true,
            value,
            reason: null
        };
    }
    
    /**
     * ========================================================================
     * FIND NEXT REQUIRED STEP - Skip already-collected steps
     * ========================================================================
     */
    static findNextRequiredStep(flow, state) {
        const collected = state.bookingCollected || {};
        
        for (const step of flow.steps) {
            // Skip optional steps
            if (!step.required) continue;
            
            const fieldKey = step.fieldKey || step.id;
            
            // Skip if already collected
            if (collected[fieldKey]) continue;
            
            return step;
        }
        
        return null; // All required steps collected
    }
    
    /**
     * ========================================================================
     * ASK STEP - Build response to ask for a step
     * ========================================================================
     */
    static askStep(step, state, flow) {
        const prompt = step.prompt || `What is your ${step.label || step.id}?`;
        
        // Track ask count
        state.askCount = state.askCount || {};
        state.askCount[step.id] = (state.askCount[step.id] || 0) + 1;
        
        return {
            reply: prompt,
            state,
            isComplete: false,
            action: 'CONTINUE',
            currentStep: step.id,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                currentStep: step.id,
                askCount: state.askCount[step.id]
            }
        };
    }
    
    /**
     * ========================================================================
     * REPROMPT STEP - Ask again with clarification
     * ========================================================================
     */
    static repromptStep(step, state, flow, reason) {
        const reprompt = step.reprompt || 
            `I didn't quite catch that. ${step.prompt || `What is your ${step.label || step.id}?`}`;
        
        return {
            reply: reprompt,
            state,
            isComplete: false,
            action: 'REPROMPT',
            currentStep: step.id,
            repromptReason: reason,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                currentStep: step.id,
                repromptReason: reason,
                askCount: state.askCount?.[step.id] || 0
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD ACKNOWLEDGMENT - Short ack for collected value
     * ========================================================================
     */
    static buildAcknowledgment(step, value) {
        const type = step.type || step.id;
        
        const acks = {
            name: ['Got it.', 'Perfect.', 'Thank you.'],
            phone: ['Great.', 'Got it.', 'Perfect.'],
            address: ['Got it.', 'Thank you.', 'Perfect.'],
            time: ['Great.', 'Perfect.', 'Sounds good.'],
            default: ['Got it.', 'Thank you.', 'Perfect.']
        };
        
        const options = acks[type] || acks.default;
        return options[Math.floor(Math.random() * options.length)];
    }
    
    /**
     * ========================================================================
     * BUILD CONFIRMATION - All required data collected
     * ========================================================================
     */
    static buildConfirmation(flow, state) {
        const collected = state.bookingCollected || {};
        
        // Build confirmation message from template
        let confirmation = flow.confirmationTemplate || 
            "Let me confirm: I have {name} at {phone}, service address {address}. Is that correct?";
        
        // Replace placeholders
        confirmation = confirmation.replace(/\{(\w+)\}/g, (match, key) => {
            return collected[key] || match;
        });
        
        // Mark flow as awaiting confirmation
        state.awaitingConfirmation = true;
        state.currentStepId = 'CONFIRMATION';
        
        return {
            reply: confirmation,
            state,
            isComplete: false,
            action: 'CONFIRM',
            bookingCollected: collected,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stage: 'CONFIRMATION',
                bookingCollected: collected
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD COMPLETION - Booking finalized
     * ========================================================================
     */
    static buildCompletion(flow, state) {
        const completion = flow.completionTemplate ||
            "Your appointment has been scheduled. Is there anything else I can help you with?";
        
        // Unlock booking mode
        state.bookingModeLocked = false;
        state.bookingComplete = true;
        state.completedAt = new Date().toISOString();
        
        return {
            reply: completion,
            state,
            isComplete: true,
            action: 'COMPLETE',
            bookingCollected: state.bookingCollected,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stage: 'COMPLETE',
                bookingCollected: state.bookingCollected
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD ESCALATION - Failed to collect after 3 attempts
     * ========================================================================
     */
    static buildEscalation(step, state, flow, reason) {
        // Unlock booking mode and signal transfer
        state.bookingModeLocked = false;
        state.escalated = true;
        state.escalationReason = reason;
        
        return {
            reply: "I'm having trouble getting that information. Let me connect you with someone who can help.",
            state,
            isComplete: false,
            action: 'ESCALATE',
            requiresTransfer: true,
            transferReason: reason,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stage: 'ESCALATE',
                failedStep: step.id,
                reason,
                askCount: state.askCount?.[step.id] || 0
            }
        };
    }
    
    /**
     * ========================================================================
     * BUILD ERROR RESPONSE
     * ========================================================================
     */
    static buildErrorResponse(error, state) {
        return {
            reply: "I apologize, but I'm having trouble with the booking system. Let me connect you with someone who can help.",
            state: {
                ...state,
                bookingModeLocked: false,
                error
            },
            isComplete: false,
            action: 'ERROR',
            requiresTransfer: true,
            transferReason: error,
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            latencyMs: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                stage: 'ERROR',
                error
            }
        };
    }
    
    /**
     * ========================================================================
     * HANDLE CONFIRMATION RESPONSE - Process yes/no to confirmation
     * ========================================================================
     */
    static handleConfirmationResponse(userInput, flow, state) {
        const input = (userInput || '').toLowerCase().trim();
        
        // Check for confirmation
        const confirmPatterns = /^(yes|yeah|yep|yup|correct|that's right|that's correct|right|affirmative|absolutely|sure|ok|okay)$/i;
        const denyPatterns = /^(no|nope|wrong|incorrect|that's wrong|not right|change|fix|redo)$/i;
        
        if (confirmPatterns.test(input) || input.includes('yes') || input.includes('correct')) {
            // Confirmed - complete the booking
            logger.info('[BOOKING FLOW RUNNER] Confirmation received - completing booking');
            return this.buildCompletion(flow, state);
        }
        
        if (denyPatterns.test(input) || input.includes('no') || input.includes('wrong')) {
            // Denied - need to re-collect
            logger.info('[BOOKING FLOW RUNNER] Confirmation denied - user wants to change');
            
            // For now, just ask what they want to change
            // Future: Parse which field they want to change
            state.awaitingConfirmation = false;
            
            return {
                reply: "What would you like to change?",
                state,
                isComplete: false,
                action: 'CHANGE_REQUESTED',
                matchSource: 'BOOKING_FLOW_RUNNER',
                tier: 'tier1',
                tokensUsed: 0,
                debug: {
                    source: 'BOOKING_FLOW_RUNNER',
                    flowId: flow.flowId,
                    stage: 'CHANGE_REQUESTED'
                }
            };
        }
        
        // Unclear response - ask again
        return {
            reply: "I'm sorry, I didn't catch that. Is the information I read back correct? Please say yes or no.",
            state,
            isComplete: false,
            action: 'CONFIRM_RETRY',
            matchSource: 'BOOKING_FLOW_RUNNER',
            tier: 'tier1',
            tokensUsed: 0,
            debug: {
                source: 'BOOKING_FLOW_RUNNER',
                flowId: flow.flowId,
                stage: 'CONFIRM_RETRY',
                userInput: input
            }
        };
    }
}

module.exports = BookingFlowRunner;
module.exports.SlotExtractors = SlotExtractors;
