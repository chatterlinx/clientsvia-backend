// ============================================================================
// 🔄 ALERT ESCALATION SERVICE
// ============================================================================
// Purpose: Automatic SMS re-sending until admin acknowledges
//
// Key Features:
// - Runs every 5 minutes via cron job
// - Finds unacknowledged alerts past nextEscalationAt time
// - Resends SMS + Email automatically
// - Escalates to phone calls for CRITICAL level 4+
// - Tracks all escalation attempts
// - Stops when alert is acknowledged
//
// Escalation Timelines:
//   CRITICAL: 0min → 30min → 1hr → 1.5hr → 1hr45 (then every 15min)
//   WARNING:  0min → 1hr → 2hr → 3hr (stop after 3 attempts)
//   INFO:     No escalation
//
// Related Files:
// - models/NotificationLog.js (stores escalation state)
// - services/AdminNotificationService.js (creates initial alerts)
// - services/autoPurgeCron.js (runs this service every 5 min)
// ============================================================================

const NotificationLog = require('../models/NotificationLog');
const logger = require('../utils/logger.js');

const v2Company = require('../models/v2Company');
const smsClient = require('../clients/smsClient');

class AlertEscalationService {
    
    /**
     * 🔍 CHECK FOR ALERTS NEEDING ESCALATION
     * Called every 5 minutes by cron job
     */
    static async checkAndEscalate() {
        try {
            const now = new Date();
            
            logger.info('🔍 [ESCALATION] Checking for unacknowledged alerts...');
            
            // Find alerts that need escalation
            const alertsToEscalate = await NotificationLog.find({
                'acknowledgment.isAcknowledged': false,
                'resolution.isResolved': false,
                'escalation.escalationPaused': false,
                'escalation.nextEscalationAt': { $lte: now }
            });
            
            if (alertsToEscalate.length === 0) {
                logger.info('✅ [ESCALATION] No alerts need escalation');
                return { escalated: 0 };
            }
            
            logger.info(`📊 [ESCALATION] Found ${alertsToEscalate.length} alerts to escalate`);
            
            let escalatedCount = 0;
            
            for (const alert of alertsToEscalate) {
                try {
                    // Check if we've hit max escalation level
                    if (alert.escalation.currentLevel >= alert.escalation.maxLevel) {
                        logger.info(`⚠️ [ESCALATION] Alert ${alert.alertId} has reached max level ${alert.escalation.maxLevel}`);
                        continue;
                    }
                    
                    await this.escalateAlert(alert);
                    escalatedCount++;
                    
                } catch (error) {
                    logger.error(`❌ [ESCALATION] Failed to escalate alert ${alert.alertId}:`, error);
                }
            }
            
            logger.info(`✅ [ESCALATION] Successfully escalated ${escalatedCount}/${alertsToEscalate.length} alerts`);
            
            return { escalated: escalatedCount };
            
        } catch (error) {
            logger.error('❌ [ESCALATION] Error in checkAndEscalate:', error);
            return { error: error.message };
        }
    }
    
