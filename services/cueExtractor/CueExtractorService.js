'use strict';

/**
 * ============================================================================
 * CUE EXTRACTOR SERVICE  —  8-Field Pattern Match (<1ms)
 * ============================================================================
 *
 * PURPOSE:
 *   Extracts 8 structured cue fields from a caller utterance using pure string
 *   matching. No LLM, no embedding, no API — <1ms worst case.
 *
 * FIELDS:
 *   1-7  Universal patterns (GlobalShare cuePhrases):
 *        requestCue, permissionCue, infoCue, directiveCue,
 *        actionCore, urgencyCore, modifierCore
 *
 *   8    Per-company trade terms (KC section.tradeTerms[]):
 *        tradeCore — maps utterance words to specific sections
 *
 * ARCHITECTURE:
 *   - Fields 1-7: loaded from PhraseReducerService.getCuePatterns() (5-min cache)
 *   - Field 8:    loaded from CompanyKnowledgeContainer sections, built into a
 *                 reverse index { term → { containerId, sectionIdx, sectionLabel } }
 *   - Trade index: Redis-cached per company, invalidated on KC section save
 *
 * OUTPUT:
 *   {
 *     requestCue:    'can you' | null,
 *     permissionCue: null,
 *     infoCue:       null,
 *     directiveCue:  null,
 *     actionCore:    'schedule' | null,
 *     urgencyCore:   'today' | null,
 *     modifierCore:  'next week' | null,
 *     tradeMatches:  [{ term, containerId, sectionIdx, sectionLabel }],
 *     fieldCount:    Number (0-8, counts non-null fields + tradeMatches>0),
 *     extractedAt:   ISO timestamp
 *   }
 *
 * PIPELINE POSITION:
 *   GATE 2.4 in KCDiscoveryRunner — fires before UAP (GATE 2.5).
 *   If fieldCount >= 3 AND tradeMatches has a strong hit → GATE 2.4b confirms.
 *   If weak/no match → falls through to GATE 2.5 (UAP unchanged).
 *
 * ============================================================================
 */

const PhraseReducerService   = require('../phraseIntelligence/PhraseReducerService');
const CompanyKnowledgeContainer = require('../../models/CompanyKnowledgeContainer');
const { getSharedRedisClient }  = require('../redisClientFactory');
const logger                    = require('../../utils/logger');

// ── Trade index cache ──────────────────────────────────────────────────────
// In-memory + Redis. Redis key: cue-trade-idx:{companyId}
// Invalidated when KC containers are saved (see invalidateTradeIndex).
const TRADE_IDX_REDIS_PREFIX = 'cue-trade-idx';
const TRADE_IDX_REDIS_TTL    = 3600;  // 1 hour (Redis backup; in-memory is primary)

let _tradeIndexCache = {};  // { companyId: { builtAt, data: { index, companyTradeKeys } } }
const TRADE_IDX_MEM_TTL_MS  = 5 * 60 * 1000;  // 5 minutes in-memory

// ── Canonical cue field names (matches GlobalShare token values) ───────────
const CUE_FIELDS = [
  'requestCue', 'permissionCue', 'infoCue', 'directiveCue',
  'actionCore', 'urgencyCore', 'modifierCore',
];

// ── Stemmer (P3, April 2026) ────────────────────────────────────────────────
// Mirrors _stem() in KCDiscoveryRunner.js with one extra rule (trailing "e"
// preceded by 4+ word chars) to collapse "schedule" with "scheduled"/"scheduling".
// Used ONLY for single-word cue patterns to catch English inflections without
// expanding the cuePhrases dictionary 3-5x. Multi-word idiomatic patterns
// ("do i have to", "i need", "right now") remain substring-matched verbatim.
//
// Length guard (<4 chars → return as-is) protects short words from collisions
// like "her" vs "here" or "the" vs "they". The (\w{4,})e$ pattern protects
// short words like "have", "here", "home" while still collapsing
// "schedule"→"schedul", "charge"→"charg", "phone"→"phon".
//
// Known limitation: irregular past tense ("paid", "made", "took") does NOT
// stem to base form. Add the irregular form as a separate pattern if needed.
function _stem(word) {
  const w = String(word || '').toLowerCase();
  if (w.length < 4) return w;
  return w
    .replace(/ings?$/,        '')   // scheduling/schedulings → schedul
    .replace(/ations?$/,      '')   // installation/installations → install
    .replace(/ers?$/,         '')   // installer/installers → install
    .replace(/ed$/,           '')   // scheduled → schedul
    .replace(/ly$/,           '')   // currently → current
    .replace(/ies$/,          'y')  // warranties → warranty
    .replace(/ves$/,          'f')  // leaves → leaf
    .replace(/s$/,            '')   // weekends → weekend
    .replace(/(\w{4,})e$/,    '$1');// schedule → schedul (4+ char prefix only)
}

