/**
 * ============================================================================
 * GLOBAL INSTANT RESPONSE TEMPLATE MODEL - V2.0 WORLD-CLASS AI ARCHITECTURE
 * ============================================================================
 * 
 * PURPOSE:
 * Platform-wide instant response library serving as the foundation for
 * intelligent, non-LLM AI agent receptionists. This is the "brain" that
 * makes AI sound impossibly human through:
 * - Hybrid matching (BM25 + embeddings + regex)
 * - Versioned, rollback-safe scenarios
 * - Entity capture with validation & prompting
 * - Confidence routing & fallback logic
 * - Multi-reply variations (anti-robotic)
 * - Timed follow-ups & silence handling
 * - State machine awareness
 * - Safety guardrails & PII masking
 * 
 * ARCHITECTURE V2.0:
 * - Scenarios are FIRST-CLASS resources (flat, many-to-many with categories)
 * - Versioning on every scenario (draft → live → archived)
 * - Hybrid retrieval: keyword + semantic + regex + context
 * - Confidence scoring with tie-breakers
 * - Bandit optimization on reply variants
 * - Per-scenario cooldowns to prevent spam
 * - Preconditions & effects for state machines
 * - Language detection & multilingual support
 * - Channel-aware (voice/sms/chat)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const { Schema } = mongoose;

/**
 * ============================================================================
 * ENHANCED SCENARIO SCHEMA V2.0 - WORLD-CLASS AI MATCHING
 * ============================================================================
 * 
 * INTELLIGENCE FEATURES:
 * 1. HYBRID MATCHING: BM25 keyword + embeddings + regex + negatives
 * 2. VERSIONING: draft/live/archived with rollback support
 * 3. CONFIDENCE ROUTING: Score thresholds with tie-breakers
 * 4. ENTITY CAPTURE: Store, validate, prompt for missing
 * 5. REPLY OPTIMIZATION: Bandit selection on variations
 * 6. STATE AWARENESS: Preconditions & effects for conversation flow
 * 7. SAFETY: PII masking, profanity filters, escalation rules
 * 8. MULTILINGUAL: Language detection & localized replies
 * 
 * ============================================================================
 */