    /**
     * 🚨 ESCALATE SINGLE ALERT
     */
    static async escalateAlert(alert) {
        const nextLevel = alert.escalation.currentLevel + 1;
        
        logger.info(`🔺 [ESCALATION] Escalating alert ${alert.alertId} to level ${nextLevel} (${alert.severity})`);
        
        try {
            // Get admin contacts from AdminSettings
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.findOne({});
            
            if (!settings) {
                throw new Error('AdminSettings not found - initialize first');
            }
            
            const adminContacts = settings.notificationCenter?.adminContacts || [];
            
            if (adminContacts.length === 0) {
                throw new Error('No admin contacts configured in Settings tab');
            }
            
            // Create new delivery attempt
            const deliveryAttempt = {
                attemptNumber: nextLevel,
                timestamp: new Date(),
                sms: [],
                email: [],
                call: []
            };
            
            // ================================================================
            // SEND SMS (always for escalation)
            // ================================================================
            const smsResults = await this.sendEscalationSMS(alert, adminContacts, nextLevel);
            deliveryAttempt.sms = smsResults;
            
            // ================================================================
            // SEND EMAIL (always for escalation)
            // ================================================================
            const emailResults = await this.sendEscalationEmail(alert, adminContacts, nextLevel);
            deliveryAttempt.email = emailResults;
            
            // ================================================================
            // MAKE PHONE CALLS (for CRITICAL level 4+)
            // ================================================================
            if (alert.severity === 'CRITICAL' && nextLevel >= 4) {
                logger.debug(`📞 [ESCALATION] CRITICAL level ${nextLevel} - initiating phone calls`);
                const callResults = await this.makeEscalationCalls(alert, adminContacts, nextLevel);
                deliveryAttempt.call = callResults;
            }
            
            // ================================================================
            // UPDATE ALERT IN DATABASE
            // ================================================================
            alert.deliveryAttempts.push(deliveryAttempt);
            alert.escalation.currentLevel = nextLevel;
            
            // Add to escalation history
            alert.escalation.escalationHistory.push({
                level: nextLevel,
                timestamp: new Date(),
                action: 'sent'
            });
            
            // Calculate next escalation time
            const nextEscalationTime = this.calculateNextEscalation(alert.severity, nextLevel);
            alert.escalation.nextEscalationAt = nextEscalationTime;
            
            // If we've hit max level, pause escalation
            if (nextLevel >= alert.escalation.maxLevel) {
                logger.info(`⚠️ [ESCALATION] Alert ${alert.alertId} reached max level - stopping escalation`);
                alert.escalation.escalationPaused = true;
            }
            
            await alert.save();
            
            logger.info(`✅ [ESCALATION] Alert ${alert.alertId} escalated to level ${nextLevel}`);
            logger.info(`📊 [ESCALATION] SMS: ${smsResults.filter(r => r.status === 'sent').length}/${smsResults.length} sent`);
            logger.info(`⏱️  [ESCALATION] Next escalation: ${nextEscalationTime || 'N/A'}`);
            
            return { success: true };
            
        } catch (error) {
            logger.error(`❌ [ESCALATION] Failed to escalate alert ${alert.alertId}:`, error);
            throw error;
        }
    }
    
