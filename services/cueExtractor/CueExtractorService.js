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
 *   8    Per-company trade terms (container.tradeVocabularyKey → GlobalShare):
 *        tradeCore — maps utterance words to containers that own that trade
 *        (Section-level tradeTerms removed — phrases+anchors handle section pick.)
 *
 * ARCHITECTURE:
 *   - Fields 1-7: loaded from PhraseReducerService.getCuePatterns() (5-min cache)
 *   - Field 8:    container.tradeVocabularyKey → GlobalShare vocab, reverse-indexed
 *                 { term → { containerId, sectionIdx: -1, sectionLabel: '' } }
 *   - Trade index: Redis-cached per company, invalidated on KC container save
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
const { stem: _stem }           = require('../../utils/stem');

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

// ── Stemmer ─────────────────────────────────────────────────────────────────
// Imported from utils/stem.js — single source of truth shared with
// KCDiscoveryRunner's Anchor Gate (Logic 1). Stage 12 audit harmonized the
// two previously-drifting copies. Used ONLY for single-word cue patterns to
// catch English inflections without expanding the cuePhrases dictionary 3-5x.
// Multi-word idiomatic patterns ("do i have to", "i need", "right now")
// remain substring-matched verbatim.
//
// See utils/stem.js for full design notes + known limitations.

// ── Determiners (April 2026) ────────────────────────────────────────────────
// Words that strongly signal "what follows is a noun phrase, not a verb".
// Used by the single-word matcher to skip noun-uses of polysemous words like
// "call" / "service" / "charge" / "book" / "fee" / "repair".
//
// Example: "do i have to pay for a service call"
//   inputTokens = [do, i, have, to, pay, for, a, service, call]
//   "call" at i=8 — preceded by "service"(i=7) preceded by "a"(i=6, determiner)
//   → "call" treated as noun, skipped → "pay"(i=4) wins as actionCore. ✓
//
// We look back up to 2 tokens because adjective-like noun modifiers can sit
// between the determiner and the head noun ("a quick call", "the service fee",
// "my next appointment"). Beyond 2-back is rare and risks false negatives.
const DETERMINERS = new Set([
  'a', 'an', 'the',
  'my', 'your', 'our', 'his', 'her', 'their',
  'this', 'that', 'these', 'those',
  'some', 'any', 'no',
]);

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
 * Build trade index from a single source:
 *   - Global vocabularies (via container.tradeVocabularyKey → GlobalShare)
 *     Maps terms to container level (sectionIdx = -1, no section targeting).
 *
 * Section-level tradeTerms[] was removed — phrases+anchors handle section pick,
 * so section-level trade routing was redundant with per-phrase anchor routing.
 *
 * @param {string} companyId
 * @returns {Promise<Object>}
 */
async function _buildTradeIndex(companyId) {
  const index = {};

  try {
    const containers = await CompanyKnowledgeContainer
      .find({ companyId, isActive: true })
      .select('_id title tradeVocabularyKey')
      .sort({ priority: 1, createdAt: 1 })
      .lean();

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

  // Tokenize once for single-word leftmost-position matching.
  // Multi-word patterns still use substring matching (idiomatic phrases).
  const inputTokens = lower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

  // Match against each canonical field
  //
  // TWO-PASS MATCHING (April 2026):
  //   PASS A — multi-word patterns (substring, longest-first). Idiomatic
  //            phrases like "do i have to" / "right now" / "i need to" are
  //            handled exactly as before.
  //   PASS B — single-word patterns (leftmost-token wins, with determiner
  //            gate). Walks input tokens left-to-right; first token whose
  //            stem matches any pattern wins, UNLESS the previous 1-2 tokens
  //            include a determiner (in which case the token is being used
  //            as a noun, not a verb, and we skip it).
  //
  //   Why leftmost beats longest-first for singles: in English (S-V-O),
  //   verbs precede their objects. Longest-first would pick "call" (4ch)
  //   over "pay" (3ch) in "do i have to pay for a service call" — but
  //   "pay" is the actual action and "call" is a noun. Leftmost + the
  //   determiner gate fix this without breaking existing matches.
  for (const field of CUE_FIELDS) {
    const token = field.toLowerCase();
    const patterns = byToken[token];
    if (!patterns) continue;

    let matched = null;

    // ── PASS A: multi-word patterns (substring, longest-first) ──────────
    for (const pat of patterns) {
      if (!pat.includes(' ')) continue;
      if (lower.includes(pat)) { matched = pat; break; }
    }

    // ── PASS B: single-word patterns (leftmost token wins + det gate) ──
    if (!matched) {
      // Build stem → canonical pattern map for this field's single-words.
      // Stemmed pattern stored too so input-stems hit the canonical form.
      const singleStemMap = new Map();
      for (const pat of patterns) {
        if (pat.includes(' ')) continue;
        singleStemMap.set(pat, pat);            // exact form
        singleStemMap.set(_stem(pat), pat);     // stemmed form → canonical
      }
      if (singleStemMap.size > 0) {
        for (let i = 0; i < inputTokens.length; i++) {
          const tok = inputTokens[i];
          // Determiner gate: if a determiner sits 1 OR 2 tokens back, this
          // token is part of a noun phrase ("a service CALL", "the FEE",
          // "my next APPOINTMENT"). Skip — it's a noun in this context.
          if (i > 0 && DETERMINERS.has(inputTokens[i - 1])) continue;
          if (i > 1 && DETERMINERS.has(inputTokens[i - 2])) continue;
          // Resolve token → canonical pattern (exact or stemmed)
          const canonical = singleStemMap.get(tok) || singleStemMap.get(_stem(tok));
          if (canonical) { matched = canonical; break; }
        }
      }
    }

    if (matched) frame[field] = matched;
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

  // ── topicWords rescue (Apr 22, 2026) ──────────────────────────────────
  // Narrative/colloquial callers ("we keep having problems here with the
  // AC units, just simply not cooling") defeat noun-phrase extractors —
  // upstream UAP reports topicWords=[] even when the caller clearly named
  // a topic. tradeMatches is a reliable fallback signal because it already
  // parsed the same utterance through the company trade vocabulary.
  //
  // Promote up to 5 unique trade terms (shortest-first → most specific
  // topical noun wins over "ac" beating "ac maintenance plan") onto the
  // cueFrame.topicWords field. Downstream (KCDiscoveryRunner merge at the
  // qaLog write sites) will pick this up automatically — no consumer
  // change needed because the existing code uses `cueFrame.topicWords || []`.
  frame.topicWords = [];
  if (frame.tradeMatches.length > 0) {
    const seen = new Set();
    const terms = frame.tradeMatches
      .map(tm => (tm && tm.term ? String(tm.term).toLowerCase().trim() : ''))
      .filter(Boolean)
      .sort((a, b) => a.length - b.length); // shortest-first = most general noun
    for (const t of terms) {
      if (seen.has(t)) continue;
      seen.add(t);
      frame.topicWords.push(t);
      if (frame.topicWords.length >= 5) break;
    }
  }

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