const scenarioSchema = new Schema({
    // ============================================
    // IDENTITY & LIFECYCLE
    // ============================================
    
    scenarioId: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        index: true
        // ULID or UUID for stable, collision-free IDs across environments
    },
    
    version: {
        type: Number,
        required: true,
        default: 1,
        min: 1
        // Incremented on each publish; enables rollback
    },
    
    status: {
        type: String,
        enum: ['draft', 'live', 'archived'],
        default: 'draft',
        index: true
        // draft: editing, live: active matching, archived: historical
    },
    
    name: {
        type: String,
        required: true,
        trim: true
    },
    
    isActive: {
        type: Boolean,
        default: true
        // Quick on/off toggle without archiving
    },
    
    // ============================================
    // CATEGORIZATION & ORGANIZATION
    // ============================================
    
    categories: [{
        type: String,
        trim: true,
        index: true
        // Many-to-many: scenario can belong to multiple categories
        // Replaces deep nesting for flexibility
    }],
    
    priority: {
        type: Number,
        default: 0,
        min: -10,
        max: 100
        // Tie-breaker when multiple scenarios match with same score
        // Higher = more priority (e.g., emergency=100, neutral=0, smalltalk=-5)
    },
    
    cooldownSeconds: {
        type: Number,
        default: 0,
        min: 0
        // Prevents scenario from firing again within N seconds
        // Avoids repetitive "I hear you" spam
    },
    
    // ============================================
    // MULTILINGUAL & CHANNEL SUPPORT
    // ============================================
    
    language: {
        type: String,
        default: 'auto',
        trim: true,
        lowercase: true
        // 'auto' = detect from input, 'en', 'es', 'fr', etc.
    },
    
    channel: {
        type: String,
        enum: ['voice', 'sms', 'chat', 'any'],
        default: 'any'
        // Restrict scenario to specific channels
    },
    
    // ============================================
    // HYBRID MATCHING - THE INTELLIGENCE CORE
    // ============================================
    
    triggers: [{
        type: String,
        trim: true,
        lowercase: true,
        required: true
        // Plain phrases for BM25 keyword matching
    }],
    
    regexTriggers: [{
        type: String,
        trim: true
        // Power user: advanced pattern matching
        // Example: "\\b(hold|wait)\\s*(on|up)\\b"
    }],
    
    negativeTriggers: [{
        type: String,
        trim: true,
        lowercase: true
        // Phrases that PREVENT matching (avoid false positives)
        // Example: "don't hold" prevents Hold scenario from firing
    }],
    
    embeddingVector: {
        type: [Number],
        select: false
        // Precomputed semantic embedding for triggers
        // Generated from OpenAI ada-002 or similar
        // Used for cosine similarity matching
    },
    
    contextWeight: {
        type: Number,
        default: 0.7,
        min: 0,
        max: 1
        // Multiplier applied to final match score
        // Higher = more importance (e.g., emergency=0.95, chitchat=0.5)
    },
    
    // ============================================
    // STATE MACHINE & CONVERSATION FLOW
    // ============================================
    
    preconditions: {
        type: Map,
        of: Schema.Types.Mixed
        // Conditions that must be met for scenario to match
        // Example: {state: 'collecting_phone', hasEntity: ['name']}
    },
    
    effects: {
        type: Map,
        of: Schema.Types.Mixed
        // State changes to apply after scenario executes
        // Example: {setState: 'confirming', increment: {'holdCount': 1}}
    },
    
    // ============================================
    // REPLIES - MULTIPLE VARIATIONS FOR NATURAL SOUND
    // ============================================
    
    quickReplies: [{
        type: String,
        trim: true,
        required: true
        // Short acknowledgment replies (2-3 variations)
        // AI randomly selects to avoid robotic repetition
    }],
    
    fullReplies: [{
        type: String,
        trim: true,
        required: true
        // Expanded responses (2-3 variations)
        // Used for longer interactions or follow-ups
    }],
    
    followUpFunnel: {
        type: String,
        trim: true
        // Re-engagement prompt to guide back to call purpose
        // Example: "Alright — where were we? Let's get you booked!"
    },
    
    replySelection: {
        type: String,
        enum: ['sequential', 'random', 'bandit'],
        default: 'bandit'
        // sequential: rotate through replies in order
        // random: pick randomly
        // bandit: multi-armed bandit optimization (learn best performers)
    },
    
    // ============================================
    // ENTITY CAPTURE & DYNAMIC VARIABLES
    // ============================================
    
    entityCapture: [{
        type: String,
        trim: true
        // List of entities to extract from speech
        // Example: ['name', 'phone_number', 'address', 'technician']
    }],
    
    entityValidation: {
        type: Map,
        of: Schema.Types.Mixed
        // Validation rules per entity
        // Example: {phone_number: {regex: '^\\d{10}$', normalize: 'E.164'}}
    },
    
    dynamicVariables: {
        type: Map,
        of: String
        // Variable fallbacks when entity missing
        // Example: {technician: 'the team', name: 'the caller'}
    },
    
    // ============================================
    // ACTION HOOKS & INTEGRATIONS
    // ============================================
    
    actionHooks: [{
        type: String,
        trim: true
        // References to GlobalActionHook hookIds
        // Example: ['escalate_to_human', 'log_sentiment_positive']
    }],
    
    handoffPolicy: {
        type: String,
        enum: ['never', 'low_confidence', 'always_on_keyword'],
        default: 'low_confidence'
        // When to escalate to human
    },
    
    // ============================================
    // SENSITIVE DATA & SAFETY
    // ============================================
    
    sensitiveInfoRule: {
        type: String,
        enum: ['platform_default', 'custom'],
        default: 'platform_default'
        // Use platform-wide masking or custom rules
    },
    
    customMasking: {
        type: Map,
        of: String
        // Per-entity masking overrides
        // Example: {phone_number: 'last4', address: 'street_only'}
    },
    
    // ============================================
    // TIMING & HOLD BEHAVIOR
    // ============================================
    
    timedFollowUp: {
        enabled: {
            type: Boolean,
            default: false
        },
        delaySeconds: {
            type: Number,
            default: 50,
            min: 0
            // How long to wait before checking in
        },
        messages: [{
            type: String,
            trim: true
            // What to say at timeout (multiple variations)
        }],
        extensionSeconds: {
            type: Number,
            default: 30,
            min: 0
            // Additional time granted if caller requests more
        }
    },
    
    silencePolicy: {
        maxConsecutive: {
            type: Number,
            default: 2,
            min: 1
            // How many silent turns before taking action
        },
        finalWarning: {
            type: String,
            trim: true,
            default: 'Hello? Did I lose you?'
        }
    },
    
    // ============================================
    // VOICE & TTS CONTROL
    // ============================================
    
    toneLevel: {
        type: Number,
        min: 1,
        max: 5,
        default: 2
        // 1=flat, 2=calm, 3=warm, 4=excited, 5=urgent
        // Maps to TTS preset parameters
    },
    
    ttsOverride: {
        pitch: {
            type: String,
            trim: true
            // Example: '+5%', '-10%', '1.2'
        },
        rate: {
            type: String,
            trim: true
            // Example: '0.95', '1.1', 'fast'
        },
        volume: {
            type: String,
            trim: true
            // Example: 'normal', '+3dB', 'soft'
        }
    },
    
    // ============================================
    // METADATA & AUDIT
    // ============================================
    
    createdBy: {
        type: String,
        trim: true,
        default: 'Platform Admin'
    },
    
    updatedBy: {
        type: String,
        trim: true,
        default: 'Platform Admin'
    },
    
    createdAt: {
        type: Date,
        default: Date.now,
        immutable: true
    },
    
    updatedAt: {
        type: Date,
        default: Date.now
    },
    
    // ============================================
    // DEPRECATED/LEGACY FIELDS (for migration)
    // ============================================
    
    // OLD: single string replies (migrated to arrays)
    quickReply: {
        type: String,
        trim: true
        // DEPRECATED: use quickReplies[] instead
    },
    
    fullReply: {
        type: String,
        trim: true
        // DEPRECATED: use fullReplies[] instead
    },
    
    // Migration marker
    legacyMigrated: {
        type: Boolean,
        default: false
    }
    
}, { 
    _id: false,
    minimize: false,
    timestamps: false // We manage createdAt/updatedAt manually for precision
});

