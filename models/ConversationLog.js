const mongoose = require('mongoose');

// Comprehensive conversation logging for AI agent interactions
const conversationLogSchema = new mongoose.Schema({
  // Multi-tenant identification
  companyId: { type: String, required: true, trim: true, index: true },
  conversationId: { type: String, required: true, unique: true }, // Unique conversation identifier
  
  // Call/session metadata
  session: {
    startTime: { type: Date, required: true, default: Date.now },
    endTime: { type: Date },
    duration: { type: Number }, // Total duration in seconds
    channel: { type: String, enum: ['voice', 'sms', 'chat', 'email'], required: true },
    twilioCallSid: { type: String }, // For voice calls
    customerPhone: { type: String, trim: true },
    customerEmail: { type: String, trim: true, lowercase: true },
    sessionQuality: { type: String, enum: ['excellent', 'good', 'fair', 'poor'] }
  },
  
  // Customer information
  customer: {
    identifier: { type: String, trim: true }, // Phone, email, or other ID
    name: { type: String, trim: true },
    isReturning: { type: Boolean, default: false },
    previousConversations: [{ type: String }], // Array of previous conversation IDs
    customerType: { type: String, enum: ['new', 'returning', 'commercial', 'residential'] },
    languagePreference: { type: String, default: 'en', trim: true },
    accessibilityNeeds: [{ type: String }]
  },
  
  // Conversation flow and messages
  messages: [{
    messageId: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    speaker: { type: String, enum: ['customer', 'agent', 'system'], required: true },
    content: {
      text: { type: String, trim: true }, // Transcribed or typed text
      audioUrl: { type: String }, // URL to audio recording if available
      confidence: { type: Number, min: 0, max: 1 }, // Speech recognition confidence
      language: { type: String, default: 'en' }
    },
    intent: {
      detected: { type: String, trim: true }, // Detected customer intent
      confidence: { type: Number, min: 0, max: 1 },
      entities: [{ // Extracted entities (names, dates, services, etc.)
        type: { type: String, trim: true },
        value: { type: String, trim: true },
        confidence: { type: Number, min: 0, max: 1 }
      }]
    },
    response: {
      type: { type: String, enum: ['direct', 'knowledge_base', 'llm', 'transfer', 'escalation'] },
      source: { type: String, trim: true }, // Which knowledge base or model
      responseTime: { type: Number }, // Response generation time in ms
      confidence: { type: Number, min: 0, max: 1 },
      templateUsed: { type: String, trim: true }
    },
    flags: {
      requiresFollowUp: { type: Boolean, default: false },
      containsSensitiveInfo: { type: Boolean, default: false },
      wasEscalated: { type: Boolean, default: false },
      customerFrustrated: { type: Boolean, default: false },
      agentUncertain: { type: Boolean, default: false }
    }
  }],
  
  // Conversation analysis and metrics
  analysis: {
    // Overall conversation metrics
    totalTurns: { type: Number, default: 0 },
    customerTurns: { type: Number, default: 0 },
    agentTurns: { type: Number, default: 0 },
    avgResponseTime: { type: Number }, // Average agent response time
    avgConfidence: { type: Number, min: 0, max: 1 },
    
    // Intent and topic analysis
    primaryIntent: { type: String, trim: true },
    secondaryIntents: [{ type: String, trim: true }],
    topicsDiscussed: [{ type: String, trim: true }],
    servicesInquiredAbout: [{ type: String, trim: true }],
    
    // Sentiment analysis
    overallSentiment: { type: String, enum: ['positive', 'neutral', 'negative'] },
    sentimentScores: [{
      timestamp: { type: Date },
      score: { type: Number, min: -1, max: 1 },
      confidence: { type: Number, min: 0, max: 1 }
    }],
    
    // Quality metrics
    resolutionStatus: { 
      type: String, 
      enum: ['resolved', 'partial', 'unresolved', 'escalated', 'transferred'], 
      default: 'unresolved' 
    },
    customerSatisfaction: { type: Number, min: 1, max: 5 },
    agentPerformanceScore: { type: Number, min: 0, max: 100 },
    
    // Knowledge base effectiveness
    knowledgeGaps: [{ type: String, trim: true }], // Topics the agent couldn't handle
    suggestedImprovements: [{ type: String, trim: true }]
  },
  
  // Business outcomes
  outcomes: {
    bookingCreated: { type: Boolean, default: false },
    bookingId: { type: String, trim: true },
    leadGenerated: { type: Boolean, default: false },
    informationProvided: { type: Boolean, default: false },
    transferCompleted: { type: Boolean, default: false },
    transferRecipient: { type: String, trim: true },
    followUpRequired: { type: Boolean, default: false },
    followUpType: { type: String, enum: ['call', 'email', 'sms', 'booking'] },
    estimateProvided: { type: Boolean, default: false },
    businessValue: { type: Number } // Estimated business value of this conversation
  },
  
  // AI agent performance data
  agentPerformance: {
    model: { type: String, trim: true }, // Which AI model was used
    totalTokensUsed: { type: Number },
    llmCalls: { type: Number, default: 0 },
    knowledgeBaseLookups: { type: Number, default: 0 },
    escalationTriggers: [{
      trigger: { type: String, trim: true },
      timestamp: { type: Date },
      resolved: { type: Boolean, default: false }
    }],
    errorOccurrences: [{
      type: { type: String, trim: true },
      message: { type: String, trim: true },
      timestamp: { type: Date },
      severity: { type: String, enum: ['low', 'medium', 'high', 'critical'] }
    }]
  },
  
  // Learning and improvement data
  learning: {
    newInformationLearned: [{ type: String, trim: true }],
    suggestedKnowledgeUpdates: [{
      type: { type: String, enum: ['new_qa', 'update_qa', 'new_process'] },
      content: { type: String, trim: true },
      confidence: { type: Number, min: 0, max: 1 },
      autoApproved: { type: Boolean, default: false }
    }],
    conversationRating: { type: Number, min: 1, max: 5 }, // Internal quality rating
    reviewRequired: { type: Boolean, default: false },
    reviewNotes: { type: String, trim: true }
  },
  
  // Integration data
  integrations: {
    crmUpdated: { type: Boolean, default: false },
    calendarEventCreated: { type: Boolean, default: false },
    emailSent: { type: Boolean, default: false },
    smsSent: { type: Boolean, default: false },
    webhooksCalled: [{ type: String, trim: true }]
  },
  
  // Cost tracking
  costs: {
    llmCosts: { type: Number, default: 0 }, // LLM API costs
    telephonyCosts: { type: Number, default: 0 }, // Twilio costs
    totalCost: { type: Number, default: 0 }
  },
  
  // Audit and compliance
  audit: {
    dataRetentionCategory: { type: String, enum: ['standard', 'extended', 'minimal'], default: 'standard' },
    containsPII: { type: Boolean, default: false },
    consentGiven: { type: Boolean, default: false },
    recordingConsent: { type: Boolean, default: false },
    complianceFlags: [{ type: String, trim: true }]
  },
  
  // Status and workflow
  status: {
    current: { type: String, enum: ['active', 'completed', 'abandoned', 'error'], default: 'active' },
    needsReview: { type: Boolean, default: false },
    reviewedBy: { type: String, trim: true },
    reviewedAt: { type: Date },
    archived: { type: Boolean, default: false }
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Indexes for performance
conversationLogSchema.index({ companyId: 1, createdAt: -1 });
conversationLogSchema.index({ conversationId: 1 });
conversationLogSchema.index({ 'session.customerPhone': 1 });
conversationLogSchema.index({ 'analysis.primaryIntent': 1, companyId: 1 });
conversationLogSchema.index({ 'outcomes.bookingCreated': 1, companyId: 1 });
conversationLogSchema.index({ 'status.needsReview': 1 });

// Middleware
conversationLogSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Calculate session duration
  if (this.session.startTime && this.session.endTime) {
    this.session.duration = Math.floor((this.session.endTime - this.session.startTime) / 1000);
  }
  
  // Calculate conversation metrics
  this.analysis.totalTurns = this.messages.length;
  this.analysis.customerTurns = this.messages.filter(m => m.speaker === 'customer').length;
  this.analysis.agentTurns = this.messages.filter(m => m.speaker === 'agent').length;
  
  // Calculate average confidence
  const confidenceScores = this.messages
    .filter(m => m.response && m.response.confidence)
    .map(m => m.response.confidence);
  
  if (confidenceScores.length > 0) {
    this.analysis.avgConfidence = confidenceScores.reduce((sum, score) => sum + score, 0) / confidenceScores.length;
  }
  
  // Calculate total costs
  this.costs.totalCost = (this.costs.llmCosts || 0) + (this.costs.telephonyCosts || 0);
  
  next();
});

// Instance methods
conversationLogSchema.methods.addMessage = function(speaker, content, intent = null, response = null) {
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  this.messages.push({
    messageId,
    timestamp: new Date(),
    speaker,
    content,
    intent: intent || {},
    response: response || {},
    flags: {}
  });
  
  return this.save();
};

conversationLogSchema.methods.markCompleted = function(resolutionStatus = 'resolved') {
  this.session.endTime = new Date();
  this.status.current = 'completed';
  this.analysis.resolutionStatus = resolutionStatus;
  return this.save();
};

conversationLogSchema.methods.escalate = function(reason, recipient = null) {
  this.outcomes.transferCompleted = true;
  if (recipient) this.outcomes.transferRecipient = recipient;
  
  this.analysis.resolutionStatus = 'escalated';
  this.agentPerformance.escalationTriggers.push({
    trigger: reason,
    timestamp: new Date(),
    resolved: false
  });
  
  return this.save();
};

conversationLogSchema.methods.generateSummary = function() {
  return {
    conversationId: this.conversationId,
    duration: this.session.duration,
    customerPhone: this.session.customerPhone,
    primaryIntent: this.analysis.primaryIntent,
    resolutionStatus: this.analysis.resolutionStatus,
    bookingCreated: this.outcomes.bookingCreated,
    bookingId: this.outcomes.bookingId,
    customerSatisfaction: this.analysis.customerSatisfaction,
    agentPerformanceScore: this.analysis.agentPerformanceScore,
    totalCost: this.costs.totalCost,
    needsReview: this.status.needsReview
  };
};

// Static methods
conversationLogSchema.statics.getAnalyticsSummary = function(companyId, dateRange = null) {
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
        _id: null,
        totalConversations: { $sum: 1 },
        avgDuration: { $avg: '$session.duration' },
        avgConfidence: { $avg: '$analysis.avgConfidence' },
        totalBookings: { $sum: { $cond: ['$outcomes.bookingCreated', 1, 0] } },
        avgSatisfaction: { $avg: '$analysis.customerSatisfaction' },
        totalCost: { $sum: '$costs.totalCost' },
        resolutionStats: {
          $push: '$analysis.resolutionStatus'
        }
      }
    }
  ]);
};

conversationLogSchema.statics.findByCustomer = function(companyId, customerIdentifier) {
  return this.find({
    companyId,
    $or: [
      { 'session.customerPhone': customerIdentifier },
      { 'session.customerEmail': customerIdentifier },
      { 'customer.identifier': customerIdentifier }
    ]
  }).sort({ createdAt: -1 });
};

conversationLogSchema.statics.getPerformanceMetrics = function(companyId, dateRange = null) {
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
        _id: '$analysis.primaryIntent',
        count: { $sum: 1 },
        avgConfidence: { $avg: '$analysis.avgConfidence' },
        avgResponseTime: { $avg: '$analysis.avgResponseTime' },
        resolutionRate: {
          $avg: {
            $cond: [
              { $in: ['$analysis.resolutionStatus', ['resolved', 'partial']] },
              1,
              0
            ]
          }
        }
      }
    },
    { $sort: { count: -1 } }
  ]);
};

module.exports = mongoose.model('ConversationLog', conversationLogSchema);
