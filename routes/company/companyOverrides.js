/**
 * ============================================================================
 * COMPANY OVERRIDES API ROUTES
 * ============================================================================
 * 
 * PURPOSE: CRUD operations for company-level overrides
 * 
 * ENDPOINTS:
 * 
 * SCENARIO OVERRIDES:
 * GET    /api/company/:companyId/overrides/scenarios
 * POST   /api/company/:companyId/overrides/scenarios/:scenarioId/disable
 * POST   /api/company/:companyId/overrides/scenarios/:scenarioId/enable
 * 
 * CATEGORY OVERRIDES:
 * GET    /api/company/:companyId/overrides/categories
 * POST   /api/company/:companyId/overrides/categories/:categoryId/disable
 * POST   /api/company/:companyId/overrides/categories/:categoryId/enable
 * 
 * COMPANY DEFAULTS:
 * GET    /api/company/:companyId/overrides/defaults
 * PUT    /api/company/:companyId/overrides/defaults
 * 
 * PLACEHOLDERS:
 * GET    /api/company/:companyId/placeholders
 * PUT    /api/company/:companyId/placeholders
 * POST   /api/company/:companyId/placeholders/:key
 * DELETE /api/company/:companyId/placeholders/:key
 * 
 * MULTI-TENANT: All operations scoped by companyId
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const logger = require('../../utils/logger.js');

// Models
const CompanyScenarioOverride = require('../../models/CompanyScenarioOverride');
const CompanyCategoryOverride = require('../../models/CompanyCategoryOverride');
const CompanyResponseDefaults = require('../../models/CompanyResponseDefaults');
const CompanyPlaceholders = require('../../models/CompanyPlaceholders');

// Middleware
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');

// Redis for cache invalidation
const { redisClient } = require('../../db');

// ═══════════════════════════════════════════════════════════════════════════════
// MIDDLEWARE
// ═══════════════════════════════════════════════════════════════════════════════
router.use(authenticateJWT);
router.use(requireCompanyAccess);

// Helper: Invalidate company caches
async function invalidateCaches(companyId) {
    try {
        await redisClient.del(`company:${companyId}`);
        await redisClient.del(`live-scenarios:${companyId}`);
        await redisClient.del(`scenario-pool:${companyId}`);
        await redisClient.del(`overrides:${companyId}`);
        await redisClient.del(`placeholders:${companyId}`);
        logger.debug(`🗑️ [OVERRIDES] Cache invalidated for company ${companyId}`);
    } catch (err) {
        logger.warn(`⚠️ [OVERRIDES] Cache invalidation failed: ${err.message}`);
    }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO OVERRIDES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/company/:companyId/overrides/scenarios
 * Get all scenario overrides for this company
 */
