// models/PendingQnA.js
// AI Agent Logic - Pending Q&A Management System
// Spartan Coder - Bulletproof Gold Standard Implementation
// STRICTLY CONFINED TO AI AGENT LOGIC TAB

const mongoose = require('mongoose');

const pendingQnASchema = new mongoose.Schema({
  // Company isolation for multi-tenant security
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'Company ID is required for Q&A isolation'],
    index: true
  },
  
  // Core Q&A data with validation
  question: {
    type: String,
    required: [true, 'Question is required'],
    trim: true,
    maxlength: [2000, 'Question cannot exceed 2000 characters'],
    validate: {
      validator: function(v) {
        return v && v.length > 5;
      },
      message: 'Question must be at least 5 characters long'
    }
  },
  
  proposedAnswer: {
    type: String,
    default: '',
    trim: true,
    maxlength: [5000, 'Proposed answer cannot exceed 5000 characters']
  },
  
  // Analytics and tracking
  frequency: {
    type: Number,
    default: 1,
    min: [1, 'Frequency must be at least 1']
  },
  
  status: {
    type: String,
    enum: {
      values: ['pending', 'approved', 'rejected', 'in_review'],
      message: 'Invalid status: {VALUE}'
    },
    default: 'pending',
    index: true
  },
  
  // Temporal tracking
  lastAsked: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  updatedAt: {
    type: Date,
    default: Date.now
  },
  
  // AI Agent Logic specific fields
  aiAgentContext: {
    traceId: {
      type: String,
      trim: true
    },
    sessionId: {
      type: String,
      trim: true
    },
    source: {
      type: String,
      enum: ['chat', 'voice', 'webhook', 'manual'],
      default: 'chat'
    },
    confidence: {
      type: Number,
      min: 0,
      max: 1,
      default: 0
    },
    intent: {
      type: String,
      trim: true
    }
  },
  
  // Administrative fields
  notes: {
    type: String,
    trim: true,
    maxlength: [1000, 'Notes cannot exceed 1000 characters']
  },
  
  reviewedBy: {
    type: String,
    trim: true
  },
  
  reviewedAt: {
    type: Date
  },
  
  // Priority scoring for AI Agent Logic
  priority: {
    type: String,
    enum: ['low', 'medium', 'high', 'urgent'],
    default: 'medium'
  },
  
  tags: [{
    type: String,
    trim: true,
    lowercase: true
  }]
}, {
  timestamps: true,
  collection: 'ai_agent_pending_qnas', // AI Agent Logic specific collection
  strict: true, // Prevent additional fields
  versionKey: false // Remove __v field
});

// Performance-optimized indexes for AI Agent Logic queries
pendingQnASchema.index({ companyId: 1, status: 1, createdAt: -1 });
pendingQnASchema.index({ companyId: 1, frequency: -1, lastAsked: -1 });
pendingQnASchema.index({ 'aiAgentContext.sessionId': 1, createdAt: -1 });
pendingQnASchema.index({ 'aiAgentContext.traceId': 1 });
pendingQnASchema.index({ priority: 1, frequency: -1 });

// Full-text search index for questions and answers
pendingQnASchema.index({ 
  question: 'text', 
  proposedAnswer: 'text',
  notes: 'text'
}, {
  name: 'qna_search_index',
  weights: { 
    question: 10, 
    proposedAnswer: 5, 
    notes: 2 
  }
});

// Pre-save middleware for data validation and defaults
pendingQnASchema.pre('save', function(next) {
  // Update timestamps
  this.updatedAt = new Date();
  
  // Auto-set priority based on frequency
  if (this.frequency >= 10) {
    this.priority = 'urgent';
  } else if (this.frequency >= 5) {
    this.priority = 'high';
  } else if (this.frequency >= 2) {
    this.priority = 'medium';
  }
  
  // Ensure AI Agent context exists
  if (!this.aiAgentContext) {
    this.aiAgentContext = {};
  }
  
  // Generate trace ID if missing
  if (!this.aiAgentContext.traceId) {
    this.aiAgentContext.traceId = `qna_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
  
  next();
});

// Instance methods for AI Agent Logic operations
pendingQnASchema.methods.incrementFrequency = function() {
  this.frequency += 1;
  this.lastAsked = new Date();
  return this.save();
};

pendingQnASchema.methods.approve = function(reviewedBy = 'system') {
  this.status = 'approved';
  this.reviewedBy = reviewedBy;
  this.reviewedAt = new Date();
  return this.save();
};

pendingQnASchema.methods.reject = function(reviewedBy = 'system', notes = '') {
  this.status = 'rejected';
  this.reviewedBy = reviewedBy;
  this.reviewedAt = new Date();
  if (notes) this.notes = notes;
  return this.save();
};

// Static methods for AI Agent Logic analytics
pendingQnASchema.statics.getStatsForCompany = async function(companyId, since = new Date(Date.now() - 24 * 60 * 60 * 1000)) {
  try {
    const pipeline = [
      { 
        $match: { 
          companyId: new mongoose.Types.ObjectId(companyId),
          createdAt: { $gte: since }
        }
      },
      {
        $group: {
          _id: null,
          totalPending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          totalApproved: { $sum: { $cond: [{ $eq: ['$status', 'approved'] }, 1, 0] } },
          totalRejected: { $sum: { $cond: [{ $eq: ['$status', 'rejected'] }, 1, 0] } },
          totalQuestions: { $sum: 1 },
          avgFrequency: { $avg: '$frequency' },
          highPriority: { $sum: { $cond: [{ $in: ['$priority', ['high', 'urgent']] }, 1, 0] } }
        }
      }
    ];

    const results = await this.aggregate(pipeline);
    const stats = results[0] || {
      totalPending: 0,
      totalApproved: 0,
      totalRejected: 0,
      totalQuestions: 0,
      avgFrequency: 0,
      highPriority: 0
    };

    return {
      ...stats,
      approvalRate: stats.totalQuestions > 0 ? (stats.totalApproved / stats.totalQuestions * 100).toFixed(1) : 0,
      pendingRate: stats.totalQuestions > 0 ? (stats.totalPending / stats.totalQuestions * 100).toFixed(1) : 0
    };
  } catch (error) {
    console.error('[PendingQnA] Error getting stats:', error);
    throw error;
  }
};

pendingQnASchema.statics.findSimilarQuestions = async function(companyId, question, threshold = 0.6) {
  try {
    // Use text search to find similar questions
    const results = await this.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      $text: { $search: question }
    }, {
      score: { $meta: 'textScore' }
    }).sort({ score: { $meta: 'textScore' } }).limit(5);

    return results.filter(result => result.score >= threshold);
  } catch (error) {
    console.error('[PendingQnA] Error finding similar questions:', error);
    return [];
  }
};

// Export the model
module.exports = mongoose.model('PendingQnA', pendingQnASchema);
