/**
 * ============================================================================
 * LLM CALL LOG MODEL - 3-TIER INTELLIGENCE SYSTEM TRACKING
 * ============================================================================
 * 
 * PURPOSE:
 * Tracks every LLM call (Tier 3) for cost analysis, pattern learning, and
 * self-improvement metrics. Essential for monitoring the Week 1 → Week 24
 * progression from 70% LLM usage → 2% LLM usage as the system learns.
 * 
 * TRACKING METRICS:
 * - Which tier was used (1, 2, or 3)
 * - Confidence scores at each tier
 * - Response times
 * - Cost per call
 * - Patterns learned from this call
 * - Template/company context
 * 
 * BUSINESS VALUE:
 * - Cost tracking: $350/month → $10/month
 * - Performance: Tracks tier distribution over time
 * - Learning: Records which patterns were extracted
 * - ROI: Measures savings vs baseline
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const llmCallLogSchema = new Schema({
    // ============================================
    // CALL CONTEXT
    // ============================================
    
    callId: {
        type: String,
        required: true,
        index: true
        // Reference to the actual phone/SMS/chat call
    },
    
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
        index: true
        // Which company made this call (null = test call)
    },
    
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true,
        index: true
        // Which template was being used
    },
    
    templateName: {
        type: String,
        trim: true
        // Snapshot of template name for reporting
    },
    
    // ============================================
    // TIER ROUTING & PERFORMANCE
    // ============================================
    
    tierUsed: {
        type: Number,
        required: true,
        enum: [1, 2, 3],
        index: true
        // 1 = Rule-based (HybridScenarioSelector)
        // 2 = Semantic (BM25 + context)
        // 3 = LLM (GPT-4/Claude)
    },
    
    tier1Result: {
        attempted: { type: Boolean, default: false },
        confidence: { type: Number, min: 0, max: 1 },
        matchedScenario: { type: String },
        responseTime: { type: Number },  // ms
        reason: { type: String }  // Why did it pass/fail threshold?
    },
    
    tier2Result: {
        attempted: { type: Boolean, default: false },
        confidence: { type: Number, min: 0, max: 1 },
        matchedScenario: { type: String },
        responseTime: { type: Number },  // ms
        reason: { type: String }
    },
    
    tier3Result: {
        attempted: { type: Boolean, default: false },
        confidence: { type: Number, min: 0, max: 1 },
        matchedScenario: { type: String },
        responseTime: { type: Number },  // ms
        llmModel: { type: String },  // gpt-4-turbo, gpt-3.5-turbo, claude-3-opus
        llmProvider: { type: String, enum: ['openai', 'anthropic'] },
        tokensUsed: {
            prompt: { type: Number },
            completion: { type: Number },
            total: { type: Number }
        },
        cost: { type: Number },  // USD
        reason: { type: String }
    },
    
    // ============================================
    // CALL DATA
    // ============================================
    
    callerInput: {
        type: String,
        required: true
        // What the caller said (or typed)
    },
    
    normalizedInput: {
        type: String
        // After filler removal, synonym translation
    },
    
    finalResponse: {
        type: String
        // What the AI responded with
    },
    
    scenarioMatched: {
        scenarioId: { type: String },
        scenarioName: { type: String },
        categoryName: { type: String },
        confidence: { type: Number, min: 0, max: 1 }
    },
    
    // ============================================
    // LEARNING OUTCOMES
    // ============================================
    
    patternsLearned: [{
        type: {
            type: String,
            enum: ['synonym', 'filler', 'keyword', 'negative_keyword']
        },
        data: { type: Schema.Types.Mixed },
        confidence: { type: Number },
        appliedToTemplate: { type: Boolean, default: false },
        appliedAt: { type: Date }
    }],
    
    learningQuality: {
        patternsDetected: { type: Number, default: 0 },
        patternsApplied: { type: Number, default: 0 },
        qualityScore: { type: Number, min: 0, max: 100 }
        // How useful was this LLM call for learning?
    },
    
    // ============================================
    // COST TRACKING
    // ============================================
    
    costBreakdown: {
        llmApiCost: { type: Number, default: 0 },  // USD
        tier1Cost: { type: Number, default: 0 },    // Always $0
        tier2Cost: { type: Number, default: 0 },    // Always $0
        totalCost: { type: Number, default: 0 }     // USD
    },
    
    // ============================================
    // PERFORMANCE METRICS
    // ============================================
    
    performanceMetrics: {
        totalTime: { type: Number },  // Total time from input to response (ms)
        tier1Time: { type: Number, default: 0 },
        tier2Time: { type: Number, default: 0 },
        tier3Time: { type: Number, default: 0 },
        cacheHit: { type: Boolean, default: false },
        cacheSource: { type: String, enum: ['redis', 'memory', 'none'], default: 'none' }
    },
    
    // ============================================
    // SELF-IMPROVEMENT TRACKING
    // ============================================
    
    selfImprovementImpact: {
        // If Tier 1 succeeded: This call was "free" thanks to past learning
        savedCost: { type: Number, default: 0 },  // USD that would have been spent on LLM
        
        // If Tier 3 was used: Contributed to learning
        contributedPatterns: { type: Number, default: 0 },
        
        // Estimated future savings from patterns learned in this call
        projectedSavings: { type: Number, default: 0 }  // USD/month
    },
    
    // ============================================
    // ERROR TRACKING
    // ============================================
    
    errors: [{
        tier: { type: Number, enum: [1, 2, 3] },
        errorType: { type: String },
        errorMessage: { type: String },
        timestamp: { type: Date, default: Date.now }
    }],
    
    // ============================================
    // METADATA
    // ============================================
    
    callType: {
        type: String,
        enum: ['test', 'production'],
        default: 'production',
        index: true
        // test: From testing center
        // production: Real customer call
    },
    
    channel: {
        type: String,
        enum: ['voice', 'sms', 'chat'],
        default: 'voice'
    },
    
    environment: {
        type: String,
        enum: ['development', 'staging', 'production'],
        default: 'production'
    },
    
    // Week number for trend analysis (Week 1 → Week 24)
    weekNumber: {
        type: Number,
        min: 1,
        max: 52,
        index: true
        // Auto-calculated: Math.floor((Date.now() - template.createdAt) / (7 * 24 * 60 * 60 * 1000))
    },
    
    monthYear: {
        type: String,
        index: true
        // Format: "2025-10" for monthly aggregation
    }
    
}, {
    timestamps: true,
    collection: 'llmcalllogs'
});

// ============================================
// INDEXES FOR PERFORMANCE & REPORTING
// ============================================

// Cost tracking by template + month
llmCallLogSchema.index({ templateId: 1, monthYear: 1, tierUsed: 1 });

// Week-over-week analysis
llmCallLogSchema.index({ templateId: 1, weekNumber: 1 });

// Company-specific analytics
llmCallLogSchema.index({ companyId: 1, createdAt: -1 });

// Cost queries
llmCallLogSchema.index({ templateId: 1, 'costBreakdown.totalCost': -1 });

// Learning queries
llmCallLogSchema.index({ templateId: 1, 'learningQuality.patternsApplied': -1 });

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get tier distribution for a template in a given time period
 */
