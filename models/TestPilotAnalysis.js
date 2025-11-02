/**
 * ============================================================================
 * TEST PILOT ANALYSIS MODEL - ENTERPRISE LLM SUGGESTION STORAGE
 * ============================================================================
 * 
 * PURPOSE:
 * Stores deep LLM analysis results from Test Pilot testing sessions.
 * Each test call generates one analysis document with suggestions, conflicts,
 * cost projections, and before/after simulations.
 * 
 * ARCHITECTURE:
 * - One analysis per test call
 * - Links to template and test result
 * - Stores LLM suggestions with priority ranking
 * - Tracks which suggestions were applied/ignored
 * - Enables trend analysis and improvement tracking
 * 
 * DEPENDENCIES:
 * - mongoose (ODM)
 * - GlobalInstantResponseTemplate (references templateId)
 * - LLMCallLog (references testCallId)
 * 
 * EXPORTS:
 * - TestPilotAnalysis (Mongoose model)
 * 
 * USED BY:
 * - EnterpriseAISuggestionEngine (creates analysis)
 * - TrendAnalyzer (queries historical data)
 * - routes/admin/enterpriseSuggestions (API endpoints)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * ============================================================================
 * SUGGESTION SCHEMA - INDIVIDUAL LLM RECOMMENDATIONS
 * ============================================================================
 */
const suggestionSchema = new Schema({
    // ============================================
    // SUGGESTION IDENTITY
    // ============================================
    suggestionId: {
        type: String,
        required: true,
        trim: true
        // Unique ID for this suggestion (ULID)
    },
    
    type: {
        type: String,
        enum: ['MISSING_TRIGGER', 'MISSING_FILLER', 'MISSING_SYNONYM', 'MISSING_KEYWORD', 'CONFLICT', 'EDGE_CASE'],
        required: true
        // Category of suggestion
    },
    
    priority: {
        type: String,
        enum: ['HIGH', 'MEDIUM', 'LOW', 'CRITICAL'],
        required: true
        // Calculated based on impact score
    },
    
    // ============================================
    // SUGGESTION CONTENT
    // ============================================
    title: {
        type: String,
        required: true,
        trim: true
        // Short summary (e.g., "Missing trigger: 'not working'")
    },
    
    description: {
        type: String,
        required: true,
        trim: true
        // Detailed explanation of why this matters
    },
    
    suggestedWords: [{
        type: String,
        trim: true
        // Actual words/phrases to add
    }],
    
    targetScenario: {
        scenarioId: { type: String, trim: true },
        scenarioName: { type: String, trim: true },
        categoryId: { type: String, trim: true },
        categoryName: { type: String, trim: true }
        // Which scenario this suggestion applies to
    },
    
    // ============================================
    // IMPACT ANALYSIS
    // ============================================
    impactScore: {
        type: Number,
        required: true,
        min: 0,
        max: 100
        // Calculated: frequency × confidenceGain × costSavings
    },
    
    estimatedConfidenceGain: {
        type: Number,
        required: true,
        min: 0,
        max: 1
        // Expected improvement in confidence (0.15 = +15%)
    },
    
    patternFrequency: {
        type: Number,
        required: true,
        min: 0,
        max: 1
        // How often this pattern appears in tests (0.34 = 34% of calls)
    },
    
    estimatedDailySavings: {
        type: Number,
        required: true,
        min: 0
        // USD saved per day if applied ($0.45/day)
    },
    
    // ============================================
    // BEFORE/AFTER SIMULATION
    // ============================================
    beforeMetrics: {
        confidence: { type: Number, min: 0, max: 1 },
        tier: { type: String, enum: ['tier1', 'tier2', 'tier3'] },
        cost: { type: Number, min: 0 },
        responseTimeMs: { type: Number, min: 0 }
    },
    
    afterMetrics: {
        confidence: { type: Number, min: 0, max: 1 },
        tier: { type: String, enum: ['tier1', 'tier2', 'tier3'] },
        cost: { type: Number, min: 0 },
        responseTimeMs: { type: Number, min: 0 }
    },
    
    // ============================================
    // SUGGESTION STATUS
    // ============================================
    status: {
        type: String,
        enum: ['pending', 'applied', 'ignored', 'rejected'],
        default: 'pending'
    },
    
    appliedAt: { type: Date },
    appliedBy: { type: String, trim: true },
    
    ignoredAt: { type: Date },
    ignoredBy: { type: String, trim: true },
    ignoredReason: { type: String, trim: true },
    
    // ============================================
    // METADATA
    // ============================================
    createdAt: {
        type: Date,
        default: Date.now,
        immutable: true
    }
    
}, { _id: false });

