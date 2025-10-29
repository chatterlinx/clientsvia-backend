// ============================================================================
// 💡 AI GATEWAY - SUGGESTION MODEL
// ============================================================================
// PURPOSE: Store LLM-generated suggestions for template improvements
// FEATURES: Filler words, synonyms, keywords, missing scenarios
// INTEGRATIONS: LLMAnalyzer (creates), SuggestionApplier (applies), UI (displays)
// CREATED: 2025-10-29
// ============================================================================

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ────────────────────────────────────────────────────────────────────────────
// 📋 SCHEMA DEFINITION
// ────────────────────────────────────────────────────────────────────────────

const AIGatewaySuggestionSchema = new Schema({
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔑 IDENTIFIERS & TYPE
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    type: {
        type: String,
        enum: ['filler-words', 'synonym', 'keywords', 'negative-keywords', 'missing-scenario'],
        required: true,
        index: true,
    },
    
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true,
        index: true,
    },
    
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
    },
    
    callLogId: {
        type: Schema.Types.ObjectId,
        ref: 'AIGatewayCallLog',
        required: true,
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🎯 PRIORITY & STATUS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium',
        index: true,
    },
    
    confidence: {
        type: Number,
        min: 0,
        max: 1,
        default: 0.5,
    },
    
    status: {
        type: String,
        enum: ['pending', 'applied', 'ignored', 'saved'],
        default: 'pending',
        index: true,
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🧠 LLM ANALYSIS DATA
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    llmReasoning: {
        type: String,
        required: true,
    },
    
    llmModel: {
        type: String,
    },
    
    llmCost: {
        type: Number,
        default: 0,
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📊 IMPACT ANALYSIS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    impact: {
        similarCallsThisMonth: { type: Number, default: 0 },
        similarCallsLastMonth: { type: Number, default: 0 },
        projectedNextMonth: { type: Number, default: 0 },
        estimatedMonthlySavings: { type: Number, default: 0 },
        estimatedAnnualSavings: { type: Number, default: 0 },
        performanceGain: { type: Number, default: 0 },
        affectedCalls: { type: Number, default: 0 },
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📝 TYPE-SPECIFIC DATA
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    // For type='filler-words'
    fillerWords: {
        type: [String],
    },
    
    // For type='synonym'
    synonymMapping: {
        colloquial: { type: String },
        technical: { type: String },
        additionalMappings: [{
            colloquial: String,
            technical: String,
            occurrences: Number
        }],
    },
    
    // For type='keywords' or 'negative-keywords'
    scenarioId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseScenario',
    },
    
    categoryId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseCategory',
    },
    
    suggestedKeywords: {
        type: [String],
    },
    
    suggestedNegativeKeywords: {
        type: [String],
    },
    
    // For type='missing-scenario'
    suggestedScenarioName: {
        type: String,
    },
    
    suggestedCategory: {
        type: String,
    },
    
    suggestedKeywordsForScenario: {
        type: [String],
    },
    
    suggestedNegativeKeywordsForScenario: {
        type: [String],
    },
    
    suggestedResponse: {
        type: String,
    },
    
    suggestedActionHook: {
        type: String,
    },
    
    suggestedBehavior: {
        type: String,
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📅 TIMESTAMPS & TRACKING
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    },
    
    updatedAt: {
        type: Date,
        default: Date.now
    },
    
    appliedAt: {
        type: Date,
    },
    
    appliedBy: {
        type: Schema.Types.ObjectId,
        ref: 'v2User',
    },
    
    ignoredAt: {
        type: Date,
    },
    
    ignoredBy: {
        type: Schema.Types.ObjectId,
        ref: 'v2User',
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔗 RELATED SUGGESTIONS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    relatedSuggestions: {
        type: [Schema.Types.ObjectId],
        ref: 'AIGatewaySuggestion',
    }
}, {
    timestamps: false, // Using manual timestamp fields
    collection: 'aiGatewaySuggestions'
});

