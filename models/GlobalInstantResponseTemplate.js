/**
 * ============================================================================
 * GLOBAL INSTANT RESPONSE TEMPLATE MODEL
 * ============================================================================
 * 
 * PURPOSE:
 * Platform-wide instant response library that serves as the foundation for
 * ALL companies. This is the "brain" of the AI agent receptionist, containing
 * 100+ human-like conversation scenarios covering emotional intelligence,
 * call flow management, safety protocols, accessibility, and edge cases.
 * 
 * ARCHITECTURE:
 * - ONE active global template exists at any time (isActive: true)
 * - Contains 103 categories organized by behavior type
 * - Each category has multiple scenarios with triggers and responses
 * - When a company is created, they receive a COPY of this template
 * - Companies can customize their copy without affecting the global template
 * - Version control allows tracking changes and rollbacks
 * 
 * INTEGRATION:
 * - Admin UI: /admin/global-instant-responses (full CRUD access)
 * - Company Creation: Auto-copies template to new company
 * - Company UI: Can "Reset to Platform Default" to re-sync
 * - AI Matching Engine: Uses these scenarios for intent recognition
 * 
 * DATA FLOW:
 * 1. Admin creates/updates global template via admin dashboard
 * 2. Template is marked as active (only one active at a time)
 * 3. New company signup → auto-copy template to InstantResponseCategory collection
 * 4. Company customizes their copy (add/edit/delete scenarios)
 * 5. Company can reset to global template anytime (re-copy)
 * 
 * WORLD-CLASS AI FEATURES:
 * - Emotional intelligence (empathy, urgency, frustration, joy)
 * - Human behavior handling (distractions, off-topic, silence)
 * - Safety protocols (medical emergency, hazards, abuse)
 * - Accessibility support (language barriers, hearing impaired, elderly)
 * - Edge case coverage (robocalls, pranks, legal threats)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * SCENARIO SCHEMA
 * Individual conversation scenario with triggers, responses, and escalation rules
 */
const scenarioSchema = new Schema({
    // Unique identifier for this scenario
    id: {
        type: String,
        required: true,
        trim: true,
        index: true
    },
    
    // Display name
    name: {
        type: String,
        required: true,
        trim: true
    },
    
    // Trigger phrases that activate this scenario
    // These are matched against user input using semantic similarity
    triggers: [{
        type: String,
        required: true,
        trim: true,
        lowercase: true
    }],
    
    // 🆕 KEYWORDS: Extracted from triggers for fast matching
    // Auto-generated from triggers using KeywordGenerationService
    keywords: [{
        type: String,
        trim: true,
        lowercase: true,
        index: true
    }],
    
    // 🆕 Q&A PAIRS: Pre-generated question-answer pairs for training
    // Each trigger becomes a question, fullReply becomes the answer
    qnaPairs: [{
        question: { type: String, trim: true, lowercase: true },
        answer: { type: String, trim: true },
        confidence: { type: Number, default: 0.85, min: 0, max: 1 }
    }],
    
    // 🎭 BEHAVIOR: AI's instruction manual for this scenario
    // Tells the AI HOW to respond (e.g., "Short apology, explain policy, offer alternatives")
    behavior: {
        type: String,
        trim: true,
        default: ''
    },
    
    // Quick reply (1 sentence) for fast response
    quickReply: {
        type: String,
        required: false, // Made optional since we now use quickReplies array
        trim: true
    },
    
    // 🔄 QUICK REPLIES: Multiple variations to avoid sounding robotic
    // AI randomly selects from this array
    quickReplies: [{
        type: String,
        trim: true
    }],
    
    // Full conversational reply (TTS/detailed)
    fullReply: {
        type: String,
        required: false, // Made optional since we now use fullReplies array
        trim: true
    },
    
    // 🔄 FULL REPLIES: Multiple variations for natural conversation
    // AI randomly selects from this array
    fullReplies: [{
        type: String,
        trim: true
    }],
    
    // 🎲 ROTATION MODE: How to select response variations
    rotationMode: {
        type: String,
        enum: ['random', 'sequential', 'weighted'],
        default: 'random'
    },
    
    // Tone indicators for TTS and behavior
    tone: {
        type: String,
        enum: [
            'empathetic',
            'urgent',
            'calm',
            'professional',
            'friendly',
            'apologetic',
            'firm',
            'reassuring',
            'enthusiastic'
        ],
        default: 'professional'
    },
    
    // Speaking pace for TTS
    pace: {
        type: String,
        enum: ['slow', 'normal', 'fast'],
        default: 'normal'
    },
    
    // Escalation rules and flags
    escalationFlags: [{
        type: String,
        trim: true
    }],
    
    // Example conversations for training/reference
    examples: [{
        caller: { type: String, trim: true },
        ai: { type: String, trim: true }
    }],
    
    // Priority level (higher = checked first)
    priority: {
        type: Number,
        default: 5,
        min: 1,
        max: 10
    },
    
    // Is this scenario active?
    isActive: {
        type: Boolean,
        default: true
    },
    
    // 🆕 VERSION TRACKING: For sync comparison
    version: {
        type: String,
        default: '1.0'
    },
    
    // 🆕 LAST UPDATED: Track when scenario was modified
    lastUpdated: {
        type: Date,
        default: Date.now
    },
    
    // 🆕 CONFIDENCE THRESHOLD: Minimum confidence for matching
    confidenceThreshold: {
        type: Number,
        default: 0.75,
        min: 0,
        max: 1
    }
}, { _id: false });

