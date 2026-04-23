/**
 * VocabularyResolver.js — Media Streams per-tenant keyword resolution
 *
 * Single platform function that merges vocabulary from three sources into a
 * single Deepgram "phrase:boost" keyword array:
 *   1. Tenant-managed keywords  (company.aiAgentSettings.agent2.speechDetection.keywords)
 *   2. Platform trade vocabulary (AdminSettings.globalHub.phraseIntelligence.tradeVocabularies,
 *                                 filtered by company.trade)
 *   3. Platform first names      (AWConfigReader.getGlobalFirstNames() — low-boost hints)
 *
 * No hardcoded trade/vertical defaults. Every term traces back to the DB.
 * If none of the three sources yield anything, an empty array is returned
 * (DeepgramService.getLiveConnectionConfig tolerates this — no HVAC fallback).
 *
 * Dedupe: case-insensitive phrase key. On collision the highest boost wins.
 * Cap: 100 keywords max (Deepgram live stream hard limit per connection).
 *
 * Pure function — does NO database reads. Callers load the company + admin
 * settings once per call and pass both in. Keeps the resolver testable and
 * hot-path friendly for C3's per-call resolution.
 *
 * @module services/mediaStream/VocabularyResolver
 * @version 1.0.0
 */

'use strict';

const DEFAULT_BOOSTS = Object.freeze({
    tenantKeyword: 3,    // matches speechDetection.keywords schema default
    tradeTerm: 2,        // platform trade vocab — useful but not anchor-level
    firstName: 1         // helps name recognition, shouldn't dominate routing
});

// Deepgram live stream accepts up to 100 keyterms per connection.
const MAX_KEYWORDS = 100;
// How many platform first names to include (a tenant with 10k names would
// blow past the keyword cap; tight bound keeps common names without drowning
// real vocabulary).
const MAX_FIRST_NAMES = 30;

/**
 * Normalise a phrase for dedupe. Trim, lowercase, collapse whitespace.
 * @param {string} phrase
 * @returns {string}
 */
function normPhrase(phrase) {
    return String(phrase || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Clamp a boost value to Deepgram's accepted 0-4 range. Tenant schema allows
 * 1-10 so we rescale: 1→1, 2-3→2, 4-6→3, 7-10→4.
 *
 * @param {number} boost
 * @returns {number}
 */
function normaliseBoost(boost) {
    const n = Number(boost);
    if (!Number.isFinite(n) || n <= 0) return 1;
    if (n <= 1) return 1;
    if (n <= 3) return 2;
    if (n <= 6) return 3;
    return 4;
}

/**
 * Extract enabled tenant keywords from company.aiAgentSettings.agent2.speechDetection.
 * Returns array of { phrase, boost } with original boost (not normalised).
 *
 * @param {Object} company
 * @returns {Array<{phrase:string, boost:number}>}
 */
function collectTenantKeywords(company) {
    const list = company?.aiAgentSettings?.agent2?.speechDetection?.keywords || [];
    const out = [];
    for (const k of list) {
        if (!k || k.enabled === false) continue;
        const phrase = normPhrase(k.phrase);
        if (!phrase) continue;
        out.push({
            phrase,
            boost: Number.isFinite(k.boost) ? k.boost : DEFAULT_BOOSTS.tenantKeyword
        });
    }
    return out;
}

/**
 * Extract trade vocabulary terms for the company's trade.
 * Trade vocab lives in AdminSettings.globalHub.phraseIntelligence.tradeVocabularies
 * as [{ tradeKey, label, terms }]. Match is case-insensitive on tradeKey.
 *
 * @param {Object} company
 * @param {Object} adminSettings
 * @returns {Array<{phrase:string, boost:number}>}
 */
function collectTradeTerms(company, adminSettings) {
    const trade = String(company?.trade || '').trim().toLowerCase();
    if (!trade) return [];
    const vocabs = adminSettings?.globalHub?.phraseIntelligence?.tradeVocabularies || [];
    const match = vocabs.find(v => String(v?.tradeKey || '').trim().toLowerCase() === trade);
    if (!match || !Array.isArray(match.terms)) return [];
    const out = [];
    for (const term of match.terms) {
        const phrase = normPhrase(term);
        if (!phrase) continue;
        out.push({ phrase, boost: DEFAULT_BOOSTS.tradeTerm });
    }
    return out;
}

/**
 * Collect platform first names, capped to MAX_FIRST_NAMES.
 * Uses AWConfigReader.getGlobalFirstNames() — synchronous cached accessor.
 *
 * @returns {Array<{phrase:string, boost:number}>}
 */
function collectFirstNames() {
    let names = [];
    try {
        const AWConfigReader = require('../wiring/AWConfigReader');
        if (typeof AWConfigReader.getGlobalFirstNames === 'function') {
            names = AWConfigReader.getGlobalFirstNames() || [];
        }
    } catch (_err) {
        // First-names cache unavailable — degrade silently.
        names = [];
    }
    const out = [];
    const take = names.slice(0, MAX_FIRST_NAMES);
    for (const n of take) {
        const phrase = normPhrase(n);
        if (!phrase) continue;
        out.push({ phrase, boost: DEFAULT_BOOSTS.firstName });
    }
    return out;
}

/**
 * Merge keyword buckets, dedupe (keep highest boost), sort by boost desc,
 * emit as Deepgram "phrase:boost" strings.
 *
 * @param {Array<{phrase:string, boost:number}>} buckets
 * @returns {string[]}
 */
function mergeAndFormat(buckets) {
    const byPhrase = new Map();
    for (const entry of buckets) {
        if (!entry?.phrase) continue;
        const key = entry.phrase; // already normalised
        const existing = byPhrase.get(key);
        if (!existing || entry.boost > existing.boost) {
            byPhrase.set(key, { phrase: key, boost: entry.boost });
        }
    }
    const merged = Array.from(byPhrase.values())
        .sort((a, b) => b.boost - a.boost)
        .slice(0, MAX_KEYWORDS);
    return merged.map(({ phrase, boost }) => `${phrase}:${normaliseBoost(boost)}`);
}

/**
 * Resolve the final Deepgram keyword array for a tenant.
 *
 * @param {Object} company
 * @param {Object} [adminSettings]
 * @returns {string[]} Deepgram "phrase:boost" strings, up to MAX_KEYWORDS
 */
function resolveKeywords(company, adminSettings) {
    const tenant = collectTenantKeywords(company);
    const trade  = collectTradeTerms(company, adminSettings);
    const names  = collectFirstNames();
    return mergeAndFormat([...tenant, ...trade, ...names]);
}

module.exports = {
    resolveKeywords,
    // Exposed for tests and C3/C4 health logging.
    _internals: {
        collectTenantKeywords,
        collectTradeTerms,
        collectFirstNames,
        mergeAndFormat,
        normPhrase,
        normaliseBoost,
        MAX_KEYWORDS,
        MAX_FIRST_NAMES,
        DEFAULT_BOOSTS
    }
};
