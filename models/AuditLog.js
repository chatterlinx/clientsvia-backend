/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AUDIT LOG MODEL (Compliance - Immutable)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Immutable log of all data access and changes for compliance.
 * Required for: GDPR, CCPA, SOC2, legal discovery.
 * 
 * WHAT GETS LOGGED:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Every call record viewed
 * - Every customer profile accessed
 * - Every data modification
 * - Every data export
 * - Every recording played
 * - Every search performed on PII data
 * 
 * IMMUTABILITY:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Documents cannot be updated or deleted (middleware enforced)
 * - Timestamps are immutable
 * - Retained for 7 years (legal requirement)
 * - Only deletable through official compliance process
 * 
 * RETENTION:
 * ─────────────────────────────────────────────────────────────────────────────
 * - 7 years (SOC2/legal requirement)
 * - ~1KB per log entry
 * - 1000 entries/day = 365KB/year = 2.5MB over 7 years per company
 * - Negligible storage cost
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// ACTION DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const AUDIT_ACTIONS = {
  // Data access
  CALL_VIEWED: 'call.viewed',
  CALL_LIST_VIEWED: 'call.list_viewed',
  TRANSCRIPT_VIEWED: 'call.transcript_viewed',
  RECORDING_PLAYED: 'call.recording_played',
  CUSTOMER_VIEWED: 'customer.viewed',
  CUSTOMER_LIST_VIEWED: 'customer.list_viewed',
  CUSTOMER_SEARCHED: 'customer.searched',
  ANALYTICS_VIEWED: 'analytics.viewed',
  
  // Data modification
  CALL_FLAGGED: 'call.flagged',
  CALL_UNFLAGGED: 'call.unflagged',
  CALL_NOTE_ADDED: 'call.note_added',
  CALL_REVIEWED: 'call.reviewed',
  CUSTOMER_CREATED: 'customer.created',
  CUSTOMER_UPDATED: 'customer.updated',
  CUSTOMER_MERGED: 'customer.merged',
  CUSTOMER_DELETED: 'customer.deleted',
  CUSTOMER_NOTE_ADDED: 'customer.note_added',
  
  // Data export
  DATA_EXPORTED: 'data.exported',
  REPORT_GENERATED: 'report.generated',
  
  // Admin actions
  SETTINGS_CHANGED: 'settings.changed',
  USER_CREATED: 'user.created',
  USER_UPDATED: 'user.updated',
  USER_DELETED: 'user.deleted',
  USER_ROLE_CHANGED: 'user.role_changed',
  
  // Security events
  LOGIN_SUCCESS: 'auth.login_success',
  LOGIN_FAILED: 'auth.login_failed',
  PASSWORD_CHANGED: 'auth.password_changed',
  API_KEY_CREATED: 'auth.api_key_created',
  API_KEY_REVOKED: 'auth.api_key_revoked',
  
  // Compliance events
  CONSENT_UPDATED: 'compliance.consent_updated',
  DATA_DELETION_REQUESTED: 'compliance.deletion_requested',
  DATA_DELETION_COMPLETED: 'compliance.deletion_completed',
  GDPR_EXPORT_REQUESTED: 'compliance.gdpr_export_requested',
  GDPR_EXPORT_COMPLETED: 'compliance.gdpr_export_completed'
};

