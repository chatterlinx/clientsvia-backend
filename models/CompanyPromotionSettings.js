'use strict';

/**
 * ============================================================================
 * CompanyPromotionSettings — Per-company global promotion voice settings
 * ============================================================================
 *
 * One document per companyId. Stores all agent voice lines used by the
 * PromotionsInterceptor at runtime. Every string the agent speaks during
 * a promo interaction is configurable here — nothing is hardcoded.
 *
 * Managed via:
 *   Admin UI   → /agent-console/promotions.html (Global Voice Settings section)
 *   API        → GET/PATCH /api/admin/agent2/company/:companyId/promotions/settings
 *   Runtime    → PromotionsInterceptor.getCompanySettings(companyId)
 *                (Redis cache TTL 15min → MongoDB fallback → built-in defaults)
 *
 * PLACEHOLDER SUPPORT:
 *   {callerName}  — replaced at runtime with caller's first name (if captured)
 *                   Example: "Hi {callerName}! Let me clarify..."
 *                   → "Hi Mark! Let me clarify..."
 *                   If name unknown, the placeholder + surrounding space is removed.
 *
 * MULTI-TENANT SAFE:
 *   Every document is scoped to companyId with a unique index.
 *   No field here is ever read across tenants.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

// ── Built-in defaults ─────────────────────────────────────────────────────────
// Used as fallback when a company hasn't saved settings yet.
// These are the values admins see pre-filled in the UI.
// They should NEVER be referenced in runtime code — always use getCompanySettings().

const BUILT_IN_DEFAULTS = {

  // ── Intent disambiguation ──────────────────────────────────────────────────
  // Fired when detect() matches but classifyIntent() returns AMBIGUOUS
  // (e.g. caller says just "coupon" or "specials" with no direction)
  // Supports {callerName} placeholder.
  clarifyingQuestion:
    "Hi {callerName}! Let me clarify — do you have a coupon or promotional " +
    "code you'd like to apply to your service visit, or are you asking if we " +
    "have any current specials running?",

  // ── Coupon code collection ─────────────────────────────────────────────────
  // Fired when caller confirms HAS_COUPON intent but didn't provide the code
  askForCodePrompt:
    "Sure! What's the coupon or promo code you have? " +
    "I want to make sure we apply that for you.",

  // Fired when code extraction fails (caller gave a response but no code found)
  codeRetryPrompt:
    "I'm sorry, I didn't quite catch that code — could you read it off " +
    "for me one more time?",

  // ── Valid code confirmation ────────────────────────────────────────────────
  // Prepended before the promo description when a code validates successfully
  // e.g. "Great news! That code is valid — We're offering 15% off..."
  validCodePrefix:
    "Great news! That code is valid —",

  // Appended in BOOKING mode when a valid code is confirmed mid-booking
  // (replaces the bookingPrompt since caller is already booked)
  validCodeBookingSuffix:
    "I'll make sure we apply that to your service.",

  // ── No specials / no match responses ──────────────────────────────────────
  // Fired when ASKING_SPECIALS but there are no active promos for this company
  // (also used as fallback from promo.noCouponResponse if that field is blank)
  noActiveSpecials:
    "We don't have any active specials right now, but I'd be happy to " +
    "get you scheduled at our standard rate.",

  // Appended after noActiveSpecials in DISCOVERY mode
  noActiveSpecialsCta:
    "Would you still like to go ahead and schedule?",

  // ── Behavior flags ─────────────────────────────────────────────────────────
  // If false, skip the clarifying question and go straight to listing promos
  // when intent is AMBIGUOUS (faster, but less precise)
  enableClarifyingQuestion: true
};

// ── Schema ────────────────────────────────────────────────────────────────────

const companyPromotionSettingsSchema = new mongoose.Schema(
  {
    // ── Identity ────────────────────────────────────────────────────────────
    companyId: {
      type:     String,
      required: true,
      unique:   true,   // one settings doc per company
      index:    true
    },

    // ── Intent disambiguation ───────────────────────────────────────────────
    clarifyingQuestion: {
      type:    String,
      trim:    true,
      default: BUILT_IN_DEFAULTS.clarifyingQuestion
    },

    // ── Coupon code collection ──────────────────────────────────────────────
    askForCodePrompt: {
      type:    String,
      trim:    true,
      default: BUILT_IN_DEFAULTS.askForCodePrompt
    },

    codeRetryPrompt: {
      type:    String,
      trim:    true,
      default: BUILT_IN_DEFAULTS.codeRetryPrompt
    },

    // ── Valid code confirmation ─────────────────────────────────────────────
    validCodePrefix: {
      type:    String,
      trim:    true,
      default: BUILT_IN_DEFAULTS.validCodePrefix
    },

    validCodeBookingSuffix: {
      type:    String,
      trim:    true,
      default: BUILT_IN_DEFAULTS.validCodeBookingSuffix
    },

    // ── No specials / no match ──────────────────────────────────────────────
    noActiveSpecials: {
      type:    String,
      trim:    true,
      default: BUILT_IN_DEFAULTS.noActiveSpecials
    },

    noActiveSpecialsCta: {
      type:    String,
      trim:    true,
      default: BUILT_IN_DEFAULTS.noActiveSpecialsCta
    },

    // ── Behavior flags ──────────────────────────────────────────────────────
    enableClarifyingQuestion: {
      type:    Boolean,
      default: true
    }
  },
  {
    timestamps:  true,
    collection:  'companyPromotionSettings'   // explicit — never inferred
  }
);

// ── Statics ───────────────────────────────────────────────────────────────────

/**
 * getForCompany — Load settings for a company, creating with defaults if absent.
 *
 * Uses upsert so there's always a document to return.
 * Returns a plain object (lean) for safe runtime use.
 *
 * @param {string} companyId
 * @returns {Promise<Object>}
 */
companyPromotionSettingsSchema.statics.getForCompany = async function (companyId) {
  const doc = await this.findOneAndUpdate(
    { companyId },
    { $setOnInsert: { companyId } },
    { upsert: true, new: true, lean: true, setDefaultsOnInsert: true }
  );
  return doc;
};

/**
 * BUILT_IN_DEFAULTS — exported so UI can pre-fill placeholders and tests
 * can assert expected default values without instantiating a document.
 */
companyPromotionSettingsSchema.statics.BUILT_IN_DEFAULTS = BUILT_IN_DEFAULTS;

// ── Model ─────────────────────────────────────────────────────────────────────

module.exports = mongoose.model(
  'CompanyPromotionSettings',
  companyPromotionSettingsSchema,
  'companyPromotionSettings'
);
