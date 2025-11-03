/**
 * ============================================================================
 * INTELLIGENT FALLBACK HANDLER
 * ============================================================================
 * 
 * PURPOSE: Emergency fallback system when primary greeting fails
 * 
 * FEATURES:
 * 1. Voice fallback (ElevenLabs TTS with custom message)
 * 2. SMS customer notification (optional)
 * 3. Admin alerts (SMS/Email/Both)
 * 4. Detailed logging for diagnostics
 * 
 * TRIGGER CONDITIONS:
 * - Pre-recorded audio file missing/corrupted
 * - ElevenLabs API failure
 * - Network timeout
 * - Any other greeting generation error
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const smsClient = require('../clients/smsClient');
const emailClient = require('../clients/emailClient');
const v2elevenLabsService = require('./v2elevenLabsService');
const AdminNotificationService = require('./AdminNotificationService');

class IntelligentFallbackHandler {
    constructor() {
        this.adminPhone = process.env.ADMIN_ALERT_PHONE || null;
        this.adminEmail = process.env.ADMIN_ALERT_EMAIL || null;
    }

    /**
     * Execute fallback system
     * @param {Object} options - Fallback options
     * @param {Object} options.company - Company document
     * @param {String} options.companyId - Company ID
     * @param {String} options.companyName - Company name
     * @param {String} options.callerPhone - Caller's phone number
     * @param {String} options.failureReason - Why primary greeting failed
     * @param {Object} options.fallbackConfig - Fallback configuration
     * @returns {Object} - Fallback result
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

        logger.info(`🆘 [FALLBACK] Executing intelligent fallback for company: ${companyName} (${companyId})`);
        logger.info(`🆘 [FALLBACK] Failure reason: ${failureReason}`);

        const result = {
            success: false,
            voiceAudioGenerated: false,
            smsSent: false,
            adminNotified: false,
            errors: []
        };

        try {
            // Step 1: Generate fallback voice audio
            result.voiceAudio = await this.generateFallbackVoice(company, fallbackConfig);
            result.voiceAudioGenerated = Boolean(result.voiceAudio);

            // Step 2: Send SMS to customer (if enabled)
            if (fallbackConfig.smsEnabled && callerPhone) {
                result.smsSent = await this.notifyCustomerViaSMS(
                    callerPhone,
                    companyName,
                    fallbackConfig.smsMessage,
                    company
                );
            }

            // Step 3: Notify admin (if enabled)
            if (fallbackConfig.notifyAdmin) {
                result.adminNotified = await this.notifyAdmin(
                    companyId,
                    companyName,
                    failureReason,
                    fallbackConfig.adminNotificationMethod,
                    fallbackConfig,
                    company
                );
            }

            // Step 4: Log fallback event
            await this.logFallbackEvent({
                companyId,
                companyName,
                callerPhone,
                failureReason,
                result
            });

            result.success = true;
            logger.info(`✅ [FALLBACK] Fallback executed successfully for ${companyName}`);

        } catch (error) {
            logger.error(`❌ [FALLBACK] Error executing fallback for ${companyName}:`, error);
            result.errors.push(error.message);
        }

        return result;
    }

    /**
     * Generate fallback voice using ElevenLabs TTS
     * @param {Object} company - Company document
     * @param {Object} fallbackConfig - Fallback configuration
     * @returns {String|null} - Audio URL or null
     */
    async generateFallbackVoice(company, fallbackConfig) {
        try {
            logger.info(`🎤 [FALLBACK] Generating fallback voice audio...`);

            const voiceSettings = company.voiceSettings || {};
            const selectedVoiceId = voiceSettings.selectedVoiceId || 'Rachel'; // Default voice

            const audioData = await v2elevenLabsService.generateSpeech(
                fallbackConfig.voiceMessage,
                selectedVoiceId,
                {
                    stability: 0.5,
                    similarity_boost: 0.75,
                    style: 0,
                    use_speaker_boost: true
                }
            );

            if (audioData && audioData.audioUrl) {
                logger.info(`✅ [FALLBACK] Voice audio generated: ${audioData.audioUrl}`);
                return audioData.audioUrl;
            }

            logger.warn(`⚠️ [FALLBACK] ElevenLabs returned no audio`);
            return null;

        } catch (error) {
            logger.error(`❌ [FALLBACK] Error generating fallback voice:`, error);
            return null;
        }
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
     * Notify admin of fallback event via AdminNotificationService (Notification Contract compliant)
     * 
     * ============================================================================
     * REFACTOR NOTE (Phase 4 - Notification Contract Compliance)
     * ============================================================================
     * 
     * BEFORE: This method directly called smsClient.send() and emailClient.send()
     * PROBLEMS:
     * - ❌ Alerts not visible in Notification Center dashboard
     * - ❌ No deduplication (100 fallbacks = 100 SMS)
     * - ❌ No escalation tracking or acknowledgment workflow
     * - ❌ Bypassed severity policies and quiet hours
     * - ❌ No analytics or registry tracking
     * 
     * AFTER: Now uses AdminNotificationService.sendAlert() per REFACTOR_PROTOCOL
     * BENEFITS:
     * - ✅ Alerts visible in Notification Center dashboard
     * - ✅ Smart deduplication (100 fallbacks → 1 alert with occurrenceCount: 100)
     * - ✅ Escalation tracking and acknowledgment workflow
     * - ✅ Respects quiet hours and severity policies
     * - ✅ Full audit trail and analytics
     * 
     * ============================================================================
     * 
     * @param {String} companyId - Company ID
     * @param {String} companyName - Company name
     * @param {String} failureReason - Why fallback was triggered
     * @param {String} method - Notification method (sms | email | both) - DEPRECATED, now controlled by AdminNotificationService policies
     * @param {Object} fallbackConfig - Fallback configuration
     * @param {Object} company - Company document (for variable replacement)
     * @returns {Boolean} - Success status
     */
    async notifyAdmin(companyId, companyName, failureReason, method, fallbackConfig, company) {
        try {
            logger.info(`🚨 [FALLBACK] Sending alert via AdminNotificationService (method: ${method})`);

            // Use custom admin SMS message with variable replacement
            const smsMessage = fallbackConfig.adminSmsMessage || 
                `⚠️ FALLBACK ALERT: Greeting fallback occurred in {companyname} ({companyid}). Please check the Messages & Greetings settings immediately.`;
            
            const processedSmsMessage = this.replaceVariables(smsMessage, company);

            // Determine severity based on fallback config
            // CRITICAL if no fallback message configured (company is down)
            // WARNING if fallback exists but primary greeting failed
            const severity = (!fallbackConfig.customerMessage || fallbackConfig.customerMessage.trim() === '') 
                ? 'CRITICAL'  // No fallback message = customers hear nothing = system down
                : 'WARNING';  // Fallback exists = degraded but functional

            // Send alert via AdminNotificationService (Notification Contract)
            await AdminNotificationService.sendAlert({
                code: 'AI_AGENT_FALLBACK_TRIGGERED',
                severity: severity,
                message: `Greeting fallback triggered for ${companyName}: ${failureReason}`,
                companyId: companyId,
                companyName: companyName,
                details: `Failure Reason: ${failureReason}\nCustomer Message: ${fallbackConfig.customerMessage || 'NONE CONFIGURED'}\nAdmin Notification Method: ${method}\nProcessed SMS Message: ${processedSmsMessage}`,
                feature: 'ai-agent',
                tab: 'AI_AGENT',
                module: 'FALLBACK_HANDLER',
                meta: {
                    failureReason: failureReason,
                    customerMessage: (fallbackConfig.customerMessage || '').substring(0, 100),
                    notificationMethod: method,
                    hasCustomerFallback: !!(fallbackConfig.customerMessage && fallbackConfig.customerMessage.trim()),
                    adminPhone: fallbackConfig.adminPhone || this.adminPhone || 'none',
                    adminEmail: fallbackConfig.adminEmail || this.adminEmail || 'none'
                }
            });

            logger.info(`✅ [FALLBACK] Alert sent successfully via AdminNotificationService`);
            return true;

        } catch (error) {
            logger.error(`❌ [FALLBACK] Error sending alert via AdminNotificationService:`, error);
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

