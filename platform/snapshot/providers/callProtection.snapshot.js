/**
 * ============================================================================
 * CALL PROTECTION SNAPSHOT PROVIDER
 * ============================================================================
 * Provides: Pre-answer filters (spam, voicemail, abuse detection)
 * 
 * DATA SOURCE: CheatSheetVersion (edgeCases) OR frontDeskBehavior.callProtection
 * 
 * Note: Call protection is OPTIONAL. If not configured, provider returns 
 * enabled=false with NOT_CONFIGURED warning (not an error).
 */

const CheatSheetVersion = require('../../../models/cheatsheet/CheatSheetVersion');
const Company = require('../../../models/v2Company');
const logger = require('../../../utils/logger');

module.exports.getSnapshot = async function(companyId) {
    const startTime = Date.now();
    
    try {
        // Try CheatSheetVersion first (primary source)
        let edgeCases = [];
        let dataSource = 'none';
        
        const cheatSheet = await CheatSheetVersion.findOne({ 
            companyId, 
            status: 'live' 
        }).lean();
        
        if (cheatSheet?.config?.edgeCases?.length > 0) {
            edgeCases = cheatSheet.config.edgeCases;
            dataSource = 'CheatSheetVersion.edgeCases';
        } else {
            // Fallback: Check frontDeskBehavior.callProtection
            const company = await Company.findById(companyId)
                .select('frontDeskBehavior.callProtection')
                .lean();
            
            if (company?.frontDeskBehavior?.callProtection?.rules?.length > 0) {
                // Convert to edge case format
                edgeCases = company.frontDeskBehavior.callProtection.rules.map(rule => ({
                    name: rule.name || 'Custom Rule',
                    type: rule.type || 'custom',
                    enabled: rule.enabled !== false,
                    priority: rule.priority || 10,
                    triggerPatterns: rule.patterns || [],
                    responseText: rule.response || '',
                    action: rule.action || 'respond'
                }));
                dataSource = 'frontDeskBehavior.callProtection';
            }
        }
        
        // If still no data, return NOT_CONFIGURED (not an error)
        if (edgeCases.length === 0) {
            return {
                provider: 'callProtection',
                providerVersion: '1.1',
                schemaVersion: 'v1',
                enabled: false,
                health: 'GREEN',  // NOT_CONFIGURED is not an error
                warnings: ['NOT_CONFIGURED: No call protection rules defined (optional feature)'],
                status: 'NOT_CONFIGURED',
                data: {
                    dataSource: 'none',
                    rulesTotal: 0,
                    rulesEnabled: 0,
                    rulesInvalid: 0,
                    ruleNames: [],
                    byType: {},
                    invalidRules: [],
                    rules: []
                },
                generatedIn: Date.now() - startTime
            };
        }
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
            // SUPPORT BOTH LEGACY AND ENTERPRISE SCHEMAS
            // Legacy: triggerPatterns[]
            // Enterprise: match.keywordsAny[], match.keywordsAll[], match.regexPatterns[]
            const legacyPatterns = ec.triggerPatterns || [];
            const enterpriseKeywordsAny = ec.match?.keywordsAny || [];
            const enterpriseKeywordsAll = ec.match?.keywordsAll || [];
            const enterpriseRegex = ec.match?.regexPatterns || [];
            
            const totalPatterns = legacyPatterns.length + enterpriseKeywordsAny.length + 
                                 enterpriseKeywordsAll.length + enterpriseRegex.length;
            const hasPatterns = totalPatterns > 0;
            
            const hasDetector = ['voicemail', 'machine', 'spam', 'abuse'].includes(ec.type);
            
            // Support both legacy and enterprise action formats
            const hasResponse = !!ec.responseText || !!ec.responseTemplateId || 
                               !!ec.action?.hangupMessage || !!ec.action?.inlineResponse ||
                               !!ec.action?.transferMessage;
            const hasTransfer = (ec.action === 'transfer' || ec.action?.type === 'force_transfer') && 
                               (ec.transferTargetId || ec.action?.transferTarget);
            const hasHangup = ec.action === 'hangup' || ec.action?.type === 'polite_hangup' || 
                             ec.action?.type === 'silent_hangup';
            const hasValidAction = hasResponse || hasTransfer || hasHangup;
            
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
            providerVersion: '1.1',
            schemaVersion: 'v1',
            enabled: edgeCases.length > 0,
            health,
            warnings,
            status: edgeCases.length > 0 ? 'CONFIGURED' : 'NOT_CONFIGURED',
            data: {
                dataSource,
                rulesTotal: edgeCases.length,
                rulesEnabled: enabledRules.length,
                rulesInvalid: invalidEnabledRules.length,
                ruleNames: enabledRules.map(r => r.name),
                
                byType: rulesByType,
                
                invalidRules: invalidEnabledRules,
                
                rules: edgeCases.map(ec => {
                    // Count patterns from BOTH legacy and enterprise schemas
                    const legacyPatterns = ec.triggerPatterns || [];
                    const enterpriseKeywordsAny = ec.match?.keywordsAny || [];
                    const enterpriseKeywordsAll = ec.match?.keywordsAll || [];
                    const enterpriseRegex = ec.match?.regexPatterns || [];
                    const totalPatterns = legacyPatterns.length + enterpriseKeywordsAny.length + 
                                         enterpriseKeywordsAll.length + enterpriseRegex.length;
                    
                    return {
                        name: ec.name,
                        type: ec.type || 'custom',
                        enabled: ec.enabled !== false,
                        priority: ec.priority || 10,
                        hasResponse: !!ec.responseText || !!ec.responseTemplateId || 
                                    !!ec.action?.hangupMessage || !!ec.action?.inlineResponse,
                        hasTransfer: (ec.action === 'transfer' || ec.action?.type === 'force_transfer') && 
                                    (!!ec.transferTargetId || !!ec.action?.transferTarget),
                        action: ec.action || 'respond',
                        patternsCount: totalPatterns,
                        isValid: !invalidEnabledRules.some(inv => inv.name === ec.name)
                    };
                }).sort((a, b) => (a.priority || 10) - (b.priority || 10))
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

