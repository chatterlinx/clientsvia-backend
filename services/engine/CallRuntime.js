/**
 * ════════════════════════════════════════════════════════════════════════════
 * CALL RUNTIME - V2.0 (Nuclear Clean Sweep - Feb 22, 2026)
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * The single orchestrator for all call processing. Every turn goes through here.
 * 
 * ☢️ NUKED Feb 22, 2026: Renamed from FrontDeskCoreRuntime - all legacy deleted:
 *   - DiscoveryFlowRunner (DELETED)
 *   - ConsentGate (DELETED) 
 *   - BookingFlowRunner (DELETED)
 *   - BookingFlowResolver (DELETED)
 *   - SlotExtractor (DELETED)
 *   - FrontDeskRuntime (DELETED)
 * 
 * ARCHITECTURE:
 * ┌─────────────────────────────────────────────────────────────────────────┐
 * │ S1    Runtime Ownership (set mode)                                     │
 * │ S2    Input Text Truth (log what we got)                               │
 * │ S4    Discovery (Agent 2.0 ONLY)                                       │
 * │ S6    Booking (BookingLogicEngine ONLY)                                │
 * │ OPEN  Opener Engine (prepend micro-acknowledgment)                     │
 * └─────────────────────────────────────────────────────────────────────────┘
 * 
 * TWO MODULES ONLY:
 * - Agent 2.0 = Discovery (always on, permanent default)
 * - BookingLogicEngine = Booking (receives JSON payload from Discovery)
 * 
 * ════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../utils/logger');
const { StateStore, extractPlainSlots, writeSlotValue } = require('./StateStore');
const ScenarioEngine = require('../ScenarioEngine');
const { SectionTracer, SECTIONS } = require('./SectionTracer');
const { selectOpener, prependOpener } = require('./OpenerEngine');
const { Agent2DiscoveryRunner } = require('./agent2/Agent2DiscoveryRunner');
const BookingLogicEngine = require('./booking/BookingLogicEngine');

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
// AGENT 2.0 PERMANENT DEFAULT ENFORCEMENT
// ═══════════════════════════════════════════════════════════════════════════

const _breakGlassAuditThrottle = new Map();
function maybeAuditBreakGlass(companyId) {
    if (!ConfigAuditService?.logSystemEvent) return;
    if (!companyId || companyId === 'unknown') return;
    const now = Date.now();
    const last = _breakGlassAuditThrottle.get(companyId) || 0;
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
 * Agent 2.0 is PERMANENTLY ON. Config values are ignored.
 * Only break-glass env var can disable for allowlisted companyIds.
 */
function isAgent2Enabled(company, bufferEvent) {
    const companyId = company?._id?.toString() || 'unknown';
    const configEnabled = company?.aiAgentSettings?.agent2?.enabled;
    const configDiscoveryEnabled = company?.aiAgentSettings?.agent2?.discovery?.enabled;
    
    const breakGlassAllowlist = (process.env.AGENT2_FORCE_DISABLE_ALLOWLIST || '').split(',').map(s => s.trim()).filter(Boolean);
    const isBreakGlassActive = breakGlassAllowlist.includes(companyId);
    
    if (isBreakGlassActive) {
        if (bufferEvent) {
            bufferEvent('AGENT2_BREAK_GLASS_USED', {
                companyId,
                reason: 'Company in AGENT2_FORCE_DISABLE_ALLOWLIST',
                configWas: { enabled: configEnabled, discoveryEnabled: configDiscoveryEnabled },
                timestamp: new Date().toISOString()
            });
        }
        maybeAuditBreakGlass(companyId);
        logger.warn('[CALL_RUNTIME] AGENT2_BREAK_GLASS_USED', { companyId });
        return { enabled: false, reason: 'BREAK_GLASS_ALLOWLIST', enforced: false };
    }
    
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
    'CORE_RUNTIME_TURN_START',
    'CORE_RUNTIME_OWNER_RESULT',
    'CORE_RUNTIME_ERROR'
]);

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

