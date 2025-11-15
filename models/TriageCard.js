// ═════════════════════════════════════════════════════════════════════════════
// TRIAGE CARD MODEL
// ═════════════════════════════════════════════════════════════════════════════
// Purpose: Atomic source of truth for Frontline-Intel triage configuration
// Scope: Per-company, multi-tenant isolated
// Architecture: Single card contains 4 parts (Frontline rules, Triage map, 
//               Response library, Category skeleton)
// ═════════════════════════════════════════════════════════════════════════════

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ─────────────────────────────────────────────────────────────────────────────
// TRIAGE MAP RULE SCHEMA
// ─────────────────────────────────────────────────────────────────────────────
// Purpose: Structured decision tree for call classification
// Logic: keywords + excludeKeywords → serviceType + action
// Example: ["not cooling", "maintenance"] → REPAIR + EXPLAIN_AND_PUSH
// ─────────────────────────────────────────────────────────────────────────────

const TriageRuleSchema = new Schema({
  keywords: {
    type: [String],
    required: true,
    description: 'Phrases to detect (AND logic: all must be present)'
  },
  excludeKeywords: {
    type: [String],
    default: [],
    description: 'Phrases that disqualify this rule (must NOT be present)'
  },
  serviceType: {
    type: String,
    enum: ['REPAIR', 'MAINTENANCE', 'EMERGENCY', 'INSTALL', 'INSPECTION', 'QUOTE', 'OTHER', 'UNKNOWN'],
    required: true,
    description: 'Target service type classification'
  },
  action: {
    type: String,
    enum: ['DIRECT_TO_3TIER', 'EXPLAIN_AND_PUSH', 'ESCALATE_TO_HUMAN', 'TAKE_MESSAGE', 'END_CALL_POLITE'],
    required: true,
    description: 'DIRECT_TO_3TIER: clean handoff | EXPLAIN_AND_PUSH: educate then handoff | ESCALATE_TO_HUMAN: transfer | TAKE_MESSAGE: collect info and end | END_CALL_POLITE: polite rejection'
  },
  responseCategory: {
    type: String,
    description: 'Which response pool to use (e.g., "downgrade_prevention")',
    default: 'general'
  },
  priority: {
    type: Number,
    required: true,
    description: 'Higher priority rules checked first (conflict resolution)',
    default: 10,
    min: 1,
    max: 100
  },
  reason: {
    type: String,
    description: 'Human-readable explanation for this rule (admin reference)'
  }
}, { _id: false });

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY SCHEMA
// ─────────────────────────────────────────────────────────────────────────────
// Purpose: Category skeleton for 3-Tier system + AI Scenario Architect
// Flow: Card generates → admin uses seeds → AI Scenario Architect builds full scenarios
// ─────────────────────────────────────────────────────────────────────────────

const CategorySchema = new Schema({
  name: {
    type: String,
    required: true,
    description: 'Human-readable category name (e.g., "AC Not Cooling - Repair")'
  },
  slug: {
    type: String,
    required: true,
    description: 'Machine-readable slug (e.g., "ac_not_cooling_repair")',
    lowercase: true,
    trim: true
  },
  description: {
    type: String,
    required: true,
    description: 'Category description for 3-Tier matching'
  },
  scenarioSeeds: {
    type: [String],
    default: [],
    description: 'One-line scenario examples for AI Scenario Architect (5-10 seeds)'
  }
}, { _id: false });

// ─────────────────────────────────────────────────────────────────────────────
// MAIN TRIAGE CARD SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

