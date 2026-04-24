'use strict';

/**
 * ============================================================================
 * BEHAVIOR CARD MODEL  (BC)
 * ============================================================================
 *
 * PURPOSE:
 *   Behavior Cards govern HOW the agent operates in a given KC category.
 *   They are completely distinct from Knowledge Cards (KC), which govern
 *   WHAT the agent knows.
 *
 *   KC answers the question.
 *   BC governs how the answer is delivered — tone, rules, do/do-not, and
 *   example responses Groq calibrates from.
 *
 * SCOPE (April 2026):
 *   Only `category_linked` Behavior Cards remain. The `standalone` variant
 *   and its Engine Hub runtime (`EngineHubRuntime.getStandaloneBC`) were
 *   removed. Flow-level behavior (discovery, escalation, greeting, after
 *   hours, mid-flow interrupt, payment routing, manager request) now lives
 *   in `company.aiAgentSettings.llmAgent.behaviorRules[]` — edited in
 *   services.html Behavior tab and injected on every LLM call via
 *   composeSystemPrompt(). One home, broader coverage, simpler mental model.
 *
 * UNIQUENESS:
 *   One BC per company per KC category. Enforced at the DB layer via a
 *   unique partial index.
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
 *   UI:        public/agent-console/services.html  (Behavior Cards per KC category)
 * ============================================================================
 */

const mongoose = require('mongoose');

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
  // Kept as a discriminator for clean index semantics and future extensibility.
  // Only 'category_linked' is accepted after the April 2026 Engine Hub nuke.
  type: {
    type:     String,
    required: true,
    enum:     ['category_linked'],
    default:  'category_linked',
    comment:  'Shared across all KC cards in a KC category. Standalone BC type removed April 2026.'
  },

  // ── Category link ────────────────────────────────────────────────────────────
  // Must match the `category` field on CompanyKnowledgeContainer documents exactly.
  category: {
    type:     String,
    required: true,
    trim:     true,
    comment:  'KC category this BC governs. Exact match against KnowledgeContainer.category.'
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

// Primary runtime lookup: BC by company + category
behaviorCardSchema.index(
  { companyId: 1, type: 1, category: 1 },
  { name: 'idx_bc_company_type_category', background: true }
);

// Uniqueness: one BC per company per category
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

// ============================================================================
// EXPORTS
// ============================================================================

const BehaviorCard = mongoose.model('BehaviorCard', behaviorCardSchema, 'behaviorCards');

module.exports = BehaviorCard;
