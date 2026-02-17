const { StepEngine } = require('./StepEngine');
const {
    renderSlotTemplateOrFallback,
    defaultSlotConfirmFallback,
    hasUnresolvedPlaceholders
} = require('./TemplateRenderer');
const logger = require('../../utils/logger');

function defaultDiscoveryMissingPrompt(slotId) {
    const id = `${slotId || ''}`.toLowerCase();
    if (id === 'name' || id === 'name.first') {
        return "What's your first name?";
    }
    if (id === 'name.last' || id === 'lastname') {
        return "What's your last name?";
    }
    if (id === 'phone') {
        return "What's the best number to reach you?";
    }
    if (id === 'address' || id === 'address.full') {
        return "What's the service address?";
    }
    if (id === 'call_reason_detail') {
        return 'What can I help you with today?';
    }
    return `What is your ${slotId}?`;
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
    /**
     * ============================================================================
     * S4 — DISCOVERY FLOW (SECTIONED, LOCKABLE)
     * ============================================================================
     * This runner is intentionally split into explicit sub-sections so we can
     * stabilize each one independently without disturbing others.
     *
     * Contract:
     * - DiscoveryFlowRunner is the ONLY discovery speaker.
     * - Emits SECTION_S4_* events when emitEvent is provided (preferred).
     * - No other modules should modify discovery state pointers.
     */
    static run({ company, callSid, userInput, state, emitEvent = null, turn = null }) {
        const emit = (type, data) => {
            try {
                if (typeof emitEvent === 'function') {
                    emitEvent(type, data);
                    return;
                }
            } catch (_err) {
                // Never let observability break discovery.
            }
        };

        const safePreview = (text, n) => `${text || ''}`.substring(0, n);

        // ───────────────────────────────────────────────────────────────────
        // S4.0 — Start + input snapshot
        // ───────────────────────────────────────────────────────────────────
        emit('SECTION_S4_0_DISCOVERY_START', {
            turn: typeof turn === 'number' ? turn : null,
            inputLength: `${userInput || ''}`.length,
            inputPreview: safePreview(userInput, 120),
            lane: state?.lane || 'DISCOVERY'
        });

        const stepEngine = StepEngine.forCall({ company, callId: callSid });

        // ───────────────────────────────────────────────────────────────────
        // S4.1 — Build engine state (inputs to StepEngine)
        // ───────────────────────────────────────────────────────────────────
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
        emit('SECTION_S4_1_ENGINE_STATE_BUILT', {
            currentStepId: discoveryState.currentStepId,
            currentSlotId: discoveryState.currentSlotId,
            pendingConfirmation: discoveryState.pendingConfirmation,
            collectedSlotKeys: Object.keys(discoveryState.collectedSlots || {}),
            confirmedSlotKeys: Object.keys(discoveryState.confirmedSlots || {}),
            repromptKeys: Object.keys(discoveryState.repromptCount || {})
        });

        // ───────────────────────────────────────────────────────────────────
        // S4.2 — StepEngine execution
        // ───────────────────────────────────────────────────────────────────
        const result = stepEngine.runDiscoveryStep({
            state: discoveryState,
            userInput,
            extractedSlots: { ...(state.plainSlots || {}) }
        });
        emit('SECTION_S4_2_STEP_ENGINE_RESULT', {
            replyPresent: !!result?.reply,
            replyPreview: safePreview(result?.reply, 120),
            stepId: result?.state?.currentStepId || null,
            slotId: result?.state?.currentSlotId || null,
            pendingConfirmation: result?.state?.pendingConfirmation || null,
            discoveryComplete: result?.discoveryComplete === true,
            debug: result?.debug || null
        });

        // ───────────────────────────────────────────────────────────────────
        // S4.3 — Merge collected slots back into plainSlots truth
        // ───────────────────────────────────────────────────────────────────
        const nextPlainSlots = {
            ...(state.plainSlots || {}),
            ...(result.state?.collectedSlots || {})
        };
        emit('SECTION_S4_3_PLAIN_SLOTS_MERGED', {
            mergedKeys: Object.keys(result.state?.collectedSlots || {}),
            plainSlotKeys: Object.keys(nextPlainSlots || {}),
            hasCallReason: !!nextPlainSlots.call_reason_detail,
            hasName: !!nextPlainSlots.name || !!nextPlainSlots['name.first'],
            hasAddress: !!nextPlainSlots.address
        });

        // ───────────────────────────────────────────────────────────────────
        // S4.4 — Persist discovery pointers into shared state
        // ───────────────────────────────────────────────────────────────────
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
                confirmedSlots: { ...(result.state?.confirmedSlots || {}) },
                complete: result?.discoveryComplete === true
            },
            booking: {
                ...state.booking,
                confirmedSlots: { ...(result.state?.confirmedSlots || state.booking?.confirmedSlots || {}) }
            }
        };
        DiscoveryFlowRunner.ensureDiscoveryStepPointers(company, next);
        emit('SECTION_S4_4_POINTERS_ENSURED', {
            currentStepId: next?.discovery?.currentStepId || null,
            currentSlotId: next?.discovery?.currentSlotId || null,
            pendingConfirmation: next?.discovery?.pendingConfirmation || null
        });

        // ───────────────────────────────────────────────────────────────────
        // S4.4B — Discovery complete marker (no prompt should be emitted here)
        // ───────────────────────────────────────────────────────────────────
        // When discovery is complete, we return a sentinel matchSource so the
        // orchestrator can ask the booking consent question (S5) deterministically.
        if (result?.discoveryComplete === true && !result?.reply) {
            emit('SECTION_S4_4B_DISCOVERY_COMPLETE', {
                stepId: next?.discovery?.currentStepId || null,
                slotId: next?.discovery?.currentSlotId || null,
                plainSlotKeys: Object.keys(next?.plainSlots || {}),
                confirmedSlotKeys: Object.keys(next?.discovery?.confirmedSlots || {})
            });
            emit('SECTION_S4_7_DISCOVERY_END', {
                matchSource: 'DISCOVERY_FLOW_COMPLETE',
                stepId: next?.discovery?.currentStepId || null,
                slotId: next?.discovery?.currentSlotId || null
            });
            return {
                response: null,
                matchSource: 'DISCOVERY_FLOW_COMPLETE',
                state: next
            };
        }

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
            emit('SECTION_S4_5_REGRESSION_GUARD_APPLIED', {
                source: 'step_engine_reply',
                changed: guardedReply !== result.reply,
                guardedPreview: safePreview(guardedReply, 120)
            });
            
            const response = DiscoveryFlowRunner.sanitizeReply({
                company,
                response: guardedReply,
                state: next
            });
            emit('SECTION_S4_6_REPLY_SANITIZED', {
                hadPlaceholders: hasUnresolvedPlaceholders(guardedReply),
                finalPreview: safePreview(response, 160)
            });
            emit('SECTION_S4_7_DISCOVERY_END', {
                matchSource: 'DISCOVERY_FLOW_RUNNER',
                stepId: next?.discovery?.currentStepId || null,
                slotId: next?.discovery?.currentSlotId || null
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
        emit('SECTION_S4_2B_FORCED_PROMPT_SELECTED', {
            forcedPromptPresent: !!forcedPrompt,
            forcedPromptPreview: safePreview(forcedPrompt, 120)
        });

        if (!forcedPrompt) {
            // V117b: Never crash the call because a deterministic prompt was null.
            // Fall back to a safe, slot-specific missing prompt.
            const fallbackSlotId = next?.discovery?.currentSlotId || next?.discovery?.pendingConfirmation || 'call_reason_detail';
            const safeFallback = defaultDiscoveryMissingPrompt(fallbackSlotId);
            emit('SECTION_S4_FALLBACK_SAFE_PROMPT_USED', {
                slotId: fallbackSlotId,
                responsePreview: safePreview(safeFallback, 120),
                reason: 'FORCED_PROMPT_NULL'
            });
            return {
                response: safeFallback,
                matchSource: 'DISCOVERY_FLOW_RUNNER',
                state: next
            };
        }

        // Apply regression guard to forced prompt too
        const guardedPrompt = DiscoveryFlowRunner.applyRegressionGuard({
            company,
            callSid,
            response: forcedPrompt,
            state: next
        });
        emit('SECTION_S4_5_REGRESSION_GUARD_APPLIED', {
            source: 'forced_prompt',
            changed: guardedPrompt !== forcedPrompt,
            guardedPreview: safePreview(guardedPrompt, 120)
        });

        const sanitized = DiscoveryFlowRunner.sanitizeReply({
            company,
            response: guardedPrompt,
            state: next
        });
        emit('SECTION_S4_6_REPLY_SANITIZED', {
            hadPlaceholders: hasUnresolvedPlaceholders(guardedPrompt),
            finalPreview: safePreview(sanitized, 160)
        });
        emit('SECTION_S4_7_DISCOVERY_END', {
            matchSource: 'DISCOVERY_FLOW_RUNNER',
            stepId: next?.discovery?.currentStepId || null,
            slotId: next?.discovery?.currentSlotId || null
        });

        return {
            response: sanitized,
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
                // V117: Missing-value prompts must not rely on {value}. Prefer askMissing/repromptMissing.
                let prompt = step.askMissing || step.repromptMissing || step.reprompt || step.ask;
                if (!prompt || hasUnresolvedPlaceholders(prompt)) {
                    prompt = step.repromptMissing || defaultDiscoveryMissingPrompt(step.slotId) || step.reprompt;
                }
                return prompt;
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
            
            // NOTE (V117b): Never auto-confirm name based on call reason presence.
            // That caused "random skipping" on turn 1 when call_reason_detail is captured early.
            
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
        const confirmed = state?.discovery?.confirmedSlots || {};
        const nameAlreadyConfirmed = confirmed.name === true || confirmed['name.first'] === true;
        const pendingConfirmation = state?.discovery?.pendingConfirmation || null;
        
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
        
        // V117b: Only treat it as regression if name is ALREADY confirmed and we're not
        // currently awaiting name confirmation. Otherwise this is normal early discovery.
        const isNamePending = pendingConfirmation === 'name' || pendingConfirmation === 'name.first' || pendingConfirmation === 'name.last';
        if (!nameAlreadyConfirmed || isNamePending) {
            return response;
        }

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
        
        // NOTE (V117b clean sweep): Do not emit out-of-band BlackBoxLogger events from here.
        // DiscoveryFlowRunner already emits ordered SECTION_S4_* events via emitEvent.
        
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
                let prompt = step.askMissing || step.repromptMissing || step.reprompt || step.ask;
                if (!prompt || hasUnresolvedPlaceholders(prompt)) {
                    prompt = step.repromptMissing || defaultDiscoveryMissingPrompt(step.slotId) || step.reprompt;
                }
                return prompt;
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
