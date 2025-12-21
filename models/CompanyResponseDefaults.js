/**
 * ============================================================================
 * COMPANY RESPONSE DEFAULTS MODEL
 * ============================================================================
 * 
 * PURPOSE: Company-level fallback replies (e.g., "Not Offered" response)
 * 
 * ARCHITECTURE:
 * - Every company has ONE document in this collection
 * - Contains default responses when no category/scenario override exists
 * - Used as last resort BEFORE Tier 3 LLM fallback
 * 
 * EXAMPLE USE CASE:
 * Company disables "Duct Cleaning" category but didn't set a category default.
 * System falls back to company-level notOfferedReply:
 * "I'm sorry, we don't offer duct cleaning services. Is there something else I can help with?"
 * 
 * NO LLM REQUIRED for this fallback.
 * 
 * MULTI-TENANT: Always scoped by companyId
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

const ReplySchema = new Schema({
    quickReply: {
        type: String,
        default: null,
        trim: true,
        maxlength: 500
    },
    fullReply: {
        type: String,
        required: true,
        trim: true,
        maxlength: 2000
    }
}, { _id: false });

const CompanyResponseDefaultsSchema = new Schema({
    // ═══════════════════════════════════════════════════════════════════
    // IDENTITY (Multi-tenant safe)
    // ═══════════════════════════════════════════════════════════════════
    companyId: {
        type: Schema.Types.ObjectId,
        ref: 'v2Company',
        required: true,
        unique: true,
        index: true
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // DEFAULT RESPONSES
    // ═══════════════════════════════════════════════════════════════════
    
    // Used when scenario/category is disabled but no specific override exists
    notOfferedReply: {
        type: ReplySchema,
        default: () => ({
            quickReply: "I'm sorry, we don't offer that service.",
            fullReply: "I'm sorry, that's not a service we currently provide. Is there anything else I can help you with today?"
        })
    },
    
    // Used when system truly has no idea what user asked (rare)
    unknownIntentReply: {
        type: ReplySchema,
        default: () => ({
            quickReply: "I'm not sure I understand.",
            fullReply: "I'm sorry, I didn't quite catch that. Could you tell me more about what you're looking for? I'm here to help with scheduling, service questions, and more."
        })
    },
    
    // Used during after-hours when booking isn't available
    afterHoursReply: {
        type: ReplySchema,
        default: () => ({
            quickReply: "We're currently closed.",
            fullReply: "Thanks for calling! Our office is currently closed. Our normal business hours are Monday through Friday, 8am to 5pm. Would you like to leave a message or schedule a callback?"
        })
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // CONFIGURATION FLAGS
    // ═══════════════════════════════════════════════════════════════════
    
    // If true, always use notOfferedReply when disabled (never LLM)
    strictDisabledBehavior: {
        type: Boolean,
        default: true
    },
    
    // ═══════════════════════════════════════════════════════════════════
    // AUDIT
    // ═══════════════════════════════════════════════════════════════════
    lastUpdatedBy: {
        type: String,
        default: null
    }
    
}, {
    timestamps: true,
    collection: 'companyResponseDefaults'
});

// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get or create defaults for a company
 */
CompanyResponseDefaultsSchema.statics.getOrCreate = async function(companyId) {
    let defaults = await this.findOne({ companyId }).lean();
    
    if (!defaults) {
        // Create with default values
        defaults = await this.create({ companyId });
        defaults = defaults.toObject();
    }
    
    return defaults;
};

/**
 * Update company defaults
 */
CompanyResponseDefaultsSchema.statics.updateDefaults = async function(companyId, updates, updatedBy = null) {
    return this.findOneAndUpdate(
        { companyId },
        {
            $set: {
                ...updates,
                lastUpdatedBy: updatedBy
            }
        },
        { upsert: true, new: true }
    );
};

/**
 * Get not offered reply for a company
 */
CompanyResponseDefaultsSchema.statics.getNotOfferedReply = async function(companyId) {
    const defaults = await this.getOrCreate(companyId);
    return defaults.notOfferedReply;
};

/**
 * Check if company has configured defaults (for Flow Tree snapshot)
 */
CompanyResponseDefaultsSchema.statics.hasConfigured = async function(companyId) {
    const defaults = await this.findOne({ companyId }).lean();
    return {
        exists: !!defaults,
        notOfferedConfigured: !!(defaults?.notOfferedReply?.fullReply),
        unknownIntentConfigured: !!(defaults?.unknownIntentReply?.fullReply),
        afterHoursConfigured: !!(defaults?.afterHoursReply?.fullReply),
        strictDisabledBehavior: defaults?.strictDisabledBehavior ?? true
    };
};

module.exports = mongoose.model('CompanyResponseDefaults', CompanyResponseDefaultsSchema);

