/**
 * ════════════════════════════════════════════════════════════════════════════════
 * SMS REMINDER PROCESSOR JOB - V88 (Jan 2026)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Scheduled job that processes due SMS reminders.
 * Runs every 5 minutes to send appointment reminders.
 * 
 * USAGE:
 *   // In index.js or server.js:
 *   const { startSMSReminderJob } = require('./jobs/smsReminderProcessor');
 *   startSMSReminderJob(); // Starts the interval
 * 
 *   // Or run manually:
 *   const { processSMSReminders } = require('./jobs/smsReminderProcessor');
 *   await processSMSReminders();
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const SMSNotificationService = require('../services/SMSNotificationService');
const logger = require('../utils/logger');

// Job interval (5 minutes)
const JOB_INTERVAL_MS = 5 * 60 * 1000;

// Track if job is currently running (prevent overlap)
let isRunning = false;
let jobInterval = null;

/**
 * Process all due SMS reminders
 */
async function processSMSReminders() {
    if (isRunning) {
        logger.debug('[SMS JOB] Skipping - previous job still running');
        return { skipped: true };
    }
    
    isRunning = true;
    const startTime = Date.now();
    
    try {
        logger.info('[SMS JOB] Starting reminder processor...');
        
        const result = await SMSNotificationService.processScheduledMessages();
        
        const duration = Date.now() - startTime;
        logger.info('[SMS JOB] ✅ Complete', {
            processed: result.processed,
            sent: result.sent,
            failed: result.failed,
            durationMs: duration
        });
        
        return result;
        
    } catch (err) {
        logger.error('[SMS JOB] ❌ Failed', {
            error: err.message,
            stack: err.stack
        });
        return { error: err.message };
        
    } finally {
        isRunning = false;
    }
}

/**
 * Start the recurring job
 */
function startSMSReminderJob() {
    if (jobInterval) {
        logger.warn('[SMS JOB] Job already running - not starting another');
        return;
    }
    
    logger.info('[SMS JOB] 🚀 Starting SMS reminder job (every 5 minutes)');
    
    // Run immediately on start
    processSMSReminders();
    
    // Then run every 5 minutes
    jobInterval = setInterval(processSMSReminders, JOB_INTERVAL_MS);
    
    return jobInterval;
}

/**
 * Stop the recurring job
 */
function stopSMSReminderJob() {
    if (jobInterval) {
        clearInterval(jobInterval);
        jobInterval = null;
        logger.info('[SMS JOB] 🛑 Stopped SMS reminder job');
    }
}

/**
 * Get job status
 */
function getJobStatus() {
    return {
        running: !!jobInterval,
        processing: isRunning,
        intervalMs: JOB_INTERVAL_MS
    };
}

module.exports = {
    processSMSReminders,
    startSMSReminderJob,
    stopSMSReminderJob,
    getJobStatus
};
