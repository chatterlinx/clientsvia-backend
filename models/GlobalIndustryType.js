/**
 * ============================================================================
 * GLOBAL INDUSTRY TYPE MODEL
 * ============================================================================
 * 
 * PURPOSE:
 * Defines available industry types for Global AI Brain Templates.
 * Admins can dynamically add/edit/remove industries without code changes.
 * 
 * USAGE:
 * - Used in "Create Template" modal dropdown
 * - Allows platform to support unlimited industry types
 * - Each industry can have custom display name, icon, and description
 * 
 * ARCHITECTURE:
 * - Dynamic, database-driven (no hard-coded enums)
 * - Can be managed via admin UI
 * - Seeded with defaults (universal, healthcare, homeservices, etc.)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const globalIndustryTypeSchema = new Schema({
    // Unique identifier (lowercase, no spaces)
    industryId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true,
        index: true
    },
    
    // Display name for UI
    name: {
        type: String,
        required: true,
        trim: true
    },
    
    // Display label (e.g., "Healthcare & Medical")
    displayLabel: {
        type: String,
        required: true,
        trim: true
    },
    
    // Icon emoji for UI
    icon: {
        type: String,
        trim: true,
        default: '🏢'
    },
    
    // Description
    description: {
        type: String,
        trim: true,
        default: ''
    },
    
    // Color theme for UI (for badges, cards, etc.)
    color: {
        type: String,
        enum: ['blue', 'red', 'orange', 'green', 'purple', 'cyan', 'indigo', 'yellow', 'gray', 'pink'],
        default: 'blue'
    },
    
    // Is this industry type active?
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    
    // Display order
    sortOrder: {
        type: Number,
        default: 0
    },
    
    // Is this a system default? (cannot be deleted)
    isSystemDefault: {
        type: Boolean,
        default: false
    },
    
    // Creation tracking
    createdBy: {
        type: String,
        trim: true,
        default: 'Platform Admin'
    },
    
    lastModifiedBy: {
        type: String,
        trim: true
    }
}, {
    timestamps: true,
    collection: 'globalindustrytypes'
});

// Indexes
globalIndustryTypeSchema.index({ isActive: 1, sortOrder: 1 });
globalIndustryTypeSchema.index({ industryId: 1 });

/**
 * Get all active industry types sorted by order
 */
globalIndustryTypeSchema.statics.getActiveIndustries = async function() {
    return await this.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .lean();
};

/**
 * Get industry by ID
 */
globalIndustryTypeSchema.statics.getByIndustryId = async function(industryId) {
    return await this.findOne({ industryId: industryId.toLowerCase(), isActive: true }).lean();
};

const GlobalIndustryType = mongoose.model('GlobalIndustryType', globalIndustryTypeSchema);

module.exports = GlobalIndustryType;

