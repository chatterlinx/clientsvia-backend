const mongoose = require('mongoose');

// Learning queue for continuous AI improvement and knowledge base updates
const learningQueueSchema = new mongoose.Schema({
  // Multi-tenant identification
  companyId: { type: String, required: true, trim: true, index: true },
  queueId: { type: String, unique: true, required: true },
  
  // Source of learning opportunity
  source: {
    type: { type: String, enum: ['conversation', 'customer_feedback', 'manual_review', 'pattern_analysis', 'error_analysis'], required: true },
    conversationId: { type: String, trim: true }, // If from conversation
    messageId: { type: String, trim: true }, // Specific message that triggered learning
    customerPhone: { type: String, trim: true },
    reviewerId: { type: String, trim: true }, // If manually submitted
    timestamp: { type: Date, required: true, default: Date.now }
  },
  
  // Learning suggestion details
  suggestion: {
    type: { 
      type: String, 
      enum: ['new_qa', 'update_qa', 'new_category', 'improve_response', 'add_keyword', 'process_improvement'], 
      required: true 
    },
    title: { type: String, required: true, trim: true },
    description: { type: String, required: true, trim: true },
    
    // For Q&A suggestions
    suggestedQuestion: { type: String, trim: true },
    suggestedAnswer: { type: String, trim: true },
    suggestedKeywords: [{ type: String, trim: true }],
    targetCategory: { type: String, trim: true },
    
    // For response improvements
    originalResponse: { type: String, trim: true },
    improvedResponse: { type: String, trim: true },
    improvementReason: { type: String, trim: true },
    
    // For process improvements
    currentProcess: { type: String, trim: true },
    suggestedProcess: { type: String, trim: true },
    expectedBenefit: { type: String, trim: true }
  },
  
  // AI analysis and confidence
  aiAnalysis: {
    confidence: { type: Number, min: 0, max: 1, required: true },
    reasoning: { type: String, trim: true },
    supportingEvidence: [{ type: String, trim: true }],
    similarPatterns: [{ type: String, trim: true }], // Other conversations with similar patterns
    estimatedImpact: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    
    // Pattern analysis
    frequency: { type: Number, default: 1 }, // How often this issue/question appears
    customerFrustrationLevel: { type: Number, min: 0, max: 1, default: 0 },
    businessImpact: { type: String, enum: ['revenue', 'efficiency', 'satisfaction', 'cost_reduction'] },
    
    // Technical metadata
    modelVersion: { type: String, trim: true },
    analysisTimestamp: { type: Date, default: Date.now },
    vectorSimilarity: { type: Number, min: 0, max: 1 } // For semantic similarity analysis
  },
  
  // Review and approval workflow
  review: {
    status: { 
      type: String, 
      enum: ['pending', 'under_review', 'approved', 'rejected', 'implemented', 'archived'], 
      default: 'pending' 
    },
    priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
    assignedTo: { type: String, trim: true }, // Reviewer ID or role
    assignedAt: { type: Date },
    
    // Review decisions
    reviewedBy: { type: String, trim: true },
    reviewedAt: { type: Date },
    reviewNotes: { type: String, trim: true },
    rejectionReason: { type: String, trim: true },
    
    // Approval workflow
    approvalRequired: { type: Boolean, default: true },
    autoApprovalEligible: { type: Boolean, default: false }, // High confidence suggestions
    approvedBy: { type: String, trim: true },
    approvedAt: { type: Date },
    
    // Implementation tracking
    implementedBy: { type: String, trim: true },
    implementedAt: { type: Date },
    implementationNotes: { type: String, trim: true },
    testingRequired: { type: Boolean, default: false },
    testingCompleted: { type: Boolean, default: false }
  },
  
  // Related data and context
  context: {
    customerContext: { type: String, trim: true }, // What the customer was trying to achieve
    conversationPhase: { type: String, enum: ['greeting', 'inquiry', 'booking', 'transfer', 'closing'] },
    previousFailures: { type: Number, default: 0 }, // Times agent failed to handle this
    seasonalRelevance: [{ type: String, enum: ['spring', 'summer', 'fall', 'winter'] }],
    urgencyLevel: { type: String, enum: ['routine', 'urgent', 'emergency'] },
    
    // Business context
    serviceCategory: { type: String, trim: true },
    businessArea: { type: String, enum: ['sales', 'support', 'technical', 'billing', 'emergency'] },
    customerSegment: { type: String, enum: ['new', 'returning', 'commercial', 'residential'] }
  },
  
  // Impact measurement
  impact: {
    // Pre-implementation metrics
    currentPerformance: {
      successRate: { type: Number, min: 0, max: 1 },
      avgConfidence: { type: Number, min: 0, max: 1 },
      escalationRate: { type: Number, min: 0, max: 1 },
      customerSatisfaction: { type: Number, min: 1, max: 5 }
    },
    
    // Post-implementation tracking
    postImplementation: {
      measuredAt: { type: Date },
      newSuccessRate: { type: Number, min: 0, max: 1 },
      newAvgConfidence: { type: Number, min: 0, max: 1 },
      newEscalationRate: { type: Number, min: 0, max: 1 },
      newCustomerSatisfaction: { type: Number, min: 1, max: 5 },
      improvementVerified: { type: Boolean, default: false }
    },
    
    // Business metrics
    estimatedValueAdd: { type: Number }, // Dollar value of improvement
    timesSaved: { type: Number }, // Minutes saved per interaction
    customersSatisfied: { type: Number } // Additional customers helped
  },
  
  // Learning metadata
  learning: {
    learningType: { type: String, enum: ['factual', 'procedural', 'conversational', 'emotional'] },
    difficultyLevel: { type: String, enum: ['basic', 'intermediate', 'advanced', 'expert'] },
    knowledgeDomain: { type: String, trim: true }, // e.g., "plumbing_emergencies", "pricing_hvac"
    
    // Knowledge graph connections
    relatedTopics: [{ type: String, trim: true }],
    prerequisiteKnowledge: [{ type: String, trim: true }],
    conflictingInformation: [{ type: String, trim: true }],
    
    // Training data
    trainingExamples: [{
      input: { type: String, trim: true },
      expectedOutput: { type: String, trim: true },
      context: { type: String, trim: true }
    }]
  },
  
  // Quality assurance
  quality: {
    validationScore: { type: Number, min: 0, max: 1 }, // How well validated the suggestion is
    testCases: [{
      scenario: { type: String, trim: true },
      expectedBehavior: { type: String, trim: true },
      actualBehavior: { type: String, trim: true },
      passed: { type: Boolean }
    }],
    
    // Risk assessment
    riskLevel: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    potentialIssues: [{ type: String, trim: true }],
    rollbackPlan: { type: String, trim: true }
  },
  
  // Automation and triggers
  automation: {
    autoImplement: { type: Boolean, default: false }, // Auto-implement if confidence is high enough
    triggerConditions: [{ type: String, trim: true }], // Conditions that triggered this suggestion
    monitoringMetrics: [{ type: String, trim: true }], // Metrics to watch post-implementation
    rollbackTriggers: [{ type: String, trim: true }] // Conditions that would trigger rollback
  },
  
  // Collaboration and feedback
  collaboration: {
    stakeholders: [{ type: String, trim: true }], // People who should be notified
    expertConsultation: { type: Boolean, default: false },
    expertFeedback: { type: String, trim: true },
    
    // Team feedback
    teamVotes: [{
      userId: { type: String, trim: true },
      vote: { type: String, enum: ['approve', 'reject', 'needs_revision'] },
      comment: { type: String, trim: true },
      votedAt: { type: Date, default: Date.now }
    }],
    consensusReached: { type: Boolean, default: false }
  },
  
  // Versioning and history
  version: { type: Number, default: 1 },
  previousVersions: [{
    version: { type: Number },
    changes: { type: String, trim: true },
    changedBy: { type: String, trim: true },
    changedAt: { type: Date, default: Date.now }
  }],
  
  // Status tracking
  statusHistory: [{
    status: { type: String },
    changedAt: { type: Date, default: Date.now },
    changedBy: { type: String, trim: true },
    reason: { type: String, trim: true }
  }],
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes for performance
learningQueueSchema.index({ companyId: 1, 'review.status': 1 });
learningQueueSchema.index({ 'review.priority': -1, 'aiAnalysis.confidence': -1 });
learningQueueSchema.index({ 'source.conversationId': 1 });
learningQueueSchema.index({ 'aiAnalysis.estimatedImpact': 1, companyId: 1 });
learningQueueSchema.index({ createdAt: -1 });

// Middleware
learningQueueSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Generate queue ID if not exists
  if (!this.queueId) {
    const timestamp = Date.now().toString(36);
    const random = Math.random().toString(36).substr(2, 5);
    this.queueId = `lq_${timestamp}${random}`.toUpperCase();
  }
  
  // Track status changes
  if (this.isModified('review.status')) {
    this.statusHistory.push({
      status: this.review.status,
      changedAt: new Date(),
      changedBy: this.review.reviewedBy || 'system'
    });
  }
  
  // Auto-approval logic for high confidence suggestions
  if (this.aiAnalysis.confidence >= 0.95 && this.review.autoApprovalEligible && this.review.status === 'pending') {
    this.review.status = 'approved';
    this.review.approvedBy = 'auto-system';
    this.review.approvedAt = new Date();
    this.automation.autoImplement = true;
  }
  
  next();
});

