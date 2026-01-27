/**
 * ============================================================================
 * PLACEHOLDER REGISTRY & GOVERNANCE
 * ============================================================================
 *
 * Single source of truth for:
 * - Registry payload (company/runtime/forbidden tokens)
 * - Placeholder governance prompt block
 * - Strict validation for template authoring
 */

const { getCatalog, resolveAlias } = require('../../config/placeholders/PlaceholderCatalog');
const { scanScenario } = require('./TemplatePlaceholderScanner');

function normalizeToken(raw) {
    return String(raw || '').trim().replace(/^\{+/, '').replace(/\}+$/, '');
}

function buildPlaceholderRegistry(tradeKey = null) {
    const catalog = getCatalog(tradeKey);
    const aliasMap = catalog.aliases || {};

    const companyTokens = (catalog.placeholders || [])
        .filter(p => p.scope === 'company')
        .map(p => ({
            key: p.key,
            label: p.label,
            type: p.type,
            category: p.category,
            required: !!p.required
        }));

    const runtimeTokens = (catalog.placeholders || [])
        .filter(p => p.scope === 'runtime')
        .map(p => ({
            key: p.key,
            label: p.label,
            type: p.type,
            category: p.category
        }));

    const forbiddenTokens = Object.entries(aliasMap).map(([legacyKey, canonicalKey]) => {
        const canonicalEntry = catalog.byKey[canonicalKey];
        return {
            key: legacyKey,
            canonical: canonicalKey,
            recommendation: canonicalEntry ? `Use {${canonicalKey}}` : null,
            scope: canonicalEntry?.scope || 'unknown'
        };
    });

    return {
        tradeKey: catalog.tradeKey || tradeKey || 'UNIVERSAL',
        companyTokens,
        runtimeTokens,
        forbiddenTokens,
        aliasMap
    };
}

function buildPlaceholderGovernanceBlock(tradeKey = null) {
    const registry = buildPlaceholderRegistry(tradeKey);
    const companyList = registry.companyTokens.map(t => `{${t.key}}`).join(', ');
    const runtimeList = registry.runtimeTokens.map(t => `{${t.key}}`).join(', ');
    const forbiddenList = registry.forbiddenTokens.map(t => `{${t.key}}`).join(', ');

    return [
        'PLACEHOLDER_GOVERNANCE_V1',
        '',
        'Allowed company tokens:',
        companyList || '(none)',
        '',
        'Allowed runtime tokens:',
        runtimeList || '(none)',
        '',
        'Forbidden legacy tokens (do NOT use):',
        forbiddenList || '(none)',
        '',
        'Rules:',
        '1) Use ONLY allowed tokens.',
        '2) Never use legacy tokens (example: {name} forbidden; use {callerName}).',
        '3) Never invent new tokens.',
        '4) Company vs Runtime scope must be respected.'
    ].join('\n');
}

function validatePlaceholderTokens(tokens = [], tradeKey = null) {
    const registry = buildPlaceholderRegistry(tradeKey);
    const aliasMap = registry.aliasMap || {};

    const companyKeys = new Set(registry.companyTokens.map(t => t.key.toLowerCase()));
    const runtimeKeys = new Set(registry.runtimeTokens.map(t => t.key.toLowerCase()));

    // ════════════════════════════════════════════════════════════════════════════════
    // LENIENT VALIDATION (V2)
    // ════════════════════════════════════════════════════════════════════════════════
    // Accept ANY placeholder that can be resolved to a known token:
    // - Direct match (case-insensitive): {companyName}, {COMPANYNAME}, {CompanyName}
    // - Alias match: {name} -> callerName, {company} -> companyName
    // - Double braces: {{companyName}} -> normalized to companyName
    //
    // Runtime will normalize all placeholders to canonical form.
    // Only reject truly unknown placeholders that can't be resolved.
    // ════════════════════════════════════════════════════════════════════════════════
    
    const acceptedAliases = [];  // Aliases that will be normalized at runtime (not errors)
    const unknownInvalid = [];   // Truly unknown placeholders

    for (const raw of tokens) {
        const cleaned = normalizeToken(raw);
        if (!cleaned) continue;
        const lower = cleaned.toLowerCase();

        // Check 1: Direct match to company or runtime token (case-insensitive)
        if (companyKeys.has(lower) || runtimeKeys.has(lower)) {
            continue; // Valid
        }

        // Check 2: Known alias - ACCEPT (will be normalized at runtime)
        if (aliasMap[lower]) {
            const canonical = aliasMap[lower];
            acceptedAliases.push({
                key: cleaned,
                canonical,
                note: `Will be normalized to {${canonical}} at runtime`
            });
            continue; // Valid - will be normalized
        }

        // Check 3: Try to find any close match (fuzzy)
        // Check if it's a case variation of a known token
        const exactCaseMatch = registry.companyTokens.find(t => t.key === cleaned)
            || registry.runtimeTokens.find(t => t.key === cleaned);
        if (exactCaseMatch) {
            continue; // Valid - exact case match
        }

        // Truly unknown - this is an error
        let suggestion = 'Unknown placeholder. Check spelling or add to catalog.';
        unknownInvalid.push({
            key: cleaned,
            suggestion
        });
    }

    // Only fail on truly unknown placeholders
    // Aliases are OK - they'll be normalized at runtime
    return {
        valid: unknownInvalid.length === 0,
        acceptedAliases,  // Info only - these are valid but will be normalized
        unknownInvalid,
        // Keep forbiddenLegacy empty for backward compatibility - we're now lenient
        forbiddenLegacy: []
    };
}

function validateScenarioPlaceholders(scenario, tradeKey = null) {
    const tokensSet = scanScenario(scenario);
    const tokens = Array.from(tokensSet);
    const validation = validatePlaceholderTokens(tokens, tradeKey);

    let message = null;
    if (!validation.valid) {
        const firstUnknown = validation.unknownInvalid[0];

        if (firstUnknown) {
            message = `Unknown placeholder "{${firstUnknown.key}}". ${firstUnknown.suggestion}`;
        } else {
            message = 'Unknown placeholders detected. Check spelling or add to catalog.';
        }
    }

    // ════════════════════════════════════════════════════════════════════════════════
    // LENIENT RESPONSE
    // ════════════════════════════════════════════════════════════════════════════════
    // - valid: true if all placeholders can be resolved (direct or via alias)
    // - acceptedAliases: placeholders that will be normalized at runtime (info only)
    // - unknownInvalid: truly unknown placeholders (errors)
    // - forbiddenLegacy: empty (we're lenient now - aliases are accepted)
    // ════════════════════════════════════════════════════════════════════════════════
    return {
        valid: validation.valid,
        message,
        acceptedAliases: validation.acceptedAliases || [],
        forbiddenLegacy: [],  // No longer blocking on legacy aliases
        unknownInvalid: validation.unknownInvalid,
        tokens
    };
}

module.exports = {
    buildPlaceholderRegistry,
    buildPlaceholderGovernanceBlock,
    validatePlaceholderTokens,
    validateScenarioPlaceholders
};
