'use strict';

/**
 * ============================================================================
 * SMART INTERCEPTOR SERVICE
 * ============================================================================
 *
 * Custom rule evaluator for company-configured interceptors.
 * Loads CompanyInterceptor documents from Redis (cached 900s), evaluates the
 * caller's input against rules in priority order, and returns a scored
 * candidate for the ArbitrationEngine.
 *
 * ARCHITECTURE ROLE:
 *   SmartInterceptorService is GATE 0 in the call pipeline — it fires before
 *   KC scoring and before LLM inference. When a rule matches, the ArbitrationEngine
 *   receives a CUSTOM_RULE candidate with a high confidence score.
 *
 *   Call pipeline position:
 *     [SmartInterceptorService] → [ArbitrationEngine] → [KCRunner] → [LLM]
 *
 * MATCH MODES (mirrors CompanyInterceptor.matchMode schema):
 *   ANY    — At least one keyword found in normalized input.
 *            Multi-word = substring, single-word = whole-word boundary.
 *   ALL    — Every keyword must be found in normalized input.
 *   PHRASE — The exact joined keyword string must appear as a substring.
 *            Strictest mode — use for compound phrases like "speak to a human".
 *
 * SCORING:
 *   Base scores:
 *     Exact phrase match        → 0.90
 *     Multi-keyword hit (ALL)   → 0.75
 *     Single-keyword ANY hit    → 0.60
 *   Multiplied by min(matchCount, 3) / 3 scaled bonus (capped at 0.95).
 *   A rule with 3 matching keywords scores higher than one with 1.
 *
 * REDIS CACHE:
 *   Key:  interceptors:{companyId}   TTL: 900s (15 min)
 *   Miss: falls through to MongoDB (CompanyInterceptor.findActiveForCompany)
 *   Down: if Redis unavailable, reads MongoDB directly on every call
 *   Invalidated: on every CREATE / UPDATE / DELETE via invalidateCache()
 *
 * STATS TRACKING:
 *   recordMatch(interceptorId) — fire-and-forget $inc on stats.matchCount.
 *   Never called at cache load time — only when a rule actually fires.
 *
 * MULTI-TENANT SAFETY:
 *   All cache keys namespaced by companyId.
 *   MongoDB queries always include { companyId, enabled: true }.
 *   No cross-tenant data is ever loaded or returned.
 *
 * PUBLIC API:
 *   loadForCompany(companyId)                    → Array<CompanyInterceptor>
 *   evaluate(input, companyId)                   → { matched, rule, score }
 *   invalidateCache(companyId)                   → void (fire-and-forget)
 *   recordMatch(interceptorId)                   → void (fire-and-forget)
 *   test(input, keywords, matchMode)             → { matched, matchedKeyword, normalizedInput }
 *
 * ============================================================================
 */

const CompanyInterceptor       = require('../../../models/CompanyInterceptor');  // 3 levels up: arbitration/ → engine/ → services/ → root
const { getSharedRedisClient } = require('../../redisClientFactory');             // 2 levels up: arbitration/ → engine/ → services/redisClientFactory
const logger                   = require('../../../utils/logger');

// ── Constants ─────────────────────────────────────────────────────────────────

const CACHE_TTL_SECONDS = 900;  // 15 minutes

/**
 * SCORE_EXACT_PHRASE — Score for a PHRASE-mode match (highest confidence).
 * Caller said exactly what the company configured.
 */
const SCORE_EXACT_PHRASE = 0.90;

/**
 * SCORE_MULTI_KEYWORD — Score for an ALL-mode match (all keywords present).
 * High confidence — compound intent confirmed.
 */
const SCORE_MULTI_KEYWORD = 0.75;

/**
 * SCORE_SINGLE_KEYWORD — Score for a single-keyword ANY-mode match.
 * Moderate confidence — single signal.
 */
const SCORE_SINGLE_KEYWORD = 0.60;

/** Hard cap on final score — never returns 1.0 (reserved for booking-only signals). */
const SCORE_MAX = 0.95;

// ── Redis Key Helper ──────────────────────────────────────────────────────────

/**
 * _cacheKey — Build the Redis cache key for a company's interceptor list.
 * @param {string} companyId
 * @returns {string}
 */
function _cacheKey(companyId) {
  return `interceptors:${companyId}`;
}

// ── Input Normalization ───────────────────────────────────────────────────────

/**
 * _normalize — Lowercase, strip punctuation (preserve apostrophes), collapse whitespace.
 * Must produce the same output as LaneController._normalizeInput —
 * these are kept as separate private functions to avoid a cross-module import.
 * @param {string} str
 * @returns {string}
 */
