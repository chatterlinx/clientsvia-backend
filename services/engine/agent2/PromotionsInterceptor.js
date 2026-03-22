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

const SERVICE_ID       = 'PROMOTIONS_INTERCEPTOR';
const REDIS_TTL        = 900;   // 15 minutes
const CACHE_KEY_PREFIX = 'promotions';

// ── Intent classification signal tables ───────────────────────────────────────
//
// classifyIntent() uses two ranked tables to split the PROMO_SIGNALS hit into
// one of three intents:
//
//   HAS_COUPON      — caller is signaling they hold a specific code to redeem
//   ASKING_SPECIALS — caller wants to know what deals are currently available
//   AMBIGUOUS       — could be either; the clarifying question is fired
//
// HAS_COUPON is checked first (more specific). ASKING_SPECIALS is checked
// second. Everything that matches PROMO_SIGNALS but neither table → AMBIGUOUS.

/** Caller is trying to redeem a code they already have */
const HAS_COUPON_SIGNALS = [
  'i have a coupon',  'i have coupon',    'i\'ve got a coupon', 'got a coupon',
  'have a code',      'i have a code',    'i\'ve got a code',   'got a code',
  'have a promo code','i have a promo',   'i have promo',
  'use a coupon',     'use my coupon',    'using a coupon',     'using my coupon',
  'apply coupon',     'apply a coupon',   'apply my coupon',
  'coupon code',      'promo code',       'discount code',
  'my coupon',        'my promo code',    'my code',            'my discount code',
  'redeem',           'my voucher',       'have a voucher',     'got a voucher',
  'i have a promo code'
];

/** Caller wants to know what promotions/specials the company currently has */
const ASKING_SPECIALS_SIGNALS = [
  'any specials',       'any deals',          'any coupons',
  'any promotions',     'any discounts',      'any offers',
  'any current',        'currently running',  'running any',
  'running specials',   'running deals',
  'do you have',        'do you offer',       'do you run',       'do you currently',
  'are there any',      'is there a deal',    'is there a special','is there a discount',
  'are there specials', 'are you running',
  'what specials',      'what deals',         'what promotions',  'what discounts',
  'what kind of specials', 'what kind of deals',
  'current specials',   'current deals',      'current promotions',
  'save money',         'save some money',    'best price',        'best rate',
  'cheaper',            'less expensive'
];

/** Signals on a FOLLOW-UP turn that confirm caller has a coupon to use */
const CONFIRM_HAS_COUPON_SIGNALS = [
  'i have',     'i\'ve got',  'i got',      'got one',
  'have one',   'yes i have', 'yeah i have','yep i have',
  'code is',    'the code is','it\'s',      'it is',
  'my code is'
];

/** Signals on a FOLLOW-UP turn that confirm caller is asking about specials */
const CONFIRM_ASKING_SPECIALS_SIGNALS = [
  'asking',     'wondering',    'just wondering',  'curious',
  'what you have',              'what you offer',
  'what\'s available',          'what is available',
  'what are',   'currently have'
];

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
 * classifyIntent — Determine the caller's promo intent from their utterance.
 *
 * Called immediately after detect() returns true. Splits the broad promo
 * signal into one of three intent buckets:
 *
 *   HAS_COUPON      — "I have a coupon", "my promo code is SPRING99"
 *   ASKING_SPECIALS — "do you have any specials?", "any current deals?"
 *   AMBIGUOUS       — "coupon?", "any specials" alone (fires clarifying Q)
 *
 * HAS_COUPON is checked first (more specific signals).
 * ASKING_SPECIALS is checked second.
 * Anything else → AMBIGUOUS.
 *
 * Pure in-memory. Never throws.
 *
 * @param {string} userInput
 * @returns {'HAS_COUPON'|'ASKING_SPECIALS'|'AMBIGUOUS'}
 */
function classifyIntent(userInput) {
  if (!userInput || typeof userInput !== 'string') return 'AMBIGUOUS';
  const normalized = userInput.toLowerCase().trim();

  // HAS_COUPON first — most specific
  for (const signal of HAS_COUPON_SIGNALS) {
    if (normalized.includes(signal)) return 'HAS_COUPON';
  }

  // ASKING_SPECIALS second
  for (const signal of ASKING_SPECIALS_SIGNALS) {
    if (normalized.includes(signal)) return 'ASKING_SPECIALS';
  }

  // Matched PROMO_SIGNALS but neither table — caller said one word like "coupon"
  return 'AMBIGUOUS';
}

