'use strict';

/**
 * ============================================================================
 * AnchorSynonymResolver — Synonym expansion for the UAP anchor gate
 * ============================================================================
 *
 * WHY THIS EXISTS:
 *
 *   The UAP anchor gate (KCDiscoveryRunner L1689-1726, "Logic 1 / Word Gate")
 *   currently scores caller utterances against a phrase's `anchorWords[]` using
 *   literal stem comparison. A caller saying "system's not cooling" misses the
 *   anchor word "ac" because "system" doesn't share a stem with "ac" — even
 *   though in HVAC parlance the two are the same thing. The gate fails ratio
 *   < 0.90 → KC card never commits → control jumps to Claude LLM agent,
 *   bypassing both KC and Groq.
 *
 *   This resolver adds a synonym layer ON TOP of literal matching: if the
 *   literal stem doesn't match, we check whether ANY of the anchor's
 *   registered synonyms appears in the caller's input. Matching either way
 *   counts as one anchor hit.
 *
 * ARCHITECTURE:
 *
 *   Two-layer config, platform-first:
 *
 *     Layer 1 — Platform default
 *       AdminSettings.globalHub.anchorSynonyms : Mixed
 *       Shape: { "<anchorWord>": ["<synonym1>", "<synonym2>", ...] }
 *       Example: { "ac": ["air conditioner", "system", "unit", "central air"] }
 *
 *     Layer 2 — Per-tenant override
 *       company.aiAgentSettings.agent2.speechDetection.anchorSynonyms : Mixed
 *       Same shape. A tenant key REPLACES the platform's list for that
 *       anchor (override semantics — keeps it predictable, no surprise unions).
 *       Setting a tenant key to [] explicitly DISABLES synonyms for that
 *       anchor (useful when a synonym creates a false positive in the tenant's
 *       industry).
 *
 * MULTI-TENANT SAFETY:
 *
 *   - No hardcoded synonyms in this file. All data lives in DB.
 *   - Empty platform + empty tenant = empty map → anchor gate behaves
 *     identically to today (literal-only). This is the behaviour at deploy
 *     time before any platform seeding is run. Zero regression.
 *   - Resolver is pure: takes config in, returns map out. No global state
 *     beyond an optional AdminSettings cache (see _loadAdminSettingsCached
 *     below).
 *
 * STORAGE NOTES:
 *
 *   Both anchor words and synonyms can be multi-token phrases (e.g.
 *   "air conditioner"). At resolve time:
 *     - The anchor key is reduced to a single stem of its FIRST token.
 *       (Anchor words in CompanyKnowledgeContainer.sections[].callerPhrases[]
 *       are themselves single-word entries — see anchor extraction logic in
 *       UtteranceActParser. So we honour that contract.)
 *     - Each synonym is stored as an array of stemmed tokens. A synonym
 *       phrase matches the input only if ALL its tokens are present in the
 *       caller's input stem set ("central air" → match only when both
 *       "central" AND "air" appear).
 *
 * PIPELINE POSITION:
 *
 *   Hot-path. Called once per turn from KCDiscoveryRunner during anchor gate
 *   scoring. resolveSynonyms() is O(N) on the size of the synonym map —
 *   typically <100 entries. matchAnchor() is O(M) on the synonym list of
 *   the specific anchor — typically <10 entries. Total cost <0.1ms per turn.
 *
 *   AdminSettings reads are cached for 60s in-process to avoid one Mongo
 *   round-trip per turn under load.
 *
 * @module services/engine/kc/AnchorSynonymResolver
 * ============================================================================
 */

const { stem } = require('../../../utils/stem');

// ─── In-process AdminSettings cache (60s TTL) ──────────────────────────────
// Avoids one Mongo round-trip per turn. AdminSettings is a singleton; admins
// edit it through a UI and the change frequency is days/weeks, not seconds.
let _adminSettingsCache = null;
let _adminSettingsCachedAt = 0;
const _ADMIN_CACHE_TTL_MS = 60 * 1000;

async function _loadAdminSettingsCached() {
  const now = Date.now();
  if (_adminSettingsCache && (now - _adminSettingsCachedAt) < _ADMIN_CACHE_TTL_MS) {
    return _adminSettingsCache;
  }
  try {
    const AdminSettings = require('../../../models/AdminSettings');
    // .lean() — we only read; skip Mongoose hydration overhead.
    const doc = await AdminSettings.findOne().lean();
    _adminSettingsCache = doc || {};
    _adminSettingsCachedAt = now;
    return _adminSettingsCache;
  } catch (_err) {
    // Never break the call over an AdminSettings load. Resolver gracefully
    // degrades to "no platform synonyms" — anchor gate falls back to literal.
    return {};
  }
}

