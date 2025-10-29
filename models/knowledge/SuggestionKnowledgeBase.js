// ============================================================================
// SUGGESTION KNOWLEDGE BASE MODEL
// ============================================================================
// Purpose: Stores AI-generated suggestions for template improvements
// Used by: Production AI dashboard, LLMSuggestionAnalyzer
// Source: Real production call analysis via GPT-4
// ============================================================================

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ────────────────────────────────────────────────────────────────────────────
// SCHEMA DEFINITION
// ────────────────────────────────────────────────────────────────────────────

const SuggestionKnowledgeBaseSchema = new Schema({
  // ──────────────────────────────────────────────────────────────────────────
  // CORE IDENTIFIERS & REFERENCES
  // ──────────────────────────────────────────────────────────────────────────
  companyId: {
    type: Schema.Types.ObjectId,
    ref: 'v2Company',
    required: true,
    index: true,
    description: 'Company that triggered this suggestion (from call)'
  },

  templateId: {
    type: Schema.Types.ObjectId,
    ref: 'GlobalInstantResponseTemplate',
    required: true,
    index: true,
    description: 'Template to be improved'
  },

  categoryId: {
    type: Schema.Types.ObjectId,
    ref: 'v2TradeCategory',
    required: false,
    description: 'Category to be improved (if applicable)'
  },

  scenarioId: {
    type: Schema.Types.ObjectId,
    ref: 'v2Template',
    required: false,
    description: 'Scenario to be improved (if applicable)'
  },

  callLogId: {
    type: Schema.Types.ObjectId,
    ref: 'ProductionAICallLog',
    required: true,
    index: true,
    description: 'Source call that triggered this suggestion'
  },

  // ──────────────────────────────────────────────────────────────────────────
  // SUGGESTION TYPE & PRIORITY
  // ──────────────────────────────────────────────────────────────────────────
  type: {
    type: String,
    enum: ['filler-words', 'synonym', 'keywords', 'negative-keywords', 'missing-scenario'],
    required: true,
    index: true,
    description: 'Type of improvement suggested'
  },

  priority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    required: true,
    default: 'medium',
    index: true,
    description: 'Priority based on impact (high = 80%+ confidence, medium = 60-79%, low = <60%)'
  },

  confidence: {
    type: Number,
    min: 0,
    max: 1,
    required: true,
    description: 'LLM confidence in this suggestion (0.0 - 1.0)'
  },

  // ──────────────────────────────────────────────────────────────────────────
  // SUGGESTION DETAILS (Varies by type)
  // ──────────────────────────────────────────────────────────────────────────
  improvements: {
    // For type: 'filler-words'
    fillerWords: {
      type: [String],
      description: 'Filler words to add to template (e.g., ["um", "like", "you know"])'
    },

    // For type: 'synonym'
    synonymMapping: {
      colloquial: { type: String, description: 'Colloquial term (e.g., "thingy on wall")' },
      technical: { type: String, description: 'Technical term (e.g., "thermostat")' },
      additionalMappings: [{
        colloquial: String,
        technical: String,
        occurrences: Number
      }],
      description: 'Synonym mapping to add to category'
    },

    // For type: 'keywords'
    keywords: {
      scenarioId: { type: Schema.Types.ObjectId, ref: 'v2Template' },
      scenarioName: { type: String },
      keywordsToAdd: [String],
      currentKeywords: [String],
      description: 'Keywords to add to existing scenario'
    },

    // For type: 'negative-keywords'
    negativeKeywords: {
      scenarioId: { type: Schema.Types.ObjectId, ref: 'v2Template' },
      scenarioName: { type: String },
      negativeKeywordsToAdd: [String],
      currentNegativeKeywords: [String],
      description: 'Negative keywords to prevent false positives'
    },

    // For type: 'missing-scenario'
    missingScenario: {
      suggestedName: { type: String, description: 'Suggested scenario name' },
      suggestedCategory: { type: String, description: 'Suggested category name' },
      suggestedKeywords: [String],
      suggestedNegativeKeywords: [String],
      suggestedResponse: { type: String, description: 'Suggested response template' },
      suggestedActionHook: { type: String, description: 'Suggested action hook (if any)' },
      suggestedBehavior: { type: String, description: 'Suggested behavior tone' },
      description: 'Complete new scenario definition'
    }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // LLM ANALYSIS DATA
  // ──────────────────────────────────────────────────────────────────────────
  llmReasoning: {
    type: String,
    required: true,
    description: 'Full GPT-4 explanation of why this improvement is needed'
  },

  llmModel: {
    type: String,
    required: true,
    default: 'gpt-4-turbo',
    description: 'LLM model used for analysis'
  },

  llmTokens: {
    type: Number,
    required: false,
    description: 'Tokens used for this analysis'
  },

  llmCost: {
    type: Number,
    required: false,
    description: 'Cost of this analysis in dollars'
  },

  // ──────────────────────────────────────────────────────────────────────────
  // IMPACT ANALYSIS & ROI
  // ──────────────────────────────────────────────────────────────────────────
  impact: {
    // Similar calls detected
    similarCallsThisMonth: { type: Number, default: 0 },
    similarCallsLastMonth: { type: Number, default: 0 },
    projectedNextMonth: { type: Number, default: 0 },

    // Cost savings
    estimatedMonthlySavings: { type: Number, default: 0, description: 'Dollars saved per month' },
    estimatedAnnualSavings: { type: Number, default: 0, description: 'Dollars saved per year' },

    // Performance gains
    performanceGain: { type: Number, default: 0, description: 'Milliseconds faster' },

    // Current vs projected tier usage (percentages)
    currentTierUsage: {
      tier1Percent: { type: Number, default: 0 },
      tier2Percent: { type: Number, default: 0 },
      tier3Percent: { type: Number, default: 0 }
    },

    projectedTierUsage: {
      tier1Percent: { type: Number, default: 0 },
      tier2Percent: { type: Number, default: 0 },
      tier3Percent: { type: Number, default: 0 }
    },

    // Business impact
    description: { type: String, description: 'Human-readable impact summary' }
  },

  // ──────────────────────────────────────────────────────────────────────────
  // RELATED SUGGESTIONS
  // ──────────────────────────────────────────────────────────────────────────
  relatedSuggestions: [{
    type: Schema.Types.ObjectId,
    ref: 'SuggestionKnowledgeBase',
    description: 'Other suggestions with similar patterns'
  }],

  // ──────────────────────────────────────────────────────────────────────────
  // STATUS & TRACKING
  // ──────────────────────────────────────────────────────────────────────────
  status: {
    type: String,
    enum: ['pending', 'applied', 'ignored', 'saved'],
    default: 'pending',
    required: true,
    index: true,
    description: 'Current status of this suggestion'
  },

  appliedAt: {
    type: Date,
    required: false,
    description: 'When this suggestion was applied'
  },

  appliedBy: {
    type: Schema.Types.ObjectId,
    ref: 'v2User',
    required: false,
    description: 'Admin who applied this suggestion'
  },

  ignoredAt: {
    type: Date,
    required: false,
    description: 'When this suggestion was ignored'
  },

  ignoredBy: {
    type: Schema.Types.ObjectId,
    ref: 'v2User',
    required: false,
    description: 'Admin who ignored this suggestion'
  },

  // ──────────────────────────────────────────────────────────────────────────
  // TIMESTAMPS
  // ──────────────────────────────────────────────────────────────────────────
  createdAt: {
    type: Date,
    default: Date.now,
    index: true
  },

  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true,
  collection: 'suggestionKnowledgeBase'
});

