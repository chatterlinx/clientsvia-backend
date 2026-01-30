/**
 * AuditProfile Model
 * 
 * Represents a versioned "standards contract" for Deep Audit.
 * 
 * PURPOSE:
 * - Define the rubric/rules for auditing scenarios
 * - Enable "start over" by creating new profiles with different standards
 * - Template-scoped (NOT company-scoped) to avoid contamination
 * 
 * USAGE:
 * - Each template has ONE active profile at a time
 * - Switching active profile = fresh audit under new standards
 * - Old profiles preserved for historical reference
 * 
 * @module models/AuditProfile
 */
const mongoose = require('mongoose');

const AuditProfileSchema = new mongoose.Schema(
    {
        // ════════════════════════════════════════════════════════════════
        // SCOPE: Template-scoped (global, NOT company-scoped)
        // ════════════════════════════════════════════════════════════════
        templateId: {
            type: String,
            required: true,
            index: true,
            description: 'Global template ID this profile applies to'
        },

        // ════════════════════════════════════════════════════════════════
        // IDENTITY
        // ════════════════════════════════════════════════════════════════
        name: {
            type: String,
            required: true,
            description: 'Human-readable name (e.g., "HVAC Standard v1 – tight dispatcher")'
        },

        description: {
            type: String,
            default: '',
            description: 'Optional notes about this profile'
        },

        isActive: {
            type: Boolean,
            default: false,
            index: true,
            description: 'Only ONE profile per template can be active'
        },

        // ════════════════════════════════════════════════════════════════
        // VERSIONING
        // ════════════════════════════════════════════════════════════════
        rubricVersion: {
            type: String,
            default: 'DEEP_AUDIT_RUBRIC_V1',
            description: 'Version identifier for the audit rubric/prompt'
        },

        promptVersion: {
            type: String,
            default: 'DEEP_AUDIT_PROMPT_V1',
            description: 'Version of the GPT prompt used'
        },

        // ════════════════════════════════════════════════════════════════
        // RULES CONFIGURATION (the "standards contract")
        // ════════════════════════════════════════════════════════════════
        rulesJson: {
            type: mongoose.Schema.Types.Mixed,
            required: true,
            default: {},
            description: 'Full rubric configuration as JSON'
        },

        // Individual rule fields for easy querying/display
        toneLevel: {
            type: String,
            enum: ['tight_dispatcher', 'friendly_dispatcher', 'chatty', 'custom'],
            default: 'tight_dispatcher'
        },

        lengthRules: {
            quickMaxWords: { type: Number, default: 15 },
            fullMaxWords: { type: Number, default: 25 },
            empathyMaxWords: { type: Number, default: 3 }
        },

        bannedPhrases: {
            type: [String],
            default: [
                "I'd be happy to",
                "Absolutely",
                "Definitely",
                "Thanks for",
                "Of course",
                "No problem",
                "No worries"
            ]
        },

        placeholderPolicy: {
            allowed: { type: [String], default: ['callerName', 'companyName'] },
            forbidden: { type: [String], default: ['name'] },
            strictUnknown: { type: Boolean, default: true }
        },

        // Blueprint/intent matching settings
        blueprintMatchingMode: {
            type: String,
            enum: ['strict', 'lenient', 'disabled'],
            default: 'strict',
            description: 'How strictly to enforce blueprint intent matching'
        },

        minMatchConfidence: {
            type: Number,
            default: 0.75,
            min: 0,
            max: 1,
            description: 'Minimum confidence for auto-matching scenarios to intents'
        },

        // Score bands
        scoreBands: {
            perfect: { min: { type: Number, default: 9 }, max: { type: Number, default: 10 } },
            good: { min: { type: Number, default: 7 }, max: { type: Number, default: 8 } },
            needsWork: { min: { type: Number, default: 0 }, max: { type: Number, default: 6 } }
        },

        // ════════════════════════════════════════════════════════════════
        // METADATA
        // ════════════════════════════════════════════════════════════════
        createdBy: {
            type: String,
            default: null,
            description: 'User who created this profile'
        },

        notes: {
            type: String,
            default: '',
            description: 'Admin notes about this profile'
        },

        // Stats (updated after each audit run)
        stats: {
            lastRunAt: { type: Date, default: null },
            totalRuns: { type: Number, default: 0 },
            lastPerfectCount: { type: Number, default: 0 },
            lastNeedsWorkCount: { type: Number, default: 0 }
        }
    },
    {
        timestamps: true,
        collection: 'auditProfiles'
    }
);

// ════════════════════════════════════════════════════════════════════════════
// INDEXES
// ════════════════════════════════════════════════════════════════════════════

// Fast lookup of active profile for a template
AuditProfileSchema.index({ templateId: 1, isActive: 1 });

// List all profiles for a template
AuditProfileSchema.index({ templateId: 1, createdAt: -1 });

// ════════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Get the active audit profile for a template, or create default if none exists
 */
AuditProfileSchema.statics.getActiveOrCreateDefault = async function(templateId) {
    let active = await this.findOne({ templateId, isActive: true }).lean();
    if (active) return active;

    // Create default profile
    const created = await this.create({
        templateId,
        name: 'Default Deep Audit Profile',
        description: 'Auto-created default profile with tight dispatcher standards',
        isActive: true,
        rubricVersion: 'DEEP_AUDIT_RUBRIC_V1',
        rulesJson: {
            tone: 'tight_dispatcher',
            placeholderPolicy: { allowed: ['callerName'], forbidden: ['name'], strictUnknown: true },
            lengthRules: { quickMaxWords: 15, fullMaxWords: 25 },
            bannedPhrases: ["I'd be happy to", "Absolutely", "Definitely", "Thanks for"],
            scoreBands: { perfect: [9, 10], good: [7, 8], needsWork: [0, 6] }
        },
        createdBy: 'system'
    });

    return created.toObject();
};

/**
 * Set a profile as active (deactivates all others for the template)
 */
AuditProfileSchema.statics.setActive = async function(templateId, auditProfileId) {
    // Deactivate all profiles for this template
    await this.updateMany({ templateId }, { $set: { isActive: false } });

    // Activate the specified one
    const updated = await this.findByIdAndUpdate(
        auditProfileId,
        { $set: { isActive: true } },
        { new: true }
    ).lean();

    return updated;
};

module.exports = mongoose.model('AuditProfile', AuditProfileSchema);
