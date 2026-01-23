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
    RULE_CATEGORIES
};
