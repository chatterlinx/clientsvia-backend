/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONTROL PLANE ENFORCER - PLATFORM LAW
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * IF IT'S NOT IN THE CONTRACT, IT DOES NOT EXIST.
 * 
 * This module enforces strict Control Plane discipline:
 * 1. All config reads go through cfgGet() - NO EXCEPTIONS
 * 2. Unknown keys throw CONTROL_PLANE_VIOLATION
 * 3. Missing required keys trigger FAIL_CLOSED
 * 4. No hardcoded defaults at runtime (only UI bootstrap)
 * 5. Every read is traced with source proof
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const fs = require('fs');
const path = require('path');
const logger = require('../../utils/logger');

// V103: Import BlackBoxLogger for CONFIG_READ event tracing
let BlackBoxLogger;
try {
    BlackBoxLogger = require('./BlackBoxLogger');
} catch (err) {
    logger.warn('[CONTROL_PLANE_ENFORCER] BlackBoxLogger not available - tracing disabled');
}

// Load the contract at module init
const CONTRACT_PATH = path.join(__dirname, '../../config/controlPlaneContract.frontDesk.v1.json');
let CONTRACT = null;
let CONTRACT_KEYS = new Set();

try {
    CONTRACT = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
    // Build flat set of all allowed keys
    for (const tab of Object.values(CONTRACT.tabs || {})) {
        for (const key of Object.keys(tab.keys || {})) {
            CONTRACT_KEYS.add(key);
        }
    }
    logger.info('[CONTROL_PLANE_ENFORCER] Contract loaded', {
        version: CONTRACT.version,
        keyCount: CONTRACT_KEYS.size,
        enforcementMode: CONTRACT.enforcementMode
    });
} catch (err) {
    logger.error('[CONTROL_PLANE_ENFORCER] CRITICAL: Failed to load contract', { error: err.message });
    // Create empty contract - will fail closed on all reads
}

// ═══════════════════════════════════════════════════════════════════════════════
// AW PATH → DB PATH TRANSLATION
// ═══════════════════════════════════════════════════════════════════════════════
// AW paths use 'frontDesk.*' convention, but DB stores at 'frontDeskBehavior.*'
// This map ensures cfgGet reads from the correct location in effectiveConfig
// (which is company.aiAgentSettings passed from v2twilio.js)
// ═══════════════════════════════════════════════════════════════════════════════
const AW_TO_DB_PATH_MAP = {
    // Core booking
    'frontDesk.bookingEnabled': 'frontDeskBehavior.bookingEnabled',
    'frontDesk.bookingSlots': 'frontDeskBehavior.bookingSlots',
    'frontDesk.bookingOutcome': 'frontDeskBehavior.bookingOutcome',
    'frontDesk.bookingBehavior': 'frontDeskBehavior.bookingBehavior',
    'frontDesk.bookingBehavior.errorMessage': 'frontDeskBehavior.bookingBehavior.errorMessage',
    'frontDesk.bookingBehavior.notConfiguredMessage': 'frontDeskBehavior.bookingBehavior.notConfiguredMessage',
    
    // Escalation
    'frontDesk.escalation': 'frontDeskBehavior.escalation',
    'frontDesk.escalation.triggerPhrases': 'frontDeskBehavior.escalation.triggerPhrases',
    'frontDesk.escalation.transferMessage': 'frontDeskBehavior.escalation.transferMessage',
    
    // Discovery consent
    'frontDesk.discoveryConsent': 'frontDeskBehavior.discoveryConsent',
    'frontDesk.discoveryConsent.consentPhrases': 'frontDeskBehavior.discoveryConsent.consentPhrases',
    'frontDesk.discoveryConsent.bookingIntentPhrases': 'frontDeskBehavior.discoveryConsent.bookingIntentPhrases',
    
    // Detection triggers - CRITICAL for booking intent
    'frontDesk.detectionTriggers': 'frontDeskBehavior.detectionTriggers',
    'frontDesk.detectionTriggers.wantsBooking': 'frontDeskBehavior.detectionTriggers.wantsBooking',
    'frontDesk.detectionTriggers.directIntentPatterns': 'frontDeskBehavior.detectionTriggers.directIntentPatterns',
    'frontDesk.detectionTriggers.trustConcern': 'frontDeskBehavior.detectionTriggers.trustConcern',
    'frontDesk.detectionTriggers.callerFeelsIgnored': 'frontDeskBehavior.detectionTriggers.callerFeelsIgnored',
    
    // Scheduling (Phase 1)
    'frontDesk.scheduling': 'frontDeskBehavior.scheduling',
    'frontDesk.scheduling.provider': 'frontDeskBehavior.scheduling.provider',
    'frontDesk.scheduling.timeWindows': 'frontDeskBehavior.scheduling.timeWindows',
    'frontDesk.scheduling.morningAfternoonPrompt': 'frontDeskBehavior.scheduling.morningAfternoonPrompt',
    'frontDesk.scheduling.timeWindowPrompt': 'frontDeskBehavior.scheduling.timeWindowPrompt',
    
    // Business hours
    'frontDesk.businessHours': 'businessHours',  // Note: stored at top level, not under frontDeskBehavior
    
    // Personality
    'frontDesk.personality': 'frontDeskBehavior.personality',
    'frontDesk.aiName': 'aiName',  // Note: stored at top level
    
    // Fallbacks
    'frontDesk.fallbackResponses': 'frontDeskBehavior.fallbackResponses'
};

