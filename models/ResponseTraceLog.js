/**
 * ============================================================================
 * RESPONSE TRACE LOG MODEL - TURN-BY-TURN CALL AUDIT TRAIL
 * ============================================================================
 * 
 * PURPOSE: Full transparency log for each conversation turn
 * ARCHITECTURE: Records entire decision chain for debugging, compliance, optimization
 * SCOPE: Per-company, per-call, per-turn structured logging
 * 
 * INTEGRATION: Written by orchestrationEngine.processCallerTurn via TraceLogger
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');

const Mixed = mongoose.Schema.Types.Mixed;

const ResponseTraceLogSchema = new mongoose.Schema(
  {
    traceId: { type: String, required: true, index: true }, // uuid
    callId: { type: String, required: true, index: true },   // Twilio CallSid or internal call id
    companyId: { type: String, required: true, index: true },

    // Turn metadata
    turnNumber: { type: Number, required: true },
    timestamp: { type: Date, default: Date.now, index: true },

    // Raw input from caller/agent at this turn
    input: {
      speaker: { type: String, enum: ['caller', 'agent'], required: true },
      text: { type: String },
      textCleaned: { type: String },
      sttMetadata: Mixed
    },

    // Frontline-Intel classification
    frontlineIntel: {
      intent: { type: String },
      confidence: { type: Number },
      signals: Mixed,
      entities: Mixed,
      metadata: Mixed
    },

    // LLM-0 orchestrator decision
    orchestratorDecision: {
      action: { type: String },          // e.g. 'ask_question', 'initiate_booking', 'answer_with_knowledge'
      nextPrompt: { type: String },
      updatedIntent: { type: String },
      updates: Mixed,                    // extracted flags, data, etc.
      knowledgeQuery: Mixed,
      debugNotes: { type: String }
    },

    // Knowledge lookup (3-Tier)
    knowledgeLookup: {
      triggered: { type: Boolean, default: false },
      result: Mixed,      // full KnowledgeResult contract
      reason: { type: String }
    },

    // Booking action
    bookingAction: {
      triggered: { type: Boolean, default: false },
      contactId: { type: String },
      locationId: { type: String },
      appointmentId: { type: String },
      result: { type: String, enum: ['success', 'failed', 'partial', null], default: null },
      error: { type: String }
    },

    // Output back to caller
    output: {
      agentResponse: { type: String },   // text we send to TTS
      action: { type: String },          // same as orchestratorDecision.action for now
      nextState: { type: String }        // currentIntent after this turn
    },

    // Performance timing (ms)
    performance: {
      frontlineIntelMs: { type: Number },
      orchestratorMs: { type: Number },
      knowledgeLookupMs: { type: Number },
      bookingMs: { type: Number },
      totalMs: { type: Number }
    },

    // Cost tracking (tokens / $ – keep it approximate if needed)
    cost: {
      frontlineIntel: { type: Number, default: 0 },
      orchestrator: { type: Number, default: 0 },
      knowledgeLookup: { type: Number, default: 0 },
      booking: { type: Number, default: 0 },
      total: { type: Number, default: 0 }
    },

    // Snapshot of context at this turn
    contextSnapshot: {
      currentIntent: { type: String },
      extractedData: Mixed,
      conversationLength: { type: Number },
      bookingReadiness: { type: Boolean }
    }
  },
  {
    timestamps: true
  }
);

// Common query patterns
ResponseTraceLogSchema.index({ callId: 1, turnNumber: 1 });
ResponseTraceLogSchema.index({ companyId: 1, timestamp: -1 });
ResponseTraceLogSchema.index({ 'orchestratorDecision.action': 1 });
ResponseTraceLogSchema.index({ 'cost.total': -1 });

module.exports = mongoose.model('ResponseTraceLog', ResponseTraceLogSchema);

