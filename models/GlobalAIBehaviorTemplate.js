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
    
    // ============================================
    // VOCAL CHARACTERISTICS (for non-LLM AI voice synthesis)
    // ============================================
    
    // Tone: How the AI should sound emotionally
    tone: {
        type: String,
        enum: ['calm', 'empathetic', 'urgent', 'cheerful', 'professional', 'reassuring', 'apologetic', 'friendly', 'firm', 'neutral'],
        default: 'professional',
        index: true
    },
    
    // Pace: Speed of speech
    pace: {
        type: String,
        enum: ['very_slow', 'slow', 'normal', 'fast', 'very_fast'],
        default: 'normal'
    },
    
    // Volume: Loudness/intensity of voice
    volume: {
        type: String,
        enum: ['soft', 'gentle', 'normal', 'firm', 'strong'],
        default: 'normal'
    },
    
    // Emotion Intensity: How strong is the emotional context (1=mild, 5=severe)
    emotionIntensity: {
        type: Number,
        min: 1,
        max: 5,
        default: 3
    },
    
    // ============================================
    // ACTION HOOKS (what AI should do after responding)
    // ============================================
    
    // Array of action hook IDs that apply to this behavior
    // Example: ['escalate_to_human', 'offer_scheduling']
    actionHooks: [{
        type: String,
        trim: true
    }],
    
    // ============================================
    // INSTRUCTIONS & GUIDANCE
    // ============================================
    
    // Detailed behavior instructions for AI (human-readable guidance)
    // This is plain English instructions that tell the AI exactly how to behave
    // Example: "Calm, slow pace, validating feelings, brief reassurance then practical next step"
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