// Instance methods
learningQueueSchema.methods.approve = function(approvedBy, notes = '') {
  this.review.status = 'approved';
  this.review.approvedBy = approvedBy;
  this.review.approvedAt = new Date();
  this.review.reviewNotes = notes;
  return this.save();
};

learningQueueSchema.methods.reject = function(rejectedBy, reason, notes = '') {
  this.review.status = 'rejected';
  this.review.reviewedBy = rejectedBy;
  this.review.reviewedAt = new Date();
  this.review.rejectionReason = reason;
  this.review.reviewNotes = notes;
  return this.save();
};

learningQueueSchema.methods.implement = function(implementedBy, notes = '') {
  this.review.status = 'implemented';
  this.review.implementedBy = implementedBy;
  this.review.implementedAt = new Date();
  this.review.implementationNotes = notes;
  return this.save();
};

learningQueueSchema.methods.measureImpact = function(metrics) {
  this.impact.postImplementation = {
    ...metrics,
    measuredAt: new Date()
  };
  
  // Determine if improvement was verified
  const current = this.impact.currentPerformance;
  const post = this.impact.postImplementation;
  
  this.impact.postImplementation.improvementVerified = 
    post.newSuccessRate > current.successRate ||
    post.newAvgConfidence > current.avgConfidence ||
    post.newEscalationRate < current.escalationRate ||
    post.newCustomerSatisfaction > current.customerSatisfaction;
  
  return this.save();
};

