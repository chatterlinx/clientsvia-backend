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
        description: 'Type of improvement suggested'
    },
    
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true,
        index: true,
        description: 'Template this suggestion applies to'
    },
    
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
        description: 'Company (if company-specific suggestion)'
    },
    
    callLogId: {
        type: Schema.Types.ObjectId,
        ref: 'AIGatewayCallLog',
        required: true,
        description: 'Source call that triggered this suggestion'
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🎯 PRIORITY & STATUS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    priority: {
        type: String,
        enum: ['low', 'medium', 'high'],
        default: 'medium',
        index: true,
        description: 'Suggestion priority (based on impact)'
    },
    
    confidence: {
        type: Number,
        min: 0,
        max: 1,
        default: 0.5,
        description: 'LLM confidence in this suggestion'
    },
    
    status: {
        type: String,
        enum: ['pending', 'applied', 'ignored', 'saved'],
        default: 'pending',
        index: true,
        description: 'Current status of suggestion'
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🧠 LLM ANALYSIS DATA
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    llmReasoning: {
        type: String,
        required: true,
        description: 'Detailed LLM explanation for this suggestion'
    },
    
    llmModel: {
        type: String,
        description: 'LLM model used (e.g., gpt-4-turbo)'
    },
    
    llmCost: {
        type: Number,
        default: 0,
        description: 'Cost of LLM analysis'
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
        description: 'Estimated business impact if applied'
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 📝 TYPE-SPECIFIC DATA
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    // For type='filler-words'
    fillerWords: {
        type: [String],
        description: 'Filler words to add to template'
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
        description: 'Synonym mapping (colloquial → technical)'
    },
    
    // For type='keywords' or 'negative-keywords'
    scenarioId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseScenario',
        description: 'Scenario to enhance'
    },
    
    categoryId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseCategory',
        description: 'Category this scenario belongs to'
    },
    
    suggestedKeywords: {
        type: [String],
        description: 'Keywords to add to scenario'
    },
    
    suggestedNegativeKeywords: {
        type: [String],
        description: 'Negative keywords to add to scenario'
    },
    
    // For type='missing-scenario'
    suggestedScenarioName: {
        type: String,
        description: 'Name for new scenario'
    },
    
    suggestedCategory: {
        type: String,
        description: 'Category for new scenario'
    },
    
    suggestedKeywordsForScenario: {
        type: [String],
        description: 'Keywords for new scenario'
    },
    
    suggestedNegativeKeywordsForScenario: {
        type: [String],
        description: 'Negative keywords for new scenario'
    },
    
    suggestedResponse: {
        type: String,
        description: 'Response template for new scenario'
    },
    
    suggestedActionHook: {
        type: String,
        description: 'Action hook for new scenario'
    },
    
    suggestedBehavior: {
        type: String,
        description: 'Behavior for new scenario'
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
        description: 'When suggestion was applied'
    },
    
    appliedBy: {
        type: Schema.Types.ObjectId,
        ref: 'v2User',
        description: 'Admin who applied this suggestion'
    },
    
    ignoredAt: {
        type: Date,
        description: 'When suggestion was ignored'
    },
    
    ignoredBy: {
        type: Schema.Types.ObjectId,
        ref: 'v2User',
        description: 'Admin who ignored this suggestion'
    },
    
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    // 🔗 RELATED SUGGESTIONS
    // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
    
    relatedSuggestions: {
        type: [Schema.Types.ObjectId],
        ref: 'AIGatewaySuggestion',
        description: 'Other suggestions with similar patterns'
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

