// ============================================================================
// AI PERFORMANCE API ROUTES
// ============================================================================
// 📋 PURPOSE: API endpoints for AI Performance Dashboard
// 🎯 FEATURES:
//    - Real-time metrics (last 24 hours)
//    - Speed trends (last 7 days)
//    - Index usage monitoring
//    - Slow query logs
// 🔒 AUTH: Requires valid JWT token
// ============================================================================

const express = require('express');
const router = express.Router();
const v2AIPerformanceMetric = require('../../models/v2AIPerformanceMetric');
const v2AIAgentCallLog = require('../../models/v2AIAgentCallLog');
const Company = require('../../models/v2Company');
const { authenticateJWT } = require('../../middleware/auth');
const mongoose = require('mongoose');

// ============================================================================
// GET REAL-TIME METRICS (Last 24 Hours)
// ============================================================================
router.get('/company/:companyId/ai-performance/realtime', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`📊 [AI PERFORMANCE API] CHECKPOINT 1: Fetching realtime metrics for company: ${companyId}`);

        // ================================================================
        // STEP 1: Validate company exists
        // ================================================================
        const company = await Company.findById(companyId);
        if (!company) {
            console.log(`❌ [AI PERFORMANCE API] Company not found: ${companyId}`);
            return res.status(404).json({
                success: false,
                message: 'Company not found'
            });
        }

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 2: Company validated: ${company.companyName}`);

        // ================================================================
        // STEP 2: Get 24-hour summary from model
        // ================================================================
        const summary = await v2AIPerformanceMetric.getLast24HoursSummary(companyId);

        if (!summary) {
            console.log(`⚠️ [AI PERFORMANCE API] CHECKPOINT 3: No metrics found (new company)`);
            return res.json({
                success: true,
                message: 'No performance data yet',
                data: {
                    totalLookups: 0,
                    avgSpeed: 0,
                    cacheHitRate: 0,
                    sourceDistribution: {
                        companyQnA: 0,
                        tradeQnA: 0,
                        templates: 0,
                        inHouseFallback: 0
                    },
                    speedBreakdown: {
                        mongoLookup: 0,
                        redisCache: 0,
                        templateLoading: 0,
                        scenarioMatching: 0,
                        confidenceCalculation: 0,
                        responseGeneration: 0
                    }
                }
            });
        }

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 4: Summary calculated`);
        console.log(`📊 [AI PERFORMANCE API] Total lookups: ${summary.totalLookups}`);
        console.log(`⚡ [AI PERFORMANCE API] Avg speed: ${Math.round(summary.avgSpeed)}ms`);
        console.log(`💾 [AI PERFORMANCE API] Cache hit rate: ${Math.round(summary.cacheHitRate)}%`);

        // ================================================================
        // STEP 3: Return data
        // ================================================================
        res.json({
            success: true,
            data: {
                totalLookups: summary.totalLookups,
                avgSpeed: Math.round(summary.avgSpeed),
                cacheHitRate: Math.round(summary.cacheHitRate * 10) / 10,
                sourceDistribution: summary.sourceDistribution,
                speedBreakdown: {
                    mongoLookup: Math.round(summary.speedBreakdown.mongoLookup),
                    redisCache: Math.round(summary.speedBreakdown.redisCache),
                    templateLoading: Math.round(summary.speedBreakdown.templateLoading),
                    scenarioMatching: Math.round(summary.speedBreakdown.scenarioMatching),
                    confidenceCalculation: Math.round(summary.speedBreakdown.confidenceCalculation),
                    responseGeneration: Math.round(summary.speedBreakdown.responseGeneration)
                }
            }
        });

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 5: Response sent successfully`);

    } catch (error) {
        console.error(`❌ [AI PERFORMANCE API] ERROR in realtime metrics:`, error);
        console.error(`❌ [AI PERFORMANCE API] Stack:`, error.stack);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch realtime metrics',
            error: error.message
        });
    }
});

// ============================================================================
// GET SPEED TRENDS (Last 7 Days)
// ============================================================================
router.get('/company/:companyId/ai-performance/trends', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        const { days = 7 } = req.query;
        
        console.log(`📈 [AI PERFORMANCE API] CHECKPOINT 1: Fetching ${days}-day trends for company: ${companyId}`);

        // ================================================================
        // STEP 1: Get trends from model
        // ================================================================
        const trends = await v2AIPerformanceMetric.getSpeedTrends(companyId, parseInt(days));

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 2: Found trends for ${trends.length} days`);

        // ================================================================
        // STEP 2: Format response
        // ================================================================
        const formattedTrends = trends.map(day => ({
            date: day._id,
            avgSpeed: Math.round(day.avgSpeed),
            totalLookups: day.totalLookups,
            cacheHitRate: Math.round(day.cacheHitRate * 10) / 10
        }));

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 3: Response formatted`);

        res.json({
            success: true,
            data: formattedTrends
        });

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 4: Response sent successfully`);

    } catch (error) {
        console.error(`❌ [AI PERFORMANCE API] ERROR in trends:`, error);
        console.error(`❌ [AI PERFORMANCE API] Stack:`, error.stack);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch trends',
            error: error.message
        });
    }
});

