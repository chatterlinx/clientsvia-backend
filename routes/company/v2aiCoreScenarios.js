/**
 * ============================================================================
 * AICORE SCENARIOS CONTROL ROUTES
 * ============================================================================
 * 
 * PURPOSE: Per-company scenario enable/disable controls for AiCore UI
 * 
 * ENDPOINTS:
 * PATCH /api/aicore/:companyId/scenarios/:templateId/:scenarioId
 *       → Toggle scenario ON/OFF for this company
 * 
 * ARCHITECTURE:
 * - Scenarios are authored/edited in Global AI Brain (admin-only)
 * - AiCore is READ-ONLY for scenario content
 * - AiCore can only enable/disable scenarios per company
 * - Runtime respects these controls (disabled scenarios never match)
 * 
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const Company = require('../../models/v2Company');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');
const { redisClient } = require('../../db');

// 🔒 SECURITY: Require authentication AND multi-tenant access control
router.use(authenticateJWT);
router.use(requireCompanyAccess);

/**
 * ============================================================================
 * PATCH /api/aicore/:companyId/scenarios/:templateId/:scenarioId
 * Toggle scenario ON/OFF for this company
 * ============================================================================
 * 
 * Request Body:
 * {
 *   "isEnabled": true | false,
 *   "notes": "Optional reason" (optional)
 * }
 * 
 * Response:
 * {
 *   "success": true,
 *   "templateId": "...",
 *   "scenarioId": "...",
 *   "isEnabled": false,
 *   "updatedAt": "2025-11-03T..."
 * }
 */
router.patch('/aicore/:companyId/scenarios/:templateId/:scenarioId', async (req, res) => {
    const { companyId, templateId, scenarioId } = req.params;
    const { isEnabled, notes } = req.body;
    
    logger.info(`🎯 [AICORE SCENARIOS] Toggle request for company ${companyId}, template ${templateId}, scenario ${scenarioId}`);
    
    try {
        // ============================================
        // STEP 1: VALIDATE INPUT
        // ============================================
        if (typeof isEnabled !== 'boolean') {
            return res.status(400).json({
                success: false,
                error: 'isEnabled must be a boolean (true or false)'
            });
        }
        
        if (!templateId || !scenarioId) {
            return res.status(400).json({
                success: false,
                error: 'templateId and scenarioId are required'
            });
        }
        
        // ============================================
        // STEP 2: LOAD COMPANY
        // ============================================
        const company = await Company.findById(companyId);
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // ============================================
        // STEP 3: UPDATE SCENARIO CONTROLS
        // ============================================
        // Initialize aiAgentSettings.scenarioControls if not exists
        if (!company.aiAgentSettings) {
            company.aiAgentSettings = {};
        }
        if (!company.aiAgentSettings.scenarioControls) {
            company.aiAgentSettings.scenarioControls = [];
        }
        
        // Find existing control entry
        const existingIndex = company.aiAgentSettings.scenarioControls.findIndex(
            ctrl => ctrl.templateId === templateId && ctrl.scenarioId === scenarioId
        );
        
        const username = req.user?.email || req.user?.username || 'Unknown User';
        const timestamp = new Date();
        
        if (existingIndex !== -1) {
            // UPDATE existing entry
            company.aiAgentSettings.scenarioControls[existingIndex].isEnabled = isEnabled;
            company.aiAgentSettings.scenarioControls[existingIndex].disabledAt = !isEnabled ? timestamp : null;
            company.aiAgentSettings.scenarioControls[existingIndex].disabledBy = !isEnabled ? username : null;
            
            if (notes) {
                company.aiAgentSettings.scenarioControls[existingIndex].notes = notes;
            }
            
            logger.info(`✏️ [AICORE SCENARIOS] Updated existing control: ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
        } else {
            // CREATE new entry
            company.aiAgentSettings.scenarioControls.push({
                templateId,
                scenarioId,
                isEnabled,
                disabledAt: !isEnabled ? timestamp : null,
                disabledBy: !isEnabled ? username : null,
                notes: notes || null
            });
            
            logger.info(`➕ [AICORE SCENARIOS] Created new control: ${isEnabled ? 'ENABLED' : 'DISABLED'}`);
        }
        
        // Update lastUpdated timestamp
        company.aiAgentSettings.lastUpdated = timestamp;
        
        // ============================================
        // STEP 4: SAVE COMPANY
        // ============================================
        await company.save();
        
        logger.info(`✅ [AICORE SCENARIOS] Saved company ${companyId}`);
        
        // ============================================
        // STEP 5: INVALIDATE CACHES
        // ============================================
        // Clear live-scenarios cache so UI sees fresh data immediately
        try {
            await redisClient.del(`live-scenarios:${companyId}`);
            await redisClient.del(`scenario-pool:${companyId}`); // 🔧 PHASE 4: Clear scenario pool cache
            logger.debug(`🗑️ [AICORE SCENARIOS] Cleared cache: live-scenarios + scenario-pool for ${companyId}`);
        } catch (cacheError) {
            logger.warn(`⚠️ [AICORE SCENARIOS] Cache invalidation failed (non-critical):`, cacheError.message);
        }
        
        // ============================================
        // STEP 6: RETURN SUCCESS
        // ============================================
        res.json({
            success: true,
            templateId,
            scenarioId,
            isEnabled,
            updatedAt: timestamp.toISOString(),
            updatedBy: username
        });
        
    } catch (error) {
        logger.error('❌ [AICORE SCENARIOS] Toggle scenario failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to toggle scenario',
            message: error.message
        });
    }
});

/**
 * ============================================================================
 * GET /api/aicore/:companyId/scenarios/controls
 * Get all scenario controls for this company (for debugging)
 * ============================================================================
 */
router.get('/aicore/:companyId/scenarios/controls', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const company = await Company.findById(companyId)
            .select('aiAgentSettings.scenarioControls companyName')
            .lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const controls = company.aiAgentSettings?.scenarioControls || [];
        
        res.json({
            success: true,
            companyId,
            companyName: company.companyName,
            controls,
            totalControls: controls.length,
            disabledCount: controls.filter(c => !c.isEnabled).length
        });
        
    } catch (error) {
        logger.error('❌ [AICORE SCENARIOS] Get controls failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get scenario controls',
            message: error.message
        });
    }
});

module.exports = router;

