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
 * SPEAKER OWNERSHIP CONTRACT (V118 - AGENT 2.0 TAKEOVER):
 * Only these modules may generate final response text:
 * - GreetingInterceptor (instant greetings ONLY)
 * - Agent2DiscoveryRunner (PRIMARY discovery speaker when enabled)
 * - DiscoveryFlowRunner (LEGACY — only if Agent 2.0 is disabled)
 * - ConsentGate (ONLY after discovery complete)
 * - BookingFlowRunner (ONLY after consent)
 * - OpenerEngine (prepends micro-acks to responses)
 * 
 * V118: Agent 2.0 owns the mic. No fallback to legacy when enabled.
 * Legacy DiscoveryFlowRunner only runs if Agent 2.0 is OFF.
 * 
 * RAW EVENTS:
 * Every section emits SECTION_* events for complete observability.
 * See docs/RAW_EVENTS_MAP.md for the full list.
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../utils/logger');
const { StateStore, extractPlainSlots, writeSlotValue } = require('./StateStore');
const { DiscoveryFlowRunner } = require('./DiscoveryFlowRunner');
const { ConsentGate } = require('./ConsentGate');
const BookingFlowRunner = require('./booking/BookingFlowRunner');
const BookingFlowResolver = require('./booking/BookingFlowResolver');
const ScenarioEngine = require('../ScenarioEngine');
const { SectionTracer, SECTIONS } = require('./SectionTracer');
const SlotExtractor = require('./booking/SlotExtractor');
const { selectOpener, prependOpener } = require('./OpenerEngine');
const { Agent2DiscoveryRunner } = require('./agent2/Agent2DiscoveryRunner');

// Interceptors - modular pattern matchers
const GreetingInterceptor = require('./interceptors/GreetingInterceptor');
// NOTE: CallReasonExtractor REMOVED in V117 Nuclear Cut - was hijacking turn ownership
// NOTE: S3.5 detection trigger block removed in V117 clean-sweep (unused + crash risk)

// ═══════════════════════════════════════════════════════════════════════════
// V118: AGENT 2.0 TAKEOVER - ONE MIC ARCHITECTURE
// ═══════════════════════════════════════════════════════════════════════════
// DECISION: Agent2DiscoveryRunner owns the mic when enabled. No fallback.
// 
// V117 (Feb 17, 2026): Removed S4A Pipeline, CallReasonExtractor hijack.
// V118 (Feb 18, 2026): Agent 2.0 is the ONLY speaker when enabled.
//                      Legacy DiscoveryFlowRunner only runs if Agent 2.0 OFF.
// 
// RATIONALE: One brain, one mic. Agent 2.0 Trigger Cards are deterministic.
// No competing speakers. No fallback confusion.
// ═══════════════════════════════════════════════════════════════════════════

