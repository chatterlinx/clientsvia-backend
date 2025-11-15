// ============================================================================
// LEGACY STUB: AI Gateway CostLog Model
// ============================================================================
// This is a NO-OP stub to prevent crashes in legacy code
// The AI Gateway analytics system has been removed
// Cost tracking should be implemented in a new model if needed
// ============================================================================

const mongoose = require('mongoose');

const stubSchema = new mongoose.Schema({
  _stub: { type: Boolean, default: true },
  message: { type: String, default: 'AI Gateway CostLog model removed' }
}, { timestamps: true });

// Stub methods that return empty results
stubSchema.statics.aggregate = async function() {
  console.warn('⚠️ [STUB] CostLog.aggregate() called - model removed, returning []');
  return [];
};

stubSchema.statics.create = async function(data) {
  console.warn('⚠️ [STUB] CostLog.create() called - model removed, no-op');
  return { _id: new mongoose.Types.ObjectId(), ...data, _stub: true };
};

stubSchema.statics.getWarmupAnalytics = async function(companyId, days) {
  console.warn('⚠️ [STUB] CostLog.getWarmupAnalytics() called - model removed, returning zero stats');
  return {
    success: true,
    totalCalls: 0,
    totalCost: 0,
    avgCostPerCall: 0,
    costBreakdown: {},
    dailyStats: []
  };
};

const CostLog = mongoose.model('CostLog', stubSchema);

module.exports = CostLog;

