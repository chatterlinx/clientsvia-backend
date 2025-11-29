// services/TriageService.js
// V22 Triage Service - Runtime matcher for quick rules (Brain-1 Tier-0)

const TriageCard = require('../models/TriageCard');
const Company = require('../models/v2Company');
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
  let normalized = String(text)
    .toLowerCase()
    .replace(/[\r\n]+/g, ' ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  
  // V22: Normalize common HVAC variations for consistent matching
  // This allows cards to use ONE keyword form and match all variations
  normalized = normalized
    // "tune up" / "tune-up" → "tuneup"
    .replace(/tune\s*up/g, 'tuneup')
    // "air conditioning" → "ac"
    .replace(/air\s*conditioning/g, 'ac')
    // "a\/c" or "a c" → "ac"
    .replace(/a\s*c\b/g, 'ac')
    // "not cooling" variations
    .replace(/no\s*cool/g, 'not cooling')
    .replace(/wont\s*cool/g, 'not cooling')
    .replace(/isnt\s*cooling/g, 'not cooling')
    // "not working" variations
    .replace(/doesnt\s*work/g, 'not working')
    .replace(/wont\s*work/g, 'not working')
    .replace(/isnt\s*working/g, 'not working')
    // Clean up any double spaces introduced
    .replace(/\s+/g, ' ')
    .trim();
  
  return normalized;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUICK RULES BUILDER
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Precompute quick rules from TriageCards.
 * Returns sorted array (highest priority first).
 */
function buildQuickRulesFromCards(cards) {
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
        linkedScenarioName: card.linkedScenario?.scenarioName || null,
        source: 'TRIAGE_CARD'
      };
    });
}

/**
 * Precompute quick rules from Company manual triage rules.
 * These are simpler inline rules stored in CheatSheet.
 */
function buildQuickRulesFromManual(manualRules) {
  if (!Array.isArray(manualRules)) return [];
  
  return manualRules
    .filter((r) => r.enabled !== false && r.action && r.keywords && r.keywords.length > 0)
    .map((rule, idx) => {
      const must = (rule.keywords || []).map((k) => normalizeText(k)).filter(Boolean);
      const exclude = (rule.excludeKeywords || []).map((k) => normalizeText(k)).filter(Boolean);
      return {
        cardId: `manual-${idx}`,
        triageLabel: `MANUAL_RULE_${idx}`,
        displayName: rule.notes || `Manual Rule ${idx + 1}`,
        intent: rule.intent || '',
        triageCategory: rule.triageCategory || '',
        serviceType: rule.serviceType || 'OTHER',
        action: rule.action,
        qnaCardRef: null,
        explanation: rule.notes || '',
        priority: rule.priority || 50,
        must,
        exclude,
        linkedScenarioId: null,
        linkedScenarioName: null,
        source: 'MANUAL_RULE'
      };
    });
}

/**
 * Merge and sort all quick rules from both sources.
 * Manual rules default to priority 50 (lower than most cards at 100+).
 * Returns sorted array (highest priority first).
 */
function buildQuickRules(cards, manualRules = []) {
  const cardRules = buildQuickRulesFromCards(cards);
  const manualQuickRules = buildQuickRulesFromManual(manualRules);
  
  // Combine and sort by priority (highest first)
  return [...cardRules, ...manualQuickRules].sort((a, b) => b.priority - a.priority);
}

// ═══════════════════════════════════════════════════════════════════════════
// CACHE MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Load active triage cards + manual rules for a company (and optional trade) from cache or DB.
 * Merges both sources into unified quickRules array.
 */
async function getCompanyTriageConfig(companyId, trade) {
  if (!companyId) {
    logger.warn('[TRIAGE] getCompanyTriageConfig called with no companyId');
    return { cards: [], quickRules: [], manualRules: [] };
  }

  const key = String(companyId) + (trade ? `:${trade}` : '');
  const now = Date.now();
  const cached = triageCache.get(key);

  if (cached && cached.expiresAt > now) {
    logger.info('[TRIAGE] Using cached config', {
      companyId: String(companyId),
      cachedCards: cached.cards?.length || 0,
      cachedRules: cached.quickRules?.length || 0
    });
    return { cards: cached.cards, quickRules: cached.quickRules, manualRules: cached.manualRules };
  }

  // Load TriageCards - ensure companyId is treated as ObjectId
  const mongoose = require('mongoose');
  let companyObjectId;
  try {
    companyObjectId = new mongoose.Types.ObjectId(String(companyId));
  } catch (err) {
    logger.error('[TRIAGE] Invalid companyId format', { companyId: String(companyId), error: err.message });
    return { cards: [], quickRules: [], manualRules: [] };
  }

  const cardQuery = { companyId: companyObjectId, isActive: true };
  if (trade) cardQuery.trade = trade;
  
  logger.info('[TRIAGE] Querying TriageCards', {
    companyId: String(companyId),
    query: JSON.stringify(cardQuery)
  });
  
  const cards = await TriageCard.find(cardQuery).lean().exec();

  // Load Manual Rules from Company.aiAgentSettings.cheatSheet.manualTriageRules
  // (This is where CheatSheetManager UI saves them)
  let manualRules = [];
  try {
    const company = await Company.findById(companyObjectId)
      .select('aiAgentSettings.cheatSheet.manualTriageRules')
      .lean()
      .exec();
    
    if (company?.aiAgentSettings?.cheatSheet?.manualTriageRules) {
      manualRules = company.aiAgentSettings.cheatSheet.manualTriageRules;
      logger.info('[TRIAGE] Loaded manual rules', { count: manualRules.length });
    }
  } catch (err) {
    logger.warn('[TRIAGE] Failed to load manual rules', {
      companyId: String(companyId),
      error: err.message
    });
  }

  // Merge both sources into unified quickRules
  const quickRules = buildQuickRules(cards, manualRules);

  triageCache.set(key, {
    cards,
    manualRules,
    quickRules,
    expiresAt: now + CACHE_TTL_MS
  });

  logger.info('[TRIAGE] Cache rebuilt', {
    companyId: String(companyId),
    trade: trade || null,
    cardCount: cards.length,
    manualRuleCount: manualRules.length,
    quickRuleCount: quickRules.length
  });

  return { cards, quickRules, manualRules };
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
  logger.info('[TRIAGE] applyQuickTriageRules called', {
    companyId: String(companyId),
    trade: trade || null,
    userTextPreview: userText?.substring(0, 50) || null
  });

  const normalized = normalizeText(userText);
  if (!normalized) {
    logger.warn('[TRIAGE] Empty input after normalization', { userText });
    return { matched: false };
  }

  logger.info('[TRIAGE] Normalized input', { normalized: normalized.substring(0, 100) });

  const { quickRules } = await getCompanyTriageConfig(companyId, trade);
  
  logger.info('[TRIAGE] Quick rules loaded', {
    companyId: String(companyId),
    rulesCount: quickRules?.length || 0
  });
  
  if (!quickRules.length) {
    logger.info('[TRIAGE] No quick rules configured - check if cards are seeded and active', { 
      companyId: String(companyId), 
      trade 
    });
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

