 
// Console.log statements are intentional for monitoring and debugging notification delivery
// ============================================================================
// 🔔 ADMIN NOTIFICATION SERVICE
// ============================================================================
// Purpose: Core notification engine with auto-registration and validation
// 
// Key Features:
// - Auto-registers notification points on first use
// - Validates entire notification chain before sending
// - Sends SMS + Email to all admin contacts
// - Records full delivery audit trail
// - Integrates with AlertEscalationService for follow-up
// - Provides stack trace analysis for error context
//
// Usage Example:
//   await AdminNotificationService.sendAlert({
//       code: 'TWILIO_GREETING_FALLBACK',
//       severity: 'WARNING',
//       companyId: company._id,
//       companyName: company.companyName,
//       message: 'Twilio greeting fallback triggered',
//       details: error.message
//   });
//
// This will:
// 1. Auto-register 'TWILIO_GREETING_FALLBACK' in NotificationRegistry
// 2. Validate notification system is working
// 3. Send SMS to all admin phones
// 4. Send email to all admin emails  
// 5. Create NotificationLog entry
// 6. Start escalation timer if not acknowledged
//
// Related Files:
// - models/NotificationLog.js (stores alerts)
// - models/NotificationRegistry.js (tracks notification points)
// - services/AlertEscalationService.js (handles escalation)
// - routes/v2twilio.js (example usage)
// ============================================================================

const v2Company = require('../models/v2Company');
const logger = require('../utils/logger.js');

const NotificationLog = require('../models/NotificationLog');
const NotificationRegistry = require('../models/NotificationRegistry');
const smsClient = require('../clients/smsClient');
const emailClient = require('../clients/emailClient');
const errorIntelligence = require('./ErrorIntelligenceService');
const SmartGroupingService = require('./SmartGroupingService');

class AdminNotificationService {
    
