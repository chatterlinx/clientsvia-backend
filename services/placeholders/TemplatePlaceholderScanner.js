/**
 * ════════════════════════════════════════════════════════════════════════════════
 * TEMPLATE PLACEHOLDER SCANNER
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Scans template scenarios for placeholder tokens and validates against catalog.
 * Used for:
 * - Showing "template-required placeholders" in UI
 * - Validating templates don't have unknown tokens
 * - Powering "Import Defaults" to only import what's needed
 * ════════════════════════════════════════════════════════════════════════════════
 */

const { getCatalog, resolveAlias, validateKey } = require('../../config/placeholders/PlaceholderCatalog');
const logger = require('../../utils/logger');

// Regex to extract placeholder tokens: {key} or {{key}} or [key]
const PLACEHOLDER_REGEX = /\{?\{([a-zA-Z][a-zA-Z0-9_]*)\}?\}?|\[([a-zA-Z][a-zA-Z0-9_]*)\]/g;

/**
 * Extract all placeholder keys from text
 * @param {string} text - Text to scan
 * @returns {Set<string>} Set of found keys
 */
function extractPlaceholdersFromText(text) {
    if (!text || typeof text !== 'string') return new Set();
    
    const keys = new Set();
    let match;
    
    // Reset regex state
    PLACEHOLDER_REGEX.lastIndex = 0;
    
    while ((match = PLACEHOLDER_REGEX.exec(text)) !== null) {
        // Group 1 is for {key} or {{key}}, Group 2 is for [key]
        const key = match[1] || match[2];
        if (key) {
            keys.add(key);
        }
    }
    
    return keys;
}

/**
 * Scan a scenario object for all placeholder tokens
 * @param {Object} scenario - Scenario object to scan
 * @returns {Set<string>} Set of found keys
 */
function scanScenario(scenario) {
    const keys = new Set();
    
    if (!scenario) return keys;
    
    // Fields that commonly contain placeholders
    const textFields = [
        'name',
        'description',
        'followUpFunnel'
    ];
    
    // Array fields that contain text
    const arrayFields = [
        'quickReplies',
        'fullReplies',
        'quickReplies_noName',
        'fullReplies_noName',
        'followUpPrompts',
        'exampleUserPhrases',
        'negativeUserPhrases',
        'triggers'
    ];
    
    // Scan text fields
    for (const field of textFields) {
        if (scenario[field]) {
            for (const key of extractPlaceholdersFromText(scenario[field])) {
                keys.add(key);
            }
        }
    }
    
    // Scan array fields
    for (const field of arrayFields) {
        const arr = scenario[field];
        if (Array.isArray(arr)) {
            for (const item of arr) {
                if (typeof item === 'string') {
                    for (const key of extractPlaceholdersFromText(item)) {
                        keys.add(key);
                    }
                } else if (item && typeof item === 'object' && item.text) {
                    // Handle {text, weight} format
                    for (const key of extractPlaceholdersFromText(item.text)) {
                        keys.add(key);
                    }
                }
            }
        }
    }
    
    // Scan entity prompts
    if (Array.isArray(scenario.entities)) {
        for (const entity of scenario.entities) {
            if (entity && entity.prompt) {
                for (const key of extractPlaceholdersFromText(entity.prompt)) {
                    keys.add(key);
                }
            }
        }
    }
    
    return keys;
}

/**
 * Scan all scenarios in a template
 * @param {Object} template - Template document with scenarios
 * @returns {Object} Scan results
 */
