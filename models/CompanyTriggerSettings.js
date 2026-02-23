/**
 * ============================================================================
 * COMPANY TRIGGER SETTINGS - Per-company trigger configuration
 * ============================================================================
 *
 * Each document stores a company's trigger configuration:
 * - Which global group they're using (activeGroupId)
 * - Which global triggers they've hidden (opt-out list)
 * - Partial overrides (just answer text/audio, not full trigger)
 *
 * UNIQUENESS GUARANTEE:
 * - { companyId } is unique (one settings doc per company)
 *
 * ISOLATION RULES:
 * - Each company has exactly one settings document
 * - hiddenGlobalTriggerIds is a Set (no duplicates)
 * - partialOverrides keyed by globalTriggerId (one override per global trigger)
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// PARTIAL OVERRIDE VALUE SCHEMA (for Map values)
// ─────────────────────────────────────────────────────────────────────────────
// Using a Map keyed by globalTriggerId guarantees uniqueness - you cannot have
// duplicate keys in a Map. This is safer than an array with manual enforcement.
const partialOverrideValueSchema = new mongoose.Schema({
  answerText: {
    type: String,
    default: null,
    maxlength: 2000
  },
  audioUrl: {
    type: String,
    default: null,
    maxlength: 500
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  createdBy: {
    type: String,
    default: null
  },
  updatedAt: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: String,
    default: null
  }
}, { _id: false });

const companyTriggerSettingsSchema = new mongoose.Schema({
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY
  // ─────────────────────────────────────────────────────────────────────────
  companyId: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    index: true
  },

  // ─────────────────────────────────────────────────────────────────────────
  // GROUP SELECTION
  // ─────────────────────────────────────────────────────────────────────────
  // VERSIONING MODEL: publishedVersion-only
  // - Company always uses the group's current publishedVersion
  // - No per-company version pinning (that requires copy-on-write complexity)
  // - activeGroupVersion is informational only (tracks what was selected)
  activeGroupId: {
    type: String,
    default: null,
    trim: true,
    lowercase: true
  },
  // INFORMATIONAL: Tracks version at time of selection (not used for loading)
  // Runtime always loads group's current publishedVersion triggers
  activeGroupVersionAtSelection: {
    type: Number,
    default: null
  },
  groupSelectedAt: {
    type: Date,
    default: null
  },
  groupSelectedBy: {
    type: String,
    default: null
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HIDDEN GLOBAL TRIGGERS (opt-out list)
  // ─────────────────────────────────────────────────────────────────────────
  hiddenGlobalTriggerIds: {
    type: [String],
    default: []
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PARTIAL OVERRIDES (just content, not full trigger)
  // Using Map keyed by globalTriggerId - guarantees one override per trigger
  // ─────────────────────────────────────────────────────────────────────────
  partialOverrides: {
    type: Map,
    of: partialOverrideValueSchema,
    default: () => new Map()
  },

  // ─────────────────────────────────────────────────────────────────────────
  // LEGACY DATA MIGRATION
  // ─────────────────────────────────────────────────────────────────────────
  migratedFromLegacy: {
    type: Boolean,
    default: false
  },
  legacyMigrationDate: {
    type: Date,
    default: null
  },
  legacyTriggerCount: {
    type: Number,
    default: 0
  },

  // ─────────────────────────────────────────────────────────────────────────
  // METADATA
  // ─────────────────────────────────────────────────────────────────────────
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: false,
  collection: 'companyTriggerSettings'
});

// ─────────────────────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────────────────────

companyTriggerSettingsSchema.index({ companyId: 1 }, { unique: true });
companyTriggerSettingsSchema.index({ activeGroupId: 1 });

// ─────────────────────────────────────────────────────────────────────────────
// STATICS
// ─────────────────────────────────────────────────────────────────────────────

companyTriggerSettingsSchema.statics.findByCompanyId = function(companyId) {
  return this.findOne({ companyId }).lean();
};

companyTriggerSettingsSchema.statics.findOrCreate = async function(companyId) {
  let settings = await this.findOne({ companyId });
  if (!settings) {
    settings = await this.create({ companyId });
  }
  return settings;
};

companyTriggerSettingsSchema.statics.setActiveGroup = function(companyId, groupId, publishedVersionAtSelection, userId) {
  const update = {
    activeGroupId: groupId ? groupId.toLowerCase() : null,
    activeGroupVersionAtSelection: publishedVersionAtSelection || null,  // Informational only
    groupSelectedAt: new Date(),
    groupSelectedBy: userId,
    updatedAt: new Date()
  };

  return this.findOneAndUpdate(
    { companyId },
    { $set: update },
    { upsert: true, new: true }
  );
};

companyTriggerSettingsSchema.statics.hideGlobalTrigger = function(companyId, triggerId) {
  return this.findOneAndUpdate(
    { companyId },
    { 
      $addToSet: { hiddenGlobalTriggerIds: triggerId },
      $set: { updatedAt: new Date() }
    },
    { upsert: true, new: true }
  );
};

companyTriggerSettingsSchema.statics.showGlobalTrigger = function(companyId, triggerId) {
  return this.findOneAndUpdate(
    { companyId },
    { 
      $pull: { hiddenGlobalTriggerIds: triggerId },
      $set: { updatedAt: new Date() }
    },
    { new: true }
  );
};

companyTriggerSettingsSchema.statics.setPartialOverride = async function(companyId, globalTriggerId, overrideData, userId) {
  const now = new Date();
  const settings = await this.findOne({ companyId });
  
  if (!settings) {
    const newSettings = new this({ companyId });
    newSettings.partialOverrides.set(globalTriggerId, {
      ...overrideData,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      updatedBy: userId
    });
    return newSettings.save();
  }

  const existing = settings.partialOverrides.get(globalTriggerId);
  
  if (existing) {
    settings.partialOverrides.set(globalTriggerId, {
      ...existing,
      ...overrideData,
      updatedAt: now,
      updatedBy: userId
    });
  } else {
    settings.partialOverrides.set(globalTriggerId, {
      ...overrideData,
      createdBy: userId,
      createdAt: now,
      updatedAt: now,
      updatedBy: userId
    });
  }

  settings.updatedAt = now;
  return settings.save();
};

companyTriggerSettingsSchema.statics.removePartialOverride = async function(companyId, globalTriggerId) {
  const settings = await this.findOne({ companyId });
  if (!settings) {
    return null;
  }
  
  settings.partialOverrides.delete(globalTriggerId);
  settings.updatedAt = new Date();
  return settings.save();
};

companyTriggerSettingsSchema.statics.countCompaniesByGroup = function(groupId) {
  return this.countDocuments({ activeGroupId: groupId.toLowerCase() });
};

companyTriggerSettingsSchema.statics.getCompaniesUsingGroup = function(groupId) {
  return this.find({ activeGroupId: groupId.toLowerCase() })
    .select('companyId groupSelectedAt')
    .lean();
};

// ─────────────────────────────────────────────────────────────────────────────
// METHODS
// ─────────────────────────────────────────────────────────────────────────────

companyTriggerSettingsSchema.methods.isGlobalTriggerHidden = function(triggerId) {
  return this.hiddenGlobalTriggerIds.includes(triggerId);
};

companyTriggerSettingsSchema.methods.getPartialOverride = function(globalTriggerId) {
  return this.partialOverrides.get(globalTriggerId);
};

// ─────────────────────────────────────────────────────────────────────────────
// PRE-SAVE HOOKS
// ─────────────────────────────────────────────────────────────────────────────

companyTriggerSettingsSchema.pre('save', function(next) {
  this.updatedAt = new Date();

  if (this.hiddenGlobalTriggerIds && this.hiddenGlobalTriggerIds.length > 0) {
    this.hiddenGlobalTriggerIds = [...new Set(this.hiddenGlobalTriggerIds)];
  }

  next();
});

module.exports = mongoose.model('CompanyTriggerSettings', companyTriggerSettingsSchema);