// ────────────────────────────────────────────────────────────────────────────
// INDEXES FOR PERFORMANCE
// ────────────────────────────────────────────────────────────────────────────

// Compound index for filtering by template and status
SuggestionKnowledgeBaseSchema.index({ templateId: 1, status: 1, priority: -1, createdAt: -1 });

// Compound index for filtering by company
SuggestionKnowledgeBaseSchema.index({ companyId: 1, status: 1 });

// Index for finding pending high-priority suggestions (for notifications)
SuggestionKnowledgeBaseSchema.index({ priority: 1, status: 1 });

// ────────────────────────────────────────────────────────────────────────────
// INSTANCE METHODS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Mark this suggestion as applied
 * @param {ObjectId} userId - Admin who applied it
 * @returns {Promise}
 */
SuggestionKnowledgeBaseSchema.methods.markApplied = async function(userId) {
  this.status = 'applied';
  this.appliedAt = new Date();
  this.appliedBy = userId;
  return this.save();
};

/**
 * Mark this suggestion as ignored
 * @param {ObjectId} userId - Admin who ignored it
 * @returns {Promise}
 */
SuggestionKnowledgeBaseSchema.methods.markIgnored = async function(userId) {
  this.status = 'ignored';
  this.ignoredAt = new Date();
  this.ignoredBy = userId;
  return this.save();
};

