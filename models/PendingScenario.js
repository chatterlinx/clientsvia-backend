/**
 * ============================================================================
 * PENDING SCENARIO MODEL - Feb 2026
 * ============================================================================
 * 
 * PURPOSE:
 * Holds generated scenarios awaiting admin review.
 * Nothing goes live until approved - this is the human-in-the-loop queue.
 * 
 * LIFECYCLE:
 * 1. Engine generates scenario → inserted as 'pending'
 * 2. Lint validation runs → lint.passed set
 * 3. Admin reviews → 'approved' or 'rejected'
 * 4. If approved → copied to template scenarios
 * 5. Record kept for audit trail
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;
const crypto = require('crypto');

/**
 * Lint result schema - validation errors
 */
const lintResultSchema = new Schema({
    passed: {
        type: Boolean,
        default: true
    },
    errors: [{
        type: { type: String }, // phone_number, url, email, price, address, invalid_placeholder
        message: String,
        matches: [String],
        severity: {
            type: String,
            enum: ['error', 'warning'],
            default: 'error'
        }
    }],
    warnings: [String],
    placeholdersUsed: [String],
    checkedAt: Date
}, { _id: false });

/**
 * Main Pending Scenario Schema
 */
const pendingScenarioSchema = new Schema({
    // Identity
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
        default: null
    },
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true
    },
    
    // Service linkage
    serviceKey: {
        type: String,
        required: true,
        index: true
    },
    serviceType: {
        type: String,
        enum: ['work', 'symptom', 'admin'],
        default: 'work'
    },
    
    // Scenario identity (for dedupe)
    scenarioKey: {
        type: String,
        required: true
        // Generated: serviceKey + scenarioType + timestamp hash
    },
    
    // The actual scenario content
    payload: {
        scenarioName: { type: String, required: true },
        scenarioType: {
            type: String,
            enum: ['EMERGENCY', 'BOOKING', 'FAQ', 'TROUBLESHOOT', 'QUOTE', 'TRIAGE', 'ADMIN'],
            default: 'FAQ'
        },
        category: String,
        triggers: [String],
        quickReplies: [String],
        fullReplies: [String],
        generationNotes: String
    },
    
    // Dedupe fingerprint - hash of normalized content
    fingerprint: {
        type: String,
        required: true,
        index: true
    },
    
    // Optional similarity grouping
    similarityGroup: String,
    
    // Review status
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'edited'],
        default: 'pending',
        index: true
    },
    
    // Generation metadata
    generatedBy: {
        model: {
            type: String,
            default: 'gpt-4o'
        },
        jobId: {
            type: Schema.Types.ObjectId,
            ref: 'ScenarioGenerationJob'
        },
        batchIndex: Number,
        tokensUsed: Number,
        generatedAt: {
            type: Date,
            default: Date.now
        }
    },
    
    // Lint validation
    lint: lintResultSchema,
    
    // Review tracking
    reviewedBy: {
        userId: Schema.Types.ObjectId,
        name: String,
        email: String
    },
    reviewedAt: Date,
    reviewNotes: String,
    
    // If edited before approval
    editedPayload: Schema.Types.Mixed,
    editedAt: Date,
    editedBy: {
        userId: Schema.Types.ObjectId,
        name: String
    },
    
    // After approval - link to actual scenario
    approvedScenarioId: String,
    
    // Rejection reason
    rejectionReason: String
    
}, {
    timestamps: true,
    collection: 'pendingscenarios'
});

// Compound indexes
pendingScenarioSchema.index({ templateId: 1, status: 1 });
pendingScenarioSchema.index({ templateId: 1, serviceKey: 1, status: 1 });
pendingScenarioSchema.index({ fingerprint: 1, templateId: 1 }, { unique: true });

/**
 * Generate fingerprint from scenario content
 * Used for dedupe - same fingerprint = duplicate
 */
pendingScenarioSchema.statics.generateFingerprint = function(payload, serviceKey) {
    // Normalize content for comparison
    const normalized = {
        serviceKey: serviceKey.toLowerCase(),
        scenarioType: (payload.scenarioType || 'FAQ').toLowerCase(),
        triggers: (payload.triggers || [])
            .map(t => t.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim())
            .sort()
            .join('|'),
        response: (payload.quickReplies || [])
            .concat(payload.fullReplies || [])
            .map(r => r.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim())
            .sort()
            .join('|')
    };
    
    const content = JSON.stringify(normalized);
    return crypto.createHash('sha256').update(content).digest('hex').substring(0, 32);
};

/**
 * Check if fingerprint already exists (approved or pending)
 */
pendingScenarioSchema.statics.isDuplicate = async function(templateId, fingerprint) {
    const existing = await this.findOne({
        templateId,
        fingerprint,
        status: { $in: ['pending', 'approved'] }
    });
    return !!existing;
};

/**
 * Create pending scenario with dedupe check
 */
pendingScenarioSchema.statics.createPending = async function(params) {
    const { templateId, companyId, serviceKey, serviceType, payload, generatedBy } = params;
    
    // Generate fingerprint
    const fingerprint = this.generateFingerprint(payload, serviceKey);
    
    // Check for duplicate
    const isDupe = await this.isDuplicate(templateId, fingerprint);
    if (isDupe) {
        return { created: false, reason: 'duplicate', fingerprint };
    }
    
    // Generate scenario key
    const scenarioKey = `${serviceKey}-${payload.scenarioType || 'FAQ'}-${Date.now().toString(36)}`;
    
    // Create pending scenario
    const pending = new this({
        templateId,
        companyId,
        serviceKey,
        serviceType,
        scenarioKey,
        payload,
        fingerprint,
        generatedBy,
        lint: {
            passed: true,
            errors: [],
            warnings: [],
            placeholdersUsed: [],
            checkedAt: new Date()
        }
    });
    
    await pending.save();
    return { created: true, pending, fingerprint };
};

/**
 * Get pending count by service
 */
pendingScenarioSchema.statics.getPendingCountsByService = async function(templateId) {
    const results = await this.aggregate([
        { $match: { templateId: new mongoose.Types.ObjectId(templateId), status: 'pending' } },
        { $group: { _id: '$serviceKey', count: { $sum: 1 }, lintFailed: { $sum: { $cond: ['$lint.passed', 0, 1] } } } }
    ]);
    
    const counts = {};
    for (const r of results) {
        counts[r._id] = { pending: r.count, lintFailed: r.lintFailed };
    }
    return counts;
};

/**
 * Approve a pending scenario
 */
pendingScenarioSchema.methods.approve = async function(reviewedBy, approvedScenarioId) {
    this.status = 'approved';
    this.reviewedBy = reviewedBy;
    this.reviewedAt = new Date();
    this.approvedScenarioId = approvedScenarioId;
    await this.save();
};

/**
 * Reject a pending scenario
 */
pendingScenarioSchema.methods.reject = async function(reviewedBy, reason) {
    this.status = 'rejected';
    this.reviewedBy = reviewedBy;
    this.reviewedAt = new Date();
    this.rejectionReason = reason;
    await this.save();
};

/**
 * Update lint results
 */
pendingScenarioSchema.methods.updateLint = async function(lintResult) {
    this.lint = {
        ...lintResult,
        checkedAt: new Date()
    };
    await this.save();
};

module.exports = mongoose.model('PendingScenario', pendingScenarioSchema);
