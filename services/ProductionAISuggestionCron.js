// ============================================================================
// PRODUCTION AI SUGGESTION CRON SERVICE
// ============================================================================
// Purpose: Background job that analyzes unanalyzed Tier 3 calls every 5 minutes
// Uses: LLMSuggestionAnalyzer to generate improvement suggestions
// Runs: Automatically on server startup
// ============================================================================

const cron = require('node-cron');
const LLMSuggestionAnalyzer = require('./LLMSuggestionAnalyzer');
const logger = require('../utils/logger');

// ────────────────────────────────────────────────────────────────────────────
// SERVICE CLASS
// ────────────────────────────────────────────────────────────────────────────

class ProductionAISuggestionCron {
  constructor() {
    this.cronJob = null;
    this.isEnabled = process.env.ENABLE_3_TIER_INTELLIGENCE === 'true';
    this.isRunning = false;
    this.lastRunTime = null;
    this.totalProcessed = 0;
    this.totalSucceeded = 0;
    this.totalFailed = 0;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // START CRON JOB
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Start the cron job (runs every 5 minutes)
   */
  start() {
    if (!this.isEnabled) {
      logger.warn('[PRODUCTION AI CRON] Disabled (ENABLE_3_TIER_INTELLIGENCE not set to true)');
      return;
    }

    if (this.cronJob) {
      logger.warn('[PRODUCTION AI CRON] Already running');
      return;
    }

    // Cron expression: */5 * * * * = every 5 minutes
    this.cronJob = cron.schedule('*/5 * * * *', async () => {
      await this.runJob();
    }, {
      scheduled: true,
      timezone: 'America/New_York' // Adjust to your timezone
    });

    logger.info('[PRODUCTION AI CRON] Started - Running every 5 minutes');
    logger.info('[PRODUCTION AI CRON] Next run:', this.cronJob.nextDate().toString());
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STOP CRON JOB
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Stop the cron job
   */
  stop() {
    if (this.cronJob) {
      this.cronJob.stop();
      this.cronJob = null;
      logger.info('[PRODUCTION AI CRON] Stopped');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RUN JOB
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Execute the analysis job
   */
  async runJob() {
    // Prevent overlapping runs
    if (this.isRunning) {
      logger.warn('[PRODUCTION AI CRON] Previous job still running, skipping this run');
      return;
    }

    this.isRunning = true;
    this.lastRunTime = new Date();

    logger.info('[PRODUCTION AI CRON] ╔═══════════════════════════════════════╗');
    logger.info('[PRODUCTION AI CRON] ║   STARTING SUGGESTION ANALYSIS JOB   ║');
    logger.info('[PRODUCTION AI CRON] ╚═══════════════════════════════════════╝');

    try {
      // Process up to 10 calls per run
      const result = await LLMSuggestionAnalyzer.processBatch(10);

      // Update totals
      this.totalProcessed += result.processed;
      this.totalSucceeded += result.succeeded;
      this.totalFailed += result.failed;

      logger.info('[PRODUCTION AI CRON] ╔═══════════════════════════════════════╗');
      logger.info('[PRODUCTION AI CRON] ║         JOB COMPLETED                ║');
      logger.info('[PRODUCTION AI CRON] ╚═══════════════════════════════════════╝');
      logger.info('[PRODUCTION AI CRON] Processed:', result.processed);
      logger.info('[PRODUCTION AI CRON] Succeeded:', result.succeeded);
      logger.info('[PRODUCTION AI CRON] Failed:', result.failed);
      logger.info('[PRODUCTION AI CRON] Total lifetime processed:', this.totalProcessed);
      logger.info('[PRODUCTION AI CRON] Next run:', this.cronJob?.nextDate().toString());

    } catch (error) {
      logger.error('[PRODUCTION AI CRON] Job failed with error:', {
        error: error.message,
        stack: error.stack
      });

    } finally {
      this.isRunning = false;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MANUAL TRIGGER (for testing)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Manually trigger the job (for testing)
   * @returns {Promise<Object>} Result summary
   */
  async triggerManually() {
    logger.info('[PRODUCTION AI CRON] Manual trigger requested');
    await this.runJob();
    return {
      lastRunTime: this.lastRunTime,
      totalProcessed: this.totalProcessed,
      totalSucceeded: this.totalSucceeded,
      totalFailed: this.totalFailed,
      nextRun: this.cronJob?.nextDate().toString()
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // STATUS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Get current cron job status
   * @returns {Object} Status info
   */
  getStatus() {
    return {
      isEnabled: this.isEnabled,
      isRunning: this.isRunning,
      lastRunTime: this.lastRunTime,
      totalProcessed: this.totalProcessed,
      totalSucceeded: this.totalSucceeded,
      totalFailed: this.totalFailed,
      nextRun: this.cronJob?.nextDate().toString() || null,
      schedule: '*/5 * * * * (every 5 minutes)'
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = new ProductionAISuggestionCron();