/**
 * ============================================================================
 * CATEGORY SCHEMA - SIMPLIFIED GROUPING
 * ============================================================================
 * 
 * Categories are now lightweight tags for organization.
 * Scenarios are first-class and can belong to multiple categories.
 * 
 * ============================================================================
 */
const categorySchema = new Schema({
    id: {
        type: String,
        required: true,
        trim: true
    },
    
    name: {
        type: String,
        required: true,
        trim: true
    },
    
    icon: {
        type: String,
        trim: true,
        default: '💬'
    },
    
    description: {
        type: String,
        required: true,
        trim: true
    },
    
    // 🎭 BEHAVIOR: Default AI behavior for scenarios in this category
    // Selected from GlobalAIBehaviorTemplate (dropdown)
    behavior: {
        type: String,
        required: true,
        trim: true
    },
    
    // Scenarios array (maintains current structure for now)
    scenarios: [scenarioSchema],
    
    isActive: {
        type: Boolean,
        default: true
    }
}, { _id: false });

/**
 * ============================================================================
 * MAIN GLOBAL TEMPLATE SCHEMA
 * ============================================================================
 */
const globalInstantResponseTemplateSchema = new Schema({
    version: {
        type: String,
        required: true,
        trim: true,
        unique: true,
        index: true
    },
    
    name: {
        type: String,
        required: true,
        trim: true,
        default: 'ClientVia.ai Global AI Receptionist Brain'
    },
    
    description: {
        type: String,
        trim: true
    },
    
    // Industry-specific template type
    templateType: {
        type: String,
        default: 'universal',
        trim: true,
        index: true
        // References GlobalIndustryType.industryId
    },
    
    industryLabel: {
        type: String,
        trim: true,
        default: 'All Industries'
    },
    
    // All categories in this template
    categories: [categorySchema],
    
    // Template status
    isActive: {
        type: Boolean,
        default: false
    },
    
    isPublished: {
        type: Boolean,
        default: false
    },
    
    isDefaultTemplate: {
        type: Boolean,
        default: false
    },
    
    // Statistics (auto-calculated)
    stats: {
        totalCategories: { type: Number, default: 0 },
        totalScenarios: { type: Number, default: 0 },
        totalTriggers: { type: Number, default: 0 }
    },
    
    // ============================================
    // 🔇 FILLER WORDS (NOISE FILTER)
    // ============================================
    // Global filter applied to ALL scenarios in this template
    // Removes conversational fluff before matching
    // Examples: "hi", "hey", "please", "you guys", "today"
    // Inherited by companies when they clone this template
    fillerWords: {
        type: [String],
        default: [
            'um', 'uh', 'like', 'you', 'know', 'i', 'mean', 'basically',
            'actually', 'so', 'well', 'okay', 'alright', 'right', 'the',
            'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were',
            'be', 'been', 'being', 'have', 'has', 'had', 'do', 'does',
            'did', 'will', 'would', 'should', 'could', 'can', 'may',
            'might', 'must', 'what', 'when', 'where', 'who', 'how', 'why',
            'please', 'thanks', 'thank', 'yes', 'no', 'yeah', 'yep', 'nope',
            'hi', 'hey', 'hello', 'you guys', 'today', 'there'
        ],
        trim: true
        // Each word is lowercased and trimmed
        // Applied during normalization in HybridScenarioSelector
    },
    
    // 📞 TWILIO TEST CONFIGURATION
    // Allows admin to test this template via dedicated test phone number
    // ISOLATED from production company phone numbers
    twilioTest: {
        enabled: {
            type: Boolean,
            default: false
            // Toggle ON to enable test calls, OFF to disable
        },
        phoneNumber: {
            type: String,
            trim: true,
            sparse: true,
            unique: true
            // Unique test phone number (e.g., +15551234567)
            // Twilio routes this number → this template's scenarios
        },
        accountSid: {
            type: String,
            trim: true
            // Twilio Account SID for this test number
        },
        authToken: {
            type: String,
            trim: true
            // Twilio Auth Token (store encrypted in production)
        },
        greeting: {
            type: String,
            trim: true,
            default: 'Welcome to the ClientsVia Global AI Brain Testing Center. You are currently testing the {template_name} template. Please ask questions or make statements to test the AI scenarios now.'
            // Custom greeting spoken when test calls connect
            // Use {template_name} placeholder for dynamic template name
        },
        lastTestedAt: {
            type: Date
            // Track when last tested
        },
        testCallCount: {
            type: Number,
            default: 0
            // Track how many test calls made
        },
        notes: {
            type: String,
            trim: true
            // Admin notes about testing
        }
    },
    
    // 🌳 LINEAGE TRACKING - Template Family Tree
    lineage: {
        isClone: { type: Boolean, default: false },
        clonedFrom: { type: Schema.Types.ObjectId, ref: 'GlobalInstantResponseTemplate' },
        clonedFromName: { type: String, trim: true },
        clonedFromVersion: { type: String, trim: true },
        clonedAt: { type: Date },
        clonedBy: { type: String, trim: true },
        parentLastUpdatedAt: { type: Date },
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
        parentUpdateCount: { type: Number, default: 0 },
        lastSyncCheck: { type: Date }
    },
    
    // Metadata
    createdBy: {
        type: String,
        trim: true,
        default: 'Platform Admin'
    },
    
    lastUpdatedBy: {
        type: String,
        trim: true,
        default: 'Platform Admin'
    },
    
    // Change log
    changeLog: [{
        changes: { type: String, trim: true },
        changedBy: { type: String, trim: true },
        date: { type: Date, default: Date.now }
    }],
    
    // ============================================
    // 📝 VARIABLE DEFINITIONS (TYPE SYSTEM)
    // ============================================
    // Structured definitions for company-specific variables
    // Replaces simple string array with typed, validated fields
    variableDefinitions: [{
        key: {
            type: String,
            required: true,
            trim: true
            // Variable key for replacement (e.g., 'companyName')
        },
        label: {
            type: String,
            required: true,
            trim: true
            // Human-readable label for UI (e.g., 'Company Name')
        },
        description: {
            type: String,
            trim: true
            // Help text explaining what this variable is for
        },
        type: {
            type: String,
            enum: ['text', 'email', 'phone', 'url', 'currency', 'enum', 'multiline'],
            default: 'text'
            // Data type determines validation and formatting
        },
        required: {
            type: Boolean,
            default: false
            // If true, company must fill this before going live
        },
        enumValues: [{
            type: String,
            trim: true
        }],
        // For enum type: allowed values
        validation: {
            type: Schema.Types.Mixed,
            default: {}
            // Optional regex, min/max, custom rules
        },
        example: {
            type: String,
            trim: true
            // Example value to guide users
        },
        category: {
            type: String,
            trim: true,
            default: 'General'
            // Group related variables (e.g., 'Pricing', 'Contact Info')
        },
        usageCount: {
            type: Number,
            default: 0
            // Auto-calculated: how many scenarios use this variable
        },
        placeholder: {
            type: String,
            trim: true
            // Default value if company hasn't filled it yet
        }
    }],
    
    // ============================================
    // 🚨 URGENCY KEYWORDS (EMERGENCY DETECTION)
    // ============================================
    // Database-driven keywords for emergency scenario detection
    // Boosts priority when detected in caller phrases
    urgencyKeywords: [{
        word: {
            type: String,
            required: true,
            trim: true,
            lowercase: true
            // Keyword to detect (e.g., 'emergency', 'urgent', 'leak')
        },
        weight: {
            type: Number,
            required: true,
            default: 0.2,
            min: 0.1,
            max: 0.5
            // Score boost when detected (0.1 = low urgency, 0.5 = critical)
        },
        category: {
            type: String,
            trim: true,
            default: 'General Emergency'
            // Group related keywords (e.g., 'Water Emergency', 'Safety Hazard')
        },
        examples: [{
            type: String,
            trim: true
        }]
        // Example phrases containing this keyword
    }]
    
}, { 
    timestamps: true,
    minimize: false
});

