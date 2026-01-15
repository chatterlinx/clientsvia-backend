const v2Company = require('../../models/v2Company');
const { getLegacyPromptKeyMap } = require('../../config/promptPacks/migrationMap.v1');
const { getPromptPackById, getLatestPackIdForTrade } = require('../../config/promptPacks');

function normalizeTradeKey(value) {
    return String(value || '').trim().toLowerCase();
}

function isNewSchemaKey(key) {
    return /^booking\.[a-z0-9_]+\./i.test(String(key || '').trim());
}

function buildMigrationPreview(companyDoc) {
    const legacyMap = getLegacyPromptKeyMap();
    const frontDesk = companyDoc?.aiAgentSettings?.frontDeskBehavior || {};
    const bookingPromptsMap = frontDesk.bookingPromptsMap || {};
    const serviceFlow = frontDesk.serviceFlow || {};
    const promptGuards = frontDesk.promptGuards || {};

    const legacyKeysFound = [];
    const proposedMappings = [];
    const conflicts = [];
    const unmappedLegacyKeys = [];
    const promptKeyUpdates = [];
    const missingSourceTextKeys = [];

    const bookingMapEntries = typeof bookingPromptsMap.get === 'function'
        ? Array.from(bookingPromptsMap.entries())
        : Object.entries(bookingPromptsMap || {});

    for (const [oldKey, oldText] of bookingMapEntries) {
        if (!legacyMap[oldKey]) {
            if (!isNewSchemaKey(oldKey)) {
                unmappedLegacyKeys.push(oldKey);
            }
            continue;
        }
        const newKey = legacyMap[oldKey];
        legacyKeysFound.push(oldKey);

        const newText = typeof bookingPromptsMap.get === 'function'
            ? bookingPromptsMap.get(newKey)
            : bookingPromptsMap[newKey];

        proposedMappings.push({
            oldKey,
            newKey,
            oldText: oldText ?? null
        });

        if (newText && String(newText).trim() !== String(oldText || '').trim()) {
            conflicts.push({
                oldKey,
                newKey,
                oldText: oldText ?? null,
                newText: newText ?? null
            });
        }
    }

    const promptKeysByTrade = serviceFlow.promptKeysByTrade || {};
    const promptKeyEntries = typeof promptKeysByTrade.get === 'function'
        ? Array.from(promptKeysByTrade.entries())
        : Object.entries(promptKeysByTrade || {});

    for (const [tradeKeyRaw, keys] of promptKeyEntries) {
        if (!keys || typeof keys !== 'object') continue;
        const tradeKey = normalizeTradeKey(tradeKeyRaw);
        for (const [field, value] of Object.entries(keys)) {
            if (!legacyMap[value]) continue;
            const oldText = typeof bookingPromptsMap.get === 'function'
                ? bookingPromptsMap.get(value)
                : bookingPromptsMap[value];
            if (!oldText) {
                missingSourceTextKeys.push(value);
                continue;
            }
            promptKeyUpdates.push({
                path: `serviceFlow.promptKeysByTrade.${tradeKey}.${field}`,
                oldKey: value,
                newKey: legacyMap[value]
            });
        }
    }

    if (legacyMap[promptGuards.missingPromptFallbackKey]) {
        const oldText = typeof bookingPromptsMap.get === 'function'
            ? bookingPromptsMap.get(promptGuards.missingPromptFallbackKey)
            : bookingPromptsMap[promptGuards.missingPromptFallbackKey];
        if (!oldText) {
            missingSourceTextKeys.push(promptGuards.missingPromptFallbackKey);
        }
        promptKeyUpdates.push({
            path: 'promptGuards.missingPromptFallbackKey',
            oldKey: promptGuards.missingPromptFallbackKey,
            newKey: legacyMap[promptGuards.missingPromptFallbackKey]
        });
    }

    return {
        companyId: companyDoc?._id?.toString() || null,
        status: conflicts.length > 0 ? 'conflicts' : 'ok',
        legacyKeysFound,
        proposedMappings,
        promptKeyUpdates,
        conflicts,
        unmappedLegacyKeys,
        missingSourceTextKeys,
        migrationStatus: frontDesk.promptPacks?.migration?.status || 'not_started'
    };
}

