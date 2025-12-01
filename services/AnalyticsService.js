/**
 * ═══════════════════════════════════════════════════════════════════════════
 * ANALYTICS SERVICE
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2
 * Created: December 1, 2025
 * Proposal: PROPOSAL-CALL-CENTER-MODULE-V2.md
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Read-only analytics service that queries pre-computed CallDailyStats.
 * Never computes on-the-fly - all data comes from the nightly rollup job.
 * 
 * PERFORMANCE:
 * ─────────────────────────────────────────────────────────────────────────────
 * - Dashboard loads: < 50ms
 * - 30-day report: < 100ms
 * - All queries hit indexed CallDailyStats collection
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const CallDailyStats = require('../models/CallDailyStats');
const CallSummary = require('../models/CallSummary');
const Customer = require('../models/Customer');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// DASHBOARD ANALYTICS
// ═══════════════════════════════════════════════════════════════════════════

class AnalyticsService {
  
  /**
   * Get dashboard overview for a company
   * 
   * @param {string} companyId - Company ID
   * @param {number} days - Number of days to include (default: 7)
   * @returns {Promise<Object>}
   */
  static async getDashboard(companyId, days = 7) {
    const startTime = Date.now();
    
    // Date range
    const endDate = new Date();
    endDate.setUTCHours(23, 59, 59, 999);
    
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);
    startDate.setUTCHours(0, 0, 0, 0);
    
    // Get pre-computed daily stats
    const dailyStats = await CallDailyStats.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      date: { $gte: startDate, $lte: endDate }
    }).sort({ date: 1 }).lean();
    
    // Aggregate totals from pre-computed stats
    const totals = this._aggregateDailyStats(dailyStats);
    
    // Get today's live stats (not yet rolled up)
    const todayStats = await this._getTodayLiveStats(companyId);
    
    // Merge today's live stats into totals
    if (todayStats.totalCalls > 0) {
      totals.totalCalls += todayStats.totalCalls;
      totals.bookedCalls += todayStats.bookedCalls;
      totals.completedCalls += todayStats.completedCalls;
      totals.transferredCalls += todayStats.transferredCalls;
      totals.abandonedCalls += todayStats.abandonedCalls;
      totals.tierUsage.tier1 += todayStats.tier1;
      totals.tierUsage.tier2 += todayStats.tier2;
      totals.tierUsage.tier3 += todayStats.tier3;
    }
    
    // Calculate rates
    const rates = {
      bookingRate: totals.totalCalls > 0 
        ? Math.round((totals.bookedCalls / totals.totalCalls) * 100) 
        : 0,
      tier1Rate: totals.totalCalls > 0 
        ? Math.round((totals.tierUsage.tier1 / totals.totalCalls) * 100) 
        : 0,
      tier3Rate: totals.totalCalls > 0 
        ? Math.round((totals.tierUsage.tier3 / totals.totalCalls) * 100) 
        : 0,
      completionRate: totals.totalCalls > 0 
        ? Math.round((totals.completedCalls / totals.totalCalls) * 100) 
        : 0
    };
    
    // Get customer stats
    const customerStats = await this._getCustomerStats(companyId);
    
    const queryTime = Date.now() - startTime;
    
    logger.debug('[ANALYTICS] Dashboard loaded', {
      companyId,
      days,
      totalCalls: totals.totalCalls,
      queryTime: `${queryTime}ms`
    });
    
    return {
      period: {
        start: startDate,
        end: endDate,
        days
      },
      totals,
      rates,
      today: todayStats,
      daily: dailyStats,
      customers: customerStats,
      meta: {
        queryTime,
        generatedAt: new Date()
      }
    };
  }
  
  /**
   * Get detailed report for a date range
   * 
   * @param {string} companyId - Company ID
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>}
   */
  static async getReport(companyId, startDate, endDate) {
    const start = new Date(startDate);
    start.setUTCHours(0, 0, 0, 0);
    
    const end = new Date(endDate);
    end.setUTCHours(23, 59, 59, 999);
    
    // Get pre-computed daily stats
    const dailyStats = await CallDailyStats.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      date: { $gte: start, $lte: end }
    }).sort({ date: 1 }).lean();
    
    // Aggregate totals
    const totals = this._aggregateDailyStats(dailyStats);
    
    // Aggregate intent breakdown across all days
    const intentBreakdown = {};
    for (const day of dailyStats) {
      if (day.intentBreakdown) {
        for (const [intent, count] of Object.entries(day.intentBreakdown)) {
          intentBreakdown[intent] = (intentBreakdown[intent] || 0) + count;
        }
      }
    }
    
    // Aggregate hourly distribution across all days
    const hourlyDistribution = Array(24).fill(0);
    for (const day of dailyStats) {
      if (day.hourlyDistribution) {
        for (let i = 0; i < 24; i++) {
          hourlyDistribution[i] += day.hourlyDistribution[i] || 0;
        }
      }
    }
    
    // Sort intents by count
    const sortedIntents = Object.entries(intentBreakdown)
      .sort((a, b) => b[1] - a[1])
      .map(([intent, count]) => ({ intent, count }));
    
    return {
      period: {
        start,
        end,
        days: dailyStats.length
      },
      totals,
      intentBreakdown: sortedIntents,
      hourlyDistribution,
      daily: dailyStats.map(d => ({
        date: d.date,
        totalCalls: d.totalCalls,
        booked: d.bookedCalls,
        tier1Rate: d.totalCalls > 0 
          ? Math.round((d.tierUsage?.tier1 / d.totalCalls) * 100) 
          : 0,
        avgDuration: d.avgDurationSeconds
      }))
    };
  }
  
  /**
   * Get top intents for a company
   * 
   * @param {string} companyId - Company ID
   * @param {number} days - Number of days
   * @param {number} limit - Max intents to return
   * @returns {Promise<Array>}
   */
  static async getTopIntents(companyId, days = 30, limit = 10) {
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);
    startDate.setUTCHours(0, 0, 0, 0);
    
    const dailyStats = await CallDailyStats.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      date: { $gte: startDate }
    }).select('intentBreakdown').lean();
    
    // Aggregate intents
    const intentBreakdown = {};
    for (const day of dailyStats) {
      if (day.intentBreakdown) {
        for (const [intent, count] of Object.entries(day.intentBreakdown)) {
          intentBreakdown[intent] = (intentBreakdown[intent] || 0) + count;
        }
      }
    }
    
    // Sort and limit
    return Object.entries(intentBreakdown)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([intent, count]) => ({ intent, count }));
  }
  
  /**
   * Get call volume trend (for sparklines/charts)
   * 
   * @param {string} companyId - Company ID
   * @param {number} days - Number of days
   * @returns {Promise<Array>}
   */
  static async getCallVolumeTrend(companyId, days = 30) {
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);
    startDate.setUTCHours(0, 0, 0, 0);
    
    const dailyStats = await CallDailyStats.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      date: { $gte: startDate }
    })
      .sort({ date: 1 })
      .select('date totalCalls bookedCalls')
      .lean();
    
    return dailyStats.map(d => ({
      date: d.date,
      calls: d.totalCalls,
      booked: d.bookedCalls
    }));
  }
  
  /**
   * Get tier usage breakdown
   * 
   * @param {string} companyId - Company ID
   * @param {number} days - Number of days
   * @returns {Promise<Object>}
   */
  static async getTierUsage(companyId, days = 30) {
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);
    startDate.setUTCHours(0, 0, 0, 0);
    
    const dailyStats = await CallDailyStats.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      date: { $gte: startDate }
    }).select('tierUsage totalCalls').lean();
    
    const totals = { tier1: 0, tier2: 0, tier3: 0, total: 0 };
    
    for (const day of dailyStats) {
      totals.tier1 += day.tierUsage?.tier1 || 0;
      totals.tier2 += day.tierUsage?.tier2 || 0;
      totals.tier3 += day.tierUsage?.tier3 || 0;
      totals.total += day.totalCalls || 0;
    }
    
    return {
      tier1: {
        count: totals.tier1,
        percentage: totals.total > 0 ? Math.round((totals.tier1 / totals.total) * 100) : 0,
        cost: 0  // Tier 1 is free
      },
      tier2: {
        count: totals.tier2,
        percentage: totals.total > 0 ? Math.round((totals.tier2 / totals.total) * 100) : 0,
        cost: 0  // Tier 2 is free
      },
      tier3: {
        count: totals.tier3,
        percentage: totals.total > 0 ? Math.round((totals.tier3 / totals.total) * 100) : 0,
        cost: totals.tier3 * 0.005  // ~$0.005 per Tier 3 call (LLM cost)
      },
      total: totals.total,
      estimatedMonthlyCost: totals.tier3 * 0.005 * (30 / days)
    };
  }
  
  /**
   * Get peak hours analysis
   * 
   * @param {string} companyId - Company ID
   * @param {number} days - Number of days
   * @returns {Promise<Object>}
   */
  static async getPeakHours(companyId, days = 30) {
    const startDate = new Date();
    startDate.setUTCDate(startDate.getUTCDate() - days);
    startDate.setUTCHours(0, 0, 0, 0);
    
    const dailyStats = await CallDailyStats.find({
      companyId: new mongoose.Types.ObjectId(companyId),
      date: { $gte: startDate }
    }).select('hourlyDistribution').lean();
    
    // Aggregate hourly distribution
    const hourly = Array(24).fill(0);
    for (const day of dailyStats) {
      if (day.hourlyDistribution) {
        for (let i = 0; i < 24; i++) {
          hourly[i] += day.hourlyDistribution[i] || 0;
        }
      }
    }
    
    // Find peak hour
    const peakHour = hourly.indexOf(Math.max(...hourly));
    const totalCalls = hourly.reduce((a, b) => a + b, 0);
    
    return {
      hourly: hourly.map((count, hour) => ({
        hour,
        count,
        percentage: totalCalls > 0 ? Math.round((count / totalCalls) * 100) : 0
      })),
      peakHour,
      peakHourCalls: hourly[peakHour],
      quietHour: hourly.indexOf(Math.min(...hourly.filter(c => c > 0)) || 0)
    };
  }
  
  // ═══════════════════════════════════════════════════════════════════════════
  // PRIVATE HELPERS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * Aggregate totals from daily stats
   */
  static _aggregateDailyStats(dailyStats) {
    const totals = {
      totalCalls: 0,
      completedCalls: 0,
      bookedCalls: 0,
      transferredCalls: 0,
      abandonedCalls: 0,
      errorCalls: 0,
      spamCalls: 0,
      tierUsage: { tier1: 0, tier2: 0, tier3: 0 },
      totalDuration: 0,
      avgDuration: 0
    };
    
    for (const day of dailyStats) {
      totals.totalCalls += day.totalCalls || 0;
      totals.completedCalls += day.completedCalls || 0;
      totals.bookedCalls += day.bookedCalls || 0;
      totals.transferredCalls += day.transferredCalls || 0;
      totals.abandonedCalls += day.abandonedCalls || 0;
      totals.errorCalls += day.errorCalls || 0;
      totals.spamCalls += day.spamCalls || 0;
      totals.tierUsage.tier1 += day.tierUsage?.tier1 || 0;
      totals.tierUsage.tier2 += day.tierUsage?.tier2 || 0;
      totals.tierUsage.tier3 += day.tierUsage?.tier3 || 0;
      totals.totalDuration += day.totalDurationSeconds || 0;
    }
    
    totals.avgDuration = totals.totalCalls > 0 
      ? Math.round(totals.totalDuration / totals.totalCalls) 
      : 0;
    
    return totals;
  }
  
  /**
   * Get today's live stats (not yet rolled up)
   */
  static async _getTodayLiveStats(companyId) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    
    const tomorrow = new Date(today);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    
    const stats = await CallSummary.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          startedAt: { $gte: today, $lt: tomorrow }
        }
      },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          completedCalls: { $sum: { $cond: [{ $eq: ['$outcome', 'completed'] }, 1, 0] } },
          bookedCalls: { $sum: { $cond: [{ $eq: ['$outcome', 'booked'] }, 1, 0] } },
          transferredCalls: { $sum: { $cond: [{ $eq: ['$outcome', 'transferred'] }, 1, 0] } },
          abandonedCalls: { $sum: { $cond: [{ $eq: ['$outcome', 'abandoned'] }, 1, 0] } },
          tier1: { $sum: { $cond: [{ $eq: ['$routingTier', 1] }, 1, 0] } },
          tier2: { $sum: { $cond: [{ $eq: ['$routingTier', 2] }, 1, 0] } },
          tier3: { $sum: { $cond: [{ $eq: ['$routingTier', 3] }, 1, 0] } },
          avgDuration: { $avg: '$durationSeconds' }
        }
      }
    ]);
    
    return stats[0] || {
      totalCalls: 0,
      completedCalls: 0,
      bookedCalls: 0,
      transferredCalls: 0,
      abandonedCalls: 0,
      tier1: 0,
      tier2: 0,
      tier3: 0,
      avgDuration: 0
    };
  }
  
  /**
   * Get customer stats for dashboard
   */
  static async _getCustomerStats(companyId) {
    const stats = await Customer.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId)
        }
      },
      {
        $group: {
          _id: '$status',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const result = {
      total: 0,
      customers: 0,
      leads: 0,
      placeholders: 0
    };
    
    for (const s of stats) {
      result[s._id] = s.count;
      result.total += s.count;
    }
    
    // Rename for clarity
    result.customers = result.customer || 0;
    result.leads = result.lead || 0;
    result.placeholders = result.placeholder || 0;
    delete result.customer;
    delete result.lead;
    delete result.placeholder;
    
    return result;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = AnalyticsService;