// ============================================================================
// TRADE INDEX — build reverse lookup from KC sections' tradeTerms[]
// ============================================================================

/**
 * Build or retrieve the trade terms reverse index for a company.
 *
 * Index shape: { normalizedTerm: [{ term, containerId, sectionIdx, sectionLabel }] }
 * A term can appear in multiple sections — all are returned (caller picks best).
 *
 * @param {string} companyId
 * @returns {Promise<Object>}
 */
async function _getTradeIndex(companyId) {
  // ── In-memory hot path ───────────────────────────────────────────────────
  const cached = _tradeIndexCache[companyId];
  if (cached && (Date.now() - cached.builtAt) < TRADE_IDX_MEM_TTL_MS) {
    return cached.data;
  }

  // ── Redis warm path ─────────────────────────────────────────────────────
  try {
    const redis = await getSharedRedisClient();
    if (redis) {
      const raw = await redis.get(`${TRADE_IDX_REDIS_PREFIX}:${companyId}`);
      if (raw) {
        const data = JSON.parse(raw);
        // Backward compat: old cache may be plain index without companyTradeKeys
        const normalized = data.companyTradeKeys ? data : { index: data, companyTradeKeys: [] };
        _tradeIndexCache[companyId] = { builtAt: Date.now(), data: normalized };
        return normalized;
      }
    }
  } catch (_) { /* fall through to build */ }

  // ── Cold path — build from MongoDB ──────────────────────────────────────
  const data = await _buildTradeIndex(companyId);

  // Write to memory + Redis
  _tradeIndexCache[companyId] = { builtAt: Date.now(), data };
  try {
    const redis = await getSharedRedisClient();
    if (redis) {
      await redis.set(
        `${TRADE_IDX_REDIS_PREFIX}:${companyId}`,
        JSON.stringify(data),
        { EX: TRADE_IDX_REDIS_TTL }
      );
    }
  } catch (_) { /* non-fatal */ }

  return data;
}

/**
 * Build trade index from two sources:
 *   1. Global vocabularies (via container.tradeVocabularyKey → GlobalShare)
 *      Maps terms to container level (sectionIdx = -1, no section targeting).
 *   2. Per-section tradeTerms[] (custom overrides, maps to specific section).
 *
 * @param {string} companyId
 * @returns {Promise<Object>}
 */
async function _buildTradeIndex(companyId) {
  const index = {};

  try {
    const containers = await CompanyKnowledgeContainer
      .find({ companyId, isActive: true })
      .select('_id title tradeVocabularyKey sections.label sections.isActive sections.tradeTerms sections.order')
      .sort({ priority: 1, createdAt: 1 })
      .lean();

    // ── Source 1: Global vocabularies (container-level) ──────────────────
    // Build a map of tradeKey → terms[] from GlobalShare (cached, <1ms)
    let vocabMap = null;
    const hasLinkedContainers = containers.some(c => c.tradeVocabularyKey);
    if (hasLinkedContainers) {
      const vocabs = await PhraseReducerService.getTradeVocabularies();
      vocabMap = {};
      for (const v of vocabs) {
        vocabMap[v.tradeKey] = v.terms || [];
      }
    }

    for (const c of containers) {
      const cId = String(c._id);

      // Global vocabulary terms → container-level (no section targeting)
      if (c.tradeVocabularyKey && vocabMap?.[c.tradeVocabularyKey]) {
        for (const term of vocabMap[c.tradeVocabularyKey]) {
          const norm = term.toLowerCase().trim();
          if (!norm) continue;
          if (!index[norm]) index[norm] = [];
          index[norm].push({
            term,
            containerId:  cId,
            sectionIdx:   -1,          // container-level — no section targeting
            sectionLabel: '',
          });
        }
      }

      // ── Source 2: Per-section tradeTerms[] (custom overrides) ──────────
      const sections = c.sections || [];
      for (let sIdx = 0; sIdx < sections.length; sIdx++) {
        const section = sections[sIdx];
        if (section.isActive === false) continue;

        for (const term of (section.tradeTerms || [])) {
          const norm = term.toLowerCase().trim();
          if (!norm) continue;
          if (!index[norm]) index[norm] = [];
          index[norm].push({
            term,
            containerId:  cId,
            sectionIdx:   sIdx,
            sectionLabel: section.label || '',
          });
        }
      }
    }

    // ── Collect distinct trade keys across this company's containers ────
    const companyTradeKeys = [...new Set(
      containers.map(c => c.tradeVocabularyKey).filter(Boolean)
    )];

    logger.debug('[CueExtractor] Trade index built', {
      companyId,
      termCount: Object.keys(index).length,
      companyTradeKeys,
    });

    return { index, companyTradeKeys };
  } catch (err) {
    logger.warn('[CueExtractor] Trade index build failed', {
      companyId, error: err.message,
    });
  }

  return { index, companyTradeKeys: [] };
}

