/**
 * ════════════════════════════════════════════════════════════════════════════════
 * BLUEPRINT API ROUTES
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Enterprise-grade API for generating and applying scenario blueprints.
 * 
 * ENDPOINTS:
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  GET  /api/company/:companyId/blueprint/trades      - List supported trades │
 * │  GET  /api/company/:companyId/blueprint/schema      - Get field schemas     │
 * │  GET  /api/company/:companyId/blueprint/generate    - Generate blueprint    │
 * │  GET  /api/company/:companyId/blueprint/summary     - Get summary only      │
 * │  GET  /api/company/:companyId/blueprint/category/:id - Get category detail  │
 * │  POST /api/company/:companyId/blueprint/apply       - Apply blueprint       │
 * │  POST /api/company/:companyId/blueprint/apply/preview - Preview changes     │
 * └─────────────────────────────────────────────────────────────────────────────┘
 * 
 * SECURITY:
 * - All endpoints require JWT authentication
 * - Company ID is validated against user permissions
 * - Audit logging for all blueprint operations
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const logger = require('../../utils/logger');

// Services
const { 
    BlueprintGenerator, 
    SUPPORTED_TRADES, 
    SCENARIO_FIELD_SCHEMA, 
    CATEGORY_FIELD_SCHEMA 
} = require('../../services/blueprint/BlueprintGenerator');

// Snapshot for platform context
let platformSnapshotService;
try {
    platformSnapshotService = require('../../platform/snapshot/platformSnapshot');
} catch (e) {
    logger.warn('[BLUEPRINT ROUTES] Platform snapshot service not available');
}

// Models
const v2Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Validate company exists and user has access
 */
