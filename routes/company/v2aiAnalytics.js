/**
 * ============================================================================
 * V2 AI ANALYTICS ROUTES
 * ============================================================================
 * 
 * PURPOSE: Real-time analytics dashboard for AI Agent performance
 * 
 * ENDPOINTS:
 * GET  /api/company/:companyId/analytics/overview
 *      → Hero metrics: Match Rate, Confidence, Speed, Total Calls
 * 
 * GET  /api/company/:companyId/analytics/intelligence
 *      → AI Intelligence: Scenario performance, confidence trends, knowledge gaps
 * 
 * GET  /api/company/:companyId/analytics/business
 *      → Business Intelligence: Call volume, top questions, conversion metrics
 * 
 * DATA SOURCES:
 * - v2AIAgentCallLog (call performance, confidence, timing)
 * - GlobalInstantResponseTemplate (scenario data)
 * - company.aiAgentSettings (active templates)
 * 
 * ARCHITECTURE:
 * - Real-time aggregation from MongoDB
 * - Efficient queries with proper indexing
 * - Returns actionable insights, not just numbers
 * 
 * ============================================================================
 */

const express = require('express');
const logger = require('../../utils/logger.js');

const router = express.Router();
const v2AIAgentCallLog = require('../../models/v2AIAgentCallLog');
const v2Company = require('../../models/v2Company');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');

// 🔒 SECURITY: Require authentication AND multi-tenant access control
router.use(authenticateJWT);
router.use(requireCompanyAccess);

/**
 * GET /api/company/:companyId/analytics/overview
 * 
 * Returns hero metrics for dashboard
 */