/**
 * Translate AW path to DB path for effectiveConfig lookup
 * @param {string} awPath - AW convention path (e.g., 'frontDesk.bookingSlots')
 * @returns {string} DB path for getNestedValue (e.g., 'frontDeskBehavior.bookingSlots')
 */
function translateAwPathToDbPath(awPath) {
    // Check exact match first
    if (AW_TO_DB_PATH_MAP[awPath]) {
        return AW_TO_DB_PATH_MAP[awPath];
    }
    
    // Check if this is a child of a mapped path
    // e.g., 'frontDesk.bookingSlots.0.question' → 'frontDeskBehavior.bookingSlots.0.question'
    for (const [awPrefix, dbPrefix] of Object.entries(AW_TO_DB_PATH_MAP)) {
        if (awPath.startsWith(awPrefix + '.')) {
            const suffix = awPath.slice(awPrefix.length);
            return dbPrefix + suffix;
        }
    }
    
    // Generic fallback: frontDesk.X → frontDeskBehavior.X
    if (awPath.startsWith('frontDesk.')) {
        return 'frontDeskBehavior.' + awPath.slice('frontDesk.'.length);
    }
    
    // No translation needed (e.g., 'booking.directIntentPatterns' legacy paths)
    return awPath;
    CONTRACT = { rules: { unknownKeyBehavior: 'CONTROL_PLANE_VIOLATION' } };
    CONTRACT_KEYS = new Set();
}

/**
 * Decision trace collector - accumulates keys used per turn
 */
class DecisionTrace {
    constructor(callId, turn) {
        this.callId = callId;
        this.turn = turn;
        this.keysUsed = [];
        this.sourcesUsed = [];
        this.decisionReasons = [];
        this.modeChanges = [];
        this.violations = [];
        this.startTime = Date.now();
    }
    
    addKeyRead(key, source, value) {
        this.keysUsed.push(key);
        if (!this.sourcesUsed.includes(source)) {
            this.sourcesUsed.push(source);
        }
    }
    
    addDecisionReason(reason, details = {}) {
        this.decisionReasons.push({ reason, ...details, timestamp: Date.now() });
    }
    
    addModeChange(from, to, reason) {
        this.modeChanges.push({ from, to, reason, timestamp: Date.now() });
    }
    
    addViolation(type, key, details = {}) {
        this.violations.push({ type, key, ...details, timestamp: Date.now() });
    }
    
