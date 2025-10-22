// models/NotificationLog.js
// AI Agent Logic Notification Logging System
// Spartan Coder - Bulletproof Gold Standard Implementation
// STRICTLY CONFINED TO AI AGENT LOGIC TAB

const mongoose = require('mongoose');

const NotificationLogSchema = new mongoose.Schema({
  // Core notification data with strict validation
  type: {
    type: String,
    required: [true, 'Notification type is required'],
    enum: {
      values: ['sms', 'email', 'event_hook', 'voice', 'webhook'],
      message: 'Invalid notification type: {VALUE}'
    },
    index: true
  },
  
  recipient: {
    type: String,
    required: [true, 'Recipient is required'],
    trim: true,
    validate: {
      validator(v) {
        return v && v.length > 0;
      },
      message: 'Recipient cannot be empty'
    }
  },
  
  subject: {
    type: String,
    default: null,
    trim: true
  },
  
  message: {
    type: String,
    required: [true, 'Message is required'],
    maxlength: [10000, 'Message cannot exceed 10,000 characters'],
    validate: {
      validator(v) {
        return v && v.length > 0;
      },
      message: 'Message cannot be empty'
    }
  },
  
  templateKey: {
    type: String,
    default: null,
    trim: true
  },
  
  status: {
    type: String,
    required: [true, 'Status is required'],
    enum: {
      values: ['sent', 'failed', 'pending', 'completed', 'retrying'],
      message: 'Invalid status: {VALUE}'
    },
    default: 'pending',
    index: true
  },
  
  errorMessage: {
    type: String,
    default: null,
    trim: true
  },
  
  // Metadata for rich analytics - AI Agent Logic specific
  metadata: {
    templateData: mongoose.Schema.Types.Mixed,
    result: mongoose.Schema.Types.Mixed,
    channel: { type: String, trim: true },
    fromAgent: { 
      type: Boolean, 
      default: true, // Default true for AI Agent Logic tab
      required: true,
      index: true
    },
    companyId: { 
      type: mongoose.Schema.Types.ObjectId, 
      ref: 'Company',
      required: [true, 'Company ID is required for AI Agent Logic'],
      index: true
    },
    sessionId: { type: String, trim: true },
    traceId: { type: String, trim: true }
  },
  
  // AI Agent Logic EXCLUSIVE context
  aiAgentContext: {
    source: {
      type: String,
      enum: {
        values: ['notification_service', 'agent_event_hooks', 'transfer_router', 'booking_flow', 'manual'],
        message: 'Invalid AI Agent source: {VALUE}'
      },
      required: [true, 'AI Agent source is required'],
      index: true
    },
    eventType: { 
      type: String, 
      trim: true,
      index: true
    },
    processingTime: { 
      type: Number, 
      default: 0,
      min: [0, 'Processing time cannot be negative']
    },
    success: { 
      type: Boolean, 
      default: false,
      index: true
    },
    sessionId: { type: String, trim: true },
    conversationStep: { type: String, trim: true },
    confidenceScore: { 
      type: Number,
      min: [0, 'Confidence score cannot be negative'],
      max: [1, 'Confidence score cannot exceed 1']
    },
    intentDetected: { type: String, trim: true }
  }
}, {
  timestamps: true,
  collection: 'ai_agent_notification_logs', // Renamed for AI Agent Logic isolation
  strict: true, // Prevent additional fields
  versionKey: false // Remove __v field
});

// Performance-optimized indexes for AI Agent Logic queries
NotificationLogSchema.index({ createdAt: -1 });
NotificationLogSchema.index({ 'metadata.fromAgent': 1, createdAt: -1 });
NotificationLogSchema.index({ 'metadata.companyId': 1, createdAt: -1 });
NotificationLogSchema.index({ 'aiAgentContext.source': 1, createdAt: -1 });
NotificationLogSchema.index({ type: 1, status: 1, createdAt: -1 });
NotificationLogSchema.index({ 'aiAgentContext.eventType': 1, createdAt: -1 });
NotificationLogSchema.index({ 'aiAgentContext.success': 1, createdAt: -1 });

// Text search index for message content and recipient search
NotificationLogSchema.index({ 
  message: 'text', 
  recipient: 'text', 
  subject: 'text' 
}, {
  name: 'notification_search_index',
  weights: { 
    message: 10, 
    recipient: 5, 
    subject: 3 
  }
});

