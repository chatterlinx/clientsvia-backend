/**
 * ============================================================================
 * V110 STEP ENGINE - ENTERPRISE GRADE PROMPT ENGINE
 * ============================================================================
 * 
 * NON-NEGOTIABLE RULES:
 * 1. BookingGate MUST NOT generate any prompts - ONLY StepEngine can.
 * 2. All prompts come from frontDeskBehavior configs - NEVER hardcoded.
 * 3. Slot state is tracked: EMPTY → CAPTURED → CONFIRMED → LOCKED
 * 4. Address uses sub-step state: street → city → unit (not separate actions)
 * 5. Action is always 'CONTINUE' - NO ADDRESS_BREAKDOWN_* or gate-generated actions
 * 
 * ARCHITECTURE:
 * - Single slot registry: frontDeskBehavior.slotRegistry
 * - Discovery flow: frontDeskBehavior.discoveryFlow (passive capture + smart confirm)
 * - Booking flow: frontDeskBehavior.bookingFlow (confirm captured → ask missing → finalize)
 * - Policies: frontDeskBehavior.policies (name parsing, address, booking behavior)
 * 
 * STATE MODEL:
 * {
 *   currentFlow: 'discovery' | 'booking',
 *   currentStepId: 'b3',
 *   currentSlotId: 'address.full',
 *   slotSubStep: 'street' | 'city' | 'unit' | null,
 *   repromptCount: { 'slotId': N },
 *   collectedSlots: { 'slotId': value },
 *   confirmedSlots: { 'slotId': true },
 *   lockedSlots: { 'slotId': true },
 *   pendingConfirmation: 'slotId' | null
 * }
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');
const { DEFAULT_SLOT_REGISTRY, DEFAULT_DISCOVERY_FLOW, DEFAULT_BOOKING_FLOW, DEFAULT_FLOW_POLICIES } = require('../../config/onboarding/DefaultFrontDeskPreset');
const { renderSlotTemplateOrFallback, defaultSlotConfirmFallback, hasUnresolvedPlaceholders } = require('./TemplateRenderer');

const VERSION = 'STEP_ENGINE_V110';

function defaultDiscoveryMissingPrompt(slot, step) {
    const rawLabel = `${slot?.label || ''}`.trim();
    const slotId = `${step?.slotId || ''}`.trim();
    const labelLower = rawLabel.toLowerCase();
    const slotLower = slotId.toLowerCase();

    if (slotLower === 'name' || labelLower.includes('first name')) {
        return "What's your first name?";
    }
    if (slotLower === 'lastname' || slotLower === 'name.last' || labelLower.includes('last name')) {
        return "What's your last name?";
    }
    if (slotLower === 'phone' || labelLower.includes('phone') || labelLower.includes('number')) {
        return "What's the best number to reach you?";
    }
    if (slotLower === 'address' || slotLower === 'address.full' || labelLower.includes('address')) {
        return "What's the service address?";
    }
    if (slotLower === 'call_reason_detail' || labelLower.includes('reason')) {
        return "What can I help you with today?";
    }
    return `What is your ${rawLabel || slotId}?`;
}

/**
 * SLOT STATES - Enterprise lifecycle
 */
const SLOT_STATES = {
    EMPTY: 'EMPTY',           // No value
    CAPTURED: 'CAPTURED',     // Value extracted but not confirmed
    CONFIRMED: 'CONFIRMED',   // Value confirmed by caller
    LOCKED: 'LOCKED',         // Value finalized, cannot change
    REJECTED: 'REJECTED'      // Caller rejected value
};

/**
 * CONFIRM MODES - Per-slot confirmation strategy
 */
const CONFIRM_MODES = {
    SMART_IF_CAPTURED: 'smart_if_captured',           // Confirm only if we captured a value
    ALWAYS: 'always',                                 // Always ask for confirmation
    NEVER: 'never',                                   // Never ask for confirmation
    CONFIRM_IF_FROM_CALLER_ID: 'confirm_if_from_caller_id'  // Confirm if from caller ID
};

/**
 * ============================================================================
 * STEP ENGINE CLASS
 * ============================================================================
 */
