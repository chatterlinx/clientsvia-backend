/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALL TRANSCRIPT MODEL (Cold Storage - Archived to S3)
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * LIFECYCLE:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Created during/after call with full transcript
 * 2. Stored in MongoDB for 48 hours (hot access)
 * 3. Archived to S3 by transcriptArchiver job
 * 4. Deleted from MongoDB after archival
 * 5. Retrieved from S3 on-demand (rare)
 * 
 * WHY SEPARATE COLLECTION:
 * ─────────────────────────────────────────────────────────────────────────────
 * Transcripts are 10-50KB each. Embedding in CallSummary would:
 * - Make list queries slow (loading 50 calls = 2.5MB)
 * - Bloat MongoDB storage costs
 * - Prevent efficient archival
 * 
 * Separate collection allows:
 * - Fast CallSummary queries (< 200ms)
 * - Efficient S3 archival (10x cheaper storage)
 * - On-demand loading when user clicks "View Transcript"
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// SCHEMA DEFINITION
// ═══════════════════════════════════════════════════════════════════════════

const CallTranscriptSchema = new mongoose.Schema({
  
  // ─────────────────────────────────────────────────────────────────────────
  // IDENTITY
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Company this transcript belongs to
   */
  companyId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'v2Company', 
    required: [true, 'companyId is required'],
    index: true 
  },
  
  /**
   * Unique call identifier (matches CallSummary.callId)
   */
  callId: { 
    type: String, 
    required: [true, 'callId is required'],
    unique: true,
    index: true
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // TRANSCRIPT DATA
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Conversation turns
   */
  turns: [{
    /**
     * Who spoke
     */
    speaker: { 
      type: String, 
      enum: ['agent', 'caller'],
      required: true
    },
    
    /**
     * What was said
     */
    text: { 
      type: String,
      required: true
    },
    
    /**
     * When it was said
     */
    timestamp: { 
      type: Date 
    },
    
    /**
     * Turn number (1, 2, 3, ...)
     */
    turnNumber: { 
      type: Number 
    },
    
    /**
     * Confidence score from STT (if applicable)
     */
    confidence: {
      type: Number,
      min: 0,
      max: 1
    }
  }],
  
  /**
   * Total number of turns
   */
  totalTurns: {
    type: Number,
    default: 0
  },
  
  /**
   * Total word count
   */
  totalWords: {
    type: Number,
    default: 0
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // S3 ARCHIVAL TRACKING
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * Has this been archived to S3?
   */
  archived: {
    type: Boolean,
    default: false,
    index: true
  },
  
  /**
   * When was it archived?
   */
  archivedAt: { 
    type: Date,
    index: true
  },
  
  /**
   * S3 key for retrieval
   * Format: "transcripts/{companyId}/{YYYY-MM}/{callId}.json"
   */
  s3Key: { 
    type: String 
  },
  
  /**
   * S3 bucket name
   */
  s3Bucket: {
    type: String
  },
  
  // ─────────────────────────────────────────────────────────────────────────
  // METADATA
  // ─────────────────────────────────────────────────────────────────────────
  
  /**
   * When the transcript was created
   */
  createdAt: { 
    type: Date, 
    default: Date.now,
    index: true
  },
  
  /**
   * Document size in bytes (for monitoring)
   */
  sizeBytes: {
    type: Number
  }
  
}, { 
  timestamps: false,  // We manage createdAt ourselves
  collection: 'call_transcripts'
});


// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Find transcript by call
 */
CallTranscriptSchema.index(
  { companyId: 1, callId: 1 },
  { name: 'idx_company_call' }
);

/**
 * Find transcripts ready for archival (> 48h old, not archived)
 */
CallTranscriptSchema.index(
  { archived: 1, createdAt: 1 },
  { name: 'idx_archival_candidates' }
);

/**
 * TTL index: Auto-delete after 7 days if archived
 * This is a safety net - archiver job should delete after archival
 */
CallTranscriptSchema.index(
  { archivedAt: 1 },
  { 
    expireAfterSeconds: 604800,  // 7 days
    partialFilterExpression: { archived: true },
    name: 'idx_archived_ttl'
  }
);


// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Create a transcript from conversation turns
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {string} callId - Call ID
 * @param {Array} turns - Array of { speaker, text, timestamp }
 * @returns {Promise<CallTranscript>}
 */
CallTranscriptSchema.statics.createTranscript = async function(companyId, callId, turns) {
  // Number the turns and calculate stats
  const numberedTurns = turns.map((turn, index) => ({
    ...turn,
    turnNumber: index + 1
  }));
  
  const totalWords = turns.reduce((sum, turn) => {
    return sum + (turn.text ? turn.text.split(/\s+/).length : 0);
  }, 0);
  
  const transcript = await this.create({
    companyId,
    callId,
    turns: numberedTurns,
    totalTurns: turns.length,
    totalWords
  });
  
  // Calculate and store size
  const jsonSize = JSON.stringify(transcript.turns).length;
  transcript.sizeBytes = jsonSize;
  await transcript.save();
  
  logger.info('[CALL_TRANSCRIPT] Transcript created', {
    callId,
    companyId: companyId.toString(),
    turns: turns.length,
    sizeBytes: jsonSize
  });
  
  return transcript;
};

/**
 * Get transcript by call ID
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {string} callId - Call ID
 * @returns {Promise<CallTranscript|null>}
 */
CallTranscriptSchema.statics.getByCallId = async function(companyId, callId) {
  return this.findOne({ companyId, callId }).lean();
};

/**
 * Find transcripts ready for archival
 * (> 48 hours old and not yet archived)
 * 
 * @param {number} limit - Max transcripts to return
 * @returns {Promise<CallTranscript[]>}
 */
CallTranscriptSchema.statics.findArchivalCandidates = async function(limit = 100) {
  const cutoffDate = new Date(Date.now() - (48 * 60 * 60 * 1000));  // 48 hours ago
  
  return this.find({
    archived: false,
    createdAt: { $lt: cutoffDate }
  })
    .limit(limit)
    .lean();
};

/**
 * Mark transcript as archived
 * 
 * @param {string} callId - Call ID
 * @param {string} s3Key - S3 key where it was stored
 * @param {string} s3Bucket - S3 bucket name
 */
CallTranscriptSchema.statics.markArchived = async function(callId, s3Key, s3Bucket) {
  await this.findOneAndUpdate(
    { callId },
    {
      $set: {
        archived: true,
        archivedAt: new Date(),
        s3Key,
        s3Bucket,
        turns: []  // Clear turns to free space (data is in S3 now)
      }
    }
  );
  
  logger.info('[CALL_TRANSCRIPT] Transcript archived', {
    callId,
    s3Key,
    s3Bucket
  });
};

/**
 * Get archival statistics
 * 
 * @param {ObjectId} companyId - Company ID (optional, null for global)
 * @returns {Promise<Object>}
 */
CallTranscriptSchema.statics.getArchivalStats = async function(companyId = null) {
  const match = companyId ? { companyId: new mongoose.Types.ObjectId(companyId) } : {};
  
  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$archived',
        count: { $sum: 1 },
        totalSize: { $sum: '$sizeBytes' }
      }
    }
  ]);
  
  const result = {
    pending: { count: 0, sizeBytes: 0 },
    archived: { count: 0, sizeBytes: 0 }
  };
  
  for (const stat of stats) {
    if (stat._id === true) {
      result.archived = { count: stat.count, sizeBytes: stat.totalSize };
    } else {
      result.pending = { count: stat.count, sizeBytes: stat.totalSize };
    }
  }
  
  return result;
};


// ═══════════════════════════════════════════════════════════════════════════
// INSTANCE METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get transcript as plain text
 */
CallTranscriptSchema.methods.toPlainText = function() {
  return this.turns.map(turn => {
    const speaker = turn.speaker === 'agent' ? 'Agent' : 'Caller';
    return `${speaker}: ${turn.text}`;
  }).join('\n\n');
};

/**
 * Get transcript formatted for display
 */
CallTranscriptSchema.methods.toDisplayFormat = function() {
  return this.turns.map(turn => ({
    speaker: turn.speaker,
    speakerLabel: turn.speaker === 'agent' ? 'AI Agent' : 'Caller',
    text: turn.text,
    timestamp: turn.timestamp,
    turnNumber: turn.turnNumber
  }));
};


// ═══════════════════════════════════════════════════════════════════════════
// MODEL EXPORT
// ═══════════════════════════════════════════════════════════════════════════

const CallTranscript = mongoose.model('CallTranscript', CallTranscriptSchema);

module.exports = CallTranscript;

