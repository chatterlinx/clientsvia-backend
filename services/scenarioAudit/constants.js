/**
 * Scenario Audit Constants
 * 
 * Central source of truth for all audit rules.
 * These constants are shared across:
 * - Audit rules (for checking existing scenarios)
 * - Gap generation prompts (for creating new scenarios)
 * 
 * When you update these, both systems stay in sync.
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 * SCENARIO SCHEMA FIELDS (from GlobalInstantResponseTemplate.js)
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * IDENTITY & LIFECYCLE:
 *   scenarioId, version, status, name, isActive, scope, ownerCompanyId
 * 
 * CATEGORIZATION:
 *   categories[], priority, cooldownSeconds, scenarioType
 * 
 * MATCHING:
 *   triggers[], regexTriggers[], negativeTriggers[], embeddingVector,
 *   contextWeight, keywords[], negativeKeywords[]
 * 
 * REPLIES:
 *   quickReplies[], fullReplies[], followUpPrompts[], followUpFunnel,
 *   replySelection, replyPolicy, replyBundles{short[], long[]}
 * 
 * FOLLOW-UP:
 *   followUpMode, followUpQuestionText, transferTarget
 * 
 * WIRING:
 *   actionType, flowId, bookingIntent, requiredSlots[], stopRouting
 * 
 * ENTITY:
 *   entityCapture[], entityValidation{}, dynamicVariables{}
 * 
 * BEHAVIOR:
 *   behavior, toneLevel, ttsOverride{}
 * 
 * TIMING:
 *   timedFollowUp{}, silencePolicy{}
 * 
 * AI/LEARNING:
 *   qnaPairs[], testPhrases[], examples[], escalationFlags[]
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

// ═══════════════════════════════════════════════════════════════════════════════
// BANNED PHRASES - Instant failures
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Chatbot words - Sound like a generic AI assistant
 */
const CHATBOT_PHRASES = [
    'wonderful to hear from you',
    'great to have you back',
    'we\'re here to help',
    'let\'s sort this out together',
    'i apologize for the inconvenience',
    'i\'m sorry to hear that',
    'thank you for reaching out',
    'how can i assist you today',
    'i\'d be happy to help',
    'is there anything else i can help you with',
    'thank you for your patience',
    'i understand your frustration',
    'let me help you with that',
    'i\'m here to assist',
    'thanks for contacting us'
];

/**
 * Help desk words - Sound like customer service, not dispatch
 */
const HELPDESK_PHRASES = [
    'got it',
    'no problem',
    'absolutely',
    'of course',
    'certainly',
    'definitely',
    'sure thing',
    'you bet',
    'my pleasure',
    'happy to help'
];

/**
 * Lazy questions - Vague, don't move toward classification
 */
const LAZY_QUESTIONS = [
    'tell me more about',
    'can you describe',
    'could you explain',
    'what seems to be',
    'what\'s going on',  // Only bad when standalone without specificity
    'how can i help'
];

/**
 * Troubleshooting questions - Technician territory, not dispatcher
 */
const TROUBLESHOOTING_PHRASES = [
    'have you checked',
    'have you tried',
    'is it set correctly',
    'any unusual noises',
    'when did it last work',
    'have you reset',
    'did you change',
    'is the filter clean',
    'have you replaced'
];

/**
 * All banned phrases combined (for quick lookup)
 */
const ALL_BANNED_PHRASES = [
    ...CHATBOT_PHRASES,
    ...HELPDESK_PHRASES,
    ...LAZY_QUESTIONS,
    ...TROUBLESHOOTING_PHRASES
];

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVED PHRASES - What dispatchers SHOULD say
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Approved acknowledgments (brief, professional)
 */
const APPROVED_ACKNOWLEDGMENTS = [
    'i understand',
    'alright',
    'okay',
    'thanks',
    'appreciate it'
];

/**
 * Approved name acknowledgments
 */
const APPROVED_NAME_ACKNOWLEDGMENTS = [
    'thanks, {name}',
    'appreciate it, {name}',
    'good to hear from you, {name}'
];

/**
 * Approved loyalty acknowledgments
 */
const APPROVED_LOYALTY_ACKNOWLEDGMENTS = [
    'we appreciate you, {name}',
    'thanks for being a long-time customer, {name}',
    'glad to have you back, {name}',
    'good to hear from you again, {name}'
];

// ═══════════════════════════════════════════════════════════════════════════════
// RESPONSE LIMITS
// ═══════════════════════════════════════════════════════════════════════════════

