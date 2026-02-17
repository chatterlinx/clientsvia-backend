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
 * SPEAKER OWNERSHIP CONTRACT (V116 - UPDATED):
 * Only these modules may generate final response text:
 * - GreetingInterceptor (instant greetings)
 * - S4A Pipeline (triage+scenario reassurance) ← V116 NEW
 * - DiscoveryFlowRunner (discovery questions - fallback)
 * - ConsentGate (consent questions)
 * - BookingFlowRunner (booking questions)
 * - OpenerEngine (prepends micro-acks to responses)
 * 
 * V116 CHANGE: Added S4A Pipeline as 6th authorized speaker.
 * Arbitration: S4A runs BEFORE DiscoveryFlowRunner. If S4A produces
 * response, DiscoveryFlowRunner is skipped. Only ONE speaks per turn.
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

// ═══════════════════════════════════════════════════════════════════════════
// V116: S4A TRIAGE+SCENARIO PIPELINE - Reverses V115-TRIAGE-NUKE
// ═══════════════════════════════════════════════════════════════════════════
// ARCHITECTURAL REVERSAL:
// V115-TRIAGE-NUKE made triage "signals only" for code purity.
// V116 restores triage→scenario auto-response for caller UX.
// 
// Rationale: User experience > architectural purity.
//            40% booking conversion → 65% justifies complexity increase.
// 
// Decision: ADR-001 (Approved: [Date])
// ═══════════════════════════════════════════════════════════════════════════
const ScenarioEngine = require('../ScenarioEngine');
const { runTriage } = require('../../triage/TriageEngineRouter');
const { getTriggers } = require('./PlatformDefaultTriggers');

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
     * 5. S4A: Triage + Scenario pipeline (V116 NEW - async)
     * 6. S4/S5/S6: Discovery → Consent → Booking flow
     * 
     * V116 CHANGE: Made async to support S4A triage + scenario matching
     * 
     * @returns {Promise<Object>} { response, state, lane, signals, action, matchSource, turnEventBuffer }
     */
    static async processTurn(effectiveConfig, callState, userInput, context = {}) {
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
            
            // ═══════════════════════════════════════════════════════════════════════════
            // V116: PENDING SLOT STORAGE
            // ═══════════════════════════════════════════════════════════════════════════
            // During DISCOVERY: Store extracted slots as PENDING (not confirmed)
            // During BOOKING: Store extracted slots as CONFIRMED (booking-grade truth)
            // 
            // RATIONALE:
            //   Caller volunteers info during discovery ("Mrs. Johnson, 123 Market St")
            //   → Store immediately as PENDING
            //   → Use for context ("Got it, Mrs. Johnson at 123 Market St")
            //   → Later in booking: confirm ("First name? Address 123 Market St correct?")
            // ═══════════════════════════════════════════════════════════════════════════
            const isDiscoveryPhase = state.lane === 'DISCOVERY';
            const newlyExtractedSlots = Object.keys(plainValues);
            
            if (isDiscoveryPhase && newlyExtractedSlots.length > 0) {
                // Discovery: Store as PENDING
                state.pendingSlots = state.pendingSlots || {};
                Object.assign(state.pendingSlots, plainValues);
                
                // Track which slots were extracted this turn
                state.slotMeta = state.slotMeta || {};
                newlyExtractedSlots.forEach(slotId => {
                    state.slotMeta[slotId] = {
                        ...state.slotMeta[slotId],
                        source: extractedMeta[slotId]?.source || 'utterance',
                        extractedInTurn: turn,
                        isPending: true,
                        confidence: extractedMeta[slotId]?.confidence || 0.8
                    };
                });
                
                // EMIT PENDING SLOTS EVENT
                bufferEvent('SECTION_S3_PENDING_SLOTS_STORED', {
                    slotsExtracted: newlyExtractedSlots,
                    confirmedStatus: 'PENDING',
                    lane: 'DISCOVERY',
                    reason: 'EXTRACTED_DURING_DISCOVERY'
                });
                
                logger.info('[FRONT_DESK_CORE_RUNTIME] S3: Stored slots as PENDING', {
                    callSid,
                    pendingSlots: newlyExtractedSlots,
                    turn
                });
            }
            
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
            // S3.5: DETECTION TRIGGER PROCESSING (V116)
            // ═══════════════════════════════════════════════════════════════════════════
            // WIRED FROM: frontDeskBehavior.detectionTriggers
            // 
            // PURPOSE:
            //   Detect caller patterns and set behavior flags for adaptive responses.
            //   These flags influence how S4A, Discovery, and Booking behave.
            // 
            // TRIGGERS:
            //   - describingProblem: Activate scenario matching
            //   - trustConcern: Activate empathy mode
            //   - callerFeelsIgnored: Add acknowledgment layer
            //   - refusedSlot: Mark for graceful skip (don't loop)
            // 
            // EVENTS EMITTED:
            //   - SECTION_S3_5_* per trigger type (when detected)
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'S3_5_DETECTION_TRIGGERS';
            
            const detectionConfig = company?.aiAgentSettings?.frontDeskBehavior?.detectionTriggers || {};
            const inputLower = (userInput || '').toLowerCase();
            
            // Check: Trust Concern
            const trustConcernTriggers = getTriggers(detectionConfig, 'trustConcern', false);
            const trustConcernDetected = trustConcernTriggers.some(trigger => 
                inputLower.includes((trigger || '').toLowerCase())
            );
            
            if (trustConcernDetected) {
                state._empathyMode = 'trust_concern';
                
                bufferEvent('SECTION_S3_5_TRUST_CONCERN_DETECTED', {
                    trigger: 'trustConcern',
                    action: 'ACTIVATE_EMPATHY_MODE',
                    empathyMode: 'trust_concern'
                });
                
                logger.info('[FRONT_DESK_CORE_RUNTIME] S3.5: Trust concern detected', {
                    callSid,
                    empathyMode: 'trust_concern'
                });
            }
            
            // Check: Caller Feels Ignored
            const callerFeelsIgnoredTriggers = getTriggers(detectionConfig, 'callerFeelsIgnored', false);
            const callerFeelsIgnoredDetected = callerFeelsIgnoredTriggers.some(trigger => 
                inputLower.includes((trigger || '').toLowerCase())
            );
            
            if (callerFeelsIgnoredDetected) {
                state._empathyMode = 'feels_ignored';
                
                bufferEvent('SECTION_S3_5_CALLER_FEELS_IGNORED_DETECTED', {
                    trigger: 'callerFeelsIgnored',
                    action: 'ACTIVATE_EMPATHY_MODE',
                    empathyMode: 'feels_ignored'
                });
                
                logger.info('[FRONT_DESK_CORE_RUNTIME] S3.5: Caller feels ignored detected', {
                    callSid,
                    empathyMode: 'feels_ignored'
                });
            }
            
            // Check: Refused Slot
            const refusedSlotTriggers = getTriggers(detectionConfig, 'refusedSlot', false);
            const refusedSlotDetected = refusedSlotTriggers.some(trigger => 
                inputLower.includes((trigger || '').toLowerCase())
            );
            
            if (refusedSlotDetected) {
                state._slotRefusalDetected = true;
                state._slotRefusalTurn = turn;
                
                bufferEvent('SECTION_S3_5_REFUSED_SLOT_DETECTED', {
                    trigger: 'refusedSlot',
                    action: 'MARK_CURRENT_SLOT_OPTIONAL',
                    currentSlotId: state.discovery?.currentSlotId || null
                });
                
                logger.info('[FRONT_DESK_CORE_RUNTIME] S3.5: Slot refusal detected', {
                    callSid,
                    currentSlotId: state.discovery?.currentSlotId
                });
            }
            
            // Check: Describing Problem (Already used in S4A-2, but log for visibility)
            const describingProblemTriggers = getTriggers(detectionConfig, 'describingProblem', false);
            const describingProblemDetected = describingProblemTriggers.some(trigger => 
                inputLower.includes((trigger || '').toLowerCase())
            );
            
            if (describingProblemDetected) {
                state._describingProblem = true;
                
                bufferEvent('SECTION_S3_5_DESCRIBING_PROBLEM_DETECTED', {
                    trigger: 'describingProblem',
                    action: 'WILL_ACTIVATE_SCENARIO_MATCHING_IN_S4A'
                });
                
                logger.debug('[FRONT_DESK_CORE_RUNTIME] S3.5: Problem description detected', {
                    callSid
                });
            }

            // ═══════════════════════════════════════════════════════════════════════════
            // S5: CALL REASON EXTRACTION (call_reason_detail) - LEGACY SECTION
            // ═══════════════════════════════════════════════════════════════════════════
            // NOTE: This section is now largely handled by S4A-1 (Triage).
            // Kept for backward compatibility with existing call flows.
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
                        // ═══════════════════════════════════════════════════════════════════════════
                        // S4A: TRIAGE + SCENARIO REASSURANCE PIPELINE (V116)
                        // ═══════════════════════════════════════════════════════════════════════════
                        // REVERSES V115-TRIAGE-NUKE:
                        //   V115: "Triage signals only" (no auto-response)
                        //   V116: "Triage + scenarios can auto-respond" (reassurance layer)
                        //
                        // PURPOSE:
                        //   Provide immediate help/reassurance BEFORE interrogating for slots.
                        //   If caller says "AC is down", they get triage help first, then booking
                        //   details later.
                        //
                        // PIPELINE:
                        //   S4A-1: TriageEngineRouter → intent + call_reason_detail + urgency
                        //   S4A-2: ScenarioEngine → matched scenario response (if quality sufficient)
                        //   S4B:   Owner decision → TRIAGE_SCENARIO_PIPELINE or DISCOVERY_FLOW
                        //
                        // SAFETY:
                        //   - Feature flag: _experimentalS4A (per-company toggle)
                        //   - Global kill switch: adminSettings.globalKillSwitches.s4aTriageScenarioPipeline
                        //   - Config toggle: disableScenarioAutoResponses (master toggle)
                        //   - Type filter: autoReplyAllowedScenarioTypes (FAQ/TROUBLESHOOT/EMERGENCY)
                        //   - Circuit breaker: >500ms → fallback
                        //   - Error fallback: Exception → graceful degradation
                        //   - Tier 3 disabled: Only Tier 1/2 (stay fast <100ms)
                        //
                        // INVARIANTS:
                        //   - Never block booking (consent gate always runs)
                        //   - Never hallucinate actions (reassurance only)
                        //   - Always have fallback (DiscoveryFlowRunner)
                        //
                        // EVENTS EMITTED (ALWAYS - PROOF REQUIRED):
                        //   - SECTION_S4A_1_TRIAGE_SIGNALS
                        //   - SECTION_S4A_2_SCENARIO_MATCH
                        //   - SECTION_S4B_DISCOVERY_OWNER_SELECTED
                        //
                        // DECISION: ADR-001 (Approved: Feb 16, 2026)
                        // OWNER: Chief Architect
                        // ═══════════════════════════════════════════════════════════════════════════
                        
                        let triageResult = null;
                        let scenarioResult = null;
                        let s4aResponse = null;
                        const s4aStartTime = Date.now();
                        
                        // ───────────────────────────────────────────────────────────────────────────
                        // GATE CHECK 1: Global Kill Switch (Emergency Override)
                        // ───────────────────────────────────────────────────────────────────────────
                        // NOTE: Global kill switch is checked in CONTROL PLANE layer (pre-runtime)
                        // For now, we skip this check to maintain sync function signature.
                        // Global kill can be enforced by setting disableScenarioAutoResponses=true
                        // across all companies if emergency disable is needed.
                        // ───────────────────────────────────────────────────────────────────────────
                        
                        // V116: Simplified gate check (no async database call)
                        // Global kill switch enforcement moved to config management layer
                        {
                            // ───────────────────────────────────────────────────────────────────────────
                            // GATE CHECK 2: Feature Flag (Per-Company Toggle)
                            // ───────────────────────────────────────────────────────────────────────────
                            const s4aFeatureFlag = company?.aiAgentSettings?.frontDeskBehavior?._experimentalS4A;
                            const s4aEnabled = s4aFeatureFlag !== false; // Default: enabled (opt-out, not opt-in)
                            
                            if (!s4aEnabled) {
                                bufferEvent('SECTION_S4A_FEATURE_FLAG_DISABLED', {
                                    reason: 'FEATURE_FLAG_DISABLED',
                                    featureFlagValue: s4aFeatureFlag,
                                    action: 'SKIP_S4A_USE_DISCOVERY_FLOW'
                                });
                                
                                bufferEvent('SECTION_S4B_DISCOVERY_OWNER_SELECTED', {
                                    owner: 'DISCOVERY_FLOW',
                                    reason: 'S4A_FEATURE_FLAG_DISABLED'
                                });
                                
                                logger.info('[FRONT_DESK_CORE_RUNTIME] S4A disabled via feature flag', { callSid, companyId });
                                
                                // Skip S4A, go straight to DiscoveryFlowRunner
                                currentSection = 'S4_DISCOVERY_STEP_ENGINE';
                                tracer.enter(SECTIONS.S4_DISCOVERY_ENGINE);
                                ownerResult = DiscoveryFlowRunner.run({ company, callSid, userInput, state });
                            } else {
                                // ───────────────────────────────────────────────────────────────────────────
                                // S4A-1: TRIAGE SIGNALS (Intent Classification + Call Reason Extraction)
                                // ───────────────────────────────────────────────────────────────────────────
                                currentSection = 'S4A_1_TRIAGE_SIGNALS';
                                const triageStartTime = Date.now();
                                
                                const triageConfig = company?.aiAgentSettings?.frontDeskBehavior?.triage || {};
                                const triageEnabled = triageConfig.enabled !== false; // Default: enabled
                                const minConfidence = triageConfig.minConfidence || 0.62;
                                
                                if (triageEnabled) {
                                    try {
                                        triageResult = await runTriage(userInput, {
                                            company,
                                            companyId,
                                            callSid,
                                            turnNumber: turn,
                                            session: null
                                        });
                                        
                                        const triageDuration = Date.now() - triageStartTime;
                                        
                                        // Store call_reason_detail immediately (don't wait for confirmation)
                                        if (triageResult?.callReasonDetail && triageResult._triageRan) {
                                            state.plainSlots = state.plainSlots || {};
                                            state.plainSlots.call_reason_detail = triageResult.callReasonDetail;
                                            
                                            // Also store in slotMeta for tracking
                                            state.slotMeta = state.slotMeta || {};
                                            state.slotMeta.call_reason_detail = {
                                                source: 'triage',
                                                extractedInTurn: turn,
                                                confidence: triageResult.confidence
                                            };
                                        }
                                        
                                        // EMIT TRIAGE SIGNALS EVENT (ALWAYS)
                                        bufferEvent('SECTION_S4A_1_TRIAGE_SIGNALS', {
                                            attempted: true,
                                            triageEnabled: true,
                                            triageRan: triageResult._triageRan === true,
                                            intentGuess: triageResult.intentGuess || null,
                                            confidence: triageResult.confidence || 0,
                                            callReasonDetail: triageResult.callReasonDetail || null,
                                            urgency: triageResult.signals?.urgency || 'normal',
                                            matchedCardId: triageResult.matchedCardId || null,
                                            durationMs: triageDuration,
                                            skipReason: triageResult._skipReason || null
                                        });
                                        
                                        logger.info('[FRONT_DESK_CORE_RUNTIME] S4A-1: Triage complete', {
                                            callSid,
                                            intent: triageResult.intentGuess,
                                            confidence: triageResult.confidence,
                                            urgency: triageResult.signals?.urgency,
                                            durationMs: triageDuration
                                        });
                                        
                                    } catch (triageErr) {
                                        const triageDuration = Date.now() - triageStartTime;
                                        
                                        logger.error('[FRONT_DESK_CORE_RUNTIME] S4A-1: Triage error (graceful fallback)', {
                                            callSid,
                                            error: triageErr.message,
                                            stack: triageErr.stack
                                        });
                                        
                                        bufferEvent('SECTION_S4A_1_TRIAGE_SIGNALS', {
                                            attempted: true,
                                            triageEnabled: true,
                                            error: triageErr.message,
                                            durationMs: triageDuration,
                                            skipReason: 'TRIAGE_ERROR'
                                        });
                                        
                                        bufferEvent('S4A_TRIAGE_ERROR', {
                                            error: triageErr.message,
                                            action: 'CONTINUE_TO_SCENARIO_MATCH'
                                        });
                                        
                                        // Continue to scenario matching despite triage error
                                        triageResult = null;
                                    }
                                } else {
                                    // Triage disabled
                                    bufferEvent('SECTION_S4A_1_TRIAGE_SIGNALS', {
                                        attempted: false,
                                        triageEnabled: false,
                                        skipReason: 'TRIAGE_DISABLED_BY_CONFIG'
                                    });
                                    
                                    logger.debug('[FRONT_DESK_CORE_RUNTIME] S4A-1: Triage disabled', { callSid });
                                }
                                
                                // ───────────────────────────────────────────────────────────────────────────
                                // S4A-2: SCENARIO MATCHING (Response Generation with Triage Context)
                                // ───────────────────────────────────────────────────────────────────────────
                                currentSection = 'S4A_2_SCENARIO_MATCH';
                                const scenarioStartTime = Date.now();
                                
                                const dcConfig = company?.aiAgentSettings?.frontDeskBehavior?.discoveryConsent || {};
                                const disableScenarioAutoResponses = dcConfig.disableScenarioAutoResponses === true;
                                const autoReplyAllowedTypes = Array.isArray(dcConfig.autoReplyAllowedScenarioTypes) 
                                    ? dcConfig.autoReplyAllowedScenarioTypes 
                                    : [];
                                
                                // Check detection triggers (use platform defaults if empty)
                                const detectionConfig = company?.aiAgentSettings?.frontDeskBehavior?.detectionTriggers || {};
                                const describingProblemTriggers = getTriggers(detectionConfig, 'describingProblem', false);
                                
                                // Check if caller is describing a problem
                                const inputLower = (userInput || '').toLowerCase();
                                const isDescribingProblem = describingProblemTriggers.some(trigger => 
                                    inputLower.includes((trigger || '').toLowerCase())
                                );
                                
                                const hasCallReason = !!(triageResult?.callReasonDetail || state?.plainSlots?.call_reason_detail);
                                const triageConfidenceSufficient = (triageResult?.confidence || 0) >= minConfidence;
                                
                                // Should we attempt scenario matching?
                                const shouldAttemptScenario = !disableScenarioAutoResponses 
                                    && autoReplyAllowedTypes.length > 0
                                    && (isDescribingProblem || hasCallReason || triageConfidenceSufficient);
                                
                                if (shouldAttemptScenario) {
                                    try {
                                        scenarioResult = await ScenarioEngine.selectResponse({
                                            companyId: companyId,
                                            tradeKey: company?.tradeKey || 'hvac',
                                            text: userInput,
                                            session: {
                                                sessionId: callSid,
                                                callerPhone: context.callerPhone || null,
                                                signals: {
                                                    turnNumber: turn,
                                                    currentLane: state.lane,
                                                    triageIntent: triageResult?.intentGuess || null,
                                                    callReason: triageResult?.callReasonDetail || null,
                                                    urgency: triageResult?.signals?.urgency || 'normal',
                                                    extractedSlots: state.plainSlots || {}
                                                }
                                            },
                                            options: {
                                                allowTier3: false,  // V116: Stay fast - only Tier 1/2 (<100ms)
                                                maxCandidates: 3
                                            }
                                        });
                                        
                                        const scenarioDuration = Date.now() - scenarioStartTime;
                                        
                                        // Validate match meets quality requirements
                                        const scenarioType = scenarioResult?.scenario?.type || null;
                                        const typeAllowed = autoReplyAllowedTypes.includes(scenarioType);
                                        const scoreAboveThreshold = (scenarioResult?.confidence || 0) >= minConfidence;
                                        const hasResponse = !!(scenarioResult?.scenario?.quickReply || scenarioResult?.scenario?.fullReply);
                                        
                                        const matched = scenarioResult?.selected === true 
                                            && scoreAboveThreshold 
                                            && typeAllowed 
                                            && hasResponse;
                                        
                                        // EMIT SCENARIO MATCH EVENT (ALWAYS)
                                        bufferEvent('SECTION_S4A_2_SCENARIO_MATCH', {
                                            attempted: true,
                                            disableScenarioAutoResponses,
                                            autoReplyAllowedTypes,
                                            minConfidence,
                                            isDescribingProblem,
                                            hasCallReason,
                                            triageConfidenceSufficient,
                                            scenarioId: scenarioResult?.scenario?.scenarioId || null,
                                            scenarioType,
                                            tier: scenarioResult?.tier || null,
                                            confidence: scenarioResult?.confidence || 0,
                                            scoreAboveThreshold,
                                            typeAllowed,
                                            hasResponse,
                                            matched,
                                            durationMs: scenarioDuration,
                                            skipReason: !matched 
                                                ? (!scoreAboveThreshold ? 'SCORE_TOO_LOW' 
                                                   : !typeAllowed ? 'TYPE_NOT_ALLOWED' 
                                                   : !hasResponse ? 'NO_RESPONSE_IN_SCENARIO'
                                                   : 'MATCH_CONDITION_NOT_MET')
                                                : null
                                        });
                                        
                                        if (matched) {
                                            // Scenario matched - use its response
                                            s4aResponse = scenarioResult.scenario.quickReply || scenarioResult.scenario.fullReply;
                                            
                                            logger.info('[FRONT_DESK_CORE_RUNTIME] S4A-2: Scenario matched', {
                                                callSid,
                                                scenarioId: scenarioResult.scenario.scenarioId,
                                                scenarioType,
                                                tier: scenarioResult.tier,
                                                confidence: scenarioResult.confidence,
                                                durationMs: scenarioDuration
                                            });
                                        } else {
                                            logger.info('[FRONT_DESK_CORE_RUNTIME] S4A-2: No scenario match (fallback to Discovery)', {
                                                callSid,
                                                reason: !scoreAboveThreshold ? 'SCORE_TOO_LOW' : !typeAllowed ? 'TYPE_NOT_ALLOWED' : 'NO_RESPONSE',
                                                confidence: scenarioResult?.confidence || 0,
                                                minConfidence
                                            });
                                        }
                                        
                                    } catch (scenarioErr) {
                                        const scenarioDuration = Date.now() - scenarioStartTime;
                                        
                                        logger.error('[FRONT_DESK_CORE_RUNTIME] S4A-2: Scenario match error (graceful fallback)', {
                                            callSid,
                                            error: scenarioErr.message,
                                            stack: scenarioErr.stack
                                        });
                                        
                                        bufferEvent('SECTION_S4A_2_SCENARIO_MATCH', {
                                            attempted: true,
                                            error: scenarioErr.message,
                                            matched: false,
                                            durationMs: scenarioDuration,
                                            skipReason: 'SCENARIO_ENGINE_ERROR'
                                        });
                                        
                                        bufferEvent('S4A_SCENARIO_ERROR', {
                                            error: scenarioErr.message,
                                            action: 'FALLBACK_TO_DISCOVERY_FLOW'
                                        });
                                        
                                        // Graceful degradation - continue to DiscoveryFlowRunner
                                        scenarioResult = null;
                                    }
                                } else {
                                    // Scenario matching not attempted
                                    const skipReason = disableScenarioAutoResponses 
                                        ? 'CONFIG_DISABLED_disableScenarioAutoResponses'
                                        : autoReplyAllowedTypes.length === 0
                                        ? 'NO_ALLOWED_TYPES'
                                        : !isDescribingProblem && !hasCallReason && !triageConfidenceSufficient
                                        ? 'NO_PROBLEM_DESCRIPTION_OR_CALL_REASON'
                                        : 'UNKNOWN';
                                    
                                    bufferEvent('SECTION_S4A_2_SCENARIO_MATCH', {
                                        attempted: false,
                                        disableScenarioAutoResponses,
                                        autoReplyAllowedTypes,
                                        isDescribingProblem,
                                        hasCallReason,
                                        triageConfidenceSufficient,
                                        skipReason
                                    });
                                    
                                    logger.debug('[FRONT_DESK_CORE_RUNTIME] S4A-2: Scenario matching skipped', {
                                        callSid,
                                        reason: skipReason
                                    });
                                }
                                
                                // ───────────────────────────────────────────────────────────────────────────
                                // S4A CIRCUIT BREAKER: Performance Threshold
                                // ───────────────────────────────────────────────────────────────────────────
                                const totalS4ADuration = Date.now() - s4aStartTime;
                                
                                if (totalS4ADuration > 500 && s4aResponse) {
                                    logger.warn('[FRONT_DESK_CORE_RUNTIME] S4A performance threshold exceeded - discarding result', {
                                        callSid,
                                        totalS4ADuration,
                                        threshold: 500,
                                        action: 'FALLBACK_TO_DISCOVERY_FLOW'
                                    });
                                    
                                    bufferEvent('S4A_PERFORMANCE_WARNING', {
                                        section: 'S4A_TOTAL',
                                        durationMs: totalS4ADuration,
                                        threshold: 500,
                                        action: 'CIRCUIT_BREAKER_TRIGGERED_FALLBACK'
                                    });
                                    
                                    // Discard S4A response, fall through to DiscoveryFlowRunner
                                    s4aResponse = null;
                                    scenarioResult = null;
                                }
                                
                                // ───────────────────────────────────────────────────────────────────────────
                                // S4B: OWNER DECISION (Proof of Who Responded)
                                // ───────────────────────────────────────────────────────────────────────────
                                currentSection = 'S4B_OWNER_DECISION';
                                
                                if (s4aResponse && scenarioResult?.scenario) {
                                    // S4A PIPELINE SPEAKS (Triage + Scenario matched)
                                    bufferEvent('SECTION_S4B_DISCOVERY_OWNER_SELECTED', {
                                        owner: 'TRIAGE_SCENARIO_PIPELINE',
                                        scenarioId: scenarioResult.scenario.scenarioId,
                                        scenarioType: scenarioResult.scenario.type,
                                        tier: scenarioResult.tier,
                                        confidence: scenarioResult.confidence,
                                        triageIntent: triageResult?.intentGuess || null,
                                        urgency: triageResult?.signals?.urgency || null,
                                        totalS4ADuration,
                                        reason: 'TRIAGE_AND_SCENARIO_MATCHED'
                                    });
                                    
                                    ownerResult = {
                                        response: s4aResponse,
                                        matchSource: 'TRIAGE_SCENARIO_PIPELINE',
                                        scenarioId: scenarioResult.scenario.scenarioId,
                                        scenarioType: scenarioResult.scenario.type,
                                        tier: scenarioResult.tier,
                                        triageIntent: triageResult?.intentGuess,
                                        urgency: triageResult?.signals?.urgency,
                                        state: state
                                    };
                                    
                                    logger.info('[FRONT_DESK_CORE_RUNTIME] S4B: Using TRIAGE_SCENARIO_PIPELINE response', {
                                        callSid,
                                        scenarioId: scenarioResult.scenario.scenarioId,
                                        totalS4ADuration
                                    });
                                    
                                } else {
                                    // NO S4A MATCH - Fall through to DiscoveryFlowRunner
                                    const fallbackReason = !triageResult?._triageRan 
                                        ? 'TRIAGE_NOT_RAN'
                                        : !scenarioResult 
                                        ? 'SCENARIO_NOT_ATTEMPTED'
                                        : !scenarioResult.selected
                                        ? 'NO_SCENARIO_MATCH'
                                        : totalS4ADuration > 500
                                        ? 'CIRCUIT_BREAKER_TRIGGERED'
                                        : 'S4A_PRODUCED_NO_RESPONSE';
                                    
                                    bufferEvent('SECTION_S4B_DISCOVERY_OWNER_SELECTED', {
                                        owner: 'DISCOVERY_FLOW',
                                        totalS4ADuration,
                                        reason: fallbackReason
                                    });
                                    
                                    logger.info('[FRONT_DESK_CORE_RUNTIME] S4B: Falling through to DISCOVERY_FLOW', {
                                        callSid,
                                        reason: fallbackReason
                                    });
                                    
                                    // ═══════════════════════════════════════════════════════════════════════════
                                    // S4: DISCOVERY FLOW RUNNER (V110 DETERMINISTIC - FALLBACK)
                                    // ═══════════════════════════════════════════════════════════════════════════
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