// ============================================
// INSTANCE METHODS
// ============================================

globalInstantResponseTemplateSchema.methods.addChangeLog = function(changes, changedBy) {
    if (!this.changeLog) {
        this.changeLog = [];
    }
    this.changeLog.push({
        changes,
        changedBy: changedBy || 'Platform Admin',
        date: new Date()
    });
    
    // 🔥 CRITICAL: Prevent memory leak - Keep only last 50 changelog entries
    // MongoDB has 16MB document limit - unbounded arrays will eventually crash
    if (this.changeLog.length > 50) {
        this.changeLog = this.changeLog.slice(-50); // Keep most recent 50
    }
};

globalInstantResponseTemplateSchema.methods.hasParent = function() {
    return this.lineage && this.lineage.isClone && this.lineage.clonedFrom;
};

globalInstantResponseTemplateSchema.methods.getParent = async function() {
    if (!this.hasParent()) return null;
    return await this.constructor.findById(this.lineage.clonedFrom);
};

globalInstantResponseTemplateSchema.methods.checkParentUpdates = async function() {
    const parent = await this.getParent();
    if (!parent) return { hasUpdates: false };
    
    const parentUpdated = parent.updatedAt;
    const lastSync = this.lineage.parentLastUpdatedAt;
    
    return {
        hasUpdates: parentUpdated > lastSync,
        parentUpdatedAt: parentUpdated,
        lastSyncedAt: lastSync
    };
};