function applyMigration(companyDoc, { appliedBy = 'admin-migration-v1', notes = null } = {}) {
    const legacyMap = getLegacyPromptKeyMap();
    const frontDesk = companyDoc.aiAgentSettings.frontDeskBehavior;
    const bookingPromptsMap = frontDesk.bookingPromptsMap || {};

    const mapGet = (key) => (typeof bookingPromptsMap.get === 'function' ? bookingPromptsMap.get(key) : bookingPromptsMap[key]);
    const mapSet = (key, value) => {
        if (typeof bookingPromptsMap.set === 'function') {
            bookingPromptsMap.set(key, value);
        } else {
            bookingPromptsMap[key] = value;
        }
    };

    const preview = buildMigrationPreview(companyDoc);
    let migratedKeysCount = 0;

    for (const mapping of preview.proposedMappings) {
        if (preview.conflicts.some(c => c.oldKey === mapping.oldKey && c.newKey === mapping.newKey)) {
            continue;
        }
        const existingNew = mapGet(mapping.newKey);
        if (!existingNew) {
            mapSet(mapping.newKey, mapping.oldText);
            migratedKeysCount += 1;
        }
    }

    const serviceFlow = frontDesk.serviceFlow || {};
    const promptKeysByTrade = serviceFlow.promptKeysByTrade || {};
    const promptKeyEntries = typeof promptKeysByTrade.get === 'function'
        ? Array.from(promptKeysByTrade.entries())
        : Object.entries(promptKeysByTrade || {});

    for (const [tradeKeyRaw, keys] of promptKeyEntries) {
        if (!keys || typeof keys !== 'object') continue;
        const updated = { ...keys };
        for (const [field, value] of Object.entries(keys)) {
            const oldText = mapGet(value);
            if (legacyMap[value] && oldText) {
                updated[field] = legacyMap[value];
            }
        }
        if (typeof promptKeysByTrade.set === 'function') {
            promptKeysByTrade.set(tradeKeyRaw, updated);
        } else {
            promptKeysByTrade[tradeKeyRaw] = updated;
        }
    }

    const promptGuards = frontDesk.promptGuards || {};
    const fallbackText = mapGet(promptGuards.missingPromptFallbackKey);
    if (legacyMap[promptGuards.missingPromptFallbackKey] && fallbackText) {
        promptGuards.missingPromptFallbackKey = legacyMap[promptGuards.missingPromptFallbackKey];
    }
    frontDesk.promptGuards = promptGuards;
    frontDesk.bookingPromptsMap = bookingPromptsMap;
    frontDesk.serviceFlow = serviceFlow;

    const legacyKeysRemaining = Object.keys(legacyMap).filter(key => mapGet(key)).length;
    frontDesk.promptPacks = frontDesk.promptPacks || {};
    frontDesk.promptPacks.migration = {
        status: 'applied',
        appliedAt: new Date(),
        appliedBy,
        notes,
        migratedKeysCount,
        conflictsCount: preview.conflicts.length,
        legacyKeysRemaining
    };

    return {
        ...preview,
        migratedKeysCount,
        legacyKeysRemaining
    };
}

function diffPromptPacks(fromPack, toPack) {
    const fromPrompts = fromPack?.prompts || {};
    const toPrompts = toPack?.prompts || {};
    const fromKeys = new Set(Object.keys(fromPrompts));
    const toKeys = new Set(Object.keys(toPrompts));

    const newKeys = Array.from(toKeys).filter(k => !fromKeys.has(k));
    const removedKeys = Array.from(fromKeys).filter(k => !toKeys.has(k));
    const changedKeys = Array.from(toKeys).filter(k => fromKeys.has(k) && fromPrompts[k] !== toPrompts[k])
        .map(k => ({
            key: k,
            fromText: fromPrompts[k],
            toText: toPrompts[k]
        }));

    return { newKeys, removedKeys, changedKeys };
}