const TARGET_TYPES = {
  CALL: 'call',
  CUSTOMER: 'customer',
  APPOINTMENT: 'appointment',
  USER: 'user',
  SETTINGS: 'settings',
  REPORT: 'report',
  SYSTEM: 'system'
};

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const AuditLogSchema = new mongoose.Schema({
  
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Company this log belongs to
   * Can be null for system-level events
   */
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'v2Company',
    index: true 
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // WHO
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * User ID who performed the action
   */
  userId: { 
    type: String, 
    required: [true, 'userId is required'],
    index: true
  },
  
  /**
   * User email (for display)
   */
  userEmail: { 
    type: String,
    maxLength: 255
  },
  
  /**
   * User role at time of action
   */
  userRole: { 
    type: String,
    maxLength: 50
  },
  
  /**
   * IP address
   */
  ipAddress: { 
    type: String,
    maxLength: 45  // IPv6 max length
  },
  
  /**
   * User agent string
   */
  userAgent: { 
    type: String,
    maxLength: 500
  },
  
  /**
   * Session ID (for tracking across actions)
   */
  sessionId: {
    type: String,
    maxLength: 100
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // WHAT
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Action performed
   */
  action: { 
    type: String, 
    required: [true, 'action is required'],
    enum: {
      values: Object.values(AUDIT_ACTIONS),
      message: '{VALUE} is not a valid audit action'
    },
    index: true
  },
  
  /**
   * Type of target entity
   */
  targetType: { 
    type: String, 
    enum: Object.values(TARGET_TYPES)
  },
  
  /**
   * ID of target entity
   */
  targetId: { 
    type: String,
    index: true
  },
  
  /**
   * Human-readable target identifier (for display)
   * e.g., "Call #call_abc123", "Customer: John Smith"
   */
  targetLabel: {
    type: String,
    maxLength: 200
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // DETAILS
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Additional details about the action
   * Structure varies by action type
   */
  details: {
    type: mongoose.Schema.Types.Mixed
    // Examples:
    // { searchQuery: "305-555" } for searches
    // { changedFields: ["name", "address"], before: {...}, after: {...} } for updates
    // { exportFormat: "csv", recordCount: 150 } for exports
    // { reason: "duplicate" } for deletions
  },
  
  /**
   * Was the action successful?
   */
  success: {
    type: Boolean,
    default: true
  },
  
  /**
   * Error message if action failed
   */
  errorMessage: {
    type: String,
    maxLength: 500
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // TIMESTAMP (Immutable)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * When the action occurred
   * IMMUTABLE - cannot be changed after creation
   */
  timestamp: { 
    type: Date, 
    default: Date.now, 
    immutable: true,
    index: true
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // RETENTION
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * When this log entry expires (7 years from creation)
   * Used for cleanup job, not TTL index (too important to auto-delete)
   */
  expiresAt: {
    type: Date,
    default: function() {
      const d = new Date();
      d.setFullYear(d.getFullYear() + 7);
      return d;
    }
  }
  
}, { 
  timestamps: false,  // We manage timestamp ourselves (immutable)
  collection: 'audit_log',
  strict: true
});


// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Primary query: Company's audit history
 */
AuditLogSchema.index(
  { companyId: 1, timestamp: -1 },
  { name: 'idx_company_timestamp' }
);

/**
 * User's actions
 */
AuditLogSchema.index(
  { companyId: 1, userId: 1, timestamp: -1 },
  { name: 'idx_company_user_timestamp' }
);

/**
 * Action type filter
 */
AuditLogSchema.index(
  { companyId: 1, action: 1, timestamp: -1 },
  { name: 'idx_company_action_timestamp' }
);

/**
 * Target lookup (who accessed this record?)
 */
AuditLogSchema.index(
  { companyId: 1, targetType: 1, targetId: 1, timestamp: -1 },
  { name: 'idx_company_target_timestamp' }
);

/**
 * Expiration lookup (for cleanup job)
 */
AuditLogSchema.index(
  { expiresAt: 1 },
  { name: 'idx_expires_at' }
);

// NOTE: No TTL index - audit logs are too important for automatic deletion
// Cleanup is handled by a controlled job that verifies retention policy


// ═══════════════════════════════════════════════════════════════════════════
// MIDDLEWARE - Prevent Updates and Deletes
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Prevent updates - audit logs are immutable
 */
AuditLogSchema.pre('updateOne', function(next) {
  const error = new Error('AuditLog documents are immutable and cannot be updated');
  logger.error('[AUDIT_LOG] Attempted to update immutable log entry');
  next(error);
});

AuditLogSchema.pre('updateMany', function(next) {
  const error = new Error('AuditLog documents are immutable and cannot be updated');
  logger.error('[AUDIT_LOG] Attempted to update immutable log entries');
  next(error);
});

AuditLogSchema.pre('findOneAndUpdate', function(next) {
  const error = new Error('AuditLog documents are immutable and cannot be updated');
  logger.error('[AUDIT_LOG] Attempted to update immutable log entry');
  next(error);
});

/**
 * Prevent deletes - audit logs must be retained
 * Deletion only allowed through official compliance process
 */
AuditLogSchema.pre('deleteOne', function(next) {
  // Check if this is an authorized compliance deletion
  // In production, this would check for a special flag/token
  const error = new Error('AuditLog documents cannot be deleted except through compliance process');
  logger.error('[AUDIT_LOG] Attempted to delete audit log entry');
  next(error);
});

AuditLogSchema.pre('deleteMany', function(next) {
  const error = new Error('AuditLog documents cannot be deleted except through compliance process');
  logger.error('[AUDIT_LOG] Attempted to delete audit log entries');
  next(error);
});


// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Log an action (primary method for creating audit entries)
 * 
 * @param {Object} params - Log parameters
 * @returns {Promise<AuditLog>}
 */
AuditLogSchema.statics.log = async function({
  companyId = null,
  userId,
  userEmail = null,
  userRole = null,
  ipAddress = null,
  userAgent = null,
  sessionId = null,
  action,
  targetType = null,
  targetId = null,
  targetLabel = null,
  details = null,
  success = true,
  errorMessage = null
}) {
  // Validate required fields
  if (!userId) throw new Error('userId is required');
  if (!action) throw new Error('action is required');
  
  const entry = await this.create({
    companyId,
    userId,
    userEmail,
    userRole,
    ipAddress,
    userAgent,
    sessionId,
    action,
    targetType,
    targetId,
    targetLabel,
    details,
    success,
    errorMessage
  });
  
  // Log to console for debugging (in production, this goes to log aggregator)
  logger.debug('[AUDIT_LOG] Entry created', {
    auditId: entry._id,
    action,
    userId,
    targetType,
    targetId,
    companyId: companyId?.toString()
  });
  
  return entry;
};

/**
 * Log data access (convenience method)
 */
AuditLogSchema.statics.logAccess = async function({
  companyId,
  userId,
  userEmail,
  ipAddress,
  action,
  targetType,
  targetId,
  targetLabel,
  details
}) {
  return this.log({
    companyId,
    userId,
    userEmail,
    ipAddress,
    action,
    targetType,
    targetId,
    targetLabel,
    details,
    success: true
  });
};

/**
 * Log data modification (convenience method)
 */
AuditLogSchema.statics.logModification = async function({
  companyId,
  userId,
  userEmail,
  ipAddress,
  action,
  targetType,
  targetId,
  targetLabel,
  before,
  after,
  changedFields
}) {
  return this.log({
    companyId,
    userId,
    userEmail,
    ipAddress,
    action,
    targetType,
    targetId,
    targetLabel,
    details: {
      before,
      after,
      changedFields
    },
    success: true
  });
};

/**
 * Get audit trail for a specific record
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {string} targetType - Target type
 * @param {string} targetId - Target ID
 * @param {number} limit - Max entries
 * @returns {Promise<AuditLog[]>}
 */
AuditLogSchema.statics.getAuditTrail = async function(companyId, targetType, targetId, limit = 100) {
  return this.find({
    companyId,
    targetType,
    targetId
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

/**
 * Get user's recent activity
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {string} userId - User ID
 * @param {number} limit - Max entries
 * @returns {Promise<AuditLog[]>}
 */
AuditLogSchema.statics.getUserActivity = async function(companyId, userId, limit = 100) {
  return this.find({
    companyId,
    userId
  })
    .sort({ timestamp: -1 })
    .limit(limit)
    .lean();
};

/**
 * Search audit logs
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {Object} filters - Search filters
 * @param {Object} options - Pagination options
 * @returns {Promise<{logs: AuditLog[], total: number}>}
 */
AuditLogSchema.statics.search = async function(companyId, filters = {}, options = {}) {
  const {
    userId = null,
    action = null,
    actions = null,
    targetType = null,
    targetId = null,
    startDate = null,
    endDate = null,
    success = null
  } = filters;
  
  const {
    page = 1,
    limit = 50
  } = options;
  
  const query = { companyId };
  
  if (userId) query.userId = userId;
  if (action) query.action = action;
  if (actions) query.action = { $in: actions };
  if (targetType) query.targetType = targetType;
  if (targetId) query.targetId = targetId;
  if (success !== null) query.success = success;
  
  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) query.timestamp.$gte = new Date(startDate);
    if (endDate) query.timestamp.$lte = new Date(endDate);
  }
  
  const skip = (page - 1) * Math.min(limit, 100);
  const actualLimit = Math.min(limit, 100);
  
  const [logs, total] = await Promise.all([
    this.find(query)
      .sort({ timestamp: -1 })
      .skip(skip)
      .limit(actualLimit)
      .lean(),
    this.countDocuments(query)
  ]);
  
  return {
    logs,
    total,
    page,
    limit: actualLimit,
    pages: Math.ceil(total / actualLimit)
  };
};

/**
 * Get statistics for compliance reporting
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 * @returns {Promise<Object>}
 */
AuditLogSchema.statics.getComplianceStats = async function(companyId, startDate, endDate) {
  const stats = await this.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(companyId),
        timestamp: { $gte: startDate, $lte: endDate }
      }
    },
    {
      $group: {
        _id: '$action',
        count: { $sum: 1 },
        uniqueUsers: { $addToSet: '$userId' }
      }
    }
  ]);
  
  const result = {
    totalActions: 0,
    byAction: {},
    uniqueUsers: new Set()
  };
  
  for (const stat of stats) {
    result.byAction[stat._id] = {
      count: stat.count,
      uniqueUsers: stat.uniqueUsers.length
    };
    result.totalActions += stat.count;
    stat.uniqueUsers.forEach(u => result.uniqueUsers.add(u));
  }
  
  result.uniqueUsers = result.uniqueUsers.size;
  
  return result;
};


// ═══════════════════════════════════════════════════════════════════════════
// MODEL EXPORT
// ═══════════════════════════════════════════════════════════════════════════

const AuditLog = mongoose.model('AuditLog', AuditLogSchema);

module.exports = AuditLog;
module.exports.AUDIT_ACTIONS = AUDIT_ACTIONS;
module.exports.TARGET_TYPES = TARGET_TYPES;
