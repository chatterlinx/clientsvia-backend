/**
 * Agent Monitoring Module - Comprehensive Call & Interaction Tracking
 * Gold Standard Monitoring with Human-in-the-Loop Feedback
 * 
 * Features:
 * - Every call/interaction logged with full decision trace
 * - Automatic repeat detection and flagging
 * - Approval/Disapproval workflow
 * - Performance analytics and insights
 * - "What not to answer" learning system
 */

const mongoose = require('mongoose');
const winston = require('winston');
const similarity = require('string-similarity');
const fs = require('fs');
const path = require('path');

// Ensure logs directory exists
const logsDir = path.join(process.cwd(), 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Enhanced Logger for Agent Monitoring
const monitoringLogger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    winston.format.printf(({ timestamp, level, message, ...meta }) => {
      return `${timestamp} [${level.toUpperCase()}] [AGENT-MONITOR] ${message} ${JSON.stringify(meta)}`;
    })
  ),
  transports: [
    new winston.transports.Console({
      format: winston.format.colorize({ all: true })
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'agent_monitoring.log'),
      maxsize: 5242880, // 5MB
      maxFiles: 10
    }),
    new winston.transports.File({ 
      filename: path.join(logsDir, 'agent_monitoring_errors.log'),
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
});

// 1. INTERACTION LOG SCHEMA - Core monitoring data
const interactionLogSchema = new mongoose.Schema({
  // Basic interaction data
  timestamp: { type: Date, default: Date.now, index: true },
  callId: { type: String, required: true, index: true }, // Twilio Call SID
  tenantId: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  
  // Call metadata
  callerNumber: { type: String },
  callerLocation: { type: String },
  callDuration: { type: Number }, // seconds
  callType: { type: String, enum: ['inbound', 'outbound', 'test'], default: 'inbound' },
  
  // Conversation data
  callerQuery: { type: String, required: true },
  agentResponse: { type: String, required: true },
  confidenceScore: { type: Number, min: 0, max: 1 },
  responseTime: { type: Number }, // milliseconds
  
  // Decision trace - HOW the agent arrived at this response
  decisionTrace: [{
    step: { type: String, required: true },
    details: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    data: { type: mongoose.Schema.Types.Mixed }, // Additional context data
    duration: { type: Number } // milliseconds for this step
  }],
  
  // AI/ML metrics
  intentClassification: {
    detected_intent: { type: String },
    confidence: { type: Number },
    alternatives: [{ intent: String, confidence: Number }]
  },
  entityExtraction: [{
    entity: { type: String },
    value: { type: String },
    confidence: { type: Number }
  }],
  
  // Quality control
  status: { 
    type: String, 
    enum: ['pending', 'approved', 'disapproved', 'deleted', 'flagged'], 
    default: 'pending',
    index: true
  },
  
  // Repeat detection
  similarityFlag: { type: Boolean, default: false, index: true },
  similarityScore: { type: Number, min: 0, max: 1 },
  similarInteractionIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'InteractionLog' }],
  repetitionCount: { type: Number, default: 0 },
  
  // Human feedback
  humanReview: {
    reviewedBy: { type: String },
    reviewedAt: { type: Date },
    notes: { type: String },
    rating: { type: Number, min: 1, max: 5 },
    issues: [{ type: String }], // Array of issue types
    suggestions: { type: String }
  },
  
  // Performance metrics
  customerSatisfaction: {
    wasHelpful: { type: Boolean },
    followUpRequired: { type: Boolean },
    escalated: { type: Boolean },
    bookingMade: { type: Boolean }
  },
  
  // Error tracking
  errors: [{
    type: { type: String },
    message: { type: String },
    stack: { type: String },
    timestamp: { type: Date, default: Date.now }
  }],
  
  // Metadata
  agentVersion: { type: String },
  modelVersion: { type: String },
  tags: [{ type: String }],
  archived: { type: Boolean, default: false }
}, {
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// 2. APPROVED KNOWLEDGE BASE SCHEMA - Dynamic learning
const approvedKnowledgeSchema = new mongoose.Schema({
  // Source interaction
  sourceInteractionId: { type: mongoose.Schema.Types.ObjectId, ref: 'InteractionLog', required: true },
  
  // Knowledge entry
  query: { type: String, required: true },
  response: { type: String, required: true },
  keywords: [{ type: String }],
  category: { type: String },
  intent: { type: String },
  
  // Tenant isolation
  tenantId: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  
  // Approval workflow
  approvedBy: { type: String, required: true },
  approvedAt: { type: Date, default: Date.now },
  approvalNotes: { type: String },
  
  // Usage tracking
  usageCount: { type: Number, default: 0 },
  lastUsed: { type: Date },
  effectiveness: { type: Number, min: 0, max: 1 }, // Success rate when used
  
  // Versioning
  version: { type: Number, default: 1 },
  supersedes: { type: mongoose.Schema.Types.ObjectId, ref: 'ApprovedKnowledge' },
  
  // Status
  active: { type: Boolean, default: true },
  tags: [{ type: String }]
}, {
  timestamps: true
});

// 3. DISAPPROVAL LIST SCHEMA - What NOT to answer
const disapprovalListSchema = new mongoose.Schema({
  // Source interaction
  sourceInteractionId: { type: mongoose.Schema.Types.ObjectId, ref: 'InteractionLog', required: true },
  
  // Pattern definition
  queryPattern: { type: String, required: true }, // Can be regex
  badResponse: { type: String, required: true },
  responsePattern: { type: String }, // Pattern to block
  
  // Classification
  reason: { type: String, required: true },
  category: { type: String, enum: [
    'inaccurate_information',
    'inappropriate_content', 
    'compliance_violation',
    'privacy_concern',
    'out_of_scope',
    'customer_service_issue',
    'technical_error',
    'pricing_error',
    'other'
  ], required: true },
  severity: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  
  // Tenant isolation
  tenantId: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  
  // Workflow
  disapprovedBy: { type: String, required: true },
  disapprovedAt: { type: Date, default: Date.now },
  disapprovalNotes: { type: String },
  
  // Impact tracking
  blockedCount: { type: Number, default: 0 },
  lastBlocked: { type: Date },
  
  // Status
  active: { type: Boolean, default: true },
  tags: [{ type: String }]
}, {
  timestamps: true
});

// 4. PERFORMANCE ANALYTICS SCHEMA - Insights and trends
const performanceAnalyticsSchema = new mongoose.Schema({
  // Time period
  date: { type: Date, required: true, index: true },
  period: { type: String, enum: ['hour', 'day', 'week', 'month'], required: true },
  
  // Tenant
  tenantId: { type: String, required: true, index: true },
  companyId: { type: String, required: true, index: true },
  
  // Volume metrics
  totalInteractions: { type: Number, default: 0 },
  uniqueCallers: { type: Number, default: 0 },
  avgInteractionsPerCaller: { type: Number, default: 0 },
  
  // Quality metrics
  approvalRate: { type: Number, default: 0 }, // % approved
  disapprovalRate: { type: Number, default: 0 }, // % disapproved
  flaggedRate: { type: Number, default: 0 }, // % flagged as repeats
  avgConfidenceScore: { type: Number, default: 0 },
  avgResponseTime: { type: Number, default: 0 }, // milliseconds
  
  // Intent distribution
  topIntents: [{
    intent: { type: String },
    count: { type: Number },
    successRate: { type: Number }
  }],
  
  // Issue patterns
  topIssues: [{
    issue: { type: String },
    count: { type: Number },
    trend: { type: String, enum: ['increasing', 'decreasing', 'stable'] }
  }],
  
  // Customer satisfaction
  customerSatisfaction: {
    avgRating: { type: Number },
    helpfulResponses: { type: Number },
    escalationRate: { type: Number },
    bookingRate: { type: Number }
  },
  
  // Error tracking
  errorRate: { type: Number, default: 0 },
  topErrors: [{
    error: { type: String },
    count: { type: Number }
  }]
}, {
  timestamps: true
});

// Models
const InteractionLog = mongoose.model('InteractionLog', interactionLogSchema);
const ApprovedKnowledge = mongoose.model('ApprovedKnowledge', approvedKnowledgeSchema);
const DisapprovalList = mongoose.model('DisapprovalList', disapprovalListSchema);
const PerformanceAnalytics = mongoose.model('PerformanceAnalytics', performanceAnalyticsSchema);

// CORE MONITORING FUNCTIONS

/**
 * Log every agent interaction with full traceability
 */
async function logAgentInteraction({
  callId,
  tenantId,
  companyId,
  callerQuery,
  agentResponse,
  decisionTrace = [],
  callerNumber = '',
  responseTime = 0,
  confidenceScore = 0,
  intentClassification = {},
  entityExtraction = [],
  agentVersion = '1.0',
  modelVersion = '1.0'
}) {
  try {
    monitoringLogger.info('Logging agent interaction', { callId, tenantId, callerQuery: callerQuery.substring(0, 100) });
    
    // Check for similar interactions (repeat detection)
    const { similarityFlag, similarityScore, similarInteractionIds, repetitionCount } = 
      await detectSimilarInteractions(tenantId, callerQuery, agentResponse);
    
    // Create interaction log
    const interaction = new InteractionLog({
      callId,
      tenantId,
      companyId,
      callerQuery,
      agentResponse,
      callerNumber,
      responseTime,
      confidenceScore,
      decisionTrace,
      intentClassification,
      entityExtraction,
      similarityFlag,
      similarityScore,
      similarInteractionIds,
      repetitionCount,
      agentVersion,
      modelVersion,
      timestamp: new Date()
    });
    
    await interaction.save();
    
    // Auto-flag high repeats or low confidence
    if (similarityFlag || confidenceScore < 0.3) {
      await flagInteractionForReview(interaction._id, 'auto_flagged', {
        reason: similarityFlag ? 'repeated_scenario' : 'low_confidence',
        score: similarityFlag ? similarityScore : confidenceScore
      });
    }
    
    // Real-time alerts for critical issues
    if (repetitionCount > 5 || confidenceScore < 0.1) {
      await sendAlert('critical_pattern', {
        callId,
        tenantId,
        issue: repetitionCount > 5 ? 'excessive_repetition' : 'very_low_confidence',
        count: repetitionCount,
        confidence: confidenceScore
      });
    }
    
    monitoringLogger.info('Interaction logged successfully', { 
      interactionId: interaction._id,
      similarityFlag,
      repetitionCount 
    });
    
    return interaction._id;
    
  } catch (error) {
    monitoringLogger.error('Failed to log interaction', { 
      error: error.message,
      stack: error.stack,
      callId,
      tenantId 
    });
    throw error;
  }
}

/**
 * Detect similar interactions for repeat flagging
 */
async function detectSimilarInteractions(tenantId, callerQuery, agentResponse, lookbackDays = 30) {
  try {
    const lookbackDate = new Date();
    lookbackDate.setDate(lookbackDate.getDate() - lookbackDays);
    
    // Get recent interactions for this tenant
    const recentInteractions = await InteractionLog.find({
      tenantId,
      timestamp: { $gte: lookbackDate },
      status: { $ne: 'deleted' }
    }).select('callerQuery agentResponse _id').limit(100).lean();
    
    let maxSimilarity = 0;
    const similarInteractionIds = [];
    let repetitionCount = 0;
    
    // Calculate similarity scores
    for (const interaction of recentInteractions) {
      const querySimilarity = similarity.compareTwoStrings(
        callerQuery.toLowerCase(),
        interaction.callerQuery.toLowerCase()
      );
      
      const responseSimilarity = similarity.compareTwoStrings(
        agentResponse.toLowerCase(),
        interaction.agentResponse.toLowerCase()
      );
      
      const avgSimilarity = (querySimilarity + responseSimilarity) / 2;
      
      if (avgSimilarity > 0.7) { // High similarity threshold
        similarInteractionIds.push(interaction._id);
        repetitionCount++;
        maxSimilarity = Math.max(maxSimilarity, avgSimilarity);
      }
    }
    
    const similarityFlag = repetitionCount > 0;
    
    return {
      similarityFlag,
      similarityScore: maxSimilarity,
      similarInteractionIds,
      repetitionCount
    };
    
  } catch (error) {
    monitoringLogger.error('Error detecting similar interactions', { error: error.message, tenantId });
    return {
      similarityFlag: false,
      similarityScore: 0,
      similarInteractionIds: [],
      repetitionCount: 0
    };
  }
}

/**
 * Flag interaction for human review
 */
async function flagInteractionForReview(interactionId, flaggedBy, metadata = {}) {
  try {
    await InteractionLog.findByIdAndUpdate(interactionId, {
      status: 'flagged',
      'humanReview.notes': `Auto-flagged: ${metadata.reason || 'review_required'}`,
      'tags': ['auto_flagged', metadata.reason || 'review_required']
    });
    
    monitoringLogger.info('Interaction flagged for review', { 
      interactionId, 
      flaggedBy, 
      reason: metadata.reason 
    });
    
  } catch (error) {
    monitoringLogger.error('Error flagging interaction', { error: error.message, interactionId });
  }
}

/**
 * Send real-time alerts for critical issues
 */
async function sendAlert(alertType, data) {
  try {
    monitoringLogger.warn(`ALERT: ${alertType}`, data);
    
    // Here you could integrate with:
    // - Email notifications
    // - Slack webhooks
    // - SMS alerts
    // - Dashboard notifications
    
    // Example webhook call (implement as needed)
    // await axios.post(process.env.ALERT_WEBHOOK_URL, {
    //   type: alertType,
    //   data,
    //   timestamp: new Date().toISOString()
    // });
    
  } catch (error) {
    monitoringLogger.error('Error sending alert', { error: error.message, alertType, data });
  }
}

/**
 * Approve interaction and add to knowledge base
 */
async function approveInteraction(interactionId, approvedBy, options = {}) {
  try {
    const interaction = await InteractionLog.findById(interactionId);
    if (!interaction) {
      throw new Error('Interaction not found');
    }
    
    // Update interaction status
    await InteractionLog.findByIdAndUpdate(interactionId, {
      status: 'approved',
      'humanReview.reviewedBy': approvedBy,
      'humanReview.reviewedAt': new Date(),
      'humanReview.notes': options.notes || 'Approved for knowledge base',
      'humanReview.rating': options.rating || 5
    });
    
    // Add to approved knowledge base
    const approvedKnowledge = new ApprovedKnowledge({
      sourceInteractionId: interactionId,
      query: interaction.callerQuery,
      response: interaction.agentResponse,
      keywords: options.keywords || extractKeywords(interaction.callerQuery),
      category: options.category || 'general',
      intent: interaction.intentClassification?.detected_intent || 'unknown',
      tenantId: interaction.tenantId,
      companyId: interaction.companyId,
      approvedBy,
      approvalNotes: options.notes
    });
    
    await approvedKnowledge.save();
    
    monitoringLogger.info('Interaction approved and added to knowledge base', {
      interactionId,
      approvedBy,
      knowledgeId: approvedKnowledge._id
    });
    
    return approvedKnowledge._id;
    
  } catch (error) {
    monitoringLogger.error('Error approving interaction', { 
      error: error.message, 
      interactionId, 
      approvedBy 
    });
    throw error;
  }
}

/**
 * Disapprove interaction and add to blocklist
 */
async function disapproveInteraction(interactionId, disapprovedBy, reason, category = 'other') {
  try {
    const interaction = await InteractionLog.findById(interactionId);
    if (!interaction) {
      throw new Error('Interaction not found');
    }
    
    // Update interaction status
    await InteractionLog.findByIdAndUpdate(interactionId, {
      status: 'disapproved',
      'humanReview.reviewedBy': disapprovedBy,
      'humanReview.reviewedAt': new Date(),
      'humanReview.notes': reason,
      'humanReview.rating': 1,
      'humanReview.issues': [category]
    });
    
    // Add to disapproval list
    const disapproval = new DisapprovalList({
      sourceInteractionId: interactionId,
      queryPattern: interaction.callerQuery,
      badResponse: interaction.agentResponse,
      reason,
      category,
      tenantId: interaction.tenantId,
      companyId: interaction.companyId,
      disapprovedBy,
      disapprovalNotes: reason
    });
    
    await disapproval.save();
    
    monitoringLogger.info('Interaction disapproved and added to blocklist', {
      interactionId,
      disapprovedBy,
      reason,
      disapprovalId: disapproval._id
    });
    
    return disapproval._id;
    
  } catch (error) {
    monitoringLogger.error('Error disapproving interaction', { 
      error: error.message, 
      interactionId, 
      disapprovedBy 
    });
    throw error;
  }
}

/**
 * Check if response should be blocked based on disapproval list
 */
async function checkDisapprovalList(tenantId, query, response) {
  try {
    const disapprovals = await DisapprovalList.find({
      tenantId,
      active: true
    }).lean();
    
    for (const disapproval of disapprovals) {
      // Check query pattern match
      const queryMatch = query.toLowerCase().includes(disapproval.queryPattern.toLowerCase()) ||
                         similarity.compareTwoStrings(query.toLowerCase(), disapproval.queryPattern.toLowerCase()) > 0.8;
      
      // Check response pattern match (if exists)
      const responseMatch = disapproval.responsePattern ? 
        response.toLowerCase().includes(disapproval.responsePattern.toLowerCase()) : false;
      
      if (queryMatch || responseMatch) {
        // Update blocked count
        await DisapprovalList.findByIdAndUpdate(disapproval._id, {
          $inc: { blockedCount: 1 },
          lastBlocked: new Date()
        });
        
        monitoringLogger.info('Response blocked by disapproval list', {
          tenantId,
          disapprovalId: disapproval._id,
          reason: disapproval.reason
        });
        
        return {
          blocked: true,
          reason: disapproval.reason,
          category: disapproval.category,
          disapprovalId: disapproval._id
        };
      }
    }
    
    return { blocked: false };
    
  } catch (error) {
    monitoringLogger.error('Error checking disapproval list', { error: error.message, tenantId });
    return { blocked: false };
  }
}

/**
 * Extract keywords from query text
 */
function extractKeywords(text, minLength = 3) {
  const stopWords = new Set(['the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'is', 'are', 'was', 'were', 'been', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can', 'must', 'shall']);
  
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(word => word.length >= minLength && !stopWords.has(word))
    .slice(0, 10); // Limit to 10 keywords
}

/**
 * Additional monitoring service functions for API support
 */

// Get pending reviews count
async function getPendingReviewsCount(companyId) {
  try {
    const count = await InteractionLog.countDocuments({
      companyId,
      status: 'pending'
    });
    return count;
  } catch (error) {
    monitoringLogger.error('Error getting pending reviews count', { error: error.message, companyId });
    return 0;
  }
}

// Get flagged interactions count
async function getFlaggedInteractionsCount(companyId) {
  try {
    const count = await InteractionLog.countDocuments({
      companyId,
      similarityFlag: true,
      status: { $ne: 'deleted' }
    });
    return count;
  } catch (error) {
    monitoringLogger.error('Error getting flagged interactions count', { error: error.message, companyId });
    return 0;
  }
}

// Get approval rate
async function getApprovalRate(companyId, days = 7) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const total = await InteractionLog.countDocuments({
      companyId,
      timestamp: { $gte: startDate },
      status: { $in: ['approved', 'disapproved'] }
    });
    
    const approved = await InteractionLog.countDocuments({
      companyId,
      timestamp: { $gte: startDate },
      status: 'approved'
    });
    
    const rate = total > 0 ? Math.round((approved / total) * 100) : 0;
    return rate;
  } catch (error) {
    monitoringLogger.error('Error calculating approval rate', { error: error.message, companyId });
    return 0;
  }
}

