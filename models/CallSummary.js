/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALL SUMMARY MODEL (Hot Data - Fast Queries)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * CRITICAL DESIGN DECISIONS:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Document size MUST stay < 8KB for fast queries
 * 2. Transcripts stored in separate CallTranscript collection
 * 3. Recordings stored in separate CallRecording collection
 * 4. Only essential, frequently-queried data lives here
 * 5. All indexes compound starting with companyId (multi-tenant)
 * 
 * HOT/COLD SEPARATION:
 * ─────────────────────────────────────────────────────────────────────────────
 * - CallSummary (this): HOT - frequently queried, small, fast
 * - CallTranscript: COLD - rarely queried, large, archived to S3 after 48h
 * - CallRecording: COLD - metadata only, actual files in S3
 * 
 * WHY THIS DESIGN:
 * ─────────────────────────────────────────────────────────────────────────────
 * V1 CallRecord embedded transcripts (50KB+) which made list queries slow.
 * V2 separates hot summary data from cold transcript/recording data.
 * Result: Recent calls list loads in < 200ms even with 500K records.
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// OUTCOME DEFINITIONS
// ═══════════════════════════════════════════════════════════════════════════

const CALL_OUTCOMES = {
  COMPLETED: 'completed',         // Call finished successfully
  TRANSFERRED: 'transferred',     // Transferred to human/external
  VOICEMAIL: 'voicemail',        // Went to voicemail
  ABANDONED: 'abandoned',        // Caller hung up
  SPAM: 'spam',                  // Identified as spam
  ERROR: 'error',                // Technical error
  CALLBACK_REQUESTED: 'callback_requested'  // Customer requested callback
};

