/**
 * ════════════════════════════════════════════════════════════════════════════════
 * PUBLIC CHAT API - V89 (Jan 2026)
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * Public-facing chat API for customers to interact with AI agent via web.
 * NO AUTHENTICATION REQUIRED - this is customer-facing.
 * 
 * ENDPOINTS:
 * - GET  /api/public-chat/:companyId/info     - Get company info & greeting
 * - POST /api/public-chat/:companyId/message  - Send message, get AI response
 * 
 * SECURITY:
 * - Rate limited per IP
 * - Company must have chat enabled
 * - No sensitive data exposed
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const v2Company = require('../../models/v2Company');
const ConversationSession = require('../../models/ConversationSession');
const BookingRequest = require('../../models/BookingRequest');
const logger = require('../../utils/logger');

// Rate limiting map (simple in-memory, replace with Redis for production scale)
const rateLimitMap = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const RATE_LIMIT_MAX = 30; // 30 messages per minute per IP

function checkRateLimit(ip) {
    const now = Date.now();
    const record = rateLimitMap.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW };
    
    if (now > record.resetAt) {
        record.count = 0;
        record.resetAt = now + RATE_LIMIT_WINDOW;
    }
    
    record.count++;
    rateLimitMap.set(ip, record);
    
    return record.count <= RATE_LIMIT_MAX;
}

// ════════════════════════════════════════════════════════════════════════════════
// GET COMPANY INFO
// ════════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/public-chat/:companyId/info
 * Get company info for chat UI (no auth required)
 * If booking ID provided, also returns customer context
 */