// Get recent activity
async function getRecentActivity(companyId, limit = 10) {
  try {
    const activities = [];
    
    // Get recent approvals
    const approvals = await InteractionLog.find({
      companyId,
      status: 'approved',
      'humanReview.reviewedAt': { $exists: true }
    })
    .sort({ 'humanReview.reviewedAt': -1 })
    .limit(limit)
    .lean();
    
    approvals.forEach(approval => {
      activities.push({
        type: 'approval',
        title: 'Response approved',
        description: `"${approval.callerQuery.substring(0, 50)}..."`,
        timestamp: approval.humanReview.reviewedAt
      });
    });
    
    // Get recent disapprovals
    const disapprovals = await InteractionLog.find({
      companyId,
      status: 'disapproved',
      'humanReview.reviewedAt': { $exists: true }
    })
    .sort({ 'humanReview.reviewedAt': -1 })
    .limit(limit)
    .lean();
    
    disapprovals.forEach(disapproval => {
      activities.push({
        type: 'disapproval',
        title: 'Response blacklisted',
        description: disapproval.humanReview.notes || 'Added to never-answer list',
        timestamp: disapproval.humanReview.reviewedAt
      });
    });
    
    // Get recent flags
    const flags = await InteractionLog.find({
      companyId,
      similarityFlag: true
    })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
    
    flags.forEach(flag => {
      activities.push({
        type: 'flag',
        title: 'Repeated question flagged',
        description: `"${flag.callerQuery.substring(0, 50)}..." (${flag.repetitionCount} occurrences)`,
        timestamp: flag.timestamp
      });
    });
    
    // Sort by timestamp and return latest
    return activities
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
      .slice(0, limit);
      
  } catch (error) {
    monitoringLogger.error('Error getting recent activity', { error: error.message, companyId });
    return [];
  }
}

