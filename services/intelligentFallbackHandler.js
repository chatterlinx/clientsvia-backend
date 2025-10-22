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
     * @param {String} text - Text with variables like {companyname}, {companyid}
     * @param {Object} company - Company document
     * @returns {String} - Text with variables replaced
     */
    replaceVariables(text, company) {
        if (!text) {return text;}

        let processedText = text;

        // Always replace built-in variables
        processedText = processedText.replace(/\{companyname\}/gi, company.companyName || company.businessName || 'Unknown');
        processedText = processedText.replace(/\{companyid\}/gi, company._id || 'Unknown');

        // Replace custom variables from company.aiAgentLogic.variables
        if (company.aiAgentLogic?.variables && Array.isArray(company.aiAgentLogic.variables)) {
            company.aiAgentLogic.variables.forEach(variable => {
                const regex = new RegExp(`\\{${variable.name}\\}`, 'gi');
                processedText = processedText.replace(regex, variable.value);
            });
        }

        return processedText;
    }

    /**
     * Notify admin of fallback event with custom contacts and variable replacement
     * @param {String} companyId - Company ID
     * @param {String} companyName - Company name
     * @param {String} failureReason - Why fallback was triggered
     * @param {String} method - Notification method (sms | email | both)
     * @param {Object} fallbackConfig - Fallback configuration
     * @param {Object} company - Company document (for variable replacement)
     * @returns {Boolean} - Success status
     */
    async notifyAdmin(companyId, companyName, failureReason, method, fallbackConfig, company) {
        try {
            logger.info(`🚨 [FALLBACK] Notifying admin via: ${method}`);

            // Use custom admin SMS message with variable replacement
            const smsMessage = fallbackConfig.adminSmsMessage || 
                `⚠️ FALLBACK ALERT: Greeting fallback occurred in {companyname} ({companyid}). Please check the Messages & Greetings settings immediately.`;
            
            const processedSmsMessage = this.replaceVariables(smsMessage, company);

            // Email message (more detailed)
            const emailMessage = `🆘 FALLBACK ALERT\n\nCompany: ${companyName}\nID: ${companyId}\n\nReason: ${failureReason}\n\nAction required: Check Messages & Greetings settings.`;

            let smsSent = false;
            let emailSent = false;

            // Get admin contact info (custom from fallback config OR fallback to env vars)
            const adminPhone = fallbackConfig.adminPhone || this.adminPhone;
            const adminEmail = fallbackConfig.adminEmail || this.adminEmail;

            // Send SMS
            if ((method === 'sms' || method === 'both') && adminPhone) {
                try {
                    await smsClient.send({
                        to: adminPhone,
                        body: processedSmsMessage,
                        from: 'ClientsVia Alert'
                    });
                    smsSent = true;
                    logger.debug(`✅ [FALLBACK] Admin SMS sent to: ${adminPhone}`);
                    logger.debug(`📝 [FALLBACK] SMS message: ${processedSmsMessage}`);
                } catch (smsError) {
                    logger.error(`❌ [FALLBACK] Admin SMS failed:`, smsError);
                }
            } else if ((method === 'sms' || method === 'both') && !adminPhone) {
                logger.warn(`⚠️ [FALLBACK] Admin SMS notification requested but no phone number configured`);
            }

            // Send Email
            if ((method === 'email' || method === 'both') && adminEmail) {
                try {
                    await emailClient.send({
                        to: adminEmail,
                        subject: `🆘 Fallback Alert: ${companyName} (${companyId})`,
                        text: emailMessage,
                        html: `
                            <div style="font-family: Arial, sans-serif; padding: 20px; background: #fff3cd; border-left: 4px solid #ffc107;">
                                <h2 style="color: #856404; margin: 0 0 15px 0;">🆘 Fallback Alert</h2>
                                <p><strong>Company:</strong> ${companyName}</p>
                                <p><strong>ID:</strong> ${companyId}</p>
                                <p><strong>Reason:</strong> ${failureReason}</p>
                                <p style="margin-top: 20px; padding: 15px; background: #fff; border-radius: 4px;">
                                    <strong>Action Required:</strong> Check the Messages & Greetings settings in the AI Agent Settings tab.
                                </p>
                            </div>
                        `
                    });
                    emailSent = true;
                    logger.info(`✅ [FALLBACK] Admin email sent to: ${adminEmail}`);
                } catch (emailError) {
                    logger.error(`❌ [FALLBACK] Admin email failed:`, emailError);
                }
            } else if ((method === 'email' || method === 'both') && !adminEmail) {
                logger.warn(`⚠️ [FALLBACK] Admin email notification requested but no email configured`);
            }

            return smsSent || emailSent;

        } catch (error) {
            logger.error(`❌ [FALLBACK] Error notifying admin:`, error);
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

