// ============================================================================
// 🗑️ NOTIFICATION PURGE SERVICE
// ============================================================================
// Purpose: Intelligent auto-purge of old notification logs
//
// Retention Policy:
// - CRITICAL/WARNING unresolved: NEVER delete (manual resolve required)
// - CRITICAL/WARNING resolved: 90 days
// - INFO unresolved: 60 days (auto-age out)
// - INFO resolved: 30 days
// - All resolved alerts: Minimum 14 days (audit trail)
//
// Runs: Daily via autoPurgeCron.js
//
// Related Files:
// - models/NotificationLog.js
// - services/autoPurgeCron.js
// ============================================================================

const NotificationLog = require('../models/NotificationLog');
const logger = require('../utils/logger.js');

class NotificationPurgeService {
    
    /**
     * 🗑️ RUN PURGE (called by cron daily)
     */
    static async runPurge() {
        try {
            logger.info('🗑️ [NOTIFICATION PURGE] Starting purge cycle...');
            
            const startTime = Date.now();
            let totalDeleted = 0;
            
            // ================================================================
            // 1. PURGE OLD RESOLVED CRITICAL/WARNING (90 days)
            // ================================================================
            const criticalWarningResult = await this.purgeCriticalWarningResolved();
            totalDeleted += criticalWarningResult.deleted;
            
            // ================================================================
            // 2. PURGE OLD INFO UNRESOLVED (60 days - auto-age out)
            // ================================================================
            const infoUnresolvedResult = await this.purgeInfoUnresolved();
            totalDeleted += infoUnresolvedResult.deleted;
            
            // ================================================================
            // 3. PURGE OLD INFO RESOLVED (30 days)
            // ================================================================
            const infoResolvedResult = await this.purgeInfoResolved();
            totalDeleted += infoResolvedResult.deleted;
            
            // ================================================================
            // 4. SAFETY: Ensure minimum 14-day audit trail for ALL resolved
            // ================================================================
            // This is already handled by the date filters above (90d > 14d, 30d > 14d)
            
            const duration = Date.now() - startTime;
            
            logger.info(`✅ [NOTIFICATION PURGE] Purge complete: ${totalDeleted} alerts deleted (${duration}ms)`);
            logger.info(`📊 [NOTIFICATION PURGE] Breakdown: CRITICAL/WARNING=${criticalWarningResult.deleted}, INFO_UNRESOLVED=${infoUnresolvedResult.deleted}, INFO_RESOLVED=${infoResolvedResult.deleted}`);
            
            return {
                success: true,
                totalDeleted,
                breakdown: {
                    criticalWarningResolved: criticalWarningResult.deleted,
                    infoUnresolved: infoUnresolvedResult.deleted,
                    infoResolved: infoResolvedResult.deleted
                },
                duration
            };
            
        } catch (error) {
            logger.error('❌ [NOTIFICATION PURGE] Purge failed:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * 🗑️ PURGE CRITICAL/WARNING RESOLVED (90 days)
     */
    static async purgeCriticalWarningResolved() {
        try {
            const cutoffDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000); // 90 days ago
            
            const result = await NotificationLog.deleteMany({
                severity: { $in: ['CRITICAL', 'WARNING'] },
                'resolution.isResolved': true,
                'resolution.resolvedAt': { $lt: cutoffDate }
            });
            
            logger.debug(`🗑️ [NOTIFICATION PURGE] Deleted ${result.deletedCount} CRITICAL/WARNING resolved alerts older than 90 days`);
            
            return { deleted: result.deletedCount };
            
        } catch (error) {
            logger.error('❌ [NOTIFICATION PURGE] Failed to purge CRITICAL/WARNING resolved:', error);
            return { deleted: 0 };
        }
    }
    
    /**
     * 🗑️ PURGE INFO UNRESOLVED (60 days - auto-age out)
     */
    static async purgeInfoUnresolved() {
        try {
            const cutoffDate = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
            
            const result = await NotificationLog.deleteMany({
                severity: 'INFO',
                'resolution.isResolved': false,
                createdAt: { $lt: cutoffDate }
            });
            
            logger.debug(`🗑️ [NOTIFICATION PURGE] Deleted ${result.deletedCount} INFO unresolved alerts older than 60 days`);
            
            return { deleted: result.deletedCount };
            
        } catch (error) {
            logger.error('❌ [NOTIFICATION PURGE] Failed to purge INFO unresolved:', error);
            return { deleted: 0 };
        }
    }
    
    /**
     * 🗑️ PURGE INFO RESOLVED (30 days)
     */
    static async purgeInfoResolved() {
        try {
            const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
            
            const result = await NotificationLog.deleteMany({
                severity: 'INFO',
                'resolution.isResolved': true,
                'resolution.resolvedAt': { $lt: cutoffDate }
            });
            
            logger.debug(`🗑️ [NOTIFICATION PURGE] Deleted ${result.deletedCount} INFO resolved alerts older than 30 days`);
            
            return { deleted: result.deletedCount };
            
        } catch (error) {
            logger.error('❌ [NOTIFICATION PURGE] Failed to purge INFO resolved:', error);
            return { deleted: 0 };
        }
    }
    
    /**
     * 📊 GET PURGE STATISTICS (for dashboard)
     */
    static async getPurgeStats() {
        try {
            const now = new Date();
            
            // Count alerts by age and status
            const stats = {
                purgeable: {
                    criticalWarningResolved: await NotificationLog.countDocuments({
                        severity: { $in: ['CRITICAL', 'WARNING'] },
                        'resolution.isResolved': true,
                        'resolution.resolvedAt': { $lt: new Date(now - 90 * 24 * 60 * 60 * 1000) }
                    }),
                    infoUnresolved: await NotificationLog.countDocuments({
                        severity: 'INFO',
                        'resolution.isResolved': false,
                        createdAt: { $lt: new Date(now - 60 * 24 * 60 * 60 * 1000) }
                    }),
                    infoResolved: await NotificationLog.countDocuments({
                        severity: 'INFO',
                        'resolution.isResolved': true,
                        'resolution.resolvedAt': { $lt: new Date(now - 30 * 24 * 60 * 60 * 1000) }
                    })
                },
                kept: {
                    unresolvedCriticalWarning: await NotificationLog.countDocuments({
                        severity: { $in: ['CRITICAL', 'WARNING'] },
                        'resolution.isResolved': false
                    }),
                    recent: await NotificationLog.countDocuments({
                        createdAt: { $gte: new Date(now - 30 * 24 * 60 * 60 * 1000) }
                    })
                }
            };
            
            stats.purgeable.total = stats.purgeable.criticalWarningResolved + 
                                    stats.purgeable.infoUnresolved + 
                                    stats.purgeable.infoResolved;
            
            return stats;
            
        } catch (error) {
            logger.error('❌ [NOTIFICATION PURGE] Failed to get stats:', error);
            return null;
        }
    }
}

module.exports = NotificationPurgeService;