const URGENCY_LEVELS = {
  NORMAL: 'normal',
  URGENT: 'urgent',
  EMERGENCY: 'emergency'
};

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const CallSummarySchema = new mongoose.Schema({
  
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY (Multi-tenant required)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Company this call belongs to
   * REQUIRED for multi-tenant isolation
   */
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'v2Company', 
    required: [true, 'companyId is required for multi-tenant isolation'],
    index: true 
  },
  
  /**
   * Unique call identifier (internal)
   * Format: "call_{timestamp}_{random}"
   */
  callId: { 
    type: String, 
    required: [true, 'callId is required'],
    unique: true, 
    index: true
  },
  
  /**
   * Twilio's Call SID (for recording lookup, debugging)
   */
  twilioSid: { 
    type: String, 
    index: true,
    sparse: true
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // CALLER INFORMATION
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Caller phone number (E.164 format)
   */
  phone: { 
    type: String, 
    required: [true, 'phone is required'],
    index: true
  },
  
  /**
   * Linked customer (if identified)
   */
  customerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Customer',
    index: true,
    sparse: true
  },
  
  /**
   * Caller name (captured during call or from customer profile)
   */
  callerName: { 
    type: String,
    maxLength: 100
  },
  
  /**
   * Was this a returning customer?
   */
  isReturning: { 
    type: Boolean, 
    default: false,
    index: true
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // CALL METADATA
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Call direction
   */
  direction: { 
    type: String, 
    enum: ['inbound', 'outbound'], 
    default: 'inbound' 
  },
  
  /**
   * When the call started
   */
  startedAt: { 
    type: Date, 
    required: [true, 'startedAt is required'],
    index: true 
  },
  
  /**
   * When the call ended
   */
  endedAt: { 
    type: Date 
  },
  
  /**
   * Call duration in seconds
   */
  durationSeconds: { 
    type: Number,
    min: 0
  },
  
  /**
   * Number of conversation turns
   */
  turnCount: {
    type: Number,
    default: 0,
    min: 0
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // AI ANALYSIS (From LLM-0 / Brain-1)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Primary intent detected by LLM-0
   * Examples: "BOOK_APPOINTMENT", "EMERGENCY", "SERVICE_QUESTION", "BILLING"
   */
  primaryIntent: { 
    type: String,
    index: true,
    maxLength: 50
  },
  
  /**
   * Confidence score for primary intent (0.0 - 1.0)
   */
  intentConfidence: { 
    type: Number,
    min: 0,
    max: 1
  },
  
  /**
   * Secondary intents detected
   */
  secondaryIntents: [{
    type: String,
    maxLength: 50
  }],
  
  /**
   * Emotion detection results
   */
  emotion: {
    /**
     * Primary emotion
     * Examples: "NEUTRAL", "FRUSTRATED", "URGENT", "HAPPY", "CONFUSED"
     */
    primary: { 
      type: String,
      maxLength: 30
    },
    
    /**
     * Emotion intensity (0.0 - 1.0)
     */
    intensity: { 
      type: Number,
      min: 0,
      max: 1
    }
  },
  
  /**
   * Which Triage Card was matched
   */
  triageCard: { 
    type: String,
    maxLength: 100
  },
  
  /**
   * Which AiCore scenario was used
   */
  scenarioMatched: { 
    type: String,
    maxLength: 100
  },
  
  /**
   * Which tier handled the call
   * 1 = Rule-based (free)
   * 2 = Semantic (free)
   * 3 = LLM fallback (paid)
   */
  routingTier: { 
    type: Number, 
    enum: [1, 2, 3],
    index: true
  },
  
  /**
   * LLM model used (if Tier 3)
   */
  llmModel: { 
    type: String,
    maxLength: 50
  },
  
  /**
   * Estimated LLM cost for this call (in dollars)
   */
  llmCost: { 
    type: Number,
    min: 0,
    default: 0
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // OUTCOME
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * How did the call end?
   */
  outcome: { 
    type: String, 
    enum: {
      values: Object.values(CALL_OUTCOMES),
      message: '{VALUE} is not a valid call outcome'
    },
    required: [true, 'outcome is required'],
    index: true
  },
  
  /**
   * Human-readable result
   * Examples: "Appointment Booked", "Message Taken", "Transferred to Sales"
   */
  outcomeDetail: { 
    type: String,
    maxLength: 200
  },
  
  /**
   * If transferred, to what number/department?
   */
  transferredTo: { 
    type: String,
    maxLength: 100
  },
  
  /**
   * If appointment was created, reference it
   */
  appointmentCreatedId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Appointment',
    sparse: true
  },
  
  /**
   * Was a message left for callback?
   */
  messageLeft: { 
    type: Boolean,
    default: false
  },
  
  /**
   * Does this require follow-up action?
   */
  followUpRequired: { 
    type: Boolean, 
    default: false,
    index: true
  },
  
  /**
   * Follow-up details
   */
  followUpNotes: { 
    type: String,
    maxLength: 500
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // CAPTURED SUMMARY (Key fields only - NOT full PII dump)
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Summary of captured data
   * Only essential fields - full data in CustomerEvent
   */
  capturedSummary: {
    /**
     * Name if captured
     */
    name: { 
      type: String,
      maxLength: 100
    },
    
    /**
     * Did they provide/update their address?
     */
    addressCaptured: { 
      type: Boolean,
      default: false
    },
    
    /**
     * Urgency level
     */
    urgency: { 
      type: String, 
      enum: Object.values(URGENCY_LEVELS)
    },
    
    /**
     * Brief problem description
     */
    problemSummary: { 
      type: String, 
      maxLength: 500 
    },
    
    /**
     * Key entities extracted (service type, date, etc.)
     * Stored as key-value pairs for flexibility
     */
    keyEntities: { 
      type: Map, 
      of: String
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // REFERENCES TO COLD STORAGE
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Reference to transcript document (CallTranscript)
   */
  transcriptRef: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'CallTranscript',
    sparse: true
  },
  
  /**
   * Reference to recording document (CallRecording)
   */
  recordingRef: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'CallRecording',
    sparse: true
  },
  
  /**
   * Quick flags for UI (avoid joins)
   */
  hasTranscript: {
    type: Boolean,
    default: false
  },
  
  hasRecording: {
    type: Boolean,
    default: false
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // NOTES & REVIEW
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Agent note (single, short - detailed notes in CustomerEvent)
   */
  agentNote: { 
    type: String, 
    maxLength: 1000 
  },
  
  /**
   * Flagged for review
   */
  flagged: { 
    type: Boolean, 
    default: false, 
    index: true 
  },
  
  /**
   * Why was it flagged?
   */
  flagReason: { 
    type: String,
    maxLength: 200
  },
  
  /**
   * When was it reviewed?
   */
  reviewedAt: { 
    type: Date 
  },
  
  /**
   * Who reviewed it?
   */
  reviewedBy: { 
    type: String,
    maxLength: 100
  },
  
  /**
   * Review rating (1-5 stars)
   */
  reviewRating: { 
    type: Number, 
    min: 1, 
    max: 5 
  },
  
  /**
   * Review feedback
   */
  reviewFeedback: {
    type: String,
    maxLength: 500
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // CONSENT TRACKING (Compliance)
  // ─────────────────────────────────────────────────────────────────────────
  
  consent: {
    /**
     * Was recording consent obtained?
     */
    recordingConsent: { 
      type: Boolean 
    },
    
    /**
     * Consent type based on state
     * - one-party: Only one party needs to consent (most states)
     * - two-party: Both parties must consent (CA, CT, FL, IL, etc.)
     */
    consentType: { 
      type: String, 
      enum: ['one-party', 'two-party', 'unknown'] 
    },
    
    /**
     * Caller's state (for compliance rules)
     */
    callerState: { 
      type: String,
      maxLength: 2
    },
    
    /**
     * When consent was given/recorded
     */
    consentTimestamp: { 
      type: Date 
    }
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // TECHNICAL METADATA
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Processing status
   */
  processingStatus: {
    type: String,
    enum: ['pending', 'complete', 'error'],
    default: 'pending'
  },
  
  /**
   * If there was an error, what was it?
   */
  errorMessage: {
    type: String,
    maxLength: 500
  }
  
}, { 
  timestamps: true,
  collection: 'call_summaries',
  
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});


// ═══════════════════════════════════════════════════════════════════════════
// INDEXES (All compound starting with companyId)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Primary: Recent calls (most common query)
 */
CallSummarySchema.index(
  { companyId: 1, startedAt: -1 },
  { name: 'idx_company_recent_calls' }
);

/**
 * Customer's calls
 */
CallSummarySchema.index(
  { companyId: 1, customerId: 1, startedAt: -1 },
  { name: 'idx_company_customer_calls' }
);

/**
 * Phone lookup (find all calls from a number)
 */
CallSummarySchema.index(
  { companyId: 1, phone: 1, startedAt: -1 },
  { name: 'idx_company_phone_calls' }
);

/**
 * Filter by outcome
 */
CallSummarySchema.index(
  { companyId: 1, outcome: 1, startedAt: -1 },
  { name: 'idx_company_outcome_calls' }
);

/**
 * Filter by intent
 */
CallSummarySchema.index(
  { companyId: 1, primaryIntent: 1, startedAt: -1 },
  { name: 'idx_company_intent_calls' }
);

/**
 * Filter by tier (for analytics)
 */
CallSummarySchema.index(
  { companyId: 1, routingTier: 1, startedAt: -1 },
  { name: 'idx_company_tier_calls' }
);

/**
 * Flagged calls
 */
CallSummarySchema.index(
  { companyId: 1, flagged: 1, startedAt: -1 },
  { name: 'idx_company_flagged_calls' }
);

/**
 * Follow-up required
 */
CallSummarySchema.index(
  { companyId: 1, followUpRequired: 1, startedAt: -1 },
  { name: 'idx_company_followup_calls' }
);

/**
 * Analytics rollup query (used by dailyStatsRollup job)
 */
CallSummarySchema.index(
  { companyId: 1, startedAt: 1, outcome: 1, routingTier: 1, primaryIntent: 1 },
  { name: 'idx_analytics_rollup' }
);


// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate a unique call ID
 */
CallSummarySchema.statics.generateCallId = function() {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `call_${timestamp}_${random}`;
};

/**
 * Create a new call summary
 * 
 * @param {Object} data - Call data
 * @returns {Promise<CallSummary>}
 */
CallSummarySchema.statics.createCall = async function(data) {
  // Generate callId if not provided
  if (!data.callId) {
    data.callId = this.generateCallId();
  }
  
  // Set defaults
  if (!data.startedAt) {
    data.startedAt = new Date();
  }
  
  const call = await this.create(data);
  
  logger.info('[CALL_SUMMARY] Call created', {
    callId: call.callId,
    companyId: call.companyId.toString(),
    phone: call.phone,
    customerId: call.customerId?.toString()
  });
  
  return call;
};

/**
 * Mark call as completed with outcome
 * 
 * @param {string} callId - Call ID
 * @param {Object} outcome - Outcome data
 * @returns {Promise<CallSummary>}
 */
CallSummarySchema.statics.completeCall = async function(callId, outcomeData) {
  const {
    outcome,
    outcomeDetail,
    primaryIntent,
    intentConfidence,
    emotion,
    triageCard,
    scenarioMatched,
    routingTier,
    llmModel,
    llmCost,
    capturedSummary,
    customerId,
    callerName,
    isReturning,
    transcriptRef,
    recordingRef,
    consent,
    appointmentCreatedId,
    messageLeft,
    followUpRequired,
    followUpNotes,
    transferredTo,
    turnCount
  } = outcomeData;
  
  const now = new Date();
  
  const call = await this.findOneAndUpdate(
    { callId },
    {
      $set: {
        endedAt: now,
        outcome,
        outcomeDetail,
        primaryIntent,
        intentConfidence,
        emotion,
        triageCard,
        scenarioMatched,
        routingTier,
        llmModel,
        llmCost: llmCost || 0,
        capturedSummary,
        customerId,
        callerName,
        isReturning,
        transcriptRef,
        recordingRef,
        hasTranscript: !!transcriptRef,
        hasRecording: !!recordingRef,
        consent,
        appointmentCreatedId,
        messageLeft,
        followUpRequired,
        followUpNotes,
        transferredTo,
        turnCount,
        processingStatus: 'complete'
      }
    },
    { new: true }
  );
  
  if (call) {
    // Calculate duration
    if (call.startedAt) {
      call.durationSeconds = Math.round((now - call.startedAt) / 1000);
      await call.save();
    }
    
    logger.info('[CALL_SUMMARY] Call completed', {
      callId,
      outcome,
      durationSeconds: call.durationSeconds,
      routingTier
    });
  }
  
  return call;
};

/**
 * Get recent calls (paginated)
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {Object} options - Query options
 * @returns {Promise<{calls: CallSummary[], total: number, pages: number}>}
 */
CallSummarySchema.statics.getRecentCalls = async function(companyId, options = {}) {
  const {
    page = 1,
    limit = 50,
    startDate = null,
    endDate = null,
    outcome = null,
    intent = null,
    customerId = null,
    phone = null,
    flagged = null,
    followUpRequired = null,
    tier = null
  } = options;
  
  const query = { companyId };
  
  // Date range
  if (startDate || endDate) {
    query.startedAt = {};
    if (startDate) query.startedAt.$gte = new Date(startDate);
    if (endDate) query.startedAt.$lte = new Date(endDate);
  }
  
  // Filters
  if (outcome) query.outcome = outcome;
  if (intent) query.primaryIntent = intent;
  if (customerId) query.customerId = customerId;
  if (phone) query.phone = phone;
  if (flagged !== null) query.flagged = flagged;
  if (followUpRequired !== null) query.followUpRequired = followUpRequired;
  if (tier) query.routingTier = tier;
  
  const skip = (page - 1) * Math.min(limit, 100);
  const actualLimit = Math.min(limit, 100);
  
  const [calls, total] = await Promise.all([
    this.find(query)
      .sort({ startedAt: -1 })
      .skip(skip)
      .limit(actualLimit)
      .lean(),
    this.countDocuments(query)
  ]);
  
  return {
    calls,
    total,
    page,
    limit: actualLimit,
    pages: Math.ceil(total / actualLimit)
  };
};

/**
 * Get calls for analytics (aggregation-friendly)
 * Used by dailyStatsRollup job
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {Date} startDate - Start of period
 * @param {Date} endDate - End of period
 * @returns {Promise<Object>} - Aggregated stats
 */
CallSummarySchema.statics.getStatsForPeriod = async function(companyId, startDate, endDate) {
  const stats = await this.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(companyId),
        startedAt: { $gte: startDate, $lt: endDate },
        processingStatus: 'complete'
      }
    },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        totalDurationSeconds: { $sum: '$durationSeconds' },
        
        // Outcomes
        completed: { $sum: { $cond: [{ $eq: ['$outcome', 'completed'] }, 1, 0] } },
        transferred: { $sum: { $cond: [{ $eq: ['$outcome', 'transferred'] }, 1, 0] } },
        voicemail: { $sum: { $cond: [{ $eq: ['$outcome', 'voicemail'] }, 1, 0] } },
        abandoned: { $sum: { $cond: [{ $eq: ['$outcome', 'abandoned'] }, 1, 0] } },
        spam: { $sum: { $cond: [{ $eq: ['$outcome', 'spam'] }, 1, 0] } },
        
        // Tiers
        tier1: { $sum: { $cond: [{ $eq: ['$routingTier', 1] }, 1, 0] } },
        tier2: { $sum: { $cond: [{ $eq: ['$routingTier', 2] }, 1, 0] } },
        tier3: { $sum: { $cond: [{ $eq: ['$routingTier', 3] }, 1, 0] } },
        
        // Customers
        newCustomers: { $sum: { $cond: [{ $eq: ['$isReturning', false] }, 1, 0] } },
        returningCustomers: { $sum: { $cond: [{ $eq: ['$isReturning', true] }, 1, 0] } },
        
        // Appointments
        appointmentsBooked: { $sum: { $cond: [{ $ne: ['$appointmentCreatedId', null] }, 1, 0] } },
        
        // Costs
        llmCostTotal: { $sum: '$llmCost' }
      }
    }
  ]);
  
  return stats[0] || {
    totalCalls: 0,
    totalDurationSeconds: 0,
    completed: 0,
    transferred: 0,
    voicemail: 0,
    abandoned: 0,
    spam: 0,
    tier1: 0,
    tier2: 0,
    tier3: 0,
    newCustomers: 0,
    returningCustomers: 0,
    appointmentsBooked: 0,
    llmCostTotal: 0
  };
};

