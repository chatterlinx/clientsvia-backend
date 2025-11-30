// models/TriageCard.js
// V22 Triage Card - Single source of truth for quick rules, frontline playbooks, and 3-tier drafts

const mongoose = require('mongoose');
const { Schema } = mongoose;

// ═══════════════════════════════════════════════════════════════════════════
// REUSABLE SUB-SCHEMAS
// ═══════════════════════════════════════════════════════════════════════════

const ObjectionPairSchema = new Schema(
  {
    customer: { type: String, trim: true },
    agent: { type: String, trim: true }
  },
  { _id: false }
);

const QuickRuleConfigSchema = new Schema(
  {
    keywordsMustHave: {
      type: [String],
      default: []
    },
    keywordsExclude: {
      type: [String],
      default: []
    },
    action: {
      type: String,
      enum: [
        'DIRECT_TO_3TIER',
        'EXPLAIN_AND_PUSH',
        'ESCALATE_TO_HUMAN',
        'TAKE_MESSAGE',
        'END_CALL_POLITE'
      ],
      required: true
    },
    explanation: { type: String, trim: true },
    qnaCardRef: { type: String, trim: true }
  },
  { _id: false }
);

const FrontlinePlaybookSchema = new Schema(
  {
    frontlineGoal: { type: String, trim: true },
    openingLines: {
      type: [String],
      default: []
    },
    explainAndPushLines: {
      type: [String],
      default: []
    },
    objectionHandling: {
      type: [ObjectionPairSchema],
      default: []
    }
  },
  { _id: false }
);

const ExplainAndPushPlaybookSchema = new Schema(
  {
    explanationLines: {
      type: [String],
      default: []
    },
    pushLines: {
      type: [String],
      default: []
    },
    objectionPairs: {
      type: [ObjectionPairSchema],
      default: []
    }
  },
  { _id: false }
);

const EscalateToHumanPlaybookSchema = new Schema(
  {
    reasonLabel: { type: String, trim: true },
    preTransferLines: {
      type: [String],
      default: []
    }
  },
  { _id: false }
);

const TakeMessagePlaybookSchema = new Schema(
  {
    introLines: {
      type: [String],
      default: []
    },
    fieldsToCollect: {
      type: [String],
      default: [] // e.g. ["name", "phone", "address", "issueSummary"]
    },
    closingLines: {
      type: [String],
      default: []
    }
  },
  { _id: false }
);

const EndCallPolitePlaybookSchema = new Schema(
  {
    reasonLabel: { type: String, trim: true },
    closingLines: {
      type: [String],
      default: []
    }
  },
  { _id: false }
);

const ActionPlaybooksSchema = new Schema(
  {
    explainAndPush: { type: ExplainAndPushPlaybookSchema, default: () => ({}) },
    escalateToHuman: { type: EscalateToHumanPlaybookSchema, default: () => ({}) },
    takeMessage: { type: TakeMessagePlaybookSchema, default: () => ({}) },
    endCallPolite: { type: EndCallPolitePlaybookSchema, default: () => ({}) }
  },
  { _id: false }
);

const ThreeTierPackageDraftSchema = new Schema(
  {
    categoryName: { type: String, trim: true },
    categoryDescription: { type: String, trim: true },
    scenarioName: { type: String, trim: true },
    scenarioObjective: { type: String, trim: true },
    scenarioExamples: {
      type: [String],
      default: []
    },
    suggestedStepsOutline: {
      type: [String],
      default: []
    },
    notesForAdmin: { type: String, trim: true }
  },
  { _id: false }
);

const LinkedScenarioSchema = new Schema(
  {
    scenarioId: { type: Schema.Types.ObjectId, ref: 'Scenario', default: null },
    scenarioName: { type: String, trim: true },
    scenarioKey: { type: String, trim: true } // V23: Key for referential integrity
  },
  { _id: false }
);

const MatchHistorySampleSchema = new Schema(
  {
    text: { type: String, trim: true }, // normalized user input
    matchedAt: { type: Date },
    outcome: {
      finalAction: { type: String, trim: true, default: null },
      successFlag: { type: Boolean, default: null }
    }
  },
  { _id: false }
);

const MatchHistorySchema = new Schema(
  {
    totalMatches: { type: Number, default: 0 },
    totalSuccesses: { type: Number, default: 0 },
    lastMatchedAt: { type: Date, default: null },
    lastSuccessAt: { type: Date, default: null },
    successRate: { type: Number, default: 0 }, // 0–1
    recentSamplePhrases: {
      type: [MatchHistorySampleSchema],
      default: []
    }
  },
  { _id: false }
);

// ═══════════════════════════════════════════════════════════════════════════
// MAIN TRIAGE CARD SCHEMA
// ═══════════════════════════════════════════════════════════════════════════

const TriageCardSchema = new Schema(
  {
    companyId: {
      type: Schema.Types.ObjectId,
      ref: 'Company',
      required: true,
      index: true
    },

    trade: {
      type: String,
      required: true // e.g. "HVAC", "PLUMBING"
    },

    triageLabel: {
      type: String,
      required: true,
      trim: true
    },

    displayName: {
      type: String,
      required: true,
      trim: true
    },

    description: {
      type: String,
      trim: true
    },

    intent: {
      type: String,
      trim: true
    },

    triageCategory: {
      type: String,
      trim: true
    },

    serviceType: {
      type: String,
      enum: ['REPAIR', 'MAINTENANCE', 'EMERGENCY', 'OTHER'],
      required: true
    },

    priority: {
      type: Number,
      default: 100
    },

    isActive: {
      type: Boolean,
      default: false
    },

    quickRuleConfig: {
      type: QuickRuleConfigSchema,
      required: true
    },

    frontlinePlaybook: {
      type: FrontlinePlaybookSchema,
      default: () => ({})
    },

    actionPlaybooks: {
      type: ActionPlaybooksSchema,
      default: () => ({})
    },

    threeTierPackageDraft: {
      type: ThreeTierPackageDraftSchema,
      default: () => ({})
    },

    linkedScenario: {
      type: LinkedScenarioSchema,
      default: () => ({ scenarioId: null, scenarioName: '' })
    },

    matchHistory: {
      type: MatchHistorySchema,
      default: () => ({})
    },

    // V23 AUTO-SCAN: Additional fields for auto-generated cards
    generatedSynonyms: {
      type: [String],
      default: []
    },
    
    autoGenerated: {
      type: Boolean,
      default: false
    },
    
    generatedAt: {
      type: Date,
      default: null
    },
    
    generatedBy: {
      type: String,
      default: null
    },

    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null }
  },
  {
    timestamps: true
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

TriageCardSchema.index(
  { companyId: 1, trade: 1, isActive: 1, priority: -1 },
  { name: 'company_trade_active_priority' }
);

TriageCardSchema.index(
  { companyId: 1, 'matchHistory.successRate': 1 },
  { name: 'company_success_rate' }
);

TriageCardSchema.index(
  { companyId: 1, triageLabel: 1 },
  { name: 'company_triage_label', unique: true }
);

// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Recompute successRate from totalMatches/totalSuccesses
 */
TriageCardSchema.methods.recomputeSuccessRate = function recomputeSuccessRate() {
  if (!this.matchHistory) this.matchHistory = {};
  const m = this.matchHistory;
  if (m.totalMatches && m.totalMatches > 0) {
    m.successRate = m.totalSuccesses / m.totalMatches;
  } else {
    m.successRate = 0;
  }
};

module.exports = mongoose.model('TriageCard', TriageCardSchema);
