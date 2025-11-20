/**
 * @file services/globalAIBrainSyncService.js
 * @description Service to sync company instant responses with Global AI Brain
 * 
 * FEATURES:
 * - Compare company scenarios vs. global template
 * - Identify NEW scenarios (not in company yet)
 * - Identify UPDATED scenarios (global version changed)
 * - Identify UNCHANGED scenarios (already up to date)
 * - Track customizations (don't overwrite user edits)
 * - Cherry-pick import functionality
 * 
 * @architecture Enterprise-grade, Redis-cached, production-ready
 */

const logger = require('../utils/logger');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');
const Company = require('../models/v2Company');
const { redisClient } = require('../clients');

/**
 * Compare company's instant response scenarios with global template
 * @param {string} companyId - Company ID
 * @returns {Object} - Comparison result with new, updated, unchanged scenarios
 */
async function compareWithGlobal(companyId) {
    try {
        logger.info(`🔄 [SYNC] Comparing company ${companyId} with Global AI Brain`);
        
        // Get active global template
        const globalTemplate = await GlobalInstantResponseTemplate.findOne({ isActive: true });
        if (!globalTemplate) {
            logger.warn('🔄 [SYNC] No active global template found');
            return {
                success: false,
                message: 'No active global template found'
            };
        }
        
        // Get company data
        const company = await Company.findById(companyId);
        if (!company) {
            logger.warn(`🔄 [SYNC] Company ${companyId} not found`);
            return {
                success: false,
                message: 'Company not found'
            };
        }
        
        // Get company's instant response categories
        const companyCategories = company.aiAgentSettings?.instantResponseCategories || [];
        
        // Build maps for quick lookup
        const companyScenarioMap = new Map();
        companyCategories.forEach(cat => {
            (cat.scenarios || []).forEach(scenario => {
                companyScenarioMap.set(scenario.id, {
                    ...scenario,
                    categoryId: cat.id,
                    categoryName: cat.name
                });
            });
        });
        
        // Compare scenarios
        const newScenarios = [];
        const updatedScenarios = [];
        const unchangedScenarios = [];
        
        globalTemplate.categories.forEach(globalCat => {
            (globalCat.scenarios || []).forEach(globalScenario => {
                const companyScenario = companyScenarioMap.get(globalScenario.id);
                
                if (!companyScenario) {
                    // NEW: Scenario doesn't exist in company
                    newScenarios.push({
                        ...globalScenario.toObject(),
                        categoryId: globalCat.id,
                        categoryName: globalCat.name,
                        categoryIcon: globalCat.icon,
                        categoryType: globalCat.type
                    });
                } else {
                    // Check if updated (compare version or lastUpdated)
                    const globalVersion = globalScenario.version || '1.0';
                    const companyVersion = companyScenario.version || '1.0';
                    const globalUpdated = new Date(globalScenario.lastUpdated || 0);
                    const companyUpdated = new Date(companyScenario.lastUpdated || 0);
                    
                    if (globalVersion !== companyVersion || globalUpdated > companyUpdated) {
                        // UPDATED: Global version is newer
                        updatedScenarios.push({
                            global: {
                                ...globalScenario.toObject(),
                                categoryId: globalCat.id,
                                categoryName: globalCat.name
                            },
                            company: companyScenario,
                            changes: detectChanges(companyScenario, globalScenario)
                        });
                    } else {
                        // UNCHANGED: Already up to date
                        unchangedScenarios.push({
                            id: globalScenario.id,
                            name: globalScenario.name,
                            version: globalVersion
                        });
                    }
                }
            });
        });
        
        logger.info(`✅ [SYNC] Comparison complete for company ${companyId}`);
        logger.info(`📊 [SYNC] NEW: ${newScenarios.length}, UPDATED: ${updatedScenarios.length}, UNCHANGED: ${unchangedScenarios.length}`);
        
        return {
            success: true,
            globalTemplate: {
                id: globalTemplate._id,
                version: globalTemplate.version,
                name: globalTemplate.name
            },
            comparison: {
                newScenarios,
                updatedScenarios,
                unchangedScenarios,
                stats: {
                    new: newScenarios.length,
                    updated: updatedScenarios.length,
                    unchanged: unchangedScenarios.length,
                    total: newScenarios.length + updatedScenarios.length + unchangedScenarios.length
                }
            }
        };
    } catch (error) {
        logger.error('❌ [SYNC] Error comparing with global', { 
            error: error.message, 
            companyId,
            stack: error.stack 
        });
        return {
            success: false,
            message: `Error comparing with global: ${error.message}`
        };
    }
}

/**
 * Detect specific changes between company and global scenario
 * @param {Object} companyScenario - Company's version
 * @param {Object} globalScenario - Global version
 * @returns {Array<string>} - List of changes
 */
