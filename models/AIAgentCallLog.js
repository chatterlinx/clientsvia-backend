// ============================================================================
// AI AGENT CALL LOG MODEL - PERFORMANCE TRACKING & LEARNING
// 📋 DESCRIPTION: Logs every AI agent interaction for performance analysis
// 🎯 PURPOSE: Enable smart threshold optimization based on real call data
// 🔧 FEATURES: 
//     - Tracks every customer query and AI response
//     - Records confidence scores and routing decisions
//     - Enables historical analysis for optimization
//     - Company-specific performance tracking
// 📊 ANALYTICS:
//     - Success/failure rates per knowledge source
//     - Confidence score distributions over time
//     - Common query patterns and missed opportunities
//     - Optimal threshold calculations based on real data
// ============================================================================

const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;

const aiAgentCallLogSchema = new mongoose.Schema({
    // Company Association
    companyId: {
        type: ObjectId,
        ref: 'Company',
        required: true,
        index: true // Critical for fast company-specific queries
    },
    
    // Call Metadata
    callId: {
        type: String,
        index: true // For tracking multi-turn conversations
    },
    
    sessionId: {
        type: String,
        index: true // For tracking entire customer sessions
    },
    
    // Query Information
    customerQuery: {
        type: String,
        required: true,
        trim: true,
        maxLength: 1000
    },
    
    queryType: {
        type: String,
        enum: ['hours', 'pricing', 'services', 'emergency', 'booking', 'general', 'other'],
        default: 'general',
        index: true
    },
    
    // AI Agent Routing Decision
    routingFlow: [{
        source: {
            type: String,
            enum: ['companyQnA', 'tradeQnA', 'templates', 'inHouseFallback'],
            required: true
        },
        priority: {
            type: Number,
            min: 1,
            max: 4
        },
        confidence: {
            type: Number,
            min: 0,
            max: 1,
            required: true
        },
        threshold: {
            type: Number,
            min: 0,
            max: 1,
            required: true
        },
        result: {
            type: String,
            enum: ['matched', 'below_threshold', 'skipped', 'error'],
            required: true
        },
        responseTime: {
            type: Number, // milliseconds
            default: 0
        }
    }],
    
    // Final Result
    finalMatchedSource: {
        type: String,
        enum: ['companyQnA', 'tradeQnA', 'templates', 'inHouseFallback', 'none'],
        required: true,
        index: true
    },
    
    finalConfidence: {
        type: Number,
        min: 0,
        max: 1,
        required: true,
        index: true
    },
    
    aiResponse: {
        type: String,
        required: true,
        trim: true,
        maxLength: 2000
    },
    
    // Performance Metrics
    totalResponseTime: {
        type: Number, // milliseconds
        required: true,
        index: true
    },
    
    // Success Indicators
    wasSuccessful: {
        type: Boolean,
        default: null, // null = unknown, true = success, false = failure
        index: true
    },
    
    customerSatisfaction: {
        type: String,
        enum: ['satisfied', 'unsatisfied', 'escalated', 'unknown'],
        default: 'unknown',
        index: true
    },
    
    // Context Information
    timeOfDay: {
        type: String,
        enum: ['morning', 'afternoon', 'evening', 'night'],
        index: true
    },
    
    dayOfWeek: {
        type: String,
        enum: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'],
        index: true
    },
    
    // Optimization Tracking
    thresholdVersion: {
        type: Number,
        default: 1 // Tracks which threshold configuration was used
    },
    
    optimizationId: {
        type: String, // Links to specific optimization runs
        index: true
    },
    
    // Metadata
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    
    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    // Automatic timestamps
    timestamps: true,
    
    // Indexes for performance
    indexes: [
        { companyId: 1, createdAt: -1 }, // Company queries by date
        { companyId: 1, finalMatchedSource: 1 }, // Source performance by company
        { companyId: 1, wasSuccessful: 1 }, // Success rate by company
        { companyId: 1, queryType: 1 }, // Query patterns by company
        { finalConfidence: 1, wasSuccessful: 1 } // Confidence vs success correlation
    ]
});

// 📊 ANALYTICS METHODS
aiAgentCallLogSchema.statics.getPerformanceAnalytics = async function(companyId, days = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const pipeline = [
        {
            $match: {
                companyId: new mongoose.Types.ObjectId(companyId),
                createdAt: { $gte: startDate }
            }
        },
        {
            $group: {
                _id: '$finalMatchedSource',
                totalQueries: { $sum: 1 },
                successfulQueries: {
                    $sum: { $cond: [{ $eq: ['$wasSuccessful', true] }, 1, 0] }
                },
                averageConfidence: { $avg: '$finalConfidence' },
                averageResponseTime: { $avg: '$totalResponseTime' },
                confidenceScores: { $push: '$finalConfidence' }
            }
        }
    ];
    
    return this.aggregate(pipeline);
};

aiAgentCallLogSchema.statics.getOptimalThresholds = async function(companyId, days = 30) {
    const analytics = await this.getPerformanceAnalytics(companyId, days);
    
    const optimalThresholds = {};
    
    analytics.forEach(sourceData => {
        const source = sourceData._id;
        const successRate = sourceData.successfulQueries / sourceData.totalQueries;
        const avgConfidence = sourceData.averageConfidence;
        
        // Calculate optimal threshold based on success rate and confidence distribution
        let optimalThreshold;
        
        if (successRate > 0.8) {
            // High success rate - can lower threshold for more coverage
            optimalThreshold = Math.max(0.45, avgConfidence - 0.1);
        } else if (successRate < 0.6) {
            // Low success rate - raise threshold for better accuracy
            optimalThreshold = Math.min(0.85, avgConfidence + 0.1);
        } else {
            // Balanced - use average confidence as baseline
            optimalThreshold = avgConfidence;
        }
        
        optimalThresholds[source] = Math.round(optimalThreshold * 100) / 100;
    });
    
    return optimalThresholds;
};

// 🔄 MIDDLEWARE
aiAgentCallLogSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    
    // Auto-detect time of day
    const hour = this.createdAt.getHours();
    if (hour >= 6 && hour < 12) this.timeOfDay = 'morning';
    else if (hour >= 12 && hour < 17) this.timeOfDay = 'afternoon';
    else if (hour >= 17 && hour < 21) this.timeOfDay = 'evening';
    else this.timeOfDay = 'night';
    
    // Auto-detect day of week
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    this.dayOfWeek = days[this.createdAt.getDay()];
    
    next();
});

module.exports = mongoose.model('AIAgentCallLog', aiAgentCallLogSchema);