// ═══════════════════════════════════════════════════════════════════════════
// BOOKING LOGIC LANE (V2.0 - STANDALONE, NO LEGACY)
// ═══════════════════════════════════════════════════════════════════════════
async function runBookingLogicLane({
    company,
    companyId,
    callSid,
    userInput,
    turn,
    bufferEvent,
    callState,
    state
}) {
    const startMs = Date.now();
    
    bufferEvent('ROUTING_MODE_ENFORCED', {
        mode: 'BOOKING',
        agent2Blocked: true,
        reason: 'session.mode is BOOKING - all turns route to BookingLogicEngine only'
    });
    
    const handoffPayload = {
        assumptions: {
            firstName: state?.plainSlots?.name || null,
            lastName: state?.plainSlots?.lastName || null,
            callerPhone: state?.plainSlots?.phone || callState?.callerPhone || null,
            callReason: state?.plainSlots?.call_reason_detail || null,
            address: state?.plainSlots?.address || null
        },
        discoveryContext: {
            companyId,
            callSid,
            turn,
            consentGrantedAt: state?.consent?.grantedAt || new Date().toISOString()
        }
    };
    
    const existingBookingCtx = state?.bookingCtx || null;
    
    bufferEvent('BOOKING_LOGIC_STEP_START', {
        hasExistingCtx: !!existingBookingCtx,
        currentStep: existingBookingCtx?.step || 'NAME',
        payloadKeys: Object.keys(handoffPayload.assumptions).filter(k => handoffPayload.assumptions[k])
    });
    
    let bookingResult;
    try {
        bookingResult = await BookingLogicEngine.computeStep(
            handoffPayload,
            existingBookingCtx,
            { userResponse: userInput }
        );
    } catch (err) {
        logger.error('[CALL_RUNTIME] BookingLogicEngine.computeStep FAILED', {
            callSid,
            error: err.message,
            stack: err.stack?.substring(0, 500)
        });
        bufferEvent('BOOKING_LOGIC_ENGINE_ERROR', {
            error: err.message,
            stack: err.stack?.substring(0, 300)
        });
        return {
            response: "One moment — I'm having trouble pulling up the system. Let me try again.",
            matchSource: 'BOOKING_LOGIC_ERROR_FALLBACK',
            complete: false,
            state: { ...state, lane: 'BOOKING' }
        };
    }
    
    const latencyMs = Date.now() - startMs;
    
    if (bookingResult.error) {
        bufferEvent('BOOKING_LOGIC_REJECTED', {
            error: bookingResult.error,
            trace: bookingResult.trace,
            latencyMs
        });
        return {
            response: "One moment — there's an issue with the booking info. Let me start fresh.",
            matchSource: 'BOOKING_LOGIC_REJECTED',
            complete: false,
            state: { ...state, lane: 'BOOKING', bookingCtx: null }
        };
    }
    
    const nextState = {
        ...state,
        lane: 'BOOKING',
        sessionMode: 'BOOKING',
        bookingCtx: bookingResult.bookingCtx,
        consent: { pending: false, askedExplicitly: false }
    };
    
    const isComplete = bookingResult.bookingComplete === true;
    
    bufferEvent('BOOKING_LOGIC_STEP_RESULT', {
        nextPromptPreview: (bookingResult.nextPrompt || '').substring(0, 120),
        currentStep: bookingResult.bookingCtx?.step || 'UNKNOWN',
        nameStage: bookingResult.bookingCtx?.name?.stage || null,
        isComplete,
        traceCount: bookingResult.trace?.length || 0,
        cacheHit: bookingResult.cacheHit,
        latencyMs
    });
    
    if (bookingResult.trace && bookingResult.trace.length > 0) {
        bufferEvent('BOOKING_LOGIC_TRACE', {
            steps: bookingResult.trace
        });
    }
    
    return {
        response: bookingResult.nextPrompt || "One moment while I check availability.",
        matchSource: 'BOOKING_LOGIC_ENGINE',
        complete: isComplete,
        state: nextState
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// CALL RUNTIME CLASS
// ═══════════════════════════════════════════════════════════════════════════

class CallRuntime {
    /**
     * Process a single turn of the conversation.
     * 
     * V2.0 FLOW:
     * 1. BOOKING mode → BookingLogicEngine speaks
     * 2. DISCOVERY mode → Agent 2.0 speaks (always on, permanent default)
     * 
     * @returns {Promise<Object>} { response, state, lane, signals, action, matchSource, turnEventBuffer }
     */
    static async processTurn(effectiveConfig, callState, userInput, context = {}) {
        const company = context.company || {};
        const callSid = context.callSid || context.sessionId || null;
        const companyId = context.companyId || company?._id?.toString?.() || null;
        const turn = callState?.turnCount || context.turnCount || 0;

        const turnEventBuffer = [];
        
        const bufferEvent = (type, data) => {
            turnEventBuffer.push(createEvent({ callSid, companyId, turn, type, data }));
        };

        let state = null;
        let tracer = null;
        let currentSection = 'INIT';
        
        try {
            state = StateStore.load(callState);

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

            bufferEvent('CORE_RUNTIME_TURN_START', {
                lane: state.lane,
                sessionMode: state.sessionMode || 'DISCOVERY',
                slotCount: Object.keys(state.plainSlots || {}).length,
                callReasonCaptured: !!state.plainSlots?.call_reason_detail
            });

            // ═══════════════════════════════════════════════════════════════════════════
            // ROUTE TO APPROPRIATE ENGINE
            // ═══════════════════════════════════════════════════════════════════════════
            let ownerResult;
            
            if (state.lane === 'BOOKING' || state.sessionMode === 'BOOKING') {
                // ───────────────────────────────────────────────────────────────────────────
                // BOOKING MODE: BookingLogicEngine is the ONLY speaker
                // ───────────────────────────────────────────────────────────────────────────
                currentSection = 'S6_BOOKING_FLOW';
                tracer.enter(SECTIONS.S6_BOOKING_FLOW);
                ownerResult = await runBookingLogicLane({
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
                // DISCOVERY MODE: Agent 2.0 is the ONLY speaker (permanent default)
                // ───────────────────────────────────────────────────────────────────────────
                currentSection = 'S4_DISCOVERY_FLOW';
                tracer.enter(SECTIONS.S4_DISCOVERY_ENGINE);
                
                if (agent2Enabled) {
                    currentSection = 'A2_DISCOVERY';
                    
                    bufferEvent('A2_LEGACY_BLOCKED', {
                        blocked: true,
                        blockedOwners: ['ALL_LEGACY_DELETED'],
                        reason: 'Agent 2.0 is permanent default - no legacy fallback exists',
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
                    
                    bufferEvent('A2_MIC_OWNER_PROOF', {
                        agent2Enabled: true,
                        agent2Ran: true,
                        agent2Responded: !!ownerResult?.response,
                        finalResponder: ownerResult?.matchSource || 'AGENT2_DISCOVERY',
                        agent2Enforced: agent2Check.enforced,
                        enforcementReason: agent2Check.reason,
                        permanentDefault: true,
                        legacyDeleted: true,
                        turn,
                        inputPreview: (userInput || '').substring(0, 60),
                        responsePreview: (ownerResult?.response || '').substring(0, 80),
                        configHash: company?.aiAgentSettings?.agent2?.meta?.uiBuild || null
                    });
                    
                    bufferEvent('A2_MIC_OWNER_CONFIRMED', {
                        owner: 'AGENT2_DISCOVERY',
                        permanentDefault: true,
                        enforced: agent2Check.enforced,
                        turn
                    });
                } else {
                    // Break-glass path - Agent 2.0 disabled
                    // Return a graceful error since legacy discovery no longer exists
                    bufferEvent('BREAK_GLASS_NO_LEGACY', {
                        reason: 'Agent 2.0 disabled via break-glass but legacy discovery DELETED',
                        breakGlassActive: true,
                        enforcementReason: agent2Check.reason,
                        turn
                    });
                    
                    logger.error('[CALL_RUNTIME] BREAK_GLASS_NO_FALLBACK - Legacy discovery DELETED', {
                        callSid,
                        companyId,
                        reason: 'BREAK_GLASS_ALLOWLIST_BUT_LEGACY_DELETED'
                    });
                    
                    ownerResult = {
                        response: "I'm sorry, I'm having trouble with the system. How can I help you today?",
                        matchSource: 'BREAK_GLASS_NO_FALLBACK',
                        state
                    };
                }
            }

            currentSection = 'PERSIST_STATE';
            const persistedState = StateStore.persist(callState, ownerResult.state || state);
            const lane = persistedState.sessionMode === 'BOOKING' ? 'BOOKING' : 'DISCOVERY';

            bufferEvent('TURN_CONTRACT', {
                lane,
                discoveryComplete: persistedState.discoveryComplete === true,
                consentPending: persistedState.bookingConsentPending === true,
                stepId: persistedState.discoveryCurrentStepId || persistedState.currentStepId || null,
                inputTextSource: context?.inputTextSource || null,
                inputTextLength: (userInput || '').length
            });

            // ═══════════════════════════════════════════════════════════════════════════
            // OPENER ENGINE
            // ═══════════════════════════════════════════════════════════════════════════
            currentSection = 'OPENER_ENGINE';
            const openerConfig = company?.aiAgentSettings?.frontDeskBehavior?.openers || {};
            const callerName = state?.plainSlots?.name || null;
            
            const openerResult = selectOpener({
                userText: inputText,
                reasonShort: null,
                openerConfig,
                turnCount: turn,
                callSid,
                callerName
            });
            
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
            
            const skipOpener =
                (ownerResult?.matchSource === 'AGENT2_DISCOVERY') ||
                (lane === 'DISCOVERY' && /^got it\b/i.test(ownerResult?.response || ''));
            
            if (openerResult.opener && !skipOpener) {
                finalResponse = prependOpener(openerResult.opener, ownerResult.response);
            }
            
            bufferEvent('SECTION_OPENER_ENGINE', {
                enabled: openerConfig.enabled !== false,
                mode: openerConfig.mode || 'micro_ack_only',
                turnCount: turn,
                openerSelected: openerResult.opener || null,
                tone: openerResult.tone,
                prependApplied: openerResult.opener && !skipOpener ? true : false,
                originalResponsePreview: (ownerResult.response || '').substring(0, 60),
                finalResponsePreview: (finalResponse || '').substring(0, 80)
            });

            currentSection = 'EMIT_RESULT';
            bufferEvent('CORE_RUNTIME_OWNER_RESULT', {
                lane,
                matchSource: ownerResult.matchSource,
                responsePreview: (finalResponse || '').substring(0, 120),
                bookingComplete: ownerResult.complete === true,
                openerApplied: openerResult.opener ? true : false,
                architecture: 'V2_CLEAN_SWEEP'
            });

            logger.info('[CALL_RUNTIME] Turn result', {
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
            logger.error('[CALL_RUNTIME] CRASH in processTurn', {
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
     * Flush turn event buffer to CallLogger.
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
                    logger.error('[CALL_RUNTIME] Critical event flush failed', {
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

// ☢️ NUKED Feb 2026: FrontDeskCoreRuntime alias removed - all callers updated to use CallRuntime

module.exports = { CallRuntime, CRITICAL_EVENTS };
