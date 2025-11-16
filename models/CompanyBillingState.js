/**
 * ============================================================================
 * COMPANYBILLINGSTATE MODEL - BILLING CYCLE TRACKING
 * ============================================================================
 * 
 * PURPOSE: Track aggregate usage and costs per billing cycle
 * ARCHITECTURE: One document per company, updated as calls complete
 * SCOPE: Per-company, used for billing dashboards and overage alerts
 * 
 * ============================================================================
 */

const mongoose = require('mongoose');

const CompanyBillingStateSchema = new mongoose.Schema({
  // Company identification (unique)
  companyId: { 
    type: String, 
    required: true,
    unique: true,
    index: true 
  },
  
  // Current billing cycle
  billingCycleStart: { 
    type: Date, 
    required: true 
  },
  billingCycleEnd: { 
    type: Date, 
    required: true 
  },
  
  // Plan limits
  plan: {
    type: String,
    enum: ['starter', 'professional', 'enterprise', 'custom'],
    default: 'starter'
  },
  minutesIncluded: { 
    type: Number, 
    required: true,
    default: 0 
  },
  
  // Usage tracking
  minutesUsed: { 
    type: Number, 
    default: 0,
    index: true 
  },
  overageMinutes: { 
    type: Number, 
    default: 0 
  },
  
  // Cost tracking (in USD)
  baseSubscriptionCost: { type: Number, default: 0 },
  includedMinutesCost: { type: Number, default: 0 },
  overageCostPerMinute: { type: Number, default: 0.10 }, // $0.10/min default
  estimatedOverageCost: { type: Number, default: 0 },
  estimatedAiCost: { type: Number, default: 0 },
  estimatedTotalCost: { type: Number, default: 0 },
  
  // Tier usage tracking
  tier1UsageCount: { type: Number, default: 0 },
  tier2UsageCount: { type: Number, default: 0 },
  tier3UsageCount: { type: Number, default: 0 },
  tier3Cost: { type: Number, default: 0 }, // Track Tier 3 LLM costs separately
  
  // Call statistics
  totalCalls: { type: Number, default: 0 },
  bookingsCreated: { type: Number, default: 0 },
  
  // Overage alert tracking
  overageAlertSent: { type: Boolean, default: false },
  overageAlertSentAt: { type: Date },
  overageThreshold: { type: Number, default: 0.9 }, // Alert at 90% usage
  
  // Payment status
  paymentStatus: {
    type: String,
    enum: ['current', 'pending', 'overdue', 'suspended'],
    default: 'current'
  },
  lastPaymentDate: { type: Date },
  lastPaymentAmount: { type: Number },
  
  // Metadata
  notes: { type: String, trim: true },
  metadata: { type: mongoose.Schema.Types.Mixed }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Indexes
CompanyBillingStateSchema.index({ billingCycleEnd: 1 });
CompanyBillingStateSchema.index({ overageAlertSent: 1, minutesUsed: 1 });
CompanyBillingStateSchema.index({ paymentStatus: 1 });

// Virtual for usage percentage
CompanyBillingStateSchema.virtual('usagePercent').get(function() {
  if (!this.minutesIncluded || this.minutesIncluded === 0) return 0;
  return Math.round((this.minutesUsed / this.minutesIncluded) * 100);
});

// Virtual for overage percentage
CompanyBillingStateSchema.virtual('overagePercent').get(function() {
  if (!this.minutesIncluded || this.minutesIncluded === 0) return 0;
  if (this.minutesUsed <= this.minutesIncluded) return 0;
  return Math.round(((this.minutesUsed - this.minutesIncluded) / this.minutesIncluded) * 100);
});

// Virtual for days remaining in cycle
CompanyBillingStateSchema.virtual('daysRemaining').get(function() {
  if (!this.billingCycleEnd) return null;
  
  const now = new Date();
  const end = new Date(this.billingCycleEnd);
  const diffTime = end - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays > 0 ? diffDays : 0;
});

// Virtual for is over limit
CompanyBillingStateSchema.virtual('isOverLimit').get(function() {
  return this.minutesUsed > this.minutesIncluded;
});

// Pre-save middleware to compute costs
CompanyBillingStateSchema.pre('save', function(next) {
  // Calculate overage minutes
  if (this.minutesUsed > this.minutesIncluded) {
    this.overageMinutes = this.minutesUsed - this.minutesIncluded;
    this.estimatedOverageCost = this.overageMinutes * (this.overageCostPerMinute || 0.10);
  } else {
    this.overageMinutes = 0;
    this.estimatedOverageCost = 0;
  }
  
  // Calculate total estimated cost
  this.estimatedTotalCost = 
    (this.baseSubscriptionCost || 0) + 
    (this.estimatedOverageCost || 0) + 
    (this.estimatedAiCost || 0);
  
  next();
});

// Static methods
CompanyBillingStateSchema.statics.findOrCreateForCompany = async function(companyId) {
  let state = await this.findOne({ companyId });
  
  if (!state) {
    // Create new billing state for current cycle
    const now = new Date();
    const cycleStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const cycleEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
    
    state = await this.create({
      companyId,
      billingCycleStart: cycleStart,
      billingCycleEnd: cycleEnd,
      plan: 'starter',
      minutesIncluded: 100, // Default 100 minutes
      baseSubscriptionCost: 49.99 // Default $49.99/month
    });
  }
  
  return state;
};

CompanyBillingStateSchema.statics.resetCycle = async function(companyId, newCycleStart, newCycleEnd) {
  const state = await this.findOne({ companyId });
  
  if (state) {
    state.billingCycleStart = newCycleStart;
    state.billingCycleEnd = newCycleEnd;
    state.minutesUsed = 0;
    state.overageMinutes = 0;
    state.estimatedOverageCost = 0;
    state.estimatedAiCost = 0;
    state.tier1UsageCount = 0;
    state.tier2UsageCount = 0;
    state.tier3UsageCount = 0;
    state.tier3Cost = 0;
    state.totalCalls = 0;
    state.bookingsCreated = 0;
    state.overageAlertSent = false;
    state.overageAlertSentAt = null;
    
    await state.save();
  }
  
  return state;
};

CompanyBillingStateSchema.statics.getCompaniesNearingLimit = async function(threshold = 0.9) {
  return this.find({
    $expr: {
      $gte: [
        { $divide: ['$minutesUsed', '$minutesIncluded'] },
        threshold
      ]
    },
    overageAlertSent: false
  });
};

CompanyBillingStateSchema.statics.getCompaniesOverLimit = async function() {
  return this.find({
    $expr: {
      $gt: ['$minutesUsed', '$minutesIncluded']
    }
  }).sort({ overageMinutes: -1 });
};

// Instance methods
CompanyBillingStateSchema.methods.addMinutes = async function(minutes) {
  this.minutesUsed += minutes;
  this.totalCalls += 1;
  return this.save();
};

CompanyBillingStateSchema.methods.addCost = async function(aiCost, tier3Cost = 0) {
  this.estimatedAiCost += aiCost;
  this.tier3Cost += tier3Cost;
  return this.save();
};

CompanyBillingStateSchema.methods.recordBooking = async function() {
  this.bookingsCreated += 1;
  return this.save();
};

CompanyBillingStateSchema.methods.checkOverageAlert = async function() {
  if (this.overageAlertSent) return false;
  
  const usagePercent = this.usagePercent / 100;
  if (usagePercent >= (this.overageThreshold || 0.9)) {
    this.overageAlertSent = true;
    this.overageAlertSentAt = new Date();
    await this.save();
    return true;
  }
  
  return false;
};

module.exports = mongoose.model('CompanyBillingState', CompanyBillingStateSchema);