    /**
     * 🔔 SEND ALERT TO ADMINS
     * Main entry point - call this from anywhere in the codebase
     */
    static async sendAlert({
        code,           // Unique code (e.g., 'TWILIO_GREETING_FALLBACK')
        severity,       // 'CRITICAL', 'WARNING', 'INFO'
        companyId = null,
        companyName = 'Platform-Wide',
        message,        // Short description
        details = '',   // Long description / error message
        stackTrace = null
    }) {
        const startTime = Date.now();
        
        try {
            logger.debug(`🔔 [ADMIN NOTIFICATION] Starting alert: ${code} (${severity})`);
            
            // ================================================================
            // STEP 1: AUTO-REGISTER THIS NOTIFICATION POINT
            // ================================================================
            const callerInfo = this.getCallerInfo();
            await NotificationRegistry.registerOrUpdate({
                code: code.toUpperCase(),
                file: callerInfo.file,
                line: callerInfo.line,
                severity
            });
            
            // ================================================================
            // STEP 2: VALIDATE NOTIFICATION SYSTEM
            // ================================================================
            const validationResult = await this.validateNotificationSystem();
            
            if (!validationResult.isValid) {
                logger.error(`❌ [ADMIN NOTIFICATION] Validation failed for ${code}:`, validationResult.errors);
                // Continue anyway - we want the alert logged even if delivery fails
            }
            
            // ================================================================
            // STEP 3: GET ADMIN CONTACTS (from AdminSettings)
            // ================================================================
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.findOne({});
            
            if (!settings) {
                throw new Error('AdminSettings not found - initialize first');
            }
            
            const adminContacts = settings.notificationCenter?.adminContacts || [];
            
            if (adminContacts.length === 0) {
                throw new Error('No admin contacts configured in Settings tab');
            }
            
            logger.debug(`📋 [ADMIN NOTIFICATION] Found ${adminContacts.length} admin contacts from AdminSettings`);
            
            // ================================================================
            // STEP 3.25: CHECK NOTIFICATION POLICY (Respect quiet hours & severity rules)
            // ================================================================
            const policy = await AdminSettings.shouldSendNotification(severity);
            const isQuietHours = await AdminSettings.isQuietHours();
            
            logger.debug(`🔔 [POLICY CHECK] Severity: ${severity} | SMS: ${policy.sendSMS} | Email: ${policy.sendEmail} | LogOnly: ${policy.logOnly} | QuietHours: ${isQuietHours}`);
            
            // If log-only, just log and return early
            if (policy.logOnly) {
                logger.info(`📋 [POLICY] ${severity} alerts are log-only. Skipping SMS/Email delivery for ${code}`);
                
                // Create log entry but don't send notifications
                const notificationLog = await NotificationLog.create({
                    code: code.toUpperCase(),
                    severity,
                    companyId,
                    companyName,
                    message,
                    details,
                    stackTrace,
                    status: 'info',
                    intelligence: {}, // Skip intelligence for INFO logs
                    deliveryAttempts: [{
                        attemptNumber: 1,
                        timestamp: new Date(),
                        sms: [],
                        email: [],
                        call: [],
                        status: 'log-only'
                    }],
                    escalation: {
                        isEnabled: false,
                        currentLevel: 0,
                        maxLevel: 0
                    }
                });
                
                logger.info(`✅ [POLICY] ${severity} alert logged: ${notificationLog.alertId}`);
                return { success: true, alertId: notificationLog.alertId, policyAction: 'log-only' };
            }
            
            // If in quiet hours, handle based on severity
            if (isQuietHours) {
                const quietHoursPolicy = settings.notificationCenter?.notificationPolicy?.quietHours;
                
                if (severity === 'CRITICAL' && quietHoursPolicy?.allowCritical) {
                    logger.info(`🌙 [QUIET HOURS] CRITICAL alert - sending immediately despite quiet hours`);
                } else if (severity === 'WARNING' && quietHoursPolicy?.deferWarnings) {
                    logger.info(`🌙 [QUIET HOURS] WARNING alert - deferring to morning digest`);
                    // TODO: Add to queued alerts for morning digest
                    return { success: true, alertId: null, policyAction: 'deferred-to-digest' };
                } else if (severity === 'WARNING') {
                    logger.info(`🌙 [QUIET HOURS] WARNING alert - sending (defer disabled)`);
                }
            }
            
            // ================================================================
            // STEP 3.4: SMART GROUPING (Prevent Alert Storms)
            // ================================================================
            const smartGroupingPolicy = settings.notificationCenter?.notificationPolicy?.smartGrouping;
            const groupCheck = await SmartGroupingService.shouldGroupError(
                code.toUpperCase(),
                severity,
                smartGroupingPolicy
            );
            
            if (groupCheck.shouldGroup) {
                // Check if we've already sent a grouped alert recently
                const recentCheck = await SmartGroupingService.hasRecentGroupedAlert(groupCheck.groupKey);
                
                if (recentCheck.alreadySent) {
                    logger.info(`🔗 [SMART GROUPING] Skipping duplicate - grouped alert sent ${recentCheck.sentInfo.minutesAgo}min ago`);
                    return { success: true, alertId: null, policyAction: 'grouped-duplicate' };
                }
                
                // This is the first grouped alert - modify the message
                const groupedMessage = SmartGroupingService.generateGroupedMessage(
                    code.toUpperCase(),
                    groupCheck.count,
                    groupCheck.windowMinutes,
                    smartGroupingPolicy?.groupMessage
                );
                
                logger.info(`🔗 [SMART GROUPING] Sending grouped alert: ${groupedMessage}`);
                
                // Override the message with grouped version
                message = groupedMessage;
                details = `${details}\n\n🔗 GROUPED ALERT: ${groupCheck.count} occurrences of ${code.toUpperCase()} detected in ${groupCheck.windowMinutes} minutes.\n\nThis alert has been consolidated to prevent notification spam.`;
                
                // Mark that we've sent the grouped alert
                await SmartGroupingService.markGroupedAlertSent(groupCheck.groupKey, groupCheck.count);
            } else if (groupCheck.count > 0) {
                logger.debug(`🔗 [SMART GROUPING] ${code.toUpperCase()}: ${groupCheck.count} occurrences (threshold not reached)`);
            }
            
            // ================================================================
            // STEP 3.5: ENHANCE ERROR WITH INTELLIGENCE
            // ================================================================
            const errorAnalysis = errorIntelligence.enhanceError({
                code: code.toUpperCase(),
                error: stackTrace ? { message, stack: stackTrace } : { message },
                companyId,
                context: {
                    sourceFile: callerInfo.file,
                    sourceLine: callerInfo.line
                }
            });
            
            logger.debug(`🧠 [ADMIN NOTIFICATION] Enhanced error with intelligence:`, {
                rootCause: errorAnalysis.intelligence.dependencies.rootCause,
                cascadeFailures: errorAnalysis.intelligence.dependencies.cascadeFailures
            });
            
            // ================================================================
            // STEP 4: CREATE NOTIFICATION LOG ENTRY (with intelligence)
            // ================================================================
            const notificationLog = await NotificationLog.create({
                code: code.toUpperCase(),
                severity,
                companyId,
                companyName,
                message,
                details,
                stackTrace,
                
                // Add error intelligence to log
                intelligence: errorAnalysis.intelligence,
                
                // Set escalation schedule based on severity
                escalation: {
                    isEnabled: severity !== 'INFO',  // No escalation for INFO
                    currentLevel: 1,
                    maxLevel: severity === 'CRITICAL' ? 5 : 3,
                    nextEscalationAt: this.calculateNextEscalation(severity, 1)
                }
            });
            
            logger.debug(`✅ [ADMIN NOTIFICATION] Created log entry: ${notificationLog.alertId}`);
            
            // ================================================================
            // STEP 5: SEND SMS TO ALL ADMINS (if policy allows)
            // ================================================================
            let smsResults = [];
            if (policy.sendSMS) {
                logger.debug(`📱 [POLICY] SMS enabled for ${severity} - sending to admins`);
                smsResults = await this.sendSMSToAdmins({
                    alertId: notificationLog.alertId,
                    code,
                    severity,
                    companyName,
                    message,
                    details,
                    adminContacts
                });
            } else {
                logger.debug(`📱 [POLICY] SMS disabled for ${severity} - skipping SMS delivery`);
            }
            
            // ================================================================
            // STEP 6: SEND EMAIL TO ALL ADMINS (if policy allows)
            // ================================================================
            let emailResults = [];
            if (policy.sendEmail) {
                logger.debug(`📧 [POLICY] Email enabled for ${severity} - sending to admins`);
                emailResults = await this.sendEmailToAdmins({
                    alertId: notificationLog.alertId,
                    code,
                    severity,
                    companyName,
                    message,
                    details,
                    adminContacts
                });
            } else {
                logger.debug(`📧 [POLICY] Email disabled for ${severity} - skipping email delivery`);
            }
            
            // ================================================================
            // STEP 7: RECORD DELIVERY ATTEMPT IN LOG
            // ================================================================
            notificationLog.deliveryAttempts.push({
                attemptNumber: 1,
                timestamp: new Date(),
                sms: smsResults,
                email: emailResults,
                call: []
            });
            
            // Calculate first delivery time
            notificationLog.metrics.firstDeliveryTime = Date.now() - startTime;
            
            await notificationLog.save();
            
            // ================================================================
            // STEP 8: UPDATE REGISTRY STATISTICS
            // ================================================================
            const registry = await NotificationRegistry.findOne({ code: code.toUpperCase() });
            if (registry) {
                const allSuccess = smsResults.every(r => r.status === 'sent' || r.status === 'delivered');
                await registry.updateStats(allSuccess);
            }
            
            logger.info(`✅ [ADMIN NOTIFICATION] Alert ${notificationLog.alertId} sent successfully`);
            logger.info(`📊 [ADMIN NOTIFICATION] SMS: ${smsResults.filter(r => r.status === 'sent').length}/${smsResults.length} sent`);
            logger.info(`📊 [ADMIN NOTIFICATION] Email: ${emailResults.filter(r => r.status === 'sent').length}/${emailResults.length} sent`);
        
        return { 
            success: true, 
                alertId: notificationLog.alertId,
                smsResults,
                emailResults
        };
        
    } catch (error) {
            logger.error(`❌ [ADMIN NOTIFICATION] Failed to send alert ${code}:`, error);
            
            // Log to notification center about the notification system failure
            // (but prevent infinite recursion by checking the error code)
            if (code !== 'NOTIFICATION_SYSTEM_FAILURE') {
                try {
                    // Self-report the failure to the notification center
                    await NotificationLog.create({
                        code: 'NOTIFICATION_SYSTEM_FAILURE',
                        severity: 'CRITICAL',
                        companyId,
                        companyName,
                        message: `Failed to send notification: ${code}`,
                        details: error.message,
                        stackTrace: error.stack,
                        deliveryAttempts: [{
                            attemptNumber: 1,
                            timestamp: new Date(),
                            sms: [],
                            email: [],
                            call: []
                        }],
                        escalation: {
                            isEnabled: false  // Don't escalate notification system failures
                        }
                    });
                } catch (logError) {
                    // Last resort - just log to console/file
                    logger.error(`❌ [ADMIN NOTIFICATION] Failed to log notification failure:`, logError);
                }
            }
            
            // Even if sending fails, try to log the original attempt
            try {
                await NotificationLog.create({
                    code: code.toUpperCase(),
                    severity,
                    companyId,
                    companyName,
                    message,
                    details,
                    stackTrace,
                    deliveryAttempts: [{
                        attemptNumber: 1,
                        timestamp: new Date(),
                        sms: [{ status: 'failed', error: error.message }],
                        email: [],
                        call: []
                    }],
                    escalation: {
                        isEnabled: false  // Disable escalation for failed initial send
                    }
                });
            } catch (logError) {
                logger.error(`❌ [ADMIN NOTIFICATION] Failed to log error:`, logError);
            }
            
        return { 
            success: false, 
                error: error.message
            };
        }
    }
    
