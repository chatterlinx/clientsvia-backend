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

module.exports = router;

