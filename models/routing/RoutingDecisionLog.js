/**
 * ============================================================================
 * ROUTING DECISION LOG MODEL - PRECISION FRONTLINE-INTEL V23
 * ============================================================================
 * 
 * PURPOSE: Log every routing decision for tuning and analysis
 * ARCHITECTURE: MongoDB document per decision
 * 
 * USE CASES:
 * - Identify misroutes (wasCorrect: false)
 * - Analyze patterns in failures
 * - Export data for prompt tuning
 * - A/B test analysis
 * 
 * DATA RETENTION: 90 days (auto-deleted after)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const RoutingDecisionLogSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true
    },
    
    callId: {
      type: String,
      required: true,
      index: true,
      // Twilio CallSid or internal call ID
    },
    
    turnNumber: {
      type: Number,
      required: true,
      // Which turn in the conversation (1 = first user input)
    },
    
    promptVersion: {
      type: String,
      required: true,
      index: true,
      // Which prompt version was used (e.g., "v1.2")
    },
    
    // Input data
    userInput: {
      type: String,
      required: true,
      // Raw transcript from caller
    },
    
    cleanedInput: {
      type: String,
      required: true,
      // After FillerStripper + Normalizer
    },
    
    // Context data
    emotionDetected: {
      primary: String,
      intensity: Number,
      signals: Array
    },
    
    callerContext: {
      phoneNumber: String,
      firstName: String,
      returning: Boolean,
      lastIntent: String,
      callCount: Number
    },
    
    // Routing decision from Micro-LLM
    routingDecision: {
      target: {
        type: String,
        required: true,
        index: true
        // Scenario key (e.g., "HVAC_LEAK")
      },
      thought: String,
      confidence: {
        type: Number,
        required: true
      },
      priority: {
        type: String,
        enum: ['NORMAL', 'HIGH', 'EMERGENCY'],
        default: 'NORMAL'
      }
    },
    
    // Performance metrics
    latency: {
      type: Number,
      required: true,
      // Milliseconds to get routing decision
    },
    
    llmModel: {
      type: String,
      default: 'gpt-4o-mini'
    },
    
    llmTokensUsed: {
      type: Number,
      default: 0
    },
    
    // Tuning data (admin can mark after review)
    wasCorrect: {
      type: Boolean,
      default: null,
      index: true
      // null = not yet reviewed
      // true = correct routing
      // false = incorrect routing
    },
    
    actualTarget: {
      type: String,
      default: null,
      // What it SHOULD have been (if wasCorrect: false)
    },
    
    tuningFlag: {
      type: Boolean,
      default: false,
      index: true
      // Admin flagged this for prompt tuning
    },
    
    tuningNotes: {
      type: String,
      default: null
      // Admin notes about why it failed
    },
    
    // Metadata
    timestamp: {
      type: Date,
      default: Date.now,
      index: true
    }
  },
  {
    timestamps: true
  }
);

// ============================================================================
// INDEXES
// ============================================================================

// Compound index for analytics queries
RoutingDecisionLogSchema.index({ companyId: 1, timestamp: -1 });
RoutingDecisionLogSchema.index({ companyId: 1, promptVersion: 1 });
RoutingDecisionLogSchema.index({ companyId: 1, wasCorrect: 1 });

// ============================================================================
// TTL INDEX (Auto-delete after 90 days)
// ============================================================================

RoutingDecisionLogSchema.index(
  { timestamp: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 } // 90 days
);

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Get all failures (wasCorrect: false) for tuning
 */
RoutingDecisionLogSchema.statics.getFailures = async function(companyId, options = {}) {
  const {
    limit = 100,
    promptVersion = null,
    emotionType = null
  } = options;
  
  const query = {
    companyId,
    wasCorrect: false
  };
  
  if (promptVersion) {
    query.promptVersion = promptVersion;
  }
  
  if (emotionType) {
    query['emotionDetected.primary'] = emotionType;
  }
  
  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

/**
 * Get accuracy stats for a prompt version
 */
RoutingDecisionLogSchema.statics.getAccuracyStats = async function(companyId, promptVersion) {
  const total = await this.countDocuments({
    companyId,
    promptVersion,
    wasCorrect: { $ne: null } // Only count reviewed decisions
  });
  
  const correct = await this.countDocuments({
    companyId,
    promptVersion,
    wasCorrect: true
  });
  
  const incorrect = await this.countDocuments({
    companyId,
    promptVersion,
    wasCorrect: false
  });
  
  const avgConfidenceResult = await this.aggregate([
    { $match: { companyId, promptVersion } },
    { $group: {
      _id: null,
      avgConfidence: { $avg: '$routingDecision.confidence' },
      avgLatency: { $avg: '$latency' }
    }}
  ]);
  
  const stats = avgConfidenceResult[0] || { avgConfidence: 0, avgLatency: 0 };
  
  return {
    total,
    correct,
    incorrect,
    accuracy: total > 0 ? (correct / total) : 0,
    avgConfidence: stats.avgConfidence,
    avgLatency: stats.avgLatency
  };
};

/**
 * Get top misroute patterns
 */
RoutingDecisionLogSchema.statics.getMisroutePatterns = async function(companyId, limit = 10) {
  return this.aggregate([
    { $match: { companyId, wasCorrect: false } },
    { $group: {
      _id: {
        routedTo: '$routingDecision.target',
        shouldBe: '$actualTarget'
      },
      count: { $sum: 1 },
      examples: { $push: '$cleanedInput' }
    }},
    { $sort: { count: -1 } },
    { $limit: limit },
    { $project: {
      _id: 0,
      routedTo: '$_id.routedTo',
      shouldBe: '$_id.shouldBe',
      count: 1,
      examples: { $slice: ['$examples', 3] } // First 3 examples
    }}
  ]);
};

// ============================================================================
// EXPORT
// ============================================================================

module.exports = mongoose.model('RoutingDecisionLog', RoutingDecisionLogSchema);

