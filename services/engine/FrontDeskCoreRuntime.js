/**
 * ════════════════════════════════════════════════════════════════════════════
 * FRONT DESK CORE RUNTIME - V1.0 (Agent 2.0 Permanent Default)
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
 * │ S4    Discovery Flow (Agent 2.0 ONLY)                                  │
 * │ S5    Consent Gate (intent detection → booking consent)                │
 * │ S6    Booking Flow (collect remaining info)                            │
 * │ S7    Voice Provider (TTS output)                                      │
 * │ OPEN  Opener Engine (prepend micro-acknowledgment)                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 * 
 * SPEAKER OWNERSHIP CONTRACT (V1.0 - AGENT 2.0 PERMANENT DEFAULT):
 * Only these modules may generate final response text:
 * - Agent2DiscoveryRunner (THE discovery speaker - ALWAYS ON, includes greetings)
 * - DiscoveryFlowRunner (DEPRECATED - only via BREAK_GLASS)
 * - ConsentGate (ONLY after discovery complete)
 * - BookingFlowRunner (ONLY after consent)
 * - OpenerEngine (prepends micro-acks to responses)
 * 
 * NUKED (Feb 2026): Legacy GreetingInterceptor - replaced by Agent2GreetingInterceptor
 * 
 * V1.0 POLICY (PERMANENT):
 * - Agent 2.0 is the ONLY Discovery system
 * - Legacy Discovery is deprecated and unreachable (except via break-glass)
 * - UI cannot turn Agent2 off
 * - Runtime enforces Agent2 even if config is missing/wrong
 * - Break-glass: AGENT2_FORCE_DISABLE_ALLOWLIST env var only
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

// NOTE: All legacy interceptors REMOVED Feb 2026 Nuclear Cleanup:
// - GreetingInterceptor: replaced by Agent2GreetingInterceptor
// - CallReasonExtractor: REMOVED in V117 Nuclear Cut - was hijacking turn ownership
// - S3.5 detection trigger block: removed in V117 clean-sweep (unused + crash risk)

// ═══════════════════════════════════════════════════════════════════════════
// V1.0: AGENT 2.0 PERMANENT DEFAULT - ONE MIC ARCHITECTURE
// ═══════════════════════════════════════════════════════════════════════════
// DECISION: Agent2DiscoveryRunner owns the mic PERMANENTLY. No fallback.
// 
// V117 (Feb 17, 2026): Removed S4A Pipeline, CallReasonExtractor hijack.
// V118 (Feb 18, 2026): Agent 2.0 is the ONLY speaker when enabled.
// V1.0 (Feb 21, 2026): Agent 2.0 is PERMANENTLY ON. Config cannot disable.
//                      Legacy DiscoveryFlowRunner only via break-glass.
// 
// RATIONALE: One brain, one mic. Agent 2.0 Trigger Cards are deterministic.
// No competing speakers. No fallback confusion. No "why is it different today?"
// ═══════════════════════════════════════════════════════════════════════════

// Agent 2.0 uses CallLogger (not legacy BlackBox name)
let CallLogger = null;
try {
    CallLogger = require('../CallLogger');
} catch (err) {
    CallLogger = null;
}

// Optional: Config governance audit (NOT call review timeline)
let ConfigAuditService = null;
try {
    ConfigAuditService = require('../ConfigAuditService');
} catch (err) {
    ConfigAuditService = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// V1.0: AGENT 2.0 PERMANENT DEFAULT ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════
// Agent 2.0 is ALWAYS enabled. This is the only way to stop ghost bugs.
// Break-glass: AGENT2_FORCE_DISABLE_ALLOWLIST env var for emergency only.
// ═══════════════════════════════════════════════════════════════════════════

const _breakGlassAuditThrottle = new Map(); // companyId -> lastLoggedMs
function maybeAuditBreakGlass(companyId) {
    if (!ConfigAuditService?.logSystemEvent) return;
    if (!companyId || companyId === 'unknown') return;
    const now = Date.now();
    const last = _breakGlassAuditThrottle.get(companyId) || 0;
    // Avoid spamming: at most once per process per 30 minutes per company
    if (now - last < 30 * 60 * 1000) return;
    _breakGlassAuditThrottle.set(companyId, now);

    ConfigAuditService.logSystemEvent({
        companyId,
        action: 'AGENT2_BREAK_GLASS_ACTIVE',
        meta: {
            mutationKind: 'break_glass',
            breakGlassActive: true
        }
    }).catch(() => {});
}

/**
 * Check if Agent 2.0 should be enabled for this company.
 * V1.0: Agent 2.0 is PERMANENTLY ON. Config values are ignored.
 * Only break-glass env var can disable for allowlisted companyIds.
 * 
 * @param {Object} company - Company document
 * @param {Function} bufferEvent - Event emitter for proof events
 * @returns {{ enabled: boolean, reason: string, enforced: boolean }}
 */
