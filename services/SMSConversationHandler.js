/**
 * ============================================================================
 * SMS CONVERSATION HANDLER - AI Brain for SMS Conversations
 * ============================================================================
 * 
 * Handles CUSTOMER SMS messages (not admin commands).
 * Routes SMS to the same AI brain as voice calls.
 * 
 * FLOW:
 * 1. Incoming SMS → Twilio webhook
 * 2. Detect if admin command or customer message
 * 3. If customer → find/create customer + session
 * 4. Pass to AI brain (same as voice)
 * 5. Send AI response via Twilio SMS
 * 
 * MULTI-TENANT: Company is identified by the "To" number (the company's phone)
 * 
 * ============================================================================
 */

const Company = require('../models/v2Company');
const CustomerService = require('./CustomerService');
const SessionService = require('./SessionService');
const RunningSummaryService = require('./RunningSummaryService');
const HybridReceptionistLLM = require('./HybridReceptionistLLM');
const logger = require('../utils/logger');

class SMSConversationHandler {
    
    /**
     * Process an incoming SMS message
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
        const startTime = Date.now();
        
        logger.info('[SMS HANDLER] 💬 Processing customer SMS', {
            fromPhone,
            toPhone,
            messageLength: message?.length,
            messageSid
        });
        
        try {
            // ═══════════════════════════════════════════════════════════════
            // STEP 1: Find company by phone number
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
            // STEP 2: Find or create customer
            // ═══════════════════════════════════════════════════════════════
            const { customer, isNew } = await CustomerService.findOrCreate(
                companyId,
                { phone: fromPhone },
                'sms'
            );
            
            logger.info('[SMS HANDLER] Customer lookup', {
                customerId: customer._id,
                isNew,
                name: customer.getDisplayName()
            });
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 3: Get or create session
            // ═══════════════════════════════════════════════════════════════
            const session = await SessionService.getOrCreate({
                companyId,
                channel: 'sms',
                identifiers: {
                    smsPhone: fromPhone,
                    smsThreadId: `sms-${fromPhone}-${toPhone}`
                },
                customer
            });
            
            logger.info('[SMS HANDLER] Session', {
                sessionId: session._id,
                isNewSession: session.metrics.totalTurns === 0,
                turns: session.metrics.totalTurns
            });
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 4: Build customer context
            // ═══════════════════════════════════════════════════════════════
            const customerContext = CustomerService.buildContextForAI(customer);
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 5: Build running summary
            // ═══════════════════════════════════════════════════════════════
            const { bullets: summaryBullets, formatted: summaryFormatted } = 
                RunningSummaryService.buildAndFormat({
                    previousSummary: session.runningSummary || [],
                    customerContext,
                    currentTurn: { userMessage: message },
                    conversationState: {
                        phase: session.phase,
                        knownSlots: session.collectedSlots,
                        signals: session.signals
                    },
                    company
                });
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 6: Get conversation history from session
            // ═══════════════════════════════════════════════════════════════
            const conversationHistory = session.getHistoryForAI();
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 7: Process through AI brain
            // ═══════════════════════════════════════════════════════════════
            const aiResult = await HybridReceptionistLLM.processConversation({
                userMessage: message,
                history: conversationHistory,
                company,
                companyId,
                
                // NEW: Customer context and running summary
                customerContext,
                runningSummary: summaryFormatted,
                
                // Channel context
                channel: 'sms',
                callSid: messageSid,
                
                // Session state
                bookingState: session.collectedSlots,
                phase: session.phase
            });
            
            const latencyMs = Date.now() - startTime;
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 8: Update session with this turn
            // ═══════════════════════════════════════════════════════════════
            await SessionService.addTurn({
                session,
                userMessage: message,
                aiResponse: aiResult.response,
                metadata: {
                    latencyMs,
                    tokensUsed: aiResult.tokensUsed,
                    responseSource: aiResult.responseSource || 'llm',
                    confidence: aiResult.confidence,
                    slotsExtracted: aiResult.slotsCollected
                },
                company
            });
            
            // Update session phase if changed
            if (aiResult.phase && aiResult.phase !== session.phase) {
                await SessionService.updatePhase(session, aiResult.phase);
            }
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 9: Check for booking completion
            // ═══════════════════════════════════════════════════════════════
            if (aiResult.bookingComplete) {
                await SessionService.end(session, 'booked', {
                    appointmentId: aiResult.appointmentId
                });
                
                logger.info('[SMS HANDLER] ✅ Booking completed via SMS', {
                    sessionId: session._id,
                    customerId: customer._id
                });
            }
            
            logger.info('[SMS HANDLER] ✅ Response generated', {
                sessionId: session._id,
                latencyMs,
                responseLength: aiResult.response?.length,
                source: aiResult.responseSource
            });
            
            return {
                response: aiResult.response,
                shouldReply: true,
                sessionId: session._id,
                customerId: customer._id
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
        
        const Company = require('../models/v2Company');
        const notificationCenter = await Company.findOne({
            'metadata.isNotificationCenter': true,
            'contacts.phoneNumber': { $regex: normalizedPhone }
        });
        
        return !!notificationCenter;
    }
}

module.exports = SMSConversationHandler;

