'use strict';

/**
 * ============================================================================
 * COMPANY ARBITRATION POLICY MODEL
 * ============================================================================
 *
 * Singleton document per company (unique on companyId). Stores all tunable
 * parameters that govern how the ArbitrationEngine resolves competing intent
 * signals on each call turn.
 *
 * ARCHITECTURE — WHAT ARBITRATION DOES:
 *   Every caller utterance produces multiple candidate signals simultaneously:
 *
 *     - BookingDetector  → score 0.0–1.0 for booking intent
 *     - TransferDetector → score 0.0–1.0 for transfer/agent intent
 *     - PricingInterceptor → score 0.0–1.0 for pricing intent
 *     - PromotionsInterceptor → score 0.0–1.0 for promo intent
 *     - KCContainerMatcher → score 0.0–1.0 for KC topic match
 *     - CompanyInterceptors → score 0.0–1.0 (custom rules)
 *
 *   ArbitrationEngine reads THIS document at call time to decide:
 *     1. Which signal wins (highest weighted score above autoRouteMinScore)?
 *     2. Do we need to disambiguate (gap < minScoreGap AND both above floor)?
 *     3. Is the lane currently locked (laneStickyEnabled + lane not timed out)?
 *     4. Did an escape keyword fire (override the lock)?
 *
 * SIGNAL WEIGHTS:
 *   Raw detector scores are multiplied by the corresponding weight before
 *   comparison. Weight 1.00 = detector score is taken as-is. Weight 0.50 =
 *   detector must fire at 0.60 to beat an unweighted signal at 0.58.
 *
 *   bookingBeatsAll=true overrides normal scoring: a booking signal above
 *   autoRouteMinScore immediately wins regardless of other candidates. This
 *   is the practical default — booking revenue is the primary goal.
 *
 * LANE LOCKING:
 *   Once a lane is established (e.g. BOOKING), subsequent turns stay in that
 *   lane for up to laneTimeoutMs milliseconds without re-arbitrating, even if
 *   another detector fires at a higher score. This prevents topic-hop loops
 *   mid-booking (e.g. caller asks a quick price question then returns to booking).
 *
 *   Escape keywords (default: cancel, stop, transfer, agent, etc.) immediately
 *   unlock the lane and re-run full arbitration. These are stored as a
 *   normalised [String] array — runtime lowercases input before checking.
 *
 * DISAMBIGUATION FLOW:
 *   When two candidates score within minScoreGap of each other AND both clear
 *   disambiguateFloor, the agent asks a clarifying question rather than guessing.
 *   maxDisambiguateAttempts caps how many times this can happen per turn before
 *   the engine falls through to the higher-scored candidate anyway.
 *
 * SINGLETON — ONE DOC PER COMPANY:
 *   getForCompany() upserts on first access, so a document always exists.
 *   API PATCH routes use $set, not $replace, to allow partial updates.
 *   Never create more than one doc per companyId — the unique index enforces this.
 *
 * MULTI-TENANT RULES:
 *   - companyId is unique-indexed. One doc per tenant. Zero cross-tenant reads.
 *   - Defaults represent sane production values but EVERY field is overridable
 *     per company through the admin UI → API → this collection.
 *   - No hardcoded weights anywhere in the service layer. Always read from here.
 *
 * REDIS CACHE:
 *   Runtime reads: key = arbitration-policy:{companyId}  TTL = 15 min
 *   Invalidated on every PATCH via ArbitrationPolicyService.invalidateCache().
 *   If Redis is unavailable, runtime falls through to MongoDB directly.
 *
 * FUTURE NOTES:
 *   - Per-lane timeout overrides (e.g. BOOKING lane times out faster than PRICING)
 *     can be added as a Map field without breaking existing docs.
 *   - queueSecondaryIntent machinery (store and surface after primary resolves)
 *     is planned but not yet implemented in the engine — field stored now so
 *     admin UI can expose it early.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

// ── Built-in defaults ─────────────────────────────────────────────────────────
// These values are used both as mongoose field defaults AND as the return value
// of getDefaults() — keeping them in one place prevents drift.
// NEVER reference these directly in runtime code — always call getForCompany().

const BUILT_IN_DEFAULTS = {
  // ── Lane locking ─────────────────────────────────────────────────────────
  laneStickyEnabled:  true,
  laneTimeoutMs:      300000,   // 5 minutes
  escapeKeywords: [
    'cancel', 'stop', 'transfer', 'agent', 'person',
    'manager', 'emergency', 'urgent', 'never mind', 'forget it'
  ],

  // ── Signal weights (0.0 – 1.0) ───────────────────────────────────────────
  weights: {
    booking:    0.90,
    transfer:   0.95,
    pricing:    0.50,
    promo:      0.50,
    customRule: 1.00,
    kc:         0.65
  },

  // ── Mixed intent ─────────────────────────────────────────────────────────
  bookingBeatsAll:       true,
  queueSecondaryIntent:  true,

  // ── Thresholds ────────────────────────────────────────────────────────────
  autoRouteMinScore:        0.75,
  minScoreGap:              0.15,
  disambiguateFloor:        0.40,
  maxDisambiguateAttempts:  2
};

// ── Schema ────────────────────────────────────────────────────────────────────

const companyArbitrationPolicySchema = new mongoose.Schema(
  {
    // ─────────────────────────────────────────────────────────────────────────
    // IDENTITY & TENANT ISOLATION
    // ─────────────────────────────────────────────────────────────────────────
    companyId: {
      type:     String,
      required: true,
      unique:   true,   // one policy doc per company — enforced at DB level
      trim:     true,
      index:    true,
      comment:  'Tenant isolator — unique per company. Never query across tenants.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // LANE LOCKING
    // Controls sticky-lane behaviour between turns within a single call.
    // ─────────────────────────────────────────────────────────────────────────
    laneStickyEnabled: {
      type:    Boolean,
      default: BUILT_IN_DEFAULTS.laneStickyEnabled,
      comment: 'When true, the active lane persists until timeout or escape keyword fires'
    },

    laneTimeoutMs: {
      type:    Number,
      default: BUILT_IN_DEFAULTS.laneTimeoutMs,
      min:     0,
      comment: 'Milliseconds before a locked lane expires and re-arbitration runs. Default: 300000 (5 min).'
    },

    escapeKeywords: {
      type:    [String],
      default: BUILT_IN_DEFAULTS.escapeKeywords,
      comment: 'Utterances that immediately unlock the lane. Compared against lowercased normalised input.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SIGNAL WEIGHTS (0.0 – 1.0)
    // Raw detector scores are multiplied by these weights before comparison.
    // 1.00 = pass-through. 0.50 = detector must score 2× higher to compete.
    // ─────────────────────────────────────────────────────────────────────────
    weights: {
      booking: {
        type:    Number,
        default: BUILT_IN_DEFAULTS.weights.booking,
        min:     0,
        max:     1,
        comment: 'Weight applied to BookingDetector raw score'
      },
      transfer: {
        type:    Number,
        default: BUILT_IN_DEFAULTS.weights.transfer,
        min:     0,
        max:     1,
        comment: 'Weight applied to TransferDetector raw score'
      },
      pricing: {
        type:    Number,
        default: BUILT_IN_DEFAULTS.weights.pricing,
        min:     0,
        max:     1,
        comment: 'Weight applied to PricingInterceptor raw score'
      },
      promo: {
        type:    Number,
        default: BUILT_IN_DEFAULTS.weights.promo,
        min:     0,
        max:     1,
        comment: 'Weight applied to PromotionsInterceptor raw score'
      },
      customRule: {
        type:    Number,
        default: BUILT_IN_DEFAULTS.weights.customRule,
        min:     0,
        max:     1,
        comment: 'Weight applied to CompanyInterceptor matches (custom rules always pass through at 1.0 by default)'
      },
      kc: {
        type:    Number,
        default: BUILT_IN_DEFAULTS.weights.kc,
        min:     0,
        max:     1,
        comment: 'Weight applied to KCContainerMatcher score'
      }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // MIXED INTENT FLAGS
    // Controls how competing intents are resolved when multiple fire at once.
    // ─────────────────────────────────────────────────────────────────────────
    bookingBeatsAll: {
      type:    Boolean,
      default: BUILT_IN_DEFAULTS.bookingBeatsAll,
      comment: 'When true, a booking signal above autoRouteMinScore wins immediately — no disambiguation.'
    },

    queueSecondaryIntent: {
      type:    Boolean,
      default: BUILT_IN_DEFAULTS.queueSecondaryIntent,
      comment: 'When true, the second-highest intent is queued and surfaced after the primary resolves. (Engine support planned.)'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SCORING THRESHOLDS
    // ─────────────────────────────────────────────────────────────────────────
    autoRouteMinScore: {
      type:    Number,
      default: BUILT_IN_DEFAULTS.autoRouteMinScore,
      min:     0,
      max:     1,
      comment: 'Weighted score a candidate must exceed to be auto-routed without disambiguation'
    },

    minScoreGap: {
      type:    Number,
      default: BUILT_IN_DEFAULTS.minScoreGap,
      min:     0,
      max:     1,
      comment: 'Minimum gap between top two weighted scores before disambiguation is skipped'
    },

    disambiguateFloor: {
      type:    Number,
      default: BUILT_IN_DEFAULTS.disambiguateFloor,
      min:     0,
      max:     1,
      comment: 'Both candidates must be above this floor before disambiguation is triggered'
    },

    maxDisambiguateAttempts: {
      type:    Number,
      default: BUILT_IN_DEFAULTS.maxDisambiguateAttempts,
      min:     1,
      comment: 'Cap on clarifying questions per turn before engine falls through to the higher-scored candidate'
    }
  },
  {
    timestamps:  true,
    collection:  'companyArbitrationPolicies',   // explicit — never rely on mongoose plural inference
    versionKey:  false
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Primary lookup — one doc per company, accessed by companyId only.
// The unique: true on the field definition covers most cases; this explicit
// index is here for explainability and to support compound queries in the future.
companyArbitrationPolicySchema.index({ companyId: 1 }, { unique: true });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * getForCompany — Load the arbitration policy for a company.
 * If no document exists yet, one is created with built-in defaults via upsert
 * (setDefaultsOnInsert ensures mongoose default values are written on creation).
 * Returns a plain lean object — safe to cache and pass across modules.
 *
 * @param {string} companyId
 * @returns {Promise<Object>}
 */
companyArbitrationPolicySchema.statics.getForCompany = async function (companyId) {
  const doc = await this.findOneAndUpdate(
    { companyId },
    { $setOnInsert: { companyId } },
    { upsert: true, new: true, lean: true, setDefaultsOnInsert: true }
  );
  return doc;
};

/**
 * getDefaults — Returns a plain object containing all built-in default values.
 * Used by:
 *   - Admin UI to pre-fill blank policy forms
 *   - Tests to assert expected default state without instantiating a document
 *   - ArbitrationEngine as ultimate fallback when both Redis and MongoDB are down
 *
 * @returns {Object}
 */
companyArbitrationPolicySchema.statics.getDefaults = function () {
  return { ...BUILT_IN_DEFAULTS, weights: { ...BUILT_IN_DEFAULTS.weights } };
};

/**
 * Export BUILT_IN_DEFAULTS on the model for direct import in tests and services.
 * Assign after model creation below.
 */
companyArbitrationPolicySchema.statics.BUILT_IN_DEFAULTS = BUILT_IN_DEFAULTS;

module.exports = mongoose.model(
  'CompanyArbitrationPolicy',
  companyArbitrationPolicySchema,
  'companyArbitrationPolicies'
);
