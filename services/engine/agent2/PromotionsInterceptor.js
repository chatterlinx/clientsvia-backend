'use strict';

/**
 * ============================================================================
 * PROMOTIONS INTERCEPTOR
 * ============================================================================
 *
 * Detects caller questions about coupons, specials, or promotions at ANY turn
 * during the call — regardless of whether the agent is in Discovery or Booking.
 *
 * FIRING ORDER in the call pipeline (runs BEFORE SCRAB / trigger matching):
 *   1. PromotionsInterceptor.detect(userInput)  → boolean
 *   2. If detected:
 *      a. DiscoveryNotesService.pushDigression()   — save where we are
 *      b. PromotionsInterceptor.buildResponse()    — fetch promos, build text
 *      c. Agent returns the promo response to caller
 *   3. Next turn: caller reacts (accept / decline / follow-up)
 *      a. DiscoveryNotesService.peekDigression()   — check origin
 *      b. If DISCOVERY origin + positive caller signal → fire FUC
 *         If BOOKING  origin (any signal)           → resume booking step
 *      c. DiscoveryNotesService.popDigression()    — clear stack entry
 *
 * REDIS CACHE:
 *   Key: promotions:{companyId}   TTL: 15 min (900s)
 *   Invalidated on every CREATE / UPDATE / DELETE in companyPromotions API.
 *   Runtime reads Redis first; falls back to MongoDB on cache miss.
 *   Graceful degrade: if both fail, returns a soft "no active specials" text
 *   so the call never breaks.
 *
 * MULTI-TENANT SAFETY:
 *   Every cache key and every MongoDB query is scoped to companyId.
 *   No cross-tenant data is ever returned.
 *
 * DIGRESSION RETURN PATHS:
 *   digressionOrigin = DISCOVERY
 *     → After answering: append bookingPrompt to invite FUC
 *     → Caller accepts  → FUC fires → HANDOFF_BOOKING
 *     → Caller declines → resume discovery (popDigression, no specific step)
 *
 *   digressionOrigin = BOOKING
 *     → After answering: append returnPrompt (exact booking question resume)
 *     → Always pop stack — caller is already consented, just answer + continue
 *
 * ============================================================================
 */

const logger              = require('../../../utils/logger');
const CompanyPromotion    = require('../../../models/CompanyPromotion');
const { getSharedRedisClient } = require('../../redisClientFactory');

// ── Constants ─────────────────────────────────────────────────────────────────

const SERVICE_ID      = 'PROMOTIONS_INTERCEPTOR';
const REDIS_TTL       = 900;   // 15 minutes
const CACHE_KEY_PREFIX = 'promotions';

// ── Promo detection signals (phrase-based, normalized lowercase) ──────────────
// These trigger the interceptor BEFORE SCRAB / trigger matching.
// Must be broad enough to catch natural speech patterns.
const PROMO_SIGNALS = [
  // Coupon / promo / special family
  'coupon', 'coupons',
  'promo', 'promos', 'promotion', 'promotions',
  'special', 'specials',
  'deal', 'deals',
  'discount', 'discounts',
  'offer', 'offers',

  // "Do you have any ..." phrasing
  'any specials', 'any deals', 'any coupons', 'any promotions', 'any discounts',
  'any offers', 'any current', 'any running',
  'running any', 'running specials', 'running deals',
  'have specials', 'have deals', 'have coupons',

  // "Is there a ..." phrasing
  'is there a deal', 'is there a special', 'is there a discount', 'is there a coupon',
  'are there any deals', 'are there any specials', 'are there specials',

  // Pricing investigation tied to promo intent
  'save money', 'save some money', 'save a little',
  'cheaper', 'less expensive', 'affordable rate', 'best price', 'best rate',

  // Service-specific promo phrasing
  'maintenance special', 'maintenance deal', 'maintenance coupon',
  'tune up special', 'tune-up special',
  'inspection special', 'inspection deal',

  // Direct coupon reference
  'i have a coupon', 'i have coupon', 'got a coupon', 'using a coupon', 'use a coupon',
  'apply coupon', 'apply a coupon', 'use my coupon',
  'coupon code', 'promo code', 'discount code',

  // Still good / valid checks
  'still good', 'still valid', 'still active', 'still running',
  'expire', 'expired', 'expiration'
];