router.get('/:companyId/info', async (req, res) => {
    try {
        const { companyId } = req.params;
        const sessionId = req.query.session;
        const bookingId = req.query.booking;
        
        // Validate company ID format
        if (!companyId || !/^[a-f0-9]{24}$/i.test(companyId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid company ID'
            });
        }
        
        // Fetch company (only public info)
        const company = await v2Company.findById(companyId)
            .select('companyName status aiAgentSettings.frontDeskBehavior.greetingMessage')
            .lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        if (company.status === 'inactive' || company.status === 'suspended') {
            return res.status(403).json({
                success: false,
                error: 'Chat is currently unavailable'
            });
        }
        
        // Get greeting message from company settings
        const greeting = company.aiAgentSettings?.frontDeskBehavior?.greetingMessage ||
            `Hi! Thanks for reaching out to ${company.companyName}. How can I help you today?`;
        
        // ═══════════════════════════════════════════════════════════════════════════
        // LOAD BOOKING CONTEXT (if booking ID provided from SMS link)
        // ═══════════════════════════════════════════════════════════════════════════
        let customerName = null;
        let appointmentInfo = null;
        let bookingContext = null;
        
        if (bookingId && /^[a-f0-9]{24}$/i.test(bookingId)) {
            try {
                const booking = await BookingRequest.findOne({
                    _id: bookingId,
                    companyId: companyId // Security: must match company
                }).select('slots calendarEventStart serviceType issue').lean();
                
                if (booking) {
                    // Extract customer name
                    customerName = booking.slots?.name?.full ||
                        `${booking.slots?.name?.first || ''} ${booking.slots?.name?.last || ''}`.trim() ||
                        null;
                    
                    // Format appointment info
                    if (booking.calendarEventStart || booking.slots?.time) {
                        const apptDate = new Date(booking.calendarEventStart || booking.slots?.time);
                        if (!isNaN(apptDate.getTime())) {
                            appointmentInfo = apptDate.toLocaleDateString('en-US', {
                                weekday: 'long',
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit'
                            });
                        }
                    }
                    
                    // Full booking context for AI
                    bookingContext = {
                        customerName,
                        customerPhone: booking.slots?.phone,
                        customerAddress: booking.slots?.address?.full || booking.slots?.address,
                        appointmentTime: appointmentInfo,
                        serviceType: booking.serviceType || booking.issue || 'service appointment'
                    };
                    
                    logger.info('[PUBLIC CHAT] Booking context loaded', { 
                        companyId,
                        bookingId,
                        customerName
                    });
                }
            } catch (bookingErr) {
                logger.warn('[PUBLIC CHAT] Could not load booking', { 
                    bookingId,
                    error: bookingErr.message 
                });
            }
        }
        
        // Load existing session messages if session ID provided
        let messages = [];
        if (sessionId) {
            const session = await ConversationSession.findOne({
                companyId,
                'metadata.webChatSessionId': sessionId
            }).select('turns').lean();
            
            if (session && session.turns) {
                messages = session.turns.map(t => ({
                    role: t.role === 'user' ? 'user' : 'agent',
                    content: t.content
                }));
            }
        }
        
        logger.info('[PUBLIC CHAT] Company info requested', { 
            companyId,
            companyName: company.companyName,
            hasBookingContext: !!bookingContext
        });
        
        res.json({
            success: true,
            companyName: company.companyName,
            greeting,
            messages,
            // V89: Customer context from booking (if available)
            customerName,
            appointmentInfo,
            bookingContext
        });
        
    } catch (err) {
        logger.error('[PUBLIC CHAT] Info fetch failed', { 
            companyId: req.params.companyId,
            error: err.message 
        });
        res.status(500).json({ success: false, error: 'Unable to load chat' });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// SEND MESSAGE
// ════════════════════════════════════════════════════════════════════════════════

/**
 * POST /api/public-chat/:companyId/message
 * Send a message and get AI response (no auth required)
 */
router.post('/:companyId/message', async (req, res) => {
    try {
        const { companyId } = req.params;
        const { sessionId, bookingId, message } = req.body;
        const clientIP = req.ip || req.connection.remoteAddress;
        
        // Rate limiting
        if (!checkRateLimit(clientIP)) {
            return res.status(429).json({
                success: false,
                error: 'Too many messages. Please wait a moment.'
            });
        }
        
        // Validate inputs
        if (!companyId || !/^[a-f0-9]{24}$/i.test(companyId)) {
            return res.status(400).json({
                success: false,
                error: 'Invalid company ID'
            });
        }
        
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Message is required'
            });
        }
        
        if (message.length > 1000) {
            return res.status(400).json({
                success: false,
                error: 'Message too long (max 1000 characters)'
            });
        }
        
        // Fetch company
        const company = await v2Company.findById(companyId).lean();
        
        if (!company) {
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        if (company.status === 'inactive' || company.status === 'suspended') {
            return res.status(403).json({
                success: false,
                error: 'Chat is currently unavailable'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════════════════
        // LOAD BOOKING CONTEXT (if booking ID provided)
        // ═══════════════════════════════════════════════════════════════════════════
        let bookingContext = null;
        if (bookingId && /^[a-f0-9]{24}$/i.test(bookingId)) {
            try {
                const booking = await BookingRequest.findOne({
                    _id: bookingId,
                    companyId: companyId
                }).select('slots calendarEventStart serviceType issue').lean();
                
                if (booking) {
                    bookingContext = {
                        bookingId: booking._id.toString(),
                        customerName: booking.slots?.name?.full ||
                            `${booking.slots?.name?.first || ''} ${booking.slots?.name?.last || ''}`.trim(),
                        customerPhone: booking.slots?.phone,
                        customerAddress: booking.slots?.address?.full || booking.slots?.address,
                        appointmentTime: booking.calendarEventStart || booking.slots?.time,
                        serviceType: booking.serviceType || booking.issue || 'service'
                    };
                }
            } catch (bookingErr) {
                logger.warn('[PUBLIC CHAT] Could not load booking for message', { bookingId });
            }
        }
        
        // Find or create conversation session
        let session = await ConversationSession.findOne({
            companyId,
            'metadata.webChatSessionId': sessionId
        });
        
        if (!session) {
            session = new ConversationSession({
                companyId,
                channel: 'web_chat',
                status: 'active',
                metadata: {
                    webChatSessionId: sessionId,
                    bookingId: bookingId || null,
                    clientIP: clientIP,
                    startedAt: new Date(),
                    // Store booking context for AI to reference
                    bookingContext: bookingContext
                },
                turns: []
            });
        } else if (bookingContext && !session.metadata?.bookingContext) {
            // Update existing session with booking context if not already set
            session.metadata = session.metadata || {};
            session.metadata.bookingContext = bookingContext;
            session.markModified('metadata');
        }
        
        // Add user message to session
        session.turns.push({
            role: 'user',
            content: message.trim(),
            timestamp: new Date()
        });
        
        logger.info('[PUBLIC CHAT] Message received', { 
            companyId,
            sessionId,
            messageLength: message.length
        });
        
        // ═══════════════════════════════════════════════════════════════════════════
        // PROCESS WITH CONVERSATION ENGINE
        // ═══════════════════════════════════════════════════════════════════════════
        
        let aiResponse;
        try {
            // Import ConversationEngine
            const ConversationEngine = require('../../services/ConversationEngine');
            
            // Build context for AI (include booking info if available)
            const customerContext = bookingContext ? {
                isReturningCustomer: true,
                customerName: bookingContext.customerName,
                customerPhone: bookingContext.customerPhone,
                customerAddress: bookingContext.customerAddress,
                currentBooking: {
                    appointmentTime: bookingContext.appointmentTime,
                    serviceType: bookingContext.serviceType
                }
            } : null;
            
            // Process the message through the AI
            const result = await ConversationEngine.processTurn({
                userText: message.trim(),
                session: session,
                company: company,
                customerContext: customerContext, // Pass booking context to AI
                metadata: {
                    channel: 'web_chat',
                    sessionId: sessionId,
                    bookingId: bookingId || null,
                    clientIP: clientIP,
                    hasBookingContext: !!bookingContext
                }
            });
            
            aiResponse = result.response || result.text || "I'm here to help! Could you tell me more about what you need?";
            
        } catch (engineErr) {
            logger.error('[PUBLIC CHAT] ConversationEngine error', { 
                error: engineErr.message,
                companyId,
                sessionId
            });
            
            // Fallback response (personalized if we have customer name)
            if (bookingContext?.customerName) {
                const firstName = bookingContext.customerName.split(' ')[0];
                aiResponse = `Thanks for your message, ${firstName}! Let me look into that for you. Is there anything specific about your appointment I can help with?`;
            } else {
                aiResponse = `Thanks for your message! Our team at ${company.companyName} will get back to you shortly. Is there anything specific I can help you with in the meantime?`;
            }
        }
        
        // Add AI response to session
        session.turns.push({
            role: 'assistant',
            content: aiResponse,
            timestamp: new Date()
        });
        
        // Save session
        session.markModified('turns');
        session.lastActivityAt = new Date();
        await session.save();
        
        logger.info('[PUBLIC CHAT] Response sent', { 
            companyId,
            sessionId,
            responseLength: aiResponse.length
        });
        
        res.json({
            success: true,
            response: aiResponse
        });
        
    } catch (err) {
        logger.error('[PUBLIC CHAT] Message processing failed', { 
            companyId: req.params.companyId,
            error: err.message,
            stack: err.stack
        });
        res.status(500).json({ 
            success: false, 
            error: "I'm having trouble right now. Please try again in a moment." 
        });
    }
});

// ════════════════════════════════════════════════════════════════════════════════
// CLEAR SESSION (optional - for testing)
// ════════════════════════════════════════════════════════════════════════════════

/**
 * DELETE /api/public-chat/:companyId/session/:sessionId
 * Clear a chat session (useful for testing)
 */
router.delete('/:companyId/session/:sessionId', async (req, res) => {
    try {
        const { companyId, sessionId } = req.params;
        
        await ConversationSession.deleteOne({
            companyId,
            'metadata.webChatSessionId': sessionId
        });
        
        res.json({ success: true, message: 'Session cleared' });
        
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
