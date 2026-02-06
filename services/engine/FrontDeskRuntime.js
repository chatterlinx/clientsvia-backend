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
    // GATE 2: Determine current lane
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
        
        const isConsent = consentPhrases.some(phrase => {
            const regex = new RegExp(`^${phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s.,!]*$`, 'i');
            return regex.test(userTurnLower.trim());
        });
        
        if (isConsent) {
            trace.addDecisionReason('LANE_BOOKING', { reason: 'consent_given_after_offer' });
            return LANES.BOOKING;
        }
    }
    
    // 4. Check for direct booking intent (V102: via cfgGet)
    const bookingTriggers = getConfig('frontDesk.detectionTriggers.wantsBooking', []);
    const directIntentPatterns = getConfig('booking.directIntentPatterns', []);
    const allBookingPatterns = [...bookingTriggers, ...directIntentPatterns];
    
    for (const pattern of allBookingPatterns) {
        if (userTurnLower.includes(pattern.toLowerCase())) {
            trace.addDecisionReason('LANE_BOOKING', { reason: 'direct_booking_intent', pattern });
            return LANES.BOOKING;
        }
    }
    
    // 5. Default to discovery
    trace.addDecisionReason('LANE_DISCOVERY', { reason: 'default' });
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
        // GATE 3: Are booking slots configured? (cfgGet - traced read)
        // ═══════════════════════════════════════════════════════════════════════
        let bookingSlots;
        try {
            bookingSlots = cfgGet(effectiveConfig, 'frontDesk.bookingSlots', {
                callId: callSid,
                turn: callState?.turnCount || 0,
                strict: false,
                readerId: 'handleBookingLane.bookingSlots'
            });
        } catch (e) {
            bookingSlots = null;
        }
        
        if (!bookingSlots || !Array.isArray(bookingSlots) || bookingSlots.length === 0) {
            logger.error('[FRONT_DESK_RUNTIME] No bookingSlots configured - fail closed', { callSid });
            
            if (BlackBoxLogger) {
                BlackBoxLogger.logEvent({
                    callId: callSid,
                    companyId,
                    type: 'BOOKING_FLOW_ERROR',
                    data: {
                        error: 'frontDesk.bookingSlots is empty or not configured',
                        gate: 'BOOKING_SLOTS_MISSING',
                        recovery: 'ESCALATE',
                        slotCount: Array.isArray(bookingSlots) ? bookingSlots.length : 0
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
    
    trace.addDecisionReason('DISCOVERY_LANE_HANDLER', { handler: 'ConversationEngine' });
    
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
        
        if (signals.deferToBookingRunner || signals.bookingModeLocked) {
            return {
                response: engineResponse,
                signals: {
                    enterBooking: true,
                    enterBookingReason: signals.bookingTriggerReason || 'engine_detected',
                    setConsentPending: signals.bookingConsentPending
                },
                matchSource: engineResult.matchSource || 'CONVERSATION_ENGINE'
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
        
        return {
            response: engineResponse,
            signals: {},
            matchSource: engineResult.matchSource || 'CONVERSATION_ENGINE',
            metadata: engineResult.metadata
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