// Compound indexes for complex AI Agent Logic queries
NotificationLogSchema.index({ 
  'metadata.fromAgent': 1, 
  'aiAgentContext.source': 1, 
  createdAt: -1 
});

// Pre-save middleware for data validation and defaults
NotificationLogSchema.pre('save', function(next) {
  // Ensure this is marked as from AI Agent Logic
  if (!this.metadata) {this.metadata = {};}
  this.metadata.fromAgent = true;
  
  // Set success status based on status field
  if (!this.aiAgentContext) {this.aiAgentContext = {};}
  this.aiAgentContext.success = ['sent', 'completed'].includes(this.status);
  
  // Auto-set processing time if not provided
  if (!this.aiAgentContext.processingTime) {
    this.aiAgentContext.processingTime = 0;
  }
  
  next();
});

// Static methods for AI Agent Logic EXCLUSIVE analytics
NotificationLogSchema.statics.getAIAgentStats = async function(since = new Date(Date.now() - 24 * 60 * 60 * 1000), companyId = null) {
  try {
    const matchCriteria = {
      'metadata.fromAgent': true,
      createdAt: { $gte: since }
    };
    
    // Add company filter for multi-tenant isolation
    if (companyId) {
      matchCriteria['metadata.companyId'] = new mongoose.Types.ObjectId(companyId);
    }
    
    const pipeline = [
      { $match: matchCriteria },
      {
        $group: {
          _id: null,
          totalNotifications: { $sum: 1 },
          successful: { $sum: { $cond: [{ $in: ['$status', ['sent', 'completed']] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          pending: { $sum: { $cond: [{ $eq: ['$status', 'pending'] }, 1, 0] } },
          avgProcessingTime: { $avg: '$aiAgentContext.processingTime' },
          maxProcessingTime: { $max: '$aiAgentContext.processingTime' },
          minProcessingTime: { $min: '$aiAgentContext.processingTime' }
        }
      }
    ];

    const results = await this.aggregate(pipeline);
    const stats = results[0] || { 
      totalNotifications: 0, 
      successful: 0, 
      failed: 0, 
      pending: 0,
      avgProcessingTime: 0,
      maxProcessingTime: 0,
      minProcessingTime: 0
    };
    
    return {
      totalNotifications: stats.totalNotifications,
      successfulNotifications: stats.successful,
      failedNotifications: stats.failed,
      pendingNotifications: stats.pending,
      successRate: stats.totalNotifications > 0 ? 
        Math.round((stats.successful / stats.totalNotifications) * 100 * 100) / 100 : 0,
      avgProcessingTime: Math.round(stats.avgProcessingTime || 0),
      maxProcessingTime: Math.round(stats.maxProcessingTime || 0),
      minProcessingTime: Math.round(stats.minProcessingTime || 0)
    };
  } catch (error) {
    console.error('[AI-AGENT-LOGIC] Error getting AI Agent stats:', error);
    return { 
      totalNotifications: 0, 
      successfulNotifications: 0, 
      failedNotifications: 0, 
      pendingNotifications: 0,
      successRate: 0, 
      avgProcessingTime: 0,
      maxProcessingTime: 0,
      minProcessingTime: 0
    };
  }
};

NotificationLogSchema.statics.getEventBreakdown = async function(since = new Date(Date.now() - 24 * 60 * 60 * 1000), companyId = null) {
  try {
    const matchCriteria = {
      'metadata.fromAgent': true,
      createdAt: { $gte: since }
    };
    
    if (companyId) {
      matchCriteria['metadata.companyId'] = new mongoose.Types.ObjectId(companyId);
    }
    
    const pipeline = [
      { $match: matchCriteria },
      {
        $group: {
          _id: '$aiAgentContext.eventType',
          count: { $sum: 1 },
          successful: { $sum: { $cond: [{ $in: ['$status', ['sent', 'completed']] }, 1, 0] } },
          failed: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
          avgProcessingTime: { $avg: '$aiAgentContext.processingTime' }
        }
      },
      { $sort: { count: -1 } },
      { $limit: 20 } // Limit for performance
    ];

    const results = await this.aggregate(pipeline);
    return results.map(r => ({
      eventType: r._id || 'unknown',
      count: r.count,
      successful: r.successful,
      failed: r.failed,
      successRate: r.count > 0 ? Math.round((r.successful / r.count) * 100 * 100) / 100 : 0,
      avgProcessingTime: Math.round(r.avgProcessingTime || 0)
    }));
  } catch (error) {
    console.error('[AI-AGENT-LOGIC] Error getting event breakdown:', error);
    return [];
  }
};

NotificationLogSchema.statics.getPerformanceMetrics = async function(since = new Date(Date.now() - 24 * 60 * 60 * 1000), companyId = null) {
  try {
    const matchCriteria = {
      'metadata.fromAgent': true,
      createdAt: { $gte: since },
      'aiAgentContext.processingTime': { $exists: true, $ne: null, $gte: 0 }
    };
    
    if (companyId) {
      matchCriteria['metadata.companyId'] = new mongoose.Types.ObjectId(companyId);
    }
    
    const pipeline = [
      { $match: matchCriteria },
      {
        $group: {
          _id: null,
          avgProcessingTime: { $avg: '$aiAgentContext.processingTime' },
          minProcessingTime: { $min: '$aiAgentContext.processingTime' },
          maxProcessingTime: { $max: '$aiAgentContext.processingTime' },
          totalProcessed: { $sum: 1 },
          p95ProcessingTime: { $push: '$aiAgentContext.processingTime' }
        }
      }
    ];

    const results = await this.aggregate(pipeline);
    const metrics = results[0] || { 
      avgProcessingTime: 0, 
      minProcessingTime: 0, 
      maxProcessingTime: 0, 
      totalProcessed: 0,
      p95ProcessingTime: []
    };
    
    // Calculate 95th percentile
    let p95 = 0;
    if (metrics.p95ProcessingTime && metrics.p95ProcessingTime.length > 0) {
      const sorted = metrics.p95ProcessingTime.sort((a, b) => a - b);
      const index = Math.ceil(sorted.length * 0.95) - 1;
      p95 = sorted[index] || 0;
    }
    
    return {
      avgProcessingTime: Math.round(metrics.avgProcessingTime || 0),
      minProcessingTime: Math.round(metrics.minProcessingTime || 0),
      maxProcessingTime: Math.round(metrics.maxProcessingTime || 0),
      p95ProcessingTime: Math.round(p95),
      totalProcessed: metrics.totalProcessed
    };
  } catch (error) {
    console.error('[AI-AGENT-LOGIC] Error getting performance metrics:', error);
    return { 
      avgProcessingTime: 0, 
      minProcessingTime: 0, 
      maxProcessingTime: 0, 
      p95ProcessingTime: 0,
      totalProcessed: 0 
    };
  }
};

// AI Agent Logic EXCLUSIVE recent activity
NotificationLogSchema.statics.getRecentActivity = async function(limit = 10, companyId = null) {
  try {
    const matchCriteria = {
      'metadata.fromAgent': true
    };
    
    if (companyId) {
      matchCriteria['metadata.companyId'] = new mongoose.Types.ObjectId(companyId);
    }
    
    const logs = await this.find(matchCriteria)
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('createdAt type recipient status aiAgentContext.eventType aiAgentContext.processingTime aiAgentContext.source')
      .lean();
      
    return logs.map(log => ({
      timestamp: log.createdAt,
      type: log.type,
      eventType: log.aiAgentContext?.eventType || 'unknown',
      status: log.status,
      recipient: log.recipient,
      success: ['sent', 'completed'].includes(log.status),
      processingTime: log.aiAgentContext?.processingTime || 0,
      source: log.aiAgentContext?.source || 'unknown'
    }));
  } catch (error) {
    console.error('[AI-AGENT-LOGIC] Error getting recent activity:', error);
    return [];
  }
};

// Instance methods with better error handling
NotificationLogSchema.methods.markAsSent = async function(result = null) {
  try {
    this.status = 'sent';
    if (!this.aiAgentContext) {this.aiAgentContext = {};}
    this.aiAgentContext.success = true;
    if (result && this.metadata) {
      this.metadata.result = result;
    }
    return await this.save();
  } catch (error) {
    console.error('[AI-AGENT-LOGIC] Error marking as sent:', error);
    throw error;
  }
};

NotificationLogSchema.methods.markAsFailed = async function(error) {
  try {
    this.status = 'failed';
    if (!this.aiAgentContext) {this.aiAgentContext = {};}
    this.aiAgentContext.success = false;
    this.errorMessage = (error && error.message) ? error.message : String(error);
    return await this.save();
  } catch (saveError) {
    console.error('[AI-AGENT-LOGIC] Error marking as failed:', saveError);
    throw saveError;
  }
};

module.exports = mongoose.model('AIAgentNotificationLog', NotificationLogSchema);
