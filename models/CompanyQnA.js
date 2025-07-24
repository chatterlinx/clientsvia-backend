const mongoose = require('mongoose');

// Company-specific Q&A model for multi-tenant knowledge base
const companyQnASchema = new mongoose.Schema({
  companyId: { type: String, required: true, trim: true, index: true },
  
  // Core Q&A content
  question: { type: String, required: true, trim: true },
  answer: { type: String, required: true, trim: true },
  
  // Enhanced matching and categorization
  keywords: [{ type: String, trim: true }],
  category: { type: String, default: 'general', trim: true },
  tradeCategory: { type: String, trim: true }, // Link to trade categories
  
  // AI and semantic search integration
  semanticVector: [{ type: Number }], // For Pinecone vector storage
  confidence: { type: Number, default: 1, min: 0, max: 1 },
  priority: { type: Number, default: 1 }, // Higher = more important
  
  // Content management
  isActive: { type: Boolean, default: true },
  isApproved: { type: Boolean, default: true },
  approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected', 'needs_review'], default: 'approved' },
  
  // Learning and optimization
  source: { 
    type: String, 
    enum: ['manual', 'auto-learned', 'imported', 'conversation', 'suggestion'], 
    default: 'manual' 
  },
  learningMetadata: {
    originalConversationId: { type: String },
    extractedContext: { type: String },
    suggestedBy: { type: String, enum: ['ai', 'agent', 'customer', 'admin'] },
    confidenceScore: { type: Number, min: 0, max: 1 },
    reviewNotes: { type: String }
  },
  
  // Usage analytics
  analytics: {
    useCount: { type: Number, default: 0 },
    lastUsed: { type: Date },
    successRate: { type: Number, default: 0 }, // How often this answer was helpful
    avgResponseTime: { type: Number, default: 0 }, // milliseconds
    customerSatisfactionScore: { type: Number, min: 1, max: 5 }
  },
  
  // Contextual information
  context: {
    situationalUse: [{ type: String, trim: true }], // "during booking", "after hours", etc.
    customerType: [{ type: String, enum: ['new', 'returning', 'commercial', 'residential'] }],
    urgencyLevel: { type: String, enum: ['low', 'medium', 'high', 'emergency'], default: 'medium' },
    timeOfYear: [{ type: String, enum: ['spring', 'summer', 'fall', 'winter'] }],
    businessHours: { type: Boolean, default: null } // null = any time, true = business hours only
  },
  
  // Related content and follow-ups
  relatedQuestions: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CompanyQnA' }],
  followUpQuestions: [{ type: String, trim: true }],
  alternateAnswers: [{
    answer: { type: String, trim: true },
    useCase: { type: String, trim: true },
    confidence: { type: Number, min: 0, max: 1, default: 0.8 }
  }],
  
  // Version control
  version: { type: Number, default: 1 },
  previousVersions: [{
    question: { type: String },
    answer: { type: String },
    modifiedAt: { type: Date, default: Date.now },
    modifiedBy: { type: String }
  }],
  
  // Audit trail
  createdBy: { type: String, default: 'system', trim: true },
  modifiedBy: { type: String, trim: true },
  approvedBy: { type: String, trim: true },
  
  // Flags and special handling
  flags: {
    requiresPersonalization: { type: Boolean, default: false }, // Should include customer name, etc.
    requiresUpdate: { type: Boolean, default: false },
    isSeasonalContent: { type: Boolean, default: false },
    containsSensitiveInfo: { type: Boolean, default: false },
    requiresCallBack: { type: Boolean, default: false }
  },
  
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

// Compound indexes for performance
companyQnASchema.index({ companyId: 1, category: 1 });
companyQnASchema.index({ companyId: 1, isActive: 1, confidence: -1 });
companyQnASchema.index({ companyId: 1, keywords: 1 });
companyQnASchema.index({ 'analytics.useCount': -1 });

// Middleware
companyQnASchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Auto-increment version on content changes
  if (this.isModified('question') || this.isModified('answer')) {
    if (!this.isNew) {
      this.previousVersions.push({
        question: this.question,
        answer: this.answer,
        modifiedAt: new Date(),
        modifiedBy: this.modifiedBy || 'system'
      });
      this.version += 1;
    }
  }
  
  next();
});

// Instance methods
companyQnASchema.methods.recordUsage = function(wasHelpful = true, responseTime = 0) {
  this.analytics.useCount += 1;
  this.analytics.lastUsed = new Date();
  
  if (responseTime > 0) {
    // Calculate rolling average response time
    const currentAvg = this.analytics.avgResponseTime || 0;
    const count = this.analytics.useCount;
    this.analytics.avgResponseTime = ((currentAvg * (count - 1)) + responseTime) / count;
  }
  
  if (wasHelpful !== null) {
    // Calculate rolling success rate
    const currentRate = this.analytics.successRate || 0;
    const count = this.analytics.useCount;
    const newSuccessCount = (currentRate * (count - 1)) + (wasHelpful ? 1 : 0);
    this.analytics.successRate = newSuccessCount / count;
  }
  
  return this.save();
};

companyQnASchema.methods.addCustomerFeedback = function(satisfactionScore) {
  if (satisfactionScore >= 1 && satisfactionScore <= 5) {
    this.analytics.customerSatisfactionScore = satisfactionScore;
    return this.save();
  }
  throw new Error('Satisfaction score must be between 1 and 5');
};

// Static methods
companyQnASchema.statics.findBestMatches = function(companyId, query, options = {}) {
  const {
    limit = 5,
    threshold = 0.5,
    category = null,
    tradeCategory = null,
    contextFilters = {}
  } = options;
  
  const matchConditions = {
    companyId,
    isActive: true,
    isApproved: true,
    confidence: { $gte: threshold }
  };
  
  if (category) matchConditions.category = category;
  if (tradeCategory) matchConditions.tradeCategory = tradeCategory;
  
  // Add context filters
  Object.keys(contextFilters).forEach(key => {
    if (contextFilters[key] !== null && contextFilters[key] !== undefined) {
      matchConditions[`context.${key}`] = contextFilters[key];
    }
  });
  
  // Text search across question, answer, and keywords
  const textSearchConditions = {
    $or: [
      { question: { $regex: query, $options: 'i' } },
      { answer: { $regex: query, $options: 'i' } },
      { keywords: { $in: [new RegExp(query, 'i')] } }
    ]
  };
  
  return this.find({
    ...matchConditions,
    ...textSearchConditions
  })
  .sort({ 
    confidence: -1, 
    'analytics.useCount': -1, 
    'analytics.successRate': -1 
  })
  .limit(limit);
};

companyQnASchema.statics.getAnalyticsSummary = function(companyId, dateRange = null) {
  const matchStage = { companyId };
  
  if (dateRange) {
    matchStage.updatedAt = {
      $gte: dateRange.start,
      $lte: dateRange.end
    };
  }
  
  return this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: null,
        totalQAs: { $sum: 1 },
        totalUsage: { $sum: '$analytics.useCount' },
        avgConfidence: { $avg: '$confidence' },
        avgSuccessRate: { $avg: '$analytics.successRate' },
        avgResponseTime: { $avg: '$analytics.avgResponseTime' },
        topCategories: { $push: '$category' }
      }
    }
  ]);
};

module.exports = mongoose.model('CompanyQnA', companyQnASchema);