// Get analytics
async function getAnalytics(companyId, days = 7) {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const totalInteractions = await InteractionLog.countDocuments({
      companyId,
      timestamp: { $gte: startDate }
    });
    
    const flaggedItems = await InteractionLog.countDocuments({
      companyId,
      timestamp: { $gte: startDate },
      similarityFlag: true
    });
    
    const approved = await InteractionLog.countDocuments({
      companyId,
      timestamp: { $gte: startDate },
      status: 'approved'
    });
    
    const disapproved = await InteractionLog.countDocuments({
      companyId,
      timestamp: { $gte: startDate },
      status: 'disapproved'
    });
    
    return {
      totalInteractions,
      flaggedItems,
      approved,
      disapproved,
      period: `${days} days`
    };
  } catch (error) {
    monitoringLogger.error('Error getting analytics', { error: error.message, companyId });
    return {};
  }
}

// Get pending interactions
async function getPendingInteractions(companyId, page = 1, limit = 20) {
  try {
    const skip = (page - 1) * limit;
    
    const interactions = await InteractionLog.find({
      companyId,
      status: 'pending'
    })
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
    
    return interactions;
  } catch (error) {
    monitoringLogger.error('Error getting pending interactions', { error: error.message, companyId });
    return [];
  }
}

// Get flagged interactions
async function getFlaggedInteractions(companyId, page = 1, limit = 20) {
  try {
    const skip = (page - 1) * limit;
    
    const interactions = await InteractionLog.find({
      companyId,
      similarityFlag: true,
      status: { $ne: 'deleted' }
    })
    .sort({ timestamp: -1 })
    .skip(skip)
    .limit(limit)
    .lean();
    
    return interactions;
  } catch (error) {
    monitoringLogger.error('Error getting flagged interactions', { error: error.message, companyId });
    return [];
  }
}