    toJSON() {
        return {
            callId: this.callId,
            turn: this.turn,
            keysUsed: [...new Set(this.keysUsed)],
            sourcesUsed: this.sourcesUsed,
            decisionReasons: this.decisionReasons,
            modeChanges: this.modeChanges,
            violations: this.violations,
            durationMs: Date.now() - this.startTime
        };
    }
}

// Active traces per call
const activeTraces = new Map();

/**
 * Get or create decision trace for a call/turn
 */
function getTrace(callId, turn = 0) {
    const key = `${callId}:${turn}`;
    if (!activeTraces.has(key)) {
        activeTraces.set(key, new DecisionTrace(callId, turn));
    }
    return activeTraces.get(key);
}

/**
 * Finalize and return trace for a call/turn
 */
function finalizeTrace(callId, turn = 0) {
    const key = `${callId}:${turn}`;
    const trace = activeTraces.get(key);
    activeTraces.delete(key);
    return trace?.toJSON() || null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * cfgGet() - THE ONLY WAY TO READ CONFIG AT RUNTIME
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * @param {Object} effectiveConfig - The loaded Control Plane config
 * @param {string} key - The config key path (e.g., 'frontDesk.bookingSlots')
 * @param {Object} options - Options
 * @param {string} options.callId - Call ID for tracing
 * @param {number} options.turn - Turn number for tracing
 * @param {boolean} options.strict - If true, throw on missing (default: true)
 * @param {string} options.readerId - Identifier for who is reading (for audit)
 * 
 * @returns {any} The config value
 * @throws {Error} CONTROL_PLANE_VIOLATION if key not in contract
 */
function cfgGet(effectiveConfig, key, options = {}) {
    const { callId = 'unknown', turn = 0, strict = true, readerId = 'unknown' } = options;
    const trace = getTrace(callId, turn);
    
    // Determine enforcement level: "strict" = block+fail, "warn" = log only
    const enforcementLevel = effectiveConfig?.frontDesk?.enforcement?.level || 
        (effectiveConfig?.frontDesk?.enforcement?.strictControlPlaneOnly === true ? 'strict' : 'warn');
    const isStrictMode = enforcementLevel === 'strict';
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 1: Is this key in the contract?
    // ═══════════════════════════════════════════════════════════════════════════
    if (!CONTRACT_KEYS.has(key)) {
        const violation = {
            type: 'UNKNOWN_KEY',
            key,
            readerId,
            enforcementLevel,
            message: `Key "${key}" is not in Control Plane contract - IF IT'S NOT IN UI, IT DOES NOT EXIST`
        };
        
        trace.addViolation('CONTROL_PLANE_VIOLATION', key, violation);
        
        // Always log the violation
        logger.error('[CONTROL_PLANE_ENFORCER] VIOLATION: Unknown key accessed', violation);
        
        if (isStrictMode) {
            // STRICT: Block and throw
            throw new Error(`CONTROL_PLANE_VIOLATION: ${violation.message}`);
        } else {
            // WARN: Log but continue (for migration period)
            logger.warn('[CONTROL_PLANE_ENFORCER] WARN MODE: Violation logged but not blocked', { key, readerId });
            return undefined;
        }
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 2: Read the value from effectiveConfig
    // CRITICAL FIX: Translate AW path to DB path (frontDesk.* → frontDeskBehavior.*)
    // ═══════════════════════════════════════════════════════════════════════════
    const dbPath = translateAwPathToDbPath(key);
    const value = getNestedValue(effectiveConfig, dbPath);
    
    // Record the read with both paths for tracing
    trace.addKeyRead(key, 'controlPlane', value);
    
    // ═══════════════════════════════════════════════════════════════════════════
    // GATE 3: Check if required and missing
    // ═══════════════════════════════════════════════════════════════════════════
    const keySpec = getKeySpec(key);
    if (keySpec?.required && (value === undefined || value === null)) {
        const violation = {
            type: 'MISSING_REQUIRED_KEY',
            key,
            readerId,
            message: `Required key "${key}" is missing from Control Plane config`
        };
        
        trace.addViolation('MISSING_REQUIRED_KEY', key, violation);
        
        logger.error('[CONTROL_PLANE_ENFORCER] VIOLATION: Missing required key', violation);
        
        if (strict) {
            throw new Error(`CONTROL_PLANE_VIOLATION: ${violation.message}`);
        }
    }
    
    // Log successful read at debug level
    logger.debug('[CONTROL_PLANE_ENFORCER] Config read', {
        key,
        readerId,
        hasValue: value !== undefined && value !== null,
        source: 'controlPlane'
    });
    
    // V103: Emit CONFIG_READ event to BlackBox for trace visibility
    // This shows config reads from FrontDeskRuntime in the same format as AWConfigReader
    if (BlackBoxLogger?.logEvent && callId && callId !== 'unknown') {
        BlackBoxLogger.logEvent({
            callId,
            companyId: effectiveConfig?.companyId || 'unknown',
            type: 'CONFIG_READ',
            turn,
            data: {
                awPath: key,
                readerId,
                resolvedFrom: (value !== undefined && value !== null) ? 'controlPlane' : 'notFound',
                valuePreview: typeof value === 'string' 
                    ? value.substring(0, 50) 
                    : Array.isArray(value) 
                        ? `[array:${value.length}]`
                        : typeof value === 'object' && value !== null
                            ? `{object:${Object.keys(value).length}}`
                            : String(value),
                valueType: Array.isArray(value) ? 'array' : typeof value,
                source: 'ControlPlaneEnforcer.cfgGet'
            }
        }).catch(() => {}); // Silent fail - never let tracing kill the call
    }
    
    return value;
}

/**
 * Get nested value from object using dot notation
 */
function getNestedValue(obj, path) {
    if (!obj || !path) return undefined;
    
    const parts = path.split('.');
    let current = obj;
    
    for (const part of parts) {
        if (current === undefined || current === null) return undefined;
        current = current[part];
    }
    
    return current;
}

/**
 * Get key specification from contract
 */
function getKeySpec(key) {
    if (!CONTRACT?.tabs) return null;
    
    for (const tab of Object.values(CONTRACT.tabs)) {
        if (tab.keys && tab.keys[key]) {
            return tab.keys[key];
        }
    }
    
    return null;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Validate entire effectiveConfig against contract
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function validateConfig(effectiveConfig, callId = 'unknown') {
    const result = {
        valid: true,
        missingRequired: [],
        unknownKeys: [],
        warnings: []
    };
    
    if (!effectiveConfig) {
        result.valid = false;
        result.missingRequired.push('effectiveConfig is null/undefined');
        return result;
    }
    
    // Check all required keys
    for (const tab of Object.values(CONTRACT.tabs || {})) {
        for (const [key, spec] of Object.entries(tab.keys || {})) {
            if (spec.required) {
                const value = getNestedValue(effectiveConfig, key);
                if (value === undefined || value === null) {
                    result.missingRequired.push(key);
                    result.valid = false;
                }
            }
        }
    }
    
    // Check for unknown keys (walk the config)
    const configKeys = flattenKeys(effectiveConfig);
    for (const key of configKeys) {
        // Only check frontDesk.*, booking.*, slotExtraction.*, etc.
        if (key.startsWith('frontDesk.') || 
            key.startsWith('booking.') || 
            key.startsWith('slotExtraction.') ||
            key.startsWith('integrations.') ||
            key.startsWith('dynamicFlow.') ||
            key.startsWith('dataConfig.') ||
            key.startsWith('transfers.') ||
            key.startsWith('infra.')) {
            if (!CONTRACT_KEYS.has(key)) {
                result.unknownKeys.push(key);
                result.warnings.push(`Unknown key in config: ${key}`);
            }
        }
    }
    
    logger.info('[CONTROL_PLANE_ENFORCER] Config validation result', {
        callId,
        valid: result.valid,
        missingRequiredCount: result.missingRequired.length,
        unknownKeysCount: result.unknownKeys.length
    });
    
    return result;
}

/**
 * Flatten object keys to dot notation
 */
function flattenKeys(obj, prefix = '', result = []) {
    if (!obj || typeof obj !== 'object') return result;
    
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        result.push(fullKey);
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            flattenKeys(value, fullKey, result);
        }
    }
    
    return result;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Build CONTROL_PLANE_HEADER event data
 * ═══════════════════════════════════════════════════════════════════════════════
 * Must include:
 * - strictMode: true/false
 * - contractVersion: "frontDesk.v1"
 * - validation: { ok, missingRequired[], unknownAccesses[] }
 * - configSource: "company" | "template" | "defaults"
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function buildControlPlaneHeader(effectiveConfig, awHash, effectiveConfigVersion, callId, companyId = null) {
    const validation = validateConfig(effectiveConfig, callId);
    
    // Determine enforcement level (strict vs warn)
    const enforcementLevel = effectiveConfig?.frontDesk?.enforcement?.level || 
        (effectiveConfig?.frontDesk?.enforcement?.strictControlPlaneOnly === true ? 'strict' : 'warn');
    const strictMode = enforcementLevel === 'strict';
    
    // Determine config source
    let configSource = 'defaults';
    if (awHash && effectiveConfigVersion) {
        configSource = 'company'; // Loaded from company-specific wiring
    } else if (effectiveConfig?.frontDesk) {
        configSource = 'template'; // Has frontDesk but no awHash
    }
    
    return {
        // Core identifiers - V102: Accept companyId as parameter
        companyId: companyId || effectiveConfig?.companyId || 'unknown',
        awHash: awHash || null,
        effectiveConfigVersion: effectiveConfigVersion || null,
        
        // Load status
        controlPlaneLoaded: !!(awHash && effectiveConfigVersion),
        configSource,
        
        // Contract info
        contractVersion: CONTRACT?.version || 'frontDesk.v1',
        
        // Enforcement status - CRITICAL for debugging
        strictMode,
        enforcementLevel,
        
        // Validation - must show ok/missingRequired/unknownAccesses
        validation: {
            ok: validation.valid,
            missingRequired: validation.missingRequired,
            unknownAccesses: validation.unknownKeys
        }
    };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * Mode ownership check - ONLY FrontDeskRouter can change these
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function assertModeOwnership(caller, operation, key) {
    const protectedKeys = CONTRACT?.modeOwnership?.protectedKeys || [
        'mode', 'bookingModeLocked', 'consentPending', 'branchTaken', 'sessionMode'
    ];
    
    if (protectedKeys.includes(key) && caller !== 'FrontDeskRouter') {
        const violation = {
            type: 'MODE_OWNERSHIP_VIOLATION',
            key,
            caller,
            operation,
            message: `Only FrontDeskRouter can ${operation} "${key}" - caller was "${caller}"`
        };
        
        logger.error('[CONTROL_PLANE_ENFORCER] MODE OWNERSHIP VIOLATION', violation);
        
        // For now, log but don't throw - we need to migrate callers first
        return false;
    }
    
    return true;
}

/**
 * Get fail-closed response for a violation type
 */
function getFailClosedResponse(violationType) {
    const behavior = CONTRACT?.failClosedBehavior?.actions?.[violationType];
    
    if (behavior) {
        return {
            response: behavior.safeResponse,
            action: behavior.action
        };
    }
    
    // Ultimate fallback
    return {
        response: "I apologize, but I'm having a technical issue. Let me connect you with someone who can help.",
        action: 'ESCALATE_TRANSFER'
    };
}

module.exports = {
    cfgGet,
    validateConfig,
    buildControlPlaneHeader,
    getTrace,
    finalizeTrace,
    assertModeOwnership,
    getFailClosedResponse,
    CONTRACT,
    CONTRACT_KEYS,
    DecisionTrace
};
