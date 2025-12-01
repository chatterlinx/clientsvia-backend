/**
 * ═══════════════════════════════════════════════════════════════════════════
 * DAILY STATS ROLLUP JOB
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Pre-compute daily statistics for instant dashboard loading.
 * Never compute on-the-fly - all analytics come from CallDailyStats.
 * 
 * SCHEDULE:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Runs nightly at 2:00 AM (configurable)
 * - Processes previous day's calls
 * - Also runs catch-up for any missed days
 * 
 * WHAT IT COMPUTES:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Total calls per company per day
 * - Outcome breakdown (completed, booked, transferred, abandoned, etc.)
 * - Tier usage (Tier 1, 2, 3)
 * - Intent breakdown
 * - Hourly distribution (0-23)
 * - Average duration
 * 
 * USAGE:
 * ─────────────────────────────────────────────────────────────────────────────
 * // Run via cron or manually
 * node jobs/dailyStatsRollup.js
 * 
 * // Or import and call directly
 * const { runRollup } = require('./jobs/dailyStatsRollup');
 * await runRollup();
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const CallSummary = require('../models/CallSummary');
const CallDailyStats = require('../models/CallDailyStats');
const V2Company = require('../models/v2Company');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // How many days to look back for catch-up
  MAX_CATCHUP_DAYS: 7,
  
  // Batch size for processing companies
  COMPANY_BATCH_SIZE: 50,
  
  // Enable detailed logging
  DEBUG: process.env.NODE_ENV !== 'production'
};

// ═══════════════════════════════════════════════════════════════════════════
// MAIN ROLLUP FUNCTION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Run the daily stats rollup for a specific date
 * 
 * @param {Date} targetDate - The date to compute stats for
 * @returns {Promise<Object>} - Rollup results
 */
async function rollupForDate(targetDate) {
  const startTime = Date.now();
  
  // Normalize to start of day (UTC)
  const dayStart = new Date(targetDate);
  dayStart.setUTCHours(0, 0, 0, 0);
  
  const dayEnd = new Date(dayStart);
  dayEnd.setUTCDate(dayEnd.getUTCDate() + 1);
  
  const dateStr = dayStart.toISOString().split('T')[0];
  
  logger.info(`[ROLLUP] Starting rollup for ${dateStr}`);
  
  // Get all companies with calls on this day
  const companiesWithCalls = await CallSummary.aggregate([
    {
      $match: {
        startedAt: { $gte: dayStart, $lt: dayEnd }
      }
    },
    {
      $group: {
        _id: '$companyId'
      }
    }
  ]);
  
  const companyIds = companiesWithCalls.map(c => c._id);
  
  logger.info(`[ROLLUP] Found ${companyIds.length} companies with calls on ${dateStr}`);
  
  if (companyIds.length === 0) {
    return {
      date: dateStr,
      companiesProcessed: 0,
      duration: Date.now() - startTime
    };
  }
  
  // Process each company
  let successCount = 0;
  let errorCount = 0;
  
  for (const companyId of companyIds) {
    try {
      await rollupCompanyForDate(companyId, dayStart, dayEnd);
      successCount++;
    } catch (err) {
      errorCount++;
      logger.error(`[ROLLUP] Failed to rollup company ${companyId}`, {
        error: err.message,
        date: dateStr
      });
    }
  }
  
  const duration = Date.now() - startTime;
  
  logger.info(`[ROLLUP] Completed rollup for ${dateStr}`, {
    companiesProcessed: successCount,
    errors: errorCount,
    duration: `${duration}ms`
  });
  
  return {
    date: dateStr,
    companiesProcessed: successCount,
    errors: errorCount,
    duration
  };
}

/**
 * Rollup stats for a single company on a specific date
 * 
 * @param {ObjectId} companyId - Company ID
 * @param {Date} dayStart - Start of day
 * @param {Date} dayEnd - End of day
 */