// ─────────────────────────────────────────────────────────────────────────────
// PUBLIC API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * detect — Check if caller input contains a promo/coupon/specials signal.
 *
 * Runs against lowercased, trimmed input.
 * Does NOT call Redis or MongoDB — purely in-memory signal matching.
 * Very fast: suitable for the hot call path.
 *
 * @param {string} userInput  Raw or ScrabEngine-cleaned caller text
 * @returns {boolean}
 */
function detect(userInput) {
  if (!userInput || typeof userInput !== 'string') return false;
  const normalized = userInput.toLowerCase().trim();
  if (normalized.length < 3) return false;

  for (const signal of PROMO_SIGNALS) {
    if (normalized.includes(signal)) return true;
  }
  return false;
}

/**
 * getActivePromotions — Fetch active promos from Redis → MongoDB.
 * Returns empty array (never throws) so calls always continue even if both fail.
 *
 * @param {string} companyId
 * @returns {Promise<Array>}  Array of CompanyPromotion lean objects
 */
async function getActivePromotions(companyId) {
  const cacheKey = `${CACHE_KEY_PREFIX}:${companyId}`;

  // ── 1. Redis fast path ─────────────────────────────────────────────────────
  try {
    const redis = await getSharedRedisClient();
    if (redis) {
      const cached = await redis.get(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        logger.debug(`[${SERVICE_ID}] Cache HIT for ${companyId} (${parsed.length} promos)`);
        return parsed;
      }
    }
  } catch (cacheErr) {
    logger.warn(`[${SERVICE_ID}] Redis read failed (non-fatal)`, {
      companyId, error: cacheErr.message
    });
  }

  // ── 2. MongoDB fallback ────────────────────────────────────────────────────
  try {
    const promos = await CompanyPromotion.findActiveForCompany(companyId);

    // Backfill cache (fire-and-forget — never block the response)
    _cachePromosFireAndForget(companyId, promos);

    logger.debug(`[${SERVICE_ID}] MongoDB LOAD for ${companyId} (${promos.length} promos)`);
    return promos;

  } catch (dbErr) {
    logger.warn(`[${SERVICE_ID}] MongoDB load failed (non-fatal — returning empty)`, {
      companyId, error: dbErr.message
    });
    return [];
  }
}

/**
 * buildResponse — Compose the spoken agent response for a promo query.
 *
 * Logic:
 *   1. Filter by serviceType if caller mentioned a specific service
 *   2. Pick the highest-priority active promo that matches (or first if no filter)
 *   3. If no promos → use noCouponResponse from the first promo's field, or
 *      a sensible platform default (multi-tenant: never hardcode prices/terms)
 *   4. Append the bookingPrompt to invite the caller to schedule
 *
 * @param {Array}  promos       Array of active promo objects
 * @param {string} userInput    Original caller utterance (for service-type detection)
 * @param {string} [origin]     'DISCOVERY' | 'BOOKING' — affects what is appended
 * @param {string} [returnPrompt] Booking resume question (BOOKING origin only)
 * @returns {{ responseText: string, promoUsed: Object|null }}
 */
function buildResponse(promos, userInput, origin = 'DISCOVERY', returnPrompt = null) {
  const normalized = (userInput || '').toLowerCase();

  // ── Step 1: Try to infer the service type caller is asking about ───────────
  const inferredService = _inferServiceType(normalized);

  // ── Step 2: Pick the best matching promo ──────────────────────────────────
  let matched = null;

  if (inferredService && promos.length > 0) {
    // Prefer a promo scoped to the inferred service
    matched = promos.find(p =>
      p.serviceType && (
        p.serviceType.toLowerCase() === inferredService ||
        p.serviceType.toLowerCase() === 'all'
      )
    ) || null;
  }

  // Fallback: take the first (highest-priority) promo regardless of service
  if (!matched && promos.length > 0) {
    matched = promos[0];
  }

  // ── Step 3: Build the spoken response ─────────────────────────────────────
  let responseText = '';

  if (matched) {
    // Use the admin-configured description or build a minimal fallback
    const desc = matched.description?.trim();
    if (desc) {
      responseText = desc;
    } else {
      // Construct a minimal voice-safe description from structured fields
      responseText = _buildFallbackDescription(matched);
    }

    // ── Step 4: Append call-to-action ─────────────────────────────────────
    const cta = matched.bookingPrompt?.trim() ||
      'Would you like to take advantage of that and get scheduled today?';

    if (origin === 'BOOKING' && returnPrompt) {
      // Already in booking — do NOT re-ask for consent.
      // Just acknowledge the deal and return to the booking step.
      responseText = `${responseText} ${cta.replace(/get scheduled today\??/i, 'apply that to your appointment.')} ${returnPrompt}`.trim();
    } else {
      // Discovery origin — the CTA IS the FUC ("Would you like to schedule?")
      responseText = `${responseText} ${cta}`.trim();
    }

  } else {
    // ── No active promos — use the first promo's noCouponResponse if any exist ─
    // (even inactive promos in the collection may have a custom no-promo message)
    // For now, fall back to the platform default — safe for all tenants.
    responseText =
      "We don't have any active specials right now, but I'd be happy to get you scheduled at our standard rate.";

    if (origin === 'BOOKING' && returnPrompt) {
      responseText = `${responseText} ${returnPrompt}`.trim();
    } else {
      responseText = `${responseText} Would you still like to go ahead and schedule?`.trim();
    }
  }

  return { responseText, promoUsed: matched };
}

