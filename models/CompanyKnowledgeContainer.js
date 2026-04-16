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
 * MATCHING (anchor-word gate + phrase intelligence):
 *   Gate pre:  Anchor check — ANY anchorWord from matched phrase's anchorWords[] must appear
 *              in caller utterance → <0.1ms. Sections/phrases with no anchorWords skip gate.
 *   Logic 1:   Phrase match — direct (UAP phraseIndex) + fuzzy (token/phonetic) → <1ms
 *   Logic 2:   Core confirmation — cosine(topicWordsEmb, phraseCoreEmbedding) → ~30ms
 *   Fork:      combined(Logic1 × 0.6 + Logic2 × 0.4) ≥ 0.90 → fire | below → Groq
 *   Gate 2.8:  Semantic fallback → ~50ms
 *   Gate 3:    Keyword fallback → <1ms
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
// CALLER PHRASE SUB-SCHEMA (embedded in sectionSchema.callerPhrases[])
// ─────────────────────────────────────────────────────────────────────────────
const callerPhraseSchema = new mongoose.Schema(
  {
    text:      { type: String, required: true, trim: true, maxlength: 200, comment: 'Full caller sentence, e.g. "I want someone to come out"' },
    embedding: { type: [Number], default: undefined, select: false, comment: '512-dim embedding from text-embedding-3-small. Auto-generated on save.' },
    addedAt:   { type: Date, default: Date.now, comment: 'When this phrase was added' },
    // ── Anchor words — admin-defined discriminating gate terms for this phrase ──
    // Admin double-clicks individual words inside this phrase to mark them as
    // anchor words (orange highlight in UI). At runtime, if anchorWords is non-empty,
    // at least ONE of these words must be present in the caller's utterance for this
    // phrase to qualify. Multiple anchor words can be set independently per phrase.
    // Phrases with an empty anchorWords[] skip the anchor gate entirely.
    anchorWords: {
      type:    [String],
      default: [],
      comment: 'Discriminating words in this phrase. At least one must appear in utterance. [] = no gate.'
    },

    // ── Persisted 3TSM score (written by phrase-score endpoint on Re-score) ──
    score: {
      type: {
        t1:       { type: Number, default: null },
        t1Source: { type: String, default: null },  // 'phrases' | 'content'
        t2:       { type: Number, default: null },
        t3:       { type: Boolean, default: null },
        t3Score:  { type: Number, default: null },
        tc:       { type: Number, default: null },  // topic correlation: phrase core vs content core
        core:     { type: String, default: null },
        status:   { type: String, default: null },  // 'green'|'yellow'|'orange'|'red'
        scoredAt: { type: Date,   default: null },
        normalizedPatterns: {
          type: [{
            pattern: { type: String },
            token:   { type: String },
          }],
          default: undefined,
          comment: 'Intent normalizer matches — e.g. [{pattern:"can you",token:"requestCue"}]. Persisted for UI display.'
        },
      },
      default: null,
      comment: 'Last 3TSM score result — persisted so UI shows scores without re-scoring.'
    },
  },
  { _id: false, versionKey: false }
);