// ============================================================================
// GET INDEX USAGE STATISTICS
// ============================================================================
router.get('/company/:companyId/ai-performance/index-usage', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`🔍 [AI PERFORMANCE API] CHECKPOINT 1: Fetching index usage for company: ${companyId}`);

        // ================================================================
        // STEP 1: Get latest metrics (last hour)
        // ================================================================
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        
        const recentMetrics = await v2AIPerformanceMetric.find({
            companyId,
            timestamp: { $gte: oneHourAgo }
        }).sort({ timestamp: -1 }).limit(4); // Last 4 intervals (1 hour)

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 2: Found ${recentMetrics.length} recent intervals`);

        if (recentMetrics.length === 0) {
            console.log(`⚠️ [AI PERFORMANCE API] CHECKPOINT 3: No recent metrics`);
            return res.json({
                success: true,
                message: 'No recent activity',
                data: {
                    companyIdIndex: { used: false, hits: 0 },
                    phoneNumberIndex: { used: false, hits: 0 },
                    createdAtIndex: { used: false, hits: 0 },
                    confidenceIndex: { used: false, hits: 0 }
                }
            });
        }

        // ================================================================
        // STEP 2: Aggregate index usage
        // ================================================================
        const indexUsage = {
            companyIdIndex: { used: true, hits: 0 },
            phoneNumberIndex: { used: true, hits: 0 },
            createdAtIndex: { used: false, hits: 0 },
            confidenceIndex: { used: false, hits: 0 }
        };

        recentMetrics.forEach(metric => {
            if (metric.indexUsage?.companyIdIndex) {
                indexUsage.companyIdIndex.hits += metric.indexUsage.companyIdIndex.hits || 0;
            }
            if (metric.indexUsage?.phoneNumberIndex) {
                indexUsage.phoneNumberIndex.hits += metric.indexUsage.phoneNumberIndex.hits || 0;
            }
            if (metric.indexUsage?.createdAtIndex) {
                indexUsage.createdAtIndex.used = metric.indexUsage.createdAtIndex.used || false;
                indexUsage.createdAtIndex.hits += metric.indexUsage.createdAtIndex.hits || 0;
            }
            if (metric.indexUsage?.confidenceIndex) {
                indexUsage.confidenceIndex.used = metric.indexUsage.confidenceIndex.used || false;
                indexUsage.confidenceIndex.hits += metric.indexUsage.confidenceIndex.hits || 0;
            }
        });

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 4: Index usage aggregated`);

        res.json({
            success: true,
            data: indexUsage
        });

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 5: Response sent successfully`);

    } catch (error) {
        console.error(`❌ [AI PERFORMANCE API] ERROR in index usage:`, error);
        console.error(`❌ [AI PERFORMANCE API] Stack:`, error.stack);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch index usage',
            error: error.message
        });
    }
});

// ============================================================================
// GET SLOW QUERIES (Last 24 Hours)
// ============================================================================
router.get('/company/:companyId/ai-performance/slow-queries', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`🐌 [AI PERFORMANCE API] CHECKPOINT 1: Fetching slow queries for company: ${companyId}`);

        // ================================================================
        // STEP 1: Get metrics from last 24 hours
        // ================================================================
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        const metrics = await v2AIPerformanceMetric.find({
            companyId,
            timestamp: { $gte: twentyFourHoursAgo },
            'slowQueries.0': { $exists: true } // Only metrics with slow queries
        }).sort({ timestamp: -1 });

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 2: Found ${metrics.length} intervals with slow queries`);

        // ================================================================
        // STEP 2: Collect all slow queries
        // ================================================================
        let allSlowQueries = [];
        
        metrics.forEach(metric => {
            if (metric.slowQueries && metric.slowQueries.length > 0) {
                allSlowQueries = allSlowQueries.concat(metric.slowQueries);
            }
        });

        // Sort by duration (slowest first)
        allSlowQueries.sort((a, b) => b.duration - a.duration);

        // Limit to top 20
        allSlowQueries = allSlowQueries.slice(0, 20);

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 3: Collected ${allSlowQueries.length} slow queries`);

        res.json({
            success: true,
            data: allSlowQueries,
            count: allSlowQueries.length
        });

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 4: Response sent successfully`);

    } catch (error) {
        console.error(`❌ [AI PERFORMANCE API] ERROR in slow queries:`, error);
        console.error(`❌ [AI PERFORMANCE API] Stack:`, error.stack);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch slow queries',
            error: error.message
        });
    }
});

