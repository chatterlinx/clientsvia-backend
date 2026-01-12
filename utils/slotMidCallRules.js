/**
 * slotMidCallRules.js
 *
 * Slot-level "Mid-Call Helpers" matcher + cooldown/max-fire guardrails.
 * This is deterministic and UI-controlled (per booking slot).
 */

function normalizeText(s) {
    return String(s || '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function matchesRule(userText, rule) {
    const t = normalizeText(userText);
    const needle = normalizeText(rule?.trigger);
    if (!t || !needle) return false;
    const matchType = (rule?.matchType || 'contains').toString();
    if (matchType === 'exact') return t === needle;
    return t.includes(needle);
}

function canFireRule({ rule, stateForSlot = {}, turnNumber = 0 }) {
    const id = String(rule?.id || '').trim();
    if (!id) return false;
    const fired = stateForSlot.fired && typeof stateForSlot.fired === 'object' ? stateForSlot.fired : {};
    const entry = fired[id] || {};
    const count = typeof entry.count === 'number' ? entry.count : 0;
    const lastTurn = typeof entry.lastTurn === 'number' ? entry.lastTurn : -999999;

    const maxPerCall = typeof rule?.maxPerCall === 'number' ? rule.maxPerCall : 2;
    const cooldownTurns = typeof rule?.cooldownTurns === 'number' ? rule.cooldownTurns : 2;

    if (count >= maxPerCall) return false;
    if (turnNumber - lastTurn <= cooldownTurns) return false;
    return true;
}

function recordRuleFired({ rule, stateForSlot = {}, turnNumber = 0 }) {
    const id = String(rule?.id || '').trim();
    if (!id) return stateForSlot;
    const next = stateForSlot && typeof stateForSlot === 'object' ? stateForSlot : {};
    if (!next.fired || typeof next.fired !== 'object') next.fired = {};
    const prev = next.fired[id] || {};
    const count = typeof prev.count === 'number' ? prev.count : 0;
    next.fired[id] = { count: count + 1, lastTurn: turnNumber };
    return next;
}

function findFirstMatchingRule({ userText, rules = [], stateForSlot = {}, turnNumber = 0 }) {
    if (!userText || typeof userText !== 'string') return null;
    if (!Array.isArray(rules) || rules.length === 0) return null;

    for (const rule of rules) {
        if (!rule || typeof rule !== 'object') continue;
        if (rule.enabled === false) continue;
        if (!matchesRule(userText, rule)) continue;
        if (!canFireRule({ rule, stateForSlot, turnNumber })) continue;
        return rule;
    }
    return null;
}

module.exports = {
    findFirstMatchingRule,
    recordRuleFired
};

