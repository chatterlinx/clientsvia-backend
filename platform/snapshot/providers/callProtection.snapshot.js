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
        
        // ═══════════════════════════════════════════════════════════════════
        // VALIDATE ENABLED RULES (December 2025 Directive)
        // An enabled rule MUST have: patterns/detector AND valid action
        // ═══════════════════════════════════════════════════════════════════
        const invalidEnabledRules = [];
        
        enabledRules.forEach(ec => {
            const patterns = ec.triggerPatterns || [];
            const hasPatterns = patterns.length > 0;
            const hasDetector = ['voicemail', 'machine', 'spam', 'abuse'].includes(ec.type);
            const hasResponse = !!ec.responseText || !!ec.responseTemplateId || !!ec.action?.hangupMessage;
            const hasTransfer = ec.action === 'transfer' && ec.transferTargetId;
            const hasValidAction = hasResponse || hasTransfer || ec.action === 'hangup';
            
            // Rule is invalid if: enabled but (no patterns AND no detector) OR no valid action
            if ((!hasPatterns && !hasDetector) || !hasValidAction) {
                invalidEnabledRules.push({
                    name: ec.name || 'Unnamed Edge Case',
                    issues: []
                });
                
                if (!hasPatterns && !hasDetector) {
                    invalidEnabledRules[invalidEnabledRules.length - 1].issues.push('no patterns or detector type');
                }
                if (!hasValidAction) {
                    invalidEnabledRules[invalidEnabledRules.length - 1].issues.push('no action response configured');
                }
            }
        });
        
        if (invalidEnabledRules.length > 0) {
            health = 'YELLOW';
            invalidEnabledRules.forEach(rule => {
                warnings.push(`Enabled call protection rule is invalid: "${rule.name}" (${rule.issues.join(', ')})`);
            });
        }
        
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
                rulesInvalid: invalidEnabledRules.length,
                ruleNames: enabledRules.map(r => r.name),
                
                byType: rulesByType,
                
                invalidRules: invalidEnabledRules,
                
                rules: edgeCases.map(ec => ({
                    name: ec.name,
                    type: ec.type || 'custom',
                    enabled: ec.enabled !== false,
                    priority: ec.priority || 10,
                    hasResponse: !!ec.responseText || !!ec.responseTemplateId,
                    hasTransfer: ec.action === 'transfer' && !!ec.transferTargetId,
                    action: ec.action || 'respond',
                    patternsCount: (ec.triggerPatterns || []).length,
                    isValid: !invalidEnabledRules.some(inv => inv.name === ec.name)
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

