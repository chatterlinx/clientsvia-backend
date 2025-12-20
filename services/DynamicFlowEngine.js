/**
 * ============================================================================
 * DYNAMIC FLOW ENGINE - The Conversation Brain Stem
 * ============================================================================
 * 
 * This engine evaluates triggers, fires events, and executes actions.
 * It sits ABOVE the LLM and controls conversation flow deterministically.
 * 
 * ARCHITECTURE:
 * 1. Each turn, evaluate all enabled flows' triggers
 * 2. Fire events for matched triggers
 * 3. Activate requirements (add slots, set flags, etc.)
 * 4. Execute actions (mode transitions, responses, etc.)
 * 5. Log trace to Black Box
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * CRITICAL RULES (PREVENT DOUBLE-BRAIN SYNDROME):
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * 1. ONLY ONE COMPONENT decides "next required item":
 *    - DynamicFlowEngine: emits events, requirements, guardrails
 *    - BookingEngine: owns slot order and next question
 *    - LLM: only phrases responses, never decides flow
 * 
 * 2. DynamicFlowEngine CAN:
 *    - Emit events (EVENT_RETURNING_CUSTOMER_CLAIM)
 *    - Add requirements to pendingRequirements
 *    - Set flags on session
 *    - Apply guardrails (NO_REGREET, NO_RESTART_BOOKING)
 *    - Transition mode (DISCOVERY → BOOKING)
 * 
 * 3. DynamicFlowEngine CANNOT:
 *    - Directly choose the next prompt
 *    - Override bookingSlots order
 *    - Bypass guardrails
 *    - Generate response text (only suggest)
 * 
 * 4. MULTI-TENANT ISOLATION:
 *    - Runtime ONLY uses company-specific flows
 *    - Global templates are NEVER used directly
 *    - Companies must COPY templates to use them
 * 
 * ============================================================================
 */

const DynamicFlow = require('../models/DynamicFlow');
const logger = require('../utils/logger');

// ════════════════════════════════════════════════════════════════════════════
// ENGINE VERSION
// ════════════════════════════════════════════════════════════════════════════
const ENGINE_VERSION = 'V1.2-CALL-LEDGER-NORMALIZED';

logger.info(`[DYNAMIC FLOW ENGINE] 🧠 LOADED VERSION: ${ENGINE_VERSION}`);

// Helper: initialize call ledger
function ensureCallLedger(session) {
    session.callLedger = session.callLedger || {};
    session.callLedger.activeScenarios = session.callLedger.activeScenarios || [];
    session.callLedger.entries = session.callLedger.entries || [];
    session.callLedger.facts = session.callLedger.facts || {};
    session.locks = session.locks || {};
    session.locks.flowAcked = session.locks.flowAcked || {};
    return session.callLedger;
}

// ════════════════════════════════════════════════════════════════════════════
// FLOW STATE MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Initialize flow state on session
 * Uses the new schema: active, needs, facts, ledger, trace, locks
 */
function initializeFlowState(session) {
    if (!session.dynamicFlows) {
        session.dynamicFlows = {
            // Active flows for this session
            active: [],                // [{ flowKey, activatedAtTurn, status }]
            
            // Unified needs list (merged from base booking + flow requirements)
            needs: [],                 // [{ type, key, order, done, source, prompt?, required? }]
            
            // Facts store for custom field values
            facts: {},                 // { clientId: "ABC123", gateCode: "9823" }
            
            // Ledger: append-only event log
            ledger: [],                // ["Turn 2: Caller claims returning customer"]
            
            // Trace: per-turn debug data
            trace: [],                 // [{ turn, triggersEvaluated, triggersFired, ... }]
            
            // Locks for dynamic flow actions (prevent repeats)
            locks: {
                acked: {}              // { flowKey: true } - ACK_ONCE spoken
            },
            
            // LEGACY: Keep for backward compatibility
            activeFlows: [],
            completedFlows: [],
            pendingRequirements: [],
            pendingActions: []
        };
    }
    
    // Ensure new fields exist on existing sessions
    if (!session.dynamicFlows.active) session.dynamicFlows.active = [];
    if (!session.dynamicFlows.needs) session.dynamicFlows.needs = [];
    if (!session.dynamicFlows.facts) session.dynamicFlows.facts = {};
    if (!session.dynamicFlows.ledger) session.dynamicFlows.ledger = [];
    if (!session.dynamicFlows.locks) session.dynamicFlows.locks = { acked: {} };
    
    return session.dynamicFlows;
}