function buildUpgradePreview(companyDoc, tradeKey, toPackId) {
    const frontDesk = companyDoc?.aiAgentSettings?.frontDeskBehavior || {};
    const selectedByTrade = frontDesk.promptPacks?.selectedByTrade || {};
    const normalizedTrade = normalizeTradeKey(tradeKey);
    const fromPackId = selectedByTrade[normalizedTrade] || null;

    const fromPack = getPromptPackById(fromPackId);
    const toPack = getPromptPackById(toPackId);
    const diff = diffPromptPacks(fromPack, toPack);

    const bookingPromptsMap = frontDesk.bookingPromptsMap || {};
    const hasOverride = (key) => {
        const val = typeof bookingPromptsMap.get === 'function'
            ? bookingPromptsMap.get(key)
            : bookingPromptsMap[key];
        return typeof val === 'string' && val.trim().length > 0;
    };

    const overrides = {
        newKeys: diff.newKeys.filter(hasOverride),
        removedKeys: diff.removedKeys.filter(hasOverride),
        changedKeys: diff.changedKeys.map(k => ({
            key: k.key,
            overridden: hasOverride(k.key)
        }))
    };

    return {
        companyId: companyDoc?._id?.toString() || null,
        tradeKey: normalizedTrade,
        fromPackId,
        toPackId,
        diff,
        overrides
    };
}

function applyPackUpgrade(companyDoc, tradeKey, toPackId, { changedBy = 'admin-pack-upgrade', notes = null } = {}) {
    const frontDesk = companyDoc.aiAgentSettings.frontDeskBehavior;
    const normalizedTrade = normalizeTradeKey(tradeKey);
    const fromPackId = frontDesk.promptPacks?.selectedByTrade?.[normalizedTrade] || null;
    const toPack = getPromptPackById(toPackId);

    const preview = buildUpgradePreview(companyDoc, normalizedTrade, toPackId);
    const overriddenKeys = preview.overrides.changedKeys.filter(k => k.overridden).length;
    const changedKeysCount = preview.diff.changedKeys.length + preview.diff.newKeys.length + preview.diff.removedKeys.length;

    frontDesk.promptPacks = frontDesk.promptPacks || {};
    frontDesk.promptPacks.selectedByTrade = frontDesk.promptPacks.selectedByTrade || {};
    frontDesk.promptPacks.selectedByTrade[normalizedTrade] = toPackId;
    frontDesk.promptPacks.history = Array.isArray(frontDesk.promptPacks.history) ? frontDesk.promptPacks.history : [];
    frontDesk.promptPacks.history.push({
        tradeKey: normalizedTrade,
        fromPack: fromPackId,
        toPack: toPackId,
        changedAt: new Date(),
        changedBy,
        notes,
        changedKeysCount,
        overrideCount: overriddenKeys
    });

    return {
        ...preview,
        changedKeysCount,
        overrideCount: overriddenKeys,
        latestPackForTrade: getLatestPackIdForTrade(normalizedTrade),
        toPackLabel: toPack?.label || toPackId
    };
}

async function previewMigration({ companyId }) {
    const company = await v2Company.findById(companyId);
    if (!company) {
        throw new Error(`Company not found: ${companyId}`);
    }
    return buildMigrationPreview(company);
}

async function previewUpgrade({ companyId, tradeKey, toPack }) {
    const company = await v2Company.findById(companyId);
    if (!company) {
        throw new Error(`Company not found: ${companyId}`);
    }
    return buildUpgradePreview(company, tradeKey, toPack);
}

module.exports = {
    buildMigrationPreview,
    applyMigration,
    buildUpgradePreview,
    applyPackUpgrade,
    diffPromptPacks,
    previewMigration,
    previewUpgrade
};
