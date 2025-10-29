// ============================================================================
// 🌐 AI GATEWAY - ADMIN API ROUTES
// ============================================================================
// PURPOSE: Complete API endpoints for AI Gateway management
// FEATURES: Health checks, suggestion management, call logs, statistics
// INTEGRATIONS: All AI Gateway services, NotificationCenter, Redis cache
// DOCUMENTATION: /docs/ai-gateway/API-REFERENCE.md
// CREATED: 2025-10-29
// ============================================================================

const express = require('express');
const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const { strictLimiter } = require('../../middleware/rateLimit');
const logger = require('../../utils/logger');

// Middleware alias for consistency
const adminOnly = requireRole('admin');

// ============================================================================
// 📦 SERVICE & MODEL IMPORTS
// ============================================================================

const { 
    HealthMonitor, 
    LLMAnalyzer, 
    SuggestionApplier, 
    CallLogProcessor 
} = require('../../services/aiGateway');

const { AIGatewayCallLog, AIGatewaySuggestion } = require('../../models/aiGateway');
const AdminNotificationService = require('../../services/AdminNotificationService');
const CacheHelper = require('../../utils/cacheHelper');

// ============================================================================
// 🟢 HEALTH CHECK ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/ai-gateway/health/openai
 * Test OpenAI connection (manual button click from UI)
 * 
 * CHECKPOINT FLOW:
 * 1. Request received
 * 2. Call HealthMonitor.checkOpenAI()
 * 3. Return status, response time, error (if any)
 * 4. Send notification if unhealthy
 */