// Static methods
learningQueueSchema.statics.getPendingReviews = function(companyId, priority = null) {
  const query = { 
    companyId, 
    'review.status': { $in: ['pending', 'under_review'] } 
  };
  
  if (priority) {
    query['review.priority'] = priority;
  }
  
  return this.find(query)
    .sort({ 'review.priority': -1, 'aiAnalysis.confidence': -1, createdAt: 1 })
    .limit(50);
};

learningQueueSchema.statics.getHighImpactSuggestions = function(companyId, limit = 10) {
  return this.find({
    companyId,
    'review.status': 'pending',
    'aiAnalysis.estimatedImpact': 'high',
    'aiAnalysis.confidence': { $gte: 0.7 }
  })
  .sort({ 'aiAnalysis.confidence': -1, 'aiAnalysis.frequency': -1 })
  .limit(limit);
};

learningQueueSchema.statics.getImplementationQueue = function(companyId) {
  return this.find({
    companyId,
    'review.status': 'approved',
    'automation.autoImplement': true
  })
  .sort({ 'review.priority': -1, 'aiAnalysis.confidence': -1 });
};

learningQueueSchema.statics.getLearningAnalytics = function(companyId, dateRange = null) {
  const matchStage = { companyId };
  
  if (dateRange) {
    matchStage.createdAt = {
      $gte: dateRange.start,
      $lte: dateRange.end
    };
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$review.status',
        count: { $sum: 1 },
        avgConfidence: { $avg: '$aiAnalysis.confidence' },
        highImpact: { 
          $sum: { 
            $cond: [{ $eq: ['$aiAnalysis.estimatedImpact', 'high'] }, 1, 0] 
          } 
        }
      }
    }
  ]);
};

module.exports = mongoose.model('LearningQueue', learningQueueSchema);
