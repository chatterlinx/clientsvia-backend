/**
 * @file routes/company/v2globalAIBrainSync.js
 * @description API routes for syncing company instant responses with Global AI Brain
 * 
 * ENDPOINTS:
 * - GET  /api/company/:companyId/sync-global-brain/compare - Compare with global
 * - POST /api/company/:companyId/sync-global-brain/import  - Import selected scenarios
 * 
 * @architecture Enterprise-grade, multi-tenant, production-ready
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticateJWT } = require('../../middleware/auth');
const { compareWithGlobal, importFromGlobal } = require('../../services/globalAIBrainSyncService');
const logger = require('../../utils/logger');

// Require authentication for all routes
router.use(authenticateJWT);

/**
 * GET /api/company/:companyId/sync-global-brain/compare
 * Compare company's instant responses with Global AI Brain
 * Returns: new, updated, and unchanged scenarios
 */
router.get('/compare', async (req, res) => {
    const { companyId } = req.params;
    const userId = req.user?._id || req.user?.id;
    const userEmail = req.user?.email || 'Unknown';
    
    logger.info(`🔄 [SYNC API] GET /api/company/${companyId}/sync-global-brain/compare by ${userEmail}`);
    
    try {
        const result = await compareWithGlobal(companyId);
        
        if (!result.success) {
            logger.warn(`🔄 [SYNC API] Comparison failed for company ${companyId}`, { message: result.message });
            return res.status(404).json(result);
        }
        
        logger.info(`✅ [SYNC API] Comparison successful for company ${companyId}`, { 
            stats: result.comparison.stats 
        });
        
        res.status(200).json(result);
    } catch (error) {
        logger.error(`❌ [SYNC API] Error comparing company ${companyId} with global`, { 
            error: error.message, 
            stack: error.stack 
        });
        res.status(500).json({
            success: false,
            message: `Error comparing with global: ${error.message}`
        });
    }
});

/**
 * POST /api/company/:companyId/sync-global-brain/import
 * Import selected scenarios from Global AI Brain to company
 * Body: { scenarioIds: ['scenario-id-1', 'scenario-id-2', ...] }
 */
router.post('/import', async (req, res) => {
    const { companyId } = req.params;
    const { scenarioIds } = req.body;
    const userId = req.user?._id || req.user?.id;
    const userEmail = req.user?.email || 'Unknown';
    
    logger.info(`📥 [SYNC API] POST /api/company/${companyId}/sync-global-brain/import by ${userEmail}`, {
        scenarioCount: scenarioIds?.length || 0
    });
    
    if (!scenarioIds || !Array.isArray(scenarioIds) || scenarioIds.length === 0) {
        logger.warn(`📥 [SYNC API] Invalid scenarioIds provided`, { scenarioIds });
        return res.status(400).json({
            success: false,
            message: 'scenarioIds array is required and must not be empty'
        });
    }
    
    try {
        const result = await importFromGlobal(companyId, scenarioIds);
        
        if (!result.success) {
            logger.warn(`📥 [SYNC API] Import failed for company ${companyId}`, { message: result.message });
            return res.status(400).json(result);
        }
        
        logger.info(`✅ [SYNC API] Import successful for company ${companyId}`, { 
            stats: result.stats 
        });
        
        res.status(200).json(result);
    } catch (error) {
        logger.error(`❌ [SYNC API] Error importing to company ${companyId}`, { 
            error: error.message, 
            stack: error.stack 
        });
        res.status(500).json({
            success: false,
            message: `Error importing from global: ${error.message}`
        });
    }
});

module.exports = router;
