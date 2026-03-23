'use strict';

/**
 * ============================================================================
 * PRICING INTERCEPTOR
 * ============================================================================
 *
 * Deterministic pricing question handler for the 123RP pipeline.
 * Mirrors the PromotionsInterceptor architecture but targets service pricing
 * facts rather than deals/coupons.
 *
 * RUNTIME INTEGRATION POINTS (future wiring in Agent2DiscoveryRunner):
 *   CHECKPOINT C — Pre-booking: detect pricing signals, answer from DB, return
 *   CHECKPOINT D — Mid-booking: pricing questions during BookingLogicEngine flow
 *   ASKING_PRICING bucket — Follow-up Consent Gate interceptor (same as ASKING_SPECIALS)
 *
 * THREE-LAYER MATCHING:
 *   Each CompanyPricingItem has up to three keyword sets.
 *   At runtime, ALL active items are scanned for ALL layers simultaneously.
 *   The best match wins — no stateful layer progression required.
 *   Layers are a UI organisational concept; runtime treats each layer as
 *   an independent keyword set with its own response.
 *
 * ADVISOR CALLBACK:
 *   Items with action='ADVISOR_CALLBACK' return advisorCallbackPrompt and
 *   set requiresAdvisor=true in the result. The caller does NOT receive
 *   a price quote — instead the agent collects contact info for an advisor
 *   to call back. BookingLogicEngine handles collection (bookingType='ADVISOR_CALLBACK').
 *
 * REDIS CACHE:
 *   Key: pricing:{companyId}   TTL: 15 min (900s)
 *   Invalidated on every CREATE / UPDATE / DELETE via invalidateCache()
 *   Graceful degrade: any Redis failure falls through to MongoDB
 *
 * MULTI-TENANT SAFETY:
 *   All cache keys are namespaced by companyId.
 *   MongoDB queries always include { companyId } filter.
 *   No cross-tenant data leakage possible.
 *
 * ============================================================================
 */

