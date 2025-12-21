/**
 * ============================================================================
 * DYNAMIC FLOW SNAPSHOT PROVIDER
 * ============================================================================
 * Provides: Dynamic flow engine state (trigger → event → state → action)
 * 
 * SCHEMA SUPPORT (December 2025):
 * - NEW SCHEMA: trigger.type='phrase', trigger.config.phrases[]
 * - LEGACY: trigger.type='PHRASE_MATCH', trigger.phrases[]
 * Prefer new schema, fallback to legacy for backward compatibility
 */

const DynamicFlow = require('../../../models/DynamicFlow');
const mongoose = require('mongoose');
const logger = require('../../../utils/logger');

/**
 * Helper: Get the first trigger from flow (schema uses 'triggers' array)
 */
function getFirstTrigger(flow) {
    // CORRECT SCHEMA: triggers[] array
    if (flow.triggers?.length > 0) {
        return flow.triggers[0];
    }
    // LEGACY: trigger object (for backward compatibility)
    if (flow.trigger) {
        return flow.trigger;
    }
    return null;
}

/**
 * Helper: Extract trigger phrases from flow (supports both schemas)
 */
function getTriggerPhrases(flow) {
    const trigger = getFirstTrigger(flow);
    if (!trigger) return [];
    
    // V2 SCHEMA: trigger.config.phrases
    if (trigger.config?.phrases?.length > 0) {
        return trigger.config.phrases;
    }
    // LEGACY: trigger.phrases
    if (trigger.phrases?.length > 0) {
        return trigger.phrases;
    }
    return [];
}

/**
 * Helper: Get normalized trigger type
 */
function getNormalizedTriggerType(flow) {
    const trigger = getFirstTrigger(flow);
    if (!trigger) return 'unknown';
    
    const type = trigger.type;
    // Normalize legacy types
    if (type === 'PHRASE_MATCH') return 'phrase';
    if (type === 'CONDITION') return 'condition';
    return type || 'unknown';
}

/**
 * Helper: Get min confidence (supports both schemas)
 */
function getMinConfidence(flow) {
    const trigger = getFirstTrigger(flow);
    if (!trigger) return 0.7;
    return trigger.config?.minConfidence || trigger.minConfidence || 0.7;
}

/**
 * Helper: Check if flow is phrase-based
 */
function isPhraseBasedTrigger(flow) {
    const type = getNormalizedTriggerType(flow);
    return type === 'phrase' || type === 'keyword';
}