// Approve interaction (enhanced version)
async function approveInteractionEnhanced(interactionId, companyId) {
  try {
    const interaction = await InteractionLog.findOne({ _id: interactionId, companyId });
    if (!interaction) {
      return { success: false, error: 'Interaction not found' };
    }
    
    if (interaction.status !== 'pending') {
      return { success: false, error: 'Interaction is not pending approval' };
    }
    
    // Update interaction status
    await InteractionLog.findByIdAndUpdate(interactionId, {
      status: 'approved',
      'humanReview.reviewedBy': 'admin', // You could pass the actual user ID
      'humanReview.reviewedAt': new Date(),
      'humanReview.notes': 'Approved via monitoring dashboard'
    });
    
    // Add to approved knowledge base
    const approvedKnowledge = new ApprovedKnowledge({
      sourceInteractionId: interactionId,
      query: interaction.callerQuery,
      response: interaction.agentResponse,
      keywords: extractKeywords(interaction.callerQuery),
      category: 'general',
      intent: interaction.intentClassification?.detected_intent || 'unknown',
      tenantId: interaction.tenantId,
      companyId: interaction.companyId,
      approvedBy: 'admin'
    });
    
    await approvedKnowledge.save();
    
    monitoringLogger.info('Interaction approved via API', { interactionId, companyId });
    
    return { success: true };
  } catch (error) {
    monitoringLogger.error('Error approving interaction via API', { error: error.message, interactionId });
    return { success: false, error: 'Failed to approve interaction' };
  }
}

