/**
 * ============================================================================
 * GLOBAL PRODUCTION INTELLIGENCE API - Platform-Wide Defaults
 * ============================================================================
 * 
 * PURPOSE:
 * Manage platform-wide default 3-tier intelligence settings that ALL companies
 * inherit from unless they switch to custom settings.
 * 
 * ARCHITECTURE:
 * - Settings stored in: AdminSettings.globalProductionIntelligence
 * - Companies have flag: company.aiAgentSettings.useGlobalIntelligence
 * - If true → use global settings (this API)
 * - If false → use company.aiAgentSettings.productionIntelligence
 * 
 * ENDPOINTS:
 * - GET    /api/admin/global-intelligence          - Load global settings
 * - PATCH  /api/admin/global-intelligence          - Save global settings
 * - GET    /api/admin/global-intelligence/stats    - Get usage statistics
 * 
 * ISOLATION: 100% separate from company-specific intelligence routes
 * CACHE: Clears cache for ALL companies using global when settings change
 * 
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger.js');
const router = express.Router();
const AdminSettings = require('../../models/AdminSettings');
const Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const { redisClient } = require('../../db');

// ============================================================================
// MIDDLEWARE: Admin Authentication Required
// ============================================================================
router.use(authenticateJWT);

/**
 * ============================================================================
 * HELPER: Clear Redis Cache for All Companies Using Global Settings
 * ============================================================================
 * CRITICAL: When global settings change, ALL companies using global must
 * have their cache cleared to pick up new settings immediately.
 * ============================================================================
 */
async function clearGlobalIntelligenceCache() {
    try {
        if (!redisClient || !redisClient.isOpen) {
            logger.warn('⚠️ [GLOBAL INTELLIGENCE] Redis client not available for cache clear');
            return { cleared: 0, message: 'Redis unavailable' };
        }

        // Find all companies using global intelligence
        const companies = await Company.find(
            { 'aiAgentSettings.useGlobalIntelligence': true },
            '_id'
        ).lean();

        if (companies.length === 0) {
            logger.info('🗑️ [GLOBAL INTELLIGENCE] No companies using global - no cache to clear');
            return { cleared: 0, message: 'No companies using global' };
        }

        // Clear cache for each company
        let cleared = 0;
        for (const company of companies) {
            const cacheKey = `company:${company._id}`;
            const result = await redisClient.del(cacheKey);
            if (result > 0) {
                cleared++;
                logger.debug(`✅ [GLOBAL INTELLIGENCE] Cleared cache: ${cacheKey}`);
            }
        }

        logger.info(`🗑️ [GLOBAL INTELLIGENCE] Cleared cache for ${cleared}/${companies.length} companies using global settings`);
        return { cleared, total: companies.length };

    } catch (error) {
        logger.error('❌ [GLOBAL INTELLIGENCE] Failed to clear cache:', error.message);
        // Non-fatal error - don't block the response
        return { cleared: 0, error: error.message };
    }
}

/**
 * ============================================================================
 * GET /api/admin/global-intelligence
 * Load current global production intelligence settings
 * ============================================================================
 */
router.get('/global-intelligence', async (req, res) => {
    try {
        logger.info('🌐 [GLOBAL INTELLIGENCE] GET request by:', req.user?.email || 'Unknown');

        // Get AdminSettings (singleton)
        const settings = await AdminSettings.getSettings();
        
        if (!settings || !settings.globalProductionIntelligence) {
            logger.warn('⚠️ [GLOBAL INTELLIGENCE] No global settings found - returning defaults');
            return res.json({
                success: true,
                intelligence: {
                    enabled: true,
                    thresholds: {
                        tier1: 0.80,
                        tier2: 0.60,
                        enableTier3: true
                    },
                    llmConfig: {
                        model: 'gpt-4o-mini',
                        maxCostPerCall: 0.10,
                        dailyBudget: null
                    },
                    smartWarmup: {
                        enabled: false,
                        confidenceThreshold: 0.75,
                        dailyBudget: 5.00,
                        enablePatternLearning: true,
                        minimumHitRate: 0.30,
                        alwaysWarmupCategories: [],
                        neverWarmupCategories: []
                    }
                },
                message: 'Returning default settings - save to persist'
            });
        }

        const intelligence = settings.globalProductionIntelligence;

        // Count companies using global intelligence (REAL production data)
        const companiesAffected = await Company.countDocuments({
            'aiAgentSettings.useGlobalIntelligence': { $ne: false } // Default is true
        });

        logger.info('✅ [GLOBAL INTELLIGENCE] Loaded successfully', {
            companiesAffected
        });
        
        res.json({
            success: true,
            intelligence: {
                enabled: intelligence.enabled,
                thresholds: intelligence.thresholds,
                llmConfig: intelligence.llmConfig,
                smartWarmup: intelligence.smartWarmup,
                lastUpdated: intelligence.lastUpdated,
                updatedBy: intelligence.updatedBy
            },
            companiesAffected // REAL count from database
        });

    } catch (error) {
        logger.error('❌ [GLOBAL INTELLIGENCE] Load failed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load global intelligence settings',
            error: error.message
        });
    }
});