/**
 * CATEGORY SCHEMA
 * Grouping of related scenarios (e.g., "Empathy", "Scheduling", "Safety")
 */
const categorySchema = new Schema({
    // Unique identifier for this category
    id: {
        type: String,
        required: true,
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
        default: '💬'
    },
    
    // Detailed description of category purpose and behavior
    description: {
        type: String,
        required: true,
        trim: true
    },
    
    // Priority level for matching (higher = checked first)
    // Safety and emergency categories should have priority 10
    priority: {
        type: Number,
        default: 5,
        min: 1,
        max: 10
    },
    
    // All scenarios within this category
    scenarios: [scenarioSchema],
    
    // Is this category active?
    isActive: {
        type: Boolean,
        default: true
    },
    
    // Category type for filtering
    type: {
        type: String,
        enum: [
            'emotional_intelligence',
            'call_flow',
            'scheduling',
            'payment',
            'problem_resolution',
            'safety_emergency',
            'accessibility',
            'customer_types',
            'small_talk',
            'edge_cases',
            'outbound'
        ],
        default: 'emotional_intelligence'
    }
}, { _id: false });

/**
 * MAIN GLOBAL TEMPLATE SCHEMA
 */
const globalInstantResponseTemplateSchema = new Schema({
    // Template version identifier
    version: {
        type: String,
        required: true,
        trim: true,
        unique: true,
        index: true
    },
    
    // Display name for this template
    name: {
        type: String,
        required: true,
        trim: true,
        default: 'ClientVia.ai Global AI Receptionist Brain'
    },
    
    // Detailed description
    description: {
        type: String,
        trim: true,
        default: 'World-class AI agent instant response library with 100+ human-like conversation scenarios'
    },
    
    // Is this the active template?
    // Only ONE template can be active at a time
    isActive: {
        type: Boolean,
        default: false,
        index: true
    },
    
    // All 103 categories
    categories: [categorySchema],
    
    // Metadata
    stats: {
        totalCategories: { type: Number, default: 0 },
        totalScenarios: { type: Number, default: 0 },
        totalTriggers: { type: Number, default: 0 }
    },
    
    // Version control
    previousVersion: {
        type: Schema.Types.ObjectId,
        ref: 'GlobalInstantResponseTemplate'
    },
    
    // Changelog
    changeLog: [{
        date: { type: Date, default: Date.now },
        changes: { type: String, trim: true },
        changedBy: { type: String, trim: true }
    }],
    
    // Creation tracking
    createdBy: {
        type: String,
        trim: true,
        default: 'Platform Admin'
    },
    
    lastUpdatedBy: {
        type: String,
        trim: true
    }
}, {
    timestamps: true,
    collection: 'globalinstantresponsetemplates'
});

