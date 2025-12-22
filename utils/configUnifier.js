/**
 * ============================================================================
 * CONFIG UNIFIER - Single Source of Truth for Control Plane
 * ============================================================================
 * 
 * PURPOSE: Resolve the "two-config reality" bug by establishing canonical keys
 *          and merging legacy fields into a single unified config.
 * 
 * CANONICAL KEYS:
 * - Greeting: connectionMessages.voice.text
 * - Booking Enabled: frontDeskBehavior.bookingEnabled
 * - Booking Slots: frontDeskBehavior.bookingSlots
 * - Conversation Style: frontDeskBehavior.personality.conversationStyle
 * - Fallbacks: companyResponseDefaults.[notOffered|unknownIntent|afterHours]Reply.fullReply
 * 
 * ============================================================================
 */

const { standardizePlaceholders } = require('./placeholderStandard');

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY PLACEHOLDER FORMAT DETECTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Detect if text contains legacy placeholder formats
 * Legacy formats: {x}, ${x}, %x%
 * Standard format: {{x}}
 * 
 * @param {string} text - Text to check
 * @returns {boolean} - True if legacy formats detected
 */
function hasLegacyPlaceholderFormat(text) {
    if (!text) return false;
    
    // Standard format: {{word}} - these are GOOD
    const standardPattern = /\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g;
    
    // Legacy formats: {word} (single brace), ${word}, %word%
    const legacyPatterns = [
        /(?<!\{)\{([a-zA-Z_][a-zA-Z0-9_]*)\}(?!\})/g,  // {x} but not {{x}}
        /\$\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g,              // ${x}
        /%([a-zA-Z_][a-zA-Z0-9_]*)%/g                   // %x%
    ];
    
    // Check each legacy pattern
    for (const pattern of legacyPatterns) {
        if (pattern.test(text)) {
            return true;
        }
    }
    
    return false;
}

// ═══════════════════════════════════════════════════════════════════════════
// CANONICAL KEY DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const CANONICAL_KEYS = {
    // GREETING (PRIMARY)
    greeting: 'connectionMessages.voice.text',
    greetingRealtime: 'connectionMessages.voice.realtime.text',
    
    // BOOKING (CANONICAL: frontDeskBehavior.booking.*)
    bookingEnabled: 'frontDeskBehavior.booking.enabled',  // NOT frontDeskBehavior.bookingEnabled
    bookingSlots: 'frontDeskBehavior.bookingSlots',
    
    // LOOP PREVENTION (CANONICAL: frontDeskBehavior.loopPrevention.*)
    loopPreventionEnabled: 'frontDeskBehavior.loopPrevention.enabled',
    loopPreventionMaxSameQuestion: 'frontDeskBehavior.loopPrevention.maxSameQuestion',
    loopPreventionOnLoop: 'frontDeskBehavior.loopPrevention.onLoop',
    loopPreventionRephraseIntro: 'frontDeskBehavior.loopPrevention.rephraseIntro',
    
    // PERSONALITY
    conversationStyle: 'frontDeskBehavior.personality.conversationStyle',
    professionalismLevel: 'frontDeskBehavior.personality.professionalismLevel',
    empathyLevel: 'frontDeskBehavior.personality.empathyLevel',
    urgencyDetection: 'frontDeskBehavior.personality.urgencyDetection',
    personalityEnabled: 'frontDeskBehavior.personality.enabled',
    
    // VOCABULARY
    forbiddenPhrases: 'frontDeskBehavior.vocabulary.forbiddenPhrases',
    preferredTerms: 'frontDeskBehavior.vocabulary.preferredTerms',
    
    // POLICIES
    blockPricing: 'frontDeskBehavior.policies.blockPricing',
    blockCompetitorMention: 'frontDeskBehavior.policies.blockCompetitorMention',
    forbiddenTopics: 'frontDeskBehavior.policies.forbiddenTopics',
    
    // FRUSTRATION
    frustrationEnabled: 'frontDeskBehavior.frustration.enabled',
    frustrationThreshold: 'frontDeskBehavior.frustration.threshold',
    
    // DETECTION
    minConfidence: 'frontDeskBehavior.detection.minConfidence',
    fallbackBehavior: 'frontDeskBehavior.detection.fallbackBehavior',
    
    // MODES
    startMode: 'frontDeskBehavior.modes.startMode',
    autoTransitionToBooking: 'frontDeskBehavior.modes.autoTransitionToBooking'
};

