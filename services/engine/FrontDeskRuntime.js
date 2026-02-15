/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * FRONT DESK RUNTIME - THE ONLY ORCHESTRATOR
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * PLATFORM LAW: This is the ONLY entry point for turn handling.
 * 
 * Everything else (LLM, scenarios, old booking handlers) becomes a PLUGIN
 * that can ONLY be invoked by FrontDeskRuntime. No bypass allowed.
 * 
 * Responsibilities:
 * 1. Pick the lane: DISCOVERY / BOOKING / ESCALATE
 * 2. Set bookingModeLocked
 * 3. Set consentPending
 * 4. Decide which prompt to speak next
 * 5. Call BookingFlowRunner (only when mode == BOOKING)
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../utils/logger');
const { cfgGet, getTrace, validateConfig, getFailClosedResponse, assertModeOwnership } = require('./ControlPlaneEnforcer');

// Lazy load plugins to avoid circular dependencies
let BookingFlowRunner = null;
let BookingFlowResolver = null;
let ConversationEngine = null;
let BlackBoxLogger = null;
let V111Router = null;
let OpenerEngine = null;
let SlotExtractor = null;

function loadPlugins() {
    if (!BookingFlowRunner) {
        try {
            const booking = require('./booking');
            BookingFlowRunner = booking.BookingFlowRunner;
            BookingFlowResolver = booking.BookingFlowResolver;
        } catch (e) {
            logger.warn('[FRONT_DESK_RUNTIME] BookingFlowRunner not available', { error: e.message });
        }
    }
    if (!ConversationEngine) {
        try {
            ConversationEngine = require('../ConversationEngine');
        } catch (e) {
            logger.warn('[FRONT_DESK_RUNTIME] ConversationEngine not available', { error: e.message });
        }
    }
    if (!OpenerEngine) {
        try {
            OpenerEngine = require('./OpenerEngine');
        } catch (e) {
            logger.warn('[FRONT_DESK_RUNTIME] OpenerEngine not available', { error: e.message });
        }
    }
    if (!BlackBoxLogger) {
        try {
            BlackBoxLogger = require('../BlackBoxLogger');
        } catch (e) {
            logger.debug('[FRONT_DESK_RUNTIME] BlackBoxLogger not available');
        }
    }
    // V111 Phase 4: Load V111Router for governance enforcement
    if (!V111Router) {
        try {
            V111Router = require('./V111Router');
        } catch (e) {
            logger.debug('[FRONT_DESK_RUNTIME] V111Router not available (Phase 4 governance disabled)', { error: e.message });
        }
    }
    // V117: Load SlotExtractor for consent-turn slot sweep
    if (!SlotExtractor) {
        try {
            SlotExtractor = require('./booking/SlotExtractor');
        } catch (e) {
            logger.warn('[FRONT_DESK_RUNTIME] SlotExtractor not available', { error: e.message });
        }
    }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LANES - The only valid execution paths
 * ═══════════════════════════════════════════════════════════════════════════════
 */
const LANES = {
    DISCOVERY: 'DISCOVERY',
    BOOKING: 'BOOKING',
    ESCALATE: 'ESCALATE'
};

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * V110: MERGE SLOT REGISTRY WITH BOOKING FLOW STEPS
 * ═══════════════════════════════════════════════════════════════════════════════
 * Helper to combine V110 slot definitions with booking flow step prompts
 */
function _mergeV110SlotsWithSteps(slots, steps) {
    if (!slots || !steps) return [];
    
    const stepMap = new Map();
    for (const step of steps) {
        if (step.slotId) stepMap.set(step.slotId, step);
    }
    
    return slots.map((slot, index) => {
        const slotId = slot.id || slot.slotId;
        const step = stepMap.get(slotId);
        
        return {
            id: slotId,
            slotId: slotId,
            type: slot.type || 'text',
            label: slot.label || slotId,
            required: slot.required !== false,
            order: step?.order || slot.order || index,
            question: step?.ask || `What is your ${slotId}?`,
            prompt: step?.ask || `What is your ${slotId}?`,
            confirmPrompt: step?.confirmPrompt || null,
            reprompt: step?.reprompt || `Could you repeat your ${slotId}?`,
            _v110: true
        };
    }).sort((a, b) => (a.order || 999) - (b.order || 999));
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * handleTurn() - THE ONLY ENTRY POINT FOR TURN HANDLING
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * @param {Object} effectiveConfig - The loaded Control Plane config (company.aiAgentSettings)
 * @param {Object} callState - Current call state from Redis
 * @param {string} userTurn - What the user said
 * @param {Object} context - Additional context (company, callSid, etc.)
 * 
 * @returns {Object} { response, state, lane, signals }
 */
async function handleTurn(effectiveConfig, callState, userTurn, context = {}) {
    const startTime = Date.now();
    const { company, callSid, turnCount = 0 } = context;
    const companyId = company?._id?.toString() || context.companyId || 'unknown';
    
    loadPlugins();
    
    // Get decision trace for this turn
    const trace = getTrace(callSid, turnCount);
    
    logger.info('[FRONT_DESK_RUNTIME] handleTurn() - SINGLE ORCHESTRATOR ENTRY', {
        callSid,
        companyId,
        turnCount,
        userTurnPreview: userTurn?.substring(0, 50),
        currentMode: callState?.sessionMode || 'DISCOVERY',
        bookingModeLocked: !!callState?.bookingModeLocked
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 1: Validate Control Plane is loaded
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 1: V110 Config Validation — UI is law
    // ═══════════════════════════════════════════════════════════════════════════
    const validation = validateConfig(effectiveConfig, callSid);
    
    logger.info('[FRONT_DESK_RUNTIME] V110 validation status', {
        callSid,
        validationOk: validation.valid,
        missingRequiredCount: validation.missingRequired?.length || 0
    });
    
    // Emit V110_CONFIG_VALIDATED or V110_CONFIG_INVALID event
    if (BlackBoxLogger) {
        const isV110Valid = validation.v110?.valid !== false;
        BlackBoxLogger.logEvent({
            callId: callSid,
            companyId,
            type: isV110Valid ? 'V110_CONFIG_VALIDATED' : 'V110_CONFIG_INVALID',
            turn: turnCount,
            data: {
                v110Valid: isV110Valid,
                missingV110: validation.v110?.missingV110 || [],
                invalidSteps: validation.v110?.invalidSteps || [],
                missingPrompts: validation.v110?.missingPrompts || [],
                slotRegistryCount: effectiveConfig?.frontDesk?.slotRegistry?.slots?.length || 0,
                discoveryFlowCount: effectiveConfig?.frontDesk?.discoveryFlow?.steps?.length || 0,
                bookingFlowCount: effectiveConfig?.frontDesk?.bookingFlow?.steps?.length || 0
            }
        }).catch(() => {});
    }
    
    if (!validation.valid) {
        logger.error('[FRONT_DESK_RUNTIME] FAIL CLOSED - V110 config invalid', {
            callSid,
            missingRequired: validation.missingRequired,
            v110MissingV110: validation.v110?.missingV110 || []
        });
        
        trace.addDecisionReason('FAIL_CLOSED', { 
            reason: 'V110_CONFIG_INVALID',
            missingRequired: validation.missingRequired,
            v110MissingV110: validation.v110?.missingV110 || []
        });
        
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'FRONT_DESK_FAIL_CLOSED',
                turn: turnCount,
                data: {
                    reason: 'V110_CONFIG_INVALID',
                    missingRequired: validation.missingRequired,
                    v110MissingV110: validation.v110?.missingV110 || []
                }
            }).catch(() => {});
        }
        
        const failResponse = getFailClosedResponse('MISSING_REQUIRED_KEY');
        return {
            response: failResponse.response,
            state: callState,
            lane: LANES.ESCALATE,
            action: failResponse.action,
            signals: { failClosed: true, escalate: true }
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V116: V110 RUNTIME GUARD — Audit config on Turn 1
    // ═══════════════════════════════════════════════════════════════════════════
    // Runs once per call (Turn 1). Logs V110_CONFIG_AUDIT and V110_RUNTIME_VIOLATION
    // to BlackBox so you can see in call review if this call used non-V110 config.
    // The guard never blocks — it only logs.
    // ═══════════════════════════════════════════════════════════════════════════
    const actualTurnForGuard = callState?.turnCount || turnCount;
    if (actualTurnForGuard <= 1) {
        try {
            const V110RuntimeGuard = require('../V110RuntimeGuard');
            V110RuntimeGuard.auditCallStart({
                company,
                callSid,
                companyId,
                effectiveConfig: effectiveConfig?.frontDeskBehavior 
                    ? effectiveConfig 
                    : { frontDeskBehavior: effectiveConfig }
            });
        } catch (guardErr) {
            // Guard must NEVER crash a call
            logger.warn('[FRONT_DESK_RUNTIME] V110RuntimeGuard error (non-fatal)', {
                callSid,
                error: guardErr.message
            });
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V116: DISCOVERY TRUTH WRITER — Captures "why they called" BEFORE gates
    // ═══════════════════════════════════════════════════════════════════════════
    // Must run BEFORE ConnectionQualityGate and SilenceHandler so that even if
    // a gate blanks the input, the caller's real words are already persisted.
    // Writes to callState.discovery.truth (first_utterance, call_reason_detail,
    // call_intent_guess). Only writes slots that exist in V110 discoveryFlow.
    // ═══════════════════════════════════════════════════════════════════════════
    try {
        const DiscoveryTruthWriter = require('./discovery/DiscoveryTruthWriter');
        const discoveryFlowConfig = effectiveConfig?.frontDeskBehavior?.discoveryFlow 
            || effectiveConfig?.frontDesk?.discoveryFlow 
            || null;
        
        const truthResult = DiscoveryTruthWriter.apply({
            callState,
            cleanedText: userTurn,
            turn: callState?.turnCount || turnCount,
            discoveryFlow: discoveryFlowConfig,
            callSid,
            companyId
        });
        
        trace.addDecisionReason('DISCOVERY_TRUTH', {
            intent: truthResult.call_intent_guess,
            confidence: truthResult.call_intent_confidence,
            hasFirstUtterance: !!truthResult.first_utterance,
            hasReason: !!truthResult.call_reason_detail
        });
    } catch (truthErr) {
        // TruthWriter must NEVER crash a call
        logger.warn('[FRONT_DESK_RUNTIME] DiscoveryTruthWriter error (non-fatal)', {
            callSid,
            error: truthErr.message
        });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 1.5: CONNECTION QUALITY GATE (V116 — de-fanged)
    // ═══════════════════════════════════════════════════════════════════════════
    // PURPOSE: Catch genuinely broken connections (static, dead air, garbage STT).
    // NOT for catching normal greetings. "Hello" on turn 1 is EXPECTED, not trouble.
    //
    // V116 RULES (stops hijacking scenario routing):
    //   1. NEVER fire on turn 1 for trouble phrases — greetings are normal
    //   2. Only fire for STT confidence on turn 1 if it's truly garbage (< 0.30)
    //   3. If input has real content (> 3 words after stripping greeting prefix),
    //      it's a real utterance — let it through regardless
    //   4. On turns 2-3, fire only for EXACT trouble phrase match (no prefix/suffix)
    //   5. After maxRetries, offer DTMF escape
    // ═══════════════════════════════════════════════════════════════════════════
    const cqGate = effectiveConfig?.frontDeskBehavior?.connectionQualityGate;
    const cqEnabled = cqGate?.enabled !== false;
    
    // V111 FIX: Use actual turn count from callState (Redis), not context.turnCount
    // which is always 1 on stateless servers (Render).
    const actualTurnCount = callState?.turnCount || turnCount;
    const hasPriorTrouble = (callState?._connectionTroubleCount || 0) > 0;
    
    // V130 FIX: Also skip gate when bookingConsentPending — the caller is responding
    // to a booking offer ("Would you like to schedule?"). Short affirmatives like "Yes"
    // with low STT confidence must reach determineLane() where CONSENT_WORDS handles them.
    if (cqEnabled && (actualTurnCount <= 3 || hasPriorTrouble) && !callState?.bookingModeLocked && !callState?.bookingConsentPending) {
        const sttConfidence = context.sttConfidence || 0;
        const threshold = cqGate?.confidenceThreshold || 0.72;
        const maxRetries = cqGate?.maxRetries || 3;
        const troublePhrases = cqGate?.troublePhrases || [
            'hello', 'hello?', 'hi', 'hi?', 'are you there',
            'can you hear me', 'is anyone there', 'is somebody there',
            'hey', 'hey?', 'anybody there'
        ];
        
        // Normalize input for trouble phrase matching
        const normalizedInput = (userTurn || '').toLowerCase().trim()
            .replace(/[.,!?;:]+/g, '').trim();
        
        // Count real words (alphanumeric tokens) to detect substantive content
        const realWords = normalizedInput.split(/\s+/).filter(w => w.replace(/[^a-z0-9]/g, '').length > 0);
        const hasSubstantiveContent = realWords.length > 3;
        
        // ═══════════════════════════════════════════════════════════════════
        // FILLER-ONLY BYPASS: If the input is empty after filler removal,
        // the caller just said "um" or "uh" while thinking. This is NOT a
        // connection quality issue — it's a natural speech pause. Let it pass
        // through to the normal silence/timeout handler instead of firing
        // the gate with a disruptive re-greeting.
        // ═══════════════════════════════════════════════════════════════════
        if (realWords.length === 0 && actualTurnCount >= 2) {
            logger.info('[FRONT_DESK_RUNTIME] CONNECTION_QUALITY_GATE: Filler-only input on turn 2+ — bypassing gate', {
                callSid,
                rawInput: userTurn?.substring(0, 30),
                turnCount: actualTurnCount,
                sttConfidence: (sttConfidence * 100).toFixed(1) + '%'
            });
            
            if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                    callId: callSid,
                    companyId,
                    type: 'CONNECTION_QUALITY_GATE',
                    turn: turnCount,
                    data: {
                        triggered: false,
                        reason: 'filler_only_bypass',
                        normalizedInput: normalizedInput?.substring(0, 50),
                        turnCount: actualTurnCount
                    }
                }).catch(() => {});
            }
            // Fall through to normal processing — silence handler will deal with it
        }
        
        // NEVER fire gate if caller said something real
        // "Hello my AC isn't cooling and it's leaking" → 8+ words → real utterance → let it through
        let isTroublePhrase = false;
        let isLowConfidence = false;
        
        if (!hasSubstantiveContent && realWords.length > 0) {
            // V116: Turn 1 — SKIP trouble phrase check entirely. 
            // "Hello" on turn 1 is how every call starts. Only check STT confidence
            // for genuinely unintelligible input (< 0.30 = garbled/static).
            if (actualTurnCount === 1) {
                // Turn 1: Only fire for truly garbage STT (not trouble phrases)
                isLowConfidence = sttConfidence > 0 && sttConfidence < 0.30;
            } else {
                // Turns 2-3 (or prior trouble): Check trouble phrases with EXACT match only
                // V116: Removed prefix/suffix matching — only exact match now
                // "Hi my name is..." should NEVER match. Only bare "hello?", "are you there?" etc.
                const MAX_TROUBLE_PHRASE_LENGTH = 25;
                isTroublePhrase = normalizedInput.length < MAX_TROUBLE_PHRASE_LENGTH && troublePhrases.some(phrase => {
                    return normalizedInput === phrase.toLowerCase().trim();
                });
                
                // STT confidence check on turns 2+ uses normal threshold
                isLowConfidence = sttConfidence > 0 && sttConfidence < threshold;
            }
        }
        
        if (isTroublePhrase || isLowConfidence) {
            // Increment connection trouble counter in call state
            const troubleCount = (callState._connectionTroubleCount || 0) + 1;
            callState._connectionTroubleCount = troubleCount;
            
            const reason = isTroublePhrase 
                ? `trouble_phrase_detected: "${normalizedInput}"`
                : `low_stt_confidence: ${(sttConfidence * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}%`;
            
            logger.info('[FRONT_DESK_RUNTIME] CONNECTION QUALITY GATE TRIGGERED', {
                callSid,
                companyId,
                turnCount: actualTurnCount,
                contextTurnCount: turnCount,
                troubleCount,
                maxRetries,
                reason,
                sttConfidence: (sttConfidence * 100).toFixed(1) + '%',
                userTurnPreview: userTurn?.substring(0, 50)
            });
            
            trace.addDecisionReason('CONNECTION_QUALITY_GATE', {
                triggered: true,
                reason,
                troubleCount,
                maxRetries,
                sttConfidence
            });
            
            if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                    callId: callSid,
                    companyId,
                    type: 'CONNECTION_QUALITY_GATE',
                    turn: turnCount,
                    data: {
                        triggered: true,
                        reason,
                        troubleCount,
                        maxRetries,
                        sttConfidence,
                        isTroublePhrase,
                        isLowConfidence,
                        normalizedInput: normalizedInput?.substring(0, 50)
                    }
                }).catch(() => {});
            }
            
            // Decide: re-greeting or DTMF escape?
            if (troubleCount >= maxRetries) {
                // DTMF ESCAPE — offer press 1 / press 2
                const dtmfMessage = cqGate?.dtmfEscapeMessage || 
                    "I'm sorry, we seem to have a bad connection. Press 1 to speak with a service advisor, or press 2 to leave a voicemail.";
                const transferDest = cqGate?.transferDestination || '';
                
                logger.info('[FRONT_DESK_RUNTIME] CONNECTION QUALITY GATE → DTMF ESCAPE', {
                    callSid, troubleCount, maxRetries, transferDest
                });
                
                return {
                    response: dtmfMessage,
                    state: callState,
                    lane: LANES.ESCALATE,
                    action: 'DTMF_ESCAPE',
                    signals: { 
                        escalate: false,
                        dtmfEscape: true,
                        transferDestination: transferDest
                    },
                    matchSource: 'CONNECTION_QUALITY_GATE',
                    metadata: { connectionTroubleCount: troubleCount }
                };
            } else {
                // CLARIFICATION PROMPT — ask caller to repeat
                // Never re-greet mid-call. The caller already knows who they called.
                const LEGACY_GREETING_PATTERNS = [
                    /^hi\s+there/i,
                    /^hello.*how can i help/i,
                    /^hey.*what can i do/i,
                    /^hi.*how can i help/i,
                    /^good\s+(morning|afternoon|evening)/i
                ];
                
                const DEFAULT_CLARIFICATION = "I'm sorry, I didn't quite catch that. Could you please repeat what you said?";
                
                // Read from config: prefer clarificationPrompt, fall back to legacy reGreeting
                let clarificationPrompt = cqGate?.clarificationPrompt || cqGate?.reGreeting || DEFAULT_CLARIFICATION;
                
                // Override any legacy greeting patterns that slipped through from old configs
                const isLegacyGreeting = LEGACY_GREETING_PATTERNS.some(p => p.test(clarificationPrompt));
                if (isLegacyGreeting) {
                    logger.warn('[FRONT_DESK_RUNTIME] Overriding legacy greeting in quality gate', {
                        callSid,
                        legacyValue: clarificationPrompt.substring(0, 50),
                        override: DEFAULT_CLARIFICATION.substring(0, 50)
                    });
                    clarificationPrompt = DEFAULT_CLARIFICATION;
                }
                
                return {
                    response: clarificationPrompt,
                    state: callState,
                    lane: LANES.DISCOVERY,
                    signals: {},
                    matchSource: 'CONNECTION_QUALITY_GATE',
                    metadata: { connectionTroubleCount: troubleCount }
                };
            }
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ABSOLUTE BOOKING GATE (V109) - PLATFORM LAW
    // ═══════════════════════════════════════════════════════════════════════════
    // If bookingModeLocked === true, ONLY BookingFlowRunner can respond.
    // This gate CANNOT be bypassed. No ConversationEngine. No LLM. No exceptions.
    // If BookingFlowRunner fails → fail-closed with FrontDesk escalation message.
    // ═══════════════════════════════════════════════════════════════════════════
    if (callState?.bookingModeLocked === true) {
        logger.info('[FRONT_DESK_RUNTIME] ABSOLUTE BOOKING GATE - bookingModeLocked=true → ONLY BookingFlowRunner can respond', {
            callSid,
            companyId,
            turnCount,
            userTurnPreview: userTurn?.substring(0, 50)
        });
        
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'ABSOLUTE_BOOKING_GATE_ENFORCED',
                turn: turnCount,
                data: {
                    bookingModeLocked: true,
                    forcedLane: 'BOOKING',
                    message: 'Lane determination SKIPPED - booking lock forces BOOKING lane. Only BookingFlowRunner can respond.'
                }
            }).catch(() => {});
        }
        
        trace.addDecisionReason('ABSOLUTE_BOOKING_GATE', { 
            reason: 'bookingModeLocked=true',
            forcedLane: 'BOOKING',
            normalLaneDeterminationSkipped: true
        });
        
        // ONLY run BookingFlowRunner - NO OTHER PATH
        const absoluteGateResult = await handleBookingLane(effectiveConfig, callState, userTurn, context, trace);
        
        // Ensure matchSource reflects the gate enforcement
        absoluteGateResult.matchSource = absoluteGateResult.matchSource || 'BOOKING_FLOW_RUNNER';
        absoluteGateResult.gateEnforced = 'ABSOLUTE_BOOKING_GATE';
        
        // Return immediately - no further processing
        const absoluteGateLatency = Date.now() - startTime;
        
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'ABSOLUTE_BOOKING_GATE_RESULT',
                turn: turnCount,
                data: {
                    lane: 'BOOKING',
                    matchSource: absoluteGateResult.matchSource,
                    responsePreview: absoluteGateResult.response?.substring(0, 100),
                    escalate: !!absoluteGateResult.signals?.escalate,
                    latencyMs: absoluteGateLatency
                }
            }).catch(() => {});
        }
        
        return {
            response: absoluteGateResult.response,
            state: callState,
            lane: LANES.BOOKING,
            action: absoluteGateResult.action,
            signals: absoluteGateResult.signals || {},
            matchSource: absoluteGateResult.matchSource,
            gateEnforced: 'ABSOLUTE_BOOKING_GATE'
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 2: Determine current lane (ONLY if booking is NOT locked)
    // ═══════════════════════════════════════════════════════════════════════════
    const currentLane = determineLane(effectiveConfig, callState, userTurn, trace, context);
    
    trace.addDecisionReason('LANE_SELECTED', { lane: currentLane });
    
    logger.info('[FRONT_DESK_RUNTIME] Lane determined', {
        callSid,
        lane: currentLane,
        bookingModeLocked: !!callState?.bookingModeLocked,
        consentPending: !!callState?.bookingConsentPending
    });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 3: Route to appropriate handler based on lane
    // ═══════════════════════════════════════════════════════════════════════════
    let result;
    
    switch (currentLane) {
        case LANES.BOOKING:
            result = await handleBookingLane(effectiveConfig, callState, userTurn, context, trace);
            break;
            
        case LANES.ESCALATE:
            result = await handleEscalateLane(effectiveConfig, callState, userTurn, context, trace);
            break;
            
        case LANES.DISCOVERY:
        default:
            result = await handleDiscoveryLane(effectiveConfig, callState, userTurn, context, trace);
            break;
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 4: Apply mode changes (ONLY FrontDeskRuntime can do this)
    // ═══════════════════════════════════════════════════════════════════════════
    if (result.signals?.enterBooking && !callState.bookingModeLocked) {
        assertModeOwnership('FrontDeskRouter', 'SET', 'bookingModeLocked');
        callState.bookingModeLocked = true;
        callState.sessionMode = 'BOOKING';
        trace.addModeChange('DISCOVERY', 'BOOKING', 'enterBooking signal');
        
        logger.info('[FRONT_DESK_RUNTIME] MODE CHANGE: DISCOVERY → BOOKING', {
            callSid,
            reason: result.signals.enterBookingReason || 'enterBooking signal'
        });
    }
    
    if (result.signals?.setConsentPending !== undefined) {
        assertModeOwnership('FrontDeskRouter', 'SET', 'consentPending');
        callState.bookingConsentPending = result.signals.setConsentPending;
        trace.addDecisionReason('CONSENT_PENDING_SET', { value: result.signals.setConsentPending });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // EMIT: FRONT_DESK_TURN_COMPLETE
    // ═══════════════════════════════════════════════════════════════════════════
    if (BlackBoxLogger) {
        BlackBoxLogger.logEvent({
            callId: callSid,
            companyId,
            type: 'FRONT_DESK_TURN_COMPLETE',
            turn: turnCount,
            data: {
                lane: currentLane,
                responsePreview: result.response?.substring(0, 100),
                bookingModeLocked: !!callState.bookingModeLocked,
                consentPending: !!callState.bookingConsentPending,
                durationMs: Date.now() - startTime
            }
        }).catch(() => {});
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V119: TRACE TRUTH PIPELINE — propagate tier/debug/tokensUsed from the
    // lane handler so v2twilio receives real ConversationEngine metadata.
    // Previously these were silently dropped, causing every strict-mode trace
    // to contain fabricated tier3 / SCENARIO_NO_MATCH events.
    // ═══════════════════════════════════════════════════════════════════════════
    return {
        response: result.response,
        text: result.response, // Alias for compatibility
        state: callState,
        lane: currentLane,
        signals: result.signals || {},
        action: result.action,
        matchSource: result.matchSource || 'FRONT_DESK_RUNTIME',
        tier: result.tier || null,
        tokensUsed: result.tokensUsed || 0,
        debug: result.debug || null,
        metadata: result.metadata || {}
    };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * determineLane() - Decide which lane to route to
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function determineLane(effectiveConfig, callState, userTurn, trace, context) {
    const { callSid, turnCount = 0 } = context;
    
    // V102: Helper to read config via cfgGet (traces reads in DecisionTrace)
    const getConfig = (key, defaultValue) => {
        try {
            const value = cfgGet(effectiveConfig, key, {
                callId: callSid,
                turn: turnCount,
                strict: false, // Don't throw in determineLane - use defaults
                readerId: 'FrontDeskRuntime.determineLane'
            });
            // V102 FIX: cfgGet returns undefined for missing keys - use default
            return (value !== undefined && value !== null) ? value : defaultValue;
        } catch (e) {
            logger.debug('[FRONT_DESK_RUNTIME] Config read fallback', { key, error: e.message });
            return defaultValue;
        }
    };
    
    // 1. If already in booking mode, stay there
    if (callState?.bookingModeLocked === true) {
        trace.addDecisionReason('LANE_BOOKING', { reason: 'bookingModeLocked=true' });
        return LANES.BOOKING;
    }
    
    // 2. Check for escalation triggers (V102: via cfgGet)
    const escalationTriggers = getConfig('frontDesk.escalation.triggerPhrases', []);
    const userTurnLower = (userTurn || '').toLowerCase();
    
    for (const trigger of escalationTriggers) {
        if (userTurnLower.includes(trigger.toLowerCase())) {
            trace.addDecisionReason('LANE_ESCALATE', { reason: 'escalation_trigger', trigger });
            return LANES.ESCALATE;
        }
    }
    
    // 3. Check for booking consent (yes-equivalent after consent question)
    // V116: Token-based matching — handles "yes please", "yeah sure", "ok thanks"
    // Old regex demanded entire input = single phrase. Natural responses always failed.
    if (callState?.bookingConsentPending === true) {
        // Consent words: any word that signals agreement or is harmless filler
        const CONSENT_WORDS = new Set([
            'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay',
            'please', 'thanks', 'thank', 'you', 'absolutely',
            'definitely', 'right', 'correct', 'go', 'ahead',
            'sounds', 'good', 'great', 'that', 'works', 'fine',
            'do', 'it', 'lets', "let's", 'can', 'we', 'alright'
        ]);
        
        // Clean: lowercase, strip punctuation, collapse spaces
        const cleanedForConsent = userTurnLower.trim()
            .replace(/[^a-z'\s]/g, '')      // keep only letters, apostrophes, spaces
            .replace(/\s+/g, ' ')            // collapse whitespace
            .trim();
        
        const tokens = cleanedForConsent.split(' ').filter(t => t.length > 0);
        
        // Consent rule: ≤4 tokens AND every token is a consent/filler word
        // This catches: "yes", "yes please", "yeah sure", "ok thanks",
        //   "sounds good", "go ahead", "that works", "lets do it"
        // Rejects: "yes my AC is broken" (non-consent words + too many tokens)
        const isConsent = tokens.length > 0 
            && tokens.length <= 4 
            && tokens.every(t => CONSENT_WORDS.has(t));
        
        // ═══════════════════════════════════════════════════════════════
        // V116 FIX: Accept leading affirmative + additional info
        // ═══════════════════════════════════════════════════════════════
        const LEADING_CONSENT_TOKENS = new Set([
            'yes', 'yeah', 'yep', 'yup', 'sure', 'ok', 'okay',
            'absolutely', 'definitely', 'please', 'alright'
        ]);
        const hasLeadingConsent = tokens.length > 0 && LEADING_CONSENT_TOKENS.has(tokens[0]);
        const consentDetected = isConsent || hasLeadingConsent;
        
        // ═══════════════════════════════════════════════════════════════════════
        // V118: CONSENT_DETECTION — Shows exactly how consent was evaluated
        // ═══════════════════════════════════════════════════════════════════════
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: context.callSid,
                companyId: context.company?._id?.toString() || context.companyId,
                type: 'CONSENT_DETECTION',
                data: {
                    // Input state
                    consentPending: true,
                    userInput: userTurn?.substring(0, 60),
                    cleanedInput: cleanedForConsent,
                    tokens,
                    tokenCount: tokens.length,
                    
                    // Detection results
                    consentDetected,
                    detectionMethod: isConsent 
                        ? 'FULL_CONSENT_PHRASE' 
                        : (hasLeadingConsent ? 'LEADING_AFFIRMATIVE' : 'NO_MATCH'),
                    
                    // Why it matched or didn't
                    fullPhraseMatch: isConsent,
                    leadingWordMatch: hasLeadingConsent,
                    leadingWord: hasLeadingConsent ? tokens[0] : null,
                    nonConsentTokens: tokens.filter(t => !CONSENT_WORDS.has(t)),
                    
                    // Result
                    resultingLane: consentDetected ? 'BOOKING' : 'CONTINUE_EVALUATION',
                    message: consentDetected 
                        ? `Consent detected via ${isConsent ? 'full phrase' : 'leading "' + tokens[0] + '"'} → BOOKING lane`
                        : `No consent detected (${tokens.length} tokens, non-consent: ${tokens.filter(t => !CONSENT_WORDS.has(t)).join(', ')})`
                }
            }).catch(() => {});
        }
        
        if (isConsent) {
            trace.addDecisionReason('LANE_BOOKING', { 
                reason: 'consent_given_after_offer',
                consentInput: cleanedForConsent,
                tokenCount: tokens.length
            });
            return LANES.BOOKING;
        }
        
        // Caller says "Yep. It's 12155 Metro Parkway" in response to
        // "Could you please provide your address so I can send a tech?"
        //
        // "Yep" = consent, "12155 Metro Parkway" = address info.
        // The strict token-only check above fails because "metro" and
        // "parkway" aren't consent words. But the leading affirmative
        // clearly signals agreement when consentPending is true.
        //
        // SAFE because consentPending is ONLY set when we explicitly
        // offered booking on the previous turn.
        if (hasLeadingConsent) {
            trace.addDecisionReason('LANE_BOOKING', { 
                reason: 'leading_consent_with_info',
                leadingWord: tokens[0],
                fullInput: cleanedForConsent.substring(0, 60)
            });
            return LANES.BOOKING;
        }
    } else {
        // V118: Log when consent detection is SKIPPED (not pending)
        // This helps understand why consent wasn't checked
        if (BlackBoxLogger && callState?.bookingConsentPending === false) {
            // Only log if explicitly false (not undefined) to avoid noise
            BlackBoxLogger.logEvent({
                callId: context.callSid,
                companyId: context.company?._id?.toString() || context.companyId,
                type: 'CONSENT_DETECTION',
                data: {
                    consentPending: false,
                    consentDetected: false,
                    detectionMethod: 'SKIPPED',
                    reason: 'CONSENT_NOT_PENDING',
                    message: 'Consent detection skipped — agent has not offered scheduling yet'
                }
            }).catch(() => {});
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // ═══════════════════════════════════════════════════════════════
    // V110 LANE LOGIC — Scenario-first, then info, then booking
    // ═══════════════════════════════════════════════════════════════
    //
    // The customer experience flow:
    //   1. Scenario speaks first (acknowledge problem + offer scheduling)
    //   2. Caller accepts → V110 info collection (name/phone/address)
    //   3. After info captured → Booking flow (remaining slots)
    //
    // Lane transition rule:
    //   BOOKING only when schedulingAccepted AND discoveryComplete
    //   Everything else → DISCOVERY (scenarios + info collection)
    //
    // Within DISCOVERY, ConversationEngine manages two sub-phases:
    //   - Pre-acceptance: scenarios are PRIMARY brain (acknowledge + funnel)
    //   - Post-acceptance: V110 steps drive info collection
    //
    // ═══════════════════════════════════════════════════════════════
    const discoverySteps = getConfig('frontDesk.discoveryFlow.steps', []);
    const hasDiscoveryFlow = discoverySteps.length > 0;
    
    if (hasDiscoveryFlow) {
        const schedulingAccepted = callState?.schedulingAccepted === true ||
                                    callState?.booking?.consentGiven === true;
        
        const bookingCollected = callState?.bookingCollected || callState?.slots || {};
        const collectedSlots = callState?.collectedSlots || {};
        const allCaptured = { ...collectedSlots, ...bookingCollected };
        
        // Required discovery slots = all steps with a slotId, minus call_reason_detail
        // (call_reason_detail is passive — triage fills it, not the agent's voice)
        const requiredSteps = discoverySteps.filter(step => {
            return step.slotId && step.slotId !== 'call_reason_detail';
        });
        
        const missingSlots = requiredSteps.filter(step => {
            const slotValue = allCaptured[step.slotId];
            return !slotValue || (typeof slotValue === 'string' && slotValue.trim() === '');
        });
        
        const discoveryComplete = missingSlots.length === 0;
        
        // ═══════════════════════════════════════════════════════════════════════
        // V118: DISCOVERY_FLOW_STATE — Shows complete discovery progress
        // ═══════════════════════════════════════════════════════════════════════
        // This is the SINGLE SOURCE OF TRUTH for understanding where agent is
        // in the discovery flow and why it's choosing DISCOVERY vs BOOKING lane.
        // ═══════════════════════════════════════════════════════════════════════
        const stepEvaluations = discoverySteps.map(step => {
            const slotValue = allCaptured[step.slotId];
            const isFilled = slotValue && (typeof slotValue !== 'string' || slotValue.trim() !== '');
            const isPassive = step.slotId === 'call_reason_detail';
            const isRequired = !isPassive && step.slotId;
            
            return {
                stepId: step.stepId,
                slotId: step.slotId,
                order: step.order,
                status: isPassive ? 'PASSIVE' : (isFilled ? 'FILLED' : 'MISSING'),
                value: isFilled ? (typeof slotValue === 'object' ? slotValue.value : slotValue) : null,
                valuePreview: isFilled ? String(slotValue?.value || slotValue).substring(0, 30) : null,
                isRequired,
                isPassive
            };
        });
        
        const filledSteps = stepEvaluations.filter(s => s.status === 'FILLED');
        const missingStepsDetail = stepEvaluations.filter(s => s.status === 'MISSING');
        const passiveSteps = stepEvaluations.filter(s => s.status === 'PASSIVE');
        
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: context.callSid,
                companyId: context.company?._id?.toString() || context.companyId,
                type: 'DISCOVERY_FLOW_STATE',
                data: {
                    // High-level state
                    phase: schedulingAccepted ? 'INFO_COLLECTION' : 'SCENARIO_PHASE',
                    schedulingAccepted,
                    discoveryComplete,
                    consentPending: callState?.bookingConsentPending === true,
                    
                    // Step-by-step evaluation
                    totalSteps: discoverySteps.length,
                    filledCount: filledSteps.length,
                    missingCount: missingStepsDetail.length,
                    passiveCount: passiveSteps.length,
                    
                    // Detailed step status (the truth)
                    steps: stepEvaluations,
                    
                    // Summary for quick reading
                    filledSlots: filledSteps.map(s => s.slotId),
                    missingSlots: missingStepsDetail.map(s => s.slotId),
                    passiveSlots: passiveSteps.map(s => s.slotId),
                    
                    // Flow order (what agent SHOULD follow)
                    configuredOrder: discoverySteps.map(s => ({ 
                        slotId: s.slotId, 
                        order: s.order,
                        confirmMode: s.confirmMode 
                    })),
                    
                    // Turn context
                    turnCount: callState?.turnCount || 0,
                    userInputPreview: userTurn?.substring(0, 50)
                }
            }).catch(() => {});
        }
        
        // ───────────────────────────────────────────────────────────
        // BOOKING: Only when caller accepted scheduling AND info captured
        // ───────────────────────────────────────────────────────────
        if (schedulingAccepted && discoveryComplete) {
            trace.addDecisionReason('LANE_BOOKING', {
                reason: 'v110_accepted_and_complete',
                capturedSlots: Object.keys(allCaptured).filter(k => allCaptured[k]),
                discoveryTurnCount: callState?.discoveryTurnCount || 0
            });
            
            logger.info('[FRONT_DESK_RUNTIME] V110: Scheduling accepted + info captured → BOOKING', {
                callSid: context.callSid,
                capturedSlots: Object.keys(allCaptured).filter(k => allCaptured[k]),
                discoveryTurnCount: callState?.discoveryTurnCount || 0
            });
            
            // V118: Log lane determination for BOOKING
            if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                    callId: context.callSid,
                    companyId: context.company?._id?.toString() || context.companyId,
                    type: 'LANE_DETERMINATION',
                    data: {
                        selectedLane: 'BOOKING',
                        reason: 'V110_ACCEPTED_AND_COMPLETE',
                        schedulingAccepted: true,
                        discoveryComplete: true,
                        filledSlots: filledSteps.map(s => s.slotId),
                        missingSlots: [],
                        transitionFrom: 'DISCOVERY',
                        message: 'All discovery slots filled + consent given → transitioning to BOOKING'
                    }
                }).catch(() => {});
            }
            
            return LANES.BOOKING;
        }
        
        // ───────────────────────────────────────────────────────────
        // DISCOVERY: Everything else — scenarios speak, info collects
        // ───────────────────────────────────────────────────────────
        // Pre-acceptance: Scenarios are the PRIMARY brain.
        //   They acknowledge the problem, answer questions, offer scheduling.
        // Post-acceptance: V110 steps drive info collection.
        //   LLM knows schedulingAccepted + missingSlots and asks for them.
        trace.addDecisionReason('LANE_DISCOVERY', {
            reason: schedulingAccepted ? 'v110_collecting_info' : 'v110_scenario_phase',
            schedulingAccepted,
            missingSlots: missingSlots.map(s => s.slotId),
            capturedSlots: Object.keys(allCaptured).filter(k => allCaptured[k]),
            discoveryTurnCount: callState?.discoveryTurnCount || 0
        });
        
        logger.info(`[FRONT_DESK_RUNTIME] V110: ${schedulingAccepted ? 'Info collection' : 'Scenario phase'} — DISCOVERY`, {
            callSid: context.callSid,
            schedulingAccepted,
            missingSlots: missingSlots.map(s => s.slotId),
            discoveryTurnCount: callState?.discoveryTurnCount || 0
        });
        
        // V118: Log lane determination for DISCOVERY
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: context.callSid,
                companyId: context.company?._id?.toString() || context.companyId,
                type: 'LANE_DETERMINATION',
                data: {
                    selectedLane: 'DISCOVERY',
                    reason: schedulingAccepted ? 'V110_COLLECTING_INFO' : 'V110_SCENARIO_PHASE',
                    schedulingAccepted,
                    discoveryComplete,
                    consentPending: callState?.bookingConsentPending === true,
                    filledSlots: filledSteps.map(s => s.slotId),
                    missingSlots: missingStepsDetail.map(s => s.slotId),
                    // Why NOT booking?
                    blockedFromBooking: !schedulingAccepted 
                        ? 'CONSENT_NOT_GIVEN' 
                        : 'SLOTS_MISSING',
                    message: schedulingAccepted 
                        ? `Consent given but ${missingStepsDetail.length} slots still missing: ${missingStepsDetail.map(s => s.slotId).join(', ')}`
                        : 'Waiting for scheduling consent — scenarios are primary brain'
                }
            }).catch(() => {});
        }
        
        return LANES.DISCOVERY;
    }
    
    // ═══════════════════════════════════════════════════════════════
    // LEGACY MODE (V110 not configured): Use hardcoded patterns
    // ═══════════════════════════════════════════════════════════════
    // If no Discovery Flow is configured, fall back to legacy behavior
    // with hardcoded patterns and smart matching. This maintains backward
    // compatibility for companies not using V110.
    // ═══════════════════════════════════════════════════════════════
    logger.info('[FRONT_DESK_RUNTIME] LEGACY MODE: No V110 Discovery Flow - using hardcoded patterns', {
        callSid: context.callSid,
        message: 'Configure Discovery Flow in UI to enable V110 STRICT MODE'
    });
    
    // 4. Check for direct booking intent
    // V110: ALL detection triggers come from frontDesk.detectionTriggers.* (sole source)
    const bookingTriggers = getConfig('frontDesk.detectionTriggers.wantsBooking', []);
    const directIntentPatterns = getConfig('frontDesk.detectionTriggers.directIntentPatterns', []);
    
    // Legacy fallback: If both are empty, use hardcoded emergency fallback
    const FALLBACK_PATTERNS = [
        'schedule', 'book', 'appointment', 'come out', 'send someone',
        'get someone', 'need someone', 'help me out', 'technician'
    ];
    
    let allBookingPatterns;
    if (bookingTriggers.length === 0 && directIntentPatterns.length === 0) {
        allBookingPatterns = FALLBACK_PATTERNS;
        logger.warn('[FRONT_DESK_RUNTIME] LEGACY MODE: Using fallback patterns - company has no booking triggers configured');
    } else {
        allBookingPatterns = [...new Set([...bookingTriggers, ...directIntentPatterns])];
    }
    
    // V105: Normalize text to catch variations
    const normalizedInput = userTurnLower
        .replace(/\bsomebody\b/g, 'someone')
        .replace(/\banybody\b/g, 'anyone')
        .replace(/\bgonna\b/g, 'going to')
        .replace(/\bwanna\b/g, 'want to')
        .replace(/\bgotta\b/g, 'got to');
    
    // Check configured patterns
    for (const pattern of allBookingPatterns) {
        const normalizedPattern = pattern.toLowerCase()
            .replace(/\bsomebody\b/g, 'someone')
            .replace(/\banybody\b/g, 'anyone');
            
        if (normalizedInput.includes(normalizedPattern)) {
            trace.addDecisionReason('LANE_BOOKING', { 
                reason: 'direct_booking_intent', 
                pattern,
                matchedIn: 'legacy_configured_patterns'
            });
            return LANES.BOOKING;
        }
    }
    
    // Legacy smart pattern matching (only when V110 not configured)
    const smartPatterns = [
        // "get/send someone out" variations
        /\b(get|send|dispatch|have)\s+(a\s+)?(someone|somebody|anyone|a\s*tech|technician|guy|person)\s+(out|over|here|there|to)/i,
        
        // "need someone to help/come/fix" - V107: Added "help" which is extremely common
        /\b(need|want)\s+(a\s+)?(someone|somebody|tech|technician|person)\s+(to\s+)?(come|come\s*out|look|check|fix|help)/i,
        
        // "I need someone/somebody to help me out" - V107: NEW pattern for "help me out"
        /\b(need|want)\s+(someone|somebody|a\s*tech|a\s*person)\s+to\s+help/i,
        
        // "help me out" / "help me out here" - V107: Direct "help" request = wants service
        /\b(help\s+me\s+out|help\s+me\s+here|help\s+me\s+with\s+this)/i,
        
        // "can you come out" / "can someone come"
        /\bcan\s+(you|someone|somebody|a\s*tech)\s+(come|come\s*out|get\s*here|come\s*over|help)/i,
        
        // "come out today/asap"
        /\b(come\s*out|come\s*over|come\s*by)\s+(today|tomorrow|asap|soon|right\s*away|this\s*week)/i,
        
        // Urgency words alone
        /\b(asap|right\s*away|as\s*soon\s*as\s*possible|emergency|urgent)/i,
        
        // "schedule/book an appointment"
        /\b(schedule|book|set\s*up)\s+(a\s+)?(service|appointment|call|visit|time)/i,
        
        // V107: "I need help" / "need help with" - simple help requests
        /\bi\s+need\s+help\b/i,
        /\bneed\s+help\s+(with|here|now|today)/i,
        
        // V107: "something's wrong" + "need someone" in same utterance
        /\b(something'?s?\s+wrong|not\s+working|broken|won'?t\s+work).{0,30}(need|send|get)\s+(someone|somebody|help)/i,
        
        // V116: "can you help me" / "please help" — extremely common service requests
        // Caller said "can you please help me?" — this was NOT caught, forcing 4 turns
        // of diagnostic discovery before LLM finally offered booking.
        /\bcan\s+you\s+(please\s+)?(help|assist)\s+(me|us)\b/i,
        /\bplease\s+(help|assist)\s+(me|us)\b/i,
        
        // V116: Problem description + "help" — caller describes issue and asks for help
        // "I'm having AC problems, can you help me?" combines problem + help request
        /\b(having|got|have)\s+(a\s+)?(problem|issue|trouble).{0,30}(help|fix|repair)/i,
        
        // V116: "having problems/issues" as standalone service request indicator
        // When a caller describes a specific equipment problem, they want service
        /\b(air\s+condition|ac|a\.?c\.?|heat|furnace|thermostat|plumbing|drain|water\s+heater).{0,20}(problem|issue|not\s+work|broken|won'?t|isn'?t|not\s+cool|not\s+heat|blank)/i
    ];
    
    for (const regex of smartPatterns) {
        if (regex.test(userTurn)) {
            const match = userTurn.match(regex);
            trace.addDecisionReason('LANE_BOOKING', { 
                reason: 'smart_pattern_match', 
                pattern: regex.source.substring(0, 50),
                matched: match ? match[0] : 'unknown'
            });
            return LANES.BOOKING;
        }
    }
    
    // ═══════════════════════════════════════════════════════════════
    // V116: DISCOVERY ESCALATION — After N turns of diagnostics,
    // proactively offer booking instead of continuing discovery.
    // ═══════════════════════════════════════════════════════════════
    // PROBLEM: Caller described AC problem on Turn 1. Scenario engine
    // ran 4 turns of diagnostic questions (float switch? breakers?)
    // before LLM finally offered booking on Turn 5. Caller frustrated.
    //
    // FIX: After 3 turns in discovery, if there's NO booking offer yet
    // and the conversation has service-related context, signal that
    // the next turn should offer booking. This prevents runaway
    // diagnostics from the scenario engine.
    // ═══════════════════════════════════════════════════════════════
    const MAX_DISCOVERY_TURNS_BEFORE_OFFER = 3;
    const discoveryTurnCount = callState?.discoveryTurnCount || 0;
    const alreadyOfferedBooking = callState?.bookingConsentPending === true || 
                                   callState?.bookingModeLocked === true;
    
    if (discoveryTurnCount >= MAX_DISCOVERY_TURNS_BEFORE_OFFER && !alreadyOfferedBooking) {
        // Check if conversation has service-related context (problem described)
        const hasServiceContext = callState?.discoveryTruth?.issue || 
                                  callState?.slots?.call_reason_detail?.value ||
                                  callState?.conversationHistory?.some?.(h => 
                                      h.role === 'user' && /problem|issue|broken|not\s+work|not\s+cool|not\s+heat|thermostat|blank|leak|noise|90\s*degree/i.test(h.text || '')
                                  );
        
        if (hasServiceContext) {
            logger.info('[FRONT_DESK_RUNTIME] V116: Discovery escalation — offering booking after prolonged diagnostics', {
                callSid,
                discoveryTurnCount,
                maxTurns: MAX_DISCOVERY_TURNS_BEFORE_OFFER,
                reason: 'SERVICE_CONTEXT_DETECTED_NO_BOOKING_OFFERED'
            });
            
            // Set consentPending so the system knows to offer booking
            callState.discoveryEscalation = true;
            trace.addDecisionReason('LANE_DISCOVERY', { 
                reason: 'discovery_escalation_pending',
                discoveryTurns: discoveryTurnCount,
                willOfferBooking: true
            });
        }
    }
    
    // Track discovery turns
    callState.discoveryTurnCount = (callState.discoveryTurnCount || 0) + 1;
    
    // 5. Default to discovery
    trace.addDecisionReason('LANE_DISCOVERY', { reason: 'default', checkedPatterns: allBookingPatterns.length });
    return LANES.DISCOVERY;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * handleBookingLane() - Process booking mode turns
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * V104 REWRITE: Now follows "UI is law" discipline:
 * 1. cfgGet('frontDesk.bookingEnabled') FIRST - if false, escalate
 * 2. V110 slotRegistry + bookingFlow - if empty, escalate with UI message
 * 3. Lock booking state BEFORE processing
 * 4. Use correct method names (resolve, runStep)
 * 5. Emit BOOKING_FLOW_ERROR with real stack on failure
 * ═══════════════════════════════════════════════════════════════════════════════
 */