/**
 * invalidateCache — Delete the Redis cache for a company's promotions.
 * Called by companyPromotions API on every CREATE / UPDATE / DELETE.
 *
 * @param {string} companyId
 * @returns {Promise<void>}
 */
async function invalidateCache(companyId) {
  try {
    const redis = await getSharedRedisClient();
    if (!redis) return;
    const cacheKey = `${CACHE_KEY_PREFIX}:${companyId}`;
    await redis.del(cacheKey);
    logger.info(`[${SERVICE_ID}] ✅ Cache invalidated for company ${companyId}`);
  } catch (err) {
    logger.warn(`[${SERVICE_ID}] Cache invalidation failed (non-fatal)`, {
      companyId, error: err.message
    });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERNAL HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * _inferServiceType — Guess the service the caller wants a promo for.
 * Returns a lowercase slug or null if ambiguous.
 *
 * @param {string} normalized  Lowercased caller input
 * @returns {string|null}
 */
function _inferServiceType(normalized) {
  if (/maintenance|tune.?up|annual service/.test(normalized)) return 'maintenance';
  if (/repair|fix|broken|not working|not cooling|not heating/.test(normalized)) return 'repair';
  if (/install|replacement|replace|new unit|new system/.test(normalized)) return 'installation';
  if (/inspection|checkup|check.?up/.test(normalized)) return 'inspection';
  if (/duct|ducts|ductwork/.test(normalized)) return 'ductwork';
  if (/diagnostic|diagnosis|assess/.test(normalized)) return 'diagnostic';
  return null;
}

/**
 * _buildFallbackDescription — If admin left description blank, construct a
 * minimal spoken line from the structured discount fields.
 * Never hardcodes company pricing — uses only the promo's own stored values.
 *
 * @param {Object} promo
 * @returns {string}
 */
function _buildFallbackDescription(promo) {
  const label = promo.serviceLabel || promo.serviceType || 'service';

  switch (promo.discountType) {
    case 'fixed_price':
      return `We currently have a special for ${label} at $${promo.discountValue}.`;
    case 'percent_off':
      return `We're offering ${promo.discountValue}% off on ${label} right now.`;
    case 'flat_discount':
      return `We have a $${promo.discountValue} discount available on ${label}.`;
    case 'free_service':
      return `We're currently offering a complimentary ${label}.`;
    default:
      return `We do have a ${promo.name} special available right now.`;
  }
}

/**
 * _cachePromosFireAndForget — Write promos to Redis cache after MongoDB load.
 * Never awaited — never blocks the hot path.
 *
 * @param {string} companyId
 * @param {Array}  promos
 */
function _cachePromosFireAndForget(companyId, promos) {
  (async () => {
    try {
      const redis = await getSharedRedisClient();
      if (!redis) return;
      const cacheKey = `${CACHE_KEY_PREFIX}:${companyId}`;
      await redis.set(cacheKey, JSON.stringify(promos), { EX: REDIS_TTL });
    } catch (err) {
      logger.warn(`[${SERVICE_ID}] Cache backfill failed (non-fatal)`, {
        companyId, error: err.message
      });
    }
  })();
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS
// ─────────────────────────────────────────────────────────────────────────────

module.exports = {
  detect,
  getActivePromotions,
  buildResponse,
  invalidateCache,
  PROMO_SIGNALS        // exported so tests and future UI can inspect/extend the list
};
