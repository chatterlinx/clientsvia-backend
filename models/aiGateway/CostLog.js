// ============================================================================
// 💰 AI GATEWAY - COST LOG MODEL
// ============================================================================
// PURPOSE: Track OpenAI API costs per operation
// FEATURES: Per-call tracking, budget alerts, cost aggregation
// RETENTION: 90-day TTL for compliance and analysis
// CREATED: 2025-10-29
// ============================================================================

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ────────────────────────────────────────────────────────────────────────────
// 💰 COST LOG SCHEMA
// ────────────────────────────────────────────────────────────────────────────

const AIGatewayCostLogSchema = new Schema({
    // ========================================================================
    // 🏷️ METADATA
    // ========================================================================
    
    timestamp: {
        type: Date,
        default: Date.now,
        required: true,
        index: true
    },
    
    // ========================================================================
    // 🎯 OPERATION DETAILS
    // ========================================================================
    
    operationType: {
        type: String,
        enum: ['health_check', 'production_call', 'tier3_fallback', 'test_call', 'manual_test', 'warmup'],
        required: true,
        index: true
    },
    
    tier: {
        type: String,
        enum: ['tier1', 'tier2', 'tier3', 'warmup'],
        index: true
    },
    
    service: {
        type: String,
        enum: ['openai'],
        required: true,
        default: 'openai'
    },
    
    // ========================================================================
    // 🤖 MODEL & USAGE
    // ========================================================================
    
    model: {
        type: String,
        required: true,
        index: true
    },
    
    tokensUsed: {
        input: {
            type: Number,
            required: true,
            min: 0
        },
        output: {
            type: Number,
            required: true,
            min: 0
        },
        total: {
            type: Number,
            required: true,
            min: 0
        }
    },
    
    // ========================================================================
    // 💰 COST
    // ========================================================================
    
    cost: {
        type: Number,
        required: true,
        min: 0
    },
    
    // ========================================================================
    // 🔗 REFERENCES
    // ========================================================================
    
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        index: true
    },
    
    callId: {
        type: String,
        index: true
    },
    
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'Company',
        index: true
    },
    
    // ========================================================================
    // 🔥 SMART WARMUP TRACKING
    // ========================================================================
    
    metadata: {
        warmupId: String,
        action: {
            type: String,
            enum: ['triggered', 'used', 'cancelled', 'failed']
        },
        reason: String,
        duration: Number,
        warmupTriggered: {
            type: Boolean,
            default: false,
            index: true
        },
        warmupUsed: {
            type: Boolean,
            default: false,
            index: true
        },
        warmupCancelled: {
            type: Boolean,
            default: false
        },
        query: String,
        responseLength: Number,
        tier1Confidence: Number,
        tier2Confidence: Number
    }
    
}, {
    timestamps: true,
    collection: 'aigateway_costlogs'
});

// ────────────────────────────────────────────────────────────────────────────
// 🔍 INDEXES
// ────────────────────────────────────────────────────────────────────────────

AIGatewayCostLogSchema.index({ timestamp: -1 });
AIGatewayCostLogSchema.index({ operationType: 1, timestamp: -1 });
AIGatewayCostLogSchema.index({ templateId: 1, timestamp: -1 });
AIGatewayCostLogSchema.index({ model: 1, timestamp: -1 });

// ────────────────────────────────────────────────────────────────────────────
// ⏰ TTL INDEX: Auto-delete logs older than 90 days
// ────────────────────────────────────────────────────────────────────────────

AIGatewayCostLogSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 90 * 24 * 60 * 60 } // 90 days
);

// ────────────────────────────────────────────────────────────────────────────
// 📊 STATIC METHODS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Get total cost for a period
 */
AIGatewayCostLogSchema.statics.getTotalCost = async function(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const result = await this.aggregate([
        {
            $match: {
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: null,
                totalCost: { $sum: '$cost' },
                totalCalls: { $sum: 1 },
                totalTokens: { $sum: '$tokensUsed.total' }
            }
        }
    ]);
    
    return result[0] || { totalCost: 0, totalCalls: 0, totalTokens: 0 };
};

