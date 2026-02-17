const { StepEngine } = require('./StepEngine');
const {
    renderSlotTemplateOrFallback,
    defaultSlotConfirmFallback,
    hasUnresolvedPlaceholders
} = require('./TemplateRenderer');
const logger = require('../../utils/logger');

let BlackBoxLogger = null;
try {
    BlackBoxLogger = require('../BlackBoxLogger');
} catch (err) {
    BlackBoxLogger = null;
}

/**
 * ============================================================================
 * DISCOVERY FLOW RUNNER - V110 Phase B State Continuity
 * ============================================================================
 * 
 * REGRESSION GUARD (Phase B):
 * Once call_reason_detail is captured (S5 complete), Discovery MUST NOT regress
 * to asking for name confirmation. This prevents the "ghost regression" bug where
 * the agent suddenly asks "I have Mark. Is that correct?" after S5.
 * 
 * If state is lost and call_reason was previously captured, we should:
 * 1. Emit SECTION_S4_REGRESSION_BLOCKED event
 * 2. Continue forward (ask for missing info) rather than re-confirm captured info
 * 
 * ============================================================================
 */
class DiscoveryFlowRunner {
    static run({ company, callSid, userInput, state }) {
        const stepEngine = StepEngine.forCall({ company, callId: callSid });

        const discoveryState = {
            currentFlow: 'discovery',
            collectedSlots: { ...(state.plainSlots || {}) },
            confirmedSlots: { ...(state.discovery?.confirmedSlots || {}) },
            repromptCount: { ...(state.discovery?.repromptCount || {}) },
            pendingConfirmation: state.discovery?.pendingConfirmation || null,
            currentStepId: state.discovery?.currentStepId || null,
            currentSlotId: state.discovery?.currentSlotId || null,
            slotMeta: { ...(state.slotMeta || {}) }
        };

        const result = stepEngine.runDiscoveryStep({
            state: discoveryState,
            userInput,
            extractedSlots: { ...(state.plainSlots || {}) }
        });

        const nextPlainSlots = {
            ...(state.plainSlots || {}),
            ...(result.state?.collectedSlots || {})
        };

        const next = {
            ...state,
            lane: 'DISCOVERY',
            plainSlots: nextPlainSlots,
            discovery: {
                ...state.discovery,
                currentStepId: result.state?.currentStepId || null,
                currentSlotId: result.state?.currentSlotId || null,
                pendingConfirmation: result.state?.pendingConfirmation || null,
                repromptCount: { ...(result.state?.repromptCount || {}) },
                confirmedSlots: { ...(result.state?.confirmedSlots || {}) }
            },
            booking: {
                ...state.booking,
                confirmedSlots: { ...(result.state?.confirmedSlots || state.booking?.confirmedSlots || {}) }
            }
        };
        DiscoveryFlowRunner.ensureDiscoveryStepPointers(company, next);

        // ═══════════════════════════════════════════════════════════════════════════
        // REGRESSION GUARD: Check if reply would regress after S5
        // ═══════════════════════════════════════════════════════════════════════════
        if (result.reply) {
            const guardedReply = DiscoveryFlowRunner.applyRegressionGuard({
                company,
                callSid,
                response: result.reply,
                state: next
            });
            
            const response = DiscoveryFlowRunner.sanitizeReply({
                company,
                response: guardedReply,
                state: next
            });
            return {
                response,
                matchSource: 'DISCOVERY_FLOW_RUNNER',
                state: next
            };
        }

        // Discovery owner contract: never fall through to LLM/scenario speaker.
        const forcedPrompt = DiscoveryFlowRunner.buildDeterministicPrompt(
            company,
            nextPlainSlots,
            next.discovery?.confirmedSlots || {},
            next // Pass full state for regression guard
        );

        if (!forcedPrompt) {
            throw new Error('DiscoveryFlowRunner produced no reply and no deterministic fallback prompt');
        }

        // Apply regression guard to forced prompt too
        const guardedPrompt = DiscoveryFlowRunner.applyRegressionGuard({
            company,
            callSid,
            response: forcedPrompt,
            state: next
        });

        return {
            response: DiscoveryFlowRunner.sanitizeReply({
                company,
                response: guardedPrompt,
                state: next
            }),
            matchSource: 'DISCOVERY_FLOW_RUNNER',
            state: next
        };
    }

