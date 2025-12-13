/**
 * ============================================================================
 * WEBSITE CHAT API - Adapter for Website/Test Console
 * ============================================================================
 * 
 * This is a THIN ADAPTER that handles JSON formatting for web clients.
 * ALL conversation logic is in ConversationEngine.
 * 
 * This endpoint handles chat messages from:
 * 1. Website chat widgets (embedded on customer websites)
 * 2. AI Test Console (developer testing tool)
 * 
 * CRITICAL: This route does NOT contain AI logic!
 * It only: validates input → calls ConversationEngine → formats output
 * 
 * MULTI-TENANT: Company ID is required in all requests
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const ConversationEngine = require('../../services/ConversationEngine');
const logger = require('../../utils/logger');

// ════════════════════════════════════════════════════════════════════════════
// OPTIONAL AUTH - Works with or without authentication
// ════════════════════════════════════════════════════════════════════════════
const jwt = require('jsonwebtoken');

const optionalAuth = (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.slice(7);
        try {
            const decoded = jwt.verify(token, process.env.JWT_SECRET);
            req.user = decoded;
            logger.debug('[CHAT API] Authenticated user:', { userId: decoded.userId || decoded.id });
        } catch (err) {
            logger.debug('[CHAT API] Invalid token provided, continuing as anonymous');
        }
    }
    next();
};

router.use(optionalAuth);

/**
 * GET /api/chat/health
 * Simple health check to verify the route is loaded
 */
router.get('/health', (req, res) => {
    res.json({ 
        success: true, 
        service: 'chat-api',
        engine: ConversationEngine.ENGINE_VERSION,
        timestamp: new Date().toISOString(),
        authenticated: !!req.user
    });
});

/**
 * POST /api/chat/message
 * 
 * Process a chat message from website or test console
 * This is a THIN ADAPTER - all logic is in ConversationEngine
 * 
 * Body:
 * {
 *   companyId: string (required),
 *   message: string (required),
 *   sessionId: string (optional - will create if not provided),
 *   visitorInfo: {
 *     ip: string,
 *     userAgent: string,
 *     pageUrl: string,
 *     phone: string (if collected),
 *     email: string (if collected),
 *     name: string (if collected)
 *   },
 *   includeDebug: boolean (optional - for test console)
 * }
 */
router.post('/message', async (req, res) => {
    try {
        const {
            companyId,
            message,
            sessionId,
            visitorInfo = {},
            includeDebug = false
        } = req.body;
        
        // ═══════════════════════════════════════════════════════════════════
        // VALIDATION (adapter responsibility)
        // ═══════════════════════════════════════════════════════════════════
        if (!companyId) {
            return res.status(400).json({
                success: false,
                error: 'companyId is required'
            });
        }
        
        if (!message || typeof message !== 'string' || message.trim().length === 0) {
            return res.status(400).json({
                success: false,
                error: 'message is required and must be a non-empty string'
            });
        }
        
        logger.info('[CHAT API] 🌐 Processing message via ConversationEngine', {
            companyId,
            messageLength: message.length,
            hasSessionId: !!sessionId
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // CALL CONVERSATION ENGINE (the unified brain)
        // ═══════════════════════════════════════════════════════════════════
        const result = await ConversationEngine.processTurn({
            companyId,
            channel: 'website',
            userText: message,
            sessionId,
            callerPhone: visitorInfo.phone,
            visitorInfo: {
                ip: visitorInfo.ip || req.ip,
                userAgent: visitorInfo.userAgent || req.get('user-agent'),
                pageUrl: visitorInfo.pageUrl,
                email: visitorInfo.email,
                name: visitorInfo.name
            },
            includeDebug
        });
        
        // ═══════════════════════════════════════════════════════════════════
        // FORMAT RESPONSE (adapter responsibility)
        // ═══════════════════════════════════════════════════════════════════
        const response = {
            success: result.success,
            response: result.reply,  // Keep 'response' key for backward compatibility
            sessionId: result.sessionId,
            conversationSessionId: result.sessionId
        };
        
        // Include debug info if requested (for AI Test Console)
        if (includeDebug && result.debug) {
            response.debug = result.debug;
        }
        
        // Include error details if failed
        if (!result.success) {
            response.error = result.error;
            response.errorType = result.errorType;
        }
        
        logger.info('[CHAT API] ✅ Response sent', {
            sessionId: result.sessionId,
            latencyMs: result.latencyMs,
            responseLength: result.reply?.length
        });
        
        return res.json(response);
        
    } catch (error) {
        logger.error('[CHAT API] ❌ Unexpected error', {
            error: error.message,
            stack: error.stack
        });
        
        return res.status(500).json({
            success: false,
            error: 'Failed to process message',
            details: error.message
        });
    }
});

/**
 * POST /api/chat/end
 * End a chat session
 */
router.post('/end', async (req, res) => {
    try {
        const { sessionId, outcome = 'no_action' } = req.body;
        
        if (!sessionId) {
            return res.status(400).json({
                success: false,
                error: 'sessionId is required'
            });
        }
        
        const session = await ConversationEngine.endSession(sessionId, outcome);
        
        logger.info('[CHAT API] Session ended', {
            sessionId,
            outcome,
            duration: session.metrics?.durationSeconds
        });
        
        return res.json({
            success: true,
            duration: session.metrics?.durationSeconds,
            turns: session.metrics?.totalTurns
        });
        
    } catch (error) {
        logger.error('[CHAT API] Error ending session', { error: error.message });
        
        return res.status(error.message === 'Session not found' ? 404 : 500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * GET /api/chat/session/:sessionId
 * Get session details (for reconnecting or debugging)
 */
router.get('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const session = await ConversationEngine.getSession(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }
        
        return res.json({
            success: true,
            session: {
                id: session._id,
                channel: session.channel,
                status: session.status,
                phase: session.phase,
                turns: session.metrics?.totalTurns,
                transcript: session.getTranscript ? session.getTranscript() : [],
                collectedSlots: session.collectedSlots,
                startedAt: session.startedAt
            }
        });
        
    } catch (error) {
        logger.error('[CHAT API] Error getting session', { error: error.message });
        
        return res.status(500).json({
            success: false,
            error: 'Failed to get session'
        });
    }
});

module.exports = router;