// ============================================================================
// GET DATABASE COLLECTION STATS
// ============================================================================
router.get('/company/:companyId/ai-performance/db-stats', authenticateJWT, async (req, res) => {
    try {
        const { companyId } = req.params;
        
        console.log(`💾 [AI PERFORMANCE API] CHECKPOINT 1: Fetching DB stats for company: ${companyId}`);

        // ================================================================
        // STEP 1: Get call log collection stats
        // ================================================================
        const db = mongoose.connection.db;
        const collStats = await db.collection('v2aiagentcalllogs').stats();

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 2: Collection stats retrieved`);

        // ================================================================
        // STEP 2: Count documents for this company
        // ================================================================
        const companyDocCount = await v2AIAgentCallLog.countDocuments({ companyId });

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 3: Company has ${companyDocCount} call logs`);

        // ================================================================
        // STEP 3: Format response
        // ================================================================
        const stats = {
            totalDocuments: collStats.count,
            companyDocuments: companyDocCount,
            indexSize: Math.round((collStats.totalIndexSize / 1024 / 1024) * 100) / 100, // MB
            dataSize: Math.round((collStats.size / 1024 / 1024) * 100) / 100, // MB
            avgDocSize: Math.round((collStats.avgObjSize / 1024) * 100) / 100, // KB
            indexes: collStats.nindexes
        };

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 4: Stats formatted`);

        res.json({
            success: true,
            data: stats
        });

        console.log(`✅ [AI PERFORMANCE API] CHECKPOINT 5: Response sent successfully`);

    } catch (error) {
        console.error(`❌ [AI PERFORMANCE API] ERROR in DB stats:`, error);
        console.error(`❌ [AI PERFORMANCE API] Stack:`, error.stack);
        res.status(500).json({
            success: false,
            message: 'Failed to fetch DB stats',
            error: error.message
        });
    }
});

// ============================================================================
// EXPORT
// ============================================================================
module.exports = router;

