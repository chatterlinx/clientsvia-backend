/**
 * 🚀 ENTERPRISE PERFORMANCE MONITORING API
 * Real-time analytics and performance tracking for AI agents
 */

const express = require('express');
const router = express.Router();
const KnowledgeRouter = require('../src/runtime/KnowledgeRouterV2');
const enterpriseCache = require('../services/enterpriseCacheService');

// Initialize router for analytics
const knowledgeRouter = new KnowledgeRouter();

/**
 * GET /api/performance/health
 * Overall system health check
 */
router.get('/health', async (req, res) => {
    try {
        const health = await knowledgeRouter.healthCheck();
        const cacheHealth = await enterpriseCache.healthCheck();
        
        const systemHealth = {
            status: 'healthy',
            timestamp: new Date(),
            services: {
                knowledgeRouter: health,
                cache: cacheHealth,
                database: { status: 'ok' } // Could add DB ping here
            },
            performance: {
                uptime: process.uptime(),
                memory: process.memoryUsage(),
                cpu: process.cpuUsage()
            }
        };

        res.json({
            success: true,
            data: systemHealth
        });

    } catch (error) {
        console.error('Health check error:', error);
        res.status(500).json({
            success: false,
            error: 'Health check failed',
            message: error.message
        });
    }
});

/**
 * GET /api/performance/analytics
 * Get system-wide performance analytics
 */
router.get('/analytics', async (req, res) => {
    try {
        const analytics = knowledgeRouter.getAnalytics();
        const cacheMetrics = enterpriseCache.getMetrics();
        
        const response = {
            timestamp: new Date(),
            performance: analytics.performanceMetrics,
            cache: cacheMetrics,
            summary: generateSummary(analytics, cacheMetrics)
        };

        res.json({
            success: true,
            data: response
        });

    } catch (error) {
        console.error('Analytics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get analytics',
            message: error.message
        });
    }
});

/**
 * GET /api/performance/companies/:companyId/metrics
 * Get company-specific performance metrics
 */
router.get('/companies/:companyId/metrics', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { timeframe = '24h' } = req.query;
        
        const analytics = knowledgeRouter.getAnalytics();
        const companyMetrics = {};
        
        // Filter metrics by company
        for (const [key, metrics] of Object.entries(analytics.performanceMetrics || {})) {
            if (key.startsWith(companyId + ':')) {
                const source = key.split(':')[1];
                companyMetrics[source] = metrics;
            }
        }

        const response = {
            companyId,
            timeframe,
            timestamp: new Date(),
            metrics: companyMetrics,
            insights: generateCompanyInsights(companyMetrics)
        };

        res.json({
            success: true,
            data: response
        });

    } catch (error) {
        console.error('Company metrics error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get company metrics',
            message: error.message
        });
    }
});

/**
 * POST /api/performance/test-routing
 * Test routing performance with sample queries
 */
router.post('/test-routing', async (req, res) => {
    try {
        const { companyId, queries } = req.body;
        
        if (!companyId || !queries || !Array.isArray(queries)) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: companyId, queries (array)'
            });
        }

        const results = [];
        
        for (const query of queries.slice(0, 10)) { // Limit to 10 queries
            const startTime = Date.now();
            
            try {
                const result = await knowledgeRouter.route({
                    companyID: companyId,
                    text: query,
                    context: { test: true }
                });
                
                results.push({
                    query,
                    result: {
                        source: result.result?.source,
                        score: result.result?.score,
                        responseTime: result.responseTime,
                        cached: result.cached
                    },
                    success: true
                });
                
            } catch (error) {
                results.push({
                    query,
                    error: error.message,
                    success: false,
                    responseTime: Date.now() - startTime
                });
            }
        }

        const summary = {
            totalQueries: results.length,
            successfulQueries: results.filter(r => r.success).length,
            averageResponseTime: results.reduce((sum, r) => sum + (r.result?.responseTime || r.responseTime || 0), 0) / results.length,
            sourceDistribution: {}
        };

        // Calculate source distribution
        results.filter(r => r.success).forEach(r => {
            const source = r.result.source;
            summary.sourceDistribution[source] = (summary.sourceDistribution[source] || 0) + 1;
        });

        res.json({
            success: true,
            data: {
                results,
                summary,
                timestamp: new Date()
            }
        });

    } catch (error) {
        console.error('Test routing error:', error);
        res.status(500).json({
            success: false,
            error: 'Test routing failed',
            message: error.message
        });
    }
});

