/**
 * ============================================================================
 * V2 AI LIVE SCENARIOS ROUTES
 * ============================================================================
 * 
 * PURPOSE: Fetch all active scenarios from activated Global AI Brain templates
 *          PRODUCTION ENDPOINT - Used by AI Agent to respond to live calls
 * 
 * ENDPOINTS:
 * GET  /api/company/:companyId/live-scenarios
 *      → Returns merged list of all scenarios from active templates
 * 
 * DATA SOURCES:
 * - company.aiAgentSettings.templateReferences (active templates by ID)
 * - GlobalInstantResponseTemplate (direct load from AI Brain - NO FILTERS)
 * 
 * ARCHITECTURE:
 * - Redis caching (5 min TTL) for production performance
 * - Direct template load (bypasses ScenarioPoolService filters)
 * - Same data source as AiCore Templates tab and Variables tab
 * - Matches template by ID (not name) for accuracy
 * - Flattens all scenarios from all categories
 * - Includes metadata: template name, template ID, category, replies
 * 
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const v2Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const { redisClient } = require('../../db');

// 🔒 SECURITY: Require authentication AND multi-tenant access control
router.use(authenticateJWT);
router.use(requireCompanyAccess);

/**
 * GET /api/company/:companyId/live-scenarios
 * 
 * Returns all scenarios from active templates
 * ARCHITECTURE: Redis caching (5 min TTL) + Mongoose queries
 */