const CompanyPricingItem = require('../../../models/CompanyPricingItem');
const logger             = require('../../../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// SIGNAL TABLE — phrases that indicate a pricing question
// ─────────────────────────────────────────────────────────────────────────────

/**
 * PRICING_SIGNALS — catch-all detection phrases.
 * Used by detect() to determine whether input MIGHT be a pricing question.
 * Company-specific keywords (from CompanyPricingItem.keywords) refine the match.
 */
const PRICING_SIGNALS = [
  // Cost / price / fee
  'how much', 'how much is', 'how much for', 'how much does', 'how much will',
  'what does it cost', 'what will it cost', 'what does that cost',
  'what is the cost', 'what is the fee', 'what is the price', 'whats the fee',
  'what are your rates', 'what are the rates', 'what are your prices',
  'what is the charge', 'what do you charge', 'how much do you charge',
  'cost', 'price', 'pricing', 'rate', 'rates', 'fee', 'fees', 'charge',
  // Specific service cost signals
  'service call', 'diagnostic fee', 'service fee', 'visit fee', 'trip charge',
  'call out', 'callout', 'come out', 'send someone',
  'maintenance plan', 'tune up', 'tune-up', 'annual plan',
  'duct cleaning', 'air duct', 'hvac cleaning',
  'emergency fee', 'after hours', 'after-hours', 'weekend rate',
  'install', 'installation cost', 'replacement cost',
  // Credit / waiver
  'credited', 'credit', 'applied to', 'go towards', 'waived', 'waive',
  'diagnostic credit', 'service call credit',
  // Inclusion queries
  'what does it include', 'what is included', 'what comes with',
  'what do you do', 'whats included', "what's included",
  'what does the service include', 'what is covered'
];

// ─────────────────────────────────────────────────────────────────────────────
// CATEGORY DISPLAY LABELS (for runtime response building)
// ─────────────────────────────────────────────────────────────────────────────

const CATEGORY_LABELS = {
  service_call:  'service call',
  commercial:    'commercial service call',
  maintenance:   'maintenance',
  repair:        'repair',
  installation:  'installation',
  duct_cleaning: 'duct cleaning',
  inspection:    'inspection',
  emergency:     'emergency service',
  warranty:      'warranty',
  other:         'service'
};

// ─────────────────────────────────────────────────────────────────────────────
// CACHE HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const CACHE_TTL = 900; // 15 minutes

let _redis = null;
function _getRedis() {
  if (_redis) return _redis;
  try {
    _redis = require('../../../services/redis/redisClient');
  } catch (_e) { /* Redis not available — graceful degrade */ }
  return _redis;
}

function _cacheKey(companyId) {
  return `pricing:${companyId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * detect — Returns true if the input contains at least one pricing signal.
 * Fast synchronous check — used as the gate before any async work.
 *
 * @param {string} input — Raw caller utterance
 * @returns {boolean}
 */
function detect(input) {
  if (!input || typeof input !== 'string') return false;
  const norm = input.toLowerCase().replace(/[^a-z\s]/g, ' ');
  return PRICING_SIGNALS.some(signal => {
    if (signal.includes(' ')) return norm.includes(signal);
    return norm.split(/\s+/).includes(signal);
  });
}

/**
 * getActivePricingItems — Load active items from Redis → MongoDB → [].
 * Writes back to Redis on cache miss (fire-and-forget).
 *
 * @param {string} companyId
 * @returns {Promise<Array>}
 */
async function getActivePricingItems(companyId) {
  if (!companyId) return [];

  const redis = _getRedis();
  const key   = _cacheKey(companyId);

  // ── Try Redis cache first ──────────────────────────────────────────────────
  if (redis) {
    try {
      const cached = await redis.get(key);
      if (cached) return JSON.parse(cached);
    } catch (_e) { /* Cache miss — fall through to MongoDB */ }
  }

  // ── Fetch from MongoDB ─────────────────────────────────────────────────────
  try {
    const items = await CompanyPricingItem.findActiveForCompany(companyId);

    // Backfill cache (non-blocking)
    if (redis) {
      redis.setEx(key, CACHE_TTL, JSON.stringify(items)).catch(() => {});
    }

    return items;
  } catch (err) {
    logger.warn('[PricingInterceptor] MongoDB fetch failed', { companyId, err: err.message });
    return [];
  }
}

/**
 * invalidateCache — Delete the Redis cache for a company's pricing items.
 * Called on every CREATE / UPDATE / DELETE from the admin API routes.
 *
 * @param {string} companyId
 * @returns {Promise<void>}
 */
async function invalidateCache(companyId) {
  if (!companyId) return;
  const redis = _getRedis();
  if (!redis) return;
  try {
    await redis.del(_cacheKey(companyId));
  } catch (_e) { /* Silence — next read will just re-fetch from MongoDB */ }
}

/**
 * matchItem — Find the best matching pricing item and layer for a given input.
 *
 * Scoring:
 *   - Multi-word phrase match beats single-word match
 *   - Longer phrase match beats shorter phrase match
 *   - Layer 1 keywords share the item's primary keywords array
 *   - Layers 2 and 3 each have their own keyword array
 *
 * @param {Array}  items — Active CompanyPricingItem documents
 * @param {string} input — Raw caller utterance (lowercased, cleaned)
 * @returns {{ item: Object, layer: number } | null}
 */
function matchItem(items, input) {
  if (!items?.length || !input) return null;

  const norm = input.toLowerCase().replace(/[^a-z\s]/g, ' ');

  let bestMatch = null;
  let bestScore = 0;

  for (const item of items) {
    // Check each layer independently
    const layers = [
      { layer: 1, keywords: item.keywords        || [] },
      { layer: 2, keywords: item.layer2Keywords   || [] },
      { layer: 3, keywords: item.layer3Keywords   || [] }
    ];

    for (const { layer, keywords } of layers) {
      if (!keywords.length) continue;

      for (const kw of keywords) {
        const kwNorm = kw.toLowerCase().trim();
        if (!kwNorm) continue;

        let matched = false;
        let score   = 0;

        if (kwNorm.includes(' ')) {
          // Multi-word phrase: exact substring match
          matched = norm.includes(kwNorm);
          score   = matched ? kwNorm.length * 2 : 0; // reward longer phrases
        } else {
          // Single word: whole-word match
          matched = norm.split(/\s+/).includes(kwNorm);
          score   = matched ? kwNorm.length : 0;
        }

        if (matched && score > bestScore) {
          bestScore = score;
          bestMatch = { item, layer };
        }
      }
    }
  }

  return bestMatch;
}

/**
 * buildResponse — Compose the spoken agent response for a pricing question.
 *
 * Logic:
 *   1. Find the best matching item + layer
 *   2. If action = ADVISOR_CALLBACK → return callback prompt
 *   3. Return the configured response for the matched layer
 *   4. If includesDetail exists and layer 1 matched and input asks "what's included" → append it
 *   5. No match → return null (caller falls through to normal pipeline)
 *
 * @param {Array}       items        Active pricing items
 * @param {string}      input        Raw caller utterance
 * @param {string}      [origin]     'DISCOVERY' | 'BOOKING' (affects CTA suffix)
 * @param {string|null} [returnPrompt] Resume question for BOOKING origin
 * @returns {{ responseText: string, item: Object, layer: number } | null}
 */
function buildResponse(items, input, origin = 'DISCOVERY', returnPrompt = null) {
  const matched = matchItem(items, input);
  if (!matched) return null;

  const { item, layer } = matched;

  // ── Advisor callback path ──────────────────────────────────────────────────
  if (item.action === 'ADVISOR_CALLBACK') {
    const prompt = item.advisorCallbackPrompt?.trim() ||
      `${CATEGORY_LABELS[item.category] || 'that service'} pricing varies by job — I'd have one of our advisors call you with an accurate quote. Can I get your name and best callback number?`;

    return {
      responseText:    prompt,
      item,
      layer:           1,
      requiresAdvisor: true
    };
  }

  // ── Pick response text for matched layer ───────────────────────────────────
  let responseText = '';

  if (layer === 1) {
    responseText = item.response?.trim() || '';
    // Append includesDetail if caller also asked "what's included" and L3 isn't configured
    const asksInclusion = /include|what.*(do|come)|consist|cover/i.test(input);
    const hasL3         = item.layer3Response?.trim();
    if (asksInclusion && item.includesDetail?.trim() && !hasL3) {
      responseText = `${responseText} ${item.includesDetail.trim()}`.trim();
    }
  } else if (layer === 2) {
    responseText = item.layer2Response?.trim() || '';
  } else if (layer === 3) {
    responseText = item.layer3Response?.trim() || item.includesDetail?.trim() || '';
  }

  if (!responseText) return null;

  // ── BOOKING origin: append returnPrompt to resume booking ──────────────────
  if (origin === 'BOOKING' && returnPrompt) {
    responseText = `${responseText} ${returnPrompt}`.trim();
  }

  return { responseText, item, layer, requiresAdvisor: false };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  PRICING_SIGNALS,
  detect,
  getActivePricingItems,
  invalidateCache,
  matchItem,
  buildResponse
};
