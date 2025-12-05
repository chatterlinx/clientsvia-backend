/**
 * ============================================================================
 * BLACK BOX RECORDING - Enterprise Flight Recorder for AI Calls
 * ============================================================================
 * 
 * Like an airplane's CVR + FDR, but for AI phone calls.
 * Records EVERY decision point so we never have to guess what went wrong.
 * 
 * CAPTURES:
 * - Full timeline of events (append-only, immutable)
 * - Performance breakdown per turn
 * - Booking intent tracking (when did they ask vs when did we act)
 * - Diagnostic analysis (what went wrong + suggested fix)
 * - Visualization data for sequence diagrams, waterfall, decision tree
 * 
 * USED BY:
 * - BlackBoxLogger service (writes during call)
 * - black-box.html (list view)
 * - black-box-detail.html (detail view with visualizations)
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');
const Schema = mongoose.Schema;

// ============================================================================
// EVENT TYPES - What we log during a call
// ============================================================================
const EVENT_TYPES = [
  'CALL_START',
  'GREETING_SENT',
  'GATHER_PARTIAL',           // Optional: partial STT results
  'GATHER_FINAL',             // Final STT text from caller
  'FAST_MATCH_HIT',           // Triage keywords matched - no LLM needed
  'LLM_FALLBACK',             // Fast match failed - calling LLM
  'INTENT_DETECTED',          // LLM-0 / Brain-1 decision
  'TRIAGE_DECISION',          // Triage router result
  'CARD_MATCHED',             // Which triage card matched
  'TIER3_DECISION',           // 3-tier router decision
  'BOOKING_MODE_ACTIVATED',   // Committed to booking flow
  'BOOKING_STEP',             // Each booking step
  'AGENT_RESPONSE_BUILT',     // Full response text ready
  'AGENT_RESPONSE_VALIDATED', // ResponseValidator verdict
  'TTS_GENERATED',            // TTS complete with timing
  'LOOP_DETECTED',            // Loop detector fired
  'BEHAVIOR_EVENT',           // Silence, frustration, escalation
  'BAILOUT_TRIGGERED',        // Hard or soft bailout
  'TRANSFER_INITIATED',       // Transfer started
  'ERROR_OCCURRED',           // Exception/error
  'CALL_END'
];

// ============================================================================
// SCHEMA
// ============================================================================

const BlackBoxRecordingSchema = new Schema({
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTIFIERS
  // ─────────────────────────────────────────────────────────────────────────
  callId: { 
    type: String, 
    required: true,
    index: true 
  },
  companyId: { 
    type: Schema.Types.ObjectId, 
    required: true,
    index: true,
    ref: 'v2Company'
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // CUSTOMER CONTEXT (link to existing customer record)
  // ─────────────────────────────────────────────────────────────────────────
  customerId: { 
    type: Schema.Types.ObjectId, 
    ref: 'Customer' 
  },
  customerContext: {
    isReturning: Boolean,
    totalCalls: Number,
    customerName: String,
    phoneType: String  // 'mobile', 'landline', 'voip'
  },

  // ─────────────────────────────────────────────────────────────────────────
  // BASIC CALL METADATA
  // ─────────────────────────────────────────────────────────────────────────
  from: String,
  to: String,
  startedAt: Date,
  endedAt: Date,
  durationMs: Number,
  callOutcome: {
    type: String,
    enum: ['COMPLETED', 'TRANSFERRED', 'HUNG_UP', 'ABANDONED', 'ERROR'],
    default: 'COMPLETED'
  },

  // ─────────────────────────────────────────────────────────────────────────
  // HIGH-LEVEL INTENT / BOOKING STORY
  // ─────────────────────────────────────────────────────────────────────────
  primaryIntent: String,           // e.g. 'BOOK_TECH_VISIT', 'TROUBLESHOOTING'
  primaryIntentConfidence: Number, // 0-1

  booking: {
    firstIntentDetectedAtMs: Number,   // When caller FIRST asked to book
    intentLockedAtMs: Number,          // When system committed to booking
    questionsAskedBeforeLock: Number,  // Troubleshooting Qs between ask & lock
    completed: Boolean,
    failureReason: {
      type: String,
      enum: ['CUSTOMER_REFUSED', 'NO_AVAILABILITY', 'LOGIC_ERROR', 'TRANSFER_INSTEAD', 'CALL_ENDED', null]
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // PERFORMANCE SUMMARY
  // ─────────────────────────────────────────────────────────────────────────
  performance: {
    totalTurns: Number,
    avgTurnTimeMs: Number,
    slowestTurn: {
      turnNumber: Number,
      totalMs: Number,
      bottleneck: {
        type: String,
        enum: ['STT', 'LLM0', 'TRIAGE', 'TIER3', 'BOOKING', 'TTS', 'UNKNOWN']
      }
    },
    llmCalls: {
      count: { type: Number, default: 0 },
      totalMs: { type: Number, default: 0 },
      totalCostUsd: { type: Number, default: 0 }
    },
    ttsTotalMs: { type: Number, default: 0 }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // FLAGS / ANOMALIES (for filtering in UI)
  // ─────────────────────────────────────────────────────────────────────────
  flags: {
    loopDetected: { type: Boolean, default: false },
    slowResponse: { type: Boolean, default: false },      // Any turn > 8s
    bailoutTriggered: { type: Boolean, default: false },
    noTriageMatch: { type: Boolean, default: false },
    customerFrustrated: { type: Boolean, default: false },
    bookingIgnored: { type: Boolean, default: false }     // User wanted to book, we kept troubleshooting
  },

  // ─────────────────────────────────────────────────────────────────────────
  // DIAGNOSIS - THE "WHY" (computed on finalizeCall)
  // ─────────────────────────────────────────────────────────────────────────
  diagnosis: {
    primaryBottleneck: {
      type: String,
      enum: ['TRIAGE_MISS', 'LLM_SLOW', 'BOOKING_LOOP', 'BEHAVIOR_RULE', 'TTS', 'UNKNOWN', null]
    },
    rootCause: String,        // Human-readable explanation
    suggestedFix: String,     // Actionable fix
    severity: {
      type: String,
      enum: ['CRITICAL', 'WARNING', 'INFO'],
      default: 'INFO'
    }
  },

  // ─────────────────────────────────────────────────────────────────────────
  // TIMELINE OF EVENTS (append-only, immutable)
  // ─────────────────────────────────────────────────────────────────────────
  events: [{
    type: {
      type: String,
      enum: EVENT_TYPES
    },
    ts: Date,           // Absolute timestamp
    t: Number,          // ms offset from startedAt (for UI display)
    turn: Number,       // Turn number (if applicable)
    data: Schema.Types.Mixed
  }],

  // ─────────────────────────────────────────────────────────────────────────
  // TRANSCRIPT (for quick access without parsing events)
  // ─────────────────────────────────────────────────────────────────────────
  transcript: {
    callerTurns: [{
      turn: Number,
      t: Number,        // ms offset
      text: String,
      confidence: Number
    }],
    agentTurns: [{
      turn: Number,
      t: Number,        // ms offset
      text: String,
      source: {
        type: String,
        enum: ['FRONTLINE', 'TRIAGE', 'TIER3', 'LLM_FALLBACK', 'BEHAVIOR', 'BAILOUT', 'GREETING']
      }
    }]
  },

  // ─────────────────────────────────────────────────────────────────────────
  // ERROR COLLECTION
  // ─────────────────────────────────────────────────────────────────────────
  errors: [{
    ts: Date,
    source: {
      type: String,
      enum: ['BRAIN1', 'TRIAGE', 'TIER3', 'BOOKING', 'TWILIO', 'TTS', 'UNKNOWN']
    },
    message: String,
    stack: String
  }],

  // ─────────────────────────────────────────────────────────────────────────
  // VISUALIZATION DATA (pre-computed for fast UI rendering)
  // ─────────────────────────────────────────────────────────────────────────
  visualization: {
    // Mermaid.js sequence diagram syntax
    sequenceDiagram: String,
    
    // Mermaid.js flowchart for decision tree
    decisionTree: String,
    
    // Performance waterfall data
    waterfall: [{
      turn: Number,
      totalMs: Number,
      segments: [{
        name: String,       // 'STT', 'Brain-1 (Fast)', 'Brain-1 (LLM)', 'Triage', etc.
        startMs: Number,    // Offset within turn
        durationMs: Number,
        status: {
          type: String,
          enum: ['ok', 'slow', 'failed', 'skipped']
        },
        detail: String      // Hover tooltip
      }]
    }]
  },

  // ─────────────────────────────────────────────────────────────────────────
  // TIMESTAMPS
  // ─────────────────────────────────────────────────────────────────────────
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true
  }
}, {
  timestamps: false,  // We manage createdAt manually
  collection: 'blackbox_recordings'
});

// ============================================================================
// INDEXES
// ============================================================================

// TTL - Auto-delete after 90 days
BlackBoxRecordingSchema.index(
  { createdAt: 1 }, 
  { expireAfterSeconds: 60 * 60 * 24 * 90 }
);

// Query indexes for filters
BlackBoxRecordingSchema.index({ companyId: 1, startedAt: -1 });
BlackBoxRecordingSchema.index({ companyId: 1, from: 1 });
BlackBoxRecordingSchema.index({ companyId: 1, 'flags.loopDetected': 1 });
BlackBoxRecordingSchema.index({ companyId: 1, 'flags.bookingIgnored': 1 });
BlackBoxRecordingSchema.index({ companyId: 1, 'flags.bailoutTriggered': 1 });
BlackBoxRecordingSchema.index({ companyId: 1, 'flags.slowResponse': 1 });
BlackBoxRecordingSchema.index({ companyId: 1, callOutcome: 1 });

// Compound for call lookup
BlackBoxRecordingSchema.index({ callId: 1, companyId: 1 }, { unique: true });

// ============================================================================
// STATICS
// ============================================================================

/**
 * Get list of calls with lightweight projection (for list view)
 */