    /**
     * 📱 SEND SMS TO ALL ADMIN CONTACTS
     */
    static async sendSMSToAdmins({ alertId, code, severity, companyName, message, details, adminContacts }) {
        const results = [];
        
        const severityEmoji = {
            CRITICAL: '🚨',
            WARNING: '⚠️',
            INFO: 'ℹ️'
        };
        
        const smsMessage = `
${severityEmoji[severity]} ClientsVia ${severity} Alert
ID: ${alertId}

Company: ${companyName}
Issue: ${message}

${details ? `Details: ${details}` : ''}

⚠️ RESPOND: Text "ACK ${alertId}" to this number

View: https://app.clientsvia.com/admin-notification-center.html
        `.trim();
        
        // Get Twilio credentials from AdminSettings
        const AdminSettings = require('../models/AdminSettings');
        const settings = await AdminSettings.findOne({});
        
        if (!settings?.notificationCenter?.twilio?.accountSid || 
            !settings?.notificationCenter?.twilio?.authToken ||
            !settings?.notificationCenter?.twilio?.phoneNumber) {
            logger.error('❌ [SMS] Twilio credentials not configured in AdminSettings');
            return [{
                status: 'failed',
                error: 'Twilio credentials not configured in Settings tab'
            }];
        }
        
        // Create Twilio client with AdminSettings credentials
        const twilio = require('twilio');
        const twilioClient = twilio(
            settings.notificationCenter.twilio.accountSid,
            settings.notificationCenter.twilio.authToken
        );
        
        logger.info(`✅ [SMS] Using Twilio credentials from AdminSettings (SID: ...${settings.notificationCenter.twilio.accountSid.slice(-4)})`);
        
        // Send to all admin contacts with SMS enabled
        const smsContacts = adminContacts.filter(c => c.receiveSMS !== false);
        
        for (const contact of smsContacts) {
            try {
                logger.info(`📱 [SMS] Sending to ${contact.name} (${contact.phone})...`);
                
                const result = await twilioClient.messages.create({
                    to: contact.phone,
                    from: settings.notificationCenter.twilio.phoneNumber,
                    body: smsMessage
                });
                
                results.push({
                    recipient: contact.phone,
                    recipientName: contact.name,
                    status: 'sent',
                    twilioSid: result.sid,
                    twilioStatus: result.status,
                    deliveredAt: null  // Will be updated by webhook
                });
                
                logger.info(`✅ [SMS] Sent to ${contact.name}: ${result.sid}`);
                
            } catch (error) {
                logger.error(`❌ [SMS] Failed to send to ${contact.name}:`, error);
                
                results.push({
                    recipient: contact.phone,
                    recipientName: contact.name,
                    status: 'failed',
                    error: error.message
                });
            }
        }
        
        return results;
    }
    