router.get('/health/openai', authenticateJWT, adminOnly, async (req, res) => {
    // ────────────────────────────────────────────────────────────────────────
    // CHECKPOINT 1: Request Received
    // ────────────────────────────────────────────────────────────────────────
    const requestId = `health-openai-${Date.now()}`;
    console.log(`🟢 [AI GATEWAY API] [${requestId}] CHECKPOINT 1: OpenAI health check requested by ${req.user.email}`);
    
    try {
        // ────────────────────────────────────────────────────────────────────
        // CHECKPOINT 2: Calling Health Monitor
        // ────────────────────────────────────────────────────────────────────
        console.log(`🔍 [AI GATEWAY API] [${requestId}] CHECKPOINT 2: Calling HealthMonitor.checkOpenAI()`);
        
        const health = await HealthMonitor.checkOpenAI();
        
        // ────────────────────────────────────────────────────────────────────
        // CHECKPOINT 3: Sending Response
        // ────────────────────────────────────────────────────────────────────
        console.log(`📤 [AI GATEWAY API] [${requestId}] CHECKPOINT 3: Sending response - Status: ${health.status}`);
        
        res.json({
            success: true,
            health: health,
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Health check complete`);
        
    } catch (error) {
        // ────────────────────────────────────────────────────────────────────
        // CHECKPOINT ERROR: Request Failed
        // ────────────────────────────────────────────────────────────────────
        console.error(`❌ [AI GATEWAY API] [${requestId}] CHECKPOINT ERROR: ${error.message}`);
        console.error(`❌ [AI GATEWAY API] [${requestId}] Stack:`, error.stack);
        
        logger.error('[AI GATEWAY API] OpenAI health check failed', {
            error: error.message,
            stack: error.stack,
            requestId: requestId,
            userId: req.user._id
        });
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

/**
 * GET /api/admin/ai-gateway/health/full
 * Run full health check (all systems)
 */
router.get('/health/full', authenticateJWT, adminOnly, async (req, res) => {
    const requestId = `health-full-${Date.now()}`;
    console.log(`🏥 [AI GATEWAY API] [${requestId}] Full health check requested by ${req.user.email}`);
    
    try {
        const results = await HealthMonitor.checkAllSystems();
        
        res.json({
            success: true,
            health: results,
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Full health check complete`);
        
    } catch (error) {
        console.error(`❌ [AI GATEWAY API] [${requestId}] Full health check failed:`, error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

// ============================================================================
// 💡 SUGGESTION MANAGEMENT ENDPOINTS
// ============================================================================

/**
 * GET /api/admin/ai-gateway/suggestions/stats
 * Get suggestion statistics (pending, applied, ignored counts)
 */
router.get('/suggestions/stats', authenticateJWT, adminOnly, async (req, res) => {
    const requestId = `stats-${Date.now()}`;
    console.log(`📊 [AI GATEWAY API] [${requestId}] Suggestion stats requested by ${req.user.email}`);
    
    try {
        const { templateId } = req.query;
        
        const stats = await AIGatewaySuggestion.getStats(templateId || null);
        
        res.json({
            success: true,
            stats: stats,
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Stats: ${stats.pending} pending, ${stats.applied} applied`);
        
    } catch (error) {
        console.error(`❌ [AI GATEWAY API] [${requestId}] Failed to get stats:`, error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

/**
 * GET /api/admin/ai-gateway/suggestions/:templateId
 * List suggestions for a template (paginated)
 */
router.get('/suggestions/:templateId', authenticateJWT, adminOnly, async (req, res) => {
    const requestId = `list-${Date.now()}`;
    const { templateId } = req.params;
    console.log(`📋 [AI GATEWAY API] [${requestId}] Listing suggestions for template ${templateId}`);
    
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 10;
        const skip = (page - 1) * limit;
        
        const suggestions = await AIGatewaySuggestion.find({
            templateId: templateId,
            status: 'pending'
        })
        .sort({ priority: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('templateId', 'name')
        .populate('categoryId', 'name')
        .populate('scenarioId', 'name')
        .lean()
        .exec();
        
        // Add computed fields
        const formattedSuggestions = suggestions.map(s => ({
            ...s,
            briefDescription: AIGatewaySuggestion.schema.methods.getBriefDescription.call(s),
            impactSummary: AIGatewaySuggestion.schema.methods.getImpactSummary.call(s)
        }));
        
        const total = await AIGatewaySuggestion.countDocuments({
            templateId: templateId,
            status: 'pending'
        });
        
        res.json({
            success: true,
            suggestions: formattedSuggestions,
            pagination: {
                page,
                limit,
                total,
                pages: Math.ceil(total / limit)
            },
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Returned ${formattedSuggestions.length} suggestions`);
        
    } catch (error) {
        console.error(`❌ [AI GATEWAY API] [${requestId}] Failed to list suggestions:`, error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

/**
 * GET /api/admin/ai-gateway/suggestions/:suggestionId/details
 * Get full details for a specific suggestion (for modal)
 */
router.get('/suggestions/:suggestionId/details', authenticateJWT, adminOnly, async (req, res) => {
    const requestId = `details-${Date.now()}`;
    const { suggestionId } = req.params;
    console.log(`🔍 [AI GATEWAY API] [${requestId}] Fetching details for suggestion ${suggestionId}`);
    
    try {
        const suggestion = await AIGatewaySuggestion.findById(suggestionId)
            .populate('templateId')
            .populate('categoryId')
            .populate('scenarioId')
            .populate('callLogId')
            .exec();
        
        if (!suggestion) {
            return res.status(404).json({
                success: false,
                error: 'Suggestion not found',
                requestId: requestId
            });
        }
        
        // Get related suggestions
        const related = await AIGatewaySuggestion.findRelated(suggestionId, 3);
        
        res.json({
            success: true,
            suggestion: suggestion,
            relatedSuggestions: related,
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Returned suggestion details with ${related.length} related`);
        
    } catch (error) {
        console.error(`❌ [AI GATEWAY API] [${requestId}] Failed to fetch details:`, error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

/**
 * POST /api/admin/ai-gateway/suggestions/:suggestionId/apply
 * Apply a suggestion to template/category/scenario
 */
router.post('/suggestions/:suggestionId/apply', 
    authenticateJWT, 
    adminOnly, 
    strictLimiter, 
    async (req, res) => {
    
    const requestId = `apply-${Date.now()}`;
    const { suggestionId } = req.params;
    console.log(`✅ [AI GATEWAY API] [${requestId}] Applying suggestion ${suggestionId} by ${req.user.email}`);
    
    try {
        const result = await SuggestionApplier.applySuggestion(suggestionId, req.user._id);
        
        res.json({
            success: true,
            result: result.result,
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Suggestion applied successfully`);
        
    } catch (error) {
        console.error(`❌ [AI GATEWAY API] [${requestId}] Failed to apply suggestion:`, error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

/**
 * POST /api/admin/ai-gateway/suggestions/:suggestionId/ignore
 * Mark a suggestion as ignored
 */
router.post('/suggestions/:suggestionId/ignore', 
    authenticateJWT, 
    adminOnly, 
    async (req, res) => {
    
    const requestId = `ignore-${Date.now()}`;
    const { suggestionId } = req.params;
    console.log(`⏭️ [AI GATEWAY API] [${requestId}] Ignoring suggestion ${suggestionId} by ${req.user.email}`);
    
    try {
        const suggestion = await AIGatewaySuggestion.findById(suggestionId);
        
        if (!suggestion) {
            return res.status(404).json({
                success: false,
                error: 'Suggestion not found',
                requestId: requestId
            });
        }
        
        await suggestion.markIgnored(req.user._id);
        
        res.json({
            success: true,
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Suggestion ignored`);
        
    } catch (error) {
        console.error(`❌ [AI GATEWAY API] [${requestId}] Failed to ignore suggestion:`, error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

/**
 * POST /api/admin/ai-gateway/suggestions/apply-batch
 * Apply multiple suggestions at once (high-confidence batch apply)
 */
router.post('/suggestions/apply-batch', 
    authenticateJWT, 
    adminOnly, 
    strictLimiter, 
    async (req, res) => {
    
    const requestId = `batch-${Date.now()}`;
    const { suggestionIds } = req.body;
    console.log(`🔄 [AI GATEWAY API] [${requestId}] Batch applying ${suggestionIds.length} suggestions by ${req.user.email}`);
    
    try {
        if (!suggestionIds || !Array.isArray(suggestionIds) || suggestionIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'suggestionIds array required',
                requestId: requestId
            });
        }
        
        const results = await SuggestionApplier.applyMultipleSuggestions(suggestionIds, req.user._id);
        
        res.json({
            success: true,
            results: results,
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Batch complete: ${results.successful} successful, ${results.failed} failed`);
        
    } catch (error) {
        console.error(`❌ [AI GATEWAY API] [${requestId}] Batch apply failed:`, error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

// ============================================================================
// 📞 CALL LOG ENDPOINTS
// ============================================================================

/**
 * POST /api/admin/ai-gateway/call-logs
 * Store a new call log (called by v2twilio.js after each call)
 */
router.post('/call-logs', 
    authenticateJWT, 
    adminOnly, 
    async (req, res) => {
    
    const requestId = `calllog-${Date.now()}`;
    console.log(`📞 [AI GATEWAY API] [${requestId}] Storing call log ${req.body.callId}`);
    
    try {
        const result = await CallLogProcessor.storeCallLog(req.body);
        
        res.json({
            success: true,
            callLogId: result.callLogId,
            queuedForAnalysis: result.queuedForAnalysis,
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Call log stored: ${result.callLogId}`);
        
    } catch (error) {
        console.error(`❌ [AI GATEWAY API] [${requestId}] Failed to store call log:`, error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

/**
 * POST /api/admin/ai-gateway/call-logs/:callLogId/analyze
 * Trigger immediate analysis (for test pilot "Generate Suggestion" button)
 */
router.post('/call-logs/:callLogId/analyze', 
    authenticateJWT, 
    adminOnly, 
    async (req, res) => {
    
    const requestId = `analyze-${Date.now()}`;
    const { callLogId } = req.params;
    console.log(`🔍 [AI GATEWAY API] [${requestId}] Triggering analysis for call log ${callLogId}`);
    
    try {
        const callLog = await AIGatewayCallLog.findById(callLogId);
        
        if (!callLog) {
            return res.status(404).json({
                success: false,
                error: 'Call log not found',
                requestId: requestId
            });
        }
        
        const suggestions = await LLMAnalyzer.analyzeCall(callLog);
        
        res.json({
            success: true,
            suggestionsCount: suggestions.length,
            suggestions: suggestions,
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Analysis complete: ${suggestions.length} suggestions generated`);
        
    } catch (error) {
        console.error(`❌ [AI GATEWAY API] [${requestId}] Analysis failed:`, error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

/**
 * GET /api/admin/ai-gateway/call-logs/stats/:templateId
 * Get call log statistics for a template
 */
router.get('/call-logs/stats/:templateId', authenticateJWT, adminOnly, async (req, res) => {
    const requestId = `stats-${Date.now()}`;
    const { templateId } = req.params;
    const days = parseInt(req.query.days) || 30;
    
    console.log(`📊 [AI GATEWAY API] [${requestId}] Fetching call log stats for template ${templateId} (last ${days} days)`);
    
    try {
        const stats = await CallLogProcessor.getStatistics(templateId, days);
        
        res.json({
            success: true,
            stats: stats,
            days: days,
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Stats fetched: ${stats.totalCalls} total calls`);
        
    } catch (error) {
        console.error(`❌ [AI GATEWAY API] [${requestId}] Failed to fetch stats:`, error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

// ============================================================================
// 🔧 MAINTENANCE ENDPOINTS
// ============================================================================

/**
 * POST /api/admin/ai-gateway/maintenance/analyze-pending
 * Manually trigger batch analysis of pending calls (admin tool)
 */
router.post('/maintenance/analyze-pending', 
    authenticateJWT, 
    adminOnly, 
    async (req, res) => {
    
    const requestId = `maintenance-${Date.now()}`;
    const limit = parseInt(req.body.limit) || 10;
    console.log(`🔧 [AI GATEWAY API] [${requestId}] Manual analysis triggered by ${req.user.email} (limit: ${limit})`);
    
    try {
        const results = await LLMAnalyzer.analyzePendingCalls(limit);
        
        res.json({
            success: true,
            results: results,
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Batch analysis complete`);
        
    } catch (error) {
        console.error(`❌ [AI GATEWAY API] [${requestId}] Batch analysis failed:`, error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

/**
 * POST /api/admin/ai-gateway/maintenance/cleanup
 * Manually trigger cleanup of old call logs
 */
router.post('/maintenance/cleanup', 
    authenticateJWT, 
    adminOnly, 
    async (req, res) => {
    
    const requestId = `cleanup-${Date.now()}`;
    const daysToKeep = parseInt(req.body.daysToKeep) || 90;
    console.log(`🧹 [AI GATEWAY API] [${requestId}] Manual cleanup triggered by ${req.user.email} (keep: ${daysToKeep} days)`);
    
    try {
        const result = await CallLogProcessor.cleanupOldLogs(daysToKeep);
        
        res.json({
            success: true,
            deletedCount: result.deletedCount,
            requestId: requestId
        });
        
        console.log(`✅ [AI GATEWAY API] [${requestId}] Cleanup complete: ${result.deletedCount} logs deleted`);
        
    } catch (error) {
        console.error(`❌ [AI GATEWAY API] [${requestId}] Cleanup failed:`, error.message);
        
        res.status(500).json({
            success: false,
            error: error.message,
            requestId: requestId
        });
    }
});

// ============================================================================
// 📦 EXPORT ROUTER
// ============================================================================

module.exports = router;