/**
 * INDEXES
 * Optimize for common queries
 */
globalInstantResponseTemplateSchema.index({ isActive: 1, version: 1 });
globalInstantResponseTemplateSchema.index({ 'categories.id': 1 });
globalInstantResponseTemplateSchema.index({ 'categories.scenarios.id': 1 });

/**
 * PRE-SAVE MIDDLEWARE
 * Calculate stats before saving
 */
globalInstantResponseTemplateSchema.pre('save', function(next) {
    if (this.categories && this.categories.length > 0) {
        this.stats.totalCategories = this.categories.filter(cat => cat.isActive).length;
        
        let scenarioCount = 0;
        let triggerCount = 0;
        
        this.categories.forEach(category => {
            if (category.isActive && category.scenarios) {
                scenarioCount += category.scenarios.filter(s => s.isActive).length;
                category.scenarios.forEach(scenario => {
                    if (scenario.isActive && scenario.triggers) {
                        triggerCount += scenario.triggers.length;
                    }
                });
            }
        });
        
        this.stats.totalScenarios = scenarioCount;
        this.stats.totalTriggers = triggerCount;
    }
    
    next();
});

/**
 * STATIC METHODS
 */

/**
 * Get the current active global template
 */
globalInstantResponseTemplateSchema.statics.getActiveTemplate = async function() {
    return await this.findOne({ isActive: true })
        .sort({ createdAt: -1 })
        .lean();
};

/**
 * Set a template as active (deactivates all others)
 */
globalInstantResponseTemplateSchema.statics.setActiveTemplate = async function(templateId) {
    // Deactivate all templates
    await this.updateMany({}, { isActive: false });
    
    // Activate the specified template
    return await this.findByIdAndUpdate(
        templateId,
        { isActive: true },
        { new: true }
    );
};

/**
 * Create a new version from existing template
 */
globalInstantResponseTemplateSchema.statics.createNewVersion = async function(sourceTemplateId, newVersionName, changedBy) {
    const sourceTemplate = await this.findById(sourceTemplateId).lean();
    
    if (!sourceTemplate) {
        throw new Error('Source template not found');
    }
    
    const newTemplate = new this({
        version: newVersionName,
        name: sourceTemplate.name,
        description: sourceTemplate.description,
        categories: sourceTemplate.categories,
        previousVersion: sourceTemplateId,
        createdBy: changedBy,
        changeLog: [{
            changes: `Created from version ${sourceTemplate.version}`,
            changedBy: changedBy
        }]
    });
    
    return await newTemplate.save();
};

/**
 * INSTANCE METHODS
 */

/**
 * Get category by ID
 */
globalInstantResponseTemplateSchema.methods.getCategoryById = function(categoryId) {
    return this.categories.find(cat => cat.id === categoryId);
};

/**
 * Get scenario by category ID and scenario ID
 */
globalInstantResponseTemplateSchema.methods.getScenarioById = function(categoryId, scenarioId) {
    const category = this.getCategoryById(categoryId);
    if (!category) return null;
    
    return category.scenarios.find(s => s.id === scenarioId);
};

/**
 * Add change log entry
 */
globalInstantResponseTemplateSchema.methods.addChangeLog = function(changes, changedBy) {
    this.changeLog.push({
        changes,
        changedBy
    });
    this.lastUpdatedBy = changedBy;
};

const GlobalInstantResponseTemplate = mongoose.model('GlobalInstantResponseTemplate', globalInstantResponseTemplateSchema);

module.exports = GlobalInstantResponseTemplate;

