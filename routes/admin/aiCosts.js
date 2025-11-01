/**
 * ============================================================================
 * AI COST TRACKING API ENDPOINTS
 * ============================================================================
 * Provides cost data, budget monitoring, and optimization insights
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const OpenAICostSync = require('../../services/OpenAICostSync');
const logger = require('../../utils/logger');

// Admin-only middleware
const adminOnly = requireRole('admin');

/**
 * GET /api/admin/ai-costs/current-month
 * Get current month costs across all templates
 */
router.get('/current-month', authenticateJWT, adminOnly, async (req, res) => {
    try {
        logger.info('📊 [AI COSTS API] Fetching current month costs');
        
        const costs = await OpenAICostSync.getCurrentMonthCosts();
        
        res.json({
            success: true,
            data: costs
        });
        
    } catch (error) {
        logger.error('❌ [AI COSTS API] Error fetching current month costs:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch cost data',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/ai-costs/template/:templateId
 * Get costs and budget status for a specific template
 */
router.get('/template/:templateId', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { templateId } = req.params;
        
        logger.info(`📊 [AI COSTS API] Fetching costs for template ${templateId}`);
        
        const costs = await OpenAICostSync.getTemplateCosts(templateId);
        
        res.json({
            success: true,
            data: costs
        });
        
    } catch (error) {
        logger.error(`❌ [AI COSTS API] Error fetching template costs:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch template costs',
            message: error.message
        });
    }
});

/**
 * GET /api/admin/ai-costs/recommendations/:templateId
 * Get optimization recommendations for a template
 */
router.get('/recommendations/:templateId', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { templateId } = req.params;
        
        logger.info(`💡 [AI COSTS API] Generating recommendations for template ${templateId}`);
        
        const recommendations = await OpenAICostSync.generateOptimizationRecommendations(templateId);
        
        res.json({
            success: true,
            data: recommendations
        });
        
    } catch (error) {
        logger.error(`❌ [AI COSTS API] Error generating recommendations:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate recommendations',
            message: error.message
        });
    }
});

/**
 * POST /api/admin/ai-costs/check-budget/:templateId
 * Manually trigger budget check and send alerts if needed
 */
router.post('/check-budget/:templateId', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { templateId } = req.params;
        
        logger.info(`🔔 [AI COSTS API] Checking budget for template ${templateId}`);
        
        await OpenAICostSync.checkBudgetAndAlert(templateId);
        
        res.json({
            success: true,
            message: 'Budget check complete'
        });
        
    } catch (error) {
        logger.error(`❌ [AI COSTS API] Error checking budget:`, error);
        res.status(500).json({
            success: false,
            error: 'Failed to check budget',
            message: error.message
        });
    }
});

module.exports = router;

