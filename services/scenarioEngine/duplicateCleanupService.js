/**
 * ============================================================================
 * DUPLICATE CLEANUP SERVICE
 * ============================================================================
 * 
 * Handles the cleanup of duplicate scenarios:
 *   - Merge triggers from duplicates into winner
 *   - Delete duplicate scenarios
 *   - Log all changes for audit trail
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const ConfigAuditLog = require('../../models/ConfigAuditLog');

// ============================================================================
// MERGE TRIGGERS
// ============================================================================

/**
 * Merge triggers from multiple scenarios into one
 * Deduplicates and caps at maxTriggers
 * 
 * @param {Object} winner - The scenario to keep
 * @param {Array} duplicates - Scenarios to merge from
 * @param {number} maxTriggers - Maximum triggers to keep (default 30)
 * @returns {Array} Merged and deduplicated triggers
 */
function mergeTriggers(winner, duplicates, maxTriggers = 30) {
    const allTriggers = new Set();
    
    // Add winner triggers first
    (winner.triggers || []).forEach(t => allTriggers.add(t.toLowerCase().trim()));
    
    // Add duplicate triggers
    for (const dup of duplicates) {
        (dup.triggers || []).forEach(t => allTriggers.add(t.toLowerCase().trim()));
    }
    
    // Convert back to array and normalize
    let merged = Array.from(allTriggers).map(t => {
        // Capitalize first letter
        return t.charAt(0).toUpperCase() + t.slice(1);
    });
    
    // Sort by length (shorter = more common patterns)
    merged.sort((a, b) => a.length - b.length);
    
    // Cap at maxTriggers
    if (merged.length > maxTriggers) {
        logger.info('[DUPLICATE CLEANUP] Triggers capped', { 
            original: merged.length, 
            capped: maxTriggers 
        });
        merged = merged.slice(0, maxTriggers);
    }
    
    return merged;
}

// ============================================================================
// APPLY CLEANUP PLAN
// ============================================================================

/**
 * Apply a cleanup plan to the template
 * 
 * @param {string} templateId - Template to modify
 * @param {Array} plan - Array of { groupId, winnerId, deleteIds, mergeTriggers }
 * @param {Object} user - User performing the cleanup
 * @returns {Object} { success, modified, deleted, errors }
 */
