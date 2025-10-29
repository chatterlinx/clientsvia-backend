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
const SuggestionKnowledgeBase = require('../../models/knowledge/SuggestionKnowledgeBase');
const ProductionAICallLog = require('../../models/ProductionAICallLog');
const LLMSuggestionAnalyzer = require('../../services/LLMSuggestionAnalyzer');
const AdminNotificationService = require('../../services/AdminNotificationService');
const CacheHelper = require('../../utils/cacheHelper');

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

// ============================================================================
// 💡 SUGGESTIONS MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/production-ai/suggestions/stats
 * Get suggestion statistics (pending, applied, ignored)
 */
router.get('/suggestions/stats', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { templateId } = req.query;
        
        const stats = await SuggestionKnowledgeBase.getStats(templateId);
        
        res.json({
            success: true,
            stats
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Failed to get suggestion stats', {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/production-ai/suggestions/:templateId
 * List suggestions for a template (paginated)
 */
router.get('/suggestions/:templateId', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const { templateId } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        const suggestions = await SuggestionKnowledgeBase.find({
            templateId,
            status: 'pending'
        })
            .sort({ priority: -1, createdAt: -1 })
            .skip(skip)
            .limit(limit)
            .populate('companyId', 'companyName')
            .populate('templateId', 'name')
            .populate('categoryId', 'name')
            .populate('scenarioId', 'name')
            .lean()
            .exec();
        
        // Add brief descriptions
        const formatted = suggestions.map(s => ({
            ...s,
            briefDescription: SuggestionKnowledgeBase.schema.methods.getBriefDescription.call(s),
            impactSummary: SuggestionKnowledgeBase.schema.methods.getImpactSummary.call(s)
        }));
        
        const total = await SuggestionKnowledgeBase.countDocuments({
            templateId,
            status: 'pending'
        });
        
        res.json({
            success: true,
            suggestions: formatted,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            }
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Failed to list suggestions', {
            templateId: req.params.templateId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/admin/production-ai/suggestions/:id/details
 * Get full details for a single suggestion
 */
router.get('/suggestions/:id/details', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const suggestion = await SuggestionKnowledgeBase.findById(req.params.id)
            .populate('companyId', 'companyName')
            .populate('templateId', 'name')
            .populate('categoryId', 'name')
            .populate('scenarioId', 'name')
            .populate('callLogId')
            .populate('appliedBy', 'name email')
            .populate('ignoredBy', 'name email')
            .lean()
            .exec();
        
        if (!suggestion) {
            return res.status(404).json({
                success: false,
                error: 'Suggestion not found'
            });
        }
        
        // Find related suggestions
        const related = await SuggestionKnowledgeBase.findRelated(req.params.id, 3);
        
        // Get ROI calculations
        const roi = {
            setupTime: 5, // 5 minutes
            monthlySavings: suggestion.impact.estimatedMonthlySavings || 0,
            annualSavings: suggestion.impact.estimatedAnnualSavings || 0,
            paybackPeriod: 'Immediate',
            performanceGain: suggestion.impact.performanceGain || 0
        };
        
        res.json({
            success: true,
            suggestion: {
                ...suggestion,
                briefDescription: SuggestionKnowledgeBase.schema.methods.getBriefDescription.call(suggestion),
                impactSummary: SuggestionKnowledgeBase.schema.methods.getImpactSummary.call(suggestion)
            },
            relatedSuggestions: related,
            roi
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Failed to get suggestion details', {
            suggestionId: req.params.id,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * POST /api/admin/production-ai/suggestions/:id/apply
 * Apply a suggestion (update template/category/scenario)
 */
router.post('/suggestions/:id/apply', 
    authenticateJWT, 
    adminOnly, 
    captureAuditInfo,
    requireIdempotency,
    configWriteRateLimit,
    async (req, res) => {
    try {
        const { id } = req.params;
        const { type } = req.body;
        
        const suggestion = await SuggestionKnowledgeBase.findById(id);
        
        if (!suggestion) {
            return res.status(404).json({
                success: false,
                error: 'Suggestion not found'
            });
        }
        
        if (suggestion.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: `Suggestion already ${suggestion.status}`
            });
        }
        
        let result;
        
        // Apply based on type
        switch (suggestion.type) {
            case 'filler-words':
                result = await SuggestionKnowledgeBase.applyFillerWordsSuggestion(id, req.user._id);
                break;
            
            case 'synonym':
                result = await SuggestionKnowledgeBase.applySynonymSuggestion(id, req.user._id);
                break;
            
            case 'keywords':
                result = await SuggestionKnowledgeBase.applyKeywordsSuggestion(id, req.user._id);
                break;
            
            case 'negative-keywords':
                result = await SuggestionKnowledgeBase.applyNegativeKeywordsSuggestion(id, req.user._id);
                break;
            
            case 'missing-scenario':
                result = await SuggestionKnowledgeBase.applyMissingScenarioSuggestion(id, req.user._id);
                break;
            
            default:
                return res.status(400).json({
                    success: false,
                    error: 'Invalid suggestion type'
                });
        }
        
        // Clear Redis cache for affected template
        await CacheHelper.clearTemplateCache(suggestion.templateId.toString());
        
        // Send notification
        await AdminNotificationService.sendNotification({
            code: 'PRODUCTION_AI_SUGGESTION_APPLIED',
            severity: 'INFO',
            message: `Suggestion applied: ${suggestion.type} for template`,
            details: {
                suggestionId: id,
                templateId: suggestion.templateId,
                appliedBy: req.user.email,
                changes: result.updated
            },
            source: 'ProductionAI',
            actionLink: `/admin-global-instant-responses.html#production-ai`
        });
        
        logger.info('[PRODUCTION AI API] Suggestion applied successfully', {
            suggestionId: id,
            type: suggestion.type,
            appliedBy: req.user.email
        });
        
        res.json({
            success: true,
            message: 'Suggestion applied successfully',
            updated: result.updated || result
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Failed to apply suggestion', {
            suggestionId: req.params.id,
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
 * POST /api/admin/production-ai/suggestions/:id/ignore
 * Ignore a suggestion
 */
router.post('/suggestions/:id/ignore', 
    authenticateJWT, 
    adminOnly, 
    captureAuditInfo,
    async (req, res) => {
    try {
        const { id } = req.params;
        
        const suggestion = await SuggestionKnowledgeBase.findById(id);
        
        if (!suggestion) {
            return res.status(404).json({
                success: false,
                error: 'Suggestion not found'
            });
        }
        
        if (suggestion.status !== 'pending') {
            return res.status(400).json({
                success: false,
                error: `Suggestion already ${suggestion.status}`
            });
        }
        
        await suggestion.markIgnored(req.user._id);
        
        logger.info('[PRODUCTION AI API] Suggestion ignored', {
            suggestionId: id,
            ignoredBy: req.user.email
        });
        
        res.json({
            success: true,
            message: 'Suggestion ignored'
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Failed to ignore suggestion', {
            suggestionId: req.params.id,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// 📞 CALL LOGS ENDPOINTS
// ============================================================================

/**
 * POST /api/admin/production-ai/call-logs
 * Store a production call log (called by v2twilio.js)
 */
router.post('/call-logs', authenticateJWT, async (req, res) => {
    try {
        const callLog = await ProductionAICallLog.create(req.body);
        
        logger.info('[PRODUCTION AI API] Call log stored', {
            callId: callLog.callId,
            tierUsed: callLog.tierUsed,
            isTest: callLog.isTest
        });
        
        res.json({
            success: true,
            callLogId: callLog._id
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Failed to store call log', {
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
 * POST /api/admin/production-ai/analyze-now/:callLogId
 * Trigger immediate analysis of a call log (from Test Pilot)
 */
router.post('/analyze-now/:callLogId', authenticateJWT, adminOnly, async (req, res) => {
    try {
        const callLog = await ProductionAICallLog.findById(req.params.callLogId);
        
        if (!callLog) {
            return res.status(404).json({
                success: false,
                error: 'Call log not found'
            });
        }
        
        if (callLog.analyzed) {
            return res.status(400).json({
                success: false,
                error: 'Call already analyzed'
            });
        }
        
        // Analyze immediately
        const suggestions = await LLMSuggestionAnalyzer.analyzeCall(callLog);
        
        logger.info('[PRODUCTION AI API] Call analyzed immediately', {
            callLogId: req.params.callLogId,
            suggestionsCreated: suggestions.length
        });
        
        res.json({
            success: true,
            suggestionsCreated: suggestions.length,
            suggestionIds: suggestions.map(s => s._id)
        });
        
    } catch (error) {
        logger.error('[PRODUCTION AI API] Failed to analyze call', {
            callLogId: req.params.callLogId,
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

