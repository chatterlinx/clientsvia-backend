/**
 * ════════════════════════════════════════════════════════════════════════════════
 * TEMPLATE DEBUG EXPORT - READ-ONLY
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Provides a comprehensive, read-only export of template contents for debugging
 * and optimization planning. No writes, no side effects.
 * 
 * GET /api/trade-knowledge/templates/:templateId/debug/export
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const logger = require('../../utils/logger');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');

/**
 * GET /api/trade-knowledge/templates/:templateId/debug/export
 * 
 * Returns a comprehensive read-only export of the template contents:
 * - templateId, name, version
 * - categories[]: {id, name, scenarioCount, description}
 * - scenarios[]: {id, categoryId, categoryName, name, priority, triggersCount, 
 *                 negativeTriggersCount, quickRepliesCount, fullRepliesCount,
 *                 actionHooks, handoffPolicy, contextWeight, status}
 * - totals: categories, scenarios, triggers, negativeTriggers
 * - duplicates report: scenarios with identical triggers or names
 * - health: warnings about incomplete scenarios
 */
router.get('/:templateId/debug/export', async (req, res) => {
    const { templateId } = req.params;
    const startTime = Date.now();
    
    logger.info(`[TEMPLATE DEBUG EXPORT] Fetching template ${templateId}`);
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        
        if (!template) {
            return res.status(404).json({
                success: false,
                error: 'Template not found',
                templateId
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // BUILD CATEGORIES SUMMARY
        // ═══════════════════════════════════════════════════════════════════
        const categories = (template.categories || []).map(cat => ({
            id: cat.id,
            name: cat.name,
            description: cat.description || '',
            scenarioCount: (cat.scenarios || []).length,
            triggersCount: (cat.scenarios || []).reduce((sum, s) => sum + (s.triggers?.length || 0), 0),
            status: cat.status || 'active'
        }));
        
        // ═══════════════════════════════════════════════════════════════════
        // BUILD SCENARIOS DETAILED LIST
        // ═══════════════════════════════════════════════════════════════════
        const scenarios = [];
        const triggerMap = new Map(); // For duplicate detection
        const nameMap = new Map();    // For duplicate name detection
        
        for (const cat of (template.categories || [])) {
            for (const scenario of (cat.scenarios || [])) {
                const scenarioEntry = {
                    id: scenario.scenarioId || scenario._id,
                    categoryId: cat.id,
                    categoryName: cat.name,
                    name: scenario.name,
                    status: scenario.status || 'live',
                    priority: scenario.priority || 5,
                    triggersCount: (scenario.triggers || []).length,
                    negativeTriggersCount: (scenario.negativeTriggers || []).length,
                    quickRepliesCount: (scenario.quickReplies || []).length,
                    fullRepliesCount: (scenario.fullReplies || []).length,
                    actionHooks: scenario.actionHooks || [],
                    handoffPolicy: scenario.handoffPolicy || 'low_confidence',
                    contextWeight: scenario.contextWeight || 0.7,
                    replyStrategy: scenario.replyStrategy || 'AUTO',
                    followUpMode: scenario.followUpMode || 'NONE',
                    minConfidence: scenario.minConfidence,
                    // Sample triggers (first 5 for debugging)
                    sampleTriggers: (scenario.triggers || []).slice(0, 5),
                    // Health indicators
                    hasQuickReplies: (scenario.quickReplies || []).length > 0,
                    hasFullReplies: (scenario.fullReplies || []).length > 0,
                    hasTriggers: (scenario.triggers || []).length > 0,
                    hasNegativeTriggers: (scenario.negativeTriggers || []).length > 0
                };
                
                scenarios.push(scenarioEntry);
                
                // Track for duplicates
                const lowerName = scenario.name?.toLowerCase();
                if (nameMap.has(lowerName)) {
                    nameMap.get(lowerName).push(scenarioEntry.id);
                } else {
                    nameMap.set(lowerName, [scenarioEntry.id]);
                }
                
                // Track trigger duplicates
                for (const trigger of (scenario.triggers || [])) {
                    const lowerTrigger = trigger.toLowerCase().trim();
                    if (triggerMap.has(lowerTrigger)) {
                        triggerMap.get(lowerTrigger).push({
                            scenarioId: scenarioEntry.id,
                            scenarioName: scenario.name,
                            categoryName: cat.name
                        });
                    } else {
                        triggerMap.set(lowerTrigger, [{
                            scenarioId: scenarioEntry.id,
                            scenarioName: scenario.name,
                            categoryName: cat.name
                        }]);
                    }
                }
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // CALCULATE TOTALS
        // ═══════════════════════════════════════════════════════════════════
        const totals = {
            categories: categories.length,
            scenarios: scenarios.length,
            triggers: scenarios.reduce((sum, s) => sum + s.triggersCount, 0),
            negativeTriggers: scenarios.reduce((sum, s) => sum + s.negativeTriggersCount, 0),
            quickReplies: scenarios.reduce((sum, s) => sum + s.quickRepliesCount, 0),
            fullReplies: scenarios.reduce((sum, s) => sum + s.fullRepliesCount, 0),
            actionHooksUsed: [...new Set(scenarios.flatMap(s => s.actionHooks))].length
        };
        
        // ═══════════════════════════════════════════════════════════════════
        // DUPLICATES REPORT
        // ═══════════════════════════════════════════════════════════════════
        const duplicates = {
            names: [],
            triggers: []
        };
        
        // Find duplicate scenario names
        for (const [name, ids] of nameMap) {
            if (ids.length > 1) {
                duplicates.names.push({
                    name,
                    count: ids.length,
                    scenarioIds: ids
                });
            }
        }
        
        // Find duplicate triggers (same trigger in multiple scenarios)
        for (const [trigger, usages] of triggerMap) {
            if (usages.length > 1) {
                duplicates.triggers.push({
                    trigger,
                    count: usages.length,
                    usedIn: usages
                });
            }
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // HEALTH WARNINGS
        // ═══════════════════════════════════════════════════════════════════
        const health = {
            warnings: [],
            incompleteScenarios: [],
            emptyCategories: []
        };
        
        // Find incomplete scenarios
        for (const scenario of scenarios) {
            const issues = [];
            if (!scenario.hasTriggers) issues.push('no_triggers');
            if (!scenario.hasQuickReplies) issues.push('no_quick_replies');
            if (!scenario.hasFullReplies) issues.push('no_full_replies');
            if (scenario.triggersCount < 3) issues.push('few_triggers');
            
            if (issues.length > 0) {
                health.incompleteScenarios.push({
                    id: scenario.id,
                    name: scenario.name,
                    categoryName: scenario.categoryName,
                    issues
                });
            }
        }
        
        // Find empty categories
        for (const cat of categories) {
            if (cat.scenarioCount === 0) {
                health.emptyCategories.push({
                    id: cat.id,
                    name: cat.name
                });
            }
        }
        
        // Generate warnings
        if (health.emptyCategories.length > 0) {
            health.warnings.push(`${health.emptyCategories.length} empty categories found`);
        }
        if (health.incompleteScenarios.length > 0) {
            health.warnings.push(`${health.incompleteScenarios.length} incomplete scenarios found`);
        }
        if (duplicates.triggers.length > 0) {
            health.warnings.push(`${duplicates.triggers.length} duplicate triggers found (may cause routing conflicts)`);
        }
        if (duplicates.names.length > 0) {
            health.warnings.push(`${duplicates.names.length} duplicate scenario names found`);
        }
        
        // ═══════════════════════════════════════════════════════════════════
        // BUILD RESPONSE
        // ═══════════════════════════════════════════════════════════════════
        const response = {
            success: true,
            export: {
                templateId: template._id,
                templateName: template.name,
                templateVersion: template.version,
                templateType: template.templateType,
                description: template.description,
                isActive: template.isActive,
                isPublished: template.isPublished,
                
                // Summary
                totals,
                
                // Detailed data
                categories,
                scenarios,
                
                // Quality reports
                duplicates: {
                    hasDuplicates: duplicates.names.length > 0 || duplicates.triggers.length > 0,
                    duplicateNames: duplicates.names,
                    duplicateTriggers: duplicates.triggers.slice(0, 50) // Limit to first 50
                },
                
                health: {
                    status: health.warnings.length === 0 ? 'GREEN' : 
                            health.emptyCategories.length > 5 ? 'RED' : 'YELLOW',
                    warnings: health.warnings,
                    emptyCategories: health.emptyCategories,
                    incompleteScenarios: health.incompleteScenarios.slice(0, 20) // Limit
                }
            },
            meta: {
                generatedAt: new Date().toISOString(),
                generatedInMs: Date.now() - startTime,
                endpoint: `/api/trade-knowledge/templates/${templateId}/debug/export`
            }
        };
        
        logger.info(`[TEMPLATE DEBUG EXPORT] Export complete: ${totals.categories} categories, ${totals.scenarios} scenarios, ${totals.triggers} triggers`);
        
        res.json(response);
        
    } catch (error) {
        logger.error(`[TEMPLATE DEBUG EXPORT] Error:`, error);
        res.status(500).json({
            success: false,
            error: error.message,
            templateId
        });
    }
});

/**
 * GET /api/trade-knowledge/templates/:templateId/debug/category/:categoryId
 * 
 * Returns detailed export of a single category with all scenario details
 */
router.get('/:templateId/debug/category/:categoryId', async (req, res) => {
    const { templateId, categoryId } = req.params;
    
    logger.info(`[TEMPLATE DEBUG EXPORT] Fetching category ${categoryId} from template ${templateId}`);
    
    try {
        const template = await GlobalInstantResponseTemplate.findById(templateId).lean();
        
        if (!template) {
            return res.status(404).json({
                success: false,
                error: 'Template not found'
            });
        }
        
        const category = (template.categories || []).find(c => c.id === categoryId);
        
        if (!category) {
            return res.status(404).json({
                success: false,
                error: 'Category not found',
                availableCategories: (template.categories || []).map(c => ({ id: c.id, name: c.name }))
            });
        }
        
        // Build detailed scenario list
        const scenarios = (category.scenarios || []).map(s => ({
            id: s.scenarioId || s._id,
            name: s.name,
            status: s.status || 'live',
            priority: s.priority || 5,
            
            // Triggers (full list)
            triggers: s.triggers || [],
            negativeTriggers: s.negativeTriggers || [],
            
            // Replies (full list)
            quickReplies: s.quickReplies || [],
            fullReplies: s.fullReplies || [],
            
            // Configuration
            actionHooks: s.actionHooks || [],
            handoffPolicy: s.handoffPolicy || 'low_confidence',
            contextWeight: s.contextWeight || 0.7,
            replyStrategy: s.replyStrategy || 'AUTO',
            followUpMode: s.followUpMode || 'NONE',
            minConfidence: s.minConfidence,
            
            // Follow-up
            followUpPrompts: s.followUpPrompts || [],
            followUpQuestionText: s.followUpQuestionText,
            
            // Timing
            timedFollowUp: s.timedFollowUp,
            silencePolicy: s.silencePolicy,
            cooldownSeconds: s.cooldownSeconds || 0,
            
            // Metadata
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            createdBy: s.createdBy
        }));
        
        res.json({
            success: true,
            category: {
                id: category.id,
                name: category.name,
                description: category.description,
                status: category.status,
                scenarioCount: scenarios.length,
                totalTriggers: scenarios.reduce((sum, s) => sum + s.triggers.length, 0),
                scenarios
            },
            templateInfo: {
                id: template._id,
                name: template.name,
                version: template.version
            },
            meta: {
                generatedAt: new Date().toISOString()
            }
        });
        
    } catch (error) {
        logger.error(`[TEMPLATE DEBUG EXPORT] Category export error:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/trade-knowledge/templates/list
 * 
 * List all available templates with summary stats
 */
router.get('/list', async (req, res) => {
    try {
        const templates = await GlobalInstantResponseTemplate.find({})
            .select('name version templateType description isActive isPublished categories createdAt updatedAt')
            .lean();
        
        const list = templates.map(t => ({
            id: t._id,
            name: t.name,
            version: t.version,
            templateType: t.templateType,
            description: t.description?.substring(0, 100),
            isActive: t.isActive,
            isPublished: t.isPublished,
            stats: {
                categories: (t.categories || []).length,
                scenarios: (t.categories || []).reduce((sum, c) => sum + (c.scenarios || []).length, 0),
                triggers: (t.categories || []).reduce((sum, c) => 
                    sum + (c.scenarios || []).reduce((s2, sc) => s2 + (sc.triggers || []).length, 0), 0)
            },
            createdAt: t.createdAt,
            updatedAt: t.updatedAt
        }));
        
        res.json({
            success: true,
            templates: list,
            count: list.length
        });
        
    } catch (error) {
        logger.error(`[TEMPLATE DEBUG EXPORT] List error:`, error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

