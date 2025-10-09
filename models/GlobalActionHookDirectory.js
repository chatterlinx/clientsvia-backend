/**
 * ============================================================================
 * GLOBAL ACTION HOOK DIRECTORY MODEL
 * ============================================================================
 * 
 * PURPOSE:
 * Defines directories for organizing action hooks (e.g., Escalation, Scheduling,
 * Communication, Payment, etc.). Directories are dynamic and admin-manageable.
 * 
 * ARCHITECTURE:
 * - Platform-wide directory library
 * - Action hooks reference directories by directoryId
 * - Admins can add/edit/delete directories from UI
 * - Displayed in dropdowns when creating/editing hooks
 * 
 * DESIGN PHILOSOPHY:
 * - Dynamic, not hardcoded
 * - Future-proof for industry-specific needs
 * - Clean separation: directories define organization, hooks define actions
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const globalActionHookDirectorySchema = new Schema({
    // Unique identifier (used in hook.directory field)
    directoryId: {
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
    
    // Description of what this directory is for
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
    
    // Is this directory active and available for selection?
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
    
    // Is this a system-default directory (cannot be deleted)
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
    collection: 'globalactionhookdirectories'
});

// Indexes for performance
globalActionHookDirectorySchema.index({ isActive: 1, sortOrder: 1 });
globalActionHookDirectorySchema.index({ directoryId: 1 });

// Static method: Get all active directories sorted by sortOrder
globalActionHookDirectorySchema.statics.getActiveDirectories = async function() {
    return await this.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .lean();
};

// Static method: Get directory by ID
globalActionHookDirectorySchema.statics.getByDirectoryId = async function(directoryId) {
    return await this.findOne({ directoryId, isActive: true }).lean();
};

const GlobalActionHookDirectory = mongoose.model('GlobalActionHookDirectory', globalActionHookDirectorySchema);

module.exports = GlobalActionHookDirectory;
