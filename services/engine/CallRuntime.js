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
// ERROR FALLBACK RESOLVER (UI-CONFIGURED, NO HARDCODED STRINGS)
// ═══════════════════════════════════════════════════════════════════════════
// Resolves error/recovery messages from UI config instead of hardcoding.
// Priority: recoveryMessages.{type} → emergencyFallbackLine → minimal safe
// ═══════════════════════════════════════════════════════════════════════════

function resolveErrorFallback(company, type, bufferEvent) {
    const recoveryMessages = company?.aiAgentSettings?.llm0Controls?.recoveryMessages || {};
    const agent2Config = company?.aiAgentSettings?.agent2 || {};
    
    // Type-specific fallback mapping
    const typeToRecoveryKey = {
        generalError: 'generalError',
        bookingError: 'generalError',
        bookingRejected: 'generalError',
        audioUnclear: 'audioUnclear',
        noSpeech: 'noSpeech',
        timeout: 'timeout',
        technicalTransfer: 'technicalTransfer'
    };
    
    const recoveryKey = typeToRecoveryKey[type] || 'generalError';
    
    // Try recovery message variants
    let variants = recoveryMessages[recoveryKey];
    if (Array.isArray(variants) && variants.length > 0) {
        return variants[Math.floor(Math.random() * variants.length)];
    }
    if (typeof variants === 'string' && variants.trim()) {
        return variants.trim();
    }
    
    // Fallback to emergency line
    const emergencyLine = agent2Config.emergencyFallbackLine?.text;
    if (emergencyLine && typeof emergencyLine === 'string' && emergencyLine.trim()) {
        return emergencyLine.trim();
    }
    
    // Last resort: minimal safe acknowledgment (better than "repeat that")
    bufferEvent?.('EMERGENCY_FALLBACK_NOT_CONFIGURED', {
        severity: 'WARNING',
        type,
        recoveryKey,
        message: `No UI-configured fallback for type="${type}". Using minimal safe.`,
        attemptedPaths: [
            `aiAgentSettings.llm0Controls.recoveryMessages.${recoveryKey}`,
            'aiAgentSettings.agent2.emergencyFallbackLine.text'
        ]
    });
    
    return 'I can help you with that.';
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
    'CORE_RUNTIME_ERROR',
    'TURN_TRACE_SUMMARY'  // The single source of truth for debugging
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
    
    // 🔍 SCRABENGINE AUTO-WIRE: Include handoff-eligible extracted entities
    const scrabEngineEntities = state?.agent2?.scrabEngine?.handoffEntities || state?.agent2?.scrabEngine?.entities || {};
    
    const followUpBookingMode = state?.agent2?.discovery?.bookingMode || null;
    const consentBucket = state?.consent?.bucket || null;
    const consentMatchedPhrases = Array.isArray(state?.consent?.matchedPhrases) ? state.consent.matchedPhrases : [];
    const handoffPayload = {
        assumptions: {
            firstName: scrabEngineEntities.firstName || state?.plainSlots?.name || null,
            lastName: scrabEngineEntities.lastName || state?.plainSlots?.lastName || null,
            phone: scrabEngineEntities.phone || null,
            email: scrabEngineEntities.email || null,
            // All ScrabEngine custom extractions auto-wired
            ...Object.fromEntries(
                Object.entries(scrabEngineEntities).filter(([key]) => 
                    !['firstName', 'lastName', 'fullName', 'phone', 'email', 'address'].includes(key)
                )
            ),
            callerPhone: state?.plainSlots?.phone || callState?.callerPhone || null,
            callReason: state?.plainSlots?.call_reason_detail || null,
            address: state?.plainSlots?.address || null,
            bookingMode: followUpBookingMode
        },
        discoveryContext: {
            companyId,
            callSid,
            turn,
            consentGrantedAt: state?.consent?.grantedAt || new Date().toISOString(),
            consent: {
                bucket: consentBucket,
                matchedPhrases: consentMatchedPhrases
            }
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
        
        // Resolve booking error fallback from UI config
        const bookingErrorResponse = resolveErrorFallback(company, 'bookingError', bufferEvent);
        return {
            response: bookingErrorResponse,
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
        
        // Resolve booking rejected fallback from UI config
        const bookingRejectedResponse = resolveErrorFallback(company, 'bookingRejected', bufferEvent);
        return {
            response: bookingRejectedResponse,
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
                    
                    // Resolve break-glass fallback from UI config
                    const breakGlassResponse = resolveErrorFallback(company, 'generalError', bufferEvent);
                    ownerResult = {
                        response: breakGlassResponse,
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
                    // Resolve empty response fallback from UI bridge lines (these are hold/wait messages)
                    const bridgeLines = company?.aiAgentSettings?.agent2?.bridge?.lines || [];
                    if (Array.isArray(bridgeLines) && bridgeLines.length > 0) {
                        finalResponse = bridgeLines[Math.floor(Math.random() * bridgeLines.length)];
                    } else {
                        finalResponse = resolveErrorFallback(company, 'generalError', bufferEvent);
                    }
                    bufferEvent('SECTION_EMPTY_RESPONSE_FALLBACK', {
                        matchSource: ownerResult?.matchSource || null,
                        lane,
                        reason: 'OWNER_RETURNED_EMPTY_RESPONSE',
                        resolvedFrom: bridgeLines.length > 0 ? 'bridge.lines' : 'generalError'
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

            // ═══════════════════════════════════════════════════════════════════════════
            // TURN_TRACE_SUMMARY - THE SINGLE SOURCE OF TRUTH FOR DEBUGGING
            // ═══════════════════════════════════════════════════════════════════════════
            // This event consolidates ALL turn decisions into one record.
            // If you're hunting "hidden hardcoded" or "triggers not firing", start here.
            // ═══════════════════════════════════════════════════════════════════════════
            const triggerCard = ownerResult.triggerCard || null;
            const isUiOwned = !!(
                triggerCard?.id ||
                ownerResult.matchSource === 'AGENT2_DISCOVERY' ||
                ownerResult.matchSource === 'BOOKING_LOGIC_ENGINE' ||
                ownerResult.uiPath ||
                ownerResult.errorFallbackUiPath
            );
            
            bufferEvent('TURN_TRACE_SUMMARY', {
                // WHO OWNED THE MIC
                ownerSelected: lane === 'BOOKING' ? 'BOOKING_ENGINE' : 
                               (agent2Enabled ? 'AGENT2_DISCOVERY' : 'BREAK_GLASS_FALLBACK'),
                agent2Enabled,
                agent2Ran: agent2Enabled && ownerResult.matchSource !== 'BREAK_GLASS_NO_FALLBACK',
                
                // TRIGGER EVALUATION
                triggerPoolCount: ownerResult._triggerPoolCount ?? null,
                triggerMatched: triggerCard ? {
                    ruleId: triggerCard.id,
                    label: triggerCard.label,
                    matchType: triggerCard.matchType,
                    matchedOn: triggerCard.matchedOn
                } : null,
                
                // EXIT REASON (why triggers might not have fired)
                exitReason: ownerResult._exitReason || null,
                
                // WHAT FALLBACK WAS USED (if any)
                fallbackUsed: ownerResult._fallbackUsed || null,
                
                // RESPONSE PROVENANCE - THE KEY QUESTION
                responseSource: {
                    type: isUiOwned ? 'UI_OWNED' : 'HARDCODED',
                    uiPath: ownerResult.uiPath || triggerCard?.id ? 
                            `aiAgentSettings.agent2.discovery.playbook.rules[id=${triggerCard?.id}]` : null,
                    matchSource: ownerResult.matchSource
                },
                
                // INPUT SUMMARY
                inputSummary: {
                    rawLen: (userInput || '').length,
                    inputTextSource: context?.inputTextSource || 'unknown'
                },
                
                // RESPONSE SUMMARY
                responseSummary: {
                    len: (finalResponse || '').length,
                    hasAudio: !!ownerResult.audioUrl,
                    openerApplied: !!(openerResult.opener && !skipOpener)
                },
                
                // SECTION TRAIL (for crash diagnosis)
                sectionTrail: tracer?.getTrailString() || null,
                
                // VERDICT - One-liner for quick scanning
                verdict: triggerCard ? `TRIGGER:${triggerCard.label || triggerCard.id}` :
                         ownerResult.matchSource === 'AGENT2_DISCOVERY' ? 'AGENT2:LLM_OR_FALLBACK' :
                         lane === 'BOOKING' ? 'BOOKING_ENGINE' :
                         `FALLBACK:${ownerResult.matchSource}`
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
            
            // ═══════════════════════════════════════════════════════════════════════════
            // RESOLVE ERROR FALLBACK FROM UI CONFIG (NO HARDCODED STRINGS)
            // ═══════════════════════════════════════════════════════════════════════════
            // Priority:
            // 1. llm0Controls.recoveryMessages.generalError (UI-configured)
            // 2. agent2.emergencyFallbackLine.text (UI-configured)  
            // 3. Minimal safe acknowledgment (last resort, system-level)
            // ═══════════════════════════════════════════════════════════════════════════
            const recoveryMessages = company?.aiAgentSettings?.llm0Controls?.recoveryMessages || {};
            const agent2Config = company?.aiAgentSettings?.agent2 || {};
            
            let errorResponse = null;
            let errorUiPath = null;
            
            // Try generalError from Recovery Messages
            const generalErrorVariants = recoveryMessages.generalError;
            if (Array.isArray(generalErrorVariants) && generalErrorVariants.length > 0) {
                errorResponse = generalErrorVariants[Math.floor(Math.random() * generalErrorVariants.length)];
                errorUiPath = 'aiAgentSettings.llm0Controls.recoveryMessages.generalError';
            } else if (typeof generalErrorVariants === 'string' && generalErrorVariants.trim()) {
                errorResponse = generalErrorVariants.trim();
                errorUiPath = 'aiAgentSettings.llm0Controls.recoveryMessages.generalError';
            }
            
            // Fallback to agent2.emergencyFallbackLine
            if (!errorResponse) {
                const emergencyLine = agent2Config.emergencyFallbackLine?.text;
                if (emergencyLine && typeof emergencyLine === 'string' && emergencyLine.trim()) {
                    errorResponse = emergencyLine.trim();
                    errorUiPath = 'aiAgentSettings.agent2.emergencyFallbackLine.text';
                }
            }
            
            // Last resort: minimal safe acknowledgment (not a "repeat" request)
            if (!errorResponse) {
                errorResponse = 'I can help you with that.';
                errorUiPath = 'SYSTEM_MINIMAL_SAFE_FALLBACK';
                bufferEvent('EMERGENCY_FALLBACK_NOT_CONFIGURED', {
                    severity: 'CRITICAL',
                    message: 'Runtime crashed but no generalError or emergencyFallbackLine configured',
                    attemptedPaths: [
                        'aiAgentSettings.llm0Controls.recoveryMessages.generalError',
                        'aiAgentSettings.agent2.emergencyFallbackLine.text'
                    ],
                    usedFallback: errorResponse
                });
            }
            
            bufferEvent('ERROR_FALLBACK_RESOLVED', {
                errorResponse: errorResponse?.substring(0, 80),
                uiPath: errorUiPath,
                crashSection: currentSection,
                originalError: error.message
            });
            
            // ═══════════════════════════════════════════════════════════════════════════
            // TURN_TRACE_SUMMARY - ERROR PATH
            // ═══════════════════════════════════════════════════════════════════════════
            // CRITICAL: This is the "mic stolen by crash" scenario.
            // Agent2 never got to speak because processTurn() threw.
            // ═══════════════════════════════════════════════════════════════════════════
            const isErrorUiOwned = errorUiPath && !errorUiPath.includes('SYSTEM_MINIMAL');
            
            bufferEvent('TURN_TRACE_SUMMARY', {
                // WHO OWNED THE MIC - Crash stole it
                ownerSelected: 'CORE_ERROR_FALLBACK',
                agent2Enabled: null,  // Unknown - crashed before we could check
                agent2Ran: false,     // CRITICAL: Agent2 never ran
                
                // TRIGGER EVALUATION - Never happened
                triggerPoolCount: null,
                triggerMatched: null,
                
                // EXIT REASON - The crash
                exitReason: 'RUNTIME_CRASH',
                crashSection: currentSection,
                crashError: error.message,
                
                // WHAT FALLBACK WAS USED
                fallbackUsed: isErrorUiOwned ? 'UI_ERROR_FALLBACK' : 'SYSTEM_MINIMAL_SAFE',
                
                // RESPONSE PROVENANCE
                responseSource: {
                    type: isErrorUiOwned ? 'UI_OWNED' : 'SYSTEM_FALLBACK',
                    uiPath: errorUiPath,
                    matchSource: 'UI_ERROR_FALLBACK'
                },
                
                // INPUT SUMMARY
                inputSummary: {
                    rawLen: (userInput || '').length,
                    inputTextSource: context?.inputTextSource || 'unknown'
                },
                
                // RESPONSE SUMMARY
                responseSummary: {
                    len: (errorResponse || '').length,
                    hasAudio: false,
                    openerApplied: false
                },
                
                // SECTION TRAIL - Where did it crash?
                sectionTrail: tracer?.getTrailString() || currentSection,
                
                // VERDICT - Clear indicator of crash
                verdict: `CRASH:${currentSection}:${error.message?.substring(0, 50)}`
            });
            
            return {
                response: errorResponse,
                state: state || callState,
                lane: 'DISCOVERY',
                signals: { escalate: false, bookingComplete: false },
                action: 'CONTINUE',
                matchSource: 'UI_ERROR_FALLBACK',
                errorFallbackUiPath: errorUiPath,
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