module.exports.getSnapshot = async function(companyId) {
    const startTime = Date.now();
    
    try {
        // ═══════════════════════════════════════════════════════════════════
        // FIXED: Query by companyId AND isTemplate=false (company flows only)
        // Also check 'enabled' field (new) and 'isActive' (legacy)
        // ═══════════════════════════════════════════════════════════════════
        const flows = await DynamicFlow.find({ 
            companyId: new mongoose.Types.ObjectId(companyId),
            isTemplate: { $ne: true },  // Exclude global templates
            $or: [
                { enabled: { $ne: false } },
                { isActive: { $ne: false } }
            ]
        }).lean();
        
        const flowsTotal = flows.length;
        const flowsEnabled = flows.filter(f => f.enabled !== false && f.isActive !== false).length;
        const flowKeys = flows.map(f => f.flowKey).filter(Boolean);
        
        // Check for duplicate flowKeys
        const duplicateFlowKeys = flowKeys.filter((key, idx) => flowKeys.indexOf(key) !== idx);
        
        // Check priority order validity
        const priorities = flows.map(f => f.priority || 0).sort((a, b) => b - a);
        const uniquePriorities = [...new Set(priorities)];
        const priorityOrderValid = priorities.length === uniquePriorities.length;
        
        // Analyze action types used
        const actionTypes = new Set();
        flows.forEach(f => {
            (f.actions || []).forEach(a => actionTypes.add(a.type));
        });
        
        // Determine health
        let health = 'GREEN';
        const warnings = [];
        
        // ═══════════════════════════════════════════════════════════════════
        // VALIDATE ENABLED FLOWS (December 2025 - STRICT VALIDATION)
        // No more "false GREEN" - flows must be properly configured
        // ═══════════════════════════════════════════════════════════════════
        const invalidFlows = [];
        
        flows.filter(f => f.enabled !== false && f.isActive !== false).forEach(f => {
            const triggerType = getNormalizedTriggerType(f);
            const phrases = getTriggerPhrases(f);
            const actions = f.actions || [];
            const schemaUsed = f.trigger?.config?.phrases?.length > 0 ? 'v2' : 'legacy';
            
            const issues = [];
            
            // STRICT RULE 1: Trigger type must be recognized
            if (triggerType === 'unknown') {
                issues.push(`unrecognized trigger type: "${f.trigger?.type || 'missing'}"`);
            }
            
            // STRICT RULE 2: Phrase-based flows need at least 1 phrase
            if (isPhraseBasedTrigger(f) && phrases.length === 0) {
                issues.push('0 trigger phrases (need at least 1)');
            }
            
            // STRICT RULE 3: Legacy schema should be converted
            if (schemaUsed === 'legacy' && f.trigger?.phrases?.length > 0) {
                issues.push('uses legacy schema (should be trigger.config.phrases)');
            }
            
            // STRICT RULE 4: All flows need at least 1 action
            if (actions.length === 0) {
                issues.push('no actions configured');
            }
            
            // STRICT RULE 5: V1 flows should have all 4 action types
            const hasSetFlag = actions.some(a => a.type === 'set_flag');
            const hasAppendLedger = actions.some(a => a.type === 'append_ledger');
            const hasAckOnce = actions.some(a => a.type === 'ack_once');
            const hasTransitionMode = actions.some(a => a.type === 'transition_mode');
            
            if (actions.length > 0 && actions.length < 4) {
                const missing = [];
                if (!hasSetFlag) missing.push('set_flag');
                if (!hasAppendLedger) missing.push('append_ledger');
                if (!hasAckOnce) missing.push('ack_once');
                if (!hasTransitionMode) missing.push('transition_mode');
                if (missing.length > 0) {
                    issues.push(`incomplete V1 actions (missing: ${missing.join(', ')})`);
                }
            }
            
            if (issues.length > 0) {
                invalidFlows.push({
                    flowKey: f.flowKey || 'unknown',
                    name: f.name || 'Unnamed Flow',
                    schemaUsed,
                    issues
                });
            }
        });
        
        if (invalidFlows.length > 0) {
            invalidFlows.forEach(f => {
                warnings.push(`Enabled flow "${f.flowKey}" is invalid: ${f.issues.join(', ')}`);
            });
            health = 'YELLOW';
        }
        
        if (duplicateFlowKeys.length > 0) {
            warnings.push(`Duplicate flowKeys: ${duplicateFlowKeys.join(', ')}`);
            health = 'YELLOW';
        }
        
        if (!priorityOrderValid) {
            warnings.push('Flows have duplicate priorities (tie risk)');
            health = 'YELLOW';
        }
        
        if (flowsEnabled === 0 && flowsTotal > 0) {
            warnings.push('All flows disabled');
            health = 'RED';
        }
        
        return {
            provider: 'dynamicFlow',
            providerVersion: '2.0',  // Updated version
            schemaVersion: 'v2',      // Supports new schema
            enabled: flowsTotal > 0,
            health,
            warnings,
            data: {
                flowsTotal,
                flowsEnabled,
                flowsInvalid: invalidFlows.length,
                flowKeys,
                duplicateFlowKeys,
                priorityOrderValid,
                actionTypesUsed: Array.from(actionTypes),
                
                invalidFlows,
                
                flows: flows.map(f => {
                    const flowKey = f.flowKey || 'unknown';
                    const phrases = getTriggerPhrases(f);
                    return {
                        flowKey,
                        name: f.name,
                        priority: f.priority || 0,
                        enabled: f.enabled !== false && f.isActive !== false,
                        // NEW: Normalized trigger info
                        triggerType: getNormalizedTriggerType(f),
                        triggerPhraseCount: phrases.length,
                        triggerPhraseSample: phrases.slice(0, 3), // Show first 3 for debugging
                        minConfidence: getMinConfidence(f),
                        actionsCount: (f.actions || []).length,
                        actionTypes: (f.actions || []).map(a => a.type),
                        allowConcurrent: f.settings?.allowConcurrent !== false,
                        isValid: !invalidFlows.some(inv => inv.flowKey === flowKey),
                        // NEW: Schema detection for debugging
                        schemaUsed: f.trigger?.config?.phrases?.length > 0 ? 'v2' : 'legacy'
                    };
                }).sort((a, b) => (b.priority || 0) - (a.priority || 0))
            },
            generatedIn: Date.now() - startTime
        };
        
    } catch (error) {
        logger.error('[SNAPSHOT:dynamicFlow] Error:', error.message);
        return {
            provider: 'dynamicFlow',
            providerVersion: '2.0',
            schemaVersion: 'v2',
            enabled: false,
            health: 'RED',
            error: error.message,
            data: null,
            generatedIn: Date.now() - startTime
        };
    }
};

