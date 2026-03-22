'use strict';

/**
 * ============================================================================
 * COMPANY PROMOTION MODEL
 * ============================================================================
 *
 * Stores per-company promotions, coupons, and specials.
 * The PromotionsInterceptor reads this collection at call runtime to answer
 * callers who ask about deals, coupons, or specials at ANY turn during the
 * call — regardless of whether the agent is in discovery or booking.
 *
 * MULTI-TENANT RULES:
 *   - Every document is scoped to a single companyId
 *   - Runtime always queries by { companyId, isActive: true } after date filter
 *   - API routes enforce companyId isolation — no cross-tenant leakage possible
 *
 * REDIS CACHE:
 *   Runtime reads: key = promotions:{companyId}  TTL = 15 min
 *   Invalidated on every CREATE / UPDATE / DELETE via PromotionsInterceptor.invalidateCache()
 *
 * FUTURE FRONTEND (end-user platform):
 *   Same collection, same API routes, scoped JWT per companyId.
 *   No schema changes required — architecture is front-end ready now.
 *
 * SCHEMA FIELDS:
 *   name            — Display name shown in the UI (e.g. "Spring Maintenance Special")
 *   code            — Optional coupon code caller can reference ("SPRING99")
 *   serviceType     — Which service this applies to ("maintenance", "repair", "all")
 *   serviceLabel    — Human-readable label for voice response ("annual maintenance")
 *   discountType    — "fixed_price" | "percent_off" | "flat_discount" | "free_service"
 *   discountValue   — Numeric value (price, %, or 0 for free)
 *   description     — What the agent reads out loud when presenting this promo
 *   bookingPrompt   — Agent's call-to-action after presenting the deal
 *   noCouponResponse— What agent says when caller asks and NO active promos match
 *   terms           — Fine print (used by LLM context, not spoken unless asked)
 *   validFrom       — ISO date — null = no start restriction
 *   validTo         — ISO date — null = no end restriction
 *   isActive        — Master on/off toggle (soft disable without deleting)
 *   priority        — Sort order (lower = shown first); default 100
 *   createdAt/updatedAt — Managed by Mongoose timestamps
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

// ── Sub-schema: none required — flat document is sufficient for this entity ──

const companyPromotionSchema = new mongoose.Schema(
  {
    // ─────────────────────────────────────────────────────────────────────────
    // IDENTITY & TENANT ISOLATION
    // ─────────────────────────────────────────────────────────────────────────
    companyId: {
      type:     String,
      required: true,
      trim:     true,
      index:    true,
      comment:  'Tenant isolator — ALL queries must include this field'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CORE DEAL FIELDS
    // ─────────────────────────────────────────────────────────────────────────
    name: {
      type:     String,
      required: true,
      trim:     true,
      maxlength: 120,
      comment:  'Admin display name — shown in the UI card header'
    },

    code: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 40,
      comment:   'Optional coupon code (e.g. "SPRING99") — spoken if caller references it'
    },

    serviceType: {
      type:      String,
      trim:      true,
      default:   'all',
      comment:   'Service slug: "maintenance", "repair", "installation", "all", etc.'
    },

    serviceLabel: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 80,
      comment:   'Human-readable voice label used in agent response ("annual maintenance")'
    },

    discountType: {
      type:     String,
      enum:     ['fixed_price', 'percent_off', 'flat_discount', 'free_service', 'custom'],
      default:  'custom',
      comment:  'How the discount is structured'
    },

    discountValue: {
      type:    Number,
      default: 0,
      min:     0,
      comment: 'Numeric value — price for fixed_price, % for percent_off, $ for flat_discount, 0 for free'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // AGENT VOICE RESPONSE FIELDS  (UI-configurable, per-company)
    // ─────────────────────────────────────────────────────────────────────────
    description: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 500,
      comment:   'Full deal description the agent reads aloud when presenting this promo'
    },

    bookingPrompt: {
      type:      String,
      trim:      true,
      default:   'Would you like to go ahead and get that scheduled today?',
      maxlength: 300,
      comment:   'Agent call-to-action after presenting the deal — triggers FUC or booking resume'
    },

    noCouponResponse: {
      type:      String,
      trim:      true,
      default:   "We don't have any active specials at the moment, but I'd be happy to get you scheduled at our regular rate.",
      maxlength: 400,
      comment:   'Agent response when caller asks about promos but no active ones match'
    },

    terms: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 600,
      comment:   'Fine print — injected into LLM context, spoken only if caller asks'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // VALIDITY WINDOW
    // ─────────────────────────────────────────────────────────────────────────
    validFrom: {
      type:    Date,
      default: null,
      comment: 'null = no start restriction; promo is valid from the moment it is created'
    },

    validTo: {
      type:    Date,
      default: null,
      comment: 'null = no expiry; promo remains active until manually disabled'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // STATE & ORDERING
    // ─────────────────────────────────────────────────────────────────────────
    isActive: {
      type:    Boolean,
      default: true,
      index:   true,
      comment: 'Master toggle — false = promo exists but agent will not present it'
    },

    priority: {
      type:    Number,
      default: 100,
      min:     1,
      comment: 'Sort order when multiple active promos exist — lower = higher priority'
    }
  },
  {
    timestamps:  true,                     // adds createdAt, updatedAt automatically
    collection:  'companyPromotions',      // explicit collection name — never relies on mongoose plural inference
    versionKey:  false                     // removes __v field from documents
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Primary runtime query: fetch active promos for a company, sorted by priority
companyPromotionSchema.index({ companyId: 1, isActive: 1, priority: 1 });

// Date-window queries: let runtime filter by today's date efficiently
companyPromotionSchema.index({ companyId: 1, validFrom: 1, validTo: 1 });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * findActiveForCompany — Runtime query used by PromotionsInterceptor.
 * Returns promos that are active AND within their validity window (if set).
 * Sorted by priority ascending (lowest number = shown first).
 *
 * @param {string} companyId
 * @returns {Promise<Array>}
 */
companyPromotionSchema.statics.findActiveForCompany = function (companyId) {
  const now = new Date();
  return this.find({
    companyId,
    isActive: true,
    $and: [
      { $or: [{ validFrom: null }, { validFrom: { $lte: now } }] },
      { $or: [{ validTo:   null }, { validTo:   { $gte: now } }] }
    ]
  })
  .sort({ priority: 1, createdAt: 1 })
  .lean();
};

module.exports = mongoose.model('CompanyPromotion', companyPromotionSchema, 'companyPromotions');
