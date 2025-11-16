/**
 * ============================================================================
 * USAGERECORD MODEL - CALL USAGE TRACKING
 * ============================================================================
 * 
 * PURPOSE: Track per-call usage for billing and analytics
 * ARCHITECTURE: One record per call, aggregated for billing cycles
 * SCOPE: Per-company, indexed for billing queries
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');

const UsageRecordSchema = new mongoose.Schema({
  // Company association
  companyId: { 
    type: String, 
    required: true,
    index: true 
  },
  
  // Call identification
  callId: { 
    type: String, 
    required: true,
    index: true,
    unique: true 
  },
  
  // Duration tracking
  rawDurationSeconds: { 
    type: Number, 
    required: true,
    default: 0 
  },
  billedMinutes: { 
    type: Number, 
    required: true,
    default: 0 
  },
  
  // Intelligence tier usage
  llmTurns: { 
    type: Number, 
    default: 0 
  },
  tier1Count: { 
    type: Number, 
    default: 0 
  },
  tier2Count: { 
    type: Number, 
    default: 0 
  },
  tier3Count: { 
    type: Number, 
    default: 0 
  },
  
  // Call classification
  primaryIntent: { 
    type: String,
    enum: ['booking', 'info', 'troubleshooting', 'billing', 'update', 'other'],
    default: 'other'
  },
  
  // Cost tracking (in USD)
  twilioVoiceCost: { type: Number, default: 0 },
  elevenLabsCost: { type: Number, default: 0 },
  llmCost: { type: Number, default: 0 },
  totalCost: { type: Number, default: 0 },
  
  // Outcome
  bookingCreated: { type: Boolean, default: false },
  appointmentId: { type: String },
  
  // Quality metrics
  successfulResolution: { type: Boolean },
  transferredToHuman: { type: Boolean, default: false },
  
  // Metadata
  metadata: { type: mongoose.Schema.Types.Mixed }
}, { 
  timestamps: true 
});

// Indexes
UsageRecordSchema.index({ companyId: 1, createdAt: -1 });
UsageRecordSchema.index({ companyId: 1, primaryIntent: 1 });
UsageRecordSchema.index({ companyId: 1, bookingCreated: 1 });
UsageRecordSchema.index({ createdAt: 1 }); // For billing cycle queries

// Pre-save middleware to compute total cost
UsageRecordSchema.pre('save', function(next) {
  this.totalCost = 
    (this.twilioVoiceCost || 0) + 
    (this.elevenLabsCost || 0) + 
    (this.llmCost || 0);
  next();
});

// Static methods
UsageRecordSchema.statics.getCompanyUsage = async function(companyId, options = {}) {
  const match = { companyId };
  
  // Date range filter
  if (options.startDate || options.endDate) {
    match.createdAt = {};
    if (options.startDate) {
      match.createdAt.$gte = new Date(options.startDate);
    }
    if (options.endDate) {
      match.createdAt.$lte = new Date(options.endDate);
    }
  }
  
  const stats = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalCalls: { $sum: 1 },
        totalMinutes: { $sum: '$billedMinutes' },
        totalCost: { $sum: '$totalCost' },
        tier1Usage: { $sum: '$tier1Count' },
        tier2Usage: { $sum: '$tier2Count' },
        tier3Usage: { $sum: '$tier3Count' },
        llmTurns: { $sum: '$llmTurns' },
        bookingsCreated: { 
          $sum: { $cond: ['$bookingCreated', 1, 0] } 
        },
        transfersToHuman: {
          $sum: { $cond: ['$transferredToHuman', 1, 0] }
        }
      }
    }
  ]);
  
  return stats.length > 0 ? stats[0] : {
    totalCalls: 0,
    totalMinutes: 0,
    totalCost: 0,
    tier1Usage: 0,
    tier2Usage: 0,
    tier3Usage: 0,
    llmTurns: 0,
    bookingsCreated: 0,
    transfersToHuman: 0
  };
};

UsageRecordSchema.statics.getTierBreakdown = async function(companyId, options = {}) {
  const match = { companyId };
  
  if (options.startDate || options.endDate) {
    match.createdAt = {};
    if (options.startDate) {
      match.createdAt.$gte = new Date(options.startDate);
    }
    if (options.endDate) {
      match.createdAt.$lte = new Date(options.endDate);
    }
  }
  
  const breakdown = await this.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalResolutions: { 
          $sum: { 
            $add: ['$tier1Count', '$tier2Count', '$tier3Count'] 
          } 
        },
        tier1: { $sum: '$tier1Count' },
        tier2: { $sum: '$tier2Count' },
        tier3: { $sum: '$tier3Count' }
      }
    },
    {
      $project: {
        _id: 0,
        totalResolutions: 1,
        tier1Count: '$tier1',
        tier2Count: '$tier2',
        tier3Count: '$tier3',
        tier1Percent: {
          $cond: [
            { $eq: ['$totalResolutions', 0] },
            0,
            { $multiply: [{ $divide: ['$tier1', '$totalResolutions'] }, 100] }
          ]
        },
        tier2Percent: {
          $cond: [
            { $eq: ['$totalResolutions', 0] },
            0,
            { $multiply: [{ $divide: ['$tier2', '$totalResolutions'] }, 100] }
          ]
        },
        tier3Percent: {
          $cond: [
            { $eq: ['$totalResolutions', 0] },
            0,
            { $multiply: [{ $divide: ['$tier3', '$totalResolutions'] }, 100] }
          ]
        }
      }
    }
  ]);
  
  return breakdown.length > 0 ? breakdown[0] : {
    totalResolutions: 0,
    tier1Count: 0,
    tier2Count: 0,
    tier3Count: 0,
    tier1Percent: 0,
    tier2Percent: 0,
    tier3Percent: 0
  };
};

module.exports = mongoose.model('UsageRecord', UsageRecordSchema);