/**
 * Test hook: clear the in-process AdminSettings cache. Tests may stub
 * AdminSettings between assertions; without this hook they'd be reading
 * a stale cache. Not for production use.
 */
function _resetAdminSettingsCache() {
  _adminSettingsCache = null;
  _adminSettingsCachedAt = 0;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function _normalize(w) {
  return String(w || '').toLowerCase().trim();
}

/**
 * Reduce a (possibly multi-word) synonym phrase to its array of stemmed
 * tokens. Strips non-alphanumerics. Filters empties.
 */
function _stemTokens(phrase) {
  return _normalize(phrase)
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(stem);
}

/**
 * Reduce an anchor word to its lookup key. Anchor words are stored as single
 * tokens by the KC editor (see UtteranceActParser anchor extraction). For
 * defensive robustness we still take just the first token + stem.
 */
function _anchorKey(anchorWord) {
  const tokens = _stemTokens(anchorWord);
  return tokens[0] || '';
}

// ─── Public API ────────────────────────────────────────────────────────────

/**
 * Resolve the synonym map for a given company.
 *
 * @param {Object} args
 * @param {Object} [args.company]        — Mongoose doc or plain object (may be null)
 * @param {Object} [args.adminSettings]  — pre-loaded settings doc; if omitted, loads from DB (cached 60s)
 * @returns {Promise<Map<string, Array<{ tokens: string[], original: string }>>>}
 *   Map key   = stem of an anchor word (e.g. "ac")
 *   Map value = array of synonym entries, each:
 *               { tokens: ["central","air"], original: "central air" }
 *               A synonym matches the input when ALL its tokens are in the
 *               input's stem set. `original` is preserved for diagnostic
 *               output ("matched via synonym 'central air'").
 *
 *   When neither layer has data, returns an empty Map. Callers must treat
 *   an empty map as "literal-only matching" (the legacy behaviour).
 */
async function resolveSynonyms({ company, adminSettings } = {}) {
  const out = new Map();

  // Resolve admin settings (passed-in wins, else cached load, else empty).
  let settings = adminSettings;
  if (!settings) settings = await _loadAdminSettingsCached();

  // ── Layer 1: Platform defaults ─────────────────────────────────────
  const platformSyns = settings?.globalHub?.anchorSynonyms || null;
  if (platformSyns && typeof platformSyns === 'object') {
    for (const [anchor, synList] of Object.entries(platformSyns)) {
      if (!Array.isArray(synList)) continue;
      const key = _anchorKey(anchor);
      if (!key) continue;
      const entries = synList
        .map(s => ({ tokens: _stemTokens(s), original: _normalize(s) }))
        .filter(e => e.tokens.length > 0);
      if (entries.length === 0) continue;
      out.set(key, entries);
    }
  }

  // ── Layer 2: Per-tenant override (REPLACE semantics) ───────────────
  const tenantSyns =
    company?.aiAgentSettings?.agent2?.speechDetection?.anchorSynonyms || null;
  if (tenantSyns && typeof tenantSyns === 'object') {
    for (const [anchor, synList] of Object.entries(tenantSyns)) {
      const key = _anchorKey(anchor);
      if (!key) continue;
      if (!Array.isArray(synList) || synList.length === 0) {
        // Tenant explicitly cleared this anchor's synonyms.
        out.delete(key);
        continue;
      }
      const entries = synList
        .map(s => ({ tokens: _stemTokens(s), original: _normalize(s) }))
        .filter(e => e.tokens.length > 0);
      if (entries.length === 0) {
        out.delete(key);
        continue;
      }
      out.set(key, entries);
    }
  }

  return out;
}

/**
 * Test whether an anchor word matches the caller's input — first via literal
 * stem (current behaviour), then via synonym expansion if literal misses.
 *
 * @param {Object} args
 * @param {string} args.anchorWord            — raw anchor word (lowercased)
 * @param {Set<string>} args.inputExact       — caller input tokens (lowercased)
 * @param {Set<string>} args.inputStems       — caller input token stems
 * @param {Map}    args.synonymMap            — from resolveSynonyms()
 * @returns {{ matched: boolean, via: 'literal'|'synonym'|'none', synonymPhrase?: string }}
 */
function matchAnchor({ anchorWord, inputExact, inputStems, synonymMap }) {
  if (!anchorWord) return { matched: false, via: 'none' };

  const aw = _normalize(anchorWord);
  // ── Literal path (zero-cost shortcut, identical to legacy logic) ────
  if (inputExact.has(aw) || inputStems.has(stem(aw))) {
    return { matched: true, via: 'literal' };
  }

  // ── Synonym path ────────────────────────────────────────────────────
  if (!synonymMap || synonymMap.size === 0) {
    return { matched: false, via: 'none' };
  }
  const key = _anchorKey(aw);
  const entries = synonymMap.get(key);
  if (!entries || entries.length === 0) {
    return { matched: false, via: 'none' };
  }
  for (const entry of entries) {
    const allTokensPresent = entry.tokens.every(
      t => inputStems.has(t) || inputExact.has(t)
    );
    if (allTokensPresent) {
      return {
        matched:       true,
        via:           'synonym',
        synonymPhrase: entry.original,
      };
    }
  }
  return { matched: false, via: 'none' };
}

/**
 * Compute the anchor-anchored window of a caller's raw input.
 *
 * Used by KCDiscoveryRunner Logic 2 ("core gate rescue") when the full
 * topicWords-joined embedding fails the threshold but anchors passed. Idea:
 * compound utterances ("how much would it cost — do I have to pay again")
 * dilute the averaged embedding. The slice of input bounded by the matched
 * anchor positions concentrates the routing-relevant signal — embedding
 * that slice gives the section phrase a fair fight.
 *
 * @param {Object} args
 * @param {string} args.rawInput               — the caller's raw utterance
 * @param {Array<string>} args.anchorWords     — anchor words from the matched phrase
 * @param {Map}    args.synonymMap             — from resolveSynonyms()
 * @param {number} [args.paddingWords=2]       — padding on each side of the bounded span
 * @returns {{ window: string, span: {min: number, max: number}, matchedAt: number[] } | null}
 *   `null` when no anchor positions can be located (input too short, no
 *   matches found in raw form). Caller should skip rescue in that case.
 */
function computeAnchorAnchoredWindow({ rawInput, anchorWords, synonymMap, paddingWords = 2 }) {
  if (!rawInput || !Array.isArray(anchorWords) || anchorWords.length === 0) return null;

  const tokens = String(rawInput)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.length === 0) return null;

  // Pre-stem each input token once.
  const tokenStems = tokens.map(stem);

  // Pre-stem each anchor + collect synonym token sets per anchor for cheap lookup.
  const anchorPlans = anchorWords.map(aw => {
    const norm = _normalize(aw);
    const stems = stem(norm);
    const synEntries = synonymMap?.get(_anchorKey(norm)) || [];
    return { norm, stem: stems, synEntries };
  });

  // For each input position, check whether ANY anchor satisfies a hit at this token.
  const matchedPositions = [];
  for (let i = 0; i < tokens.length; i++) {
    const t  = tokens[i];
    const ts = tokenStems[i];
    let satisfiesAny = false;

    for (const plan of anchorPlans) {
      // Literal hit
      if (t === plan.norm || ts === plan.stem) { satisfiesAny = true; break; }
      // Synonym hit — this token is part of a synonym phrase whose ALL
      // tokens are in the input set. We don't re-validate the "all tokens
      // present" condition here (gate already did); we just check whether
      // THIS position is one of the synonym's tokens.
      for (const entry of plan.synEntries) {
        if (entry.tokens.includes(t) || entry.tokens.includes(ts)) {
          satisfiesAny = true; break;
        }
      }
      if (satisfiesAny) break;
    }
    if (satisfiesAny) matchedPositions.push(i);
  }

  if (matchedPositions.length === 0) return null;

  const minP = Math.max(0, Math.min(...matchedPositions) - paddingWords);
  const maxP = Math.min(tokens.length - 1, Math.max(...matchedPositions) + paddingWords);
  const windowText = tokens.slice(minP, maxP + 1).join(' ');

  return {
    window:    windowText,
    span:      { min: minP, max: maxP },
    matchedAt: matchedPositions,
  };
}

module.exports = {
  resolveSynonyms,
  matchAnchor,
  computeAnchorAnchoredWindow,
  // Test hooks (do not use in production code paths)
  _resetAdminSettingsCache,
};