globalInstantResponseTemplateSchema.methods.compareWithParent = async function() {
    const parent = await this.getParent();
    if (!parent) return null;
    
    // Build scenario maps for comparison
    const parentScenarios = new Map();
    const childScenarios = new Map();
    
    parent.categories.forEach(cat => {
        cat.scenarios.forEach(scenario => {
            parentScenarios.set(scenario.id, { ...scenario.toObject(), categoryId: cat.id, categoryName: cat.name });
        });
    });
    
    this.categories.forEach(cat => {
        cat.scenarios.forEach(scenario => {
            childScenarios.set(scenario.id, { ...scenario.toObject(), categoryId: cat.id, categoryName: cat.name });
        });
    });
    
    // Compare
    const added = [];
    const removed = [];
    const modified = [];
    const unchanged = [];
    
    // Check what's in parent but not in child (removed/available)
    parentScenarios.forEach((scenario, id) => {
        if (!childScenarios.has(id)) {
            removed.push(scenario);
        }
    });
    
    // Check what's in child
    childScenarios.forEach((scenario, id) => {
        if (!parentScenarios.has(id)) {
            added.push(scenario);
        } else {
            const parentVersion = parentScenarios.get(id);
            const childVersion = scenario;
            
            // Simple comparison (can be enhanced)
            if (JSON.stringify(parentVersion) !== JSON.stringify(childVersion)) {
                modified.push({
                    ...scenario,
                    parentVersion,
                    currentVersion: childVersion
                });
            } else {
                unchanged.push(scenario);
            }
        }
    });
    
    return {
        summary: {
            total: childScenarios.size,
            unchanged: unchanged.length,
            modified: modified.length,
            custom: added.length,
            availableToSync: removed.length
        },
        details: {
            added,
            removed,
            modified,
            unchanged,
            conflicts: modified // Scenarios that exist in both but are different
        }
    };
};