/**
 * Get cost breakdown by operation type
 */
AIGatewayCostLogSchema.statics.getCostBreakdown = async function(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const breakdown = await this.aggregate([
        {
            $match: {
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: '$operationType',
                cost: { $sum: '$cost' },
                calls: { $sum: 1 },
                tokens: { $sum: '$tokensUsed.total' }
            }
        }
    ]);
    
    return breakdown;
};

/**
 * Get daily cost trend
 */
AIGatewayCostLogSchema.statics.getDailyCosts = async function(days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const daily = await this.aggregate([
        {
            $match: {
                timestamp: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: {
                    $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
                },
                cost: { $sum: '$cost' },
                calls: { $sum: 1 },
                tokens: { $sum: '$tokensUsed.total' }
            }
        },
        {
            $sort: { '_id': 1 }
        }
    ]);
    
    return daily.map(d => ({
        date: d._id,
        cost: parseFloat(d.cost.toFixed(4)),
        calls: d.calls,
        tokens: d.tokens
    }));
};

/**
 * Get warmup analytics for a company
 */
AIGatewayCostLogSchema.statics.getWarmupAnalytics = async function(companyId, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const stats = await this.aggregate([
        {
            $match: {
                companyId: companyId,
                timestamp: { $gte: startDate },
                'metadata.warmupTriggered': true
            }
        },
        {
            $group: {
                _id: null,
                totalTriggered: { $sum: 1 },
                totalUsed: {
                    $sum: {
                        $cond: [{ $eq: ['$metadata.warmupUsed', true] }, 1, 0]
                    }
                },
                totalCancelled: {
                    $sum: {
                        $cond: [{ $eq: ['$metadata.warmupCancelled', true] }, 1, 0]
                    }
                },
                totalCost: {
                    $sum: {
                        $cond: [{ $eq: ['$metadata.warmupUsed', true] }, '$cost', 0]
                    }
                },
                avgDuration: { $avg: '$metadata.duration' },
                avgTimeSaved: {
                    $avg: {
                        $cond: [
                            { $eq: ['$metadata.warmupUsed', true] },
                            { $subtract: [1000, '$metadata.duration'] }, // Assume 1000ms saved vs fresh call
                            null
                        ]
                    }
                }
            }
        }
    ]);
    
    if (stats.length === 0) {
        return {
            totalTriggered: 0,
            totalUsed: 0,
            totalCancelled: 0,
            hitRate: 0,
            totalCost: 0,
            avgDuration: 0,
            avgTimeSaved: 0,
            estimatedSavings: 0
        };
    }
    
    const result = stats[0];
    const hitRate = result.totalTriggered > 0 ? result.totalUsed / result.totalTriggered : 0;
    
    // Estimated savings: time saved * value per second ($0.01/second perception cost)
    const estimatedSavings = (result.avgTimeSaved || 0) * result.totalUsed * 0.01 / 1000;
    
    return {
        totalTriggered: result.totalTriggered,
        totalUsed: result.totalUsed,
        totalCancelled: result.totalCancelled,
        hitRate: parseFloat(hitRate.toFixed(3)),
        totalCost: parseFloat(result.totalCost.toFixed(4)),
        avgDuration: Math.round(result.avgDuration || 0),
        avgTimeSaved: Math.round(result.avgTimeSaved || 0),
        estimatedSavings: parseFloat(estimatedSavings.toFixed(4)),
        roi: result.totalCost > 0 ? parseFloat((estimatedSavings / result.totalCost).toFixed(2)) : 0
    };
};

/**
 * Get warmup hit rate by category
 */
AIGatewayCostLogSchema.statics.getWarmupHitRateByCategory = async function(companyId, days = 7) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // This would require joining with template data
    // For now, return overall hit rate
    return await this.getWarmupAnalytics(companyId, days);
};

// ────────────────────────────────────────────────────────────────────────────
// 📦 EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = mongoose.model('AIGatewayCostLog', AIGatewayCostLogSchema);

