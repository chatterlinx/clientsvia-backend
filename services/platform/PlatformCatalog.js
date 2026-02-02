/**
 * ════════════════════════════════════════════════════════════════════════════════
 * PLATFORM CATALOG - UNIFIED CAPABILITY REGISTRY
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Single source of truth for ALL platform capabilities:
 * - Tokens (placeholders)
 * - Config (wiring registry fields)
 * - Integrations (Google Calendar, SMS, etc.)
 * - RuntimeModules (engines, services)
 * - ScenarioEnforcement (validation rules)
 * 
 * Each item answers 4 questions:
 * 1. Is it built? (code exists)
 * 2. Is it wired? (UI → DB → runtime)
 * 3. Is it configured? (DB has values)
 * 4. Is it executed? (runtime trace proof)
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../../utils/logger');
const { getCatalog } = require('../../config/placeholders/PlaceholderCatalog');
const { wiringRegistryV2, getAllFields } = require('../wiring/wiringRegistry.v2');
const { RUNTIME_READERS_MAP } = require('../wiring/runtimeReaders.map');

// ════════════════════════════════════════════════════════════════════════════════
// ITEM TYPES
// ════════════════════════════════════════════════════════════════════════════════
const ITEM_TYPES = {
    TOKEN: 'Token',
    CONFIG: 'Config',
    INTEGRATION: 'Integration',
    RUNTIME_MODULE: 'RuntimeModule',
    SCENARIO_ENFORCEMENT: 'ScenarioEnforcement'
};

const ITEM_CATEGORIES = {
    // Token categories (from PlaceholderCatalog)
    IDENTITY: 'identity',
    CONTACT: 'contact',
    LOCATION: 'location',
    HOURS: 'hours',
    PRICING: 'pricing',
    ONLINE: 'online',
    CREDENTIALS: 'credentials',
    RUNTIME: 'runtime',
    
    // Config categories
    FRONT_DESK: 'frontDesk',
    BOOKING: 'booking',
    SCENARIOS: 'scenarios',
    VOICE: 'voice',
    CALL_HANDLING: 'callHandling',
    
    // Integration categories
    CALENDAR: 'calendar',
    SMS: 'sms',
    VOICE_PROVIDER: 'voiceProvider',
    
    // Runtime module categories
    ENGINE: 'engine',
    SERVICE: 'service',
    
    // Enforcement categories
    ENFORCEMENT: 'enforcement'
};

// ════════════════════════════════════════════════════════════════════════════════
// INTEGRATION DEFINITIONS (hardcoded - these are platform capabilities)
// ════════════════════════════════════════════════════════════════════════════════
const INTEGRATION_DEFINITIONS = [
    {
        id: 'integrations.googleCalendar',
        key: 'googleCalendar',
        label: 'Google Calendar',
        type: ITEM_TYPES.INTEGRATION,
        category: ITEM_CATEGORIES.CALENDAR,
        description: 'Real-time availability checking and automatic appointment creation',
        dbPath: 'googleCalendar',
        enabledPath: 'googleCalendar.enabled',
        connectedPath: 'googleCalendar.connected',
        runtimeEntryPoints: [
            'services/ConversationEngine.js#finalizeBooking',
            'services/GoogleCalendarService.js#createBookingEvent'
        ],
        apiRoutes: [
            'routes/company/googleCalendar.js'
        ],
        telemetryEvents: [
            'CALENDAR_CHECK',
            'CALENDAR_EVENT_ATTEMPT',
            'CALENDAR_EVENT_CREATED',
            'CALENDAR_EVENT_FAILED'
        ],
        requiredForFeature: 'booking',
        built: true,
        uiPath: 'Company Profile → Configuration → Google Calendar'
    },
    {
        id: 'integrations.smsNotifications',
        key: 'smsNotifications',
        label: 'SMS Notifications',
        type: ITEM_TYPES.INTEGRATION,
        category: ITEM_CATEGORIES.SMS,
        description: 'Booking confirmations and appointment reminders via SMS',
        dbPath: 'smsNotifications',
        enabledPath: 'smsNotifications.enabled',
        runtimeEntryPoints: [
            'services/ConversationEngine.js#finalizeBooking',
            'services/SMSNotificationService.js#sendBookingConfirmation'
        ],
        apiRoutes: [
            'routes/company/smsNotifications.js'
        ],
        telemetryEvents: [
            'SMS_CHECK',
            'SMS_SENT',
            'SMS_FAILED'
        ],
        requiredForFeature: 'booking',
        built: true,
        uiPath: 'Company Profile → Configuration → SMS Notifications'
    },
    {
        id: 'integrations.elevenLabs',
        key: 'elevenLabs',
        label: 'ElevenLabs TTS',
        type: ITEM_TYPES.INTEGRATION,
        category: ITEM_CATEGORIES.VOICE_PROVIDER,
        description: 'High-quality text-to-speech voice synthesis',
        dbPath: 'aiAgentSettings.voiceSettings',
        enabledPath: 'aiAgentSettings.voiceSettings.elevenLabsEnabled',
        runtimeEntryPoints: [
            'services/TTS/ElevenLabsTTSService.js#synthesize'
        ],
        telemetryEvents: [
            'TTS_ELEVENLABS_REQUEST',
            'TTS_ELEVENLABS_SUCCESS',
            'TTS_ELEVENLABS_FAILED'
        ],
        built: true,
        uiPath: 'Front Desk → Voice Settings → Provider'
    }
];

// ════════════════════════════════════════════════════════════════════════════════
// RUNTIME MODULE DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════════
const RUNTIME_MODULE_DEFINITIONS = [
    {
        id: 'runtime.conversationEngine',
        key: 'conversationEngine',
        label: 'Conversation Engine',
        type: ITEM_TYPES.RUNTIME_MODULE,
        category: ITEM_CATEGORIES.ENGINE,
        description: 'Core AI conversation orchestrator',
        entryPoint: 'services/ConversationEngine.js',
        telemetryEvents: ['TURN_TRACE', 'LLM_RESPONSE'],
        built: true,
        critical: true
    },
    {
        id: 'runtime.bookingFlowRunner',
        key: 'bookingFlowRunner',
        label: 'Booking Flow Runner',
        type: ITEM_TYPES.RUNTIME_MODULE,
        category: ITEM_CATEGORIES.ENGINE,
        description: 'Deterministic booking state machine',
        entryPoint: 'services/engine/booking/BookingFlowRunner.js',
        telemetryEvents: ['BOOKING_FLOW_STEP', 'BOOKING_SLOT_COLLECTED'],
        built: true,
        critical: true
    },
    {
        id: 'runtime.slotExtractor',
        key: 'slotExtractor',
        label: 'Slot Extractor',
        type: ITEM_TYPES.RUNTIME_MODULE,
        category: ITEM_CATEGORIES.ENGINE,
        description: 'Extracts booking slots from utterances',
        entryPoint: 'services/engine/booking/SlotExtractor.js',
        telemetryEvents: ['SLOTS_EXTRACTED'],
        built: true,
        critical: true
    },
    {
        id: 'runtime.scenarioMatcher',
        key: 'scenarioMatcher',
        label: 'Scenario Matcher',
        type: ITEM_TYPES.RUNTIME_MODULE,
        category: ITEM_CATEGORIES.ENGINE,
        description: 'Tier-1 deterministic scenario matching',
        entryPoint: 'services/HybridScenarioSelector.js',
        telemetryEvents: ['SCENARIO_MATCHED', 'SCENARIO_POOL_LOADED'],
        built: true,
        critical: true
    },
    {
        id: 'runtime.greetingIntercept',
        key: 'greetingIntercept',
        label: 'Greeting Intercept',
        type: ITEM_TYPES.RUNTIME_MODULE,
        category: ITEM_CATEGORIES.ENGINE,
        description: '0-token fast responses to common greetings',
        entryPoint: 'services/ConversationEngine.js#GREETING_INTERCEPT',
        configPath: 'aiAgentSettings.frontDeskBehavior.conversationStages',
        built: true
    },
    {
        id: 'runtime.afterHoursEvaluator',
        key: 'afterHoursEvaluator',
        label: 'After Hours Evaluator',
        type: ITEM_TYPES.RUNTIME_MODULE,
        category: ITEM_CATEGORIES.SERVICE,
        description: 'Determines if call is after business hours',
        entryPoint: 'services/hours/AfterHoursEvaluator.js',
        configPath: 'aiAgentSettings.businessHours',
        built: true
    },
    {
        id: 'runtime.blackBoxLogger',
        key: 'blackBoxLogger',
        label: 'BlackBox Logger',
        type: ITEM_TYPES.RUNTIME_MODULE,
        category: ITEM_CATEGORIES.SERVICE,
        description: 'Call trace event logger for debugging',
        entryPoint: 'services/BlackBoxLogger.js',
        built: true,
        critical: true
    }
];

// ════════════════════════════════════════════════════════════════════════════════
// SCENARIO ENFORCEMENT DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════════
const ENFORCEMENT_DEFINITIONS = [
    {
        id: 'enforcement.stopRouting',
        key: 'stopRouting',
        label: 'Emergency Stop Routing',
        type: ITEM_TYPES.SCENARIO_ENFORCEMENT,
        category: ITEM_CATEGORIES.ENFORCEMENT,
        description: 'Enforces stop_routing flag on emergency scenarios',
        configPath: 'scenarios[].actions.stop_routing',
        validatorFile: 'utils/scenarioEnforcement.js',
        built: true
    },
    {
        id: 'enforcement.requiredActions',
        key: 'requiredActions',
        label: 'Required Actions Validator',
        type: ITEM_TYPES.SCENARIO_ENFORCEMENT,
        category: ITEM_CATEGORIES.ENFORCEMENT,
        description: 'Validates scenario has required action fields',
        validatorFile: 'services/scenarioAudit/rules/FullScenarioRule.js',
        built: true
    }
];

// ════════════════════════════════════════════════════════════════════════════════
// CATALOG BUILDER
// ════════════════════════════════════════════════════════════════════════════════

/**
 * Build the complete platform catalog
 * @param {string} tradeKey - Trade identifier for trade-specific tokens
 * @returns {Object} Complete catalog with all item types
 */
