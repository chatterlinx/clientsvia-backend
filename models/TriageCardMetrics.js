/**
 * TriageCardMetrics Model
 * 
 * PURPOSE: Track real-world performance of each triage card
 * - Fire rate (how often the card matches)
 * - Conversion rate (matched → booking/transfer)
 * - False positive rate (admin marked "wrong match")
 * - Trending arrows (↑ ↓ →)
 * 
 * ARCHITECTURE: Daily rollup + running totals
 * - Daily snapshots for trending
 * - Running totals for overall performance
 * 
 * @module models/TriageCardMetrics
 */

const mongoose = require('mongoose');

const triageCardMetricsSchema = new mongoose.Schema({
  // ═══════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════
  companyId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'V2Company',
    required: true,
    index: true
  },
  
  cardId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'TriageCard',
    required: true,
    index: true
  },
  
  triageLabel: {
    type: String,
    required: true
    // Denormalized for fast queries without joins
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // DATE SCOPE
  // ═══════════════════════════════════════════════════════════════════════════
  date: {
    type: Date,
    required: true,
    index: true
    // One document per card per day
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // FIRE METRICS (How often this card matches)
  // ═══════════════════════════════════════════════════════════════════════════
  fireCount: {
    type: Number,
    default: 0
    // Total times this card was the winning match
  },
  
  // What phrases triggered this card (sample for analysis)
  triggerSamples: [{
    phrase: {
      type: String,
      maxlength: 200
    },
    timestamp: Date,
    callId: mongoose.Schema.Types.ObjectId
  }],
  
  // ═══════════════════════════════════════════════════════════════════════════
  // CONVERSION METRICS (What happened after matching)
  // ═══════════════════════════════════════════════════════════════════════════
  outcomes: {
    // Successful outcomes
    booked: {
      type: Number,
      default: 0
      // Caller booked an appointment after this card matched
    },
    
    transferred: {
      type: Number,
      default: 0
      // Call was transferred to human (as intended)
    },
    
    infoProvided: {
      type: Number,
      default: 0
      // Caller got their question answered
    },
    
    // Neutral outcomes
    hangup: {
      type: Number,
      default: 0
      // Caller hung up after matching (could be satisfied or frustrated)
    },
    
    continued: {
      type: Number,
      default: 0
      // Caller continued to another topic
    },
    
    // Negative outcomes
    wrongRoute: {
      type: Number,
      default: 0
      // Admin marked this as wrong routing
    },
    
    escalated: {
      type: Number,
      default: 0
      // Had to escalate despite card's intended action
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PRECISION METRICS (False positive tracking)
  // ═══════════════════════════════════════════════════════════════════════════
  falsePositives: {
    count: {
      type: Number,
      default: 0
      // Times this card matched when it shouldn't have
    },
    
    samples: [{
      phrase: String,       // What the caller said
      expectedCard: String, // What card SHOULD have matched
      callId: mongoose.Schema.Types.ObjectId,
      markedBy: String,     // Admin who flagged it
      markedAt: Date
    }]
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // MISSED MATCHES (Recall tracking)
  // ═══════════════════════════════════════════════════════════════════════════
  missedMatches: {
    count: {
      type: Number,
      default: 0
      // Times this card SHOULD have matched but didn't
    },
    
    samples: [{
      phrase: String,       // What the caller said
      matchedCard: String,  // What card actually matched (or none)
      callId: mongoose.Schema.Types.ObjectId,
      markedBy: String,
      markedAt: Date
    }]
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // COMPUTED SCORES (Calculated daily)
  // ═══════════════════════════════════════════════════════════════════════════
  scores: {
    // Precision = correct matches / total matches (avoid false positives)
    precision: {
      type: Number,
      min: 0,
      max: 1
    },
    
    // Recall = matches that should have matched / total that should match
    // (Harder to calculate - requires missed match data)
    recall: {
      type: Number,
      min: 0,
      max: 1
    },
    
    // F1 = harmonic mean of precision and recall
    f1Score: {
      type: Number,
      min: 0,
      max: 1
    },
    
    // Conversion rate = successful outcomes / total fires
    conversionRate: {
      type: Number,
      min: 0,
      max: 1
    }
  },
  
  // ═══════════════════════════════════════════════════════════════════════════
  // TRENDING (Compare to previous periods)
  // ═══════════════════════════════════════════════════════════════════════════
  trending: {
    fireRate: {
      type: String,
      enum: ['UP', 'DOWN', 'STABLE', 'NEW'],
      default: 'NEW'
    },
    
    conversionRate: {
      type: String,
      enum: ['UP', 'DOWN', 'STABLE', 'NEW'],
      default: 'NEW'
    },
    
    falsePositiveRate: {
      type: String,
      enum: ['UP', 'DOWN', 'STABLE', 'NEW'],
      default: 'NEW'
    }
  }
  
}, {
  timestamps: true,
  collection: 'triage_card_metrics'
});

// ═══════════════════════════════════════════════════════════════════════════
// INDEXES
// ═══════════════════════════════════════════════════════════════════════════

// One document per card per day per company
triageCardMetricsSchema.index({ companyId: 1, cardId: 1, date: 1 }, { unique: true });

// Fast lookup for dashboard
triageCardMetricsSchema.index({ companyId: 1, date: -1 });

// Find metrics for specific card
triageCardMetricsSchema.index({ cardId: 1, date: -1 });

// ═══════════════════════════════════════════════════════════════════════════
// STATIC METHODS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Record a card match event
 */
triageCardMetricsSchema.statics.recordMatch = async function({
  companyId,
  cardId,
  triageLabel,
  phrase,
  callId
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const update = {
    $inc: { fireCount: 1 },
    $push: {
      triggerSamples: {
        $each: [{ phrase: phrase.substring(0, 200), timestamp: new Date(), callId }],
        $slice: -50 // Keep last 50 samples
      }
    },
    $setOnInsert: {
      companyId,
      cardId,
      triageLabel,
      date: today
    }
  };
  
  return this.findOneAndUpdate(
    { companyId, cardId, date: today },
    update,
    { upsert: true, new: true }
  );
};

/**
 * Record outcome of a card match
 */
triageCardMetricsSchema.statics.recordOutcome = async function({
  companyId,
  cardId,
  outcome, // 'booked', 'transferred', 'infoProvided', 'hangup', 'continued', 'wrongRoute', 'escalated'
  callId
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const validOutcomes = ['booked', 'transferred', 'infoProvided', 'hangup', 'continued', 'wrongRoute', 'escalated'];
  if (!validOutcomes.includes(outcome)) {
    throw new Error(`Invalid outcome: ${outcome}`);
  }
  
  return this.findOneAndUpdate(
    { companyId, cardId, date: today },
    { $inc: { [`outcomes.${outcome}`]: 1 } },
    { new: true }
  );
};

/**
 * Mark a match as false positive
 */
triageCardMetricsSchema.statics.markFalsePositive = async function({
  companyId,
  cardId,
  phrase,
  expectedCard,
  callId,
  markedBy
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return this.findOneAndUpdate(
    { companyId, cardId, date: today },
    {
      $inc: { 'falsePositives.count': 1 },
      $push: {
        'falsePositives.samples': {
          $each: [{ phrase, expectedCard, callId, markedBy, markedAt: new Date() }],
          $slice: -20
        }
      }
    },
    { new: true }
  );
};

/**
 * Mark a missed match (card should have fired but didn't)
 */
triageCardMetricsSchema.statics.markMissedMatch = async function({
  companyId,
  cardId,
  triageLabel,
  phrase,
  matchedCard, // What actually matched (or null)
  callId,
  markedBy
}) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  const update = {
    $inc: { 'missedMatches.count': 1 },
    $push: {
      'missedMatches.samples': {
        $each: [{ phrase, matchedCard, callId, markedBy, markedAt: new Date() }],
        $slice: -20
      }
    },
    $setOnInsert: {
      companyId,
      cardId,
      triageLabel,
      date: today
    }
  };
  
  return this.findOneAndUpdate(
    { companyId, cardId, date: today },
    update,
    { upsert: true, new: true }
  );
};

/**
 * Calculate scores for a day's metrics
 */
triageCardMetricsSchema.statics.calculateDailyScores = async function(companyId, date) {
  const logger = require('../utils/logger');
  
  const dayStart = new Date(date);
  dayStart.setHours(0, 0, 0, 0);
  
  const metrics = await this.find({ companyId, date: dayStart });
  
  for (const metric of metrics) {
    const totalFires = metric.fireCount || 0;
    const falsePositives = metric.falsePositives?.count || 0;
    const missedMatches = metric.missedMatches?.count || 0;
    
    // Precision = (total fires - false positives) / total fires
    const precision = totalFires > 0 
      ? (totalFires - falsePositives) / totalFires 
      : 1;
    
    // Recall = true positives / (true positives + missed matches)
    const truePositives = totalFires - falsePositives;
    const recall = (truePositives + missedMatches) > 0
      ? truePositives / (truePositives + missedMatches)
      : 1;
    
    // F1 Score
    const f1Score = (precision + recall) > 0
      ? 2 * (precision * recall) / (precision + recall)
      : 0;
    
    // Conversion rate
    const successfulOutcomes = (metric.outcomes?.booked || 0) + 
                               (metric.outcomes?.transferred || 0) + 
                               (metric.outcomes?.infoProvided || 0);
    const conversionRate = totalFires > 0
      ? successfulOutcomes / totalFires
      : 0;
    
    metric.scores = {
      precision: Math.round(precision * 100) / 100,
      recall: Math.round(recall * 100) / 100,
      f1Score: Math.round(f1Score * 100) / 100,
      conversionRate: Math.round(conversionRate * 100) / 100
    };
    
    await metric.save();
  }
  
  logger.info('[TRIAGE METRICS] Calculated daily scores', {
    companyId: String(companyId),
    date: dayStart.toISOString().split('T')[0],
    cardsProcessed: metrics.length
  });
  
  return metrics;
};

/**
 * Get card health summary for dashboard
 */
triageCardMetricsSchema.statics.getCardHealthSummary = async function(companyId, days = 7) {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  startDate.setHours(0, 0, 0, 0);
  
  // Aggregate metrics across the date range
  const aggregation = await this.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(companyId),
        date: { $gte: startDate }
      }
    },
    {
      $group: {
        _id: '$cardId',
        triageLabel: { $first: '$triageLabel' },
        totalFires: { $sum: '$fireCount' },
        totalBooked: { $sum: '$outcomes.booked' },
        totalTransferred: { $sum: '$outcomes.transferred' },
        totalWrongRoute: { $sum: '$outcomes.wrongRoute' },
        totalFalsePositives: { $sum: '$falsePositives.count' },
        totalMissedMatches: { $sum: '$missedMatches.count' },
        avgPrecision: { $avg: '$scores.precision' },
        avgRecall: { $avg: '$scores.recall' },
        avgF1: { $avg: '$scores.f1Score' },
        avgConversion: { $avg: '$scores.conversionRate' },
        days: { $sum: 1 }
      }
    },
    {
      $project: {
        cardId: '$_id',
        triageLabel: 1,
        totalFires: 1,
        totalBooked: 1,
        totalTransferred: 1,
        totalWrongRoute: 1,
        totalFalsePositives: 1,
        totalMissedMatches: 1,
        avgPrecision: { $round: ['$avgPrecision', 2] },
        avgRecall: { $round: ['$avgRecall', 2] },
        avgF1: { $round: ['$avgF1', 2] },
        avgConversion: { $round: ['$avgConversion', 2] },
        avgDailyFires: { $round: [{ $divide: ['$totalFires', '$days'] }, 1] },
        healthGrade: {
          $switch: {
            branches: [
              { case: { $gte: ['$avgF1', 0.9] }, then: 'A' },
              { case: { $gte: ['$avgF1', 0.8] }, then: 'B' },
              { case: { $gte: ['$avgF1', 0.7] }, then: 'C' },
              { case: { $gte: ['$avgF1', 0.6] }, then: 'D' }
            ],
            default: 'F'
          }
        }
      }
    },
    {
      $sort: { totalFires: -1 }
    }
  ]);
  
  return aggregation;
};

/**
 * Get unmatched phrases (calls that didn't match any card)
 */
triageCardMetricsSchema.statics.getUnmatchedPhrases = async function(companyId, days = 30, limit = 100) {
  const CallSummary = require('./CallSummary');
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);
  
  // Find calls where triage didn't match
  const unmatchedCalls = await CallSummary.find({
    companyId,
    callStartTime: { $gte: startDate },
    'triageResult.matched': false
  })
  .select('aiContext.firstCallerPhrase aiContext.callerIntent callId')
  .limit(limit)
  .lean();
  
  // Group by phrase similarity (basic grouping)
  const phraseGroups = {};
  for (const call of unmatchedCalls) {
    const phrase = call.aiContext?.firstCallerPhrase || 'unknown';
    const normalized = phrase.toLowerCase().trim();
    
    if (!phraseGroups[normalized]) {
      phraseGroups[normalized] = {
        phrase: normalized,
        count: 0,
        samples: []
      };
    }
    
    phraseGroups[normalized].count++;
    if (phraseGroups[normalized].samples.length < 5) {
      phraseGroups[normalized].samples.push({
        callId: call.callId,
        intent: call.aiContext?.callerIntent
      });
    }
  }
  
  // Sort by frequency
  return Object.values(phraseGroups)
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
};

const TriageCardMetrics = mongoose.model('TriageCardMetrics', triageCardMetricsSchema);

module.exports = TriageCardMetrics;