// ═══════════════════════════════════════════════════════════════════════════
// DEPRECATED KEYS (read-only, map to canonical)
// ═══════════════════════════════════════════════════════════════════════════

const DEPRECATED_KEYS = {
    // OLD booking enabled paths -> canonical
    'frontDeskBehavior.bookingEnabled': 'frontDeskBehavior.booking.enabled',
    'booking.enabled': 'frontDeskBehavior.booking.enabled',
    'aiAgentSettings.booking.enabled': 'frontDeskBehavior.booking.enabled',
    
    // OLD loop prevention paths -> canonical
    'frontDeskBehavior.loops.maxRepetitions': 'frontDeskBehavior.loopPrevention.maxSameQuestion',
    'frontDeskBehavior.loops.variationStrategy': 'frontDeskBehavior.loopPrevention.onLoop',
    
    // OLD greeting paths -> canonical
    'frontDeskBehavior.greeting.text': 'connectionMessages.voice.text',
    'frontDeskBehavior.greeting': 'connectionMessages.voice.text',
    'callFlowEngine.style.greeting': 'connectionMessages.voice.text'
};

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT HVAC BOOKING SLOTS
// ═══════════════════════════════════════════════════════════════════════════

const DEFAULT_HVAC_BOOKING_SLOTS = [
    {
        key: 'firstName',
        label: 'First Name',
        question: "What's your first name?",
        required: true,
        validation: 'name',
        order: 1
    },
    {
        key: 'lastName',
        label: 'Last Name',
        question: "And your last name?",
        required: true,
        validation: 'name',
        order: 2
    },
    {
        key: 'phone',
        label: 'Phone Number',
        question: "What's the best cell number for technician text updates?",
        required: true,
        validation: 'phone',
        order: 3
    },
    {
        key: 'address',
        label: 'Service Address',
        question: "What's the full service address—street, city, and unit if any?",
        required: true,
        validation: 'address',
        order: 4
    },
    {
        key: 'serviceType',
        label: 'Service Type',
        question: "Is this repair, maintenance, or a new system estimate?",
        required: true,
        validation: 'none',
        order: 5
    },
    {
        key: 'problemDescription',
        label: 'Problem Description',
        question: "What's going on with the system?",
        required: true,
        validation: 'none',
        order: 6
    },
    {
        key: 'timeWindow',
        label: 'Preferred Time',
        question: "Do you prefer morning or afternoon? I can offer 8–10, 10–12, 12–2, or 2–4.",
        required: true,
        validation: 'none',
        order: 7
    }
];

// ═══════════════════════════════════════════════════════════════════════════
// PLACEHOLDER MIGRATION MAP
// ═══════════════════════════════════════════════════════════════════════════

const PLACEHOLDER_MIGRATION_MAP = {
    // Case-insensitive legacy → canonical (camelCase)
    // Company Name
    'companyname': 'companyName',
    'company_name': 'companyName',
    'company-name': 'companyName',
    'COMPANYNAME': 'companyName',
    'CompanyName': 'companyName',
    
    // Business Hours
    'hours': 'businessHours',
    'business_hours': 'businessHours',
    'businesshours': 'businessHours',
    'BusinessHours': 'businessHours',
    'BUSINESSHOURS': 'businessHours',
    
    // Emergency Phone (CRITICAL: must match runtime placeholder key)
    'emergencyphone': 'emergencyPhone',
    'emergency_phone': 'emergencyPhone',
    'emergency-phone': 'emergencyPhone',
    'EMERGENCYPHONE': 'emergencyPhone',
    'EmergencyPhone': 'emergencyPhone',
    
    // Company Phone
    'companyphone': 'companyPhone',
    'company_phone': 'companyPhone',
    'phone': 'companyPhone',
    'CompanyPhone': 'companyPhone',
    'COMPANYPHONE': 'companyPhone',
    
    // Service Area
    'servicearea': 'serviceArea',
    'service_area': 'serviceArea',
    'ServiceArea': 'serviceArea',
    'SERVICEAREA': 'serviceArea'
};