globalInstantResponseTemplateSchema.methods.recordModification = function(type, details) {
    if (!this.lineage) {
        this.lineage = { modifications: [] };
    }
    if (!this.lineage.modifications) {
        this.lineage.modifications = [];
    }
    
    this.lineage.modifications.push({
        type,
        ...details,
        modifiedAt: new Date()
    });
};

// ============================================
// STATIC METHODS
// ============================================

globalInstantResponseTemplateSchema.statics.getActiveTemplate = async function() {
    return await this.findOne({ isActive: true }).sort({ createdAt: -1 });
};

globalInstantResponseTemplateSchema.statics.getDefaultTemplate = async function() {
    return await this.findOne({ isDefaultTemplate: true, isPublished: true }).sort({ createdAt: -1 });
};

globalInstantResponseTemplateSchema.statics.cloneTemplate = async function(sourceTemplateId, newName, newVersion, templateType, industryLabel, createdBy) {
    const sourceTemplate = await this.findById(sourceTemplateId);
    if (!sourceTemplate) {
        throw new Error('Source template not found');
    }
    
    const newTemplate = new this({
        version: newVersion,
        name: newName,
        description: `Cloned from ${sourceTemplate.name} (${sourceTemplate.version})`,
        templateType: templateType || sourceTemplate.templateType,
        industryLabel: industryLabel || sourceTemplate.industryLabel,
        categories: JSON.parse(JSON.stringify(sourceTemplate.categories)),
        isActive: false,
        isPublished: false,
        isDefaultTemplate: false,
        createdBy: createdBy || 'Platform Admin',
        lastUpdatedBy: createdBy || 'Platform Admin',
        
        // 🌳 LINEAGE TRACKING
        lineage: {
            isClone: true,
            clonedFrom: sourceTemplateId,
            clonedFromName: sourceTemplate.name,
            clonedFromVersion: sourceTemplate.version,
            clonedAt: new Date(),
            clonedBy: createdBy || 'Platform Admin',
            parentLastUpdatedAt: sourceTemplate.updatedAt,
            modifications: [],
            parentUpdateCount: 0,
            lastSyncCheck: new Date()
        },
        
        changeLog: [{
            changes: `Cloned from ${sourceTemplate.name} (${sourceTemplate.version})`,
            changedBy: createdBy || 'Platform Admin',
            date: new Date()
        }]
    });
    
    await newTemplate.save();
    return newTemplate;
};

globalInstantResponseTemplateSchema.statics.getPublishedTemplates = async function() {
    return await this.find({ isPublished: true })
        .select('_id name version description templateType industryLabel stats createdAt updatedAt')
        .sort({ createdAt: -1 });
};

// ============================================
// INDEXES
// ============================================

globalInstantResponseTemplateSchema.index({ version: 1 });
globalInstantResponseTemplateSchema.index({ isActive: 1 });
globalInstantResponseTemplateSchema.index({ isPublished: 1 });
globalInstantResponseTemplateSchema.index({ isDefaultTemplate: 1 });
globalInstantResponseTemplateSchema.index({ templateType: 1 });
globalInstantResponseTemplateSchema.index({ 'lineage.clonedFrom': 1 });

const GlobalInstantResponseTemplate = mongoose.model('GlobalInstantResponseTemplate', globalInstantResponseTemplateSchema);

module.exports = GlobalInstantResponseTemplate;