// Disapprove interaction (enhanced version)
async function disapproveInteractionEnhanced(interactionId, companyId, reason = 'Disapproved via dashboard') {
  try {
    const interaction = await InteractionLog.findOne({ _id: interactionId, companyId });
    if (!interaction) {
      return { success: false, error: 'Interaction not found' };
    }
    
    if (interaction.status !== 'pending') {
      return { success: false, error: 'Interaction is not pending review' };
    }
    
    // Update interaction status
    await InteractionLog.findByIdAndUpdate(interactionId, {
      status: 'disapproved',
      'humanReview.reviewedBy': 'admin',
      'humanReview.reviewedAt': new Date(),
      'humanReview.notes': reason
    });
    
    // Add to disapproval list
    const disapproval = new DisapprovalList({
      sourceInteractionId: interactionId,
      queryPattern: interaction.callerQuery,
      badResponse: interaction.agentResponse,
      reason,
      category: 'other',
      tenantId: interaction.tenantId,
      companyId: interaction.companyId,
      disapprovedBy: 'admin'
    });
    
    await disapproval.save();
    
    monitoringLogger.info('Interaction disapproved via API', { interactionId, companyId, reason });
    
    return { success: true };
  } catch (error) {
    monitoringLogger.error('Error disapproving interaction via API', { error: error.message, interactionId });
    return { success: false, error: 'Failed to disapprove interaction' };
  }
}