// Canonical placeholder keys (the ONLY keys that should exist in DB after migration)
const CANONICAL_PLACEHOLDER_KEYS = [
    'companyName',
    'companyPhone',
    'businessHours',
    'emergencyPhone',
    'serviceArea',
    'companyAddress',
    'companyEmail',
    'companyWebsite'
];

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Get nested value from object
// ═══════════════════════════════════════════════════════════════════════════

function getNestedValue(obj, path) {
    if (!obj || !path) return undefined;
    const keys = path.split('.');
    let value = obj;
    for (const key of keys) {
        if (value === undefined || value === null) return undefined;
        value = value[key];
    }
    return value;
}

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Set nested value in object
// ═══════════════════════════════════════════════════════════════════════════

function setNestedValue(obj, path, value) {
    if (!obj || !path) return;
    const keys = path.split('.');
    let current = obj;
    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key]) current[key] = {};
        current = current[key];
    }
    current[keys[keys.length - 1]] = value;
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFY GREETING
// ═══════════════════════════════════════════════════════════════════════════

function unifyGreeting(company) {
    // Canonical: connectionMessages.voice.text
    const canonical = getNestedValue(company, 'connectionMessages.voice.text');
    
    // Legacy sources in priority order
    const legacySources = [
        { path: 'connectionMessages.voice.realtime.text', name: 'realtime' },
        { path: 'frontDeskBehavior.greeting', name: 'frontDeskBehavior' },
        { path: 'aiAgentSettings.greeting', name: 'aiAgentSettings' }
    ];
    
    let resolvedValue = canonical;
    let source = canonical ? 'connectionMessages.voice.text' : 'none';
    
    // If canonical is empty, try legacy sources
    if (!canonical) {
        for (const legacy of legacySources) {
            const legacyValue = getNestedValue(company, legacy.path);
            if (legacyValue) {
                resolvedValue = legacyValue;
                source = `${legacy.path} (legacy)`;
                break;
            }
        }
    }
    
    // Standardize placeholders
    const standardized = resolvedValue ? standardizePlaceholders(resolvedValue) : '';
    
    return {
        raw: resolvedValue || '',
        standardized,
        source,
        hasLegacyPlaceholders: resolvedValue !== standardized,
        configured: !!resolvedValue
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFY BOOKING SLOTS
// ═══════════════════════════════════════════════════════════════════════════

function unifyBookingSlots(company, seedIfEmpty = false) {
    // CRITICAL FIX: ControlPlane provider reads from aiAgentSettings.frontDeskBehavior.bookingSlots
    // But some UI writes to root frontDeskBehavior.bookingSlots
    // We MUST check ALL possible locations in priority order
    
    const possibleSources = [
        // Most common: aiAgentSettings.frontDeskBehavior.bookingSlots (where most UI writes)
        { path: 'aiAgentSettings.frontDeskBehavior.bookingSlots', name: 'aiAgentSettings.frontDeskBehavior' },
        // Root level frontDeskBehavior (some legacy UI)
        { path: 'frontDeskBehavior.bookingSlots', name: 'frontDeskBehavior' },
        // Very legacy: aiAgentSettings.bookingSlots (flat)
        { path: 'aiAgentSettings.bookingSlots', name: 'aiAgentSettings (flat)' },
        // Very legacy: booking.slots
        { path: 'booking.slots', name: 'booking' },
        // Very legacy: root level bookingSlots
        { path: 'bookingSlots', name: 'root' }
    ];
    
    let resolvedSlots = null;
    let source = 'none';
    
    // Try each source in priority order
    for (const src of possibleSources) {
        const value = getNestedValue(company, src.path);
        if (value && Array.isArray(value) && value.length > 0) {
            resolvedSlots = value;
            source = src.path;
            break;
        }
    }
    
    // Seed default slots if still empty and requested
    if (!resolvedSlots && seedIfEmpty) {
        resolvedSlots = DEFAULT_HVAC_BOOKING_SLOTS;
        source = 'seeded (HVAC default)';
    }
    
    const slots = resolvedSlots || [];
    
    return {
        slots,
        slotsCount: slots.length,
        slotNames: slots.map(s => s.key || s.name || s.id || 'unknown'),
        source,
        isEmpty: slots.length === 0
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFY BOOKING ENABLED
// ═══════════════════════════════════════════════════════════════════════════

function unifyBookingEnabled(company) {
    // CANONICAL: frontDeskBehavior.booking.enabled (NOT frontDeskBehavior.bookingEnabled)
    // This matches the cp.v2.0 registry schema
    
    // 1. Primary canonical: frontDeskBehavior.booking.enabled
    const canonical = getNestedValue(company, 'frontDeskBehavior.booking.enabled');
    if (canonical !== undefined) {
        return { enabled: canonical, source: 'frontDeskBehavior.booking.enabled' };
    }
    
    // 2. Legacy: frontDeskBehavior.bookingEnabled (old flat key)
    const legacyFlat = getNestedValue(company, 'frontDeskBehavior.bookingEnabled');
    if (legacyFlat !== undefined) {
        return { enabled: legacyFlat, source: 'frontDeskBehavior.bookingEnabled (LEGACY)' };
    }
    
    // 3. Legacy: aiAgentSettings.frontDeskBehavior.booking.enabled
    const aiAgentNested = getNestedValue(company, 'aiAgentSettings.frontDeskBehavior.booking.enabled');
    if (aiAgentNested !== undefined) {
        return { enabled: aiAgentNested, source: 'aiAgentSettings.frontDeskBehavior.booking.enabled' };
    }
    
    // 4. Very Legacy: booking.enabled at root
    const rootBooking = getNestedValue(company, 'booking.enabled');
    if (rootBooking !== undefined) {
        return { enabled: rootBooking, source: 'booking.enabled (LEGACY)' };
    }
    
    // 5. Legacy: aiAgentSettings.bookingEnabled
    const aiAgentFlat = getNestedValue(company, 'aiAgentSettings.bookingEnabled');
    if (aiAgentFlat !== undefined) {
        return { enabled: aiAgentFlat, source: 'aiAgentSettings.bookingEnabled (LEGACY)' };
    }
    
    // Default
    return { enabled: true, source: 'default' };
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFY CONVERSATION STYLE
// ═══════════════════════════════════════════════════════════════════════════

function unifyConversationStyle(company) {
    // CRITICAL: Check aiAgentSettings.frontDeskBehavior paths FIRST (where ControlPlane reads)
    
    // 1. aiAgentSettings.frontDeskBehavior.personality.conversationStyle
    const aiAgentNested = getNestedValue(company, 'aiAgentSettings.frontDeskBehavior.personality.conversationStyle');
    if (aiAgentNested) {
        return { style: aiAgentNested, source: 'aiAgentSettings.frontDeskBehavior.personality.conversationStyle' };
    }
    
    // 2. aiAgentSettings.frontDeskBehavior.conversationStyle (flat)
    const aiAgentFlat = getNestedValue(company, 'aiAgentSettings.frontDeskBehavior.conversationStyle');
    if (aiAgentFlat) {
        return { style: aiAgentFlat, source: 'aiAgentSettings.frontDeskBehavior.conversationStyle' };
    }
    
    // 3. Root frontDeskBehavior.personality.conversationStyle
    const rootNested = getNestedValue(company, 'frontDeskBehavior.personality.conversationStyle');
    if (rootNested) {
        return { style: rootNested, source: 'frontDeskBehavior.personality.conversationStyle' };
    }
    
    // 4. Root frontDeskBehavior.conversationStyle (legacy)
    const rootFlat = getNestedValue(company, 'frontDeskBehavior.conversationStyle');
    if (rootFlat) {
        return { style: rootFlat, source: 'frontDeskBehavior.conversationStyle (legacy)' };
    }
    
    // Default
    return { style: 'balanced', source: 'default' };
}

// ═══════════════════════════════════════════════════════════════════════════
// MIGRATE PLACEHOLDERS IN TEXT
// ═══════════════════════════════════════════════════════════════════════════

function migratePlaceholders(text) {
    if (!text) return text;
    
    let result = text;
    
    // Replace legacy brace formats with standard double-brace
    // Pattern: {word} -> {{word}}
    result = result.replace(/\{([a-zA-Z_]+)\}/g, (match, key) => {
        const normalizedKey = PLACEHOLDER_MIGRATION_MAP[key.toLowerCase()] || key;
        return `{{${normalizedKey}}}`;
    });
    
    // Replace ${word} -> {{word}}
    result = result.replace(/\$\{([a-zA-Z_]+)\}/g, (match, key) => {
        const normalizedKey = PLACEHOLDER_MIGRATION_MAP[key.toLowerCase()] || key;
        return `{{${normalizedKey}}}`;
    });
    
    // Replace %word% -> {{word}}
    result = result.replace(/%([a-zA-Z_]+)%/g, (match, key) => {
        const normalizedKey = PLACEHOLDER_MIGRATION_MAP[key.toLowerCase()] || key;
        return `{{${normalizedKey}}}`;
    });
    
    // Normalize existing {{key}} to use canonical keys
    result = result.replace(/\{\{([a-zA-Z_]+)\}\}/g, (match, key) => {
        const normalizedKey = PLACEHOLDER_MIGRATION_MAP[key.toLowerCase()] || key;
        return `{{${normalizedKey}}}`;
    });
    
    return result;
}

// ═══════════════════════════════════════════════════════════════════════════
// DETECT QUICKANSWER DUPLICATES
// ═══════════════════════════════════════════════════════════════════════════

function detectQuickAnswerDuplicates(quickAnswers) {
    if (!Array.isArray(quickAnswers) || quickAnswers.length === 0) return [];
    
    const duplicates = [];
    const triggerMap = new Map(); // key: normalized triggers string -> first QA
    
    for (const qa of quickAnswers) {
        if (!qa.triggers || !Array.isArray(qa.triggers)) continue;
        
        // Create normalized key from triggers (sorted, lowercase)
        const normalizedTriggers = qa.triggers
            .map(t => (t || '').toLowerCase().trim())
            .sort()
            .join('|');
        
        if (!normalizedTriggers) continue;
        
        if (triggerMap.has(normalizedTriggers)) {
            const first = triggerMap.get(normalizedTriggers);
            duplicates.push({
                triggers: qa.triggers,
                firstQuestion: first.question || first.name,
                firstAnswer: (first.answer || '').substring(0, 50) + '...',
                duplicateQuestion: qa.question || qa.name,
                duplicateAnswer: (qa.answer || '').substring(0, 50) + '...',
                recommendation: 'Keep one, disable the other'
            });
        } else {
            triggerMap.set(normalizedTriggers, qa);
        }
    }
    
    return duplicates;
}

// ═══════════════════════════════════════════════════════════════════════════
// UNIFY FULL CONFIG (MAIN ENTRY POINT)
// ═══════════════════════════════════════════════════════════════════════════

function unifyConfig(company, responseDefaults = {}, options = {}) {
    const { seedBookingSlotsIfEmpty = false } = options;
    
    // Unify each section
    const greeting = unifyGreeting(company);
    const bookingSlots = unifyBookingSlots(company, seedBookingSlotsIfEmpty);
    const bookingEnabled = unifyBookingEnabled(company);
    const conversationStyle = unifyConversationStyle(company);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // DETECT BOOKING ENGINE CONFLICT
    // Two booking systems: callFlowEngine.bookingFields vs frontDeskBehavior.bookingSlots
    // ═══════════════════════════════════════════════════════════════════════════
    const callFlowBookingFields = getNestedValue(company, 'callFlowEngine.bookingFields') || [];
    const frontDeskBookingSlots = bookingSlots.slots || [];
    const hasCallFlowFields = Array.isArray(callFlowBookingFields) && callFlowBookingFields.length > 0;
    const hasFrontDeskSlots = Array.isArray(frontDeskBookingSlots) && frontDeskBookingSlots.length > 0;
    
    // Determine active booking engine mode (default: SLOTS if available, else FIELDS)
    const explicitMode = getNestedValue(company, 'frontDeskBehavior.bookingEngineMode') 
                      || getNestedValue(company, 'aiAgentSettings.frontDeskBehavior.bookingEngineMode');
    let bookingEngineMode = explicitMode || (hasFrontDeskSlots ? 'SLOTS' : (hasCallFlowFields ? 'FIELDS' : 'NONE'));
    
    const bookingEngineConflict = hasCallFlowFields && hasFrontDeskSlots && !explicitMode;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // DETECT DISCOVERY CONSENT ISSUES
    // If these are too restrictive, scenarios get blocked
    // ═══════════════════════════════════════════════════════════════════════════
    const discoveryConsent = getNestedValue(company, 'callFlowEngine.discoveryConsent') || {};
    const disableScenarioAutoResponses = discoveryConsent.disableScenarioAutoResponses ?? false;
    const forceLLMDiscovery = discoveryConsent.forceLLMDiscovery ?? false;
    const bookingRequiresExplicitConsent = discoveryConsent.bookingRequiresExplicitConsent ?? true;
    
    // Warn if scenarios are being blocked unnecessarily
    const scenariosBlockedByConsent = disableScenarioAutoResponses || forceLLMDiscovery;
    
    // ═══════════════════════════════════════════════════════════════════════════
    // DETECT QUICKANSWERS DUPLICATES
    // ═══════════════════════════════════════════════════════════════════════════
    const quickAnswers = getNestedValue(company, 'aiAgentSettings.quickAnswers') || [];
    const quickAnswerDuplicates = detectQuickAnswerDuplicates(quickAnswers);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // BUILD CONFLICTS & WARNINGS LIST
    // ═══════════════════════════════════════════════════════════════════════════
    const conflicts = [];
    const warnings = [];
    
    if (bookingEngineConflict) {
        conflicts.push({
            type: 'BOOKING_ENGINE_CONFLICT',
            severity: 'critical',
            message: `Two booking systems active: callFlowEngine.bookingFields (${callFlowBookingFields.length} fields) AND frontDeskBehavior.bookingSlots (${frontDeskBookingSlots.length} slots). Set bookingEngineMode to resolve.`,
            fix: 'Set frontDeskBehavior.bookingEngineMode to "SLOTS" or "FIELDS"',
            activeMode: bookingEngineMode
        });
    }
    
    if (scenariosBlockedByConsent) {
        warnings.push({
            type: 'SCENARIOS_BLOCKED_BY_CONSENT',
            severity: 'high',
            message: 'Scenario auto-responses disabled by discovery consent settings. AI will feel "dumb" or stall.',
            flags: { disableScenarioAutoResponses, forceLLMDiscovery },
            fix: 'Set disableScenarioAutoResponses=false and forceLLMDiscovery=false'
        });
    }
    
    if (quickAnswerDuplicates.length > 0) {
        warnings.push({
            type: 'QUICKANSWER_DUPLICATES',
            severity: 'medium',
            message: `${quickAnswerDuplicates.length} duplicate QuickAnswer(s) detected. Inconsistent responses possible.`,
            duplicates: quickAnswerDuplicates,
            fix: 'Remove or disable duplicate QuickAnswers'
        });
    }
    
    // Standardize fallback placeholders
    const notOfferedReply = migratePlaceholders(responseDefaults?.notOfferedReply?.fullReply || '');
    const unknownIntentReply = migratePlaceholders(responseDefaults?.unknownIntentReply?.fullReply || '');
    const afterHoursReply = migratePlaceholders(responseDefaults?.afterHoursReply?.fullReply || '');
    
    return {
        // ═══════════════════════════════════════════════════════════════════
        // UNIFIED GREETING
        // ═══════════════════════════════════════════════════════════════════
        greeting: {
            raw: greeting.raw,
            standardized: greeting.standardized,
            source: greeting.source,
            configured: greeting.configured,
            hasLegacyPlaceholders: greeting.hasLegacyPlaceholders,
            needsMigration: greeting.hasLegacyPlaceholders
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // UNIFIED PERSONALITY
        // CRITICAL: Check aiAgentSettings.frontDeskBehavior FIRST (where ControlPlane reads)
        // then fall back to root frontDeskBehavior
        // ═══════════════════════════════════════════════════════════════════
        personality: {
            enabled: getNestedValue(company, 'aiAgentSettings.frontDeskBehavior.personality.enabled') 
                    ?? getNestedValue(company, 'frontDeskBehavior.personality.enabled') 
                    ?? true,
            professionalismLevel: getNestedValue(company, 'aiAgentSettings.frontDeskBehavior.personality.professionalismLevel') 
                    ?? getNestedValue(company, 'frontDeskBehavior.personality.professionalismLevel') 
                    ?? 7,
            empathyLevel: getNestedValue(company, 'aiAgentSettings.frontDeskBehavior.personality.empathyLevel') 
                    ?? getNestedValue(company, 'frontDeskBehavior.personality.empathyLevel') 
                    ?? 8,
            urgencyDetection: getNestedValue(company, 'aiAgentSettings.frontDeskBehavior.personality.urgencyDetection') 
                    ?? getNestedValue(company, 'frontDeskBehavior.personality.urgencyDetection') 
                    ?? true,
            conversationStyle: conversationStyle.style,
            conversationStyleSource: conversationStyle.source
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // UNIFIED BOOKING
        // ═══════════════════════════════════════════════════════════════════
        booking: {
            enabled: bookingEnabled.enabled,
            enabledSource: bookingEnabled.source,
            slots: bookingSlots.slots,
            slotsCount: bookingSlots.slotsCount,
            slotNames: bookingSlots.slotNames,
            slotsSource: bookingSlots.source,
            misconfigured: bookingEnabled.enabled && bookingSlots.isEmpty,
            
            // Booking Engine Mode (resolves SLOTS vs FIELDS conflict)
            engineMode: bookingEngineMode,
            engineModeExplicit: !!explicitMode,
            hasConflict: bookingEngineConflict,
            callFlowFieldsCount: callFlowBookingFields.length,
            frontDeskSlotsCount: frontDeskBookingSlots.length
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // DISCOVERY CONSENT (affects scenario behavior)
        // ═══════════════════════════════════════════════════════════════════
        discoveryConsent: {
            disableScenarioAutoResponses,
            forceLLMDiscovery,
            bookingRequiresExplicitConsent,
            scenariosBlockedByConsent,
            recommendation: scenariosBlockedByConsent 
                ? 'Set disableScenarioAutoResponses=false and forceLLMDiscovery=false to allow scenario replies'
                : 'OK - Scenarios can respond normally'
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // UNIFIED VOCABULARY & POLICIES
        // ═══════════════════════════════════════════════════════════════════
        vocabulary: {
            forbiddenPhrases: getNestedValue(company, 'frontDeskBehavior.vocabulary.forbiddenPhrases') || [],
            forbiddenPhrasesCount: (getNestedValue(company, 'frontDeskBehavior.vocabulary.forbiddenPhrases') || []).length,
            preferredTerms: getNestedValue(company, 'frontDeskBehavior.vocabulary.preferredTerms') || {}
        },
        
        policies: {
            blockPricing: getNestedValue(company, 'frontDeskBehavior.policies.blockPricing') ?? true,
            blockCompetitorMention: getNestedValue(company, 'frontDeskBehavior.policies.blockCompetitorMention') ?? true,
            forbiddenTopics: getNestedValue(company, 'frontDeskBehavior.policies.forbiddenTopics') || []
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // UNIFIED ESCALATION
        // ═══════════════════════════════════════════════════════════════════
        escalation: {
            rules: getNestedValue(company, 'frontDeskBehavior.escalation.rules') || [],
            rulesCount: (getNestedValue(company, 'frontDeskBehavior.escalation.rules') || []).length,
            frustrationEnabled: getNestedValue(company, 'frontDeskBehavior.frustration.enabled') ?? true,
            frustrationThreshold: getNestedValue(company, 'frontDeskBehavior.frustration.threshold') ?? 3
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // UNIFIED FALLBACKS (with placeholder migration)
        // ═══════════════════════════════════════════════════════════════════
        fallbacks: {
            notOfferedReply,
            notOfferedConfigured: !!notOfferedReply,
            notOfferedHasLegacyPlaceholders: hasLegacyPlaceholderFormat(notOfferedReply),
            unknownIntentReply,
            unknownIntentConfigured: !!unknownIntentReply,
            unknownIntentHasLegacyPlaceholders: hasLegacyPlaceholderFormat(unknownIntentReply),
            afterHoursReply,
            afterHoursConfigured: !!afterHoursReply,
            afterHoursHasLegacyPlaceholders: hasLegacyPlaceholderFormat(afterHoursReply)
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // UNIFIED DETECTION
        // ═══════════════════════════════════════════════════════════════════
        detection: {
            minConfidence: getNestedValue(company, 'frontDeskBehavior.detection.minConfidence') ?? 0.5,
            fallbackBehavior: getNestedValue(company, 'frontDeskBehavior.detection.fallbackBehavior') ?? 'ask_clarification'
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // UNIFIED LOOP PREVENTION (CANONICAL: frontDeskBehavior.loopPrevention.*)
        // NOT frontDeskBehavior.loops.* (deprecated)
        // ═══════════════════════════════════════════════════════════════════
        loopPrevention: {
            enabled: getNestedValue(company, 'frontDeskBehavior.loopPrevention.enabled')
                    ?? getNestedValue(company, 'aiAgentSettings.frontDeskBehavior.loopPrevention.enabled')
                    ?? getNestedValue(company, 'frontDeskBehavior.loops.enabled') // legacy fallback
                    ?? true,
            maxSameQuestion: getNestedValue(company, 'frontDeskBehavior.loopPrevention.maxSameQuestion')
                    ?? getNestedValue(company, 'aiAgentSettings.frontDeskBehavior.loopPrevention.maxSameQuestion')
                    ?? getNestedValue(company, 'frontDeskBehavior.loops.maxRepetitions') // legacy fallback
                    ?? 2,
            onLoop: getNestedValue(company, 'frontDeskBehavior.loopPrevention.onLoop')
                    ?? getNestedValue(company, 'aiAgentSettings.frontDeskBehavior.loopPrevention.onLoop')
                    ?? getNestedValue(company, 'frontDeskBehavior.loops.variationStrategy') // legacy fallback
                    ?? 'rephrase',
            rephraseIntro: getNestedValue(company, 'frontDeskBehavior.loopPrevention.rephraseIntro')
                    ?? getNestedValue(company, 'aiAgentSettings.frontDeskBehavior.loopPrevention.rephraseIntro')
                    ?? "Let me try this differently —",
            // Legacy detection
            hasLegacyLoops: !!(getNestedValue(company, 'frontDeskBehavior.loops.maxRepetitions') || getNestedValue(company, 'frontDeskBehavior.loops.variationStrategy')),
            source: getNestedValue(company, 'frontDeskBehavior.loopPrevention.enabled') !== undefined 
                    ? 'frontDeskBehavior.loopPrevention' 
                    : (getNestedValue(company, 'frontDeskBehavior.loops.enabled') !== undefined ? 'frontDeskBehavior.loops (LEGACY)' : 'defaults')
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // UNIFIED MODES
        // ═══════════════════════════════════════════════════════════════════
        modes: {
            startMode: getNestedValue(company, 'frontDeskBehavior.modes.startMode') ?? 'DISCOVERY',
            autoTransitionToBooking: getNestedValue(company, 'frontDeskBehavior.modes.autoTransitionToBooking') ?? true
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // QUICKANSWERS STATUS
        // ═══════════════════════════════════════════════════════════════════
        quickAnswers: {
            count: quickAnswers.length,
            duplicatesCount: quickAnswerDuplicates.length,
            duplicates: quickAnswerDuplicates,
            hasDuplicates: quickAnswerDuplicates.length > 0
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // CONFLICTS & WARNINGS (Critical for debugging)
        // ═══════════════════════════════════════════════════════════════════
        _conflicts: conflicts,
        _warnings: warnings,
        _health: {
            status: conflicts.length > 0 ? 'CRITICAL' : (warnings.length > 0 ? 'WARNING' : 'OK'),
            conflictsCount: conflicts.length,
            warningsCount: warnings.length,
            summary: conflicts.length > 0 
                ? `${conflicts.length} critical conflict(s) need immediate attention`
                : (warnings.length > 0 
                    ? `${warnings.length} warning(s) may affect AI behavior`
                    : 'Configuration looks healthy')
        },
        
        // ═══════════════════════════════════════════════════════════════════
        // METADATA
        // ═══════════════════════════════════════════════════════════════════
        _meta: {
            greetingSource: greeting.source,
            bookingEnabledSource: bookingEnabled.source,
            bookingSlotsSource: bookingSlots.source,
            conversationStyleSource: conversationStyle.source,
            bookingEngineMode: bookingEngineMode,
            canonicalKeys: CANONICAL_KEYS,
            unifiedAt: new Date().toISOString()
        }
    };
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
    unifyConfig,
    unifyGreeting,
    unifyBookingSlots,
    unifyBookingEnabled,
    unifyConversationStyle,
    migratePlaceholders,
    detectQuickAnswerDuplicates,
    getNestedValue,
    setNestedValue,
    CANONICAL_KEYS,
    DEFAULT_HVAC_BOOKING_SLOTS,
    PLACEHOLDER_MIGRATION_MAP
};

