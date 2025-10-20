// ============================================================================
// BLOCKED CALL LOG MODEL
// ============================================================================
// 📋 PURPOSE: Track blocked/spam calls for security and analytics
// 🎯 FEATURES:
//    - Log all blocked calls with reason
//    - Track spam patterns
//    - Company-specific blocking
//    - Integration with GlobalSpamDatabase
// ============================================================================

const mongoose = require('mongoose');
const { ObjectId } = mongoose.Schema.Types;

const blockedCallLogSchema = new mongoose.Schema({
    // ────────────────────────────────────────────────────────────────────────
    // CALLER INFORMATION
    // ────────────────────────────────────────────────────────────────────────
    callerPhone: {
        type: String,
        required: true,
        index: true
    },

    callerName: {
        type: String,
        default: null
    },

    callerCountry: {
        type: String,
        default: null
    },

    // ────────────────────────────────────────────────────────────────────────
    // TARGETED COMPANY
    // ────────────────────────────────────────────────────────────────────────
    companyId: {
        type: ObjectId,
        ref: 'Company',
        required: true,
        index: true
    },

    companyPhone: {
        type: String,
        required: true
    },

    // ────────────────────────────────────────────────────────────────────────
    // BLOCKING DETAILS
    // ────────────────────────────────────────────────────────────────────────
    blockReason: {
        type: String,
        enum: [
            'known_spammer',        // In GlobalSpamDatabase
            'company_blacklist',    // Company blocked this number
            'high_frequency',       // Too many calls in short time
            'robo_pattern',         // Detected robocall pattern
            'invalid_number',       // Invalid phone format
            'suspicious_behavior',  // AI detected suspicious behavior
            'manual_block'          // Admin manually blocked
        ],
        required: true,
        index: true
    },

    blockReasonDetails: {
        type: String,
        default: null
    },

    // ────────────────────────────────────────────────────────────────────────
    // SPAM DETECTION METADATA
    // ────────────────────────────────────────────────────────────────────────
    spamScore: {
        type: Number,
        min: 0,
        max: 100,
        default: 0
    },

    detectionMethod: {
        type: String,
        enum: ['database', 'pattern_analysis', 'frequency_check', 'ai_detection', 'manual'],
        default: 'pattern_analysis'
    },

    // ────────────────────────────────────────────────────────────────────────
    // CALL ATTEMPT DETAILS
    // ────────────────────────────────────────────────────────────────────────
    twilioCallSid: {
        type: String,
        default: null
    },

    attemptTime: {
        type: Date,
        default: Date.now,
        index: true
    },

    // ────────────────────────────────────────────────────────────────────────
    // FREQUENCY TRACKING
    // ────────────────────────────────────────────────────────────────────────
    previousAttempts: {
        count: { type: Number, default: 0 },
        lastAttempt: { type: Date, default: null }
    },

    // ────────────────────────────────────────────────────────────────────────
    // ADMIN ACTIONS
    // ────────────────────────────────────────────────────────────────────────
    adminReviewed: {
        type: Boolean,
        default: false
    },

    adminNotes: {
        type: String,
        default: null
    },

    // ────────────────────────────────────────────────────────────────────────
    // METADATA
    // ────────────────────────────────────────────────────────────────────────
    createdAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'blockedcalllogs'
});

// ============================================================================
// INDEXES FOR PERFORMANCE
// ============================================================================

// Compound index for company + caller lookups
blockedCallLogSchema.index({ companyId: 1, callerPhone: 1, attemptTime: -1 });

// Index for spam analysis
blockedCallLogSchema.index({ blockReason: 1, spamScore: -1 });

// TTL index - auto-delete blocks older than 90 days
blockedCallLogSchema.index(
    { createdAt: 1 },
    { expireAfterSeconds: 7776000 } // 90 days
);

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Log a blocked call attempt
 */
blockedCallLogSchema.statics.logBlock = async function(data) {
    console.log(`🚫 [BLOCKED CALL] Logging block for ${data.callerPhone}`);
    
    // Check previous attempts
    const previousCount = await this.countDocuments({
        callerPhone: data.callerPhone,
        companyId: data.companyId
    });

    const blocked = await this.create({
        ...data,
        previousAttempts: {
            count: previousCount,
            lastAttempt: previousCount > 0 ? new Date() : null
        }
    });

    console.log(`✅ [BLOCKED CALL] Logged: ${blocked._id}`);
    return blocked;
};

/**
 * Get blocked calls for a company
 */
blockedCallLogSchema.statics.getBlockedCallsForCompany = async function(companyId, limit = 100) {
    return this.find({ companyId })
        .sort({ attemptTime: -1 })
        .limit(limit)
        .lean();
};

/**
 * Get spam statistics for a company
 */
blockedCallLogSchema.statics.getSpamStats = async function(companyId) {
    const stats = await this.aggregate([
        { $match: { companyId: mongoose.Types.ObjectId(companyId) } },
        {
            $group: {
                _id: '$blockReason',
                count: { $sum: 1 },
                avgSpamScore: { $avg: '$spamScore' }
            }
        },
        { $sort: { count: -1 } }
    ]);

    return stats;
};

// ============================================================================
// MODEL EXPORT
// ============================================================================

const BlockedCallLog = mongoose.model('BlockedCallLog', blockedCallLogSchema);

module.exports = BlockedCallLog;