/**
 * ============================================================================
 * CONFLICT SCHEMA - DETECTED ROUTING ISSUES
 * ============================================================================
 */
const conflictSchema = new Schema({
    conflictId: {
        type: String,
        required: true,
        trim: true
    },
    
    type: {
        type: String,
        enum: ['TRIGGER_COLLISION', 'SYNONYM_OVERLAP', 'ROUTING_AMBIGUITY'],
        required: true
    },
    
    severity: {
        type: String,
        enum: ['CRITICAL', 'WARNING', 'INFO'],
        required: true
    },
    
    description: {
        type: String,
        required: true,
        trim: true
    },
    
    affectedScenarios: [{
        scenarioId: { type: String, trim: true },
        scenarioName: { type: String, trim: true },
        categoryName: { type: String, trim: true }
    }],
    
    conflictingElements: [{
        type: String,
        trim: true
        // The actual triggers/synonyms that conflict
    }],
    
    smartFixes: [{
        action: {
            type: String,
            enum: ['ADD_TO_BOTH', 'CREATE_NEW_SCENARIO', 'MERGE_SCENARIOS', 'ADJUST_THRESHOLD'],
            required: true
        },
        description: { type: String, trim: true }
    }],
    
    status: {
        type: String,
        enum: ['open', 'resolved', 'ignored'],
        default: 'open'
    },
    
    resolvedAt: { type: Date },
    resolvedBy: { type: String, trim: true }
    
}, { _id: false });

/**
 * ============================================================================
 * MAIN TEST PILOT ANALYSIS SCHEMA
 * ============================================================================
 */
