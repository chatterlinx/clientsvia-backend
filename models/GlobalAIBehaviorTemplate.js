/**
 * ============================================================================
 * GLOBAL AI BEHAVIOR TEMPLATE MODEL
 * ============================================================================
 * 
 * PURPOSE:
 * Stores pre-defined AI behavior templates that control how the AI agent
 * responds in different scenarios. Categories in the Global AI Brain inherit
 * one of these behaviors.
 * 
 * ARCHITECTURE:
 * - Platform-wide behavior library
 * - Each behavior defines tone, pace, instructions, and best use cases
 * - Categories reference behaviors by ID or name
 * - Admins can add/edit/delete behaviors from the Behaviors tab
 * 
 * DESIGN PHILOSOPHY:
 * - ONE source of truth for AI behavior
 * - Dynamic loading in category dropdowns
 * - Admin-controlled, no hard-coded lists
 * - Clean separation: behavior template vs scenario content
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

const globalAIBehaviorTemplateSchema = new Schema({
    // Unique identifier (used in category.behavior field)
    behaviorId: {
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
        default: '🎭'
    },
    
    // Tone of voice (affects TTS and text generation)
    tone: {
        type: String,
        enum: [
            'empathetic',
            'professional',
            'friendly',
            'urgent',
            'apologetic',
            'calm',
            'enthusiastic',
            'firm',
            'casual',
            'formal',
            'nurturing',
            'educational',
            'consultative',
            'reassuring'
        ],
        required: true
    },
    
    // Speaking pace (affects TTS)
    pace: {
        type: String,
        enum: ['slow', 'normal', 'fast'],
        required: true,
        default: 'normal'
    },
    
    // Detailed behavior instructions for AI
    instructions: {
        type: String,
        required: true,
        trim: true
    },
    
    // When to use this behavior (descriptive guidance)
    bestFor: {
        type: String,
        trim: true,
        default: ''
    },
    
    // Example scenarios where this behavior applies
    examples: [{
        type: String,
        trim: true
    }],
    
    // Is this behavior active and available for selection?
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
    
    // Is this a system-default behavior (cannot be deleted)
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
    collection: 'globalaibehaviortemplates'
});

// Indexes for performance
globalAIBehaviorTemplateSchema.index({ isActive: 1, sortOrder: 1 });
globalAIBehaviorTemplateSchema.index({ behaviorId: 1 });

// Static method: Get all active behaviors sorted by sortOrder
globalAIBehaviorTemplateSchema.statics.getActiveBehaviors = async function() {
    return await this.find({ isActive: true })
        .sort({ sortOrder: 1, name: 1 })
        .lean();
};

// Static method: Get behavior by ID
globalAIBehaviorTemplateSchema.statics.getByBehaviorId = async function(behaviorId) {
    return await this.findOne({ behaviorId, isActive: true }).lean();
};

// Static method: Increment usage count
globalAIBehaviorTemplateSchema.statics.incrementUsage = async function(behaviorId) {
    return await this.findOneAndUpdate(
        { behaviorId },
        { $inc: { usageCount: 1 } },
        { new: true }
    );
};

const GlobalAIBehaviorTemplate = mongoose.model('GlobalAIBehaviorTemplate', globalAIBehaviorTemplateSchema);

module.exports = GlobalAIBehaviorTemplate;

