// ============================================================================
// 🚨 AI GATEWAY - ALERT RULE MODEL
// ============================================================================
// PURPOSE: Define smart alert rules with thresholds and conditions
// FEATURES: Pattern detection, consecutive failures, metric thresholds
// CREATED: 2025-10-29
// ============================================================================

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ────────────────────────────────────────────────────────────────────────────
// 🚨 ALERT RULE SCHEMA
// ────────────────────────────────────────────────────────────────────────────

const AIGatewayAlertRuleSchema = new Schema({
    // ========================================================================
    // 🏷️ RULE IDENTIFICATION
    // ========================================================================
    
    name: {
        type: String,
        required: true,
        trim: true
    },
    
    description: {
        type: String,
        trim: true
    },
    
    enabled: {
        type: Boolean,
        default: true,
        index: true
    },
    
    // ========================================================================
    // 🎯 TARGET & CONDITION
    // ========================================================================
    
    service: {
        type: String,
        enum: ['openai', 'mongodb', 'redis', 'tier3', 'any'],
        required: true,
        index: true
    },
    
    metric: {
        type: String,
        enum: ['responseTime', 'failures', 'cost', 'uptime', 'consecutiveFailures'],
        required: true
    },
    
    condition: {
        operator: {
            type: String,
            enum: ['>', '<', '>=', '<=', '==', '!='],
            required: true
        },
        threshold: {
            type: Number,
            required: true
        },
        duration: {
            value: {
                type: Number,
                min: 1
            },
            unit: {
                type: String,
                enum: ['minutes', 'hours', 'days']
            }
        }
    },
    
    // ========================================================================
    // 🔔 ACTION CONFIGURATION
    // ========================================================================
    
    action: {
        severity: {
            type: String,
            enum: ['INFO', 'WARNING', 'CRITICAL'],
            required: true
        },
        
        notifyAdmin: {
            type: Boolean,
            default: true
        },
        
        createIncident: {
            type: Boolean,
            default: false
        },
        
        customMessage: {
            type: String
        }
    },
    
    // ========================================================================
    // 📊 TRACKING & STATISTICS
    // ========================================================================
    
    stats: {
        totalTriggers: {
            type: Number,
            default: 0
        },
        lastTriggered: {
            type: Date
        },
        consecutiveTriggers: {
            type: Number,
            default: 0
        }
    },
    
    // ========================================================================
    // 🕐 METADATA
    // ========================================================================
    
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    
    createdAt: {
        type: Date,
        default: Date.now
    },
    
    updatedAt: {
        type: Date,
        default: Date.now
    }
    
}, {
    timestamps: true,
    collection: 'aigateway_alertrules'
});

// ────────────────────────────────────────────────────────────────────────────
// 🔍 INDEXES
// ────────────────────────────────────────────────────────────────────────────

AIGatewayAlertRuleSchema.index({ enabled: 1, service: 1 });
AIGatewayAlertRuleSchema.index({ 'stats.lastTriggered': -1 });

// ────────────────────────────────────────────────────────────────────────────
// 📊 STATIC METHODS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Get all enabled rules for a service
 */
AIGatewayAlertRuleSchema.statics.getEnabledRules = async function(service = null) {
    const query = { enabled: true };
    if (service && service !== 'any') {
        query.service = { $in: [service, 'any'] };
    }
    
    return this.find(query).sort({ createdAt: 1 }).lean();
};

/**
 * Increment trigger counter
 */
AIGatewayAlertRuleSchema.methods.recordTrigger = async function() {
    this.stats.totalTriggers += 1;
    this.stats.lastTriggered = new Date();
    this.stats.consecutiveTriggers += 1;
    await this.save();
};

/**
 * Reset consecutive trigger counter
 */
AIGatewayAlertRuleSchema.methods.resetConsecutive = async function() {
    this.stats.consecutiveTriggers = 0;
    await this.save();
};

// ────────────────────────────────────────────────────────────────────────────
// 📦 EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = mongoose.model('AIGatewayAlertRule', AIGatewayAlertRuleSchema);