llmCallLogSchema.statics.getTierDistribution = async function(templateId, startDate, endDate) {
    const pipeline = [
        {
            $match: {
                templateId: new mongoose.Types.ObjectId(templateId),
                createdAt: { $gte: startDate, $lte: endDate }
            }
        },
        {
            $group: {
                _id: '$tierUsed',
                count: { $sum: 1 },
                totalCost: { $sum: '$costBreakdown.totalCost' },
                avgResponseTime: { $avg: '$performanceMetrics.totalTime' }
            }
        }
    ];
    
    const results = await this.aggregate(pipeline);
    
    const total = results.reduce((sum, r) => sum + r.count, 0);
    
    return {
        tier1: {
            count: results.find(r => r._id === 1)?.count || 0,
            percentage: total > 0 ? ((results.find(r => r._id === 1)?.count || 0) / total * 100).toFixed(1) : 0,
            cost: 0,
            avgResponseTime: results.find(r => r._id === 1)?.avgResponseTime || 0
        },
        tier2: {
            count: results.find(r => r._id === 2)?.count || 0,
            percentage: total > 0 ? ((results.find(r => r._id === 2)?.count || 0) / total * 100).toFixed(1) : 0,
            cost: 0,
            avgResponseTime: results.find(r => r._id === 2)?.avgResponseTime || 0
        },
        tier3: {
            count: results.find(r => r._id === 3)?.count || 0,
            percentage: total > 0 ? ((results.find(r => r._id === 3)?.count || 0) / total * 100).toFixed(1) : 0,
            cost: results.find(r => r._id === 3)?.totalCost || 0,
            avgResponseTime: results.find(r => r._id === 3)?.avgResponseTime || 0
        },
        total: {
            calls: total,
            cost: results.reduce((sum, r) => sum + (r.totalCost || 0), 0)
        }
    };
};

/**
 * Get weekly progression for self-improvement cycle
 */
llmCallLogSchema.statics.getWeeklyProgression = async function(templateId) {
    const pipeline = [
        {
            $match: { templateId: new mongoose.Types.ObjectId(templateId) }
        },
        {
            $group: {
                _id: '$weekNumber',
                tier1: { $sum: { $cond: [{ $eq: ['$tierUsed', 1] }, 1, 0] } },
                tier2: { $sum: { $cond: [{ $eq: ['$tierUsed', 2] }, 1, 0] } },
                tier3: { $sum: { $cond: [{ $eq: ['$tierUsed', 3] }, 1, 0] } },
                totalCost: { $sum: '$costBreakdown.totalCost' },
                patternsLearned: { $sum: '$learningQuality.patternsApplied' }
            }
        },
        { $sort: { _id: 1 } },
        { $limit: 24 }  // First 24 weeks
    ];
    
    return this.aggregate(pipeline);
};

/**
 * Calculate cost savings vs baseline
 */
llmCallLogSchema.statics.getCostSavings = async function(templateId, baselineCost = 350) {
    const currentMonth = new Date().toISOString().substring(0, 7);
    
    const result = await this.aggregate([
        {
            $match: {
                templateId: new mongoose.Types.ObjectId(templateId),
                monthYear: currentMonth
            }
        },
        {
            $group: {
                _id: null,
                totalCost: { $sum: '$costBreakdown.totalCost' },
                callCount: { $sum: 1 }
            }
        }
    ]);
    
    const currentCost = result[0]?.totalCost || 0;
    const savings = baselineCost - currentCost;
    const savingsPercentage = baselineCost > 0 ? (savings / baselineCost * 100).toFixed(1) : 0;
    
    return {
        baseline: baselineCost,
        current: currentCost,
        savings,
        savingsPercentage,
        callCount: result[0]?.callCount || 0
    };
};

module.exports = mongoose.model('LLMCallLog', llmCallLogSchema);