function scanTemplate(template) {
    const allKeys = new Set();
    const keyUsage = {}; // Track where each key is used
    
    if (!template) {
        return {
            success: false,
            error: 'No template provided',
            tokensFound: [],
            keyUsage: {}
        };
    }
    
    // Collect scenarios from both legacy root and category structures
    const scenarioEntries = [];
    
    // Legacy root-level scenarios (if present)
    if (Array.isArray(template.scenarios)) {
        for (const scenario of template.scenarios) {
            scenarioEntries.push({
                scenario,
                categoryName: 'Uncategorized'
            });
        }
    }
    
    // Category-based scenarios (current structure)
    if (Array.isArray(template.categories)) {
        for (const category of template.categories) {
            const categoryName = category?.name || category?.categoryName || 'Category';
            const categoryScenarios = category?.scenarios || [];
            for (const scenario of categoryScenarios) {
                scenarioEntries.push({
                    scenario,
                    categoryName
                });
            }
        }
    }
    
    // Scan all scenarios
    for (const entry of scenarioEntries) {
        const scenario = entry.scenario;
        const scenarioKeys = scanScenario(scenario);
        
        for (const key of scenarioKeys) {
            allKeys.add(key);
            
            // Track usage
            if (!keyUsage[key]) {
                keyUsage[key] = [];
            }
            keyUsage[key].push({
                scenarioId: scenario.scenarioId || scenario._id?.toString(),
                scenarioName: scenario.name,
                categoryName: entry.categoryName
            });
        }
    }
    
    if (scenarioEntries.length === 0) {
        logger.warn('[PLACEHOLDERS] Template has no scenarios to scan');
    }
    
    return {
        success: true,
        tokensFound: Array.from(allKeys),
        keyUsage,
        scenarioCount: scenarioEntries.length
    };
}

/**
 * Full template placeholder analysis with validation
 * @param {Object} template - Template document
 * @param {string} tradeKey - Trade for catalog lookup
 * @returns {Object} Complete analysis
 */
function analyzeTemplatePlaceholders(template, tradeKey = null) {
    const scanResult = scanTemplate(template);
    
    if (!scanResult.success) {
        return scanResult;
    }
    
    const catalog = getCatalog(tradeKey);
    const analysis = {
        success: true,
        tradeKey: tradeKey || 'UNIVERSAL',
        templateId: template._id?.toString() || template.templateId,
        templateName: template.name,
        
        // What the template uses
        tokensUsed: [],
        
        // Validation results
        validTokens: [],
        unknownTokens: [],
        aliasedTokens: [], // Tokens using old names
        runtimeTokens: [], // Runtime tokens (system-filled)
        
        // For UI "required placeholders" display
        requiredPlaceholders: [],
        optionalPlaceholders: [],
        
        // Raw data
        keyUsage: scanResult.keyUsage,
        scenarioCount: scanResult.scenarioCount
    };
    
    // Track unique canonical keys to prevent duplicates
    const requiredKeySet = new Set();
    const optionalKeySet = new Set();
    
    // Analyze each token
    for (const key of scanResult.tokensFound) {
        const validation = validateKey(key, tradeKey);
        
        analysis.tokensUsed.push(key);
        
        if (validation.valid) {
            analysis.validTokens.push(key);
            
            if (validation.isAlias) {
                analysis.aliasedTokens.push({
                    found: key,
                    canonical: validation.canonicalKey,
                    recommendation: `Replace {${key}} with {${validation.canonicalKey}}`,
                    scope: validation.placeholder?.scope || 'company'
                });
            }
            
            // Categorize by required/optional
            const placeholder = validation.placeholder;
            if (placeholder?.scope === 'runtime') {
                analysis.runtimeTokens.push({
                    key: validation.canonicalKey,
                    originalKey: key,
                    label: placeholder.label,
                    type: placeholder.type,
                    scope: 'runtime',
                    usedIn: scanResult.keyUsage[key] || []
                });
                continue;
            }

            const item = {
                key: validation.canonicalKey,
                originalKey: key,
                label: placeholder.label,
                type: placeholder.type,
                category: placeholder.category,
                required: placeholder.required,
                fallback: placeholder.fallback,
                example: placeholder.example,
                usedIn: scanResult.keyUsage[key] || []
            };
            
            if (placeholder.required) {
                if (!requiredKeySet.has(item.key)) {
                    analysis.requiredPlaceholders.push(item);
                    requiredKeySet.add(item.key);
                }
            } else {
                if (!optionalKeySet.has(item.key)) {
                    analysis.optionalPlaceholders.push(item);
                    optionalKeySet.add(item.key);
                }
            }
        } else {
            analysis.unknownTokens.push({
                key,
                usedIn: scanResult.keyUsage[key] || [],
                suggestion: 'Add to catalog or replace with valid placeholder'
            });
        }
    }
    
    // Sort by category
    analysis.requiredPlaceholders.sort((a, b) => a.category.localeCompare(b.category));
    analysis.optionalPlaceholders.sort((a, b) => a.category.localeCompare(b.category));
    
    // Summary
    analysis.summary = {
        totalTokens: analysis.tokensUsed.length,
        valid: analysis.validTokens.length,
        unknown: analysis.unknownTokens.length,
        aliased: analysis.aliasedTokens.length,
        required: analysis.requiredPlaceholders.length,
        optional: analysis.optionalPlaceholders.length,
        runtime: analysis.runtimeTokens.length
    };
    
    // Warnings
    analysis.warnings = [];
    
    if (analysis.unknownTokens.length > 0) {
        analysis.warnings.push({
            type: 'UNKNOWN_TOKENS',
            severity: 'ERROR',
            message: `Template contains ${analysis.unknownTokens.length} unknown placeholder(s): ${analysis.unknownTokens.map(t => t.key).join(', ')}`,
            action: 'Fix template or add alias mapping'
        });
    }
    
    if (analysis.aliasedTokens.length > 0) {
        analysis.warnings.push({
            type: 'ALIASED_TOKENS',
            severity: 'WARNING',
            message: `Template uses ${analysis.aliasedTokens.length} legacy placeholder name(s) that should be updated`,
            action: 'Consider updating to canonical names for consistency'
        });
    }
    
    return analysis;
}