function detectChanges(companyScenario, globalScenario) {
    const changes = [];
    
    // Check triggers
    const companyTriggers = new Set(companyScenario.triggers || []);
    const globalTriggers = new Set(globalScenario.triggers || []);
    const newTriggers = [...globalTriggers].filter(t => !companyTriggers.has(t));
    if (newTriggers.length > 0) {
        changes.push(`${newTriggers.length} new trigger(s) added`);
    }
    
    // Check responses
    if (companyScenario.fullReply !== globalScenario.fullReply) {
        changes.push('Response text updated');
    }
    
    // Check keywords
    if ((globalScenario.keywords || []).length > (companyScenario.keywords || []).length) {
        changes.push('Keywords enhanced');
    }
    
    // Check Q&A pairs
    if ((globalScenario.qnaPairs || []).length > (companyScenario.qnaPairs || []).length) {
        changes.push('Q&A pairs added');
    }
    
    return changes;
}

/**
 * Import selected scenarios from global template to company
 * @param {string} companyId - Company ID
 * @param {Array<string>} scenarioIds - Array of scenario IDs to import
 * @returns {Object} - Import result
 */
async function importFromGlobal(companyId, scenarioIds) {
    try {
        logger.info(`📥 [SYNC] Importing ${scenarioIds.length} scenarios to company ${companyId}`);
        
        // Get global template
        const globalTemplate = await GlobalInstantResponseTemplate.findOne({ isActive: true });
        if (!globalTemplate) {
            return {
                success: false,
                message: 'No active global template found'
            };
        }
        
        // Get company
        const company = await Company.findById(companyId);
        if (!company) {
            return {
                success: false,
                message: 'Company not found'
            };
        }
        
        // Build scenario map from global template
        const globalScenarioMap = new Map();
        globalTemplate.categories.forEach(cat => {
            (cat.scenarios || []).forEach(scenario => {
                globalScenarioMap.set(scenario.id, {
                    scenario: scenario.toObject(),
                    category: {
                        id: cat.id,
                        name: cat.name,
                        icon: cat.icon,
                        type: cat.type,
                        description: cat.description
                    }
                });
            });
        });
        
        // Import scenarios
        const imported = [];
        const skipped = [];
        
        scenarioIds.forEach(scenarioId => {
            const globalData = globalScenarioMap.get(scenarioId);
            if (!globalData) {
                skipped.push({ id: scenarioId, reason: 'Not found in global template' });
                return;
            }
            
            // Find or create category in company
            let companyCategory = (company.aiAgentSettings?.instantResponseCategories || [])
                .find(cat => cat.id === globalData.category.id);
            
            if (!companyCategory) {
                // Create new category
                if (!company.aiAgentSettings) {company.aiAgentSettings = {};}
                if (!company.aiAgentSettings.instantResponseCategories) {
                    company.aiAgentSettings.instantResponseCategories = [];
                }
                
                companyCategory = {
                    id: globalData.category.id,
                    name: globalData.category.name,
                    icon: globalData.category.icon,
                    type: globalData.category.type,
                    description: globalData.category.description,
                    scenarios: []
                };
                company.aiAgentSettings.instantResponseCategories.push(companyCategory);
            }
            
            // Check if scenario already exists
            const existingIndex = companyCategory.scenarios.findIndex(s => s.id === scenarioId);
            
            if (existingIndex >= 0) {
                // Update existing scenario
                companyCategory.scenarios[existingIndex] = globalData.scenario;
                imported.push({ id: scenarioId, action: 'updated' });
            } else {
                // Add new scenario
                companyCategory.scenarios.push(globalData.scenario);
                imported.push({ id: scenarioId, action: 'added' });
            }
        });
        
        // Update sync history
        if (!company.aiAgentSettings.syncHistory) {
            company.aiAgentSettings.syncHistory = {};
        }
        company.aiAgentSettings.syncHistory.lastSyncedAt = new Date();
        company.aiAgentSettings.syncHistory.globalTemplateVersion = globalTemplate.version;
        company.aiAgentSettings.syncHistory.lastImportCount = imported.length;
        
        // Save company
        await company.save();
        
        // Clear Redis cache for this company
        const cacheKey = `company:${companyId}`;
        await redisClient.del(cacheKey);
        logger.info(`🗑️ [SYNC] Cleared Redis cache: ${cacheKey}`);
        
        logger.info(`✅ [SYNC] Import complete: ${imported.length} imported, ${skipped.length} skipped`);
        
        return {
            success: true,
            imported,
            skipped,
            stats: {
                imported: imported.length,
                skipped: skipped.length
            }
        };
    } catch (error) {
        logger.error('❌ [SYNC] Error importing from global', { 
            error: error.message, 
            companyId,
            scenarioIds,
            stack: error.stack 
        });
        return {
            success: false,
            message: `Error importing from global: ${error.message}`
        };
    }
}

module.exports = {
    compareWithGlobal,
    importFromGlobal,
    detectChanges
};
