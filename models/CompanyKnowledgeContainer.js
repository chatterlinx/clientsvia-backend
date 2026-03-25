'use strict';

/**
 * ============================================================================
 * COMPANY KNOWLEDGE CONTAINER MODEL
 * ============================================================================
 *
 * Unified knowledge document for the Knowledge Container system.
 * One container = one topic the caller might ask about.
 *
 * PURPOSE:
 *   Replaces the fragmented Pricing/Promotions keyword approach with a
 *   rich, admin-authored briefing document. Groq reads the full container
 *   and answers any caller question about that topic — bounded to the
 *   admin-written content, never inventing facts.
 *
 * DESIGN PHILOSOPHY:
 *   - Admin authors unlimited content in flexible labelled sections
 *     (Price, What's Included, Warranty, Duration, Availability, etc.)
 *   - Groq synthesises the answer within a configurable word limit
 *   - Caller gets a natural, human answer — not a robot reading a price list
 *   - After answering, Groq naturally offers to book OR appends a fixed phrase
 *
 * SECTIONS (flexible):
 *   Each container has N sections — { label, content, order }.
 *   Admin adds any labels they need. No fixed schema for what goes inside.
 *   Examples: "Price", "What's Included", "Warranty", "Duration",
 *             "Availability", "How It Works", "Who Needs This"
 *
 * KEYWORD MATCHING:
 *   Runtime: KnowledgeContainerService.findContainer() scores all containers
 *   against the caller utterance. Best-scoring container wins.
 *   Keyword auto-generation via POST .../generate-keywords endpoint.
 *
 * BOOKING ACTION:
 *   offer_to_book    — after answering, Groq offers to schedule (or appends fixed phrase)
 *   advisor_callback — after answering, collects name+phone for advisor callback
 *   none             — answer only, no booking action
 *
 * MULTI-TENANT SAFETY:
 *   All documents scoped to companyId. Runtime always queries with companyId filter.
 *
 * REDIS CACHE:
 *   Key: knowledge:{companyId}  TTL: 15 min (900s)
 *   Invalidated on every write via KnowledgeContainerService.invalidateCache()
 *
 * FRONTEND READY:
 *   API routes are built for admin console AND future end-user platform.
 *   Same collection, same endpoints, scoped JWT per companyId when wired.
 *
 * ============================================================================
 */

const mongoose = require('mongoose');

// ─────────────────────────────────────────────────────────────────────────────
// SECTION SUB-SCHEMA — flexible labelled content blocks
// ─────────────────────────────────────────────────────────────────────────────

const sectionSchema = new mongoose.Schema(
  {
    label: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 80,
      comment:   'Section heading shown in UI and injected into Groq prompt (e.g. "Price", "What\'s Included", "Warranty")'
    },
    content: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 2000,
      comment:   'The actual knowledge content — admin can be as detailed as needed. Groq synthesises within word limit.'
    },
    order: {
      type:    Number,
      default: 0,
      comment: 'Display and injection order — lower = earlier'
    }
  },
  { _id: true, versionKey: false }
);

// ─────────────────────────────────────────────────────────────────────────────
// MAIN SCHEMA
// ─────────────────────────────────────────────────────────────────────────────

