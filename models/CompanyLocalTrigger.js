/**
 * ============================================================================
 * COMPANY LOCAL TRIGGER - Company-specific trigger cards
 * ============================================================================
 *
 * Each document represents a company-specific trigger that either:
 * 1. A pure local trigger (company-specific, not related to global)
 * 2. A full override of a global trigger (replaces global completely)
 *
 * UNIQUENESS GUARANTEE:
 * - { companyId, ruleId } is unique (MongoDB enforced)
 * - { triggerId } is unique globally (MongoDB enforced)
 * - { companyId, overrideOfTriggerId } is unique for overrides (partial index)
 * - Duplicates are PHYSICALLY IMPOSSIBLE at the database level
 *
 * ISOLATION RULES:
 * - Each company's triggers are completely isolated
 * - No cross-company data access possible via this collection
 * - companyId is required on every document
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const companyLocalTriggerSchema = new mongoose.Schema({
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY
  // ─────────────────────────────────────────────────────────────────────────
  companyId: {
    type: String,
    required: true,
    trim: true,
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
  // OVERRIDE REFERENCE (if this is overriding a global trigger)
  // ─────────────────────────────────────────────────────────────────────────
  // CRITICAL: Never parse IDs from strings. Always store explicit references.
  isOverride: {
    type: Boolean,
    default: false
  },
  overrideOfGroupId: {
    type: String,
    default: null,
    trim: true,
    lowercase: true
  },
  overrideOfRuleId: {
    type: String,
    default: null,
    trim: true,
    lowercase: true
  },
  overrideOfTriggerId: {
    type: String,
    default: null,
    trim: true
  },
  overrideType: {
    type: String,
    enum: ['FULL', null],
    default: null
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
  
  // Response mode determines how the agent answers when this trigger fires
  // - 'standard': Use answerText directly (play audio or TTS)
  // - 'llm': Use LLM to generate response from fact packs (always TTS, no pre-recorded audio)
  responseMode: {
    type: String,
    enum: ['standard', 'llm'],
    default: 'standard'
  },
  
  // Standard mode fields
  answerText: {
    type: String,
    required: function() { return this.responseMode !== 'llm'; },
    maxlength: 2000
  },
  audioUrl: {
    type: String,
    default: '',
    maxlength: 500
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // LLM FACT PACK (used when responseMode === 'llm')
  // ─────────────────────────────────────────────────────────────────────────
  // The LLM generates a response constrained to ONLY these facts.
  // This keeps responses deterministic and prevents hallucination.
  // TIGHT LIMITS: Fact packs are capped at 2500 chars each to control cost/latency.
  
  llmFactPack: {
    // What IS included in the service/product
    includedFacts: {
      type: String,
      default: '',
      maxlength: 2500
    },
    // What is NOT included (disclaimers, "needs estimate" items)
    excludedFacts: {
      type: String,
      default: '',
      maxlength: 2500
    },
    // Deterministic backup answer if LLM fails/times out
    // CRITICAL: This is used when OpenAI is down - NOT generic fluff
    backupAnswer: {
      type: String,
      default: '',
      maxlength: 500
    }
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
  collection: 'companyLocalTriggers'
});

// ─────────────────────────────────────────────────────────────────────────────
// INDEXES - CRITICAL FOR DUPLICATE PREVENTION AND ISOLATION
// ─────────────────────────────────────────────────────────────────────────────

// PRIMARY: ruleId unique per company (only for non-deleted docs)
// PARTIAL: allows recreate after soft delete
companyLocalTriggerSchema.index(
  { companyId: 1, ruleId: 1 },
  { 
    unique: true,
    partialFilterExpression: { isDeleted: { $ne: true } }
  }
);

// triggerId unique per company (only for non-deleted docs)
companyLocalTriggerSchema.index(
  { companyId: 1, triggerId: 1 },
  { 
    unique: true,
    partialFilterExpression: { isDeleted: { $ne: true } }
  }
);

// Query optimization
companyLocalTriggerSchema.index({ companyId: 1, priority: 1 });
companyLocalTriggerSchema.index({ companyId: 1, enabled: 1 });
companyLocalTriggerSchema.index({ companyId: 1, isDeleted: 1 });

// CRITICAL: Unique override index - one override per global trigger per company
// PARTIAL: only when isOverride=true AND not deleted
companyLocalTriggerSchema.index(
  { companyId: 1, overrideOfTriggerId: 1 },
  { 
    unique: true,
    partialFilterExpression: { 
      isOverride: true,
      isDeleted: { $ne: true },
      overrideOfTriggerId: { $type: 'string' } 
    }
  }
);

// overrideOfRuleId is for efficient lookups, NOT uniqueness enforcement
companyLocalTriggerSchema.index({ companyId: 1, overrideOfRuleId: 1 });

// ─────────────────────────────────────────────────────────────────────────────
// STATICS
// ─────────────────────────────────────────────────────────────────────────────

companyLocalTriggerSchema.statics.generateTriggerId = function(companyId, ruleId, isOverride = false, overrideOfTriggerId = null) {
  if (isOverride && overrideOfTriggerId) {
    return `${companyId}::override::${overrideOfTriggerId}`;
  }
  return `${companyId}::${ruleId}`;
};

// RUNTIME: Load ONLY enabled, non-deleted triggers
companyLocalTriggerSchema.statics.findActiveByCompanyId = function(companyId) {
  return this.find({
    companyId,
    enabled: true,
    isDeleted: { $ne: true }
  })
    .sort({ priority: 1 })
    .lean();
};

// ADMIN: Load all triggers for editing
companyLocalTriggerSchema.statics.findByCompanyId = function(companyId, includeDeleted = false) {
  const query = { companyId };
  if (!includeDeleted) {
    query.isDeleted = { $ne: true };
  }
  return this.find(query)
    .sort({ priority: 1 })
    .lean();
};

companyLocalTriggerSchema.statics.findByTriggerId = function(triggerId, includeDeleted = false) {
  const query = { triggerId };
  if (!includeDeleted) {
    query.isDeleted = { $ne: true };
  }
  return this.findOne(query).lean();
};

companyLocalTriggerSchema.statics.existsForCompany = async function(companyId, ruleId, includeDeleted = false) {
  const query = { companyId, ruleId };
  if (!includeDeleted) {
    query.isDeleted = { $ne: true };
  }
  const count = await this.countDocuments(query);
  return count > 0;
};

// Find soft-deleted trigger (for revival)
companyLocalTriggerSchema.statics.findDeletedForCompany = function(companyId, ruleId) {
  return this.findOne({
    companyId,
    ruleId,
    isDeleted: true
  });
};

companyLocalTriggerSchema.statics.overrideExists = async function(companyId, overrideOfTriggerId, includeDeleted = false) {
  const query = { companyId, overrideOfTriggerId, isOverride: true };
  if (!includeDeleted) {
    query.isDeleted = { $ne: true };
  }
  const count = await this.countDocuments(query);
  return count > 0;
};

companyLocalTriggerSchema.statics.countByCompanyId = function(companyId) {
  return this.countDocuments({ companyId });
};

companyLocalTriggerSchema.statics.findDuplicatesForCompany = async function(companyId) {
  const duplicates = await this.aggregate([
    { $match: { companyId } },
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

companyLocalTriggerSchema.pre('save', function(next) {
  if (!this.triggerId) {
    if (this.isOverride && this.overrideOfTriggerId) {
      this.triggerId = `${this.companyId}::override::${this.overrideOfTriggerId}`;
    } else {
      this.triggerId = `${this.companyId}::${this.ruleId}`;
    }
  }

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

companyLocalTriggerSchema.methods.toMatcherFormat = function() {
  const base = {
    id: this.triggerId,  // TriggerCardMatcher expects card.id
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
    responseMode: this.responseMode || 'standard',
    answer: {
      answerText: this.answerText || '',
      audioUrl: this.audioUrl || ''
    },
    followUp: {
      question: this.followUpQuestion || '',
      nextAction: this.followUpNextAction || ''
    },
    _scope: 'LOCAL',
    _isOverride: this.isOverride,
    _overrideOfGroupId: this.overrideOfGroupId,
    _overrideOfRuleId: this.overrideOfRuleId,
    _overrideOfTriggerId: this.overrideOfTriggerId
  };
  
  // Include LLM fact pack if in LLM mode
  if (this.responseMode === 'llm' && this.llmFactPack) {
    base.llmFactPack = {
      includedFacts: this.llmFactPack.includedFacts || '',
      excludedFacts: this.llmFactPack.excludedFacts || '',
      backupAnswer: this.llmFactPack.backupAnswer || ''
    };
  }
  
  return base;
};

module.exports = mongoose.model('CompanyLocalTrigger', companyLocalTriggerSchema);