const testPilotAnalysisSchema = new Schema({
    // ============================================
    // IDENTITY & REFERENCES
    // ============================================
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true,
        index: true
        // Which template was being tested
    },
    
    testCallId: {
        type: Schema.Types.ObjectId,
        ref: 'LLMCallLog',
        required: false,
        index: true
        // Links to the actual test call (if available)
    },
    
    // ============================================
    // TEST DETAILS
    // ============================================
    testPhrase: {
        type: String,
        required: true,
        trim: true
        // What the developer/customer said
    },
    
    intelligenceMode: {
        type: String,
        enum: ['MAXIMUM', 'BALANCED', 'MINIMAL'],
        required: true
        // Which preset was used for this test
    },
    
    // ============================================
    // TIER RESULTS
    // ============================================
    tierResults: {
        tier1: {
            confidence: { type: Number, min: 0, max: 1 },
            matched: { type: Boolean },
            scenario: { type: Schema.Types.Mixed },
            responseTimeMs: { type: Number, min: 0 },
            matchedFillers: [{ type: String }],
            matchedSynonyms: { type: Map, of: String },
            matchedKeywords: [{ type: String }],
            matchedTriggers: [{ type: String }]
        },
        tier2: {
            confidence: { type: Number, min: 0, max: 1 },
            matched: { type: Boolean },
            scenario: { type: Schema.Types.Mixed },
            responseTimeMs: { type: Number, min: 0 }
        },
        tier3: {
            confidence: { type: Number, min: 0, max: 1 },
            matched: { type: Boolean },
            scenario: { type: Schema.Types.Mixed },
            responseTimeMs: { type: Number, min: 0 },
            llmModel: { type: String, trim: true },
            cost: { type: Number, min: 0 }
        },
        finalTier: {
            type: String,
            enum: ['tier1', 'tier2', 'tier3'],
            required: true
        },
        finalConfidence: {
            type: Number,
            required: true,
            min: 0,
            max: 1
        }
    },
    
    // ============================================
    // LLM DEEP ANALYSIS (Qualitative)
    // ============================================
    llmAnalysis: {
        missingFillers: [{ type: String, trim: true }],
        missingTriggers: [{ type: String, trim: true }],
        missingSynonyms: [{
            colloquial: { type: String, trim: true },
            technical: { type: String, trim: true }
        }],
        missingKeywords: [{ type: String, trim: true }],
        contextConfusion: { type: String, trim: true },
        suggestedScenario: { type: String, trim: true },
        edgeCases: [{
            phrase: { type: String, trim: true },
            likelihood: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW'] }
        }],
        reasoning: { type: String, trim: true }
        // Why Tier 1 failed - LLM's explanation
    },
    
    // ============================================
    // SUGGESTIONS (Actionable)
    // ============================================
    suggestions: [suggestionSchema],
    
    suggestionsSummary: {
        total: { type: Number, default: 0 },
        high: { type: Number, default: 0 },
        medium: { type: Number, default: 0 },
        low: { type: Number, default: 0 },
        critical: { type: Number, default: 0 },
        applied: { type: Number, default: 0 },
        ignored: { type: Number, default: 0 },
        pending: { type: Number, default: 0 }
    },
    
    // ============================================
    // CONFLICTS (Detected Issues)
    // ============================================
    conflicts: [conflictSchema],
    
    conflictsSummary: {
        total: { type: Number, default: 0 },
        critical: { type: Number, default: 0 },
        warnings: { type: Number, default: 0 },
        resolved: { type: Number, default: 0 },
        open: { type: Number, default: 0 }
    },
    
    // ============================================
    // COST ANALYSIS
    // ============================================
    costAnalysis: {
        analysisCost: { type: Number, default: 0 },
        projectedDailySavings: { type: Number, default: 0 },
        projectedMonthlySavings: { type: Number, default: 0 },
        roi: { type: Number, default: 0 },
        paybackDays: { type: Number, default: 0 }
        // How many days until analysis cost is recovered
    },
    
    // ============================================
    // METADATA
    // ============================================
    analyzedAt: {
        type: Date,
        default: Date.now,
        immutable: true,
        index: true
    },
    
    analyzedBy: {
        type: String,
        trim: true,
        default: 'Enterprise AI Suggestion Engine'
    },
    
    analysisVersion: {
        type: String,
        trim: true,
        default: '1.0.0'
        // Track which version of analyzer generated this
    }
    
}, {
    timestamps: true,
    collection: 'testPilotAnalyses'
});

// ============================================
// INDEXES FOR PERFORMANCE
// ============================================
testPilotAnalysisSchema.index({ templateId: 1, analyzedAt: -1 });
testPilotAnalysisSchema.index({ 'tierResults.finalTier': 1, analyzedAt: -1 });
testPilotAnalysisSchema.index({ intelligenceMode: 1, analyzedAt: -1 });
testPilotAnalysisSchema.index({ 'suggestions.status': 1 });
testPilotAnalysisSchema.index({ 'conflicts.status': 1 });

// ============================================
// INSTANCE METHODS
// ============================================

/**
 * Get pending suggestions
 * @returns {Array} Array of pending suggestions
 */
testPilotAnalysisSchema.methods.getPendingSuggestions = function() {
    return this.suggestions.filter(s => s.status === 'pending');
};

/**
 * Get high priority suggestions
 * @returns {Array} Array of high/critical priority suggestions
 */