const companyKnowledgeContainerSchema = new mongoose.Schema(
  {
    // ─────────────────────────────────────────────────────────────────────────
    // TENANT ISOLATION — all queries must include this field
    // ─────────────────────────────────────────────────────────────────────────
    companyId: {
      type:     String,
      required: true,
      trim:     true,
      index:    true,
      comment:  'Multi-tenant isolator — ALL queries must include companyId filter'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // CONTAINER IDENTITY
    // ─────────────────────────────────────────────────────────────────────────

    // Human-readable, auto-generated ID for this container.
    // Format: {last5charsOfCompanyId}-{seq} e.g. "700c4-01"
    // Generated atomically via $inc on v2Company.aiAgentSettings.kcSeq at POST time.
    // IMMUTABLE after creation — never reused even if container is deleted.
    kcId: {
      type:   String,
      trim:   true,
      index:  true,
      comment: 'Auto-generated human-readable ID: {last5ofCompanyId}-{seq}. Immutable after creation.'
    },

    title: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 120,
      comment:   'Admin display name — short, topic-focused (e.g. "Residential Maintenance Visit", "Spring Tune-Up Special")'
    },

    category: {
      type:      String,
      default:   '',
      trim:      true,
      maxlength: 80,
      comment:   'Optional grouping label for UI organisation (e.g. "Services", "Specials", "Policies") — not used for agent matching'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // KNOWLEDGE SECTIONS — the rich content Groq reads
    // At least 1 section required. Admin adds as many as needed.
    // ─────────────────────────────────────────────────────────────────────────
    sections: {
      type:    [sectionSchema],
      default: [],
      comment: 'Flexible labelled content blocks. Groq reads all sections and synthesises within wordLimit.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // KEYWORDS — what the caller says to trigger this container
    // Scored at runtime by KnowledgeContainerService.findContainer()
    // ─────────────────────────────────────────────────────────────────────────
    keywords: {
      type:    [String],
      default: [],
      comment: 'Trigger phrases — what a caller might say when asking about this topic. Auto-generate via POST .../generate-keywords.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // RESPONSE SETTINGS — per-container overrides
    // ─────────────────────────────────────────────────────────────────────────
    wordLimit: {
      type:    Number,
      default: null,
      min:     5,
      max:     300,
      comment: 'Max words Groq may use in its response. null = use company knowledgeBaseSettings.defaultWordLimit.'
    },

    bookingAction: {
      type:    String,
      enum:    ['offer_to_book', 'advisor_callback', 'none'],
      default: 'offer_to_book',
      comment: 'What happens after Groq answers: offer booking, collect callback info, or nothing.'
    },

    // Optional follow-up guidance for Groq. When set, Groq closes in the spirit
    // of this phrase instead of its generic "invite to schedule" default.
    // Ignored when bookingAction = 'none' or 'fixed'.
    // Example: "Want me to get you signed up today, or do you have any questions?"
    closingPrompt: {
      type:      String,
      default:   '',
      trim:      true,
      maxlength: 400,
      comment:   'Suggested closing / follow-up language for Groq to adapt after answering. Leave blank for Groq default.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // SEMANTIC EMBEDDING — for keyword health / conflict detection
    // Generated automatically on save via KCKeywordHealthService.
    // select: false keeps the large float array out of regular queries.
    // ─────────────────────────────────────────────────────────────────────────
    embeddingVector: {
      type:    [Number],
      default: undefined,
      select:  false,
      comment: 'text-embedding-3-small 512-dim vector of title+sections. Used for semantic conflict detection.'
    },

    embeddingUpdatedAt: {
      type:    Date,
      default: undefined,
      comment: 'Timestamp of last embedding generation. Stale if older than updatedAt.'
    },

    // ─────────────────────────────────────────────────────────────────────────
    // STATE & ORDERING
    // ─────────────────────────────────────────────────────────────────────────
    isActive: {
      type:    Boolean,
      default: true,
      index:   true,
      comment: 'Master toggle — false = container exists but will not be matched at runtime'
    },

    priority: {
      type:    Number,
      default: 100,
      min:     1,
      comment: 'Sort order when multiple containers are loaded — lower = higher priority in tie-breaking'
    }
  },
  {
    timestamps: true,
    collection: 'companyKnowledgeContainers',  // explicit — never rely on mongoose plural inference
    versionKey: false
  }
);

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// Primary runtime query — active containers for a company, ordered by priority
companyKnowledgeContainerSchema.index({ companyId: 1, isActive: 1, priority: 1 });

// Admin lookup — by company and title
companyKnowledgeContainerSchema.index({ companyId: 1, title: 1 });

// Category filter — UI organisation and analytics
companyKnowledgeContainerSchema.index({ companyId: 1, category: 1 });

// kcId lookup — unique per company (sparse: containers created before this feature have no kcId)
companyKnowledgeContainerSchema.index({ companyId: 1, kcId: 1 }, { unique: true, sparse: true });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC HELPERS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * findActiveForCompany — Runtime query used by KnowledgeContainerService.
 * Returns all active containers for a company, sorted by priority then creation date.
 *
 * @param {string} companyId
 * @returns {Promise<Array>}
 */
companyKnowledgeContainerSchema.statics.findActiveForCompany = function (companyId) {
  return this.find({ companyId, isActive: true })
    .sort({ priority: 1, createdAt: 1 })
    .lean();
};

/**
 * findAllForCompany — Admin query — includes inactive containers.
 *
 * @param {string} companyId
 * @returns {Promise<Array>}
 */
companyKnowledgeContainerSchema.statics.findAllForCompany = function (companyId) {
  return this.find({ companyId })
    .sort({ priority: 1, createdAt: 1 })
    .lean();
};

module.exports = mongoose.model(
  'CompanyKnowledgeContainer',
  companyKnowledgeContainerSchema,
  'companyKnowledgeContainers'
);