// Agent 2.0 uses CallLogger (not legacy BlackBox name)
let CallLogger = null;
try {
    CallLogger = require('../CallLogger');
} catch (err) {
    CallLogger = null;
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

function readSlotValue(slots, slotId) {
    const entry = slots?.[slotId];
    if (entry == null) return null;
    if (typeof entry === 'object' && !Array.isArray(entry)) {
        if (entry.v != null) return entry.v;
        if (entry.value != null) return entry.value;
    }
    return entry;
}

// Verbose events flag - set to false when Agent 2.0 owns the turn to suppress legacy noise
let verboseEvents = true;

function checkpoint(bufferEvent, name, data = {}) {
    if (!verboseEvents) return; // Suppress when Agent 2.0 is active
    bufferEvent('FD_CHECKPOINT', {
        checkpoint: name,
        ...data
    });
}

function sectionEvent(bufferEvent, name, data = {}) {
    if (!verboseEvents) return; // Suppress when Agent 2.0 is active
    bufferEvent(name, data);
}

function buildPreExtractedBookingSlots(state = {}) {
    const out = {};
    const plain = state.plainSlots || {};
    const meta = state.slotMeta || {};
    Object.entries(plain).forEach(([slotId, value]) => {
        if (value == null || `${value}`.trim() === '') return;
        const m = meta?.[slotId] || {};
        out[slotId] = {
            value,
            confidence: m.confidence ?? 0.8,
            source: m.source || 'discovery'
        };
    });
    return out;
}

async function runBookingLane({
    company,
    companyId,
    callSid,
    userInput,
    turn,
    bufferEvent,
    callState,
    state
}) {
    const resolvedFlow = BookingFlowResolver.resolve({
        companyId,
        trade: null,
        serviceType: null,
        company
    });

    bufferEvent('SECTION_S6_BOOKING_FLOW_RESOLVED', {
        flowId: resolvedFlow?.flowId || null,
        stepCount: resolvedFlow?.steps?.length || 0,
        source: resolvedFlow?.resolution?.source || resolvedFlow?.source || null,
        status: resolvedFlow?.resolution?.status || null
    });

    // Ensure booking runner sees the latest extracted truth in its canonical slots bag.
    const slotsBag = state.slots || callState.slots || {};
    Object.entries(state.plainSlots || {}).forEach(([slotId, value]) => {
        writeSlotValue(slotsBag, slotId, value, 'discovery');
    });

    const bookingRunnerState = {
        ...(callState || {}),
        // Canonical slots store used by BookingFlowRunner.initializeState
        slots: slotsBag,
        // Keep legacy view for compatibility paths inside BookingFlowRunner
        bookingCollected: {
            ...(callState?.bookingCollected || {}),
            ...(state.plainSlots || {})
        },
        slotMetadata: state.slotMeta || callState?.slotMetadata || {}
    };

    const preExtractedSlots = buildPreExtractedBookingSlots(state);
    const bookingResult = await BookingFlowRunner.runStep({
        flow: resolvedFlow,
        state: bookingRunnerState,
        userInput,
        company,
        session: { metrics: { totalTurns: turn } },
        callSid,
        slots: preExtractedSlots
    });

    bufferEvent('SECTION_S6_BOOKING_FLOW_RESULT', {
        replyPreview: (bookingResult?.reply || '').substring(0, 120),
        isComplete: bookingResult?.isComplete === true,
        action: bookingResult?.action || null,
        nextStepId: bookingResult?.state?.currentStepId || null
    });

    const nextSlotsBag = bookingResult?.state?.slots || slotsBag;
    const nextPlainFromSlots = extractPlainSlots(nextSlotsBag);

    const nextState = {
        ...state,
        lane: 'BOOKING',
        slots: nextSlotsBag,
        plainSlots: { ...(state.plainSlots || {}), ...(nextPlainFromSlots || {}) },
        consent: { pending: false, askedExplicitly: false },
        booking: {
            ...state.booking,
            currentStepId: bookingResult?.state?.currentStepId || state.booking?.currentStepId || null,
            bookingComplete:
                bookingResult?.isComplete === true ||
                bookingResult?.action === 'COMPLETE' ||
                bookingResult?.state?.bookingComplete === true
        }
    };

    return {
        response: bookingResult?.reply || 'Okay — let me grab a few details to get you scheduled.',
        matchSource: 'BOOKING_FLOW_RUNNER',
        complete: nextState.booking.bookingComplete === true,
        state: nextState
    };
}

function formatCallReasonForSpeech(rawReason) {
    const reason = `${rawReason || ''}`.trim();
    if (!reason) return null;

    // If SlotExtractor produced label list ("a; b; c"), make it sound natural.
    const parts = reason
        .split(';')
        .map((p) => `${p}`.trim())
        .filter(Boolean);

    const lower = parts.map((p) => p.toLowerCase());
    const hasNotCooling = lower.includes('ac not cooling') || lower.some((p) => p.includes('not cool'));
    const hasLeak = lower.includes('water leak') || lower.some((p) => p.includes('leak'));
    const hasNotRunning = lower.includes('system not running') || lower.includes('system not working');

    // Prefer compact HVAC phrasing.
    const out = [];
    if (hasNotCooling) out.push('AC not cooling');
    if (hasLeak) out.push('leaking water');
    if (!hasNotCooling && hasNotRunning) out.push('system not running');

    if (out.length > 0) {
        if (out.length === 1) return out[0];
        if (out.length === 2) return `${out[0]} and ${out[1]}`;
        return `${out[0]}, ${out[1]}`;
    }

    // Generic: keep at most two items, join naturally.
    if (parts.length === 1) return parts[0];
    return `${parts[0]} and ${parts[1]}`;
}

function sanitizeScenarioAssistText(text) {
    const raw = `${text || ''}`.trim();
    if (!raw) return null;

    // Remove any booking/CTA sentences so we don't double-ask consent.
    const sentences = raw
        .split(/(?<=[.!?])\s+/)
        .map((s) => `${s}`.trim())
        .filter(Boolean)
        .filter((s) => !/\b(would you like|why don'?t we|can i|get (?:a|the) technician|schedule (?:a|an)|book (?:a|an))\b/i.test(s));

    const kept = sentences.length > 0 ? sentences.slice(0, 2).join(' ') : raw;
    const clipped = kept.length > 240 ? `${kept.substring(0, 237).trim()}...` : kept;
    return clipped || null;
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
     * V117 CHANGE: S4A removed (clean sweep). No competing speakers.
     * 
     * @returns {Promise<Object>} { response, state, lane, signals, action, matchSource, turnEventBuffer }
     */
    static async processTurn(effectiveConfig, callState, userInput, context = {}) {
        const company = context.company || {};
        const callSid = context.callSid || context.sessionId || null;
        const companyId = context.companyId || company?._id?.toString?.() || null;
        const turn = callState?.turnCount || context.turnCount || 0;

        // Reset verbose events at the start of each turn
        verboseEvents = true;

        // ═══════════════════════════════════════════════════════════════════════════
        // TURN EVENT BUFFER
        // ═══════════════════════════════════════════════════════════════════════════
        const turnEventBuffer = [];
        
        // Event types to suppress when Agent 2.0 is active (verboseEvents = false)
        const suppressedEventTypes = new Set([
            'SECTION_S1_RUNTIME_OWNER',
            'SECTION_S1_5_CONNECTION_QUALITY_GATE',
            'SECTION_S2_5_ESCALATION_DETECTION',
            'SECTION_S3_SLOT_EXTRACTION',
            'SECTION_S3_PENDING_SLOTS_STORED',
            'SECTION_S3_CALL_REASON_OVERWRITE_BLOCKED',
            'SECTION_OPENER_ENGINE',
            'CORE_RUNTIME_TURN_START',
            'CORE_RUNTIME_OWNER_RESULT',
            'FD_OWNER_PROOF',
            'TURN_CONTRACT'
        ]);
        
        const bufferEvent = (type, data) => {
            // Suppress verbose legacy events when Agent 2.0 is active
            if (!verboseEvents && suppressedEventTypes.has(type)) return;
            turnEventBuffer.push(createEvent({ callSid, companyId, turn, type, data }));
        };

        let state = null;
        let tracer = null;
        let currentSection = 'INIT';
        
        try {
            state = StateStore.load(callState);
            checkpoint(bufferEvent, 'STATE_LOADED', {
                lane: state.lane,
                turnCount: turn,
                plainSlotKeys: Object.keys(state.plainSlots || {}),
                pendingSlotKeys: Object.keys(state.pendingSlots || {}),
                discoveryStepId: state.discovery?.currentStepId || null,
                discoverySlotId: state.discovery?.currentSlotId || null
            });
            
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
                    
                    // V4: SPEECH_SOURCE_SELECTED for Call Review transcript attribution
                    bufferEvent('SPEECH_SOURCE_SELECTED', {
                        sourceId: 'connectionQualityGate.dtmfEscape',
                        uiPath: 'aiAgentSettings.frontDeskBehavior.connectionQualityGate.dtmfEscapeMessage',
                        uiTab: 'LLM-0 Behavior → Connection Quality Gate',
                        configPath: 'frontDeskBehavior.connectionQualityGate.dtmfEscapeMessage',
                        spokenTextPreview: cqDtmfMessage.substring(0, 120),
                        note: `DTMF escape after ${callState._connectionTroubleCount} connection troubles (max: ${cqMaxRetries})`,
                        isFromUiConfig: true
                    });
                    
                    logger.warn('[FRONT_DESK_CORE_RUNTIME] Connection quality gate: DTMF escape triggered', {
                        callSid,
                        troubleCount: callState._connectionTroubleCount,
                        maxRetries: cqMaxRetries
                    });
                    
                    // V126: ROUTING_PROVENANCE - Log routing decision for No-UI-No-Execute compliance
                    bufferEvent('ROUTING_PROVENANCE', {
                        routingId: 'dtmf.catastrophicMenu',
                        uiPath: 'aiAgentSettings.frontDeskBehavior.connectionQualityGate.dtmfOptions',
                        uiTab: 'LLM-0 Behavior',
                        configPath: 'frontDeskBehavior.connectionQualityGate',
                        action: 'DTMF_ESCAPE',
                        reason: `Connection quality gate triggered DTMF menu after ${callState._connectionTroubleCount} troubles`,
                        isFromUiConfig: true,
                        dtmfOptions: {
                          option1: 'Transfer to agent',
                          option2: 'Leave voicemail'
                        },
                        turn: turn
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
                    
                    // V4: SPEECH_SOURCE_SELECTED for Call Review transcript attribution
                    bufferEvent('SPEECH_SOURCE_SELECTED', {
                        sourceId: 'connectionQualityGate.clarification',
                        uiPath: 'aiAgentSettings.frontDeskBehavior.connectionQualityGate.clarificationPrompt',
                        uiTab: 'LLM-0 Behavior → Connection Quality Gate',
                        configPath: 'frontDeskBehavior.connectionQualityGate.clarificationPrompt',
                        spokenTextPreview: cqClarificationPrompt.substring(0, 120),
                        note: `Connection trouble detected (${troubleReason}), retry ${callState._connectionTroubleCount}/${cqMaxRetries}`,
                        isFromUiConfig: true
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
            checkpoint(bufferEvent, 'INPUT_TEXT_SELECTED', {
                inputTextSource: inputSource,
                sttConfidence: context.sttConfidence ?? null,
                inputTextLength: inputText.length
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
            // This handles instant responses from Global Settings → Instant Responses:
            // "good morning" → "Good morning! How can I help you today?"
            // Must happen BEFORE we run SlotExtractor or Discovery.
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'GREETING_INTERCEPT';
            
            // V119: Check if utterance passes the short-greeting gate BEFORE trying to match
            const isShortEnough = GreetingInterceptor.isShortGreeting(inputText);
            const greetingMatch = GreetingInterceptor.tryIntercept(inputText, company, state);
            
            // V119: ALWAYS emit greeting evaluation proof (whether it matched or not)
            bufferEvent('GREETING_EVALUATED', {
                inputPreview: inputText.substring(0, 60),
                inputWordCount: (inputText || '').split(/\s+/).filter(w => w.length > 0).length,
                isShortGreeting: isShortEnough,
                matched: !!greetingMatch,
                matchedTrigger: greetingMatch?.matchedTrigger || null,
                blockedReason: !isShortEnough ? 'UTTERANCE_TOO_LONG_FOR_GREETING' : (greetingMatch ? null : 'NO_RULE_MATCHED'),
                turn
            });
            
            if (greetingMatch) {
                // Log the intercept
                bufferEvent('GREETING_INTERCEPTED', {
                    matchedTrigger: greetingMatch.matchedTrigger,
                    matchType: greetingMatch.matchType,
                    responsePreview: greetingMatch.response.substring(0, 80),
                    sectionTrail: tracer.getTrailString()
                });
                
                // V4: SPEECH_SOURCE_SELECTED for Call Review transcript attribution
                // This is a LEGACY greeting interceptor path (not Agent 2.0)
                bufferEvent('SPEECH_SOURCE_SELECTED', {
                    sourceId: 'legacy.greetingInterceptor',
                    uiPath: 'aiAgentSettings.frontDeskBehavior.greetingResponses',
                    uiTab: 'Global Settings → Instant Responses',
                    configPath: `greetingResponses.${greetingMatch.matchedTrigger || 'generic'}`,
                    spokenTextPreview: greetingMatch.response?.substring(0, 120),
                    note: `Legacy greeting interceptor matched: "${greetingMatch.matchedTrigger}" (${greetingMatch.matchType})`,
                    isLegacy: true
                });
                
                // V119: Emit MIC_OWNER_PROOF for greeting intercept path
                // This proves Agent 2.0 was BYPASSED because greeting matched
                const agent2Enabled =
                    company?.aiAgentSettings?.agent2?.enabled === true &&
                    company?.aiAgentSettings?.agent2?.discovery?.enabled === true;
                    
                bufferEvent('A2_MIC_OWNER_PROOF', {
                    agent2Enabled,
                    agent2Ran: false,
                    agent2Responded: false,
                    finalResponder: 'GREETING_INTERCEPTOR',
                    // PROOF: Greeting intercepted BEFORE Agent 2.0 could run
                    greetingInterceptorRan: true,
                    greetingMatched: greetingMatch.matchedTrigger,
                    legacyDiscoveryRan: false,
                    scenarioEngineAutoRan: false,
                    callReasonExtractorAckRan: false,
                    consentGateRan: false,
                    bookingFlowRan: false,
                    openerEngineRan: false,
                    // Why Agent 2.0 didn't run
                    bypassReason: 'GREETING_INTERCEPTED_EARLY_RETURN',
                    turn,
                    inputPreview: inputText.substring(0, 40)
                });
                
                logger.info('[FRONT_DESK_CORE_RUNTIME] Greeting intercepted', {
                    callSid,
                    trigger: greetingMatch.matchedTrigger,
                    matchType: greetingMatch.matchType
                });
                
                // HARD RETURN: Greeting owns this turn, nothing else runs
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
            
            // V120: Check if there's a pending question from Agent 2.0
            // If so, we should NOT extract call_reason_detail (prevents "yes please" poisoning)
            const hasPendingQuestion = state.agent2?.discovery?.pendingQuestion && 
                                       state.agent2?.discovery?.pendingQuestionTurn === (turn - 1);
            
            // V120: Emit event when pending question guard is active
            if (hasPendingQuestion) {
                bufferEvent('PENDING_QUESTION_SLOT_GUARD', {
                    blockedSlots: ['call_reason_detail'],
                    reason: 'User is responding to yes/no question - do not poison call_reason',
                    pendingQuestion: state.agent2.discovery.pendingQuestion?.substring(0, 60),
                    pendingQuestionTurn: state.agent2.discovery.pendingQuestionTurn
                });
            }
            
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
                    sessionMode: state.sessionMode || 'DISCOVERY',
                    // V120: Block call_reason extraction when pending question exists
                    hasPendingQuestion: hasPendingQuestion,
                    pendingQuestionText: hasPendingQuestion ? state.agent2.discovery.pendingQuestion : null
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

            // ═══════════════════════════════════════════════════════════════════════════
            // V118: CALL REASON TRUTH GUARDS (prevent consent utterance overwrite)
            // ═══════════════════════════════════════════════════════════════════════════
            const consentTurn = state?.consent?.pending === true && state?.consent?.askedExplicitly === true;
            const existingReason = `${state?.plainSlots?.call_reason_detail || ''}`.trim();
            const extractedReasonMeta = extractedMeta?.call_reason_detail || null;
            const extractedReasonValue = `${plainValues?.call_reason_detail || ''}`.trim();
            const extractedIsFallback =
                extractedReasonMeta?.patternSource === 'call_reason_fallback_utterance' ||
                extractedReasonMeta?.patternSource === 'fallback_utterance';

            if (consentTurn && extractedReasonValue) {
                delete plainValues.call_reason_detail;
                bufferEvent('SECTION_S3_CALL_REASON_OVERWRITE_BLOCKED', {
                    reason: 'CONSENT_TURN',
                    existingPreview: existingReason.substring(0, 80) || null,
                    blockedPreview: extractedReasonValue.substring(0, 80),
                    patternSource: extractedReasonMeta?.patternSource || null
                });
            } else if (existingReason && extractedReasonValue && extractedIsFallback) {
                delete plainValues.call_reason_detail;
                bufferEvent('SECTION_S3_CALL_REASON_OVERWRITE_BLOCKED', {
                    reason: 'EXISTING_REASON_PROTECTED_FROM_FALLBACK',
                    existingPreview: existingReason.substring(0, 80),
                    blockedPreview: extractedReasonValue.substring(0, 80),
                    patternSource: extractedReasonMeta?.patternSource || null
                });
            }

            state.plainSlots = { ...state.plainSlots, ...plainValues };
            checkpoint(bufferEvent, 'SLOTS_MERGED', {
                extractedSlotIds: Object.keys(plainValues || {}),
                plainSlotKeys: Object.keys(state.plainSlots || {}),
                pendingSlotKeys: Object.keys(state.pendingSlots || {})
            });
            
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
            // V117: CALL REASON EXTRACTION REMOVED
            // ═══════════════════════════════════════════════════════════════════════════
            // CallReasonExtractor acknowledgment DELETED - was hijacking turn ownership.
            // Call reason extraction now happens INSIDE DiscoveryFlowRunner steps.
            // DiscoveryFlowRunner is the ONLY speaker during DISCOVERY lane.
            // ═══════════════════════════════════════════════════════════════════════════

            bufferEvent('CORE_RUNTIME_TURN_START', {
                lane: state.lane,
                consentPending: state.consent?.pending === true,
                slotCount: Object.keys(state.plainSlots || {}).length,
                callReasonCaptured: !!state.plainSlots.call_reason_detail,
                sectionTrail: tracer.getTrailString()
            });
            checkpoint(bufferEvent, 'OWNER_SELECTION_START', {
                lane: state.lane,
                plainSlotKeys: Object.keys(state.plainSlots || {}),
                discoveryStepId: state.discovery?.currentStepId || null,
                discoverySlotId: state.discovery?.currentSlotId || null
            });

            // ═══════════════════════════════════════════════════════════════════════════
            // V117: ONE BRAIN OWNER SELECTION - NUCLEAR CUT
            // ═══════════════════════════════════════════════════════════════════════════
            // RULE: DiscoveryFlowRunner is the ONLY speaker during DISCOVERY lane.
            // 
            // FLOW:
            // 1. BOOKING lane → BookingFlowRunner speaks
            // 2. DISCOVERY lane → DiscoveryFlowRunner speaks (ONLY)
            // 3. ConsentGate evaluates AFTER discovery completes (never hijacks)
            //
            // DELETED (Feb 17, 2026):
            // - S4A Triage pipeline (competing speaker)
            // - ScenarioEngine auto-responses (competing speaker)
            // - CallReasonExtractor acknowledgment hijack
            // - Intent detection bypass (was skipping discovery)
            // ═══════════════════════════════════════════════════════════════════════════
            let ownerResult;
            
            if (state.lane === 'BOOKING') {
                // ───────────────────────────────────────────────────────────────────────────
                // BOOKING LANE: BookingFlowRunner is the ONLY speaker
                // ───────────────────────────────────────────────────────────────────────────
                currentSection = 'S6_BOOKING_FLOW';
                tracer.enter(SECTIONS.S6_BOOKING_FLOW);
                ownerResult = await runBookingLane({
                    company,
                    companyId,
                    callSid,
                    userInput,
                    turn,
                    bufferEvent,
                    callState,
                    state
                });
                
            } else {
                // ───────────────────────────────────────────────────────────────────────────
                // DISCOVERY LANE: DiscoveryFlowRunner is the ONLY speaker
                // ───────────────────────────────────────────────────────────────────────────
                // V117: No competing owners. No triage. No scenarios. Just discovery steps.
                
                currentSection = 'S4_DISCOVERY_FLOW';
                tracer.enter(SECTIONS.S4_DISCOVERY_ENGINE);

                // ───────────────────────────────────────────────────────────────────────────
                // V117b: CONSENT PENDING MUST BE EVALUATED BEFORE DISCOVERY RUNS
                // ───────────────────────────────────────────────────────────────────────────
                if (state?.consent?.pending === true && state?.consent?.askedExplicitly === true) {
                    currentSection = 'S5_CONSENT_GATE_EVAL';
                    const consentEval = ConsentGate.evaluate({ company, userInput, state, callSid });
                    if (consentEval.turnEventBuffer) {
                        turnEventBuffer.push(...consentEval.turnEventBuffer);
                    }

                    if (consentEval.granted) {
                        state.lane = 'BOOKING';
                        state.consent = { pending: false, askedExplicitly: false };
                        bufferEvent('SECTION_S5_CONSENT_GRANTED', {
                            previousLane: 'DISCOVERY',
                            newLane: 'BOOKING',
                            action: 'TRANSITION_AND_RUN_BOOKING_THIS_TURN'
                        });

                        currentSection = 'S6_BOOKING_FLOW';
                        tracer.enter(SECTIONS.S6_BOOKING_FLOW);
                        ownerResult = await runBookingLane({
                            company,
                            companyId,
                            callSid,
                            userInput,
                            turn,
                            bufferEvent,
                            callState,
                            state
                        });
                    } else if (consentEval.pending === true) {
                        currentSection = 'S5_CONSENT_PENDING';
                        const askResult = ConsentGate.ask({ company, state, callSid });
                        if (askResult.turnEventBuffer) {
                            turnEventBuffer.push(...askResult.turnEventBuffer);
                        }
                        state.discovery = state.discovery || {};
                        state.discovery.currentStepId = state.discovery.currentStepId || 'dConsent';
                        state.discovery.currentSlotId = 'booking_consent';
                        ownerResult = askResult;
                    } else {
                        bufferEvent('SECTION_S5_CONSENT_DENIED', {
                            previousLane: 'DISCOVERY',
                            action: 'STAY_IN_DISCOVERY'
                        });
                        ownerResult = {
                            response: "No problem. What can I help you with today?",
                            matchSource: 'CONSENT_GATE',
                            state: { ...state, lane: 'DISCOVERY', consent: { pending: false, askedExplicitly: false } }
                        };
                    }
                }

                // ───────────────────────────────────────────────────────────────────────────
                // V117b: DISCOVERY SEQUENCE POLICY (REASON → CONSENT → BOOKING)
                // ───────────────────────────────────────────────────────────────────────────
                if (!ownerResult) {
                    // ───────────────────────────────────────────────────────────────────────────
                    // AGENT 2.0 (DISCOVERY ONLY) — Single mic owner, UI-gated
                    // ───────────────────────────────────────────────────────────────────────────
                    // V119: HARD ISOLATION - When Agent 2.0 is enabled:
                    // - It is the ONLY speaker
                    // - Legacy owners are BLOCKED (not just skipped)
                    // - We emit proof of blocking
                    const agent2Enabled =
                        company?.aiAgentSettings?.agent2?.enabled === true &&
                        company?.aiAgentSettings?.agent2?.discovery?.enabled === true;
                    
                    if (agent2Enabled) {
                        currentSection = 'A2_DISCOVERY';
                        verboseEvents = false; // Suppress legacy noise when Agent 2.0 active
                        
                        // V119: Emit legacy blocked proof BEFORE running Agent 2.0
                        bufferEvent('A2_LEGACY_BLOCKED', {
                            blocked: true,
                            blockedOwners: [
                                'DiscoveryFlowRunner',
                                'ScenarioEngine_auto',
                                'CallReasonExtractor_ack',
                                'S4A_Pipeline'
                            ],
                            reason: 'Agent 2.0 enabled - legacy owners will NOT be evaluated',
                            turn,
                            uiBuild: company?.aiAgentSettings?.agent2?.meta?.uiBuild || null
                        });
                        
                        ownerResult = await Agent2DiscoveryRunner.run({
                            company,
                            companyId,
                            callSid,
                            userInput,
                            state,
                            emitEvent: bufferEvent,
                            turn
                        });
                        
                        // ═══════════════════════════════════════════════════════════════════════════
                        // V119: A2_MIC_OWNER_PROOF — CONSOLIDATED PROOF OF WHAT RAN AND WHAT DIDN'T
                        // ═══════════════════════════════════════════════════════════════════════════
                        // This is the SINGLE event that proves hard isolation.
                        // Check this event to verify no other speaker executed.
                        // 
                        // NOTE: greetingEvaluated is TRUE because GREETING_EVALUATED event fired above.
                        // If greeting had matched, we would have returned early and never reached here.
                        bufferEvent('A2_MIC_OWNER_PROOF', {
                            agent2Enabled: true,
                            agent2Ran: true,
                            agent2Responded: !!ownerResult?.response,
                            finalResponder: ownerResult?.matchSource || 'AGENT2_DISCOVERY',
                            // PROOF: Greeting was evaluated but did NOT match (otherwise we wouldn't be here)
                            greetingInterceptorRan: false,  // Would have returned early if it fired
                            greetingEvaluated: true,        // See GREETING_EVALUATED event above
                            greetingBlocked: !isShortEnough, // True if blocked by short-greeting gate
                            greetingBlockReason: !isShortEnough ? 'UTTERANCE_TOO_LONG' : 'NO_RULE_MATCHED',
                            // PROOF: Legacy engines did NOT run
                            legacyDiscoveryRan: false,
                            scenarioEngineAutoRan: false,   // Only runs if useScenarioFallback=true inside Agent2
                            callReasonExtractorAckRan: false,
                            consentGateRan: false,
                            bookingFlowRan: false,
                            openerEngineRan: false,  // Skipped for Agent 2.0 responses
                            // Meta
                            turn,
                            inputPreview: (userInput || '').substring(0, 60),
                            responsePreview: (ownerResult?.response || '').substring(0, 80),
                            configHash: company?.aiAgentSettings?.agent2?.meta?.uiBuild || null
                        });
                        
                        // HARD RETURN: Do not evaluate any other speakers
                        // ownerResult is set, legacy path will be skipped by the agent2WasEnabled check
                    } else {
                        // Legacy path - emit that Agent 2.0 is OFF
                        bufferEvent('A2_LEGACY_BLOCKED', {
                            blocked: false,
                            reason: 'Agent 2.0 disabled - legacy owners may run',
                            turn
                        });
                    }
                }

                // ═══════════════════════════════════════════════════════════════════════════
                // LEGACY PATH: Only runs if Agent 2.0 is DISABLED
                // ═══════════════════════════════════════════════════════════════════════════
                const agent2WasEnabled =
                    company?.aiAgentSettings?.agent2?.enabled === true &&
                    company?.aiAgentSettings?.agent2?.discovery?.enabled === true;

                if (!ownerResult && !agent2WasEnabled) {
                    // Legacy DiscoveryFlowRunner — only if Agent 2.0 is OFF
                    bufferEvent('LEGACY_DISCOVERY_FLOW_ENTER', { reason: 'agent2_disabled' });
                    ownerResult = DiscoveryFlowRunner.run({
                        company,
                        callSid,
                        userInput,
                        state,
                        emitEvent: bufferEvent,
                        turn
                    });

                    const discoveryComplete =
                        ownerResult?.matchSource === 'DISCOVERY_FLOW_COMPLETE' ||
                        ownerResult?.state?.discovery?.complete === true;

                    const consentAlreadyAsked =
                        ownerResult?.state?.consent?.askedExplicitly === true ||
                        ownerResult?.state?.consent?.pending === true ||
                        state?.consent?.askedExplicitly === true ||
                        state?.consent?.pending === true;

                    if (discoveryComplete && !consentAlreadyAsked) {
                        currentSection = 'S5_CONSENT_PENDING';
                        bufferEvent('SECTION_S5_CONSENT_READY', {
                            discoveryComplete: true,
                            hasCallReason: !!ownerResult?.state?.plainSlots?.call_reason_detail,
                            hasName: !!ownerResult?.state?.plainSlots?.name,
                            hasPhone: !!ownerResult?.state?.plainSlots?.phone,
                            hasAddress: !!ownerResult?.state?.plainSlots?.address
                        });

                        const askResult = ConsentGate.ask({ company, state: ownerResult.state || state, callSid });
                        if (askResult.turnEventBuffer) {
                            turnEventBuffer.push(...askResult.turnEventBuffer);
                        }

                        // Observability pointers (do NOT let this change discovery flow ordering).
                        const nextState = askResult?.state || ownerResult.state || state;
                        nextState.discovery = nextState.discovery || {};
                        nextState.discovery.currentStepId = nextState.discovery.currentStepId || 'dConsent';
                        nextState.discovery.currentSlotId = 'booking_consent';

                        ownerResult = {
                            ...askResult,
                            // If discovery runner returned no prompt (complete), ConsentGate becomes speaker now.
                            response: askResult.response,
                            matchSource: 'CONSENT_GATE'
                        };
                    }
                }

                checkpoint(bufferEvent, 'DISCOVERY_FLOW_RETURNED', {
                    matchSource: ownerResult.matchSource,
                    stepId: ownerResult.state?.discovery?.currentStepId || null,
                    slotId: ownerResult.state?.discovery?.currentSlotId || null,
                    responsePreview: (ownerResult.response || '').substring(0, 80)
                });
                
                // EMIT PROOF EVENT: which owner actually spoke this turn
                const effectiveLane = ownerResult?.state?.lane || state?.lane || 'DISCOVERY';
                bufferEvent('FD_OWNER_PROOF', {
                    lane: effectiveLane,
                    owner: ownerResult?.matchSource || 'UNKNOWN',
                    stepId: ownerResult.state?.discovery?.currentStepId || null,
                    slotId: ownerResult.state?.discovery?.currentSlotId || null,
                    turnCount: turn,
                    architecture: 'V117_ONE_BRAIN'
                });

                logger.info('[FRONT_DESK_CORE_RUNTIME] V117b discovery result', {
                    callSid,
                    matchSource: ownerResult.matchSource,
                    stepId: ownerResult.state?.discovery?.currentStepId,
                    turn
                });
            }

            currentSection = 'PERSIST_STATE';
            const persistedState = StateStore.persist(callState, ownerResult.state || state);
            const lane = persistedState.sessionMode === 'BOOKING' ? 'BOOKING' : 'DISCOVERY';
            checkpoint(bufferEvent, 'STATE_PERSISTED', {
                lane,
                callReasonCaptured: persistedState.callReasonCaptured === true,
                namePresent: persistedState.namePresent === true,
                addressPresent: persistedState.addressPresent === true,
                discoveryStepId: persistedState.discoveryCurrentStepId || null,
                discoverySlotId: persistedState.discoveryCurrentSlotId || null
            });

            // ═══════════════════════════════════════════════════════════════════════════
            // TURN CONTRACT (single truth snapshot for debugging)
            // ═══════════════════════════════════════════════════════════════════════════
            // This is the one event you should be able to scan per turn to know:
            // lane, step, completion, consent state, and what slot we are asking next.
            bufferEvent('TURN_CONTRACT', {
                lane,
                discoveryComplete: persistedState.discoveryComplete === true,
                consentPending: persistedState.bookingConsentPending === true,
                stepId: persistedState.discoveryCurrentStepId || persistedState.currentStepId || null,
                nextSlotToAsk:
                    lane === 'BOOKING'
                        ? (persistedState.currentStepId || null)
                        : (persistedState.discoveryCurrentSlotId || null),
                inputTextSource: context?.inputTextSource || null,
                inputTextLength: (userInput || '').length
            });

            // ═══════════════════════════════════════════════════════════════════════════
            // OPENER ENGINE (V117 - Simplified, no scenario reflection)
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'OPENER_ENGINE';
            const openerConfig = company?.aiAgentSettings?.frontDeskBehavior?.openers || {};
            
            // V119: Pass caller name for personalized bridges ("Ok, Mark.")
            const callerName = state?.plainSlots?.name || null;
            
            const openerResult = selectOpener({
                userText: inputText,
                reasonShort: null, // V117: No call reason reflection in openers
                openerConfig,
                turnCount: turn,
                callSid,
                callerName
            });
            
            // Apply opener to response
            // When Agent 2.0 returns audioUrl (pre-recorded greeting/trigger card audio),
            // response is intentionally null — the audio IS the response.
            const hasAgent2Audio = !!ownerResult?.audioUrl;
            let finalResponse = ownerResult.response || '';
            if (!finalResponse || `${finalResponse}`.trim() === '') {
                if (hasAgent2Audio) {
                    finalResponse = '';
                } else {
                    finalResponse = "One moment — I'm pulling up your account.";
                    bufferEvent('SECTION_EMPTY_RESPONSE_FALLBACK', {
                        matchSource: ownerResult?.matchSource || null,
                        lane,
                        reason: 'OWNER_RETURNED_EMPTY_RESPONSE'
                    });
                }
            }
            // If we already crafted an empathy-style acknowledgment (consent ask turn),
            // skip micro-openers like "Understood." that make it sound robotic.
            const reasonExtractedThisTurn = state?.slotMeta?.call_reason_detail?.extractedInTurn === turn;
            const skipOpener =
                (ownerResult?.matchSource === 'DISCOVERY_REASON_CONSENT' && /^thanks,\s+/i.test(ownerResult?.response || '')) ||
                // Agent 2.0 responses should not be prefixed by legacy openers ("Alright.") — keep "Ok" contract.
                (ownerResult?.matchSource === 'AGENT2_DISCOVERY') ||
                // If we just acknowledged the call reason (starts with "Got it"), don't prepend "Great!" etc.
                (lane === 'DISCOVERY' && /^got it\b/i.test(ownerResult?.response || '')) ||
                // If call reason was extracted this turn, keep the top line clean and deterministic.
                (lane === 'DISCOVERY' && reasonExtractedThisTurn === true);
            if (openerResult.opener && !skipOpener) {
                finalResponse = prependOpener(openerResult.opener, ownerResult.response);
            }
            
            // EMIT OPENER ENGINE EVENT
            bufferEvent('SECTION_OPENER_ENGINE', {
                enabled: openerConfig.enabled !== false,
                mode: openerConfig.mode || 'micro_ack_only',
                turnCount: turn,
                openerSelected: openerResult.opener || null,
                tone: openerResult.tone,
                prependApplied: openerResult.opener && !skipOpener ? true : false,
                originalResponsePreview: (ownerResult.response || '').substring(0, 60),
                finalResponsePreview: (finalResponse || '').substring(0, 80),
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
                architecture: 'V117_ONE_BRAIN',
                sectionTrail: tracer.getTrailString()
            });

            logger.info('[FRONT_DESK_CORE_RUNTIME] V117 owner result', {
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
                audioUrl: ownerResult.audioUrl || null,
                triggerCard: ownerResult.triggerCard || null,
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
        if (!CallLogger?.logEvent || !Array.isArray(turnEventBuffer)) {
            return;
        }
        
        const criticalPromises = [];
        
        for (const event of turnEventBuffer) {
            const promise = CallLogger.logEvent({
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
