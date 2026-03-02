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

  // ═══════════════════════════════════════════════════════════════════════════
  // STRICT TRIGGER SYSTEM - MODE CONTROL (Added V131)
  // ═══════════════════════════════════════════════════════════════════════════
  // DEFAULT: STRICT (true)
  // - Legacy playbook.rules is DISABLED
  // - Triggers load ONLY from GlobalTrigger + CompanyLocalTrigger
  // - Zero-trigger pool emits loud warning + remediation hint
  //
  // LEGACY MODE: strictMode = false (explicit opt-in)
  // - Legacy playbook.rules is allowed as fallback
  // - Runtime emits LEGACY_FALLBACK_USED event on every use
  // - Admin console shows warning banner
  // - Intended ONLY for migration, not permanent state
  // ═══════════════════════════════════════════════════════════════════════════
  strictMode: {
    type: Boolean,
    default: true  // STRICT by default — legacy is opt-in, not opt-out
  },
  strictModeSetAt: {
    type: Date,
    default: null
  },
  strictModeSetBy: {
    type: String,
    default: null
  },
  // Track when legacy was last used (for auditing)
  lastLegacyFallbackAt: {
    type: Date,
    default: null
  },
  legacyFallbackCount: {
    type: Number,
    default: 0
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
  // DISABLED GLOBAL TRIGGERS (opt-out list)
  // Disabled triggers are still visible but marked as OFF
  // ─────────────────────────────────────────────────────────────────────────
  disabledGlobalTriggerIds: {
    type: [String],
    default: []
  },
  
  // DEPRECATED: Legacy field for migration
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
  // COMPANY VARIABLES (for placeholder replacement in triggers)
  // Example: {diagnosticFee: "$89", afterHoursFee: "$125"}
  // Used in trigger text: "Our service call is {diagnosticFee}"
  // ─────────────────────────────────────────────────────────────────────────
  companyVariables: {
    type: Map,
    of: String,
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

companyTriggerSettingsSchema.statics.disableGlobalTrigger = function(companyId, triggerId) {
  return this.findOneAndUpdate(
    { companyId },
    { 
      $addToSet: { disabledGlobalTriggerIds: triggerId },
      $set: { updatedAt: new Date() }
    },
    { upsert: true, new: true }
  );
};

companyTriggerSettingsSchema.statics.enableGlobalTrigger = function(companyId, triggerId) {
  return this.findOneAndUpdate(
    { companyId },
    { 
      $pull: { disabledGlobalTriggerIds: triggerId },
      $set: { updatedAt: new Date() }
    },
    { new: true }
  );
};

// LEGACY: Keep old methods for backward compatibility
companyTriggerSettingsSchema.statics.hideGlobalTrigger = function(companyId, triggerId) {
  return this.disableGlobalTrigger(companyId, triggerId);
};

companyTriggerSettingsSchema.statics.showGlobalTrigger = function(companyId, triggerId) {
  return this.enableGlobalTrigger(companyId, triggerId);
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

// ═══════════════════════════════════════════════════════════════════════════
// STRICT TRIGGER SYSTEM - MODE CONTROL STATICS (Added V131)
// ═══════════════════════════════════════════════════════════════════════════

companyTriggerSettingsSchema.statics.setStrictMode = function(companyId, enabled, userId) {
  const now = new Date();
  return this.findOneAndUpdate(
    { companyId },
    { 
      $set: { 
        strictMode: enabled,
        strictModeSetAt: now,
        strictModeSetBy: userId,
        updatedAt: now 
      }
    },
    { upsert: true, new: true }
  );
};

companyTriggerSettingsSchema.statics.isStrictMode = async function(companyId) {
  const settings = await this.findOne({ companyId }).select('strictMode').lean();
  // Default to strict mode if no settings exist
  return settings?.strictMode !== false;
};

companyTriggerSettingsSchema.statics.recordLegacyFallback = function(companyId) {
  return this.findOneAndUpdate(
    { companyId },
    { 
      $set: { lastLegacyFallbackAt: new Date() },
      $inc: { legacyFallbackCount: 1 }
    },
    { upsert: true, new: true }
  );
};

companyTriggerSettingsSchema.statics.getStrictModeStats = async function() {
  const [strictCount, legacyCount] = await Promise.all([
    this.countDocuments({ strictMode: true }),
    this.countDocuments({ strictMode: false })
  ]);
  return { strictCount, legacyCount, total: strictCount + legacyCount };
};

// ─────────────────────────────────────────────────────────────────────────────
// METHODS
// ─────────────────────────────────────────────────────────────────────────────

companyTriggerSettingsSchema.methods.isGlobalTriggerDisabled = function(triggerId) {
  return this.disabledGlobalTriggerIds.includes(triggerId);
};

// LEGACY: Keep old method for backward compatibility
companyTriggerSettingsSchema.methods.isGlobalTriggerHidden = function(triggerId) {
  return this.isGlobalTriggerDisabled(triggerId);
};

companyTriggerSettingsSchema.methods.getPartialOverride = function(globalTriggerId) {
  return this.partialOverrides.get(globalTriggerId);
};

// ─────────────────────────────────────────────────────────────────────────────
// PRE-SAVE HOOKS
// ─────────────────────────────────────────────────────────────────────────────

companyTriggerSettingsSchema.pre('save', function(next) {
  this.updatedAt = new Date();

  // Deduplicate disabledGlobalTriggerIds
  if (this.disabledGlobalTriggerIds && this.disabledGlobalTriggerIds.length > 0) {
    this.disabledGlobalTriggerIds = [...new Set(this.disabledGlobalTriggerIds)];
  }

  // Legacy field deduplication
  if (this.hiddenGlobalTriggerIds && this.hiddenGlobalTriggerIds.length > 0) {
    this.hiddenGlobalTriggerIds = [...new Set(this.hiddenGlobalTriggerIds)];
  }

  next();
});

module.exports = mongoose.model('CompanyTriggerSettings', companyTriggerSettingsSchema);
