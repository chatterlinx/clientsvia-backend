/**
 * ============================================================================
 * WEBSITE CHAT API - AI Receptionist for Website Visitors
 * ============================================================================
 * 
 * This endpoint handles chat messages from:
 * 1. Website chat widgets (embedded on customer websites)
 * 2. AI Test Console (developer testing tool)
 * 
 * CRITICAL DESIGN DECISION:
 * All interactions are treated as REAL customer interactions.
 * There is NO "test mode" flag. The AI Test Console creates real sessions
 * that appear in the Call Center with channel: 'website'.
 * 
 * This ensures:
 * - AI doesn't "know" it's being tested
 * - All conversations train the AI the same way
 * - Call Center shows unified view of all channels
 * 
 * MULTI-TENANT: Company ID is required in all requests
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const Company = require('../../models/v2Company');
const CustomerService = require('../../services/CustomerService');
const SessionService = require('../../services/SessionService');
const RunningSummaryService = require('../../services/RunningSummaryService');
const HybridReceptionistLLM = require('../../services/HybridReceptionistLLM');
const logger = require('../../utils/logger');

// ════════════════════════════════════════════════════════════════════════════
// OPTIONAL AUTH - Works with or without authentication
// ════════════════════════════════════════════════════════════════════════════
// - Website visitors: No auth required (public API)
// - AI Test Console: Can use auth if desired
// - Rate limiting should be added for production security
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
            // Token invalid, but that's OK - this auth is optional
            logger.debug('[CHAT API] Invalid token provided, continuing as anonymous');
        }
    }
    next();
};

// Apply optional auth to all routes
router.use(optionalAuth);

/**
 * GET /api/chat/health
 * Simple health check to verify the route is loaded
 */
router.get('/health', (req, res) => {
    res.json({ 
        success: true, 
        service: 'chat-api',
        timestamp: new Date().toISOString(),
        authenticated: !!req.user
    });
});

/**
 * POST /api/chat/message
 * 
 * Process a chat message from website or test console
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
 *   }
 * }
 * 
 * Response:
 * {
 *   success: true,
 *   response: string,
 *   sessionId: string,
 *   debug: { ... } (only if includeDebug: true)
 * }
 */
