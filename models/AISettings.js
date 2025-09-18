const mongoose = require('mongoose');

const AISettingsSchema = new mongoose.Schema({
  companyID: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company',
    required: true,
    index: true 
  },
  // 🚨 REMOVED: Hardcoded priorities and thresholds violate multi-tenant principles
  // All configuration must come from company-specific aiAgentLogic UI settings
  memory: {
    mode: { type: String, default: "conversational", enum: ["none", "conversational", "persistent"] },
    retentionMinutes: { type: Number, default: 30, min: 5, max: 1440 }
  },
  escalation: {
    onNoMatch: { type: Boolean, default: true },
    strategy: { type: String, default: "ask-confirm", enum: ["immediate", "ask-confirm", "queue"] }
  },
  rePromptAfterTurns: { type: Number, default: 3, min: 1, max: 10 },
  maxPromptsPerCall: { type: Number, default: 2, min: 1, max: 5 },
  // 🚨 REMOVED: Hardcoded LLM model configurations violate no-LLM business rule
  tradeCategories: { 
    type: [String], 
    default: ["HVAC Residential", "Plumbing Residential"] 
  },
  version: { type: Number, default: 1 },
  lastUpdated: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true }
}, {
  timestamps: true,
  collection: 'ai_settings'
});

// Compound index for performance
AISettingsSchema.index({ companyID: 1, isActive: 1 });

// Ensure only one active config per company
AISettingsSchema.index({ companyID: 1, isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

module.exports = mongoose.model('AISettings', AISettingsSchema);
