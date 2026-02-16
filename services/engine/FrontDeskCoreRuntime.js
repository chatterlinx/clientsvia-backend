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
const { SectionTracer, SECTIONS } = require('./SectionTracer');

// S3: SLOT EXTRACTION - Use full battle-tested SlotExtractor (not minimal)
const SlotExtractor = require('./booking/SlotExtractor');

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

class FrontDeskCoreRuntime {
    static processTurn(effectiveConfig, callState, userInput, context = {}) {
        const company = context.company || {};
        const callSid = context.callSid || context.sessionId || null;
        const companyId = context.companyId || company?._id?.toString?.() || null;
        const turn = callState?.turnCount || context.turnCount || 0;

        const state = StateStore.load(callState);
        
        // ═══════════════════════════════════════════════════════════════════════════
        // S1: RUNTIME OWNERSHIP
        // ═══════════════════════════════════════════════════════════════════════════
        const tracer = SectionTracer.forCall(state, callSid, companyId);
        tracer.enter(SECTIONS.S1_RUNTIME_OWNER, {
            lane: state.lane || 'DISCOVERY'
        });
        
        // ═══════════════════════════════════════════════════════════════════════════
        // S2: INPUT TEXT TRUTH
        // ═══════════════════════════════════════════════════════════════════════════
        const inputText = userInput || '';
        const inputSource = 'speechResult'; // Will be enhanced later with partialCache fallback
        tracer.enter(SECTIONS.S2_INPUT_TEXT_TRUTH, {
            source: inputSource,
            len: inputText.length
        });
        
        tracer.emit('INPUT_TEXT_SELECTED', {
            inputTextSource: inputSource,
            inputTextLength: inputText.length,
            inputTextPreview: inputText.substring(0, 120)
        });
        
        // ═══════════════════════════════════════════════════════════════════════════
        // S3: SLOT EXTRACTION - Use full SlotExtractor (2000+ lines, battle-tested)
        // ═══════════════════════════════════════════════════════════════════════════
        const fromInput = SlotExtractor.extract(inputText, {
            callId: callSid,
            companyId: companyId,
            company: company,
            callerPhone: context.callerPhone,
            slots: state.plainSlots || {},
            confirmedSlots: state.discovery?.confirmedSlots || {},
            slotMeta: state.slotMeta || {},
            turnCount: turn,
            currentBookingStep: null,
            sessionMode: state.sessionMode || 'DISCOVERY'
        });
        
        // Merge extracted slots into state
        state.plainSlots = { ...state.plainSlots, ...fromInput };
        
        const slotCount = Object.keys(state.plainSlots || {}).length;
        tracer.enter(SECTIONS.S3_SLOT_EXTRACTION, {
            name: fromInput.name ? '1' : '0',
            phone: fromInput.phone ? '1' : '0',
            address: fromInput.address ? '1' : '0'
        });
        
        tracer.emit('SLOTS_EXTRACTED', {
            slotCount,
            slotsPresent: {
                name: !!state.plainSlots.name,
                phone: !!state.plainSlots.phone,
                address: !!state.plainSlots.address
            },
            extractedThisTurn: Object.keys(fromInput),
            nameValuePreview: fromInput.name ? String(fromInput.name).substring(0, 20) : null
        });

        emitRawEvent({
            callSid,
            companyId,
            turn,
            type: 'CORE_RUNTIME_TURN_START',
            data: {
                lane: state.lane,
                consentPending: state.consent.pending === true,
                slotCount,
                sectionTrail: tracer.getTrailString()
            }
        });

        let ownerResult;

        // ═══════════════════════════════════════════════════════════════════════════
        // S4: DISCOVERY STEP ENGINE or S5: CONSENT GATE or S6: BOOKING FLOW
        // ═══════════════════════════════════════════════════════════════════════════
        if (state.lane === 'BOOKING') {
            tracer.enter(SECTIONS.S6_BOOKING_FLOW);
            ownerResult = BookingFlowRunner.run({ company, callSid, userInput, state });
        } else {
            const consentEval = ConsentGate.evaluate({ company, userInput, state });
            if (consentEval.granted) {
                tracer.enter(SECTIONS.S5_CONSENT_GATE, { granted: '1' });
                state.lane = 'BOOKING';
                state.consent.pending = false;
                state.consent.askedExplicitly = false;
                tracer.enter(SECTIONS.S6_BOOKING_FLOW);
                ownerResult = BookingFlowRunner.run({ company, callSid, userInput, state });
            } else if (consentEval.pending) {
                tracer.enter(SECTIONS.S5_CONSENT_GATE, { pending: '1' });
                ownerResult = ConsentGate.ask({ company, state });
            } else {
                tracer.enter(SECTIONS.S4_DISCOVERY_STEP_ENGINE);
                ownerResult = DiscoveryFlowRunner.run({ company, callSid, userInput, state });
                const nowComplete = DiscoveryFlowRunner.isComplete(company, ownerResult.state?.plainSlots || {});
                if (nowComplete && ownerResult.state?.consent?.pending !== true) {
                    tracer.enter(SECTIONS.S5_CONSENT_GATE, { askAfterDiscovery: '1' });
                    ownerResult = ConsentGate.ask({ company, state: ownerResult.state });
                }
            }
        }

        const persistedState = StateStore.persist(callState, ownerResult.state || state);
        const lane = persistedState.sessionMode === 'BOOKING' ? 'BOOKING' : 'DISCOVERY';

        tracer.emit('CORE_RUNTIME_OWNER_RESULT', {
            lane,
            matchSource: ownerResult.matchSource,
            responsePreview: (ownerResult.response || '').substring(0, 120),
            bookingComplete: ownerResult.complete === true
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