function isAgent2Enabled(company, bufferEvent) {
    const companyId = company?._id?.toString() || 'unknown';
    const configEnabled = company?.aiAgentSettings?.agent2?.enabled;
    const configDiscoveryEnabled = company?.aiAgentSettings?.agent2?.discovery?.enabled;
    
    // Break-glass check: AGENT2_FORCE_DISABLE_ALLOWLIST env var
    const breakGlassAllowlist = (process.env.AGENT2_FORCE_DISABLE_ALLOWLIST || '').split(',').map(s => s.trim()).filter(Boolean);
    const isBreakGlassActive = breakGlassAllowlist.includes(companyId);
    
    if (isBreakGlassActive) {
        // Log break-glass usage
        if (bufferEvent) {
            bufferEvent('AGENT2_BREAK_GLASS_USED', {
                companyId,
                reason: 'Company in AGENT2_FORCE_DISABLE_ALLOWLIST',
                configWas: { enabled: configEnabled, discoveryEnabled: configDiscoveryEnabled },
                timestamp: new Date().toISOString()
            });
        }
        // Config governance trail (throttled)
        maybeAuditBreakGlass(companyId);
        logger.warn('[FRONT_DESK_CORE_RUNTIME] AGENT2_BREAK_GLASS_USED', { companyId });
        return { enabled: false, reason: 'BREAK_GLASS_ALLOWLIST', enforced: false };
    }
    
    // V1.0: Agent 2.0 is PERMANENTLY ON regardless of config
    const wasConfigMissing = configEnabled !== true || configDiscoveryEnabled !== true;
    
    if (wasConfigMissing && bufferEvent) {
        bufferEvent('AGENT2_DEFAULT_ENFORCED', {
            companyId,
            reason: 'missing_or_disabled_config',
            configWas: { enabled: configEnabled, discoveryEnabled: configDiscoveryEnabled },
            enforcedTo: { enabled: true, discoveryEnabled: true },
            timestamp: new Date().toISOString()
        });
    }
    
    return { 
        enabled: true, 
        reason: wasConfigMissing ? 'ENFORCED_DEFAULT' : 'CONFIG_MATCH',
        enforced: wasConfigMissing 
    };
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
// LEGACY PREEMPTORS - NUKED (Feb 2026)
// ═══════════════════════════════════════════════════════════════════════════
// DELETED: ConnectionQualityGate, EscalationDetector, CallReasonExtractor
// Agent 2.0 is now the ONLY responder. No preemptors hijack the conversation.
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

            // V1.0: Compute Agent2 enablement ONCE per turn for consistent enforcement/proof.
            // This emits AGENT2_DEFAULT_ENFORCED or AGENT2_BREAK_GLASS_USED as appropriate.
            const agent2Check = isAgent2Enabled(company, bufferEvent);
            const agent2Enabled = agent2Check.enabled;
            
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
            // S1.5: CONNECTION QUALITY GATE - NUKED (Feb 2026)
            // ═══════════════════════════════════════════════════════════════════════════
            // DELETED: Was hijacking Agent 2.0 on early turns with "hello?" detection.
            // Agent 2.0 now handles ALL input including connection-related utterances.
            // ═══════════════════════════════════════════════════════════════════════════
            
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
            // S2.5: ESCALATION DETECTION - NUKED (Feb 2026)
            // ═══════════════════════════════════════════════════════════════════════════
            // DELETED: Was hijacking Agent 2.0 with "manager"/"human" keyword detection.
            // Escalation/transfer requests are now handled by Agent 2.0 Trigger Cards.
            // ═══════════════════════════════════════════════════════════════════════════
            
            // ═══════════════════════════════════════════════════════════════════════════
            // GREETING INTERCEPT - NUKED (Feb 2026)
            // ═══════════════════════════════════════════════════════════════════════════
            // DELETED: Legacy GreetingInterceptor removed. Agent 2.0 now handles all
            // greeting responses via Agent2GreetingInterceptor in Agent2DiscoveryRunner.
            // ═══════════════════════════════════════════════════════════════════════════
            
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
                    // AGENT 2.0 (DISCOVERY ONLY) — Single mic owner, PERMANENT DEFAULT
                    // ───────────────────────────────────────────────────────────────────────────
                    // V1.0: HARD ISOLATION + PERMANENT DEFAULT
                    // - Agent 2.0 is ALWAYS enabled (config is ignored)
                    // - It is the ONLY speaker
                    // - Legacy owners are BLOCKED (not just skipped)
                    // - Break-glass only via AGENT2_FORCE_DISABLE_ALLOWLIST env var
                    // - We emit proof of blocking AND enforcement
                    // Use the turn-level computed truth (avoid duplicate enforcement events)
                    // NOTE: 'agent2Check' and 'agent2Enabled' are defined at top of try{} scope.
                    
                    if (agent2Enabled) {
                        currentSection = 'A2_DISCOVERY';
                        verboseEvents = false; // Suppress legacy noise when Agent 2.0 active
                        
                        // V119: Emit legacy blocked proof BEFORE running Agent 2.0
                        // V1.0: Also emit enforcement status
                        bufferEvent('A2_LEGACY_BLOCKED', {
                            blocked: true,
                            blockedOwners: [
                                'DiscoveryFlowRunner',
                                'ScenarioEngine_auto',
                                'CallReasonExtractor_ack',
                                'S4A_Pipeline'
                            ],
                            reason: agent2Check.enforced 
                                ? 'Agent 2.0 ENFORCED (config was missing/disabled) - legacy owners will NOT be evaluated'
                                : 'Agent 2.0 enabled - legacy owners will NOT be evaluated',
                            enforced: agent2Check.enforced,
                            enforcementReason: agent2Check.reason,
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
                        // V1.0: Added enforcement proof fields
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
                            // V1.0: Enforcement proof
                            agent2Enforced: agent2Check.enforced,
                            enforcementReason: agent2Check.reason,
                            permanentDefault: true,  // V1.0: Always true - Agent 2.0 is permanent
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
                        
                        // V1.0: Emit explicit mic owner confirmation
                        bufferEvent('A2_MIC_OWNER_CONFIRMED', {
                            owner: 'AGENT2_DISCOVERY',
                            permanentDefault: true,
                            enforced: agent2Check.enforced,
                            turn
                        });
                        
                        // HARD RETURN: Do not evaluate any other speakers
                        // ownerResult is set, legacy path will be skipped by the agent2WasEnabled check
                    } else {
                        // Legacy path - emit that Agent 2.0 is OFF (break-glass only)
                        // V1.0: This should ONLY happen via break-glass allowlist
                        bufferEvent('A2_LEGACY_BLOCKED', {
                            blocked: false,
                            reason: 'Agent 2.0 disabled via BREAK_GLASS_ALLOWLIST - legacy owners may run',
                            breakGlassActive: true,
                            enforcementReason: agent2Check.reason,
                            turn
                        });
                    }
                }

                // ═══════════════════════════════════════════════════════════════════════════
                // LEGACY PATH: Only runs if Agent 2.0 is DISABLED (break-glass only)
                // ═══════════════════════════════════════════════════════════════════════════
                // V1.0: Agent 2.0 is PERMANENTLY ON. This path is only reachable via break-glass.
                const agent2WasEnabled = agent2Enabled;

                if (!ownerResult && !agent2WasEnabled) {
                    // Legacy DiscoveryFlowRunner — only if Agent 2.0 is OFF (break-glass only)
                    // V1.0: This path is deprecated. It should only run via break-glass.
                    bufferEvent('LEGACY_DISCOVERY_FLOW_ENTER', { 
                        reason: 'agent2_disabled_via_break_glass',
                        deprecated: true,
                        warning: 'Legacy discovery is deprecated. Agent 2.0 is the permanent default.'
                    });
                    
                    // V1.0: Log that we're bypassing the permanent default
                    logger.warn('[FRONT_DESK_CORE_RUNTIME] LEGACY_DISCOVERY_BYPASSED - Using deprecated legacy path', {
                        callSid,
                        companyId,
                        reason: 'BREAK_GLASS_ALLOWLIST'
                    });
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
