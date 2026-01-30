/**
 * ScenarioFixLedger Model
 * 
 * Audit trail for all "Fix in Global Brain" actions.
 * 
 * PURPOSE:
 * - Track what was fixed, when, and under which audit profile
 * - Provide diff capability (before/after hashes)
 * - Enable "was this already fixed?" queries
 * - Support accountability and rollback investigations
 * 
 * WHEN A ROW IS CREATED:
 * - User clicks "Fix in Global Brain" and saves
 * - beforeHash = hash of scenario BEFORE fix
 * - afterHash = hash of scenario AFTER fix
 * 
 * IMPORTANT:
 * - This is template-scoped (global), NOT company-scoped
 * - Entries are immutable (never update, only append)
 * 
 * @module models/ScenarioFixLedger
 */
const mongoose = require('mongoose');

const ScenarioFixLedgerSchema = new mongoose.Schema(
    {
        // ════════════════════════════════════════════════════════════════
        // IDENTITY
        // ════════════════════════════════════════════════════════════════
        templateId: {
            type: String,
            required: true,
            index: true,
            description: 'Global template ID'
        },

        scenarioId: {
            type: String,
            required: true,
            index: true,
            description: 'Scenario that was fixed'
        },

        auditProfileId: {
            type: String,
            required: true,
            index: true,
            description: 'Audit profile active when fix was applied'
        },

        // ════════════════════════════════════════════════════════════════
        // CONTENT CHANGE TRACKING
        // ════════════════════════════════════════════════════════════════
        beforeHash: {
            type: String,
            required: true,
            description: 'Content hash BEFORE the fix'
        },

        afterHash: {
            type: String,
            required: true,
            description: 'Content hash AFTER the fix'
        },

        // Optional: store the actual before/after content for debugging
        beforeSnapshot: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
            description: 'Optional: full scenario content before fix'
        },

        afterSnapshot: {
            type: mongoose.Schema.Types.Mixed,
            default: null,
            description: 'Optional: full scenario content after fix'
        },

        // ════════════════════════════════════════════════════════════════
        // FIX METADATA
        // ════════════════════════════════════════════════════════════════
        fixType: {
            type: String,
            enum: ['auto_gpt', 'manual_edit', 'batch_fix', 'import'],
            default: 'auto_gpt',
            description: 'How the fix was applied'
        },

        fixPromptVersion: {
            type: String,
            default: 'DEEP_FIX_PROMPT_V1',
            description: 'Version of the fix prompt used'
        },

        model: {
            type: String,
            default: 'gpt-4o',
            description: 'Model used for auto-fix'
        },

        fixRunId: {
            type: String,
            default: null,
            description: 'Batch run ID if part of a batch fix'
        },

        // ════════════════════════════════════════════════════════════════
        // AUDIT CONTEXT
        // ════════════════════════════════════════════════════════════════
        auditScore: {
            type: Number,
            default: null,
            description: 'Score that triggered this fix'
        },

        auditVerdict: {
            type: String,
            default: null,
            description: 'Verdict that triggered this fix'
        },

        issuesAddressed: {
            type: [String],
            default: [],
            description: 'List of issue types this fix was meant to address'
        },

        // ════════════════════════════════════════════════════════════════
        // SCENARIO METADATA (for display)
        // ════════════════════════════════════════════════════════════════
        scenarioName: {
            type: String,
            default: null
        },

        scenarioType: {
            type: String,
            default: null
        },

        categoryName: {
            type: String,
            default: null
        },

        // ════════════════════════════════════════════════════════════════
        // WHO/WHEN
        // ════════════════════════════════════════════════════════════════
        appliedBy: {
            type: String,
            default: null,
            description: 'User who applied the fix'
        },

        appliedByUserId: {
            type: mongoose.Schema.Types.ObjectId,
            default: null
        },

        notes: {
            type: String,
            default: '',
            description: 'Optional notes about the fix'
        },

        // ════════════════════════════════════════════════════════════════
        // POST-FIX VERIFICATION
        // ════════════════════════════════════════════════════════════════
        verifiedAt: {
            type: Date,
            default: null,
            description: 'When the fix was verified (re-audited and passed)'
        },

        verifiedScore: {
            type: Number,
            default: null,
            description: 'Score after re-audit'
        },

        verifiedVerdict: {
            type: String,
            default: null,
            description: 'Verdict after re-audit'
        }
    },
    {
        timestamps: true,
        collection: 'scenarioFixLedger'
    }
);

