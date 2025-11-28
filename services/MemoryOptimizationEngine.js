// services/MemoryOptimizationEngine.js
//
// Brain-5: decides if we need LLM-R / LLM-C
// or if we can run on pure brains + memory + cache.

const ResponseCache = require("../models/memory/ResponseCache");
const logger = require('../utils/logger');

/**
 * Normalize user text into a stable string for hashing / caching.
 * Keep it simple for now: lowercase, trim, collapse spaces.
 */
function normalizeUtterance(text) {
  if (!text) return "";
  return text
    .toString()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Decide whether we should call any LLM at all for routing / phrasing.
 *
 * Sets:
 *  - context.forcedScenarioId
 *  - context.cachedResponse
 *  - context.userInputNormalized
 *
 * Returns:
 *  { useLLM: boolean, reason: string }
 */
async function shouldUseLLM(userText, context) {
  const { companyID, callState, memory } = context;
  const phoneNumber = callState?.from || null;

  const normalized = normalizeUtterance(userText);
  context.userInputNormalized = normalized;

  const tentativeIntent = context.tentativeIntent || null;
  const triageCategory = context.triageCategory || null;

  logger.debug('[OPTIMIZATION ENGINE] 🔍 Evaluating LLM necessity', {
    companyId: companyID,
    phoneNumber: phoneNumber ? phoneNumber.substring(0, 8) + '***' : 'N/A',
    tentativeIntent,
    triageCategory,
    normalizedLength: normalized.length
  });

  // Default decision if we lack basic info
  if (!companyID || !phoneNumber) {
    logger.debug('[OPTIMIZATION ENGINE] Missing context, requiring LLM');
    return { useLLM: true, reason: "MISSING_CONTEXT" };
  }

  const callerHistory = (memory && memory.callerHistory) || [];
  const resolutionPaths = (memory && memory.resolutionPaths) || [];

  // 1) Known caller + known intent with multiple past successes
  if (tentativeIntent) {
    const historyForIntent = callerHistory.find(
      (h) => h.intent === tentativeIntent
    );

    if (historyForIntent && historyForIntent.successCount >= 3) {
      logger.info('[OPTIMIZATION ENGINE] ✅ Known caller with proven intent, skipping LLM', {
        companyId: companyID,
        intent: tentativeIntent,
        successCount: historyForIntent.successCount
      });
      return {
        useLLM: false,
        reason: "KNOWN_CALLER_KNOWN_INTENT"
      };
    }
  }

  // 2) Proven resolution path for this intent + category
  if (tentativeIntent && triageCategory) {
    const provenPath = resolutionPaths.find(
      (p) =>
        p.intent === tentativeIntent &&
        p.triageCategory === triageCategory &&
        p.successRate >= 0.85 &&
        p.sampleSize >= 5
    );

    if (provenPath) {
      context.forcedScenarioId = provenPath.scenarioId;
      logger.info('[OPTIMIZATION ENGINE] ✅ Proven resolution path found, skipping LLM', {
        companyId: companyID,
        intent: tentativeIntent,
        category: triageCategory,
        scenarioId: provenPath.scenarioId,
        successRate: provenPath.successRate,
        sampleSize: provenPath.sampleSize
      });
      return {
        useLLM: false,
        reason: "PROVEN_RESOLUTION_PATH"
      };
    }
  }

  // 3) Cache hit – we've seen this exact utterance text before
  if (normalized) {
    const cached = await ResponseCache.findSimilar(companyID, normalized);
    if (cached && cached.responseText) {
      context.cachedResponse = cached;
      logger.info('[OPTIMIZATION ENGINE] ✅ Cache hit, skipping LLM', {
        companyId: companyID,
        normalizedHash: normalized.substring(0, 30) + '...',
        hitCount: cached.hitCount,
        lastUsed: cached.lastUsedAt
      });
      return {
        useLLM: false,
        reason: "CACHE_HIT"
      };
    }
  }

  // 4) Novel situation → pay the teacher (LLM) to learn
  logger.info('[OPTIMIZATION ENGINE] 💰 Novel situation detected, requiring LLM', {
    companyId: companyID,
    reason: 'No known pattern, cache miss, or proven path found'
  });
  return {
    useLLM: true,
    reason: "NOVEL_SITUATION"
  };
}

module.exports = {
  shouldUseLLM,
  normalizeUtterance
};