    static isComplete(company, plainSlots = {}) {
        const steps = company?.aiAgentSettings?.frontDeskBehavior?.discoveryFlow?.steps || [];
        if (!Array.isArray(steps) || steps.length === 0) {
            return true;
        }

        return steps
            .filter((step) => step.slotId && step.passive !== true && step.isPassive !== true)
            .every((step) => {
                const value = plainSlots[step.slotId];
                return value != null && `${value}`.trim() !== '';
            });
    }

    static ensureDiscoveryStepPointers(company, state) {
        const currentStepId = state?.discovery?.currentStepId;
        const currentSlotId = state?.discovery?.currentSlotId;
        if (currentStepId && currentSlotId) {
            return;
        }

        const steps = [...(company?.aiAgentSettings?.frontDeskBehavior?.discoveryFlow?.steps || [])]
            .filter((step) => !!step?.slotId && step.passive !== true && step.isPassive !== true)
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        const plainSlots = state?.plainSlots || {};
        const confirmedSlots = state?.discovery?.confirmedSlots || {};
        const pendingConfirmation = state?.discovery?.pendingConfirmation || null;

        let activeStep = null;
        if (pendingConfirmation) {
            activeStep = steps.find((step) => step.slotId === pendingConfirmation) || null;
        }

        if (!activeStep) {
            activeStep = steps.find((step) => {
                const value = plainSlots[step.slotId];
                if (value == null || `${value}`.trim() === '') {
                    return true;
                }
                if (step.confirmMode !== 'never' && confirmedSlots[step.slotId] !== true) {
                    return true;
                }
                return false;
            }) || null;
        }

        if (!activeStep) {
            state.discovery.currentStepId = currentStepId || 'discovery_complete';
            state.discovery.currentSlotId = currentSlotId || 'discovery_complete';
            return;
        }

        state.discovery.currentStepId = currentStepId || activeStep.stepId || 'discovery_active';
        state.discovery.currentSlotId = currentSlotId || activeStep.slotId || 'discovery_active';
    }

