// models/TriagePresetScenario.js
// V23 Global Starter Templates - Pre-built triage scenarios for each trade
// Used to "seed" new companies with starter packs
// NOT used at runtime - only in admin factory

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// Sub-schema for quick rule skeleton
const QuickRuleSkeletonSchema = new Schema(
  {
    action: {
      type: String,
      enum: ['DIRECT_TO_3TIER', 'EXPLAIN_AND_PUSH', 'ESCALATE_TO_HUMAN', 'TAKE_MESSAGE', 'END_CALL_POLITE'],
      default: 'DIRECT_TO_3TIER'
    },
    intent: { type: String, trim: true, default: '' },
    triageCategory: { type: String, trim: true, default: '' },
    serviceType: {
      type: String,
      enum: ['REPAIR', 'MAINTENANCE', 'EMERGENCY', 'OTHER'],
      default: 'REPAIR'
    },
    priority: { type: Number, default: 100 },
    keywordsMustHave: { type: [String], default: [] },
    keywordsExclude: { type: [String], default: [] },
    explanation: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

// Sub-schema for frontline template
const FrontlineTemplateSchema = new Schema(
  {
    goal: { type: String, trim: true, default: '' },
    openingLines: { type: [String], default: [] },
    explainAndPushLines: { type: [String], default: [] },
    objectionHandling: [
      {
        customer: { type: String, trim: true },
        agent: { type: String, trim: true }
      }
    ]
  },
  { _id: false }
);

// Sub-schema for 3-tier template
const ThreeTierTemplateSchema = new Schema(
  {
    categoryName: { type: String, trim: true, default: '' },
    categoryDescription: { type: String, trim: true, default: '' },
    scenarioName: { type: String, trim: true, default: '' },
    scenarioObjective: { type: String, trim: true, default: '' },
    scenarioExamples: { type: [String], default: [] },
    suggestedStepsOutline: { type: [String], default: [] },
    notesForAdmin: { type: String, trim: true, default: '' }
  },
  { _id: false }
);

const TriagePresetScenarioSchema = new Schema(
  {
    // Which trade this preset belongs to
    tradeKey: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true
      // e.g., "HVAC", "PLUMBING", "DENTAL"
    },

    // Unique key for this preset within the trade
    presetKey: {
      type: String,
      required: true,
      uppercase: true,
      trim: true
      // e.g., "HVAC_AC_NOT_COOLING", "PLUMBING_TOILET_CLOGGED"
    },

    // Human-readable display name
    displayName: {
      type: String,
      required: true,
      trim: true
      // e.g., "AC not cooling", "Toilet clogged"
    },

    // Short description for admin
    description: {
      type: String,
      trim: true,
      default: ''
    },

    // Category within the trade
    category: {
      type: String,
      trim: true,
      default: ''
      // e.g., "Cooling / No Cool", "Clogs"
    },

    // Quick rule skeleton (generic, to be cloned)
    quickRuleSkeleton: {
      type: QuickRuleSkeletonSchema,
      required: true
    },

    // Frontline template (may contain {{companyName}} tokens)
    frontlineTemplate: {
      type: FrontlineTemplateSchema,
      default: () => ({})
    },

    // 3-Tier package template
    threeTierTemplate: {
      type: ThreeTierTemplateSchema,
      default: () => ({})
    },

    // Sample caller phrases for testing
    samplePhrases: {
      type: [String],
      default: []
    },

    // Is this preset active/available?
    isActive: {
      type: Boolean,
      default: true
    },

    // Sort order within trade
    sortOrder: {
      type: Number,
      default: 100
    },

    // Metadata
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  {
    timestamps: true
  }
);

// Compound unique index
TriagePresetScenarioSchema.index({ tradeKey: 1, presetKey: 1 }, { unique: true });

// Static: Get all active presets for a trade
TriagePresetScenarioSchema.statics.getPresetsForTrade = async function (tradeKey) {
  return this.find({ tradeKey: tradeKey.toUpperCase(), isActive: true })
    .sort({ sortOrder: 1, displayName: 1 })
    .lean();
};

// Static: Get preset by key
TriagePresetScenarioSchema.statics.getByKey = async function (tradeKey, presetKey) {
  return this.findOne({
    tradeKey: tradeKey.toUpperCase(),
    presetKey: presetKey.toUpperCase()
  }).lean();
};

// Static: Clone preset into a TriageCard for a company
TriagePresetScenarioSchema.statics.cloneToTriageCard = async function (
  presetKey,
  tradeKey,
  companyId,
  options = {}
) {
  const preset = await this.getByKey(tradeKey, presetKey);
  if (!preset) {
    throw new Error(`Preset not found: ${tradeKey}/${presetKey}`);
  }

  const TriageCard = require('./TriageCard');

  const cardData = {
    companyId,
    trade: preset.tradeKey,
    triageLabel: preset.presetKey,
    displayName: preset.displayName,
    description: preset.description,
    intent: preset.quickRuleSkeleton.intent,
    triageCategory: preset.quickRuleSkeleton.triageCategory || preset.category,
    serviceType: preset.quickRuleSkeleton.serviceType,
    priority: preset.quickRuleSkeleton.priority,
    isActive: options.activate !== false,

    quickRuleConfig: {
      keywordsMustHave: preset.quickRuleSkeleton.keywordsMustHave || [],
      keywordsExclude: preset.quickRuleSkeleton.keywordsExclude || [],
      action: preset.quickRuleSkeleton.action,
      explanation: preset.quickRuleSkeleton.explanation || preset.description
    },

    frontlinePlaybook: {
      frontlineGoal: preset.frontlineTemplate?.goal || '',
      openingLines: preset.frontlineTemplate?.openingLines || [],
      explainAndPushLines: preset.frontlineTemplate?.explainAndPushLines || [],
      objectionHandling: preset.frontlineTemplate?.objectionHandling || []
    },

    threeTierPackageDraft: {
      categoryName: preset.threeTierTemplate?.categoryName || preset.category,
      categoryDescription: preset.threeTierTemplate?.categoryDescription || '',
      scenarioName: preset.threeTierTemplate?.scenarioName || preset.displayName,
      scenarioObjective: preset.threeTierTemplate?.scenarioObjective || '',
      scenarioExamples: preset.threeTierTemplate?.scenarioExamples || preset.samplePhrases || [],
      suggestedStepsOutline: preset.threeTierTemplate?.suggestedStepsOutline || [],
      notesForAdmin: preset.threeTierTemplate?.notesForAdmin || 'Cloned from preset'
    }
  };

  return TriageCard.create(cardData);
};

module.exports = mongoose.model('TriagePresetScenario', TriagePresetScenarioSchema);

