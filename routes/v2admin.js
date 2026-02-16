/**
 * Admin Routes for System Management
 * Emergency endpoints for fixing production issues
 */

const express = require('express');
const logger = require('../utils/logger.js');

const router = express.Router();

// Import admin routes
const accountDeletionRoutes = require('./admin/accountDeletion');
const aiAgentMonitoringRoutes = require('./admin/aiAgentMonitoring');
const User = require('../models/v2User');
const Company = require('../models/v2Company');
const { authenticateJWT } = require('../middleware/auth');
const { getSharedRedisClient, isRedisConfigured } = require('../services/redisClientFactory');

/**
 * 🚨 EMERGENCY: Fix User-Company Association
 * Addresses critical issue where users have null companyId
 */
router.post('/fix-user-company/:userId/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { userId, companyId } = req.params;
        
        logger.security('🚨 EMERGENCY: Fixing user-company association');
        logger.security('🔍 Target user ID:', userId);
        logger.info('🔍 Target company ID:', companyId);
        
        // Find the user
        const user = await User.findById(userId);
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found',
                userId
            });
        }
        
        // Find the company
        const company = await Company.findById(companyId);
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found',
                companyId
            });
        }
        
        logger.info('✅ Found user:', {
            id: user._id,
            email: user.email,
            currentCompanyId: user.companyId
        });
        
        logger.info('✅ Found company:', {
            id: company._id,
            name: company.companyName
        });
        
        // Fix the association
        user.companyId = companyId;
        await user.save();
        
        // Verify the fix
        const verifyUser = await User.findById(userId).populate('companyId');
        
        const result = {
            success: true,
            message: 'User-company association fixed successfully',
            before: {
                userId,
                hadCompanyId: Boolean(user.companyId)
            },
            after: {
                userId: verifyUser._id,
                companyId: verifyUser.companyId?._id,
                companyName: verifyUser.companyId?.companyName,
                associationWorking: Boolean(verifyUser.companyId)
            }
        };
        
        logger.info('🎉 SUCCESS: User-company association fixed!', result);
        
        res.json(result);
        
    } catch (error) {
        logger.error('❌ EMERGENCY: Fix user-company association failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fix user-company association',
            details: error.message
        });
    }
});

/**
 * 🔍 DIAGNOSTIC: Check User-Company Association
 * Verify user-company relationships
 */
router.get('/check-user-company/:userId', authenticateJWT, async (req, res) => {
    try {
        const { userId } = req.params;
        
        const user = await User.findById(userId).populate('companyId');
        
        if (!user) {
            return res.status(404).json({
                success: false,
                error: 'User not found'
            });
        }
        
        const diagnosis = {
            success: true,
            user: {
                id: user._id,
                email: user.email,
                name: user.name,
                status: user.status
            },
            company: {
                id: user.companyId?._id || null,
                name: user.companyId?.companyName || null,
                populated: Boolean(user.companyId)
            },
            diagnosis: {
                hasCompanyId: Boolean(user.companyId),
                canAccessKnowledge: Boolean(user.companyId),
                needsFix: !user.companyId
            }
        };
        
        logger.info('🔍 User-company diagnosis:', diagnosis);
        
        res.json(diagnosis);
        
    } catch (error) {
        logger.error('❌ User-company check failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to check user-company association',
            details: error.message
        });
    }
});

/**
 * 🚨 EMERGENCY: Clear Company Cache
 * Clears Redis cache for a specific company to force reload of fresh data
 */
router.post('/clear-cache/:companyId', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        logger.security('🚨 EMERGENCY: Clearing company cache');
        logger.security('🔍 Target company ID:', companyId);
        
        if (!isRedisConfigured()) {
            return res.status(503).json({
                success: false,
                error: 'Redis not configured - REDIS_URL not set'
            });
        }
        
        // Use the SHARED client from factory - do NOT create new connections
        const client = await getSharedRedisClient();
        if (!client) {
            return res.status(503).json({
                success: false,
                error: 'Redis client not available'
            });
        }
        logger.debug('✅ Using shared Redis client');

        // Clear all possible cache keys for this company
        const keysToDelete = [
            `ai_config_${companyId}`,
            `company:${companyId}`,
            `company:${companyId}:personality`,
            `company:${companyId}:config`,
            `company:${companyId}:ai`,
            `priorities:${companyId}`,
            `knowledge:${companyId}`
        ];

        let deletedCount = 0;
        const results = [];
        
        for (const key of keysToDelete) {
            const result = await client.del(key);
            if (result) {deletedCount++;}
            results.push({ key, deleted: Boolean(result) });
            logger.debug(`🗑️ Cache key: ${key} (${result ? 'deleted' : 'not found'})`);
        }

        // Do NOT disconnect - this is a shared client
        logger.debug(`✅ Cache cleared: ${deletedCount} keys deleted`);

        res.json({
            success: true,
            companyId,
            deletedCount,
            results,
            message: `Cleared ${deletedCount} cache keys for company ${companyId}`
        });

    } catch (error) {
        logger.error('❌ Cache clear failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to clear company cache',
            details: error.message
        });
    }
});