function _normalize(str) {
  if (!str || typeof str !== 'string') return '';
  return str
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Matching Primitives ───────────────────────────────────────────────────────

/**
 * _matchAnyKeyword — Returns true if at least one keyword is found in normalizedInput.
 *   - Multi-word keyword → substring match
 *   - Single word keyword → whole-word boundary match
 *
 * Also returns the first matching keyword for scoring purposes.
 *
 * @param {string}   normalizedInput
 * @param {string[]} keywords — Already-normalized keyword list
 * @returns {{ matched: boolean, matchedKeyword: string|null, matchCount: number }}
 */
function _matchAnyKeyword(normalizedInput, keywords) {
  if (!normalizedInput || !keywords?.length) return { matched: false, matchedKeyword: null, matchCount: 0 };

  const words      = normalizedInput.split(/\s+/);
  let matchCount   = 0;
  let firstMatched = null;

  for (const kw of keywords) {
    const normKw = _normalize(kw);
    if (!normKw) continue;

    let hit;
    if (normKw.includes(' ')) {
      hit = normalizedInput.includes(normKw);
    } else {
      hit = words.includes(normKw);
    }

    if (hit) {
      matchCount++;
      if (!firstMatched) firstMatched = normKw;
    }
  }

  return { matched: matchCount > 0, matchedKeyword: firstMatched, matchCount };
}

/**
 * _matchAllKeywords — Returns true only if EVERY keyword is found in normalizedInput.
 * @param {string}   normalizedInput
 * @param {string[]} keywords
 * @returns {{ matched: boolean, matchedKeyword: string|null, matchCount: number }}
 */
function _matchAllKeywords(normalizedInput, keywords) {
  if (!normalizedInput || !keywords?.length) return { matched: false, matchedKeyword: null, matchCount: 0 };

  const words = normalizedInput.split(/\s+/);
  let count   = 0;

  for (const kw of keywords) {
    const normKw = _normalize(kw);
    if (!normKw) continue;

    let hit;
    if (normKw.includes(' ')) {
      hit = normalizedInput.includes(normKw);
    } else {
      hit = words.includes(normKw);
    }

    if (hit) count++;
  }

  const matched = count === keywords.filter(k => _normalize(k)).length;
  return { matched, matchedKeyword: matched ? _normalize(keywords[0]) : null, matchCount: matched ? count : 0 };
}

/**
 * _matchPhrase — Returns true if the full joined phrase (all keywords joined by space)
 * appears as an exact substring in normalizedInput.
 *
 * This is the strictest mode — designed for caller phrases like "speak to a human"
 * where every word must appear in exact order.
 *
 * @param {string}   normalizedInput
 * @param {string[]} keywords
 * @returns {{ matched: boolean, matchedKeyword: string|null, matchCount: number }}
 */
function _matchPhrase(normalizedInput, keywords) {
  if (!normalizedInput || !keywords?.length) return { matched: false, matchedKeyword: null, matchCount: 0 };

  const phrase  = keywords.map(k => _normalize(k)).filter(Boolean).join(' ');
  if (!phrase)  return { matched: false, matchedKeyword: null, matchCount: 0 };

  const matched = normalizedInput.includes(phrase);
  return { matched, matchedKeyword: matched ? phrase : null, matchCount: matched ? 1 : 0 };
}

// ── Score Calculator ──────────────────────────────────────────────────────────

/**
 * _calculateScore — Compute the final confidence score for a match.
 *
 * Base score selection:
 *   PHRASE mode              → SCORE_EXACT_PHRASE  (0.90)
 *   matchCount > 1           → SCORE_MULTI_KEYWORD (0.75)
 *   matchCount = 1           → SCORE_SINGLE_KEYWORD (0.60)
 *
 * Multiplier:
 *   min(matchCount, 3) keyword bonus scaled over range [0, 1].
 *   matchCount=1 → ×1.0, matchCount=2 → ×1.1, matchCount=3+ → ×1.2
 *   Result is capped at SCORE_MAX (0.95).
 *
 * @param {string} matchMode  — 'ANY' | 'ALL' | 'PHRASE'
 * @param {number} matchCount — Number of keywords that matched
 * @returns {number}
 */
function _calculateScore(matchMode, matchCount) {
  let base;
  if (matchMode === 'PHRASE') {
    base = SCORE_EXACT_PHRASE;
  } else if (matchCount > 1) {
    base = SCORE_MULTI_KEYWORD;
  } else {
    base = SCORE_SINGLE_KEYWORD;
  }

  const multiplier = 1.0 + (Math.min(matchCount, 3) - 1) * 0.1;
  return Math.min(SCORE_MAX, base * multiplier);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * loadForCompany — Load all enabled interceptor rules for a company.
 *
 * Cache strategy: Redis hit → return parsed JSON.
 * Cache miss (or Redis down) → query MongoDB → backfill Redis (fire-and-forget).
 * MongoDB failure → return [] (graceful degrade, call continues without interceptors).
 *
 * @param {string} companyId
 * @returns {Promise<Array>} Array of CompanyInterceptor lean objects
 */
async function loadForCompany(companyId) {
  if (!companyId) return [];

  // ── Try Redis cache ────────────────────────────────────────────────────────
  let redis = null;
  try {
    redis = await getSharedRedisClient();
    if (redis) {
      const cached = await redis.get(_cacheKey(companyId));
      if (cached) return JSON.parse(cached);
    }
  } catch (_e) {
    // Cache miss — fall through to MongoDB
  }

  // ── Fetch from MongoDB ─────────────────────────────────────────────────────
  try {
    const rules = await CompanyInterceptor.findActiveForCompany(companyId);

    // Backfill Redis asynchronously — never block the return
    if (redis) {
      redis.setEx(_cacheKey(companyId), CACHE_TTL_SECONDS, JSON.stringify(rules)).catch(() => {});
    }

    return rules;
  } catch (err) {
    logger.warn('[SmartInterceptorService] MongoDB load failed — no interceptors this turn', {
      companyId,
      error: err.message
    });
    return [];
  }
}

/**
 * evaluate — Run a caller input string through all company interceptors in
 * priority order. Returns the first matching rule with its confidence score.
 *
 * Priority order: lower priority number fires first (same as MongoDB sort).
 * Short-circuits on first match — only the highest-priority match fires.
 *
 * @param {string} input      — Raw caller utterance
 * @param {string} companyId
 * @returns {Promise<{ matched: boolean, rule: Object|null, score: number }>}
 */
async function evaluate(input, companyId) {
  if (!input || !companyId) {
    return { matched: false, rule: null, score: 0 };
  }

  const rules          = await loadForCompany(companyId);
  const normalizedInput = _normalize(input);

  for (const rule of rules) {
    if (!rule.enabled) continue;

    const keywords  = Array.isArray(rule.keywords) ? rule.keywords : [];
    const matchMode = rule.matchMode || 'ANY';

    const result = test(input, keywords, matchMode);

    if (result.matched) {
      const score = _calculateScore(matchMode, result.matchCount ?? 1);

      logger.debug('[SmartInterceptorService] Interceptor matched', {
        companyId,
        ruleId:           rule._id,
        ruleName:         rule.name,
        matchMode,
        matchedKeyword:   result.matchedKeyword,
        score,
        normalizedInput:  result.normalizedInput
      });

      // Fire-and-forget stats increment
      recordMatch(rule._id);

      return { matched: true, rule, score };
    }
  }

  return { matched: false, rule: null, score: 0 };
}

/**
 * invalidateCache — Delete the Redis cache for a company's interceptor list.
 * Called on every CREATE / UPDATE / DELETE / enable-toggle from the admin API.
 * Fire-and-forget — never awaited by callers.
 *
 * @param {string} companyId
 * @returns {void}
 */
function invalidateCache(companyId) {
  if (!companyId) return;
  (async () => {
    try {
      const redis = await getSharedRedisClient();
      if (redis) await redis.del(_cacheKey(companyId));
    } catch (_e) {
      // Silence — next read will simply re-fetch from MongoDB
    }
  })();
}

/**
 * recordMatch — Increment stats.matchCount and update stats.lastMatchedAt
 * on the matching CompanyInterceptor document.
 * Fire-and-forget — never awaited, never throws outward.
 *
 * @param {string|Object} interceptorId — MongoDB _id of the CompanyInterceptor
 * @returns {void}
 */
function recordMatch(interceptorId) {
  if (!interceptorId) return;
  (async () => {
    try {
      await CompanyInterceptor.updateOne(
        { _id: interceptorId },
        {
          $inc: { 'stats.matchCount': 1 },
          $set: { 'stats.lastMatchedAt': new Date() }
        }
      );
    } catch (err) {
      logger.warn('[SmartInterceptorService] recordMatch failed (non-fatal)', {
        interceptorId: interceptorId.toString(),
        error: err.message
      });
    }
  })();
}

/**
 * test — Synchronous keyword test utility. Used by:
 *   - evaluate() internally
 *   - Admin "test" endpoint (POST /:companyId/interceptors/test) for dry-run
 *
 * @param {string}   input     — Raw caller utterance
 * @param {string[]} keywords  — Array of keyword strings
 * @param {string}   matchMode — 'ANY' | 'ALL' | 'PHRASE' (default 'ANY')
 * @returns {{ matched: boolean, matchedKeyword: string|null, normalizedInput: string, matchCount: number }}
 */
function test(input, keywords, matchMode = 'ANY') {
  const normalizedInput = _normalize(input);
  const normKeywords    = Array.isArray(keywords)
    ? keywords.map(k => _normalize(k)).filter(Boolean)
    : [];

  let result;
  switch (matchMode) {
    case 'ALL':
      result = _matchAllKeywords(normalizedInput, normKeywords);
      break;
    case 'PHRASE':
      result = _matchPhrase(normalizedInput, normKeywords);
      break;
    case 'ANY':
    default:
      result = _matchAnyKeyword(normalizedInput, normKeywords);
      break;
  }

  return {
    matched:        result.matched,
    matchedKeyword: result.matchedKeyword,
    matchCount:     result.matchCount,
    normalizedInput
  };
}

// ── Exports ───────────────────────────────────────────────────────────────────

module.exports = {
  loadForCompany,
  evaluate,
  invalidateCache,
  recordMatch,
  test
};
