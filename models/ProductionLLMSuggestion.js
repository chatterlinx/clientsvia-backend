/**
 * ============================================================================
 * PRODUCTION LLM SUGGESTION MODEL - V2 ENHANCED
 * ============================================================================
 * 
 * PURPOSE: Store LLM-generated suggestions from production calls
 * VERSION: 2.0 - Comprehensive latency tracking + multi-source support
 * 
 * KEY FEATURES:
 * - Template + company tracking
 * - Call source differentiation (template-test, company-test, production)
 * - Full tier routing analysis (scores, thresholds, latency)
 * - Dead air / customer wait time tracking
 * - Rich suggestion metadata (type, priority, changes)
 * - Admin workflow (pending, applied, rejected, snoozed)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

const ProductionLLMSuggestionSchema = new Schema(
  {
    // ========================================================================
    // WHAT TEMPLATE / COMPANY
    // ========================================================================
    templateId: { 
      type: Schema.Types.ObjectId, 
      ref: 'GlobalInstantResponseTemplate', 
      required: true,
      index: true
    },
    templateName: { 
      type: String, 
      required: true 
    },

    companyId: { 
      type: Schema.Types.ObjectId, 
      ref: 'v2Company', 
      default: null,
      index: true
    },
    companyName: { 
      type: String, 
      default: null 
    },

    // ========================================================================
    // WHERE DID THIS CALL COME FROM?
    // ========================================================================
    // - template-test  => Global AI Brain test pilot
    // - company-test   => Test Pilot company mode
    // - production     => real customer calls
    callSource: {
      type: String,
      enum: ['template-test', 'company-test', 'production'],
      default: 'production',
      required: true,
      index: true,
    },

    // ========================================================================
    // CALL IDENTITY & TIMING
    // ========================================================================
    callId: { 
      type: String, 
      index: true 
    }, // internal call id
    
    callSid: { 
      type: String, 
      index: true 
    }, // Twilio SID if available
    
    callDate: { 
      type: Date, 
      default: Date.now, 
      required: true,
      index: true 
    },

    // ========================================================================
    // TIER ROUTING INFO
    // ========================================================================
    tierPath: {
      type: String, // e.g. "tier1", "tier2", "tier3"
      default: 'tier3',
    },
    
    tier1Score: { type: Number },
    tier2Score: { type: Number },
    tier1Threshold: { type: Number },
    tier2Threshold: { type: Number },

    // ========================================================================
    // LATENCY / CUSTOMER WAIT TIME
    // ========================================================================
    tier1LatencyMs: { type: Number },
    tier2LatencyMs: { type: Number },
    tier3LatencyMs: { type: Number },
    totalResponseLatencyMs: { type: Number }, // full time between caller speech and reply
    overallLatencyMs: { type: Number }, // alias for totalResponseLatencyMs (UI compatibility)
    deadAirMs: { type: Number }, // estimated "silence" time (deprecated - use maxDeadAirMs)
    maxDeadAirMs: { type: Number }, // maximum silence/dead air time during call
    avgDeadAirMs: { type: Number }, // average dead air time across call

    // ========================================================================
    // WHAT THE CALLER SAID + TRANSCRIPT
    // ========================================================================
    customerPhrase: { 
      type: String,
      required: true
    }, // the exact utterance that caused Tier 3
    
    agentResponseSnippet: { type: String }, // what the AI agent responded (preview)
    
    fullCallTranscript: { type: String },

    // ========================================================================
    // WHERE IN THE TEMPLATE THIS SUGGESTION APPLIES
    // ========================================================================
    targetCategory: { type: String },
    categoryName: { type: String }, // human-readable category name
    targetScenario: { type: String },
    scenarioId: { type: String }, // your internal scenario key
    scenarioName: { type: String }, // human-readable scenario name
    targetField: {
      type: String,
      enum: ['keyword', 'synonym', 'filler', 'scenario', 'reply', 'meta', 'other'],
      default: 'keyword',
    },

    // ========================================================================
    // SUGGESTION SEMANTICS
    // ========================================================================
    suggestionType: {
      type: String,
      enum: [
        'ADD_KEYWORDS',
        'ADD_SYNONYMS',
        'ADD_FILLERS',
        'NEW_SCENARIO',
        'UPDATE_SCENARIO',
        'MERGE_SCENARIOS',
        'DELETE_SCENARIO',
        'TWEAK_REPLY_TONE',
        'ADD_EDGE_CASE',
        'LATENCY_WARNING',
        'OVERLAP_WARNING',
        'OTHER',
      ],
      default: 'OTHER',
      required: true,
      index: true,
    },

    suggestionSummary: { 
      type: String,
      required: true
    }, // short human summary for list view
    
    suggestedChanges: [{ type: String }], // concrete things to add/update/delete

    // ========================================================================
    // DEEP EXPLANATION
    // ========================================================================
    rootCauseReason: { 
      type: String 
    }, // "why this fired", human readable

    // ========================================================================
    // LLM META
    // ========================================================================
    llmModel: { 
      type: String,
      required: true
    },
    
    llmResponse: { type: String }, // raw text from Tier 3 if helpful
    tokens: { type: Number },
    costUsd: { 
      type: Number, 
      default: 0,
      min: 0,
      required: true
    },

    // ========================================================================
    // PRIORITY & STATUS TRACKING
    // ========================================================================
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      required: true,
      index: true,
    },
    
    severity: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      index: true,
      description: 'How severe is the impact (separate from priority)'
    },
    
    changeImpactScore: {
      type: Number,
      min: 0,
      max: 5,
      default: 0,
      description: 'Estimated impact of applying this fix (0-5 scale)'
    },
    
    similarCallCount: {
      type: Number,
      default: 1,
      description: 'Number of similar calls affected by the same issue'
    },
    
    status: {
      type: String,
      enum: ['pending', 'applied', 'rejected', 'snoozed'],
      default: 'pending',
      required: true,
      index: true,
    },
    
    snoozeUntil: { type: Date },

    // ========================================================================
    // ADMIN AUDIT INFO
    // ========================================================================
    reviewedBy: { type: String },
    appliedBy: { type: String },
    appliedAt: { type: Date },
    rejectedBy: { type: String },
    rejectedReason: { type: String },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// ============================================================================
// INDEXES FOR PERFORMANCE
// ============================================================================

// Main console query (template + status + priority)
ProductionLLMSuggestionSchema.index({ 
  templateId: 1, 
  status: 1, 
  priority: -1, 
  callDate: -1 
});

// Call source filtering
ProductionLLMSuggestionSchema.index({ 
  callSource: 1, 
  callDate: -1 
});

// Company-specific queries
ProductionLLMSuggestionSchema.index({ 
  companyId: 1, 
  status: 1, 
  callDate: -1 
});

// Cost analytics queries
ProductionLLMSuggestionSchema.index({ 
  callDate: -1, 
  costUsd: 1 
});

// Duplicate detection
ProductionLLMSuggestionSchema.index({ 
  templateId: 1, 
  suggestionType: 1, 
  suggestionSummary: 1 
});

// Snoozed items query
ProductionLLMSuggestionSchema.index({ 
  status: 1, 
  snoozeUntil: 1 
});

// Severity filtering
ProductionLLMSuggestionSchema.index({ 
  severity: 1, 
  callDate: -1 
});

// ============================================================================
// STATIC METHODS (V1 Compatibility)
// ============================================================================

/**
 * Get cost analytics for V1 dashboard
 * DEPRECATED: Use V2 /overview endpoint instead
 */
