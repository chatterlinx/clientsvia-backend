// ============================================================================
// 💊 AI GATEWAY - HEALTH LOG MODEL
// ============================================================================
// PURPOSE: Store historical health check results for trending and analysis
// FEATURES: TTL-based auto-deletion, indexed queries, detailed results
// RETENTION: 1000 most recent checks (30-day rolling window)
// CREATED: 2025-10-29
// ============================================================================

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ────────────────────────────────────────────────────────────────────────────
// 📊 INDIVIDUAL SERVICE HEALTH RESULT
// ────────────────────────────────────────────────────────────────────────────

const ServiceHealthSchema = new Schema({
    status: {
        type: String,
        enum: ['HEALTHY', 'UNHEALTHY', 'NOT_CONFIGURED', 'UNKNOWN'],
        required: true
    },
    responseTime: {
        type: Number, // milliseconds
        min: 0
    },
    error: {
        type: String
    },
    details: {
        type: Schema.Types.Mixed // Service-specific details
    }
}, { _id: false });

// ────────────────────────────────────────────────────────────────────────────
// 💊 MAIN HEALTH LOG SCHEMA
// ────────────────────────────────────────────────────────────────────────────

const AIGatewayHealthLogSchema = new Schema({
    // ========================================================================
    // 🏷️ METADATA
    // ========================================================================
    
    timestamp: {
        type: Date,
        default: Date.now,
        required: true,
        index: true
    },
    
    type: {
        type: String,
        enum: ['manual', 'auto'],
        required: true,
        index: true
    },
    
    triggeredBy: {
        type: String, // 'auto-ping' or userId
        required: true
    },
    
    // ========================================================================
    // 📊 SERVICE HEALTH RESULTS
    // ========================================================================
    
    openai: {
        type: ServiceHealthSchema,
        required: true
    },
    
    mongodb: {
        type: ServiceHealthSchema,
        required: true
    },
    
    redis: {
        type: ServiceHealthSchema,
        required: true
    },
    
    tier3System: {
        status: {
            type: String,
            enum: ['ENABLED', 'DISABLED', 'NOT_CONFIGURED'],
            required: true
        },
        details: {
            type: Schema.Types.Mixed
        }
    },
    
    // ========================================================================
    // 📈 AGGREGATE STATUS
    // ========================================================================
    
    overallStatus: {
        type: String,
        enum: ['ALL_HEALTHY', 'DEGRADED', 'CRITICAL'],
        required: true,
        index: true
    },
    
    // Number of unhealthy services
    unhealthyCount: {
        type: Number,
        default: 0,
        min: 0,
        max: 3 // openai, mongodb, redis
    },
    
    // Total response time (for performance tracking)
    totalResponseTime: {
        type: Number,
        min: 0
    }
    
}, {
    timestamps: true, // Adds createdAt, updatedAt
    collection: 'aigateway_healthlogs'
});

// ────────────────────────────────────────────────────────────────────────────
// 🔍 INDEXES FOR FAST QUERIES
// ────────────────────────────────────────────────────────────────────────────

AIGatewayHealthLogSchema.index({ timestamp: -1 }); // Most recent first
AIGatewayHealthLogSchema.index({ type: 1, timestamp: -1 }); // Filter by type
AIGatewayHealthLogSchema.index({ overallStatus: 1, timestamp: -1 }); // Filter by health

// ────────────────────────────────────────────────────────────────────────────
// ⏰ TTL INDEX: Auto-delete logs older than 30 days
// ────────────────────────────────────────────────────────────────────────────

AIGatewayHealthLogSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 30 * 24 * 60 * 60 } // 30 days
);

// ────────────────────────────────────────────────────────────────────────────
// 📊 STATIC METHODS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Get recent health logs with optional filters
 */
AIGatewayHealthLogSchema.statics.getRecent = async function(options = {}) {
    const {
        limit = 10,
        type = null,
        status = null
    } = options;
    
    const query = {};
    if (type) query.type = type;
    if (status) query.overallStatus = status;
    
    return this.find(query)
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();
};

/**
 * Get health statistics for a time period
 */
AIGatewayHealthLogSchema.statics.getStats = async function(days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const logs = await this.find({
        timestamp: { $gte: startDate }
    }).lean();
    
    const total = logs.length;
    const healthy = logs.filter(l => l.overallStatus === 'ALL_HEALTHY').length;
    const degraded = logs.filter(l => l.overallStatus === 'DEGRADED').length;
    const critical = logs.filter(l => l.overallStatus === 'CRITICAL').length;
    
    // Calculate uptime percentage per service
    const openaiHealthy = logs.filter(l => l.openai.status === 'HEALTHY').length;
    const mongodbHealthy = logs.filter(l => l.mongodb.status === 'HEALTHY').length;
    const redisHealthy = logs.filter(l => l.redis.status === 'HEALTHY').length;
    
    return {
        period: `${days} days`,
        totalChecks: total,
        breakdown: {
            healthy,
            degraded,
            critical
        },
        uptime: {
            openai: total > 0 ? ((openaiHealthy / total) * 100).toFixed(2) + '%' : 'N/A',
            mongodb: total > 0 ? ((mongodbHealthy / total) * 100).toFixed(2) + '%' : 'N/A',
            redis: total > 0 ? ((redisHealthy / total) * 100).toFixed(2) + '%' : 'N/A'
        }
    };
};

/**
 * Calculate average response times
 */
AIGatewayHealthLogSchema.statics.getResponseTimeStats = async function(service, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const logs = await this.find({
        timestamp: { $gte: startDate },
        [`${service}.status`]: 'HEALTHY'
    }).lean();
    
    if (logs.length === 0) {
        return { average: 0, min: 0, max: 0, dataPoints: [] };
    }
    
    const responseTimes = logs
        .map(l => l[service]?.responseTime)
        .filter(rt => rt !== null && rt !== undefined);
    
    const sum = responseTimes.reduce((a, b) => a + b, 0);
    const average = Math.round(sum / responseTimes.length);
    const min = Math.min(...responseTimes);
    const max = Math.max(...responseTimes);
    
    return {
        average,
        min,
        max,
        p50: calculatePercentile(responseTimes, 50),
        p95: calculatePercentile(responseTimes, 95),
        p99: calculatePercentile(responseTimes, 99),
        dataPoints: logs.map(l => ({
            timestamp: l.timestamp,
            value: l[service]?.responseTime
        }))
    };
};

// ────────────────────────────────────────────────────────────────────────────
// 🛠️ HELPER FUNCTIONS
// ────────────────────────────────────────────────────────────────────────────

function calculatePercentile(values, percentile) {
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[index] || 0;
}

// ────────────────────────────────────────────────────────────────────────────
// 📦 EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = mongoose.model('AIGatewayHealthLog', AIGatewayHealthLogSchema);

