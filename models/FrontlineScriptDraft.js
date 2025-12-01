/**
 * ============================================================================
 * FRONTLINE SCRIPT DRAFT MODEL
 * ============================================================================
 * 
 * PURPOSE: Audit trail for LLM-generated Frontline scripts
 * 
 * STORED: Every time an admin generates a script draft
 * WHY: Compliance, debugging, rollback capability
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const FrontlineScriptDraftSchema = new Schema({
    // ========================================================================
    // IDENTIFIERS
    // ========================================================================
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
        required: true,
        index: true
    },
    
    versionId: {
        type: String,
        required: true,
        index: true
    },
    
    // ========================================================================
    // GENERATED CONTENT
    // ========================================================================
    scriptText: {
        type: String,
        required: true
    },
    
    // ========================================================================
    // GENERATION PARAMETERS
    // ========================================================================
    parameters: {
        adminBrief: { type: String, default: '' },
        tonePreset: { 
            type: String, 
            enum: ['professional_warm', 'casual_friendly', 'strict_corporate', 'empathetic_supportive'],
            default: 'professional_warm'
        },
        aggressiveness: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'medium'
        },
        includeExamples: { type: Boolean, default: true }
    },
    
    // ========================================================================
    // CONTEXT SNAPSHOT (for debugging)
    // ========================================================================
    contextSnapshot: {
        companyName: { type: String },
        trade: { type: String },
        categoriesCount: { type: Number, default: 0 },
        scenariosCount: { type: Number, default: 0 },
        triageCardsCount: { type: Number, default: 0 },
        bookingRulesCount: { type: Number, default: 0 },
        transferRulesCount: { type: Number, default: 0 }
    },
    
    // ========================================================================
    // LLM METADATA
    // ========================================================================
    llmMetadata: {
        model: { type: String, default: 'gpt-4o-mini' },
        promptTokens: { type: Number, default: 0 },
        completionTokens: { type: Number, default: 0 },
        totalTokens: { type: Number, default: 0 },
        cost: { type: Number, default: 0 },
        latencyMs: { type: Number, default: 0 }
    },
    
    // ========================================================================
    // AUDIT
    // ========================================================================
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'v2User',
        required: true
    },
    
    // Track if this draft was actually saved to the cheatsheet
    wasApplied: { type: Boolean, default: false },
    appliedAt: { type: Date, default: null },
    appliedToVersionId: { type: String, default: null }
    
}, {
    timestamps: true,
    collection: 'frontlinescriptdrafts'
});

// ============================================================================
// INDEXES
// ============================================================================
FrontlineScriptDraftSchema.index({ companyId: 1, createdAt: -1 });
FrontlineScriptDraftSchema.index({ createdBy: 1, createdAt: -1 });

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get recent drafts for a company
 */
FrontlineScriptDraftSchema.statics.getRecentDrafts = async function(companyId, limit = 10) {
    return this.find({ companyId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .populate('createdBy', 'email name')
        .lean();
};

/**
 * Mark a draft as applied
 */
FrontlineScriptDraftSchema.statics.markAsApplied = async function(draftId, appliedToVersionId) {
    return this.findByIdAndUpdate(draftId, {
        wasApplied: true,
        appliedAt: new Date(),
        appliedToVersionId
    });
};

module.exports = mongoose.model('FrontlineScriptDraft', FrontlineScriptDraftSchema);