// ════════════════════════════════════════════════════════════════════════════
// INDEXES
// ════════════════════════════════════════════════════════════════════════════

// Timeline view: all fixes for a template under a profile
ScenarioFixLedgerSchema.index({ templateId: 1, auditProfileId: 1, createdAt: -1 });

// Scenario history: all fixes for a specific scenario
ScenarioFixLedgerSchema.index({ templateId: 1, scenarioId: 1, createdAt: -1 });

// Fix runs: group by batch
ScenarioFixLedgerSchema.index({ fixRunId: 1, createdAt: -1 });

// User activity
ScenarioFixLedgerSchema.index({ appliedBy: 1, createdAt: -1 });

// ════════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Record a fix action
 */
ScenarioFixLedgerSchema.statics.recordFix = async function({
    templateId,
    scenarioId,
    auditProfileId,
    beforeHash,
    afterHash,
    beforeSnapshot = null,
    afterSnapshot = null,
    fixType = 'auto_gpt',
    fixPromptVersion = 'DEEP_FIX_PROMPT_V1',
    model = 'gpt-4o',
    fixRunId = null,
    auditScore = null,
    auditVerdict = null,
    issuesAddressed = [],
    scenarioName = null,
    scenarioType = null,
    categoryName = null,
    appliedBy = null,
    appliedByUserId = null,
    notes = ''
}) {
    // Don't record if nothing changed
    if (beforeHash === afterHash) {
        return null;
    }

    return this.create({
        templateId,
        scenarioId,
        auditProfileId,
        beforeHash,
        afterHash,
        beforeSnapshot,
        afterSnapshot,
        fixType,
        fixPromptVersion,
        model,
        fixRunId,
        auditScore,
        auditVerdict,
        issuesAddressed,
        scenarioName,
        scenarioType,
        categoryName,
        appliedBy,
        appliedByUserId,
        notes
    });
};

/**
 * Check if a scenario was already fixed under a profile
 */
ScenarioFixLedgerSchema.statics.wasAlreadyFixed = async function(templateId, scenarioId, auditProfileId) {
    const fix = await this.findOne({
        templateId,
        scenarioId,
        auditProfileId
    }).sort({ createdAt: -1 }).lean();

    return fix !== null;
};

/**
 * Get fix history for a scenario
 */
ScenarioFixLedgerSchema.statics.getScenarioHistory = async function(templateId, scenarioId, limit = 10) {
    return this.find({ templateId, scenarioId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .lean();
};

/**
 * Get all fixes for a profile
 */
ScenarioFixLedgerSchema.statics.getProfileFixes = async function(templateId, auditProfileId, options = {}) {
    const { limit = 100, skip = 0 } = options;

    return this.find({ templateId, auditProfileId })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean();
};

/**
 * Get fix stats for a profile
 */
ScenarioFixLedgerSchema.statics.getProfileFixStats = async function(templateId, auditProfileId) {
    const result = await this.aggregate([
        { $match: { templateId, auditProfileId } },
        {
            $group: {
                _id: null,
                totalFixes: { $sum: 1 },
                uniqueScenarios: { $addToSet: '$scenarioId' },
                byType: {
                    $push: '$fixType'
                }
            }
        },
        {
            $project: {
                totalFixes: 1,
                uniqueScenariosFixed: { $size: '$uniqueScenarios' },
                autoFixCount: {
                    $size: {
                        $filter: {
                            input: '$byType',
                            cond: { $eq: ['$$this', 'auto_gpt'] }
                        }
                    }
                },
                manualFixCount: {
                    $size: {
                        $filter: {
                            input: '$byType',
                            cond: { $eq: ['$$this', 'manual_edit'] }
                        }
                    }
                }
            }
        }
    ]);

    return result[0] || {
        totalFixes: 0,
        uniqueScenariosFixed: 0,
        autoFixCount: 0,
        manualFixCount: 0
    };
};

/**
 * Mark a fix as verified (re-audit passed)
 */
ScenarioFixLedgerSchema.statics.markVerified = async function(ledgerEntryId, score, verdict) {
    return this.findByIdAndUpdate(
        ledgerEntryId,
        {
            $set: {
                verifiedAt: new Date(),
                verifiedScore: score,
                verifiedVerdict: verdict
            }
        },
        { new: true }
    ).lean();
};

module.exports = mongoose.model('ScenarioFixLedger', ScenarioFixLedgerSchema);
