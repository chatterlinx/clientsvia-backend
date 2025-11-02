/**
 * ============================================================================
 * V2 AI LIVE SCENARIOS ROUTES
 * ============================================================================
 * 
 * PURPOSE: Fetch all active scenarios from activated Global AI Brain templates
 * 
 * ENDPOINTS:
 * GET  /api/company/:companyId/live-scenarios
 *      → Returns merged list of all scenarios from active templates
 * 
 * DATA SOURCES:
 * - company.aiAgentSettings.templateReferences (active templates)
 * - GlobalInstantResponseTemplate (template data with scenarios)
 * 
 * ARCHITECTURE:
 * - Fetches all active template IDs from company
 * - Loads template data from Global AI Brain
 * - Merges all scenarios into single list
 * - Includes metadata: category, template name, usage stats
 * 
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const v2Company = require('../../models/v2Company');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const { authenticateJWT } = require('../../middleware/auth');

// 🔒 SECURITY: Require authentication for all routes
router.use(authenticateJWT);

/**
 * GET /api/company/:companyId/live-scenarios
 * 
 * Returns all scenarios from active templates
 */
router.get('/company/:companyId/live-scenarios', async (req, res) => {
    const { companyId } = req.params;
    
    logger.debug(`🎭 [LIVE SCENARIOS API] Fetching scenarios for company: ${companyId}`);
    
    try {
        // Get company with template references
        const company = await v2Company.findById(companyId)
            .select('aiAgentSettings.templateReferences')
            .lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const templateRefs = company.aiAgentSettings?.templateReferences || [];
        const activeTemplateIds = templateRefs
            .filter(ref => ref.enabled)
            .map(ref => ref.templateId);
        
        logger.info(`📊 [LIVE SCENARIOS API] Company has ${activeTemplateIds.length} active templates`);
        
        if (activeTemplateIds.length === 0) {
            return res.json({
                success: true,
                scenarios: [],
                categories: [],
                summary: {
                    totalScenarios: 0,
                    totalCategories: 0,
                    activeTemplates: 0
                }
            });
        }
        
        // Fetch all active templates from Global AI Brain
        const templates = await GlobalInstantResponseTemplate.find({
            _id: { $in: activeTemplateIds },
            status: 'published'
        }).select('name tradeName categories scenarios stats').lean();
        
        logger.info(`📚 [LIVE SCENARIOS API] Loaded ${templates.length} templates`);
        
        // Merge all scenarios from all templates
        // ARCHITECTURE FIX: Scenarios are nested INSIDE categories!
        const allScenarios = [];
        const categoriesSet = new Set();
        
        templates.forEach(template => {
            // Check if template has categories
            if (!template.categories || template.categories.length === 0) {
                logger.warn(`⚠️ [LIVE SCENARIOS API] Template "${template.name}" has no categories`);
                return;
            }
            
            logger.debug(`📂 [LIVE SCENARIOS API] Processing ${template.categories.length} categories from "${template.name}"`);
            
            // Iterate through categories, THEN scenarios
            template.categories.forEach(category => {
                // Add category name to set
                if (category.name) {
                    categoriesSet.add(category.name);
                }
                
                // Check if category has scenarios
                if (!category.scenarios || category.scenarios.length === 0) {
                    logger.debug(`  ⚠️ Category "${category.name}" has no scenarios`);
                    return;
                }
                
                logger.debug(`  ✅ Category "${category.name}" has ${category.scenarios.length} scenarios`);
                
                // Iterate through scenarios in this category
                category.scenarios.forEach(scenario => {
                    // Only include LIVE scenarios
                    if (scenario.status !== 'live' || !scenario.isActive) {
                        return;
                    }
                    
                    // Extract first trigger as preview
                    const trigger = scenario.triggers && scenario.triggers.length > 0 
                        ? scenario.triggers[0] 
                        : '';
                    
                    // Extract first full reply as preview
                    const reply = scenario.fullReplies && scenario.fullReplies.length > 0 
                        ? scenario.fullReplies[0] 
                        : '';
                    
                    // Build scenario object
                    allScenarios.push({
                        _id: scenario.scenarioId || scenario._id || `${template._id}-${category.id}-${allScenarios.length}`,
                        scenarioId: scenario.scenarioId,
                        name: scenario.name || trigger,
                        trigger: trigger,
                        triggers: scenario.triggers || [],
                        reply: reply,
                        fullReplies: scenario.fullReplies || [],
                        quickReplies: scenario.quickReplies || [],
                        category: category.name || 'General',
                        categoryId: category.id,
                        templateId: template._id,
                        templateName: template.name,
                        tradeName: template.tradeName,
                        priority: scenario.priority || 0,
                        avgConfidence: scenario.avgConfidence || 0,
                        usageCount: scenario.usageCount || 0,
                        status: scenario.status,
                        isActive: scenario.isActive
                    });
                });
            });
            
            logger.info(`✅ [LIVE SCENARIOS API] Processed template "${template.name}": ${allScenarios.length} total scenarios so far`);
        });
        
        const categories = Array.from(categoriesSet).sort();
        
        logger.info(`✅ [LIVE SCENARIOS API] Returning ${allScenarios.length} scenarios from ${categories.length} categories`);
        
        res.json({
            success: true,
            scenarios: allScenarios,
            categories,
            summary: {
                totalScenarios: allScenarios.length,
                totalCategories: categories.length,
                activeTemplates: templates.length
            }
        });
        
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