router.post('/message', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const {
            companyId,
            message,
            sessionId: providedSessionId,
            visitorInfo = {},
            includeDebug = false
        } = req.body;
        
        // ═══════════════════════════════════════════════════════════════
        // VALIDATION
        // ═══════════════════════════════════════════════════════════════
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
        
        logger.info('[CHAT API] 🌐 Processing website chat message', {
            companyId,
            messageLength: message.length,
            hasSessionId: !!providedSessionId,
            hasVisitorInfo: Object.keys(visitorInfo).length > 0
        });
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 1: Load company
        // ═══════════════════════════════════════════════════════════════
        const company = await Company.findById(companyId);
        
        if (!company) {
            logger.warn('[CHAT API] Company not found', { companyId });
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 2: Find or create customer
        // ═══════════════════════════════════════════════════════════════
        let customer = null;
        let isNewCustomer = false;
        
        // Try to identify customer by phone or email
        if (visitorInfo.phone || visitorInfo.email) {
            const result = await CustomerService.findOrCreate(
                companyId,
                {
                    phone: visitorInfo.phone,
                    email: visitorInfo.email,
                    name: visitorInfo.name,
                    sessionId: providedSessionId
                },
                'website'
            );
            customer = result.customer;
            isNewCustomer = result.isNew;
        } else if (providedSessionId) {
            // Try to find by session ID
            customer = await CustomerService.findBySession(companyId, providedSessionId);
            
            if (!customer) {
                // Create temporary customer for this session
                const result = await CustomerService.findOrCreate(
                    companyId,
                    { sessionId: providedSessionId },
                    'website'
                );
                customer = result.customer;
                isNewCustomer = result.isNew;
            }
        }
        
        // Generate session ID if not provided
        const sessionId = providedSessionId || `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        logger.info('[CHAT API] Customer lookup', {
            hasCustomer: !!customer,
            isNewCustomer,
            customerId: customer?._id
        });
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 3: Get or create session
        // ═══════════════════════════════════════════════════════════════
        const session = await SessionService.getOrCreate({
            companyId,
            channel: 'website',
            identifiers: {
                sessionId,
                ip: visitorInfo.ip || req.ip,
                userAgent: visitorInfo.userAgent || req.get('user-agent'),
                pageUrl: visitorInfo.pageUrl
            },
            customer
        });
        
        logger.info('[CHAT API] Session', {
            sessionId: session._id,
            turns: session.metrics.totalTurns
        });
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 4: Build customer context
        // ═══════════════════════════════════════════════════════════════
        const customerContext = customer 
            ? CustomerService.buildContextForAI(customer)
            : { isKnown: false, summary: 'New website visitor' };
        
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
        // STEP 6: Get conversation history
        // ═══════════════════════════════════════════════════════════════
        const conversationHistory = session.getHistoryForAI();
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 7: Process through AI brain
        // ═══════════════════════════════════════════════════════════════
        // CRITICAL: Must match HybridReceptionistLLM.processConversation signature exactly
        const aiResult = await HybridReceptionistLLM.processConversation({
            company,
            callContext: {
                callId: session._id.toString(),
                companyId,
                customerContext,
                runningSummary: summaryFormatted,
                turnCount: (session.metrics?.totalTurns || 0) + 1,
                channel: 'website'
            },
            currentMode: session.phase === 'booking' ? 'booking' : 'free',
            knownSlots: session.collectedSlots || {},
            conversationHistory,
            userInput: message,
            behaviorConfig: company.aiAgentSettings?.frontDeskBehavior || {}
        });
        
        const latencyMs = Date.now() - startTime;
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 8: Update session
        // ═══════════════════════════════════════════════════════════════
        // CRITICAL: HybridReceptionistLLM returns { reply, conversationMode, needsInfo, filledSlots, latencyMs, tokensUsed }
        const aiResponse = aiResult.reply || aiResult.response || 'I apologize, I could not process your request.';
        
        await SessionService.addTurn({
            session,
            userMessage: message,
            aiResponse,
            metadata: {
                latencyMs,
                tokensUsed: aiResult.tokensUsed || 0,
                responseSource: aiResult.fromQuickAnswers ? 'quick_answer' : 'llm',
                confidence: aiResult.confidence,
                slotsExtracted: aiResult.filledSlots || {}
            },
            company
        });
        
        // Update phase based on conversationMode
        const newPhase = aiResult.conversationMode === 'booking' ? 'booking' : 
                         aiResult.conversationMode === 'complete' ? 'complete' : 
                         session.phase;
        if (newPhase !== session.phase) {
            await SessionService.updatePhase(session, newPhase);
        }
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 9: Check for booking completion
        // ═══════════════════════════════════════════════════════════════
        // Check if all slots are filled
        const slots = session.collectedSlots || {};
        const requiredSlots = ['name', 'phone', 'address'];
        const allSlotsFilled = requiredSlots.every(s => slots[s]);
        
        if (allSlotsFilled && aiResult.conversationMode === 'booking') {
            // Booking is complete
            await SessionService.end(session, 'booked');
        }
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 10: Build response
        // ═══════════════════════════════════════════════════════════════
        const responsePayload = {
            success: true,
            response: aiResponse,
            sessionId: sessionId,
            conversationSessionId: session._id.toString()
        };
        
        // Include debug info if requested (for AI Test Console)
        if (includeDebug) {
            responsePayload.debug = {
                latencyMs,
                tokensUsed: aiResult.tokensUsed || 0,
                responseSource: aiResult.fromQuickAnswers ? 'quick_answer' : 'llm',
                confidence: aiResult.confidence,
                phase: newPhase,
                conversationMode: aiResult.conversationMode,
                needsInfo: aiResult.needsInfo,
                customerContext: {
                    isKnown: customerContext.isKnown,
                    isReturning: customerContext.isReturning,
                    name: customerContext.name
                },
                runningSummary: summaryBullets,
                slotsCollected: { ...session.collectedSlots, ...(aiResult.filledSlots || {}) },
                turnNumber: session.metrics.totalTurns
            };
        }
        
        logger.info('[CHAT API] ✅ Response sent', {
            sessionId: session._id,
            latencyMs,
            responseLength: aiResponse?.length
        });
        
        return res.json(responsePayload);
        
    } catch (error) {
        logger.error('[CHAT API] ❌ Error processing message', {
            error: error.message,
            stack: error.stack
        });
        
        return res.status(500).json({
            success: false,
            error: 'Failed to process message',
            details: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

/**
 * POST /api/chat/end
 * 
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
        
        const session = await SessionService.findById(sessionId);
        
        if (!session) {
            return res.status(404).json({
                success: false,
                error: 'Session not found'
            });
        }
        
        await SessionService.end(session, outcome);
        
        logger.info('[CHAT API] Session ended', {
            sessionId: session._id,
            outcome,
            duration: session.metrics.durationSeconds
        });
        
        return res.json({
            success: true,
            duration: session.metrics.durationSeconds,
            turns: session.metrics.totalTurns
        });
        
    } catch (error) {
        logger.error('[CHAT API] Error ending session', {
            error: error.message
        });
        
        return res.status(500).json({
            success: false,
            error: 'Failed to end session'
        });
    }
});

/**
 * GET /api/chat/session/:sessionId
 * 
 * Get session details (for reconnecting or debugging)
 */
router.get('/session/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const session = await SessionService.findById(sessionId);
        
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
                turns: session.metrics.totalTurns,
                transcript: session.getTranscript(),
                collectedSlots: session.collectedSlots,
                startedAt: session.startedAt
            }
        });
        
    } catch (error) {
        logger.error('[CHAT API] Error getting session', {
            error: error.message
        });
        
        return res.status(500).json({
            success: false,
            error: 'Failed to get session'
        });
    }
});

module.exports = router;