/**
 * Get brief description for UI display
 * @returns {String}
 */
SuggestionKnowledgeBaseSchema.methods.getBriefDescription = function() {
  switch (this.type) {
    case 'filler-words':
      return `Add ${this.improvements.fillerWords?.length || 0} filler words to improve matching`;
    
    case 'synonym':
      const syn = this.improvements.synonymMapping;
      return `Add synonym: "${syn?.colloquial}" → "${syn?.technical}"`;
    
    case 'keywords':
      const kw = this.improvements.keywords;
      return `Add ${kw?.keywordsToAdd?.length || 0} keywords to "${kw?.scenarioName}"`;
    
    case 'negative-keywords':
      const neg = this.improvements.negativeKeywords;
      return `Add ${neg?.negativeKeywordsToAdd?.length || 0} negative keywords to "${neg?.scenarioName}"`;
    
    case 'missing-scenario':
      const missing = this.improvements.missingScenario;
      return `Create new scenario: "${missing?.suggestedName}"`;
    
    default:
      return 'Unknown suggestion type';
  }
};

/**
 * Get formatted impact summary
 * @returns {String}
 */
SuggestionKnowledgeBaseSchema.methods.getImpactSummary = function() {
  const { impact } = this;
  
  if (this.type === 'synonym' && impact.estimatedMonthlySavings > 0) {
    return `Impact: ${impact.similarCallsThisMonth} similar calls/month | Saves $${impact.estimatedMonthlySavings.toFixed(2)}/mo`;
  }
  
  if (this.type === 'missing-scenario' && impact.similarCallsThisMonth > 0) {
    return `Impact: ${impact.similarCallsThisMonth} unmatched calls this month`;
  }
  
  if (this.type === 'filler-words' && impact.similarCallsThisMonth > 0) {
    return `Impact: Appears in ${Math.round((impact.similarCallsThisMonth / 100) * 100)}% of calls`;
  }
  
  return impact.description || 'Impact data unavailable';
};

// ────────────────────────────────────────────────────────────────────────────
// STATIC METHODS
// ────────────────────────────────────────────────────────────────────────────

/**
 * Get suggestion statistics for a template
 * @param {String} templateId - Template ID
 * @returns {Promise<Object>} { pending, applied, ignored }
 */
SuggestionKnowledgeBaseSchema.statics.getStats = async function(templateId = null) {
  const match = templateId ? { templateId: new mongoose.Types.ObjectId(templateId) } : {};

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 }
      }
    }
  ];

  const results = await this.aggregate(pipeline);

  const stats = {
    pending: 0,
    applied: 0,
    ignored: 0,
    saved: 0
  };

  results.forEach(result => {
    stats[result._id] = result.count;
  });

  return stats;
};

/**
 * Find related suggestions (same template, similar patterns)
 * @param {String} suggestionId - Current suggestion ID
 * @param {Number} limit - Max results
 * @returns {Promise<Array>}
 */
SuggestionKnowledgeBaseSchema.statics.findRelated = async function(suggestionId, limit = 3) {
  const suggestion = await this.findById(suggestionId);
  if (!suggestion) return [];

  return this.find({
    _id: { $ne: suggestionId },
    templateId: suggestion.templateId,
    type: suggestion.type,
    status: 'pending'
  })
    .sort({ priority: -1, createdAt: -1 })
    .limit(limit)
    .exec();
};

