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
 */
router.get('/:companyId/info', async (req, res) => {
    try {
        const { companyId } = req.params;
        const sessionId = req.query.session;
        
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
            companyName: company.companyName
        });
        
        res.json({
            success: true,
            companyName: company.companyName,
            greeting,
            messages,
            // Future: could add primaryColor, logo, etc.
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
        const { sessionId, message } = req.body;
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
                    clientIP: clientIP,
                    startedAt: new Date()
                },
                turns: []
            });
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
            
            // Process the message through the AI
            const result = await ConversationEngine.processTurn({
                userText: message.trim(),
                session: session,
                company: company,
                metadata: {
                    channel: 'web_chat',
                    sessionId: sessionId,
                    clientIP: clientIP
                }
            });
            
            aiResponse = result.response || result.text || "I'm here to help! Could you tell me more about what you need?";
            
        } catch (engineErr) {
            logger.error('[PUBLIC CHAT] ConversationEngine error', { 
                error: engineErr.message,
                companyId,
                sessionId
            });
            
            // Fallback response
            aiResponse = `Thanks for your message! Our team at ${company.companyName} will get back to you shortly. Is there anything specific I can help you with in the meantime?`;
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