/**
 * resolveClassification — Determine intent on the FOLLOW-UP TURN after the
 * agent asked the clarifying question.
 *
 * The caller just heard: "Do you have a coupon code, or are you asking about
 * our current specials?" and responded. This function classifies that response.
 *
 * Checks all HAS_COUPON/ASKING_SPECIALS tables first, then the narrower
 * CONFIRM tables. Defaults to ASKING_SPECIALS (the more common intent) if
 * the response is still genuinely ambiguous (e.g. bare "yes").
 *
 * Pure in-memory. Never throws.
 *
 * @param {string} userInput  Caller's follow-up response
 * @returns {'HAS_COUPON'|'ASKING_SPECIALS'}
 */
function resolveClassification(userInput) {
  if (!userInput || typeof userInput !== 'string') return 'ASKING_SPECIALS';
  const normalized = userInput.toLowerCase().trim();

  // Full HAS_COUPON signal list — highest confidence
  for (const signal of HAS_COUPON_SIGNALS) {
    if (normalized.includes(signal)) return 'HAS_COUPON';
  }

  // Full ASKING_SPECIALS signal list — high confidence
  for (const signal of ASKING_SPECIALS_SIGNALS) {
    if (normalized.includes(signal)) return 'ASKING_SPECIALS';
  }

  // Softer confirm signals — used when caller gives a brief follow-up
  for (const signal of CONFIRM_HAS_COUPON_SIGNALS) {
    if (normalized.includes(signal)) return 'HAS_COUPON';
  }
  for (const signal of CONFIRM_ASKING_SPECIALS_SIGNALS) {
    if (normalized.includes(signal)) return 'ASKING_SPECIALS';
  }

  // Bare "yes" / "yeah" / "yep" alone — default to ASKING_SPECIALS
  // (most callers in this context are asking what deals exist, not redeeming)
  return 'ASKING_SPECIALS';
}

/**
 * buildClarifyingQuestion — Return the spoken question the agent uses when
 * the caller's promo intent is ambiguous (e.g. they just said "coupon").
 *
 * @returns {string}
 */
function buildClarifyingQuestion() {
  return (
    "Let me clarify — do you have a coupon or promotional code you'd like to " +
    "apply to your service visit, or are you asking if we have any current " +
    "specials running?"
  );
}

/**
 * extractCouponCode — Try to pull a specific code string from caller speech.
 *
 * Speech-to-text output is lowercase, so we work on the uppercased version.
 * Priority order:
 *   1. Explicit keyword context: "code is SPRING99", "promo HVAC20"
 *   2. Standalone alphanumeric token that looks like a code (letters + digits,
 *      at least 3 chars, not a common English word)
 *
 * Returns null if no code is confidently identified.
 * Pure in-memory. Never throws.
 *
 * @param {string} userInput
 * @returns {string|null}
 */
