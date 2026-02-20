/**
 * ============================================================================
 * LLM FALLBACK USAGE MODEL - Agent 2.0 LLM Assist Tracking
 * ============================================================================
 * 
 * PURPOSE:
 * Tracks every LLM fallback call made by Agent 2.0 for:
 * - Cost monitoring (today + month-to-date)
 * - Token usage tracking (input/output/total)
 * - Trigger analysis (why was LLM called?)
 * - Provenance audit (full UI traceability)
 * 
 * BUSINESS RULES:
 * - LLM fallback only fires when trigger cards fail
 * - Never during booking-critical steps
 * - Every call must have provenance (uiPath required)
 * - Cost is calculated from model pricing table
 * 
 * UI INTEGRATION:
 * - Usage dashboard in Agent 2.0 > LLM Fallback tab
 * - Shows today + MTD totals
 * - Visible in Call Review with full provenance
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ============================================================================
// MODEL PRICING TABLE (USD per 1M tokens)
// Updated: 2024 pricing - extend as new models are added
// ============================================================================
const MODEL_PRICING = {
  // GPT-4.1 family
  'gpt-4.1': { input: 2.00, output: 8.00 },
  'gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'gpt-4.1-nano': { input: 0.10, output: 0.40 },
  
  // GPT-4o family
  'gpt-4o': { input: 2.50, output: 10.00 },
  'gpt-4o-mini': { input: 0.15, output: 0.60 },
  
  // GPT-4 Turbo
  'gpt-4-turbo': { input: 10.00, output: 30.00 },
  'gpt-4-turbo-preview': { input: 10.00, output: 30.00 },
  
  // GPT-3.5
  'gpt-3.5-turbo': { input: 0.50, output: 1.50 },
  
  // Default fallback pricing (conservative estimate)
  'default': { input: 0.50, output: 2.00 }
};

const llmFallbackUsageSchema = new Schema({
  // ============================================
  // CALL CONTEXT
  // ============================================
  
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'v2Company',
    required: true,
    index: true
  },
  
  callSid: {
    type: String,
    required: true,
    index: true
  },
  
  turnNumber: {
    type: Number,
    default: 0
  },
  
  // ============================================
  // MODEL & PROVIDER
  // ============================================
  
  provider: {
    type: String,
    enum: ['openai', 'anthropic', 'google'],
    default: 'openai'
  },
  
  model: {
    type: String,
    required: true,
    index: true
  },
  
  // ============================================
  // TOKEN USAGE
  // ============================================
  
  tokens: {
    input: { type: Number, default: 0 },
    output: { type: Number, default: 0 },
    total: { type: Number, default: 0 }
  },
  
  // ============================================
  // COST (calculated from tokens + model pricing)
  // ============================================
  
  costUsd: {
    type: Number,
    default: 0,
    index: true
  },
  
  // ============================================
  // TRIGGER ANALYSIS (why was LLM called?)
  // ============================================
  
  trigger: {
    reason: {
      type: String,
      required: true
      // e.g., 'noMatchCount=2', 'complexityScore=0.71', 'complexQuestion'
    },
    
    noMatchCount: { type: Number, default: 0 },
    complexityScore: { type: Number, min: 0, max: 1 },
    matchedKeywords: [{ type: String }],
    
    callerInput: {
      type: String
      // What the caller said (truncated for storage)
    },
    
    callerInputPreview: {
      type: String
      // First 200 chars
    }
  },
  
  // ============================================
  // RESULT & QUALITY
  // ============================================
  
  result: {
    success: { type: Boolean, default: true },
    
    responseText: {
      type: String
      // Full LLM response (for audit)
    },
    
    responsePreview: {
      type: String
      // First 120 chars (for dashboard)
    },
    
    hadFunnelQuestion: { type: Boolean, default: false },
    sentenceCount: { type: Number, default: 0 },
    
    constraintViolations: [{
      type: String
      // e.g., 'exceeded_max_sentences', 'missing_funnel_question'
    }],
    
    usedEmergencyFallback: { type: Boolean, default: false },
    
    responseTimeMs: { type: Number, default: 0 }
  },
  
  // ============================================
  // PROVENANCE (UI traceability - REQUIRED)
  // ============================================
  
  provenance: {
    uiPath: {
      type: String,
      required: true,
      default: 'aiAgentSettings.agent2.llmFallback'
    },
    
    uiTab: {
      type: String,
      default: 'LLM Fallback'
    },
    
    configVersion: { type: String },
    
    promptTemplateVersion: { type: String },
    
    isFromUiConfig: {
      type: Boolean,
      default: true
    }
  },
  
  // ============================================
  // ERROR TRACKING
  // ============================================
  
  error: {
    occurred: { type: Boolean, default: false },
    message: { type: String },
    code: { type: String },
    fallbackUsed: { type: Boolean, default: false }
  }
  
}, {
  timestamps: true,
  collection: 'llmfallbackusage'
});

// ============================================================================
// INDEXES FOR EFFICIENT AGGREGATION
// ============================================================================

// Compound index for company + time range queries (usage dashboard)
llmFallbackUsageSchema.index({ companyId: 1, createdAt: -1 });

// Index for daily aggregation
llmFallbackUsageSchema.index({ companyId: 1, createdAt: 1 });

// Index for model-specific cost analysis
llmFallbackUsageSchema.index({ model: 1, createdAt: -1 });

// Index for call detail lookup
llmFallbackUsageSchema.index({ callSid: 1, turnNumber: 1 });

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Calculate cost from tokens and model
 */
