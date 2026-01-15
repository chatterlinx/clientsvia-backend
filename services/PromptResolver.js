const { getPromptPackById } = require('../config/promptPacks');

function normalizeTradeKey(value) {
    return String(value || '').trim().toLowerCase();
}

function parsePromptKeyTrade(promptKey) {
    const match = /^booking\.([a-z0-9_]+)\./i.exec(String(promptKey || '').trim());
    if (!match) return null;
    return normalizeTradeKey(match[1]);
}

function resolveBookingPrompt(company, promptKey, { tradeKey = null } = {}) {
    if (!promptKey) return null;
    const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};
    const map = frontDesk.bookingPromptsMap || frontDesk.bookingPrompts || null;
    if (!map) return null;

    if (typeof map.get === 'function') {
        const value = map.get(promptKey);
        return value ? String(value).trim() : null;
    }

    const value = map[promptKey];
    if (value) return String(value).trim();

    const promptTrade = parsePromptKeyTrade(promptKey);
    const normalizedTrade = normalizeTradeKey(tradeKey || promptTrade || 'universal');
    const promptPacks = frontDesk.promptPacks || {};
    const selectedByTrade = promptPacks.selectedByTrade || {};
    if (promptPacks.enabled === false) {
        return null;
    }

    const explicitPackId = selectedByTrade[normalizedTrade] || null;
    const pickFromPack = (packId) => {
        if (!packId) return null;
        const pack = getPromptPackById(packId);
        if (!pack || !pack.prompts) return null;
        return pack.prompts[promptKey] || null;
    };

    let packPrompt = pickFromPack(explicitPackId);

    if (!packPrompt && normalizedTrade !== 'universal' && selectedByTrade.universal) {
        packPrompt = pickFromPack(selectedByTrade.universal);
    }

    if (!packPrompt && promptTrade && promptTrade !== normalizedTrade) {
        const fallbackPackId = selectedByTrade[promptTrade];
        packPrompt = pickFromPack(fallbackPackId);
    }

    return packPrompt ? String(packPrompt).trim() : null;
}

function resolveServiceFlowPrompts(company, tradeKey) {
    const frontDesk = company.aiAgentSettings?.frontDeskBehavior || {};
    const serviceFlow = frontDesk.serviceFlow || {};
    if (!tradeKey || serviceFlow.mode === 'off') return null;

    const promptKeysByTrade = serviceFlow.promptKeysByTrade || {};
    const tradeConfig = typeof promptKeysByTrade.get === 'function'
        ? promptKeysByTrade.get(tradeKey)
        : promptKeysByTrade[tradeKey];

    if (!tradeConfig) return null;

    return {
        nonUrgentConsent: resolveBookingPrompt(company, tradeConfig.nonUrgentConsent, { tradeKey }),
        urgentTriageQuestion: resolveBookingPrompt(company, tradeConfig.urgentTriageQuestion, { tradeKey }),
        postTriageConsent: resolveBookingPrompt(company, tradeConfig.postTriageConsent, { tradeKey }),
        consentClarify: resolveBookingPrompt(company, tradeConfig.consentClarify, { tradeKey })
    };
}

module.exports = {
    resolveBookingPrompt,
    resolveServiceFlowPrompts
};
