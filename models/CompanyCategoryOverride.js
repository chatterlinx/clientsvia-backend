/**
 * ============================================================================
 * COMPANY CATEGORY OVERRIDE MODEL
 * ============================================================================
 * 
 * PURPOSE: Per-company enable/disable + default reply for entire categories
 * 
 * ARCHITECTURE:
 * - Global templates are READ-ONLY
 * - This collection stores COMPANY-SPECIFIC category overrides
 * - When a category is disabled, ALL scenarios in it use category default reply
 * - NO LLM required for disabled category handling
 * 
 * EXAMPLE USE CASE:
 * HVAC company disables "Duct Cleaning" category entirely.
 * When caller asks about duct cleaning:
 * - Scenario STILL MATCHES (we know what they asked)
 * - Category disabled → return disabledDefaultReply
 * - NO LLM hallucination
 * 
 * MULTI-TENANT: Always scoped by companyId
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const DisabledDefaultReplySchema = new Schema({
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

const CompanyCategoryOverrideSchema = new Schema({
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
    
    // Category name (denormalized for display, not for logic)
    categoryName: {
        type: String,
        default: null
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // OVERRIDE SETTINGS
    // ═══════════════════════════════════════════════════════════════════
    
    // Is this category enabled for this company?
    // true = all scenarios in category use normal behavior
    // false = all scenarios in category use disabledDefaultReply
    enabled: {
        type: Boolean,
        default: true,
        required: true
    },
    
    // Default reply when entire category is disabled
    // Used for ANY scenario in this category when category is disabled
    disabledDefaultReply: {
        type: DisabledDefaultReplySchema,
        default: () => ({})
    },
    
    // If true, use company-level notOfferedReply instead of category default
    useCompanyDefault: {
        type: Boolean,
        default: false
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
    collection: 'companyCategoryOverrides'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Primary lookup: get all category overrides for a company
CompanyCategoryOverrideSchema.index({ companyId: 1, templateId: 1 });

// Fast lookup: specific category override
CompanyCategoryOverrideSchema.index({ companyId: 1, categoryId: 1 }, { unique: true });

// Query: get all disabled categories for a company
CompanyCategoryOverrideSchema.index({ companyId: 1, enabled: 1 });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get all category overrides for a company (for runtime)
 * Returns a Map for O(1) lookup by categoryId
 */
CompanyCategoryOverrideSchema.statics.getOverridesMap = async function(companyId) {
    const overrides = await this.find({ companyId }).lean();
    const map = new Map();
    
    for (const override of overrides) {
        map.set(override.categoryId, override);
    }
    
    return map;
};

/**
 * Check if a specific category is enabled for a company
 */
CompanyCategoryOverrideSchema.statics.isCategoryEnabled = async function(companyId, categoryId) {
    const override = await this.findOne({ companyId, categoryId }).lean();
    
    if (!override) {
        // No override = category is enabled by default
        return { enabled: true, override: null };
    }
    
    return { enabled: override.enabled, override };
};

/**
 * Disable a category for a company with optional default reply
 */
CompanyCategoryOverrideSchema.statics.disableCategory = async function(
    companyId, 
    templateId, 
    categoryId, 
    options = {}
) {
    const { 
        categoryName,
        quickReply, 
        fullReply, 
        useCompanyDefault = false, 
        disabledBy, 
        notes 
    } = options;
    
    return this.findOneAndUpdate(
        { companyId, categoryId },
        {
            $set: {
                companyId,
                templateId,
                categoryId,
                categoryName: categoryName || null,
                enabled: false,
                disabledDefaultReply: {
                    quickReply: quickReply || null,
                    fullReply: fullReply || null
                },
                useCompanyDefault,
                disabledAt: new Date(),
                disabledBy: disabledBy || null,
                notes: notes || null
            }
        },
        { upsert: true, new: true }
    );
};

/**
 * Enable a category for a company
 */
CompanyCategoryOverrideSchema.statics.enableCategory = async function(companyId, categoryId) {
    return this.findOneAndUpdate(
        { companyId, categoryId },
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
CompanyCategoryOverrideSchema.statics.getSummary = async function(companyId) {
    const overrides = await this.find({ companyId }).lean();
    
    const total = overrides.length;
    const disabled = overrides.filter(o => !o.enabled).length;
    const disabledWithDefault = overrides.filter(o => 
        !o.enabled && 
        !o.useCompanyDefault && 
        o.disabledDefaultReply?.fullReply
    ).length;
    
    return {
        totalOverrides: total,
        disabledCount: disabled,
        disabledWithDefaultCount: disabledWithDefault
    };
};

module.exports = mongoose.model('CompanyCategoryOverride', CompanyCategoryOverrideSchema);

