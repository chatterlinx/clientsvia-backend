/**
 * ============================================================================
 * TRANSFERS SNAPSHOT PROVIDER
 * ============================================================================
 * Provides: Transfer targets, after-hours routing configuration
 * 
 * DATA SOURCE: CheatSheetVersion (transferRules) OR frontDeskBehavior.transfers
 * 
 * Note: Transfers are OPTIONAL. If not configured, provider returns 
 * enabled=false with NOT_CONFIGURED status (not an error).
 */

const CheatSheetVersion = require('../../../models/cheatsheet/CheatSheetVersion');
const Company = require('../../../models/v2Company');
const logger = require('../../../utils/logger');

module.exports.getSnapshot = async function(companyId) {
    const startTime = Date.now();
    
    try {
        // Try CheatSheetVersion first (primary source)
        let transferRules = [];
        let dataSource = 'none';
        
        const cheatSheet = await CheatSheetVersion.findOne({ 
            companyId, 
            status: 'live' 
        }).lean();
        
        if (cheatSheet?.config?.transferRules?.length > 0) {
            transferRules = cheatSheet.config.transferRules;
            dataSource = 'CheatSheetVersion.transferRules';
        }
        
        // Check company for multiple possible locations
        const company = await Company.findById(companyId)
            .select('frontDeskBehavior.transfers aiAgentSettings.transferTargets')
            .lean();
        
        // Fallback 1: Check aiAgentSettings.transferTargets (where seedGolden stores them)
        if (transferRules.length === 0 && company?.aiAgentSettings?.transferTargets?.length > 0) {
            transferRules = company.aiAgentSettings.transferTargets.map(target => ({
                id: target.id,
                contactNameOrQueue: target.name || target.id || 'Unnamed',
                label: target.name || target.id || 'Unnamed',
                phoneNumber: target.destination || target.phone || target.phoneNumber || null,
                intentTag: target.id || null,  // Use ID as intent tag for routing
                enabled: target.enabled !== false,
                priority: target.priority || 10,
                afterHoursOnly: target.afterHoursOnly || false,
                preTransferScript: target.script || target.preTransferScript || null,
                type: target.type || 'phone',
                description: target.description || null
            }));
            dataSource = 'aiAgentSettings.transferTargets';
        }
        
        // Fallback 2: Check frontDeskBehavior.transfers
        if (transferRules.length === 0 && company?.frontDeskBehavior?.transfers?.targets?.length > 0) {
            transferRules = company.frontDeskBehavior.transfers.targets.map(target => ({
                contactNameOrQueue: target.name || target.label || 'Unnamed',
                label: target.label || target.name || 'Unnamed',
                phoneNumber: target.phone || target.phoneNumber || null,
                intentTag: target.intentTag || null,
                enabled: target.enabled !== false,
                priority: target.priority || 10,
                afterHoursOnly: target.afterHoursOnly || false,
                preTransferScript: target.script || target.preTransferScript || null
            }));
            dataSource = 'frontDeskBehavior.transfers';
        }
        
        // If still no data, return NOT_CONFIGURED (not an error)
        if (transferRules.length === 0) {
            return {
                provider: 'transfers',
                providerVersion: '1.1',
                schemaVersion: 'v1',
                enabled: false,
                health: 'GREEN',  // NOT_CONFIGURED is not an error
                warnings: ['NOT_CONFIGURED: No transfer targets defined (optional feature)'],
                status: 'NOT_CONFIGURED',
                data: {
                    dataSource: 'none',
                    targetsTotal: 0,
                    targetsEnabled: 0,
                    afterHoursRouting: false,
                    afterHoursTargetsCount: 0,
                    intentTags: [],
                    targets: []
                },
                generatedIn: Date.now() - startTime
            };
        }
        
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
        
        // Validate enabled targets have phone numbers
        const enabledWithoutPhone = enabledTargets.filter(r => !r.phoneNumber);
        if (enabledWithoutPhone.length > 0) {
            health = 'YELLOW';
            enabledWithoutPhone.forEach(r => {
                warnings.push(`Transfer target "${r.label || r.contactNameOrQueue}" enabled but has no phone number`);
            });
        }
        
        return {
            provider: 'transfers',
            providerVersion: '1.1',
            schemaVersion: 'v1',
            enabled: transferRules.length > 0,
            health,
            warnings,
            status: 'CONFIGURED',
            data: {
                dataSource,
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

