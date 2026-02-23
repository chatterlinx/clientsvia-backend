/**
 * ============================================================================
 * GLOBAL TRIGGER GROUP - Platform-wide trigger collections
 * ============================================================================
 *
 * This collection stores metadata for global trigger groups (e.g., HVAC, Dental).
 * Groups contain triggers that can be shared across multiple companies.
 *
 * ISOLATION RULES:
 * - Groups are platform-level resources (no companyId)
 * - Access controlled via RBAC permissions
 * - Changes require explicit approval workflow
 *
 * VERSIONING:
 * - Every edit increments version
 * - Publishing creates immutable snapshot
 * - Rollback restores from version history
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const versionSnapshotSchema = new mongoose.Schema({
  version: { type: Number, required: true },
  triggerCount: { type: Number, required: true },
  publishedAt: { type: Date, required: true },
  publishedBy: { type: String, required: true },
  changeLog: { type: String, default: '' },
  triggersSnapshot: { type: mongoose.Schema.Types.Mixed, default: null }
}, { _id: false });

const auditLogEntrySchema = new mongoose.Schema({
  action: {
    type: String,
    required: true,
    enum: [
      'GROUP_CREATED',
      'GROUP_UPDATED',
      'GROUP_PUBLISHED',
      'GROUP_ROLLBACK',
      'TRIGGER_ADDED',
      'TRIGGER_UPDATED',
      'TRIGGER_DELETED',
      'BULK_IMPORT'
    ]
  },
  targetTriggerId: { type: String, default: null },
  performedBy: { type: String, required: true },
  performedAt: { type: Date, default: Date.now },
  approvalText: { type: String, default: null },
  ipAddress: { type: String, default: null },
  userAgent: { type: String, default: null },
  details: { type: mongoose.Schema.Types.Mixed, default: {} }
}, { _id: false });

const globalTriggerGroupSchema = new mongoose.Schema({
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY
  // ─────────────────────────────────────────────────────────────────────────
  groupId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
    match: [/^[a-z0-9_-]+$/, 'groupId must be lowercase alphanumeric with underscores/hyphens only']
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  icon: {
    type: String,
    default: '📋',
    maxlength: 10
  },
  description: {
    type: String,
    default: '',
    maxlength: 500
  },
  industry: {
    type: String,
    default: 'general',
    trim: true,
    lowercase: true
  },

  // ─────────────────────────────────────────────────────────────────────────
  // VERSIONING
  // ─────────────────────────────────────────────────────────────────────────
  version: {
    type: Number,
    default: 1,
    min: 1
  },
  publishedVersion: {
    type: Number,
    default: 0,
    min: 0
  },
  isDraft: {
    type: Boolean,
    default: true
  },

  // ─────────────────────────────────────────────────────────────────────────
  // VERSION HISTORY (for rollback)
  // ─────────────────────────────────────────────────────────────────────────
  versionHistory: {
    type: [versionSnapshotSchema],
    default: []
  },
  maxVersionHistorySize: {
    type: Number,
    default: 20
  },

  // ─────────────────────────────────────────────────────────────────────────
  // AUDIT LOG
  // ─────────────────────────────────────────────────────────────────────────
  auditLog: {
    type: [auditLogEntrySchema],
    default: []
  },

  // ─────────────────────────────────────────────────────────────────────────
  // STATS (denormalized for performance)
  // ─────────────────────────────────────────────────────────────────────────
  triggerCount: {
    type: Number,
    default: 0,
    min: 0
  },
  companyCount: {
    type: Number,
    default: 0,
    min: 0
  },

  // ─────────────────────────────────────────────────────────────────────────
  // STATUS
  // ─────────────────────────────────────────────────────────────────────────
  isActive: {
    type: Boolean,
    default: true
  },
  isLocked: {
    type: Boolean,
    default: false
  },
  lockedReason: {
    type: String,
    default: null
  },

  // ─────────────────────────────────────────────────────────────────────────
  // METADATA
  // ─────────────────────────────────────────────────────────────────────────
  createdAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: String,
    required: true
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: String,
    default: null
  }
}, {
  timestamps: false,
  collection: 'globalTriggerGroups'
});

// ─────────────────────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────────────────────

globalTriggerGroupSchema.index({ groupId: 1 }, { unique: true });
globalTriggerGroupSchema.index({ industry: 1 });
globalTriggerGroupSchema.index({ isActive: 1 });
globalTriggerGroupSchema.index({ companyCount: -1 });

// ─────────────────────────────────────────────────────────────────────────────
// METHODS
// ─────────────────────────────────────────────────────────────────────────────

globalTriggerGroupSchema.methods.addAuditEntry = function(action, performedBy, details = {}) {
  this.auditLog.push({
    action,
    performedBy,
    performedAt: new Date(),
    details
  });

  if (this.auditLog.length > 100) {
    this.auditLog = this.auditLog.slice(-100);
  }
};

globalTriggerGroupSchema.methods.incrementVersion = function(updatedBy) {
  this.version += 1;
  this.isDraft = true;
  this.updatedAt = new Date();
  this.updatedBy = updatedBy;
};

// ─────────────────────────────────────────────────────────────────────────────
// STATICS
// ─────────────────────────────────────────────────────────────────────────────

globalTriggerGroupSchema.statics.findByGroupId = function(groupId) {
  return this.findOne({ groupId: groupId.toLowerCase() });
};

globalTriggerGroupSchema.statics.listActiveGroups = function() {
  return this.find({ isActive: true })
    .select('groupId name icon description industry triggerCount companyCount')
    .sort({ companyCount: -1, name: 1 })
    .lean();
};

globalTriggerGroupSchema.statics.groupIdExists = async function(groupId) {
  const count = await this.countDocuments({ groupId: groupId.toLowerCase() });
  return count > 0;
};

// ─────────────────────────────────────────────────────────────────────────────
// PRE-SAVE HOOKS
// ─────────────────────────────────────────────────────────────────────────────

globalTriggerGroupSchema.pre('save', function(next) {
  this.updatedAt = new Date();
  next();
});

module.exports = mongoose.model('GlobalTriggerGroup', globalTriggerGroupSchema);
