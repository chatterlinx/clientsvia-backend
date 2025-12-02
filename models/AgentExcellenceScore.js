/**
 * AgentExcellenceScore Model
 * 
 * PURPOSE: Track AI agent performance over time
 * - Daily score snapshots for trending
 * - Category breakdowns with transparent weights
 * - LLM-generated improvement suggestions
 * - Revenue impact tracking
 * 
 * SCORING FORMULA (Transparent, Deterministic):
 * Overall Score = 
 *   20% Booking Flow × 
 *   20% Triage Accuracy × 
 *   20% Knowledge Completeness × 
 *   15% Customer Memory × 
 *   15% Call Outcomes × 
 *   10% Frontline Intelligence
 * 
 * @module models/AgentExcellenceScore
 */

const mongoose = require('mongoose');

// ═══════════════════════════════════════════════════════════════════════════
// SCORING WEIGHTS (Transparent, Fixed, Visible to Users)
// ═══════════════════════════════════════════════════════════════════════════

const SCORE_WEIGHTS = {
  bookingFlow: 0.20,           // 20% - Revenue driver
  triageAccuracy: 0.20,        // 20% - Correct routing
  knowledgeCompleteness: 0.20, // 20% - Can answer questions
  customerMemory: 0.15,        // 15% - Returning customer experience
  callOutcomes: 0.15,          // 15% - End results
  frontlineIntelligence: 0.10  // 10% - Greeting/tone quality
};