router.get('/overrides/scenarios', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const overrides = await CompanyScenarioOverride.find({ companyId }).lean();
        const summary = await CompanyScenarioOverride.getSummary(companyId);
        
        res.json({
            success: true,
            companyId,
            overrides,
            summary
        });
    } catch (error) {
        logger.error('❌ [OVERRIDES] Failed to get scenario overrides:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get scenario overrides',
            message: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/overrides/scenarios/:scenarioId/disable
 * Disable a scenario for this company with optional alternate reply
 * 
 * Body: {
 *   templateId: String (required),
 *   categoryId: String (required),
 *   quickReply: String (optional),
 *   fullReply: String (optional),
 *   fallbackPreference: "SCENARIO" | "CATEGORY" | "COMPANY" (default: "COMPANY"),
 *   notes: String (optional)
 * }
 */
router.post('/overrides/scenarios/:scenarioId/disable', async (req, res) => {
    const { companyId, scenarioId } = req.params;
    const { templateId, categoryId, quickReply, fullReply, fallbackPreference, notes } = req.body;
    
    try {
        if (!templateId || !categoryId) {
            return res.status(400).json({
                success: false,
                error: 'templateId and categoryId are required'
            });
        }
        
        const username = req.user?.email || req.user?.username || 'Unknown';
        
        const override = await CompanyScenarioOverride.disableScenario(
            companyId,
            templateId,
            categoryId,
            scenarioId,
            {
                quickReply,
                fullReply,
                fallbackPreference: fallbackPreference || 'COMPANY',
                disabledBy: username,
                notes
            }
        );
        
        await invalidateCaches(companyId);
        
        logger.info(`🚫 [OVERRIDES] Scenario disabled: ${scenarioId} for company ${companyId}`);
        
        res.json({
            success: true,
            message: 'Scenario disabled',
            override
        });
    } catch (error) {
        logger.error('❌ [OVERRIDES] Failed to disable scenario:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disable scenario',
            message: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/overrides/scenarios/:scenarioId/enable
 * Enable a scenario for this company
 */
router.post('/overrides/scenarios/:scenarioId/enable', async (req, res) => {
    const { companyId, scenarioId } = req.params;
    
    try {
        const override = await CompanyScenarioOverride.enableScenario(companyId, scenarioId);
        
        await invalidateCaches(companyId);
        
        logger.info(`✅ [OVERRIDES] Scenario enabled: ${scenarioId} for company ${companyId}`);
        
        res.json({
            success: true,
            message: 'Scenario enabled',
            override
        });
    } catch (error) {
        logger.error('❌ [OVERRIDES] Failed to enable scenario:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to enable scenario',
            message: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// CATEGORY OVERRIDES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/company/:companyId/overrides/categories
 * Get all category overrides for this company
 */
router.get('/overrides/categories', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const overrides = await CompanyCategoryOverride.find({ companyId }).lean();
        const summary = await CompanyCategoryOverride.getSummary(companyId);
        
        res.json({
            success: true,
            companyId,
            overrides,
            summary
        });
    } catch (error) {
        logger.error('❌ [OVERRIDES] Failed to get category overrides:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get category overrides',
            message: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/overrides/categories/:categoryId/disable
 * Disable a category for this company with optional default reply
 * 
 * Body: {
 *   templateId: String (required),
 *   categoryName: String (optional, for display),
 *   quickReply: String (optional),
 *   fullReply: String (optional),
 *   useCompanyDefault: Boolean (default: false),
 *   notes: String (optional)
 * }
 */
router.post('/overrides/categories/:categoryId/disable', async (req, res) => {
    const { companyId, categoryId } = req.params;
    const { templateId, categoryName, quickReply, fullReply, useCompanyDefault, notes } = req.body;
    
    try {
        if (!templateId) {
            return res.status(400).json({
                success: false,
                error: 'templateId is required'
            });
        }
        
        const username = req.user?.email || req.user?.username || 'Unknown';
        
        const override = await CompanyCategoryOverride.disableCategory(
            companyId,
            templateId,
            categoryId,
            {
                categoryName,
                quickReply,
                fullReply,
                useCompanyDefault: useCompanyDefault || false,
                disabledBy: username,
                notes
            }
        );
        
        await invalidateCaches(companyId);
        
        logger.info(`🚫 [OVERRIDES] Category disabled: ${categoryId} for company ${companyId}`);
        
        res.json({
            success: true,
            message: 'Category disabled',
            override
        });
    } catch (error) {
        logger.error('❌ [OVERRIDES] Failed to disable category:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to disable category',
            message: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/overrides/categories/:categoryId/enable
 * Enable a category for this company
 */
router.post('/overrides/categories/:categoryId/enable', async (req, res) => {
    const { companyId, categoryId } = req.params;
    
    try {
        const override = await CompanyCategoryOverride.enableCategory(companyId, categoryId);
        
        await invalidateCaches(companyId);
        
        logger.info(`✅ [OVERRIDES] Category enabled: ${categoryId} for company ${companyId}`);
        
        res.json({
            success: true,
            message: 'Category enabled',
            override
        });
    } catch (error) {
        logger.error('❌ [OVERRIDES] Failed to enable category:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to enable category',
            message: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// COMPANY RESPONSE DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/company/:companyId/overrides/defaults
 * Get company default responses
 */
router.get('/overrides/defaults', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const defaults = await CompanyResponseDefaults.getOrCreate(companyId);
        const status = await CompanyResponseDefaults.hasConfigured(companyId);
        
        res.json({
            success: true,
            companyId,
            defaults,
            configurationStatus: status
        });
    } catch (error) {
        logger.error('❌ [OVERRIDES] Failed to get defaults:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get company defaults',
            message: error.message
        });
    }
});

/**
 * PUT /api/company/:companyId/overrides/defaults
 * Update company default responses
 * 
 * Body: {
 *   notOfferedReply: { quickReply, fullReply },
 *   unknownIntentReply: { quickReply, fullReply },
 *   afterHoursReply: { quickReply, fullReply },
 *   strictDisabledBehavior: Boolean
 * }
 */
router.put('/overrides/defaults', async (req, res) => {
    const { companyId } = req.params;
    const updates = req.body;
    
    try {
        const username = req.user?.email || req.user?.username || 'Unknown';
        
        const defaults = await CompanyResponseDefaults.updateDefaults(companyId, updates, username);
        
        await invalidateCaches(companyId);
        
        logger.info(`📝 [OVERRIDES] Company defaults updated for ${companyId}`);
        
        res.json({
            success: true,
            message: 'Defaults updated',
            defaults
        });
    } catch (error) {
        logger.error('❌ [OVERRIDES] Failed to update defaults:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update company defaults',
            message: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PLACEHOLDERS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/company/:companyId/placeholders
 * Get all placeholders for this company
 */
router.get('/placeholders', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const doc = await CompanyPlaceholders.getOrCreate(companyId);
        const summary = await CompanyPlaceholders.getSummary(companyId);
        
        res.json({
            success: true,
            companyId,
            placeholders: doc.placeholders || [],
            summary
        });
    } catch (error) {
        logger.error('❌ [PLACEHOLDERS] Failed to get placeholders:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get placeholders',
            message: error.message
        });
    }
});

/**
 * PUT /api/company/:companyId/placeholders
 * Bulk update all placeholders (replaces entire array)
 * 
 * Body: {
 *   placeholders: [{ key, value, description? }]
 * }
 */
router.put('/placeholders', async (req, res) => {
    const { companyId } = req.params;
    const { placeholders } = req.body;
    
    try {
        if (!Array.isArray(placeholders)) {
            return res.status(400).json({
                success: false,
                error: 'placeholders must be an array'
            });
        }
        
        // Validate structure
        for (const p of placeholders) {
            if (!p.key || !p.value) {
                return res.status(400).json({
                    success: false,
                    error: 'Each placeholder must have key and value'
                });
            }
        }
        
        const username = req.user?.email || req.user?.username || 'Unknown';
        
        const doc = await CompanyPlaceholders.setAllPlaceholders(companyId, placeholders, username);
        
        await invalidateCaches(companyId);
        
        logger.info(`📝 [PLACEHOLDERS] Updated ${placeholders.length} placeholders for ${companyId}`);
        
        res.json({
            success: true,
            message: `Updated ${placeholders.length} placeholders`,
            placeholders: doc.placeholders
        });
    } catch (error) {
        logger.error('❌ [PLACEHOLDERS] Failed to update placeholders:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to update placeholders',
            message: error.message
        });
    }
});

/**
 * POST /api/company/:companyId/placeholders/:key
 * Set a single placeholder
 * 
 * Body: {
 *   value: String (required),
 *   description: String (optional)
 * }
 */
router.post('/placeholders/:key', async (req, res) => {
    const { companyId, key } = req.params;
    const { value, description } = req.body;
    
    try {
        if (!value) {
            return res.status(400).json({
                success: false,
                error: 'value is required'
            });
        }
        
        const username = req.user?.email || req.user?.username || 'Unknown';
        
        const doc = await CompanyPlaceholders.setPlaceholder(companyId, key, value, {
            description,
            updatedBy: username
        });
        
        await invalidateCaches(companyId);
        
        logger.info(`📝 [PLACEHOLDERS] Set placeholder ${key} for ${companyId}`);
        
        res.json({
            success: true,
            message: `Placeholder "${key}" set`,
            placeholder: { key: key.toLowerCase(), value, description }
        });
    } catch (error) {
        logger.error('❌ [PLACEHOLDERS] Failed to set placeholder:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to set placeholder',
            message: error.message
        });
    }
});

/**
 * DELETE /api/company/:companyId/placeholders/:key
 * Remove a placeholder
 */
router.delete('/placeholders/:key', async (req, res) => {
    const { companyId, key } = req.params;
    
    try {
        await CompanyPlaceholders.removePlaceholder(companyId, key);
        
        await invalidateCaches(companyId);
        
        logger.info(`🗑️ [PLACEHOLDERS] Removed placeholder ${key} for ${companyId}`);
        
        res.json({
            success: true,
            message: `Placeholder "${key}" removed`
        });
    } catch (error) {
        logger.error('❌ [PLACEHOLDERS] Failed to remove placeholder:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to remove placeholder',
            message: error.message
        });
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUMMARY ENDPOINT (for Flow Tree)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/company/:companyId/overrides/summary
 * Get complete override summary for Flow Tree snapshot
 */
router.get('/overrides/summary', async (req, res) => {
    const { companyId } = req.params;
    
    try {
        const [scenarioSummary, categorySummary, defaultsStatus, placeholdersSummary] = await Promise.all([
            CompanyScenarioOverride.getSummary(companyId),
            CompanyCategoryOverride.getSummary(companyId),
            CompanyResponseDefaults.hasConfigured(companyId),
            CompanyPlaceholders.getSummary(companyId)
        ]);
        
        res.json({
            success: true,
            companyId,
            scenarios: scenarioSummary,
            categories: categorySummary,
            companyDefaults: defaultsStatus,
            placeholders: placeholdersSummary,
            wiringStatus: {
                scenarioOverrides: true,
                categoryOverrides: true,
                placeholders: true,
                deterministicFallback: true
            }
        });
    } catch (error) {
        logger.error('❌ [OVERRIDES] Failed to get summary:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get override summary',
            message: error.message
        });
    }
});

module.exports = router;

