/**
 * ============================================================================
 * CHEATSHEET AUDIT LOG MODEL
 * ============================================================================
 * 
 * Compliance-grade audit trail for all CheatSheet configuration changes.
 * 
 * Purpose:
 * - Regulatory compliance (SOC 2, HIPAA, GDPR)
 * - Forensics ("who changed the config on Black Friday?")
 * - Analytics ("which admins edit configs most?")
 * - Security monitoring (detect unauthorized changes)
 * 
 * Retention Policy:
 * - Keep all logs indefinitely (disk is cheap, compliance is expensive)
 * - Archive logs older than 1 year to separate collection if needed
 * 
 * Performance:
 * - Separate collection (doesn't slow down version operations)
 * - Indexed for fast queries
 * - Write-only (never updated after creation)
 * ============================================================================
 */

const mongoose = require('mongoose');

const CheatSheetAuditLogSchema = new mongoose.Schema({
  
  // ============================================================================
  // IDENTITY
  // ============================================================================
  
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company', 
    required: true,
    index: true 
  },
  
  versionId: { 
    type: String, 
    required: true,
    index: true
  },
  
  // ============================================================================
  // ACTION DETAILS
  // ============================================================================
  
  action: { 
    type: String, 
    enum: [
      'create_draft',
      'save_draft',
      'push_live',
      'discard_draft',
      'restore_version',
      'archive_version',
      'delete_version'
    ],
    required: true,
    index: true
  },
  
  // ============================================================================
  // ACTOR DETAILS (Who did this?)
  // ============================================================================
  
  actor: { 
    type: String, 
    required: true,
    index: true
  },
  
  actorIp: { 
    type: String,
    default: null
  },
  
  actorUserAgent: {
    type: String,
    default: null
  },
  
  // ============================================================================
  // STATE SNAPSHOTS (What changed?)
  // ============================================================================
  
  previousState: { 
    type: Object,
    default: null
  },
  
  newState: { 
    type: Object,
    default: null
  },
  
  // ============================================================================
  // METADATA (Additional context)
  // ============================================================================
  
  metadata: { 
    type: Object, 
    default: {}
  },
  
  // Success or failure
  success: {
    type: Boolean,
    default: true
  },
  
  errorMessage: {
    type: String,
    default: null
  },
  
  // ============================================================================
  // TIMESTAMP
  // ============================================================================
  
  timestamp: { 
    type: Date, 
    default: Date.now, 
    required: true,
    index: true
  }
  
}, { 
  timestamps: false  // We use custom timestamp field
});

// ============================================================================
// INDEXES FOR COMMON QUERIES
// ============================================================================

// "Show me all changes for company X"
CheatSheetAuditLogSchema.index({ companyId: 1, timestamp: -1 });

// "Show me all changes by user Y"
CheatSheetAuditLogSchema.index({ actor: 1, timestamp: -1 });

// "Show me all push-live operations"
CheatSheetAuditLogSchema.index({ action: 1, timestamp: -1 });

// "Show me changes to version Z"
CheatSheetAuditLogSchema.index({ versionId: 1, timestamp: -1 });

// "Show me all failed operations"
CheatSheetAuditLogSchema.index({ success: 1, timestamp: -1 });

// Compound index for company + action queries
CheatSheetAuditLogSchema.index({ companyId: 1, action: 1, timestamp: -1 });

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Log an action (create audit entry)
 */
CheatSheetAuditLogSchema.statics.logAction = async function(params) {
  const {
    companyId,
    versionId,
    action,
    actor,
    actorIp = null,
    actorUserAgent = null,
    previousState = null,
    newState = null,
    metadata = {},
    success = true,
    errorMessage = null
  } = params;
  
  try {
    const entry = await this.create({
      companyId,
      versionId,
      action,
      actor,
      actorIp,
      actorUserAgent,
      previousState,
      newState,
      metadata,
      success,
      errorMessage,
      timestamp: new Date()
    });
    
    return entry;
  } catch (err) {
    const logger = require('../../utils/logger');
    logger.error('AUDIT_LOG_FAILED', {
      error: err.message,
      action,
      companyId,
      versionId
    });
    // Don't throw - audit failure shouldn't break the operation
    return null;
  }
};

/**
 * Get audit trail for a company
 */
CheatSheetAuditLogSchema.statics.getCompanyAudit = function(companyId, options = {}) {
  const { 
    limit = 100, 
    action = null, 
    actor = null,
    startDate = null,
    endDate = null
  } = options;
  
  const query = { companyId };
  
  if (action) query.action = action;
  if (actor) query.actor = actor;
  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) query.timestamp.$gte = new Date(startDate);
    if (endDate) query.timestamp.$lte = new Date(endDate);
  }
  
  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

/**
 * Get audit trail for a specific version
 */
CheatSheetAuditLogSchema.statics.getVersionAudit = function(versionId) {
  return this.find({ versionId })
    .sort({ timestamp: -1 })
    .lean();
};

/**
 * Get audit trail for an actor (user)
 */
CheatSheetAuditLogSchema.statics.getActorAudit = function(actor, limit = 100) {
  return this.find({ actor })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

/**
 * Get failed operations (for alerting)
 */
CheatSheetAuditLogSchema.statics.getFailedOperations = function(options = {}) {
  const { limit = 100, since = null } = options;
  
  const query = { success: false };
  if (since) {
    query.timestamp = { $gte: new Date(since) };
  }
  
  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

/**
 * Get analytics summary
 */
CheatSheetAuditLogSchema.statics.getAnalytics = async function(companyId, days = 30) {
  const since = new Date();
  since.setDate(since.getDate() - days);
  
  const logs = await this.find({
    companyId,
    timestamp: { $gte: since }
  }).lean();
  
  const analytics = {
    totalActions: logs.length,
    actionBreakdown: {},
    actorBreakdown: {},
    successRate: 0,
    failedActions: []
  };
  
  logs.forEach(log => {
    // Count by action type
    analytics.actionBreakdown[log.action] = 
      (analytics.actionBreakdown[log.action] || 0) + 1;
    
    // Count by actor
    analytics.actorBreakdown[log.actor] = 
      (analytics.actorBreakdown[log.actor] || 0) + 1;
    
    // Track failures
    if (!log.success) {
      analytics.failedActions.push({
        action: log.action,
        actor: log.actor,
        error: log.errorMessage,
        timestamp: log.timestamp
      });
    }
  });
  
  analytics.successRate = logs.length > 0
    ? ((logs.filter(l => l.success).length / logs.length) * 100).toFixed(2)
    : 100;
  
  return analytics;
};

// ============================================================================
// MIDDLEWARE FOR DEBUGGING
// ============================================================================

/**
 * Log creation (for debugging audit system itself)
 */
CheatSheetAuditLogSchema.post('save', function(doc) {
  const logger = require('../../utils/logger');
  logger.debug('AUDIT_LOG_CREATED', {
    action: doc.action,
    companyId: doc.companyId,
    versionId: doc.versionId,
    actor: doc.actor,
    success: doc.success
  });
});

// ============================================================================
// EXPORT MODEL
// ============================================================================

module.exports = mongoose.model('CheatSheetAuditLog', CheatSheetAuditLogSchema);