    /**
     * Build a deterministic prompt based on discovery flow state.
     * 
     * REGRESSION GUARD (Phase B):
     * If call_reason_detail is captured, do NOT ask to confirm name again.
     * Instead, skip to the next unconfirmed slot after name.
     * 
     * V116 PENDING SLOT AWARENESS:
     * If a slot exists in pendingSlots (extracted but not confirmed), use it for
     * CONTEXT but don't ask for confirmation yet. Save confirmation for booking.
     * This prevents re-asking during discovery when caller volunteers info.
     */
    static buildDeterministicPrompt(company, plainSlots = {}, confirmedSlots = {}, fullState = null) {
        const steps = [...(company?.aiAgentSettings?.frontDeskBehavior?.discoveryFlow?.steps || [])]
            .sort((a, b) => (a.order || 0) - (b.order || 0));

        // Phase B: Check if call reason was captured (S5 complete)
        const callReasonCaptured = !!plainSlots.call_reason_detail;
        const namePresent = !!plainSlots.name || !!plainSlots['name.first'];
        
        // V116: Get pending slots from state
        const pendingSlots = fullState?.pendingSlots || {};
        
        for (const step of steps) {
            if (!step?.slotId || step.passive === true || step.isPassive === true) {
                continue;
            }
            const value = plainSlots[step.slotId];
            const isConfirmed = confirmedSlots[step.slotId] === true;
            const isPending = !!pendingSlots[step.slotId];  // V116: Check if pending

            if (!value) {
                return step.ask || step.reprompt || `What is your ${step.slotId}?`;
            }
            
            // ═══════════════════════════════════════════════════════════════════════════
            // V116: PENDING SLOT SKIP
            // ═══════════════════════════════════════════════════════════════════════════
            // If slot is PENDING (extracted during discovery but not confirmed):
            //   - Use it for CONTEXT (S4A already used it in response)
            //   - Skip confirmation during discovery
            //   - Booking will confirm it later
            // 
            // Example: Caller says "Mrs. Johnson, 123 Market St" upfront
            //   Discovery: Uses these for context, doesn't re-ask
            //   Booking: "First name? Last name Johnson? Address 123 Market St correct?"
            // ═══════════════════════════════════════════════════════════════════════════
            if (isPending && !isConfirmed && step.confirmMode !== 'always') {
                logger.info('[DISCOVERY FLOW] V116: Slot is pending - using for context, skipping confirmation until booking', {
                    slotId: step.slotId,
                    value: typeof value === 'string' ? value.substring(0, 30) : value,
                    isPending: true,
                    willConfirmInBooking: true
                });
                
                // Mark as "seen" so we don't ask for it, but don't mark confirmed yet
                // (Booking will handle confirmation)
                continue; // Skip to next step
            }
            
            // ═══════════════════════════════════════════════════════════════════════════
            // REGRESSION GUARD: If S5 complete + name present, skip name confirmation
            // ═══════════════════════════════════════════════════════════════════════════
            // This prevents the bug: after S5 (call reason captured), the agent regresses
            // to "I have Mark. Is that correct?" instead of moving forward.
            // ═══════════════════════════════════════════════════════════════════════════
            const isNameSlot = step.slotId === 'name' || step.slotId === 'name.first' || step.slotId === 'name.last';
            if (isNameSlot && callReasonCaptured && namePresent && !isConfirmed) {
                // Auto-confirm name if call reason is already captured
                // This is safe because S5 wouldn't fire without name being captured first
                logger.info('[DISCOVERY FLOW] Regression guard: auto-confirming name after S5', {
                    slotId: step.slotId,
                    value,
                    callReasonCaptured
                });
                confirmedSlots[step.slotId] = true;
                continue; // Skip to next step
            }
            
            if (!isConfirmed && step.confirmMode !== 'never') {
                const template = step.confirm || step.ask || 'Is {value} correct?';
                return renderSlotTemplateOrFallback({
                    template,
                    slotId: step.slotId,
                    slotValue: value,
                    fallbackText: defaultSlotConfirmFallback(step.slotId, value),
                    context: 'discovery_runner_forced_confirm'
                });
            }
        }

        return null;
    }
    
