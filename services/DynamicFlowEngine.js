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
 * CRITICAL RULE:
 * The engine decides flow. The LLM only phrases responses.
 * The engine can VETO LLM decisions (re-greet, restart, etc.)
 * 
 * MULTI-TENANT: All operations scoped by companyId
 * 
 * ============================================================================
 */

const DynamicFlow = require('../models/DynamicFlow');
const logger = require('../utils/logger');

// ════════════════════════════════════════════════════════════════════════════
// ENGINE VERSION
// ════════════════════════════════════════════════════════════════════════════
const ENGINE_VERSION = 'V1.0-INITIAL';

logger.info(`[DYNAMIC FLOW ENGINE] 🧠 LOADED VERSION: ${ENGINE_VERSION}`);

// ════════════════════════════════════════════════════════════════════════════
// FLOW STATE MANAGEMENT
// ════════════════════════════════════════════════════════════════════════════

/**
 * Initialize flow state on session
 */
function initializeFlowState(session) {
    if (!session.dynamicFlows) {
        session.dynamicFlows = {
            activeFlows: [],           // Currently active flow IDs
            completedFlows: [],        // Completed flow IDs (for reactivation check)
            pendingRequirements: [],   // Requirements waiting to be fulfilled
            pendingActions: [],        // Actions waiting to execute
            trace: []                  // Trace log for this session
        };
    }
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
    const flowState = initializeFlowState(session);
    
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
        result.trace = {
            turn: context.turnNumber,
            timestamp: new Date().toISOString(),
            latencyMs: Date.now() - startTime,
            triggersEvaluated: result.triggersEvaluated,
            triggersFired: result.triggersFired.map(t => t.flowKey),
            flowsActivated: result.flowsActivated.map(f => f.flowKey),
            flowsDeactivated: result.flowsDeactivated.map(f => f.flowKey),
            activeFlows: flowState.activeFlows,
            actionsExecuted: result.actionsExecuted.map(a => a.type),
            guardrailsApplied: result.guardrailsApplied,
            stateChanges: result.stateChanges
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
    
    // Add to active flows
    flowState.activeFlows.push(flowId);
    
    // Get requirements to add
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
        error: null
    };
    
    try {
        switch (action.type) {
            case 'transition_mode': {
                const targetMode = action.config?.targetMode;
                if (targetMode) {
                    session.mode = targetMode;
                    result.stateChange = { mode: targetMode };
                    result.executed = true;
                    
                    // Also update locks
                    if (targetMode === 'BOOKING') {
                        session.locks = session.locks || {};
                        session.locks.bookingStarted = true;
                    }
                }
                break;
            }
            
            case 'set_next_slot': {
                const slotId = action.config?.slotId;
                if (slotId) {
                    session.booking = session.booking || {};
                    session.booking.activeSlot = slotId;
                    result.stateChange = { activeSlot: slotId };
                    result.executed = true;
                }
                break;
            }
            
            case 'send_response': {
                result.response = action.config?.response;
                result.appendToNext = action.config?.appendToNext;
                result.executed = true;
                break;
            }
            
            case 'set_flag': {
                const flagName = action.config?.flagName;
                const flagValue = action.config?.flagValue ?? true;
                if (flagName) {
                    session.flags = session.flags || {};
                    session.flags[flagName] = flagValue;
                    result.stateChange = { [`flags.${flagName}`]: flagValue };
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
    getNextRequiredSlot,
    getPendingAcknowledgments,
    markAcknowledged
};

