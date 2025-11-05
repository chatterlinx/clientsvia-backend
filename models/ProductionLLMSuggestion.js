/**
 * ============================================================================
 * PRODUCTION LLM SUGGESTION MODEL
 * ============================================================================
 * 
 * PURPOSE: Store LLM-generated suggestions from REAL production customer calls
 * SCOPE: Multi-tenant (all companies contribute to one global learning pool)
 * 
 * KEY DIFFERENCES FROM TestPilotAnalysis:
 * - TestPilotAnalysis: Temporary suggestions from developer testing
 * - ProductionLLMSuggestion: Permanent suggestions from customer calls
 * 
 * FLOW:
 * 1. Customer calls company → Tier 3 LLM triggered
 * 2. LLM generates suggestion (e.g., "add trigger: leaky pipe")
 * 3. Saved to this collection
 * 4. Admin reviews in LLM Learning Console
 * 5. Approve → Updates Global Template
 * 6. Reject → Marks as dismissed
 * 
 * COST TRACKING:
 * Each suggestion stores the LLM cost, allowing ROI analysis
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');

const ProductionLLMSuggestionSchema = new mongoose.Schema({
    // ========================================================================
    // CORE IDENTIFIERS
    // ========================================================================
    
    templateId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true,
        index: true,
        description: 'Which global template this suggestion applies to'
    },
    
    templateName: {
        type: String,
        required: true,
        description: 'Template name (denormalized for fast querying)'
    },
    
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'v2Company',
        required: true,
        index: true,
        description: 'Which company\'s call generated this suggestion'
    },
    
    companyName: {
        type: String,
        required: true,
        description: 'Company name (denormalized for fast display)'
    },
    
    // 🎯 TEST PILOT INTEGRATION (Phase 1)
    callSource: {
        type: String,
        enum: ['company-test', 'production'],
        required: true,
        index: true,
        description: 'Whether this suggestion came from Test Pilot testing or real production calls'
    },
    
    // ========================================================================
    // SUGGESTION DETAILS
    // ========================================================================
    
    suggestionType: {
        type: String,
        enum: ['trigger', 'synonym', 'filler', 'scenario', 'category', 'keyword', 'pattern', 'other'],
        required: true,
        index: true,
        description: 'What type of improvement is suggested'
    },
    
    suggestion: {
        type: String,
        required: true,
        description: 'Human-readable suggestion text (e.g., "Add trigger: leaky pipe")'
    },
    
    suggestedValue: {
        type: String,
        required: true,
        description: 'The actual value to add (e.g., "leaky pipe")'
    },
    
    targetCategory: {
        type: String,
        description: 'Which category this should be added to (if applicable)'
    },
    
    targetScenario: {
        type: String,
        description: 'Which scenario this should be added to (if applicable)'
    },
    
    confidence: {
        type: Number,
        min: 0,
        max: 1,
        required: true,
        description: 'LLM confidence in this suggestion (0.0 - 1.0)'
    },
    
    priority: {
        type: String,
        enum: ['high', 'medium', 'low'],
        required: true,
        index: true,
        description: 'Priority based on confidence + impact score'
    },
    
    impactScore: {
        type: Number,
        min: 0,
        max: 100,
        description: 'Estimated impact on template performance (0-100)'
    },
    
    // ========================================================================
    // CONTEXT FROM ORIGINAL CALL
    // ========================================================================
    
    customerPhrase: {
        type: String,
        required: true,
        description: 'What the customer actually said that triggered this suggestion'
    },
    
    tier1Score: {
        type: Number,
        description: 'Tier 1 confidence score for this phrase (failed to match)'
    },
    
    tier2Score: {
        type: Number,
        description: 'Tier 2 confidence score for this phrase (failed to match)'
    },
    
    llmResponse: {
        type: String,
        description: 'What the LLM actually responded with'
    },
    
    callDate: {
        type: Date,
        required: true,
        index: true,
        description: 'When the customer call happened'
    },
    
    phoneNumber: {
        type: String,
        description: 'Customer phone number (for debugging)'
    },
    
    // ========================================================================
    // COST & ROI TRACKING
    // ========================================================================
    
    llmModel: {
        type: String,
        enum: ['gpt-4o', 'gpt-4o-mini', 'gpt-3.5-turbo'],
        required: true,
        description: 'Which LLM model generated this suggestion'
    },
    
    cost: {
        type: Number,
        required: true,
        min: 0,
        description: 'Cost of this LLM call in USD (e.g., 0.08 = 8 cents)'
    },
    
    estimatedMonthlySavings: {
        type: Number,
        min: 0,
        description: 'Estimated $ savings per month if this suggestion is applied'
    },
    
    // ========================================================================
    // STATUS & APPROVAL
    // ========================================================================
    
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'applied'],
        default: 'pending',
        required: true,
        index: true,
        description: 'Current status of this suggestion'
    },
    
    reviewedBy: {
        type: String,
        description: 'Admin email who reviewed this suggestion'
    },
    
    reviewedAt: {
        type: Date,
        description: 'When this suggestion was reviewed'
    },
    
    rejectionReason: {
        type: String,
        description: 'Why this suggestion was rejected (optional)'
    },
    
    appliedAt: {
        type: Date,
        description: 'When this suggestion was applied to the template'
    },
    
    appliedBy: {
        type: String,
        description: 'Admin email who applied this suggestion'
    },
    
    // ========================================================================
    // METADATA
    // ========================================================================
    
    notes: {
        type: String,
        description: 'Admin notes about this suggestion'
    },
    
    isDuplicate: {
        type: Boolean,
        default: false,
        description: 'Flag if this suggestion duplicates an existing one'
    },
    
    duplicateOf: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'ProductionLLMSuggestion',
        description: 'Reference to original suggestion if this is a duplicate'
    },
    
    createdAt: {
        type: Date,
        default: Date.now,
        index: true,
        description: 'When this suggestion was created'
    },
    
    updatedAt: {
        type: Date,
        default: Date.now,
        description: 'When this suggestion was last updated'
    }
});

// ============================================================================
// INDEXES FOR PERFORMANCE
// ============================================================================

// Compound index for LLM Learning Console main query (with callSource filtering)
ProductionLLMSuggestionSchema.index({ templateId: 1, callSource: 1, status: 1, priority: -1, createdAt: -1 });

// Index for cost analytics queries
ProductionLLMSuggestionSchema.index({ callDate: -1, cost: 1 });

// Index for company-specific queries (with callSource)
ProductionLLMSuggestionSchema.index({ companyId: 1, callSource: 1, createdAt: -1 });

// Index for duplicate detection
ProductionLLMSuggestionSchema.index({ templateId: 1, suggestionType: 1, suggestedValue: 1 });

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get pending suggestions grouped by template
 * Used for LLM Learning Console main view
 */
