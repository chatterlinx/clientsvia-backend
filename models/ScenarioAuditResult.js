/**
 * ScenarioAuditResult Model
 * 
 * Persistent cache for Deep Audit results.
 * 
 * CACHE KEY:
 * templateId + scenarioId + auditProfileId + scenarioContentHash
 * 
 * If all four match, the cached result is valid and GPT is NOT called.
 * 
 * WHEN CACHE IS INVALIDATED:
 * - Scenario content changes (hash changes) → re-audit
 * - Audit profile changes (new standards) → re-audit
 * - Admin purges cache → re-audit
 * 
 * IMPORTANT:
 * - This is template-scoped (global), NOT company-scoped
 * - Same result is visible from any company viewing the global template
 * 
 * @module models/ScenarioAuditResult
 */
const mongoose = require('mongoose');

const IssueSchema = new mongoose.Schema({
    field: { type: String, default: 'general' },
    issue: { type: String, required: true },
    suggestion: { type: String, default: '' },
    grounded: { type: Boolean, default: false },
    severity: { type: String, enum: ['critical', 'major', 'minor', 'info'], default: 'major' }
}, { _id: false });

const StrengthSchema = new mongoose.Schema({
    description: { type: String, required: true },
    category: { type: String, default: 'general' }
}, { _id: false });

const ScenarioAuditResultSchema = new mongoose.Schema(
    {
        // ════════════════════════════════════════════════════════════════
        // CACHE KEY COMPONENTS (unique together)
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
            description: 'Scenario ID within the template'
        },

        auditProfileId: {
            type: String,
            required: true,
            index: true,
            description: 'Audit profile this result belongs to'
        },

        scenarioContentHash: {
            type: String,
            required: true,
            index: true,
            description: 'SHA256 hash of scenario content at audit time'
        },

        // ════════════════════════════════════════════════════════════════
        // AUDIT RESULT
        // ════════════════════════════════════════════════════════════════
        score: {
            type: Number,
            default: 0,
            min: 0,
            max: 10,
            description: 'Audit score 1-10'
        },

        verdict: {
            type: String,
            enum: ['PERFECT', 'GOOD', 'ACCEPTABLE', 'NEEDS_WORK', 'FAILS', 'ERROR', 'PARSE_ERROR', 'TIMEOUT'],
            default: 'NEEDS_WORK',
            description: 'Overall verdict'
        },

        rewriteNeeded: {
            type: Boolean,
            default: false,
            description: 'Whether the fixer should rewrite this scenario'
        },

        issues: {
            type: [IssueSchema],
            default: [],
            description: 'List of issues found'
        },

        strengths: {
            type: [StrengthSchema],
            default: [],
            description: 'List of strengths noted'
        },

        fixSuggestions: {
            type: [String],
            default: [],
            description: 'Specific fix suggestions'
        },

        // ════════════════════════════════════════════════════════════════
        // INTENT/BLUEPRINT MATCHING
        // ════════════════════════════════════════════════════════════════
        blueprintItemKey: {
            type: String,
            default: null,
            description: 'Blueprint intent this was matched to (if any)'
        },

        matchConfidence: {
            type: Number,
            default: null,
            min: 0,
            max: 1,
            description: 'Confidence of intent match'
        },

        matchSource: {
            type: String,
            enum: ['explicit_mapping', 'auto_match', 'none', null],
            default: null
        },

        intentFulfilled: {
            type: Boolean,
            default: null,
            description: 'Whether scenario fulfills its matched intent'
        },

        // ════════════════════════════════════════════════════════════════
        // SUPERVISION/GROUNDING METADATA
        // ════════════════════════════════════════════════════════════════
        supervision: {
            grounded: { type: Boolean, default: false },
            originalIssueCount: { type: Number, default: 0 },
            hallucinatedFiltered: { type: Number, default: 0 },
            verifiedIssueCount: { type: Number, default: 0 }
        },

        // ════════════════════════════════════════════════════════════════
        // EXECUTION METADATA
        // ════════════════════════════════════════════════════════════════
        model: {
            type: String,
            default: 'gpt-4o',
            description: 'Model used for this audit'
        },

        promptVersion: {
            type: String,
            default: 'DEEP_AUDIT_PROMPT_V1'
        },

        rubricVersion: {
            type: String,
            default: 'DEEP_AUDIT_RUBRIC_V1'
        },

        tokensUsed: {
            type: Number,
            default: 0
        },

        durationMs: {
            type: Number,
            default: 0,
            description: 'Time taken for this audit in milliseconds'
        },

        // ════════════════════════════════════════════════════════════════
        // CACHE STATUS
        // ════════════════════════════════════════════════════════════════
        cached: {
            type: Boolean,
            default: false,
            description: 'True if this result was served from cache (not fresh GPT call)'
        },

        cacheHitCount: {
            type: Number,
            default: 0,
            description: 'Number of times this cached result was reused'
        },

        // ════════════════════════════════════════════════════════════════
        // SCENARIO METADATA (for display/debugging)
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

        categoryId: {
            type: String,
            default: null
        }
    },
    {
        timestamps: true,
        collection: 'scenarioAuditResults'
    }
);

