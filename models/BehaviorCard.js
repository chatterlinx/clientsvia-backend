'use strict';

/**
 * ============================================================================
 * BEHAVIOR CARD MODEL  (BC)
 * ============================================================================
 *
 * PURPOSE:
 *   Behavior Cards govern HOW the agent operates in a given situation.
 *   They are completely distinct from Knowledge Cards (KC), which govern
 *   WHAT the agent knows.
 *
 *   KC answers the question.
 *   BC governs how the answer is delivered — tone, rules, do/do-not, and
 *   example responses Groq calibrates from.
 *
 * TWO TYPES:
 *
 *   category_linked
 *     One BC per KC category, shared across every KC card in that category.
 *     Edit once — behavior updates across all KC cards in the category.
 *     Example: "Pricing & Trust Behavior" governs all pricing KC cards.
 *
 *   standalone
 *     Governs call flow scenarios that have no KC card underneath.
 *     Examples: inbound_greeting, discovery_flow, escalation_ladder,
 *               after_hours_intake, mid_flow_interrupt.
 *
 *     NOTE: standalone BC documents are stored but not yet consumed by any
 *     engine flow. forStandalone() in BehaviorCardService is built and ready —
 *     wire it when building each standalone scenario (build steps 8b–11 in
 *     the platform build plan). Category-linked BC is fully wired today.
 *
 * UNIQUENESS:
 *   One category_linked BC per company per category.
 *   One standalone BC per company per standaloneType.
 *   Enforced at the database layer via unique partial indexes.
 *
 * MULTI-TENANT SAFETY:
 *   Every document is scoped by companyId.
 *   Compound indexes enforce isolation at the database layer.
 *   Service methods refuse to query without companyId.
 *
 * COLLECTION: behaviorCards  (explicit — never relies on Mongoose pluralization)
 *
 * RELATED:
 *   Service:   services/behaviorCards/BehaviorCardService.js
 *   Routes:    routes/admin/behaviorCards.js
 *   UI:        public/agent-console/enginehub.html  (Behavior Cards tab)
 * ============================================================================
 */

const mongoose = require('mongoose');

// ============================================================================
// CONSTANTS  (exported for use in routes and services)
// ============================================================================

/**
 * Valid values for standaloneType.
 * Each type maps to a specific call flow scenario.
 */
const STANDALONE_TYPES = [
  'inbound_greeting',     // First words on every inbound call
  'discovery_flow',       // Collecting name, address, issue, urgency
  'escalation_ladder',    // Distress handling, manager request, transfer logic
  'after_hours_intake',   // Caller reaches agent outside business hours
  'mid_flow_interrupt',   // Caller injects a question into an active flow
  'payment_routing',      // Payment-related interaction handling
  'manager_request'       // Caller explicitly asks to speak to a manager
];

// ============================================================================
// SCHEMA
// ============================================================================

const behaviorCardSchema = new mongoose.Schema({

  // ── Multi-tenant isolation ──────────────────────────────────────────────────
  // REQUIRED. Every query MUST include companyId.
  // The service layer enforces this. The database layer enforces it via indexes.
  companyId: {
    type:     String,
    required: true,
    trim:     true,
    index:    true,
    comment:  'Tenant scope. Every query filters by this field. Never unscoped reads.'
  },

  // ── Identity ────────────────────────────────────────────────────────────────
  name: {
    type:      String,
    required:  true,
    trim:      true,
    maxlength: 120,
    comment:   'Human-readable display name. e.g. "Pricing & Trust Behavior"'
  },

  // ── Card type ────────────────────────────────────────────────────────────────
  type: {
    type:     String,
    required: true,
    enum:     ['category_linked', 'standalone'],
    comment:  'category_linked: shared across all KC cards in a KC category. standalone: governs a specific call flow scenario.'
  },

  // ── Category link  (category_linked type only) ───────────────────────────────
  // Must match the `category` field on CompanyKnowledgeContainer documents exactly.
  // Empty string '' for standalone type.
  category: {
    type:    String,
    default: '',
    trim:    true,
    comment: 'KC category this BC governs. Exact match against KnowledgeContainer.category.'
  },

  // ── Standalone type  (standalone type only) ──────────────────────────────────
  // Null for category_linked type.
  standaloneType: {
    type:    String,
    enum:    [...STANDALONE_TYPES, null],
    default: null,
    comment: 'The specific call flow scenario this BC governs. Null for category_linked.'
  },

  // ── Behavior rules ────────────────────────────────────────────────────────────
  // These fields are injected into the Groq system prompt on every relevant turn.
  // Groq reads them to calibrate tone, apply restrictions, and shape the response.
  // AI-generated via POST /generate endpoint in behaviorCards.js — owners review/edit.

  tone: {
    type:      String,
    default:   '',
    trim:      true,
    maxlength: 400,
    comment:   'Free text tone descriptor. e.g. "Direct and confident. Never apologetic about pricing."'
  },

  rules: {

    // What the agent MUST do in this situation
    do: {
      type:    [String],
      default: [],
      comment: 'Affirmative behavioral rules. e.g. ["Answer the exact dollar amount", "Move back to booking immediately after"]'
    },

    // What the agent must NEVER do in this situation
    doNot: {
      type:    [String],
      default: [],
      comment: 'Prohibition rules. e.g. ["Never volunteer extra pricing not asked about", "Never apologize for the cost"]'
    },

    // Model spoken responses — Groq calibrates voice register and length from these.
    // These are the single most powerful calibration signal — two good examples
    // teach Groq more about expected length and tone than any amount of rules.
    exampleResponses: {
      type:    [String],
      default: [],
      comment: 'Example utterances showing correct tone, length, and pivot pattern. Groq pattern-matches these.'
    }
  },

  // ── Status ─────────────────────────────────────────────────────────────────────
  enabled: {
    type:    Boolean,
    default: true,
    index:   true,
    comment: 'When false, this BC is ignored by the engine. Useful for drafting without activating.'
  }

}, {
  timestamps:  true,
  collection:  'behaviorCards',   // Explicit collection name — never Mongoose auto-pluralization
  versionKey:  false
});

