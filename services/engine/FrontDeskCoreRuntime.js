/**
 * ════════════════════════════════════════════════════════════════════════════
 * FRONT DESK CORE RUNTIME - V111 Enterprise Edition
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * The single orchestrator for all call processing. Every turn goes through here.
 * 
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ S1    Runtime Ownership (set lane)                                     │
 * │ S1.5  Connection Quality Gate (hello? detection)                       │
 * │ S2    Input Text Truth (log what we got)                               │
 * │ S2.5  Escalation Detection (manager/human requests)                    │
 * │ GREET Greeting Intercept (good morning → instant response)             │
 * │ S3    Slot Extraction (name/phone/address)                             │
 * │ S4    Discovery Flow (step progression)                                │
 * │ S5    Consent Gate (intent detection → booking consent)                │
 * │ S6    Booking Flow (collect remaining info)                            │
 * │ S7    Voice Provider (TTS output)                                      │
 * │ OPEN  Opener Engine (prepend micro-acknowledgment)                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 * 
 * SPEAKER OWNERSHIP CONTRACT:
 * Only these modules may generate final response text:
 * - GreetingInterceptor (instant greetings)
 * - DiscoveryFlowRunner (discovery questions)
 * - ConsentGate (consent questions)
 * - BookingFlowRunner (booking questions)
 * - OpenerEngine (prepends micro-acks to responses)
 * 
 * RAW EVENTS:
 * Every section emits SECTION_* events for complete observability.
 * See docs/RAW_EVENTS_MAP.md for the full list.
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../utils/logger');
const { StateStore } = require('./StateStore');
const { DiscoveryFlowRunner } = require('./DiscoveryFlowRunner');
const { ConsentGate } = require('./ConsentGate');
const BookingFlowRunner = require('./booking/BookingFlowRunner');
const { SectionTracer, SECTIONS } = require('./SectionTracer');
const SlotExtractor = require('./booking/SlotExtractor');
const { selectOpener, prependOpener } = require('./OpenerEngine');

// Interceptors - modular pattern matchers
const GreetingInterceptor = require('./interceptors/GreetingInterceptor');
const EscalationDetector = require('./interceptors/EscalationDetector');
const ConnectionQualityGate = require('./interceptors/ConnectionQualityGate');
const CallReasonExtractor = require('./interceptors/CallReasonExtractor');

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
// NOTE: CallReasonExtractor, GreetingInterceptor, EscalationDetector, and
// ConnectionQualityGate have been extracted to ./interceptors/ for modularity.
// ═══════════════════════════════════════════════════════════════════════════

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
            // S1.5: CONNECTION QUALITY GATE (V111)
            // ═══════════════════════════════════════════════════════════════════════════
            // WIRED FROM: frontDeskBehavior.connectionQualityGate (Discovery & Consent tab)
            // 
            // PURPOSE: Detect bad connections, low STT confidence, and "hello? are you there?"
            // patterns on early turns (1-2). Without this gate, the AI treats "hello?" as a
            // real question and gives wrong answers.
            //
            // ACTIONS:
            // - If trouble phrase detected OR STT confidence < threshold → re-greet
            // - After maxRetries → offer DTMF escape (press 1 for human, press 2 for voicemail)
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'S1_5_CONNECTION_QUALITY_GATE';
            const cqGate = company?.aiAgentSettings?.frontDeskBehavior?.connectionQualityGate || {};
            const cqEnabled = cqGate.enabled !== false; // Default: enabled
            const cqThreshold = cqGate.confidenceThreshold || 0.72;
            const cqMaxRetries = cqGate.maxRetries || 3;
            const cqTroublePhrases = cqGate.troublePhrases || [
                'hello', 'hello?', 'hi', 'hi?', 'are you there',
                'can you hear me', 'is anyone there', 'is somebody there',
                'hey', 'hey?', 'anybody there'
            ];
            const cqClarificationPrompt = cqGate.clarificationPrompt || cqGate.reGreeting || 
                "I'm sorry, I didn't quite catch that. Could you please repeat what you said?";
            const cqDtmfMessage = cqGate.dtmfEscapeMessage || 
                "I'm sorry, we seem to have a bad connection. Press 1 to speak with a service advisor, or press 2 to leave a voicemail.";
            
            // Get STT confidence from context (passed from v2twilio.js)
            const sttConfidence = context.sttConfidence || 1.0; // Default high if not provided
            const inputTextRaw = userInput || '';
            const inputTextLower = inputTextRaw.toLowerCase().trim();
            
            // Initialize connection trouble tracking in state
            if (!callState._connectionTroubleCount) {
                callState._connectionTroubleCount = 0;
            }
            
            // Only run on early turns (1-2) when enabled
            const isEarlyTurn = turn <= 2;
            let connectionTroubleDetected = false;
            let troubleReason = null;
            
            if (cqEnabled && isEarlyTurn) {
                // Check 1: Is this a trouble phrase?
                const matchedTroublePhrase = cqTroublePhrases.find(phrase => {
                    const phraseLower = phrase.toLowerCase().trim();
                    return inputTextLower === phraseLower || 
                           inputTextLower.startsWith(phraseLower + ' ') ||
                           inputTextLower.endsWith(' ' + phraseLower) ||
                           inputTextLower.includes(' ' + phraseLower + ' ');
                });
                
                if (matchedTroublePhrase) {
                    connectionTroubleDetected = true;
                    troubleReason = 'TROUBLE_PHRASE';
                }
                
                // Check 2: Low STT confidence
                if (!connectionTroubleDetected && sttConfidence < cqThreshold) {
                    connectionTroubleDetected = true;
                    troubleReason = 'LOW_STT_CONFIDENCE';
                }
            }
            
            // EMIT S1.5 CONNECTION QUALITY GATE EVENT (always, for debugging)
            bufferEvent('SECTION_S1_5_CONNECTION_QUALITY_GATE', {
                enabled: cqEnabled,
                turn: turn,
                isEarlyTurn: isEarlyTurn,
                sttConfidence: sttConfidence,
                confidenceThreshold: cqThreshold,
                inputTextPreview: inputTextRaw.substring(0, 40),
                troubleDetected: connectionTroubleDetected,
                troubleReason: troubleReason,
                troubleCount: callState._connectionTroubleCount,
                maxRetries: cqMaxRetries,
                configSource: 'frontDeskBehavior.connectionQualityGate'
            });
            
            // If connection trouble detected, handle it
            if (connectionTroubleDetected) {
                callState._connectionTroubleCount++;
                
                // Check if we've exceeded max retries
                if (callState._connectionTroubleCount >= cqMaxRetries) {
                    // DTMF Escape - too many failures
                    bufferEvent('CONNECTION_QUALITY_GATE_DTMF_ESCAPE', {
                        troubleCount: callState._connectionTroubleCount,
                        maxRetries: cqMaxRetries,
                        action: 'DTMF_ESCAPE',
                        dtmfMessage: cqDtmfMessage.substring(0, 100)
                    });
                    
                    logger.warn('[FRONT_DESK_CORE_RUNTIME] Connection quality gate: DTMF escape triggered', {
                        callSid,
                        troubleCount: callState._connectionTroubleCount,
                        maxRetries: cqMaxRetries
                    });
                    
                    // Return DTMF escape response
                    // Note: The actual DTMF handling (Gather with numDigits) happens in v2twilio.js
                    return {
                        response: cqDtmfMessage,
                        state: callState,
                        lane: 'DISCOVERY',
                        signals: { escalate: false, bookingComplete: false, dtmfEscape: true },
                        action: 'DTMF_ESCAPE',
                        matchSource: 'CONNECTION_QUALITY_GATE',
                        turnEventBuffer
                    };
                } else {
                    // Re-greet - still have retries left
                    bufferEvent('CONNECTION_QUALITY_GATE_REGREET', {
                        troubleCount: callState._connectionTroubleCount,
                        maxRetries: cqMaxRetries,
                        troubleReason: troubleReason,
                        action: 'REGREET',
                        clarificationPrompt: cqClarificationPrompt.substring(0, 100)
                    });
                    
                    logger.info('[FRONT_DESK_CORE_RUNTIME] Connection quality gate: re-greeting', {
                        callSid,
                        troubleCount: callState._connectionTroubleCount,
                        troubleReason
                    });
                    
                    // Return clarification prompt
                    return {
                        response: cqClarificationPrompt,
                        state: callState,
                        lane: 'DISCOVERY',
                        signals: { escalate: false, bookingComplete: false },
                        action: 'CONTINUE',
                        matchSource: 'CONNECTION_QUALITY_GATE',
                        turnEventBuffer
                    };
                }
            }
            
            // Reset trouble count if this turn was clean
            if (cqEnabled && isEarlyTurn && !connectionTroubleDetected && callState._connectionTroubleCount > 0) {
                logger.info('[FRONT_DESK_CORE_RUNTIME] Connection quality gate: trouble count reset (clean turn)', {
                    callSid,
                    previousTroubleCount: callState._connectionTroubleCount
                });
                callState._connectionTroubleCount = 0;
            }
            
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
            // S2.5: ESCALATION DETECTION (V111 WIRING) - HIGHEST PRIORITY
            // ═══════════════════════════════════════════════════════════════════════════
            // WIRED FROM: frontDeskBehavior.escalation.triggerPhrases
            //
            // PURPOSE: Detect when caller wants human assistance ("manager", "supervisor",
            // "real person", "human", etc.) and escalate BEFORE any other processing.
            //
            // PRIORITY: Escalation trumps EVERYTHING - greeting, discovery, booking.
            // If someone says "I want to speak to a manager", we don't ask their name.
            //
            // CONFIG PATHS:
            // - frontDeskBehavior.escalation.enabled
            // - frontDeskBehavior.escalation.triggerPhrases[]
            // - frontDeskBehavior.escalation.escalationMessage
            // - frontDeskBehavior.escalation.transferNumber
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'S2_5_ESCALATION_DETECTION';
            const escalationConfig = company?.aiAgentSettings?.frontDeskBehavior?.escalation || {};
            const escalationEnabled = escalationConfig.enabled !== false; // Default: enabled
            const escalationTriggers = Array.isArray(escalationConfig.triggerPhrases) && escalationConfig.triggerPhrases.length > 0
                ? escalationConfig.triggerPhrases
                : ['manager', 'supervisor', 'real person', 'human', 'someone else', 'speak to a person', 'talk to someone'];
            const escalationMessage = escalationConfig.escalationMessage || 
                "I understand you'd like to speak with someone. Let me transfer you right away.";
            const transferNumber = escalationConfig.transferNumber || null;
            
            const inputTextLowerEsc = inputText.toLowerCase().trim();
            let escalationTriggered = false;
            let matchedEscalationTrigger = null;
            
            if (escalationEnabled && inputTextLowerEsc) {
                for (const trigger of escalationTriggers) {
                    const triggerLower = trigger.toLowerCase().trim();
                    if (inputTextLowerEsc.includes(triggerLower)) {
                        escalationTriggered = true;
                        matchedEscalationTrigger = trigger;
                        break;
                    }
                }
            }
            
            // EMIT ESCALATION DETECTION EVENT (always, for raw event visibility)
            bufferEvent('SECTION_S2_5_ESCALATION_DETECTION', {
                enabled: escalationEnabled,
                inputTextPreview: inputText.substring(0, 60),
                triggered: escalationTriggered,
                matchedTrigger: matchedEscalationTrigger,
                configuredTriggerCount: escalationTriggers.length,
                hasTransferNumber: !!transferNumber,
                configSource: 'frontDeskBehavior.escalation'
            });
            
            // If escalation triggered, return immediately
            if (escalationTriggered) {
                bufferEvent('ESCALATION_TRIGGERED', {
                    matchedTrigger: matchedEscalationTrigger,
                    escalationMessage: escalationMessage.substring(0, 80),
                    transferNumber: transferNumber ? '***' : null, // Don't log full number
                    action: transferNumber ? 'TRANSFER' : 'ESCALATE',
                    sectionTrail: tracer.getTrailString()
                });
                
                logger.warn('[FRONT_DESK_CORE_RUNTIME] ESCALATION TRIGGERED', {
                    callSid,
                    matchedTrigger: matchedEscalationTrigger,
                    hasTransferNumber: !!transferNumber
                });
                
                return {
                    response: escalationMessage,
                    state: callState,
                    lane: 'ESCALATION',
                    signals: { 
                        escalate: true, 
                        bookingComplete: false,
                        transferNumber: transferNumber || null
                    },
                    action: 'ESCALATE',
                    matchSource: 'ESCALATION_DETECTOR',
                    turnEventBuffer
                };
            }
            
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

            // ═══════════════════════════════════════════════════════════════════════════
            // S5: CALL REASON EXTRACTION (call_reason_detail)
            // ═══════════════════════════════════════════════════════════════════════════
            // Extract the caller's problem/reason from their utterance.
            // When we first capture a call reason, we MUST acknowledge it before
            // continuing with discovery. This makes the agent feel responsive.
            // 
            // Example:
            //   User: "My AC isn't cooling and it's 90 degrees. My name is Mark."
            //   Agent: "I understand your AC isn't cooling. Let me help you with that, Mark."
            //          (NOT: "I have Mark. Is that correct?")
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'S5_CALL_REASON_EXTRACTION';
            
            let callReasonJustCaptured = false;
            let capturedCallReason = null;
            
            // Only extract if we don't already have a call reason
            if (!state.plainSlots.call_reason_detail) {
                capturedCallReason = CallReasonExtractor.extract(inputText);
                if (capturedCallReason) {
                    state.plainSlots.call_reason_detail = capturedCallReason;
                    callReasonJustCaptured = true;
                    
                    bufferEvent('SECTION_S5_CALL_REASON_CAPTURED', {
                        callReasonDetail: capturedCallReason,
                        inputTextPreview: inputText.substring(0, 80),
                        sectionTrail: tracer.getTrailString()
                    });
                    
                    logger.info('[FRONT_DESK_CORE_RUNTIME] S5: Call reason captured', {
                        callSid,
                        callReason: capturedCallReason,
                        turn
                    });
                }
            }
            
            // ═══════════════════════════════════════════════════════════════════════════
            // ACKNOWLEDGE CALL REASON (if just captured)
            // ═══════════════════════════════════════════════════════════════════════════
            // If we just captured the call reason AND we have the caller's name,
            // acknowledge both together for a natural response.
            // If we don't have the name yet, acknowledge the problem and ask for name.
            // ═══════════════════════════════════════════════════════════════════════════
            if (callReasonJustCaptured && capturedCallReason) {
                const callerName = state.plainSlots.name;
                let acknowledgment;
                
                if (callerName) {
                    // We have both name and reason - acknowledge both
                    acknowledgment = `I understand, ${callerName} — ${capturedCallReason}. Let me help you get that taken care of. Can I confirm your phone number?`;
                } else {
                    // We have reason but not name - acknowledge and ask for name
                    acknowledgment = `I understand — ${capturedCallReason}. Let me help you get that taken care of. May I have your name?`;
                }
                
                bufferEvent('CALL_REASON_ACKNOWLEDGED', {
                    acknowledgment: acknowledgment.substring(0, 100),
                    callReason: capturedCallReason,
                    hasName: !!callerName,
                    sectionTrail: tracer.getTrailString()
                });
                
                // Return the acknowledgment - skip normal Discovery Flow for this turn
                return {
                    response: acknowledgment,
                    state: state,
                    lane: 'DISCOVERY',
                    signals: { escalate: false, bookingComplete: false },
                    action: 'CONTINUE',
                    matchSource: 'CALL_REASON_ACKNOWLEDGER',
                    turnEventBuffer
                };
            }

            bufferEvent('CORE_RUNTIME_TURN_START', {
                lane: state.lane,
                consentPending: state.consent?.pending === true,
                slotCount: Object.keys(state.plainSlots || {}).length,
                callReasonCaptured: !!state.plainSlots.call_reason_detail,
                sectionTrail: tracer.getTrailString()
            });

            // ═══════════════════════════════════════════════════════════════════════════
            // S4/S5/S6: DISCOVERY → CONSENT → BOOKING (V111 ENHANCED)
            // ═══════════════════════════════════════════════════════════════════════════
            // WIRED FROM: frontDeskBehavior.detectionTriggers, frontDeskBehavior.discoveryConsent
            //
            // FLOW:
            // 1. If already in BOOKING lane → S6 Booking Flow
            // 2. If consent pending → Evaluate consent response
            // 3. NEW: Detect booking intent mid-discovery (directIntentPatterns, wantsBooking)
            // 4. Run Discovery Flow
            // 5. After discovery complete → Ask consent (if not bypassed)
            // ═══════════════════════════════════════════════════════════════════════════
            let ownerResult;
            
            if (state.lane === 'BOOKING') {
                // Already in booking lane
                currentSection = 'S6_BOOKING_FLOW';
                tracer.enter(SECTIONS.S6_BOOKING_FLOW);
                ownerResult = BookingFlowRunner.run({ company, callSid, userInput, state });
            } else {
                // DISCOVERY lane - check consent state and intent
                currentSection = 'S5_CONSENT_GATE_EVAL';
                const consentEval = ConsentGate.evaluate({ company, userInput, state, callSid });
                
                // Merge consent eval events into our buffer
                if (consentEval.turnEventBuffer) {
                    turnEventBuffer.push(...consentEval.turnEventBuffer);
                }
                
                if (consentEval.granted) {
                    // Consent granted - move to booking
                    currentSection = 'S5_CONSENT_GRANTED';
                    tracer.enter(SECTIONS.S5_CONSENT_GATE, { granted: '1' });
                    state.lane = 'BOOKING';
                    state.consent.pending = false;
                    state.consent.askedExplicitly = false;
                    
                    bufferEvent('SECTION_S5_CONSENT_GRANTED', {
                        previousLane: 'DISCOVERY',
                        newLane: 'BOOKING',
                        action: 'TRANSITION_TO_BOOKING'
                    });
                    
                    currentSection = 'S6_BOOKING_FLOW';
                    tracer.enter(SECTIONS.S6_BOOKING_FLOW);
                    ownerResult = BookingFlowRunner.run({ company, callSid, userInput, state });
                } else if (consentEval.pending && state?.consent?.askedExplicitly) {
                    // Consent was asked but user response unclear - re-ask
                    currentSection = 'S5_CONSENT_PENDING';
                    tracer.enter(SECTIONS.S5_CONSENT_GATE, { pending: '1' });
                    
                    const askResult = ConsentGate.ask({ company, state, callSid });
                    if (askResult.turnEventBuffer) {
                        turnEventBuffer.push(...askResult.turnEventBuffer);
                    }
                    ownerResult = askResult;
                } else {
                    // ═══════════════════════════════════════════════════════════════════════════
                    // V111: DETECT BOOKING INTENT MID-DISCOVERY
                    // ═══════════════════════════════════════════════════════════════════════════
                    // Check if user is expressing booking intent ("I want to schedule service")
                    // This allows us to:
                    // 1. Bypass consent if intent is strong (directIntentPatterns)
                    // 2. Note the intent for later (wantsBooking phrases)
                    // ═══════════════════════════════════════════════════════════════════════════
                    currentSection = 'S5_INTENT_DETECTION';
                    const intentResult = ConsentGate.detectBookingIntent({ company, userInput, state, callSid });
                    
                    // Merge intent detection events into our buffer
                    if (intentResult.turnEventBuffer) {
                        turnEventBuffer.push(...intentResult.turnEventBuffer);
                    }
                    
                    // Check if we should bypass consent due to direct intent
                    if (intentResult.hasBookingIntent && intentResult.bypassConsent) {
                        // Strong intent detected - bypass consent, go straight to booking
                        currentSection = 'S5_DIRECT_INTENT_BYPASS';
                        tracer.enter(SECTIONS.S5_CONSENT_GATE, { directIntentBypass: '1' });
                        
                        state.lane = 'BOOKING';
                        state.consent = { pending: false, askedExplicitly: false, bypassedByDirectIntent: true };
                        
                        bufferEvent('SECTION_S5_DIRECT_INTENT_BYPASS', {
                            intentType: intentResult.intentType,
                            matchedPattern: intentResult.matchedPattern,
                            action: 'BYPASS_CONSENT_STRAIGHT_TO_BOOKING'
                        });
                        
                        logger.info('[FRONT_DESK_CORE_RUNTIME] Direct intent bypass - skipping consent', {
                            callSid,
                            matchedPattern: intentResult.matchedPattern
                        });
                        
                        currentSection = 'S6_BOOKING_FLOW';
                        tracer.enter(SECTIONS.S6_BOOKING_FLOW);
                        ownerResult = BookingFlowRunner.run({ company, callSid, userInput, state });
                    } else {
                        // Normal discovery flow
                        currentSection = 'S4_DISCOVERY_STEP_ENGINE';
                        tracer.enter(SECTIONS.S4_DISCOVERY_ENGINE);
                        ownerResult = DiscoveryFlowRunner.run({ company, callSid, userInput, state });
                        
                        // Note: If user expressed soft booking intent, mark it in state for later
                        if (intentResult.hasBookingIntent && !intentResult.bypassConsent) {
                            ownerResult.state = ownerResult.state || state;
                            ownerResult.state._bookingIntentDetected = true;
                            ownerResult.state._bookingIntentType = intentResult.intentType;
                        }
                        
                        // Check if discovery is now complete
                        const nowComplete = DiscoveryFlowRunner.isComplete(company, ownerResult.state?.plainSlots || {});
                        const consentRequired = ConsentGate.isConsentRequired(company);
                        
                        if (nowComplete && ownerResult.state?.consent?.pending !== true) {
                            if (consentRequired && !intentResult.bypassConsent) {
                                // Discovery complete, need to ask consent
                                currentSection = 'S5_CONSENT_AFTER_DISCOVERY';
                                tracer.enter(SECTIONS.S5_CONSENT_GATE, { askAfterDiscovery: '1' });
                                
                                const askResult = ConsentGate.ask({ company, state: ownerResult.state, callSid });
                                if (askResult.turnEventBuffer) {
                                    turnEventBuffer.push(...askResult.turnEventBuffer);
                                }
                                ownerResult = askResult;
                            } else if (!consentRequired) {
                                // Consent not required - go straight to booking
                                currentSection = 'S5_CONSENT_NOT_REQUIRED';
                                tracer.enter(SECTIONS.S5_CONSENT_GATE, { consentNotRequired: '1' });
                                
                                state.lane = 'BOOKING';
                                state.consent = { pending: false, askedExplicitly: false, skipped: true };
                                
                                bufferEvent('SECTION_S5_CONSENT_SKIPPED', {
                                    reason: 'CONSENT_NOT_REQUIRED_BY_CONFIG',
                                    configSource: 'frontDeskBehavior.discoveryConsent.enabled'
                                });
                                
                                currentSection = 'S6_BOOKING_FLOW';
                                tracer.enter(SECTIONS.S6_BOOKING_FLOW);
                                ownerResult = BookingFlowRunner.run({ company, callSid, userInput, state });
                            }
                        }
                    }
                }
            }

            currentSection = 'PERSIST_STATE';
            const persistedState = StateStore.persist(callState, ownerResult.state || state);
            const lane = persistedState.sessionMode === 'BOOKING' ? 'BOOKING' : 'DISCOVERY';

            // ═══════════════════════════════════════════════════════════════════════════
            // OPENER ENGINE (V111 WIRING)
            // ═══════════════════════════════════════════════════════════════════════════
            // WIRED FROM: frontDeskBehavior.openers
            //
            // PURPOSE: Prepend micro-acknowledgment ("Alright.", "I hear you.") to
            // eliminate dead air. Runs AFTER we have a response, BEFORE returning.
            //
            // CONFIG PATHS:
            // - frontDeskBehavior.openers.enabled
            // - frontDeskBehavior.openers.mode ('reflect_first', 'micro_ack_only', 'off')
            // - frontDeskBehavior.openers.general[] (general acks)
            // - frontDeskBehavior.openers.frustration[] (empathy acks)
            // - frontDeskBehavior.openers.urgency[] (urgency acks)
            // - frontDeskBehavior.openers.frustrationKeywords[] (trigger frustration pool)
            // - frontDeskBehavior.openers.urgencyKeywords[] (trigger urgency pool)
            // - frontDeskBehavior.openers.reflectionTemplate (for reflect_first mode)
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'OPENER_ENGINE';
            const openerConfig = company?.aiAgentSettings?.frontDeskBehavior?.openers || {};
            const reasonShort = persistedState?.plainSlots?.call_reason_detail || 
                                persistedState?.slots?.call_reason_detail || null;
            
            const openerResult = selectOpener({
                userText: inputText,
                reasonShort,
                openerConfig,
                turnCount: turn,
                callSid
            });
            
            // Apply opener to response
            let finalResponse = ownerResult.response;
            if (openerResult.opener) {
                finalResponse = prependOpener(openerResult.opener, ownerResult.response);
            }
            
            // EMIT OPENER ENGINE EVENT (always, for raw event visibility)
            bufferEvent('SECTION_OPENER_ENGINE', {
                enabled: openerConfig.enabled !== false,
                mode: openerConfig.mode || 'reflect_first',
                turnCount: turn,
                openerSelected: openerResult.opener || null,
                tone: openerResult.tone,
                reasonShort: reasonShort ? reasonShort.substring(0, 40) : null,
                prependApplied: openerResult.opener ? true : false,
                originalResponsePreview: (ownerResult.response || '').substring(0, 60),
                finalResponsePreview: (finalResponse || '').substring(0, 80),
                debug: openerResult.debug,
                configSource: 'frontDeskBehavior.openers'
            });

            // ═══════════════════════════════════════════════════════════════════════════
            // CORE_RUNTIME_OWNER_RESULT - MANDATORY CRITICAL EVENT
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'EMIT_RESULT';
            bufferEvent('CORE_RUNTIME_OWNER_RESULT', {
                lane,
                matchSource: ownerResult.matchSource,
                responsePreview: (finalResponse || '').substring(0, 120),
                bookingComplete: ownerResult.complete === true,
                openerApplied: openerResult.opener ? true : false,
                sectionTrail: tracer.getTrailString()
            });

            logger.info('[FRONT_DESK_CORE_RUNTIME] owner result', {
                callSid,
                lane,
                matchSource: ownerResult.matchSource,
                bookingComplete: ownerResult.complete === true,
                openerApplied: !!openerResult.opener
            });

            return {
                response: finalResponse,
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
