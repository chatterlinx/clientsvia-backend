/**
 * ============================================================================
 * INTELLIGENT FALLBACK HANDLER - INFRASTRUCTURE FAILURE NOTIFICATION
 * ============================================================================
 * 
 * PURPOSE: When greeting generation INFRASTRUCTURE fails (not AI logic)
 * 
 * HYBRID APPROACH:
 * ✅ NO generic voice fallback text
 * ✅ SMS notification to customer (infrastructure issue detected)
 * ✅ Critical admin alert (ops team investigates)
 * ✅ Transfer to human immediately (no masking problems)
 * ✅ Detailed logging for root cause analysis
 * 
 * TRIGGER CONDITIONS:
 * - Pre-recorded audio file missing/corrupted
 * - ElevenLabs API failure
 * - Network timeout
 * - Greeting generation system error
 * 
 * NEW BEHAVIOR:
 * Greeting fails → SMS customer + Alert admin + Transfer to human (NO TEXT)
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const smsClient = require('../clients/smsClient');
const AdminNotificationService = require('./AdminNotificationService');

class IntelligentFallbackHandler {
    constructor() {
        this.adminPhone = process.env.ADMIN_ALERT_PHONE || null;
        this.adminEmail = process.env.ADMIN_ALERT_EMAIL || null;
    }

    /**
     * Execute fallback system - Infrastructure failure response
     * 
     * 🔥 HYBRID APPROACH:
     * - NO generic voice fallback (purity)
     * - SMS notification to customer (reliability)
     * - Admin alert CRITICAL (visibility)
     * - Transfer to human (no masking)
     * 
     * @param {Object} options - Fallback options
     * @param {Object} options.company - Company document
     * @param {String} options.companyId - Company ID
     * @param {String} options.companyName - Company name
     * @param {String} options.callerPhone - Caller's phone number
     * @param {String} options.failureReason - Why primary greeting failed
     * @param {Object} options.fallbackConfig - Fallback configuration
     * @returns {Object} - Fallback result with transfer action
     */
    async executeFallback(options) {
        const {
            company,
            companyId,
            companyName,
            callerPhone,
            failureReason,
            fallbackConfig
        } = options;

        logger.error(`🚨 [INFRASTRUCTURE FAILURE] Triggering fallback for company: ${companyName} (${companyId})`);
        logger.error(`🚨 [INFRASTRUCTURE FAILURE] Reason: ${failureReason}`);

        const result = {
            success: false,
            smsSent: false,
            adminNotified: false,
            transferTriggered: true,  // Always transfer to human
            errors: []
        };

        try {
            // Step 1: Send SMS to customer (if caller phone available)
            if (callerPhone && fallbackConfig?.smsEnabled !== false) {
                const defaultSmsMessage = `We're experiencing technical difficulties and are connecting you to our team. Thank you for your patience.`;
                const smsMessage = fallbackConfig?.smsMessage || defaultSmsMessage;
                result.smsSent = await this.notifyCustomerViaSMS(
                    callerPhone,
                    companyName,
                    smsMessage,
                    company
                );
            }

            // Step 2: CRITICAL admin alert (always notify on infrastructure failure)
            if (fallbackConfig?.notifyAdmin !== false) {
                result.adminNotified = await this.notifyAdmin(
                    companyId,
                    companyName,
                    failureReason,
                    fallbackConfig?.adminNotificationMethod || 'both',
                    fallbackConfig,
                    company
                );
            }

            // Step 3: Log fallback event for debugging
            await this.logFallbackEvent({
                companyId,
                companyName,
                callerPhone,
                failureReason,
                result
            });

            result.success = true;
            logger.error(`✅ [FALLBACK] Infrastructure failure response complete - transferring to human`);

        } catch (error) {
            logger.error(`❌ [FALLBACK] Error executing fallback for ${companyName}:`, error);
            result.errors.push(error.message);
        }

        return result;
    }


    /**
     * Notify customer via SMS with variable replacement
     * @param {String} phoneNumber - Customer's phone number
     * @param {String} companyName - Company name
     * @param {String} message - SMS message (supports variables)
     * @param {Object} company - Company document (for variable replacement)
     * @returns {Boolean} - Success status
     */
    async notifyCustomerViaSMS(phoneNumber, companyName, message, company) {
        try {
            logger.debug(`📱 [FALLBACK] Sending SMS to customer: ${phoneNumber}`);

            // Process variables in message using company's Variables system
            const processedMessage = this.replaceVariables(message, company);

            await smsClient.send({
                to: phoneNumber,
                body: processedMessage,
                from: companyName
            });

            logger.debug(`✅ [FALLBACK] SMS sent to customer: ${phoneNumber}`);
            logger.debug(`📝 [FALLBACK] Original message: ${message}`);
            logger.debug(`📝 [FALLBACK] Processed message: ${processedMessage}`);
            return true;

        } catch (error) {
            logger.error(`❌ [FALLBACK] Error sending SMS to customer:`, error);
            return false;
        }
    }

    /**
     * Replace variables in text using company's Variables system
     * 
     * REFACTORED: Now uses canonical placeholderReplacer
     * - Reads from: company.aiAgentSettings.variables
     * - Single source of truth for all variable replacement
     * 
     * @param {String} text - Text with variables like {companyname}, {companyid}
     * @param {Object} company - Company document
     * @returns {String} - Text with variables replaced
     */
    replaceVariables(text, company) {
        if (!text) {return text;}
        
        const { replacePlaceholders } = require('../utils/placeholderReplacer');
        
        let processedText = text;
        
        // Replace built-in variables that might not be in aiAgentSettings.variables
        processedText = processedText.replace(/\{companyname\}/gi, company.companyName || company.businessName || 'Unknown');
        processedText = processedText.replace(/\{companyid\}/gi, company._id || 'Unknown');
        
        // Replace all other variables from canonical source
        processedText = replacePlaceholders(processedText, company);
        
        return processedText;
    }

    /**
     * Notify admin of infrastructure failure
     * 
     * 🔥 ALWAYS CRITICAL SEVERITY
     * Infrastructure failures = system is down = ops team must investigate immediately
     * 
     * ============================================================================
     * Uses AdminNotificationService per REFACTOR_PROTOCOL (Notification Contract)
     * ============================================================================
     * 
     * @param {String} companyId - Company ID
     * @param {String} companyName - Company name
     * @param {String} failureReason - Why greeting infrastructure failed
     * @param {String} method - Notification method (sms | email | both)
     * @param {Object} fallbackConfig - Fallback configuration
     * @param {Object} company - Company document (for variable replacement)
     * @returns {Boolean} - Success status
     */
    async notifyAdmin(companyId, companyName, failureReason, method, fallbackConfig, company) {
        try {
            logger.error(`🚨 [ADMIN ALERT] Infrastructure failure - sending CRITICAL notification`);

            // Send alert via AdminNotificationService with CRITICAL severity
            // Infrastructure failures ALWAYS warrant immediate ops team attention
            await AdminNotificationService.sendAlert({
                code: 'GREETING_INFRASTRUCTURE_FAILURE',
                severity: 'CRITICAL',  // Always critical for infrastructure failures
                message: `GREETING INFRASTRUCTURE FAILURE in ${companyName}: ${failureReason}`,
                companyId: companyId,
                companyName: companyName,
                details: `Greeting infrastructure has failed and customer is being transferred to human agent.\n\nFailure Reason: ${failureReason}\n\nImmediate investigation required.`,
                feature: 'ai-agent',
                tab: 'AI_AGENT',
                module: 'GREETING_INFRASTRUCTURE',
                meta: {
                    failureReason: failureReason,
                    action: 'CUSTOMER_TRANSFERRED_TO_HUMAN',
                    requiresImmediateInvestigation: true
                }
            });

            logger.error(`✅ [ADMIN ALERT] CRITICAL alert sent - ops team notified of infrastructure failure`);
            return true;

        } catch (error) {
            logger.error(`❌ [ADMIN ALERT] Error sending critical alert:`, error);
            return false;
        }
    }

    /**
     * Log fallback event to database
     * @param {Object} eventData - Event details
     */
    async logFallbackEvent(eventData) {
        try {
            logger.warn('[FALLBACK EVENT]', {
                timestamp: new Date().toISOString(),
                companyId: eventData.companyId,
                companyName: eventData.companyName,
                callerPhone: eventData.callerPhone,
                failureReason: eventData.failureReason,
                voiceAudioGenerated: eventData.result.voiceAudioGenerated,
                smsSent: eventData.result.smsSent,
                adminNotified: eventData.result.adminNotified,
                errors: eventData.result.errors
            });
        } catch (error) {
            logger.error(`❌ [FALLBACK] Error logging fallback event:`, error);
        }
    }
}

// Export singleton instance
module.exports = new IntelligentFallbackHandler();