class StepEngine {
    /**
     * Initialize StepEngine with company config
     * @param {Object} options
     * @param {Object} options.company - Company document
     * @param {string} options.callId - Call identifier
     * @param {Object} options.awReader - AWConfigReader for traced reads (optional)
     */
    constructor({ company, callId, awReader = null }) {
        this.company = company;
        this.callId = callId;
        this.awReader = awReader;
        
        // Load configs from company.aiAgentSettings.frontDeskBehavior
        const fdb = company?.aiAgentSettings?.frontDeskBehavior || {};
        
        this.slotRegistry = fdb.slotRegistry || DEFAULT_SLOT_REGISTRY;
        this.discoveryFlow = fdb.discoveryFlow || DEFAULT_DISCOVERY_FLOW;
        this.bookingFlow = fdb.bookingFlow || DEFAULT_BOOKING_FLOW;
        this.policies = fdb.policies || DEFAULT_FLOW_POLICIES;
        
        // Build slot lookup map
        this.slotMap = new Map();
        (this.slotRegistry.slots || []).forEach(slot => {
            this.slotMap.set(slot.id, slot);
        });
        
        // ═══════════════════════════════════════════════════════════════════════
        // V117: VALIDATE DISCOVERY STEP ORDER VALUES (MUST BE UNIQUE)
        // ═══════════════════════════════════════════════════════════════════════
        // Non-negotiable rule: Every step must have a unique order value.
        // If duplicates exist, deterministic step-by-step flow is impossible.
        // ═══════════════════════════════════════════════════════════════════════
        const discoverySteps = Array.isArray(this.discoveryFlow.steps) ? this.discoveryFlow.steps : [];
        const normalizedSteps = discoverySteps
            .map((step, idx) => ({
                ...step,
                _originalIndex: idx,
                order: Number.isFinite(step?.order) ? step.order : idx
            }))
            .sort((a, b) => {
                if (a.order === b.order) {
                    return a._originalIndex - b._originalIndex;
                }
                return a.order - b.order;
            });

        let orderAdjusted = false;
        let lastOrder = -1;
        const dedupedOrderSteps = normalizedSteps.map((step) => {
            const nextOrder = step.order <= lastOrder ? lastOrder + 1 : step.order;
            if (nextOrder !== step.order) {
                orderAdjusted = true;
            }
            lastOrder = nextOrder;
            const { _originalIndex, ...cleanStep } = step;
            return { ...cleanStep, order: nextOrder };
        });

        if (orderAdjusted) {
            this.discoveryFlow = { ...this.discoveryFlow, steps: dedupedOrderSteps };
            logger.warn('[STEP ENGINE] Duplicate discovery order values detected - normalized at runtime', {
                callId,
                companyId: company?._id?.toString(),
                normalizedOrders: dedupedOrderSteps.map((s) => ({ stepId: s.stepId, order: s.order })),
                action: 'AUTO_NORMALIZE_DUPLICATE_DISCOVERY_ORDERS'
            });
        }
        
        logger.info(`[STEP ENGINE] V117: Enterprise engine initialized`, {
            callId,
            companyId: company?._id?.toString(),
            slotCount: this.slotMap.size,
            discoveryEnabled: this.discoveryFlow.enabled !== false,
            bookingEnabled: this.bookingFlow.enabled !== false,
            discoveryStepCount: this.discoveryFlow.steps?.length || 0,
            bookingStepCount: (this.bookingFlow.steps || []).length,
            discoveryOrdersValid: true,
            architecture: 'V117_ONE_BRAIN'
        });
    }

    /**
     * Get slot definition by ID
     */
    getSlot(slotId) {
        return this.slotMap.get(slotId) || null;
    }

    /**
     * Get step config by slotId from a flow
     */
    getStepForSlot(flow, slotId) {
        const steps = flow?.steps || [];
        return steps.find(s => s.slotId === slotId) || null;
    }

