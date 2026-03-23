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
 *   Free-text label — admin types whatever fits their industry.
 *   Not used by the agent for matching (keyword-based). UI organisation only.
 *   Examples: "Service Call", "Flatbed Tow", "Jump Start", "Duct Cleaning"
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
      default: '',
      trim:    true,
      comment: 'Free-text label for admin UI organisation (e.g. "Service Call", "Flatbed Tow") — NOT used by agent for matching'
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
    // ROUTING ACTION — what happens after (or instead of) delivering the price
    //
    // RESPOND            — Agent reads configured response layers; no follow-up action
    // RESPOND_THEN_BOOK  — Agent reads L1 response, then offers to schedule
    // ADVISOR_CALLBACK   — No price given; agent collects name + phone for advisor call-back
    // SCHEDULE_ESTIMATE  — No price given; agent pivots to booking for a free in-home estimate
    // TRANSFER           — No price given; agent speaks actionPrompt then transfers to live agent
    // ─────────────────────────────────────────────────────────────────────────
    action: {
      type:    String,
      enum:    ['RESPOND', 'RESPOND_THEN_BOOK', 'ADVISOR_CALLBACK', 'SCHEDULE_ESTIMATE', 'TRANSFER'],
      default: 'RESPOND',
      comment: 'Post-pricing routing action — see inline docs above'
    },

    actionPrompt: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 400,
      comment:   'Spoken for ADVISOR_CALLBACK / SCHEDULE_ESTIMATE / TRANSFER actions. Falls back to company-level pricingVoiceSettings.advisorCallbackFallback.'
    },

    // ─ Legacy alias (kept for backward compat — maps to actionPrompt at runtime) ─
    advisorCallbackPrompt: {
      type:      String,
      trim:      true,
      default:   '',
      maxlength: 400,
      comment:   'Legacy — use actionPrompt for new items. Checked as fallback if actionPrompt is empty.'
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