async function handleBookingLane(effectiveConfig, callState, userTurn, context, trace) {
    const { company, callSid } = context;
    const companyId = company?._id?.toString() || context.companyId;
    
    trace.addDecisionReason('BOOKING_LANE_HANDLER', { handler: 'BookingFlowRunner' });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 1: Is booking module available?
    // ═══════════════════════════════════════════════════════════════════════════
    if (!BookingFlowRunner || !BookingFlowResolver) {
        logger.error('[FRONT_DESK_RUNTIME] BookingFlowRunner not available - fail closed');
        
        // Emit error event for tracing
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'BOOKING_FLOW_ERROR',
                data: {
                    error: 'BookingFlowRunner module not loaded',
                    gate: 'MODULE_AVAILABILITY',
                    recovery: 'ESCALATE'
                }
            }).catch(() => {});
        }
        
        return {
            response: "I apologize, I'm having trouble with the booking system. Let me connect you with someone who can help.",
            signals: { escalate: true, failClosed: true },
            matchSource: 'FRONT_DESK_RUNTIME_FAIL'
        };
    }
    
    try {
        // ═══════════════════════════════════════════════════════════════════════
        // GATE 2: Is booking enabled? (cfgGet - traced read)
        // ═══════════════════════════════════════════════════════════════════════
        let bookingEnabled;
        try {
            bookingEnabled = cfgGet(effectiveConfig, 'frontDesk.bookingEnabled', {
                callId: callSid,
                turn: callState?.turnCount || 0,
                strict: false,
                readerId: 'handleBookingLane.bookingEnabled'
            });
        } catch (e) {
            // Key might not be in contract - treat as disabled
            bookingEnabled = false;
        }
        
        if (bookingEnabled === false) {
            logger.warn('[FRONT_DESK_RUNTIME] Booking is disabled via UI', { callSid });
            
            if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                    callId: callSid,
                    companyId,
                    type: 'BOOKING_FLOW_ERROR',
                    data: {
                        error: 'frontDesk.bookingEnabled is false',
                        gate: 'BOOKING_DISABLED',
                        recovery: 'ESCALATE'
                    }
                }).catch(() => {});
            }
            
            // Use UI-controlled escalation message
            let transferMsg;
            try {
                transferMsg = cfgGet(effectiveConfig, 'frontDesk.escalation.transferMessage', {
                    callId: callSid,
                    turn: callState?.turnCount || 0,
                    strict: false,
                    readerId: 'handleBookingLane.transferMessage'
                });
            } catch (e) {
                transferMsg = null;
            }
            
            return {
                response: transferMsg || "I'd be happy to help you with booking. Let me connect you with someone who can assist.",
                signals: { escalate: true },
                matchSource: 'FRONT_DESK_RUNTIME_BOOKING_DISABLED'
            };
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // GATE 3: V110 SLOT REGISTRY + BOOKING FLOW (SOLE SOURCE OF TRUTH)
        // ═══════════════════════════════════════════════════════════════════════
        let bookingSlots;
        let configSource = 'UNKNOWN';
        
        try {
            const slotRegistry = cfgGet(effectiveConfig, 'frontDesk.slotRegistry', {
                callId: callSid,
                turn: callState?.turnCount || 0,
                strict: false,
                readerId: 'handleBookingLane.v110.slotRegistry'
            }) || {};
            
            const bookingFlow = cfgGet(effectiveConfig, 'frontDesk.bookingFlow', {
                callId: callSid,
                turn: callState?.turnCount || 0,
                strict: false,
                readerId: 'handleBookingLane.v110.bookingFlow'
            }) || {};
            
            const v110Slots = slotRegistry.slots || [];
            const v110Steps = bookingFlow.steps || [];
            
            if (v110Slots.length > 0 && v110Steps.length > 0) {
                bookingSlots = _mergeV110SlotsWithSteps(v110Slots, v110Steps);
                configSource = 'V110_SLOT_REGISTRY';
                
                logger.info('[FRONT_DESK_RUNTIME] V110: Using slotRegistry + bookingFlow', {
                    callSid,
                    slotCount: v110Slots.length,
                    stepCount: v110Steps.length
                });
            } else {
                // V110 not configured — fail closed, no legacy fallback
                configSource = 'NONE';
                bookingSlots = null;
                
                logger.error('[FRONT_DESK_RUNTIME] V110 slotRegistry/bookingFlow NOT configured — no slots available', {
                    callSid,
                    companyId,
                    hasSlots: v110Slots.length > 0,
                    hasSteps: v110Steps.length > 0
                });
            }
        } catch (e) {
            bookingSlots = null;
            configSource = 'ERROR';
            logger.error('[FRONT_DESK_RUNTIME] Error loading booking slots', { callSid, error: e.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // CRITICAL TRACE: BOOKING_SLOTS_LOADED or BOOKING_SLOTS_EMPTY
        // ═══════════════════════════════════════════════════════════════════════
        const slotCount = Array.isArray(bookingSlots) ? bookingSlots.length : 0;
        const slotSummary = slotCount > 0 
            ? bookingSlots.map(s => s.id || s.fieldKey || 'unknown').join(', ')
            : 'NONE';
        
        if (BlackBoxLogger) {
            const eventType = slotCount > 0 ? 'BOOKING_SLOTS_LOADED' : 'BOOKING_SLOTS_EMPTY';
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: eventType,
                data: {
                    slotCount,
                    slotIds: slotSummary,
                    configSource,
                    awPath: 'frontDesk.slotRegistry + frontDesk.bookingFlow',
                    resolvedFrom: slotCount > 0 ? configSource : 'NOT_FOUND'
                }
            }).catch(() => {});
        }
        
        if (!bookingSlots || !Array.isArray(bookingSlots) || bookingSlots.length === 0) {
            logger.error('[FRONT_DESK_RUNTIME] No booking slots configured — fail closed', { 
                callSid,
                configSource,
                v110Path: 'frontDesk.slotRegistry + frontDesk.bookingFlow',
                hasSlotRegistry: !!effectiveConfig?.frontDeskBehavior?.slotRegistry,
                hasBookingFlow: !!effectiveConfig?.frontDeskBehavior?.bookingFlow
            });
            
            if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                    callId: callSid,
                    companyId,
                    type: 'BOOKING_FLOW_ERROR',
                    data: {
                        error: 'V110 slotRegistry/bookingFlow not configured',
                        gate: 'BOOKING_SLOTS_MISSING',
                        recovery: 'ESCALATE',
                        slotCount: 0
                    }
                }).catch(() => {});
            }
            
            return {
                response: "I apologize, the booking system isn't fully configured yet. Let me connect you with someone who can help schedule your appointment.",
                signals: { escalate: true },
                matchSource: 'FRONT_DESK_RUNTIME_NO_SLOTS'
            };
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // GATE 3.5: Phase 1 - Verify scheduling config if provider=request_only
        // If time slot exists in bookingSlots, ensure timeWindows are configured
        // ═══════════════════════════════════════════════════════════════════════
        const hasTimeSlot = bookingSlots.some(s => 
            s.id === 'time' || s.fieldKey === 'time' || 
            s.type === 'time' || s.type === 'dateTime'
        );
        
        if (hasTimeSlot) {
            let schedulingProvider;
            let timeWindows;
            
            try {
                schedulingProvider = cfgGet(effectiveConfig, 'frontDesk.scheduling.provider', {
                    callId: callSid,
                    turn: callState?.turnCount || 0,
                    strict: false,
                    readerId: 'handleBookingLane.scheduling.provider'
                }) || 'request_only';
                
                timeWindows = cfgGet(effectiveConfig, 'frontDesk.scheduling.timeWindows', {
                    callId: callSid,
                    turn: callState?.turnCount || 0,
                    strict: false,
                    readerId: 'handleBookingLane.scheduling.timeWindows'
                }) || [];
            } catch (e) {
                schedulingProvider = 'request_only';
                timeWindows = [];
            }
            
            // Phase 1: If provider=request_only and no time windows, warn (strict mode: fail closed)
            if (schedulingProvider === 'request_only' && 
                (!Array.isArray(timeWindows) || timeWindows.length === 0)) {
                
                logger.warn('[FRONT_DESK_RUNTIME] Phase 1: No time windows configured for request_only mode', {
                    callSid,
                    provider: schedulingProvider,
                    hasTimeSlot: true
                });
                
                if (BlackBoxLogger) {
                    BlackBoxLogger.logEvent({
                        callId: callSid,
                        companyId,
                        type: 'SCHEDULING_CONFIG_WARNING',
                        data: {
                            provider: schedulingProvider,
                            timeWindowCount: 0,
                            hasTimeSlot: true,
                            message: 'Time slot exists but no time windows configured. Time preferences will be stored as-is.'
                        }
                    }).catch(() => {});
                }
                
                // Note: We don't fail closed here - we just won't offer specific windows
                // The booking flow will store the user's preference as-is
            } else if (timeWindows.length > 0) {
                logger.info('[FRONT_DESK_RUNTIME] Phase 1: Scheduling config verified', {
                    callSid,
                    provider: schedulingProvider,
                    windowCount: timeWindows.length
                });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // GATE 4: LOCK BOOKING STATE (before any processing)
        // This is critical - if we're in BOOKING lane, we MUST lock
        // ═══════════════════════════════════════════════════════════════════════
        if (!callState.bookingModeLocked) {
            assertModeOwnership('handleBookingLane', 'SET', 'bookingModeLocked');
            callState.bookingModeLocked = true;
            callState.bookingConsentPending = false;  // Consent was given to enter booking
            
            logger.info('[FRONT_DESK_RUNTIME] BOOKING STATE LOCKED', {
                callSid,
                slotCount: bookingSlots.length,
                slots: bookingSlots.map(s => s.id || s.fieldKey).join(',')
            });
            
            if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                    callId: callSid,
                    companyId,
                    type: 'BOOKING_MODE_LOCKED',
                    data: {
                        slotCount: bookingSlots.length,
                        slotIds: bookingSlots.map(s => s.id || s.fieldKey),
                        source: 'handleBookingLane'
                    }
                }).catch(() => {});
            }
            
            // ═══════════════════════════════════════════════════════════════════════
            // V117: CONSENT-TURN SLOT SWEEP (MANDATORY)
            // ═══════════════════════════════════════════════════════════════════════
            // PROBLEM: When consent flips on a turn, slot extraction already ran in
            // DISCOVERY mode (at v2twilio line ~3201), which gates address/time.
            // Result: caller says "yeah, the address is 123 Main St" but address
            // gets blocked because bookingModeLocked was still false at extraction.
            //
            // FIX: Now that booking mode is LOCKED, re-run extraction with BOOKING
            // rules to capture any slots the caller provided on this consent turn.
            //
            // GUARD: This block is inside `if (!callState.bookingModeLocked)` which
            // means it ONLY runs on the flip turn (when booking mode just locked).
            // Subsequent booking turns skip this entirely — no double-extraction.
            //
            // PERFORMANCE: Only run sweep if utterance contains likely slot language.
            // This keeps calls snappy when caller just says "yeah" or "sure".
            // ═══════════════════════════════════════════════════════════════════════
            if (SlotExtractor && userTurn && userTurn.trim().length > 0) {
                const userTurnLower = userTurn.toLowerCase();
                
                // V117: Performance gate — only sweep if likely slot language present
                // Address patterns: "address is", street numbers, "metro", "parkway", etc.
                const hasAddressLanguage = /(?:address\s+is|my\s+address|street|avenue|ave|road|rd|drive|dr|lane|ln|boulevard|blvd|parkway|pkwy|court|ct|place|pl|\d{2,5}\s+[a-z])/i.test(userTurn);
                // Time patterns: "today", "tomorrow", "morning", "afternoon", "asap", time windows
                const hasTimeLanguage = /(?:today|tomorrow|morning|afternoon|evening|asap|as soon as|8\s*(?:to|-)|\d{1,2}\s*(?:am|pm|o'?clock))/i.test(userTurn);
                // Phone patterns: "call me at", "my number", phone digits
                const hasPhoneLanguage = /(?:call\s+me\s+at|my\s+(?:number|phone)|reach\s+me\s+at|\d{3}[.\-\s]?\d{3}[.\-\s]?\d{4})/i.test(userTurn);
                
                const hasLikelySlotLanguage = hasAddressLanguage || hasTimeLanguage || hasPhoneLanguage;
                
                if (hasLikelySlotLanguage) {
                    const slotsBefore = Object.keys(callState.slots || {});
                    
                    // Re-extract with BOOKING context (ungated)
                    // Uses same userTurn that consent detector saw — no normalization mismatch
                    const consentTurnSlots = SlotExtractor.extractAll(userTurn, {
                        turnCount: callState.turnCount || 1,
                        existingSlots: callState.slots || {},
                        company,
                        // V117: BOOKING mode extraction — no gating
                        bookingModeLocked: true,
                        sessionMode: 'BOOKING',
                        // Pass current step hint if available
                        currentBookingStep: callState.currentBookingStep || null
                    });
                    
                    if (Object.keys(consentTurnSlots).length > 0) {
                        // Merge new extractions BEFORE determineNextAction() runs
                        const mergedSlots = SlotExtractor.mergeSlots(
                            callState.slots || {}, 
                            consentTurnSlots
                        );
                        
                        // Remove internal tracking property if present
                        delete mergedSlots._mergeDecisions;
                        callState.slots = mergedSlots;
                        
                        const slotsAfter = Object.keys(callState.slots);
                        const newSlots = slotsAfter.filter(k => !slotsBefore.includes(k));
                        
                        logger.info('[FRONT_DESK_RUNTIME] V117: Consent-turn slot sweep captured new slots', {
                            callSid,
                            slotsBefore,
                            slotsAfter,
                            newSlots,
                            extractedKeys: Object.keys(consentTurnSlots),
                            userTurnPreview: userTurn.substring(0, 60)
                        });
                        
                        if (BlackBoxLogger) {
                            BlackBoxLogger.logEvent({
                                callId: callSid,
                                companyId,
                                type: 'CONSENT_TURN_SLOT_SWEEP',
                                data: {
                                    slotsBefore,
                                    slotsAfter,
                                    newSlots,
                                    extractedKeys: Object.keys(consentTurnSlots),
                                    extractedValues: Object.fromEntries(
                                        Object.entries(consentTurnSlots).map(([k, v]) => [
                                            k, 
                                            { value: typeof v === 'object' ? v.value : v, confidence: v?.confidence }
                                        ])
                                    ),
                                    userTurnPreview: userTurn.substring(0, 60),
                                    source: 'V117_CONSENT_SWEEP',
                                    performanceGate: {
                                        hasAddressLanguage,
                                        hasTimeLanguage,
                                        hasPhoneLanguage
                                    }
                                }
                            }).catch(() => {});
                        }
                    }
                } else {
                    // No likely slot language — skip sweep for performance
                    logger.debug('[FRONT_DESK_RUNTIME] V117: Skipping consent-turn sweep (no slot language detected)', {
                        callSid,
                        userTurnPreview: userTurn.substring(0, 40)
                    });
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // RESOLVE: Get booking flow from UI config
        // V104 FIX: Use correct method name and parameters
        // ═══════════════════════════════════════════════════════════════════════
        const resolution = BookingFlowResolver.resolve({
            companyId,
            company,
            // Note: awReader not passed here - BookingFlowResolver creates its own if needed
        });
        
        if (!resolution || !resolution.steps || resolution.steps.length === 0) {
            logger.error('[FRONT_DESK_RUNTIME] BookingFlowResolver returned no flow', { callSid });
            
            if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                    callId: callSid,
                    companyId,
                    type: 'BOOKING_FLOW_ERROR',
                    data: {
                        error: 'BookingFlowResolver.resolve returned empty flow',
                        gate: 'FLOW_RESOLUTION',
                        recovery: 'ESCALATE',
                        resolutionSource: resolution?.source
                    }
                }).catch(() => {});
            }
            
            return {
                response: "I apologize, there was an issue loading the booking configuration. Let me get you some help.",
                signals: { escalate: true },
                matchSource: 'FRONT_DESK_RUNTIME_NO_FLOW'
            };
        }
        
        // Log successful flow resolution
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'BOOKING_FLOW_RESOLVED',
                data: {
                    flowId: resolution.flowId,
                    stepCount: resolution.steps.length,
                    stepIds: resolution.steps.map(s => s.id),
                    source: resolution.source
                }
            }).catch(() => {});
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // BUILD: Prepare state for BookingFlowRunner
        // ═══════════════════════════════════════════════════════════════════════
        // V116 FIX: Include transient state variables persisted from previous turns.
        // Without these, the booking flow "forgets" context like:
        //   - askedForLastName (was lastName question already asked?)
        //   - firstNameCollected (what first name to combine with last name?)
        //   - awaitingSpelledName (are we waiting for caller to spell their name?)
        // ═══════════════════════════════════════════════════════════════════════
        const bookingState = {
            bookingCollected: callState.bookingCollected || callState.slots || {},
            confirmedSlots: callState.confirmedSlots || {},
            slotMetadata: callState.slotMetadata || {},
            currentStepId: callState.currentBookingStep,
            turn: callState.turnCount || 0,
            _traceContext: { callSid, companyId },
            askedForLastName: callState.askedForLastName,
            firstNameCollected: callState.firstNameCollected,
            awaitingSpelledName: callState.awaitingSpelledName,
            pendingConfirmation: callState.pendingConfirmation,
            _slotRegistry: effectiveConfig?.frontDesk?.slotRegistry
        };
        
        // Initialize state if this is first entry
        BookingFlowRunner.initializeState(bookingState, resolution, callState.slots || {});
        
        // ═══════════════════════════════════════════════════════════════════════
        // RUN: Execute booking step
        // V104 FIX: Use correct method name (runStep, not processBookingTurn)
        // ═══════════════════════════════════════════════════════════════════════
        const bookingResult = await BookingFlowRunner.runStep({
            flow: resolution,
            state: bookingState,
            userInput: userTurn,
            company,
            session: callState,
            callSid,
            slots: callState.slots || {}
        });
        
        // Log step result
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'BOOKING_STEP_COMPLETE',
                data: {
                    currentStepId: bookingResult.state?.currentStepId,
                    isComplete: bookingResult.isComplete,
                    mode: bookingResult.mode,
                    promptSource: bookingResult.promptSource,
                    slotsCollected: Object.keys(bookingResult.state?.bookingCollected || {})
                }
            }).catch(() => {});
            
            // ═══════════════════════════════════════════════════════════════════════
            // V117: BOOKING_NEXT_STEP_SELECTED — Proves step skip when slot is filled
            // ═══════════════════════════════════════════════════════════════════════
            // This event shows which step was selected and why. If address was swept
            // on consent turn, this event will show address in slotsPresent (not slotsMissing).
            // ═══════════════════════════════════════════════════════════════════════
            const allStepIds = resolution.steps.map(s => s.id);
            const collectedSlotKeys = Object.keys(bookingResult.state?.bookingCollected || {});
            const confirmedSlotKeys = Object.keys(bookingResult.state?.confirmedSlots || {});
            const slotsMissing = allStepIds.filter(id => 
                !collectedSlotKeys.includes(id) && !confirmedSlotKeys.includes(id)
            );
            
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'BOOKING_NEXT_STEP_SELECTED',
                data: {
                    selectedStepId: bookingResult.state?.currentStepId,
                    reason: bookingResult.isComplete 
                        ? 'ALL_SLOTS_COMPLETE' 
                        : (bookingResult.mode === 'CONFIRM' ? 'CONFIRM_PENDING' : 'SLOT_MISSING'),
                    slotsPresent: collectedSlotKeys,
                    slotsConfirmed: confirmedSlotKeys,
                    slotsMissing,
                    flowStepOrder: allStepIds,
                    // V117: Explicit proof that swept slots caused skip
                    sweptSlotsPresent: collectedSlotKeys.filter(k => 
                        ['address', 'time', 'phone'].includes(k)
                    )
                }
            }).catch(() => {});
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // UPDATE: Sync state back to callState
        // ═══════════════════════════════════════════════════════════════════════
        // V116 FIX: Include transient booking state variables that control multi-turn
        // slot collection (e.g., askedForLastName, firstNameCollected). Without these,
        // the booking flow "forgets" that it already asked for last name and re-asks.
        // ═══════════════════════════════════════════════════════════════════════
        if (bookingResult.state) {
            callState.bookingCollected = bookingResult.state.bookingCollected || callState.bookingCollected;
            callState.slots = bookingResult.state.bookingCollected || callState.slots;
            callState.confirmedSlots = bookingResult.state.confirmedSlots || callState.confirmedSlots;
            callState.slotMetadata = bookingResult.state.slotMetadata || callState.slotMetadata;
            callState.currentBookingStep = bookingResult.state.currentStepId;
            
            // V116: Sync transient state variables for multi-turn slot collection
            // These control the "ask lastName" / "ask to spell" / "confirm" sub-flows
            if (bookingResult.state.askedForLastName !== undefined) {
                callState.askedForLastName = bookingResult.state.askedForLastName;
            }
            if (bookingResult.state.firstNameCollected !== undefined) {
                callState.firstNameCollected = bookingResult.state.firstNameCollected;
            }
            if (bookingResult.state.awaitingSpelledName !== undefined) {
                callState.awaitingSpelledName = bookingResult.state.awaitingSpelledName;
            }
            if (bookingResult.state.pendingConfirmation !== undefined) {
                callState.pendingConfirmation = bookingResult.state.pendingConfirmation;
            }
        }
        
        // V119: CRITICAL DEBUG — Trace askedForLastName through FrontDeskRuntime path
        // This helps diagnose the lastName loop bug where askedForLastName doesn't persist
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'BOOKING_LANE_STATE_SYNC',
                data: {
                    // Values from BookingFlowRunner
                    fromRunner_askedForLastName: bookingResult.state?.askedForLastName,
                    fromRunner_firstNameCollected: bookingResult.state?.firstNameCollected,
                    fromRunner_awaitingSpelledName: bookingResult.state?.awaitingSpelledName,
                    // Values synced to callState (what will be returned to v2twilio)
                    toCallState_askedForLastName: callState.askedForLastName,
                    toCallState_firstNameCollected: callState.firstNameCollected,
                    toCallState_awaitingSpelledName: callState.awaitingSpelledName,
                    // Debugging context
                    stepId: bookingResult.state?.currentStepId,
                    action: bookingResult.action,
                    note: 'V119: Trace path of transient booking state flags through FrontDeskRuntime'
                }
            }).catch(() => {});
        }
        
        return {
            response: bookingResult.reply || bookingResult.response,
            signals: {
                bookingComplete: bookingResult.isComplete,
                enterBooking: true,
                enterBookingReason: 'booking_lane'
            },
            action: bookingResult.action,
            matchSource: 'BOOKING_FLOW_RUNNER',
            promptSource: bookingResult.promptSource,
            metadata: bookingResult.debug
        };
        
    } catch (error) {
        // ═══════════════════════════════════════════════════════════════════════
        // ERROR: Log with FULL STACK for debugging
        // ═══════════════════════════════════════════════════════════════════════
        logger.error('[FRONT_DESK_RUNTIME] BookingFlowRunner error', {
            callSid,
            error: error.message,
            stack: error.stack?.substring(0, 1000)
        });
        
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'BOOKING_FLOW_ERROR',
                data: {
                    error: error.message,
                    stack: error.stack?.substring(0, 500),
                    gate: 'EXECUTION_ERROR',
                    recovery: 'ESCALATE'
                }
            }).catch(() => {});
        }
        
        // Use UI-controlled error message if available
        let errorMsg;
        try {
            errorMsg = cfgGet(effectiveConfig, 'frontDesk.bookingBehavior.errorMessage', {
                callId: callSid,
                turn: callState?.turnCount || 0,
                strict: false,
                readerId: 'handleBookingLane.errorMessage'
            });
        } catch (e) {
            errorMsg = null;
        }
        
        return {
            response: errorMsg || "I apologize, I encountered an issue with booking. Let me connect you with someone who can help.",
            signals: { escalate: true },
            matchSource: 'FRONT_DESK_RUNTIME_ERROR'
        };
    }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * handleDiscoveryLane() - Process discovery mode turns
 * ═══════════════════════════════════════════════════════════════════════════════
 */
