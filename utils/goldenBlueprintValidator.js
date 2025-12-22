/**
 * ============================================================================
 * GOLDEN BLUEPRINT VALIDATOR
 * ============================================================================
 * 
 * Validates company config against the Penguin Air Golden Blueprint.
 * Detects legacy keys, deprecated namespaces, and nuke-eligible fields.
 * 
 * PURPOSE:
 * - Control Plane is truth
 * - Placeholders are canonical (NOT variables)
 * - Anything outside allowlist is legacy
 * - Legacy gets flagged, then deleted
 * 
 * ============================================================================
 */

const fs = require('fs');
const path = require('path');
const logger = require('./logger');

// Load the Golden Blueprint allowlist
let GOLDEN_BLUEPRINT = null;
try {
    const blueprintPath = path.join(__dirname, '../docs/golden-blueprint/penguin-air.controlplane.allowlist.json');
    GOLDEN_BLUEPRINT = JSON.parse(fs.readFileSync(blueprintPath, 'utf8'));
    logger.info('[GOLDEN BLUEPRINT] Loaded allowlist v' + GOLDEN_BLUEPRINT.version);
} catch (e) {
    logger.warn('[GOLDEN BLUEPRINT] Could not load allowlist, using defaults');
    GOLDEN_BLUEPRINT = {
        version: 'fallback-v1',
        rules: { STRICT_MODE: false },
        deprecatedNamespaces: ['variables'],
        allowlist: {},
        nukeTargets: { safeToDelete: [] }
    };
}

/**
 * Flatten an object into dot-notation keys
 * @param {Object} obj - Object to flatten
 * @param {string} prefix - Current path prefix
 * @returns {string[]} Array of dot-notation keys
 */
function flattenKeys(obj, prefix = '') {
    const keys = [];
    
    if (!obj || typeof obj !== 'object') return keys;
    
    for (const [key, value] of Object.entries(obj)) {
        const fullKey = prefix ? `${prefix}.${key}` : key;
        keys.push(fullKey);
        
        if (value && typeof value === 'object' && !Array.isArray(value)) {
            keys.push(...flattenKeys(value, fullKey));
        }
    }
    
    return keys;
}

/**
 * Get all allowed keys from the blueprint (flattened)
 * @returns {Set<string>} Set of allowed keys
 */
function getAllowedKeys() {
    const allowed = new Set();
    
    for (const section of Object.values(GOLDEN_BLUEPRINT.allowlist || {})) {
        if (Array.isArray(section)) {
            section.forEach(key => allowed.add(key));
        }
    }
    
    return allowed;
}

/**
 * Check if a key matches a deprecated namespace
 * @param {string} key - Key to check
 * @returns {boolean}
 */
function isDeprecatedNamespace(key) {
    const deprecated = GOLDEN_BLUEPRINT.deprecatedNamespaces || [];
    return deprecated.some(ns => key.startsWith(ns));
}

/**
 * Check if a key is safe to delete (nuke target)
 * @param {string} key - Key to check
 * @returns {boolean}
 */
function isSafeToDelete(key) {
    const nukeTargets = GOLDEN_BLUEPRINT.nukeTargets?.safeToDelete || [];
    return nukeTargets.some(pattern => {
        if (pattern.endsWith('.*')) {
            const prefix = pattern.slice(0, -2);
            return key.startsWith(prefix);
        }
        return key === pattern;
    });
}

/**
 * Validate a company config against the Golden Blueprint
 * @param {Object} companyConfig - The company configuration object
 * @returns {Object} Validation result with legacy keys, warnings, and nuke candidates
 */
