/**
 * DEBUG ENDPOINT - Force reload scenarios and clear cache
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT } = require('../middleware/auth');
const ScenarioPoolService = require('../services/ScenarioPoolService');
const logger = require('../utils/logger');

// ============================================================================
// POST /api/debug/reload-scenarios/:companyId
// Force reload scenarios and clear Redis cache
// ============================================================================
router.post('/reload-scenarios/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.info('[DEBUG] Force reloading scenarios', { companyId });
        
        // Clear Redis cache
        const redis = req.app.locals.redis;
        if (redis) {
            const cacheKey = `scenarioPool:${companyId}`;
            await redis.del(cacheKey);
            logger.info('[DEBUG] Redis cache cleared', { cacheKey });
        }
        
        // Force reload fresh from database
        const { scenarios, templatesUsed } = await ScenarioPoolService.getScenarioPoolForCompany(companyId);
        
        // Analyze what we got
        const statusBreakdown = {};
        const categoryBreakdown = {};
        
        scenarios.forEach(s => {
            // Status
            const status = s.status || 'undefined';
            statusBreakdown[status] = (statusBreakdown[status] || 0) + 1;
            
            // Category
            const cat = s.categoryName || 'Uncategorized';
            categoryBreakdown[cat] = (categoryBreakdown[cat] || 0) + 1;
        });
        
        // Sample first 3 scenarios
        const samples = scenarios.slice(0, 3).map(s => ({
            name: s.name,
            categoryName: s.categoryName,
            categoryId: s.categoryId,
            status: s.status,
            isActive: s.isActive
        }));
        
        res.json({
            success: true,
            companyId,
            totalScenarios: scenarios.length,
            templatesUsed: templatesUsed.length,
            statusBreakdown,
            categoryBreakdown,
            samples,
            message: 'Scenarios reloaded fresh from database'
        });
        
    } catch (error) {
        logger.error('[DEBUG] Reload scenarios failed:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;
