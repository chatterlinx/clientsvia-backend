/**
 * ════════════════════════════════════════════════════════════════════════════════
 * PLACEHOLDER RESOLVER
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Runtime placeholder resolution with:
 * - Alias normalization
 * - Catalog fallbacks
 * - Unknown token logging
 * ════════════════════════════════════════════════════════════════════════════════
 */

const { getCatalog, resolveAlias, validateKey } = require('../../config/placeholders/PlaceholderCatalog');
const logger = require('../../utils/logger');

// Regex to match placeholders: {key}, {{key}}, [key]
const PLACEHOLDER_REGEX = /\{?\{([a-zA-Z][a-zA-Z0-9_]*)\}?\}?|\[([a-zA-Z][a-zA-Z0-9_]*)\]/g;

/**
 * Resolve all placeholders in text
 * @param {string} text - Text with placeholders
 * @param {Object} companyValues - Company's placeholder values (key -> value)
 * @param {Object} options - Resolution options
 * @returns {Object} { resolvedText, replacements, unknownTokens, fallbacksUsed }
 */
function resolvePlaceholders(text, companyValues = {}, options = {}) {
    const {
        tradeKey = null,
        useAliases = true,
        useFallbacks = true,
        leaveUnknown = true,  // If false, replace unknown with empty string
        logUnknown = true
    } = options;
    
    if (!text || typeof text !== 'string') {
        return {
            resolvedText: text || '',
            replacements: [],
            unknownTokens: [],
            fallbacksUsed: []
        };
    }
    
    const catalog = getCatalog(tradeKey);
    
    // Normalize company values to lowercase keys for lookup
    const normalizedValues = {};
    for (const [k, v] of Object.entries(companyValues)) {
        normalizedValues[k.toLowerCase()] = v;
    }
    
    const replacements = [];
    const unknownTokens = [];
    const fallbacksUsed = [];
    
    // Replace all placeholders
    const resolvedText = text.replace(PLACEHOLDER_REGEX, (match, braceKey, bracketKey) => {
        const originalKey = braceKey || bracketKey;
        
        if (!originalKey) return match;
        
        // Resolve through alias if enabled
        const canonicalKey = useAliases ? resolveAlias(originalKey) : originalKey;
        const normalizedKey = canonicalKey.toLowerCase();
        
        // Check if we have a value
        const value = normalizedValues[normalizedKey];
        
        if (value !== undefined && value !== null && value !== '') {
            replacements.push({
                original: match,
                key: originalKey,
                canonicalKey,
                value
            });
            return value;
        }
        
        // Try catalog fallback
        if (useFallbacks) {
            const catalogEntry = catalog.byKey[canonicalKey];
            if (catalogEntry && catalogEntry.fallback) {
                fallbacksUsed.push({
                    original: match,
                    key: originalKey,
                    canonicalKey,
                    fallback: catalogEntry.fallback
                });
                return catalogEntry.fallback;
            }
        }
        
        // Check if key is even valid
        const validation = validateKey(originalKey, tradeKey);
        
        if (!validation.valid) {
            unknownTokens.push({
                original: match,
                key: originalKey,
                position: text.indexOf(match)
            });
            
            if (logUnknown) {
                logger.warn(`[PLACEHOLDER] Unknown token: ${originalKey} in text`);
            }
            
            return leaveUnknown ? match : '';
        }
        
        // Valid key but no value and no fallback
        unknownTokens.push({
            original: match,
            key: originalKey,
            canonicalKey,
            reason: 'no_value_or_fallback'
        });
        
        return leaveUnknown ? match : '';
    });
    
    return {
        resolvedText,
        replacements,
        unknownTokens,
        fallbacksUsed
    };
}

/**
 * Resolve placeholders in all text fields of a scenario
 * @param {Object} scenario - Scenario object
 * @param {Object} companyValues - Company's placeholder values
 * @param {Object} options - Resolution options
 * @returns {Object} Scenario with resolved placeholders
 */
function resolveScenarioPlaceholders(scenario, companyValues, options = {}) {
    if (!scenario) return scenario;
    
    const resolved = { ...scenario };
    const allReplacements = [];
    const allUnknown = [];
    const allFallbacks = [];
    
    // Helper to resolve text and track
    const resolveField = (text) => {
        const result = resolvePlaceholders(text, companyValues, options);
        allReplacements.push(...result.replacements);
        allUnknown.push(...result.unknownTokens);
        allFallbacks.push(...result.fallbacksUsed);
        return result.resolvedText;
    };
    
    // Helper to resolve array of strings or {text, weight} objects
    const resolveArray = (arr) => {
        if (!Array.isArray(arr)) return arr;
        return arr.map(item => {
            if (typeof item === 'string') {
                return resolveField(item);
            } else if (item && typeof item === 'object' && item.text) {
                return { ...item, text: resolveField(item.text) };
            }
            return item;
        });
    };
    
    // Resolve text fields
    if (resolved.name) resolved.name = resolveField(resolved.name);
    if (resolved.description) resolved.description = resolveField(resolved.description);
    if (resolved.followUpFunnel) resolved.followUpFunnel = resolveField(resolved.followUpFunnel);
    
    // Resolve array fields
    if (resolved.quickReplies) resolved.quickReplies = resolveArray(resolved.quickReplies);
    if (resolved.fullReplies) resolved.fullReplies = resolveArray(resolved.fullReplies);
    if (resolved.quickReplies_noName) resolved.quickReplies_noName = resolveArray(resolved.quickReplies_noName);
    if (resolved.fullReplies_noName) resolved.fullReplies_noName = resolveArray(resolved.fullReplies_noName);
    if (resolved.followUpPrompts) resolved.followUpPrompts = resolveArray(resolved.followUpPrompts);
    
    // Resolve entity prompts
    if (Array.isArray(resolved.entities)) {
        resolved.entities = resolved.entities.map(entity => {
            if (entity && entity.prompt) {
                return { ...entity, prompt: resolveField(entity.prompt) };
            }
            return entity;
        });
    }
    
    // Attach resolution metadata
    resolved._placeholderResolution = {
        replacements: allReplacements.length,
        unknownTokens: allUnknown,
        fallbacksUsed: allFallbacks
    };
    
    return resolved;
}

/**
 * Batch resolve all scenarios in a pool
 * @param {Array} scenarios - Array of scenarios
 * @param {Object} companyValues - Company's placeholder values
 * @param {Object} options - Resolution options
 * @returns {Array} Resolved scenarios
 */
function resolveScenarioPool(scenarios, companyValues, options = {}) {
    if (!Array.isArray(scenarios)) return scenarios;
    
    return scenarios.map(scenario => 
        resolveScenarioPlaceholders(scenario, companyValues, options)
    );
}

/**
 * Quick text replacement (legacy compatibility)
 * @param {string} text - Text with placeholders
 * @param {Object} values - Key-value pairs
 * @returns {string} Resolved text
 */
function quickReplace(text, values) {
    const result = resolvePlaceholders(text, values, {
        useAliases: true,
        useFallbacks: true,
        leaveUnknown: true,
        logUnknown: false
    });
    return result.resolvedText;
}

module.exports = {
    resolvePlaceholders,
    resolveScenarioPlaceholders,
    resolveScenarioPool,
    quickReplace
};
