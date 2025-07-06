const mongoose = require('mongoose');

const agentPromptSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'Company', required: false },
  intent: { type: String, required: true },
  variants: { type: [String], required: true },
  updatedAt: { type: Date, default: Date.now },
});

agentPromptSchema.index({ companyId: 1, intent: 1 }, { unique: true });

module.exports = mongoose.model('AgentPrompt', agentPromptSchema);