    /**
     * Get next required unfilled step
     */
    getNextRequiredStep(flow, collectedSlots, confirmedSlots = {}) {
        const steps = (flow?.steps || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        
        for (const step of steps) {
            const slot = this.getSlot(step.slotId);
            if (!slot) {continue;}
            
            const value = collectedSlots[step.slotId];
            const isConfirmed = confirmedSlots[step.slotId] === true;
            
            // If required and not collected
            if (slot.required && !value) {
                return step;
            }
            
            // If collected but needs confirmation
            if (value && slot.bookingConfirmRequired && !isConfirmed) {
                return step;
            }
        }
        
        return null;
    }

    /**
     * ========================================================================
     * DISCOVERY MODE - Passive capture + smart confirmation
     * ========================================================================
     * Discovery should:
     * - Passively extract slots from natural speech
     * - Only confirm when confidence is high or ambiguity exists
     * - NOT interrogate the caller
     */
    runDiscoveryStep({ state, userInput, extractedSlots = {} }) {
        // ═══════════════════════════════════════════════════════════════════════
        // V117: BLOCK IF CONFIG INVALID (duplicate orders, missing prompts, etc.)
        // ═══════════════════════════════════════════════════════════════════════
        if (this._discoveryConfigInvalid) {
            logger.error(`[STEP ENGINE] V117: DISCOVERY_CONFIG_INVALID - Cannot run discovery`, {
                callId: this.callId,
                error: this._discoveryConfigError
            });
            
            // Return safe fallback - don't loop or ask random questions
            return {
                action: 'CONTINUE',
                reply: "One moment — I'm pulling up your account.",
                state,
                configInvalid: true,
                debug: { 
                    source: 'STEP_ENGINE_DISCOVERY', 
                    reason: 'DISCOVERY_CONFIG_INVALID',
                    error: this._discoveryConfigError,
                    action: 'PIPELINE_ABORT_OWNER_SELECTION'
                }
            };
        }
        
        if (this.discoveryFlow.enabled === false) {
            return { 
                action: 'CONTINUE',  // V110: Standardized action
                state,
                debug: { source: 'STEP_ENGINE_DISCOVERY', reason: 'discovery_disabled' }
            };
        }

        const collectedSlots = state.collectedSlots || {};
        const confirmedSlots = state.confirmedSlots || {};
        const repromptCount = state.repromptCount || {};
        
        // ═══════════════════════════════════════════════════════════════════════
        // STEP 1: Merge extracted slots (passive capture)
        // ═══════════════════════════════════════════════════════════════════════
        Object.entries(extractedSlots).forEach(([slotId, value]) => {
            if (value && !collectedSlots[slotId]) {
                const slot = this.getSlot(slotId);
                if (slot && slot.discoveryFillAllowed !== false) {
                    collectedSlots[slotId] = value;
                    logger.info(`[STEP ENGINE] Discovery: Passively captured ${slotId}`, {
                        callId: this.callId,
                        value: typeof value === 'string' ? value.substring(0, 30) : value,
                        source: 'utterance_extraction'
                    });
                }
            }
        });

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 2: Handle pending confirmation response
        // ═══════════════════════════════════════════════════════════════════════
        const pendingConfirmation = state.pendingConfirmation;
        if (pendingConfirmation && userInput) {
            const isYes = this._isYesResponse(userInput);
            const isNo = this._isNoResponse(userInput);
            
            if (isYes) {
                confirmedSlots[pendingConfirmation] = true;
                state.pendingConfirmation = null;
                logger.info(`[STEP ENGINE] Discovery: Confirmed ${pendingConfirmation}`, { callId: this.callId });
            } else if (isNo) {
                // Caller rejected - handle per name parsing policy
                const step = this.getStepForSlot(this.discoveryFlow, pendingConfirmation);
                const namePolicy = this.policies?.nameParsing || {};
                
                // Check if this is a "that's my last name" scenario
                if (pendingConfirmation === 'name.first' && namePolicy.ifCallerSaysNoThatsMyLastName) {
                    const currentValue = collectedSlots[pendingConfirmation];
                    collectedSlots['name.last'] = currentValue;
                    delete collectedSlots[pendingConfirmation];
                    state.pendingConfirmation = null;
                    
                    // Ask for first name
                    const firstNameStep = this.getStepForSlot(this.discoveryFlow, 'name.first');
                    const prompt = firstNameStep?.correctionPrompt || firstNameStep?.ask || "What's your first name?";
                    
                    logger.info(`[STEP ENGINE] Discovery: Moved value to last name, asking for first`, { 
                        callId: this.callId,
                        movedValue: currentValue
                    });
                    
                    return {
                        action: 'CONTINUE',
                        reply: renderSlotTemplateOrFallback({
                            template: prompt,
                            slotId: 'name.first',
                            slotValue: currentValue,
                            fallbackText: defaultSlotConfirmFallback('name.first', currentValue),
                            logger,
                            callId: this.callId,
                            context: 'discovery_name_correction'
                        }),
                        slotId: 'name.first',
                        state: {
                            ...state,
                            currentFlow: 'discovery',
                            currentSlotId: 'name.first',
                            collectedSlots,
                            confirmedSlots
                        },
                        debug: {
                            source: 'STEP_ENGINE_DISCOVERY',
                            reason: 'name_moved_to_last',
                            promptSource: `discoveryFlow.steps[name.first].correctionPrompt`
                        }
                    };
                }
                
                // Normal rejection - clear and ask fresh
                delete collectedSlots[pendingConfirmation];
                state.pendingConfirmation = null;
                
                const correctionPrompt = step?.correctionPrompt || step?.reprompt;
                if (correctionPrompt) {
                    const renderedCorrection = renderSlotTemplateOrFallback({
                        template: correctionPrompt,
                        slotId: pendingConfirmation,
                        slotValue: collectedSlots[pendingConfirmation],
                        fallbackText: step?.ask || `What is your ${pendingConfirmation}?`,
                        logger,
                        callId: this.callId,
                        context: 'discovery_correction_prompt'
                    });
                    return {
                        action: 'CONTINUE',
                        reply: renderedCorrection,
                        slotId: pendingConfirmation,
                        state: {
                            ...state,
                            currentFlow: 'discovery',
                            currentSlotId: pendingConfirmation,
                            collectedSlots,
                            confirmedSlots
                        },
                        debug: {
                            source: 'STEP_ENGINE_DISCOVERY',
                            reason: 'caller_rejected_confirmation',
                            promptSource: `discoveryFlow.steps[${pendingConfirmation}].correctionPrompt`
                        }
                    };
                }
            }
            // Unclear response - treat as new value
            else if (userInput.trim()) {
                collectedSlots[pendingConfirmation] = userInput.trim();
                state.pendingConfirmation = null;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 3: Find next slot needing confirmation (smart confirm)
        // ═══════════════════════════════════════════════════════════════════════
        const steps = (this.discoveryFlow.steps || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        
        for (const step of steps) {
            const slot = this.getSlot(step.slotId);
            if (!slot) {continue;}
            
            const value = collectedSlots[step.slotId];
            const isConfirmed = confirmedSlots[step.slotId] === true;
            
            // Check if needs confirmation based on confirmMode
            if (value && !isConfirmed) {
                const confirmMode = step.confirmMode || CONFIRM_MODES.SMART_IF_CAPTURED;
                
                if (confirmMode === CONFIRM_MODES.ALWAYS || 
                    confirmMode === CONFIRM_MODES.SMART_IF_CAPTURED) {
                    const count = repromptCount[step.slotId] || 0;
                    const { prompt, promptSource } = this._buildDiscoveryConfirmPrompt(step, value, count);
                    
                    repromptCount[step.slotId] = count + 1;
                    
                    return {
                        action: 'CONTINUE',  // V110: Always CONTINUE
                        reply: prompt,
                        slotId: step.slotId,
                        state: {
                            ...state,
                            currentFlow: 'discovery',
                            currentStepId: step.stepId,
                            currentSlotId: step.slotId,
                            collectedSlots,
                            confirmedSlots,
                            repromptCount,
                            pendingConfirmation: step.slotId
                        },
                        debug: {
                            source: 'STEP_ENGINE_DISCOVERY',
                            step: step.stepId,
                            slotId: step.slotId,
                            confirmMode,
                            repromptCount: repromptCount[step.slotId],
                            promptSource
                        }
                    };
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 4: Ask for missing required slots (V120: Discovery Flow as Speaker)
        // ═══════════════════════════════════════════════════════════════════════
        for (const step of steps) {
            const slot = this.getSlot(step.slotId);
            if (!slot) continue;
            
            // Skip passive slots (like call_reason_detail)
            if (step.passive === true || step.isPassive === true) continue;
            
            const value = collectedSlots[step.slotId];
            const isConfirmed = confirmedSlots[step.slotId] === true;
            
            // If slot is missing value, ask for it
            if (!value) {
                // Keep d0 resilient: never render "Got it — {value}" when reason is empty.
                if (step.slotId === 'call_reason_detail') {
                    const reasonPrompt = step.reprompt || "What can I help you with today?";
                    const prompt = `Got it. ${reasonPrompt}`.trim();
                    const currentCount = repromptCount[step.slotId] || 0;
                    repromptCount[step.slotId] = currentCount + 1;
                    return {
                        action: 'CONTINUE',
                        reply: prompt,
                        slotId: step.slotId,
                        state: {
                            ...state,
                            currentFlow: 'discovery',
                            currentStepId: step.stepId,
                            currentSlotId: step.slotId,
                            collectedSlots,
                            confirmedSlots,
                            repromptCount
                        },
                        debug: {
                            source: 'STEP_ENGINE_DISCOVERY',
                            step: step.stepId,
                            slotId: step.slotId,
                            mode: 'ASK_MISSING',
                            repromptCount: repromptCount[step.slotId],
                            promptSource: `discoveryFlow.steps[${step.slotId}].reprompt`
                        }
                    };
                }

                const count = repromptCount[step.slotId] || 0;
                let prompt;
                let promptSource;
                
                if (count > 0 && step.repromptVariants?.length > 0) {
                    const idx = Math.min(count - 1, step.repromptVariants.length - 1);
                    prompt = step.repromptVariants[idx];
                    promptSource = `discoveryFlow.steps[${step.slotId}].repromptVariants[${idx}]`;
                } else if (count > 0 && step.reprompt) {
                    prompt = step.reprompt;
                    promptSource = `discoveryFlow.steps[${step.slotId}].reprompt`;
                } else {
                    // V117: Ask-missing MUST NOT use templates that require {value}.
                    // Prefer askMissing; otherwise use ask only if it doesn't contain placeholders.
                    prompt = step.askMissing || step.ask;
                    promptSource = step.askMissing
                        ? `discoveryFlow.steps[${step.slotId}].askMissing`
                        : `discoveryFlow.steps[${step.slotId}].ask`;
                    if (prompt && hasUnresolvedPlaceholders(prompt)) {
                        // When slot value is missing, do NOT use "did I get X right?" reprompts.
                        // Prefer explicit repromptMissing, otherwise use a deterministic default.
                        prompt = step.repromptMissing || defaultDiscoveryMissingPrompt(slot, step) || step.reprompt;
                        promptSource = step.repromptMissing
                            ? `discoveryFlow.steps[${step.slotId}].repromptMissing`
                            : 'DEFAULT_DISCOVERY_MISSING_PROMPT';
                    }
                }
                
                // Only ask if we have a prompt configured
                if (prompt) {
                    repromptCount[step.slotId] = count + 1;
                    const renderedPrompt = renderSlotTemplateOrFallback({
                        template: prompt,
                        slotId: step.slotId,
                        slotValue: value,
                        fallbackText: defaultDiscoveryMissingPrompt(slot, step),
                        logger,
                        callId: this.callId,
                        context: 'discovery_ask_missing'
                    });
                    
                    logger.info(`[STEP ENGINE] Discovery: Asking for missing slot`, {
                        callId: this.callId,
                        slotId: step.slotId,
                        stepId: step.stepId,
                        count
                    });
                    
                    return {
                        action: 'CONTINUE',
                        reply: renderedPrompt,
                        slotId: step.slotId,
                        state: {
                            ...state,
                            currentFlow: 'discovery',
                            currentStepId: step.stepId,
                            currentSlotId: step.slotId,
                            collectedSlots,
                            confirmedSlots,
                            repromptCount
                        },
                        debug: {
                            source: 'STEP_ENGINE_DISCOVERY',
                            step: step.stepId,
                            slotId: step.slotId,
                            mode: 'ASK_MISSING',
                            repromptCount: repromptCount[step.slotId],
                            promptSource
                        }
                    };
                }
            }
            
            // Also handle confirm_if_from_caller_id mode for phone
            if (value && !isConfirmed) {
                const confirmMode = step.confirmMode || CONFIRM_MODES.SMART_IF_CAPTURED;
                
                if (confirmMode === 'confirm_if_from_caller_id') {
                    // Check if value came from caller ID
                    const slotMeta = state.slotMeta?.[step.slotId] || {};
                    if (slotMeta.source === 'caller_id' || slotMeta.source === 'callerID') {
                        const count = repromptCount[step.slotId] || 0;
                        const basePrompt = step.confirm || step.ask || `Is ${value} the best number to reach you?`;
                        const prompt = renderSlotTemplateOrFallback({
                            template: basePrompt,
                            slotId: step.slotId,
                            slotValue: value,
                            fallbackText: `Is ${value} the best number to reach you?`,
                            logger,
                            callId: this.callId,
                            context: 'discovery_confirm_if_caller_id'
                        });
                        
                        repromptCount[step.slotId] = count + 1;
                        
                        return {
                            action: 'CONTINUE',
                            reply: prompt,
                            slotId: step.slotId,
                            state: {
                                ...state,
                                currentFlow: 'discovery',
                                currentStepId: step.stepId,
                                currentSlotId: step.slotId,
                                collectedSlots,
                                confirmedSlots,
                                repromptCount,
                                pendingConfirmation: step.slotId
                            },
                            debug: {
                                source: 'STEP_ENGINE_DISCOVERY',
                                step: step.stepId,
                                slotId: step.slotId,
                                confirmMode,
                                repromptCount: repromptCount[step.slotId],
                                promptSource: `discoveryFlow.steps[${step.slotId}].confirm`
                            }
                        };
                    }
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // STEP 5: All required slots captured and confirmed - discovery complete
        // ═══════════════════════════════════════════════════════════════════════
        const allRequiredFilled = steps.every(step => {
            if (step.passive === true || step.isPassive === true) return true;
            const slot = this.getSlot(step.slotId);
            if (!slot?.required) return true;
            const value = collectedSlots[step.slotId];
            if (value == null || `${value}`.trim() === '') {
                return false;
            }

            const confirmMode = step.confirmMode || CONFIRM_MODES.SMART_IF_CAPTURED;
            if (confirmMode === CONFIRM_MODES.NEVER) {
                return true;
            }
            if (confirmMode === CONFIRM_MODES.CONFIRM_IF_FROM_CALLER_ID) {
                const slotMeta = state.slotMeta?.[step.slotId] || {};
                const cameFromCallerId = slotMeta.source === 'caller_id' || slotMeta.source === 'callerID';
                return !cameFromCallerId || confirmedSlots[step.slotId] === true;
            }
            return confirmedSlots[step.slotId] === true;
        });
        
        return {
            action: 'CONTINUE',
            discoveryComplete: allRequiredFilled,
            state: { 
                ...state, 
                currentFlow: 'discovery',
                collectedSlots, 
                confirmedSlots,
                repromptCount
            },
            debug: { 
                source: 'STEP_ENGINE_DISCOVERY', 
                reason: allRequiredFilled ? 'discovery_complete' : 'no_action_needed',
                capturedSlots: Object.keys(collectedSlots),
                confirmedSlots: Object.keys(confirmedSlots)
            }
        };
    }

    /**
     * ========================================================================
     * BOOKING MODE - Confirm captured → Ask missing → Finalize
     * ========================================================================
     * Booking should:
     * - Confirm what's already captured (never restart at "name")
     * - Lock confirmed slots
     * - Ask only for missing required slots
     * - Support sub-step state for address
     */
    runBookingStep({ state, userInput }) {
        if (this.bookingFlow.enabled === false) {
            // V110: Get transfer message from config
            const transferMsg = this.bookingFlow.disabledMessage || 
                "I apologize, but booking isn't configured. Let me connect you with someone who can help.";
            
            return { 
                action: 'CONTINUE',
                reply: transferMsg,
                requiresTransfer: true,
                debug: {
                    source: 'STEP_ENGINE_BOOKING',
                    reason: 'booking_disabled',
                    promptSource: 'bookingFlow.disabledMessage'
                }
            };
        }

        const collectedSlots = state.collectedSlots || {};
        const confirmedSlots = state.confirmedSlots || {};
        const lockedSlots = state.lockedSlots || {};
        const repromptCount = state.repromptCount || {};
        const pendingConfirmation = state.pendingConfirmation;
        const slotSubStep = state.slotSubStep;
        
        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 1: Handle address sub-step continuation
        // ═══════════════════════════════════════════════════════════════════════
        if (slotSubStep && state.currentSlotId === 'address.full') {
            return this._handleAddressSubStep({ state, userInput });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 2: Handle pending confirmation response
        // ═══════════════════════════════════════════════════════════════════════
        if (pendingConfirmation) {
            const isYes = this._isYesResponse(userInput);
            const isNo = this._isNoResponse(userInput);
            
            if (isYes) {
                confirmedSlots[pendingConfirmation] = true;
                lockedSlots[pendingConfirmation] = true;  // V110: Lock on confirm
                state.pendingConfirmation = null;
                logger.info(`[STEP ENGINE] Booking: Confirmed + locked ${pendingConfirmation}`, { 
                    callId: this.callId 
                });
            } else if (isNo) {
                // Caller rejected - ask fresh
                const step = this.getStepForSlot(this.bookingFlow, pendingConfirmation);
                const slot = this.getSlot(pendingConfirmation);
                
                delete collectedSlots[pendingConfirmation];
                state.pendingConfirmation = null;
                
                const prompt = step?.correctionPrompt || step?.ask;
                const promptSource = step?.correctionPrompt 
                    ? `bookingFlow.steps[${pendingConfirmation}].correctionPrompt`
                    : `bookingFlow.steps[${pendingConfirmation}].ask`;
                
                if (!prompt) {
                    logger.error('[STEP ENGINE] V110: No correctionPrompt configured', {
                        stepId: step?.stepId,
                        slotId: pendingConfirmation
                    });
                }
                
                return {
                    action: 'CONTINUE',
                    reply: prompt || `What is your ${slot?.label || pendingConfirmation}?`,
                    slotId: pendingConfirmation,
                    state: {
                        ...state,
                        currentFlow: 'booking',
                        currentSlotId: pendingConfirmation,
                        collectedSlots,
                        confirmedSlots,
                        lockedSlots
                    },
                    debug: {
                        source: 'STEP_ENGINE_BOOKING',
                        reason: 'caller_rejected_confirmation',
                        slotId: pendingConfirmation,
                        promptSource
                    }
                };
            } else if (userInput?.trim()) {
                // Unclear response - treat as value update
                collectedSlots[pendingConfirmation] = userInput.trim();
                state.pendingConfirmation = null;
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 3: Confirm-captured-first (if enabled)
        // ═══════════════════════════════════════════════════════════════════════
        if (this.bookingFlow.confirmCapturedFirst !== false) {
            const steps = (this.bookingFlow.steps || []).sort((a, b) => (a.order || 0) - (b.order || 0));
            
            for (const step of steps) {
                const slot = this.getSlot(step.slotId);
                if (!slot) {continue;}
                
                const value = collectedSlots[step.slotId];
                const isConfirmed = confirmedSlots[step.slotId] === true;
                const isLocked = lockedSlots[step.slotId] === true;
                
                // Skip if already locked
                if (isLocked) {continue;}
                
                // If we have a value but it's not confirmed
                if (value && !isConfirmed && slot.bookingConfirmRequired !== false) {
                    const prompt = renderSlotTemplateOrFallback({
                        template: step.confirmPrompt || '',
                        slotId: step.slotId,
                        slotValue: value,
                        fallbackText: `I have ${value}. Is that correct?`,
                        logger,
                        callId: this.callId,
                        context: 'booking_confirm_prompt'
                    });
                    const promptSource = step.confirmPrompt 
                        ? `bookingFlow.steps[${step.slotId}].confirmPrompt`
                        : 'ERROR:NO_CONFIRM_PROMPT';
                    
                    if (!step.confirmPrompt) {
                        logger.warn('[STEP ENGINE] V110: No confirmPrompt configured for slot', {
                            stepId: step.stepId,
                            slotId: step.slotId
                        });
                    }
                    
                    return {
                        action: 'CONTINUE',
                        reply: prompt || `I have ${value}. Is that correct?`,
                        slotId: step.slotId,
                        state: {
                            ...state,
                            currentFlow: 'booking',
                            currentStepId: step.stepId,
                            currentSlotId: step.slotId,
                            collectedSlots,
                            confirmedSlots,
                            lockedSlots,
                            pendingConfirmation: step.slotId
                        },
                        debug: {
                            source: 'STEP_ENGINE_BOOKING',
                            phase: 'confirm_captured_first',
                            step: step.stepId,
                            slotId: step.slotId,
                            promptSource
                        }
                    };
                }
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 4: Ask for missing required slots
        // ═══════════════════════════════════════════════════════════════════════
        const steps = (this.bookingFlow.steps || []).sort((a, b) => (a.order || 0) - (b.order || 0));
        
        for (const step of steps) {
            const slot = this.getSlot(step.slotId);
            if (!slot || !slot.required) {continue;}
            
            const value = collectedSlots[step.slotId];
            
            if (!value) {
                const currentCount = repromptCount[step.slotId] || 0;
                const maxAttempts = step.maxAttempts || 3;
                
                // Check max attempts - transfer if exceeded
                if (currentCount >= maxAttempts) {
                    const transferMsg = this.bookingFlow.maxAttemptsMessage ||
                        "I'm having trouble. Let me connect you with someone who can help.";
                    
                    return {
                        action: 'CONTINUE',
                        reply: transferMsg,
                        requiresTransfer: true,
                        debug: {
                            source: 'STEP_ENGINE_BOOKING',
                            reason: 'max_attempts_exceeded',
                            slotId: step.slotId,
                            repromptCount: currentCount,
                            maxAttempts,
                            promptSource: 'bookingFlow.maxAttemptsMessage'
                        }
                    };
                }
                
                // Check if this is address with sub-steps
                if ((step.slotId === 'address.full' || step.type === 'address') && 
                    step.structuredSubflow?.enabled === true) {
                    return this._startAddressSubSteps({ state, step });
                }
                
                // Get prompt - use repromptVariants if available
                let prompt;
                let promptSource;
                
                if (currentCount > 0 && step.repromptVariants?.length > 0) {
                    const idx = Math.min(currentCount - 1, step.repromptVariants.length - 1);
                    prompt = step.repromptVariants[idx];
                    promptSource = `bookingFlow.steps[${step.slotId}].repromptVariants[${idx}]`;
                } else if (currentCount > 0 && step.reprompt) {
                    prompt = step.reprompt;
                    promptSource = `bookingFlow.steps[${step.slotId}].reprompt`;
                } else {
                    prompt = step.ask;
                    promptSource = `bookingFlow.steps[${step.slotId}].ask`;
                }
                
                if (!prompt) {
                    logger.error('[STEP ENGINE] V110: No prompt configured for slot', {
                        stepId: step.stepId,
                        slotId: step.slotId,
                        repromptCount: currentCount
                    });
                }
                
                repromptCount[step.slotId] = currentCount + 1;
                
                return {
                    action: 'CONTINUE',
                    reply: prompt || `What is your ${slot.label || step.slotId}?`,
                    slotId: step.slotId,
                    state: {
                        ...state,
                        currentFlow: 'booking',
                        currentStepId: step.stepId,
                        currentSlotId: step.slotId,
                        collectedSlots,
                        confirmedSlots,
                        lockedSlots,
                        repromptCount
                    },
                    debug: {
                        source: 'STEP_ENGINE_BOOKING',
                        phase: 'ask_missing',
                        step: step.stepId,
                        slotId: step.slotId,
                        repromptCount: repromptCount[step.slotId],
                        promptSource
                    }
                };
            }
        }

        // ═══════════════════════════════════════════════════════════════════════
        // PHASE 5: All slots collected - final confirmation
        // ═══════════════════════════════════════════════════════════════════════
        if (this.bookingFlow.completion?.reviewAndConfirm && !state.pendingFinalConfirmation) {
            let confirmScript = this.bookingFlow.completion.confirmScript;
            
            if (!confirmScript) {
                logger.error('[STEP ENGINE] V110: No confirmScript configured in bookingFlow.completion');
                confirmScript = "I have all your information. Is that all correct?";
            }
            
            // Replace slot placeholders
            for (const [slotId, value] of Object.entries(collectedSlots)) {
                confirmScript = confirmScript.replace(`{${slotId}}`, value);
            }
            
            return {
                action: 'CONTINUE',
                reply: confirmScript,
                state: {
                    ...state,
                    currentFlow: 'booking',
                    currentStepId: 'final_confirmation',
                    collectedSlots,
                    confirmedSlots,
                    lockedSlots,
                    repromptCount,
                    pendingFinalConfirmation: true
                },
                debug: {
                    source: 'STEP_ENGINE_BOOKING',
                    phase: 'final_confirmation',
                    promptSource: 'bookingFlow.completion.confirmScript'
                }
            };
        }
        
        // Handle final confirmation response
        if (state.pendingFinalConfirmation) {
            const isYes = this._isYesResponse(userInput);
            const isNo = this._isNoResponse(userInput);
            
            if (isYes) {
                return {
                    action: 'COMPLETE',
                    state: {
                        ...state,
                        bookingComplete: true,
                        collectedSlots,
                        confirmedSlots,
                        lockedSlots
                    },
                    debug: {
                        source: 'STEP_ENGINE_BOOKING',
                        phase: 'complete'
                    }
                };
            } else if (isNo) {
                // Ask what to change
                const correctionPrompt = this.bookingFlow.completion?.correctionPrompt;
                
                return {
                    action: 'CONTINUE',
                    reply: correctionPrompt || "What would you like to change?",
                    state: {
                        ...state,
                        pendingFinalConfirmation: false,
                        awaitingCorrection: true
                    },
                    debug: {
                        source: 'STEP_ENGINE_BOOKING',
                        phase: 'correction_requested',
                        promptSource: 'bookingFlow.completion.correctionPrompt'
                    }
                };
            } 
                // Unclear - re-ask
                const retryPrompt = this.bookingFlow.completion?.confirmRetryPrompt;
                
                return {
                    action: 'CONTINUE',
                    reply: retryPrompt || "Is all that information correct?",
                    state,
                    debug: {
                        source: 'STEP_ENGINE_BOOKING',
                        phase: 'final_confirm_retry',
                        promptSource: 'bookingFlow.completion.confirmRetryPrompt'
                    }
                };
            
        }

        // Complete without final confirmation
        return {
            action: 'COMPLETE',
            state: {
                ...state,
                bookingComplete: true,
                collectedSlots,
                confirmedSlots,
                lockedSlots
            },
            debug: {
                source: 'STEP_ENGINE_BOOKING',
                phase: 'complete'
            }
        };
    }

    /**
     * ========================================================================
     * ADDRESS SUB-STEP HANDLING - Enterprise sub-step state
     * ========================================================================
     * Sub-step state: state.slotSubStep = 'street' | 'city' | 'unit' | 'confirm'
     */
    _startAddressSubSteps({ state, step }) {
        const subflow = step.structuredSubflow;
        const sequence = subflow.sequence || ['address.street', 'address.city', 'address.unit'];
        const prompts = subflow.prompts || {};
        
        const firstSubStep = sequence[0]?.replace('address.', '') || 'street';
        const firstPrompt = prompts[`address.${firstSubStep}`] || prompts[firstSubStep];
        
        if (!firstPrompt) {
            logger.error('[STEP ENGINE] V110: No prompt for address sub-step', {
                subStep: firstSubStep,
                availablePrompts: Object.keys(prompts)
            });
        }
        
        return {
            action: 'CONTINUE',
            reply: firstPrompt || step.ask,
            slotId: 'address.full',
            state: {
                ...state,
                currentFlow: 'booking',
                currentStepId: step.stepId,
                currentSlotId: 'address.full',
                slotSubStep: firstSubStep,
                addressCollected: {},
                repromptCount: {
                    ...state.repromptCount,
                    'address.full': (state.repromptCount?.['address.full'] || 0) + 1
                }
            },
            debug: {
                source: 'STEP_ENGINE_BOOKING',
                phase: 'address_sub_step_start',
                slotSubStep: firstSubStep,
                promptSource: `bookingFlow.steps[address.full].structuredSubflow.prompts.address.${firstSubStep}`
            }
        };
    }
    
    _handleAddressSubStep({ state, userInput }) {
        const step = this.getStepForSlot(this.bookingFlow, 'address.full');
        const subflow = step?.structuredSubflow || {};
        const sequence = subflow.sequence || ['address.street', 'address.city', 'address.unit'];
        const prompts = subflow.prompts || {};
        
        const currentSubStep = state.slotSubStep;
        const addressCollected = { ...state.addressCollected };
        
        // Empty input - reprompt current sub-step
        if (!userInput?.trim()) {
            const repromptKey = `address.${currentSubStep}.reprompt`;
            const reprompt = prompts[repromptKey] || prompts[`address.${currentSubStep}`];
            
            return {
                action: 'CONTINUE',
                reply: reprompt,
                slotId: 'address.full',
                state,
                debug: {
                    source: 'STEP_ENGINE_BOOKING',
                    phase: 'address_sub_step_reprompt',
                    slotSubStep: currentSubStep,
                    promptSource: `bookingFlow.steps[address.full].structuredSubflow.prompts.${repromptKey}`
                }
            };
        }
        
        // Store current sub-step value
        addressCollected[currentSubStep] = userInput.trim();
        
        // Find next sub-step
        const currentKey = `address.${currentSubStep}`;
        const currentIdx = sequence.indexOf(currentKey);
        const nextIdx = currentIdx + 1;
        
        if (nextIdx < sequence.length) {
            const nextKey = sequence[nextIdx];
            const nextSubStep = nextKey.replace('address.', '');
            const nextPrompt = prompts[nextKey] || prompts[nextSubStep];
            
            if (!nextPrompt) {
                logger.error('[STEP ENGINE] V110: No prompt for next address sub-step', {
                    nextSubStep,
                    availablePrompts: Object.keys(prompts)
                });
            }
            
            return {
                action: 'CONTINUE',
                reply: nextPrompt,
                slotId: 'address.full',
                state: {
                    ...state,
                    slotSubStep: nextSubStep,
                    addressCollected
                },
                debug: {
                    source: 'STEP_ENGINE_BOOKING',
                    phase: 'address_sub_step_advance',
                    slotSubStep: nextSubStep,
                    addressCollected,
                    promptSource: `bookingFlow.steps[address.full].structuredSubflow.prompts.${nextKey}`
                }
            };
        }
        
        // All sub-steps complete - assemble address
        const fullAddress = this._assembleAddress(addressCollected);
        const collectedSlots = { ...state.collectedSlots, 'address.full': fullAddress };
        
        logger.info('[STEP ENGINE] Address sub-steps complete', {
            callId: this.callId,
            addressCollected,
            fullAddress
        });
        
        // Clear sub-step state and continue booking
        return this.runBookingStep({
            state: {
                ...state,
                slotSubStep: null,
                addressCollected: null,
                collectedSlots
            },
            userInput: null
        });
    }
    
    _assembleAddress(parts) {
        const { street, city, unit, state: addressState, zip } = parts;
        let address = street || '';
        if (unit && unit.toLowerCase() !== 'house') {
            address += ` ${unit}`;
        }
        if (city) {
            address += `, ${city}`;
        }
        if (addressState) {
            address += `, ${addressState}`;
        } else {
            // Default state from policies
            const defaultState = this.policies?.address?.defaultState || 'FL';
            address += `, ${defaultState}`;
        }
        if (zip) {
            address += ` ${zip}`;
        }
        return address.trim();
    }

    /**
     * ========================================================================
     * PROMOTE DISCOVERY TO BOOKING
     * ========================================================================
     * Transfer captured slots from discovery to booking mode
     * Per policy: neverRestartIfAlreadyCaptured
     */
    promoteToBooking(state) {
        const bookingPolicy = this.policies?.booking || {};
        
        if (bookingPolicy.neverRestartIfAlreadyCaptured !== false) {
            logger.info('[STEP ENGINE] Promoting discovery to booking - keeping captured values', {
                callId: this.callId,
                capturedSlots: Object.keys(state.collectedSlots || {}),
                confirmedSlots: Object.keys(state.confirmedSlots || {})
            });
            
            return {
                ...state,
                currentFlow: 'booking',
                mode: 'BOOKING',
                bookingModeLocked: true
            };
        }
        
        // Clear and restart (not recommended)
        logger.warn('[STEP ENGINE] Restarting booking from scratch (not recommended)', {
            callId: this.callId
        });
        
        return {
            currentFlow: 'booking',
            mode: 'BOOKING',
            bookingModeLocked: true,
            collectedSlots: {},
            confirmedSlots: {},
            lockedSlots: {},
            repromptCount: {}
        };
    }

    /**
     * ========================================================================
     * HELPER METHODS
     * ========================================================================
     */
    _isYesResponse(text) {
        if (!text) {return false;}
        const lower = text.toLowerCase().trim();
        const yesPatterns = [
            'yes', 'yeah', 'yep', 'yup', 'correct', 'right', 
            "that's right", "that's correct", 'sure', 'ok', 'okay',
            'uh-huh', 'mhm', 'absolutely', 'definitely', 'confirmed',
            'affirmative', 'yea', 'ya'
        ];
        return yesPatterns.some(p => lower.includes(p));
    }
    
    _isNoResponse(text) {
        if (!text) {return false;}
        const lower = text.toLowerCase().trim();
        const noPatterns = [
            'no', 'nope', 'nah', 'wrong', 'incorrect', 
            "that's wrong", "that's not right", "that's not correct",
            'actually', 'wait', 'hold on', 'change'
        ];
        return noPatterns.some(p => lower.includes(p));
    }

    _buildDiscoveryConfirmPrompt(step, value, count) {
        let prompt;
        let promptSource;

        if (count > 0 && step.confirmReprompt) {
            prompt = step.confirmReprompt;
            promptSource = `discoveryFlow.steps[${step.slotId}].confirmReprompt`;
        } else if (step.confirm) {
            prompt = step.confirm;
            promptSource = `discoveryFlow.steps[${step.slotId}].confirm`;
        } else if (step.confirmPrompt) {
            prompt = step.confirmPrompt;
            promptSource = `discoveryFlow.steps[${step.slotId}].confirmPrompt`;
        } else {
            prompt = 'I have {value}. Is that correct?';
            promptSource = `discoveryFlow.steps[${step.slotId}].confirm[default]`;
        }

        const fallback = defaultSlotConfirmFallback(step.slotId, value);
        return {
            prompt: renderSlotTemplateOrFallback({
                template: prompt || '',
                slotId: step.slotId,
                slotValue: value,
                fallbackText: fallback,
                logger,
                callId: this.callId,
                context: 'discovery_confirm_prompt'
            }),
            promptSource
        };
    }
}

/**
 * ============================================================================
 * STATIC FACTORY FOR CALL CONTEXT
 * ============================================================================
 */
StepEngine.forCall = function({ company, callId, awReader }) {
    return new StepEngine({ company, callId, awReader });
};

module.exports = {
    StepEngine,
    SLOT_STATES,
    CONFIRM_MODES,
    VERSION
};
