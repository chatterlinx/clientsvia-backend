/**
 * Scenario Content Hashing Service
 * 
 * Generates deterministic content hashes for scenarios to enable
 * accurate caching of Deep Audit results.
 * 
 * IMPORTANT:
 * - Only hashes CONTENT fields (what affects audit scoring)
 * - Does NOT hash metadata fields (createdAt, lastAuditedAt, etc.)
 * - Hash is normalized to avoid drift from whitespace/ordering
 * 
 * CACHE KEY:
 * templateId + scenarioId + auditProfileId + contentHash
 * 
 * @module services/deepAudit/scenarioHash
 */
const crypto = require('crypto');

// ════════════════════════════════════════════════════════════════════════════
// CONTENT FIELDS (fields that affect audit scoring)
// ════════════════════════════════════════════════════════════════════════════

/**
 * Fields that are part of the scenario CONTENT
 * Changes to these fields should trigger re-audit
 */
const CONTENT_FIELDS = [
    // Identity
    'name',
    'scenarioId',
    'scenarioType',
    
    // Status
    'status',
    'isActive',
    'priority',
    
    // Category
    'categoryId',
    'categoryName',
    'categories',
    
    // Triggers (what causes this scenario to match)
    'triggers',
    'regexTriggers',
    'negativeTriggers',
    'exampleUserPhrases',
    'negativeUserPhrases',
    'minConfidence',
    
    // Responses (what the AI says)
    'quickReplies',
    'fullReplies',
    'quickReplies_noName',
    'fullReplies_noName',
    'replyStrategy',
    
    // Behavior
    'behavior',
    'bookingIntent',
    
    // Blueprint mapping
    'blueprintItemKey',
    
    // Notes (content, not metadata)
    'notes'
];

/**
 * Fields that are METADATA (changes should NOT trigger re-audit)
 */
const METADATA_FIELDS = [
    'createdAt',
    'updatedAt',
    'lastAuditedAt',
    'lastAuditScore',
    'lastAuditVerdict',
    'lastAuditContentHash',
    'lastAuditIntentFulfilled',
    'blueprintMatchSource',
    'blueprintMatchedAt',
    'blueprintMatchConfidence',
    '_id',
    '__v'
];

// ════════════════════════════════════════════════════════════════════════════
// NORMALIZATION HELPERS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Normalize a value for consistent hashing
 * - Trims strings
 * - Sorts arrays
 * - Recursively normalizes objects
 * - Removes undefined/null
 */
function normalizeValue(value) {
    // Handle null/undefined
    if (value === null || value === undefined) {
        return null;
    }
    
    // Handle arrays
    if (Array.isArray(value)) {
        const normalized = value
            .map(normalizeValue)
            .filter(v => v !== null && v !== undefined);
        
        // Sort array for consistency (convert to JSON strings for comparison)
        return normalized.sort((a, b) => {
            const aStr = JSON.stringify(a);
            const bStr = JSON.stringify(b);
            return aStr > bStr ? 1 : aStr < bStr ? -1 : 0;
        });
    }
    
    // Handle objects (but not Date)
    if (typeof value === 'object' && !(value instanceof Date)) {
        const keys = Object.keys(value).sort();
        const normalized = {};
        
        for (const key of keys) {
            // Skip metadata fields
            if (METADATA_FIELDS.includes(key)) continue;
            
            const normalizedValue = normalizeValue(value[key]);
            if (normalizedValue !== null && normalizedValue !== undefined) {
                normalized[key] = normalizedValue;
            }
        }
        
        return Object.keys(normalized).length > 0 ? normalized : null;
    }
    
    // Handle strings (trim whitespace)
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : null;
    }
    
    // Handle booleans and numbers
    return value;
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN FUNCTIONS
// ════════════════════════════════════════════════════════════════════════════

/**
 * Extract content-only snapshot from a scenario
 * This is what gets hashed
 */
function getScenarioContentSnapshot(scenario) {
    const snapshot = {};
    
    for (const field of CONTENT_FIELDS) {
        const value = scenario[field];
        const normalized = normalizeValue(value);
        
        if (normalized !== null && normalized !== undefined) {
            snapshot[field] = normalized;
        }
    }
    
    return snapshot;
}

/**
 * Generate deterministic hash of scenario content
 * 
 * @param {Object} scenario - The scenario object
 * @param {string} algorithm - Hash algorithm (default: sha256)
 * @param {number} length - Hash length to return (default: 16 chars)
 * @returns {string} Hex hash string
 */
function hashScenarioContent(scenario, algorithm = 'sha256', length = 16) {
    const snapshot = getScenarioContentSnapshot(scenario);
    const json = JSON.stringify(snapshot);
    const hash = crypto.createHash(algorithm).update(json).digest('hex');
    
    return hash.substring(0, length);
}

/**
 * Generate full-length hash (for unique identification)
 */
function hashScenarioContentFull(scenario) {
    return hashScenarioContent(scenario, 'sha256', 64);
}

/**
 * Check if two scenarios have the same content
 */
function scenariosHaveSameContent(scenario1, scenario2) {
    const hash1 = hashScenarioContent(scenario1);
    const hash2 = hashScenarioContent(scenario2);
    return hash1 === hash2;
}

/**
 * Generate cache key for audit results
 * 
 * @param {Object} params
 * @param {string} params.templateId
 * @param {string} params.scenarioId
 * @param {string} params.auditProfileId
 * @param {string} params.contentHash - Pre-computed content hash
 * @returns {string} Combined cache key
 */
function generateAuditCacheKey({ templateId, scenarioId, auditProfileId, contentHash }) {
    return `${templateId}:${scenarioId}:${auditProfileId}:${contentHash}`;
}

/**
 * Generate cache key from scenario object
 */
function generateAuditCacheKeyFromScenario({ templateId, scenario, auditProfileId }) {
    const contentHash = hashScenarioContent(scenario);
    const scenarioId = scenario.scenarioId || scenario._id?.toString();
    
    return {
        cacheKey: generateAuditCacheKey({ templateId, scenarioId, auditProfileId, contentHash }),
        contentHash,
        scenarioId
    };
}

// ════════════════════════════════════════════════════════════════════════════
// EXPORTS
// ════════════════════════════════════════════════════════════════════════════

module.exports = {
    // Constants
    CONTENT_FIELDS,
    METADATA_FIELDS,
    
    // Core functions
    getScenarioContentSnapshot,
    hashScenarioContent,
    hashScenarioContentFull,
    scenariosHaveSameContent,
    
    // Cache key helpers
    generateAuditCacheKey,
    generateAuditCacheKeyFromScenario,
    
    // Internal (exposed for testing)
    normalizeValue
};