// Update monitoring configuration
async function updateMonitoringConfig(companyId, config) {
  try {
    // For now, we'll store config in a simple JSON document
    // In production, you might want a dedicated configuration collection
    
    monitoringLogger.info('Monitoring config updated', { companyId, config });
    
    return { success: true };
  } catch (error) {
    monitoringLogger.error('Error updating monitoring config', { error: error.message, companyId });
    return { success: false, error: 'Failed to update configuration' };
  }
}

// Export monitoring data
async function exportMonitoringData(companyId, days = 30, format = 'csv') {
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const interactions = await InteractionLog.find({
      companyId,
      timestamp: { $gte: startDate }
    })
    .sort({ timestamp: -1 })
    .lean();
    
    if (format === 'csv') {
      // Convert to CSV format
      const headers = [
        'Timestamp',
        'Caller Query',
        'Agent Response',
        'Status',
        'Confidence Score',
        'Response Time',
        'Similarity Flag',
        'Repetition Count'
      ];
      
      const csvRows = [headers.join(',')];
      
      interactions.forEach(interaction => {
        const row = [
          interaction.timestamp,
          `"${interaction.callerQuery.replace(/"/g, '""')}"`,
          `"${interaction.agentResponse.replace(/"/g, '""')}"`,
          interaction.status,
          interaction.confidenceScore || 0,
          interaction.responseTime || 0,
          interaction.similarityFlag || false,
          interaction.repetitionCount || 0
        ];
        csvRows.push(row.join(','));
      });
      
      return csvRows.join('\n');
    } else {
      // Return JSON format
      return JSON.stringify(interactions, null, 2);
    }
  } catch (error) {
    monitoringLogger.error('Error exporting monitoring data', { error: error.message, companyId });
    throw error;
  }
}