/**
 * ============================================================================
 * PATCH /api/admin/global-intelligence
 * Save global production intelligence settings
 * ============================================================================
 * CRITICAL: Clears cache for ALL companies using global settings!
 * ============================================================================
 */
router.patch('/global-intelligence', async (req, res) => {
    try {
        const { intelligence } = req.body;
        
        logger.info('🌐 [GLOBAL INTELLIGENCE] PATCH request by:', req.user?.email || 'Unknown');
        logger.info('📤 [GLOBAL INTELLIGENCE] Updating settings:', JSON.stringify(intelligence, null, 2));

        if (!intelligence) {
            return res.status(400).json({
                success: false,
                message: 'intelligence object required in request body'
            });
        }

        // Get AdminSettings (singleton - creates if doesn't exist)
        const settings = await AdminSettings.getSettings();

        // Update global production intelligence
        settings.globalProductionIntelligence = {
            enabled: intelligence.enabled !== false,
            thresholds: {
                tier1: parseFloat(intelligence.thresholds?.tier1) || 0.80,
                tier2: parseFloat(intelligence.thresholds?.tier2) || 0.60,
                enableTier3: intelligence.thresholds?.enableTier3 !== false
            },
            llmConfig: {
                model: intelligence.llmConfig?.model || 'gpt-4o-mini',
                maxCostPerCall: parseFloat(intelligence.llmConfig?.maxCostPerCall) || 0.10,
                dailyBudget: intelligence.llmConfig?.dailyBudget 
                    ? parseFloat(intelligence.llmConfig.dailyBudget) 
                    : null
            },
            smartWarmup: {
                enabled: intelligence.smartWarmup?.enabled === true,
                confidenceThreshold: parseFloat(intelligence.smartWarmup?.confidenceThreshold) || 0.75,
                dailyBudget: parseFloat(intelligence.smartWarmup?.dailyBudget) || 5.00,
                enablePatternLearning: intelligence.smartWarmup?.enablePatternLearning !== false,
                minimumHitRate: parseFloat(intelligence.smartWarmup?.minimumHitRate) || 0.30,
                alwaysWarmupCategories: Array.isArray(intelligence.smartWarmup?.alwaysWarmupCategories)
                    ? intelligence.smartWarmup.alwaysWarmupCategories
                    : [],
                neverWarmupCategories: Array.isArray(intelligence.smartWarmup?.neverWarmupCategories)
                    ? intelligence.smartWarmup.neverWarmupCategories
                    : []
            },
            lastUpdated: new Date(),
            updatedBy: req.user?.email || 'Admin'
        };

        // Save to MongoDB
        await settings.save();

        logger.info('✅ [GLOBAL INTELLIGENCE] Settings saved to AdminSettings');

        // ⚠️ CRITICAL: Clear cache for ALL companies using global settings
        const cacheResult = await clearGlobalIntelligenceCache();
        
        logger.info(`🗑️ [GLOBAL INTELLIGENCE] Cache invalidation result:`, cacheResult);

        res.json({
            success: true,
            message: 'Global production intelligence settings saved successfully',
            cacheCleared: cacheResult,
            globalIntelligence: settings.globalProductionIntelligence
        });

    } catch (error) {
        logger.error('❌ [GLOBAL INTELLIGENCE] Save failed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to save global intelligence settings',
            error: error.message
        });
    }
});

/**
 * ============================================================================
 * GET /api/admin/global-intelligence/stats
 * Get statistics about global intelligence usage
 * ============================================================================
 * RETURNS:
 * - Total companies
 * - Companies using global settings
 * - Companies using custom settings
 * - Percentage breakdown
 * ============================================================================
 */
router.get('/global-intelligence/stats', async (req, res) => {
    try {
        logger.info('📊 [GLOBAL INTELLIGENCE] GET stats request by:', req.user?.email || 'Unknown');

        // Count total companies
        const totalCompanies = await Company.countDocuments();

        // Count companies using global
        const usingGlobal = await Company.countDocuments({
            'aiAgentSettings.useGlobalIntelligence': true
        });

        // Count companies using custom
        const usingCustom = await Company.countDocuments({
            'aiAgentSettings.useGlobalIntelligence': false
        });

        // Calculate percentages
        const percentGlobal = totalCompanies > 0 
            ? Math.round((usingGlobal / totalCompanies) * 100) 
            : 0;
        const percentCustom = totalCompanies > 0 
            ? Math.round((usingCustom / totalCompanies) * 100) 
            : 0;

        logger.info(`📊 [GLOBAL INTELLIGENCE] Stats: ${usingGlobal}/${totalCompanies} using global (${percentGlobal}%)`);

        res.json({
            success: true,
            stats: {
                total: totalCompanies,
                usingGlobal,
                usingCustom,
                percentGlobal,
                percentCustom
            }
        });

    } catch (error) {
        logger.error('❌ [GLOBAL INTELLIGENCE] Stats failed:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to load statistics',
            error: error.message
        });
    }
});

// ============================================================================
// EXPORT
// ============================================================================
module.exports = router;

