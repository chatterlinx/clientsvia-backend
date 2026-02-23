/**
 * ============================================================================
 * GLOBAL TRIGGER - Individual trigger cards within a global group
 * ============================================================================
 *
 * Each document represents one trigger card that belongs to a GlobalTriggerGroup.
 * Stored as separate documents (not embedded) to enable:
 * - MongoDB unique index enforcement (hard duplicate prevention)
 * - Efficient querying and updates
 * - Better scalability for large groups
 *
 * UNIQUENESS GUARANTEE:
 * - { groupId, ruleId } is unique (MongoDB enforced)
 * - { triggerId } is unique globally (MongoDB enforced)
 * - Duplicates are PHYSICALLY IMPOSSIBLE at the database level
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const globalTriggerSchema = new mongoose.Schema({
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY
  // ─────────────────────────────────────────────────────────────────────────
  groupId: {
    type: String,
    required: true,
    trim: true,
    lowercase: true,
    index: true
  },
  ruleId: {
    type: String,
    required: true,
    trim: true,
    match: [/^[a-z0-9_.]+$/, 'ruleId must be lowercase alphanumeric with dots/underscores only']
  },
  triggerId: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },

  // ─────────────────────────────────────────────────────────────────────────
  // DISPLAY
  // ─────────────────────────────────────────────────────────────────────────
  label: {
    type: String,
    required: true,
    trim: true,
    maxlength: 200
  },
  description: {
    type: String,
    default: '',
    maxlength: 500
  },

  // ─────────────────────────────────────────────────────────────────────────
  // MATCHING RULES
  // ─────────────────────────────────────────────────────────────────────────
  enabled: {
    type: Boolean,
    default: true
  },
  priority: {
    type: Number,
    default: 50,
    min: 1,
    max: 1000
  },
  keywords: {
    type: [String],
    default: []
  },
  phrases: {
    type: [String],
    default: []
  },
  negativeKeywords: {
    type: [String],
    default: []
  },
  scenarioTypeAllowlist: {
    type: [String],
    default: []
  },

  // ─────────────────────────────────────────────────────────────────────────
  // RESPONSE
  // ─────────────────────────────────────────────────────────────────────────
  answerText: {
    type: String,
    required: true,
    maxlength: 2000
  },
  audioUrl: {
    type: String,
    default: '',
    maxlength: 500
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FOLLOW-UP
  // ─────────────────────────────────────────────────────────────────────────
  followUpQuestion: {
    type: String,
    default: '',
    maxlength: 500
  },
  followUpNextAction: {
    type: String,
    default: '',
    maxlength: 100
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ADVANCED
  // ─────────────────────────────────────────────────────────────────────────
  typeAllowlist: {
    type: [String],
    default: []
  },
  tags: {
    type: [String],
    default: []
  },

  // ─────────────────────────────────────────────────────────────────────────
  // VERSIONING (per-trigger)
  // ─────────────────────────────────────────────────────────────────────────
  version: {
    type: Number,
    default: 1,
    min: 1
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
  },

  // ─────────────────────────────────────────────────────────────────────────
  // SOFT DELETE (for audit trail and rollback)
  // ─────────────────────────────────────────────────────────────────────────
  isDeleted: {
    type: Boolean,
    default: false,
    index: true
  },
  deletedAt: {
    type: Date,
    default: null
  },
  deletedBy: {
    type: String,
    default: null
  },
  deletedReason: {
    type: String,
    default: null,
    maxlength: 200
  }
}, {
  timestamps: false,
  collection: 'globalTriggers'
});

// ─────────────────────────────────────────────────────────────────────────────
// INDEXES - CRITICAL FOR DUPLICATE PREVENTION
// ─────────────────────────────────────────────────────────────────────────────

globalTriggerSchema.index({ groupId: 1, ruleId: 1 }, { unique: true });
globalTriggerSchema.index({ triggerId: 1 }, { unique: true });
globalTriggerSchema.index({ groupId: 1, priority: 1 });
globalTriggerSchema.index({ groupId: 1, enabled: 1 });
globalTriggerSchema.index({ groupId: 1, isDeleted: 1 });  // Soft delete queries

// ─────────────────────────────────────────────────────────────────────────────
// VIRTUAL: Generate triggerId from groupId and ruleId
// ─────────────────────────────────────────────────────────────────────────────

globalTriggerSchema.statics.generateTriggerId = function(groupId, ruleId) {
  return `${groupId}::${ruleId}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// STATICS
// ─────────────────────────────────────────────────────────────────────────────

globalTriggerSchema.statics.findByGroupId = function(groupId, includeDeleted = false) {
  const query = { groupId: groupId.toLowerCase() };
  if (!includeDeleted) {
    query.isDeleted = { $ne: true };
  }
  return this.find(query)
    .sort({ priority: 1 })
    .lean();
};

globalTriggerSchema.statics.findByTriggerId = function(triggerId, includeDeleted = false) {
  const query = { triggerId };
  if (!includeDeleted) {
    query.isDeleted = { $ne: true };
  }
  return this.findOne(query).lean();
};

globalTriggerSchema.statics.existsInGroup = async function(groupId, ruleId, includeDeleted = false) {
  const query = {
    groupId: groupId.toLowerCase(),
    ruleId
  };
  if (!includeDeleted) {
    query.isDeleted = { $ne: true };
  }
  const count = await this.countDocuments(query);
  return count > 0;
};

globalTriggerSchema.statics.countByGroupId = function(groupId, includeDeleted = false) {
  const query = { groupId: groupId.toLowerCase() };
  if (!includeDeleted) {
    query.isDeleted = { $ne: true };
  }
  return this.countDocuments(query);
};

globalTriggerSchema.statics.findDuplicatesInGroup = async function(groupId) {
  const duplicates = await this.aggregate([
    { $match: { groupId: groupId.toLowerCase(), isDeleted: { $ne: true } } },
    { $group: {
      _id: '$ruleId',
      count: { $sum: 1 },
      docs: { $push: { triggerId: '$triggerId', label: '$label' } }
    }},
    { $match: { count: { $gt: 1 } } }
  ]);
  return duplicates;
};

// ─────────────────────────────────────────────────────────────────────────────
// PRE-SAVE HOOKS
// ─────────────────────────────────────────────────────────────────────────────

globalTriggerSchema.pre('save', function(next) {
  if (!this.triggerId) {
    this.triggerId = `${this.groupId}::${this.ruleId}`;
  }

  this.groupId = this.groupId.toLowerCase();

  this.updatedAt = new Date();

  if (this.keywords && this.keywords.length > 0) {
    this.keywords = this.keywords.map(k => k.toLowerCase().trim()).filter(Boolean);
  }
  if (this.phrases && this.phrases.length > 0) {
    this.phrases = this.phrases.map(p => p.toLowerCase().trim()).filter(Boolean);
  }
  if (this.negativeKeywords && this.negativeKeywords.length > 0) {
    this.negativeKeywords = this.negativeKeywords.map(n => n.toLowerCase().trim()).filter(Boolean);
  }

  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// METHODS: Convert to TriggerCardMatcher format
// ─────────────────────────────────────────────────────────────────────────────

globalTriggerSchema.methods.toMatcherFormat = function() {
  return {
    ruleId: this.ruleId,  // CANONICAL KEY - always use this for Map operations
    triggerId: this.triggerId,
    enabled: this.enabled,
    priority: this.priority ?? 50,  // Default priority if missing
    label: this.label,
    match: {
      keywords: this.keywords || [],
      phrases: this.phrases || [],
      negativeKeywords: this.negativeKeywords || [],
      scenarioTypeAllowlist: this.scenarioTypeAllowlist || []
    },
    answer: {
      answerText: this.answerText,
      audioUrl: this.audioUrl || ''
    },
    followUp: {
      question: this.followUpQuestion || '',
      nextAction: this.followUpNextAction || ''
    },
    _scope: 'GLOBAL',
    _originGroupId: this.groupId
  };
};

module.exports = mongoose.model('GlobalTrigger', globalTriggerSchema);