/**
 * Check company's placeholder values against template requirements
 * @param {Object} companyPlaceholders - Company's placeholder values (Map or Object)
 * @param {Object} templateAnalysis - Result from analyzeTemplatePlaceholders
 * @returns {Object} Coverage report
 */
function checkPlaceholderCoverage(companyPlaceholders, templateAnalysis) {
    const values = companyPlaceholders instanceof Map 
        ? Object.fromEntries(companyPlaceholders)
        : (companyPlaceholders || {});
    
    // Normalize keys to lowercase for comparison
    const normalizedValues = {};
    for (const [k, v] of Object.entries(values)) {
        normalizedValues[k.toLowerCase()] = v;
    }
    
    const coverage = {
        filled: [],
        missing: [],
        missingRequired: [],
        usingFallback: []
    };
    
    // Check all placeholders used by template
    const allPlaceholders = [
        ...templateAnalysis.requiredPlaceholders,
        ...templateAnalysis.optionalPlaceholders
    ];
    
    for (const placeholder of allPlaceholders) {
        const key = placeholder.key;
        const normalizedKey = key.toLowerCase();
        const value = normalizedValues[normalizedKey];
        
        const hasValue = value !== undefined && value !== null && value !== '';
        
        if (hasValue) {
            coverage.filled.push({
                key,
                value,
                required: placeholder.required
            });
        } else if (placeholder.fallback) {
            coverage.usingFallback.push({
                key,
                fallback: placeholder.fallback,
                required: placeholder.required
            });
        } else {
            coverage.missing.push({
                key,
                label: placeholder.label,
                required: placeholder.required
            });
            
            if (placeholder.required) {
                coverage.missingRequired.push({
                    key,
                    label: placeholder.label
                });
            }
        }
    }
    
    coverage.summary = {
        total: allPlaceholders.length,
        filled: coverage.filled.length,
        missing: coverage.missing.length,
        missingRequired: coverage.missingRequired.length,
        usingFallback: coverage.usingFallback.length,
        coveragePercent: allPlaceholders.length > 0 
            ? Math.round((coverage.filled.length / allPlaceholders.length) * 100) 
            : 100
    };
    
    coverage.canPublish = coverage.missingRequired.length === 0;
    
    return coverage;
}

module.exports = {
    extractPlaceholdersFromText,
    scanScenario,
    scanTemplate,
    analyzeTemplatePlaceholders,
    checkPlaceholderCoverage
};
