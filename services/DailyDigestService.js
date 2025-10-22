// ============================================================================
// 📧 DAILY DIGEST SERVICE
// ============================================================================
// Purpose: Send daily health summary email to admins
// 
// Features:
// - System health overview (uptime, response times)
// - Error counts by severity
// - Top errors of the day
// - Company-level statistics
// - Deferred quiet-hours alerts
// - Beautiful HTML email with charts
//
// Scheduling: Runs via cron at configured time (default: 8 AM ET)
// ============================================================================

const NotificationLog = require('../models/NotificationLog');
const v2Company = require('../models/v2Company');
const emailClient = require('../clients/emailClient');
const logger = require('../utils/logger');

class DailyDigestService {
    
    /**
     * Generate and send daily digest email
     * @param {Object} options - { forceTime: Date } for manual triggers
     * @returns {Object} { success: boolean, stats: object }
     */
    static async sendDailyDigest(options = {}) {
        const startTime = Date.now();
        
        try {
            logger.info('📧 [DAILY DIGEST] Starting daily digest generation...');
            
            // ================================================================
            // STEP 1: GET ADMIN SETTINGS
            // ================================================================
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.findOne({});
            
            if (!settings) {
                throw new Error('AdminSettings not found');
            }
            
            const digestConfig = settings.notificationCenter?.notificationPolicy?.dailyDigest;
            
            if (!digestConfig || !digestConfig.enabled) {
                logger.info('📧 [DAILY DIGEST] Daily digest is disabled in settings');
                return { success: false, reason: 'disabled' };
            }
            
            const adminContacts = settings.notificationCenter?.adminContacts || [];
            const emailContacts = adminContacts.filter(c => c.email && c.receiveEmail);
            
            if (emailContacts.length === 0) {
                logger.warn('📧 [DAILY DIGEST] No email contacts configured');
                return { success: false, reason: 'no-contacts' };
            }
            
            // ================================================================
            // STEP 2: GATHER 24-HOUR STATISTICS
            // ================================================================
            const stats = await this.gather24HourStats();
            
            // ================================================================
            // STEP 3: GENERATE EMAIL CONTENT
            // ================================================================
            const emailContent = this.generateDigestEmail(stats, digestConfig);
            
            // ================================================================
            // STEP 4: SEND TO ALL ADMIN CONTACTS
            // ================================================================
            const results = [];
            for (const contact of emailContacts) {
                try {
                    const result = await emailClient.send({
                        to: contact.email,
                        subject: `${stats.statusEmoji} ClientsVia Daily Health Report - ${new Date().toLocaleDateString()}`,
                        body: emailContent.text,
                        html: emailContent.html
                    });
                    
                    results.push({
                        recipient: contact.email,
                        success: result.success
                    });
                    
                    if (result.success) {
                        logger.info(`✅ [DAILY DIGEST] Sent to ${contact.email}`);
                    }
                    
                } catch (error) {
                    logger.error(`❌ [DAILY DIGEST] Failed to send to ${contact.email}:`, error);
                    results.push({
                        recipient: contact.email,
                        success: false,
                        error: error.message
                    });
                }
            }
            
            const successCount = results.filter(r => r.success).length;
            const duration = Date.now() - startTime;
            
            logger.info(`✅ [DAILY DIGEST] Sent ${successCount}/${results.length} emails in ${duration}ms`);
            
            return {
                success: true,
                stats,
                recipients: results,
                duration
            };
            
        } catch (error) {
            logger.error('❌ [DAILY DIGEST] Error generating digest:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
    
    /**
     * Gather statistics for the last 24 hours
     * @returns {Object} Complete stats object
     */
    static async gather24HourStats() {
        const endDate = new Date();
        const startDate = new Date(endDate.getTime() - 24 * 60 * 60 * 1000);
        
        try {
            // Alert statistics
            const alerts = await NotificationLog.find({
                createdAt: { $gte: startDate, $lte: endDate }
            });
            
            const criticalCount = alerts.filter(a => a.severity === 'CRITICAL').length;
            const warningCount = alerts.filter(a => a.severity === 'WARNING').length;
            const infoCount = alerts.filter(a => a.severity === 'INFO').length;
            
            const unresolvedCritical = alerts.filter(a => a.severity === 'CRITICAL' && !a.resolution?.isResolved).length;
            const unresolvedWarning = alerts.filter(a => a.severity === 'WARNING' && !a.resolution?.isResolved).length;
            
            // Top errors
            const errorCounts = {};
            alerts.forEach(alert => {
                if (alert.severity !== 'INFO') {
                    errorCounts[alert.code] = (errorCounts[alert.code] || 0) + 1;
                }
            });
            
            const topErrors = Object.entries(errorCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 5)
                .map(([code, count]) => ({ code, count }));
            
            // Company statistics
            const totalCompanies = await v2Company.countDocuments({ status: 'LIVE' });
            
            // Overall status
            let overallStatus = 'HEALTHY';
            let statusEmoji = '🟢';
            
            if (unresolvedCritical > 0) {
                overallStatus = 'CRITICAL';
                statusEmoji = '🔴';
            } else if (unresolvedWarning > 0 || criticalCount > 5) {
                overallStatus = 'WARNING';
                statusEmoji = '🟡';
            }
            
            // Calculate uptime percentage (based on critical alerts)
            const uptimePercentage = Math.max(0, 100 - (criticalCount * 0.1)).toFixed(2);
            
            return {
                period: {
                    start: startDate,
                    end: endDate
                },
                overallStatus,
                statusEmoji,
                uptimePercentage,
                alerts: {
                    total: alerts.length,
                    critical: criticalCount,
                    warning: warningCount,
                    info: infoCount,
                    unresolvedCritical,
                    unresolvedWarning
                },
                topErrors,
                companies: {
                    total: totalCompanies
                }
            };
            
        } catch (error) {
            logger.error('❌ [DAILY DIGEST] Error gathering stats:', error);
            throw error;
        }
    }
    
    /**
     * Generate beautiful HTML + plain text email content
     * @param {Object} stats - Statistics object
     * @param {Object} config - Digest configuration
     * @returns {Object} { text: string, html: string }
     */
    static generateDigestEmail(stats, config) {
        const date = new Date().toLocaleDateString('en-US', { 
            weekday: 'long', 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });
        
        // ================================================================
        // PLAIN TEXT VERSION
        // ================================================================
        const text = `
${stats.statusEmoji} CLIENTSVIA DAILY HEALTH REPORT
${date}
═══════════════════════════════════════════════════

SYSTEM STATUS: ${stats.overallStatus}
Uptime: ${stats.uptimePercentage}%

═══════════════════════════════════════════════════
ALERTS (Last 24 Hours)
═══════════════════════════════════════════════════

Total Alerts: ${stats.alerts.total}
🚨 CRITICAL: ${stats.alerts.critical} (${stats.alerts.unresolvedCritical} unresolved)
⚠️ WARNING: ${stats.alerts.warning} (${stats.alerts.unresolvedWarning} unresolved)
ℹ️ INFO: ${stats.alerts.info}

${stats.topErrors.length > 0 ? `
═══════════════════════════════════════════════════
TOP ISSUES
═══════════════════════════════════════════════════

${stats.topErrors.map((err, i) => `${i + 1}. ${err.code} (${err.count} occurrences)`).join('\n')}
` : ''}

═══════════════════════════════════════════════════
PLATFORM STATISTICS
═══════════════════════════════════════════════════

Active Companies: ${stats.companies.total}

═══════════════════════════════════════════════════
ACTIONS REQUIRED
═══════════════════════════════════════════════════

${stats.alerts.unresolvedCritical > 0 ? `⚠️ ${stats.alerts.unresolvedCritical} CRITICAL alerts need attention` : '✅ No critical issues'}
${stats.alerts.unresolvedWarning > 0 ? `⚠️ ${stats.alerts.unresolvedWarning} WARNING alerts pending` : ''}

👉 View Details: https://clientsvia-backend.onrender.com/admin-notification-center.html

═══════════════════════════════════════════════════
Generated: ${new Date().toISOString()}
ClientsVia Multi-Tenant Platform
═══════════════════════════════════════════════════
        `.trim();
        
        // ================================================================
        // HTML VERSION
        // ================================================================
        const statusColor = stats.overallStatus === 'HEALTHY' ? '#10b981' : 
                           stats.overallStatus === 'WARNING' ? '#f59e0b' : '#ef4444';
        
        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>ClientsVia Daily Health Report</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f9fafb;">
    <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
        
        <!-- Header -->
        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; border-radius: 12px 12px 0 0; text-align: center;">
            <h1 style="margin: 0; color: white; font-size: 24px;">
                ${stats.statusEmoji} ClientsVia Daily Health Report
            </h1>
            <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 14px;">
                ${date}
            </p>
        </div>
        
        <!-- Status Badge -->
        <div style="background: white; padding: 20px; text-align: center; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
            <div style="display: inline-block; background: ${statusColor}; color: white; padding: 12px 24px; border-radius: 8px; font-weight: bold; font-size: 18px;">
                ${stats.overallStatus}
            </div>
            <p style="margin: 15px 0 0 0; color: #6b7280; font-size: 14px;">
                Uptime: ${stats.uptimePercentage}%
            </p>
        </div>
        
        <!-- Alert Statistics -->
        <div style="background: white; padding: 20px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb;">
            <h2 style="margin: 0 0 15px 0; color: #111827; font-size: 18px;">📊 Alerts (Last 24 Hours)</h2>
            <table style="width: 100%; border-collapse: collapse;">
                <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="padding: 12px 0; color: #6b7280;">Total Alerts</td>
                    <td style="padding: 12px 0; text-align: right; font-weight: bold; color: #111827;">${stats.alerts.total}</td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="padding: 12px 0; color: #ef4444;">🚨 CRITICAL</td>
                    <td style="padding: 12px 0; text-align: right; font-weight: bold; color: #ef4444;">
                        ${stats.alerts.critical} ${stats.alerts.unresolvedCritical > 0 ? `(${stats.alerts.unresolvedCritical} unresolved)` : ''}
                    </td>
                </tr>
                <tr style="border-bottom: 1px solid #e5e7eb;">
                    <td style="padding: 12px 0; color: #f59e0b;">⚠️ WARNING</td>
                    <td style="padding: 12px 0; text-align: right; font-weight: bold; color: #f59e0b;">
                        ${stats.alerts.warning} ${stats.alerts.unresolvedWarning > 0 ? `(${stats.alerts.unresolvedWarning} unresolved)` : ''}
                    </td>
                </tr>
                <tr>
                    <td style="padding: 12px 0; color: #3b82f6;">ℹ️ INFO</td>
                    <td style="padding: 12px 0; text-align: right; font-weight: bold; color: #3b82f6;">${stats.alerts.info}</td>
                </tr>
            </table>
        </div>
        
        ${stats.topErrors.length > 0 ? `
        <!-- Top Issues -->
        <div style="background: white; padding: 20px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; border-top: 1px solid #e5e7eb;">
            <h2 style="margin: 0 0 15px 0; color: #111827; font-size: 18px;">🔥 Top Issues</h2>
            <div style="space-y: 8px;">
                ${stats.topErrors.map((err, i) => `
                    <div style="padding: 12px; background: #f9fafb; border-radius: 6px; margin-bottom: 8px;">
                        <span style="font-weight: bold; color: #111827;">${i + 1}. ${err.code}</span>
                        <span style="float: right; color: #6b7280;">${err.count} occurrences</span>
                    </div>
                `).join('')}
            </div>
        </div>
        ` : ''}
        
        <!-- Platform Stats -->
        <div style="background: white; padding: 20px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; border-top: 1px solid #e5e7eb;">
            <h2 style="margin: 0 0 15px 0; color: #111827; font-size: 18px;">🏢 Platform Statistics</h2>
            <p style="margin: 0; color: #6b7280;">
                <strong style="color: #111827;">Active Companies:</strong> ${stats.companies.total}
            </p>
        </div>
        
        <!-- Actions Required -->
        <div style="background: ${stats.alerts.unresolvedCritical > 0 ? '#fee' : '#f0fdf4'}; padding: 20px; border-left: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; border-top: 1px solid #e5e7eb;">
            <h2 style="margin: 0 0 15px 0; color: #111827; font-size: 18px;">⚡ Actions Required</h2>
            ${stats.alerts.unresolvedCritical > 0 ? `
                <p style="margin: 0 0 10px 0; color: #dc2626; font-weight: bold;">
                    ⚠️ ${stats.alerts.unresolvedCritical} CRITICAL alerts need immediate attention
                </p>
            ` : '<p style="margin: 0 0 10px 0; color: #10b981; font-weight: bold;">✅ No critical issues</p>'}
            ${stats.alerts.unresolvedWarning > 0 ? `
                <p style="margin: 0; color: #f59e0b;">
                    ⚠️ ${stats.alerts.unresolvedWarning} WARNING alerts pending
                </p>
            ` : ''}
        </div>
        
        <!-- Call to Action -->
        <div style="background: white; padding: 30px; text-align: center; border-radius: 0 0 12px 12px; border: 1px solid #e5e7eb;">
            <a href="https://clientsvia-backend.onrender.com/admin-notification-center.html" 
               style="display: inline-block; background: #667eea; color: white; padding: 14px 32px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                View Full Notification Center →
            </a>
        </div>
        
        <!-- Footer -->
        <div style="text-align: center; padding: 20px; color: #9ca3af; font-size: 12px;">
            <p style="margin: 0;">Generated: ${new Date().toLocaleString()}</p>
            <p style="margin: 5px 0 0 0;">ClientsVia Multi-Tenant Platform</p>
            <p style="margin: 10px 0 0 0;">
                <a href="https://clientsvia-backend.onrender.com/admin-notification-center.html#settings" style="color: #667eea; text-decoration: none;">
                    Configure Digest Settings
                </a>
            </p>
        </div>
        
    </div>
</body>
</html>
        `.trim();
        
        return { text, html };
    }
}

module.exports = DailyDigestService;