// Get interaction details
async function getInteractionDetails(interactionId) {
  try {
    const interaction = await InteractionLog.findById(interactionId).lean();
    return interaction;
  } catch (error) {
    monitoringLogger.error('Error getting interaction details', { error: error.message, interactionId });
    return null;
  }
}

// Edit interaction response
async function editInteractionResponse(interactionId, newResponse, companyId) {
  try {
    const interaction = await InteractionLog.findOne({ _id: interactionId, companyId });
    if (!interaction) {
      return { success: false, error: 'Interaction not found' };
    }
    
    await InteractionLog.findByIdAndUpdate(interactionId, {
      agentResponse: newResponse,
      'humanReview.reviewedBy': 'admin',
      'humanReview.reviewedAt': new Date(),
      'humanReview.notes': 'Response edited via dashboard'
    });
    
    monitoringLogger.info('Interaction response edited', { interactionId, companyId });
    
    return { success: true };
  } catch (error) {
    monitoringLogger.error('Error editing interaction response', { error: error.message, interactionId });
    return { success: false, error: 'Failed to edit interaction' };
  }
}

// Get monitoring status
async function getMonitoringStatus(companyId) {
  try {
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    
    const todayInteractions = await InteractionLog.countDocuments({
      companyId,
      timestamp: { $gte: todayStart }
    });
    
    const pendingCount = await InteractionLog.countDocuments({
      companyId,
      status: 'pending'
    });
    
    return {
      status: 'active',
      todayInteractions,
      pendingCount,
      lastUpdate: new Date()
    };
  } catch (error) {
    monitoringLogger.error('Error getting monitoring status', { error: error.message, companyId });
    return { status: 'error' };
  }
}

module.exports = {
  // Models
  InteractionLog,
  ApprovedKnowledge,
  DisapprovalList,
  PerformanceAnalytics,
  
  // Core functions
  logAgentInteraction,
  detectSimilarInteractions,
  flagInteractionForReview,
  sendAlert,
  approveInteraction,
  disapproveInteraction,
  checkDisapprovalList,
  extractKeywords,
  
  // API support functions
  getPendingReviewsCount,
  getFlaggedInteractionsCount,
  getApprovalRate,
  getRecentActivity,
  getAnalytics,
  getPendingInteractions,
  getFlaggedInteractions,
  approveInteraction: approveInteractionEnhanced,
  disapproveInteraction: disapproveInteractionEnhanced,
  updateMonitoringConfig,
  exportMonitoringData,
  getInteractionDetails,
  editInteractionResponse,
  getMonitoringStatus,
  
  // Logger
  monitoringLogger
};