llmFallbackUsageSchema.statics.calculateCost = function(tokens, model) {
  if (!tokens || typeof tokens.input !== 'number') return 0;
  
  const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];
  
  const inputCost = (tokens.input / 1_000_000) * pricing.input;
  const outputCost = (tokens.output / 1_000_000) * pricing.output;
  
  return Number((inputCost + outputCost).toFixed(6));
};

/**
 * Get model pricing (for UI display)
 */
llmFallbackUsageSchema.statics.getModelPricing = function(model) {
  return MODEL_PRICING[model] || MODEL_PRICING['default'];
};

/**
 * Get all available models with pricing
 */
llmFallbackUsageSchema.statics.getAllModelPricing = function() {
  return MODEL_PRICING;
};

/**
 * Get usage stats for a company (today + MTD)
 */
llmFallbackUsageSchema.statics.getUsageStats = async function(companyId, timezone = 'America/New_York') {
  const now = new Date();
  
  // Calculate start of today in company timezone
  const todayStart = new Date(now.toLocaleString('en-US', { timeZone: timezone }));
  todayStart.setHours(0, 0, 0, 0);
  
  // Calculate start of month
  const monthStart = new Date(todayStart);
  monthStart.setDate(1);
  
  // Aggregation pipeline
  const pipeline = [
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(companyId),
        createdAt: { $gte: monthStart }
      }
    },
    {
      $facet: {
        today: [
          { $match: { createdAt: { $gte: todayStart } } },
          {
            $group: {
              _id: null,
              calls: { $sum: 1 },
              inputTokens: { $sum: '$tokens.input' },
              outputTokens: { $sum: '$tokens.output' },
              totalTokens: { $sum: '$tokens.total' },
              totalCost: { $sum: '$costUsd' },
              avgResponseTime: { $avg: '$result.responseTimeMs' },
              successCount: { $sum: { $cond: ['$result.success', 1, 0] } },
              errorCount: { $sum: { $cond: ['$error.occurred', 1, 0] } }
            }
          }
        ],
        mtd: [
          {
            $group: {
              _id: null,
              calls: { $sum: 1 },
              inputTokens: { $sum: '$tokens.input' },
              outputTokens: { $sum: '$tokens.output' },
              totalTokens: { $sum: '$tokens.total' },
              totalCost: { $sum: '$costUsd' },
              avgResponseTime: { $avg: '$result.responseTimeMs' },
              successCount: { $sum: { $cond: ['$result.success', 1, 0] } },
              errorCount: { $sum: { $cond: ['$error.occurred', 1, 0] } }
            }
          }
        ],
        byModel: [
          {
            $group: {
              _id: '$model',
              calls: { $sum: 1 },
              totalTokens: { $sum: '$tokens.total' },
              totalCost: { $sum: '$costUsd' }
            }
          },
          { $sort: { totalCost: -1 } }
        ],
        last7Days: [
          {
            $match: {
              createdAt: { $gte: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000) }
            }
          },
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
              calls: { $sum: 1 },
              totalTokens: { $sum: '$tokens.total' },
              totalCost: { $sum: '$costUsd' }
            }
          },
          { $sort: { _id: 1 } }
        ]
      }
    }
  ];
  
  const [result] = await this.aggregate(pipeline);
  
  const emptyStats = {
    calls: 0,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    avgResponseTime: 0,
    successCount: 0,
    errorCount: 0
  };
  
  return {
    today: result.today[0] || emptyStats,
    mtd: result.mtd[0] || emptyStats,
    byModel: result.byModel || [],
    last7Days: result.last7Days || [],
    generatedAt: new Date().toISOString()
  };
};

/**
 * Log an LLM fallback call
 */
llmFallbackUsageSchema.statics.logCall = async function(data) {
  const cost = this.calculateCost(data.tokens, data.model);
  
  const doc = new this({
    companyId: data.companyId,
    callSid: data.callSid,
    turnNumber: data.turnNumber || 0,
    provider: data.provider || 'openai',
    model: data.model,
    tokens: {
      input: data.tokens?.input || 0,
      output: data.tokens?.output || 0,
      total: (data.tokens?.input || 0) + (data.tokens?.output || 0)
    },
    costUsd: cost,
    trigger: {
      reason: data.trigger?.reason || 'unknown',
      noMatchCount: data.trigger?.noMatchCount,
      complexityScore: data.trigger?.complexityScore,
      matchedKeywords: data.trigger?.matchedKeywords || [],
      callerInput: data.trigger?.callerInput?.substring(0, 500),
      callerInputPreview: data.trigger?.callerInput?.substring(0, 200)
    },
    result: {
      success: data.result?.success !== false,
      responseText: data.result?.responseText,
      responsePreview: data.result?.responseText?.substring(0, 120),
      hadFunnelQuestion: data.result?.hadFunnelQuestion || false,
      sentenceCount: data.result?.sentenceCount || 0,
      constraintViolations: data.result?.constraintViolations || [],
      usedEmergencyFallback: data.result?.usedEmergencyFallback || false,
      responseTimeMs: data.result?.responseTimeMs || 0
    },
    provenance: {
      uiPath: data.provenance?.uiPath || 'aiAgentSettings.agent2.llmFallback',
      uiTab: data.provenance?.uiTab || 'LLM Fallback',
      configVersion: data.provenance?.configVersion,
      promptTemplateVersion: data.provenance?.promptTemplateVersion,
      isFromUiConfig: true
    },
    error: {
      occurred: data.error?.occurred || false,
      message: data.error?.message,
      code: data.error?.code,
      fallbackUsed: data.error?.fallbackUsed || false
    }
  });
  
  return doc.save();
};

// ============================================================================
// EXPORT
// ============================================================================

const LLMFallbackUsage = mongoose.model('LLMFallbackUsage', llmFallbackUsageSchema);

module.exports = LLMFallbackUsage;