BlackBoxRecordingSchema.statics.getCallList = async function(companyId, options = {}) {
  const {
    limit = 20,
    skip = 0,
    fromDate,
    toDate,
    flag,
    phone,
    onlyProblematic = false
  } = options;

  const query = { companyId };

  // Date range
  if (fromDate || toDate) {
    query.startedAt = {};
    if (fromDate) query.startedAt.$gte = new Date(fromDate);
    if (toDate) query.startedAt.$lte = new Date(toDate);
  }

  // Flag filter
  if (flag && flag !== 'all') {
    query[`flags.${flag}`] = true;
  }

  // Phone search
  if (phone) {
    query.from = { $regex: phone.replace(/\D/g, ''), $options: 'i' };
  }

  // Only problematic
  if (onlyProblematic) {
    query.$or = [
      { 'flags.loopDetected': true },
      { 'flags.bailoutTriggered': true },
      { 'flags.bookingIgnored': true },
      { 'flags.slowResponse': true },
      { 'flags.customerFrustrated': true }
    ];
  }

  const calls = await this.find(query)
    .select({
      callId: 1,
      from: 1,
      to: 1,
      startedAt: 1,
      durationMs: 1,
      callOutcome: 1,
      primaryIntent: 1,
      primaryIntentConfidence: 1,
      'booking.completed': 1,
      'performance.totalTurns': 1,
      'performance.avgTurnTimeMs': 1,
      flags: 1,
      'diagnosis.severity': 1,
      'diagnosis.primaryBottleneck': 1
    })
    .sort({ startedAt: -1 })
    .skip(skip)
    .limit(limit)
    .lean();

  const total = await this.countDocuments(query);

  return { calls, total };
};

/**
 * Get full call detail
 */
BlackBoxRecordingSchema.statics.getCallDetail = async function(companyId, callId) {
  return this.findOne({ companyId, callId }).lean();
};

// ============================================================================
// EXPORT
// ============================================================================

module.exports = mongoose.model('BlackBoxRecording', BlackBoxRecordingSchema);