async function rollupCompanyForDate(companyId, dayStart, dayEnd) {
  // Aggregate all calls for this company on this date
  const stats = await CallSummary.aggregate([
    {
      $match: {
        companyId: new mongoose.Types.ObjectId(companyId),
        startedAt: { $gte: dayStart, $lt: dayEnd }
      }
    },
    {
      $group: {
        _id: null,
        
        // Total calls
        totalCalls: { $sum: 1 },
        
        // Outcome breakdown
        completedCalls: { 
          $sum: { $cond: [{ $eq: ['$outcome', 'completed'] }, 1, 0] } 
        },
        bookedCalls: { 
          $sum: { $cond: [{ $eq: ['$outcome', 'booked'] }, 1, 0] } 
        },
        transferredCalls: { 
          $sum: { $cond: [{ $eq: ['$outcome', 'transferred'] }, 1, 0] } 
        },
        abandonedCalls: { 
          $sum: { $cond: [{ $eq: ['$outcome', 'abandoned'] }, 1, 0] } 
        },
        errorCalls: { 
          $sum: { $cond: [{ $eq: ['$outcome', 'error'] }, 1, 0] } 
        },
        spamCalls: { 
          $sum: { $cond: [{ $eq: ['$outcome', 'spam'] }, 1, 0] } 
        },
        noAnswerCalls: { 
          $sum: { $cond: [{ $eq: ['$outcome', 'no_answer'] }, 1, 0] } 
        },
        voicemailCalls: { 
          $sum: { $cond: [{ $eq: ['$outcome', 'voicemail'] }, 1, 0] } 
        },
        modifiedCalls: { 
          $sum: { $cond: [{ $eq: ['$outcome', 'modified'] }, 1, 0] } 
        },
        
        // Tier usage
        tier1Calls: { 
          $sum: { $cond: [{ $eq: ['$routingTier', 1] }, 1, 0] } 
        },
        tier2Calls: { 
          $sum: { $cond: [{ $eq: ['$routingTier', 2] }, 1, 0] } 
        },
        tier3Calls: { 
          $sum: { $cond: [{ $eq: ['$routingTier', 3] }, 1, 0] } 
        },
        
        // Duration
        totalDuration: { $sum: { $ifNull: ['$durationSeconds', 0] } },
        avgDuration: { $avg: { $ifNull: ['$durationSeconds', 0] } },
        
        // Intent breakdown (grouped in next stage)
        intents: { $push: '$primaryIntent' },
        
        // Hourly distribution (need to extract hour first)
        callTimes: { $push: '$startedAt' }
      }
    }
  ]);
  
  if (stats.length === 0) {
    // No calls for this company on this date
    return;
  }
  
  const data = stats[0];
  
  // Compute intent breakdown
  const intentBreakdown = {};
  for (const intent of data.intents) {
    if (intent) {
      intentBreakdown[intent] = (intentBreakdown[intent] || 0) + 1;
    }
  }
  
  // Compute hourly distribution
  const hourlyDistribution = Array(24).fill(0);
  for (const time of data.callTimes) {
    const hour = new Date(time).getUTCHours();
    hourlyDistribution[hour]++;
  }
  
  // Upsert the daily stats document
  await CallDailyStats.findOneAndUpdate(
    {
      companyId: new mongoose.Types.ObjectId(companyId),
      date: dayStart
    },
    {
      $set: {
        totalCalls: data.totalCalls,
        completedCalls: data.completedCalls,
        bookedCalls: data.bookedCalls,
        transferredCalls: data.transferredCalls,
        abandonedCalls: data.abandonedCalls,
        errorCalls: data.errorCalls,
        spamCalls: data.spamCalls,
        noAnswerCalls: data.noAnswerCalls,
        voicemailCalls: data.voicemailCalls,
        modifiedCalls: data.modifiedCalls,
        tierUsage: {
          tier1: data.tier1Calls,
          tier2: data.tier2Calls,
          tier3: data.tier3Calls
        },
        totalDurationSeconds: data.totalDuration,
        avgDurationSeconds: Math.round(data.avgDuration || 0),
        intentBreakdown,
        hourlyDistribution,
        lastUpdated: new Date()
      }
    },
    { upsert: true, new: true }
  );
  
  logger.debug(`[ROLLUP] Company ${companyId} stats saved`, {
    date: dayStart.toISOString().split('T')[0],
    totalCalls: data.totalCalls,
    booked: data.bookedCalls,
    tier1Rate: data.totalCalls > 0 
      ? `${Math.round((data.tier1Calls / data.totalCalls) * 100)}%` 
      : '0%'
  });
}

/**
 * Run the full rollup process
 * - Rolls up yesterday's stats
 * - Catches up on any missed days
 * 
 * @returns {Promise<Object>} - Full rollup results
 */
