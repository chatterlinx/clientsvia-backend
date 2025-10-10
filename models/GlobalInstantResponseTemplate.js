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
 * SCENARIO SCHEMA - SIMPLIFIED FOR MAXIMUM CLARITY
 * Individual conversation scenario with triggers and multiple response variations
 * 
 * DESIGN PHILOSOPHY:
 * - Scenarios are PURE trigger → response mappings
 * - Behavior is inherited from the parent Category
 * - No priority/tone/pace conflicts - category behavior controls all
 * - Multiple response variations prevent robotic repetition
 */
const scenarioSchema = new Schema({
    // Unique identifier for this scenario
    id: {
        type: String,
        required: true,
        trim: true
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
    
    // 🔄 QUICK REPLIES: Multiple variations to avoid sounding robotic (2-3 variations)
    // AI randomly selects from this array
    quickReplies: [{
        type: String,
        trim: true,
        required: true
    }],
    
    // 🔄 FULL REPLIES: Multiple variations for natural conversation (2-3 variations)
    // AI randomly selects from this array
    fullReplies: [{
        type: String,
        trim: true,
        required: true
    }],
    
    // Is this scenario active?
    isActive: {
        type: Boolean,
        default: true
    },
    
    // ============================================
    // SMART HOLD CONFIGURATION (optional)
    // ============================================
    
    // Enable smart hold for this scenario (customer says "hold on", "let me check", etc.)
    enableSmartHold: {
        type: Boolean,
        default: false
    },
    
    // Smart hold settings (only applies if enableSmartHold = true)
    smartHoldConfig: {
        // Timeout intervals in seconds (when to check in with customer)
        timeoutIntervals: {
            type: [Number],
            default: [60, 120, 180]  // Check at 1min, 2min, 3min
        },
        
        // Maximum hold duration in seconds (after this, offer callback)
        maxDuration: {
            type: Number,
            default: 300  // 5 minutes max
        },
        
        // Enable active listening (monitor for customer speech during hold)
        activeListening: {
            type: Boolean,
            default: true
        },
        
        // Custom check-in messages (what AI says at each timeout)
        checkInMessages: [{
            type: String,
            trim: true
        }],
        
        // What to say if max duration exceeded
        maxDurationMessage: {
            type: String,
            trim: true,
            default: "I want to make sure I'm still helping — would you like me to call you back when you're ready?"
        }
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
    }
}, { _id: false });

/**
 * CATEGORY SCHEMA - SIMPLIFIED FOR MAXIMUM CLARITY
 * Grouping of related scenarios (e.g., "Empathy", "Scheduling", "Safety")
 * 
 * DESIGN PHILOSOPHY:
 * - Categories define ONE behavior template that ALL scenarios inherit
 * - No priority scale - behavior template controls matching importance
 * - No type field - behavior template IS the type
 * - Clean, simple, world-class structure
 */
const categorySchema = new Schema({
    // Unique identifier for this category
    id: {
        type: String,
        required: true,
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
        default: '💬'
    },
    
    // Detailed description of category purpose and behavior
    description: {
        type: String,
        required: true,
        trim: true
    },
    
    // 🎭 BEHAVIOR: AI instruction template inherited by all scenarios
    // Selected from 15 pre-defined behavior templates (e.g., "Empathetic & Reassuring")
    // This controls tone, pace, structure - ONE source of truth
    behavior: {
        type: String,
        required: true,
        trim: true
    },
    
    // All scenarios within this category
    scenarios: [scenarioSchema],
    
    // Is this category active?
    isActive: {
        type: Boolean,
        default: true
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
    
    // Template type / industry specialization (references GlobalIndustryType.industryId)
    templateType: {
        type: String,
        default: 'universal',
        trim: true,
        index: true
    },
    
    // Industry-specific label (for UI display)
    industryLabel: {
        type: String,
        trim: true,
        default: 'Universal (All Industries)'
    },
    
    // Is this template available for companies to select?
    isPublished: {
        type: Boolean,
        default: true,
        index: true
    },
    
    // Is this the default template for new companies?
    isDefaultTemplate: {
        type: Boolean,
        default: false,
        index: true
    },
    
    // Is this the active template? (LEGACY - kept for backwards compatibility)
    // Note: Now we use isDefaultTemplate instead
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
    
    // 🌳 LINEAGE TRACKING - Template Family Tree
    // Tracks parent-child relationships when templates are cloned
    lineage: {
        // Was this template cloned from another?
        isClone: {
            type: Boolean,
            default: false
        },
        
        // Parent template ID (if cloned)
        clonedFrom: {
            type: Schema.Types.ObjectId,
            ref: 'GlobalInstantResponseTemplate'
        },
        
        // Parent template name at time of cloning
        clonedFromName: {
            type: String,
            trim: true
        },
        
        // Parent template version at time of cloning
        clonedFromVersion: {
            type: String,
            trim: true
        },
        
        // When was this template cloned?
        clonedAt: {
            type: Date
        },
        
        // Who cloned this template?
        clonedBy: {
            type: String,
            trim: true
        },
        
        // Parent's last update date at time of cloning
        parentLastUpdatedAt: {
            type: Date
        },
        
        // Track custom modifications made after cloning
        modifications: [{
            type: {
                type: String,
                enum: ['category_added', 'category_removed', 'category_modified',
                       'scenario_added', 'scenario_removed', 'scenario_modified'],
                required: true
            },
            categoryId: { type: String, trim: true },
            categoryName: { type: String, trim: true },
            scenarioId: { type: String, trim: true },
            scenarioName: { type: String, trim: true },
            description: { type: String, trim: true },
            modifiedBy: { type: String, trim: true },
            modifiedAt: { type: Date, default: Date.now }
        }],
        
        // Cached count of how many updates parent has since cloning
        parentUpdateCount: {
            type: Number,
            default: 0
        },
        
        // Last time we checked for parent updates
        lastSyncCheck: {
            type: Date
        }
    },
    
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
 * Get the current active global template (LEGACY - use getDefaultTemplate instead)
 */
globalInstantResponseTemplateSchema.statics.getActiveTemplate = async function() {
    return await this.findOne({ isActive: true })
        .sort({ createdAt: -1 })
        .lean();
};

/**
 * Get the default template for new companies
 */
globalInstantResponseTemplateSchema.statics.getDefaultTemplate = async function() {
    return await this.findOne({ isDefaultTemplate: true, isPublished: true })
        .sort({ createdAt: -1 })
        .lean();
};

/**
 * Get all published templates (for selection dropdown)
 */
globalInstantResponseTemplateSchema.statics.getPublishedTemplates = async function() {
    return await this.find({ isPublished: true })
        .sort({ templateType: 1, name: 1 })
        .select('_id version name description templateType industryLabel isDefaultTemplate')
        .lean();
};

/**
 * Get templates by type
 */
globalInstantResponseTemplateSchema.statics.getTemplatesByType = async function(templateType) {
    return await this.find({ templateType, isPublished: true })
        .sort({ name: 1 })
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
        templateType: sourceTemplate.templateType,
        industryLabel: sourceTemplate.industryLabel,
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
 * Clone template for new industry
 */
globalInstantResponseTemplateSchema.statics.cloneTemplate = async function(sourceTemplateId, newData, createdBy) {
    const sourceTemplate = await this.findById(sourceTemplateId).lean();
    
    if (!sourceTemplate) {
        throw new Error('Source template not found');
    }
    
    const newTemplate = new this({
        version: newData.version || `${sourceTemplate.version}-${newData.templateType}`,
        name: newData.name,
        description: newData.description,
        templateType: newData.templateType,
        industryLabel: newData.industryLabel,
        isPublished: newData.isPublished !== undefined ? newData.isPublished : false,
        isDefaultTemplate: false,
        isActive: false,
        categories: sourceTemplate.categories, // Clone all categories
        previousVersion: sourceTemplateId,
        createdBy: createdBy || 'Platform Admin',
        changeLog: [{
            changes: `Cloned from ${sourceTemplate.name} (${sourceTemplate.templateType})`,
            changedBy: createdBy || 'Platform Admin'
        }],
        
        // 🌳 LINEAGE TRACKING - Record parent relationship
        lineage: {
            isClone: true,
            clonedFrom: sourceTemplateId,
            clonedFromName: sourceTemplate.name,
            clonedFromVersion: sourceTemplate.version,
            clonedAt: new Date(),
            clonedBy: createdBy || 'Platform Admin',
            parentLastUpdatedAt: sourceTemplate.updatedAt,
            modifications: [], // Start with empty modifications array
            parentUpdateCount: 0,
            lastSyncCheck: new Date()
        }
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

/**
 * 🌳 LINEAGE METHODS
 */

/**
 * Check if this template has a parent (was cloned)
 */
globalInstantResponseTemplateSchema.methods.hasParent = function() {
    return this.lineage && this.lineage.isClone && this.lineage.clonedFrom;
};

/**
 * Get parent template
 */
globalInstantResponseTemplateSchema.methods.getParent = async function() {
    if (!this.hasParent()) return null;
    return await this.constructor.findById(this.lineage.clonedFrom);
};

/**
 * Check if parent has updates since cloning
 */
globalInstantResponseTemplateSchema.methods.checkParentUpdates = async function() {
    if (!this.hasParent()) return { hasUpdates: false };
    
    const parent = await this.getParent();
    if (!parent) return { hasUpdates: false, error: 'Parent template not found' };
    
    // Compare parent's updatedAt with our clonedAt
    const hasUpdates = parent.updatedAt > this.lineage.clonedAt;
    
    // Count parent's changelog entries since cloning
    const newChanges = parent.changeLog.filter(log => 
        log.date > this.lineage.clonedAt
    );
    
    return {
        hasUpdates,
        parentUpdatedAt: parent.updatedAt,
        clonedAt: this.lineage.clonedAt,
        newChangeCount: newChanges.length,
        changes: newChanges
    };
};

/**
 * Compare scenarios with parent template
 * Returns: { added, removed, modified, unchanged }
 */
globalInstantResponseTemplateSchema.methods.compareWithParent = async function() {
    if (!this.hasParent()) return null;
    
    const parent = await this.getParent();
    if (!parent) return null;
    
    const comparison = {
        added: [],      // Scenarios in child but not in parent
        removed: [],    // Scenarios in parent but not in child
        modified: [],   // Scenarios that exist in both but differ
        unchanged: [],  // Scenarios that are identical
        conflicts: []   // Scenarios modified in both child and parent
    };
    
    // Build maps for easy lookup
    const parentScenarios = new Map();
    const childScenarios = new Map();
    
    parent.categories.forEach(cat => {
        cat.scenarios.forEach(scenario => {
            const key = `${cat.id}:${scenario.id}`;
            parentScenarios.set(key, { category: cat, scenario });
        });
    });
    
    this.categories.forEach(cat => {
        cat.scenarios.forEach(scenario => {
            const key = `${cat.id}:${scenario.id}`;
            childScenarios.set(key, { category: cat, scenario });
        });
    });
    
    // Find scenarios in parent but not in child (removed or not inherited)
    parentScenarios.forEach((value, key) => {
        if (!childScenarios.has(key)) {
            comparison.removed.push({
                categoryId: value.category.id,
                categoryName: value.category.name,
                scenarioId: value.scenario.id,
                scenarioName: value.scenario.name,
                action: 'available_to_add'
            });
        }
    });
    
    // Find scenarios in child but not in parent (custom additions)
    childScenarios.forEach((value, key) => {
        if (!parentScenarios.has(key)) {
            comparison.added.push({
                categoryId: value.category.id,
                categoryName: value.category.name,
                scenarioId: value.scenario.id,
                scenarioName: value.scenario.name,
                action: 'custom'
            });
        }
    });
    
    // Compare common scenarios
    childScenarios.forEach((childValue, key) => {
        if (parentScenarios.has(key)) {
            const parentValue = parentScenarios.get(key);
            const childScenario = childValue.scenario;
            const parentScenario = parentValue.scenario;
            
            // Simple comparison: check if triggers or replies changed
            const triggersChanged = JSON.stringify(childScenario.triggers) !== JSON.stringify(parentScenario.triggers);
            const quickRepliesChanged = JSON.stringify(childScenario.quickReplies) !== JSON.stringify(parentScenario.quickReplies);
            const fullRepliesChanged = JSON.stringify(childScenario.fullReplies) !== JSON.stringify(parentScenario.fullReplies);
            
            const isModified = triggersChanged || quickRepliesChanged || fullRepliesChanged;
            
            // Check if parent scenario was updated after cloning
            const parentUpdatedAfterClone = parentScenario.lastUpdated && 
                                           parentScenario.lastUpdated > this.lineage.clonedAt;
            
            // Check if this scenario was modified in child
            const childModified = this.lineage.modifications.some(mod => 
                mod.scenarioId === childScenario.id && mod.categoryId === childValue.category.id
            );
            
            if (isModified) {
                if (childModified && parentUpdatedAfterClone) {
                    // CONFLICT: Modified in both parent and child
                    comparison.conflicts.push({
                        categoryId: childValue.category.id,
                        categoryName: childValue.category.name,
                        scenarioId: childScenario.id,
                        scenarioName: childScenario.name,
                        childVersion: childScenario,
                        parentVersion: parentScenario,
                        action: 'resolve_conflict'
                    });
                } else {
                    comparison.modified.push({
                        categoryId: childValue.category.id,
                        categoryName: childValue.category.name,
                        scenarioId: childScenario.id,
                        scenarioName: childScenario.name,
                        modifiedInParent: parentUpdatedAfterClone,
                        modifiedInChild: childModified,
                        action: childModified ? 'keep_custom' : 'sync_available'
                    });
                }
            } else {
                comparison.unchanged.push({
                    categoryId: childValue.category.id,
                    categoryName: childValue.category.name,
                    scenarioId: childScenario.id,
                    scenarioName: childScenario.name
                });
            }
        }
    });
    
    return comparison;
};

/**
 * Record a modification for lineage tracking
 */
globalInstantResponseTemplateSchema.methods.recordModification = function(type, details, modifiedBy) {
    if (!this.lineage) {
        this.lineage = { modifications: [] };
    }
    
    this.lineage.modifications.push({
        type,
        categoryId: details.categoryId,
        categoryName: details.categoryName,
        scenarioId: details.scenarioId,
        scenarioName: details.scenarioName,
        description: details.description,
        modifiedBy,
        modifiedAt: new Date()
    });
};

const GlobalInstantResponseTemplate = mongoose.model('GlobalInstantResponseTemplate', globalInstantResponseTemplateSchema);

module.exports = GlobalInstantResponseTemplate;