ProductionLLMSuggestionSchema.statics.getCostAnalytics = async function() {
  try {
    const now = new Date();
    const todayStart = new Date(now.setHours(0, 0, 0, 0));
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);
    
    // Today's stats
    const todayStats = await this.aggregate([
      { $match: { callDate: { $gte: todayStart } } },
      { $group: {
        _id: null,
        cost: { $sum: '$costUsd' },
        calls: { $sum: 1 }
      }}
    ]);
    
    // This week's stats
    const weekStats = await this.aggregate([
      { $match: { callDate: { $gte: weekStart } } },
      { $group: {
        _id: null,
        cost: { $sum: '$costUsd' },
        calls: { $sum: 1 }
      }}
    ]);
    
    // ROI stats (applied suggestions)
    const roiStats = await this.aggregate([
      { $match: { status: 'applied' } },
      { $group: {
        _id: null,
        savings: { $sum: '$changeImpactScore' }, // Approximate savings
        suggestionsApplied: { $sum: 1 }
      }}
    ]);
    
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
      tier3Reduction: 0 // Placeholder
    };
  } catch (error) {
    console.error('Error in getCostAnalytics:', error);
    return {
      today: { cost: 0, calls: 0 },
      week: { cost: 0, calls: 0 },
      roi: { savings: 0, suggestionsApplied: 0 },
      tier3Reduction: 0
    };
  }
};

/**
 * Get templates summary for V1 dashboard
 * DEPRECATED: Use V2 /tasks endpoint instead
 */
ProductionLLMSuggestionSchema.statics.getTemplatesSummary = async function() {
  try {
    const GlobalTemplate = mongoose.model('GlobalInstantResponseTemplate');
    
    // Get all templates
    const templates = await GlobalTemplate.find({ isPublished: true })
      .select('name')
      .lean();
    
    if (!templates || templates.length === 0) {
      return [];
    }
    
    // Get suggestion counts for each template
    const summaries = await Promise.all(templates.map(async (template) => {
      try {
        const suggestions = await this.find({
          templateId: template._id,
          status: 'pending'
        }).lean();
        
        const highCount = suggestions.filter(s => s.priority === 'high' || s.priority === 'critical').length;
        const mediumCount = suggestions.filter(s => s.priority === 'medium').length;
        const lowCount = suggestions.filter(s => s.priority === 'low').length;
        
        const totalCost = suggestions.reduce((sum, s) => sum + (s.costUsd || 0), 0);
        
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
      } catch (templateError) {
        console.error(`Error processing template ${template._id}:`, templateError.message);
        return null;
      }
    }));
    
    return summaries
      .filter(s => s !== null && s.pendingSuggestions > 0)
      .sort((a, b) => b.pendingSuggestions - a.pendingSuggestions);
      
  } catch (error) {
    console.error('Error in getTemplatesSummary:', error);
    return [];
  }
};

module.exports = mongoose.model('ProductionLLMSuggestion', ProductionLLMSuggestionSchema);
