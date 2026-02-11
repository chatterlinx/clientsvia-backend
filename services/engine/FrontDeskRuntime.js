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
    // Determine enforcement level: "strict" = block+fail, "warn" = log only
    const enforcementLevel = effectiveConfig?.frontDesk?.enforcement?.level || 
        (effectiveConfig?.frontDesk?.enforcement?.strictControlPlaneOnly === true ? 'strict' : 'warn');
    const strictMode = enforcementLevel === 'strict';
    const validation = validateConfig(effectiveConfig, callSid);
    
    // Log enforcement status on every turn for visibility
    logger.info('[FRONT_DESK_RUNTIME] Enforcement status', {
        callSid,
        enforcementLevel,
        strictMode,
        validationOk: validation.valid,
        missingRequiredCount: validation.missingRequired?.length || 0
    });
    
    if (!validation.valid && strictMode) {
        logger.error('[FRONT_DESK_RUNTIME] FAIL CLOSED - Control Plane validation failed', {
            callSid,
            missingRequired: validation.missingRequired,
            strictMode
        });
        
        trace.addDecisionReason('FAIL_CLOSED', { 
            reason: 'CONTROL_PLANE_VALIDATION_FAILED',
            missingRequired: validation.missingRequired
        });
        
        if (BlackBoxLogger) {
            BlackBoxLogger.logEvent({
                callId: callSid,
                companyId,
                type: 'FRONT_DESK_FAIL_CLOSED',
                turn: turnCount,
                data: {
                    reason: 'CONTROL_PLANE_VALIDATION_FAILED',
                    missingRequired: validation.missingRequired,
                    strictMode
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
    
    if (cqEnabled && (actualTurnCount <= 3 || hasPriorTrouble) && !callState?.bookingModeLocked) {
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
        
        // V116: Count real words (alphanumeric tokens) to detect substantive content
        const realWords = normalizedInput.split(/\s+/).filter(w => w.replace(/[^a-z0-9]/g, '').length > 0);
        const hasSubstantiveContent = realWords.length > 3;
        
        // V116: NEVER fire gate if caller said something real
        // "Hello my AC isn't cooling and it's leaking" → 8+ words → real utterance → let it through
        let isTroublePhrase = false;
        let isLowConfidence = false;
        
        if (!hasSubstantiveContent) {
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
                // RE-GREETING — try again
                const reGreeting = cqGate?.reGreeting || 'Hi there! How can I help you today?';
                
                return {
                    response: reGreeting,
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
    
    return {
        response: result.response,
        text: result.response, // Alias for compatibility
        state: callState,
        lane: currentLane,
        signals: result.signals || {},
        action: result.action,
        matchSource: result.matchSource || 'FRONT_DESK_RUNTIME',
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
    if (callState?.bookingConsentPending === true) {
        const consentPhrases = getConfig('frontDesk.discoveryConsent.consentPhrases',
            ['yes', 'yeah', 'yep', 'sure', 'okay', 'ok', 'please']);
        
        // V110: Strip STT artifact punctuation before consent matching.
        // When STT preprocessing removes fillers (e.g., "Uh", "please"), it leaves
        // orphaned punctuation: "Uh, yes, please." → ", yes, ."
        // The ^-anchored regex needs a clean start-of-string to match.
        const cleanedForConsent = userTurnLower.trim()
            .replace(/^[\s,.:;!?]+/, '')   // strip leading punctuation from filler removal
            .replace(/[\s,.:;!?]+$/, '');   // strip trailing punctuation
        
        const isConsent = cleanedForConsent.length > 0 && consentPhrases.some(phrase => {
            const regex = new RegExp(`^${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s.,!]*$`, 'i');
            return regex.test(cleanedForConsent);
        });
        
        if (isConsent) {
            trace.addDecisionReason('LANE_BOOKING', { reason: 'consent_given_after_offer' });
            return LANES.BOOKING;
        }
    }
    
    // 4. Check for direct booking intent (V102: via cfgGet)
    // V108: ALL detection triggers MUST come from frontDesk.detectionTriggers.*
    // In strict mode: booking.directIntentPatterns is FORBIDDEN (legacy/compat only)
    const bookingTriggers = getConfig('frontDesk.detectionTriggers.wantsBooking', []);
    
    // V108: Read from CANONICAL location first (frontDesk.detectionTriggers.directIntentPatterns)
    const directIntentPatternsCanonical = getConfig('frontDesk.detectionTriggers.directIntentPatterns', []);
    
    // V108: Check enforcement level - strict mode bans legacy paths
    const enforcementLevel = getConfig('frontDesk.enforcement.level', 'warn');
    const isStrictMode = enforcementLevel === 'strict';
    
    let directIntentPatterns;
    if (isStrictMode) {
        // STRICT MODE: ONLY read from frontDesk.detectionTriggers.directIntentPatterns
        directIntentPatterns = directIntentPatternsCanonical;
        if (directIntentPatternsCanonical.length === 0) {
            logger.warn('[FRONT_DESK_RUNTIME] V108: STRICT MODE - No directIntentPatterns at canonical path frontDesk.detectionTriggers.directIntentPatterns');
        }
    } else {
        // WARN MODE: Fall back to legacy booking.directIntentPatterns for migration period
        const directIntentPatternsLegacy = getConfig('booking.directIntentPatterns', []);
        directIntentPatterns = directIntentPatternsCanonical.length > 0 
            ? directIntentPatternsCanonical 
            : directIntentPatternsLegacy;
        
        if (directIntentPatternsLegacy.length > 0 && directIntentPatternsCanonical.length === 0) {
            logger.warn('[FRONT_DESK_RUNTIME] V108: Reading from legacy booking.directIntentPatterns - migrate to frontDesk.detectionTriggers.directIntentPatterns');
        }
    }
    
    // V107: If both are empty, use hardcoded emergency fallback
    // This prevents "cold start" where new companies have no patterns at all
    const FALLBACK_PATTERNS = [
        'schedule', 'book', 'appointment', 'come out', 'send someone',
        'get someone', 'need someone', 'help me out', 'technician'
    ];
    
    let allBookingPatterns;
    if (bookingTriggers.length === 0 && directIntentPatterns.length === 0) {
        allBookingPatterns = FALLBACK_PATTERNS;
        logger.warn('[FRONT_DESK_RUNTIME] V108: Using fallback patterns - company has no booking triggers configured');
    } else {
        allBookingPatterns = [...new Set([...bookingTriggers, ...directIntentPatterns])];
    }
    
    // V105: Normalize text to catch variations
    // - "somebody" → "someone"
    // - "anybody" → "anyone"
    // - "gonna" → "going to"
    const normalizedInput = userTurnLower
        .replace(/\bsomebody\b/g, 'someone')
        .replace(/\banybody\b/g, 'anyone')
        .replace(/\bgonna\b/g, 'going to')
        .replace(/\bwanna\b/g, 'want to')
        .replace(/\bgotta\b/g, 'got to');
    
    // Check configured patterns first
    for (const pattern of allBookingPatterns) {
        const normalizedPattern = pattern.toLowerCase()
            .replace(/\bsomebody\b/g, 'someone')
            .replace(/\banybody\b/g, 'anyone');
            
        if (normalizedInput.includes(normalizedPattern)) {
            trace.addDecisionReason('LANE_BOOKING', { 
                reason: 'direct_booking_intent', 
                pattern,
                matchedIn: 'configured_patterns'
            });
            return LANES.BOOKING;
        }
    }
    
    // V107: Smart pattern matching for common service request variations
    // These catch phrases even if not explicitly configured in UI
    // CRITICAL: Must match how REAL HUMANS talk, not formal booking language
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
        /\b(something'?s?\s+wrong|not\s+working|broken|won'?t\s+work).{0,30}(need|send|get)\s+(someone|somebody|help)/i
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
 * 2. cfgGet('frontDesk.bookingSlots') - if empty, escalate with UI message
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
        // GATE 3: V110 SLOT REGISTRY CHECK (CANONICAL) → LEGACY FALLBACK
        // ═══════════════════════════════════════════════════════════════════════
        // Priority 1: V110 slotRegistry.slots + bookingFlow.steps
        // Priority 2: Legacy bookingSlots (deprecated)
        // ═══════════════════════════════════════════════════════════════════════
        let bookingSlots;
        let configSource = 'UNKNOWN';
        
        try {
            // V110: Check slotRegistry + bookingFlow first
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
                // V110 is configured - merge slots with steps
                bookingSlots = _mergeV110SlotsWithSteps(v110Slots, v110Steps);
                configSource = 'V110_SLOT_REGISTRY';
                
                logger.info('[FRONT_DESK_RUNTIME] ✅ V110: Using slotRegistry + bookingFlow', {
                    callSid,
                    slotCount: v110Slots.length,
                    stepCount: v110Steps.length
                });
            } else {
                // ═══════════════════════════════════════════════════════════════
                // V116 TRAP: Legacy bookingSlots path is DEAD
                // If we reach here, the company has no V110 config.
                // Log violation, return null (will fail closed below).
                // ═══════════════════════════════════════════════════════════════
                configSource = 'LEGACY_TRAPPED';
                bookingSlots = null;
                
                // Check if legacy data exists (for diagnostic logging)
                const legacyBookingSlots = cfgGet(effectiveConfig, 'frontDesk.bookingSlots', {
                    callId: callSid,
                    turn: callState?.turnCount || 0,
                    strict: false,
                    readerId: 'handleBookingLane.legacy.TRAP_CHECK'
                });
                
                if (legacyBookingSlots && legacyBookingSlots.length > 0) {
                    logger.error('[FRONT_DESK_RUNTIME] 🚨 LEGACY_BOOKING_TRAPPED — company has legacy bookingSlots but NO V110 config', {
                        callSid,
                        companyId,
                        legacySlotCount: legacyBookingSlots.length,
                        action: 'RETURNING_NULL — company must be migrated to V110 slotRegistry + bookingFlow'
                    });
                    
                    // V110RuntimeGuard: log violation to BlackBox
                    try {
                        const V110RuntimeGuard = require('../V110RuntimeGuard');
                        V110RuntimeGuard.verifyBookingSource('LEGACY_BOOKING_SLOTS', callSid, companyId, 'handleBookingLane');
                    } catch (e) { /* guard is non-fatal */ }
                }
            }
        } catch (e) {
            bookingSlots = null;
            configSource = 'ERROR';
            logger.error('[FRONT_DESK_RUNTIME] Error loading booking slots', { callSid, error: e.message });
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // CRITICAL TRACE: BOOKING_SLOTS_LOADED or BOOKING_SLOTS_EMPTY
        // This tells you EXACTLY where slots were looked for and what was found
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
                    awPath: configSource === 'V110_SLOT_REGISTRY' 
                        ? 'frontDesk.slotRegistry + frontDesk.bookingFlow' 
                        : 'frontDesk.bookingSlots',
                    resolvedFrom: slotCount > 0 ? configSource : 'NOT_FOUND',
                    lookupDetails: {
                        v110Checked: true,
                        legacyChecked: configSource !== 'V110_SLOT_REGISTRY',
                        effectiveConfigKeys: Object.keys(effectiveConfig || {}).slice(0, 10),
                        hasFrontDeskBehavior: !!effectiveConfig?.frontDeskBehavior,
                        hasSlotRegistry: !!effectiveConfig?.frontDeskBehavior?.slotRegistry,
                        hasBookingFlow: !!effectiveConfig?.frontDeskBehavior?.bookingFlow,
                        hasLegacyBookingSlots: !!effectiveConfig?.frontDeskBehavior?.bookingSlots
                    }
                }
            }).catch(() => {});
        }
        
        if (!bookingSlots || !Array.isArray(bookingSlots) || bookingSlots.length === 0) {
            logger.error('[FRONT_DESK_RUNTIME] No booking slots configured (V110 or legacy) - fail closed', { 
                callSid,
                configSource,
                v110Path: 'frontDesk.slotRegistry + frontDesk.bookingFlow',
                legacyPath: 'frontDesk.bookingSlots',
                effectiveConfigHasFrontDeskBehavior: !!effectiveConfig?.frontDeskBehavior,
                hasSlotRegistry: !!effectiveConfig?.frontDeskBehavior?.slotRegistry,
                hasBookingFlow: !!effectiveConfig?.frontDeskBehavior?.bookingFlow,
                hasLegacyBookingSlots: !!effectiveConfig?.frontDeskBehavior?.bookingSlots
            });
            
            if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                    callId: callSid,
                    companyId,
                    type: 'BOOKING_FLOW_ERROR',
                    data: {
                        error: 'frontDesk.bookingSlots is empty or not configured',
                        gate: 'BOOKING_SLOTS_MISSING',
                        recovery: 'ESCALATE',
                        slotCount: 0,
                        debug: {
                            awPath: 'frontDesk.bookingSlots',
                            translatedPath: 'frontDeskBehavior.bookingSlots',
                            effectiveConfigKeys: Object.keys(effectiveConfig || {}).slice(0, 10),
                            hasFrontDeskBehavior: !!effectiveConfig?.frontDeskBehavior,
                            frontDeskBehaviorBookingSlotsLength: effectiveConfig?.frontDeskBehavior?.bookingSlots?.length || 0
                        }
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
        const bookingState = {
            bookingCollected: callState.bookingCollected || callState.slots || {},
            confirmedSlots: callState.confirmedSlots || {},
            slotMetadata: callState.slotMetadata || {},
            currentStepId: callState.currentBookingStep,
            turn: callState.turnCount || 0,
            _traceContext: { callSid, companyId }
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
        }
        
        // ═══════════════════════════════════════════════════════════════════════
        // UPDATE: Sync state back to callState
        // ═══════════════════════════════════════════════════════════════════════
        if (bookingResult.state) {
            callState.bookingCollected = bookingResult.state.bookingCollected || callState.bookingCollected;
            callState.slots = bookingResult.state.bookingCollected || callState.slots;
            callState.confirmedSlots = bookingResult.state.confirmedSlots || callState.confirmedSlots;
            callState.slotMetadata = bookingResult.state.slotMetadata || callState.slotMetadata;
            callState.currentBookingStep = bookingResult.state.currentStepId;
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
        // Call ConversationEngine for discovery handling
        // V101 fix: ConversationEngine.processTurn expects a SINGLE object, not positional args
        const engineResult = await ConversationEngine.processTurn({
            companyId: company?._id?.toString() || context.companyId,
            channel: 'voice',
            userText: userTurn,
            sessionId: callState?.sessionId || null,
            callerPhone: context.callerPhone || null,
            callSid,
            preExtractedSlots: callState?.bookingCollected || {},
            bookingConsentPending: callState?.bookingConsentPending || false
        });
        
        // Extract signals from engine result
        const signals = engineResult.signals || {};
        
        // If engine detected booking intent or consent
        // V101 fix: ConversationEngine returns 'reply', not 'response' or 'text'
        const engineResponse = engineResult.reply || engineResult.response || engineResult.text || '';
        
        // ═══════════════════════════════════════════════════════════════════════
        // V109: If deferToBookingRunner=true, we MUST run BookingFlowRunner NOW
        // ═══════════════════════════════════════════════════════════════════════
        // BUG FIX: Previously, when ConversationEngine signaled deferToBookingRunner
        // with reply=null, we'd return an empty response that became "I'm sorry, 
        // could you repeat that?" - THIS IS THE ROOT CAUSE OF SPLIT-BRAIN.
        //
        // FIX: Actually run BookingFlowRunner here to generate the booking prompt.
        // ═══════════════════════════════════════════════════════════════════════
        if (signals.deferToBookingRunner || signals.bookingModeLocked) {
            logger.info('[FRONT_DESK_RUNTIME] V109: deferToBookingRunner detected - running BookingFlowRunner NOW', {
                callSid: context.callSid,
                deferToBookingRunner: !!signals.deferToBookingRunner,
                bookingModeLocked: !!signals.bookingModeLocked,
                hasEngineResponse: !!engineResponse,
                triggerReason: signals.bookingTriggerReason
            });
            
            // Lock booking mode immediately (Absolute Booking Gate from now on)
            callState.bookingModeLocked = true;
            callState.sessionMode = 'BOOKING';
            
            // Copy any collected slots from engine result
            if (engineResult.bookingFlowState?.bookingCollected) {
                callState.bookingCollected = { 
                    ...callState.bookingCollected,
                    ...engineResult.bookingFlowState.bookingCollected 
                };
            }
            
            // Actually run BookingFlowRunner to get the booking prompt
            try {
                if (!BookingFlowRunner || !BookingFlowResolver) {
                    loadPlugins();
                }
                
                if (BookingFlowRunner && BookingFlowResolver) {
                    // Resolve the booking flow
                    const deferredFlow = BookingFlowResolver.resolve({
                        companyId: context.companyId,
                        trade: callState.trade || null,
                        serviceType: callState.serviceType || null,
                        company: context.company
                    });
                    
                    // Build initial state
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
                    
                    // Run booking flow
                    const bookingResult = await BookingFlowRunner.runStep({
                        flow: deferredFlow,
                        state: deferredState,
                        userInput: userTurn,
                        callSid: context.callSid,
                        company: context.company,
                        session: { mode: 'BOOKING', collectedSlots: callState.bookingCollected || {} }
                    });
                    
                    // Update callState with booking state
                    Object.assign(callState, bookingResult.state || {});
                    
                    if (BlackBoxLogger) {
                        BlackBoxLogger.logEvent({
                            callId: context.callSid,
                            companyId: context.companyId,
                            type: 'DEFERRED_BOOKING_EXECUTED',
                            data: {
                                reason: signals.bookingTriggerReason || 'deferToBookingRunner',
                                flowId: deferredFlow.flowId,
                                currentStep: bookingResult.state?.currentStepId,
                                responsePreview: bookingResult.reply?.substring(0, 100)
                            }
                        }).catch(() => {});
                    }
                    
                    return {
                        response: bookingResult.reply || "Great! What's a good phone number to reach you?",
                        signals: {
                            enterBooking: true,
                            enterBookingReason: signals.bookingTriggerReason || 'deferred_from_engine'
                        },
                        matchSource: 'BOOKING_FLOW_RUNNER',
                        bookingState: bookingResult.state
                    };
                }
            } catch (bookingErr) {
                logger.error('[FRONT_DESK_RUNTIME] V109: BookingFlowRunner deferred execution failed', {
                    callSid: context.callSid,
                    error: bookingErr.message
                });
                // Fall through to return enterBooking signal with whatever response we have
            }
            
            // Fallback if BookingFlowRunner couldn't run
            return {
                response: engineResponse || "Great! Let me help you schedule. What's a good phone number to reach you?",
                signals: {
                    enterBooking: true,
                    enterBookingReason: signals.bookingTriggerReason || 'engine_detected',
                    setConsentPending: signals.bookingConsentPending
                },
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
        
        return {
            response: finalResponse,
            signals: captureInjectionApplied ? { softCaptureInjection: true } : {},
            matchSource: engineResult.matchSource || 'CONVERSATION_ENGINE',
            metadata: engineResult.metadata,
            v111: v111Decision
        };
        
    } catch (error) {
        logger.error('[FRONT_DESK_RUNTIME] ConversationEngine error', {
            callSid,
            error: error.message
        });
        
        return {
            response: "I'm here to help! What can I assist you with?",
            signals: {},
            matchSource: 'FRONT_DESK_RUNTIME_ERROR_RECOVERY'
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
