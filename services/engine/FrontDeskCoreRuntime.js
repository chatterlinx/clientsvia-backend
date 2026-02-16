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

        // ═══════════════════════════════════════════════════════════════════════════
        // MASTER TRY/CATCH - NO SILENT FAILURES
        // ═══════════════════════════════════════════════════════════════════════════
        // If ANYTHING crashes, we MUST emit CORE_RUNTIME_ERROR with:
        // - section: which section was executing
        // - sectionTrail: breadcrumb of what completed
        // - error: message and stack
        // This ensures we always know WHERE the failure happened.
        // ═══════════════════════════════════════════════════════════════════════════
        
        let state = null;
        let tracer = null;
        let currentSection = 'INIT';
        
        try {
            state = StateStore.load(callState);
            
            // ═══════════════════════════════════════════════════════════════════════════
            // S1: RUNTIME OWNERSHIP
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'S1_RUNTIME_OWNER';
            tracer = SectionTracer.forCall(state, callSid, companyId);
            tracer.enter(SECTIONS.S1_RUNTIME_OWNER, {
                lane: state.lane || 'DISCOVERY'
            });
            
            // Emit S1 as explicit event (not just embedded in trail)
            emitRawEvent({
                callSid,
                companyId,
                turn,
                type: 'SECTION_S1_RUNTIME_OWNER',
                data: {
                    lane: state.lane || 'DISCOVERY',
                    sessionMode: state.sessionMode || 'DISCOVERY',
                    turnCount: turn
                }
            });
            
            // ═══════════════════════════════════════════════════════════════════════════
            // S2: INPUT TEXT TRUTH
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'S2_INPUT_TEXT_TRUTH';
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
            currentSection = 'S3_SLOT_EXTRACTION';
            
            // extractAll() returns slot METADATA objects: { name: { value: 'Mark', confidence: 0.9, ... } }
            let extractedMeta = {};
            try {
                extractedMeta = SlotExtractor.extractAll(inputText, {
                    callId: callSid,
                    companyId: companyId,
                    company: company,
                    callerPhone: context.callerPhone,
                    existingSlots: state.plainSlots || {},
                    confirmedSlots: state.discovery?.confirmedSlots || {},
                    slotMeta: state.slotMeta || {},
                    turnCount: turn,
                    currentBookingStep: null,
                    sessionMode: state.sessionMode || 'DISCOVERY'
                }) || {};
            } catch (extractError) {
                logger.error('[FRONT_DESK_CORE_RUNTIME] S3 extractAll FAILED', {
                    callSid,
                    error: extractError.message,
                    stack: extractError.stack?.substring(0, 500)
                });
                emitRawEvent({
                    callSid,
                    companyId,
                    turn,
                    type: 'S3_EXTRACTION_ERROR',
                    data: {
                        error: extractError.message,
                        stack: extractError.stack?.substring(0, 500),
                        inputTextPreview: inputText.substring(0, 80)
                    }
                });
                extractedMeta = {}; // Continue with empty extraction
            }
            
            // Merge metadata using SlotExtractor's canonical merge rules
            let mergedMeta = {};
            try {
                const existingMeta = state.slotMeta || {};
                mergedMeta = SlotExtractor.mergeSlots(existingMeta, extractedMeta) || {};
                state.slotMeta = mergedMeta;
            } catch (mergeError) {
                logger.error('[FRONT_DESK_CORE_RUNTIME] S3 mergeSlots FAILED', {
                    callSid,
                    error: mergeError.message
                });
                emitRawEvent({
                    callSid,
                    companyId,
                    turn,
                    type: 'S3_MERGE_ERROR',
                    data: { error: mergeError.message }
                });
                mergedMeta = extractedMeta; // Fallback to just extracted
            }
            
            // Convert merged metadata to plain values for plainSlots
            let plainValues = {};
            try {
                plainValues = SlotExtractor.getSlotValues(mergedMeta) || {};
            } catch (valuesError) {
                logger.error('[FRONT_DESK_CORE_RUNTIME] S3 getSlotValues FAILED', {
                    callSid,
                    error: valuesError.message
                });
                plainValues = {};
            }
            state.plainSlots = { ...state.plainSlots, ...plainValues };
            
            const slotCount = Object.keys(state.plainSlots || {}).length;
            const extractedKeys = Object.keys(extractedMeta || {});
            
            tracer.enter(SECTIONS.S3_SLOT_EXTRACTION, {
                name: extractedMeta.name ? '1' : '0',
                phone: extractedMeta.phone ? '1' : '0',
                address: extractedMeta.address ? '1' : '0'
            });
            
            // Emit S3 as explicit event with full details
            emitRawEvent({
                callSid,
                companyId,
                turn,
                type: 'SECTION_S3_SLOT_EXTRACTION',
                data: {
                    slotCount,
                    slotsPresent: {
                        name: !!state.plainSlots.name,
                        phone: !!state.plainSlots.phone,
                        address: !!state.plainSlots.address
                    },
                    extractedThisTurn: extractedKeys,
                    nameValuePreview: state.plainSlots.name ? String(state.plainSlots.name).substring(0, 20) : null,
                    nameConfidence: extractedMeta.name?.confidence || null,
                    namePatternSource: extractedMeta.name?.patternSource || null,
                    sectionTrail: tracer.getTrailString()
                }
            });

            emitRawEvent({
                callSid,
                companyId,
                turn,
                type: 'CORE_RUNTIME_TURN_START',
                data: {
                    lane: state.lane,
                    consentPending: state.consent?.pending === true,
                    slotCount,
                    sectionTrail: tracer.getTrailString()
                }
            });

            // ═══════════════════════════════════════════════════════════════════════════
            // S4: DISCOVERY STEP ENGINE or S5: CONSENT GATE or S6: BOOKING FLOW
            // ═══════════════════════════════════════════════════════════════════════════
            let ownerResult;
            
            if (state.lane === 'BOOKING') {
                currentSection = 'S6_BOOKING_FLOW';
                tracer.enter(SECTIONS.S6_BOOKING_FLOW);
                ownerResult = BookingFlowRunner.run({ company, callSid, userInput, state });
            } else {
                currentSection = 'S5_CONSENT_GATE_EVAL';
                const consentEval = ConsentGate.evaluate({ company, userInput, state });
                
                if (consentEval.granted) {
                    currentSection = 'S5_CONSENT_GRANTED';
                    tracer.enter(SECTIONS.S5_CONSENT_GATE, { granted: '1' });
                    state.lane = 'BOOKING';
                    state.consent.pending = false;
                    state.consent.askedExplicitly = false;
                    currentSection = 'S6_BOOKING_FLOW';
                    tracer.enter(SECTIONS.S6_BOOKING_FLOW);
                    ownerResult = BookingFlowRunner.run({ company, callSid, userInput, state });
                } else if (consentEval.pending) {
                    currentSection = 'S5_CONSENT_PENDING';
                    tracer.enter(SECTIONS.S5_CONSENT_GATE, { pending: '1' });
                    ownerResult = ConsentGate.ask({ company, state });
                } else {
                    currentSection = 'S4_DISCOVERY_STEP_ENGINE';
                    tracer.enter(SECTIONS.S4_DISCOVERY_STEP_ENGINE);
                    ownerResult = DiscoveryFlowRunner.run({ company, callSid, userInput, state });
                    const nowComplete = DiscoveryFlowRunner.isComplete(company, ownerResult.state?.plainSlots || {});
                    if (nowComplete && ownerResult.state?.consent?.pending !== true) {
                        currentSection = 'S5_CONSENT_AFTER_DISCOVERY';
                        tracer.enter(SECTIONS.S5_CONSENT_GATE, { askAfterDiscovery: '1' });
                        ownerResult = ConsentGate.ask({ company, state: ownerResult.state });
                    }
                }
            }

            currentSection = 'PERSIST_STATE';
            const persistedState = StateStore.persist(callState, ownerResult.state || state);
            const lane = persistedState.sessionMode === 'BOOKING' ? 'BOOKING' : 'DISCOVERY';

            // ═══════════════════════════════════════════════════════════════════════════
            // EMIT CORE_RUNTIME_OWNER_RESULT - MANDATORY
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'EMIT_RESULT';
            emitRawEvent({
                callSid,
                companyId,
                turn,
                type: 'CORE_RUNTIME_OWNER_RESULT',
                data: {
                    lane,
                    matchSource: ownerResult.matchSource,
                    responsePreview: (ownerResult.response || '').substring(0, 120),
                    bookingComplete: ownerResult.complete === true,
                    sectionTrail: tracer.getTrailString()
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
            
        } catch (error) {
            // ═══════════════════════════════════════════════════════════════════════════
            // CRITICAL: NEVER SILENT FAIL - ALWAYS EMIT CORE_RUNTIME_ERROR
            // ═══════════════════════════════════════════════════════════════════════════
            logger.error('[FRONT_DESK_CORE_RUNTIME] CRASH in processTurn', {
                callSid,
                companyId,
                turn,
                section: currentSection,
                error: error.message,
                stack: error.stack?.substring(0, 800)
            });
            
            emitRawEvent({
                callSid,
                companyId,
                turn,
                type: 'CORE_RUNTIME_ERROR',
                data: {
                    section: currentSection,
                    sectionTrail: tracer?.getTrailString() || 'no-tracer',
                    error: error.message,
                    stack: error.stack?.substring(0, 500)
                }
            });
            
            // Return graceful fallback - don't crash the whole call
            return {
                response: "I'm sorry, I didn't quite catch that. Could you repeat?",
                state: state || callState,
                lane: 'DISCOVERY',
                signals: { escalate: false, bookingComplete: false },
                action: 'CONTINUE',
                matchSource: 'CORE_RUNTIME_ERROR_FALLBACK'
            };
        }
    }
}

module.exports = { FrontDeskCoreRuntime };
