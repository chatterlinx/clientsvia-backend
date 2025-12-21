/**
 * ============================================================================
 * DYNAMIC FLOW SNAPSHOT PROVIDER
 * ============================================================================
 * Provides: Dynamic flow engine state (trigger → event → state → action)
 */

const DynamicFlow = require('../../../models/DynamicFlow');
const logger = require('../../../utils/logger');

module.exports.getSnapshot = async function(companyId) {
    const startTime = Date.now();
    
    try {
        const flows = await DynamicFlow.find({ companyId, isActive: { $ne: false } }).lean();
        
        const flowsTotal = flows.length;
        const flowsEnabled = flows.filter(f => f.isActive !== false).length;
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
            providerVersion: '1.0',
            schemaVersion: 'v1',
            enabled: flowsTotal > 0,
            health,
            warnings,
            data: {
                flowsTotal,
                flowsEnabled,
                flowKeys,
                duplicateFlowKeys,
                priorityOrderValid,
                actionTypesUsed: Array.from(actionTypes),
                
                flows: flows.map(f => ({
                    flowKey: f.flowKey,
                    name: f.name,
                    priority: f.priority || 0,
                    enabled: f.isActive !== false,
                    triggerType: f.trigger?.type || 'PHRASE_MATCH',
                    triggerPhraseCount: (f.trigger?.phrases || []).length,
                    minConfidence: f.trigger?.minConfidence || 0.7,
                    actionsCount: (f.actions || []).length,
                    allowConcurrent: f.settings?.allowConcurrent !== false
                })).sort((a, b) => (b.priority || 0) - (a.priority || 0))
            },
            generatedIn: Date.now() - startTime
        };
        
    } catch (error) {
        logger.error('[SNAPSHOT:dynamicFlow] Error:', error.message);
        return {
            provider: 'dynamicFlow',
            providerVersion: '1.0',
            schemaVersion: 'v1',
            enabled: false,
            health: 'RED',
            error: error.message,
            data: null,
            generatedIn: Date.now() - startTime
        };
    }
};

