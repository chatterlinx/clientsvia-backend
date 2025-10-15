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

        console.log(`🆘 [FALLBACK] Executing intelligent fallback for company: ${companyName} (${companyId})`);
        console.log(`🆘 [FALLBACK] Failure reason: ${failureReason}`);

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
            result.voiceAudioGenerated = !!result.voiceAudio;

            // Step 2: Send SMS to customer (if enabled)
            if (fallbackConfig.smsEnabled && callerPhone) {
                result.smsSent = await this.notifyCustomerViaSMS(
                    callerPhone,
                    companyName,
                    fallbackConfig.smsMessage
                );
            }

            // Step 3: Notify admin (if enabled)
            if (fallbackConfig.notifyAdmin) {
                result.adminNotified = await this.notifyAdmin(
                    companyId,
                    companyName,
                    failureReason,
                    fallbackConfig.adminNotificationMethod
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
            console.log(`✅ [FALLBACK] Fallback executed successfully for ${companyName}`);

        } catch (error) {
            console.error(`❌ [FALLBACK] Error executing fallback for ${companyName}:`, error);
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
            console.log(`🎤 [FALLBACK] Generating fallback voice audio...`);

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
                console.log(`✅ [FALLBACK] Voice audio generated: ${audioData.audioUrl}`);
                return audioData.audioUrl;
            }

            console.warn(`⚠️ [FALLBACK] ElevenLabs returned no audio`);
            return null;

        } catch (error) {
            console.error(`❌ [FALLBACK] Error generating fallback voice:`, error);
            return null;
        }
    }

    /**
     * Notify customer via SMS
     * @param {String} phoneNumber - Customer's phone number
     * @param {String} companyName - Company name
     * @param {String} message - SMS message
     * @returns {Boolean} - Success status
     */
    async notifyCustomerViaSMS(phoneNumber, companyName, message) {
        try {
            console.log(`📱 [FALLBACK] Sending SMS to customer: ${phoneNumber}`);

            await smsClient.send({
                to: phoneNumber,
                body: message,
                from: companyName
            });

            console.log(`✅ [FALLBACK] SMS sent to customer: ${phoneNumber}`);
            return true;

        } catch (error) {
            console.error(`❌ [FALLBACK] Error sending SMS to customer:`, error);
            return false;
        }
    }

    /**
     * Notify admin of fallback event
     * @param {String} companyId - Company ID
     * @param {String} companyName - Company name
     * @param {String} failureReason - Why fallback was triggered
     * @param {String} method - Notification method (sms | email | both)
     * @returns {Boolean} - Success status
     */
    async notifyAdmin(companyId, companyName, failureReason, method) {
        try {
            console.log(`🚨 [FALLBACK] Notifying admin via: ${method}`);

            const message = `🆘 FALLBACK ALERT\n\nCompany: ${companyName}\nID: ${companyId}\n\nReason: ${failureReason}\n\nAction required: Check Messages & Greetings settings.`;

            let smsSent = false;
            let emailSent = false;

            // Send SMS
            if ((method === 'sms' || method === 'both') && this.adminPhone) {
                try {
                    await smsClient.send({
                        to: this.adminPhone,
                        body: message,
                        from: 'ClientsVia Alert'
                    });
                    smsSent = true;
                    console.log(`✅ [FALLBACK] Admin SMS sent to: ${this.adminPhone}`);
                } catch (smsError) {
                    console.error(`❌ [FALLBACK] Admin SMS failed:`, smsError);
                }
            }

            // Send Email
            if ((method === 'email' || method === 'both') && this.adminEmail) {
                try {
                    await emailClient.send({
                        to: this.adminEmail,
                        subject: `🆘 Fallback Alert: ${companyName} (${companyId})`,
                        text: message,
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
                    console.log(`✅ [FALLBACK] Admin email sent to: ${this.adminEmail}`);
                } catch (emailError) {
                    console.error(`❌ [FALLBACK] Admin email failed:`, emailError);
                }
            }

            return smsSent || emailSent;

        } catch (error) {
            console.error(`❌ [FALLBACK] Error notifying admin:`, error);
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
            console.error(`❌ [FALLBACK] Error logging fallback event:`, error);
        }
    }
}

// Export singleton instance
module.exports = new IntelligentFallbackHandler();