// ─────────────────────────────────────────────────────────────────────────────
// SECTION SUB-SCHEMA — each section is an independently routable knowledge unit
// ─────────────────────────────────────────────────────────────────────────────
//
// ROUTING:  callerPhrases[] → BridgeService builds phraseIndex → UAP matches
//           caller utterance against callerPhrases. Match → routes directly
//           to this section. No more daSubTypeKey / UAPArray indirection.
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
    groqContent: {
      type:      String,
      trim:      true,
      maxlength: 4000,
      default:   '',
      comment:   'Rich detailed source material for Groq (up to 4000 chars). When non-empty, Groq reads this instead of content. Fixed mode always uses content.'
    },
    order: {
      type:    Number,
      default: 0,
      comment: 'Display and injection order — lower = earlier'
    },

    // ── Section Active Toggle ──────────────────────────────────────────────
    // Allows business owners to disable a section without deleting it.
    // Inactive sections are skipped during KC scoring, UAP phrase indexing,
    // and Groq prompt building. Content is preserved for easy re-enable.
    isActive: {
      type:    Boolean,
      default: true,
      comment: 'Per-section on/off toggle. false = skipped at runtime, content preserved.'
    },

    // ── Caller Phrases — what callers say when asking about this section ──
    // Each phrase is a full sentence (e.g. "how much is a service call?").
    // BridgeService indexes these into phraseIndex for UAP matching.
    // Embeddings auto-generated on save via SemanticMatchService.
    callerPhrases: { type: [callerPhraseSchema], default: [] },

    // ── Auto-extracted content keywords (bigrams from section content) ────
    // Used by Gate 3 keyword fallback when UAP + semantic miss.
    // Regenerated on every save — no manual management.
    contentKeywords: {
      type:    [String],
      default: [],
      comment: 'Auto-extracted bigrams from section label + content. Regenerated on save.'
    },

    // ── Per-section exclusion keywords ─────────────────────────────────────
    // If ANY of these words/phrases appear in the caller's utterance, this
    // section is skipped during keyword scoring — even if contentKeywords match.
    // Supports single words ("repair") and multi-word phrases ("ac repair").
    negativeKeywords: {
      type:    [String],
      default: [],
    },

    // ── Trade Terms — admin-curated trade-specific vocabulary ────────────
    // Per-section nouns/phrases callers use when asking about this topic.
    // Used by CueExtractor for tradeCore matching at runtime.
    // Examples: "ac maintenance", "duct cleaning", "service call", "thermostat"
    tradeTerms: {
      type:    [String],
      default: [],
      comment: 'Admin-curated trade-specific terms for this section. Used by CueExtractor for tradeCore routing.'
    },

    // ── Content embedding — for semantic matching ────────────────────────
    // 512-dim vector of section content, used by SemanticMatchService.
    // Auto-generated on save. select: false keeps it out of regular queries.
    contentEmbedding: {
      type:    [Number],
      default: undefined,
      select:  false,
      comment: '512-dim embedding of section content. Auto-generated on save.'
    },
    contentEmbeddingAt: {
      type:    Date,
      default: undefined,
      comment: 'Timestamp of last content embedding. Stale if older than section updatedAt.'
    },

    // ── Content Core — PhraseReducer applied to section content ──────────
    // Computed on Re-score alongside phrase scores. Used as TC comparison target.
    contentCore: {
      type:    String,
      default: null,
      comment: 'Reduced core of section content — key topic terms stripped of stop words.'
    },
    contentCoreScoredAt: {
      type:    Date,
      default: null,
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
    // Only fires when UAP routes a call to this section via callerPhrases.
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

    // ── Per-section Promotion Flag ──────────────────────────────────────
    // Tags this section as a live promotion. Promotions appear on the admin
    // Knowledge Base listing as a summary card (Live Promotions).
    // Runtime promo-list behavior is built separately on top of this flag.
    isPromotion: {
      type:    Boolean,
      default: false,
      comment: 'Per-section: tag as live promotion. Shows in admin Live Promotions card.'
    },
    promotionLabel: {
      type:      String,
      default:   '',
      trim:      true,
      maxlength: 120,
      comment:   'Short promo title (e.g. "Spring Tune-Up — $49"). Falls back to section label if empty.'
    },

    // ── Phrase Core — run summary of all callerPhrases ───────────────────
    // PhraseReducerService applied to all phrase texts combined.
    // Computed on Re-score. Used as Logic 2 target for runtime gate.
    // Distinct from contentCore (which comes from section content text).
    phraseCore: {
      type:    String,
      default: null,
      comment: 'Reduced semantic core of all callerPhrases combined. Logic 2 comparison target.'
    },
    phraseCoreEmbedding: {
      type:    [Number],
      default: undefined,
      select:  false,
      comment: '512-dim embedding of phraseCore. Used by Logic 2 runtime gate. select:false keeps it out of regular queries.'
    },
    phraseCoreScoredAt: {
      type:    Date,
      default: null,
      comment: 'Timestamp of last phraseCore computation.'
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

    // DEPRECATED — exclusion keywords are now per-SECTION (section.negativeKeywords).
    // This container-level field is kept for backward compatibility but is no longer
    // populated by the UI or checked by the scoring engine.
    negativeKeywords: {
      type:    [String],
      default: [],
      comment: 'DEPRECATED — use section.negativeKeywords instead. Legacy container-level exclusion phrases.'
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
      comment:   'Response style guide — coaching directives (tone, key facts, offers, avoidances) injected into Groq prompt as a guardrail for how to answer.'
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
    },

    // ── No-Anchor Flag — prevents this container from becoming the anchor ──
    // When true, this container's _id is NEVER written to anchorContainerId
    // in discoveryNotes. Used for "meta" containers (e.g. Conversational Recovery)
    // that handle caller friction/emotions — if these become anchor, the 3×
    // keyword boost drowns out real HVAC matches for the rest of the call.
    noAnchor: {
      type:    Boolean,
      default: false,
      comment: 'When true, matching this container does NOT set anchorContainerId. Prevents poisoning anchor for meta-conversation containers.'
    },

    // ── Trade Vocabulary Link — reference to GlobalShare trade vocabulary ──
    // Links this container to a shared industry vocabulary (e.g. "HVAC", "PLUMBING").
    // CueExtractor reads terms from the global library at runtime — no copying.
    // Null = no link, falls back to per-section tradeTerms[] only.
    tradeVocabularyKey: {
      type:    String,
      default: null,
      comment: 'Key linking to GlobalShare trade vocabulary. CueExtractor reads global terms for this container.'
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

// (daType index removed — callerPhrases are now indexed in BridgeService phraseIndex)

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