// ════════════════════════════════════════════════════════════════════════════
// INDEXES
// ════════════════════════════════════════════════════════════════════════════

// UNIQUE CACHE KEY: same content under same profile should never have duplicate results
ScenarioAuditResultSchema.index(
    { templateId: 1, scenarioId: 1, auditProfileId: 1, scenarioContentHash: 1 },
    { unique: true }
);

// Fast lookup: all results for a template under a profile
ScenarioAuditResultSchema.index({ templateId: 1, auditProfileId: 1, verdict: 1 });

// Fast lookup: results for a specific scenario
ScenarioAuditResultSchema.index({ scenarioId: 1, auditProfileId: 1, createdAt: -1 });

// Stats queries
ScenarioAuditResultSchema.index({ auditProfileId: 1, score: 1 });

// ════════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Look up cached result for a scenario
 * Returns null if no valid cache exists
 */
ScenarioAuditResultSchema.statics.findCached = async function({
    templateId,
    scenarioId,
    auditProfileId,
    scenarioContentHash
}) {
    const cached = await this.findOne({
        templateId,
        scenarioId,
        auditProfileId,
        scenarioContentHash
    }).lean();

    if (cached) {
        // Increment cache hit count (fire and forget)
        this.updateOne(
            { _id: cached._id },
            { $inc: { cacheHitCount: 1 } }
        ).exec();
    }

    return cached;
};

/**
 * Store or update audit result
 * Uses upsert to handle race conditions
 */
ScenarioAuditResultSchema.statics.upsertResult = async function(resultData) {
    const {
        templateId,
        scenarioId,
        auditProfileId,
        scenarioContentHash,
        ...rest
    } = resultData;

    return this.findOneAndUpdate(
        { templateId, scenarioId, auditProfileId, scenarioContentHash },
        { $set: { templateId, scenarioId, auditProfileId, scenarioContentHash, ...rest } },
        { upsert: true, new: true }
    ).lean();
};

/**
 * Get summary stats for a profile
 */
ScenarioAuditResultSchema.statics.getProfileStats = async function(templateId, auditProfileId) {
    const results = await this.aggregate([
        { $match: { templateId, auditProfileId } },
        {
            $group: {
                _id: null,
                total: { $sum: 1 },
                avgScore: { $avg: '$score' },
                perfectCount: {
                    $sum: { $cond: [{ $gte: ['$score', 9] }, 1, 0] }
                },
                needsWorkCount: {
                    $sum: { $cond: [{ $eq: ['$verdict', 'NEEDS_WORK'] }, 1, 0] }
                },
                failsCount: {
                    $sum: { $cond: [{ $eq: ['$verdict', 'FAILS'] }, 1, 0] }
                },
                errorCount: {
                    $sum: { $cond: [{ $in: ['$verdict', ['ERROR', 'PARSE_ERROR', 'TIMEOUT']] }, 1, 0] }
                }
            }
        }
    ]);

    return results[0] || {
        total: 0,
        avgScore: 0,
        perfectCount: 0,
        needsWorkCount: 0,
        failsCount: 0,
        errorCount: 0
    };
};

/**
 * Purge all results for a profile (admin reset)
 */
ScenarioAuditResultSchema.statics.purgeForProfile = async function(templateId, auditProfileId) {
    const result = await this.deleteMany({ templateId, auditProfileId });
    return result.deletedCount || 0;
};

/**
 * Purge result for a single scenario (selective re-audit)
 */
ScenarioAuditResultSchema.statics.purgeForScenario = async function(templateId, scenarioId, auditProfileId) {
    const result = await this.deleteMany({ templateId, scenarioId, auditProfileId });
    return result.deletedCount || 0;
};

module.exports = mongoose.model('ScenarioAuditResult', ScenarioAuditResultSchema);
