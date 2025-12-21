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
 * Helper: Extract trigger phrases from flow (supports both schemas)
 */
function getTriggerPhrases(flow) {
    // NEW SCHEMA: trigger.config.phrases
    if (flow.trigger?.config?.phrases?.length > 0) {
        return flow.trigger.config.phrases;
    }
    // LEGACY: trigger.phrases
    if (flow.trigger?.phrases?.length > 0) {
        return flow.trigger.phrases;
    }
    return [];
}

/**
 * Helper: Get normalized trigger type
 */
function getNormalizedTriggerType(flow) {
    const type = flow.trigger?.type;
    // Normalize legacy types
    if (type === 'PHRASE_MATCH') return 'phrase';
    if (type === 'CONDITION') return 'condition';
    return type || 'unknown';
}

/**
 * Helper: Get min confidence (supports both schemas)
 */
function getMinConfidence(flow) {
    return flow.trigger?.config?.minConfidence || flow.trigger?.minConfidence || 0.7;
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
        // VALIDATE ENABLED FLOWS (December 2025 - FIXED to use helpers)
        // Phrase-based flows MUST have at least 1 trigger phrase
        // ═══════════════════════════════════════════════════════════════════
        const invalidFlows = [];
        
        flows.filter(f => f.enabled !== false && f.isActive !== false).forEach(f => {
            const triggerType = getNormalizedTriggerType(f);
            const phrases = getTriggerPhrases(f);
            const actions = f.actions || [];
            
            const issues = [];
            
            // Phrase-based flows need at least 1 phrase
            if (isPhraseBasedTrigger(f) && phrases.length === 0) {
                issues.push('0 trigger phrases');
            }
            
            // All flows need at least 1 action
            if (actions.length === 0) {
                issues.push('no actions configured');
            }
            
            if (issues.length > 0) {
                invalidFlows.push({
                    flowKey: f.flowKey || 'unknown',
                    name: f.name || 'Unnamed Flow',
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

