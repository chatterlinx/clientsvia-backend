// ============================================================================
// GLOBAL SPAM DATABASE MODEL
// ============================================================================
// 📋 PURPOSE: Centralized database of known spam numbers across all companies
// 🎯 FEATURES:
//    - Global spam number registry
//    - Community reporting
//    - Spam score calculation
//    - Automatic blacklisting
// ============================================================================

const mongoose = require('mongoose');

const globalSpamDatabaseSchema = new mongoose.Schema({
    // ────────────────────────────────────────────────────────────────────────
    // SPAM NUMBER
    // ────────────────────────────────────────────────────────────────────────
    phoneNumber: {
        type: String,
        required: true,
        unique: true,
        index: true
    },

    // ────────────────────────────────────────────────────────────────────────
    // SPAM CLASSIFICATION
    // ────────────────────────────────────────────────────────────────────────
    spamType: {
        type: String,
        enum: [
            'robocall',
            'telemarketer',
            'scam',
            'phishing',
            'harassment',
            'wrong_number',
            'other'
        ],
        default: 'other'
    },

    spamScore: {
        type: Number,
        min: 0,
        max: 100,
        default: 50,
        index: true
    },

    // ────────────────────────────────────────────────────────────────────────
    // REPORTING STATISTICS
    // ────────────────────────────────────────────────────────────────────────
    reports: {
        count: { type: Number, default: 1 },
        firstReported: { type: Date, default: Date.now },
        lastReported: { type: Date, default: Date.now },
        reportedByCompanies: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Company' }]
    },

    // ────────────────────────────────────────────────────────────────────────
    // BLOCKING HISTORY
    // ────────────────────────────────────────────────────────────────────────
    blockHistory: {
        totalBlocks: { type: Number, default: 0 },
        lastBlockedAt: { type: Date, default: null }
    },

    // ────────────────────────────────────────────────────────────────────────
    // CALLER INFORMATION
    // ────────────────────────────────────────────────────────────────────────
    callerInfo: {
        name: { type: String, default: null },
        country: { type: String, default: null },
        carrier: { type: String, default: null }
    },

    // ────────────────────────────────────────────────────────────────────────
    // ADMIN VERIFICATION
    // ────────────────────────────────────────────────────────────────────────
    verified: {
        type: Boolean,
        default: false
    },

    verifiedBy: {
        type: String,
        default: null
    },

    verifiedAt: {
        type: Date,
        default: null
    },

    // ────────────────────────────────────────────────────────────────────────
    // STATUS
    // ────────────────────────────────────────────────────────────────────────
    status: {
        type: String,
        enum: ['active', 'whitelisted', 'under_review'],
        default: 'active',
        index: true
    },

    // ────────────────────────────────────────────────────────────────────────
    // NOTES
    // ────────────────────────────────────────────────────────────────────────
    notes: {
        type: String,
        default: null
    },

    // ────────────────────────────────────────────────────────────────────────
    // METADATA
    // ────────────────────────────────────────────────────────────────────────
    createdAt: {
        type: Date,
        default: Date.now
    },

    updatedAt: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true,
    collection: 'globalspamdatabase'
});

// ============================================================================
// INDEXES FOR PERFORMANCE
// ============================================================================

// Index for spam score lookups
globalSpamDatabaseSchema.index({ spamScore: -1, status: 1 });

// Index for reporting statistics
globalSpamDatabaseSchema.index({ 'reports.count': -1 });

// ============================================================================
// STATIC METHODS
// ============================================================================

/**
 * Check if a number is spam
 */
globalSpamDatabaseSchema.statics.isSpam = async function(phoneNumber) {
    const entry = await this.findOne({
        phoneNumber,
        status: 'active',
        spamScore: { $gte: 50 } // Threshold for blocking
    });

    if (entry) {
        console.log(`🚫 [SPAM DB] Number ${phoneNumber} found in spam database (score: ${entry.spamScore})`);
        return { isSpam: true, entry };
    }

    return { isSpam: false, entry: null };
};

/**
 * Report a spam number
 */
globalSpamDatabaseSchema.statics.reportSpam = async function(data) {
    const { phoneNumber, spamType, reportedBy, companyId } = data;

    console.log(`📝 [SPAM DB] Reporting spam: ${phoneNumber}`);

    // Find existing entry
    let entry = await this.findOne({ phoneNumber });

    if (entry) {
        // Update existing entry
        entry.reports.count += 1;
        entry.reports.lastReported = new Date();
        
        if (companyId && !entry.reports.reportedByCompanies.includes(companyId)) {
            entry.reports.reportedByCompanies.push(companyId);
        }

        // Increase spam score based on reports
        entry.spamScore = Math.min(100, entry.spamScore + 10);

        await entry.save();
        console.log(`✅ [SPAM DB] Updated entry: ${entry._id} (new score: ${entry.spamScore})`);
    } else {
        // Create new entry
        entry = await this.create({
            phoneNumber,
            spamType: spamType || 'other',
            spamScore: 60, // Initial score for reported numbers
            reports: {
                count: 1,
                firstReported: new Date(),
                lastReported: new Date(),
                reportedByCompanies: companyId ? [companyId] : []
            }
        });
        console.log(`✅ [SPAM DB] Created new entry: ${entry._id}`);
    }

    return entry;
};

/**
 * Whitelist a number (remove from spam)
 */
globalSpamDatabaseSchema.statics.whitelist = async function(phoneNumber, reason) {
    console.log(`✅ [SPAM DB] Whitelisting: ${phoneNumber}`);
    
    const entry = await this.findOneAndUpdate(
        { phoneNumber },
        {
            status: 'whitelisted',
            notes: reason || 'Whitelisted by admin',
            updatedAt: new Date()
        },
        { new: true }
    );

    return entry;
};

/**
 * Get top spam numbers
 */
globalSpamDatabaseSchema.statics.getTopSpamNumbers = async function(limit = 100) {
    return this.find({ status: 'active' })
        .sort({ spamScore: -1, 'reports.count': -1 })
        .limit(limit)
        .lean();
};

/**
 * Get spam statistics
 */
globalSpamDatabaseSchema.statics.getStats = async function() {
    const stats = await this.aggregate([
        {
            $group: {
                _id: '$spamType',
                count: { $sum: 1 },
                avgScore: { $avg: '$spamScore' }
            }
        },
        { $sort: { count: -1 } }
    ]);

    const totalSpamNumbers = await this.countDocuments({ status: 'active' });
    const totalReports = await this.aggregate([
        { $group: { _id: null, total: { $sum: '$reports.count' } } }
    ]);

    return {
        totalSpamNumbers,
        totalReports: totalReports[0]?.total || 0,
        byType: stats
    };
};

// ============================================================================
// MODEL EXPORT
// ============================================================================

const GlobalSpamDatabase = mongoose.model('GlobalSpamDatabase', globalSpamDatabaseSchema);

module.exports = GlobalSpamDatabase;

