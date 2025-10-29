// ============================================================================
// PRODUCTION AI CALL LOG MODEL
// ============================================================================
// Purpose: Stores complete call data for Production AI analysis and learning
// Used by: LLMSuggestionAnalyzer, Production AI dashboard, Test Pilot
// TTL: 90 days (auto-delete old logs)
// ============================================================================

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ────────────────────────────────────────────────────────────────────────────
// SCHEMA DEFINITION
// ────────────────────────────────────────────────────────────────────────────

const ProductionAICallLogSchema = new Schema({
  // ──────────────────────────────────────────────────────────────────────────
  // CORE IDENTIFIERS
  // ──────────────────────────────────────────────────────────────────────────
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
    description: 'Template used for AI routing'
  },

  categoryId: {
    type: Schema.Types.ObjectId,
    ref: 'v2TradeCategory',
    required: false,
    description: 'Category that matched (if any)'
  },

  scenarioId: {
    type: Schema.Types.ObjectId,
    ref: 'v2Template',
    required: false,
    description: 'Scenario that matched (if any)'
  },

  callId: {
    type: String,
    required: true,
    unique: true,
    index: true,
    description: 'Unique Twilio call SID'
  },

  // ──────────────────────────────────────────────────────────────────────────
  // CALL METADATA
  // ──────────────────────────────────────────────────────────────────────────
  callerPhone: {
    type: String,
    required: true,
    description: 'Caller phone number (formatted)'
  },

  duration: {
    type: Number,
    required: false,
    description: 'Call duration in seconds'
  },

  isTest: {
    type: Boolean,
    default: false,
    index: true,
    description: 'True if from Test Pilot, false if production'
  },

  // ──────────────────────────────────────────────────────────────────────────
  // CALL TRANSCRIPT
  // ──────────────────────────────────────────────────────────────────────────
  transcript: {
    type: String,
    required: true,
    description: 'Full conversation (Caller: ...\nAgent: ...)'
  },

  callerQuery: {
    type: String,
    required: true,
    description: 'Original caller query (before processing)'
  },

  processedQuery: {
    type: String,
    required: false,
    description: 'Query after filler removal and preprocessing'
  },

  // ──────────────────────────────────────────────────────────────────────────
  // 3-TIER ROUTING RESULTS
  // ──────────────────────────────────────────────────────────────────────────
  tierUsed: {
    type: Number,
    enum: [1, 2, 3],
    required: true,
    index: true,
    description: 'Which tier ultimately matched (1=Rule, 2=Semantic, 3=LLM)'
  },

  tier1Result: {
    attempted: { type: Boolean, default: false },
    matched: { type: Boolean, default: false },
    confidence: { type: Number, default: 0 },
    matchedScenarioId: { type: Schema.Types.ObjectId, ref: 'v2Template' },
    reason: { type: String, description: 'Why it succeeded or failed' },
    responseTime: { type: Number, description: 'Time in milliseconds' }
  },

  tier2Result: {
    attempted: { type: Boolean, default: false },
    matched: { type: Boolean, default: false },
    confidence: { type: Number, default: 0 },
    matchedScenarioId: { type: Schema.Types.ObjectId, ref: 'v2Template' },
    reason: { type: String, description: 'Why it succeeded or failed' },
    responseTime: { type: Number, description: 'Time in milliseconds' },
    vectorSimilarity: { type: Number, description: 'Cosine similarity score' }
  },

  tier3Result: {
    attempted: { type: Boolean, default: false },
    matched: { type: Boolean, default: false },
    confidence: { type: Number, default: 0 },
    matchedScenarioId: { type: Schema.Types.ObjectId, ref: 'v2Template' },
    reason: { type: String, description: 'Why it succeeded or failed' },
    responseTime: { type: Number, description: 'Time in milliseconds' },
    llmModel: { type: String, description: 'e.g., gpt-4-turbo' },
    llmTokens: { type: Number, description: 'Total tokens used' },
    llmCost: { type: Number, description: 'Cost in dollars' },
    llmReasoning: { type: String, description: 'Full LLM explanation of match' }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // FINAL RESPONSE
  // ──────────────────────────────────────────────────────────────────────────
  finalResponse: {
    type: String,
    required: true,
    description: 'Final response sent to caller'
  },

  responseTime: {
    type: Number,
    required: true,
    description: 'Total response time in milliseconds'
  },

  totalCost: {
    type: Number,
    required: true,
    default: 0,
    description: 'Total cost in dollars (LLM + any other costs)'
  },

  // ──────────────────────────────────────────────────────────────────────────
  // ANALYSIS STATUS
  // ──────────────────────────────────────────────────────────────────────────
  analyzed: {
    type: Boolean,
    default: false,
    index: true,
    description: 'True if LLM has analyzed this call for suggestions'
  },

  analyzedAt: {
    type: Date,
    required: false,
    description: 'When analysis was completed'
  },

  suggestionsGenerated: {
    type: Boolean,
    default: false,
    description: 'True if suggestions were created from this call'
  },

  analysisAttempts: {
    type: Number,
    default: 0,
    description: 'Number of times analysis has been attempted (max 3)'
  },

  analysisError: {
    type: String,
    required: false,
    description: 'Error message if analysis failed after 3 attempts'
  },

  // ──────────────────────────────────────────────────────────────────────────
  // TIMESTAMPS
  // ──────────────────────────────────────────────────────────────────────────
  timestamp: {
    type: Date,
    default: Date.now,
    required: true,
    index: true,
    description: 'When the call occurred'
  }
}, {
  timestamps: true, // Adds createdAt and updatedAt
  collection: 'productionAICallLogs'
});

