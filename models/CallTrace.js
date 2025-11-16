/**
 * ============================================================================
 * CALLTRACE MODEL - PERSISTENT CALL SNAPSHOT
 * ============================================================================
 * 
 * PURPOSE: Store complete call context after call ends
 * ARCHITECTURE: Snapshot of FrontlineContext from Redis
 * INDEXING: Optimized for company/call lookups and analytics
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');

const TierResolutionSchema = new mongoose.Schema({
  tier: { 
    type: Number, 
    enum: [1, 2, 3],
    required: true 
  },
  confidence: { 
    type: Number,
    min: 0,
    max: 1 
  },
  sourceId: { type: String },
  answerText: { type: String },
  reasoning: { type: String }
}, { _id: false });

const TranscriptTurnSchema = new mongoose.Schema({
  role: { 
    type: String, 
    enum: ["caller", "agent"],
    required: true 
  },
  text: { 
    type: String,
    required: true 
  },
  timestamp: { type: Number } // Unix ms
}, { _id: false });

const ExtractedSchema = new mongoose.Schema({
  callerName: String,
  callerPhone: String,
  addressLine1: String,
  addressLine2: String,
  city: String,
  state: String,
  postalCode: String,
  locationId: String,
  contactId: String,
  issueSummary: String,
  symptoms: [String],
  serviceType: String,
  requestedDate: String,
  requestedWindow: String,
  accessNotes: String,
  isReturningCustomer: Boolean
}, { _id: false });

const CallTraceSchema = new mongoose.Schema({
  // Call identification
  callId: { 
    type: String, 
    required: true,
    index: true,
    unique: true 
  },
  companyId: { 
    type: String, 
    required: true,
    index: true 
  },
  trade: { type: String },
  
  // Intent and extracted data
  currentIntent: { type: String },
  extracted: ExtractedSchema,
  
  // Triage and intelligence tracking
  triageMatches: [String],
  tierTrace: [TierResolutionSchema],
  
  // Full conversation
  transcript: [TranscriptTurnSchema],
  
  // Booking status
  readyToBook: { type: Boolean, default: false },
  appointmentId: { type: String },
  
  // Configuration version
  configVersion: { type: Number, default: 1 },
  
  // Call timing
  startedAt: { type: Number }, // Unix ms
  endedAt: { type: Number },   // Unix ms
  durationSeconds: { type: Number } // Computed
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes for performance
CallTraceSchema.index({ companyId: 1, createdAt: -1 });
CallTraceSchema.index({ companyId: 1, trade: 1 });
CallTraceSchema.index({ appointmentId: 1 });
CallTraceSchema.index({ 'extracted.callerPhone': 1 });
CallTraceSchema.index({ 'extracted.serviceType': 1 });

// Virtual for computed duration
CallTraceSchema.virtual('duration').get(function() {
  if (this.startedAt && this.endedAt) {
    return this.endedAt - this.startedAt;
  }
  return null;
});

// Pre-save middleware to compute duration
CallTraceSchema.pre('save', function(next) {
  if (this.startedAt && this.endedAt) {
    this.durationSeconds = Math.round((this.endedAt - this.startedAt) / 1000);
  }
  next();
});

// Static methods
CallTraceSchema.statics.findByCompany = function(companyId, options = {}) {
  const query = this.find({ companyId });
  
  if (options.trade) {
    query.where('trade', options.trade);
  }
  
  if (options.startDate || options.endDate) {
    const dateQuery = {};
    if (options.startDate) {
      dateQuery.$gte = options.startDate;
    }
    if (options.endDate) {
      dateQuery.$lte = options.endDate;
    }
    query.where('createdAt', dateQuery);
  }
  
  if (options.limit) {
    query.limit(options.limit);
  }
  
  return query.sort({ createdAt: -1 });
};

CallTraceSchema.statics.findByCallId = function(callId) {
  return this.findOne({ callId });
};

CallTraceSchema.statics.getCompanyStats = async function(companyId, options = {}) {
  const match = { companyId };
  
  if (options.startDate || options.endDate) {
    match.createdAt = {};
    if (options.startDate) {
      match.createdAt.$gte = options.startDate;
    }
    if (options.endDate) {
      match.createdAt.$lte = options.endDate;
    }
  }
  
  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        totalDuration: { $sum: '$durationSeconds' },
        avgDuration: { $avg: '$durationSeconds' },
        bookingsMade: { 
          $sum: { 
            $cond: [{ $ne: ['$appointmentId', null] }, 1, 0] 
          } 
        },
        tier1Count: {
          $sum: {
            $size: {
              $filter: {
                input: '$tierTrace',
                as: 'tier',
                cond: { $eq: ['$$tier.tier', 1] }
              }
            }
          }
        },
        tier2Count: {
          $sum: {
            $size: {
              $filter: {
                input: '$tierTrace',
                as: 'tier',
                cond: { $eq: ['$$tier.tier', 2] }
              }
            }
          }
        },
        tier3Count: {
          $sum: {
            $size: {
              $filter: {
                input: '$tierTrace',
                as: 'tier',
                cond: { $eq: ['$$tier.tier', 3] }
              }
            }
          }
        }
      }
    }
  ]);
  
  return stats.length > 0 ? stats[0] : {
    totalCalls: 0,
    totalDuration: 0,
    avgDuration: 0,
    bookingsMade: 0,
    tier1Count: 0,
    tier2Count: 0,
    tier3Count: 0
  };
};

module.exports = mongoose.model('CallTrace', CallTraceSchema);