testPilotAnalysisSchema.methods.getHighPrioritySuggestions = function() {
    return this.suggestions.filter(s => 
        (s.priority === 'HIGH' || s.priority === 'CRITICAL') && 
        s.status === 'pending'
    );
};

/**
 * Get open conflicts
 * @returns {Array} Array of unresolved conflicts
 */
testPilotAnalysisSchema.methods.getOpenConflicts = function() {
    return this.conflicts.filter(c => c.status === 'open');
};

/**
 * Mark suggestion as applied
 * @param {String} suggestionId - ID of suggestion to mark
 * @param {String} appliedBy - Who applied it
 */
testPilotAnalysisSchema.methods.applySuggestion = function(suggestionId, appliedBy) {
    const suggestion = this.suggestions.find(s => s.suggestionId === suggestionId);
    if (suggestion) {
        suggestion.status = 'applied';
        suggestion.appliedAt = new Date();
        suggestion.appliedBy = appliedBy;
        
        // Update summary
        this.suggestionsSummary.applied++;
        this.suggestionsSummary.pending--;
    }
};

/**
 * Mark suggestion as ignored
 * @param {String} suggestionId - ID of suggestion to mark
 * @param {String} ignoredBy - Who ignored it
 * @param {String} reason - Why it was ignored
 */
testPilotAnalysisSchema.methods.ignoreSuggestion = function(suggestionId, ignoredBy, reason) {
    const suggestion = this.suggestions.find(s => s.suggestionId === suggestionId);
    if (suggestion) {
        suggestion.status = 'ignored';
        suggestion.ignoredAt = new Date();
        suggestion.ignoredBy = ignoredBy;
        suggestion.ignoredReason = reason;
        
        // Update summary
        this.suggestionsSummary.ignored++;
        this.suggestionsSummary.pending--;
    }
};

// ============================================
// STATIC METHODS
// ============================================

/**
 * Get recent analyses for a template
 * @param {String} templateId - Template ID
 * @param {Number} limit - Max results
 * @returns {Array} Recent analyses
 */
testPilotAnalysisSchema.statics.getRecentForTemplate = async function(templateId, limit = 10) {
    return await this.find({ templateId })
        .sort({ analyzedAt: -1 })
        .limit(limit);
};

/**
 * Get trend data for a template
 * @param {String} templateId - Template ID
 * @param {Number} days - Days to look back
 * @returns {Object} Trend data
 */
testPilotAnalysisSchema.statics.getTrendData = async function(templateId, days = 30) {
    const since = new Date();
    since.setDate(since.getDate() - days);
    
    const analyses = await this.find({
        templateId,
        analyzedAt: { $gte: since }
    }).sort({ analyzedAt: 1 });
    
    return {
        totalTests: analyses.length,
        averageConfidence: analyses.reduce((sum, a) => sum + a.tierResults.finalConfidence, 0) / analyses.length,
        tierDistribution: {
            tier1: analyses.filter(a => a.tierResults.finalTier === 'tier1').length,
            tier2: analyses.filter(a => a.tierResults.finalTier === 'tier2').length,
            tier3: analyses.filter(a => a.tierResults.finalTier === 'tier3').length
        },
        totalSuggestions: analyses.reduce((sum, a) => sum + a.suggestionsSummary.total, 0),
        appliedSuggestions: analyses.reduce((sum, a) => sum + a.suggestionsSummary.applied, 0),
        totalConflicts: analyses.reduce((sum, a) => sum + a.conflictsSummary.total, 0),
        resolvedConflicts: analyses.reduce((sum, a) => sum + a.conflictsSummary.resolved, 0),
        totalCost: analyses.reduce((sum, a) => sum + a.costAnalysis.analysisCost, 0),
        projectedSavings: analyses.reduce((sum, a) => sum + a.costAnalysis.projectedMonthlySavings, 0)
    };
};

const TestPilotAnalysis = mongoose.model('TestPilotAnalysis', testPilotAnalysisSchema);

module.exports = TestPilotAnalysis;