router.get('/company/:companyId/live-scenarios', async (req, res) => {
    const { companyId } = req.params;
    const cacheKey = `live-scenarios:${companyId}`;
    const CACHE_TTL = 300; // 5 minutes
    
    logger.debug(`🎭 [LIVE SCENARIOS API] Fetching scenarios for company: ${companyId}`);
    
    try {
        // ============================================================================
        // STEP 1: CHECK REDIS CACHE (Mongoose + Redis Architecture)
        // ============================================================================
        const cacheStartTime = Date.now();
        
        try {
            const cachedData = await redisClient.get(cacheKey);
            if (cachedData) {
                const cacheHitTime = Date.now() - cacheStartTime;
                logger.info(`✅ [LIVE SCENARIOS CACHE] Cache HIT for company ${companyId} (${cacheHitTime}ms)`);
                const parsed = JSON.parse(cachedData);
                return res.json(parsed);
            }
        } catch (cacheError) {
            logger.warn(`⚠️ [LIVE SCENARIOS CACHE] Redis error (non-critical):`, cacheError.message);
            // Continue to MongoDB fallback
        }
        
        logger.debug(`⚪ [LIVE SCENARIOS CACHE] Cache MISS for company ${companyId}, loading directly from AI Brain...`);
        
        // ============================================================================
        // STEP 2: LOAD DIRECTLY FROM GLOBAL AI BRAIN (SOURCE OF TRUTH)
        // ============================================================================
        // Same architecture as Variables tab - bypass ScenarioPoolService filters
        // Read from: company.aiAgentSettings.templateReferences
        // Load from: GlobalInstantResponseTemplate (by template ID)
        // ============================================================================
        const dbStartTime = Date.now();
        
        // Load company with active template references AND scenario controls
        const company = await v2Company.findById(companyId)
            .select('aiAgentSettings.templateReferences aiAgentSettings.scenarioControls companyName')
            .lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeTemplateRefs = templateRefs.filter(ref => ref.enabled !== false);
        const scenarioControls = company.aiAgentSettings?.scenarioControls || [];
        
        logger.info(`🎭 [LIVE SCENARIOS] Found ${activeTemplateRefs.length} active template(s) for ${company.companyName}`);
        logger.info(`🎭 [LIVE SCENARIOS] Found ${scenarioControls.length} scenario control(s) (disabled scenarios)`);
        
        if (activeTemplateRefs.length === 0) {
            const emptyResult = {
                success: true,
                scenarios: [],
                categories: [],
                summary: {
                    totalScenarios: 0,
                    totalCategories: 0,
                    activeTemplates: 0,
                    totalEnabled: 0,
                    totalDisabled: 0
                },
                warning: 'No active templates configured'
            };
            
            // Cache empty result (shorter TTL - 1 minute)
            try {
                await redisClient.setEx(cacheKey, 60, JSON.stringify(emptyResult));
                logger.debug(`💾 [LIVE SCENARIOS CACHE] Cached empty result (60s TTL)`);
            } catch (cacheError) {
                logger.warn(`⚠️ [LIVE SCENARIOS CACHE] Failed to cache empty result:`, cacheError.message);
            }
            
            return res.json(emptyResult);
        }
        
        // Load templates directly from Global AI Brain
        const scenarios = [];
        const templatesUsed = [];
        
        for (const templateRef of activeTemplateRefs) {
            try {
                const template = await GlobalInstantResponseTemplate.findById(templateRef.templateId)
                    .select('name categories version')
                    .lean();
                
                if (!template) {
                    logger.warn(`⚠️ [LIVE SCENARIOS] Template ${templateRef.templateId} not found, skipping`);
                    continue;
                }
                
                logger.info(`📦 [LIVE SCENARIOS] Loading template: ${template.name} (ID: ${templateRef.templateId})`);
                
                // Count template stats BEFORE flattening
                const templateCategories = template.categories || [];
                const templateScenarios = templateCategories.flatMap(cat => cat.scenarios || []);
                const templateTriggersCount = templateScenarios.reduce((sum, s) => sum + (s.triggers?.length || 0), 0);
                
                // Initialize template metadata (will update disabled count after all scenarios are processed)
                const templateMeta = {
                    templateId: templateRef.templateId,
                    templateName: template.name,
                    version: template.version,
                    categoriesCount: templateCategories.length,
                    scenariosCount: templateScenarios.length,
                    triggersCount: templateTriggersCount,
                    disabledCount: 0  // Will calculate after scenarios are built
                };
                
                templatesUsed.push(templateMeta);
                
                // Flatten all scenarios from all categories
                if (template.categories && Array.isArray(template.categories)) {
                    for (const category of template.categories) {
                        if (category.scenarios && Array.isArray(category.scenarios)) {
                            for (const scenario of category.scenarios) {
                                // Defensive check: Skip scenarios without scenarioId
                                if (!scenario.scenarioId) {
                                    logger.warn(`⚠️ [LIVE SCENARIOS] Skipping scenario without scenarioId in category "${category.name || 'Unknown'}" of template "${template.name}"`);
                                    continue;
                                }
                                
                                // Check if this scenario is disabled via scenarioControls
                                const control = scenarioControls.find(c => 
                                    c.templateId === templateRef.templateId && 
                                    c.scenarioId === scenario.scenarioId
                                );
                                const isEnabled = control ? control.isEnabled : true; // Default to enabled if no control exists
                                
                                scenarios.push({
                                    scenarioId: scenario.scenarioId,  // ✅ Use scenarioId field (not _id)
                                    name: scenario.name || 'Unnamed Scenario',
                                    triggers: scenario.triggers || [],
                                    quickReplies: scenario.quickReplies || [],
                                    fullReplies: scenario.fullReplies || [],
                                    categoryName: category.name || 'General',
                                    categoryId: category.categoryId || category.name,  // Categories also don't have _id
                                    templateId: templateRef.templateId,
                                    templateName: template.name,
                                    priority: templateRef.priority || 1,
                                    avgConfidence: 0, // Can be populated from performance metrics later
                                    usageCount: 0, // Can be populated from call logs later
                                    status: isEnabled ? 'active' : 'disabled',
                                    isActive: isEnabled,
                                    isEnabledForCompany: isEnabled,  // ✅ Apply per-company control
                                    disabledAt: control?.disabledAt || null,
                                    disabledBy: control?.disabledBy || null,
                                    // ═══════════════════════════════════════════════════════════
                                    // SCOPE LOCK FIELDS (Multi-tenant protection)
                                    // ═══════════════════════════════════════════════════════════
                                    scope: scenario.scope || 'GLOBAL',  // GLOBAL = read-only in company context
                                    ownerCompanyId: scenario.ownerCompanyId?.toString() || null,
                                    isLocked: (scenario.scope || 'GLOBAL') === 'GLOBAL',  // GLOBAL is always locked
                                    isOverride: (scenario.scope || 'GLOBAL') === 'COMPANY',
                                    overridesGlobalScenarioId: scenario.overridesGlobalScenarioId || null
                                });
                            }
                        }
                    }
                }
                
            } catch (templateError) {
                logger.error(`❌ [LIVE SCENARIOS] Error loading template ${templateRef.templateId}:`, templateError);
                // Continue with other templates
            }
        }
        
        logger.info(`✅ [LIVE SCENARIOS] Loaded ${scenarios.length} scenarios from ${templatesUsed.length} templates`);
        
        if (scenarios.length === 0) {
            const emptyResult = {
                success: true,
                scenarios: [],
                categories: [],
                summary: {
                    totalScenarios: 0,
                    totalCategories: 0,
                    activeTemplates: templatesUsed.length,
                    totalEnabled: 0,
                    totalDisabled: 0
                },
                warning: 'No scenarios found in active templates'
            };
            
            // Cache empty result (shorter TTL - 1 minute)
            try {
                await redisClient.setEx(cacheKey, 60, JSON.stringify(emptyResult));
                logger.debug(`💾 [LIVE SCENARIOS CACHE] Cached empty result (60s TTL)`);
            } catch (cacheError) {
                logger.warn(`⚠️ [LIVE SCENARIOS CACHE] Failed to cache empty result:`, cacheError.message);
            }
            
            return res.json(emptyResult);
        }
        
        // Build category list
        const categoriesSet = new Set();
        scenarios.forEach(scenario => {
            if (scenario.categoryName) {
                categoriesSet.add(scenario.categoryName);
            }
        });
        const categories = Array.from(categoriesSet).sort();
        
        // Build frontend-friendly scenario objects
        const frontendScenarios = scenarios.map(scenario => {
            // Extract first trigger and reply as preview
            const trigger = scenario.triggers && scenario.triggers.length > 0 
                ? scenario.triggers[0] 
                : '';
            const reply = scenario.fullReplies && scenario.fullReplies.length > 0 
                ? scenario.fullReplies[0] 
                : '';
            
            return {
                _id: scenario.scenarioId,
                scenarioId: scenario.scenarioId,
                name: scenario.name || trigger,
                trigger: trigger,
                triggers: scenario.triggers,
                reply: reply,
                fullReplies: scenario.fullReplies,
                quickReplies: scenario.quickReplies,
                category: scenario.categoryName || 'General',
                categoryId: scenario.categoryId,
                templateId: scenario.templateId,
                templateName: scenario.templateName,
                priority: scenario.priority,
                avgConfidence: scenario.avgConfidence || 0,
                usageCount: scenario.usageCount || 0,
                status: scenario.status,
                isActive: scenario.isActive,
                
                // NEW: Per-company enable/disable state
                isEnabledForCompany: scenario.isEnabledForCompany,
                disabledAt: scenario.disabledAt || null,
                disabledBy: scenario.disabledBy || null
            };
        });
        
        // Calculate per-template disabled counts
        templatesUsed.forEach(template => {
            const templateScenarios = frontendScenarios.filter(s => s.templateId === template.templateId);
            template.disabledCount = templateScenarios.filter(s => !s.isEnabledForCompany).length;
            template.enabledCount = templateScenarios.filter(s => s.isEnabledForCompany).length;
        });
        
        // Calculate summary
        const enabledCount = frontendScenarios.filter(s => s.isEnabledForCompany).length;
        const disabledCount = frontendScenarios.length - enabledCount;
        
        const totalTime = Date.now() - dbStartTime;
        logger.info(`✅ [LIVE SCENARIOS API] Loaded ${frontendScenarios.length} scenarios (${enabledCount} enabled, ${disabledCount} disabled) from ${categories.length} categories, ${templatesUsed.length} templates (${totalTime}ms)`);
        
        const responseData = {
            success: true,
            scenarios: frontendScenarios,
            categories,
            summary: {
                totalScenarios: frontendScenarios.length,
                totalCategories: categories.length,
                activeTemplates: templatesUsed.length,
                totalEnabled: enabledCount,
                totalDisabled: disabledCount
            },
            templatesUsed, // Include template metadata for debugging
            cached: false,
            queryTimeMs: totalTime
        };
        
        // ============================================================================
        // STEP 3: CACHE THE RESULT IN REDIS (for next request)
        // ============================================================================
        try {
            await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(responseData));
            logger.info(`💾 [LIVE SCENARIOS CACHE] Cached ${allScenarios.length} scenarios for company ${companyId} (TTL: ${CACHE_TTL}s)`);
        } catch (cacheError) {
            logger.warn(`⚠️ [LIVE SCENARIOS CACHE] Failed to cache result:`, cacheError.message);
            // Non-fatal - continue with response
        }
        
        res.json(responseData);
        
    } catch (error) {
        logger.error('❌ [LIVE SCENARIOS API] Error fetching scenarios:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch live scenarios',
            message: error.message
        });
    }
});

module.exports = router;

