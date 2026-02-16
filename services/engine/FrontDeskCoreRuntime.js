/*
NEW LAW - SPEAKER OWNERSHIP CONTRACT
1) DISCOVERY speaks ONLY through DiscoveryFlowRunner.
2) CONSENT speaks ONLY through ConsentGate.
3) BOOKING speaks ONLY through BookingFlowRunner.
If any other module emits final response text, it is a runtime bug.
*/

const logger = require('../../utils/logger');
const { StateStore } = require('./StateStore');
const { DiscoveryFlowRunner } = require('./DiscoveryFlowRunner');
const { ConsentGate } = require('./ConsentGate');
const { BookingFlowRunner } = require('./BookingFlowRunner');

let BlackBoxLogger = null;
try {
    BlackBoxLogger = require('../BlackBoxLogger');
} catch (err) {
    BlackBoxLogger = null;
}

function emitRawEvent({ callSid, companyId, turn, type, data }) {
    if (!BlackBoxLogger?.logEvent || !callSid) {
        return;
    }
    BlackBoxLogger.logEvent({
        callId: callSid,
        companyId,
        turn: turn || 0,
        type,
        data
    }).catch(() => {});
}

function minimalExtract(userInput = '') {
    const text = (userInput || '').trim();
    if (!text) {
        return {};
    }
    const extracted = {};
    const phone = text.match(/(?:\+?1[\s-]?)?\(?(\d{3})\)?[\s-]?(\d{3})[\s-]?(\d{4})/);
    if (phone) {
        extracted.phone = `${phone[1]}${phone[2]}${phone[3]}`;
    }
    const name = text.match(/\b(?:my name is|i am|i'm)\s+([a-zA-Z]+)(?:\s+([a-zA-Z]+))?/i);
    if (name) {
        extracted['name.first'] = name[1];
        if (name[2]) {
            extracted['name.last'] = name[2];
        }
    }
    if (/\b\d{1,5}\s+[a-z0-9.\- ]{3,}\b/i.test(text)) {
        extracted['address.full'] = text;
    }
    return extracted;
}

class FrontDeskCoreRuntime {
    static processTurn(effectiveConfig, callState, userInput, context = {}) {
        const company = context.company || {};
        const callSid = context.callSid || context.sessionId || null;
        const companyId = context.companyId || company?._id?.toString?.() || null;
        const turn = callState?.turnCount || context.turnCount || 0;

        const state = StateStore.load(callState);
        const fromInput = minimalExtract(userInput);
        state.plainSlots = { ...state.plainSlots, ...fromInput };

        emitRawEvent({
            callSid,
            companyId,
            turn,
            type: 'CORE_RUNTIME_TURN_START',
            data: {
                lane: state.lane,
                consentPending: state.consent.pending === true,
                slotCount: Object.keys(state.plainSlots || {}).length
            }
        });

        let ownerResult;

        if (state.lane === 'BOOKING') {
            ownerResult = BookingFlowRunner.run({ company, callSid, userInput, state });
        } else {
            const consentEval = ConsentGate.evaluate({ company, userInput, state });
            if (consentEval.granted) {
                state.lane = 'BOOKING';
                state.consent.pending = false;
                state.consent.askedExplicitly = false;
                ownerResult = BookingFlowRunner.run({ company, callSid, userInput, state });
            } else if (consentEval.pending) {
                ownerResult = ConsentGate.ask({ company, state });
            } else {
                ownerResult = DiscoveryFlowRunner.run({ company, callSid, userInput, state });
                const nowComplete = DiscoveryFlowRunner.isComplete(company, ownerResult.state?.plainSlots || {});
                if (nowComplete && ownerResult.state?.consent?.pending !== true) {
                    ownerResult = ConsentGate.ask({ company, state: ownerResult.state });
                }
            }
        }

        const persistedState = StateStore.persist(callState, ownerResult.state || state);
        const lane = persistedState.sessionMode === 'BOOKING' ? 'BOOKING' : 'DISCOVERY';

        emitRawEvent({
            callSid,
            companyId,
            turn,
            type: 'CORE_RUNTIME_OWNER_RESULT',
            data: {
                lane,
                matchSource: ownerResult.matchSource,
                responsePreview: (ownerResult.response || '').substring(0, 120),
                bookingComplete: ownerResult.complete === true
            }
        });

        logger.info('[FRONT_DESK_CORE_RUNTIME] owner result', {
            callSid,
            lane,
            matchSource: ownerResult.matchSource,
            bookingComplete: ownerResult.complete === true
        });

        return {
            response: ownerResult.response,
            state: persistedState,
            lane,
            signals: {
                escalate: false,
                bookingComplete: ownerResult.complete === true
            },
            action: ownerResult.complete === true ? 'COMPLETE' : 'CONTINUE',
            matchSource: ownerResult.matchSource
        };
    }
}

module.exports = { FrontDeskCoreRuntime };
