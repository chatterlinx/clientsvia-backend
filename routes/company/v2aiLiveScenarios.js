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
        const allScenarios = [];
        const categoriesSet = new Set();
        
        templates.forEach(template => {
            if (!template.scenarios || template.scenarios.length === 0) {
                return;
            }
            
            template.scenarios.forEach(scenario => {
                // Extract categories
                if (scenario.categories && scenario.categories.length > 0) {
                    scenario.categories.forEach(cat => categoriesSet.add(cat));
                }
                
                // Build scenario object
                allScenarios.push({
                    _id: scenario._id || `${template._id}-${allScenarios.length}`,
                    trigger: scenario.trigger || '',
                    reply: scenario.reply || '',
                    category: scenario.categories && scenario.categories.length > 0 
                        ? scenario.categories[0] 
                        : template.tradeName || 'General',
                    categories: scenario.categories || [],
                    templateId: template._id,
                    templateName: template.name,
                    tradeName: template.tradeName,
                    avgConfidence: scenario.avgConfidence || 0,
                    usageCount: scenario.usageCount || 0
                });
            });
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

