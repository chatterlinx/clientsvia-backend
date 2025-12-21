/**
 * ============================================================================
 * COMPANY SCENARIO OVERRIDE MODEL
 * ============================================================================
 * 
 * PURPOSE: Per-company enable/disable + alternate reply for individual scenarios
 * 
 * ARCHITECTURE:
 * - Global templates are READ-ONLY
 * - This collection stores COMPANY-SPECIFIC overrides
 * - Scenario matching happens FIRST, then overrides are applied
 * - NO LLM required for disabled scenario handling
 * 
 * RESOLUTION ORDER (when scenario matches but is disabled):
 * 1. Scenario disabledAlternateReply (if fallbackPreference = "SCENARIO")
 * 2. Category disabledDefaultReply (if fallbackPreference = "CATEGORY")
 * 3. Company notOfferedReply (if fallbackPreference = "COMPANY")
 * 4. Tier 3 LLM fallback (ONLY if nothing above exists)
 * 
 * MULTI-TENANT: Always scoped by companyId
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const DisabledAlternateReplySchema = new Schema({
    quickReply: {
        type: String,
        default: null,
        trim: true,
        maxlength: 500
    },
    fullReply: {
        type: String,
        default: null,
        trim: true,
        maxlength: 2000
    }
}, { _id: false });

const CompanyScenarioOverrideSchema = new Schema({
    // ═══════════════════════════════════════════════════════════════════
    // IDENTITY (Multi-tenant safe)
    // ═══════════════════════════════════════════════════════════════════
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
        required: true,
        index: true
    },
    
    // Reference to Global AI Brain template
    templateId: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate',
        required: true,
        index: true
    },
    
    // Category within the template (string ID from template.categories[].id)
    categoryId: {
        type: String,
        required: true,
        index: true
    },
    
    // Scenario within the category (string ID from scenario.scenarioId)
    scenarioId: {
        type: String,
        required: true,
        index: true
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // OVERRIDE SETTINGS
    // ═══════════════════════════════════════════════════════════════════
    
    // Is this scenario enabled for this company?
    // true = use normal scenario reply
    // false = use override resolution order
    enabled: {
        type: Boolean,
        default: true,
        required: true
    },
    
    // Custom alternate reply when scenario is disabled
    // Used when fallbackPreference = "SCENARIO"
    disabledAlternateReply: {
        type: DisabledAlternateReplySchema,
        default: () => ({})
    },
    
    // What to use when scenario is disabled:
    // - "SCENARIO" = use this scenario's disabledAlternateReply
    // - "CATEGORY" = use parent category's disabledDefaultReply
    // - "COMPANY" = use company's notOfferedReply
    fallbackPreference: {
        type: String,
        enum: ['SCENARIO', 'CATEGORY', 'COMPANY'],
        default: 'COMPANY'
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // AUDIT
    // ═══════════════════════════════════════════════════════════════════
    disabledAt: {
        type: Date,
        default: null
    },
    disabledBy: {
        type: String,
        default: null
    },
    notes: {
        type: String,
        default: null,
        maxlength: 500
    }
    
}, {
    timestamps: true,
    collection: 'companyScenarioOverrides'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Primary lookup: get all overrides for a company
CompanyScenarioOverrideSchema.index({ companyId: 1, templateId: 1 });

// Fast lookup: specific scenario override
CompanyScenarioOverrideSchema.index({ companyId: 1, scenarioId: 1 }, { unique: true });

// Query: get all disabled scenarios for a company
CompanyScenarioOverrideSchema.index({ companyId: 1, enabled: 1 });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all scenario overrides for a company (for runtime)
 * Returns a Map for O(1) lookup by scenarioId
 */
CompanyScenarioOverrideSchema.statics.getOverridesMap = async function(companyId) {
    const overrides = await this.find({ companyId }).lean();
    const map = new Map();
    
    for (const override of overrides) {
        map.set(override.scenarioId, override);
    }
    
    return map;
};

/**
 * Check if a specific scenario is enabled for a company
 * Returns { enabled, override } or { enabled: true, override: null } if no override exists
 */
CompanyScenarioOverrideSchema.statics.isScenarioEnabled = async function(companyId, scenarioId) {
    const override = await this.findOne({ companyId, scenarioId }).lean();
    
    if (!override) {
        // No override = scenario is enabled by default
        return { enabled: true, override: null };
    }
    
    return { enabled: override.enabled, override };
};

/**
 * Disable a scenario for a company with optional alternate reply
 */
CompanyScenarioOverrideSchema.statics.disableScenario = async function(
    companyId, 
    templateId, 
    categoryId, 
    scenarioId, 
    options = {}
) {
    const { quickReply, fullReply, fallbackPreference = 'COMPANY', disabledBy, notes } = options;
    
    return this.findOneAndUpdate(
        { companyId, scenarioId },
        {
            $set: {
                companyId,
                templateId,
                categoryId,
                scenarioId,
                enabled: false,
                disabledAlternateReply: {
                    quickReply: quickReply || null,
                    fullReply: fullReply || null
                },
                fallbackPreference,
                disabledAt: new Date(),
                disabledBy: disabledBy || null,
                notes: notes || null
            }
        },
        { upsert: true, new: true }
    );
};

/**
 * Enable a scenario for a company (removes override or sets enabled=true)
 */
CompanyScenarioOverrideSchema.statics.enableScenario = async function(companyId, scenarioId) {
    return this.findOneAndUpdate(
        { companyId, scenarioId },
        {
            $set: {
                enabled: true,
                disabledAt: null,
                disabledBy: null
            }
        },
        { new: true }
    );
};

/**
 * Get summary counts for a company (for Flow Tree snapshot)
 */
CompanyScenarioOverrideSchema.statics.getSummary = async function(companyId) {
    const overrides = await this.find({ companyId }).lean();
    
    const total = overrides.length;
    const disabled = overrides.filter(o => !o.enabled).length;
    const disabledWithAlternate = overrides.filter(o => 
        !o.enabled && 
        o.fallbackPreference === 'SCENARIO' && 
        o.disabledAlternateReply?.fullReply
    ).length;
    
    return {
        totalOverrides: total,
        disabledCount: disabled,
        disabledWithAlternateCount: disabledWithAlternate
    };
};

module.exports = mongoose.model('CompanyScenarioOverride', CompanyScenarioOverrideSchema);

