'use strict';

/**
 * ============================================================================
 * COMPANY INTERCEPTOR MODEL
 * ============================================================================
 *
 * Per-company keyword-triggered interceptors that fire BEFORE the main KC
 * routing pipeline. When a caller utterance matches an interceptor's keywords,
 * the interceptor short-circuits normal routing and executes its configured
 * action immediately — no KC scoring, no LLM inference, no arbitration.
 *
 * ARCHITECTURE — WHERE INTERCEPTORS FIT:
 *   The ConversationEngine processes each turn through a layered pipeline:
 *
 *     1. Interceptors (this collection) — priority-sorted, keyword-matched
 *        → RESPOND / ROUTE_KC / BOOK / TRANSFER fired instantly
 *     2. ArbitrationEngine — scores all candidate signals
 *     3. KCRunner (GATE 1→4) — containers, anchor scoring, LLM fallback
 *     4. LLM catch-all (HybridReceptionistLLM)
 *
 *   Interceptors are the FASTEST possible response path. They consume no LLM
 *   budget, no scoring overhead, and produce deterministic responses every
 *   time. Use them for high-confidence, narrow-intent responses.
 *
 * MATCH MODES:
 *   ANY    — At least one keyword must appear anywhere in the normalized input.
 *            Best for broad topic capture (e.g. ["price","cost","how much"]).
 *   ALL    — Every keyword must appear. Use for compound-intent precision
 *            (e.g. ["cancel","appointment"] to avoid false-fires on "cancel").
 *   PHRASE — The exact joined phrase must appear as a substring. Strictest
 *            mode — use for exact phrases like "speak to someone".
 *
 * ACTIONS:
 *   RESPOND      — Read action.response to the caller verbatim (TTS/audio).
 *   ROUTE_KC     — Bypass keyword scoring and load the named KC container
 *                  directly (action.kcContainerId). Useful when you know
 *                  exactly which container should handle this utterance.
 *   BOOK         — Trigger the booking sub-pipeline (BookingLogicEngine).
 *                  action.bookingMode is an optional hint passed through.
 *   TRANSFER     — Bridge to action.transferTarget immediately.
 *
 * KEYWORD NORMALISATION (pre-save hook):
 *   All keywords are trimmed, lowercased, and deduped on every save.
 *   Runtime matching operates on already-normalized input — no re-normalizing
 *   at match time. Keep keywords as the caller would say them, lowercased.
 *
 * MULTI-TENANT RULES:
 *   - Every document is scoped to a single companyId.
 *   - Runtime always queries by { companyId, enabled: true }, sorted by priority.
 *   - API routes enforce companyId isolation — no cross-tenant leakage possible.
 *   - NEVER read interceptors across tenants. The compound index enforces this.
 *
 * REDIS CACHE:
 *   Runtime reads: key = interceptors:{companyId}  TTL = 10 min
 *   Invalidated on every CREATE / UPDATE / DELETE / enable-toggle.
 *   If Redis is unavailable, runtime falls through to MongoDB directly.
 *
 * STATS TRACKING:
 *   stats.matchCount and stats.lastMatchedAt are incremented fire-and-forget
 *   via $inc/$set after a successful match. They are never read at call time —
 *   purely for admin analytics and capacity planning.
 *
 * FUTURE NOTES:
 *   - PHRASE mode regex could be extended to support wildcard tokens.
 *   - A per-interceptor maxMatchesPerCall guard (circuit breaker) may be
 *     added to prevent looping on identical utterances.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

const companyInterceptorSchema = new mongoose.Schema(
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
    // DISPLAY
    // ─────────────────────────────────────────────────────────────────────────
    name: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 100,
      comment:   'Admin display name shown in the interceptor card UI (e.g. "After-hours transfer")'
    },

    description: {
      type:      String,
      trim:      true,
      maxlength: 300,
      default:   '',
      comment:   'Internal note — never spoken to caller. Use for "why this interceptor exists".'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // STATE & ORDERING
    // ─────────────────────────────────────────────────────────────────────────
    enabled: {
      type:    Boolean,
      default: true,
      comment: 'Master toggle — false = interceptor is skipped at runtime without deleting it'
    },

    priority: {
      type:    Number,
      default: 100,
      min:     1,
      comment: 'Sort order — lower number fires FIRST. Use 1–10 for must-fire gates, 50–200 for normal rules.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // KEYWORD MATCHING
    // Keywords are normalised on pre-save: trimmed, lowercased, deduped.
    // Runtime matching always operates on already-normalised caller input.
    // ─────────────────────────────────────────────────────────────────────────
    keywords: {
      type:     [String],
      required: true,
      validate: {
        validator: function (v) { return Array.isArray(v) && v.length >= 1; },
        message:   'keywords must have at least one entry'
      },
      comment: 'Trigger words/phrases — normalised to lowercase on save. Min 1 required.'
    },

    matchMode: {
      type:    String,
      enum:    ['ANY', 'ALL', 'PHRASE'],
      default: 'ANY',
      comment: 'ANY=any keyword present, ALL=all must be present, PHRASE=exact substring match'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // ACTION — what the interceptor does when it fires
    //
    // RESPOND      → speak action.response verbatim
    // ROUTE_KC     → jump to action.kcContainerId directly (bypass scoring)
    // BOOK         → trigger BookingLogicEngine (optional hint: action.bookingMode)
    // TRANSFER     → bridge to action.transferTarget
    // ─────────────────────────────────────────────────────────────────────────
    action: {
      type: {
        type:    String,
        enum:    ['RESPOND', 'ROUTE_KC', 'BOOK', 'TRANSFER'],
        required: true,
        comment: 'Routing action executed when this interceptor fires'
      },

      // RESPOND
      response: {
        type:      String,
        trim:      true,
        maxlength: 600,
        default:   '',
        comment:   'Required when action.type = RESPOND. Spoken verbatim to caller.'
      },

      // ROUTE_KC
      kcContainerId: {
        type:    String,
        trim:    true,
        default: '',
        comment: 'Required when action.type = ROUTE_KC. MongoDB _id of the KC container to load.'
      },

      kcContainerName: {
        type:    String,
        trim:    true,
        default: '',
        comment: 'Denormalised label for UI display — not used at runtime. Keep in sync with KC container name.'
      },

      // TRANSFER
      transferTarget: {
        type:    String,
        trim:    true,
        default: '',
        comment: 'Required when action.type = TRANSFER. E164 phone number or SIP URI.'
      },

      // BOOK
      bookingMode: {
        type:    String,
        trim:    true,
        default: '',
        comment: 'Optional hint passed to BookingLogicEngine when action.type = BOOK (e.g. "ADVISOR_CALLBACK").'
      }
    },

    // ─────────────────────────────────────────────────────────────────────────
    // STATS — fire-and-forget analytics, never read at call time
    // ─────────────────────────────────────────────────────────────────────────
    stats: {
      matchCount: {
        type:    Number,
        default: 0,
        comment: 'Total number of times this interceptor has fired. Incremented via $inc, never decremented.'
      },
      lastMatchedAt: {
        type:    Date,
        default: null,
        comment: 'Timestamp of the most recent successful match. Updated fire-and-forget.'
      }
    }
  },
  {
    timestamps:  true,
    collection:  'companyInterceptors',   // explicit — never rely on mongoose plural inference
    versionKey:  false
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Primary runtime query: enabled interceptors for a company, ordered by priority
companyInterceptorSchema.index({ companyId: 1, enabled: 1, priority: 1 });

// Admin UI listing: all interceptors for a company sorted by priority
companyInterceptorSchema.index({ companyId: 1, priority: 1 });

// ═══════════════════════════════════════════════════════════════════════════
// PRE-SAVE HOOK — KEYWORD NORMALISATION
// ═══════════════════════════════════════════════════════════════════════════

companyInterceptorSchema.pre('save', function (next) {
  // Normalise keywords: trim whitespace, lowercase, remove empty strings, dedup
  if (Array.isArray(this.keywords) && this.keywords.length > 0) {
    this.keywords = [
      ...new Set(
        this.keywords
          .map(k => (typeof k === 'string' ? k.trim().toLowerCase() : ''))
          .filter(Boolean)
      )
    ];
  }

  // Ensure companyId is always a string (never an ObjectId)
  if (this.companyId && typeof this.companyId !== 'string') {
    this.companyId = this.companyId.toString();
  }

  next();
});

// ═══════════════════════════════════════════════════════════════════════════
// STATIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * findActiveForCompany — Runtime query used by the ConversationEngine interceptor pass.
 * Returns all enabled interceptors for a company, sorted by priority ASC (lowest fires first).
 * Results are lean objects — safe to cache and pass across modules without mongoose overhead.
 *
 * @param {string} companyId
 * @returns {Promise<Array>}
 */
companyInterceptorSchema.statics.findActiveForCompany = function (companyId) {
  return this.find({ companyId, enabled: true })
    .sort({ priority: 1, createdAt: 1 })
    .lean();
};

module.exports = mongoose.model('CompanyInterceptor', companyInterceptorSchema, 'companyInterceptors');