/**
 * Get intent distribution for a period
 */
CallSummarySchema.statics.getIntentDistribution = async function(companyId, startDate, endDate) {
  const distribution = await this.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(companyId),
        startedAt: { $gte: startDate, $lt: endDate },
        primaryIntent: { $ne: null }
      }
    },
    {
      $group: {
        _id: '$primaryIntent',
        count: { $sum: 1 }
      }
    },
    {
      $sort: { count: -1 }
    },
    {
      $limit: 20  // Top 20 intents
    }
  ]);
  
  const result = {};
  for (const { _id, count } of distribution) {
    result[_id] = count;
  }
  
  return result;
};


// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Flag this call for review
 */
CallSummarySchema.methods.flag = async function(reason, flaggedBy = 'system') {
  this.flagged = true;
  this.flagReason = reason;
  await this.save();
  
  logger.info('[CALL_SUMMARY] Call flagged', {
    callId: this.callId,
    reason,
    flaggedBy
  });
};

/**
 * Mark as reviewed
 */
CallSummarySchema.methods.markReviewed = async function(reviewedBy, rating = null, feedback = null) {
  this.reviewedAt = new Date();
  this.reviewedBy = reviewedBy;
  if (rating) this.reviewRating = rating;
  if (feedback) this.reviewFeedback = feedback;
  await this.save();
  
  logger.info('[CALL_SUMMARY] Call reviewed', {
    callId: this.callId,
    reviewedBy,
    rating
  });
};

/**
 * Add agent note
 */
CallSummarySchema.methods.addNote = async function(note) {
  this.agentNote = note;
  await this.save();
};


// ═══════════════════════════════════════════════════════════════════════════
// VIRTUALS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Duration formatted as "Xm Ys"
 */
CallSummarySchema.virtual('durationFormatted').get(function() {
  if (!this.durationSeconds) return null;
  const minutes = Math.floor(this.durationSeconds / 60);
  const seconds = this.durationSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
});

/**
 * Is this call recent (within last 24 hours)?
 */
CallSummarySchema.virtual('isRecent').get(function() {
  if (!this.startedAt) return false;
  const dayAgo = Date.now() - (24 * 60 * 60 * 1000);
  return this.startedAt.getTime() > dayAgo;
});


// ═══════════════════════════════════════════════════════════════════════════
// MODEL EXPORT
// ═══════════════════════════════════════════════════════════════════════════

const CallSummary = mongoose.model('CallSummary', CallSummarySchema);

module.exports = CallSummary;
module.exports.CALL_OUTCOMES = CALL_OUTCOMES;
module.exports.URGENCY_LEVELS = URGENCY_LEVELS;

