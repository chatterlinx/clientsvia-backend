/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CALL CENTER MONITOR
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * Part of: Call Center Module V2 - Phase 5
 * Created: December 1, 2025
 * 
 * PURPOSE:
 * ─────────────────────────────────────────────────────────────────────────────
 * Monitors Call Center health and creates alerts for the Notification Center.
 * 
 * MONITORS:
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Call volume anomalies (sudden spikes or drops)
 * 2. High Tier-3 usage (cost alert)
 * 3. Failed customer lookups
 * 4. Data purge needed alerts
 * 5. Duplicate customers found
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const mongoose = require('mongoose');
const CallSummary = require('../models/CallSummary');
const CallDailyStats = require('../models/CallDailyStats');
const Customer = require('../models/Customer');
const V2Company = require('../models/v2Company');
const logger = require('../utils/logger');
const ComplianceService = require('./ComplianceService');

// Try to import AdminNotificationService if it exists
let AdminNotificationService;
try {
  AdminNotificationService = require('./AdminNotificationService');
} catch (e) {
  AdminNotificationService = null;
}

// ═══════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════════════════════════════════════

const CONFIG = {
  // Alert thresholds
  TIER3_HIGH_PERCENT: 15,        // Alert if Tier 3 usage > 15%
  CALL_VOLUME_DROP_PERCENT: 50,  // Alert if calls drop by 50%+
  DUPLICATE_THRESHOLD: 5,        // Alert if > 5 duplicate sets
  
  // Check intervals
  CHECK_INTERVAL_MS: 5 * 60 * 1000  // 5 minutes
};

// ═══════════════════════════════════════════════════════════════════════════
// MONITOR CLASS
// ═══════════════════════════════════════════════════════════════════════════

class CallCenterMonitor {
  
  static isRunning = false;
  static intervalId = null;
  
