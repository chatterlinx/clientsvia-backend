/**
 * ============================================================================
 * TRIGGER BUCKET CLASSIFIER — Company-specific intent bucketing
 * ============================================================================
 *
 * Classifies caller utterances into company-defined buckets to pre-filter
 * trigger evaluation. Uses ScrabEngine-normalized text + expanded tokens.
 *
 * DESIGN:
 * - Deterministic, zero-LLM
 * - Safe fallback: if confidence is low or ambiguous, no filtering
 * - Caches bucket definitions per company (short TTL)
 * ============================================================================
 */

'use strict';

const logger = require('../../../utils/logger');
const TriggerBucket = require('../../../models/TriggerBucket');

const CACHE_TTL_MS = 60 * 1000;
const bucketCache = new Map();   // companyId -> { buckets, timestamp }
const cacheMeta = new Map();     // companyId -> { lastLoadedAt, bucketCount, keywordCount, fromCache }

const DEFAULT_CLASSIFIER_CONFIG = {
  minConfidence: 0.45,
  minMatches: 1,
  minConfidenceGap: 0.12
};

function normalizeText(text) {
  return `${text || ''}`.toLowerCase().trim();
}

function extractWords(text) {
  return normalizeText(text)
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

function buildTokenSet(expandedTokens, originalTokens) {
  const tokens = [...(expandedTokens || []), ...(originalTokens || [])]
    .map(t => `${t || ''}`.toLowerCase().trim())
    .filter(Boolean);
  return new Set(tokens);
}

function normalizeKeywords(list) {
  return (list || [])
    .map(k => `${k || ''}`.toLowerCase().trim())
    .filter(Boolean);
}

async function loadBuckets(companyId, { useCache = true } = {}) {
  if (useCache) {
    const cached = bucketCache.get(companyId);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      cacheMeta.set(companyId, {
        lastLoadedAt: cached.timestamp,
        bucketCount: cached.buckets.length,
        keywordCount: cached.keywordCount,
        fromCache: true
      });
      return cached.buckets;
    }
  }

  const buckets = await TriggerBucket.findByCompanyId(companyId);
  const normalizedBuckets = (buckets || []).map(b => ({
    id: b._id?.toString(),
    key: `${b.key || ''}`.toLowerCase().trim(),
    name: b.name || '',
    keywords: normalizeKeywords(b.keywords || []),
    priority: typeof b.priority === 'number' ? b.priority : 50,
    enabled: b.enabled !== false
  }));

  const keywordCount = normalizedBuckets.reduce((sum, b) => sum + (b.keywords?.length || 0), 0);

  bucketCache.set(companyId, {
    buckets: normalizedBuckets,
    keywordCount,
    timestamp: Date.now()
  });
  cacheMeta.set(companyId, {
    lastLoadedAt: Date.now(),
    bucketCount: normalizedBuckets.length,
    keywordCount,
    fromCache: false
  });

  return normalizedBuckets;
}

function classifyBuckets({ normalizedText, expandedTokens, originalTokens, buckets, config }) {
  const tokenSet = buildTokenSet(expandedTokens, originalTokens);
  const text = normalizeText(normalizedText);

  const candidates = [];

  for (const bucket of buckets) {
    if (!bucket.enabled) continue;
    const keywords = bucket.keywords || [];
    if (keywords.length === 0) continue;

    let matchedWeight = 0;
    let totalWeight = 0;
    const matchedKeywords = [];

    for (const keyword of keywords) {
      const isPhrase = keyword.includes(' ');
      const weight = isPhrase ? 2 : 1;
      totalWeight += weight;

      const match = isPhrase ? text.includes(keyword) : tokenSet.has(keyword);
      if (match) {
        matchedWeight += weight;
        matchedKeywords.push(keyword);
      }
    }

    const score = totalWeight > 0 ? matchedWeight / totalWeight : 0;
    const matchCount = matchedKeywords.length;

    if (matchCount >= config.minMatches && score > 0) {
      candidates.push({
        key: bucket.key,
        name: bucket.name,
        priority: bucket.priority,
        score,
        matchCount,
        matchedKeywords
      });
    }
  }

  candidates.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    return (a.priority || 50) - (b.priority || 50);
  });

  const top = candidates[0] || null;
  const runnerUp = candidates[1] || null;
  const confidenceGap = top && runnerUp ? (top.score - runnerUp.score) : 1;

  return {
    top,
    candidates,
    confidenceGap
  };
}

const TriggerBucketClassifier = {
  async classify({ companyId, normalizedText, expandedTokens = [], originalTokens = [] }, options = {}) {
    const config = { ...DEFAULT_CLASSIFIER_CONFIG, ...(options || {}) };
    const buckets = await loadBuckets(companyId, { useCache: true });

    const enabledBuckets = (buckets || []).filter(b => b.enabled !== false);
    if (enabledBuckets.length === 0) {
      return {
        bucket: null,
        confidence: 0,
        reason: 'NO_BUCKETS',
        candidates: [],
        bucketCount: buckets.length,
        usedConfig: config
      };
    }

    const { top, candidates, confidenceGap } = classifyBuckets({
      normalizedText,
      expandedTokens,
      originalTokens,
      buckets: enabledBuckets,
      config
    });

    if (!top || top.score < config.minConfidence || confidenceGap < config.minConfidenceGap) {
      return {
        bucket: null,
        confidence: top ? top.score : 0,
        reason: top ? 'LOW_CONFIDENCE' : 'NO_MATCH',
        candidates,
        bucketCount: buckets.length,
        usedConfig: config
      };
    }

    return {
      bucket: top.key,
      confidence: top.score,
      matchedKeywords: top.matchedKeywords,
      candidates,
      bucketCount: buckets.length,
      usedConfig: config
    };
  },

  applyToTriggerPool(cards, classifierResult) {
    if (!classifierResult || !classifierResult.bucket) {
      return { filtered: false, filteredCards: cards, totalCards: cards.length, excludedCount: 0 };
    }

    const bucketKey = classifierResult.bucket;
    const filtered = [];
    const excluded = [];

    for (const card of cards || []) {
      const cardBucket = card.bucket || null;
      if (cardBucket === null || cardBucket === bucketKey) {
        filtered.push(card);
      } else {
        excluded.push(card);
      }
    }

    logger.debug('[TriggerBucketClassifier] Pool filtered', {
      bucket: bucketKey,
      before: (cards || []).length,
      after: filtered.length,
      excluded: excluded.length
    });

    return {
      filtered: true,
      filteredCards: filtered,
      totalCards: (cards || []).length,
      excludedCount: excluded.length,
      bucketUsed: bucketKey
    };
  },

  invalidateCache(companyId) {
    if (!companyId) return;
    bucketCache.delete(companyId);
    cacheMeta.delete(companyId);
  },

  getCacheInfo(companyId) {
    return cacheMeta.get(companyId) || null;
  }
};

module.exports = { TriggerBucketClassifier };