function validateConfig(companyConfig) {
    const allowedKeys = getAllowedKeys();
    const configKeys = flattenKeys(companyConfig);
    
    const result = {
        valid: true,
        totalKeys: configKeys.length,
        allowedCount: 0,
        legacyCount: 0,
        nukeEligibleCount: 0,
        
        // Detailed arrays
        legacyKeys: [],
        deprecatedKeys: [],
        nukeEligible: [],
        warnings: [],
        
        // Summary
        health: 'GREEN',
        recommendation: null
    };
    
    // Check each config key
    for (const key of configKeys) {
        // Skip internal/meta keys
        if (key.startsWith('_') || key === 'id' || key === '_id') {
            continue;
        }
        
        // Check if in allowlist
        const isAllowed = allowedKeys.has(key) || 
                         Array.from(allowedKeys).some(ak => key.startsWith(ak + '.'));
        
        if (isAllowed) {
            result.allowedCount++;
            continue;
        }
        
        // Check if deprecated namespace
        if (isDeprecatedNamespace(key)) {
            result.deprecatedKeys.push({
                key,
                reason: 'Deprecated namespace',
                action: 'MIGRATE_OR_DELETE'
            });
            result.legacyCount++;
            
            // Check if safe to delete
            if (isSafeToDelete(key)) {
                result.nukeEligible.push({
                    key,
                    reason: 'In nuke targets list',
                    safe: true
                });
                result.nukeEligibleCount++;
            }
            continue;
        }
        
        // Not in allowlist = legacy
        result.legacyKeys.push({
            key,
            reason: 'Not in Golden Blueprint allowlist',
            action: 'REVIEW'
        });
        result.legacyCount++;
        
        // Check if safe to nuke
        if (isSafeToDelete(key)) {
            result.nukeEligible.push({
                key,
                reason: 'Matches nuke pattern',
                safe: true
            });
            result.nukeEligibleCount++;
        }
    }
    
    // Determine health status
    if (result.legacyCount === 0) {
        result.health = 'GREEN';
        result.recommendation = 'Config is clean - matches Golden Blueprint';
    } else if (result.legacyCount <= 5) {
        result.health = 'YELLOW';
        result.recommendation = `${result.legacyCount} legacy key(s) detected - review and nuke`;
    } else {
        result.health = 'RED';
        result.valid = false;
        result.recommendation = `${result.legacyCount} legacy key(s) detected - needs cleanup`;
    }
    
    // Add specific warnings for known issues
    if (result.deprecatedKeys.some(k => k.key.startsWith('variables'))) {
        result.warnings.push({
            type: 'DEPRECATED_VARIABLES',
            message: 'Legacy "variables" namespace detected. Use "placeholders" instead.',
            severity: 'error'
        });
    }
    
    if (result.deprecatedKeys.some(k => k.key.includes('callFlowEngine.bookingFields'))) {
        result.warnings.push({
            type: 'DUPLICATE_BOOKING',
            message: 'Legacy "callFlowEngine.bookingFields" detected. Use "frontDeskBehavior.bookingSlots" instead.',
            severity: 'error'
        });
    }
    
    return result;
}

/**
 * Get keys that are safe to delete from a config
 * @param {Object} companyConfig - The company configuration
 * @returns {string[]} Array of keys safe to delete
 */
function getNukeableKeys(companyConfig) {
    const validation = validateConfig(companyConfig);
    return validation.nukeEligible.filter(n => n.safe).map(n => n.key);
}

/**
 * Strip legacy keys from config (returns new object)
 * @param {Object} companyConfig - The company configuration
 * @param {Object} options - Options
 * @returns {Object} Cleaned config
 */
function stripLegacyKeys(companyConfig, options = {}) {
    const { logDropped = true, dryRun = false } = options;
    const validation = validateConfig(companyConfig);
    
    if (validation.legacyCount === 0) {
        return { config: companyConfig, dropped: [] };
    }
    
    const dropped = [];
    const config = JSON.parse(JSON.stringify(companyConfig)); // Deep clone
    
    // Delete each legacy key
    for (const legacy of [...validation.legacyKeys, ...validation.deprecatedKeys]) {
        const parts = legacy.key.split('.');
        let obj = config;
        
        // Navigate to parent
        for (let i = 0; i < parts.length - 1; i++) {
            if (obj && obj[parts[i]]) {
                obj = obj[parts[i]];
            } else {
                obj = null;
                break;
            }
        }
        
        // Delete the key
        if (obj && parts.length > 0) {
            const lastKey = parts[parts.length - 1];
            if (obj.hasOwnProperty(lastKey)) {
                if (!dryRun) {
                    delete obj[lastKey];
                }
                dropped.push(legacy.key);
            }
        }
    }
    
    if (logDropped && dropped.length > 0) {
        logger.info(`[GOLDEN BLUEPRINT] Dropped ${dropped.length} legacy keys: ${dropped.slice(0, 5).join(', ')}${dropped.length > 5 ? '...' : ''}`);
    }
    
    return { config, dropped };
}

/**
 * Get the Golden Blueprint defaults
 * @returns {Object} Golden defaults
 */
function getGoldenDefaults() {
    return GOLDEN_BLUEPRINT.goldenDefaults || {};
}

/**
 * Get the blueprint version
 * @returns {string}
 */
function getVersion() {
    return GOLDEN_BLUEPRINT.version;
}

module.exports = {
    validateConfig,
    getNukeableKeys,
    stripLegacyKeys,
    getGoldenDefaults,
    getVersion,
    getAllowedKeys,
    isDeprecatedNamespace,
    isSafeToDelete,
    GOLDEN_BLUEPRINT
};

