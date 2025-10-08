/**
 * ============================================================================
 * GLOBAL ACTION HOOK CATEGORY MODEL
 * ============================================================================
 * 
 * PURPOSE:
 * Defines categories for organizing action hooks (e.g., Escalation, Scheduling,
 * Communication, Payment, etc.). Categories are dynamic and admin-manageable.
 * 
 * ARCHITECTURE:
 * - Platform-wide category library
 * - Action hooks reference categories by categoryId
 * - Admins can add/edit/delete categories from UI
 * - Displayed in dropdowns when creating/editing hooks
 * 
 * DESIGN PHILOSOPHY:
 * - Dynamic, not hardcoded
 * - Future-proof for industry-specific needs
 * - Clean separation: categories define organization, hooks define actions
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const globalActionHookCategorySchema = new Schema({
    // Unique identifier (used in hook.category field)
    categoryId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
    },
    
    // Display name
    name: {
        type: String,
        required: true,
        trim: true
    },
    
    // Emoji icon for UI display
    icon: {
        type: String,
        trim: true,
        default: '⚡'
    },
    
    // Description of what this category is for
    description: {
        type: String,
        trim: true,
        default: ''
    },
    
    // Badge color for UI (Tailwind color name)
    color: {
        type: String,
        enum: ['red', 'blue', 'green', 'purple', 'cyan', 'indigo', 'yellow', 'gray', 'pink', 'orange'],
        default: 'gray'
    },
    
    // Is this category active and available for selection?
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    
    // Display order (lower numbers appear first)
    sortOrder: {
        type: Number,
        default: 0
    },
    
    // Is this a system-default category (cannot be deleted)
    isSystemDefault: {
        type: Boolean,
        default: false
    },
    
    // Metadata
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
    collection: 'globalactionhookcategories'
});

// Indexes for performance
globalActionHookCategorySchema.index({ isActive: 1, sortOrder: 1 });
globalActionHookCategorySchema.index({ categoryId: 1 });

// Static method: Get all active categories sorted by sortOrder
globalActionHookCategorySchema.statics.getActiveCategories = async function() {
    return await this.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .lean();
};

// Static method: Get category by ID
globalActionHookCategorySchema.statics.getByCategoryId = async function(categoryId) {
    return await this.findOne({ categoryId, isActive: true }).lean();
};

const GlobalActionHookCategory = mongoose.model('GlobalActionHookCategory', globalActionHookCategorySchema);

module.exports = GlobalActionHookCategory;

