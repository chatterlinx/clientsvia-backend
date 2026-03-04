/**
 * CallIntelligence Model
 * 
 * Stores AI-powered analysis of call performance, trigger matching,
 * and actionable recommendations for system improvement.
 * 
 * @module models/CallIntelligence
 */

const mongoose = require('mongoose');

const RecommendationSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    enum: ['add_keyword', 'create_trigger', 'update_bucket', 'improve_response', 'fix_scrabengine'],
    required: true
  },
  priority: {
    type: String,
    enum: ['immediate', 'high', 'medium', 'low'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  copyableContent: {
    type: String,
    required: false
  },
  targetTrigger: {
    type: String,
    required: false
  },
  targetBucket: {
    type: String,
    required: false
  },
  status: {
    type: String,
    enum: ['pending', 'implemented', 'dismissed'],
    default: 'pending'
  },
  implementedAt: {
    type: Date,
    required: false
  },
  implementedBy: {
    type: String,
    required: false
  }
}, { _id: false });

const IssueSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true
  },
  severity: {
    type: String,
    enum: ['critical', 'high', 'medium', 'low'],
    required: true
  },
  category: {
    type: String,
    enum: ['trigger_match', 'bucket_gap', 'scrabengine', 'response_quality', 'performance'],
    required: true
  },
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  evidence: {
    type: mongoose.Schema.Types.Mixed,
    required: false
  },
  affectedComponent: {
    type: String,
    required: false
  }
}, { _id: false });

const AnalysisSectionSchema = new mongoose.Schema({
  triggerAnalysis: {
    totalTriggersEvaluated: Number,
    triggersMatched: Number,
    matchRate: Number,
    topIssue: String,
    tokensDelivered: [String],
    normalizedInput: String
  },
  scrabEnginePerformance: {
    overallStatus: {
      type: String,
      enum: ['excellent', 'good', 'needs_improvement', 'poor']
    },
    stages: {
      fillerRemoval: mongoose.Schema.Types.Mixed,
      vocabularyNormalization: mongoose.Schema.Types.Mixed,
      tokenExpansion: mongoose.Schema.Types.Mixed,
      entityExtraction: mongoose.Schema.Types.Mixed,
      qualityAssessment: mongoose.Schema.Types.Mixed
    },
    totalProcessingTime: Number
  },
  callFlowAnalysis: {
    totalTurns: Number,
    pathsSelected: [String],
    fallbackUsed: Boolean,
    responseQuality: String
  },
  performanceMetrics: {
    triggerEvaluationTime: Number,
    scrabEngineTime: Number,
    totalResponseTime: Number,
    efficiency: String
  }
}, { _id: false });

const CallIntelligenceSchema = new mongoose.Schema({
  callSid: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  companyId: {
    type: String,
    required: true,
    index: true
  },
  analyzedAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  status: {
    type: String,
    enum: ['critical', 'needs_improvement', 'performing_well'],
    required: true,
    index: true
  },
  issueCount: {
    type: Number,
    default: 0
  },
  criticalIssueCount: {
    type: Number,
    default: 0
  },
  executiveSummary: {
    type: String,
    required: true
  },
  topIssue: {
    type: String,
    required: false
  },
  issues: [IssueSchema],
  recommendations: [RecommendationSchema],
  analysis: AnalysisSectionSchema,
  gpt4Analysis: {
    enabled: {
      type: Boolean,
      default: false
    },
    tokensUsed: {
      type: Number,
      required: false
    },
    processingTime: {
      type: Number,
      required: false
    },
    modelVersion: {
      type: String,
      required: false
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      required: false
    }
  },
  callMetadata: {
    duration: Number,
    turns: Number,
    fromPhone: String,
    startTime: Date
  }
}, {
  timestamps: true,
  collection: 'call_intelligence'
});

CallIntelligenceSchema.index({ companyId: 1, analyzedAt: -1 });
CallIntelligenceSchema.index({ companyId: 1, status: 1 });
CallIntelligenceSchema.index({ callSid: 1 }, { unique: true });

CallIntelligenceSchema.methods.getTopRecommendation = function() {
  if (!this.recommendations || this.recommendations.length === 0) {
    return null;
  }
  
  const priorityOrder = { immediate: 0, high: 1, medium: 2, low: 3 };
  const pending = this.recommendations.filter(r => r.status === 'pending');
  
  return pending.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority])[0];
};

CallIntelligenceSchema.methods.markRecommendationImplemented = function(recommendationId, implementedBy) {
  const recommendation = this.recommendations.find(r => r.id === recommendationId);
  if (recommendation) {
    recommendation.status = 'implemented';
    recommendation.implementedAt = new Date();
    recommendation.implementedBy = implementedBy;
  }
  return this.save();
};

CallIntelligenceSchema.statics.getCompanySummary = async function(companyId, dateRange = {}) {
  const query = { companyId };
  
  if (dateRange.start && dateRange.end) {
    query.analyzedAt = {
      $gte: new Date(dateRange.start),
      $lte: new Date(dateRange.end)
    };
  }
  
  const [total, critical, needsImprovement, performingWell] = await Promise.all([
    this.countDocuments(query),
    this.countDocuments({ ...query, status: 'critical' }),
    this.countDocuments({ ...query, status: 'needs_improvement' }),
    this.countDocuments({ ...query, status: 'performing_well' })
  ]);
  
  return {
    total,
    critical,
    needsImprovement,
    performingWell,
    matchRate: total > 0 ? ((performingWell / total) * 100).toFixed(1) : 0
  };
};

module.exports = mongoose.model('CallIntelligence', CallIntelligenceSchema);
