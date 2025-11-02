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
        trim: true
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
        default: 'draft'
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
        trim: true
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
    
    // 🎭 BEHAVIOR: AI personality for this scenario
    // Selected from GlobalAIBehaviorTemplate (dropdown)
    // Controls tone, pace, volume, emotion intensity, and instructions
    behavior: {
        type: String,
        trim: true,
        default: null
        // References GlobalAIBehaviorTemplate.behaviorId
        // If null, inherits from parent category's behavior
    },
    
    toneLevel: {
        type: Number,
        min: 1,
        max: 5,
        default: 2
        // DEPRECATED: Use 'behavior' field instead
        // 1=flat, 2=calm, 3=warm, 4=excited, 5=urgent
        // Kept for backwards compatibility with existing scenarios
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
    // DEPRECATED: Scenarios control their own behavior (more flexible)
    // Kept for backward compatibility with existing categories
    behavior: {
        type: String,
        required: false,  // FIX: Made optional (scenarios control their own behavior)
        trim: true,
        default: null
    },
    
    // Scenarios array (maintains current structure for now)
    scenarios: [scenarioSchema],
    
    isActive: {
        type: Boolean,
        default: true
    },
    
    // ============================================
    // 🔇 CATEGORY-LEVEL FILLER WORDS (EXTENDS TEMPLATE)
    // ============================================
    // Additional fillers specific to this category
    // Combined with template fillers for effective filler list
    // Example: "thingy", "thing", "contraption" for Thermostats category
    additionalFillerWords: {
        type: [String],
        default: [],
        trim: true
        // Extends template.fillerWords
        // All scenarios in category inherit: template + category fillers
    },
    
    // ============================================
    // 🔤 CATEGORY-LEVEL SYNONYM MAPPING
    // ============================================
    // Translate colloquial terms to technical terms for this category
    // Format: { "thermostat": ["thingy", "box on the wall", "temperature thing"] }
    // Extends template.synonymMap
    synonymMap: {
        type: Map,
        of: [String],
        default: new Map()
        // Key: technical term (e.g., "thermostat")
        // Value: array of colloquial aliases (e.g., ["thingy", "thing", "contraption"])
        // Applied before keyword matching in HybridScenarioSelector
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
        unique: true
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
        trim: true
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
    
    // ============================================
    // 🔤 TEMPLATE-LEVEL SYNONYM MAPPING (GLOBAL)
    // ============================================
    // Translate colloquial terms to technical terms for ALL scenarios
    // Format: { "air conditioner": ["ac", "a/c", "air", "cooling", "cold air"] }
    // Categories can add additional synonyms on top of these
    synonymMap: {
        type: Map,
        of: [String],
        default: () => new Map([
            ['air conditioner', ['ac', 'a/c', 'air', 'cooling', 'cold air', 'system']],
            ['furnace', ['heater', 'heat', 'heating', 'hot air']],
            ['unit', ['system', 'equipment', 'machine', 'thing outside']]
        ])
        // Key: technical term (e.g., "air conditioner")
        // Value: array of colloquial aliases
        // Applied before keyword matching in HybridScenarioSelector
        // Categories extend this with category-specific synonyms
    },
    
    // ============================================================================
    // 🧠 AI LEARNING SETTINGS - 3-TIER SELF-IMPROVEMENT SYSTEM
    // ============================================================================
    // Controls how this template learns from LLM analysis and shares patterns
    // with other templates. Part of the self-improvement cycle that reduces
    // LLM costs from 70% → 2% over 6 months while increasing intelligence.
    // ============================================================================
    learningSettings: {
        // ============================================
        // LEARNING ENABLED (Always On)
        // ============================================
        enableLearning: {
            type: Boolean,
            default: true,
            required: true
            // Cannot be disabled. Core self-improvement mechanism.
            // Patterns learned from test calls automatically improve this template.
        },
        
        // ============================================
        // INDUSTRY-WIDE SHARING (Optional Checkbox)
        // ============================================
        shareWithinIndustry: {
            type: Boolean,
            default: false
            // If enabled: High-quality patterns (confidence >85%) are automatically
            // shared with other templates in the same industryLabel.
            // Example: "HVAC Receptionist" teaches "HVAC Trade Knowledge"
            // Requires: At least 2 templates in same industry
        },
        
        industryShareThreshold: {
            type: Number,
            default: 0.85,
            min: 0.7,
            max: 0.95
            // Minimum confidence score required for auto-sharing within industry
            // Default: 0.85 (85% confidence)
        },
        
        // ============================================
        // GLOBAL SHARING (Admin Approval Required)
        // ============================================
        proposeForGlobal: {
            type: Boolean,
            default: false
            // If enabled: Universal patterns (confidence >90%) are submitted to
            // admin review queue for potential platform-wide sharing.
            // Example: Generic fillers like "um, uh, like" benefit all templates.
            // Requires: Manual admin approval before patterns go global
        },
        
        globalProposeThreshold: {
            type: Number,
            default: 0.90,
            min: 0.85,
            max: 0.98
            // Minimum confidence score required for proposing global patterns
            // Default: 0.90 (90% confidence)
            // Must be higher than industryShareThreshold
        },
        
        // ============================================
        // QUALITY FILTERS
        // ============================================
        minPatternFrequency: {
            type: Number,
            default: 3,
            min: 1,
            max: 20
            // Pattern must appear in this many test calls before being considered
            // Template-only: 3+ occurrences
            // Industry: 10+ occurrences
            // Global: 20+ occurrences
        },
        
        autoApproveIndustry: {
            type: Boolean,
            default: true
            // If true: Industry-wide patterns are auto-applied (if threshold met)
            // If false: Industry patterns also require admin approval
        },
        
        // ============================================
        // TIER ROUTING THRESHOLDS
        // ============================================
        tier1Threshold: {
            type: Number,
            default: 0.80,
            min: 0.60,
            max: 0.95
            // Minimum confidence for Tier 1 (rule-based) to accept match
            // Below this: escalates to Tier 2
            // Default: 0.80 (80% confidence)
        },
        
        tier2Threshold: {
            type: Number,
            default: 0.60,
            min: 0.40,
            max: 0.80
            // Minimum confidence for Tier 2 (semantic) to accept match
            // Below this: escalates to Tier 3 (LLM)
            // Default: 0.60 (60% confidence)
        },
        
        // ============================================
        // COST CONTROLS
        // ============================================
        llmBudgetMonthly: {
            type: Number,
            default: 500,
            min: 0,
            max: 10000
            // Maximum monthly LLM spend for this template (USD)
            // When reached: Falls back to Tier 2 (no LLM)
            // Set to 0 to disable LLM completely
        },
        
        llmCostPerCall: {
            type: Number,
            default: 0.50,
            min: 0.01,
            max: 5.00
            // Estimated cost per LLM call (USD)
            // Used for budget tracking and cost projections
            // GPT-4 Turbo: ~$0.50, GPT-3.5 Turbo: ~$0.05
        }
    },
    
    // ============================================================================
    // 🧠 INTELLIGENCE MODE - TEST PILOT CONFIGURATION
    // ============================================================================
    // Controls the depth of LLM analysis during testing (Test Pilot mode).
    // Three presets: MAXIMUM (deep), BALANCED (selective), MINIMAL (critical-only)
    // Philosophy: Pay upfront in testing → Get perfect template → Production is free
    // ============================================================================
    intelligenceMode: {
        type: String,
        enum: ['MAXIMUM', 'BALANCED', 'MINIMAL'],
        default: 'MAXIMUM'
        // MAXIMUM: Deep LLM analysis on every test (~$0.10/test)
        // BALANCED: Selective analysis on failures (~$0.05/test)
        // MINIMAL: Critical-only analysis (~$0.01/test)
        // Set via preset selector UI in Test Pilot tab
    },
    
    // ============================================================================
    // 🔬 TEST PILOT SETTINGS (Advanced - Auto-Configured by Preset)
    // ============================================================================
    // These settings are automatically configured when intelligenceMode is selected.
    // Developers rarely need to touch these directly.
    // ============================================================================
    testPilotSettings: {
        llmModel: {
            type: String,
            enum: ['gpt-4o', 'gpt-4o-mini'],
            default: 'gpt-4o'
            // Best model for MAXIMUM, cheaper model for BALANCED/MINIMAL
        },
        
        analysisDepth: {
            type: String,
            enum: ['DEEP', 'STANDARD', 'SHALLOW'],
            default: 'DEEP'
            // DEEP: Full analysis (triggers, fillers, synonyms, edge cases, conflicts)
            // STANDARD: Normal analysis (triggers, fillers, synonyms)
            // SHALLOW: Quick analysis (critical issues only)
        },
        
        analysisMode: {
            type: String,
            enum: ['ALWAYS', 'ON_FAILURE', 'CRITICAL_ONLY'],
            default: 'ALWAYS'
            // ALWAYS: Analyze every test (even 100% confidence)
            // ON_FAILURE: Only analyze when confidence < minConfidenceForAnalysis
            // CRITICAL_ONLY: Only analyze catastrophic failures (<40% confidence)
        },
        
        suggestionFilter: {
            type: String,
            enum: ['ALL', 'HIGH_PRIORITY', 'CRITICAL_ONLY'],
            default: 'ALL'
            // ALL: Show all LLM suggestions
            // HIGH_PRIORITY: Show important suggestions only
            // CRITICAL_ONLY: Show critical issues only
        },
        
        minConfidenceForAnalysis: {
            type: Number,
            default: 0,
            min: 0,
            max: 1
            // Minimum confidence to trigger analysis (if analysisMode = ON_FAILURE)
            // 0 = analyze all, 0.70 = analyze if <70%, 0.40 = analyze if <40%
        },
        
        conflictDetection: {
            type: String,
            enum: ['AGGRESSIVE', 'STANDARD', 'DISABLED'],
            default: 'AGGRESSIVE'
            // AGGRESSIVE: Find all potential conflicts (trigger collisions, synonym overlap)
            // STANDARD: Basic conflict detection
            // DISABLED: Skip conflict detection (cost savings)
        },
        
        edgeCasePrediction: {
            type: Boolean,
            default: true
            // If true: LLM predicts edge cases before customers hit them
            // If false: Only analyze current test phrase
        },
        
        beforeAfterSimulation: {
            type: Boolean,
            default: true
            // If true: Show predicted impact of applying suggestions
            // If false: Skip simulation (cost savings)
        },
        
        bulkActions: {
            type: Boolean,
            default: true
            // If true: Enable "Apply All" / "Ignore All" bulk actions
            // If false: Manual review required for each suggestion
        },
        
        costLimit: {
            type: Number,
            default: null
            // Max cost per test (USD). null = no limit
            // Example: 0.10 = stop analysis if cost exceeds $0.10
        },
        
        maxAnalysisTime: {
            type: Number,
            default: 30000
            // Max time for LLM analysis (ms)
            // Prevents runaway costs for complex tests
        }
    },
    
    // ============================================================================
    // 🌐 AI GATEWAY SETTINGS (Production Tier Thresholds)
    // ============================================================================
    // Controls when production calls escalate from Tier 1 → 2 → 3
    // Also auto-configured by intelligenceMode preset
    // ============================================================================
    aiGatewaySettings: {
        tier1Threshold: {
            type: Number,
            default: 0.80,
            min: 0.60,
            max: 0.95
            // Minimum confidence for Tier 1 (rule-based) to accept match
            // MAXIMUM: 0.80 (higher bar, more testing analysis)
            // BALANCED: 0.70 (standard)
            // MINIMAL: 0.60 (lower bar, easier to pass)
        },
        
        tier2Threshold: {
            type: Number,
            default: 0.60,
            min: 0.40,
            max: 0.80
            // Minimum confidence for Tier 2 (semantic) to accept match
            // MAXIMUM: 0.60 (lower bar, catches more edge cases)
            // BALANCED: 0.75 (standard)
            // MINIMAL: 0.80 (higher bar, hard to reach Tier 3)
        },
        
        enableTier3: {
            type: Boolean,
            default: true
            // If false: Disable LLM entirely (production will never use Tier 3)
            // If true: Use LLM as fallback when Tier 1/2 fail
        }
    },
    
    // ============================================================================
    // 📊 LEARNING STATISTICS (Auto-Calculated)
    // ============================================================================
    // Tracks self-improvement progress over time
    // Updated by PatternLearningService and CostTrackingService
    // ============================================================================
    learningStats: {
        // Pattern counts
        patternsLearnedTotal: { type: Number, default: 0 },
        patternsLearnedThisMonth: { type: Number, default: 0 },
        synonymsLearned: { type: Number, default: 0 },
        fillersLearned: { type: Number, default: 0 },
        keywordsLearned: { type: Number, default: 0 },
        
        // Sharing statistics
        patternsSharedToIndustry: { type: Number, default: 0 },
        patternsSharedGlobally: { type: Number, default: 0 },
        patternsReceivedFromIndustry: { type: Number, default: 0 },
        patternsReceivedGlobal: { type: Number, default: 0 },
        
        // Tier distribution (current month)
        tier1Percentage: { type: Number, default: 20 },  // Week 1 baseline
        tier2Percentage: { type: Number, default: 10 },
        tier3Percentage: { type: Number, default: 70 },  // Starts high, decreases over time
        
        // Cost tracking (current month)
        llmCallsThisMonth: { type: Number, default: 0 },
        llmCostThisMonth: { type: Number, default: 0 },
        projectedMonthlyCost: { type: Number, default: 350 },  // Week 1 baseline
        
        // Improvement metrics
        costSavingsVsBaseline: { type: Number, default: 0 },  // USD saved vs Week 1
        averageResponseTime: { type: Number, default: 0 },     // ms
        selfImprovementScore: { type: Number, default: 0 },    // 0-100
        
        // Timestamps
        firstLearningEvent: { type: Date },
        lastLearningEvent: { type: Date },
        lastStatsReset: { type: Date, default: Date.now },
        monthStartDate: { type: Date, default: () => new Date(new Date().getFullYear(), new Date().getMonth(), 1) }
    },
    
    // ============================================================================
    // 📞 TWILIO TEST CONFIGURATION (⚠️ DEPRECATED - Moving to AdminSettings)
    // ============================================================================
    // ⚠️ DEPRECATION NOTICE:
    // This field is being phased out. Twilio test config has been moved to
    // AdminSettings.globalAIBrainTest for a cleaner, global architecture.
    // 
    // REASON FOR CHANGE:
    // - OLD: Each template had its own Twilio config (caused duplicate errors)
    // - NEW: One global test console routes to any template (clean UX)
    // 
    // This field is kept temporarily for backward compatibility and data migration.
    // It will be removed in a future version after all data is migrated.
    // ============================================================================
    twilioTest: {
        enabled: {
            type: Boolean,
            default: false
            // Toggle ON to enable test calls, OFF to disable
        },
        phoneNumber: {
            type: String,
            trim: true
            // ⚠️ DEPRECATED: Unique constraint removed (no longer enforced)
            // Test phone number (e.g., +15551234567)
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
    if (!this.hasParent()) {return null;}
    return await this.constructor.findById(this.lineage.clonedFrom);
};

globalInstantResponseTemplateSchema.methods.checkParentUpdates = async function() {
    const parent = await this.getParent();
    if (!parent) {return { hasUpdates: false };}
    
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
    if (!parent) {return null;}
    
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
    const templates = await this.find({ isPublished: true })
        .select('_id name version description templateType industryLabel stats categories createdAt updatedAt')
        .sort({ createdAt: -1 });
    
    // Auto-calculate stats if they're 0 (for legacy templates)
    templates.forEach(template => {
        if (!template.stats.totalCategories && template.categories && template.categories.length > 0) {
            let totalScenarios = 0;
            let totalTriggers = 0;
            
            template.categories.forEach(category => {
                if (category.scenarios && category.scenarios.length > 0) {
                    totalScenarios += category.scenarios.length;
                    category.scenarios.forEach(scenario => {
                        if (scenario.triggers && scenario.triggers.length > 0) {
                            totalTriggers += scenario.triggers.length;
                        }
                    });
                }
            });
            
            template.stats = {
                totalCategories: template.categories.length,
                totalScenarios,
                totalTriggers
            };
        }
    });
    
    return templates;
};

// ============================================
// INDEXES
// ============================================
// Note: Field-level "index: true" removed to avoid Mongoose duplicate index warnings
// All indexes declared here for clarity and control

globalInstantResponseTemplateSchema.index({ version: 1 });
globalInstantResponseTemplateSchema.index({ isActive: 1 });
globalInstantResponseTemplateSchema.index({ isPublished: 1 });
globalInstantResponseTemplateSchema.index({ isDefaultTemplate: 1 });
globalInstantResponseTemplateSchema.index({ templateType: 1 });
globalInstantResponseTemplateSchema.index({ 'lineage.clonedFrom': 1 });

// ============================================================================
// P1 CHECKPOINT: Template Integrity Validation (pre-save)
// ============================================================================
globalInstantResponseTemplateSchema.pre('save', async function(next) {
    // Skip validation for new templates (they might not have scenarios yet)
    if (this.isNew) {
        return next();
    }
    
    try {
        const AdminNotificationService = require('../services/AdminNotificationService');
        
        // Count total scenarios across all categories
        let totalScenarios = 0;
        this.categories.forEach(category => {
            if (category.scenarios && Array.isArray(category.scenarios)) {
                totalScenarios += category.scenarios.length;
            }
        });
        
        // Alert if template has categories but no scenarios
        if (this.categories.length > 0 && totalScenarios === 0) {
            await AdminNotificationService.sendAlert({
                code: 'TEMPLATE_EMPTY_SCENARIOS_ON_SAVE',
                severity: 'WARNING',
                companyId: null,
                companyName: 'Platform',
                message: `⚠️ Attempting to save template "${this.name}" with categories but no scenarios`,
                details: {
                    templateId: this._id.toString(),
                    templateName: this.name,
                    categoriesCount: this.categories.length,
                    scenariosCount: 0,
                    impact: 'AI agent cannot respond to any queries - template will be non-functional',
                    suggestedFix: 'Add scenarios to categories before saving or mark template as draft',
                    detectedBy: 'Template pre-save validation hook'
                },
                bypassPatternDetection: true // Empty state = immediate alert
            }).catch(err => console.error('Failed to send pre-save template alert:', err));
        }
    } catch (error) {
        // Don't block save if notification fails
        console.error('Error in Template pre-save hook:', error.message);
    }
    
    next();
});

const GlobalInstantResponseTemplate = mongoose.model('GlobalInstantResponseTemplate', globalInstantResponseTemplateSchema);

module.exports = GlobalInstantResponseTemplate;
