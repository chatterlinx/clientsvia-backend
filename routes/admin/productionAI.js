// ============================================================================
// 📡 PRODUCTION AI - ADMIN API ROUTES
// ============================================================================
// PURPOSE: API endpoints for Production AI management
// FEATURES: Health checks, settings management, test connection
// DOCUMENTATION: /docs/PRODUCTION-AI-CORE-INTEGRATION.md
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticateJWT, adminOnly } = require('../../middleware/auth');
const { requireIdempotency } = require('../../middleware/validate');
const { captureAuditInfo } = require('../../middleware/audit');
const { configWriteRateLimit } = require('../../middleware/rateLimit');
const logger = require('../../utils/logger');
const Company = require('../../models/v2Company');
const ProductionAIHealthMonitor = require('../../services/ProductionAIHealthMonitor');
const TemplateGatekeeper = require('../../services/TemplateGatekeeper');
const IntelligentFallbackService = require('../../services/IntelligentFallbackService');
const DependencyHealthMonitor = require('../../services/DependencyHealthMonitor');

// ============================================================================
// 🟢 HEALTH CHECK ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/production-ai/health/openai
 * Test OpenAI connection (manual test button)
 */
router.get('/health/openai', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const depHealthMonitor = DependencyHealthMonitor.getInstance();
        const health = await depHealthMonitor.checkOpenAI();
        
        res.json({
            success: true,
            status: health.status,
            responseTime: health.responseTime,
            backendCheckTime: health.responseTime,
            model: health.model,
            error: health.error || null,
            timestamp: new Date()
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] OpenAI health check failed', {
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/production-ai/health/full
 * Run full system health check
 */
router.get('/health/full', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const healthReport = await ProductionAIHealthMonitor.runFullHealthCheck();
        
        res.json({
            success: true,
            health: healthReport,
            timestamp: new Date()
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Full health check failed', {
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// ⚙️ SETTINGS MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/production-ai/settings/:companyId
 * Get Production AI settings for a company
 */
router.get('/settings/:companyId', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const company = await Company.findById(req.params.companyId)
            .select('companyName aiAgentLogic');
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        res.json({
            success: true,
            settings: {
                templateGatekeeper: company.aiAgentLogic?.templateGatekeeper || {},
                fallbackResponses: company.aiAgentLogic?.fallbackResponses || {},
                learningSettings: company.aiAgentLogic?.learningSettings || {}
            }
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Failed to get settings', {
            companyId: req.params.companyId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PATCH /api/admin/production-ai/settings/:companyId/gatekeeper
 * Update template gatekeeper settings
 */
router.patch('/settings/:companyId/gatekeeper', 
    authenticateJWT, 
    adminOnly, 
    captureAuditInfo,
    requireIdempotency,
    configWriteRateLimit,
    async (req, res) => {
    try {
        const { enabled, tier1Threshold, tier2Threshold, enableLLMFallback, monthlyBudget } = req.body;
        
        const updateData = {};
        
        if (enabled !== undefined) {
            updateData['aiAgentLogic.templateGatekeeper.enabled'] = enabled;
        }
        if (tier1Threshold !== undefined) {
            updateData['aiAgentLogic.templateGatekeeper.tier1Threshold'] = tier1Threshold;
        }
        if (tier2Threshold !== undefined) {
            updateData['aiAgentLogic.templateGatekeeper.tier2Threshold'] = tier2Threshold;
        }
        if (enableLLMFallback !== undefined) {
            updateData['aiAgentLogic.templateGatekeeper.enableLLMFallback'] = enableLLMFallback;
        }
        if (monthlyBudget !== undefined) {
            updateData['aiAgentLogic.templateGatekeeper.monthlyBudget'] = monthlyBudget;
        }
        
        updateData['aiAgentLogic.templateGatekeeper.lastUpdated'] = new Date();
        
        const company = await Company.findByIdAndUpdate(
            req.params.companyId,
            { $set: updateData },
            { new: true }
        ).select('companyName aiAgentLogic');
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Clear Redis cache
        try {
            const redisClient = require('../../db').redisClient;
            if (redisClient && redisClient.del) {
                await redisClient.del(`company:${req.params.companyId}:production-ai`);
            }
        } catch (cacheError) {
            logger.warn('[PRODUCTION AI API] Failed to clear cache', { error: cacheError.message });
        }
        
        res.json({
            success: true,
            settings: company.aiAgentLogic.templateGatekeeper
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Failed to update gatekeeper settings', {
            companyId: req.params.companyId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * PATCH /api/admin/production-ai/settings/:companyId/fallback
 * Update fallback response settings
 */
router.patch('/settings/:companyId/fallback', 
    authenticateJWT, 
    adminOnly, 
    captureAuditInfo,
    requireIdempotency,
    configWriteRateLimit,
    async (req, res) => {
    try {
        const { toneProfile, clarificationNeeded, noMatchFound, technicalIssue, outOfScope, escalationOptions } = req.body;
        
        const updateData = {};
        
        if (toneProfile) {
            updateData['aiAgentLogic.fallbackResponses.toneProfile'] = toneProfile;
        }
        if (clarificationNeeded) {
            updateData['aiAgentLogic.fallbackResponses.clarificationNeeded'] = clarificationNeeded;
        }
        if (noMatchFound) {
            updateData['aiAgentLogic.fallbackResponses.noMatchFound'] = noMatchFound;
        }
        if (technicalIssue) {
            updateData['aiAgentLogic.fallbackResponses.technicalIssue'] = technicalIssue;
        }
        if (outOfScope) {
            updateData['aiAgentLogic.fallbackResponses.outOfScope'] = outOfScope;
        }
        if (escalationOptions) {
            updateData['aiAgentLogic.fallbackResponses.escalationOptions'] = escalationOptions;
        }
        
        updateData['aiAgentLogic.fallbackResponses.lastUpdated'] = new Date();
        
        const company = await Company.findByIdAndUpdate(
            req.params.companyId,
            { $set: updateData },
            { new: true }
        ).select('companyName aiAgentLogic');
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // Clear Redis cache
        try {
            const redisClient = require('../../db').redisClient;
            if (redisClient && redisClient.del) {
                await redisClient.del(`company:${req.params.companyId}:production-ai`);
            }
        } catch (cacheError) {
            logger.warn('[PRODUCTION AI API] Failed to clear cache', { error: cacheError.message });
        }
        
        res.json({
            success: true,
            settings: company.aiAgentLogic.fallbackResponses
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Failed to update fallback settings', {
            companyId: req.params.companyId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// 📊 METRICS ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/production-ai/metrics/:companyId
 * Get Production AI metrics for a company
 */
router.get('/metrics/:companyId', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const company = await Company.findById(req.params.companyId)
            .select('companyName aiAgentLogic');
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        const gatekeeperMetrics = company.aiAgentLogic?.templateGatekeeper?.metrics || {};
        
        // Calculate fallback rate
        const fallbackRate = await ProductionAIHealthMonitor.calculateFallbackRate(company._id);
        
        res.json({
            success: true,
            metrics: {
                gatekeeper: gatekeeperMetrics,
                fallbackRate,
                budget: {
                    limit: company.aiAgentLogic?.templateGatekeeper?.monthlyBudget || 0,
                    spent: company.aiAgentLogic?.templateGatekeeper?.currentSpend || 0,
                    remaining: (company.aiAgentLogic?.templateGatekeeper?.monthlyBudget || 0) - 
                               (company.aiAgentLogic?.templateGatekeeper?.currentSpend || 0)
                }
            }
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Failed to get metrics', {
            companyId: req.params.companyId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/production-ai/metrics/system
 * Get system-wide Production AI metrics
 */
router.get('/metrics/system', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const gatekeeperMetrics = TemplateGatekeeper.getMetrics();
        const fallbackMetrics = IntelligentFallbackService.getMetrics();
        
        res.json({
            success: true,
            metrics: {
                gatekeeper: gatekeeperMetrics,
                fallback: fallbackMetrics
            }
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Failed to get system metrics', {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

