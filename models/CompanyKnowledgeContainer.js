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

// ─────────────────────────────────────────────────────────────────────────────
// PRE-QUALIFY OPTION SUB-SCHEMA (reused in sectionSchema)
// ─────────────────────────────────────────────────────────────────────────────
const preQualifyOptionSchema = new mongoose.Schema(
  {
    label:           { type: String, trim: true, default: '',  comment: 'Human-readable label for logs/UI. e.g. "Plan Member"' },
    value:           { type: String, trim: true, default: '',  comment: 'Stored in discoveryNotes.temp. e.g. "plan_member"' },
    keywords:        { type: [String], default: [],            comment: 'Caller phrases that match this option.' },
    responseContext: { type: String, trim: true, default: '',  comment: 'Injected into Groq prompt as CALLER TYPE.' },
  },
  { _id: false, versionKey: false }
);

// ─────────────────────────────────────────────────────────────────────────────
// UPSELL ITEM SUB-SCHEMA (reused in sectionSchema)
// ─────────────────────────────────────────────────────────────────────────────
const upsellItemSchema = new mongoose.Schema(
  {
    offerScript:   { type: String, trim: true, maxlength: 600, comment: 'Agent pitch — spoken verbatim.' },
    yesScript:     { type: String, trim: true, maxlength: 400, default: '', comment: 'Agent says when caller accepts.' },
    noScript:      { type: String, trim: true, maxlength: 400, default: '', comment: 'Agent says when caller declines.' },
    itemKey:       { type: String, trim: true, default: '',    comment: 'Tracking key written to discoveryNotes.' },
    price:         { type: Number, default: null,              comment: 'Optional price in dollars for tracking.' },
    offerAudioUrl: { type: String, default: null,              comment: 'Pre-cached audio URL for the offer script (from Generate Audio).' },
    yesAudioUrl:   { type: String, default: null,              comment: 'Pre-cached audio URL for the yes response script.' },
    noAudioUrl:    { type: String, default: null,              comment: 'Pre-cached audio URL for the no response script.' },
  },
  { _id: true, versionKey: false }
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION SUB-SCHEMA — each section is an independently routable knowledge unit
// ─────────────────────────────────────────────────────────────────────────────
//
// ROUTING:  daSubTypeKey links this section to a UAP array sub-type.
//           When UAP resolves daSubType === section.daSubTypeKey, the agent
//           routes here and reads ONLY this section's content.
//           Set automatically by the Auto-label button.
//
// FLOW:     Agent lands on this section → pre-qualify fires (if text set)
//           → Groq answers from this section's content → upsell fires (if items)
//           → booking. If pre/post fields are empty, straight answer.
// ─────────────────────────────────────────────────────────────────────────────

const sectionSchema = new mongoose.Schema(
  {
    label: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 80,
      comment:   'Section heading (e.g. "Price", "What\'s Included", "Warranty")'
    },
    content: {
      type:      String,
      required:  true,
      trim:      true,
      maxlength: 2000,
      comment:   'Knowledge content — Groq reads this and synthesises within word limit.'
    },
    order: {
      type:    Number,
      default: 0,
      comment: 'Display and injection order — lower = earlier'
    },

    // ── UAP routing key ────────────────────────────────────────────────────
    // Set by Auto-label button. Links this section to UAPArray.daSubTypes[].key.
    // null = section not yet classified; not reachable via UAP zero-latency routing.
    daSubTypeKey: {
      type:    String,
      default: null,
      trim:    true,
      comment: 'UAP daSubType key that routes here (e.g. "_pricing", "_included"). Set by Auto-label.'
    },

    // ── Per-section booking action ─────────────────────────────────────────
    // Overrides container-level bookingAction for this specific section.
    // null = inherit container default.
    bookingAction: {
      type:    String,
      enum:    ['offer_to_book', 'advisor_callback', 'none', null],
      default: null,
      comment: 'Per-section booking action override. null = use container default.'
    },

    // ── Per-section Fixed Response Mode ───────────────────────────────────
    // When true, Groq is bypassed for this specific section.
    // Only fires when UAP routes a call to this section via daSubTypeKey.
    // Audio is pre-cached on save (kind: 'KC_RESPONSE').
    // Falls through to Groq gracefully if content is missing.
    // Independent of container.useFixedResponse — each section decides for itself.
    useFixedResponse: {
      type:    Boolean,
      default: false,
      comment: 'Per-section: bypass Groq when UAP routes here — reads content verbatim with pre-cached audio.'
    },
    audioUrl: {
      type:    String,
      default: null,
      comment: 'Pre-cached audio URL for section content (shown/generated when useFixedResponse is true).'
    },

    // ── Pre-qualify question (optional) ───────────────────────────────────
    // Agent asks this BEFORE answering this section's content.
    // Caller's answer is matched to options[].keywords → responseContext injected into Groq.
    // State tracked per-call via Redis: kc-prequal:{companyId}:{callSid}
    // Engine: KCDiscoveryRunner GATE 3.5 / _handlePrequalResponse
    preQualifyQuestion: {
      enabled: {
        type:    Boolean,
        default: true,
        comment: 'Toggle — false means agent reads text content above, ignores pre-qualify. Data is preserved either way.'
      },
      text: {
        type:      String,
        default:   '',
        trim:      true,
        maxlength: 300,
        comment:   'Question spoken by agent before answering. e.g. "Are you a plan member?"'
      },
      audioUrl: {
        type:    String,
        default: null,
        comment: 'Pre-cached audio URL for the pre-qualify question (from Generate Audio).'
      },
      fieldKey: {
        type:    String,
        default: 'preQualifyAnswer',
        trim:    true,
        comment: 'Key written to discoveryNotes.temp. Keep unique across sections.'
      },
      options: { type: [preQualifyOptionSchema], default: [] },
    },

    // ── Upsell chain (optional) ────────────────────────────────────────────
    // Sequential add-on offers pitched AFTER Groq returns BOOKING_READY.
    // Each offer fires on its own turn. YES → next. Chain exhausted → booking.
    // State tracked per-call via Redis: kc-upsell:{companyId}:{callSid}
    // Engine: KCDiscoveryRunner GATE 4.5 / _handleUpsellResponse
    upsellChain: { type: [upsellItemSchema], default: [] },
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

    negativeKeywords: {
      type:    [String],
      default: [],
      comment: 'Exclusion phrases — if ANY of these appear in the caller\'s utterance, this container is immediately excluded from scoring for that turn. Use to prevent containers with broad positive keywords from firing on unrelated topics. E.g. "System Replacement" container adds negativeKeywords: ["maintenance", "tune-up"] to stop matching maintenance price questions.'
    },

    sampleQuestions: {
      type:    [String],
      default: [],
      comment: 'Example caller utterances generated alongside trigger keywords (Auto-Generate from Content). Persisted so they survive page reloads and can be used for future QA/analytics.'
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

    wordLimitEnabled: {
      type:    Boolean,
      default: true,
      comment: 'When false, the word cap is omitted from the Groq prompt — no hard ceiling, style multiplier still applies.'
    },

    // ── FIXED RESPONSE MODE ────────────────────────────────────────────────
    // When true, Groq is bypassed entirely. The agent reads the first section's
    // content verbatim. The companyKnowledge route pre-generates audio on save
    // (kind: 'KC_RESPONSE') so the runtime plays a cached MP3 — same zero-latency
    // path as Pricing Interceptor. Word limit, sample response, and closing prompt
    // are ignored in fixed mode. bookingAction still applies after the response.
    // ──────────────────────────────────────────────────────────────────────────
    useFixedResponse: {
      type:    Boolean,
      default: false,
      comment: 'When true, bypasses Groq. Agent reads Section 1 content verbatim. Enables instant audio pre-caching — same latency as Pricing Interceptor. Word limit and sample response are ignored.'
    },

    sampleResponse: {
      type:      String,
      default:   null,
      trim:      true,
      maxlength: 600,
      comment:   'Ideal example answer for this container. Injected into Groq prompt as a length/tone guardrail — shows Groq exactly what a perfect response looks like.'
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

    // How many pronoun-only follow-up turns to stay anchored to this container.
    // When the caller asks "what does it include?" without repeating the topic,
    // SPFUQ keeps Groq in this container. This field controls the max depth.
    // null = use system default (4 turns). Admin can set per topic:
    //   2 = Short  (simple topics — price check, one-liner answer)
    //   4 = Standard (default — general Q&A topics)
    //   6 = Deep (complex topics — multi-option services, pricing tiers)
    followUpDepth: {
      type:    Number,
      default: null,
      min:     2,
      max:     6,
      comment: 'Max SPFUQ follow-up turns (pronoun resolution depth). null = system default (4). Options: 2 Short, 4 Standard, 6 Deep.'
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
    // UAP CLASSIFICATION — which daType array this container maps to
    // Set manually from UI or auto-generated via POST .../auto-classify.
    // Runtime Bridge uses this for zero-latency intent routing.
    // ─────────────────────────────────────────────────────────────────────────

    // The UAP daType this container belongs to (e.g. 'PRICING_QUERY', 'AVAILABILITY_QUERY').
    // null = unclassified → runtime falls through to Gate 3 keyword scoring.
    daType: {
      type:    String,
      default: null,
      trim:    true,
      comment: 'UAP daType key — links this container to a UAPArray. null = unclassified.'
    },

    // Sub-type keys within the daType array that point back to this container.
    // Populated by the auto-classify route → upserted onto the UAPArray.daSubTypes[].attachedTo[].
    daSubTypes: {
      type:    [String],
      default: [],
      comment: 'UAPArray daSubType keys that reference this container. Set by auto-classify.'
    },

    // Classification provenance — how the daType was determined.
    classificationStatus: {
      type:    String,
      enum:    ['AUTO_CONFIRMED', 'MANUAL', 'PENDING', 'UNCLASSIFIED'],
      default: 'UNCLASSIFIED',
      index:   true,
      comment: 'How daType was set: AUTO_CONFIRMED=Groq inferred, MANUAL=owner set, PENDING=needs review, UNCLASSIFIED=not yet set.'
    },

    // Groq confidence score (0–1) from auto-classify — null if manually set.
    classificationScore: {
      type:    Number,
      default: null,
      comment: 'Auto-classify confidence score (0–1). null if manually classified.'
    },

    // Timestamp of last auto-classify run.
    autoClassifiedAt: {
      type:    Date,
      default: null,
      comment: 'Timestamp of last successful auto-classify run.'
    },

    // Trigger phrases generated by last auto-classify run — persisted so they
    // survive page reload without a separate UAPArray fetch.
    triggerPhrases: {
      type:    [String],
      default: [],
      comment: 'Caller trigger phrases from last auto-classify. Mirrors UAPArray sub-type phrases.'
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

// UAP Bridge lookup — find all containers for a company + daType (zero-latency routing)
companyKnowledgeContainerSchema.index({ companyId: 1, daType: 1, isActive: 1 });

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