// ────────────────────────────────────────────────────────────────────────────
// 🔍 INDEXES FOR PERFORMANCE
// ────────────────────────────────────────────────────────────────────────────

// Compound index for common queries
AIGatewaySuggestionSchema.index({ templateId: 1, status: 1, priority: -1, createdAt: -1 });
AIGatewaySuggestionSchema.index({ companyId: 1, status: 1 });
AIGatewaySuggestionSchema.index({ priority: 1, status: 1 });
AIGatewaySuggestionSchema.index({ type: 1, status: 1 });

// ────────────────────────────────────────────────────────────────────────────
// 📊 STATIC METHODS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Get suggestion statistics
 */
AIGatewaySuggestionSchema.statics.getStats = async function(templateId = null) {
    const query = templateId ? { templateId: mongoose.Types.ObjectId(templateId) } : {};
    
    const stats = await this.aggregate([
        { $match: query },
        {
            $group: {
                _id: '$status',
                count: { $sum: 1 }
            }
        }
    ]);
    
    const result = {
        pending: 0,
        applied: 0,
        ignored: 0,
        saved: 0
    };
    
    stats.forEach(stat => {
        result[stat._id] = stat.count;
    });
    
    return result;
};

/**
 * Find related suggestions (similar patterns)
 */
AIGatewaySuggestionSchema.statics.findRelated = async function(suggestionId, limit = 3) {
    const suggestion = await this.findById(suggestionId);
    if (!suggestion) return [];
    
    return await this.find({
        _id: { $ne: suggestionId },
        templateId: suggestion.templateId,
        type: suggestion.type,
        status: 'pending'
    })
    .sort({ priority: -1, createdAt: -1 })
    .limit(limit)
    .exec();
};

// ────────────────────────────────────────────────────────────────────────────
// 🎯 INSTANCE METHODS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Get brief description for UI display
 */
AIGatewaySuggestionSchema.methods.getBriefDescription = function() {
    switch (this.type) {
        case 'filler-words':
            return `Add ${this.fillerWords.length} filler words`;
        case 'synonym':
            return `Add synonym: "${this.synonymMapping.colloquial}" → "${this.synonymMapping.technical}"`;
        case 'keywords':
            return `Add ${this.suggestedKeywords.length} keywords to scenario`;
        case 'negative-keywords':
            return `Add ${this.suggestedNegativeKeywords.length} negative keywords`;
        case 'missing-scenario':
            return `Create new scenario: "${this.suggestedScenarioName}"`;
        default:
            return 'Unknown suggestion type';
    }
};

/**
 * Get impact summary for UI display
 */
AIGatewaySuggestionSchema.methods.getImpactSummary = function() {
    if (this.type === 'missing-scenario') {
        return `${this.impact.affectedCalls} unmatched calls this month`;
    }
    return `Saves $${this.impact.estimatedMonthlySavings.toFixed(2)}/mo | ${this.impact.similarCallsThisMonth} similar calls`;
};

/**
 * Mark suggestion as applied
 */
AIGatewaySuggestionSchema.methods.markApplied = async function(userId) {
    this.status = 'applied';
    this.appliedAt = new Date();
    this.appliedBy = userId;
    this.updatedAt = new Date();
    return await this.save();
};

/**
 * Mark suggestion as ignored
 */
AIGatewaySuggestionSchema.methods.markIgnored = async function(userId) {
    this.status = 'ignored';
    this.ignoredAt = new Date();
    this.ignoredBy = userId;
    this.updatedAt = new Date();
    return await this.save();
};

// ────────────────────────────────────────────────────────────────────────────
// 📦 MODEL EXPORT
// ────────────────────────────────────────────────────────────────────────────

const AIGatewaySuggestion = mongoose.model('AIGatewaySuggestion', AIGatewaySuggestionSchema);

module.exports = AIGatewaySuggestion;

