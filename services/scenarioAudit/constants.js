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
// - AGENT: Does the runtime agent use this setting?
// 
// ⚠️ If AUDIT=true but AGENT=false, we're checking something that doesn't matter
// ⚠️ If GAP=true but AGENT=false, we're generating something that gets ignored
// ⚠️ ALL THREE SHOULD MATCH for every important setting
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * SCENARIO_SETTINGS_REGISTRY - Master list of all scenario settings
 * 
 * PURPOSE TYPES:
 * - "runtime": Setting actively used by agent when responding
 * - "generation": Setting influences how replies are WRITTEN (Gap), not DELIVERED
 * - "system": Internal/automatic setting, not user-facing
 * - "future": Planned but not yet implemented
 * 
 * ALIGNMENT RULES:
 * 1. If agent uses it → audit should check it
 * 2. If purpose="generation" → agent=false is EXPECTED (not a gap)
 * 3. If purpose="future" → can ignore for now
 */
const SCENARIO_SETTINGS_REGISTRY = {
    // ============================================
    // IDENTITY & LIFECYCLE (8 settings)
    // ============================================
    scenarioId:       { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Unique scenario identifier' },
    version:          { audit: false, gap: false, agent: false, purpose: 'system', description: 'Version number for rollback' },
    status:           { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'draft/live/archived - only live scenarios match' },
    name:             { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Human-readable scenario name' },
    isActive:         { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Quick on/off toggle' },
    scope:            { audit: false, gap: false, agent: true,  purpose: 'system', description: 'GLOBAL vs COMPANY scope' },
    ownerCompanyId:   { audit: false, gap: false, agent: true,  purpose: 'system', description: 'Company that owns this scenario' },
    notes:            { audit: false, gap: false, agent: false, purpose: 'system', description: 'Admin notes (not used by AI)' },
    
    // ============================================
    // CATEGORIZATION (4 settings)
    // ============================================
    categories:       { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Category tags for organization' },
    scenarioType:     { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'EMERGENCY/BOOKING/FAQ/etc - determines reply strategy' },
    priority:         { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Tie-breaker when multiple scenarios match' },
    cooldownSeconds:  { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Prevents scenario from firing again within N seconds' },
    
    // ============================================
    // MATCHING - TRIGGERS (7 settings)
    // ============================================
    triggers:         { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Plain phrases for BM25 keyword matching' },
    regexTriggers:    { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Advanced pattern matching (regex)' },
    negativeTriggers: { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Phrases that PREVENT matching' },
    keywords:         { audit: true,  gap: false, agent: true,  purpose: 'system', description: 'Fast Tier-1 matching keywords (auto-generated)' },
    negativeKeywords: { audit: true,  gap: false, agent: true,  purpose: 'system', description: 'Keywords that veto matches (auto-generated)' },
    embeddingVector:  { audit: false, gap: false, agent: true,  purpose: 'system', description: 'Precomputed semantic embedding (auto-generated)' },
    contextWeight:    { audit: false, gap: false, agent: true,  purpose: 'system', description: 'Multiplier for final match score' },
    
    // ============================================
    // CONFIDENCE & PRIORITY (1 setting)
    // ============================================
    minConfidence:    { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Scenario-level confidence threshold' },
    
    // ============================================
    // REPLIES - CORE (8 settings)
    // ============================================
    quickReplies:         { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Short/quick response variations' },
    fullReplies:          { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Full/detailed response variations' },
    quickReplies_noName:  { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Quick replies without {name} for unknown callers' },
    fullReplies_noName:   { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Full replies without {name} for unknown callers' },
    replyStrategy:        { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'AUTO/FULL_ONLY/QUICK_ONLY/etc' },
    replySelection:       { audit: false, gap: false, agent: true,  purpose: 'system', description: 'sequential/random/bandit selection' },
    replyBundles:         { audit: false, gap: false, agent: false, purpose: 'future', description: 'Reply bundle system (future)' },
    replyPolicy:          { audit: false, gap: false, agent: false, purpose: 'future', description: 'ROTATE_PER_CALLER/etc (future)' },
    
    // ============================================
    // FOLLOW-UP BEHAVIOR (5 settings)
    // ============================================
    followUpMode:         { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'NONE/ASK_FOLLOWUP_QUESTION/ASK_IF_BOOK/TRANSFER' },
    followUpQuestionText: { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Text to ask for follow-up' },
    followUpPrompts:      { audit: false, gap: false, agent: false, purpose: 'future', description: 'Follow-up prompts (future)' },
    followUpFunnel:       { audit: false, gap: false, agent: false, purpose: 'future', description: 'Re-engagement prompt (future)' },
    transferTarget:       { audit: true,  gap: false, agent: true,  purpose: 'runtime_manual', description: 'Queue/extension for transfer (manual config)' },
    
    // ============================================
    // WIRING - ACTION (5 settings)
    // ============================================
    actionType:       { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'REPLY_ONLY/START_FLOW/REQUIRE_BOOKING/TRANSFER' },
    flowId:           { audit: true,  gap: false, agent: true,  purpose: 'runtime_manual', description: 'Dynamic Flow to execute (manual config)' },
    bookingIntent:    { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'true = caller wants to book' },
    requiredSlots:    { audit: true,  gap: false, agent: true,  purpose: 'runtime_manual', description: 'Slots to collect for booking (manual config)' },
    stopRouting:      { audit: true,  gap: false, agent: true,  purpose: 'runtime_manual', description: 'Stop routing flag (manual config)' },
    
    // ============================================
    // ENTITY CAPTURE (3 settings)
    // ============================================
    entityCapture:    { audit: true,  gap: true,  agent: false, purpose: 'future', description: 'Entities to extract (future runtime implementation)' },
    entityValidation: { audit: true,  gap: false, agent: false, purpose: 'future', description: 'Validation rules per entity (future)' },
    dynamicVariables: { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'Variable fallbacks when entity missing' },
    
    // ============================================
    // BEHAVIOR & VOICE (4 settings)
    // ============================================
    behavior:         { audit: true,  gap: true,  agent: false, purpose: 'generation', description: 'AI personality - influences how replies are WRITTEN' },
    toneLevel:        { audit: false, gap: false, agent: false, purpose: 'system', description: 'DEPRECATED - use behavior instead' },
    ttsOverride:      { audit: true,  gap: false, agent: false, purpose: 'not_implemented', description: '⚠️ NOT IMPLEMENTED - TTS uses company-level settings only' },
    channel:          { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'voice/sms/chat/any channel restriction' },
    
    // ============================================
    // TIMING & SILENCE (2 settings)
    // ============================================
    timedFollowUp:    { audit: true,  gap: false, agent: false, purpose: 'not_implemented', description: '⚠️ NOT IMPLEMENTED - Stored but timer never triggers' },
    silencePolicy:    { audit: true,  gap: false, agent: true,  purpose: 'runtime_manual', description: 'Silence handling policy (manual config)' },
    
    // ============================================
    // ACTION HOOKS (2 settings)
    // ============================================
    actionHooks:      { audit: true,  gap: false, agent: false, purpose: 'not_implemented', description: '⚠️ NOT IMPLEMENTED - Stored but never executed' },
    handoffPolicy:    { audit: true,  gap: true,  agent: true,  purpose: 'runtime', description: 'When to escalate to human' },
    
    // ============================================
    // STATE MACHINE (2 settings)
    // ============================================
    preconditions:    { audit: false, gap: false, agent: true,  purpose: 'system', description: 'Conditions for scenario to match - WORKING in HybridScenarioSelector' },
    effects:          { audit: false, gap: false, agent: false, purpose: 'not_implemented', description: '⚠️ NOT IMPLEMENTED - Effects stored but never applied' },
    
    // ============================================
    // AI INTELLIGENCE (4 settings)
    // ============================================
    qnaPairs:         { audit: false, gap: false, agent: true,  purpose: 'system', description: 'Training data for semantic matching (auto-generated)' },
    testPhrases:      { audit: false, gap: false, agent: false, purpose: 'system', description: 'Validation test cases' },
    examples:         { audit: false, gap: false, agent: false, purpose: 'system', description: 'Sample conversations for admin' },
    escalationFlags:  { audit: false, gap: false, agent: true,  purpose: 'system', description: 'Triggers for human handoff' },
    
    // ============================================
    // MULTILINGUAL (1 setting)
    // ============================================
    language:         { audit: false, gap: false, agent: true,  purpose: 'system', description: 'auto/en/es/fr language setting' }
};

/**
 * Get settings count summary
 * @returns {Object} { total, audited, gapGenerated, agentUsed, aligned, gaps }
 */
function getSettingsCount() {
    const settings = Object.entries(SCENARIO_SETTINGS_REGISTRY);
    const total = settings.length;
    
    // Count by flag
    const audited = settings.filter(([_, v]) => v.audit).length;
    const gapGenerated = settings.filter(([_, v]) => v.gap).length;
    const agentUsed = settings.filter(([_, v]) => v.agent).length;
    
    // Count by purpose
    const runtimeSettings = settings.filter(([_, v]) => v.purpose === 'runtime');
    const runtimeManualSettings = settings.filter(([_, v]) => v.purpose === 'runtime_manual');
    const generationSettings = settings.filter(([_, v]) => v.purpose === 'generation');
    const systemSettings = settings.filter(([_, v]) => v.purpose === 'system');
    const futureSettings = settings.filter(([_, v]) => v.purpose === 'future');
    const notImplementedSettings = settings.filter(([_, v]) => v.purpose === 'not_implemented');
    
    // ✅ ALIGNED RUNTIME: Gap-generated settings where audit=true, gap=true, agent=true
    const alignedRuntime = runtimeSettings.filter(([_, v]) => v.audit && v.gap && v.agent);
    
    // ✅ ALIGNED MANUAL: Manual settings where audit=true, agent=true (gap not required)
    const alignedManual = runtimeManualSettings.filter(([_, v]) => v.audit && v.agent);
    
    // Total aligned = runtime + manual
    const totalAligned = [...alignedRuntime, ...alignedManual];
    const totalRuntimeSettings = runtimeSettings.length + runtimeManualSettings.length;
    
    // ⚠️ GAPS: Runtime settings that should be aligned but aren't
    const gapsRuntime = runtimeSettings.filter(([_, v]) => !(v.audit && v.gap && v.agent));
    const gapsManual = runtimeManualSettings.filter(([_, v]) => !(v.audit && v.agent));
    const gaps = [...gapsRuntime, ...gapsManual];
    
    // For backwards compatibility, still track these
    const mismatches = settings.filter(([_, v]) => 
        v.purpose === 'future' && (v.audit || v.gap) && !v.agent
    );
    const unaudited = [...runtimeSettings, ...runtimeManualSettings].filter(([_, v]) => v.agent && !v.audit);
    
    return {
        total,
        audited,
        gapGenerated,
        agentUsed,
        
        // Purpose breakdown
        byPurpose: {
            runtime: runtimeSettings.length,
            runtimeManual: runtimeManualSettings.length,
            generation: generationSettings.length,
            system: systemSettings.length,
            future: futureSettings.length,
            notImplemented: notImplementedSettings.length
        },
        
        // ⚠️ NOT IMPLEMENTED: Settings with UI forms but no runtime code
        notImplemented: notImplementedSettings.map(([k, v]) => ({ setting: k, ...v })),
        
        // Alignment status
        aligned: totalAligned.map(([k, v]) => ({ setting: k, ...v })),
        alignedCount: totalAligned.length,
        totalRuntimeSettings,
        
        gaps: gaps.map(([k, v]) => ({ setting: k, ...v })),
        gapsCount: gaps.length,
        
        // Legacy (for UI compatibility)
        mismatches: mismatches.map(([k, v]) => ({ setting: k, ...v })),
        unaudited: unaudited.map(([k, v]) => ({ setting: k, ...v }))
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
        'Matching - Triggers': ['triggers', 'regexTriggers', 'negativeTriggers', 'keywords', 'negativeKeywords', 'embeddingVector', 'contextWeight'],
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
