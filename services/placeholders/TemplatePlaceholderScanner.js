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

const { getCatalog, resolveAlias } = require('../../config/placeholders/PlaceholderCatalog');
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
        validTokens: [],           // Canonical tokens only
        unknownTokens: [],         // Unknown or invalid tokens
        aliasedTokens: [],         // Legacy tokens (deprecated) - kept for backward compat
        runtimeTokens: [],         // Canonical runtime tokens

        // New governance classifications
        canonicalCompanyTokens: [],
        canonicalRuntimeTokens: [],
        forbiddenLegacyTokens: [],
        unknownInvalidTokens: [],
        
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
    const runtimeKeySet = new Set();
    
    const aliasMap = catalog.aliases || {};

    // Analyze each token
    for (const key of scanResult.tokensFound) {
        analysis.tokensUsed.push(key);
        const normalizedKey = String(key || '').trim();
        const lowerKey = normalizedKey.toLowerCase();

        // Legacy alias tokens are FORBIDDEN in authoring
        if (aliasMap[lowerKey]) {
            const canonical = aliasMap[lowerKey];
            const legacyInfo = {
                found: normalizedKey,
                canonical,
                recommendation: `Replace {${normalizedKey}} with {${canonical}}`,
                scope: catalog.byKey[canonical]?.scope || 'company',
                usedIn: scanResult.keyUsage[key] || []
            };
            analysis.aliasedTokens.push(legacyInfo);
            analysis.forbiddenLegacyTokens.push({
                key: normalizedKey,
                canonical,
                recommendation: legacyInfo.recommendation,
                scope: legacyInfo.scope,
                usedIn: legacyInfo.usedIn
            });
            continue;
        }

        const placeholder = catalog.byKey[normalizedKey];
        if (!placeholder) {
            let suggestion = 'Add to catalog or replace with valid placeholder';
            const canonicalMatch = Object.keys(catalog.byKey).find(k => k.toLowerCase() === lowerKey);
            if (canonicalMatch) {
                suggestion = `Use {${canonicalMatch}}`;
            }

            analysis.unknownTokens.push({
                key: normalizedKey,
                usedIn: scanResult.keyUsage[key] || [],
                suggestion
            });
            analysis.unknownInvalidTokens.push({
                key: normalizedKey,
                usedIn: scanResult.keyUsage[key] || [],
                suggestion
            });
            continue;
        }

        // Canonical token
        analysis.validTokens.push(normalizedKey);

        if (placeholder.scope === 'runtime') {
            if (!runtimeKeySet.has(placeholder.key)) {
                analysis.runtimeTokens.push({
                    key: placeholder.key,
                    originalKey: normalizedKey,
                    label: placeholder.label,
                    type: placeholder.type,
                    scope: 'runtime',
                    usedIn: scanResult.keyUsage[key] || []
                });
                analysis.canonicalRuntimeTokens.push({
                    key: placeholder.key,
                    label: placeholder.label,
                    type: placeholder.type,
                    category: placeholder.category,
                    usedIn: scanResult.keyUsage[key] || []
                });
                runtimeKeySet.add(placeholder.key);
            }
            continue;
        }

        const item = {
            key: placeholder.key,
            originalKey: normalizedKey,
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

        analysis.canonicalCompanyTokens.push({
            key: placeholder.key,
            label: placeholder.label,
            type: placeholder.type,
            category: placeholder.category,
            required: placeholder.required,
            usedIn: scanResult.keyUsage[key] || []
        });
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
    
    if (analysis.forbiddenLegacyTokens.length > 0) {
        analysis.warnings.push({
            type: 'FORBIDDEN_LEGACY_TOKENS',
            severity: 'ERROR',
            message: `Template uses ${analysis.forbiddenLegacyTokens.length} forbidden legacy placeholder(s): ${analysis.forbiddenLegacyTokens.map(t => t.key).join(', ')}`,
            action: 'Replace legacy tokens with canonical names'
        });
    }
    
    return analysis;
}

/**
 * Check company's placeholder values against template requirements
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 * STRICT MODE: Company Placeholder Values = Single Source of Truth
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * If a company value is missing, it's MISSING. Period.
 * No fallback consideration in readiness calculation.
 * Catalog fallbacks only exist as runtime safety net, not for UI/validation.
 * 
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
        filled: [],           // Has company value
        missing: [],          // No company value (regardless of catalog fallback)
        missingRequired: []   // Missing AND required = blocks readiness
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
        
        // STRICT: Only company values count as "filled"
        const hasValue = value !== undefined && value !== null && value !== '';
        
        if (hasValue) {
            coverage.filled.push({
                key,
                value,
                required: placeholder.required,
                usedIn: placeholder.usedIn || []
            });
        } else {
            // MISSING = no company value (fallback doesn't change this)
            coverage.missing.push({
                key,
                label: placeholder.label,
                required: placeholder.required,
                usedIn: placeholder.usedIn || []
            });
            
            if (placeholder.required) {
                coverage.missingRequired.push({
                    key,
                    label: placeholder.label,
                    usedIn: placeholder.usedIn || []
                });
            }
        }
    }
    
    coverage.summary = {
        total: allPlaceholders.length,
        filled: coverage.filled.length,
        missing: coverage.missing.length,
        missingRequired: coverage.missingRequired.length,
        coveragePercent: allPlaceholders.length > 0 
            ? Math.round((coverage.filled.length / allPlaceholders.length) * 100) 
            : 100
    };
    
    // READY = all required tokens have company values
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