function buildPlatformCatalog(tradeKey = null) {
    const items = [];
    
    // ════════════════════════════════════════════════════════════════════════════
    // 1. TOKENS (from PlaceholderCatalog)
    // ════════════════════════════════════════════════════════════════════════════
    const placeholderCatalog = getCatalog(tradeKey);
    
    for (const placeholder of placeholderCatalog.placeholders) {
        items.push({
            id: `token.${placeholder.key}`,
            key: placeholder.key,
            label: placeholder.label,
            type: ITEM_TYPES.TOKEN,
            category: placeholder.category,
            description: placeholder.description || '',
            scope: placeholder.scope,
            required: placeholder.required || false,
            fallback: placeholder.fallback || null,
            example: placeholder.example || null,
            dbPath: placeholder.scope === 'company' 
                ? `placeholders.${placeholder.key}` 
                : null,
            built: true,
            // Tokens are always "wired" - they're resolved at runtime
            wired: true
        });
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // 2. CONFIG FIELDS (from WiringRegistry)
    // ════════════════════════════════════════════════════════════════════════════
    const wiringFields = getAllFields();
    
    for (const field of wiringFields) {
        // Skip if already covered by integrations
        if (field.id.startsWith('integrations.')) continue;
        
        items.push({
            id: `config.${field.id}`,
            key: field.id,
            label: field.label,
            type: ITEM_TYPES.CONFIG,
            category: field.tabId?.replace('tab.', '') || 'config',
            description: field.notes || '',
            dbPath: field.db?.path || null,
            uiPath: field.ui?.path || null,
            required: field.required || false,
            critical: field.critical || false,
            killSwitch: field.killSwitch || false,
            defaultValue: field.defaultValue,
            built: true,
            wired: !!(field.runtime && field.db?.path)
        });
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // 3. INTEGRATIONS
    // ════════════════════════════════════════════════════════════════════════════
    for (const integration of INTEGRATION_DEFINITIONS) {
        items.push({
            ...integration,
            wired: true // Integrations we define are wired by definition
        });
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // 4. RUNTIME MODULES
    // ════════════════════════════════════════════════════════════════════════════
    for (const module of RUNTIME_MODULE_DEFINITIONS) {
        items.push({
            ...module,
            wired: true // Modules exist in code
        });
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // 5. SCENARIO ENFORCEMENT
    // ════════════════════════════════════════════════════════════════════════════
    for (const enforcement of ENFORCEMENT_DEFINITIONS) {
        items.push({
            ...enforcement,
            wired: true
        });
    }
    
    // Build lookup maps
    const byId = {};
    const byType = {};
    const byCategory = {};
    
    for (const item of items) {
        byId[item.id] = item;
        
        if (!byType[item.type]) byType[item.type] = [];
        byType[item.type].push(item);
        
        if (!byCategory[item.category]) byCategory[item.category] = [];
        byCategory[item.category].push(item);
    }
    
    return {
        version: '2.0.0',
        generatedAt: new Date().toISOString(),
        tradeKey: tradeKey || 'UNIVERSAL',
        itemTypes: Object.values(ITEM_TYPES),
        categories: Object.values(ITEM_CATEGORIES),
        items,
        byId,
        byType,
        byCategory,
        stats: {
            total: items.length,
            byType: Object.fromEntries(
                Object.entries(byType).map(([k, v]) => [k, v.length])
            ),
            built: items.filter(i => i.built).length,
            wired: items.filter(i => i.wired).length,
            required: items.filter(i => i.required).length,
            critical: items.filter(i => i.critical).length
        }
    };
}

/**
 * Check company configuration status for all catalog items
 * @param {Object} company - Company document
 * @param {string} tradeKey - Trade identifier
 * @returns {Object} Catalog with per-item configuration status
 */
async function checkCompanyCatalogStatus(company, tradeKey = null) {
    const catalog = buildPlatformCatalog(tradeKey);
    const companyId = company._id?.toString();
    
    const statusItems = [];
    let configuredCount = 0;
    let missingCount = 0;
    
    for (const item of catalog.items) {
        const status = {
            ...item,
            configured: false,
            configuredValue: null,
            missing: false,
            missingReason: null
        };
        
        // Check configuration based on type
        if (item.type === ITEM_TYPES.TOKEN && item.scope === 'company') {
            // Check placeholder value
            const placeholders = company.placeholders || {};
            const value = placeholders[item.key];
            status.configured = value !== undefined && value !== null && value !== '';
            status.configuredValue = value;
            status.missing = item.required && !status.configured;
            if (status.missing) status.missingReason = 'Required token not filled';
        } 
        else if (item.type === ITEM_TYPES.CONFIG) {
            // Check config field value
            const value = getNestedValue(company, item.dbPath);
            status.configured = value !== undefined && value !== null;
            status.configuredValue = typeof value === 'object' ? '[object]' : value;
            status.missing = item.required && !status.configured;
            if (status.missing) status.missingReason = 'Required config not set';
        }
        else if (item.type === ITEM_TYPES.INTEGRATION) {
            // Check integration status
            const enabled = getNestedValue(company, item.enabledPath);
            const connected = item.connectedPath 
                ? getNestedValue(company, item.connectedPath) 
                : enabled;
            
            status.configured = !!enabled;
            status.connected = !!connected;
            status.configuredValue = enabled ? (connected ? 'Connected' : 'Enabled but not connected') : 'Disabled';
        }
        else {
            // Runtime modules and enforcement are always "configured" (they exist in code)
            status.configured = item.built;
        }
        
        if (status.configured) configuredCount++;
        if (status.missing) missingCount++;
        
        statusItems.push(status);
    }
    
    return {
        ...catalog,
        companyId,
        companyName: company.companyName || company.name,
        items: statusItems,
        companyStats: {
            configured: configuredCount,
            missing: missingCount,
            total: catalog.items.length,
            readiness: missingCount === 0 ? 'Ready' : 'Not Ready',
            readinessPercent: Math.round((configuredCount / catalog.items.length) * 100)
        }
    };
}

/**
 * Get nested value from object using dot notation path
 */
function getNestedValue(obj, path) {
    if (!path || !obj) return undefined;
    
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
        if (current === null || current === undefined) return undefined;
        current = current[part];
    }
    
    return current;
}

/**
 * Get catalog summary for dashboard
 */
function getCatalogSummary(tradeKey = null) {
    const catalog = buildPlatformCatalog(tradeKey);
    
    return {
        version: catalog.version,
        generatedAt: catalog.generatedAt,
        stats: catalog.stats,
        types: catalog.itemTypes.map(type => ({
            type,
            count: catalog.byType[type]?.length || 0,
            items: (catalog.byType[type] || []).map(i => ({
                id: i.id,
                label: i.label,
                required: i.required,
                critical: i.critical
            }))
        }))
    };
}

module.exports = {
    ITEM_TYPES,
    ITEM_CATEGORIES,
    buildPlatformCatalog,
    checkCompanyCatalogStatus,
    getCatalogSummary,
    INTEGRATION_DEFINITIONS,
    RUNTIME_MODULE_DEFINITIONS,
    ENFORCEMENT_DEFINITIONS
};
