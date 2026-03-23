'use strict';

/**
 * ============================================================================
 * COMPANY PRICING ITEM MODEL
 * ============================================================================
 *
 * Stores per-company service pricing facts and what-is-included details.
 * The PricingInterceptor reads this collection at call runtime to answer
 * callers who ask about costs, fees, or service details at ANY turn during
 * the call — including mid-booking.
 *
 * ARCHITECTURE — THREE-LAYER RESPONSE SYSTEM:
 *   Each pricing item supports up to three independent, voice-ready answer
 *   layers. Layers are independently keyword-matched at runtime — no stateful
 *   layer progression is required. The "layer" concept is a UI organisational
 *   tool that groups related follow-up answers under one service card.
 *
 *   Layer 1 — Primary answer:    "How much is a service call?"  → "$89"
 *   Layer 2 — First follow-up:   "Does that get credited?"      → "Yes, repairs over $200"
 *   Layer 3 — Second follow-up:  "What does it include?"        → "Full inspection, estimate..."
 *
 * ADVISOR CALLBACK ROUTING:
 *   When action = 'ADVISOR_CALLBACK' (e.g. duct cleaning, custom quotes),
 *   PricingInterceptor returns advisorCallbackPrompt and signals the runtime
 *   to collect caller contact info (name + phone) via BookingLogicEngine
 *   with bookingType = 'ADVISOR_CALLBACK'. No new collection system needed —
 *   existing booking infrastructure handles it.
 *
 * MULTI-TENANT RULES:
 *   - Every document is scoped to a single companyId
 *   - Runtime always queries by { companyId, isActive: true }
 *   - API routes enforce companyId isolation — no cross-tenant leakage possible
 *
 * REDIS CACHE:
 *   Runtime reads: key = pricing:{companyId}  TTL = 15 min
 *   Invalidated on every CREATE / UPDATE / DELETE via PricingInterceptor.invalidateCache()
 *
 * FUTURE FRONTEND (end-user platform):
 *   Same collection, same API routes, scoped JWT per companyId.
 *   No schema changes required — architecture is front-end ready now.
 *
 * CATEGORIES:
 *   service_call   — Residential diagnostic / service fee
 *   commercial     — Commercial service call / inspection
 *   maintenance    — Maintenance plan / tune-up
 *   repair         — Repair labour / parts
 *   installation   — New equipment installation
 *   duct_cleaning  — Duct / air quality services
 *   inspection     — System inspection / assessment
 *   emergency      — After-hours / emergency call-out
 *   warranty       — Warranty / extended coverage
 *   other          — Catch-all for custom pricing types
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const companyPricingItemSchema = new mongoose.Schema(
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
    // SERVICE IDENTITY
    // ─────────────────────────────────────────────────────────────────────────
    label: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 120,
      comment:   'Admin display name — shown in the UI card header (e.g. "Residential Service Call")'
    },

    category: {
      type:    String,
      enum:    [
        'service_call', 'commercial', 'maintenance', 'repair',
        'installation', 'duct_cleaning', 'inspection', 'emergency',
        'warranty', 'other'
      ],
      default: 'other',
      comment: 'Service category — drives badge colour and filter in the UI'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 1 — PRIMARY ANSWER
    // Primary keywords trigger this item. Response is what the agent says first.
    // includesDetail is spoken when caller asks "what does that include?"
    // ─────────────────────────────────────────────────────────────────────────
    keywords: {
      type:    [String],
      default: [],
      comment: 'Trigger phrases for this pricing item (e.g. ["service call", "diagnostic fee", "how much is a service call"])'
    },

    response: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 500,
      comment:   'Layer 1: Primary spoken answer (e.g. "Our residential service call is $89.")'
    },

    includesDetail: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 600,
      comment:   'Optional: what is included — spoken when caller asks "what does that include?" without a separate layer'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 2 — FIRST FOLLOW-UP
    // Matched independently by its own keywords — no stateful layer progression.
    // Grouped here for admin UI clarity and context.
    // ─────────────────────────────────────────────────────────────────────────
    layer2Keywords: {
      type:    [String],
      default: [],
      comment: 'Layer 2 trigger phrases (e.g. ["credited", "applied to repair", "go towards", "waived"])'
    },

    layer2Response: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 500,
      comment:   'Layer 2: First follow-up answer (e.g. "Yes — for repairs over $200 we waive the diagnostic fee.")'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // LAYER 3 — SECOND FOLLOW-UP
    // ─────────────────────────────────────────────────────────────────────────
    layer3Keywords: {
      type:    [String],
      default: [],
      comment: 'Layer 3 trigger phrases (e.g. ["what does it include", "what comes with", "what do you do"])'
    },

    layer3Response: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 500,
      comment:   'Layer 3: Second follow-up answer (e.g. "The diagnostic includes a full system inspection, fault diagnosis, and a written estimate.")'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // ROUTING ACTION
    // RESPOND          — Agent reads the configured response layers
    // ADVISOR_CALLBACK — Agent collects caller info for advisor follow-up
    //                    (used for custom-quote services like duct cleaning)
    // ─────────────────────────────────────────────────────────────────────────
    action: {
      type:    String,
      enum:    ['RESPOND', 'ADVISOR_CALLBACK'],
      default: 'RESPOND',
      comment: 'RESPOND = agent answers directly; ADVISOR_CALLBACK = collect info for advisor call-back'
    },

    advisorCallbackPrompt: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 400,
      comment:   'Spoken when action=ADVISOR_CALLBACK (e.g. "Duct cleaning is priced per system — I\'d have an advisor call with an exact quote. Can I get your name and best number?")'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // STATE & ORDERING
    // ─────────────────────────────────────────────────────────────────────────
    isActive: {
      type:    Boolean,
      default: true,
      index:   true,
      comment: 'Master toggle — false = item exists but agent will not present it'
    },

    priority: {
      type:    Number,
      default: 100,
      min:     1,
      comment: 'Sort order when multiple items match — lower = higher priority'
    }
  },
  {
    timestamps: true,
    collection: 'companyPricingItems',   // explicit — never rely on mongoose plural inference
    versionKey: false
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Primary runtime query: active items for a company, sorted by priority
companyPricingItemSchema.index({ companyId: 1, isActive: 1, priority: 1 });

// Category filter: UI and analytics
companyPricingItemSchema.index({ companyId: 1, category: 1 });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * findActiveForCompany — Runtime query used by PricingInterceptor.
 * Returns all active pricing items for a company, sorted by priority.
 *
 * @param {string} companyId
 * @returns {Promise<Array>}
 */
companyPricingItemSchema.statics.findActiveForCompany = function (companyId) {
  return this.find({ companyId, isActive: true })
    .sort({ priority: 1, createdAt: 1 })
    .lean();
};

module.exports = mongoose.model('CompanyPricingItem', companyPricingItemSchema, 'companyPricingItems');
