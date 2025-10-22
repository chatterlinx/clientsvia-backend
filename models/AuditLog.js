/**
 * ============================================================================
 * AUDIT LOG MODEL
 * ============================================================================
 * 
 * PURPOSE: Track all configuration changes for compliance and debugging
 * 
 * CAPTURES:
 * - Who made the change (userId)
 * - What changed (before/after/diff)
 * - When it happened (timestamp)
 * - Where it came from (IP, user-agent)
 * - Why it happened (preview token, idempotency key)
 * - Impact (scenarios affected, variables changed)
 * 
 * RETENTION: Permanent (no TTL)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger.js');


const auditLogSchema = new mongoose.Schema({
    // Unique audit ID (for reference)
    auditId: {
        type: String,
        required: true,
        unique: true,
        index: true
    },
    
    // Company ID
    companyId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },
    
    // User who made the change
    userId: {
        type: String,
        required: true,
        index: true
    },
    
    // Action type
    action: {
        type: String,
        required: true,
        enum: [
            'update_variables',
            'add_filler_words',
            'remove_filler_words',
            'reset_filler_words',
            'go_live',
            'sync_template',
            'clone_template'
        ],
        index: true
    },
    
    // Changes made
    changes: {
        // Before state (snapshot)
        before: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        
        // After state (snapshot)
        after: {
            type: mongoose.Schema.Types.Mixed,
            default: {}
        },
        
        // Diff (what actually changed)
        diff: {
            added: { type: [String], default: [] },
            removed: { type: [String], default: [] },
            modified: { type: [String], default: [] }
        }
    },
    
    // Impact analysis
    impact: {
        // How many scenarios are affected by this change
        scenariosAffected: { type: Number, default: 0 },
        
        // Which variables changed
        variablesChanged: { type: [String], default: [] },
        
        // Severity
        severity: {
            type: String,
            enum: ['low', 'medium', 'high', 'critical'],
            default: 'medium'
        },
        
        // Description of impact
        description: { type: String, default: '' }
    },
    
    // Request metadata
    metadata: {
        // Preview token (if used)
        previewToken: { type: String, default: null },
        
        // Idempotency key (if used)
        idempotencyKey: { type: String, default: null },
        
        // IP address
        ip: { type: String, required: true },
        
        // User-Agent
        userAgent: { type: String, required: true },
        
        // Request ID (for correlation)
        requestId: { type: String, default: null },
        
        // Additional context
        context: { type: mongoose.Schema.Types.Mixed, default: {} }
    },
    
    // Timestamps
    timestamp: {
        type: Date,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true
});

// Compound indexes for common queries
auditLogSchema.index({ companyId: 1, timestamp: -1 });
auditLogSchema.index({ userId: 1, timestamp: -1 });
auditLogSchema.index({ action: 1, timestamp: -1 });

// Static method to create audit log with auto-generated ID
auditLogSchema.statics.createLog = async function(data) {
    const { ulid } = require('ulid');
    
    const auditLog = new this({
        auditId: ulid(),
        ...data,
        timestamp: new Date()
    });
    
    await auditLog.save();
    
    logger.info(`[AUDIT LOG] ✅ Created: ${auditLog.auditId} (${data.action})`);
    
    return auditLog;
};

// Static method to get recent logs for a company
auditLogSchema.statics.getRecentForCompany = async function(companyId, limit = 20) {
    return this.find({ companyId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();
};

// Static method to get logs by user
auditLogSchema.statics.getByUser = async function(userId, limit = 50) {
    return this.find({ userId })
        .sort({ timestamp: -1 })
        .limit(limit)
        .lean();
};

// Instance method to generate human-readable summary
auditLogSchema.methods.getSummary = function() {
    const actionMap = {
        update_variables: 'Updated variables',
        add_filler_words: 'Added filler words',
        remove_filler_words: 'Removed filler words',
        reset_filler_words: 'Reset filler words',
        go_live: 'Went live',
        sync_template: 'Synced template',
        clone_template: 'Cloned template'
    };
    
    return {
        auditId: this.auditId,
        action: actionMap[this.action] || this.action,
        userId: this.userId,
        timestamp: this.timestamp,
        impact: this.impact.description || `${this.impact.scenariosAffected} scenarios affected`,
        severity: this.impact.severity
    };
};

const AuditLog = mongoose.model('AuditLog', auditLogSchema);

module.exports = AuditLog;