/**
 * Apply filler words suggestion to template
 * @param {String} suggestionId - Suggestion ID
 * @param {ObjectId} userId - Admin who applied it
 * @returns {Promise<Object>} { success, updated }
 */
SuggestionKnowledgeBaseSchema.statics.applyFillerWordsSuggestion = async function(suggestionId, userId) {
  const suggestion = await this.findById(suggestionId);
  if (!suggestion) throw new Error('Suggestion not found');
  if (suggestion.status !== 'pending') throw new Error('Suggestion already processed');
  if (suggestion.type !== 'filler-words') throw new Error('Invalid suggestion type');

  const GlobalInstantResponseTemplate = mongoose.model('GlobalInstantResponseTemplate');
  const template = await GlobalInstantResponseTemplate.findById(suggestion.templateId);
  if (!template) throw new Error('Template not found');

  // Merge filler words (avoid duplicates)
  const existingFillers = template.fillerWords || [];
  const newFillers = suggestion.improvements.fillerWords || [];
  const merged = [...new Set([...existingFillers, ...newFillers])];

  template.fillerWords = merged;
  await template.save();

  // Mark suggestion as applied
  await suggestion.markApplied(userId);

  return { success: true, updated: { fillerWords: merged } };
};

/**
 * Apply synonym suggestion to category
 * @param {String} suggestionId - Suggestion ID
 * @param {ObjectId} userId - Admin who applied it
 * @returns {Promise<Object>} { success, updated }
 */
SuggestionKnowledgeBaseSchema.statics.applySynonymSuggestion = async function(suggestionId, userId) {
  const suggestion = await this.findById(suggestionId);
  if (!suggestion) throw new Error('Suggestion not found');
  if (suggestion.status !== 'pending') throw new Error('Suggestion already processed');
  if (suggestion.type !== 'synonym') throw new Error('Invalid suggestion type');

  const v2TradeCategory = mongoose.model('v2TradeCategory');
  const category = await v2TradeCategory.findById(suggestion.categoryId);
  if (!category) throw new Error('Category not found');

  // Add synonym mapping
  const mapping = suggestion.improvements.synonymMapping;
  if (!category.synonymMappings) category.synonymMappings = {};
  
  if (!category.synonymMappings[mapping.technical]) {
    category.synonymMappings[mapping.technical] = [];
  }

  // Add colloquial term if not already present
  if (!category.synonymMappings[mapping.technical].includes(mapping.colloquial)) {
    category.synonymMappings[mapping.technical].push(mapping.colloquial);
  }

  // Mark as modified for Mongoose to detect change
  category.markModified('synonymMappings');
  await category.save();

  // Mark suggestion as applied
  await suggestion.markApplied(userId);

  return { success: true, updated: { synonymMappings: category.synonymMappings } };
};

/**
 * Apply keywords suggestion to scenario
 * @param {String} suggestionId - Suggestion ID
 * @param {ObjectId} userId - Admin who applied it
 * @returns {Promise<Object>} { success, updated }
 */
SuggestionKnowledgeBaseSchema.statics.applyKeywordsSuggestion = async function(suggestionId, userId) {
  const suggestion = await this.findById(suggestionId);
  if (!suggestion) throw new Error('Suggestion not found');
  if (suggestion.status !== 'pending') throw new Error('Suggestion already processed');
  if (suggestion.type !== 'keywords') throw new Error('Invalid suggestion type');

  const v2Template = mongoose.model('v2Template');
  const scenario = await v2Template.findById(suggestion.improvements.keywords.scenarioId);
  if (!scenario) throw new Error('Scenario not found');

  // Merge keywords (avoid duplicates)
  const existingKeywords = scenario.keywords || [];
  const newKeywords = suggestion.improvements.keywords.keywordsToAdd || [];
  const merged = [...new Set([...existingKeywords, ...newKeywords])];

  scenario.keywords = merged;
  await scenario.save();

  // Mark suggestion as applied
  await suggestion.markApplied(userId);

  return { success: true, updated: { keywords: merged } };
};

