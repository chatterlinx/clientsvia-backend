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

// ═══════════════════════════════════════════════════════════════════════════
// CRITICAL EVENTS - Must be awaited, never fire-and-forget
// ═══════════════════════════════════════════════════════════════════════════
// These events form the "truth chain" - if ANY of these are missing from
// raw-events, we know the turn didn't complete properly.
// ═══════════════════════════════════════════════════════════════════════════
const CRITICAL_EVENTS = new Set([
    'SECTION_S1_RUNTIME_OWNER',
    'INPUT_TEXT_SELECTED',
    'SECTION_S3_SLOT_EXTRACTION',
    'CORE_RUNTIME_TURN_START',
    'CORE_RUNTIME_OWNER_RESULT',
    'CORE_RUNTIME_ERROR',
    'S3_EXTRACTION_ERROR',
    'S3_MERGE_ERROR'
]);

/**
 * Create an event object for the turn buffer.
 * Events are NOT logged immediately - they're collected and flushed by the route handler.
 */
function createEvent({ callSid, companyId, turn, type, data }) {
    return {
        callId: callSid,
        companyId,
        turn: turn || 0,
        type,
        data,
        isCritical: CRITICAL_EVENTS.has(type),
        ts: new Date().toISOString()
    };
}

class FrontDeskCoreRuntime {
    /**
     * Process a single turn of the conversation.
     * 
     * CRITICAL: This method returns a turnEventBuffer[] that MUST be flushed by the caller.
     * The route handler is responsible for awaiting the flush of critical events.
     * 
     * @returns {Object} { response, state, lane, signals, action, matchSource, turnEventBuffer }
     */
    static processTurn(effectiveConfig, callState, userInput, context = {}) {
        const company = context.company || {};
        const callSid = context.callSid || context.sessionId || null;
        const companyId = context.companyId || company?._id?.toString?.() || null;
        const turn = callState?.turnCount || context.turnCount || 0;

        // ═══════════════════════════════════════════════════════════════════════════
        // TURN EVENT BUFFER - Collected here, flushed by route handler
        // ═══════════════════════════════════════════════════════════════════════════
        // Events are NOT fire-and-forget. They're collected in this buffer.
        // The route handler MUST await flush of critical events before sending TwiML.
        // This guarantees trace continuity - no silent truncation.
        // ═══════════════════════════════════════════════════════════════════════════
        const turnEventBuffer = [];
        
        const bufferEvent = (type, data) => {
            turnEventBuffer.push(createEvent({ callSid, companyId, turn, type, data }));
        };

        // ═══════════════════════════════════════════════════════════════════════════
        // MASTER TRY/CATCH - NO SILENT FAILURES
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
            
            bufferEvent('SECTION_S1_RUNTIME_OWNER', {
                lane: state.lane || 'DISCOVERY',
                sessionMode: state.sessionMode || 'DISCOVERY',
                turnCount: turn
            });
            
            // ═══════════════════════════════════════════════════════════════════════════
            // S2: INPUT TEXT TRUTH
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'S2_INPUT_TEXT_TRUTH';
            const inputText = userInput || '';
            const inputSource = context.inputTextSource || 'speechResult';
            tracer.enter(SECTIONS.S2_INPUT_TEXT_TRUTH, {
                source: inputSource,
                len: inputText.length
            });
            
            bufferEvent('INPUT_TEXT_SELECTED', {
                inputTextSource: inputSource,
                inputTextLength: inputText.length,
                inputTextPreview: inputText.substring(0, 120)
            });
            
            // ═══════════════════════════════════════════════════════════════════════════
            // S3: SLOT EXTRACTION - Use full SlotExtractor (2000+ lines, battle-tested)
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'S3_SLOT_EXTRACTION';
            
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
                bufferEvent('S3_EXTRACTION_ERROR', {
                    error: extractError.message,
                    stack: extractError.stack?.substring(0, 500),
                    inputTextPreview: inputText.substring(0, 80)
                });
                extractedMeta = {};
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
                bufferEvent('S3_MERGE_ERROR', { error: mergeError.message });
                mergedMeta = extractedMeta;
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
            
            bufferEvent('SECTION_S3_SLOT_EXTRACTION', {
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
            });

            bufferEvent('CORE_RUNTIME_TURN_START', {
                lane: state.lane,
                consentPending: state.consent?.pending === true,
                slotCount,
                sectionTrail: tracer.getTrailString()
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
            // CORE_RUNTIME_OWNER_RESULT - MANDATORY CRITICAL EVENT
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'EMIT_RESULT';
            bufferEvent('CORE_RUNTIME_OWNER_RESULT', {
                lane,
                matchSource: ownerResult.matchSource,
                responsePreview: (ownerResult.response || '').substring(0, 120),
                bookingComplete: ownerResult.complete === true,
                sectionTrail: tracer.getTrailString()
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
                matchSource: ownerResult.matchSource,
                turnEventBuffer  // MUST be flushed by route handler
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
            
            bufferEvent('CORE_RUNTIME_ERROR', {
                section: currentSection,
                sectionTrail: tracer?.getTrailString() || 'no-tracer',
                error: error.message,
                stack: error.stack?.substring(0, 500)
            });
            
            // Return graceful fallback with buffer - don't crash the whole call
            return {
                response: "I'm sorry, I didn't quite catch that. Could you repeat?",
                state: state || callState,
                lane: 'DISCOVERY',
                signals: { escalate: false, bookingComplete: false },
                action: 'CONTINUE',
                matchSource: 'CORE_RUNTIME_ERROR_FALLBACK',
                turnEventBuffer  // MUST be flushed by route handler even on error
            };
        }
    }
    
    /**
     * Flush turn event buffer to BlackBox logger.
     * Awaits CRITICAL events, fire-and-forget for non-critical.
     * 
     * @param {Array} turnEventBuffer - Events to flush
     * @returns {Promise<void>}
     */
    static async flushEventBuffer(turnEventBuffer) {
        if (!BlackBoxLogger?.logEvent || !Array.isArray(turnEventBuffer)) {
            return;
        }
        
        const criticalPromises = [];
        
        for (const event of turnEventBuffer) {
            const promise = BlackBoxLogger.logEvent({
                callId: event.callId,
                companyId: event.companyId,
                turn: event.turn,
                type: event.type,
                data: event.data
            });
            
            if (event.isCritical) {
                // CRITICAL events MUST be awaited
                criticalPromises.push(promise.catch(err => {
                    logger.error('[FRONT_DESK_CORE_RUNTIME] Critical event flush failed', {
                        type: event.type,
                        error: err.message
                    });
                }));
            } else {
                // Non-critical events can be fire-and-forget
                promise.catch(() => {});
            }
        }
        
        // Wait for all critical events to persist
        if (criticalPromises.length > 0) {
            await Promise.all(criticalPromises);
        }
    }
}

module.exports = { FrontDeskCoreRuntime, CRITICAL_EVENTS };
