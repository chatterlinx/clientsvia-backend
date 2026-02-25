/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CALL TRANSCRIPT MODEL - MongoDB Schema for V111 Transcripts
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * Stores generated transcripts and conversation memory snapshots at call end.
 * 
 * PURPOSE:
 * - Archive call transcripts for customer access and support
 * - Store engineering transcripts for debugging
 * - Preserve ConversationMemory snapshot for analysis
 * 
 * RETENTION:
 * - Transcripts are retained based on company settings (default 90 days)
 * - Can be queried by callId, companyId, date range
 * 
 * SPEC: docs/architecture/V111-ConversationMemory-Spec.md
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');

// ═══════════════════════════════════════════════════════════════════════════════
// SCHEMA DEFINITION
// ═══════════════════════════════════════════════════════════════════════════════

const CallTranscriptSchema = new mongoose.Schema({
  // ─────────────────────────────────────────────────────────────────────────────
  // IDENTIFIERS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Twilio Call SID - primary identifier */
  callId: {
    type: String,
    required: true,
    index: true,
    unique: true
  },
  
  /** Company this call belongs to */
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'v2Company',
    required: true,
    index: true
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CALL METADATA
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** When the call started */
  callStartTime: {
    type: Date,
    required: true
  },
  
  /** When the call ended */
  callEndTime: {
    type: Date,
    required: true
  },
  
  /** Call duration in milliseconds */
  durationMs: {
    type: Number,
    default: 0
  },
  
  /** Caller phone number (hashed for privacy) */
  callerPhoneHash: {
    type: String,
    default: null
  },
  
  /** How the call ended */
  endReason: {
    type: String,
    enum: ['caller_hangup', 'agent_hangup', 'transfer', 'timeout', 'error', 'booking_complete', 'unknown'],
    default: 'unknown'
  },
  
  /** Final conversation phase */
  finalPhase: {
    type: String,
    enum: ['GREETING', 'DISCOVERY', 'BOOKING', 'COMPLETE', 'ESCALATED'],
    default: 'DISCOVERY'
  },
  
  /** Number of conversation turns */
  turnCount: {
    type: Number,
    default: 0
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // TRANSCRIPTS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Clean customer-facing transcript */
  customerTranscript: {
    type: String,
    default: ''
  },
  
  /** Detailed engineering transcript with debug info */
  engineeringTranscript: {
    type: String,
    default: ''
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // TURNS ARRAY (simple format from Redis call state)
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Array of conversation turns: { speaker, text, turn, timestamp, source } */
  turns: {
    type: [{
      speaker: { type: String, enum: ['caller', 'agent'], required: true },
      text: { type: String, required: true },
      turn: { type: Number },
      timestamp: { type: String },
      source: { type: String }, // For agent turns: provenance source
      // Optional richer provenance payload (used by Call Console for UI traceability)
      provenance: { type: mongoose.Schema.Types.Mixed }
    }],
    default: []
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // CONVERSATION MEMORY SNAPSHOT
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Full ConversationMemory at call end (JSON) */
  memorySnapshot: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  
  /** Just the final facts captured */
  facts: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  /** Capture goal achievement */
  captureProgress: {
    must: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    should: {
      type: mongoose.Schema.Types.Mixed,
      default: {}
    },
    complete: {
      type: Boolean,
      default: false
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // BOOKING INFO (if applicable)
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Whether a booking was created */
  bookingCreated: {
    type: Boolean,
    default: false
  },
  
  /** Reference to booking if created */
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    default: null
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // QUALITY METRICS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** Average response latency in ms */
  avgLatencyMs: {
    type: Number,
    default: 0
  },
  
  /** Which handlers were used and how many times */
  handlerDistribution: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  
  /** Whether V111 was enabled for this call */
  v111Enabled: {
    type: Boolean,
    default: false
  },
  
  /** V111 version used */
  v111Version: {
    type: String,
    default: null
  },
  
  // ─────────────────────────────────────────────────────────────────────────────
  // TIMESTAMPS
  // ─────────────────────────────────────────────────────────────────────────────
  
  /** When this transcript was created */
  createdAt: {
    type: Date,
    default: Date.now
  },
  
  /** When this transcript was last updated */
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  collection: 'call_transcripts',
  timestamps: true
});

// ═══════════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════════

// Compound index for company + date queries
CallTranscriptSchema.index({ companyId: 1, callStartTime: -1 });

// Index for date-based cleanup
CallTranscriptSchema.index({ createdAt: 1 }, { expireAfterSeconds: 7776000 }); // 90 days TTL

// ═══════════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Create a transcript from ConversationMemory
 * @param {object} memory - ConversationMemory object
 * @param {object} transcripts - { customer, engineering }
 * @param {object} company - Company object
 * @returns {Promise<CallTranscript>}
 */
CallTranscriptSchema.statics.createFromMemory = async function(memory, transcripts, company) {
  // Calculate handler distribution
  const handlerDistribution = {};
  let totalLatency = 0;
  let latencyCount = 0;
  
  for (const turn of (memory.turns || [])) {
    const handler = turn.routing?.selectedHandler || 'UNKNOWN';
    handlerDistribution[handler] = (handlerDistribution[handler] || 0) + 1;
    
    if (turn.response?.latencyMs) {
      totalLatency += turn.response.latencyMs;
      latencyCount++;
    }
  }
  
  const avgLatencyMs = latencyCount > 0 ? Math.round(totalLatency / latencyCount) : 0;
  
  // Check if MUST goals are complete
  const mustComplete = Object.values(memory.captureProgress?.must || {})
    .every(field => field.captured === true);
  
  return this.create({
    callId: memory.callId,
    companyId: memory.companyId || company?._id,
    callStartTime: memory.createdAt || new Date(),
    callEndTime: new Date(),
    durationMs: memory.outcome?.duration || (Date.now() - new Date(memory.createdAt).getTime()),
    endReason: memory.outcome?.endReason || 'unknown',
    finalPhase: memory.phase?.current || 'DISCOVERY',
    turnCount: memory.turns?.length || 0,
    customerTranscript: transcripts.customer || '',
    engineeringTranscript: transcripts.engineering || '',
    memorySnapshot: memory,
    facts: memory.facts || {},
    captureProgress: {
      must: memory.captureProgress?.must || {},
      should: memory.captureProgress?.should || {},
      complete: mustComplete
    },
    bookingCreated: memory.booking?.created || false,
    bookingId: memory.booking?.bookingId || null,
    avgLatencyMs,
    handlerDistribution,
    v111Enabled: memory.config?.enabled || false,
    v111Version: memory.version || null
  });
};

/**
 * Create a transcript from a simple turns array (from Redis call state)
 * @param {string} companyId - Company ID
 * @param {string} callId - Call SID
 * @param {Array} turns - Array of { speaker, text, turn, timestamp, source }
 * @returns {Promise<CallTranscript>}
 */
CallTranscriptSchema.statics.createTranscript = async function(companyId, callId, turns) {
  // Build customer-facing transcript string
  const customerLines = turns.map(turn => {
    const speaker = turn.speaker === 'agent' ? 'AI' : 'Customer';
    return `${speaker}: ${turn.text}`;
  });
  
  // Calculate stats
  const agentTurns = turns.filter(t => t.speaker === 'agent');
  const callerTurns = turns.filter(t => t.speaker === 'caller');
  
  return this.create({
    callId,
    companyId,
    callStartTime: turns[0]?.timestamp ? new Date(turns[0].timestamp) : new Date(),
    callEndTime: new Date(),
    turnCount: turns.length,
    customerTranscript: customerLines.join('\n'),
    turns, // Store raw turns array for Call Review
    v111Enabled: false
  });
};

/**
 * Upsert (create or replace) a transcript from a simple turns array.
 * This is safer than create() because callId is unique and multiple pipelines may race.
 *
 * @param {string|ObjectId} companyId
 * @param {string} callId
 * @param {Array} turns
 * @param {Object} [opts]
 * @param {Date} [opts.callEndTime]
 * @returns {Promise<CallTranscript>}
 */
CallTranscriptSchema.statics.upsertTranscriptFromTurns = async function(companyId, callId, turns, opts = {}) {
  const now = new Date();
  const endTimeCandidate = opts.callEndTime instanceof Date ? opts.callEndTime : now;
  const callEndTime = Number.isNaN(endTimeCandidate.getTime()) ? now : endTimeCandidate;

  const cleanedTurns = (Array.isArray(turns) ? turns : [])
    .map(t => ({
      speaker: t?.speaker === 'agent' ? 'agent' : 'caller',
      text: `${t?.text || ''}`.trim(),
      turn: typeof t?.turn === 'number' ? t.turn : undefined,
      timestamp: t?.timestamp ? `${t.timestamp}` : undefined,
      source: t?.source ? `${t.source}` : undefined,
      provenance: t?.provenance || undefined
    }))
    .filter(t => t.text.length > 0);

  const customerLines = cleanedTurns.map(turn => {
    const speaker = turn.speaker === 'agent' ? 'AI' : 'Customer';
    return `${speaker}: ${turn.text}`;
  });

  const startFromTimestamp = cleanedTurns[0]?.timestamp ? new Date(cleanedTurns[0].timestamp) : null;
  const callStartTime = startFromTimestamp && !Number.isNaN(startFromTimestamp.getTime()) ? startFromTimestamp : now;

  return this.findOneAndUpdate(
    { callId },
    {
      $setOnInsert: {
        callId,
        companyId,
        v111Enabled: false
      },
      $set: {
        callStartTime,
        callEndTime,
        durationMs: Math.max(0, callEndTime.getTime() - callStartTime.getTime()),
        turnCount: cleanedTurns.length,
        customerTranscript: customerLines.join('\n'),
        turns: cleanedTurns,
        updatedAt: now
      }
    },
    { new: true, upsert: true }
  );
};

/**
 * Append turns during the live call (Mongo fallback when Redis/status-callback is unreliable).
 * Not guaranteed idempotent across webhook retries; call detail API de-dupes at read time.
 *
 * @param {string|ObjectId} companyId
 * @param {string} callId
 * @param {Array} turns
 * @param {Object} [opts]
 * @param {Date} [opts.callStartTime]
 */
CallTranscriptSchema.statics.appendTurns = async function(companyId, callId, turns, opts = {}) {
  const now = new Date();
  const startCandidate = opts.callStartTime instanceof Date ? opts.callStartTime : now;
  const callStartTime = Number.isNaN(startCandidate.getTime()) ? now : startCandidate;

  const cleanedTurns = (Array.isArray(turns) ? turns : [])
    .map(t => ({
      speaker: t?.speaker === 'agent' ? 'agent' : (t?.speaker === 'caller' ? 'caller' : 'caller'),
      text: `${t?.text || ''}`.trim(),
      turn: typeof t?.turn === 'number' ? t.turn : undefined,
      timestamp: t?.timestamp ? `${t.timestamp}` : undefined,
      source: t?.source ? `${t.source}` : undefined,
      provenance: t?.provenance || undefined
    }))
    .filter(t => t.text.length > 0);

  if (cleanedTurns.length === 0) return;

  await this.updateOne(
    { callId },
    {
      $setOnInsert: {
        callId,
        companyId,
        callStartTime,
        callEndTime: now,
        v111Enabled: false
      },
      $set: {
        callEndTime: now,
        updatedAt: now
      },
      $push: {
        turns: { $each: cleanedTurns }
      }
    },
    { upsert: true }
  );
};

/**
 * Get recent transcripts for a company
 * @param {string} companyId - Company ID
 * @param {number} limit - Max transcripts to return
 * @returns {Promise<CallTranscript[]>}
 */
CallTranscriptSchema.statics.getRecentForCompany = function(companyId, limit = 20) {
  return this.find({ companyId })
    .sort({ callStartTime: -1 })
    .limit(limit)
    .select({
      callId: 1,
      callStartTime: 1,
      durationMs: 1,
      endReason: 1,
      turnCount: 1,
      bookingCreated: 1,
      'captureProgress.complete': 1,
      'facts.name': 1
    })
    .lean();
};

/**
 * Get full transcript by call ID
 * @param {string} callId - Call SID
 * @returns {Promise<CallTranscript|null>}
 */
CallTranscriptSchema.statics.getByCallId = function(callId) {
  return this.findOne({ callId }).lean();
};

// ═══════════════════════════════════════════════════════════════════════════════
// MODEL EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

const CallTranscript = mongoose.model('CallTranscript', CallTranscriptSchema);

module.exports = CallTranscript;
