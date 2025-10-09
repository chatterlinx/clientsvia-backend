/**
 * ============================================================================
 * GLOBAL ACTION HOOK MODEL
 * ============================================================================
 * 
 * PURPOSE:
 * Stores platform-wide action hooks that define what the AI should DO
 * after responding to a caller (escalate, schedule, send SMS, etc.)
 * 
 * ARCHITECTURE:
 * - Platform-wide action library
 * - Behaviors reference action hooks by hookId
 * - Each hook defines a specific post-response action
 * - Admins can add/edit/delete hooks from Action Hooks tab
 * 
 * DESIGN PHILOSOPHY:
 * - Separate "what to say" (behavior) from "what to do" (action hooks)
 * - Dynamic loading in behavior forms
 * - Clean integration with non-LLM AI engine
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const globalActionHookSchema = new Schema({
    // Unique identifier (used in behavior.actionHooks array)
    hookId: {
        type: String,
        required: true,
        unique: true,
        trim: true
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
    
    // What this action hook does (human-readable description)
    description: {
        type: String,
        required: true,
        trim: true
    },
    
    // Directory for organization (references GlobalActionHookDirectory.directoryId)
    directory: {
        type: String,
        trim: true,
        default: 'other',
        index: true
    },
    
    // Technical function name (for AI engine integration)
    // Example: "escalateToHuman", "offerScheduling", "sendPaymentLink"
    functionName: {
        type: String,
        trim: true,
        default: ''
    },
    
    // Parameters this action requires (JSON schema)
    // Example: { "requiresContactInfo": true, "requiresServiceType": false }
    parameters: {
        type: Schema.Types.Mixed,
        default: {}
    },
    
    // When to trigger this action (timing guidance)
    triggerTiming: {
        type: String,
        enum: ['immediately', 'after_response', 'on_confirmation', 'on_request'],
        default: 'after_response'
    },
    
    // Is this action hook active and available for selection?
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
    
    // Is this a system-default action (cannot be deleted)
    isSystemDefault: {
        type: Boolean,
        default: false
    },
    
    // Usage tracking
    usageCount: {
        type: Number,
        default: 0
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
    collection: 'globalactionhooks'
});

// Indexes for performance
globalActionHookSchema.index({ isActive: 1, sortOrder: 1 });
globalActionHookSchema.index({ category: 1 });

// Static method: Get all active action hooks sorted by category and sortOrder
globalActionHookSchema.statics.getActiveHooks = async function() {
    return await this.find({ isActive: true })
        .sort({ category: 1, sortOrder: 1, name: 1 })
        .lean();
};

// Static method: Get hooks by category
globalActionHookSchema.statics.getByCategory = async function(category) {
    return await this.find({ category, isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .lean();
};

// Static method: Get hook by ID
globalActionHookSchema.statics.getByHookId = async function(hookId) {
    return await this.findOne({ hookId, isActive: true }).lean();
};

// Static method: Increment usage count
globalActionHookSchema.statics.incrementUsage = async function(hookId) {
    return await this.findOneAndUpdate(
        { hookId },
        { $inc: { usageCount: 1 } },
        { new: true }
    );
};

const GlobalActionHook = mongoose.model('GlobalActionHook', globalActionHookSchema);

module.exports = GlobalActionHook;

