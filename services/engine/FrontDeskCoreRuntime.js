/**
 * ============================================================================
 * FRONT DESK CORE RUNTIME - V110 Clean Sweep
 * ============================================================================
 * 
 * SPEAKER OWNERSHIP CONTRACT (THE LAW):
 * 1) GREETING speaks through GreetingInterceptor (instant, no LLM)
 * 2) DISCOVERY speaks through DiscoveryFlowRunner
 * 3) CONSENT speaks through ConsentGate
 * 4) BOOKING speaks through BookingFlowRunner
 * 
 * If any other module emits final response text, it is a runtime bug.
 * 
 * SECTION MAP (S1-S7):
 * S1 - Runtime Ownership (lane/mode)
 * S2 - Input Text Truth (speechResult vs cache)
 * S3 - Slot Extraction (name/phone/address)
 * S4 - Discovery Engine (step progression)
 * S5 - Call Reason Capture (call_reason_detail)
 * S6 - Consent & Lane Transition
 * S7 - Voice Provider (ElevenLabs/Twilio)
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');
const { StateStore } = require('./StateStore');
const { DiscoveryFlowRunner } = require('./DiscoveryFlowRunner');
const { ConsentGate } = require('./ConsentGate');
const BookingFlowRunner = require('./booking/BookingFlowRunner');
const { SectionTracer, SECTIONS } = require('./SectionTracer');
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
const CRITICAL_EVENTS = new Set([
    'SECTION_S1_RUNTIME_OWNER',
    'INPUT_TEXT_SELECTED',
    'SECTION_S3_SLOT_EXTRACTION',
    'GREETING_INTERCEPTED',
    'CORE_RUNTIME_TURN_START',
    'CORE_RUNTIME_OWNER_RESULT',
    'CORE_RUNTIME_ERROR',
    'S3_EXTRACTION_ERROR',
    'S3_MERGE_ERROR'
]);

// ═══════════════════════════════════════════════════════════════════════════
// GREETING INTERCEPTOR
// ═══════════════════════════════════════════════════════════════════════════
// Handles instant responses to simple greetings like "good morning", "hi", etc.
// These come from the Personality tab's Greeting Responses configuration.
// Intercepted BEFORE Discovery Flow runs - saves LLM calls and is instant.
// ═══════════════════════════════════════════════════════════════════════════
const GreetingInterceptor = {
    /**
     * Fuzzy patterns for common greetings (used when fuzzy=true in UI config)
     */
    fuzzyPatterns: {
        'good morning': /^(good\s*morning|morning|gm)\b/i,
        'morning': /^(good\s*morning|morning|gm)\b/i,
        'good afternoon': /^(good\s*afternoon|afternoon)\b/i,
        'afternoon': /^(good\s*afternoon|afternoon)\b/i,
        'good evening': /^(good\s*evening|evening)\b/i,
        'evening': /^(good\s*evening|evening)\b/i,
        'hi': /^(hi|hello|hey|howdy|yo|sup|what'?s\s*up|greetings?)\b/i,
        'hello': /^(hi|hello|hey|howdy|yo|sup|what'?s\s*up|greetings?)\b/i,
        'hey': /^(hi|hello|hey|howdy|yo|sup|what'?s\s*up|greetings?)\b/i
    },
    
    /**
     * Filler prefixes to strip before checking for greeting
     * "yes, good morning" → "good morning"
     */
    FILLER_PREFIXES: /^(yes|yeah|yep|yup|uh|um|uh\s*huh|ok|okay|sure|well|so|right|alright|,|\s)+/i,
    
    /**
     * Check if text is JUST a greeting (not "hi I need help with my AC")
     */
    isShortGreeting(text) {
        const cleaned = text.toLowerCase().replace(this.FILLER_PREFIXES, '').trim();
        const isShort = cleaned.length < 40;
        const startsWithGreeting = /^(good\s*(morning|afternoon|evening)|hi|hello|hey|howdy|yo|sup|what'?s\s*up|greetings?|morning|afternoon|evening|gm)\b/i.test(cleaned);
        return isShort && startsWithGreeting;
    },
    
    /**
     * Try to intercept a greeting and return instant response
     * 
     * @param {string} userText - The user's input
     * @param {Object} company - Company config with greetingRules
     * @param {Object} state - Call state
     * @returns {Object|null} { response, matchedTrigger, matchType } or null if not a greeting
     */
    tryIntercept(userText, company, state) {
        if (!userText) return null;
        
        const userTextLower = userText.toLowerCase().trim();
        
        // Skip if this isn't a short greeting-like message
        if (!this.isShortGreeting(userText)) {
            return null;
        }
        
        // Skip if we've already greeted (existing session beyond turn 1)
        const hasExistingSession = (state?.turnCount || 0) > 1;
        if (hasExistingSession) {
            return null;
        }
        
        // Get greeting rules from company config (Personality tab)
        const greetingRules = company?.aiAgentSettings?.frontDeskBehavior?.conversationStages?.greetingRules || [];
        
        if (greetingRules.length === 0) {
            return null;
        }
        
        // Sort rules by trigger length (longest first) to prioritize specific matches
        // "hi good afternoon" → should match "good afternoon" not "hi"
        const sortedRules = [...greetingRules].sort((a, b) => 
            (b.trigger?.length || 0) - (a.trigger?.length || 0)
        );
        
        for (const rule of sortedRules) {
            if (!rule.trigger || !rule.response) continue;
            
            const trigger = rule.trigger.toLowerCase().trim();
            
            if (rule.fuzzy) {
                // Fuzzy matching - use pattern if available, otherwise contains check
                const pattern = this.fuzzyPatterns[trigger];
                if (pattern && pattern.test(userTextLower)) {
                    return {
                        response: rule.response,
                        matchedTrigger: trigger,
                        matchType: 'fuzzy-pattern'
                    };
                } else if (userTextLower.includes(trigger)) {
                    return {
                        response: rule.response,
                        matchedTrigger: trigger,
                        matchType: 'fuzzy-contains'
                    };
                }
            } else {
                // EXACT matching - trigger must appear as whole phrase
                const exactPattern = new RegExp(`\\b${trigger.replace(/\s+/g, '\\s+')}\\b`, 'i');
                if (exactPattern.test(userTextLower)) {
                    return {
                        response: rule.response,
                        matchedTrigger: trigger,
                        matchType: 'exact-phrase'
                    };
                }
            }
        }
        
        return null;
    }
};

/**
 * Create an event object for the turn buffer.
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
     * EXECUTION ORDER:
     * 1. S1: Runtime Ownership (set lane)
     * 2. S2: Input Text Truth (log what text we got)
     * 3. GREETING CHECK: Intercept "good morning" etc. BEFORE extraction
     * 4. S3: Slot Extraction (name/phone/address)
     * 5. S4/S5/S6: Discovery → Consent → Booking flow
     * 
     * @returns {Object} { response, state, lane, signals, action, matchSource, turnEventBuffer }
     */
    static processTurn(effectiveConfig, callState, userInput, context = {}) {
        const company = context.company || {};
        const callSid = context.callSid || context.sessionId || null;
        const companyId = context.companyId || company?._id?.toString?.() || null;
        const turn = callState?.turnCount || context.turnCount || 0;

        // ═══════════════════════════════════════════════════════════════════════════
        // TURN EVENT BUFFER
        // ═══════════════════════════════════════════════════════════════════════════
        const turnEventBuffer = [];
        
        const bufferEvent = (type, data) => {
            turnEventBuffer.push(createEvent({ callSid, companyId, turn, type, data }));
        };

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
            // GREETING INTERCEPT - CHECK BEFORE SLOT EXTRACTION
            // ═══════════════════════════════════════════════════════════════════════════
            // This handles instant responses from Personality tab:
            // "good morning" → "Good morning! How can I help you today?"
            // Must happen BEFORE we run SlotExtractor or Discovery.
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'GREETING_INTERCEPT';
            const greetingMatch = GreetingInterceptor.tryIntercept(inputText, company, state);
            
            if (greetingMatch) {
                // Log the intercept
                bufferEvent('GREETING_INTERCEPTED', {
                    matchedTrigger: greetingMatch.matchedTrigger,
                    matchType: greetingMatch.matchType,
                    responsePreview: greetingMatch.response.substring(0, 80),
                    sectionTrail: tracer.getTrailString()
                });
                
                logger.info('[FRONT_DESK_CORE_RUNTIME] Greeting intercepted', {
                    callSid,
                    trigger: greetingMatch.matchedTrigger,
                    matchType: greetingMatch.matchType
                });
                
                // Return immediately - no need for Discovery Flow
                return {
                    response: greetingMatch.response,
                    state: state,
                    lane: 'DISCOVERY',
                    signals: { escalate: false, bookingComplete: false },
                    action: 'CONTINUE',
                    matchSource: 'GREETING_INTERCEPTOR',
                    turnEventBuffer
                };
            }
            
            // ═══════════════════════════════════════════════════════════════════════════
            // S3: SLOT EXTRACTION
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
            // S4/S5/S6: DISCOVERY → CONSENT → BOOKING
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
                    tracer.enter(SECTIONS.S4_DISCOVERY_ENGINE);
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
                turnEventBuffer
            };
            
        } catch (error) {
            // ═══════════════════════════════════════════════════════════════════════════
            // CRITICAL: NEVER SILENT FAIL
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
            
            return {
                response: "I'm sorry, I didn't quite catch that. Could you repeat?",
                state: state || callState,
                lane: 'DISCOVERY',
                signals: { escalate: false, bookingComplete: false },
                action: 'CONTINUE',
                matchSource: 'CORE_RUNTIME_ERROR_FALLBACK',
                turnEventBuffer
            };
        }
    }
    
    /**
     * Flush turn event buffer to BlackBox logger.
     * Awaits CRITICAL events, fire-and-forget for non-critical.
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
                criticalPromises.push(promise.catch(err => {
                    logger.error('[FRONT_DESK_CORE_RUNTIME] Critical event flush failed', {
                        type: event.type,
                        error: err.message
                    });
                }));
            } else {
                promise.catch(() => {});
            }
        }
        
        if (criticalPromises.length > 0) {
            await Promise.all(criticalPromises);
        }
    }
}

module.exports = { FrontDeskCoreRuntime, CRITICAL_EVENTS };
