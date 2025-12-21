/**
 * ============================================================================
 * CALL PROTECTION SNAPSHOT PROVIDER
 * ============================================================================
 * Provides: Pre-answer filters (spam, voicemail, abuse detection)
 */

const CheatSheetVersion = require('../../../models/cheatsheet/CheatSheetVersion');
const logger = require('../../../utils/logger');

module.exports.getSnapshot = async function(companyId) {
    const startTime = Date.now();
    
    try {
        // Get the LIVE cheatsheet version for this company
        const cheatSheet = await CheatSheetVersion.findOne({ 
            companyId, 
            status: 'live' 
        }).lean();
        
        const edgeCases = cheatSheet?.config?.edgeCases || [];
        const enabledRules = edgeCases.filter(ec => ec.enabled !== false);
        
        // Categorize rules by type
        const rulesByType = {};
        edgeCases.forEach(ec => {
            const type = ec.type || 'custom';
            if (!rulesByType[type]) rulesByType[type] = [];
            rulesByType[type].push({
                name: ec.name,
                enabled: ec.enabled !== false,
                priority: ec.priority || 10,
                hasResponse: !!ec.responseText,
                action: ec.action || 'respond'
            });
        });
        
        // Determine health
        let health = 'GREEN';
        const warnings = [];
        
        // No call protection is fine if intentional
        if (edgeCases.length === 0) {
            // Not a warning - call protection is optional
        }
        
        return {
            provider: 'callProtection',
            providerVersion: '1.0',
            schemaVersion: 'v1',
            enabled: edgeCases.length > 0,
            health,
            warnings,
            data: {
                rulesTotal: edgeCases.length,
                rulesEnabled: enabledRules.length,
                ruleNames: enabledRules.map(r => r.name),
                
                byType: rulesByType,
                
                rules: edgeCases.map(ec => ({
                    name: ec.name,
                    type: ec.type || 'custom',
                    enabled: ec.enabled !== false,
                    priority: ec.priority || 10,
                    hasResponse: !!ec.responseText,
                    action: ec.action || 'respond',
                    patternsCount: (ec.triggerPatterns || []).length
                })).sort((a, b) => (a.priority || 10) - (b.priority || 10))
            },
            generatedIn: Date.now() - startTime
        };
        
    } catch (error) {
        logger.error('[SNAPSHOT:callProtection] Error:', error.message);
        return {
            provider: 'callProtection',
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