// ============================================================================
// INDEXES
// All indexes lead with companyId — enforces multi-tenant isolation at DB layer.
// ============================================================================

// Primary runtime lookup: category_linked BC by company + category
behaviorCardSchema.index(
  { companyId: 1, type: 1, category: 1 },
  { name: 'idx_bc_company_type_category', background: true }
);

// Primary runtime lookup: standalone BC by company + standaloneType
behaviorCardSchema.index(
  { companyId: 1, standaloneType: 1 },
  { name: 'idx_bc_company_standalone', background: true }
);

// Uniqueness: one category_linked BC per company per category
behaviorCardSchema.index(
  { companyId: 1, category: 1 },
  {
    unique:                  true,
    sparse:                  true,
    partialFilterExpression: { type: 'category_linked' },
    name:                    'idx_bc_unique_category_linked',
    background:              true
  }
);

// Uniqueness: one standalone BC per company per standaloneType
behaviorCardSchema.index(
  { companyId: 1, standaloneType: 1 },
  {
    unique:                  true,
    sparse:                  true,
    partialFilterExpression: { type: 'standalone', standaloneType: { $ne: null } },
    name:                    'idx_bc_unique_standalone',
    background:              true
  }
);

// ============================================================================
// STATICS
// Convenience query methods — always include companyId for tenant safety.
// ============================================================================

/**
 * findForCategory — Load the Behavior Card for a given KC category.
 *
 * Called by KnowledgeContainerService.answer() when delivering a KC response.
 * Returns null if no BC is configured for this category — engine degrades
 * gracefully (Groq responds without BC behavior rules).
 *
 * @param  {string}          companyId
 * @param  {string}          category   Must match KnowledgeContainer.category exactly
 * @returns {Promise<Object|null>}
 */
behaviorCardSchema.statics.findForCategory = function (companyId, category) {
  return this.findOne({
    companyId,
    type:     'category_linked',
    category,
    enabled:  true
  }).lean();
};

/**
 * findStandalone — Load a standalone Behavior Card by standaloneType.
 *
 * Called by BehaviorCardService.forStandalone(). Service is built and ready.
 * Wire call sites when building each standalone scenario:
 *   - inbound_greeting   → HybridReceptionistLLM.js (build step 11)
 *   - discovery_flow     → DiscoveryNotesService (build step 11)
 *   - escalation_ladder  → escalation engine (build step 8c)
 *   - after_hours_intake → v2twilio.js after-hours gate (build step TBD)
 *   - mid_flow_interrupt → ConversationEngine.js (build step TBD)
 *
 * Returns null if not configured — engine degrades gracefully.
 *
 * @param  {string}          companyId
 * @param  {string}          standaloneType   One of STANDALONE_TYPES
 * @returns {Promise<Object|null>}
 */
behaviorCardSchema.statics.findStandalone = function (companyId, standaloneType) {
  return this.findOne({
    companyId,
    type:          'standalone',
    standaloneType,
    enabled:       true
  }).lean();
};

// ============================================================================
// EXPORTS
// ============================================================================

const BehaviorCard = mongoose.model('BehaviorCard', behaviorCardSchema, 'behaviorCards');

module.exports                  = BehaviorCard;
module.exports.STANDALONE_TYPES = STANDALONE_TYPES;
