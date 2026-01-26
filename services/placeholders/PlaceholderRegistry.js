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

    const forbiddenLegacy = [];
    const unknownInvalid = [];

    for (const raw of tokens) {
        const cleaned = normalizeToken(raw);
        if (!cleaned) continue;
        const lower = cleaned.toLowerCase();

        if (aliasMap[lower]) {
            const canonical = aliasMap[lower];
            forbiddenLegacy.push({
                key: cleaned,
                canonical,
                recommendation: `Use {${canonical}}`,
                scope: registry.companyTokens.find(t => t.key === canonical)?.scope
                    || registry.runtimeTokens.find(t => t.key === canonical)?.scope
                    || 'unknown'
            });
            continue;
        }

        if (companyKeys.has(lower) || runtimeKeys.has(lower)) {
            continue;
        }

        let suggestion = 'Add to catalog or replace with valid placeholder';
        const canonicalMatch = registry.companyTokens.find(t => t.key.toLowerCase() === lower)
            || registry.runtimeTokens.find(t => t.key.toLowerCase() === lower);
        if (canonicalMatch) {
            suggestion = `Use {${canonicalMatch.key}}`;
        }

        unknownInvalid.push({
            key: cleaned,
            suggestion
        });
    }

    return {
        valid: forbiddenLegacy.length === 0 && unknownInvalid.length === 0,
        forbiddenLegacy,
        unknownInvalid
    };
}

function validateScenarioPlaceholders(scenario, tradeKey = null) {
    const tokensSet = scanScenario(scenario);
    const tokens = Array.from(tokensSet);
    const validation = validatePlaceholderTokens(tokens, tradeKey);

    let message = null;
    if (!validation.valid) {
        const firstForbidden = validation.forbiddenLegacy[0];
        const firstUnknown = validation.unknownInvalid[0];

        if (firstForbidden) {
            message = `Invalid placeholder "{${firstForbidden.key}}". ${firstForbidden.recommendation || 'Use canonical tokens only.'} This template can only use canonical tokens from registry.`;
        } else if (firstUnknown) {
            message = `Invalid placeholder "{${firstUnknown.key}}". ${firstUnknown.suggestion || 'Use canonical tokens only.'} This template can only use canonical tokens from registry.`;
        } else {
            message = 'Invalid placeholders detected. This template can only use canonical tokens from registry.';
        }
    }

    return {
        valid: validation.valid,
        message,
        forbiddenLegacy: validation.forbiddenLegacy,
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
