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

let _tradeIndexCache = {};  // { companyId: { builtAt, index } }
const TRADE_IDX_MEM_TTL_MS  = 5 * 60 * 1000;  // 5 minutes in-memory

// ── Canonical cue field names (matches GlobalShare token values) ───────────
const CUE_FIELDS = [
  'requestCue', 'permissionCue', 'infoCue', 'directiveCue',
  'actionCore', 'urgencyCore', 'modifierCore',
];

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
    return cached.index;
  }

  // ── Redis warm path ─────────────────────────────────────────────────────
  try {
    const redis = await getSharedRedisClient();
    if (redis) {
      const raw = await redis.get(`${TRADE_IDX_REDIS_PREFIX}:${companyId}`);
      if (raw) {
        const index = JSON.parse(raw);
        _tradeIndexCache[companyId] = { builtAt: Date.now(), index };
        return index;
      }
    }
  } catch (_) { /* fall through to build */ }

  // ── Cold path — build from MongoDB ──────────────────────────────────────
  const index = await _buildTradeIndex(companyId);

  // Write to memory + Redis
  _tradeIndexCache[companyId] = { builtAt: Date.now(), index };
  try {
    const redis = await getSharedRedisClient();
    if (redis) {
      await redis.set(
        `${TRADE_IDX_REDIS_PREFIX}:${companyId}`,
        JSON.stringify(index),
        { EX: TRADE_IDX_REDIS_TTL }
      );
    }
  } catch (_) { /* non-fatal */ }

  return index;
}

/**
 * Build trade index from MongoDB.
 * Queries all active KC containers, iterates sections' tradeTerms[].
 *
 * @param {string} companyId
 * @returns {Promise<Object>}
 */
async function _buildTradeIndex(companyId) {
  const index = {};

  try {
    const containers = await CompanyKnowledgeContainer
      .find({ companyId, isActive: true })
      .select('_id title sections.label sections.isActive sections.tradeTerms sections.order')
      .sort({ priority: 1, createdAt: 1 })
      .lean();

    for (const c of containers) {
      const cId = String(c._id);
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

    logger.debug('[CueExtractor] Trade index built', {
      companyId,
      termCount: Object.keys(index).length,
    });
  } catch (err) {
    logger.warn('[CueExtractor] Trade index build failed', {
      companyId, error: err.message,
    });
  }

  return index;
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

  // Match against each canonical field
  for (const field of CUE_FIELDS) {
    const token = field.toLowerCase();
    const patterns = byToken[token];
    if (!patterns) continue;

    for (const pat of patterns) {
      if (lower.includes(pat)) {
        frame[field] = pat;
        break;  // first (longest) match wins
      }
    }
  }

  // ── FIELD 8: Trade terms ───────────────────────────────────────────────
  const tradeIndex = await _getTradeIndex(companyId);
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
};