router.get('/company/:companyId/analytics/overview', async (req, res) => {
    const { companyId } = req.params;
    const { timeRange = '30d' } = req.query; // 7d, 30d, 90d
    
    logger.debug(`📊 [ANALYTICS API] Fetching overview for company: ${companyId}, range: ${timeRange}`);
    
    try {
        // Calculate date range
        const days = parseInt(timeRange) || 30;
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);
        
        logger.debug(`📊 [ANALYTICS API] Date range: ${startDate.toISOString()} to ${new Date().toISOString()}`);
        
        // Aggregate metrics from call logs
        const metrics = await v2AIAgentCallLog.aggregate([
            {
                $match: {
                    companyId,
                    createdAt: { $gte: startDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalCalls: { $sum: 1 },
                    avgConfidence: { $avg: '$matchDetails.confidence' },
                    avgResponseTime: { $avg: '$responseTime' },
                    successfulMatches: {
                        $sum: {
                            $cond: [
                                { $and: [
                                    { $gte: ['$matchDetails.confidence', 0.7] },
                                    { $ne: ['$usedFallback', true] }
                                ]},
                                1,
                                0
                            ]
                        }
                    },
                    fallbackCount: {
                        $sum: { $cond: ['$usedFallback', 1, 0] }
                    }
                }
            }
        ]);
        
        // Get previous period for comparison
        const prevStartDate = new Date(startDate);
        prevStartDate.setDate(prevStartDate.getDate() - days);
        
        const prevMetrics = await v2AIAgentCallLog.aggregate([
            {
                $match: {
                    companyId,
                    createdAt: { $gte: prevStartDate, $lt: startDate }
                }
            },
            {
                $group: {
                    _id: null,
                    totalCalls: { $sum: 1 },
                    avgConfidence: { $avg: '$matchDetails.confidence' },
                    avgResponseTime: { $avg: '$responseTime' },
                    successfulMatches: {
                        $sum: {
                            $cond: [
                                { $and: [
                                    { $gte: ['$matchDetails.confidence', 0.7] },
                                    { $ne: ['$usedFallback', true] }
                                ]},
                                1,
                                0
                            ]
                        }
                    }
                }
            }
        ]);
        
        const current = metrics[0] || {
            totalCalls: 0,
            avgConfidence: 0,
            avgResponseTime: 0,
            successfulMatches: 0,
            fallbackCount: 0
        };
        
        const previous = prevMetrics[0] || {
            totalCalls: 0,
            avgConfidence: 0,
            avgResponseTime: 0,
            successfulMatches: 0
        };
        
        // Calculate percentages and trends
        const matchRate = current.totalCalls > 0 
            ? (current.successfulMatches / current.totalCalls * 100)
            : 0;
        
        const prevMatchRate = previous.totalCalls > 0
            ? (previous.successfulMatches / previous.totalCalls * 100)
            : 0;
        
        const fallbackRate = current.totalCalls > 0
            ? (current.fallbackCount / current.totalCalls * 100)
            : 0;
        
        // Calculate trends
        const confidenceTrend = previous.avgConfidence > 0
            ? ((current.avgConfidence - previous.avgConfidence) / previous.avgConfidence * 100)
            : 0;
        
        const matchRateTrend = prevMatchRate > 0
            ? ((matchRate - prevMatchRate) / prevMatchRate * 100)
            : 0;
        
        const speedTrend = previous.avgResponseTime > 0
            ? ((current.avgResponseTime - previous.avgResponseTime) / previous.avgResponseTime * 100)
            : 0;
        
        const callsTrend = previous.totalCalls > 0
            ? ((current.totalCalls - previous.totalCalls) / previous.totalCalls * 100)
            : 0;
        
        logger.info(`✅ [ANALYTICS API] Overview calculated:`, {
            matchRate: matchRate.toFixed(1),
            confidence: (current.avgConfidence * 100).toFixed(1),
            speed: Math.round(current.avgResponseTime),
            calls: current.totalCalls
        });
        
        res.json({
            success: true,
            timeRange,
            overview: {
                matchRate: {
                    value: Math.round(matchRate),
                    trend: Math.round(matchRateTrend),
                    status: matchRate >= 90 ? 'excellent' : matchRate >= 75 ? 'good' : matchRate >= 60 ? 'acceptable' : 'needs_improvement'
                },
                confidence: {
                    value: Math.round(current.avgConfidence * 100),
                    trend: Math.round(confidenceTrend),
                    status: current.avgConfidence >= 0.85 ? 'excellent' : current.avgConfidence >= 0.70 ? 'good' : current.avgConfidence >= 0.60 ? 'acceptable' : 'needs_improvement'
                },
                speed: {
                    value: Math.round(current.avgResponseTime),
                    trend: Math.round(speedTrend * -1), // Negative is good for speed
                    status: current.avgResponseTime <= 25 ? 'excellent' : current.avgResponseTime <= 50 ? 'good' : current.avgResponseTime <= 100 ? 'acceptable' : 'needs_improvement'
                },
                totalCalls: {
                    value: current.totalCalls,
                    trend: Math.round(callsTrend),
                    status: 'info'
                },
                fallbackRate: {
                    value: Math.round(fallbackRate * 10) / 10,
                    count: current.fallbackCount,
                    status: fallbackRate <= 5 ? 'excellent' : fallbackRate <= 10 ? 'acceptable' : 'needs_improvement'
                }
            },
            calculatedAt: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('❌ [ANALYTICS API] Error fetching overview:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch analytics overview',
            message: error.message
        });
    }
});

/**
 * GET /api/company/:companyId/analytics/intelligence
 * 
 * Returns AI intelligence metrics (scenario performance, trends, gaps)
 */
router.get('/company/:companyId/analytics/intelligence', async (req, res) => {
    const { companyId } = req.params;
    const { limit = 10 } = req.query;
    
    logger.debug(`🧠 [ANALYTICS API] Fetching intelligence for company: ${companyId}`);
    
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        // Top scenarios by usage
        const topScenarios = await v2AIAgentCallLog.aggregate([
            {
                $match: {
                    companyId,
                    matchedScenario: { $ne: null },
                    createdAt: { $gte: thirtyDaysAgo }
                }
            },
            {
                $group: {
                    _id: '$matchedScenario',
                    count: { $sum: 1 },
                    avgConfidence: { $avg: '$matchDetails.confidence' },
                    category: { $first: '$matchDetails.category' }
                }
            },
            {
                $sort: { count: -1 }
            },
            {
                $limit: parseInt(limit)
            }
        ]);
        
        // Low confidence calls (knowledge gaps)
        const knowledgeGaps = await v2AIAgentCallLog.aggregate([
            {
                $match: {
                    companyId,
                    'matchDetails.confidence': { $lt: 0.7 },
                    createdAt: { $gte: thirtyDaysAgo }
                }
            },
            {
                $group: {
                    _id: '$caller.question',
                    count: { $sum: 1 },
                    avgConfidence: { $avg: '$matchDetails.confidence' },
                    lastOccurrence: { $max: '$createdAt' }
                }
            },
            {
                $sort: { count: -1 }
            },
            {
                $limit: 10
            }
        ]);
        
        logger.info(`✅ [ANALYTICS API] Intelligence calculated:`, {
            topScenarios: topScenarios.length,
            knowledgeGaps: knowledgeGaps.length
        });
        
        res.json({
            success: true,
            intelligence: {
                topScenarios: topScenarios.map(s => ({
                    scenario: s._id,
                    uses: s.count,
                    confidence: Math.round(s.avgConfidence * 100),
                    category: s.category,
                    status: s.avgConfidence >= 0.85 ? 'excellent' : s.avgConfidence >= 0.70 ? 'good' : 'needs_improvement'
                })),
                knowledgeGaps: knowledgeGaps.map(g => ({
                    question: g._id,
                    occurrences: g.count,
                    avgConfidence: Math.round(g.avgConfidence * 100),
                    lastOccurrence: g.lastOccurrence,
                    urgency: g.count >= 10 ? 'high' : g.count >= 5 ? 'medium' : 'low'
                }))
            },
            calculatedAt: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('❌ [ANALYTICS API] Error fetching intelligence:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch intelligence analytics',
            message: error.message
        });
    }
});

/**
 * GET /api/company/:companyId/analytics/business
 * 
 * Returns business intelligence metrics (call volume, patterns, insights)
 */
router.get('/company/:companyId/analytics/business', async (req, res) => {
    const { companyId } = req.params;
    
    logger.debug(`💼 [ANALYTICS API] Fetching business intelligence for company: ${companyId}`);
    
    try {
        const thirtyDaysAgo = new Date();
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
        
        // Call volume by day (last 30 days)
        const callVolume = await v2AIAgentCallLog.aggregate([
            {
                $match: {
                    companyId,
                    createdAt: { $gte: thirtyDaysAgo }
                }
            },
            {
                $group: {
                    _id: {
                        $dateToString: { format: '%Y-%m-%d', date: '$createdAt' }
                    },
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { _id: 1 }
            }
        ]);
        
        // Call volume by hour (to find peak hours)
        const callsByHour = await v2AIAgentCallLog.aggregate([
            {
                $match: {
                    companyId,
                    createdAt: { $gte: thirtyDaysAgo }
                }
            },
            {
                $group: {
                    _id: { $hour: '$createdAt' },
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { count: -1 }
            },
            {
                $limit: 3
            }
        ]);
        
        // Top question categories (if available)
        const topCategories = await v2AIAgentCallLog.aggregate([
            {
                $match: {
                    companyId,
                    'matchDetails.category': { $ne: null },
                    createdAt: { $gte: thirtyDaysAgo }
                }
            },
            {
                $group: {
                    _id: '$matchDetails.category',
                    count: { $sum: 1 }
                }
            },
            {
                $sort: { count: -1 }
            },
            {
                $limit: 5
            }
        ]);
        
        const totalCalls = callVolume.reduce((sum, day) => sum + day.count, 0);
        const avgCallsPerDay = totalCalls / 30;
        
        logger.info(`✅ [ANALYTICS API] Business intelligence calculated:`, {
            totalCalls,
            avgCallsPerDay: avgCallsPerDay.toFixed(1),
            days: callVolume.length
        });
        
        res.json({
            success: true,
            business: {
                callVolume: callVolume.map(day => ({
                    date: day._id,
                    calls: day.count
                })),
                peakHours: callsByHour.map(h => ({
                    hour: h._id,
                    calls: h.count
                })),
                topCategories: topCategories.map(c => ({
                    category: c._id,
                    count: c.count,
                    percentage: Math.round(c.count / totalCalls * 100)
                })),
                summary: {
                    totalCalls,
                    avgCallsPerDay: Math.round(avgCallsPerDay),
                    days: 30
                }
            },
            calculatedAt: new Date().toISOString()
        });
        
    } catch (error) {
        logger.error('❌ [ANALYTICS API] Error fetching business intelligence:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch business intelligence',
            message: error.message
        });
    }
});

/**
 * ============================================================================
 * CALL-LEVEL ANALYTICS (Brain-Wired)
 * ============================================================================
 */

/**
 * GET /api/company/:companyId/analytics/calls
 * 
 * Returns paginated list of calls with metrics and outcomes
 * Query params: from, to, page, pageSize, status, sentiment, goodCall
 */
router.get('/company/:companyId/analytics/calls', async (req, res) => {
    const { companyId } = req.params;
    const {
        from,
        to,
        page = 1,
        pageSize = 20,
        status, // Filter by outcome.status
        sentiment, // Filter by sentiment
        goodCall, // Filter by goodCall (true/false)
        serviceType, // Filter by serviceType
        categorySlug // Filter by categorySlug
    } = req.query;
    
    try {
        logger.info('📞 [CALL ANALYTICS] Fetching call list', {
            companyId,
            page,
            pageSize,
            filters: { status, sentiment, goodCall, serviceType, categorySlug }
        });
        
        // Build query filter
        const filter = { companyId };
        
        // Date range filter
        if (from || to) {
            filter.startedAt = {};
            if (from) filter.startedAt.$gte = new Date(from);
            if (to) filter.startedAt.$lte = new Date(to);
        } else {
            // Default: Last 30 days
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            filter.startedAt = { $gte: thirtyDaysAgo };
        }
        
        // Status filter
        if (status) {
            filter['outcome.status'] = status.toUpperCase();
        }
        
        // Sentiment filter
        if (sentiment) {
            filter.sentiment = sentiment.toLowerCase();
        }
        
        // Good call filter
        if (goodCall !== undefined) {
            filter['outcome.goodCall'] = goodCall === 'true';
        }
        
        // Service type filter
        if (serviceType) {
            filter.serviceType = serviceType;
        }
        
        // Category filter
        if (categorySlug) {
            filter.categorySlug = categorySlug;
        }
        
        // Count total matching calls
        const total = await v2AIAgentCallLog.countDocuments(filter);
        
        // Fetch paginated calls
        const skip = (parseInt(page) - 1) * parseInt(pageSize);
        const calls = await v2AIAgentCallLog.find(filter)
            .select({
                callId: 1,
                direction: 1,
                fromNumber: 1,
                toNumber: 1,
                startedAt: 1,
                durationMs: 1,
                serviceType: 1,
                categorySlug: 1,
                matchedScenarioId: 1,
                'outcome.status': 1,
                'outcome.successScore': 1,
                'outcome.goodCall': 1,
                sentiment: 1,
                sentimentScore: 1,
                summary: 1,
                callerIntent: 1
            })
            .sort({ startedAt: -1 })
            .skip(skip)
            .limit(parseInt(pageSize))
            .lean();
        
        logger.info(`✅ [CALL ANALYTICS] Fetched ${calls.length} calls (total: ${total})`);
        
        res.json({
            success: true,
            calls: calls.map(call => ({
                callId: call.callId,
                direction: call.direction,
                fromNumber: call.fromNumber,
                toNumber: call.toNumber,
                startedAt: call.startedAt,
                durationMs: call.durationMs,
                serviceType: call.serviceType,
                categorySlug: call.categorySlug,
                outcome: call.outcome || {},
                sentiment: call.sentiment,
                sentimentScore: call.sentimentScore,
                summary: call.summary,
                callerIntent: call.callerIntent
            })),
            pagination: {
                total,
                page: parseInt(page),
                pageSize: parseInt(pageSize),
                totalPages: Math.ceil(total / parseInt(pageSize))
            }
        });
        
    } catch (error) {
        logger.error('❌ [CALL ANALYTICS] Error fetching call list:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch call list',
            message: error.message
        });
    }
});

/**
 * GET /api/company/:companyId/analytics/calls/:callId
 * 
 * Returns detailed information for a single call
 */
router.get('/company/:companyId/analytics/calls/:callId', async (req, res) => {
    const { companyId, callId } = req.params;
    
    try {
        logger.info('📞 [CALL ANALYTICS] Fetching call detail', {
            companyId,
            callId
        });
        
        // Fetch call with all details
        const call = await v2AIAgentCallLog.findOne({
            companyId,
            callId
        })
        .populate('matchedScenarioId', 'name description')
        .lean();
        
        if (!call) {
            logger.warn(`⚠️ [CALL ANALYTICS] Call not found: ${callId}`);
            return res.status(404).json({
                success: false,
                error: 'Call not found'
            });
        }
        
        // Build transcript from conversation.turns or events
        let transcript = [];
        if (call.conversation && call.conversation.turns && call.conversation.turns.length > 0) {
            transcript = call.conversation.turns.map(turn => ({
                role: turn.role || turn.speaker || 'unknown',
                text: turn.text || '',
                tOffsetMs: turn.tOffsetMs || 0,
                timestamp: turn.timestamp
            }));
        } else if (call.events && call.events.length > 0) {
            transcript = call.events
                .filter(e => e.type === 'caller_utterance' || e.type === 'agent_reply')
                .map(e => ({
                    role: e.type === 'caller_utterance' ? 'caller' : 'agent',
                    text: e.text || '',
                    tOffsetMs: e.tOffsetMs || 0,
                    timestamp: e.at
                }));
        }
        
        logger.info(`✅ [CALL ANALYTICS] Call detail fetched`, {
            callId,
            transcriptLength: transcript.length,
            eventsCount: call.events?.length || 0
        });
        
        res.json({
            success: true,
            call: {
                // Basic info
                callId: call.callId,
                direction: call.direction,
                fromNumber: call.fromNumber,
                toNumber: call.toNumber,
                startedAt: call.startedAt,
                endedAt: call.endedAt,
                durationMs: call.durationMs,
                
                // Brain / Cheat Sheet
                serviceType: call.serviceType,
                categorySlug: call.categorySlug,
                matchedScenarioId: call.matchedScenarioId,
                matchedScenario: call.matchedScenarioId ? {
                    id: call.matchedScenarioId._id,
                    name: call.matchedScenarioId.name,
                    description: call.matchedScenarioId.description
                } : null,
                usedFallback: call.usedFallback,
                confidence: call.confidence,
                
                // Outcome
                outcome: call.outcome || {
                    status: 'UNKNOWN',
                    details: '',
                    successScore: 0,
                    goodCall: false
                },
                
                // Metrics
                metrics: call.metrics || {
                    avgAgentLatencyMs: 0,
                    maxAgentLatencyMs: 0,
                    deadAirMsTotal: 0,
                    deadAirSegments: 0,
                    turnsCaller: 0,
                    turnsAgent: 0
                },
                
                // Summary & Analysis
                summary: call.summary,
                callerIntent: call.callerIntent,
                sentiment: call.sentiment,
                sentimentScore: call.sentimentScore,
                
                // Transcript
                transcript,
                
                // Events (for debugging/advanced view)
                events: call.events || []
            }
        });
        
    } catch (error) {
        logger.error('❌ [CALL ANALYTICS] Error fetching call detail:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to fetch call detail',
            message: error.message
        });
    }
});

module.exports = router;

