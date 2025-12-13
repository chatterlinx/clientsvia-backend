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
const LLM0TurnHandler = require('../../services/LLM0TurnHandler');
const BookingScriptEngine = require('../../services/BookingScriptEngine');
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
        logger.info('[CHAT API] CHECKPOINT 1: Loading company...');
        let company;
        try {
            company = await Company.findById(companyId);
        } catch (companyErr) {
            companyErr.checkpoint = 'company_load';
            throw companyErr;
        }
        
        if (!company) {
            logger.warn('[CHAT API] Company not found', { companyId });
            return res.status(404).json({
                success: false,
                error: 'Company not found'
            });
        }
        logger.info('[CHAT API] CHECKPOINT 1: ✅ Company loaded:', company.companyName);
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 2: Find or create customer (OPTIONAL - don't fail if no customer)
        // ═══════════════════════════════════════════════════════════════
        logger.info('[CHAT API] CHECKPOINT 2: Customer lookup...');
        let customer = null;
        let isNewCustomer = false;
        
        // Generate session ID first
        const sessionId = providedSessionId || `web-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        
        try {
            // Try to identify customer by phone or email
            if (visitorInfo.phone || visitorInfo.email) {
                const result = await CustomerService.findOrCreate(
                    companyId,
                    {
                        phone: visitorInfo.phone,
                        email: visitorInfo.email,
                        name: visitorInfo.name,
                        sessionId
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
                        { sessionId },
                        'website'
                    );
                    customer = result.customer;
                    isNewCustomer = result.isNew;
                }
            }
        } catch (custErr) {
            // Customer lookup failed - log but continue without customer
            logger.warn('[CHAT API] Customer lookup failed, continuing without customer:', custErr.message);
        }
        
        logger.info('[CHAT API] CHECKPOINT 2: ✅ Customer lookup done', {
            hasCustomer: !!customer,
            isNewCustomer,
            customerId: customer?._id
        });
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 3: Get or create session
        // ═══════════════════════════════════════════════════════════════
        logger.info('[CHAT API] CHECKPOINT 3: Creating session...');
        let session;
        try {
            session = await SessionService.getOrCreate({
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
        } catch (sessErr) {
            sessErr.checkpoint = 'session_create';
            throw sessErr;
        }
        
        logger.info('[CHAT API] CHECKPOINT 3: ✅ Session ready', {
            sessionId: session._id,
            turns: session.metrics?.totalTurns || 0
        });
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 4: Build customer context
        // ═══════════════════════════════════════════════════════════════
        logger.info('[CHAT API] CHECKPOINT 4: Building customer context...');
        let customerContext;
        try {
            customerContext = customer 
                ? CustomerService.buildContextForAI(customer)
                : { isKnown: false, summary: 'New website visitor' };
        } catch (ctxErr) {
            // Fall back to simple context if builder fails
            logger.warn('[CHAT API] buildContextForAI failed, using simple context:', ctxErr.message);
            customerContext = { isKnown: false, summary: 'New website visitor' };
        }
        logger.info('[CHAT API] CHECKPOINT 4: ✅ Customer context built');
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 5: Build running summary
        // ═══════════════════════════════════════════════════════════════
        logger.info('[CHAT API] CHECKPOINT 5: Building running summary...');
        let summaryBullets = [];
        let summaryFormatted = '';
        try {
            const summaryResult = RunningSummaryService.buildAndFormat({
                previousSummary: session.runningSummary || [],
                customerContext,
                currentTurn: { userMessage: message },
                conversationState: {
                    phase: session.phase || 'greeting',
                    knownSlots: session.collectedSlots || {},
                    signals: session.signals || {}
                },
                company
            });
            summaryBullets = summaryResult.bullets;
            summaryFormatted = summaryResult.formatted;
        } catch (sumErr) {
            logger.warn('[CHAT API] Running summary failed, continuing without:', sumErr.message);
        }
        logger.info('[CHAT API] CHECKPOINT 5: ✅ Running summary built');
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 6: Get conversation history
        // ═══════════════════════════════════════════════════════════════
        logger.info('[CHAT API] CHECKPOINT 6: Getting conversation history...');
        let conversationHistory = [];
        try {
            conversationHistory = session.getHistoryForAI ? session.getHistoryForAI() : [];
        } catch (histErr) {
            logger.warn('[CHAT API] getHistoryForAI failed, using empty history:', histErr.message);
        }
        logger.info('[CHAT API] CHECKPOINT 6: ✅ History retrieved, turns:', conversationHistory.length);
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 6.5: Extract slots from user message
        // ═══════════════════════════════════════════════════════════════
        logger.info('[CHAT API] CHECKPOINT 6.5: Extracting slots from user input...');
        const currentSlots = { ...(session.collectedSlots || {}) };
        const extractedThisTurn = {};
        
        // Get booking config to check askMissingNamePart setting
        const bookingConfig = BookingScriptEngine.getBookingSlotsFromCompany(company);
        const nameSlotConfig = bookingConfig.slots.find(s => s.slotId === 'name' || s.id === 'name');
        const askMissingNamePart = nameSlotConfig?.askMissingNamePart === true;
        
        try {
            // Extract name if we don't have one
            if (!currentSlots.name) {
                const extractedName = LLM0TurnHandler.extractName(message);
                if (extractedName) {
                    // Check if askMissingNamePart is enabled and name is partial (single word)
                    const isPartialName = !extractedName.includes(' '); // No space = single word
                    const alreadyAskedForMissingPart = session.askedForMissingNamePart === true;
                    
                    if (askMissingNamePart && isPartialName && !alreadyAskedForMissingPart) {
                        // Store partial name but DON'T mark slot as complete
                        // This lets AI ask for the full name
                        currentSlots.partialName = extractedName;
                        extractedThisTurn.partialName = extractedName;
                        logger.info('[CHAT API] 📝 Partial name detected (askMissingNamePart enabled):', extractedName);
                        logger.info('[CHAT API] 👤 Will let AI ask for full name');
                    } else {
                        // Either:
                        // - askMissingNamePart is disabled
                        // - Name has both first and last (has space)
                        // - We already asked once (don't insist)
                        
                        // If we had a partial name and now got more, combine them
                        if (currentSlots.partialName && isPartialName) {
                            currentSlots.name = `${currentSlots.partialName} ${extractedName}`;
                            delete currentSlots.partialName;
                            logger.info('[CHAT API] 📝 Combined partial names into full name:', currentSlots.name);
                        } else if (currentSlots.partialName) {
                            // Had partial, got full name now - use the full one
                            currentSlots.name = extractedName;
                            delete currentSlots.partialName;
                            logger.info('[CHAT API] 📝 Got full name after partial:', currentSlots.name);
                        } else {
                            currentSlots.name = extractedName;
                            logger.info('[CHAT API] 📝 Extracted name:', extractedName);
                        }
                        extractedThisTurn.name = currentSlots.name;
                    }
                } else if (currentSlots.partialName) {
                    // User didn't give a name this turn, but we have a partial
                    // Accept the partial name and move on (only ask once)
                    currentSlots.name = currentSlots.partialName;
                    delete currentSlots.partialName;
                    extractedThisTurn.name = currentSlots.name;
                    logger.info('[CHAT API] 📝 Accepting partial name as complete:', currentSlots.name);
                }
            }
            
            // Extract phone if we don't have one
            if (!currentSlots.phone) {
                const extractedPhone = LLM0TurnHandler.extractPhone(message);
                if (extractedPhone) {
                    currentSlots.phone = extractedPhone;
                    extractedThisTurn.phone = extractedPhone;
                    logger.info('[CHAT API] 📞 Extracted phone:', extractedPhone);
                }
            }
            
            // Extract address if we don't have one
            if (!currentSlots.address) {
                const extractedAddress = LLM0TurnHandler.extractAddress(message);
                if (extractedAddress) {
                    currentSlots.address = extractedAddress;
                    extractedThisTurn.address = extractedAddress;
                    logger.info('[CHAT API] 📍 Extracted address:', extractedAddress);
                }
            }
        } catch (extractErr) {
            logger.warn('[CHAT API] Slot extraction error (non-fatal):', extractErr.message);
        }
        
        // Track if we're about to ask for missing name part (for the flag)
        const willAskForMissingNamePart = currentSlots.partialName && !currentSlots.name;
        
        logger.info('[CHAT API] CHECKPOINT 6.5: ✅ Slots after extraction:', {
            ...currentSlots,
            _willAskForMissingNamePart: willAskForMissingNamePart
        });
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 7: Process through AI brain
        // ═══════════════════════════════════════════════════════════════
        logger.info('[CHAT API] CHECKPOINT 7: Calling AI brain...');
        let aiResult;
        try {
            // CRITICAL: Must match HybridReceptionistLLM.processConversation signature exactly
            aiResult = await HybridReceptionistLLM.processConversation({
                company,
                callContext: {
                    callId: session._id.toString(),
                    companyId,
                    customerContext,
                    runningSummary: summaryFormatted,
                    turnCount: (session.metrics?.totalTurns || 0) + 1,
                    channel: 'website',
                    partialName: currentSlots.partialName || null  // Pass partial name so AI can reference it
                },
                currentMode: session.phase === 'booking' ? 'booking' : 'free',
                knownSlots: currentSlots,  // Use slots with extractions
                conversationHistory,
                userInput: message,
                behaviorConfig: company.aiAgentSettings?.frontDeskBehavior || {}
            });
            
            // Merge extracted slots into AI result
            aiResult.filledSlots = { ...(aiResult.filledSlots || {}), ...extractedThisTurn };
            
            // If we asked for missing name part this turn, set the flag so we don't ask again
            if (willAskForMissingNamePart) {
                session.askedForMissingNamePart = true;
                logger.info('[CHAT API] 👤 Set askedForMissingNamePart flag - will not ask again');
            }
        } catch (aiErr) {
            aiErr.checkpoint = 'ai_processing';
            throw aiErr;
        }
        logger.info('[CHAT API] CHECKPOINT 7: ✅ AI response generated');
        
        const latencyMs = Date.now() - startTime;
        
        // ═══════════════════════════════════════════════════════════════
        // STEP 8: Update session
        // ═══════════════════════════════════════════════════════════════
        logger.info('[CHAT API] CHECKPOINT 8: Updating session...');
        // CRITICAL: HybridReceptionistLLM returns { reply, conversationMode, needsInfo, filledSlots, latencyMs, tokensUsed }
        const aiResponse = aiResult?.reply || aiResult?.response || 'I apologize, I could not process your request.';
        
        try {
            await SessionService.addTurn({
                session,
                userMessage: message,
                aiResponse,
                metadata: {
                    latencyMs,
                    tokensUsed: aiResult?.tokensUsed || 0,
                    responseSource: aiResult?.fromQuickAnswers ? 'quick_answer' : 'llm',
                    confidence: aiResult?.confidence,
                    slotsExtracted: aiResult?.filledSlots || {}
                },
                company
            });
        } catch (turnErr) {
            logger.warn('[CHAT API] Failed to save turn, continuing:', turnErr.message);
        }
        
        // Update phase based on conversationMode
        const newPhase = aiResult?.conversationMode === 'booking' ? 'booking' : 
                         aiResult?.conversationMode === 'complete' ? 'complete' : 
                         session.phase || 'greeting';
        try {
            if (newPhase !== session.phase) {
                await SessionService.updatePhase(session, newPhase);
            }
            
            // Save askedForMissingNamePart flag and partialName if set
            if (session.askedForMissingNamePart || currentSlots.partialName) {
                await session.constructor.findByIdAndUpdate(session._id, {
                    $set: {
                        askedForMissingNamePart: session.askedForMissingNamePart || false,
                        'collectedSlots.partialName': currentSlots.partialName || null
                    }
                });
            }
        } catch (phaseErr) {
            logger.warn('[CHAT API] Failed to update phase/flags:', phaseErr.message);
        }
        logger.info('[CHAT API] CHECKPOINT 8: ✅ Session updated');
        
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
            // Get booking config for debug - shows what prompts AI was given
            const frontDeskBehavior = company.aiAgentSettings?.frontDeskBehavior || {};
            const bookingConfig = BookingScriptEngine.getBookingSlotsFromCompany(company);
            
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
                turnNumber: session.metrics?.totalTurns || 0,
                historySent: conversationHistory.length,
                // ═══════════════════════════════════════════════════════════════
                // BOOKING CONFIG DEBUG - Shows exactly what prompts AI sees
                // ═══════════════════════════════════════════════════════════════
                bookingConfig: {
                    source: bookingConfig.source,  // 'DATABASE' or 'NOT_CONFIGURED'
                    isConfigured: bookingConfig.isConfigured,
                    slots: bookingConfig.slots.map(s => {
                        const slotDebug = {
                            id: s.slotId,
                            type: s.type,
                            question: s.question,  // THE ACTUAL QUESTION AI SHOULD USE
                            required: s.required
                        };
                        
                        // Show type-specific options that AI will read
                        if (s.type === 'name' || s.slotId === 'name') {
                            slotDebug.nameOptions = {
                                askFullName: s.askFullName,
                                useFirstNameOnly: s.useFirstNameOnly,
                                askMissingNamePart: s.askMissingNamePart  // 🔴 The key setting!
                            };
                        }
                        if (s.type === 'phone' || s.slotId === 'phone') {
                            slotDebug.phoneOptions = {
                                offerCallerId: s.offerCallerId,
                                acceptTextMe: s.acceptTextMe
                            };
                        }
                        if (s.type === 'address' || s.slotId === 'address') {
                            slotDebug.addressOptions = {
                                addressConfirmLevel: s.addressConfirmLevel,
                                acceptPartialAddress: s.acceptPartialAddress
                            };
                        }
                        if (s.confirmBack) {
                            slotDebug.confirmBack = s.confirmPrompt;
                        }
                        
                        return slotDebug;
                    })
                }
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
            stack: error.stack,
            companyId: req.body?.companyId,
            messagePreview: req.body?.message?.substring(0, 50)
        });
        
        // Always return error details for debugging (can restrict later)
        return res.status(500).json({
            success: false,
            error: 'Failed to process message',
            details: error.message,
            errorType: error.name,
            checkpoint: error.checkpoint || 'unknown'
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

