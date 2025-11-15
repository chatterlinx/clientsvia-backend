// ============================================================================
// LEGACY STUB: AI Gateway Suggestion Model
// ============================================================================
// This is a NO-OP stub to prevent crashes in legacy code
// The AI Gateway analytics system has been removed
// Real suggestions should use ProductionLLMSuggestion model instead
// ============================================================================

const mongoose = require('mongoose');

const stubSchema = new mongoose.Schema({
  _stub: { type: Boolean, default: true },
  message: { type: String, default: 'AI Gateway Suggestion model removed - use ProductionLLMSuggestion' }
}, { timestamps: true });

// Stub methods that return empty results
stubSchema.statics.find = async function() {
  console.warn('⚠️ [STUB] AIGatewaySuggestion.find() called - model removed, returning []');
  return [];
};

stubSchema.statics.findById = async function() {
  console.warn('⚠️ [STUB] AIGatewaySuggestion.findById() called - model removed, returning null');
  return null;
};

stubSchema.statics.create = async function(data) {
  console.warn('⚠️ [STUB] AIGatewaySuggestion.create() called - model removed, no-op');
  return { _id: new mongoose.Types.ObjectId(), ...data, _stub: true };
};

const AIGatewaySuggestion = mongoose.model('AIGatewaySuggestion', stubSchema);

module.exports = AIGatewaySuggestion;

