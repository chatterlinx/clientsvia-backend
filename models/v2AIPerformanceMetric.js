// ============================================================================
// AI PERFORMANCE METRICS MODEL
// ============================================================================
// 📋 PURPOSE: Track AI agent performance in real-time for optimization
// 🎯 FEATURES:
//    - Real-time lookup speed tracking
//    - Database index usage monitoring
//    - Cache performance metrics
//    - Source distribution analytics
// 🔍 USAGE: Performance Dashboard, optimization recommendations
// ============================================================================

const mongoose = require('mongoose');
const logger = require('../utils/logger.js');

const { ObjectId } = mongoose.Schema.Types;

// ============================================================================
// SCHEMA DEFINITION
// ============================================================================

const aiPerformanceMetricSchema = new mongoose.Schema({
    // ────────────────────────────────────────────────────────────────────────
    // COMPANY ASSOCIATION
    // ────────────────────────────────────────────────────────────────────────
    companyId: {
        type: ObjectId,
        ref: 'Company',
        required: true,
        index: true // Fast company-specific queries
    },

    // ────────────────────────────────────────────────────────────────────────
    // TIMESTAMP (15-minute intervals for aggregation)
    // ────────────────────────────────────────────────────────────────────────
    timestamp: {
        type: Date,
        required: true,
        index: true // Time-range queries
    },

    intervalStart: {
        type: Date,
        required: true
    },

    intervalEnd: {
        type: Date,
        required: true
    },

    // ────────────────────────────────────────────────────────────────────────
    // LOOKUP SPEED BREAKDOWN (milliseconds)
    // ────────────────────────────────────────────────────────────────────────
    lookupSpeed: {
        mongoLookup: {
            avg: { type: Number, default: 0 },
            min: { type: Number, default: 0 },
            max: { type: Number, default: 0 },
            count: { type: Number, default: 0 }
        },

        redisCache: {
            avg: { type: Number, default: 0 },
            min: { type: Number, default: 0 },
            max: { type: Number, default: 0 },
            count: { type: Number, default: 0 }
        },

        templateLoading: {
            avg: { type: Number, default: 0 },
            min: { type: Number, default: 0 },
            max: { type: Number, default: 0 },
            count: { type: Number, default: 0 }
        },

        scenarioMatching: {
            avg: { type: Number, default: 0 },
            min: { type: Number, default: 0 },
            max: { type: Number, default: 0 },
            count: { type: Number, default: 0 }
        },

        confidenceCalculation: {
            avg: { type: Number, default: 0 },
            min: { type: Number, default: 0 },
            max: { type: Number, default: 0 },
            count: { type: Number, default: 0 }
        },

        responseGeneration: {
            avg: { type: Number, default: 0 },
            min: { type: Number, default: 0 },
            max: { type: Number, default: 0 },
            count: { type: Number, default: 0 }
        },

        total: {
            avg: { type: Number, default: 0 },
            min: { type: Number, default: 0 },
            max: { type: Number, default: 0 },
            count: { type: Number, default: 0 }
        }
    },

    // ────────────────────────────────────────────────────────────────────────
    // DATABASE INDEX USAGE
    // ────────────────────────────────────────────────────────────────────────
    indexUsage: {
        companyIdIndex: {
            used: { type: Boolean, default: false },
            hits: { type: Number, default: 0 }
        },

        phoneNumberIndex: {
            used: { type: Boolean, default: false },
            hits: { type: Number, default: 0 }
        },

        createdAtIndex: {
            used: { type: Boolean, default: false },
            hits: { type: Number, default: 0 }
        },

        confidenceIndex: {
            used: { type: Boolean, default: false },
            hits: { type: Number, default: 0 }
        }
    },

    // ────────────────────────────────────────────────────────────────────────
    // SOURCE DISTRIBUTION (where AI routed queries)
    // ────────────────────────────────────────────────────────────────────────
    sourceDistribution: {
        companyQnA: { type: Number, default: 0 },
        tradeQnA: { type: Number, default: 0 },
        templates: { type: Number, default: 0 },
        inHouseFallback: { type: Number, default: 0 },
        totalLookups: { type: Number, default: 0 }
    },

    // ────────────────────────────────────────────────────────────────────────
    // CACHE PERFORMANCE
    // ────────────────────────────────────────────────────────────────────────
    cacheStats: {
        hits: { type: Number, default: 0 },
        misses: { type: Number, default: 0 },
        hitRate: { type: Number, default: 0 }, // Percentage (0-100)
        avgHitTime: { type: Number, default: 0 }, // milliseconds
        avgMissTime: { type: Number, default: 0 } // milliseconds
    },

    // ────────────────────────────────────────────────────────────────────────
    // CONFIDENCE SCORE DISTRIBUTION
    // ────────────────────────────────────────────────────────────────────────
    confidenceDistribution: {
        high: { type: Number, default: 0 },    // >= 0.8
        medium: { type: Number, default: 0 },  // 0.5 - 0.79
        low: { type: Number, default: 0 },     // < 0.5
        avgConfidence: { type: Number, default: 0 }
    },

    // ────────────────────────────────────────────────────────────────────────
    // SLOW QUERY TRACKING
    // ────────────────────────────────────────────────────────────────────────
    slowQueries: [{
        queryType: String,
        duration: Number, // milliseconds
        timestamp: Date,
        customerQuery: String
    }],

    // ────────────────────────────────────────────────────────────────────────
    // METADATA
    // ────────────────────────────────────────────────────────────────────────
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'v2aiperformancemetrics'
});