ProductionLLMSuggestionSchema.statics.getTemplatesSummary = async function() {
    const GlobalTemplate = mongoose.model('GlobalInstantResponseTemplate');
    
    // Get all templates
    const templates = await GlobalTemplate.find({ isPublished: true })
        .select('name')
        .lean();
    
    // Get suggestion counts for each template
    const summaries = await Promise.all(templates.map(async (template) => {
        const suggestions = await this.find({
            templateId: template._id,
            status: 'pending'
        }).lean();
        
        const highCount = suggestions.filter(s => s.priority === 'high').length;
        const mediumCount = suggestions.filter(s => s.priority === 'medium').length;
        const lowCount = suggestions.filter(s => s.priority === 'low').length;
        
        const totalCost = suggestions.reduce((sum, s) => sum + (s.cost || 0), 0);
        
        // Count unique companies using this template
        const Company = mongoose.model('v2Company');
        const companiesUsing = await Company.countDocuments({
            'aiAgentSettings.templateReferences.templateId': template._id,
            'aiAgentSettings.templateReferences.isActive': true
        });
        
        const lastSuggestion = suggestions.length > 0 
            ? suggestions.sort((a, b) => b.createdAt - a.createdAt)[0].createdAt
            : new Date(0);
        
        return {
            _id: template._id,
            name: template.name,
            pendingSuggestions: suggestions.length,
            learningCost: totalCost,
            companiesUsing,
            lastSuggestion,
            priority: {
                high: highCount,
                medium: mediumCount,
                low: lowCount
            }
        };
    }));
    
    // Filter out templates with no suggestions
    return summaries.filter(s => s.pendingSuggestions > 0)
        .sort((a, b) => b.pendingSuggestions - a.pendingSuggestions);
};

/**
 * Get cost analytics for dashboard
 */
ProductionLLMSuggestionSchema.statics.getCostAnalytics = async function() {
    const now = new Date();
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    const weekStart = new Date(now.setDate(now.getDate() - 7));
    
    // Today's stats
    const todayStats = await this.aggregate([
        { $match: { callDate: { $gte: todayStart } } },
        { $group: {
            _id: null,
            cost: { $sum: '$cost' },
            calls: { $sum: 1 }
        }}
    ]);
    
    // This week's stats
    const weekStats = await this.aggregate([
        { $match: { callDate: { $gte: weekStart } } },
        { $group: {
            _id: null,
            cost: { $sum: '$cost' },
            calls: { $sum: 1 }
        }}
    ]);
    
    // ROI stats (applied suggestions)
    const roiStats = await this.aggregate([
        { $match: { status: 'applied' } },
        { $group: {
            _id: null,
            savings: { $sum: '$estimatedMonthlySavings' },
            suggestionsApplied: { $sum: 1 }
        }}
    ]);
    
    // Tier 3 reduction (placeholder - would need historical data)
    const tier3Reduction = 0; // TODO: Calculate from historical metrics
    
    return {
        today: {
            cost: todayStats[0]?.cost || 0,
            calls: todayStats[0]?.calls || 0
        },
        week: {
            cost: weekStats[0]?.cost || 0,
            calls: weekStats[0]?.calls || 0
        },
        roi: {
            savings: roiStats[0]?.savings || 0,
            suggestionsApplied: roiStats[0]?.suggestionsApplied || 0
        },
        tier3Reduction
    };
};

/**
 * Update timestamps on save
 */
ProductionLLMSuggestionSchema.pre('save', function(next) {
    this.updatedAt = new Date();
    next();
});

module.exports = mongoose.model('ProductionLLMSuggestion', ProductionLLMSuggestionSchema);

