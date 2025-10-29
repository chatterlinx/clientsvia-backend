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
        enum: ['health_check', 'production_call', 'tier3_fallback', 'test_call', 'manual_test'],
        required: true,
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

// ────────────────────────────────────────────────────────────────────────────
// 📦 EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = mongoose.model('AIGatewayCostLog', AIGatewayCostLogSchema);