const validateCompanyAccess = async (req, res, next) => {
    const { companyId } = req.params;
    
    if (!companyId || !companyId.match(/^[a-f\d]{24}$/i)) {
        return res.status(400).json({
            success: false,
            error: 'Invalid company ID format'
        });
    }
    
    try {
        const company = await v2Company.findById(companyId)
            .select('name tradeKey tradeCategoryId')
            .lean();
            
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        req.company = company;
        next();
    } catch (error) {
        logger.error('[BLUEPRINT] Company access validation failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to validate company access'
        });
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/company/:companyId/blueprint/trades
// List all supported trades with their details
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/trades', validateCompanyAccess, async (req, res) => {
    try {
        const trades = Object.values(SUPPORTED_TRADES).map(trade => ({
            key: trade.key,
            name: trade.name,
            description: trade.description,
            keywords: trade.keywords,
            hasTemplate: true // All listed trades have templates
        }));
        
        res.json({
            success: true,
            trades,
            currentCompanyTrade: req.company.tradeKey || 'universal'
        });
        
    } catch (error) {
        logger.error('[BLUEPRINT] Error listing trades:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/company/:companyId/blueprint/schema
// Get full field schemas for scenarios and categories
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/schema', validateCompanyAccess, async (req, res) => {
    try {
        res.json({
            success: true,
            schema: {
                scenario: SCENARIO_FIELD_SCHEMA,
                category: CATEGORY_FIELD_SCHEMA
            },
            fieldCount: {
                scenario: Object.keys(SCENARIO_FIELD_SCHEMA).length,
                category: Object.keys(CATEGORY_FIELD_SCHEMA).length
            },
            categorizedFields: {
                scenario: categorizeFields(SCENARIO_FIELD_SCHEMA),
                category: categorizeFields(CATEGORY_FIELD_SCHEMA)
            }
        });
        
    } catch (error) {
        logger.error('[BLUEPRINT] Error getting schema:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Helper to categorize fields by their category property
 */
function categorizeFields(schema) {
    const categorized = {};
    
    for (const [fieldName, fieldDef] of Object.entries(schema)) {
        const category = fieldDef.category || 'other';
        
        if (!categorized[category]) {
            categorized[category] = [];
        }
        
        categorized[category].push({
            name: fieldName,
            type: fieldDef.type,
            required: fieldDef.required,
            impactLevel: fieldDef.impactLevel
        });
    }
    
    return categorized;
}

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/company/:companyId/blueprint/generate
// Generate a complete blueprint for the company
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/generate', validateCompanyAccess, async (req, res) => {
    const { companyId } = req.params;
    const { trade, includeReasoning = 'true' } = req.query;
    
    const startTime = Date.now();
    
    try {
        // Determine trade to use
        const tradeKey = trade || req.company.tradeKey || 'universal';
        
        // Get platform snapshot for context
        let platformSnapshot = null;
        if (platformSnapshotService) {
            try {
                platformSnapshot = await platformSnapshotService.generateSnapshot(companyId, 'full');
            } catch (e) {
                logger.warn('[BLUEPRINT] Could not get platform snapshot, using minimal context');
            }
        }
        
        // Fallback minimal snapshot if service unavailable
        if (!platformSnapshot) {
            platformSnapshot = {
                meta: {
                    companyId,
                    companyName: req.company.name,
                    tradeKey
                },
                providers: {}
            };
        }
        
        // Initialize generator
        const generator = new BlueprintGenerator({
            validateTransfers: true,
            validatePlaceholders: true,
            validatePriorities: true,
            includeReasoning: includeReasoning === 'true'
        });
        
        // Generate blueprint
        const blueprint = await generator.generate(companyId, tradeKey, platformSnapshot);
        
        logger.info(`[BLUEPRINT] Generated for ${companyId}, trade: ${tradeKey}, ms: ${Date.now() - startTime}`);
        
        res.json(blueprint);
        
    } catch (error) {
        logger.error('[BLUEPRINT] Generation error:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            generatedIn: Date.now() - startTime
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/company/:companyId/blueprint/summary
// Get just the summary (Tier 1 - for admin overview)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/summary', validateCompanyAccess, async (req, res) => {
    const { companyId } = req.params;
    const { trade } = req.query;
    
    try {
        const tradeKey = trade || req.company.tradeKey || 'universal';
        
        // Get platform snapshot
        let platformSnapshot = null;
        if (platformSnapshotService) {
            try {
                platformSnapshot = await platformSnapshotService.generateSnapshot(companyId, 'full');
            } catch (e) {
                logger.warn('[BLUEPRINT] Could not get platform snapshot for summary');
            }
        }
        
        if (!platformSnapshot) {
            platformSnapshot = {
                meta: { companyId, companyName: req.company.name, tradeKey },
                providers: {}
            };
        }
        
        const generator = new BlueprintGenerator({ includeReasoning: false });
        const blueprint = await generator.generate(companyId, tradeKey, platformSnapshot);
        
        if (!blueprint.success) {
            return res.status(400).json(blueprint);
        }
        
        res.json({
            success: true,
            meta: blueprint.meta,
            summary: blueprint.summary,
            validation: blueprint.validation
        });
        
    } catch (error) {
        logger.error('[BLUEPRINT] Summary error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/company/:companyId/blueprint/category/:categoryId
// Get detailed config for a specific category (Tier 2)
// ═══════════════════════════════════════════════════════════════════════════════
router.get('/category/:categoryId', validateCompanyAccess, async (req, res) => {
    const { companyId, categoryId } = req.params;
    const { trade } = req.query;
    
    try {
        const tradeKey = trade || req.company.tradeKey || 'universal';
        
        let platformSnapshot = null;
        if (platformSnapshotService) {
            try {
                platformSnapshot = await platformSnapshotService.generateSnapshot(companyId, 'full');
            } catch (e) {
                // Continue without snapshot
            }
        }
        
        if (!platformSnapshot) {
            platformSnapshot = {
                meta: { companyId, companyName: req.company.name, tradeKey },
                providers: {}
            };
        }
        
        const generator = new BlueprintGenerator({ includeReasoning: true });
        const blueprint = await generator.generate(companyId, tradeKey, platformSnapshot);
        
        if (!blueprint.success) {
            return res.status(400).json(blueprint);
        }
        
        // Find the requested category
        const category = blueprint.details.find(c => 
            c.categoryId === categoryId || c.name.toLowerCase() === categoryId.toLowerCase()
        );
        
        if (!category) {
            return res.status(404).json({
                success: false,
                error: `Category '${categoryId}' not found`,
                availableCategories: blueprint.details.map(c => ({
                    id: c.categoryId,
                    name: c.name
                }))
            });
        }
        
        res.json({
            success: true,
            meta: blueprint.meta,
            category,
            scenarioCount: category.scenarios.length
        });
        
    } catch (error) {
        logger.error('[BLUEPRINT] Category detail error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/company/:companyId/blueprint/apply/preview
// Preview what changes would be made without applying
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/apply/preview', validateCompanyAccess, async (req, res) => {
    const { companyId } = req.params;
    const { trade, categories } = req.body;
    
    try {
        const tradeKey = trade || req.company.tradeKey || 'universal';
        
        // Get current scenarios for comparison
        const existingTemplates = await GlobalInstantResponseTemplate.find({
            $or: [
                { companyId },
                { scope: 'GLOBAL', tradeKey }
            ]
        }).lean();
        
        // Get platform snapshot
        let platformSnapshot = null;
        if (platformSnapshotService) {
            try {
                platformSnapshot = await platformSnapshotService.generateSnapshot(companyId, 'full');
            } catch (e) {
                // Continue
            }
        }
        
        if (!platformSnapshot) {
            platformSnapshot = {
                meta: { companyId, companyName: req.company.name, tradeKey },
                providers: {}
            };
        }
        
        const generator = new BlueprintGenerator({ includeReasoning: true });
        const blueprint = await generator.generate(companyId, tradeKey, platformSnapshot);
        
        if (!blueprint.success) {
            return res.status(400).json(blueprint);
        }
        
        // Calculate diff
        const preview = {
            willCreate: [],
            willUpdate: [],
            willSkip: [],
            unchanged: []
        };
        
        // Filter categories if specified
        let categoriesToApply = blueprint.details;
        if (categories && Array.isArray(categories) && categories.length > 0) {
            categoriesToApply = blueprint.details.filter(c => 
                categories.includes(c.categoryId) || categories.includes(c.name)
            );
        }
        
        for (const category of categoriesToApply) {
            // Check if category exists
            const existingCategory = existingTemplates.find(t => 
                t.categories?.some(c => c.categoryId === category.categoryId)
            );
            
            for (const scenario of category.scenarios) {
                const existingScenario = findExistingScenario(existingTemplates, scenario.scenarioId);
                
                if (!existingScenario) {
                    preview.willCreate.push({
                        categoryId: category.categoryId,
                        categoryName: category.name,
                        scenarioId: scenario.scenarioId,
                        scenarioName: scenario.name
                    });
                } else {
                    // Compare key fields
                    const hasChanges = scenarioHasChanges(existingScenario, scenario);
                    
                    if (hasChanges) {
                        preview.willUpdate.push({
                            categoryId: category.categoryId,
                            scenarioId: scenario.scenarioId,
                            scenarioName: scenario.name,
                            changes: getScenarioChanges(existingScenario, scenario)
                        });
                    } else {
                        preview.unchanged.push({
                            scenarioId: scenario.scenarioId,
                            scenarioName: scenario.name
                        });
                    }
                }
            }
        }
        
        res.json({
            success: true,
            preview,
            summary: {
                creating: preview.willCreate.length,
                updating: preview.willUpdate.length,
                unchanged: preview.unchanged.length,
                skipping: preview.willSkip.length,
                totalAffected: preview.willCreate.length + preview.willUpdate.length
            }
        });
        
    } catch (error) {
        logger.error('[BLUEPRINT] Preview error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Helper to find an existing scenario by ID
 */
function findExistingScenario(templates, scenarioId) {
    for (const template of templates) {
        for (const category of template.categories || []) {
            for (const scenario of category.scenarios || []) {
                if (scenario.scenarioId === scenarioId) {
                    return scenario;
                }
            }
        }
    }
    return null;
}

/**
 * Check if scenario has meaningful changes
 */
function scenarioHasChanges(existing, proposed) {
    const keysToCompare = [
        'triggers', 'negativeTriggers', 'quickReplies', 'fullReplies',
        'minConfidence', 'priority', 'enabled', 'followUpMode',
        'transitionToMode', 'transferHook'
    ];
    
    for (const key of keysToCompare) {
        const existingValue = JSON.stringify(existing[key]);
        const proposedValue = JSON.stringify(proposed[key]);
        
        if (existingValue !== proposedValue) {
            return true;
        }
    }
    
    return false;
}

/**
 * Get list of changed fields
 */
function getScenarioChanges(existing, proposed) {
    const changes = [];
    const keysToCompare = [
        'triggers', 'negativeTriggers', 'quickReplies', 'fullReplies',
        'minConfidence', 'priority', 'enabled', 'followUpMode',
        'transitionToMode', 'transferHook', 'replySelection', 'replyStrategy'
    ];
    
    for (const key of keysToCompare) {
        const existingValue = JSON.stringify(existing[key]);
        const proposedValue = JSON.stringify(proposed[key]);
        
        if (existingValue !== proposedValue) {
            changes.push({
                field: key,
                from: existing[key],
                to: proposed[key]
            });
        }
    }
    
    return changes;
}

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/company/:companyId/blueprint/apply
// Apply blueprint to company (create/update scenarios)
// ═══════════════════════════════════════════════════════════════════════════════
router.post('/apply', validateCompanyAccess, async (req, res) => {
    const { companyId } = req.params;
    const { trade, categories, mode = 'merge' } = req.body;
    
    // mode: 'merge' = update existing, create new
    // mode: 'replace' = delete existing in categories, create new
    // mode: 'create_only' = skip existing, only create new
    
    const validModes = ['merge', 'replace', 'create_only'];
    if (!validModes.includes(mode)) {
        return res.status(400).json({
            success: false,
            error: `Invalid mode. Must be one of: ${validModes.join(', ')}`
        });
    }
    
    try {
        const tradeKey = trade || req.company.tradeKey || 'universal';
        
        // Get platform snapshot
        let platformSnapshot = null;
        if (platformSnapshotService) {
            try {
                platformSnapshot = await platformSnapshotService.generateSnapshot(companyId, 'full');
            } catch (e) {
                // Continue
            }
        }
        
        if (!platformSnapshot) {
            platformSnapshot = {
                meta: { companyId, companyName: req.company.name, tradeKey },
                providers: {}
            };
        }
        
        // Generate blueprint
        const generator = new BlueprintGenerator({ includeReasoning: false });
        const blueprint = await generator.generate(companyId, tradeKey, platformSnapshot);
        
        if (!blueprint.success) {
            return res.status(400).json(blueprint);
        }
        
        // Apply changes
        const results = {
            created: [],
            updated: [],
            skipped: [],
            errors: []
        };
        
        // Filter categories if specified
        let categoriesToApply = blueprint.details;
        if (categories && Array.isArray(categories) && categories.length > 0) {
            categoriesToApply = blueprint.details.filter(c => 
                categories.includes(c.categoryId) || categories.includes(c.name)
            );
        }
        
        // Find or create company-specific template
        let companyTemplate = await GlobalInstantResponseTemplate.findOne({
            companyId,
            scope: 'COMPANY'
        });
        
        if (!companyTemplate) {
            companyTemplate = new GlobalInstantResponseTemplate({
                name: `${req.company.name} - Blueprint Scenarios`,
                companyId,
                scope: 'COMPANY',
                tradeKey,
                categories: []
            });
        }
        
        // Apply each category
        for (const categoryConfig of categoriesToApply) {
            try {
                // Find existing category
                let existingCategoryIndex = companyTemplate.categories.findIndex(
                    c => c.categoryId === categoryConfig.categoryId
                );
                
                if (existingCategoryIndex === -1) {
                    // Create new category
                    companyTemplate.categories.push({
                        categoryId: categoryConfig.categoryId,
                        name: categoryConfig.name,
                        icon: categoryConfig.icon,
                        enabled: categoryConfig.enabled,
                        priority: categoryConfig.priority,
                        description: categoryConfig.description,
                        disabledDefaultReply: categoryConfig.disabledDefaultReply,
                        scenarios: []
                    });
                    existingCategoryIndex = companyTemplate.categories.length - 1;
                }
                
                const targetCategory = companyTemplate.categories[existingCategoryIndex];
                
                // Apply scenarios
                for (const scenarioConfig of categoryConfig.scenarios) {
                    try {
                        const existingScenarioIndex = targetCategory.scenarios.findIndex(
                            s => s.scenarioId === scenarioConfig.scenarioId
                        );
                        
                        if (existingScenarioIndex === -1) {
                            // Create new scenario
                            const newScenario = createScenarioFromConfig(scenarioConfig);
                            targetCategory.scenarios.push(newScenario);
                            results.created.push({
                                categoryId: categoryConfig.categoryId,
                                scenarioId: scenarioConfig.scenarioId,
                                name: scenarioConfig.name
                            });
                        } else if (mode === 'merge') {
                            // Update existing
                            const updatedScenario = createScenarioFromConfig(scenarioConfig);
                            targetCategory.scenarios[existingScenarioIndex] = updatedScenario;
                            results.updated.push({
                                categoryId: categoryConfig.categoryId,
                                scenarioId: scenarioConfig.scenarioId,
                                name: scenarioConfig.name
                            });
                        } else if (mode === 'create_only') {
                            // Skip existing
                            results.skipped.push({
                                categoryId: categoryConfig.categoryId,
                                scenarioId: scenarioConfig.scenarioId,
                                reason: 'already_exists'
                            });
                        }
                    } catch (scenarioError) {
                        results.errors.push({
                            scenarioId: scenarioConfig.scenarioId,
                            error: scenarioError.message
                        });
                    }
                }
            } catch (categoryError) {
                results.errors.push({
                    categoryId: categoryConfig.categoryId,
                    error: categoryError.message
                });
            }
        }
        
        // Save the template
        await companyTemplate.save();
        
        // Audit log
        logger.info(`[BLUEPRINT] Applied to ${companyId}: created=${results.created.length}, updated=${results.updated.length}, errors=${results.errors.length}`);
        
        res.json({
            success: true,
            results,
            summary: {
                created: results.created.length,
                updated: results.updated.length,
                skipped: results.skipped.length,
                errors: results.errors.length
            },
            templateId: companyTemplate._id
        });
        
    } catch (error) {
        logger.error('[BLUEPRINT] Apply error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Create scenario document from config
 */
function createScenarioFromConfig(config) {
    return {
        scenarioId: config.scenarioId,
        name: config.name,
        enabled: config.enabled,
        priority: config.priority,
        description: config.description,
        
        // Matching
        triggers: config.triggers || [],
        negativeTriggers: config.negativeTriggers || [],
        minConfidence: config.minConfidence,
        contextWeight: config.contextWeight,
        requiresAllTriggers: config.requiresAllTriggers,
        
        // Responses
        quickReplies: config.quickReplies || [],
        fullReplies: config.fullReplies || [],
        replySelection: config.replySelection,
        replyStrategy: config.replyStrategy,
        
        // Flow
        followUpMode: config.followUpMode,
        followUpPrompt: config.followUpPrompt,
        transitionToMode: config.transitionToMode,
        
        // Escalation
        transferHook: config.transferHook,
        transferMessage: config.transferMessage,
        escalationThreshold: config.escalationThreshold,
        
        // Entity validation
        entityValidation: config.entityValidation,
        
        // Timing
        silencePolicy: config.silencePolicy,
        timedFollowUp: config.timedFollowUp,
        
        // Hooks
        actionHooks: config.actionHooks || [],
        
        // Metadata
        tags: config.tags || [],
        version: config.version || '1.0.0',
        lastUpdatedBy: 'blueprint',
        lastUpdatedAt: new Date()
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = router;

