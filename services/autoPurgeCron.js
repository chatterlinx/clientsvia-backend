/**
 * ============================================================================
 * AUTO-PURGE CRON JOB
 * ============================================================================
 * Automatically hard-deletes companies past their grace period
 * Runs daily at 02:00 UTC
 * ============================================================================
 */

const cron = require('node-cron');
const Company = require('../models/v2Company');
const DataCenterPurgeService = require('./DataCenterPurgeService');
const AlertEscalationService = require('./AlertEscalationService');
const PlatformHealthCheckService = require('./PlatformHealthCheckService');

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
    console.log('[AUTO-PURGE] Starting scheduled auto-purge job...');

    try {
        // Find companies past their auto-purge date
        const now = new Date();
        const companiesToPurge = await Company.find({
            isDeleted: true,
            autoPurgeAt: { $lte: now }
        }).option({ includeDeleted: true });

        console.log(`[AUTO-PURGE] Found ${companiesToPurge.length} companies to purge`);

        if (companiesToPurge.length === 0) {
            console.log('[AUTO-PURGE] No companies to purge. Exiting.');
            return;
        }

        const results = {
            success: [],
            failed: []
        };

        // Purge each company
        for (const company of companiesToPurge) {
            try {
                console.log(`[AUTO-PURGE] Purging company: ${company._id} (${company.companyName || company.businessName})`);
                
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

                console.log(`[AUTO-PURGE] ✅ Successfully purged: ${company._id}`);

            } catch (error) {
                console.error(`[AUTO-PURGE] ❌ Failed to purge ${company._id}:`, error.message);
                results.failed.push({
                    companyId: company._id,
                    companyName: company.companyName || company.businessName,
                    error: error.message
                });
            }

            // Small delay between purges to avoid DB overload
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        console.log('[AUTO-PURGE] Job complete!');
        console.log(`[AUTO-PURGE] Success: ${results.success.length}, Failed: ${results.failed.length}`);

        if (results.failed.length > 0) {
            console.error('[AUTO-PURGE] Failed companies:', results.failed);
        }

    } catch (error) {
        console.error('[AUTO-PURGE] Critical error in auto-purge job:', error);
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
        console.log('[AUTO-PURGE] Cron triggered at', new Date().toISOString());
        runAutoPurge().catch(error => {
            console.error('[AUTO-PURGE] Unhandled error in cron job:', error);
        });
    }, {
        timezone: 'UTC'
    });
    console.log('[AUTO-PURGE] ✅ Cron job initialized (runs daily at 02:00 UTC)');
    
    // ========================================================================
    // CRON JOB 2: ALERT ESCALATION CHECK (Every 5 minutes)
    // ========================================================================
    cron.schedule('*/5 * * * *', () => {
        console.log('[ALERT ESCALATION] Cron triggered at', new Date().toISOString());
        AlertEscalationService.checkAndEscalate().catch(error => {
            console.error('[ALERT ESCALATION] Unhandled error in cron job:', error);
        });
    });
    console.log('[ALERT ESCALATION] ✅ Cron job initialized (runs every 5 minutes)');
    
    // ========================================================================
    // CRON JOB 3: PLATFORM HEALTH CHECK (Every 6 hours)
    // ========================================================================
    cron.schedule('0 */6 * * *', () => {
        console.log('[HEALTH CHECK] Cron triggered at', new Date().toISOString());
        PlatformHealthCheckService.runFullHealthCheck('scheduled').catch(error => {
            console.error('[HEALTH CHECK] Unhandled error in cron job:', error);
        });
    });
    console.log('[HEALTH CHECK] ✅ Cron job initialized (runs every 6 hours)');
}

module.exports = {
    initializeAutoPurgeCron,
    runAutoPurge // Export for manual testing
};

