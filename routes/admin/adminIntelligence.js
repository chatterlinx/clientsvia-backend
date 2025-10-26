/**
 * ============================================================================
 * ADMIN INTELLIGENCE & LEARNING API ROUTES
 * ============================================================================
 * 
 * PURPOSE:
 * API endpoints for the 3-Tier Intelligence System, pattern learning, and
 * cost tracking. Powers the Intelligence Dashboard and Global Pattern Review.
 * 
 * ENDPOINTS:
 * - POST   /api/admin/intelligence/analyze        - Manual LLM analysis
 * - GET    /api/admin/intelligence/metrics/:id    - Intelligence metrics
 * - GET    /api/admin/intelligence/global-patterns- Global pattern queue
 * - POST   /api/admin/intelligence/global-patterns/:id/approve - Approve
 * - POST   /api/admin/intelligence/global-patterns/:id/reject  - Reject
 * 
 * SECURITY:
 * - All routes require JWT authentication
 * - All routes require 'admin' role
 * - All operations are logged
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');
const SuggestionKnowledgeBase = require('../../models/SuggestionKnowledgeBase');
const GlobalPattern = require('../../models/GlobalPattern');
const Tier3LLMFallback = require('../../services/Tier3LLMFallback');
const CostTrackingService = require('../../services/CostTrackingService');
const PatternSharingService = require('../../services/PatternSharingService');
const DependencyHealthMonitor = require('../../services/DependencyHealthMonitor');
const AdminNotificationService = require('../../services/AdminNotificationService');
const logger = require('../../utils/logger');

// Middleware
const adminOnly = requireRole('admin');

// Apply auth to all routes
router.use(authenticateJWT);
router.use(adminOnly);

// Log all requests
router.use((req, res, next) => {
    logger.info(`🎯 [ADMIN INTELLIGENCE] ${req.method} ${req.path}`, {
        user: req.user?.email || req.user?.username,
        ip: req.ip
    });
    next();
});

// ============================================================================
// POST /api/admin/intelligence/analyze
// Manual LLM Analysis for Testing
// ============================================================================
/**
 * Manually trigger LLM analysis on a test phrase
 * Body: { templateId, callerInput, context }
 */