    /**
     * 📱 SEND ESCALATION SMS
     */
    static async sendEscalationSMS(alert, adminContacts, attemptNumber) {
        const results = [];
        
        const severityEmoji = {
            CRITICAL: '🚨',
            WARNING: '⚠️',
            INFO: 'ℹ️'
        };
        
        const smsMessage = `
${severityEmoji[alert.severity]} ESCALATION ${attemptNumber}/${alert.escalation.maxLevel}
ID: ${alert.alertId}

${alert.message}

⚠️ NO RESPONSE RECEIVED
Please acknowledge IMMEDIATELY!

Text: "ACK ${alert.alertId}"

View: https://app.clientsvia.com/admin-notification-center.html

Company: ${alert.companyName}
Time: ${new Date().toLocaleTimeString()}
        `.trim();
        
        // Get Twilio credentials from AdminSettings
        const AdminSettings = require('../models/AdminSettings');
        const settings = await AdminSettings.findOne({});
        
        if (!settings?.notificationCenter?.twilio?.accountSid || 
            !settings?.notificationCenter?.twilio?.authToken ||
            !settings?.notificationCenter?.twilio?.phoneNumber) {
            logger.error('❌ [ESCALATION SMS] Twilio credentials not configured');
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
        
        // Use receiveSMS filter (matches AdminNotificationService)
        const smsContacts = adminContacts.filter(c => c.receiveSMS !== false);
        
        for (const contact of smsContacts) {
            try {
                logger.info(`📱 [ESCALATION SMS] Sending to ${contact.name} (${contact.phone})...`);
                
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
                    twilioStatus: result.status
                });
                
                logger.info(`✅ [ESCALATION SMS] Sent to ${contact.name}`);
                
            } catch (error) {
                logger.error(`❌ [ESCALATION SMS] Failed to send to ${contact.name}:`, error);
                
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
     * 📧 SEND ESCALATION EMAIL
     */
    static async sendEscalationEmail(alert, adminContacts, attemptNumber) {
        const results = [];
        
        const emailContacts = adminContacts.filter(c => c.email && c.emailNotifications !== false);
        
        for (const contact of emailContacts) {
            // TODO: Implement email sending via SendGrid/AWS SES
            // For now, just log that we would send email
            logger.info(`📧 [ESCALATION EMAIL] Would send to ${contact.name} (${contact.email})`);
            
            results.push({
                recipient: contact.email,
                recipientName: contact.name,
                status: 'pending',
                provider: 'not-configured'
            });
        }
        
        return results;
    }
    
    /**
     * 📞 MAKE ESCALATION PHONE CALLS (CRITICAL level 4+)
     * 
     * 🚨 LESSON LEARNED (Oct 2025 - Twilio crash loop):
     * ALWAYS validate phone numbers before making Twilio calls!
     * 
     * THE PROBLEM:
     * - AdminSettings had contacts with missing/null phoneNumber fields
     * - Code called twilioClient.calls.create({ to: null })
     * - Twilio throws: "Required parameter 'params['to']' missing"
     * - This triggered an alert → which tried to call AGAIN → infinite loop
     * 
     * THE SOLUTION:
     * - Added safety check BEFORE making Twilio call
     * - Validates: phoneNumber exists, is string, and not empty
     * - Skips invalid contacts and logs warning instead of crashing
     * 
     * WHAT TO CHECK IF YOU SEE THIS ERROR:
     * 1. Look at AdminSettings → adminContacts array
     * 2. Verify every contact has a valid phoneNumber field
     * 3. Check that phoneCallAlerts is properly configured
     * 4. Never remove this validation - Twilio doesn't handle null gracefully
     */
    static async makeEscalationCalls(alert, adminContacts, attemptNumber) {
        const results = [];
        
        const callContacts = adminContacts.filter(c => c.phoneCallAlerts !== false);
        
        for (const contact of callContacts) {
            try {
                // ────────────────────────────────────────────────────────────────────
                // SAFETY CHECK: Skip if phone number is missing or invalid
                // ────────────────────────────────────────────────────────────────────
                if (!contact.phoneNumber || typeof contact.phoneNumber !== 'string' || contact.phoneNumber.trim() === '') {
                    logger.warn(`⚠️ [ESCALATION CALL] Skipping ${contact.name || 'contact'} - no valid phone number`);
                    results.push({
                        recipient: contact.phoneNumber || 'N/A',
                        recipientName: contact.name || 'Unknown',
                        status: 'skipped',
                        error: 'No valid phone number configured'
                    });
                    continue;
                }
                
                logger.debug(`📞 [ESCALATION CALL] Calling ${contact.name} (${contact.phoneNumber})...`);
                
                // Use Twilio Voice API to make automated call
                const twilioClient = require('twilio')(
                    process.env.TWILIO_ACCOUNT_SID,
                    process.env.TWILIO_AUTH_TOKEN
                );
                
                const call = await twilioClient.calls.create({
                    to: contact.phoneNumber,
                    from: process.env.TWILIO_PHONE_NUMBER,
                    twiml: this.generateCallTwiML(alert, attemptNumber)
                });
                
                results.push({
                    recipient: contact.phoneNumber,
                    recipientName: contact.name,
                    status: 'initiated',
                    twilioCallSid: call.sid
                });
                
                logger.debug(`✅ [ESCALATION CALL] Call initiated to ${contact.name}: ${call.sid}`);
                
            } catch (error) {
                logger.error(`❌ [ESCALATION CALL] Failed to call ${contact.name}:`, error);
                
                results.push({
                    recipient: contact.phoneNumber,
                    recipientName: contact.name,
                    status: 'failed',
                    error: error.message
                });
            }
        }
        
        return results;
    }
    
    /**
     * 📞 GENERATE TWIML FOR AUTOMATED CALL
     */
    static generateCallTwiML(alert, attemptNumber) {
        const severityText = {
            CRITICAL: 'critical',
            WARNING: 'warning',
            INFO: 'informational'
        };
        
        const message = `
            This is an urgent ClientsVia alert escalation, attempt ${attemptNumber}.
            A ${severityText[alert.severity]} alert requires immediate attention.
            Alert ID: ${alert.alertId}.
            Issue: ${alert.message}.
            Please log in to the notification center or text ACK ${alert.alertId} to acknowledge this alert.
            This call will repeat every 15 minutes until acknowledged.
        `.trim();
        
        return `
            <Response>
                <Say voice="alice">${message}</Say>
                <Pause length="2"/>
                <Say voice="alice">Again, alert ID: ${alert.alertId}. Text ACK ${alert.alertId} to acknowledge.</Say>
            </Response>
        `.trim();
    }
    
    /**
     * ⏱️ CALCULATE NEXT ESCALATION TIME
     */
    static calculateNextEscalation(severity, currentLevel) {
        const now = new Date();
        
        const intervals = {
            CRITICAL: [30, 30, 30, 15, 15],  // minutes: 30, 30, 30, 15, 15
            WARNING: [60, 60, 60],           // minutes: 1hr, 1hr, 1hr
            INFO: []                         // No escalation
        };
        
        const levelIntervals = intervals[severity] || [];
        
        // Get interval for current level (use last interval if beyond array length)
        const minutes = levelIntervals[currentLevel - 1] || levelIntervals[levelIntervals.length - 1] || 0;
        
        if (minutes === 0) {
            return null;  // No more escalation
        }
        
        return new Date(now.getTime() + minutes * 60 * 1000);
    }
    
    /**
     * ⏸️ PAUSE ESCALATION (manual override)
     */
    static async pauseEscalation(alertId, reason = '') {
        try {
            const alert = await NotificationLog.findOne({ alertId });
            
            if (!alert) {
                throw new Error(`Alert ${alertId} not found`);
            }
            
            alert.escalation.escalationPaused = true;
            alert.escalation.escalationHistory.push({
                level: alert.escalation.currentLevel,
                timestamp: new Date(),
                action: `paused: ${reason}`
            });
            
            await alert.save();
            
            logger.info(`⏸️ [ESCALATION] Alert ${alertId} escalation paused: ${reason}`);
            
            return { success: true };
            
        } catch (error) {
            logger.error(`❌ [ESCALATION] Failed to pause alert ${alertId}:`, error);
            throw error;
        }
    }
    
    /**
     * ▶️ RESUME ESCALATION (manual override)
     */
    static async resumeEscalation(alertId) {
        try {
            const alert = await NotificationLog.findOne({ alertId });
            
            if (!alert) {
                throw new Error(`Alert ${alertId} not found`);
            }
            
            alert.escalation.escalationPaused = false;
            alert.escalation.nextEscalationAt = this.calculateNextEscalation(
                alert.severity,
                alert.escalation.currentLevel
            );
            alert.escalation.escalationHistory.push({
                level: alert.escalation.currentLevel,
                timestamp: new Date(),
                action: 'resumed'
            });
            
            await alert.save();
            
            logger.info(`▶️ [ESCALATION] Alert ${alertId} escalation resumed`);
            
            return { success: true };
            
        } catch (error) {
            logger.error(`❌ [ESCALATION] Failed to resume alert ${alertId}:`, error);
            throw error;
        }
    }
    
    /**
     * 🔕 SNOOZE ALERT (delay escalation for X minutes)
     */
    static async snoozeAlert(alertId, minutes, reason = '') {
        try {
            const alert = await NotificationLog.findOne({ alertId });
            
            if (!alert) {
                throw new Error(`Alert ${alertId} not found`);
            }
            
            const snoozeUntil = new Date(Date.now() + minutes * 60 * 1000);
            
            alert.acknowledgment.snoozedUntil = snoozeUntil;
            alert.acknowledgment.snoozeCount += 1;
            alert.acknowledgment.snoozeReason = reason;
            
            alert.escalation.nextEscalationAt = snoozeUntil;
            alert.escalation.escalationHistory.push({
                level: alert.escalation.currentLevel,
                timestamp: new Date(),
                action: `snoozed for ${minutes} minutes: ${reason}`
            });
            
            await alert.save();
            
            logger.info(`🔕 [ESCALATION] Alert ${alertId} snoozed for ${minutes} minutes until ${snoozeUntil}`);
            
            // Send confirmation SMS
            const AdminSettings = require('../models/AdminSettings');
            const settings = await AdminSettings.findOne({});
            
            if (settings?.notificationCenter?.twilio?.accountSid && 
                settings?.notificationCenter?.twilio?.authToken &&
                settings?.notificationCenter?.twilio?.phoneNumber) {
                
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
🔕 Alert ${alertId} snoozed for ${minutes} minutes.

Will resume at ${snoozeUntil.toLocaleTimeString()}.

To cancel snooze: Text "UNSNOOZE ${alertId}"
                `.trim();
                
                for (const contact of adminContacts) {
                    try {
                        await twilioClient.messages.create({
                            to: contact.phone,
                            from: settings.notificationCenter.twilio.phoneNumber,
                            body: message
                        });
                        logger.info(`✅ [SMS] Sent snooze confirmation to ${contact.name}`);
                    } catch (error) {
                        logger.error(`❌ Failed to send snooze confirmation to ${contact.name}:`, error);
                    }
                }
            }
            
            return { success: true, snoozeUntil };
            
        } catch (error) {
            logger.error(`❌ [ESCALATION] Failed to snooze alert ${alertId}:`, error);
            throw error;
        }
    }
}

module.exports = AlertEscalationService;