    /**
     * REGRESSION GUARD: Prevent regression to name confirmation after S5
     * 
     * If the response looks like it's asking for name confirmation ("I have Mark"),
     * but call_reason is already captured, this is a regression.
     * 
     * Actions:
     * 1. Log SECTION_S4_REGRESSION_BLOCKED event
     * 2. Return a forward-looking prompt instead
     */
    static applyRegressionGuard({ company, callSid, response, state }) {
        const callReasonCaptured = !!state?.plainSlots?.call_reason_detail;
        const namePresent = !!state?.plainSlots?.name || !!state?.plainSlots?.['name.first'];
        
        // Only guard if S5 is complete (call reason captured)
        if (!callReasonCaptured || !namePresent) {
            return response;
        }
        
        // Check if response is asking for name confirmation
        const responseText = (response || '').toLowerCase();
        const isNameConfirmation = /i have .{1,30}\.?\s*is that correct/i.test(responseText) ||
                                   /just to confirm.*first name/i.test(responseText) ||
                                   /is .{1,30} correct\??$/i.test(responseText);
        
        // Also check for the specific regression pattern from raw events
        const isRegressionPattern = /i have (mark|[a-z]+)\.\s*is that correct/i.test(responseText);
        
        if (!isNameConfirmation && !isRegressionPattern) {
            return response;
        }
        
        // REGRESSION DETECTED - Block it
        logger.warn('[DISCOVERY FLOW] REGRESSION GUARD TRIGGERED - blocked name re-confirmation after S5', {
            callSid,
            attemptedPrompt: response.substring(0, 80),
            callReasonCaptured,
            namePresent,
            currentSlots: Object.keys(state?.plainSlots || {})
        });
        
        // Emit SECTION_S4_REGRESSION_BLOCKED event
        if (BlackBoxLogger && callSid) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId: company?._id?.toString?.() || null,
                type: 'SECTION_S4_REGRESSION_BLOCKED',
                turn: state?.turnCount || 0,
                data: {
                    attemptedPrompt: response.substring(0, 100),
                    lane: state?.lane || 'DISCOVERY',
                    stepId: state?.discovery?.currentStepId || null,
                    callReasonCaptured: true,
                    nameValue: state?.plainSlots?.name || state?.plainSlots?.['name.first'] || null,
                    severity: 'WARNING'
                }
            }).catch(() => {});
        }
        
        // Return a forward-looking prompt instead
        // Find the next slot that actually needs input
        const steps = [...(company?.aiAgentSettings?.frontDeskBehavior?.discoveryFlow?.steps || [])]
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        
        const plainSlots = state?.plainSlots || {};
        const confirmedSlots = state?.discovery?.confirmedSlots || {};
        
        for (const step of steps) {
            if (!step?.slotId || step.passive === true || step.isPassive === true) {
                continue;
            }
            
            // Skip name-related slots - we just blocked them
            if (step.slotId === 'name' || step.slotId === 'name.first' || step.slotId === 'name.last') {
                continue;
            }
            
            const value = plainSlots[step.slotId];
            const isConfirmed = confirmedSlots[step.slotId] === true;
            
            if (!value) {
                return step.ask || step.reprompt || `What is your ${step.slotId}?`;
            }
            if (!isConfirmed && step.confirmMode !== 'never') {
                const template = step.confirm || step.ask || 'Is {value} correct?';
                return renderSlotTemplateOrFallback({
                    template,
                    slotId: step.slotId,
                    slotValue: value,
                    fallbackText: defaultSlotConfirmFallback(step.slotId, value),
                    context: 'discovery_runner_regression_guard_forward'
                });
            }
        }
        
        // If all slots are done, discovery is complete - return consent prompt
        return "I have all your information. Would you like me to check availability for a service appointment?";
    }

    static sanitizeReply({ company, response, state }) {
        const text = `${response || ''}`;
        if (!hasUnresolvedPlaceholders(text)) {
            return text;
        }

        const steps = [...(company?.aiAgentSettings?.frontDeskBehavior?.discoveryFlow?.steps || [])]
            .sort((a, b) => (a.order || 0) - (b.order || 0));
        const byStepId = new Map(steps.map((s) => [s.stepId, s]));
        const plainSlots = state?.plainSlots || {};

        let slotId = state?.discovery?.pendingConfirmation || state?.discovery?.currentSlotId || null;
        if (!slotId && state?.discovery?.currentStepId) {
            slotId = byStepId.get(state.discovery.currentStepId)?.slotId || null;
        }
        if (!slotId) {
            const firstFilled = steps.find((s) => {
                const v = plainSlots[s.slotId];
                return v != null && `${v}`.trim() !== '';
            });
            slotId = firstFilled?.slotId || 'name.first';
        }

        const slotValue = plainSlots[slotId];
        const fallback = slotValue != null && `${slotValue}`.trim() !== ''
            ? defaultSlotConfirmFallback(slotId, slotValue)
            : 'Let me confirm that one more time. What is your first name?';

        return renderSlotTemplateOrFallback({
            template: text,
            slotId,
            slotValue,
            fallbackText: fallback,
            context: 'discovery_runner_sanitize_reply'
        });
    }
}

module.exports = { DiscoveryFlowRunner };