// (Intentionally left blank – legacy endpoint permanently removed)

// Mount admin routes
router.use('/account-deletion', accountDeletionRoutes);
router.use('/ai-agent-monitoring', aiAgentMonitoringRoutes);

// 🧪 AI Test Console - Test agent without making real calls
const aiTestRoutes = require('./admin/aiTest');
router.use('/ai-test', aiTestRoutes);

// 🔥 NEW: Fix user-company association routes
const fixUserCompanyRoutes = require('./admin/fixUserCompany');
router.use('/', fixUserCompanyRoutes);

// 🧹 NEW: Platform Admin deduplication routes
const deduplicatePlatformAdminRoutes = require('./admin/deduplicatePlatformAdmin');
router.use('/', deduplicatePlatformAdminRoutes);

// 📊 NEW: Section Health Dashboard (V110 Stabilization)
// Tracks S1-S7 section status for the Front Desk AI agent
const sectionHealthRoutes = require('./admin/sectionHealth');
router.use('/section-health', sectionHealthRoutes);

// ═══════════════════════════════════════════════════════════════════════════
// TRUTH BUNDLE EXPORT - The single source of truth
// ═══════════════════════════════════════════════════════════════════════════
const TruthBundleExporter = require('../services/wiring/TruthBundleExporter');

/**
 * GET /api/admin/truth-bundle
 * Export the complete Truth Bundle JSON
 * 
 * Query params:
 * - companyId: Optional company ID for company-specific config
 * - download: If 'true', sets Content-Disposition header for file download
 */
router.get('/truth-bundle', authenticateJWT, async (req, res) => {
    try {
        const { companyId, download } = req.query;
        
        // Get company if ID provided
        let company = null;
        if (companyId) {
            company = await Company.findById(companyId);
        }
        
        // Generate the truth bundle
        const truthBundle = await TruthBundleExporter.generateTruthBundle({
            companyId: companyId || 'global',
            company,
            environment: process.env.NODE_ENV || 'development'
        });
        
        // Validate the bundle
        const validation = TruthBundleExporter.validateTruthBundle(truthBundle);
        
        // Add validation results to response
        truthBundle.meta.validationResult = validation;
        
        // Set download headers if requested
        if (download === 'true') {
            const filename = `truth-bundle-${companyId || 'global'}-${Date.now()}.json`;
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        }
        
        res.json(truthBundle);
        
    } catch (error) {
        logger.error('[TRUTH BUNDLE] Export failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to generate Truth Bundle',
            details: error.message
        });
    }
});

/**
 * GET /api/admin/truth-bundle/flow-tree
 * Export just the Flow Tree section (for UI visualization)
 */
router.get('/truth-bundle/flow-tree', authenticateJWT, async (req, res) => {
    try {
        const FlowTreeDefinition = require('../services/wiring/FlowTreeDefinition');
        
        const flowTree = FlowTreeDefinition.exportFlowTree();
        const runtimeBindings = FlowTreeDefinition.exportRuntimeBindings();
        
        res.json({
            flowTree,
            runtimeBindings,
            validation: {
                unreachableNodes: FlowTreeDefinition.findUnreachableNodes(),
                invalidEdges: FlowTreeDefinition.findInvalidEdges(),
                validMatchSources: FlowTreeDefinition.getValidMatchSources()
            }
        });
        
    } catch (error) {
        logger.error('[FLOW TREE] Export failed:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to export Flow Tree',
            details: error.message
        });
    }
});

module.exports = router;