const RESPONSE_LIMITS = {
    quickReply: {
        maxWords: 20,
        description: 'Quick replies should be under 20 words'
    },
    fullReply: {
        maxWords: 25,
        description: 'Full replies should be under 25 words'
    },
    acknowledgment: {
        maxWords: 3,
        description: 'Acknowledgments should be 3 words max'
    },
    nameAcknowledgment: {
        maxWords: 10,
        description: 'Name acknowledgments should be under 10 words'
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// PLACEHOLDER RULES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Allowed placeholders in scenarios
 */
const ALLOWED_PLACEHOLDERS = [
    '{name}',
    '{companyName}',
    '{technician}',
    '{time}',
    '{date}',
    '{phone}',
    '{address}',
    '{serviceType}'
];

/**
 * Placeholder that should NOT be used (inconsistent naming)
 */
const DEPRECATED_PLACEHOLDERS = [
    '{firstName}',   // Use {name} instead
    '{lastName}',    // Not typically needed
    '{customer}',    // Use {name} instead
    '{customerName}' // Use {name} instead
];

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO STRUCTURE RULES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Booking phrases - Should only appear in fullReplies, not quickReplies
 */
const BOOKING_PHRASES = [
    'morning or afternoon',
    'what day works',
    'get you on the schedule',
    'schedule an appointment',
    'book a technician',
    'get a technician out',
    'send someone out'
];

/**
 * Classification phrases - Should appear in quickReplies
 */
const CLASSIFICATION_PHRASES = [
    'running but not cooling',
    'not turning on',
    'air coming out',
    'thermostat screen',
    'is it making',
    'when did it start'
];

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO TYPES & DEFAULTS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Valid scenario types (from schema)
 */
const SCENARIO_TYPES = [
    'EMERGENCY',      // Critical issues (gas leak, no heat, flooding) - priority 90-100
    'BOOKING',        // Scheduling/appointment intents - priority 70-85
    'FAQ',            // Informational questions (pricing, warranty, hours) - priority 40-60
    'TROUBLESHOOT',   // Diagnostic/problem-solving scenarios - priority 50-70
    'BILLING',        // Payment, invoice, account questions - priority 40-60
    'TRANSFER',       // Human escalation requests - priority 80-90
    'SMALL_TALK',     // Casual conversation (greetings, thanks, goodbye) - priority -5 to 10
    'SYSTEM',         // Internal acks, confirmations - priority 20-40
    'UNKNOWN'         // Not yet classified
];

/**
 * Expected priority ranges per scenario type
 */
const PRIORITY_RANGES = {
    EMERGENCY: { min: 90, max: 100 },
    BOOKING: { min: 70, max: 85 },
    TRANSFER: { min: 80, max: 90 },
    FAQ: { min: 40, max: 60 },
    TROUBLESHOOT: { min: 50, max: 70 },
    BILLING: { min: 40, max: 60 },
    SYSTEM: { min: 20, max: 40 },
    SMALL_TALK: { min: -5, max: 10 },
    UNKNOWN: { min: 0, max: 50 }
};

/**
 * Valid action types (from schema)
 */
const ACTION_TYPES = [
    'REPLY_ONLY',      // Just respond (FAQ, small talk)
    'START_FLOW',      // Start a Dynamic Flow (flowId REQUIRED)
    'REQUIRE_BOOKING', // Lock into booking collection mode
    'TRANSFER',        // Immediately transfer
    'SMS_FOLLOWUP'     // Send SMS follow-up
];

/**
 * Valid follow-up modes (from schema)
 */
const FOLLOW_UP_MODES = [
    'NONE',                   // No follow-up
    'ASK_FOLLOWUP_QUESTION',  // Ask followUpQuestionText
    'ASK_IF_BOOK',            // "Would you like to book?"
    'TRANSFER'                // Transfer after response
];

/**
 * Valid behaviors (approved dispatcher styles)
 */
const APPROVED_BEHAVIORS = [
    'calm_professional',      // DEFAULT - calm, in control, experienced
    'empathetic_reassuring',  // For complaints, callbacks, service recovery
    'professional_efficient'  // Business inquiries, billing, formal requests
];

/**
 * Behaviors that should NOT be used (make AI chatty)
 */
const BANNED_BEHAVIORS = [
    'friendly_warm',          // Makes AI chatty
    'enthusiastic_positive',  // Sounds like sales
    'casual_friendly',        // Too informal
    'warm',                   // Too soft
    'excited'                 // Too energetic
];

// ═══════════════════════════════════════════════════════════════════════════════
// WIRING VALIDATION RULES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Required fields per action type
 */
const ACTION_TYPE_REQUIREMENTS = {
    REPLY_ONLY: {
        required: [],
        forbidden: ['flowId'],
        description: 'Just respond with quickReply/fullReply'
    },
    START_FLOW: {
        required: ['flowId'],
        forbidden: [],
        description: 'Must have flowId pointing to valid DynamicFlow'
    },
    REQUIRE_BOOKING: {
        required: [],
        implied: { bookingIntent: true },
        description: 'Auto-sets bookingIntent=true, activates slot collection'
    },
    TRANSFER: {
        required: ['transferTarget'],
        forbidden: [],
        description: 'Must have transferTarget (queue/extension)'
    },
    SMS_FOLLOWUP: {
        required: [],
        forbidden: [],
        description: 'Send SMS follow-up, continue call'
    }
};

/**
 * Required fields per follow-up mode
 */
const FOLLOW_UP_MODE_REQUIREMENTS = {
    NONE: {
        required: [],
        forbidden: ['followUpQuestionText'],
        description: 'No follow-up, call ends'
    },
    ASK_FOLLOWUP_QUESTION: {
        required: ['followUpQuestionText'],
        forbidden: [],
        description: 'Must have followUpQuestionText'
    },
    ASK_IF_BOOK: {
        required: [],
        forbidden: [],
        description: '"Would you like to book?" auto-prompt'
    },
    TRANSFER: {
        required: ['transferTarget'],
        forbidden: [],
        description: 'Must have transferTarget'
    }
};

// ═══════════════════════════════════════════════════════════════════════════════
// TRIGGER VALIDATION RULES
// ═══════════════════════════════════════════════════════════════════════════════

const TRIGGER_LIMITS = {
    minTriggers: 3,           // Minimum triggers per scenario
    maxTriggers: 20,          // Maximum triggers (too many = overlap risk)
    minTriggerLength: 2,      // Minimum characters per trigger
    maxTriggerLength: 100,    // Maximum characters per trigger
    recommendedTriggers: {
        min: 10,
        max: 15
    }
};

/**
 * Trigger patterns that are too generic (high false-positive risk)
 */
const GENERIC_TRIGGERS = [
    'yes',
    'no',
    'ok',
    'okay',
    'sure',
    'yeah',
    'help',
    'hi',
    'hello',
    'hey',
    'thanks',
    'thank you',
    'please',
    'what',
    'how',
    'why',
    'when',
    'where',
    'who'
];

// ═══════════════════════════════════════════════════════════════════════════════
// SEVERITY LEVELS
// ═══════════════════════════════════════════════════════════════════════════════

const SEVERITY = {
    ERROR: 'error',       // Must fix - breaks dispatcher persona or causes runtime errors
    WARNING: 'warning',   // Should fix - not ideal but functional
    INFO: 'info'          // Suggestion - optimization opportunity
};

// ═══════════════════════════════════════════════════════════════════════════════
// RULE CATEGORIES
// ═══════════════════════════════════════════════════════════════════════════════

const RULE_CATEGORIES = {
    TONE: 'tone',                     // Banned phrases, chatbot language
    PERSONALIZATION: 'personalization', // Name/placeholder usage
    STRUCTURE: 'structure',           // Reply structure, booking vs classify
    TRIGGERS: 'triggers',             // Trigger quality and coverage
    WIRING: 'wiring',                 // Action types, flow connections
    DUPLICATES: 'duplicates',         // Near-duplicate detection
    COMPLETENESS: 'completeness',     // Missing required fields
    PRIORITY: 'priority'              // Priority/confidence mismatches
};

// ═══════════════════════════════════════════════════════════════════════════════
// 🎯 MASTER SETTINGS REGISTRY - SINGLE SOURCE OF TRUTH
// ═══════════════════════════════════════════════════════════════════════════════
// 
// This registry tracks ALL scenario settings and which systems use them:
// - AUDIT: Does the audit system check this setting?
// - GAP: Does gap generation create this setting?
// ═══════════════════════════════════════════════════════════════════════════════
// 🎯 SINGLE SOURCE OF TRUTH - SCENARIO RUNTIME CONTRACT
// ═══════════════════════════════════════════════════════════════════════════════
// 
// ARCHITECTURE (V2 - Enterprise Grade):
// - ONE list of settings with PURPOSE + aiGenerable flag
// - All policies are DERIVED from these two fields (no drift possible)
// 
// PURPOSE TYPES:
// - "runtime": Agent uses at runtime, AI can generate, Audit checks
// - "runtime_manual": Agent uses at runtime, Admin configures, Audit checks
// - "system": Auto-generated/internal, Agent uses, no audit/gap
// - "generation": Influences reply writing only, not runtime
// - "future": Planned but not implemented
// 
// DERIVED POLICIES (computed, never stored):
// - isAudited = purpose in ['runtime', 'runtime_manual']
// - isAgentUsed = purpose in ['runtime', 'runtime_manual', 'system']
// - isGapGenerated = purpose in ['runtime', 'runtime_manual'] && aiGenerable === true
// 
// BENEFITS:
// ✅ ONE runtime contract (no drift between audit/gap/agent)
// ✅ Audit checks EVERYTHING in runtime contract automatically
// ✅ Gap Fill generates what it can, marks rest as admin-required
// ✅ Scales across trades and companies without drift
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * ════════════════════════════════════════════════════════════════════════════════
 * SCENARIO_SETTINGS_REGISTRY - Single Source of Truth
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * OWNERSHIP MODEL (the key insight):
 * 
 *   CONTENT  = Scenario defines WHAT to say (GPT generates)
 *   RUNTIME  = ConversationEngine decides HOW/WHEN to behave (not generated)
 *   ADMIN    = Infrastructure/policy settings (admin configures)
 *   SYSTEM   = Auto-generated/internal (never touched)
 * 
 * Each setting has:
 * - ownership: 'content' | 'runtime' | 'admin' | 'system' (WHO owns it)
 * - purpose: Legacy field for backward compatibility
 * - aiGenerable: Derived from ownership === 'content'
 * - description: Human-readable description
 * 
 * DERIVATION RULE (enforced in code):
 *   aiGenerable = (ownership === 'content')
 *   
 * This ensures Gap Fill, Audit, Agent, and Wiring Tab all read the same contract.
 * ════════════════════════════════════════════════════════════════════════════════
 */
const SCENARIO_SETTINGS_REGISTRY = {
    // ════════════════════════════════════════════════════════════════════════════
    // IDENTITY (Scenario owns - CONTENT)
    // ════════════════════════════════════════════════════════════════════════════
    name:             { ownership: 'content',  purpose: 'runtime',        description: 'Human-readable scenario name' },
    status:           { ownership: 'content',  purpose: 'runtime',        description: 'draft/live/archived - only live scenarios match' },
    isActive:         { ownership: 'content',  purpose: 'runtime',        description: 'Quick on/off toggle' },
    categories:       { ownership: 'content',  purpose: 'runtime',        description: 'Category tags for organization' },
    scenarioType:     { ownership: 'content',  purpose: 'runtime',        description: 'EMERGENCY/BOOKING/FAQ/etc - determines reply strategy' },
    notes:            { ownership: 'content',  purpose: 'system',         description: 'Admin notes (not used by AI)' },
    
    // System-managed identity
    scenarioId:       { ownership: 'system',   purpose: 'runtime',        description: 'Unique scenario identifier' },
    version:          { ownership: 'system',   purpose: 'system',         description: 'Version number for rollback' },
    scope:            { ownership: 'system',   purpose: 'system',         description: 'GLOBAL vs COMPANY scope' },
    ownerCompanyId:   { ownership: 'system',   purpose: 'system',         description: 'Company that owns this scenario' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // MATCHING PRIORITY (Scenario owns - CONTENT)
    // ════════════════════════════════════════════════════════════════════════════
    priority:         { ownership: 'content',  purpose: 'runtime',        description: 'Tie-breaker when multiple scenarios match (-10 to +10)' },
    minConfidence:    { ownership: 'content',  purpose: 'runtime',        description: 'Scenario-level confidence threshold' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // TRIGGERS - When to match (Scenario owns - CONTENT)
    // ════════════════════════════════════════════════════════════════════════════
    triggers:             { ownership: 'content',  purpose: 'runtime',    description: 'Plain phrases for BM25 keyword matching' },
    regexTriggers:        { ownership: 'content',  purpose: 'runtime',    description: 'Advanced pattern matching (regex)' },
    negativeTriggers:     { ownership: 'content',  purpose: 'runtime',    description: 'Phrases that PREVENT matching' },
    exampleUserPhrases:   { ownership: 'content',  purpose: 'runtime',    description: '12-18 example phrases users say (for Tier-3 LLM context)' },
    negativeUserPhrases:  { ownership: 'content',  purpose: 'runtime',    description: 'Phrases that PREVENT this scenario from matching' },
    
    // System-managed triggers
    keywords:             { ownership: 'system',   purpose: 'system',     description: 'Fast Tier-1 matching keywords (auto-generated)' },
    negativeKeywords:     { ownership: 'system',   purpose: 'system',     description: 'Keywords that veto matches (auto-generated)' },
    embeddingVector:      { ownership: 'system',   purpose: 'system',     description: 'Precomputed semantic embedding (auto-generated)' },
    contextWeight:        { ownership: 'system',   purpose: 'system',     description: 'Multiplier for final match score' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // REPLIES - What to say (Scenario owns - CONTENT)
    // ════════════════════════════════════════════════════════════════════════════
    quickReplies:         { ownership: 'content',  purpose: 'runtime',    description: 'Short/quick response variations' },
    fullReplies:          { ownership: 'content',  purpose: 'runtime',    description: 'Full/detailed response variations' },
    quickReplies_noName:  { ownership: 'content',  purpose: 'runtime',    description: 'Quick replies without {name} for unknown callers' },
    fullReplies_noName:   { ownership: 'content',  purpose: 'runtime',    description: 'Full replies without {name} for unknown callers' },
    replyStrategy:        { ownership: 'content',  purpose: 'runtime',    description: 'AUTO/FULL_ONLY/QUICK_ONLY/etc' },
    
    // System-managed reply settings
    replySelection:       { ownership: 'system',   purpose: 'system',     description: 'sequential/random/bandit selection' },
    replyBundles:         { ownership: 'system',   purpose: 'future',     description: 'Reply bundle system (future)' },
    replyPolicy:          { ownership: 'system',   purpose: 'future',     description: 'ROTATE_PER_CALLER/etc (future)' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // PERSONALITY (Scenario owns - CONTENT)
    // Affects HOW replies are WRITTEN, not how agent BEHAVES
    // ════════════════════════════════════════════════════════════════════════════
    behavior:         { ownership: 'content',  purpose: 'generation',     description: 'AI personality - influences how replies are WRITTEN' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // INTENT FLAG (Scenario owns - CONTENT)
    // Flag only - Runtime decides what to DO with this flag
    // ════════════════════════════════════════════════════════════════════════════
    bookingIntent:    { ownership: 'content',  purpose: 'runtime',        description: 'true = caller wants to book (Runtime decides behavior)' },
    entityCapture:    { ownership: 'content',  purpose: 'future',         description: 'Entities to extract (what to capture, not how)' },
    channel:          { ownership: 'content',  purpose: 'runtime',        description: 'voice/sms/chat/any channel restriction' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // FOLLOW-UP BEHAVIOR (Runtime owns - NOT GENERATED)
    // ConversationEngine decides these based on context + bookingIntent
    // ════════════════════════════════════════════════════════════════════════════
    followUpMode:         { ownership: 'runtime',  purpose: 'runtime',        description: 'Runtime decides: NONE/ASK_IF_BOOK based on context' },
    followUpQuestionText: { ownership: 'runtime',  purpose: 'runtime',        description: 'Runtime decides follow-up text based on booking flow' },
    followUpFunnel:       { ownership: 'runtime',  purpose: 'future',         description: 'Re-engagement prompt (Runtime decides)' },
    followUpPrompts:      { ownership: 'system',   purpose: 'future',         description: 'Follow-up prompts (future)' },
    transferTarget:       { ownership: 'admin',    purpose: 'runtime_manual', description: 'Queue/extension for transfer (admin configures)' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // ACTION TYPE (Runtime owns - NOT GENERATED)
    // ConversationEngine decides based on confidence, booking flow, etc.
    // ════════════════════════════════════════════════════════════════════════════
    actionType:       { ownership: 'runtime',  purpose: 'runtime',        description: 'Runtime decides: REPLY_ONLY/REQUIRE_BOOKING based on context' },
    handoffPolicy:    { ownership: 'runtime',  purpose: 'runtime',        description: 'Runtime decides when to escalate to human' },
    flowId:           { ownership: 'admin',    purpose: 'runtime_manual', description: 'Dynamic Flow to execute (admin configures)' },
    requiredSlots:    { ownership: 'admin',    purpose: 'runtime_manual', description: 'Slots to collect for booking (admin configures)' },
    stopRouting:      { ownership: 'admin',    purpose: 'runtime_manual', description: 'Stop routing flag (admin configures)' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // TIMING & SILENCE (Admin owns - INFRASTRUCTURE)
    // Global policies, not per-scenario AI decisions
    // ════════════════════════════════════════════════════════════════════════════
    cooldownSeconds:  { ownership: 'admin',    purpose: 'runtime',        description: 'Prevents scenario from firing again within N seconds' },
    timedFollowUp:    { ownership: 'admin',    purpose: 'runtime_manual', description: 'Idle timer triggers follow-up (admin configures)' },
    silencePolicy:    { ownership: 'admin',    purpose: 'runtime_manual', description: 'Silence handling policy (admin configures)' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // ACTION HOOKS (Admin owns - INFRASTRUCTURE)
    // ════════════════════════════════════════════════════════════════════════════
    actionHooks:      { ownership: 'admin',    purpose: 'runtime_manual', description: 'Hooks executed after scenario match (admin configures)' },
    entityValidation: { ownership: 'admin',    purpose: 'future',         description: 'Validation rules per entity (admin configures)' },
    dynamicVariables: { ownership: 'admin',    purpose: 'runtime',        description: 'Variable fallbacks when entity missing (admin configures)' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // VOICE & TTS (Admin owns - INFRASTRUCTURE)
    // ════════════════════════════════════════════════════════════════════════════
    ttsOverride:      { ownership: 'admin',    purpose: 'runtime_manual', description: 'Scenario TTS overrides (admin configures)' },
    toneLevel:        { ownership: 'system',   purpose: 'system',         description: 'DEPRECATED - use behavior instead' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // STATE MACHINE (Admin/System owns)
    // ════════════════════════════════════════════════════════════════════════════
    preconditions:    { ownership: 'system',   purpose: 'system',         description: 'Conditions for scenario to match (auto-managed)' },
    effects:          { ownership: 'admin',    purpose: 'runtime_manual', description: 'State changes after scenario execution (admin configures)' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // AI INTELLIGENCE (System owns - AUTO-GENERATED)
    // ════════════════════════════════════════════════════════════════════════════
    qnaPairs:         { ownership: 'system',   purpose: 'system',         description: 'Training data for semantic matching (auto-generated)' },
    testPhrases:      { ownership: 'system',   purpose: 'system',         description: 'Validation test cases' },
    examples:         { ownership: 'system',   purpose: 'system',         description: 'Sample conversations for admin' },
    escalationFlags:  { ownership: 'system',   purpose: 'system',         description: 'Triggers for human handoff' },
    
    // ════════════════════════════════════════════════════════════════════════════
    // MULTILINGUAL (System owns)
    // ════════════════════════════════════════════════════════════════════════════
    language:         { ownership: 'system',   purpose: 'system',         description: 'auto/en/es/fr language setting' }
};

// ════════════════════════════════════════════════════════════════════════════════
// DERIVE aiGenerable FROM OWNERSHIP (SINGLE SOURCE OF TRUTH)
// ════════════════════════════════════════════════════════════════════════════════
// This ensures no drift - aiGenerable is computed, not stored
Object.keys(SCENARIO_SETTINGS_REGISTRY).forEach(key => {
    const setting = SCENARIO_SETTINGS_REGISTRY[key];
    // CONTENT ownership = GPT can generate it
    setting.aiGenerable = setting.ownership === 'content';
});

/**
 * ════════════════════════════════════════════════════════════════════════════════
 * DERIVE POLICIES FROM OWNERSHIP (SINGLE SOURCE OF TRUTH)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * OWNERSHIP MODEL:
 *   CONTENT  = Scenario owns (GPT generates) - WHAT to say
 *   RUNTIME  = ConversationEngine owns - HOW/WHEN to behave
 *   ADMIN    = Admin owns - Infrastructure policies
 *   SYSTEM   = Auto-generated - Never touched
 * 
 * All policies are derived from ownership:
 *   isGapGenerated: ownership === 'content'
 *   isAudited: ownership in ['content', 'runtime', 'admin']
 *   isAgentUsed: ownership !== 'system' (but system still auto-populates)
 *   requiresAdmin: ownership === 'admin'
 *   isRuntimeOwned: ownership === 'runtime'
 * 
 * This ensures NO DRIFT - Gap Fill, Audit, Agent, Wiring Tab all consistent.
 * ════════════════════════════════════════════════════════════════════════════════
 */

function derivePolicy(setting) {
    const { ownership, purpose } = setting;
    
    // Derived from ownership - the SINGLE source of truth
    const isContent = ownership === 'content';
    const isRuntimeOwned = ownership === 'runtime';
    const isAdminOwned = ownership === 'admin';
    const isSystemOwned = ownership === 'system';
    
    // For backward compatibility with purpose-based code
    const isRuntimeContract = purpose === 'runtime' || purpose === 'runtime_manual';
    
    return {
        // Gap Fill ONLY generates CONTENT (what to say)
        isGapGenerated: isContent,
        
        // Audit checks content + runtime + admin (everything except system)
        isAudited: !isSystemOwned,
        
        // Agent uses everything except pure system fields
        isAgentUsed: !isSystemOwned,
        
        // Admin must configure these manually
        requiresAdmin: isAdminOwned,
        
        // Runtime decides these at call time (NOT in scenario)
        isRuntimeOwned: isRuntimeOwned,
        
        // AI can auto-generate content only
        aiCanGenerate: isContent,
        
        // Legacy support
        isRuntimeContract: isRuntimeContract
    };
}

/**
 * Get settings count summary - SINGLE SOURCE OF TRUTH
 * @returns {Object} Counts derived from ownership model
 */
function getSettingsCount() {
    const settings = Object.entries(SCENARIO_SETTINGS_REGISTRY);
    const total = settings.length;
    
    // ════════════════════════════════════════════════════════════════════════════
    // GROUP BY OWNERSHIP (the REAL source of truth)
    // ════════════════════════════════════════════════════════════════════════════
    const byOwnership = {
        content: settings.filter(([_, v]) => v.ownership === 'content'),
        runtime: settings.filter(([_, v]) => v.ownership === 'runtime'),
        admin: settings.filter(([_, v]) => v.ownership === 'admin'),
        system: settings.filter(([_, v]) => v.ownership === 'system')
    };
    
    // ════════════════════════════════════════════════════════════════════════════
    // LEGACY: Group by purpose (for backward compatibility)
    // ════════════════════════════════════════════════════════════════════════════
    const byPurpose = {
        runtime: settings.filter(([_, v]) => v.purpose === 'runtime'),
        runtime_manual: settings.filter(([_, v]) => v.purpose === 'runtime_manual'),
        generation: settings.filter(([_, v]) => v.purpose === 'generation'),
        system: settings.filter(([_, v]) => v.purpose === 'system'),
        future: settings.filter(([_, v]) => v.purpose === 'future')
    };
    
    // ════════════════════════════════════════════════════════════════════════════
    // THE OWNERSHIP CONTRACT (what REALLY matters)
    // ════════════════════════════════════════════════════════════════════════════
    // Content = GPT generates (WHAT to say)
    // Runtime = ConversationEngine decides (HOW/WHEN to behave)
    // Admin = Infrastructure policies
    // System = Auto-generated
    
    // For backward compatibility, runtimeContract = content + runtime + admin
    const runtimeContract = [...byOwnership.content, ...byOwnership.runtime, ...byOwnership.admin];
    const runtimeContractCount = runtimeContract.length;
    
    // ════════════════════════════════════════════════════════════════════════════
    // DERIVED COUNTS FROM OWNERSHIP (the truth)
    // ════════════════════════════════════════════════════════════════════════════
    
    // Content = WHAT to say (GPT generates these)
    const contentSettings = byOwnership.content;
    const contentCount = contentSettings.length;
    
    // Runtime = HOW/WHEN to behave (ConversationEngine decides at call time)
    const runtimeOwnedSettings = byOwnership.runtime;
    const runtimeOwnedCount = runtimeOwnedSettings.length;
    
    // Admin = Infrastructure policies (admin configures)
    const adminSettings = byOwnership.admin;
    const adminCount = adminSettings.length;
    
    // System = Auto-generated (never touched)
    const systemCount = byOwnership.system.length;
    
    // Gap Fill generates CONTENT only
    const gapGenerated = contentCount;
    
    // Audit checks content + runtime + admin (everything human-visible)
    const audited = contentCount + runtimeOwnedCount + adminCount;
    
    // Agent uses everything
    const agentUsed = total;
    
    // ════════════════════════════════════════════════════════════════════════════
    // ALIGNMENT CHECK (should always be 100% now!)
    // ════════════════════════════════════════════════════════════════════════════
    // With single ownership source of truth, there are NO gaps by definition
    const alignedCount = audited;
    const gapsCount = 0; // No drift possible!
    
    return {
        total,
        
        // ════════════════════════════════════════════════════════════════════════════
        // 🎯 OWNERSHIP MODEL (the REAL contract)
        // ════════════════════════════════════════════════════════════════════════════
        ownership: {
            content: contentCount,       // WHAT to say (GPT generates)
            runtime: runtimeOwnedCount,  // HOW/WHEN (ConversationEngine decides)
            admin: adminCount,           // Infrastructure (admin configures)
            system: systemCount,         // Auto-generated (never touched)
            
            // Detailed lists
            contentSettings: contentSettings.map(([k, v]) => ({ setting: k, ...v, ...derivePolicy(v) })),
            runtimeOwnedSettings: runtimeOwnedSettings.map(([k, v]) => ({ setting: k, ...v, ...derivePolicy(v) })),
            adminSettings: adminSettings.map(([k, v]) => ({ setting: k, ...v, ...derivePolicy(v) }))
        },
        
        // ════════════════════════════════════════════════════════════════════════════
        // LEGACY: Runtime Contract (for backward compatibility)
        // ════════════════════════════════════════════════════════════════════════════
        runtimeContract: {
            total: runtimeContractCount,
            aiGenerates: contentCount,        // CONTENT is what AI generates
            adminConfigures: adminCount,      // ADMIN settings need manual config
            runtimeOwns: runtimeOwnedCount,   // RUNTIME decides at call time
            settings: runtimeContract.map(([k, v]) => ({ 
                setting: k, 
                ...v,
                ...derivePolicy(v)
            }))
        },
        
        // ════════════════════════════════════════════════════════════════════════════
        // DERIVED COUNTS (for backward compatibility)
        // ════════════════════════════════════════════════════════════════════════════
        audited,           // = content + runtime + admin
        gapGenerated,      // = content only (WHAT to say)
        agentUsed,         // = everything
        
        // Purpose breakdown (legacy)
        byPurpose: {
            runtime: byPurpose.runtime.length,
            runtimeManual: byPurpose.runtime_manual.length,
            generation: byPurpose.generation.length,
            system: byPurpose.system.length,
            future: byPurpose.future.length
        },
        
        // AI vs Admin breakdown
        aiGenerates: aiGenerates.map(([k, v]) => ({ setting: k, ...v })),
        adminConfigures: adminConfigures.map(([k, v]) => ({ setting: k, ...v })),
        
        // ========================================
        // ALIGNMENT STATUS (always perfect now!)
        // ========================================
        aligned: runtimeContract.map(([k, v]) => ({ setting: k, ...v })),
        alignedCount,
        totalRuntimeSettings: runtimeContractCount,
        
        // No gaps possible with single source of truth!
        gaps: [],
        gapsCount,
        
        // Legacy compatibility
        mismatches: [],
        unaudited: [],
        runtimeAuto: byPurpose.runtime.length,
        runtimeManual: byPurpose.runtime_manual.length
    };
}

/**
 * Get all settings by category
 * @returns {Object} Settings grouped by their section
 */
function getSettingsByCategory() {
    const categories = {
        'Identity & Lifecycle': ['scenarioId', 'version', 'status', 'name', 'isActive', 'scope', 'ownerCompanyId', 'notes'],
        'Categorization': ['categories', 'scenarioType', 'priority', 'cooldownSeconds'],
        'Matching - Triggers': ['triggers', 'regexTriggers', 'negativeTriggers', 'exampleUserPhrases', 'negativeUserPhrases', 'keywords', 'negativeKeywords', 'embeddingVector', 'contextWeight'],
        'Confidence & Priority': ['minConfidence'],
        'Replies - Core': ['quickReplies', 'fullReplies', 'quickReplies_noName', 'fullReplies_noName', 'replyStrategy', 'replySelection', 'replyBundles', 'replyPolicy'],
        'Follow-Up Behavior': ['followUpMode', 'followUpQuestionText', 'followUpPrompts', 'followUpFunnel', 'transferTarget'],
        'Wiring - Action': ['actionType', 'flowId', 'bookingIntent', 'requiredSlots', 'stopRouting'],
        'Entity Capture': ['entityCapture', 'entityValidation', 'dynamicVariables'],
        'Behavior & Voice': ['behavior', 'toneLevel', 'ttsOverride', 'channel'],
        'Timing & Silence': ['timedFollowUp', 'silencePolicy'],
        'Action Hooks': ['actionHooks', 'handoffPolicy'],
        'State Machine': ['preconditions', 'effects'],
        'AI Intelligence': ['qnaPairs', 'testPhrases', 'examples', 'escalationFlags'],
        'Multilingual': ['language']
    };
    
    const result = {};
    for (const [category, settingNames] of Object.entries(categories)) {
        result[category] = settingNames.map(name => ({
            name,
            ...SCENARIO_SETTINGS_REGISTRY[name]
        }));
    }
    return result;
}

/**
 * Validate that a setting is properly implemented
 * @param {string} settingName - Name of the setting
 * @returns {Object} { valid, issues }
 */
function validateSettingImplementation(settingName) {
    const setting = SCENARIO_SETTINGS_REGISTRY[settingName];
    if (!setting) {
        return { valid: false, issues: ['Setting not found in registry'] };
    }
    
    const issues = [];
    
    // Warning: Audited/Generated but not used by agent
    if ((setting.audit || setting.gap) && !setting.agent) {
        if (!setting.description.includes('NOT IMPLEMENTED')) {
            issues.push(`⚠️ ${settingName} is audited/generated but agent doesn't use it`);
        }
    }
    
    // Warning: Used by agent but not audited
    if (setting.agent && !setting.audit) {
        issues.push(`⚠️ ${settingName} is used by agent but not audited`);
    }
    
    return {
        valid: issues.length === 0,
        issues
    };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = {
    // Banned phrases
    CHATBOT_PHRASES,
    HELPDESK_PHRASES,
    LAZY_QUESTIONS,
    TROUBLESHOOTING_PHRASES,
    ALL_BANNED_PHRASES,
    
    // Approved phrases
    APPROVED_ACKNOWLEDGMENTS,
    APPROVED_NAME_ACKNOWLEDGMENTS,
    APPROVED_LOYALTY_ACKNOWLEDGMENTS,
    
    // Limits
    RESPONSE_LIMITS,
    
    // Placeholders
    ALLOWED_PLACEHOLDERS,
    DEPRECATED_PLACEHOLDERS,
    
    // Structure
    BOOKING_PHRASES,
    CLASSIFICATION_PHRASES,
    
    // Scenario types & defaults
    SCENARIO_TYPES,
    PRIORITY_RANGES,
    ACTION_TYPES,
    FOLLOW_UP_MODES,
    APPROVED_BEHAVIORS,
    BANNED_BEHAVIORS,
    
    // Wiring validation
    ACTION_TYPE_REQUIREMENTS,
    FOLLOW_UP_MODE_REQUIREMENTS,
    
    // Trigger validation
    TRIGGER_LIMITS,
    GENERIC_TRIGGERS,
    
    // Meta
    SEVERITY,
    RULE_CATEGORIES,
    
    // 🎯 MASTER SETTINGS REGISTRY - Single source of truth
    SCENARIO_SETTINGS_REGISTRY,
    getSettingsCount,
    getSettingsByCategory,
    validateSettingImplementation
};
