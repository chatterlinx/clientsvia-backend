/**
 * ============================================================================
 * DATA CENTER AUDIT LOG MODEL
 * ============================================================================
 * Tracks all admin operations performed in the Data Center
 * Provides full audit trail for compliance and debugging
 * ============================================================================
 */

const mongoose = require('mongoose');

const auditLogSchema = new mongoose.Schema({
    // Action details
    action: {
        type: String,
        required: true,
        enum: [
            'SOFT_DELETE',
            'RESTORE',
            'HARD_PURGE',
            'PARTIAL_CLEANUP',
            'EXPORT_DATA',
            'VIEW_COMPANY',
            'SEARCH',
            'DUPLICATE_MERGE'
        ]
    },
    
    // Target
    targetType: {
        type: String,
        required: true,
        enum: ['COMPANY', 'COMPANIES', 'DATA']
    },
    targetId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        default: null
    },
    targetName: {
        type: String,
        default: null
    },
    
    // User who performed action
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'v2User',
        required: true
    },
    userEmail: {
        type: String,
        required: true
    },
    
    // Context
    metadata: {
        type: mongoose.Schema.Types.Mixed,
        default: {}
    },
    
    // Request details
    ipAddress: {
        type: String,
        default: null
    },
    userAgent: {
        type: String,
        default: null
    },
    
    // Result
    success: {
        type: Boolean,
        default: true
    },
    errorMessage: {
        type: String,
        default: null
    },
    
    // Impact metrics (for purge operations)
    impact: {
        documentsDeleted: { type: Number, default: 0 },
        collectionsAffected: { type: [String], default: [] },
        estimatedBytes: { type: Number, default: 0 }
    }
}, {
    timestamps: true
});

// Indexes for fast queries
auditLogSchema.index({ action: 1, createdAt: -1 });
auditLogSchema.index({ targetId: 1, createdAt: -1 });
auditLogSchema.index({ userId: 1, createdAt: -1 });
auditLogSchema.index({ createdAt: -1 });

const DataCenterAuditLog = mongoose.model('DataCenterAuditLog', auditLogSchema);

module.exports = DataCenterAuditLog;