async function applyCleanupPlan(templateId, plan, user = {}) {
    const template = await GlobalInstantResponseTemplate.findById(templateId);
    if (!template) {
        throw new Error('Template not found');
    }
    
    const results = {
        success: true,
        modified: 0,
        deleted: 0,
        errors: [],
        details: []
    };
    
    // Build a map of all scenarios for quick lookup
    const scenarioMap = new Map();
    const categoryMap = new Map();  // scenarioId -> category
    
    for (const category of template.categories || []) {
        for (const scenario of category.scenarios || []) {
            const id = scenario.scenarioId || scenario._id?.toString();
            if (id) {
                scenarioMap.set(id, scenario);
                categoryMap.set(id, category);
            }
        }
    }
    
    // Process each group in the plan
    for (const group of plan) {
        try {
            const { winnerId, deleteIds, mergeTriggers: shouldMerge } = group;
            
            if (!winnerId || !deleteIds || deleteIds.length === 0) {
                continue;
            }
            
            const winner = scenarioMap.get(winnerId);
            if (!winner) {
                results.errors.push(`Winner scenario not found: ${winnerId}`);
                continue;
            }
            
            const duplicates = deleteIds
                .map(id => scenarioMap.get(id))
                .filter(Boolean);
            
            if (duplicates.length === 0) {
                results.errors.push(`No duplicates found for group with winner ${winnerId}`);
                continue;
            }
            
            // Merge triggers if requested
            if (shouldMerge) {
                const originalTriggerCount = winner.triggers?.length || 0;
                winner.triggers = mergeTriggers(winner, duplicates);
                
                results.details.push({
                    action: 'merge',
                    winnerId,
                    winnerName: winner.scenarioName || winner.name,
                    triggersAdded: winner.triggers.length - originalTriggerCount
                });
                results.modified++;
            }
            
            // Delete duplicates from their categories
            for (const duplicate of duplicates) {
                const dupId = duplicate.scenarioId || duplicate._id?.toString();
                const category = categoryMap.get(dupId);
                
                if (category) {
                    const originalLength = category.scenarios.length;
                    category.scenarios = category.scenarios.filter(s => {
                        const sId = s.scenarioId || s._id?.toString();
                        return sId !== dupId;
                    });
                    
                    if (category.scenarios.length < originalLength) {
                        results.deleted++;
                        results.details.push({
                            action: 'delete',
                            scenarioId: dupId,
                            scenarioName: duplicate.scenarioName || duplicate.name,
                            fromCategory: category.name
                        });
                    }
                }
            }
            
        } catch (error) {
            results.errors.push(`Error processing group: ${error.message}`);
            logger.error('[DUPLICATE CLEANUP] Group processing error', { error: error.message, group });
        }
    }
    
    // Save template
    try {
        await template.save();
        
        // Log the cleanup
        await ConfigAuditLog.create({
            companyId: null,  // Global template
            category: 'scenario_cleanup',
            action: 'duplicate_cleanup',
            changes: {
                templateId,
                templateName: template.name,
                groupsProcessed: plan.length,
                scenariosDeleted: results.deleted,
                scenariosModified: results.modified,
                details: results.details
            },
            user: {
                id: user.userId || user._id,
                name: user.name || 'Admin',
                email: user.email
            },
            source: 'deep_audit_duplicate_scan'
        });
        
        logger.info('[DUPLICATE CLEANUP] Cleanup applied', {
            templateId,
            deleted: results.deleted,
            modified: results.modified,
            errors: results.errors.length
        });
        
    } catch (error) {
        results.success = false;
        results.errors.push(`Failed to save template: ${error.message}`);
        logger.error('[DUPLICATE CLEANUP] Save failed', { error: error.message });
    }
    
    return results;
}

// ============================================================================
// GET SCENARIOS BY SERVICE
// ============================================================================

/**
 * Get all scenarios for a specific service from a template
 */
async function getScenariosForService(templateId, serviceKey) {
    const template = await GlobalInstantResponseTemplate.findById(templateId);
    if (!template) {
        throw new Error('Template not found');
    }
    
    const scenarios = [];
    
    for (const category of template.categories || []) {
        for (const scenario of category.scenarios || []) {
            // Match by serviceKey or by category name containing the service
            const matchesService = 
                scenario.serviceKey === serviceKey ||
                (category.name || '').toLowerCase().includes(serviceKey.toLowerCase().replace(/_/g, ' '));
            
            if (matchesService) {
                scenarios.push({
                    ...scenario.toObject ? scenario.toObject() : scenario,
                    _categoryName: category.name,
                    _categoryId: category.id
                });
            }
        }
    }
    
    return scenarios;
}

/**
 * Get all scenarios from template grouped by service
 */
async function getAllScenariosGrouped(templateId) {
    const template = await GlobalInstantResponseTemplate.findById(templateId);
    if (!template) {
        throw new Error('Template not found');
    }
    
    const byService = new Map();
    
    for (const category of template.categories || []) {
        for (const scenario of category.scenarios || []) {
            const serviceKey = scenario.serviceKey || category.name?.toLowerCase().replace(/\s+/g, '_') || 'uncategorized';
            
            if (!byService.has(serviceKey)) {
                byService.set(serviceKey, []);
            }
            
            byService.get(serviceKey).push({
                ...scenario.toObject ? scenario.toObject() : scenario,
                _categoryName: category.name,
                _categoryId: category.id
            });
        }
    }
    
    return Object.fromEntries(byService);
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    mergeTriggers,
    applyCleanupPlan,
    getScenariosForService,
    getAllScenariosGrouped
};