// ────────────────────────────────────────────────────────────────────────────
// INDEXES FOR PERFORMANCE
// ────────────────────────────────────────────────────────────────────────────

// Compound index for querying calls by company and date
ProductionAICallLogSchema.index({ companyId: 1, timestamp: -1 });

// Compound index for querying calls by template and date
ProductionAICallLogSchema.index({ templateId: 1, timestamp: -1 });

// Index for finding unanalyzed Tier 3 calls (background processing)
ProductionAICallLogSchema.index({ tierUsed: 1, analyzed: 1, analysisAttempts: 1 });

// Index for test vs production filtering
ProductionAICallLogSchema.index({ isTest: 1 });

// ────────────────────────────────────────────────────────────────────────────
// TTL INDEX - AUTO-DELETE AFTER 90 DAYS
// ────────────────────────────────────────────────────────────────────────────
// MongoDB will automatically delete documents 90 days after 'timestamp'
ProductionAICallLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 7776000 } // 90 days = 90 * 24 * 60 * 60
);

// ────────────────────────────────────────────────────────────────────────────
// INSTANCE METHODS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mark this call log as analyzed
 */
ProductionAICallLogSchema.methods.markAnalyzed = async function(suggestionsCreated = false) {
  this.analyzed = true;
  this.analyzedAt = new Date();
  this.suggestionsGenerated = suggestionsCreated;
  return this.save();
};

/**
 * Increment analysis attempts (for retry logic)
 */
ProductionAICallLogSchema.methods.incrementAnalysisAttempts = async function(error = null) {
  this.analysisAttempts += 1;
  if (error) {
    this.analysisError = error.message || String(error);
  }
  return this.save();
};

/**
 * Get formatted call duration
 */
ProductionAICallLogSchema.methods.getFormattedDuration = function() {
  if (!this.duration) return 'N/A';
  const minutes = Math.floor(this.duration / 60);
  const seconds = this.duration % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
};

/**
 * Get formatted cost
 */
ProductionAICallLogSchema.methods.getFormattedCost = function() {
  return `$${this.totalCost.toFixed(4)}`;
};

// ────────────────────────────────────────────────────────────────────────────
// STATIC METHODS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Find unanalyzed Tier 3 calls for background processing
 * @param {Number} limit - Maximum number of calls to return
 * @returns {Promise<Array>} Array of call logs
 */
ProductionAICallLogSchema.statics.findUnanalyzedTier3Calls = function(limit = 10) {
  return this.find({
    tierUsed: 3,
    analyzed: false,
    analysisAttempts: { $lt: 3 } // Only retry up to 3 times
  })
    .sort({ timestamp: 1 }) // Oldest first
    .limit(limit)
    .exec();
};

/**
 * Get call statistics for a template
 * @param {String} templateId - Template ID
 * @param {Number} days - Number of days to look back
 * @returns {Promise<Object>} Statistics object
 */
ProductionAICallLogSchema.statics.getTemplateStats = async function(templateId, days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const pipeline = [
    {
      $match: {
        templateId: new mongoose.Types.ObjectId(templateId),
        timestamp: { $gte: since }
      }
    },
    {
      $group: {
        _id: '$tierUsed',
        count: { $sum: 1 },
        avgResponseTime: { $avg: '$responseTime' },
        totalCost: { $sum: '$totalCost' }
      }
    }
  ];

  const results = await this.aggregate(pipeline);

  // Format results
  const stats = {
    tier1: { count: 0, avgResponseTime: 0, totalCost: 0 },
    tier2: { count: 0, avgResponseTime: 0, totalCost: 0 },
    tier3: { count: 0, avgResponseTime: 0, totalCost: 0 },
    total: 0
  };

  results.forEach(result => {
    const tier = `tier${result._id}`;
    stats[tier] = {
      count: result.count,
      avgResponseTime: Math.round(result.avgResponseTime),
      totalCost: result.totalCost
    };
    stats.total += result.count;
  });

  return stats;
};

// ────────────────────────────────────────────────────────────────────────────
// PRE-SAVE HOOKS
// ────────────────────────────────────────────────────────────────────────────

ProductionAICallLogSchema.pre('save', function(next) {
  // Ensure timestamp is set
  if (!this.timestamp) {
    this.timestamp = new Date();
  }

  // Ensure totalCost is calculated
  if (!this.totalCost && this.tier3Result && this.tier3Result.llmCost) {
    this.totalCost = this.tier3Result.llmCost;
  }

  next();
});

// ────────────────────────────────────────────────────────────────────────────
// MODEL EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = mongoose.model('ProductionAICallLog', ProductionAICallLogSchema);

