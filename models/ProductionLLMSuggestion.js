/**
 * ============================================================================
 * PRODUCTION LLM SUGGESTION MODEL - V2 ENHANCED
 * ============================================================================
 * 
 * PURPOSE: Store LLM-generated suggestions from production calls
 * VERSION: 2.0 - Comprehensive latency tracking + multi-source support
 * 
 * KEY FEATURES:
 * - Template + company tracking
 * - Call source differentiation (template-test, company-test, production)
 * - Full tier routing analysis (scores, thresholds, latency)
 * - Dead air / customer wait time tracking
 * - Rich suggestion metadata (type, priority, changes)
 * - Admin workflow (pending, applied, rejected, snoozed)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');

const { Schema } = mongoose;

const ProductionLLMSuggestionSchema = new Schema(
  {
    // ========================================================================
    // WHAT TEMPLATE / COMPANY
    // ========================================================================
    templateId: { 
      type: Schema.Types.ObjectId, 
      ref: 'GlobalInstantResponseTemplate', 
      required: true,
      index: true
    },
    templateName: { 
      type: String, 
      required: true 
    },

    companyId: { 
      type: Schema.Types.ObjectId, 
      ref: 'v2Company', 
      default: null,
      index: true
    },
    companyName: { 
      type: String, 
      default: null 
    },

    // ========================================================================
    // WHERE DID THIS CALL COME FROM?
    // ========================================================================
    // - template-test  => Global AI Brain test pilot
    // - company-test   => Test Pilot company mode
    // - production     => real customer calls
    callSource: {
      type: String,
      enum: ['template-test', 'company-test', 'production'],
      default: 'production',
      required: true,
      index: true,
    },

    // ========================================================================
    // CALL IDENTITY & TIMING
    // ========================================================================
    callId: { 
      type: String, 
      index: true 
    }, // internal call id
    
    callSid: { 
      type: String, 
      index: true 
    }, // Twilio SID if available
    
    callDate: { 
      type: Date, 
      default: Date.now, 
      required: true,
      index: true 
    },

    // ========================================================================
    // TIER ROUTING INFO
    // ========================================================================
    tierPath: {
      type: String, // e.g. "tier1", "tier2", "tier3"
      default: 'tier3',
    },
    
    tier1Score: { type: Number },
    tier2Score: { type: Number },
    tier1Threshold: { type: Number },
    tier2Threshold: { type: Number },

    // ========================================================================
    // LATENCY / CUSTOMER WAIT TIME
    // ========================================================================
    tier1LatencyMs: { type: Number },
    tier2LatencyMs: { type: Number },
    tier3LatencyMs: { type: Number },
    totalResponseLatencyMs: { type: Number }, // full time between caller speech and reply
    deadAirMs: { type: Number }, // estimated "silence" time

    // ========================================================================
    // WHAT THE CALLER SAID + TRANSCRIPT
    // ========================================================================
    customerPhrase: { 
      type: String,
      required: true
    }, // the exact utterance that caused Tier 3
    
    fullCallTranscript: { type: String },

    // ========================================================================
    // WHERE IN THE TEMPLATE THIS SUGGESTION APPLIES
    // ========================================================================
    targetCategory: { type: String },
    targetScenario: { type: String },
    scenarioId: { type: String }, // your internal scenario key
    targetField: {
      type: String,
      enum: ['keyword', 'synonym', 'filler', 'scenario', 'reply', 'meta', 'other'],
      default: 'keyword',
    },

    // ========================================================================
    // SUGGESTION SEMANTICS
    // ========================================================================
    suggestionType: {
      type: String,
      enum: [
        'ADD_KEYWORDS',
        'ADD_SYNONYMS',
        'ADD_FILLERS',
        'NEW_SCENARIO',
        'UPDATE_SCENARIO',
        'MERGE_SCENARIOS',
        'DELETE_SCENARIO',
        'TWEAK_REPLY_TONE',
        'ADD_EDGE_CASE',
        'LATENCY_WARNING',
        'OVERLAP_WARNING',
        'OTHER',
      ],
      default: 'OTHER',
      required: true,
      index: true,
    },

    suggestionSummary: { 
      type: String,
      required: true
    }, // short human summary for list view
    
    suggestedChanges: [{ type: String }], // concrete things to add/update/delete

    // ========================================================================
    // DEEP EXPLANATION
    // ========================================================================
    rootCauseReason: { 
      type: String 
    }, // "why this fired", human readable

    // ========================================================================
    // LLM META
    // ========================================================================
    llmModel: { 
      type: String,
      required: true
    },
    
    llmResponse: { type: String }, // raw text from Tier 3 if helpful
    tokens: { type: Number },
    costUsd: { 
      type: Number, 
      default: 0,
      min: 0,
      required: true
    },

    // ========================================================================
    // PRIORITY & STATUS TRACKING
    // ========================================================================
    priority: {
      type: String,
      enum: ['low', 'medium', 'high', 'critical'],
      default: 'medium',
      required: true,
      index: true,
    },
    
    status: {
      type: String,
      enum: ['pending', 'applied', 'rejected', 'snoozed'],
      default: 'pending',
      required: true,
      index: true,
    },
    
    snoozeUntil: { type: Date },

    // ========================================================================
    // ADMIN AUDIT INFO
    // ========================================================================
    reviewedBy: { type: String },
    appliedBy: { type: String },
    appliedAt: { type: Date },
    rejectedBy: { type: String },
    rejectedReason: { type: String },
  },
  {
    timestamps: true, // createdAt, updatedAt
  }
);

// ============================================================================
// INDEXES FOR PERFORMANCE
// ============================================================================

// Main console query (template + status + priority)
ProductionLLMSuggestionSchema.index({ 
  templateId: 1, 
  status: 1, 
  priority: -1, 
  callDate: -1 
});

// Call source filtering
ProductionLLMSuggestionSchema.index({ 
  callSource: 1, 
  callDate: -1 
});

// Company-specific queries
ProductionLLMSuggestionSchema.index({ 
  companyId: 1, 
  status: 1, 
  callDate: -1 
});

// Cost analytics queries
ProductionLLMSuggestionSchema.index({ 
  callDate: -1, 
  costUsd: 1 
});

// Duplicate detection
ProductionLLMSuggestionSchema.index({ 
  templateId: 1, 
  suggestionType: 1, 
  suggestionSummary: 1 
});

// Snoozed items query
ProductionLLMSuggestionSchema.index({ 
  status: 1, 
  snoozeUntil: 1 
});

module.exports = mongoose.model('ProductionLLMSuggestion', ProductionLLMSuggestionSchema);
