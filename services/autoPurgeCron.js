/**
 * ============================================================================
 * AUTO-PURGE CRON JOB
 * ============================================================================
 * Automatically hard-deletes companies past their grace period
 * Runs daily at 02:00 UTC
 * ============================================================================
 */

const cron = require('node-cron');
const logger = require('../utils/logger.js');

const Company = require('../models/v2Company');
const DataCenterPurgeService = require('./DataCenterPurgeService');
const AlertEscalationService = require('./AlertEscalationService');
const PlatformHealthCheckService = require('./PlatformHealthCheckService');
const NotificationPurgeService = require('./NotificationPurgeService');
const DailyDigestService = require('./DailyDigestService');

// System user for automated operations
const SYSTEM_USER = {
    _id: '000000000000000000000000',
    id: '000000000000000000000000',
    email: 'system@clientsvia.ai'
};

/**
 * Run auto-purge job
 */
async function runAutoPurge() {
    logger.debug('[AUTO-PURGE] Starting scheduled auto-purge job...');

    try {
        // Find companies past their auto-purge date
        const now = new Date();
        const companiesToPurge = await Company.find({
            isDeleted: true,
            autoPurgeAt: { $lte: now }
        }).option({ includeDeleted: true });

        logger.info(`[AUTO-PURGE] Found ${companiesToPurge.length} companies to purge`);

        if (companiesToPurge.length === 0) {
            logger.info('[AUTO-PURGE] No companies to purge. Exiting.');
            return;
        }

        const results = {
            success: [],
            failed: []
        };

        // Purge each company
        for (const company of companiesToPurge) {
            try {
                logger.info(`[AUTO-PURGE] Purging company: ${company._id} (${company.companyName || company.businessName})`);
                
                const result = await DataCenterPurgeService.hardPurge(
                    company._id.toString(),
                    SYSTEM_USER,
                    {
                        reason: 'Auto-purge after 30-day grace period',
                        metadata: {
                            deletedAt: company.deletedAt,
                            autoPurgeAt: company.autoPurgeAt,
                            scheduledPurge: true
                        }
                    }
                );

                results.success.push({
                    companyId: company._id,
                    companyName: company.companyName || company.businessName,
                    documentsDeleted: result.documentsDeleted
                });

                logger.info(`[AUTO-PURGE] ✅ Successfully purged: ${company._id}`);

            } catch (error) {
                logger.error(`[AUTO-PURGE] ❌ Failed to purge ${company._id}:`, error.message);
                results.failed.push({
                    companyId: company._id,
                    companyName: company.companyName || company.businessName,
                    error: error.message
                });
            }

            // Small delay between purges to avoid DB overload
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        logger.info('[AUTO-PURGE] Job complete!');
        logger.info(`[AUTO-PURGE] Success: ${results.success.length}, Failed: ${results.failed.length}`);

        if (results.failed.length > 0) {
            logger.error('[AUTO-PURGE] Failed companies:', results.failed);
        }

    } catch (error) {
        logger.error('[AUTO-PURGE] Critical error in auto-purge job:', error);
    }
}

/**
 * Initialize auto-purge cron job
 */
function initializeAutoPurgeCron() {
    // ========================================================================
    // CRON JOB 1: AUTO-PURGE DELETED COMPANIES (Daily at 02:00 UTC)
    // ========================================================================
    cron.schedule('0 2 * * *', () => {
        logger.debug('[AUTO-PURGE] Cron triggered at', new Date().toISOString());
        runAutoPurge().catch(error => {
            logger.error('[AUTO-PURGE] Unhandled error in cron job:', error);
        });
    }, {
        timezone: 'UTC'
    });
    logger.debug('[AUTO-PURGE] ✅ Cron job initialized (runs daily at 02:00 UTC)');
    
    // ========================================================================
    // CRON JOB 2: ALERT ESCALATION CHECK (Every 5 minutes)
    // ========================================================================
    cron.schedule('*/5 * * * *', () => {
        logger.info('[ALERT ESCALATION] Cron triggered at', new Date().toISOString());
        AlertEscalationService.checkAndEscalate().catch(error => {
            logger.error('[ALERT ESCALATION] Unhandled error in cron job:', error);
        });
    });
    logger.debug('[ALERT ESCALATION] ✅ Cron job initialized (runs every 5 minutes)');
    
    // ========================================================================
    // CRON JOB 3: PLATFORM HEALTH CHECK (Every 6 hours)
    // ========================================================================
    cron.schedule('0 */6 * * *', () => {
        logger.info('[HEALTH CHECK] Cron triggered at', new Date().toISOString());
        PlatformHealthCheckService.runFullHealthCheck('scheduled').catch(error => {
            logger.error('[HEALTH CHECK] Unhandled error in cron job:', error);
        });
    });
    logger.debug('[HEALTH CHECK] ✅ Cron job initialized (runs every 6 hours)');
    
    // ========================================================================
    // CRON JOB 4: NOTIFICATION LOG PURGE (Daily at 03:00 UTC)
    // ========================================================================
    cron.schedule('0 3 * * *', () => {
        logger.info('[NOTIFICATION PURGE] Cron triggered at', new Date().toISOString());
        NotificationPurgeService.runPurge().catch(error => {
            logger.error('[NOTIFICATION PURGE] Unhandled error in cron job:', error);
        });
    }, {
        timezone: 'UTC'
    });
    logger.debug('[NOTIFICATION PURGE] ✅ Cron job initialized (runs daily at 03:00 UTC)');
    
    // ========================================================================
    // CRON JOB 5: DAILY DIGEST EMAIL (Runs hourly, checks configured time)
    // ========================================================================
    cron.schedule('0 * * * *', async () => {
        try {
            logger.debug('[DAILY DIGEST] Hourly check triggered');
            
            // Get admin settings to check configured time
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.findOne({});
            
            if (!settings?.notificationCenter?.notificationPolicy?.dailyDigest) {
                return;
            }
            
            const digestConfig = settings.notificationCenter.notificationPolicy.dailyDigest;
            
            if (!digestConfig.enabled) {
                return;
            }
            
            // Check if current time matches configured time in specified timezone
            const now = new Date();
            const timezone = digestConfig.timezone || 'America/New_York';
            const configuredTime = digestConfig.time || '08:00';
            
            const nowInTz = now.toLocaleTimeString('en-US', {
                timeZone: timezone,
                hour12: false,
                hour: '2-digit',
                minute: '2-digit'
            });
            
            logger.debug(`[DAILY DIGEST] Current time in ${timezone}: ${nowInTz} | Configured: ${configuredTime}`);
            
            if (nowInTz === configuredTime) {
                logger.info(`[DAILY DIGEST] ⏰ Configured time reached! Sending daily digest...`);
                DailyDigestService.sendDailyDigest().catch(error => {
                    logger.error('[DAILY DIGEST] Unhandled error:', error);
                });
            }
            
        } catch (error) {
            logger.error('[DAILY DIGEST] Error in cron check:', error);
        }
    });
    logger.debug('[DAILY DIGEST] ✅ Cron job initialized (checks hourly for configured time)');
}

module.exports = {
    initializeAutoPurgeCron,
    runAutoPurge // Export for manual testing
};

