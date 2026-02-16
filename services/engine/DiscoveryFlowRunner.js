const { StepEngine } = require('./StepEngine');
const {
    renderSlotTemplateOrFallback,
    defaultSlotConfirmFallback,
    hasUnresolvedPlaceholders
} = require('./TemplateRenderer');

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

        if (result.reply) {
            const response = DiscoveryFlowRunner.sanitizeReply({
                company,
                response: result.reply,
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
            next.discovery?.confirmedSlots || {}
        );

        if (!forcedPrompt) {
            throw new Error('DiscoveryFlowRunner produced no reply and no deterministic fallback prompt');
        }

        return {
            response: DiscoveryFlowRunner.sanitizeReply({
                company,
                response: forcedPrompt,
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

    static buildDeterministicPrompt(company, plainSlots = {}, confirmedSlots = {}) {
        const steps = [...(company?.aiAgentSettings?.frontDeskBehavior?.discoveryFlow?.steps || [])]
            .sort((a, b) => (a.order || 0) - (b.order || 0));

        for (const step of steps) {
            if (!step?.slotId || step.passive === true || step.isPassive === true) {
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
                    context: 'discovery_runner_forced_confirm'
                });
            }
        }

        return null;
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
