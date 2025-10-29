// ============================================================================
// 📞 AI GATEWAY - CALL LOG MODEL
// ============================================================================
// PURPOSE: Store detailed logs of all AI agent calls for analysis & learning
// FEATURES: 3-tier routing data, transcripts, costs, performance metrics
// INTEGRATIONS: LLMAnalyzer, SuggestionApplier, HealthMonitor
// TTL: 90 days (auto-deletion for storage optimization)
// CREATED: 2025-10-29
// ============================================================================

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ────────────────────────────────────────────────────────────────────────────
// 📋 SCHEMA DEFINITION
// ────────────────────────────────────────────────────────────────────────────

const AIGatewayCallLogSchema = new Schema({
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔑 IDENTIFIERS & REFERENCES
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
        required: true,
        index: true,
        description: 'Company that received this call'
    },
    
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true,
        index: true,
        description: 'AI template used for this call'
    },
    
    categoryId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseCategory',
        description: 'Matched category (if any)'
    },
    
    scenarioId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseScenario',
        description: 'Matched scenario (if any)'
    },
    
    callId: {
        type: String,
        required: true,
        unique: true,
        index: true,
        description: 'Unique call identifier (Twilio SID)'
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 👤 CALLER INFORMATION
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    callerPhone: {
        type: String,
        description: 'Caller phone number (normalized)'
    },
    
    callerName: {
        type: String,
        description: 'Caller name (if captured)'
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 💬 CONVERSATION DATA
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    transcript: {
        type: String,
        required: true,
        description: 'Full conversation transcript (caller + agent)'
    },
    
    userInput: {
        type: String,
        required: true,
        description: 'Raw user input (before processing)'
    },
    
    processedInput: {
        type: String,
        description: 'User input after filler removal & synonym mapping'
    },
    
    finalResponse: {
        type: String,
        required: true,
        description: 'AI agent response sent to caller'
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🎯 3-TIER ROUTING RESULTS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    tierUsed: {
        type: String,
        enum: ['Tier1', 'Tier2', 'Tier3', 'Fallback'],
        required: true,
        index: true,
        description: 'Which tier successfully matched'
    },
    
    tier1Result: {
        attempted: { type: Boolean, default: false },
        matched: { type: Boolean, default: false },
        confidence: { type: Number, min: 0, max: 1 },
        matchedScenario: { type: String },
        reason: { type: String },
        responseTime: { type: Number },
        description: 'Tier 1 (Rule-Based) matching result'
    },
    
    tier2Result: {
        attempted: { type: Boolean, default: false },
        matched: { type: Boolean, default: false },
        confidence: { type: Number, min: 0, max: 1 },
        matchedScenario: { type: String },
        reason: { type: String },
        responseTime: { type: Number },
        description: 'Tier 2 (Semantic) matching result'
    },
    
    tier3Result: {
        attempted: { type: Boolean, default: false },
        matched: { type: Boolean, default: false },
        confidence: { type: Number, min: 0, max: 1 },
        matchedScenario: { type: String },
        llmModel: { type: String },
        llmTokens: { type: Number },
        llmCost: { type: Number },
        llmReasoning: { type: String },
        reason: { type: String },
        responseTime: { type: Number },
        description: 'Tier 3 (LLM Fallback) matching result'
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // ⚡ PERFORMANCE METRICS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    totalResponseTime: {
        type: Number,
        required: true,
        description: 'Total time to respond (milliseconds)'
    },
    
    cost: {
        type: Number,
        default: 0,
        description: 'Total cost (LLM + API calls)'
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🧠 ANALYSIS & LEARNING FLAGS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    isTest: {
        type: Boolean,
        default: false,
        index: true,
        description: 'True if call came from Test Pilot'
    },
    
    analyzed: {
        type: Boolean,
        default: false,
        index: true,
        description: 'True if LLMAnalyzer has processed this call'
    },
    
    analysisAttempts: {
        type: Number,
        default: 0,
        description: 'Number of times analysis was attempted'
    },
    
    analysisError: {
        type: String,
        description: 'Error message if analysis failed'
    },
    
    suggestionsGenerated: {
        type: Boolean,
        default: false,
        description: 'True if suggestions were created from this call'
    },
    
    suggestionCount: {
        type: Number,
        default: 0,
        description: 'Number of suggestions generated from this call'
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📅 TIMESTAMPS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    timestamp: {
        type: Date,
        default: Date.now,
        index: true,
        description: 'When this call occurred'
    },
    
    analyzedAt: {
        type: Date,
        description: 'When LLM analysis completed'
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📦 ADDITIONAL METADATA
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    metadata: {
        type: Schema.Types.Mixed,
        description: 'Additional call metadata (platform, device, etc.)'
    }
}, {
    timestamps: false, // Using manual timestamp field
    collection: 'aiGatewayCallLogs'
});

// ────────────────────────────────────────────────────────────────────────────
// 🔍 INDEXES FOR PERFORMANCE
// ────────────────────────────────────────────────────────────────────────────

// Compound indexes for common queries
AIGatewayCallLogSchema.index({ companyId: 1, timestamp: -1 });
AIGatewayCallLogSchema.index({ templateId: 1, timestamp: -1 });
AIGatewayCallLogSchema.index({ tierUsed: 1, analyzed: 1, analysisAttempts: 1 });
AIGatewayCallLogSchema.index({ isTest: 1, timestamp: -1 });

// TTL index for automatic deletion after 90 days
AIGatewayCallLogSchema.index(
    { timestamp: 1 },
    { expireAfterSeconds: 7776000 } // 90 days = 90 * 24 * 60 * 60
);

// ────────────────────────────────────────────────────────────────────────────
// 📊 STATIC METHODS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Get call statistics for a template
 */
AIGatewayCallLogSchema.statics.getTemplateStats = async function(templateId, days = 30) {
    const cutoffDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
    
    return await this.aggregate([
        {
            $match: {
                templateId: mongoose.Types.ObjectId(templateId),
                timestamp: { $gte: cutoffDate }
            }
        },
        {
            $group: {
                _id: '$tierUsed',
                count: { $sum: 1 },
                avgCost: { $avg: '$cost' },
                avgResponseTime: { $avg: '$totalResponseTime' }
            }
        }
    ]);
};

/**
 * Find calls needing analysis (Tier 3 only, not yet analyzed)
 */
AIGatewayCallLogSchema.statics.findPendingAnalysis = async function(limit = 10) {
    return await this.find({
        tierUsed: 'Tier3',
        analyzed: false,
        analysisAttempts: { $lt: 3 }
    })
    .sort({ timestamp: 1 })
    .limit(limit)
    .exec();
};

// ────────────────────────────────────────────────────────────────────────────
// 🎯 INSTANCE METHODS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mark this call as analyzed
 */
AIGatewayCallLogSchema.methods.markAnalyzed = async function(success = true, error = null) {
    this.analyzed = success;
    this.analyzedAt = new Date();
    this.analysisAttempts += 1;
    if (error) {
        this.analysisError = error;
    }
    return await this.save();
};

/**
 * Get brief summary for display
 */
AIGatewayCallLogSchema.methods.getBriefSummary = function() {
    return {
        callId: this.callId,
        tier: this.tierUsed,
        confidence: this.tier1Result.confidence || this.tier2Result.confidence || this.tier3Result.confidence || 0,
        cost: this.cost,
        responseTime: this.totalResponseTime,
        timestamp: this.timestamp
    };
};

// ────────────────────────────────────────────────────────────────────────────
// 📦 MODEL EXPORT
// ────────────────────────────────────────────────────────────────────────────

const AIGatewayCallLog = mongoose.model('AIGatewayCallLog', AIGatewayCallLogSchema);

module.exports = AIGatewayCallLog;