const agentExcellenceScoreSchema = new mongoose.Schema({
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'V2Company',
    required: true,
    index: true
  },
  
  date: {
    type: Date,
    required: true,
    index: true
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // OVERALL SCORE
  // ═══════════════════════════════════════════════════════════════════════════
  overallScore: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  
  previousScore: {
    type: Number,
    min: 0,
    max: 100
  },
  
  trend: {
    type: String,
    enum: ['UP', 'DOWN', 'STABLE'],
    default: 'STABLE'
  },
  
  trendDelta: {
    type: Number,
    default: 0
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CATEGORY SCORES (0-100 each)
  // ═══════════════════════════════════════════════════════════════════════════
  categories: {
    bookingFlow: {
      score: { type: Number, min: 0, max: 100 },
      weight: { type: Number, default: SCORE_WEIGHTS.bookingFlow },
      status: { type: String },  // "Excellent", "Good", "Needs Work", "Critical"
      details: { type: String }, // "Fast bookings, good capture rate"
      metrics: {
        bookingRate: Number,        // % of calls that result in booking
        avgTimeToBook: Number,      // seconds
        accessInfoCaptureRate: Number,
        rescheduleSuccessRate: Number
      }
    },
    
    triageAccuracy: {
      score: { type: Number, min: 0, max: 100 },
      weight: { type: Number, default: SCORE_WEIGHTS.triageAccuracy },
      status: { type: String },
      details: { type: String },
      metrics: {
        matchRate: Number,           // % of calls matched by triage
        falsePositiveRate: Number,   // % wrong routing
        emergencyEscalationRate: Number, // should be 100%
        unmatchedPhraseCount: Number
      }
    },
    
    knowledgeCompleteness: {
      score: { type: Number, min: 0, max: 100 },
      weight: { type: Number, default: SCORE_WEIGHTS.knowledgeCompleteness },
      status: { type: String },
      details: { type: String },
      metrics: {
        questionAnswerRate: Number,  // % of questions agent could answer
        unansweredQuestionCount: Number,
        scenarioCoverage: Number,    // % of services with Brain-2 scenarios
        pricingCoverage: Number      // % of services with pricing info
      }
    },
    
    customerMemory: {
      score: { type: Number, min: 0, max: 100 },
      weight: { type: Number, default: SCORE_WEIGHTS.customerMemory },
      status: { type: String },
      details: { type: String },
      metrics: {
        recognitionRate: Number,     // % of returning callers recognized
        personalizedGreetingRate: Number,
        householdLinkRate: Number,
        multiPropertyHandlingRate: Number
      }
    },
    
    callOutcomes: {
      score: { type: Number, min: 0, max: 100 },
      weight: { type: Number, default: SCORE_WEIGHTS.callOutcomes },
      status: { type: String },
      details: { type: String },
      metrics: {
        successRate: Number,         // % calls with positive outcome
        hangupRate: Number,          // % callers who hung up (bad)
        transferRate: Number,        // lower = better (agent handling more)
        avgHandleTime: Number,       // seconds
        revenuePerCall: Number       // $$ - THE MONEY METRIC
      }
    },
    
    frontlineIntelligence: {
      score: { type: Number, min: 0, max: 100 },
      weight: { type: Number, default: SCORE_WEIGHTS.frontlineIntelligence },
      status: { type: String },
      details: { type: String },
      metrics: {
        greetingQuality: Number,     // LLM-assessed
        toneConsistency: Number,     // matches brand
        protocolCompleteness: Number, // all protocols present
        variableUsage: Number        // % of available variables used
      }
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // REVENUE METRICS (Enterprise Must-Have)
  // ═══════════════════════════════════════════════════════════════════════════
  revenue: {
    totalCalls: { type: Number, default: 0 },
    totalBookings: { type: Number, default: 0 },
    estimatedRevenue: { type: Number, default: 0 },     // $ from bookings
    revenuePerCall: { type: Number, default: 0 },       // $ per call
    revenuePerCallTrend: { type: String, enum: ['UP', 'DOWN', 'STABLE'] },
    revenuePerCallDelta: { type: Number, default: 0 },  // % change
    avgJobValue: { type: Number, default: 0 }           // $ per booking
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // LLM ANALYSIS (Cached - Generated at 3 AM)
  // ═══════════════════════════════════════════════════════════════════════════
  llmAnalysis: {
    generatedAt: { type: Date },
    cacheExpiresAt: { type: Date },
    
    // Top 5 prioritized improvements
    topImprovements: [{
      rank: { type: Number, min: 1, max: 5 },
      priority: { type: String, enum: ['HIGH', 'MEDIUM', 'LOW'] },
      category: { type: String },  // Which category this improves
      title: { type: String },
      description: { type: String },
      predictedImpact: { type: String }, // e.g., "+5% booking rate"
      actionType: { type: String },      // CREATE_CARD, UPDATE_SCRIPT, ADD_KEYWORD, etc.
      actionData: { type: mongoose.Schema.Types.Mixed },
      status: { 
        type: String, 
        enum: ['PENDING', 'APPLIED', 'REJECTED', 'SHADOW_TESTING'],
        default: 'PENDING'
      }
    }],
    
    // Weekly summary for client report
    weeklySummary: {
      headline: { type: String },
      highlights: [{ type: String }],
      concerns: [{ type: String }],
      recommendations: [{ type: String }]
    },
    
    // What agent learned this period
    learnings: [{
      type: { type: String }, // SYNONYM, NEW_PHRASE, PATTERN, etc.
      description: { type: String },
      example: { type: String }
    }]
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // RAW DATA SNAPSHOT (For debugging/audit)
  // ═══════════════════════════════════════════════════════════════════════════
  rawMetrics: {
    periodStart: { type: Date },
    periodEnd: { type: Date },
    totalCalls: { type: Number },
    totalBookings: { type: Number },
    totalTransfers: { type: Number },
    totalHangups: { type: Number },
    avgCallDuration: { type: Number },
    newCustomers: { type: Number },
    returningCustomers: { type: Number },
    unmatchedPhrases: [{ phrase: String, count: Number }],
    unansweredQuestions: [{ question: String, count: Number }]
  }
  
}, {
  timestamps: true,
  collection: 'agent_excellence_scores'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// One score per company per day
agentExcellenceScoreSchema.index({ companyId: 1, date: 1 }, { unique: true });

// Fast lookup for dashboard
agentExcellenceScoreSchema.index({ companyId: 1, date: -1 });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Calculate overall score from category scores using transparent weights
 */
agentExcellenceScoreSchema.statics.calculateOverallScore = function(categories) {
  let totalScore = 0;
  let totalWeight = 0;
  
  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
    if (categories[key]?.score !== undefined) {
      totalScore += categories[key].score * weight;
      totalWeight += weight;
    }
  }
  
  // Normalize if not all categories present
  return totalWeight > 0 ? Math.round(totalScore / totalWeight * 100) / 100 : 0;
};

/**
 * Get latest score for a company
 */
agentExcellenceScoreSchema.statics.getLatestScore = async function(companyId) {
  return this.findOne({ companyId }).sort({ date: -1 });
};

/**
 * Get score history for trending
 */
agentExcellenceScoreSchema.statics.getScoreHistory = async function(companyId, days = 30) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  return this.find({ 
    companyId, 
    date: { $gte: startDate } 
  })
  .sort({ date: 1 })
  .select('date overallScore trend revenue.revenuePerCall categories');
};

/**
 * Get status label from score
 */
agentExcellenceScoreSchema.statics.getStatusFromScore = function(score) {
  if (score >= 90) return { status: 'Excellent', color: 'green' };
  if (score >= 75) return { status: 'Good', color: 'blue' };
  if (score >= 60) return { status: 'Needs Work', color: 'yellow' };
  return { status: 'Critical', color: 'red' };
};

/**
 * Get scoring formula as human-readable string
 */
agentExcellenceScoreSchema.statics.getScoringFormula = function() {
  return {
    formula: 'Overall Score = (20% × Booking Flow) + (20% × Triage Accuracy) + (20% × Knowledge) + (15% × Customer Memory) + (15% × Call Outcomes) + (10% × Frontline Intel)',
    weights: SCORE_WEIGHTS,
    explanation: 'Scores are calculated using a transparent, deterministic formula. Each category is scored 0-100 based on real call metrics, then weighted and combined. No black-box AI scoring.'
  };
};

// Export weights for use elsewhere
agentExcellenceScoreSchema.statics.SCORE_WEIGHTS = SCORE_WEIGHTS;

const AgentExcellenceScore = mongoose.model('AgentExcellenceScore', agentExcellenceScoreSchema);

module.exports = AgentExcellenceScore;

