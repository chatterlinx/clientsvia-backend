// services/TriageService.js
// V22 Triage Service - Runtime matcher for quick rules (Brain-1 Tier-0)

const TriageCard = require('../models/TriageCard');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// CACHE CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_TTL_MS = 60 * 1000; // 60 seconds per company snapshot

// Simple in-process cache: { companyId: { expiresAt, cards, quickRules } }
const triageCache = new Map();

// ═══════════════════════════════════════════════════════════════════════════
// TEXT NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Normalize caller text for keyword matching.
 * Lowercase, remove punctuation, collapse whitespace.
 */
function normalizeText(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ═══════════════════════════════════════════════════════════════════════════
// QUICK RULES BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Precompute quick rules for fast evaluation.
 * Returns sorted array (highest priority first).
 */
function buildQuickRules(cards) {
  return cards
    .filter((c) => c.isActive && c.quickRuleConfig && c.quickRuleConfig.action)
    .map((card) => {
      const cfg = card.quickRuleConfig || {};
      const must = (cfg.keywordsMustHave || []).map((k) => normalizeText(k)).filter(Boolean);
      const exclude = (cfg.keywordsExclude || []).map((k) => normalizeText(k)).filter(Boolean);
      return {
        cardId: card._id.toString(),
        triageLabel: card.triageLabel,
        displayName: card.displayName,
        intent: card.intent,
        triageCategory: card.triageCategory,
        serviceType: card.serviceType,
        action: cfg.action,
        qnaCardRef: cfg.qnaCardRef || null,
        explanation: cfg.explanation || '',
        priority: card.priority || 0,
        must,
        exclude,
        linkedScenarioId: card.linkedScenario?.scenarioId || null,
        linkedScenarioName: card.linkedScenario?.scenarioName || null
      };
    })
    .sort((a, b) => b.priority - a.priority); // high priority first
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load active triage cards for a company (and optional trade) from cache or DB.
 */
async function getCompanyTriageConfig(companyId, trade) {
  if (!companyId) return { cards: [], quickRules: [] };

  const key = String(companyId) + (trade ? `:${trade}` : '');
  const now = Date.now();
  const cached = triageCache.get(key);

  if (cached && cached.expiresAt > now) {
    return { cards: cached.cards, quickRules: cached.quickRules };
  }

  const query = { companyId, isActive: true };
  if (trade) query.trade = trade;

  const cards = await TriageCard.find(query).lean().exec();
  const quickRules = buildQuickRules(cards);

  triageCache.set(key, {
    cards,
    quickRules,
    expiresAt: now + CACHE_TTL_MS
  });

  logger.info('[TRIAGE] Cache rebuilt', {
    companyId: String(companyId),
    trade: trade || null,
    cardCount: cards.length,
    quickRuleCount: quickRules.length
  });

  return { cards, quickRules };
}

/**
 * Invalidate cache for a company (call after card create/update/delete).
 */
function invalidateCache(companyId, trade) {
  if (!companyId) return;
  
  const key1 = String(companyId);
  const key2 = trade ? `${companyId}:${trade}` : null;
  
  triageCache.delete(key1);
  if (key2) triageCache.delete(key2);
  
  logger.info('[TRIAGE] Cache invalidated', { companyId: String(companyId), trade });
}

// ═══════════════════════════════════════════════════════════════════════════
// MATCH HISTORY RECORDING
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Best-effort match logging into matchHistory.
 * Non-blocking; exceptions are swallowed.
 */
async function recordMatchSample(triageCardId, normalizedText) {
  if (!triageCardId) return;
  try {
    await TriageCard.updateOne(
      { _id: triageCardId },
      {
        $inc: {
          'matchHistory.totalMatches': 1
        },
        $set: {
          'matchHistory.lastMatchedAt': new Date()
        },
        $push: {
          'matchHistory.recentSamplePhrases': {
            $each: [
              {
                text: normalizedText,
                matchedAt: new Date(),
                outcome: { finalAction: null, successFlag: null }
              }
            ],
            $slice: -25 // Keep last 25 samples
          }
        }
      }
    ).exec();
  } catch (err) {
    logger.error('[TRIAGE] Failed to record match sample', {
      triageCardId,
      error: err.message
    });
  }
}

/**
 * Record success outcome for a previous match.
 * Call this from PostCallLearningService when we know the call succeeded.
 */
async function recordMatchSuccess(triageCardId) {
  if (!triageCardId) return;
  try {
    await TriageCard.updateOne(
      { _id: triageCardId },
      {
        $inc: {
          'matchHistory.totalSuccesses': 1
        },
        $set: {
          'matchHistory.lastSuccessAt': new Date()
        }
      }
    ).exec();
    
    // Recompute success rate
    const card = await TriageCard.findById(triageCardId);
    if (card) {
      card.recomputeSuccessRate();
      await card.save();
    }
  } catch (err) {
    logger.error('[TRIAGE] Failed to record match success', {
      triageCardId,
      error: err.message
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN MATCHING FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Apply quick triage rules for the given input.
 * 
 * @param {string} userText - Raw user input
 * @param {string} companyId - Company ObjectId
 * @param {string} [trade] - Optional trade filter (e.g., "HVAC")
 * 
 * @returns {Object} Result object:
 *   { matched: false }  OR
 *   {
 *     matched: true,
 *     source: "QUICK_RULE",
 *     triageCardId,
 *     triageLabel,
 *     displayName,
 *     intent,
 *     triageCategory,
 *     serviceType,
 *     action,
 *     qnaCardRef,
 *     explanation,
 *     linkedScenarioId,
 *     linkedScenarioName,
 *     confidence: 1.0
 *   }
 */
async function applyQuickTriageRules(userText, companyId, trade) {
  const normalized = normalizeText(userText);
  if (!normalized) {
    return { matched: false };
  }

  const { quickRules } = await getCompanyTriageConfig(companyId, trade);
  if (!quickRules.length) {
    logger.debug('[TRIAGE] No quick rules configured', { companyId: String(companyId), trade });
    return { matched: false };
  }

  for (const rule of quickRules) {
    let ok = true;

    // Check all "must have" keywords are present
    if (rule.must && rule.must.length) {
      for (const phrase of rule.must) {
        if (!phrase) continue;
        if (!normalized.includes(phrase)) {
          ok = false;
          break;
        }
      }
    }

    if (!ok) continue;

    // Check no "exclude" keywords are present
    if (rule.exclude && rule.exclude.length) {
      for (const phrase of rule.exclude) {
        if (!phrase) continue;
        if (normalized.includes(phrase)) {
          ok = false;
          break;
        }
      }
    }

    if (!ok) continue;

    // First hit wins (already priority-sorted)
    recordMatchSample(rule.cardId, normalized).catch(() => {});

    logger.info('[TRIAGE] ✅ Quick rule matched', {
      companyId: String(companyId),
      trade: trade || null,
      triageCardId: rule.cardId,
      triageLabel: rule.triageLabel,
      action: rule.action,
      userTextPreview: normalized.substring(0, 50)
    });

    return {
      matched: true,
      source: 'QUICK_RULE',
      triageCardId: rule.cardId,
      triageLabel: rule.triageLabel,
      displayName: rule.displayName,
      intent: rule.intent,
      triageCategory: rule.triageCategory,
      serviceType: rule.serviceType,
      action: rule.action,
      qnaCardRef: rule.qnaCardRef || null,
      explanation: rule.explanation || '',
      linkedScenarioId: rule.linkedScenarioId,
      linkedScenarioName: rule.linkedScenarioName,
      confidence: 1.0
    };
  }

  logger.debug('[TRIAGE] No quick rule matched', {
    companyId: String(companyId),
    trade: trade || null,
    rulesChecked: quickRules.length
  });

  return { matched: false };
}

// ═══════════════════════════════════════════════════════════════════════════
// CARD RETRIEVAL HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get full triage card by ID (for loading playbooks).
 */
async function getTriageCardById(triageCardId) {
  if (!triageCardId) return null;
  return TriageCard.findById(triageCardId).lean().exec();
}

/**
 * Get all active triage cards for a company.
 */
async function getActiveCardsForCompany(companyId, trade) {
  const { cards } = await getCompanyTriageConfig(companyId, trade);
  return cards;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  applyQuickTriageRules,
  normalizeText,
  getCompanyTriageConfig,
  getTriageCardById,
  getActiveCardsForCompany,
  invalidateCache,
  recordMatchSuccess
};