/**
 * Invalidate the trade index for a company.
 * Call this when KC containers are saved (tradeTerms may have changed).
 *
 * @param {string} companyId
 */
async function invalidateTradeIndex(companyId) {
  delete _tradeIndexCache[companyId];
  try {
    const redis = await getSharedRedisClient();
    if (redis) {
      await redis.del(`${TRADE_IDX_REDIS_PREFIX}:${companyId}`);
    }
  } catch (_) { /* non-fatal */ }
}

// ============================================================================
// EXTRACT — main entry point
// ============================================================================

/**
 * Extract 8 cue fields from a caller utterance.
 *
 * @param {string} companyId
 * @param {string} utterance  — raw caller input
 * @returns {Promise<Object>} cueFrame — see module header for shape
 */
async function extract(companyId, utterance) {
  const startMs = Date.now();
  const frame = {
    requestCue:    null,
    permissionCue: null,
    infoCue:       null,
    directiveCue:  null,
    actionCore:    null,
    urgencyCore:   null,
    modifierCore:  null,
    tradeMatches:  [],
    fieldCount:    0,
    extractedAt:   new Date().toISOString(),
  };

  if (!utterance || typeof utterance !== 'string') return frame;

  const lower = utterance.toLowerCase().trim();
  if (!lower) return frame;

  // ── FIELDS 1-7: Universal cue patterns ─────────────────────────────────
  // Longest patterns first → first match per type wins.
  const cuePatterns = await PhraseReducerService.getCuePatterns();

  // Group patterns by token, sorted longest-first within each group
  const byToken = {};
  for (const cp of cuePatterns) {
    const token = (cp.token || '').toLowerCase();
    if (!token) continue;
    if (!byToken[token]) byToken[token] = [];
    byToken[token].push(cp.pattern.toLowerCase().trim());
  }
  // Sort each group by length DESC
  for (const token of Object.keys(byToken)) {
    byToken[token].sort((a, b) => b.length - a.length);
  }

  // Pre-compute input tokens + stems once for stemmed whole-word matching
  // of single-word patterns (catches "paying" when pattern is "pay", etc.).
  // Multi-word patterns still use substring matching (idiomatic phrases).
  const inputTokens = lower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);
  const inputExact  = new Set(inputTokens);
  const inputStems  = new Set(inputTokens.map(_stem));

  // Match against each canonical field
  for (const field of CUE_FIELDS) {
    const token = field.toLowerCase();
    const patterns = byToken[token];
    if (!patterns) continue;

    for (const pat of patterns) {
      let hit = false;
      if (pat.includes(' ')) {
        // Multi-word patterns ("do i have to", "right now") — substring match
        if (lower.includes(pat)) hit = true;
      } else {
        // Single-word patterns — stemmed whole-word match.
        // Whole-word avoids false positives like "pay" matching "payment"/"paypal".
        // Stemming catches inflections: "paying"/"pays" → "pay", "scheduling" → "schedule".
        if (inputExact.has(pat) || inputStems.has(_stem(pat))) hit = true;
      }
      if (hit) {
        frame[field] = pat;
        break;  // first (longest) match wins
      }
    }
  }

  // ── FIELD 8: Trade terms ───────────────────────────────────────────────
  const { index: tradeIndex, companyTradeKeys } = await _getTradeIndex(companyId);
  const tradeTerms = Object.keys(tradeIndex);

  if (tradeTerms.length > 0) {
    // Sort longest-first so "ac maintenance plan" matches before "ac"
    tradeTerms.sort((a, b) => b.length - a.length);

    const matched = new Set();  // avoid duplicate section matches
    for (const term of tradeTerms) {
      if (lower.includes(term)) {
        const entries = tradeIndex[term];
        for (const entry of entries) {
          const key = `${entry.containerId}:${entry.sectionIdx}`;
          if (!matched.has(key)) {
            matched.add(key);
            frame.tradeMatches.push(entry);
          }
        }
      }
    }
  }

  // ── Field count — how many of the 8 fields are populated ──────────────
  let count = 0;
  for (const field of CUE_FIELDS) {
    if (frame[field]) count++;
  }
  if (frame.tradeMatches.length > 0) count++;
  frame.fieldCount = count;

  // ── Company trade context — enables single-trade bypass in GATE 2.4 ──
  frame.companyTradeKeys = companyTradeKeys;
  frame.isSingleTrade    = companyTradeKeys.length <= 1;

  const elapsedMs = Date.now() - startMs;
  if (elapsedMs > 5) {
    logger.warn('[CueExtractor] Slow extraction', {
      companyId, elapsedMs, fieldCount: frame.fieldCount,
    });
  }

  return frame;
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  extract,
  invalidateTradeIndex,
  CUE_FIELDS,
};
