const mongoose = require('mongoose');

// Enterprise-grade Trade Category model with comprehensive Q&A management
const tradeCategorySchema = new mongoose.Schema({
  name: { type: String, required: true, unique: true, trim: true },
  
  // Enhanced Q&A with semantic capabilities
  qna: [{
    question: { type: String, required: true, trim: true },
    answer: { type: String, required: true, trim: true },
    keywords: [{ type: String, trim: true }], // For keyword matching
    semanticVector: [{ type: Number }], // For semantic search (Pinecone integration)
    confidence: { type: Number, default: 1, min: 0, max: 1 },
    category: { type: String, default: 'general', trim: true }, // Sub-categorization
    priority: { type: Number, default: 1 }, // Higher priority = more likely to match
    isActive: { type: Boolean, default: true },
    lastUsed: { type: Date, default: null },
    useCount: { type: Number, default: 0 }, // Track popularity for optimization
    createdBy: { type: String, default: 'system', trim: true },
    approvedBy: { type: String, default: null, trim: true },
    approvalStatus: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'approved' },
    learningSource: { type: String, enum: ['manual', 'auto-suggestion', 'conversation'], default: 'manual' },
    metadata: {
      tags: [{ type: String, trim: true }],
      difficulty: { type: String, enum: ['basic', 'intermediate', 'advanced'], default: 'basic' },
      businessArea: { type: String, enum: ['sales', 'support', 'technical', 'billing', 'general'], default: 'general' }
    }
  }],
  
  // Service types and specializations
  serviceTypes: [{
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    estimatedDuration: { type: Number }, // in minutes
    basePrice: { type: Number },
    isBookable: { type: Boolean, default: true },
    requiresConsultation: { type: Boolean, default: false },
    seasonalAvailability: {
      available: [{ type: String, enum: ['spring', 'summer', 'fall', 'winter'] }],
      peakSeason: [{ type: String, enum: ['spring', 'summer', 'fall', 'winter'] }]
    }
  }],
  
  // Common industry terminology and synonyms
  terminology: [{
    term: { type: String, required: true, trim: true },
    synonyms: [{ type: String, trim: true }],
    definition: { type: String, trim: true },
    commonMisspellings: [{ type: String, trim: true }]
  }],
  
  // Seasonal and time-based considerations
  seasonalFactors: {
    peakSeasons: [{ type: String, enum: ['spring', 'summer', 'fall', 'winter'] }],
    emergencyKeywords: [{ type: String, trim: true }], // "urgent", "emergency", "ASAP"
    weatherDependency: { type: Boolean, default: false },
    holidayConsiderations: { type: String, trim: true }
  },
  
  // Learning and optimization settings
  learningSettings: {
    autoLearnFromConversations: { type: Boolean, default: true },
    suggestionConfidenceThreshold: { type: Number, default: 0.7, min: 0, max: 1 },
    requireHumanApproval: { type: Boolean, default: true },
    maxSuggestionsPerDay: { type: Number, default: 5 }
  },
  
  // Performance analytics
  analytics: {
    totalQuestions: { type: Number, default: 0 },
    successfulMatches: { type: Number, default: 0 },
    averageConfidence: { type: Number, default: 0 },
    lastOptimized: { type: Date, default: null },
    topPerformingQAs: [{ questionId: mongoose.Schema.Types.ObjectId, score: Number }]
  },
  
  // Industry-specific metadata
  industryData: {
    averageJobDuration: { type: Number }, // hours
    certificationRequired: { type: Boolean, default: false },
    licenseRequired: { type: Boolean, default: false },
    insuranceRequired: { type: Boolean, default: false },
    commonTools: [{ type: String, trim: true }],
    safetyConsiderations: [{ type: String, trim: true }]
  },
  
  isActive: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  lastKnowledgeUpdate: { type: Date, default: Date.now }
});

// Indexes for performance (note: name index is auto-created by unique constraint)
tradeCategorySchema.index({ 'qna.keywords': 1 });
tradeCategorySchema.index({ 'qna.confidence': -1 });
tradeCategorySchema.index({ 'qna.useCount': -1 });

// Middleware
tradeCategorySchema.pre('save', function(next) {
  this.updatedAt = new Date();
  
  // Update analytics
  this.analytics.totalQuestions = this.qna.length;
  this.analytics.averageConfidence = this.qna.length > 0 
    ? this.qna.reduce((sum, qa) => sum + qa.confidence, 0) / this.qna.length 
    : 0;
  
  next();
});

// Instance methods
tradeCategorySchema.methods.findBestMatch = function(query, threshold = 0.5) {
  // Simple keyword matching - can be enhanced with semantic search
  const queryLower = query.toLowerCase();
  const matches = this.qna.filter(qa => {
    if (!qa.isActive) return false;
    
    const questionMatch = qa.question.toLowerCase().includes(queryLower);
    const keywordMatch = qa.keywords.some(keyword => 
      queryLower.includes(keyword.toLowerCase()) || keyword.toLowerCase().includes(queryLower)
    );
    
    return (questionMatch || keywordMatch) && qa.confidence >= threshold;
  });
  
  // Sort by confidence and usage count
  return matches.sort((a, b) => {
    const scoreA = a.confidence * 0.7 + (a.useCount / 100) * 0.3;
    const scoreB = b.confidence * 0.7 + (b.useCount / 100) * 0.3;
    return scoreB - scoreA;
  });
};

tradeCategorySchema.methods.recordUsage = function(qaId) {
  const qa = this.qna.id(qaId);
  if (qa) {
    qa.useCount += 1;
    qa.lastUsed = new Date();
  }
};

module.exports = mongoose.model('TradeCategory', tradeCategorySchema);