function extractCouponCode(userInput) {
  if (!userInput || typeof userInput !== 'string') return null;

  const upper = userInput.toUpperCase().trim();

  // ── 1. Explicit keyword context ───────────────────────────────────────────
  // "my code is SPRING99" / "the code is HVAC20" / "promo code TUNE50"
  const kwMatch = upper.match(
    /(?:CODE|COUPON|PROMO(?:TION)?|DISCOUNT)\s+(?:IS\s+)?([A-Z0-9]{3,20})\b/
  );
  if (kwMatch) return kwMatch[1];

  // "it's SPRING99" / "it is HVAC20"
  const itMatch = upper.match(/(?:IT'?S?|IS)\s+([A-Z0-9]{3,20})\b/);
  if (itMatch && /[A-Z]/.test(itMatch[1]) && /[0-9]/.test(itMatch[1])) {
    return itMatch[1];
  }

  // ── 2. Standalone alphanumeric that looks like a code ─────────────────────
  // Must contain BOTH letters and digits (e.g. SPRING99, HVAC20, TUNE50)
  // to avoid matching plain words that got uppercased.
  const standalone = upper.match(/\b([A-Z]{2,}[0-9]{1,10}|[0-9]{1,10}[A-Z]{2,})\b/g);
  if (standalone) {
    const WORD_BLACKLIST = new Set([
      'THE','AND','FOR','ARE','NOT','YES','OKAY','HAVE','WITH','FROM',
      'THIS','THAT','WILL','BEEN','THEY','YOUR','WHAT','JUST','ALSO',
      'WELL','NEED','HAVE','WANT','TAKE','GOOD','KNOW','MEAN','SAID'
    ]);
    const codes = standalone.filter(m => !WORD_BLACKLIST.has(m) && m.length >= 3);
    if (codes.length > 0) return codes[0];
  }

  return null;
}

/**
 * validateCouponCode — Look up a coupon code in MongoDB for this company.
 *
 * Returns a spoken agent response whether the code is valid or not.
 * If valid: confirms the deal and appends the promo's bookingPrompt or CTA.
 * If invalid/expired: uses noCouponResponse from the promo record if available,
 *   or a safe platform default. Always keeps the call moving.
 *
 * Multi-tenant safe: every query is scoped to companyId.
 * Graceful degrade: any DB error returns a soft hand-off response.
 *
 * @param {string} code             Uppercased coupon code from extractCouponCode()
 * @param {string} companyId
 * @param {string} [origin]         'DISCOVERY' | 'BOOKING'
 * @param {string} [returnPrompt]   Booking resume question (BOOKING origin only)
 * @returns {Promise<{ valid: boolean, promo: Object|null, responseText: string }>}
 */
async function validateCouponCode(code, companyId, origin = 'DISCOVERY', returnPrompt = null) {
  try {
    const now = new Date();
    const promo = await CompanyPromotion.findOne({
      companyId,
      code:     code.toUpperCase(),
      isActive: true,
      $and: [
        { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
        { $or: [{ validTo:   null }, { validTo:   { $gte: now } }] }
      ]
    }).lean();

    // ── Code not found or expired ──────────────────────────────────────────
    if (!promo) {
      // Try to load ANY promo for this company to get a custom noCouponResponse
      const anyPromo = await CompanyPromotion.findOne({ companyId }).sort({ priority: 1 }).lean();
      const noMatch  = anyPromo?.noCouponResponse?.trim() ||
        "I'm not finding that code in our system — it may have expired or " +
        "been entered incorrectly. Let me still get you taken care of.";

      let responseText = noMatch;
      if (origin === 'BOOKING' && returnPrompt) {
        responseText = `${responseText} ${returnPrompt}`;
      } else {
        responseText = `${responseText} Would you like to go ahead and get scheduled at our standard rate?`;
      }

      logger.info(`[${SERVICE_ID}] Coupon NOT found/expired`, { companyId, code });
      return { valid: false, promo: null, responseText };
    }

    // ── Valid code found ───────────────────────────────────────────────────
    const desc = promo.description?.trim() || _buildFallbackDescription(promo);
    const cta  = promo.bookingPrompt?.trim() ||
      'Would you like to go ahead and apply that to your appointment today?';

    let responseText = `Great news! That code is valid — ${desc}`;

    if (origin === 'BOOKING' && returnPrompt) {
      responseText = `${responseText} I'll make sure we apply that to your service. ${returnPrompt}`;
    } else {
      responseText = `${responseText} ${cta}`;
    }

    logger.info(`[${SERVICE_ID}] Coupon validated`, {
      companyId, code, promoName: promo.name
    });
    return { valid: true, promo, responseText };

  } catch (err) {
    logger.warn(`[${SERVICE_ID}] validateCouponCode error (non-fatal)`, {
      companyId, code, error: err.message
    });
    return {
      valid:        false,
      promo:        null,
      responseText: "Let me get someone to verify that coupon for you right away."
    };
  }
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
  // ── Core detection ──────────────────────────────────────────────────────
  detect,
  classifyIntent,
  resolveClassification,

  // ── Clarifying question & code extraction ───────────────────────────────
  buildClarifyingQuestion,
  extractCouponCode,
  validateCouponCode,

  // ── Promo list & response building ─────────────────────────────────────
  getActivePromotions,
  buildResponse,

  // ── Cache management ────────────────────────────────────────────────────
  invalidateCache,

  // ── Signal tables (exported for tests and future UI) ───────────────────
  PROMO_SIGNALS,
  HAS_COUPON_SIGNALS,
  ASKING_SPECIALS_SIGNALS
};
