/**
 * Phase 8: Agent Config Snapshot Model
 * Stores compiled, immutable agent configurations for deterministic runtime behavior
 * Eliminates router_config_missing and ensures consistent AI Agent Logic execution
 */

const mongoose = require('mongoose');

const AgentConfigSnapshotSchema = new mongoose.Schema({
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Company', 
    index: true, 
    required: true 
  },
  version: { 
    type: Number, 
    required: true 
  }, // monotonic (e.g., Date.now())
  data: { 
    type: Object, 
    required: true 
  }, // compiled agent config
  createdAt: { 
    type: Date, 
    default: Date.now, 
    index: true 
  },
}, { 
  collection: 'agent_config_snapshots',
  timestamps: false // using custom createdAt
});

// Compound index for efficient queries (latest version per company)
AgentConfigSnapshotSchema.index({ companyId: 1, version: -1 });

// Static method to get latest snapshot for a company
AgentConfigSnapshotSchema.statics.getLatest = function(companyId) {
  return this.findOne({ companyId })
    .sort({ version: -1 })
    .lean();
};

// Static method to create new snapshot with auto-versioning
AgentConfigSnapshotSchema.statics.createSnapshot = function(companyId, data) {
  const version = Date.now();
  return this.create({ companyId, version, data });
};

module.exports = mongoose.model('AgentConfigSnapshot', AgentConfigSnapshotSchema);