// ============================================================================
// INDEXES FOR PERFORMANCE
// ============================================================================

// Compound index for time-range queries per company
aiPerformanceMetricSchema.index({ companyId: 1, timestamp: -1 });

// Index for interval lookups
aiPerformanceMetricSchema.index({ companyId: 1, intervalStart: 1, intervalEnd: 1 });

// TTL index - auto-delete metrics older than 90 days
aiPerformanceMetricSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 7776000 } // 90 days
);

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get performance summary for a company (last 24 hours)
 */
aiPerformanceMetricSchema.statics.getLast24HoursSummary = async function(companyId) {
    logger.debug(`📊 [PERFORMANCE] Fetching 24h summary for company: ${companyId}`);
    
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    
    const metrics = await this.find({
        companyId,
        timestamp: { $gte: twentyFourHoursAgo }
    }).sort({ timestamp: -1 });
    
    if (!metrics || metrics.length === 0) {
        logger.info(`⚠️ [PERFORMANCE] No metrics found for last 24 hours`);
        return null;
    }
    
    // Aggregate all metrics
    const summary = {
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
    };
    
    metrics.forEach(metric => {
        summary.totalLookups += metric.sourceDistribution.totalLookups || 0;
        summary.sourceDistribution.companyQnA += metric.sourceDistribution.companyQnA || 0;
        summary.sourceDistribution.tradeQnA += metric.sourceDistribution.tradeQnA || 0;
        summary.sourceDistribution.templates += metric.sourceDistribution.templates || 0;
        summary.sourceDistribution.inHouseFallback += metric.sourceDistribution.inHouseFallback || 0;
    });
    
    // Calculate averages
    const count = metrics.length;
    metrics.forEach(metric => {
        summary.avgSpeed += (metric.lookupSpeed.total?.avg || 0) / count;
        summary.cacheHitRate += (metric.cacheStats.hitRate || 0) / count;
        summary.speedBreakdown.mongoLookup += (metric.lookupSpeed.mongoLookup?.avg || 0) / count;
        summary.speedBreakdown.redisCache += (metric.lookupSpeed.redisCache?.avg || 0) / count;
        summary.speedBreakdown.templateLoading += (metric.lookupSpeed.templateLoading?.avg || 0) / count;
        summary.speedBreakdown.scenarioMatching += (metric.lookupSpeed.scenarioMatching?.avg || 0) / count;
        summary.speedBreakdown.confidenceCalculation += (metric.lookupSpeed.confidenceCalculation?.avg || 0) / count;
        summary.speedBreakdown.responseGeneration += (metric.lookupSpeed.responseGeneration?.avg || 0) / count;
    });
    
    logger.info(`✅ [PERFORMANCE] Summary calculated: ${summary.totalLookups} lookups, ${Math.round(summary.avgSpeed)}ms avg`);
    
    return summary;
};

/**
 * Get speed trends over time (last 7 days)
 */
aiPerformanceMetricSchema.statics.getSpeedTrends = async function(companyId, days = 7) {
    logger.debug(`📈 [PERFORMANCE] Fetching ${days}-day trends for company: ${companyId}`);
    
    const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    
    const trends = await this.aggregate([
        {
            $match: {
                companyId: new mongoose.Types.ObjectId(companyId),
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp' } },
                avgSpeed: { $avg: '$lookupSpeed.total.avg' },
                totalLookups: { $sum: '$sourceDistribution.totalLookups' },
                cacheHitRate: { $avg: '$cacheStats.hitRate' }
            }
        },
        { $sort: { _id: 1 } }
    ]);
    
    logger.info(`✅ [PERFORMANCE] Trends calculated for ${trends.length} days`);
    
    return trends;
};

// ============================================================================
// MODEL EXPORT
// ============================================================================

const v2AIPerformanceMetric = mongoose.model('v2AIPerformanceMetric', aiPerformanceMetricSchema);

module.exports = v2AIPerformanceMetric;