async function runRollup() {
  const startTime = Date.now();
  
  logger.info('[ROLLUP] ═══════════════════════════════════════════════════════════════');
  logger.info('[ROLLUP] Starting daily stats rollup job');
  logger.info('[ROLLUP] ═══════════════════════════════════════════════════════════════');
  
  const results = [];
  
  // Always process yesterday
  const yesterday = new Date();
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  
  const yesterdayResult = await rollupForDate(yesterday);
  results.push(yesterdayResult);
  
  // Check for missed days (catch-up)
  const missedDays = await findMissedDays();
  
  if (missedDays.length > 0) {
    logger.info(`[ROLLUP] Found ${missedDays.length} missed days to catch up`);
    
    for (const missedDate of missedDays) {
      const result = await rollupForDate(missedDate);
      results.push(result);
    }
  }
  
  const totalDuration = Date.now() - startTime;
  
  logger.info('[ROLLUP] ═══════════════════════════════════════════════════════════════');
  logger.info('[ROLLUP] Daily stats rollup job completed', {
    daysProcessed: results.length,
    totalDuration: `${totalDuration}ms`
  });
  logger.info('[ROLLUP] ═══════════════════════════════════════════════════════════════');
  
  return {
    success: true,
    daysProcessed: results.length,
    results,
    totalDuration
  };
}

/**
 * Find days that have calls but no rollup stats
 * 
 * @returns {Promise<Date[]>} - Array of dates needing rollup
 */
async function findMissedDays() {
  const missedDays = [];
  
  // Check last N days
  for (let i = 2; i <= CONFIG.MAX_CATCHUP_DAYS; i++) {
    const checkDate = new Date();
    checkDate.setUTCDate(checkDate.getUTCDate() - i);
    checkDate.setUTCHours(0, 0, 0, 0);
    
    const nextDay = new Date(checkDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    
    // Check if we have calls for this day
    const callCount = await CallSummary.countDocuments({
      startedAt: { $gte: checkDate, $lt: nextDay }
    });
    
    if (callCount === 0) continue;
    
    // Check if we have stats for this day
    const statsCount = await CallDailyStats.countDocuments({
      date: checkDate
    });
    
    if (statsCount === 0) {
      missedDays.push(checkDate);
      logger.info(`[ROLLUP] Found missed day: ${checkDate.toISOString().split('T')[0]} (${callCount} calls)`);
    }
  }
  
  return missedDays;
}

/**
 * Force rollup for a specific date range
 * Used for manual catch-up or re-processing
 * 
 * @param {Date} startDate - Start date
 * @param {Date} endDate - End date
 */
async function forceRollupRange(startDate, endDate) {
  const results = [];
  const current = new Date(startDate);
  current.setUTCHours(0, 0, 0, 0);
  
  const end = new Date(endDate);
  end.setUTCHours(0, 0, 0, 0);
  
  while (current <= end) {
    const result = await rollupForDate(current);
    results.push(result);
    current.setUTCDate(current.getUTCDate() + 1);
  }
  
  return results;
}

/**
 * Get rollup status for monitoring
 */
async function getRollupStatus() {
  const now = new Date();
  
  // Get latest rollup date
  const latestStats = await CallDailyStats.findOne()
    .sort({ date: -1 })
    .select('date lastUpdated')
    .lean();
  
  // Get count of missed days
  const missedDays = await findMissedDays();
  
  // Get total stats documents
  const totalDocs = await CallDailyStats.countDocuments();
  
  return {
    status: missedDays.length === 0 ? 'HEALTHY' : 'NEEDS_CATCHUP',
    latestRollupDate: latestStats?.date || null,
    lastUpdated: latestStats?.lastUpdated || null,
    missedDays: missedDays.map(d => d.toISOString().split('T')[0]),
    totalDocuments: totalDocs,
    checkedAt: now
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// CLI EXECUTION
// ═══════════════════════════════════════════════════════════════════════════

async function main() {
  // Connect to MongoDB if not already connected
  if (mongoose.connection.readyState !== 1) {
    const mongoUri = process.env.MONGODB_URI;
    if (!mongoUri) {
      console.error('MONGODB_URI environment variable is required');
      process.exit(1);
    }
    
    await mongoose.connect(mongoUri);
    console.log('Connected to MongoDB');
  }
  
  try {
    const result = await runRollup();
    console.log('Rollup completed:', JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('Rollup failed:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  main();
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = {
  runRollup,
  rollupForDate,
  forceRollupRange,
  getRollupStatus
};

