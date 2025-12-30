/**
 * ============================================================================
 * CONFIG AUDIT LOG (Immutable, Config Governance)
 * ============================================================================
 *
 * Purpose:
 * - Append-only, immutable audit log for company configuration changes.
 * - Stores before/after snapshots + effectiveConfigVersion linkage.
 *
 * Why separate from general AuditLog?
 * - Config governance needs stronger invariants, dedicated indexing, and
 *   explicit before/after payloads without mixing with call-center access logs.
 */

const mongoose = require('mongoose');

const ConfigAuditLogSchema = new mongoose.Schema({
  companyId: { type: mongoose.Schema.Types.ObjectId, ref: 'v2Company', index: true, required: true },

  // Who
  actor: {
    userId: { type: String, required: true },
    email: { type: String },
    role: { type: String },
    effectiveRole: { type: String },
    breakGlass: { type: Boolean, default: false }
  },

  // Request context
  request: {
    requestId: { type: String, index: true },
    method: { type: String },
    path: { type: String },
    ip: { type: String },
    userAgent: { type: String }
  },

  // What changed
  action: {
    type: String,
    required: true,
    // Examples: frontDeskBehavior.patch, templateReferences.update, placeholders.update
    maxLength: 120,
    index: true
  },

  // Deterministic truth anchors
  schemaVersion: { type: String, default: 'CONFIG_AUDIT_V1' },
  effectiveConfigVersionBefore: { type: String, default: null, index: true },
  effectiveConfigVersionAfter: { type: String, default: null, index: true },

  // Diff hints (non-authoritative; used for quick UI)
  diff: {
    updatedPaths: { type: [String], default: [] },
    summary: { type: String, default: null, maxLength: 500 }
  },

  // Snapshots (kept lean; can be pruned later if needed)
  before: { type: mongoose.Schema.Types.Mixed, default: null },
  after: { type: mongoose.Schema.Types.Mixed, default: null },

  createdAt: { type: Date, default: Date.now, index: true }
}, { minimize: false });

// Enforce immutability: no updates/deletes allowed.
ConfigAuditLogSchema.pre(['updateOne', 'updateMany', 'findOneAndUpdate'], function(next) {
  next(new Error('ConfigAuditLog is immutable (updates not allowed)'));
});
ConfigAuditLogSchema.pre('deleteOne', function(next) {
  next(new Error('ConfigAuditLog is immutable (deletes not allowed)'));
});

module.exports = mongoose.model('ConfigAuditLog', ConfigAuditLogSchema);