/**
 * POST /api/performance/cache/invalidate
 * Invalidate cache for specific patterns
 */
router.post('/cache/invalidate', async (req, res) => {
    try {
        const { pattern, companyId } = req.body;
        
        if (companyId) {
            await enterpriseCache.invalidateCompany(companyId);
            res.json({
                success: true,
                message: `Cache invalidated for company: ${companyId}`
            });
        } else if (pattern) {
            await enterpriseCache.invalidate(pattern);
            res.json({
                success: true,
                message: `Cache invalidated for pattern: ${pattern}`
            });
        } else {
            res.status(400).json({
                success: false,
                error: 'Either companyId or pattern is required'
            });
        }

    } catch (error) {
        console.error('Cache invalidation error:', error);
        res.status(500).json({
            success: false,
            error: 'Cache invalidation failed',
            message: error.message
        });
    }
});

/**
 * GET /api/performance/cache/stats
 * Get detailed cache statistics
 */
router.get('/cache/stats', async (req, res) => {
    try {
        const stats = enterpriseCache.getMetrics();
        const health = await enterpriseCache.healthCheck();
        
        res.json({
            success: true,
            data: {
                metrics: stats,
                health,
                timestamp: new Date()
            }
        });

    } catch (error) {
        console.error('Cache stats error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to get cache stats',
            message: error.message
        });
    }
});

// === UTILITY FUNCTIONS ===

function generateSummary(analytics, cacheMetrics) {
    const summary = {
        totalRequests: 0,
        averageResponseTime: 0,
        averageScore: 0,
        successRate: 0,
        cacheHitRate: cacheMetrics.hitRate,
        topSources: {}
    };

    const metrics = analytics.performanceMetrics || {};
    const sources = Object.keys(metrics);
    
    if (sources.length > 0) {
        let totalTime = 0;
        let totalScore = 0;
        let totalSuccesses = 0;
        
        for (const metric of Object.values(metrics)) {
            summary.totalRequests += metric.totalRequests;
            totalTime += metric.averageResponseTime * metric.totalRequests;
            totalScore += metric.averageScore * metric.totalRequests;
            totalSuccesses += metric.totalRequests * metric.successRate;
        }
        
        if (summary.totalRequests > 0) {
            summary.averageResponseTime = Math.round(totalTime / summary.totalRequests);
            summary.averageScore = Math.round((totalScore / summary.totalRequests) * 100) / 100;
            summary.successRate = Math.round((totalSuccesses / summary.totalRequests) * 100) / 100;
        }
    }

    return summary;
}

function generateCompanyInsights(metrics) {
    const insights = [];
    
    // Analyze response times
    const responseTimes = Object.values(metrics).map(m => m.averageResponseTime);
    const avgResponseTime = responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length;
    
    if (avgResponseTime > 1000) {
        insights.push({
            type: 'warning',
            category: 'performance',
            message: `Average response time (${Math.round(avgResponseTime)}ms) exceeds target (500ms)`,
            recommendation: 'Consider cache optimization or query tuning'
        });
    }
    
    // Analyze success rates
    const successRates = Object.values(metrics).map(m => m.successRate);
    const avgSuccessRate = successRates.reduce((a, b) => a + b, 0) / successRates.length;
    
    if (avgSuccessRate < 0.8) {
        insights.push({
            type: 'warning',
            category: 'accuracy',
            message: `Success rate (${Math.round(avgSuccessRate * 100)}%) is below target (80%)`,
            recommendation: 'Review knowledge base content and confidence thresholds'
        });
    }
    
    // Find top performing source
    const bestSource = Object.entries(metrics).reduce((best, [source, metric]) => {
        const score = metric.successRate * 0.6 + (1 - Math.min(metric.averageResponseTime / 1000, 1)) * 0.4;
        return score > best.score ? { source, score, metric } : best;
    }, { source: null, score: 0 });
    
    if (bestSource.source) {
        insights.push({
            type: 'info',
            category: 'optimization',
            message: `Best performing source: ${bestSource.source} (${Math.round(bestSource.metric.successRate * 100)}% success rate)`,
            recommendation: 'Consider prioritizing this source or using it as a model for others'
        });
    }
    
    return insights;
}

module.exports = router;
