/**
 * ============================================================================
 * TRANSFERS SNAPSHOT PROVIDER
 * ============================================================================
 * Provides: Transfer targets, after-hours routing configuration
 */

const CheatSheet = require('../../../models/CheatSheet');
const logger = require('../../../utils/logger');

module.exports.getSnapshot = async function(companyId) {
    const startTime = Date.now();
    
    try {
        const cheatSheet = await CheatSheet.findOne({ companyId }).lean();
        
        const transferRules = cheatSheet?.transferRules || [];
        const enabledTargets = transferRules.filter(r => r.enabled !== false);
        
        // Check for after-hours routing
        const afterHoursTargets = transferRules.filter(r => r.afterHoursOnly === true);
        const hasAfterHoursRouting = afterHoursTargets.length > 0;
        
        // Analyze by intent
        const intentTags = new Set();
        transferRules.forEach(r => {
            if (r.intentTag) intentTags.add(r.intentTag);
        });
        
        // Determine health
        let health = 'GREEN';
        const warnings = [];
        
        // Transfers are optional - no warning if empty
        
        return {
            provider: 'transfers',
            providerVersion: '1.0',
            schemaVersion: 'v1',
            enabled: transferRules.length > 0,
            health,
            warnings,
            data: {
                targetsTotal: transferRules.length,
                targetsEnabled: enabledTargets.length,
                afterHoursRouting: hasAfterHoursRouting,
                afterHoursTargetsCount: afterHoursTargets.length,
                intentTags: Array.from(intentTags),
                
                targets: transferRules.map(r => ({
                    label: r.contactNameOrQueue || r.label || 'Unnamed',
                    intentTag: r.intentTag || null,
                    hasPhone: !!r.phoneNumber,
                    enabled: r.enabled !== false,
                    priority: r.priority || 10,
                    afterHoursOnly: r.afterHoursOnly || false,
                    hasPreTransferScript: !!r.preTransferScript
                }))
            },
            generatedIn: Date.now() - startTime
        };
        
    } catch (error) {
        logger.error('[SNAPSHOT:transfers] Error:', error.message);
        return {
            provider: 'transfers',
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