/**
 * Get active flow state from session
 */
function getFlowState(session) {
    return session.dynamicFlows || initializeFlowState(session);
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN ENGINE FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Process a turn through the dynamic flow engine
 * 
 * @param {Object} options
 * @param {string} options.companyId - Company ID
 * @param {Object} options.session - Session object
 * @param {string} options.userText - User's message
 * @param {Object} options.slots - Current collected slots
 * @param {Object} options.customer - Customer context
 * @param {Object} options.company - Company config
 * @returns {Object} Engine result with activated flows, requirements, actions
 */
async function processTurn({
    companyId,
    session,
    userText,
    slots,
    customer,
    company
}) {
    const startTime = Date.now();
    const prevMode = session.mode || 'DISCOVERY';
    const flowState = initializeFlowState(session);
    const callLedger = ensureCallLedger(session);
    
    const result = {
        triggersEvaluated: [],
        triggersFired: [],
        flowsActivated: [],
        flowsDeactivated: [],
        requirementsAdded: [],
        actionsExecuted: [],
        guardrailsApplied: [],
        stateChanges: {},
        trace: null
    };
    
    try {
        // ─────────────────────────────────────────────────────────────────────
        // STEP 1: Load enabled flows for this company
        // ─────────────────────────────────────────────────────────────────────
        const tradeType = company?.tradeType || null;
        const flows = await DynamicFlow.getFlowsForCompany(companyId, tradeType);
        // Sort by priority desc, then createdAt desc for stability
        flows.sort((a, b) => (b.priority || 0) - (a.priority || 0));
        
        logger.debug('[DYNAMIC FLOW] Loaded flows', {
            companyId,
            flowCount: flows.length,
            activeFlows: flowState.activeFlows.length
        });
        
        // ─────────────────────────────────────────────────────────────────────
        // STEP 2: Build evaluation context
        // ─────────────────────────────────────────────────────────────────────
        const context = {
            userText,
            session,
            customer,
            slots,
            company,
            flowState,
            turnNumber: (session.metrics?.totalTurns || 0) + 1
        };
        
        // ─────────────────────────────────────────────────────────────────────
        // STEP 3: Evaluate triggers for non-active flows
        // ─────────────────────────────────────────────────────────────────────
        for (const flow of flows) {
            result.triggersEvaluated.push(flow.flowKey);
            
            // Skip if already active (unless reactivatable)
            const isActive = flowState.activeFlows.includes(flow._id.toString());
            const isCompleted = flowState.completedFlows.includes(flow._id.toString());
            
            if (isActive) continue;
            if (isCompleted && !flow.settings?.reactivatable) continue;
            
            // Evaluate triggers
            const triggerResult = evaluateFlowTriggers(flow, context);
            
            if (triggerResult.matched && triggerResult.confidence >= (flow.settings?.minConfidence || 0.7)) {
                result.triggersFired.push({
                    flowKey: flow.flowKey,
                    flowId: flow._id.toString(),
                    trigger: triggerResult.trigger?.type,
                    confidence: triggerResult.confidence,
                    matchedValue: triggerResult.matchedValue
                });
                
                // Activate flow
                const activation = activateFlow(flow, flowState, context);
                if (activation.activated) {
                    result.flowsActivated.push({
                        flowKey: flow.flowKey,
                        flowId: flow._id.toString(),
                        requirements: activation.requirements.length,
                        actions: activation.onActivateActions.length
                    });
                    
                    result.requirementsAdded.push(...activation.requirements);
                    
                    // Execute on_activate actions
                    for (const action of activation.onActivateActions) {
                        action.flowKey = flow.flowKey;
                        const actionResult = executeAction(action, context, session);
                        result.actionsExecuted.push(actionResult);
                        
                        if (actionResult.stateChange) {
                            Object.assign(result.stateChanges, actionResult.stateChange);
                        }
                    }
                    
                    // Record usage
                    DynamicFlow.recordUsage(flow._id).catch(() => {});
                }
            }
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // STEP 4: Process active flows (check completion, execute actions)
        // ─────────────────────────────────────────────────────────────────────
        for (const activeFlowId of [...flowState.activeFlows]) {
            const flow = flows.find(f => f._id.toString() === activeFlowId);
            if (!flow) continue;
            
            // Check if requirements are met
            const requirementStatus = checkRequirements(flow, context);
            
            if (requirementStatus.allMet) {
                // Flow complete - execute on_complete actions
                const onCompleteActions = (flow.actions || []).filter(a => a.timing === 'on_complete');
                
                for (const action of onCompleteActions) {
                    const actionResult = executeAction(action, context, session);
                    result.actionsExecuted.push(actionResult);
                    
                    if (actionResult.stateChange) {
                        Object.assign(result.stateChanges, actionResult.stateChange);
                    }
                }
                
                // Deactivate flow
                deactivateFlow(flow, flowState, 'completed');
                result.flowsDeactivated.push({
                    flowKey: flow.flowKey,
                    reason: 'completed'
                });
            } else {
                // Execute each_turn actions
                const eachTurnActions = (flow.actions || []).filter(a => a.timing === 'each_turn');
                
                for (const action of eachTurnActions) {
                    action.flowKey = flow.flowKey;
                    const actionResult = executeAction(action, context, session);
                    result.actionsExecuted.push(actionResult);
                }
            }
        }
        
        // ─────────────────────────────────────────────────────────────────────
        // STEP 5: Apply guardrails based on active flows
        // ─────────────────────────────────────────────────────────────────────
        const guardrails = applyGuardrails(flowState, session, context);
        result.guardrailsApplied = guardrails;
        
        // ─────────────────────────────────────────────────────────────────────
        // STEP 6: Build trace for Black Box
        // ─────────────────────────────────────────────────────────────────────
        const ledgerAppends = result.actionsExecuted
            .filter(a => a.type === 'append_ledger' && a.executed)
            .map(a => ({
                type: a.config?.type,
                key: a.config?.key,
                note: a.config?.note,
                flowKey: a.flowKey
            }));
        const modeChange = result.stateChanges?.mode ? { from: prevMode, to: result.stateChanges.mode } : null;
        result.trace = {
            turn: context.turnNumber,
            timestamp: new Date(),
            inputSnippet: (userText || '').substring(0, 120),
            latencyMs: Date.now() - startTime,
            evaluatedCount: result.triggersEvaluated.length,
            triggersEvaluated: result.triggersEvaluated,
            triggersFired: result.triggersFired.map(t => ({ key: t.flowKey, confidence: t.confidence })),
            flowsActivated: result.flowsActivated.map(f => f.flowKey),
            flowsDeactivated: result.flowsDeactivated.map(f => f.flowKey),
            activeFlows: flowState.activeFlows,
            actionsExecuted: result.actionsExecuted.map(a => ({
                type: a.type,
                payload: a.config
            })),
            ledgerAppends,
            guardrailsApplied: result.guardrailsApplied,
            stateChanges: result.stateChanges,
            modeChange
        };
        
        // Add to session trace
        flowState.trace.push(result.trace);
        
        logger.info('[DYNAMIC FLOW] Turn processed', {
            companyId,
            turn: context.turnNumber,
            triggersFired: result.triggersFired.length,
            flowsActivated: result.flowsActivated.length,
            actionsExecuted: result.actionsExecuted.length,
            latencyMs: result.trace.latencyMs
        });
        
        return result;
        
    } catch (error) {
        logger.error('[DYNAMIC FLOW] Error processing turn', {
            companyId,
            error: error.message,
            stack: error.stack
        });
        
        return {
            ...result,
            error: error.message
        };
    }
}

// ════════════════════════════════════════════════════════════════════════════
// TRIGGER EVALUATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Evaluate all triggers for a flow
 */
function evaluateFlowTriggers(flow, context) {
    const triggers = flow.triggers || [];
    
    // Sort by priority (higher first)
    const sortedTriggers = [...triggers].sort((a, b) => (b.priority || 0) - (a.priority || 0));
    
    for (const trigger of sortedTriggers) {
        const result = evaluateTrigger(trigger, context);
        if (result.matched) {
            return {
                matched: true,
                trigger,
                confidence: result.confidence,
                matchedValue: result.matchedValue
            };
        }
    }
    
    return { matched: false };
}

/**
 * Evaluate a single trigger
 */
function evaluateTrigger(trigger, context) {
    const { userText, session, customer, slots } = context;
    const userTextLower = (userText || '').toLowerCase().trim();
    
    switch (trigger.type) {
        case 'phrase': {
            const phrases = trigger.config?.phrases || [];
            for (const phrase of phrases) {
                const phraseLower = phrase.toLowerCase();
                if (trigger.config?.fuzzy !== false) {
                    if (userTextLower.includes(phraseLower)) {
                        return { matched: true, confidence: 0.8, matchedValue: phrase };
                    }
                } else {
                    if (userTextLower === phraseLower) {
                        return { matched: true, confidence: 1.0, matchedValue: phrase };
                    }
                }
            }
            break;
        }
        
        case 'keyword': {
            const keywords = trigger.config?.keywords || [];
            const matched = keywords.filter(kw => 
                userTextLower.includes(kw.toLowerCase())
            );
            
            if (trigger.config?.matchAll) {
                if (matched.length === keywords.length) {
                    return { matched: true, confidence: 0.9, matchedValue: matched };
                }
            } else if (matched.length > 0) {
                return { matched: true, confidence: 0.7, matchedValue: matched };
            }
            break;
        }
        
        case 'regex': {
            try {
                const regex = new RegExp(trigger.config?.pattern, trigger.config?.flags || 'i');
                const match = userText?.match(regex);
                if (match) {
                    return { matched: true, confidence: 0.85, matchedValue: match[0] };
                }
            } catch (e) {
                logger.warn('[DYNAMIC FLOW] Invalid regex', { pattern: trigger.config?.pattern });
            }
            break;
        }
        
        case 'slot_value': {
            const slotValue = slots?.[trigger.config?.slotId];
            if (slotValue) {
                const targetValues = trigger.config?.slotValues || [];
                const slotLower = slotValue.toLowerCase();
                for (const tv of targetValues) {
                    if (slotLower.includes(tv.toLowerCase())) {
                        return { matched: true, confidence: 0.9, matchedValue: slotValue };
                    }
                }
            }
            break;
        }
        
        case 'slot_missing': {
            const missing = trigger.config?.missingSlots || [];
            const actuallyMissing = missing.filter(s => !slots?.[s]);
            if (actuallyMissing.length === missing.length && missing.length > 0) {
                return { matched: true, confidence: 1.0, matchedValue: actuallyMissing };
            }
            break;
        }
        
        case 'turn_count': {
            const turns = session?.metrics?.totalTurns || 0;
            const min = trigger.config?.minTurns ?? 0;
            const max = trigger.config?.maxTurns ?? Infinity;
            if (turns >= min && turns <= max) {
                return { matched: true, confidence: 1.0, matchedValue: turns };
            }
            break;
        }
        
        case 'customer_flag': {
            const flags = trigger.config?.flags || [];
            for (const flag of flags) {
                const hasFlag = customer?.[flag] || 
                               customer?.flags?.[flag] || 
                               session?.signals?.[flag] ||
                               session?.memory?.facts?.[flag];
                if (hasFlag) {
                    return { matched: true, confidence: 1.0, matchedValue: flag };
                }
            }
            break;
        }
        
        case 'composite': {
            const subTriggers = trigger.config?.subTriggers || [];
            const results = subTriggers.map(st => evaluateTrigger(st, context));
            
            if (trigger.config?.operator === 'AND') {
                if (results.every(r => r.matched)) {
                    const avgConf = results.reduce((s, r) => s + r.confidence, 0) / results.length;
                    return { matched: true, confidence: avgConf, matchedValue: results };
                }
            } else {
                const first = results.find(r => r.matched);
                if (first) return first;
            }
            break;
        }
    }
    
    return { matched: false };
}

// ════════════════════════════════════════════════════════════════════════════
// FLOW ACTIVATION / DEACTIVATION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Activate a flow
 */
function activateFlow(flow, flowState, context) {
    const flowId = flow._id.toString();
    const session = context.session;
    const turnNumber = context.turnNumber;
    
    // Check for conflicts
    if (flow.settings?.conflictsWith?.length > 0) {
        for (const activeId of flowState.activeFlows) {
            const activeFlow = context.flows?.find(f => f._id.toString() === activeId);
            if (activeFlow && flow.settings.conflictsWith.includes(activeFlow.flowKey)) {
                logger.debug('[DYNAMIC FLOW] Flow conflicts with active flow', {
                    newFlow: flow.flowKey,
                    conflictsWith: activeFlow.flowKey
                });
                return { activated: false, reason: 'conflict' };
            }
        }
    }
    
    // Check concurrent limit
    if (!flow.settings?.allowConcurrent && flowState.activeFlows.length > 0) {
        logger.debug('[DYNAMIC FLOW] Flow does not allow concurrent', {
            flow: flow.flowKey,
            activeFlows: flowState.activeFlows.length
        });
        return { activated: false, reason: 'no_concurrent' };
    }
    
    // Add to active flows (legacy)
    flowState.activeFlows.push(flowId);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // NEW: Add to active array (new schema)
    // ═══════════════════════════════════════════════════════════════════════════
    if (!flowState.active) flowState.active = [];
    flowState.active.push({
        flowKey: flow.flowKey,
        activatedAtTurn: turnNumber,
        activatedAt: new Date(),
        status: 'active'
    });
    
    // Add ledger entry for activation (legacy trace)
    flowState.trace = flowState.trace || [];
    
    // Get requirements to add (legacy - for backward compatibility)
    const requirements = (flow.requirements || []).map(req => ({
        flowId,
        flowKey: flow.flowKey,
        ...req
    }));
    
    // Get on_activate actions
    const onActivateActions = (flow.actions || []).filter(a => a.timing === 'on_activate');
    
    logger.info('[DYNAMIC FLOW] Flow activated', {
        flowKey: flow.flowKey,
        requirements: requirements.length,
        onActivateActions: onActivateActions.length
    });
    
    return {
        activated: true,
        requirements,
        onActivateActions
    };
}

/**
 * Deactivate a flow
 */
function deactivateFlow(flow, flowState, reason) {
    const flowId = flow._id.toString();
    
    // Remove from active
    flowState.activeFlows = flowState.activeFlows.filter(id => id !== flowId);
    
    // Add to completed
    if (!flowState.completedFlows.includes(flowId)) {
        flowState.completedFlows.push(flowId);
    }
    
    logger.info('[DYNAMIC FLOW] Flow deactivated', {
        flowKey: flow.flowKey,
        reason
    });
}

// ════════════════════════════════════════════════════════════════════════════
// REQUIREMENT CHECKING
// ════════════════════════════════════════════════════════════════════════════

/**
 * Check if all requirements for a flow are met
 */
function checkRequirements(flow, context) {
    const requirements = flow.requirements || [];
    const { slots, session } = context;
    
    const status = {
        allMet: true,
        met: [],
        unmet: []
    };
    
    for (const req of requirements) {
        let isMet = false;
        
        switch (req.type) {
            case 'collect_slot':
            case 'verify_slot':
                isMet = !!slots?.[req.config?.slotId];
                break;
                
            case 'collect_custom':
                isMet = !!session?.customFields?.[req.config?.fieldId];
                break;
                
            case 'set_flag':
                isMet = !!session?.flags?.[req.config?.flagName];
                break;
                
            case 'set_fact':
                isMet = !!session?.memory?.facts?.[req.config?.factKey];
                break;
                
            case 'acknowledge':
                const acks = session?.memory?.acknowledgedClaims || [];
                isMet = acks.includes(req.config?.acknowledgment);
                break;
                
            case 'lookup':
                isMet = !!session?.[req.config?.storeAs];
                break;
                
            default:
                isMet = true; // Unknown types are considered met
        }
        
        if (isMet || !req.config?.required) {
            status.met.push(req);
        } else {
            status.unmet.push(req);
            status.allMet = false;
        }
    }
    
    return status;
}

// ════════════════════════════════════════════════════════════════════════════
// ACTION EXECUTION
// ════════════════════════════════════════════════════════════════════════════

/**
 * Execute an action
 */
function executeAction(action, context, session) {
    const result = {
        type: action.type,
        timing: action.timing,
        executed: false,
        stateChange: null,
        response: null,
        error: null,
        config: action.config || {},
        flowKey: action.flowKey || null
    };
    
    try {
        switch (action.type) {
            case 'transition_mode': {
                const targetMode = action.config?.targetMode;
                if (targetMode) {
                    const modeBefore = session.mode || 'DISCOVERY';
                    if (modeBefore !== targetMode) {
                        session.mode = targetMode;
                        result.stateChange = { mode: targetMode };
                        result.executed = true;
                        
                        // Also update locks
                        if (targetMode === 'BOOKING') {
                            session.locks = session.locks || {};
                            session.locks.bookingStarted = true;
                            session.locks.bookingLocked = true;
                        }
                    }
                }
                break;
            }
            
            case 'ack_once': {
                const ackText = action.config?.text;
                if (ackText && executeAckOnce(session, action.flowKey || action.config?.flowKey || 'unknown', ackText)) {
                    result.response = ackText;
                    result.executed = true;
                }
                break;
            }
            
            case 'set_next_slot': {
                // ═══════════════════════════════════════════════════════════════
                // CRITICAL: Dynamic Flow Engine does NOT override booking order
                // It only SUGGESTS a slot by adding to pendingRequirements
                // The deterministic "nextMissingSlot" engine makes final decision
                // ═══════════════════════════════════════════════════════════════
                const slotId = action.config?.slotId;
                if (slotId) {
                    // Add to pending requirements, NOT override activeSlot
                    const flowState = getFlowState(session);
                    flowState.pendingRequirements = flowState.pendingRequirements || [];
                    flowState.pendingRequirements.push({
                        type: 'collect_slot',
                        config: { slotId, askImmediately: true },
                        source: 'dynamic_flow_action'
                    });
                    result.stateChange = { suggestedSlot: slotId };
                    result.executed = true;
                    
                    logger.info('[DYNAMIC FLOW] Slot suggested (not forced)', {
                        slotId,
                        note: 'Booking engine makes final decision'
                    });
                }
                break;
            }
            
            case 'send_response': {
                // Deprecated for V1 - treat as ack_once
                const ackText = action.config?.response;
                if (ackText && executeAckOnce(session, action.flowKey || action.config?.flowKey || 'unknown', ackText)) {
                    result.response = ackText;
                    result.executed = true;
                }
                break;
            }
            
            case 'set_flag': {
                const flagName = action.config?.flagName;
                const flagValue = action.config?.flagValue ?? true;
                if (flagName) {
                    session.flags = session.flags || {};
                    session.flags[flagName] = flagValue;
                    const ledger = ensureCallLedger(session);
                    ledger.facts[flagName] = flagValue;
                    result.stateChange = { [`flags.${flagName}`]: flagValue };
                    result.executed = true;
                }
                break;
            }
            
            case 'append_ledger': {
                const { type, key, note, turnNumber } = action.config || {};
                const flowKeyForLedger = action.flowKey || action.config?.flowKey || 'unknown';
                if (type && key && !hasLedgerEntry(session, type, key, flowKeyForLedger)) {
                    addLedgerEntry(session, {
                        turn: turnNumber || context.turnNumber || 0,
                        timestamp: new Date(),
                        type,
                        key,
                        note,
                        flowKey: flowKeyForLedger
                    });
                    result.executed = true;
                }
                break;
            }
            
            case 'activate_flow': {
                // This would be handled by the main engine on next turn
                result.activateFlowKey = action.config?.flowName;
                result.executed = true;
                break;
            }
            
            case 'deactivate_flow': {
                const flowState = getFlowState(session);
                const flowKey = action.config?.flowName;
                // Find and remove the flow
                // This is a simplified version - full implementation would look up by key
                result.deactivateFlowKey = flowKey;
                result.executed = true;
                break;
            }
            
            case 'end_call': {
                session.mode = 'COMPLETE';
                session.status = 'ended';
                result.stateChange = { mode: 'COMPLETE', status: 'ended' };
                result.executed = true;
                break;
            }
            
            case 'transfer': {
                session.mode = 'TRANSFER';
                session.transferTo = action.config?.transferTo;
                session.transferReason = action.config?.transferReason;
                result.stateChange = { mode: 'TRANSFER' };
                result.executed = true;
                break;
            }
            
            default:
                logger.warn('[DYNAMIC FLOW] Unknown action type', { type: action.type });
        }
        
    } catch (error) {
        result.error = error.message;
        logger.error('[DYNAMIC FLOW] Action execution failed', {
            type: action.type,
            error: error.message
        });
    }
    
    return result;
}

// ════════════════════════════════════════════════════════════════════════════
// GUARDRAILS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Apply guardrails based on active flows and session state
 */
function applyGuardrails(flowState, session, context) {
    const guardrails = [];
    
    // Guardrail 1: No re-greet after first turn
    if (session.locks?.greeted) {
        guardrails.push('NO_REGREET');
    }
    
    // Guardrail 2: No restart booking once locked
    if (session.locks?.bookingLocked) {
        guardrails.push('NO_RESTART_BOOKING');
    }
    
    // Guardrail 3: No re-ask collected slots
    if (session.locks?.askedSlots) {
        const askedSlots = Object.keys(session.locks.askedSlots);
        if (askedSlots.length > 0) {
            guardrails.push(`NO_REASK_SLOTS:${askedSlots.join(',')}`);
        }
    }
    
    // Guardrail 4: Respect flow-specific rules
    for (const flowId of flowState.activeFlows) {
        // Could add flow-specific guardrails here
    }
    
    return guardrails;
}

/**
 * Add a ledger entry
 * 
 * @param {Object} session - Session object
 * @param {string} entry - The ledger entry text
 */
function addLedgerEntry(session, entry) {
    const ledger = ensureCallLedger(session);
    ledger.entries.push(entry);
    logger.debug('[DYNAMIC FLOW] Ledger entry added', { entry });
}

function hasLedgerEntry(session, type, key, flowKey = null) {
    const ledger = ensureCallLedger(session);
    return ledger.entries.some(e => e.type === type && e.key === key && (flowKey ? e.flowKey === flowKey : true));
}

/**
 * Execute ACK_ONCE action (with lock to prevent repeats)
 */
function executeAckOnce(session, flowKey, ackText) {
    ensureCallLedger(session);
    session.locks = session.locks || {};
    session.locks.flowAcked = session.locks.flowAcked || {};
    
    if (session.locks.flowAcked[flowKey]) {
        logger.debug('[DYNAMIC FLOW] ACK_ONCE already spoken, skipping', { flowKey });
        return false;
    }
    session.locks.flowAcked[flowKey] = true;
    logger.info('[DYNAMIC FLOW] ACK_ONCE executed', { flowKey });
    return true;
}

// ════════════════════════════════════════════════════════════════════════════
// UTILITY FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get the next required slot based on active flows
 */
function getNextRequiredSlot(session) {
    const flowState = getFlowState(session);
    
    // Look through pending requirements for collect_slot types
    for (const req of flowState.pendingRequirements || []) {
        if (req.type === 'collect_slot' && req.config?.askImmediately) {
            return req.config.slotId;
        }
    }
    
    return null;
}

/**
 * Get pending acknowledgments
 */
function getPendingAcknowledgments(session) {
    const flowState = getFlowState(session);
    const acks = [];
    
    for (const req of flowState.pendingRequirements || []) {
        if (req.type === 'acknowledge') {
            const alreadyAcked = session.memory?.acknowledgedClaims?.includes(req.config?.acknowledgment);
            if (!alreadyAcked) {
                acks.push(req.config.acknowledgment);
            }
        }
    }
    
    return acks;
}

/**
 * Mark an acknowledgment as done
 */
function markAcknowledged(session, acknowledgment) {
    session.memory = session.memory || {};
    session.memory.acknowledgedClaims = session.memory.acknowledgedClaims || [];
    
    if (!session.memory.acknowledgedClaims.includes(acknowledgment)) {
        session.memory.acknowledgedClaims.push(acknowledgment);
    }
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

module.exports = {
    ENGINE_VERSION,
    
    // Main functions
    processTurn,
    initializeFlowState,
    getFlowState,
    
    // Trigger evaluation
    evaluateFlowTriggers,
    evaluateTrigger,
    
    // Flow management
    activateFlow,
    deactivateFlow,
    checkRequirements,
    
    // Action execution
    executeAction,
    
    // Guardrails
    applyGuardrails,
    
    // Utilities
    addLedgerEntry,
    executeAckOnce,
    getNextRequiredSlot,
    getPendingAcknowledgments,
    markAcknowledged
};

