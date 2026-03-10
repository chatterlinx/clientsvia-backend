/**
 * CallIntelligenceSettings Model
 * 
 * Stores company-specific settings for Call Intelligence system.
 * 
 * @module models/CallIntelligenceSettings
 */

const mongoose = require('mongoose');

const CallIntelligenceSettingsSchema = new mongoose.Schema({
  companyId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  gpt4Enabled: {
    type: Boolean,
    default: false
  },
  analysisMode: {
    type: String,
    enum: ['quick', 'full'],
    default: 'full'
  },
  analysisModel: {
    type: String,
    enum: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'],
    default: 'gpt-4o-mini'
  },
  autoAnalyzeEnabled: {
    type: Boolean,
    default: false
  },
  autoAnalyzeDelay: {
    type: Number,
    default: 60000
  }
}, {
  timestamps: true,
  collection: 'call_intelligence_settings'
});

CallIntelligenceSettingsSchema.statics.getSettings = async function(companyId) {
  let settings = await this.findOne({ companyId });
  
  if (!settings) {
    settings = await this.create({
      companyId,
      gpt4Enabled: false,
      analysisMode: 'full',
      autoAnalyzeEnabled: false
    });
  }
  
  return settings;
};

CallIntelligenceSettingsSchema.statics.updateSettings = async function(companyId, updates) {
  return await this.findOneAndUpdate(
    { companyId },
    { $set: updates },
    { new: true, upsert: true }
  );
};

module.exports = mongoose.model('CallIntelligenceSettings', CallIntelligenceSettingsSchema);
