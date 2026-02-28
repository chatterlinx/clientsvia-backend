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
 * DRAFT/PUBLISHED MODEL:
 * - Each trigger has a `state` field: 'draft' or 'published'
 * - Admins edit DRAFT triggers (never touch published directly)
 * - Publish operation: copy draft → published (upsert)
 * - Runtime reads ONLY 'published' state triggers
 * - This prevents draft edits from leaking live
 *
 * UNIQUENESS GUARANTEE:
 * - { groupId, ruleId, state } is unique (for non-deleted docs)
 * - Partial unique index excludes soft-deleted docs (allows recreate after delete)
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
    trim: true
  },

  // ─────────────────────────────────────────────────────────────────────────
  // DRAFT/PUBLISHED STATE
  // ─────────────────────────────────────────────────────────────────────────
  // 'draft' = editable by admins, not served to companies
  // 'published' = read-only snapshot served to companies at runtime
  // Publish operation copies draft → published (upsert)
  state: {
    type: String,
    enum: ['draft', 'published'],
    default: 'draft',
    required: true,
    index: true
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

// PRIMARY UNIQUE: { groupId, ruleId, state } - allows one draft and one published per ruleId
// PARTIAL: excludes soft-deleted docs so you can recreate after delete
globalTriggerSchema.index(
  { groupId: 1, ruleId: 1, state: 1 },
  { 
    unique: true,
    partialFilterExpression: { isDeleted: { $ne: true } }
  }
);

// triggerId unique per state (not globally - allows draft and published to coexist)
globalTriggerSchema.index(
  { triggerId: 1, state: 1 },
  { 
    unique: true,
    partialFilterExpression: { isDeleted: { $ne: true } }
  }
);

// Query optimization indexes
globalTriggerSchema.index({ groupId: 1, state: 1, priority: 1 });
globalTriggerSchema.index({ groupId: 1, state: 1, enabled: 1 });
globalTriggerSchema.index({ groupId: 1, state: 1, isDeleted: 1 });

// ─────────────────────────────────────────────────────────────────────────────
// VIRTUAL: Generate triggerId from groupId and ruleId
// ─────────────────────────────────────────────────────────────────────────────

globalTriggerSchema.statics.generateTriggerId = function(groupId, ruleId) {
  return `${groupId}::${ruleId}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// STATICS
// ─────────────────────────────────────────────────────────────────────────────

// RUNTIME: Load ONLY published, enabled, non-deleted triggers
globalTriggerSchema.statics.findPublishedByGroupId = function(groupId) {
  return this.find({
    groupId: groupId.toLowerCase(),
    state: 'published',
    enabled: true,
    isDeleted: { $ne: true }
  })
    .sort({ priority: 1 })
    .lean();
};

// ADMIN: Load draft triggers for editing
globalTriggerSchema.statics.findDraftsByGroupId = function(groupId) {
  return this.find({
    groupId: groupId.toLowerCase(),
    state: 'draft',
    isDeleted: { $ne: true }
  })
    .sort({ priority: 1 })
    .lean();
};

// ADMIN: Load all triggers (both states) for a group
globalTriggerSchema.statics.findByGroupId = function(groupId, options = {}) {
  const { state = null, includeDeleted = false, includeDisabled = true } = options;
  const query = { groupId: groupId.toLowerCase() };
  
  if (state) {
    query.state = state;
  }
  if (!includeDeleted) {
    query.isDeleted = { $ne: true };
  }
  if (!includeDisabled) {
    query.enabled = true;
  }
  
  return this.find(query)
    .sort({ priority: 1 })
    .lean();
};

globalTriggerSchema.statics.findByTriggerId = function(triggerId, state = 'draft', includeDeleted = false) {
  const query = { triggerId, state };
  if (!includeDeleted) {
    query.isDeleted = { $ne: true };
  }
  return this.findOne(query).lean();
};

globalTriggerSchema.statics.existsInGroup = async function(groupId, ruleId, state = 'draft', includeDeleted = false) {
  const query = {
    groupId: groupId.toLowerCase(),
    ruleId,
    state
  };
  if (!includeDeleted) {
    query.isDeleted = { $ne: true };
  }
  const count = await this.countDocuments(query);
  return count > 0;
};

// Find soft-deleted trigger (for revival)
globalTriggerSchema.statics.findDeletedInGroup = function(groupId, ruleId, state = 'draft') {
  return this.findOne({
    groupId: groupId.toLowerCase(),
    ruleId,
    state,
    isDeleted: true
  });
};

globalTriggerSchema.statics.countByGroupId = function(groupId, state = null, includeDeleted = false) {
  const query = { groupId: groupId.toLowerCase() };
  if (state) {
    query.state = state;
  }
  if (!includeDeleted) {
    query.isDeleted = { $ne: true };
  }
  return this.countDocuments(query);
};

globalTriggerSchema.statics.findDuplicatesInGroup = async function(groupId, state = 'draft') {
  const duplicates = await this.aggregate([
    { $match: { groupId: groupId.toLowerCase(), state, isDeleted: { $ne: true } } },
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
    _scope: 'GLOBAL',
    _originGroupId: this.groupId,
    _state: this.state
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

// ─────────────────────────────────────────────────────────────────────────────
// PUBLISH OPERATION: Copy draft → published
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Publish all draft triggers in a group to 'published' state.
 * Uses upsert to create or update published versions.
 * Returns { publishedCount, deletedCount, errors }
 */
globalTriggerSchema.statics.publishGroup = async function(groupId, userId) {
  const normalizedGroupId = groupId.toLowerCase();
  const results = {
    publishedCount: 0,
    deletedFromPublished: 0,
    errors: []
  };

  // 1. Get all draft triggers (non-deleted)
  const drafts = await this.find({
    groupId: normalizedGroupId,
    state: 'draft',
    isDeleted: { $ne: true }
  }).lean();

  // 2. Get all currently published triggers
  const currentPublished = await this.find({
    groupId: normalizedGroupId,
    state: 'published',
    isDeleted: { $ne: true }
  }).lean();

  const draftRuleIds = new Set(drafts.map(d => d.ruleId));

  // 3. For each draft: upsert into published
  for (const draft of drafts) {
    try {
      const publishedData = {
        groupId: draft.groupId,
        ruleId: draft.ruleId,
        triggerId: draft.triggerId,
        state: 'published',
        label: draft.label,
        description: draft.description,
        enabled: draft.enabled,
        priority: draft.priority,
        keywords: draft.keywords,
        phrases: draft.phrases,
        negativeKeywords: draft.negativeKeywords,
        scenarioTypeAllowlist: draft.scenarioTypeAllowlist,
        responseMode: draft.responseMode || 'standard',
        answerText: draft.answerText,
        audioUrl: draft.audioUrl,
        llmFactPack: draft.llmFactPack || {
          includedFacts: '',
          excludedFacts: '',
          backupAnswer: ''
        },
        followUpQuestion: draft.followUpQuestion,
        followUpNextAction: draft.followUpNextAction,
        typeAllowlist: draft.typeAllowlist,
        tags: draft.tags,
        version: draft.version,
        createdAt: draft.createdAt,
        createdBy: draft.createdBy,
        updatedAt: new Date(),
        updatedBy: userId,
        isDeleted: false,
        deletedAt: null,
        deletedBy: null,
        deletedReason: null
      };

      await this.findOneAndUpdate(
        { groupId: normalizedGroupId, ruleId: draft.ruleId, state: 'published' },
        { $set: publishedData },
        { upsert: true, new: true }
      );
      results.publishedCount++;
    } catch (err) {
      results.errors.push({ ruleId: draft.ruleId, error: err.message });
    }
  }

  // 4. Soft-delete published triggers that no longer exist in draft
  for (const pub of currentPublished) {
    if (!draftRuleIds.has(pub.ruleId)) {
      await this.findOneAndUpdate(
        { _id: pub._id },
        { 
          $set: { 
            isDeleted: true, 
            deletedAt: new Date(), 
            deletedBy: userId,
            deletedReason: 'REMOVED_FROM_DRAFT_ON_PUBLISH'
          } 
        }
      );
      results.deletedFromPublished++;
    }
  }

  return results;
};

module.exports = mongoose.model('GlobalTrigger', globalTriggerSchema);