/**
 * Apply negative keywords suggestion to scenario
 * @param {String} suggestionId - Suggestion ID
 * @param {ObjectId} userId - Admin who applied it
 * @returns {Promise<Object>} { success, updated }
 */
SuggestionKnowledgeBaseSchema.statics.applyNegativeKeywordsSuggestion = async function(suggestionId, userId) {
  const suggestion = await this.findById(suggestionId);
  if (!suggestion) throw new Error('Suggestion not found');
  if (suggestion.status !== 'pending') throw new Error('Suggestion already processed');
  if (suggestion.type !== 'negative-keywords') throw new Error('Invalid suggestion type');

  const v2Template = mongoose.model('v2Template');
  const scenario = await v2Template.findById(suggestion.improvements.negativeKeywords.scenarioId);
  if (!scenario) throw new Error('Scenario not found');

  // Merge negative keywords (avoid duplicates)
  const existingNegatives = scenario.negativeKeywords || [];
  const newNegatives = suggestion.improvements.negativeKeywords.negativeKeywordsToAdd || [];
  const merged = [...new Set([...existingNegatives, ...newNegatives])];

  scenario.negativeKeywords = merged;
  await scenario.save();

  // Mark suggestion as applied
  await suggestion.markApplied(userId);

  return { success: true, updated: { negativeKeywords: merged } };
};

/**
 * Apply missing scenario suggestion (create new scenario)
 * @param {String} suggestionId - Suggestion ID
 * @param {ObjectId} userId - Admin who applied it
 * @returns {Promise<Object>} { success, scenarioId }
 */
SuggestionKnowledgeBaseSchema.statics.applyMissingScenarioSuggestion = async function(suggestionId, userId) {
  const suggestion = await this.findById(suggestionId);
  if (!suggestion) throw new Error('Suggestion not found');
  if (suggestion.status !== 'pending') throw new Error('Suggestion already processed');
  if (suggestion.type !== 'missing-scenario') throw new Error('Invalid suggestion type');

  const missing = suggestion.improvements.missingScenario;
  const v2Template = mongoose.model('v2Template');
  const v2TradeCategory = mongoose.model('v2TradeCategory');

  // Find or create category
  let category = await v2TradeCategory.findOne({
    name: missing.suggestedCategory,
    templateId: suggestion.templateId
  });

  if (!category) {
    category = await v2TradeCategory.create({
      name: missing.suggestedCategory,
      templateId: suggestion.templateId,
      description: `Auto-generated from LLM suggestion`,
      isActive: true
    });
  }

  // Create new scenario
  const newScenario = await v2Template.create({
    name: missing.suggestedName,
    category: category._id,
    keywords: missing.suggestedKeywords || [],
    negativeKeywords: missing.suggestedNegativeKeywords || [],
    response: missing.suggestedResponse,
    actionHook: missing.suggestedActionHook,
    behavior: missing.suggestedBehavior,
    priority: 5,
    isActive: true,
    createdFrom: 'llm-suggestion'
  });

  // Mark suggestion as applied
  await suggestion.markApplied(userId);

  return { success: true, scenarioId: newScenario._id, categoryId: category._id };
};

// ────────────────────────────────────────────────────────────────────────────
// PRE-SAVE HOOKS
// ────────────────────────────────────────────────────────────────────────────

SuggestionKnowledgeBaseSchema.pre('save', function(next) {
  this.updatedAt = new Date();

  // Auto-set priority based on confidence if not set
  if (!this.priority && this.confidence) {
    if (this.confidence >= 0.8) this.priority = 'high';
    else if (this.confidence >= 0.6) this.priority = 'medium';
    else this.priority = 'low';
  }

  // Calculate annual savings from monthly
  if (this.impact && this.impact.estimatedMonthlySavings) {
    this.impact.estimatedAnnualSavings = this.impact.estimatedMonthlySavings * 12;
  }

  next();
});

// ────────────────────────────────────────────────────────────────────────────
// MODEL EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = mongoose.model('SuggestionKnowledgeBase', SuggestionKnowledgeBaseSchema);

