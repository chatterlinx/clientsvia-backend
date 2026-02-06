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
const logger = require('../../lib/logger');

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
    // ═══════════════════════════════════════════════════════════════════════════
    const value = getNestedValue(effectiveConfig, key);
    
    // Record the read
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
function buildControlPlaneHeader(effectiveConfig, awHash, effectiveConfigVersion, callId) {
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
        // Core identifiers
        companyId: effectiveConfig?.companyId || 'unknown',
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
