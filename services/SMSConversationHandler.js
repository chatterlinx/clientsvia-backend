/**
 * ============================================================================
 * SMS CONVERSATION HANDLER - Adapter for SMS Channel
 * ============================================================================
 * 
 * This is a THIN ADAPTER that routes SMS to ConversationEngine.
 * ALL conversation logic is in ConversationEngine.
 * 
 * FLOW:
 * 1. Incoming SMS → Twilio webhook
 * 2. Detect if admin command or customer message
 * 3. If customer → call ConversationEngine.processTurn()
 * 4. Send AI response via Twilio SMS
 * 
 * CRITICAL: This file does NOT contain AI logic!
 * It only: validates input → calls ConversationEngine → formats output
 * 
 * MULTI-TENANT: Company is identified by the "To" number (the company's phone)
 * 
 * ============================================================================
 */

const Company = require('../models/v2Company');
const ConversationEngine = require('./ConversationEngine');
const logger = require('../utils/logger');

class SMSConversationHandler {
    
    /**
     * Process an incoming SMS message
     * This is a THIN ADAPTER - all logic is in ConversationEngine
     * 
     * @param {Object} params
     * @param {string} params.fromPhone - Customer's phone number
     * @param {string} params.toPhone - Company's phone number (Twilio number)
     * @param {string} params.message - SMS message content
     * @param {string} params.messageSid - Twilio message SID
     * @returns {Object} { response, shouldReply }
     */
    static async processMessage({
        fromPhone,
        toPhone,
        message,
        messageSid
    }) {
        logger.info('[SMS HANDLER] 💬 Processing customer SMS via ConversationEngine', {
            fromPhone,
            toPhone,
            messageLength: message?.length,
            messageSid
        });
        
        try {
            // ═══════════════════════════════════════════════════════════════
            // STEP 1: Find company by phone number (adapter responsibility)
            // ═══════════════════════════════════════════════════════════════
            const company = await this.findCompanyByPhone(toPhone);
            
            if (!company) {
                logger.warn('[SMS HANDLER] No company found for phone', { toPhone });
                return {
                    response: "Thank you for your message. This number is not currently configured for AI responses.",
                    shouldReply: true
                };
            }
            
            const companyId = company._id.toString();
            logger.info('[SMS HANDLER] Company identified', {
                companyId,
                companyName: company.companyName || company.businessName
            });
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 2: Call ConversationEngine (the unified brain)
            // ═══════════════════════════════════════════════════════════════
            const result = await ConversationEngine.processTurn({
                companyId,
                channel: 'sms',
                userText: message,
                sessionId: `sms-${fromPhone}-${toPhone}`,
                callerPhone: fromPhone,
                metadata: {
                    messageSid,
                    toPhone
                },
                includeDebug: false
            });
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 3: Format response (adapter responsibility)
            // ═══════════════════════════════════════════════════════════════
            logger.info('[SMS HANDLER] ✅ Response generated via ConversationEngine', {
                sessionId: result.sessionId,
                latencyMs: result.latencyMs,
                responseLength: result.reply?.length,
                phase: result.phase
            });
            
            return {
                response: result.reply || 'I apologize, I could not process your message.',
                shouldReply: true,
                sessionId: result.sessionId,
                phase: result.phase,
                slotsCollected: result.slotsCollected
            };
            
        } catch (error) {
            logger.error('[SMS HANDLER] ❌ Error processing SMS', {
                error: error.message,
                stack: error.stack,
                fromPhone,
                toPhone
            });
            
            return {
                response: "I apologize, but I'm having trouble processing your message. Please try again or call us directly.",
                shouldReply: true
            };
        }
    }
    
    /**
     * Find company by their Twilio phone number
     */
    static async findCompanyByPhone(phoneNumber) {
        // Normalize phone number
        const normalized = phoneNumber.replace(/\D/g, '');
        const searchPatterns = [
            phoneNumber,
            normalized,
            `+${normalized}`,
            `+1${normalized}`,
            normalized.slice(-10) // Last 10 digits
        ];
        
        // Look for company with this Twilio number
        const company = await Company.findOne({
            $or: [
                { twilioPhoneNumber: { $in: searchPatterns } },
                { 'twilio.phoneNumber': { $in: searchPatterns } },
                { 'phoneNumbers.primary': { $in: searchPatterns } },
                { 'aiAgentSettings.twilioPhone': { $in: searchPatterns } }
            ]
        });
        
        return company;
    }
    
    /**
     * Check if message is an admin command (not a customer message)
     * Admin commands should be handled separately
     */
    static isAdminCommand(message) {
        const adminPatterns = [
            /^ACK\s+ALT-/i,
            /^SNOOZE\s+ALT-/i,
            /^REOPEN\s+ALT-/i,
            /^TEST$/i,
            /^PING$/i,
            /^HELLO$/i,
            /^HI$/i,
            /^STATUS$/i,
            /^HELP$/i
        ];
        
        return adminPatterns.some(pattern => pattern.test(message.trim()));
    }
    
    /**
     * Check if phone number is an admin
     * Admins are in the Notification Center contacts
     */
    static async isAdminPhone(phoneNumber) {
        const normalizedPhone = phoneNumber.replace(/\D/g, '');
        
        const notificationCenter = await Company.findOne({
            'metadata.isNotificationCenter': true,
            'contacts.phoneNumber': { $regex: normalizedPhone }
        });
        
        return !!notificationCenter;
    }
}

module.exports = SMSConversationHandler;
