const { StepEngine } = require('./StepEngine');

class BookingFlowRunner {
    static run({ company, callSid, userInput, state }) {
        const stepEngine = StepEngine.forCall({ company, callId: callSid });
        const bookingState = {
            currentFlow: 'booking',
            currentStepId: state.booking?.currentStepId || null,
            currentSlotId: state.booking?.currentSlotId || null,
            slotSubStep: state.booking?.slotSubStep || null,
            pendingConfirmation: state.booking?.pendingConfirmation || null,
            pendingFinalConfirmation: state.booking?.pendingFinalConfirmation || false,
            collectedSlots: { ...(state.plainSlots || {}) },
            confirmedSlots: { ...(state.booking?.confirmedSlots || {}) },
            lockedSlots: { ...(state.booking?.lockedSlots || {}) },
            repromptCount: { ...(state.booking?.repromptCount || {}) },
            addressCollected: { ...(state.booking?.addressCollected || {}) }
        };

        const result = stepEngine.runBookingStep({ state: bookingState, userInput });
        const mergedPlainSlots = {
            ...(state.plainSlots || {}),
            ...(result.state?.collectedSlots || {})
        };

        return {
            response: result.reply || '',
            matchSource: 'BOOKING_FLOW_RUNNER',
            complete: result.action === 'COMPLETE',
            state: {
                ...state,
                lane: 'BOOKING',
                plainSlots: mergedPlainSlots,
                booking: {
                    ...state.booking,
                    currentStepId: result.state?.currentStepId || state.booking?.currentStepId || null,
                    currentSlotId: result.state?.currentSlotId || state.booking?.currentSlotId || null,
                    slotSubStep: result.state?.slotSubStep || null,
                    pendingConfirmation: result.state?.pendingConfirmation || null,
                    pendingFinalConfirmation: result.state?.pendingFinalConfirmation === true,
                    confirmedSlots: { ...(result.state?.confirmedSlots || {}) },
                    lockedSlots: { ...(result.state?.lockedSlots || {}) },
                    repromptCount: { ...(result.state?.repromptCount || {}) },
                    addressCollected: { ...(result.state?.addressCollected || {}) },
                    bookingComplete: result.action === 'COMPLETE'
                },
                consent: {
                    pending: false,
                    askedExplicitly: false
                }
            }
        };
    }
}

module.exports = { BookingFlowRunner };