router.post('/analyze', async (req, res) => {
    try {
        const { templateId, callerInput, context = {} } = req.body;
        
        if (!templateId || !callerInput) {
            return res.status(400).json({
                success: false,
                error: 'templateId and callerInput are required'
            });
        }
        
        // Get template
        const template = await GlobalInstantResponseTemplate.findById(templateId);
        if (!template) {
            return res.status(404).json({
                success: false,
                error: 'Template not found'
            });
        }
        
        // Prepare scenarios
        const availableScenarios = [];
        for (const category of template.categories) {
            for (const scenario of category.scenarios || []) {
                if (scenario.isActive && scenario.status === 'live') {
                    availableScenarios.push({
                        scenarioId: scenario.scenarioId,
                        name: scenario.name,
                        categoryName: category.name,
                        triggerPhrases: scenario.triggerPhrases || [],
                        intentKeywords: scenario.intentKeywords || []
                    });
                }
            }
        }
        
        // Call LLM
        const result = await Tier3LLMFallback.analyze({
            callerInput,
            template,
            availableScenarios,
            context
        });
        
        logger.info('✅ [MANUAL LLM ANALYSIS] Complete', {
            templateId,
            matched: result.matched,
            cost: result.cost.llmApiCost,
            patternsExtracted: result.patterns?.length || 0
        });
        
        res.json({
            success: true,
            analysis: {
                matched: result.matched,
                scenario: result.scenario,
                confidence: result.confidence,
                reasoning: result.reasoning,
                patterns: result.patterns,
                cost: result.cost,
                performance: result.performance
            },
            metadata: {
                templateId,
                templateName: template.name,
                callerInput,
                timestamp: new Date()
            }
        });
        
    } catch (error) {
        logger.error('❌ [MANUAL LLM ANALYSIS] Error', {
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
// GET /api/admin/intelligence/openai-health
// Test OpenAI Connection & Send Alert if Down
// ============================================================================
/**
 * Test OpenAI connectivity and send notification if it's down
 * Called from Global AI Brain UI "Test OpenAI" button
 */
router.get('/openai-health', async (req, res) => {
    try {
        logger.info('🏥 [OPENAI HEALTH] Testing OpenAI connection', {
            user: req.user?.email || req.user?.username
        });
        
        // Get OpenAI health status
        const healthCheck = await DependencyHealthMonitor.checkOpenAI();
        
        // Determine if we should send an alert
        const isDown = healthCheck.status === 'DOWN';
        const isNotConfigured = healthCheck.status === 'NOT_CONFIGURED';
        const isCritical = healthCheck.critical === true;
        
        // Send alert to Notification Center if down AND critical
        if (isDown && isCritical) {
            try {
                await AdminNotificationService.sendAlert({
                    code: 'DEPENDENCY_HEALTH_CRITICAL',
                    severity: 'critical',
                    title: '🚨 OpenAI (GPT-4) Connection Failed',
                    message: `OpenAI API is DOWN and 3-Tier Intelligence System is ENABLED.\n\n` +
                             `Error: ${healthCheck.message}\n\n` +
                             `Impact: ${healthCheck.impact}\n\n` +
                             `Action Required: ${healthCheck.action}\n\n` +
                             `The self-improvement cycle is broken. Tier 3 (LLM) cannot learn new patterns until OpenAI is restored.`,
                    details: {
                        service: 'OpenAI',
                        status: healthCheck.status,
                        error: healthCheck.error,
                        responseTime: healthCheck.responseTime,
                        featureFlag: 'ENABLE_3_TIER_INTELLIGENCE=true',
                        missingVars: healthCheck.missingVars,
                        testedBy: req.user?.username || req.user?.email,
                        testedAt: new Date().toISOString()
                    }
                });
                
                logger.warn('📢 [OPENAI HEALTH] Alert sent to Notification Center', {
                    status: 'DOWN',
                    critical: true
                });
            } catch (notifError) {
                logger.error('❌ [OPENAI HEALTH] Failed to send notification', {
                    error: notifError.message
                });
            }
        } else if (healthCheck.status === 'HEALTHY') {
            // OpenAI is healthy - log success
            logger.info('✅ [OPENAI HEALTH] OpenAI connection successful', {
                responseTime: `${healthCheck.responseTime}ms`,
                model: healthCheck.details?.model
            });
        } else if (isNotConfigured) {
            // 3-tier disabled - OpenAI not needed
            logger.info('ℹ️ [OPENAI HEALTH] OpenAI not configured (3-tier disabled)', {
                status: healthCheck.status
            });
        }
        
        // Return detailed status to frontend
        res.json({
            success: true,
            health: {
                status: healthCheck.status,
                critical: healthCheck.critical,
                message: healthCheck.message,
                responseTime: healthCheck.responseTime,
                details: healthCheck.details,
                note: healthCheck.note,
                impact: healthCheck.impact,
                action: healthCheck.action,
                error: healthCheck.error
            },
            alerts: {
                sent: isDown && isCritical,
                severity: isDown && isCritical ? 'critical' : 'none',
                message: isDown && isCritical 
                    ? 'Alert sent to Notification Center - OpenAI is down!'
                    : healthCheck.status === 'HEALTHY'
                    ? 'OpenAI is operational - no alerts needed'
                    : '3-Tier system disabled - OpenAI not required'
            },
            recommendations: {
                enable3Tier: !isNotConfigured && healthCheck.status === 'HEALTHY',
                disable3Tier: isDown && isCritical,
                addApiKey: healthCheck.missingVars?.includes('OPENAI_API_KEY'),
                checkBilling: healthCheck.error?.includes('401') || healthCheck.error?.includes('authentication')
            },
            timestamp: new Date()
        });
        
    } catch (error) {
        logger.error('❌ [OPENAI HEALTH] Health check failed', {
            error: error.message,
            stack: error.stack
        });
        
        res.status(500).json({
            success: false,
            error: error.message,
            message: 'Failed to check OpenAI health'
        });
    }
});

// ============================================================================
// GET /api/admin/intelligence/metrics/:templateId
// Get Intelligence Metrics for Template
// ============================================================================
/**
 * Get complete intelligence dashboard data
 * Query params: ?refresh=true to bypass cache
 */
router.get('/metrics/:templateId', async (req, res) => {
    try {
        const { templateId } = req.params;
        const { refresh } = req.query;
        
        const metrics = await CostTrackingService.getIntelligenceMetrics(templateId, {
            refresh: refresh === 'true'
        });
        
        res.json({
            success: true,
            metrics
        });
        
    } catch (error) {
        logger.error('❌ [INTELLIGENCE METRICS] Error', {
            templateId: req.params.templateId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// GET /api/admin/intelligence/global-patterns
// Get Global Pattern Review Queue
// ============================================================================
/**
 * Get all patterns awaiting global approval
 * Query params: ?status=global_pending&type=synonym
 */
router.get('/global-patterns', async (req, res) => {
    try {
        const { status = 'global_pending', type, minConfidence } = req.query;
        
        const query = {
            shareStatus: status
        };
        
        if (type) {
            query.type = type;
        }
        
        if (minConfidence) {
            query.confidence = { $gte: parseFloat(minConfidence) };
        }
        
        const suggestions = await SuggestionKnowledgeBase.find(query)
            .populate('templateId', 'name industryLabel')
            .sort({ 'qualityScore.overall': -1, createdAt: -1 })
            .limit(100);
        
        // Get counts by type
        const typeCounts = await SuggestionKnowledgeBase.aggregate([
            { $match: { shareStatus: 'global_pending' } },
            {
                $group: {
                    _id: '$type',
                    count: { $sum: 1 },
                    avgConfidence: { $avg: '$confidence' }
                }
            }
        ]);
        
        res.json({
            success: true,
            patterns: suggestions.map(s => ({
                _id: s._id,
                type: s.type,
                confidence: s.confidence,
                qualityScore: s.qualityScore?.overall || 0,
                universalityScore: s.qualityScore?.universalityScore || 0,
                
                // Pattern data
                technicalTerm: s.technicalTerm,
                colloquialTerm: s.colloquialTerm,
                fillerWord: s.fillerWord,
                keyword: s.keyword,
                
                // Origin
                originTemplate: {
                    id: s.templateId?._id,
                    name: s.templateId?.name,
                    industry: s.templateId?.industryLabel
                },
                
                // Submission
                submittedAt: s.globalSharingDetails?.submittedAt,
                submittedBy: s.globalSharingDetails?.submittedBy,
                
                // Context
                exampleCalls: s.exampleCalls || [],
                contextPhrases: s.contextPhrases || [],
                frequency: s.frequency,
                
                createdAt: s.createdAt
            })),
            summary: {
                total: suggestions.length,
                byType: typeCounts.reduce((acc, t) => {
                    acc[t._id] = {
                        count: t.count,
                        avgConfidence: t.avgConfidence.toFixed(2)
                    };
                    return acc;
                }, {})
            }
        });
        
    } catch (error) {
        logger.error('❌ [GLOBAL PATTERNS] Error fetching queue', {
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// ============================================================================
// POST /api/admin/intelligence/global-patterns/:suggestionId/approve
// Approve Global Pattern
// ============================================================================
/**
 * Approve a pattern for platform-wide sharing
 * Body: { notes }
 */
router.post('/global-patterns/:suggestionId/approve', async (req, res) => {
    try {
        const { suggestionId } = req.params;
        const { notes } = req.body;
        
        const suggestion = await SuggestionKnowledgeBase.findById(suggestionId);
        if (!suggestion) {
            return res.status(404).json({
                success: false,
                error: 'Suggestion not found'
            });
        }
        
        if (suggestion.shareStatus !== 'global_pending') {
            return res.status(400).json({
                success: false,
                error: `Pattern is not pending approval (status: ${suggestion.shareStatus})`
            });
        }
        
        // Create GlobalPattern
        const globalPattern = await GlobalPattern.create({
            patternId: `gp-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: suggestion.type,
            name: `Global ${suggestion.type}: ${suggestion.technicalTerm || suggestion.fillerWord || suggestion.keyword}`,
            description: notes || 'Admin-approved universal pattern',
            
            // Pattern data
            fillerWords: suggestion.type === 'filler' ? [suggestion.fillerWord] : [],
            synonymMapping: suggestion.type === 'synonym' ? {
                technicalTerm: suggestion.technicalTerm,
                colloquialTerms: [suggestion.colloquialTerm]
            } : undefined,
            keywords: (suggestion.type === 'keyword' || suggestion.type === 'negative_keyword') ? [suggestion.keyword] : [],
            
            // Quality metrics
            qualityMetrics: {
                confidence: suggestion.confidence,
                universality: suggestion.qualityScore?.universalityScore || 0.8,
                frequency: suggestion.frequency || 1,
                estimatedImpact: suggestion.estimatedImpact || 0,
                applicableTemplateCount: 0  // Will be updated as we apply
            },
            
            // Submission details
            submissionDetails: {
                suggestionId: suggestion._id,
                originTemplateId: suggestion.templateId,
                submittedBy: suggestion.globalSharingDetails?.submittedBy || req.user._id,
                submittedAt: suggestion.globalSharingDetails?.submittedAt || new Date(),
                submissionNotes: notes
            },
            
            // Approval details
            approvalDetails: {
                approvedBy: req.user._id,
                approvedAt: new Date(),
                approvalNotes: notes,
                evidenceCallIds: suggestion.exampleCalls?.map(c => c.callId) || []
            }
        });
        
        // Apply to all active templates
        const templates = await GlobalInstantResponseTemplate.find({
            isActive: true,
            _id: { $ne: suggestion.templateId }  // Exclude origin template (already has it)
        });
        
        let appliedCount = 0;
        const errors = [];
        
        for (const template of templates) {
            try {
                await globalPattern.applyToTemplate(
                    template._id,
                    template.name,
                    template.industryLabel,
                    `Admin Approval by ${req.user.username || req.user.email}`
                );
                appliedCount++;
            } catch (error) {
                errors.push({
                    templateId: template._id,
                    templateName: template.name,
                    error: error.message
                });
            }
        }
        
        // Update suggestion status
        suggestion.shareStatus = 'global_approved';
        suggestion.status = 'applied';
        suggestion.appliedAt = new Date();
        suggestion.appliedBy = req.user._id;
        suggestion.globalSharingDetails = suggestion.globalSharingDetails || {};
        suggestion.globalSharingDetails.reviewedAt = new Date();
        suggestion.globalSharingDetails.reviewedBy = req.user._id;
        suggestion.globalSharingDetails.reviewNotes = notes;
        
        await suggestion.save();
        
        logger.info('✅ [APPROVE GLOBAL PATTERN] Pattern approved and applied', {
            suggestionId,
            globalPatternId: globalPattern._id,
            appliedToTemplates: appliedCount,
            errors: errors.length
        });
        
        res.json({
            success: true,
            message: `Pattern approved and applied to ${appliedCount} template(s)`,
            globalPattern: {
                id: globalPattern._id,
                patternId: globalPattern.patternId,
                type: globalPattern.type,
                appliedCount,
                errors
            }
        });
        
    } catch (error) {
        logger.error('❌ [APPROVE GLOBAL PATTERN] Error', {
            suggestionId: req.params.suggestionId,
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
// POST /api/admin/intelligence/global-patterns/:suggestionId/reject
// Reject Global Pattern
// ============================================================================
/**
 * Reject a pattern for global sharing
 * Body: { reason }
 */
router.post('/global-patterns/:suggestionId/reject', async (req, res) => {
    try {
        const { suggestionId } = req.params;
        const { reason } = req.body;
        
        if (!reason) {
            return res.status(400).json({
                success: false,
                error: 'Rejection reason is required'
            });
        }
        
        const suggestion = await SuggestionKnowledgeBase.findById(suggestionId);
        if (!suggestion) {
            return res.status(404).json({
                success: false,
                error: 'Suggestion not found'
            });
        }
        
        if (suggestion.shareStatus !== 'global_pending') {
            return res.status(400).json({
                success: false,
                error: `Pattern is not pending approval (status: ${suggestion.shareStatus})`
            });
        }
        
        // Update suggestion status
        suggestion.shareStatus = 'global_rejected';
        suggestion.status = 'ignored';
        suggestion.ignoredAt = new Date();
        suggestion.ignoredBy = req.user._id;
        suggestion.ignoredReason = reason;
        suggestion.globalSharingDetails = suggestion.globalSharingDetails || {};
        suggestion.globalSharingDetails.reviewedAt = new Date();
        suggestion.globalSharingDetails.reviewedBy = req.user._id;
        suggestion.globalSharingDetails.reviewNotes = reason;
        suggestion.globalSharingDetails.rejectionReason = reason;
        
        await suggestion.save();
        
        logger.info('✅ [REJECT GLOBAL PATTERN] Pattern rejected', {
            suggestionId,
            reason,
            reviewedBy: req.user.username || req.user.email
        });
        
        res.json({
            success: true,
            message: 'Pattern rejected',
            reason
        });
        
    } catch (error) {
        logger.error('❌ [REJECT GLOBAL PATTERN] Error', {
            suggestionId: req.params.suggestionId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

module.exports = router;