async function handleDiscoveryLane(effectiveConfig, callState, userTurn, context, trace) {
    const { company, callSid } = context;
    const companyId = company?._id?.toString() || context.companyId || 'unknown';
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V109: BOOKING GATE INVARIANT CHECK - Defense in depth
    // ═══════════════════════════════════════════════════════════════════════════
    // If we somehow reached handleDiscoveryLane with bookingModeLocked=true, that's
    // an INVARIANT VIOLATION. The Absolute Booking Gate should have caught this.
    // DO NOT call ConversationEngine - return FrontDesk-controlled message instead.
    // ═══════════════════════════════════════════════════════════════════════════
    if (callState?.bookingModeLocked === true) {
        logger.error('[FRONT_DESK_RUNTIME] BOOKING_GATE_INVARIANT_VIOLATION: handleDiscoveryLane called with bookingModeLocked=true!', {
            callSid,
            companyId,
            bookingModeLocked: true,
            violation: 'DISCOVERY_LANE_WHILE_BOOKING_LOCKED'
        });
        
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'BOOKING_GATE_INVARIANT_VIOLATION',
                data: {
                    violation: 'DISCOVERY_LANE_WHILE_BOOKING_LOCKED',
                    bookingModeLocked: true,
                    expectedBehavior: 'Absolute Booking Gate should have prevented this',
                    remediation: 'Returning escalation message instead of calling ConversationEngine'
                }
            }).catch(() => {});
        }
        
        trace.addDecisionReason('BOOKING_GATE_INVARIANT_VIOLATION', {
            violation: 'DISCOVERY_LANE_WHILE_BOOKING_LOCKED',
            action: 'ESCALATE_INSTEAD_OF_CONVERSATION_ENGINE'
        });
        
        // DO NOT call ConversationEngine - use FrontDesk escalation
        let escalationMsg;
        try {
            escalationMsg = cfgGet(effectiveConfig, 'frontDesk.escalation.transferMessage', {
                callId: callSid,
                turn: callState?.turnCount || 0,
                strict: false,
                readerId: 'handleDiscoveryLane.bookingGateViolation'
            });
        } catch (e) {
            escalationMsg = null;
        }
        
        return {
            response: escalationMsg || "I apologize for the confusion. Let me connect you with someone who can help with your booking.",
            signals: { escalate: true, bookingGateViolation: true },
            matchSource: 'BOOKING_GATE_INVARIANT_VIOLATION'
        };
    }
    
    trace.addDecisionReason('DISCOVERY_LANE_HANDLER', { handler: 'ConversationEngine' });
    
    // ═══════════════════════════════════════════════════════════════════════════
    // V111 Phase 4: Check V111 Router for governance & capture injection
    // ═══════════════════════════════════════════════════════════════════════════
    // If V111 is enabled, the router may override handler selection or
    // inject a capture prompt for missing fields.
    // ═══════════════════════════════════════════════════════════════════════════
    let v111Decision = null;
    let v111Router = null;
    
    if (V111Router && context.v111Memory?.isV111Enabled?.()) {
        try {
            v111Router = V111Router.createRouter(context.v111Memory, { callId: callSid });
            v111Decision = v111Router.route({
                scenarioMatch: context.scenarioMatch || null,
                consentSignal: context.consentSignal || null,
                escalationSignal: context.escalationSignal || null,
                currentResponse: null  // Will check loop detection later
            });
            
            logger.debug('[FRONT_DESK_RUNTIME] V111 Router decision', {
                callSid,
                handler: v111Decision?.handler,
                reason: v111Decision?.reason,
                captureField: v111Decision?.captureInjection?.field,
                escalation: v111Decision?.escalation?.trigger
            });
            
            // Handle escalation trigger from V111
            if (v111Decision?.handler === 'ESCALATION') {
                trace.addDecisionReason('V111_ESCALATION', {
                    reason: v111Decision.reason,
                    trigger: v111Decision.escalation?.trigger
                });
                
                let escalationMsg;
                try {
                    escalationMsg = cfgGet(effectiveConfig, 'frontDesk.escalation.transferMessage', {
                        callId: callSid,
                        turn: callState?.turnCount || 0,
                        strict: false,
                        readerId: 'handleDiscoveryLane.v111Escalation'
                    });
                } catch (e) {
                    escalationMsg = null;
                }
                
                return {
                    response: escalationMsg || "Let me connect you with someone who can help.",
                    signals: { escalate: true, v111Escalation: true },
                    matchSource: 'V111_ESCALATION',
                    v111: v111Decision
                };
            }
            
            // Handle capture injection (V111 wants to prompt for missing field)
            if (v111Decision?.handler === 'CAPTURE_INJECTION' && v111Decision?.captureInjection?.inject) {
                trace.addDecisionReason('V111_CAPTURE_INJECTION', {
                    field: v111Decision.captureInjection.field,
                    priority: v111Decision.captureInjection.priority,
                    reason: v111Decision.captureInjection.reason
                });
                
                // Return capture prompt directly (bypass ConversationEngine this turn)
                logger.info('[FRONT_DESK_RUNTIME] V111 Capture injection active', {
                    callSid,
                    field: v111Decision.captureInjection.field,
                    priority: v111Decision.captureInjection.priority
                });
                
                return {
                    response: v111Decision.captureInjection.prompt,
                    signals: { captureInjection: true, captureField: v111Decision.captureInjection.field },
                    matchSource: 'V111_CAPTURE_INJECTION',
                    v111: v111Decision
                };
            }
            
        } catch (v111Err) {
            // V111 errors must NEVER crash the call - log and continue
            logger.warn('[FRONT_DESK_RUNTIME] V111 Router error (non-fatal)', {
                callSid,
                error: v111Err.message
            });
        }
    }
    
    if (!ConversationEngine) {
        logger.error('[FRONT_DESK_RUNTIME] ConversationEngine not available - fail closed');
        return {
            response: "Hello! How can I help you today?",
            signals: {},
            matchSource: 'FRONT_DESK_RUNTIME_FALLBACK'
        };
    }
    
    try {
        // ═══════════════════════════════════════════════════════════════════════
        // V116: Inject discovery truth into ConversationEngine context
        // ═══════════════════════════════════════════════════════════════════════
        // Without this, if a gate blanked the input on a prior turn the LLM
        // has amnesia about why the caller called. By attaching truth,
        // the scenario matcher and LLM always know the caller's first words
        // and intent — even if the current turn's userTurn is "[unknown input]".
        // ═══════════════════════════════════════════════════════════════════════
        const discoveryTruth = callState?.discovery?.truth || null;
        
        // Merge truth-derived slots into preExtractedSlots
        const enrichedSlots = { ...(callState?.bookingCollected || {}) };
        if (discoveryTruth?.call_reason_detail && !enrichedSlots.call_reason_detail) {
            enrichedSlots.call_reason_detail = discoveryTruth.call_reason_detail;
        }
        
        // Call ConversationEngine for discovery handling
        // V101 fix: ConversationEngine.processTurn expects a SINGLE object, not positional args
        const engineResult = await ConversationEngine.processTurn({
            companyId: company?._id?.toString() || context.companyId,
            channel: 'voice',
            userText: userTurn,
            sessionId: callState?.sessionId || null,
            callerPhone: context.callerPhone || null,
            callSid,
            preExtractedSlots: enrichedSlots,
            bookingConsentPending: callState?.bookingConsentPending || false,
            // V116: Discovery truth for scenario/LLM context
            discoveryTruth: discoveryTruth
        });
        
        // Extract signals from engine result
        const signals = engineResult.signals || {};
        
        // If engine detected booking intent or consent
        // V101 fix: ConversationEngine returns 'reply', not 'response' or 'text'
        const engineResponse = engineResult.reply || engineResult.response || engineResult.text || '';
        
        // ═══════════════════════════════════════════════════════════════════════
        // BOOKING SIGNAL HANDLING — V110 vs Legacy behavior
        // ═══════════════════════════════════════════════════════════════════════
        if (signals.deferToBookingRunner || signals.bookingModeLocked || signals.schedulingAccepted) {
            
            // ─────────────────────────────────────────────────────────────────
            // V110: Caller accepted scheduling → set flag, DON'T lock booking
            // ─────────────────────────────────────────────────────────────────
            // In V110, booking consent means the caller said "yes" to the
            // scheduling offer. But we still need to collect info (name, phone,
            // address) before running BookingFlowRunner. So:
            //   1. Set schedulingAccepted = true
            //   2. Return the scenario response (which includes the funnel)
            //   3. Next turn: determineLane sees schedulingAccepted + !complete → DISCOVERY
            //   4. ConversationEngine starts collecting info
            //   5. When complete: determineLane → BOOKING
            // ─────────────────────────────────────────────────────────────────
            const v110Steps = getConfig('frontDesk.discoveryFlow.steps', []);
            const isV110 = v110Steps.length > 0;
            
            if (isV110) {
                // Check if discovery info is already complete
                // Merge ALL slot sources: callState persisted + engine extracted this turn
                const bookingCollected = callState?.bookingCollected || callState?.slots || {};
                const collectedSlots = callState?.collectedSlots || {};
                const allCaptured = { ...collectedSlots, ...bookingCollected };
                
                // Merge slots from engine's booking flow state
                if (engineResult.bookingFlowState?.bookingCollected) {
                    Object.assign(allCaptured, engineResult.bookingFlowState.bookingCollected);
                    callState.bookingCollected = { ...callState.bookingCollected, ...engineResult.bookingFlowState.bookingCollected };
                }
                
                // Merge slots extracted this turn (name, address from "Mark Johnson 1212 Cleveland")
                if (engineResult.filledSlots) {
                    Object.assign(allCaptured, engineResult.filledSlots);
                    callState.bookingCollected = { ...(callState.bookingCollected || {}), ...engineResult.filledSlots };
                }
                if (engineResult.slotsCollected) {
                    Object.assign(allCaptured, engineResult.slotsCollected);
                    callState.bookingCollected = { ...(callState.bookingCollected || {}), ...engineResult.slotsCollected };
                }
                
                const requiredSteps = v110Steps.filter(s => s.slotId && s.slotId !== 'call_reason_detail');
                const missingSlots = requiredSteps.filter(s => {
                    const v = allCaptured[s.slotId];
                    return !v || (typeof v === 'string' && v.trim() === '');
                });
                
                if (missingSlots.length > 0) {
                    // Info still needed — don't lock booking, set scheduling flag
                    callState.schedulingAccepted = true;
                    callState.booking = callState.booking || {};
                    callState.booking.consentGiven = true;
                    
                    logger.info('[FRONT_DESK_RUNTIME] V110: Scheduling accepted — collecting info before booking', {
                        callSid: context.callSid,
                        missingSlots: missingSlots.map(s => s.slotId),
                        capturedThisTurn: Object.keys(engineResult.filledSlots || {}),
                        triggerReason: signals.bookingTriggerReason,
                        implicitConsent: !!signals.implicitConsent
                    });
                    
                    if (BlackBoxLogger) {
                        BlackBoxLogger.logEvent({
                            callId: context.callSid,
                            companyId: context.companyId,
                            type: 'V110_SCHEDULING_ACCEPTED',
                            data: {
                                reason: signals.bookingTriggerReason || 'caller_accepted_scheduling',
                                missingSlots: missingSlots.map(s => s.slotId),
                                responsePreview: (engineResponse || '').substring(0, 100)
                            }
                        }).catch(() => {});
                    }
                    
                    // Return scenario response — it already acknowledged + funneled
                    // Next turn the LLM will know schedulingAccepted=true and start collecting info
                    return {
                        response: engineResponse || "Perfect — let me get a few details. What's your first and last name?",
                        signals: { schedulingAccepted: true },
                        matchSource: engineResult.matchSource || 'CONVERSATION_ENGINE'
                    };
                }
                
                // Discovery info already captured — fall through to lock booking
                logger.info('[FRONT_DESK_RUNTIME] V110: Scheduling accepted + info already captured → locking booking', {
                    callSid: context.callSid
                });
            }
            
            // ─────────────────────────────────────────────────────────────────
            // Non-V110 (or V110 with info complete): Lock booking immediately
            // ─────────────────────────────────────────────────────────────────
            logger.info('[FRONT_DESK_RUNTIME] Booking signal detected — locking booking mode', {
                callSid: context.callSid,
                deferToBookingRunner: !!signals.deferToBookingRunner,
                bookingModeLocked: !!signals.bookingModeLocked,
                triggerReason: signals.bookingTriggerReason
            });
            
            callState.bookingModeLocked = true;
            callState.sessionMode = 'BOOKING';
            
            if (engineResult.bookingFlowState?.bookingCollected) {
                callState.bookingCollected = { 
                    ...callState.bookingCollected,
                    ...engineResult.bookingFlowState.bookingCollected 
                };
            }
            
            // Run BookingFlowRunner for the first booking step
            try {
                if (!BookingFlowRunner || !BookingFlowResolver) {
                    loadPlugins();
                }
                
                if (BookingFlowRunner && BookingFlowResolver) {
                    const deferredFlow = BookingFlowResolver.resolve({
                        companyId: context.companyId,
                        trade: callState.trade || null,
                        serviceType: callState.serviceType || null,
                        company: context.company
                    });
                    
                    const deferredState = {
                        bookingModeLocked: true,
                        bookingFlowId: deferredFlow.flowId,
                        currentStepId: deferredFlow.steps[0]?.id || 'name',
                        bookingCollected: callState.bookingCollected || {},
                        slotMetadata: {},
                        confirmedSlots: {},
                        askCount: {},
                        pendingConfirmation: null
                    };
                    
                    const bookingResult = await BookingFlowRunner.runStep({
                        flow: deferredFlow,
                        state: deferredState,
                        userInput: userTurn,
                        callSid: context.callSid,
                        company: context.company,
                        session: { mode: 'BOOKING', collectedSlots: callState.bookingCollected || {} }
                    });
                    
                    Object.assign(callState, bookingResult.state || {});
                    
                    return {
                        response: bookingResult.reply || "Great! What's a good phone number to reach you?",
                        signals: { enterBooking: true },
                        matchSource: 'BOOKING_FLOW_RUNNER',
                        bookingState: bookingResult.state
                    };
                }
            } catch (bookingErr) {
                logger.error('[FRONT_DESK_RUNTIME] BookingFlowRunner deferred execution failed', {
                    callSid: context.callSid,
                    error: bookingErr.message
                });
            }
            
            return {
                response: engineResponse || "Great! Let me help you schedule. What's your first and last name?",
                signals: { enterBooking: true },
                matchSource: engineResult.matchSource || 'CONVERSATION_ENGINE_DEFERRED'
            };
        }
        
        // If engine set consent pending (asked booking question)
        if (signals.bookingConsentPending === true) {
            return {
                response: engineResponse,
                signals: {
                    setConsentPending: true
                },
                matchSource: engineResult.matchSource || 'CONVERSATION_ENGINE'
            };
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // V111 Phase 4: Apply soft capture injection (append to response)
        // ═══════════════════════════════════════════════════════════════════════
        // If V111 router recommended capture injection but handler wasn't switched,
        // we can still append a capture prompt to the response.
        // This is "soft" injection - it doesn't interrupt the conversation.
        // ═══════════════════════════════════════════════════════════════════════
        let finalResponse = engineResponse;
        let captureInjectionApplied = false;
        
        if (v111Router && v111Decision && context.v111Memory?.isV111Enabled?.()) {
            // Check if we should apply soft capture injection
            const softCaptureCheck = context.v111Memory.shouldInjectCapturePrompt();
            
            if (softCaptureCheck.inject && engineResponse) {
                // Only apply soft injection if we have a meaningful response
                // and turns without progress is at threshold (not above - that's handled earlier)
                const turnsWithoutProgress = context.v111Memory.captureProgress?.turnsWithoutProgress || 0;
                const maxTurns = context.v111Memory.config?.routerRules?.captureInjection?.maxTurnsWithoutProgress || 2;
                
                // Soft injection at threshold, hard injection above threshold
                if (turnsWithoutProgress === maxTurns) {
                    const capturePrompt = context.v111Memory.getNextCaptureField()?.prompt;
                    if (capturePrompt) {
                        finalResponse = v111Router.applyCaptureInjection(engineResponse, {
                            inject: true,
                            prompt: capturePrompt,
                            field: softCaptureCheck.field
                        });
                        captureInjectionApplied = true;
                        
                        logger.info('[FRONT_DESK_RUNTIME] V111 Soft capture injection applied', {
                            callSid,
                            field: softCaptureCheck.field,
                            originalLength: engineResponse.length,
                            finalLength: finalResponse.length
                        });
                    }
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // OPENER ENGINE — Pre-prompt micro-acknowledgment (Layer 0)
        // ═══════════════════════════════════════════════════════════════════════
        // Prepends a fast micro-ack ("Alright.", "I hear you.") to the response
        // to eliminate dead air. Runs AFTER V111 capture injection so the ack
        // appears before the full answer.
        //
        // Config: frontDesk.conversationStyle.openers (per-company, UI-driven)
        // ═══════════════════════════════════════════════════════════════════════
        let openerDebug = null;
        if (OpenerEngine) {
            try {
                const openerConfig = getConfig('frontDesk.conversationStyle.openers', null);
                const reasonShort = callState?.discovery?.truth?.call_reason_detail || 
                                    callState?.slots?.call_reason_detail?.value ||
                                    null;
                
                const openerResult = OpenerEngine.selectOpener({
                    userText: userTurn,
                    reasonShort,
                    openerConfig,
                    turnCount: callState?.turnCount || callState?.discoveryTurnCount || 0,
                    callSid
                });
                
                if (openerResult.opener) {
                    finalResponse = OpenerEngine.prependOpener(openerResult.opener, finalResponse);
                    openerDebug = openerResult.debug;
                    
                    logger.info('[FRONT_DESK_RUNTIME] Opener prepended', {
                        callSid,
                        opener: openerResult.opener,
                        tone: openerResult.tone
                    });
                }
            } catch (openerErr) {
                // Opener must NEVER crash a call
                logger.warn('[FRONT_DESK_RUNTIME] OpenerEngine error (non-fatal)', {
                    callSid,
                    error: openerErr.message
                });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // TRACE TRUTH PIPELINE — propagate tier/debug/tokensUsed from
        // ConversationEngine for honest trace events.
        // ═══════════════════════════════════════════════════════════════════════
        return {
            response: finalResponse,
            signals: captureInjectionApplied ? { softCaptureInjection: true } : {},
            matchSource: engineResult.matchSource || 'CONVERSATION_ENGINE',
            tier: engineResult.tier || null,
            tokensUsed: engineResult.tokensUsed || 0,
            debug: { ...(engineResult.debug || {}), opener: openerDebug },
            metadata: engineResult.metadata,
            v111: v111Decision
        };
        
    } catch (error) {
        logger.error('[FRONT_DESK_RUNTIME] ConversationEngine error', {
            callSid,
            error: error.message,
            stack: error.stack?.substring(0, 800)
        });
        
        // ═══════════════════════════════════════════════════════════════════════════
        // V110 STRICT: SCENARIO_RENDER_ERROR — Log errors for call review visibility
        // ═══════════════════════════════════════════════════════════════════════════
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'SCENARIO_RENDER_ERROR',
                turn: turnCount,
                data: {
                    lane: 'CONVERSATION_ENGINE',
                    errorMessage: error.message,
                    stack: error.stack?.split('\n').slice(0, 8).join('\n'),
                    userTurn: userTurn?.substring(0, 50),
                    sessionMode: callState?.sessionMode,
                    bookingModeLocked: callState?.bookingModeLocked,
                    note: 'V110 STRICT: ConversationEngine threw an exception'
                }
            }).catch(() => {});
        }
        
        return {
            response: "I'm here to help! What can I assist you with?",
            signals: {},
            matchSource: 'FRONT_DESK_RUNTIME_ERROR_RECOVERY',
            tier: null,
            tokensUsed: 0,
            debug: null
        };
    }
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * handleEscalateLane() - Process escalation/transfer
 * ═══════════════════════════════════════════════════════════════════════════════
 */
async function handleEscalateLane(effectiveConfig, callState, userTurn, context, trace) {
    const { callSid, turnCount = 0 } = context;
    trace.addDecisionReason('ESCALATE_LANE_HANDLER', { reason: 'escalation_triggered' });
    
    // V102: Read via cfgGet for tracing
    const defaultTransferMsg = "Of course, let me connect you with someone who can help.";
    let transferMessage;
    try {
        const value = cfgGet(effectiveConfig, 'frontDesk.escalation.transferMessage', {
            callId: callSid,
            turn: turnCount,
            strict: false,
            readerId: 'FrontDeskRuntime.handleEscalateLane'
        });
        // V102 FIX: Use default if cfgGet returns undefined/null
        transferMessage = (value !== undefined && value !== null && value !== '') ? value : defaultTransferMsg;
    } catch (e) {
        transferMessage = defaultTransferMsg;
    }
    
    return {
        response: transferMessage,
        signals: { escalate: true, transfer: true },
        action: 'TRANSFER',
        matchSource: 'FRONT_DESK_ESCALATION'
    };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * isStrictModeEnabled() - Check if strict Control Plane mode is on
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function isStrictModeEnabled(effectiveConfig) {
    // Check enforcement.level first, then fallback to strictControlPlaneOnly boolean
    const level = effectiveConfig?.frontDesk?.enforcement?.level;
    if (level) {
        return level === 'strict';
    }
    return effectiveConfig?.frontDesk?.enforcement?.strictControlPlaneOnly === true;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * getEnforcementLevel() - Get current enforcement level ("warn" or "strict")
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function getEnforcementLevel(effectiveConfig) {
    const level = effectiveConfig?.frontDesk?.enforcement?.level;
    if (level && ['warn', 'strict'].includes(level)) {
        return level;
    }
    return effectiveConfig?.frontDesk?.enforcement?.strictControlPlaneOnly === true ? 'strict' : 'warn';
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * EXPORTS
 * ═══════════════════════════════════════════════════════════════════════════════
 */
module.exports = {
    handleTurn,
    determineLane,
    isStrictModeEnabled,
    getEnforcementLevel,
    LANES
};