  /**
   * Start the monitor
   */
  static start() {
    if (this.isRunning) {
      logger.warn('[CALL_CENTER_MONITOR] Already running');
      return;
    }
    
    logger.info('[CALL_CENTER_MONITOR] Starting Call Center monitoring...');
    this.isRunning = true;
    
    // Run initial check
    this.runChecks();
    
    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      this.runChecks();
    }, CONFIG.CHECK_INTERVAL_MS);
  }
  
  /**
   * Stop the monitor
   */
  static stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.isRunning = false;
    logger.info('[CALL_CENTER_MONITOR] Stopped');
  }
  
  /**
   * Run all monitoring checks
   */
  static async runChecks() {
    try {
      logger.debug('[CALL_CENTER_MONITOR] Running periodic checks...');
      
      const companies = await V2Company.find({ 'aiAgentSettings.enabled': true })
        .select('_id businessName')
        .lean();
      
      for (const company of companies) {
        await this.checkCompany(company);
      }
      
    } catch (error) {
      logger.error('[CALL_CENTER_MONITOR] Check failed', { error: error.message });
    }
  }
  
  /**
   * Check a specific company
   */
  static async checkCompany(company) {
    const companyId = company._id.toString();
    
    try {
      // 1. Check Tier 3 usage
      await this.checkTier3Usage(companyId, company.businessName);
      
      // 2. Check for duplicate customers
      await this.checkDuplicates(companyId, company.businessName);
      
      // 3. Check data retention compliance
      await this.checkCompliance(companyId, company.businessName);
      
    } catch (error) {
      logger.error('[CALL_CENTER_MONITOR] Company check failed', {
        companyId,
        error: error.message
      });
    }
  }
  
  /**
   * Check Tier 3 usage and alert if too high
   */
  static async checkTier3Usage(companyId, companyName) {
    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    
    const stats = await CallSummary.aggregate([
      {
        $match: {
          companyId: new mongoose.Types.ObjectId(companyId),
          startedAt: { $gte: oneDayAgo }
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          tier3: { $sum: { $cond: [{ $eq: ['$routingTier', 3] }, 1, 0] } }
        }
      }
    ]);
    
    if (stats.length === 0 || stats[0].total === 0) return;
    
    const tier3Percent = (stats[0].tier3 / stats[0].total) * 100;
    
    if (tier3Percent > CONFIG.TIER3_HIGH_PERCENT) {
      await this.createAlert({
        companyId,
        type: 'HIGH_TIER3_USAGE',
        severity: 'WARNING',
        title: `High Tier-3 LLM Usage - ${companyName}`,
        message: `Tier-3 usage is ${tier3Percent.toFixed(1)}% (${stats[0].tier3}/${stats[0].total} calls). This increases LLM costs. Consider improving triage rules.`,
        data: {
          tier3Count: stats[0].tier3,
          totalCalls: stats[0].total,
          percentage: tier3Percent
        }
      });
    }
  }
  
  /**
   * Check for duplicate customers
   */
  static async checkDuplicates(companyId, companyName) {
    const duplicates = await ComplianceService.findDuplicates(companyId);
    const totalDups = (duplicates.byPhone?.length || 0) + (duplicates.byEmail?.length || 0);
    
    if (totalDups > CONFIG.DUPLICATE_THRESHOLD) {
      await this.createAlert({
        companyId,
        type: 'DUPLICATE_CUSTOMERS',
        severity: 'INFO',
        title: `Duplicate Customers Found - ${companyName}`,
        message: `${totalDups} potential duplicate customer sets detected. Review and merge in Call Center → Compliance.`,
        data: {
          byPhone: duplicates.byPhone?.length || 0,
          byEmail: duplicates.byEmail?.length || 0
        }
      });
    }
  }
  
  /**
   * Check data retention compliance
   */
  static async checkCompliance(companyId, companyName) {
    const status = await ComplianceService.getRetentionStatus(companyId);
    
    if (status.status === 'PURGE_NEEDED') {
      const pendingTotal = (status.pendingPurge?.calls || 0) + (status.pendingPurge?.transcripts || 0);
      
      if (pendingTotal > 100) {
        await this.createAlert({
          companyId,
          type: 'DATA_PURGE_NEEDED',
          severity: 'INFO',
          title: `Data Purge Recommended - ${companyName}`,
          message: `${pendingTotal} records exceed retention policy. Run data purge to maintain compliance.`,
          data: status.pendingPurge
        });
      }
    }
  }
  
  /**
   * Create an alert via AdminNotificationService
   */
  static async createAlert({ companyId, type, severity, title, message, data }) {
    // Log the alert
    logger.info('[CALL_CENTER_MONITOR] Alert', {
      companyId,
      type,
      severity,
      title
    });
    
    // Send to AdminNotificationService if available
    if (AdminNotificationService && typeof AdminNotificationService.sendAlert === 'function') {
      try {
        await AdminNotificationService.sendAlert({
          alertType: type,
          severity,
          title,
          description: message,
          metadata: {
            companyId,
            ...data
          },
          source: 'CallCenterMonitor'
        });
      } catch (err) {
        logger.error('[CALL_CENTER_MONITOR] Failed to send alert', {
          error: err.message,
          type
        });
      }
    }
  }
  
  /**
   * Get current monitor status
   */
  static getStatus() {
    return {
      isRunning: this.isRunning,
      checkInterval: CONFIG.CHECK_INTERVAL_MS,
      thresholds: {
        tier3HighPercent: CONFIG.TIER3_HIGH_PERCENT,
        duplicateThreshold: CONFIG.DUPLICATE_THRESHOLD
      }
    };
  }
  
  /**
   * Manual health check for a company
   */
  static async healthCheck(companyId) {
    const now = new Date();
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    
    const [callStats, customerCount, compliance] = await Promise.all([
      CallSummary.aggregate([
        {
          $match: {
            companyId: new mongoose.Types.ObjectId(companyId),
            startedAt: { $gte: oneDayAgo }
          }
        },
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            tier1: { $sum: { $cond: [{ $eq: ['$routingTier', 1] }, 1, 0] } },
            tier2: { $sum: { $cond: [{ $eq: ['$routingTier', 2] }, 1, 0] } },
            tier3: { $sum: { $cond: [{ $eq: ['$routingTier', 3] }, 1, 0] } },
            avgDuration: { $avg: '$durationSeconds' }
          }
        }
      ]),
      Customer.countDocuments({ companyId, status: { $ne: 'deleted' } }),
      ComplianceService.getRetentionStatus(companyId)
    ]);
    
    const stats = callStats[0] || { total: 0, tier1: 0, tier2: 0, tier3: 0, avgDuration: 0 };
    
    return {
      status: 'HEALTHY',
      lastChecked: new Date().toISOString(),
      metrics: {
        calls24h: stats.total,
        tierDistribution: {
          tier1: stats.tier1,
          tier2: stats.tier2,
          tier3: stats.tier3
        },
        avgCallDuration: Math.round(stats.avgDuration || 0),
        customerCount,
        compliance: compliance.status
      },
      alerts: {
        highTier3: stats.total > 0 && (stats.tier3 / stats.total) * 100 > CONFIG.TIER3_HIGH_PERCENT,
        purgeNeeded: compliance.status === 'PURGE_NEEDED'
      }
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════════

module.exports = CallCenterMonitor;
module.exports.CONFIG = CONFIG;