const TriageCardSchema = new Schema({
  
  // ─── MULTI-TENANT SCOPING ───
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'Company',
    required: true,
    index: true,
    description: 'Company this card belongs to (multi-tenant isolation)'
  },

  // ─── CARD METADATA ───
  status: {
    type: String,
    enum: ['DRAFT', 'ACTIVE', 'ARCHIVED'],
    default: 'DRAFT',
    required: true,
    index: true,
    description: 'DRAFT: not used | ACTIVE: compiled into runtime config | ARCHIVED: historical reference'
  },

  trade: {
    type: String,
    required: true,
    description: 'Industry/trade this card applies to (HVAC, Plumbing, Electrical, etc.)'
  },

  serviceTypes: {
    type: [String],
    required: true,
    description: 'Service types this card handles (REPAIR, MAINTENANCE, etc.)'
  },

  // ─── PART 1: FRONTLINE-INTEL BLOCK ───
  frontlineIntelBlock: {
    type: String,
    required: true,
    description: 'Procedural text: how Frontline should think and triage this situation'
  },

  // ─── PART 2: TRIAGE MAP (STRUCTURED DECISION TREE) ───
  triageMap: {
    type: [TriageRuleSchema],
    required: true,
    validate: {
      validator: function(arr) {
        return arr.length > 0;
      },
      message: 'Triage map must contain at least one rule'
    },
    description: 'Structured rules for call classification (THE BRAIN OF CALL DISTRIBUTION)'
  },

  // ─── PART 3: RESPONSE LIBRARY ───
  responses: {
    type: [String],
    required: true,
    validate: {
      validator: function(arr) {
        return arr.length >= 5;
      },
      message: 'Response library must contain at least 5 variations'
    },
    description: '10+ rotating response lines to keep AI sounding human'
  },

  // ─── PART 4: CATEGORY SKELETON + SCENARIO SEEDS ───
  category: {
    type: CategorySchema,
    required: true,
    description: 'Category structure for 3-Tier + scenario seeds for AI Scenario Architect'
  },

  // ─── VERSION TRACKING ───
  version: {
    type: Number,
    default: 1,
    description: 'Version number (incremented on each update)'
  },

  generatedBy: {
    type: String,
    enum: ['LLM', 'MANUAL', 'IMPORT'],
    default: 'LLM',
    description: 'How this card was created'
  },

  llmModel: {
    type: String,
    description: 'LLM model used for generation (e.g., "gpt-4o-mini")'
  },

  // ─── AUDIT TRAIL ───
  createdBy: {
    type: Schema.Types.ObjectId,
    ref: 'Admin',
    description: 'Admin who created this card'
  },

  lastModifiedBy: {
    type: Schema.Types.ObjectId,
    ref: 'Admin',
    description: 'Admin who last modified this card'
  }

}, {
  timestamps: true,
  collection: 'triageCards'
});

// ─────────────────────────────────────────────────────────────────────────────
// INDEXES
// ─────────────────────────────────────────────────────────────────────────────

TriageCardSchema.index({ companyId: 1, status: 1 });
TriageCardSchema.index({ companyId: 1, 'category.slug': 1 });
TriageCardSchema.index({ companyId: 1, trade: 1 });
TriageCardSchema.index({ createdAt: -1 });

// ─────────────────────────────────────────────────────────────────────────────
// INSTANCE METHODS
// ─────────────────────────────────────────────────────────────────────────────

TriageCardSchema.methods.activate = function() {
  this.status = 'ACTIVE';
  return this.save();
};

TriageCardSchema.methods.deactivate = function() {
  this.status = 'DRAFT';
  return this.save();
};

TriageCardSchema.methods.archive = function() {
  this.status = 'ARCHIVED';
  return this.save();
};

TriageCardSchema.methods.incrementVersion = function() {
  this.version += 1;
  return this;
};

// ─────────────────────────────────────────────────────────────────────────────
// STATIC METHODS
// ─────────────────────────────────────────────────────────────────────────────

TriageCardSchema.statics.findActiveByCompany = function(companyId) {
  return this.find({ companyId, status: 'ACTIVE' }).sort({ 'category.name': 1 });
};

TriageCardSchema.statics.findByCompany = function(companyId) {
  return this.find({ companyId }).sort({ createdAt: -1 });
};

TriageCardSchema.statics.findByCategorySlug = function(companyId, categorySlug) {
  return this.findOne({ companyId, 'category.slug': categorySlug });
};

// ─────────────────────────────────────────────────────────────────────────────
// PRE-SAVE HOOKS
// ─────────────────────────────────────────────────────────────────────────────

TriageCardSchema.pre('save', function(next) {
  // Sort triageMap by priority (descending) for runtime optimization
  if (this.isModified('triageMap')) {
    this.triageMap.sort((a, b) => b.priority - a.priority);
  }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT
// ─────────────────────────────────────────────────────────────────────────────

const TriageCard = mongoose.model('TriageCard', TriageCardSchema);

module.exports = TriageCard;