    /**
     * 📧 SEND EMAIL TO ALL ADMIN CONTACTS
     */
    static async sendEmailToAdmins({ alertId, code, severity, companyName, message, details, adminContacts }) {
        const results = [];
        
        const emailContacts = adminContacts.filter(c => c.email && c.receiveEmail !== false);
        
        if (emailContacts.length === 0) {
            logger.info('📧 [EMAIL] No admin contacts with email enabled');
            return results;
        }
        
        const severityEmoji = {
            'CRITICAL': '🚨',
            'WARNING': '⚠️',
            'INFO': 'ℹ️'
        }[severity] || '📢';
        
        const subject = `${severityEmoji} [ClientsVia Alert] ${code}`;
        const emailBody = `
${severityEmoji} CLIENTSVIA ADMIN ALERT
═══════════════════════════════════════════

Alert ID: ${alertId}
Code: ${code}
Severity: ${severity}
Company: ${companyName}

MESSAGE:
${message}

DETAILS:
${details}

═══════════════════════════════════════════
Timestamp: ${new Date().toISOString()}
View full details: https://clientsvia-backend.onrender.com/admin-notification-center.html#logs
        `.trim();
        
        const htmlBody = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto;">
                <div style="padding: 20px; background: ${severity === 'CRITICAL' ? '#fee' : severity === 'WARNING' ? '#fffbeb' : '#eff6ff'}; border-left: 4px solid ${severity === 'CRITICAL' ? '#dc2626' : severity === 'WARNING' ? '#f59e0b' : '#3b82f6'}; border-radius: 8px;">
                    <h2 style="margin: 0 0 15px 0; color: ${severity === 'CRITICAL' ? '#991b1b' : severity === 'WARNING' ? '#92400e' : '#1e40af'};">
                        ${severityEmoji} ClientsVia Admin Alert
                    </h2>
                    <table style="width: 100%; border-collapse: collapse;">
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold; width: 120px;">Alert ID:</td>
                            <td style="padding: 8px 0;">${alertId}</td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold;">Code:</td>
                            <td style="padding: 8px 0;"><code style="background: #f3f4f6; padding: 2px 6px; border-radius: 4px;">${code}</code></td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold;">Severity:</td>
                            <td style="padding: 8px 0;"><strong>${severity}</strong></td>
                        </tr>
                        <tr>
                            <td style="padding: 8px 0; font-weight: bold;">Company:</td>
                            <td style="padding: 8px 0;">${companyName}</td>
                        </tr>
                    </table>
                    
                    <div style="margin: 20px 0; padding: 15px; background: white; border-radius: 6px;">
                        <p style="margin: 0 0 10px 0; font-weight: bold;">Message:</p>
                        <p style="margin: 0;">${message}</p>
                    </div>
                    
                    ${details ? `
                    <div style="margin: 20px 0; padding: 15px; background: white; border-radius: 6px;">
                        <p style="margin: 0 0 10px 0; font-weight: bold;">Details:</p>
                        <pre style="margin: 0; white-space: pre-wrap; font-size: 13px; color: #374151;">${details}</pre>
                    </div>
                    ` : ''}
                    
                    <div style="margin-top: 20px; text-align: center;">
                        <a href="https://clientsvia-backend.onrender.com/admin-notification-center.html#logs" 
                           style="display: inline-block; padding: 12px 24px; background: #3b82f6; color: white; text-decoration: none; border-radius: 6px; font-weight: bold;">
                            View in Notification Center →
                        </a>
                    </div>
                </div>
                
                <p style="margin-top: 20px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; font-size: 12px; color: #6b7280;">
                    ${new Date().toISOString()}<br>
                    This is an automated alert from ClientsVia Platform
                </p>
            </div>
        `;
        
        for (const contact of emailContacts) {
            try {
                logger.info(`📧 [EMAIL] Sending to ${contact.name} (${contact.email})...`);
                
                const result = await emailClient.send({
                    to: contact.email,
                    subject: subject,
                    body: emailBody,
                    html: htmlBody
                });
                
                if (result.success) {
                    logger.info(`✅ [EMAIL] Sent to ${contact.name} (${contact.email})`);
                    results.push({
                        recipient: contact.email,
                        recipientName: contact.name,
                        status: 'sent',
                        messageId: result.messageId,
                        provider: 'gmail',
                        timestamp: new Date()
                    });
                } else {
                    logger.error(`❌ [EMAIL] Failed to send to ${contact.name}: ${result.error}`);
                    results.push({
                        recipient: contact.email,
                        recipientName: contact.name,
                        status: 'failed',
                        error: result.error,
                        provider: 'gmail',
                        timestamp: new Date()
                    });
                }
                
            } catch (error) {
                logger.error(`❌ [EMAIL] Exception sending to ${contact.name}:`, error);
                results.push({
                    recipient: contact.email,
                    recipientName: contact.name,
                    status: 'failed',
                    error: error.message,
                    provider: 'gmail',
                    timestamp: new Date()
                });
            }
        }
        
        const successCount = results.filter(r => r.status === 'sent').length;
        logger.info(`📧 [EMAIL] Sent ${successCount}/${results.length} admin emails`);
        
        return results;
    }
    
    /**
     * 🔍 VALIDATE ENTIRE NOTIFICATION SYSTEM
     */
    static async validateNotificationSystem() {
        const checks = {
            isValid: true,
            errors: []
        };
        
        try {
            // Check 1: AdminSettings exists
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.findOne({});
            
            if (!settings) {
                checks.isValid = false;
                checks.errors.push('AdminSettings not found - initialize first');
                return checks;
            }
            
            // Check 2: Admin contacts exist
            const adminContacts = settings.notificationCenter?.adminContacts || [];
            
            if (adminContacts.length === 0) {
                checks.isValid = false;
                checks.errors.push('No admin contacts configured (add in Settings tab)');
            }
            
            // Check 3: At least one contact has SMS enabled
            const smsEnabledContacts = adminContacts.filter(c => c.receiveSMS !== false);
            if (smsEnabledContacts.length === 0) {
                checks.isValid = false;
                checks.errors.push('No admin contacts with SMS enabled');
            }
            
            // Check 4: SMS client configured
            if (!smsClient || !smsClient.send) {
                checks.isValid = false;
                checks.errors.push('SMS client not configured');
            }
            
            // Check 5: Twilio credentials (from AdminSettings or env vars)
            const hasTwilioInSettings = settings?.notificationCenter?.twilio?.accountSid;
            const hasTwilioInEnv = process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN;
            
            if (!hasTwilioInSettings && !hasTwilioInEnv) {
                checks.isValid = false;
                checks.errors.push('Twilio credentials not configured (check Settings tab)');
            }
            
        } catch (error) {
            checks.isValid = false;
            checks.errors.push(`Validation error: ${error.message}`);
        }
        
        return checks;
    }
    
    /**
     * 📍 GET CALLER INFO (for auto-registration)
     */
    static getCallerInfo() {
        const stack = new Error().stack;
        const stackLines = stack.split('\n');
        
        // Go up the stack to find the actual caller (skip this file)
        for (let i = 3; i < stackLines.length; i++) {
            const line = stackLines[i];
            
            // Skip node_modules and this file
            if (line.includes('node_modules') || line.includes('AdminNotificationService')) {
                continue;
            }
            
            // Extract file and line number
            const match = line.match(/\((.+):(\d+):\d+\)/);
            if (match) {
                let filePath = match[1];
                const lineNumber = parseInt(match[2]);
                
                // Make path relative to project root
                const projectRoot = process.cwd();
                if (filePath.startsWith(projectRoot)) {
                    filePath = filePath.substring(projectRoot.length + 1);
                }
        
        return {
                    file: filePath,
                    line: lineNumber
        };
            }
        }
        
        return {
            file: 'unknown',
            line: 0
        };
    }
    
    /**
     * ⏱️ CALCULATE NEXT ESCALATION TIME
     */
    static calculateNextEscalation(severity, currentLevel) {
        const now = new Date();
        
        const intervals = {
            CRITICAL: [30, 30, 30, 15, 15],  // minutes
            WARNING: [60, 60, 60],
            INFO: []  // No escalation
        };
        
        const minutes = intervals[severity]?.[currentLevel - 1] || 0;
        
        if (minutes === 0) {
            return null;  // No escalation
        }
        
        return new Date(now.getTime() + minutes * 60 * 1000);
    }
    
    /**
     * ✅ ACKNOWLEDGE ALERT (called from UI or SMS webhook)
     */
    static async acknowledgeAlert(alertId, acknowledgedBy, via = 'WEB_UI', message = '') {
        try {
            const alert = await NotificationLog.findOne({ alertId });
            
            if (!alert) {
                throw new Error(`Alert ${alertId} not found`);
            }
            
            if (alert.acknowledgment.isAcknowledged) {
                logger.info(`⚠️ [ADMIN NOTIFICATION] Alert ${alertId} already acknowledged`);
                return { success: false, message: 'Alert already acknowledged' };
            }
            
            await alert.acknowledge(acknowledgedBy, via, message);
            
            logger.info(`✅ [ADMIN NOTIFICATION] Alert ${alertId} acknowledged by ${acknowledgedBy} via ${via}`);
            
            // Update registry stats
            const registry = await NotificationRegistry.findOne({ code: alert.code });
            if (registry && alert.metrics.acknowledgmentTime) {
                await registry.updateStats(true, alert.metrics.acknowledgmentTime);
            }
            
            // Send confirmation SMS
            await this.sendAcknowledgmentConfirmation(alert, acknowledgedBy);
            
            return { success: true, alert };
            
        } catch (error) {
            logger.error(`❌ [ADMIN NOTIFICATION] Failed to acknowledge alert ${alertId}:`, error);
            throw error;
        }
    }
    
    /**
     * 📱 SEND ACKNOWLEDGMENT CONFIRMATION SMS
     */
    static async sendAcknowledgmentConfirmation(alert, acknowledgedBy) {
        try {
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.findOne({});
            
            if (!settings) {
                logger.error('❌ AdminSettings not found');
                return;
            }
            
            if (!settings?.notificationCenter?.twilio?.accountSid || 
                !settings?.notificationCenter?.twilio?.authToken ||
                !settings?.notificationCenter?.twilio?.phoneNumber) {
                logger.error('❌ [SMS] Twilio credentials not configured');
                return;
            }
            
            // Create Twilio client with AdminSettings credentials
            const twilio = require('twilio');
            const twilioClient = twilio(
                settings.notificationCenter.twilio.accountSid,
                settings.notificationCenter.twilio.authToken
            );
            
            const adminContacts = settings.notificationCenter?.adminContacts?.filter(
                c => c.receiveSMS !== false
            ) || [];
            
            const message = `
✅ Alert ${alert.alertId} acknowledged by ${acknowledgedBy}.

No further notifications will be sent.

To reopen: Text "REOPEN ${alert.alertId}"
            `.trim();
            
            for (const contact of adminContacts) {
                try {
                    await twilioClient.messages.create({
                        to: contact.phone,
                        from: settings.notificationCenter.twilio.phoneNumber,
                        body: message
                    });
                    logger.info(`✅ [SMS] Sent ACK confirmation to ${contact.name}`);
                } catch (error) {
                    logger.error(`❌ Failed to send confirmation to ${contact.name}:`, error);
                }
            }
        
    } catch (error) {
            logger.error('❌ Failed to send acknowledgment confirmation:', error);
        }
    }
}

module.exports = AdminNotificationService;
