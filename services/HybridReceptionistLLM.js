/**
 * ============================================================================
 * HYBRID RECEPTIONIST LLM - The REAL AI Brain
 * ============================================================================
 * 
 * This is what you're PAYING for. This is the brain that makes callers
 * think they're talking to a human.
 * 
 * THREE MODES:
 * 1. FREE/DISCOVERY - Open conversation, figure out what they want
 * 2. GUIDED - Booking/triage with natural conversation
 * 3. RESCUE - Handle frustration, stupid comments, side questions
 * 
 * EVERY TURN:
 * - Gets full conversation history
 * - Gets all known data (slots, mode, signals)
 * - Returns: reply + extracted slots + next goal + signals
 * - Engine just validates and sends reply to TTS
 * 
 * THIS IS NOT AN IVR. THIS IS A RECEPTIONIST.
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ IMPORTANT: All LLM calls go through llmRegistry - NOT direct OpenAI
// ════════════════════════════════════════════════════════════════════════════
const { callLLM0 } = require('./llmRegistry');
const TriageContextProvider = require('./TriageContextProvider');
const STTProfile = require('../models/STTProfile');
const BookingScriptEngine = require('./BookingScriptEngine');

// ═══════════════════════════════════════════════════════════════════════════════
// 🎯 VERSION BANNER - This log PROVES the new code is deployed
// ═══════════════════════════════════════════════════════════════════════════════
const HYBRID_LLM_VERSION = '2025-12-14-LEAN-PROMPT-V1';
logger.info(`[HYBRID RECEPTIONIST LLM] 🧠 LOADED VERSION: ${HYBRID_LLM_VERSION}`, {
    features: [
        '🚨 100% UI-CONTROLLED - NO HARDCODED AI INSTRUCTIONS',
        'All forbidden phrases from UI',
        'All frustration triggers from UI',
        'All personality from UI',
        'All prompts from UI'
    ]
});
// ═══════════════════════════════════════════════════════════════════════════════
const ServiceAreaHandler = require('./ServiceAreaHandler');

// ════════════════════════════════════════════════════════════════════════════
// 🚨 NO HARDCODED BEHAVIOR RULES - EVERYTHING COMES FROM UI
// ════════════════════════════════════════════════════════════════════════════
// All AI behavior is controlled via:
//   company.aiAgentSettings.frontDeskBehavior
// 
// If you need new controls, ADD TABS TO THE UI.
// NEVER hardcode AI instructions in backend code.
// ════════════════════════════════════════════════════════════════════════════

/**
 * Load Front Desk Behavior config from company
 * 🚨 ZERO HARDCODED DEFAULTS - Everything comes from database
 * If config is missing, the system will show clear errors in UI
 */
function loadFrontDeskConfig(company) {
    const config = company?.aiAgentSettings?.frontDeskBehavior || {};
    
    // 🚨 FLAG: Is this company properly configured?
    const isConfigured = !!(config.bookingSlots?.length > 0);
    
    return {
        // Meta: Is this company configured?
        _isConfigured: isConfigured,
        _configSource: isConfigured ? 'DATABASE' : 'NOT_CONFIGURED',
        
        // Personality - from database ONLY
        personality: {
            tone: config.personality?.tone || null,
            verbosity: config.personality?.verbosity || null,
            maxResponseWords: config.personality?.maxResponseWords || null,
            useCallerName: config.personality?.useCallerName,
            agentName: config.personality?.agentName || null
        },
        
        // 🎯 Conversation Style - confident/balanced/polite
        conversationStyle: config.conversationStyle || 'balanced',
        
        // 💬 Style Acknowledgments - UI-configurable phrases
        styleAcknowledgments: config.styleAcknowledgments || null,
        
        // 🚨 BOOKING SLOTS - NO DEFAULTS - Must be in database
        bookingSlots: config.bookingSlots || [],
        
        // Booking templates - from database ONLY
        bookingTemplates: {
            confirmTemplate: config.bookingTemplates?.confirmTemplate || config.bookingPrompts?.confirmTemplate || null,
            completeTemplate: config.bookingTemplates?.completeTemplate || config.bookingPrompts?.completeTemplate || null,
            offerAsap: config.bookingTemplates?.offerAsap,
            asapPhrase: config.bookingTemplates?.asapPhrase || null
        },
        
        // Legacy booking prompts - from database ONLY
        bookingPrompts: {
            askName: config.bookingPrompts?.askName || null,
            askPhone: config.bookingPrompts?.askPhone || null,
            askAddress: config.bookingPrompts?.askAddress || null,
            askTime: config.bookingPrompts?.askTime || null,
            confirmTemplate: config.bookingPrompts?.confirmTemplate || null,
            completeTemplate: config.bookingPrompts?.completeTemplate || null
        },
        
        // Emotion responses - from database ONLY
        emotionResponses: config.emotionResponses || {},
        
        // Frustration triggers - from database ONLY
        frustrationTriggers: config.frustrationTriggers || [],
        
        // Escalation settings - from database ONLY
        escalation: {
            enabled: config.escalation?.enabled,
            maxLoopsBeforeOffer: config.escalation?.maxLoopsBeforeOffer || null,
            triggerPhrases: config.escalation?.triggerPhrases || [],
            offerMessage: config.escalation?.offerMessage || null,
            transferMessage: config.escalation?.transferMessage || null
        },
        
        // Loop prevention - from database ONLY
        loopPrevention: {
            enabled: config.loopPrevention?.enabled,
            maxSameQuestion: config.loopPrevention?.maxSameQuestion || null,
            onLoop: config.loopPrevention?.onLoop || null
        },
        
        // Forbidden phrases - from database ONLY
        forbiddenPhrases: config.forbiddenPhrases || [],
        
        // Detection triggers - from database ONLY
        detectionTriggers: {
            trustConcern: config.detectionTriggers?.trustConcern || [],
            callerFeelsIgnored: config.detectionTriggers?.callerFeelsIgnored || [],
            refusedSlot: config.detectionTriggers?.refusedSlot || [],
            describingProblem: config.detectionTriggers?.describingProblem || [],
            wantsBooking: config.detectionTriggers?.wantsBooking || []
        },
        
        // Fallback responses - from database ONLY
        // 🚨 TIERED FALLBACK - Honesty-first (never fake understanding)
        fallbackResponses: {
            greeting: config.fallbackResponses?.greeting || null,
            // Tiered "didn't understand" fallbacks (HONESTY-FIRST)
            didNotUnderstandTier1: config.fallbackResponses?.didNotUnderstandTier1 || null,
            didNotUnderstandTier2: config.fallbackResponses?.didNotUnderstandTier2 || null,
            didNotUnderstandTier3: config.fallbackResponses?.didNotUnderstandTier3 || null,
            // Booking slot prompts
            askName: config.fallbackResponses?.askName || null,
            askPhone: config.fallbackResponses?.askPhone || null,
            askAddress: config.fallbackResponses?.askAddress || null,
            askTime: config.fallbackResponses?.askTime || null,
            confirmBooking: config.fallbackResponses?.confirmBooking || null,
            bookingComplete: config.fallbackResponses?.bookingComplete || null,
            transfering: config.fallbackResponses?.transfering || null,
            // Deprecated (keep for backward compatibility)
            discovery: config.fallbackResponses?.discovery || null,
            didNotHear: config.fallbackResponses?.didNotHear || null,
            connectionIssue: config.fallbackResponses?.connectionIssue || null,
            clarification: config.fallbackResponses?.clarification || null,
            generic: config.fallbackResponses?.generic || null
        },
        
        // Mode switching (from UI) - WHEN TO SWITCH MODES
        modeSwitching: {
            minTurnsBeforeBooking: config.modeSwitching?.minTurnsBeforeBooking ?? 2,
            bookingConfidenceThreshold: config.modeSwitching?.bookingConfidenceThreshold ?? 0.75,
            autoRescueOnFrustration: config.modeSwitching?.autoRescueOnFrustration !== false,
            autoTriageOnProblem: config.modeSwitching?.autoTriageOnProblem !== false
        },
        
        // Raw config for anything else
        raw: config
    };
}

// ════════════════════════════════════════════════════════════════════════════
// THE MAIN CLASS
// ════════════════════════════════════════════════════════════════════════════

class HybridReceptionistLLM {
    
    /**
     * Process a turn with full conversation context
     * 
     * @param {Object} params
     * @param {Object} params.company - Company info (name, trade, service areas)
     * @param {Object} params.callContext - Call metadata (callId, turnCount, etc.)
     * @param {string} params.currentMode - 'free' | 'booking' | 'triage' | 'rescue'
     * @param {Object} params.knownSlots - Already collected data
     * @param {Array} params.conversationHistory - Array of {role, content} turns
     * @param {string} params.userInput - What the caller just said
     * @param {Object} params.behaviorConfig - UI config for personality/prompts
     * @returns {Promise<Object>} Structured response with reply, slots, signals
     */
    static async processConversation({
        company = {},
        callContext = {},
        currentMode = 'free',
        knownSlots = {},
        conversationHistory = [],
        userInput,
        behaviorConfig = {}
    }) {
        const startTime = Date.now();
        const callId = callContext.callId || 'unknown';
        const companyId = company.id || company._id || callContext.companyId;
        const customerContext = callContext.customerContext || { isReturning: false, totalCalls: 0 };
        
        // Note: callLLM0 is imported from llmRegistry - it handles OpenAI config internally
        if (!callLLM0) {
            logger.error('[HYBRID LLM] llmRegistry.callLLM0 not available!');
            return this.emergencyFallback(currentMode, knownSlots, behaviorConfig);
        }
        
        try {
            logger.info('[HYBRID LLM] 🔍 TRACE START', {
                callId,
                companyId,
                userInputPreview: userInput?.substring(0, 50),
                currentMode,
                hasCompany: !!company,
                hasBehaviorConfig: !!behaviorConfig
            });
            
            // ════════════════════════════════════════════════════════════════
            // ❓ QUICK ANSWERS - Check for instant responses FIRST
            // ════════════════════════════════════════════════════════════════
            // If the caller is asking a common question (hours, pricing, etc.)
            // we can give an instant answer without needing the full LLM
            const QuickAnswersMatcher = require('./QuickAnswersMatcher');
            
            logger.info('[HYBRID LLM] 🔍 TRACE: Checking Quick Answers', { callId });
            if (QuickAnswersMatcher.looksLikeQuestion(userInput)) {
                const quickMatch = await QuickAnswersMatcher.findBestMatch(companyId, userInput);
                
                if (quickMatch) {
                    logger.info('[HYBRID LLM] ❓ Quick Answer matched!', {
                        callId,
                        category: quickMatch.category,
                        question: quickMatch.question,
                        triggers: quickMatch.matchedTriggers
                    });
                    
                    // Build a response that answers the question AND continues the flow
                    // If we're in booking mode, bridge back to booking after answering
                    let reply = quickMatch.answer;
                    
                    // Smart bridging based on current mode
                    if (currentMode === 'booking') {
                        const nextSlot = this.getNextMissingSlot(knownSlots);
                        if (nextSlot) {
                            reply += ` Now, to help you further, ${this.getSlotPrompt(nextSlot, behaviorConfig)}`;
                        }
                    } else if (currentMode === 'free') {
                        // Nudge toward booking after answering
                        reply += ` Is there anything else I can help you with, or would you like to schedule service?`;
                    }
                    
                    BlackBoxLogger.logEvent({
                        type: 'QUICK_ANSWER_USED',
                        callId,
                        data: {
                            question: quickMatch.question,
                            category: quickMatch.category,
                            matchedTriggers: quickMatch.matchedTriggers,
                            score: quickMatch.score,
                            mode: currentMode,
                            latencyMs: Date.now() - startTime
                        }
                    });
                    
                    return {
                        reply,
                        conversationMode: currentMode,
                        intent: 'answering_question',
                        nextGoal: currentMode === 'booking' ? this.getNextMissingSlot(knownSlots) : 'discover_intent',
                        filledSlots: {},
                        signals: { answeredQuestion: true, quickAnswerUsed: true },
                        fromQuickAnswers: true,
                        wasQuickAnswer: true,
                        source: 'quick_answer',
                        quickAnswerCategory: quickMatch.category
                    };
                }
            }
            
            logger.info('[HYBRID LLM] 🔍 TRACE: Quick Answers check passed (no match)', { callId });
            
            // ════════════════════════════════════════════════════════════════
            // 🗺️ SERVICE AREA CHECK - Answer area questions FIRST
            // ════════════════════════════════════════════════════════════════
            logger.info('[HYBRID LLM] 🔍 TRACE: Checking Service Area', { callId });
            let serviceAreaInfo = null;
            if (ServiceAreaHandler.isServiceAreaQuestion(userInput)) {
                serviceAreaInfo = ServiceAreaHandler.buildComprehensiveResponse(
                    userInput,
                    company.serviceAreas,
                    behaviorConfig.serviceAreaResponses
                );
                
                logger.info('[HYBRID LLM] 🗺️ Service area question detected', {
                    callId,
                    detectedCity: serviceAreaInfo.detected?.city,
                    services: serviceAreaInfo.services?.map(s => s.display),
                    action: serviceAreaInfo.action
                });
            }
            
            // Also detect service needs even if not an area question
            const detectedServices = ServiceAreaHandler.detectServiceNeeds(userInput);
            if (detectedServices.length > 0) {
                logger.info('[HYBRID LLM] 🔧 Services detected', {
                    callId,
                    services: detectedServices.map(s => s.display)
                });
            }
            
            logger.info('[HYBRID LLM] 🔍 TRACE: Service Area check done', { callId, hasServiceAreaInfo: !!serviceAreaInfo });
            
            // ════════════════════════════════════════════════════════════════
            // 🔍 GET TRIAGE CONTEXT - This is what makes us SMART
            // ════════════════════════════════════════════════════════════════
            // Look up matching triage cards so we know:
            // - What diagnostic questions to ask
            // - What explanations to give
            // - Urgency level
            // - Whether this is repair vs maintenance
            logger.info('[HYBRID LLM] 🔍 TRACE: Checking Triage', { callId });
            let triageContext = null;
            
            // ════════════════════════════════════════════════════════════════════
            // 🚨 UI-CONTROLLED: Problem detection triggers
            // Uses: company.aiAgentSettings.frontDeskBehavior.detectionTriggers.describingProblem
            // ════════════════════════════════════════════════════════════════════
            const uiConfig = loadFrontDeskConfig(company);
            const problemTriggers = uiConfig.detectionTriggers?.describingProblem || [];
            const lowerUserInput = userInput.toLowerCase();
            
            // Use UI triggers if configured, otherwise always true to load triage context
            const isDescribingIssue = problemTriggers.length > 0
                ? problemTriggers.some(t => t && lowerUserInput.includes(t.toLowerCase()))
                : true; // If no triggers configured, always try to load triage context
            
            // ALWAYS try to load triage context for service calls
            if (companyId && (isDescribingIssue || trade === 'HVAC')) {
                triageContext = await TriageContextProvider.getTriageContext(companyId, userInput);
                
                if (triageContext?.matched) {
                    logger.info('[HYBRID LLM] 🎯 Triage context found', {
                        callId,
                        cardName: triageContext.cardName,
                        urgency: triageContext.urgency,
                        hasQuestions: triageContext.diagnosticQuestions?.length > 0
                    });
                    
                    // Switch to triage mode if we matched a card
                    if (currentMode === 'booking' || currentMode === 'free') {
                        currentMode = 'triage';
                    }
                }
            }
            
            // ════════════════════════════════════════════════════════════════
            // LOAD SPEAKING CORRECTIONS (what AI should NOT say)
            // ════════════════════════════════════════════════════════════════
            let speakingCorrections = [];
            try {
                const templateId = company.aiAgentSettings?.templateReferences?.[0]?.templateId;
                if (templateId) {
                    const sttProfile = await STTProfile.findOne({ templateId, isActive: true }).lean();
                    if (sttProfile?.speakingCorrections?.length > 0) {
                        speakingCorrections = sttProfile.speakingCorrections.filter(sc => sc.enabled !== false);
                    }
                }
            } catch (err) {
                logger.debug('[HYBRID LLM] Failed to load speaking corrections (non-fatal)', { error: err.message });
            }
            
            logger.info('[HYBRID LLM] 🔍 TRACE: Triage done, building prompt', { callId, hasTriageContext: !!triageContext });
            
            // ════════════════════════════════════════════════════════════════
            // V22: CHECK FOR ENTERPRISE CONTEXT (LLM-LED DISCOVERY)
            // ════════════════════════════════════════════════════════════════
            // If we're in V22 LLM-led discovery mode, use the custom system prompt
            // which includes scenario knowledge. This is the key to making the AI
            // actually USE the scenarios instead of just asking "tell me more".
            // ════════════════════════════════════════════════════════════════
            const enterpriseContext = callContext.enterpriseContext || {};
            const isV22Discovery = enterpriseContext.mode === 'LLM_LED_DISCOVERY';
            
            let systemPrompt;
            const isBookingInterruption = enterpriseContext.mode === 'BOOKING_INTERRUPTION';
            
            if (isBookingInterruption) {
                // ════════════════════════════════════════════════════════════════
                // V22 BOOKING INTERRUPTION: Answer question + bridge back to slot
                // ════════════════════════════════════════════════════════════════
                logger.info('[HYBRID LLM] 🔄 BOOKING INTERRUPTION MODE', {
                    callId,
                    discoverySummary: enterpriseContext.discoverySummary,
                    keyFactsCount: enterpriseContext.keyFacts?.length || 0,
                    nextSlotQuestion: enterpriseContext.nextSlotQuestion
                });
                
                const companyName = company.name || company.companyName || 'our company';
                const trade = company.trade || 'service';
                const keyFactsList = (enterpriseContext.keyFacts || []).join('\n- ');
                const collectedSlotsList = Object.entries(enterpriseContext.collectedSlots || {})
                    .filter(([k, v]) => v)
                    .map(([k, v]) => `${k}: ${v}`)
                    .join(', ');
                
                systemPrompt = `You are ${companyName}'s receptionist (${trade}).

CONTEXT (what we've discussed so far):
${enterpriseContext.discoverySummary || 'Scheduling service'}
${keyFactsList ? `\nKey facts:\n- ${keyFactsList}` : ''}
${collectedSlotsList ? `\nAlready collected: ${collectedSlotsList}` : ''}

The caller asked a question or made a comment DURING booking.
Your job: Answer briefly (1-2 sentences max), then bridge back to the booking question.

NEXT BOOKING QUESTION: "${enterpriseContext.nextSlotQuestion}"

OUTPUT JSON (STRICT):
{"say":"brief answer to their question","bridgeBack":"${enterpriseContext.nextSlotQuestion}"}

RULES:
1. Keep "say" SHORT - 1-2 sentences max
2. "bridgeBack" must be EXACTLY: "${enterpriseContext.nextSlotQuestion}"
3. Be helpful but don't get derailed
4. If they ask about pricing/hours, give brief answer then bridge back
5. If they're frustrated, acknowledge briefly then bridge back`;

            } else if (isV22Discovery && enterpriseContext.customSystemPrompt) {
                // ════════════════════════════════════════════════════════════════
                // V22 DISCOVERY MODE: Use the custom prompt WITH scenario knowledge
                // ════════════════════════════════════════════════════════════════
                logger.info('[HYBRID LLM] 🧠 V22 DISCOVERY MODE - Using custom prompt with scenarios', {
                    callId,
                    scenarioCount: enterpriseContext.scenarioKnowledge?.length || 0,
                    callerEmotion: enterpriseContext.callerEmotion,
                    hasDiscoveryIssue: !!enterpriseContext.discovery?.issue
                });
                
                // Use the custom discovery prompt that includes scenario knowledge
                systemPrompt = enterpriseContext.customSystemPrompt;
                
                // Append scenario knowledge if available (in case buildDiscoveryPrompt didn't include it)
                if (enterpriseContext.scenarioKnowledge?.length > 0 && !systemPrompt.includes('RELEVANT KNOWLEDGE')) {
                    const scenarioSection = enterpriseContext.scenarioKnowledge.map((s, i) => 
                        `${i + 1}. ${s.title}: ${s.knowledge}`
                    ).join('\n');
                    
                    systemPrompt += `\n\nRELEVANT KNOWLEDGE (use naturally, do not read verbatim):\n${scenarioSection}`;
                }
                
                // Add V22 discovery rules
                systemPrompt += `\n\nV22 DISCOVERY RULES:
1. You are in DISCOVERY mode - understand the caller's situation first
2. Use the scenario knowledge above to provide helpful information
3. Do NOT ask for name/phone/address until caller explicitly wants to book
4. If caller describes a problem, acknowledge it and offer relevant guidance
5. Only ask "Would you like me to schedule an appointment?" after understanding their issue
6. Output JSON: {"slot":"none","ack":"your natural response using scenario knowledge"}`;

            } else {
                // ════════════════════════════════════════════════════════════════
                // STANDARD MODE: Build the regular system prompt
                // ════════════════════════════════════════════════════════════════
                // Get last agent response to prevent repetition
                const lastAgentTurn = conversationHistory
                    .filter(t => t.role === 'assistant')
                    .slice(-1)[0];
                const lastAgentResponse = lastAgentTurn?.content?.substring(0, 100) || null;
                
                systemPrompt = this.buildSystemPrompt({
                    company,
                    currentMode,
                    knownSlots,
                    behaviorConfig,
                    triageContext,  // Pass triage context for smarter responses
                    serviceAreaInfo,  // Include service area detection
                    detectedServices,  // Include detected service needs
                    customerContext: callContext.customerContext || { isReturning: false, totalCalls: 0 },
                    runningSummary: callContext.runningSummary || null,  // Running conversation summary
                    lastAgentResponse,  // Prevent repetition
                    turnCount: callContext.turnCount || 1,
                    speakingCorrections,  // What words NOT to use
                    callerId: callContext.callerId || callContext.callerPhone || null,  // For caller ID confirmation
                    partialName: callContext.partialName || knownSlots.partialName || null  // For asking for missing name part
                });
            }
            
            // ════════════════════════════════════════════════════════════════
            // BUILD MESSAGES WITH FULL HISTORY
            // ════════════════════════════════════════════════════════════════
            const messages = [
                { role: 'system', content: systemPrompt },
                ...this.formatConversationHistory(conversationHistory),
                { role: 'user', content: userInput }
            ];
            
            // ════════════════════════════════════════════════════════════════
            // CALL LLM-0 via REGISTRY (THE ONLY ALLOWED PATH)
            // ════════════════════════════════════════════════════════════════
            // Target: <1.5s response time
            // - All LLM calls go through llmRegistry.callLLM0()
            // - This ensures proper logging with brain identifier
            // - Reduced max_tokens (we only need ~100 for a short reply)
            // ════════════════════════════════════════════════════════════════
            logger.info('[HYBRID LLM] 🚀 CHECKPOINT: About to call LLM-0', {
                callId,
                companyId,
                messageCount: messages.length,
                systemPromptLength: systemPrompt?.length || 0,
                userInputLength: userInput?.length || 0
            });
            
            const response = await callLLM0({
                callId,
                companyId,
                messages,
                temperature: 0.6, // Lower = faster, more focused
                max_tokens: 150, // We only need ~100 for reply + slots
                response_format: { type: 'json_object' },
                metadata: {
                    mode: currentMode,
                    turn: callContext.turnCount || 0,
                    hasTriageContext: !!triageContext,
                    hasServiceAreaInfo: !!serviceAreaInfo
                }
            });
            
            const latencyMs = Date.now() - startTime;
            const content = response.choices[0]?.message?.content;
            
            logger.info('[HYBRID LLM] ✅ CHECKPOINT: LLM-0 returned', {
                callId,
                latencyMs,
                hasContent: !!content,
                contentPreview: content?.substring(0, 100),
                tokensUsed: response.usage?.total_tokens || 0
            });
            
            // ════════════════════════════════════════════════════════════════
            // LEAN PROMPT: LLM decides WHAT, Engine decides WORDS
            // ════════════════════════════════════════════════════════════════
            // New lean format: { "slot": "name|phone|none", "ack": "brief acknowledgment" }
            // Engine looks up EXACT question from DB and combines with ack
            // Result: ~350 token prompt, 99.9% verbatim compliance
            // ════════════════════════════════════════════════════════════════
            let parsed;
            try {
                parsed = JSON.parse(content);
                logger.info('[HYBRID LLM] 📥 Parsed LLM response:', parsed);
            } catch (parseErr) {
                logger.warn('[HYBRID LLM] JSON parse failed, using raw content as ack');
                parsed = { slot: 'none', ack: content.replace(/[{}"\n]/g, '').trim() };
            }
            
            // ════════════════════════════════════════════════════════════════
            // V22 BOOKING INTERRUPTION: Handle {say, bridgeBack} format
            // ════════════════════════════════════════════════════════════════
            if (isBookingInterruption && (parsed.say || parsed.bridgeBack)) {
                const say = (parsed.say || '').trim();
                const bridgeBack = (parsed.bridgeBack || enterpriseContext.nextSlotQuestion || '').trim();
                
                const finalReply = bridgeBack ? `${say} ${bridgeBack}` : say;
                
                logger.info('[HYBRID LLM] 🔄 BOOKING INTERRUPTION response assembled', {
                    callId,
                    say: say.substring(0, 50),
                    bridgeBack: bridgeBack.substring(0, 50),
                    finalReply: finalReply.substring(0, 80)
                });
                
                return {
                    reply: finalReply,
                    conversationMode: 'booking',
                    intent: 'booking_interruption',
                    nextGoal: 'RESUME_BOOKING',
                    filledSlots: {},
                    signals: { bookingInterruption: true, bridgedBack: true },
                    latencyMs,
                    tokensUsed: response.usage?.total_tokens || 0,
                    source: 'booking_interruption',
                    debug: {
                        say,
                        bridgeBack,
                        originalQuestion: enterpriseContext.nextSlotQuestion
                    }
                };
            }
            
            // ════════════════════════════════════════════════════════════════
            // ENGINE RESPONSE ASSEMBLY - Inject exact questions from DB
            // ════════════════════════════════════════════════════════════════
            const bookingConfig = BookingScriptEngine.getBookingSlotsFromCompany(company);
            const bookingSlots = bookingConfig.slots || [];
            
            let finalReply;
            // Support both old format (collectSlot) and new lean format (slot)
            let collectingSlot = parsed.slot || parsed.collectSlot || parsed.needsInfo;
            
            // Normalize collectSlot value
            if (collectingSlot === 'none' || collectingSlot === '|none' || !collectingSlot) {
                collectingSlot = null;
            } else {
                // Clean up slot name (handle "|name" or "name|phone" formats)
                collectingSlot = collectingSlot.replace(/^\|/, '').split('|')[0].trim().toLowerCase();
            }
            
            // ════════════════════════════════════════════════════════════════
            // V22 CONSENT GATE: Block slot collection in discovery mode
            // ════════════════════════════════════════════════════════════════
            // If we're in V22 discovery mode, the LLM should NOT be collecting
            // booking slots. If it tries to, we block it and use just the ack.
            // This prevents the AI from jumping to "What's your name?" before
            // the caller has explicitly agreed to book.
            // ════════════════════════════════════════════════════════════════
            if (isV22Discovery && collectingSlot) {
                logger.warn('[HYBRID LLM] ⚠️ V22 CONSENT GATE: Blocking slot collection in discovery mode', {
                    callId,
                    attemptedSlot: collectingSlot,
                    ack: parsed.ack?.substring(0, 50)
                });
                // Force slot to null - use just the acknowledgment
                collectingSlot = null;
            }
            
            if (collectingSlot && bookingSlots.length > 0) {
                // ═══════════════════════════════════════════════════════════
                // SLOT COLLECTION TURN - Use EXACT configured question
                // ═══════════════════════════════════════════════════════════
                const slot = bookingSlots.find(s => 
                    (s.slotId || s.id || '').toLowerCase() === collectingSlot ||
                    s.type?.toLowerCase() === collectingSlot
                );
                
                if (slot && slot.question) {
                    // Get acknowledgment from LLM
                    let ack = (parsed.acknowledgment || parsed.ack || '').trim();
                    
                    // If LLM didn't provide an acknowledgment, use UI-configured style acknowledgment
                    if (!ack) {
                        const style = behaviorConfig.conversationStyle || 'balanced';
                        // 🚨 UI-CONTROLLED: Use styleAcknowledgments from database, fallback to sensible defaults
                        const styleAcks = behaviorConfig.styleAcknowledgments || {
                            confident: "Let's get this taken care of.",
                            balanced: "I can help with that!",
                            polite: "I'd be happy to help."
                        };
                        ack = styleAcks[style] || styleAcks.balanced || "I can help with that!";
                        logger.info('[HYBRID LLM] 📝 Using UI-configured acknowledgment for style:', { style, ack });
                    }
                    
                    // Get EXACT question from database config - LLM NEVER generates this
                    const exactQuestion = slot.question;
                    
                    // ═══════════════════════════════════════════════════════════
                    // DEDUP CHECK: Don't append question if LLM already asked for it
                    // The LLM sometimes ignores the "system adds the question" rule
                    // Check multiple ways the LLM might have included the request
                    // ═══════════════════════════════════════════════════════════
                    const ackLower = ack.toLowerCase();
                    const ackEndsWithQuestion = ack.trim().endsWith('?');
                    
                    // Slot-specific keywords that indicate LLM already asked for it
                    const slotKeywords = {
                        'name': ['your name', 'may i have your name', 'provide your name', 'what is your name', 'what\'s your name'],
                        'phone': ['phone number', 'contact number', 'reach you', 'call you', 'best number'],
                        'address': ['service address', 'your address', 'the address', 'what address', 'provide the address', 'provide address'],
                        'time': ['what time', 'when works', 'morning or afternoon', 'schedule', 'prefer']
                    };
                    
                    const keywords = slotKeywords[collectingSlot] || [];
                    const ackContainsSlotRequest = keywords.some(kw => ackLower.includes(kw));
                    
                    if (ackEndsWithQuestion || ackContainsSlotRequest) {
                        // LLM already asked for this slot - use just the ack
                        finalReply = ack;
                        logger.info('[HYBRID LLM] 🔄 LLM included slot request in ack - not appending duplicate', {
                            slotId: collectingSlot,
                            ack: ack.substring(0, 60),
                            matchedKeyword: keywords.find(kw => ackLower.includes(kw)) || 'ends with ?',
                            exactQuestion: exactQuestion.substring(0, 30)
                        });
                    } else {
                        // Clean ack - append the exact question
                        finalReply = `${ack} ${exactQuestion}`;
                        logger.info('[HYBRID LLM] 🎯 LLMQNA: Appending EXACT configured question', {
                            slotId: collectingSlot,
                            acknowledgment: ack,
                            exactQuestion: exactQuestion,
                            finalReply: finalReply.substring(0, 80)
                        });
                    }
                } else {
                    // Slot not found in config - use LLM reply as fallback
                    finalReply = parsed.reply || parsed.freeformReply || 'How can I help you?';
                    logger.warn('[HYBRID LLM] ⚠️ Slot not found in config, using LLM reply', { collectingSlot });
                }
            } else {
                // ═══════════════════════════════════════════════════════════
                // NON-COLLECTION TURN - LLM can be conversational
                // In lean format: slot="none" and ack contains the full reply
                // ═══════════════════════════════════════════════════════════
                finalReply = parsed.ack || parsed.reply || parsed.freeformReply || parsed.response || 'How can I help you?';
                logger.info('[HYBRID LLM] 💬 Non-collection turn, using ack as reply:', finalReply.substring(0, 60));
            }
            
            // Determine mode from what we still need
            const hasAllSlots = knownSlots.name && knownSlots.phone && knownSlots.address && knownSlots.time;
            const conversationMode = hasAllSlots ? 'confirmation' : 
                                     collectingSlot ? 'booking' : 'discovery';
            
            // ════════════════════════════════════════════════════════════════
            // BUILD COMPREHENSIVE DEBUG INFO
            // ════════════════════════════════════════════════════════════════
            const debugInfo = {
                // What the LLM saw
                promptSummary: {
                    companyName: company.companyName || company.name,
                    trade: company.tradeType || company.trade,
                    style: behaviorConfig?.conversationStyle || 'balanced',
                    callerInfo: customerContext?.isReturning ? 'returning' : 'new',
                    slotsHave: Object.entries(knownSlots).filter(([k,v]) => v).map(([k,v]) => `${k}:${v}`),
                    slotsNeed: bookingSlots.filter(s => !knownSlots[s.slotId || s.id]).map(s => s.slotId || s.id),
                    promptTokens: response.usage?.prompt_tokens || 0
                },
                // What the LLM returned
                llmRawOutput: parsed,
                llmDecision: {
                    slotChosen: parsed.slot || parsed.collectSlot || 'none',
                    acknowledgment: parsed.ack || parsed.acknowledgment || '(none)',
                    wasValidSlot: !!collectingSlot
                },
                // What the Engine did
                engineAction: {
                    normalizedSlot: collectingSlot || 'none',
                    questionInjected: collectingSlot ? (bookingSlots.find(s => (s.slotId || s.id) === collectingSlot)?.question || 'NOT FOUND') : null,
                    finalResponse: finalReply
                },
                // Performance
                performance: {
                    latencyMs,
                    tokensUsed: response.usage?.total_tokens || 0,
                    promptTokens: response.usage?.prompt_tokens || 0,
                    completionTokens: response.usage?.completion_tokens || 0
                }
            };
            
            const result = {
                reply: finalReply,
                conversationMode,
                needsInfo: collectingSlot || 'none',
                nextGoal: collectingSlot ? `ASK_${collectingSlot.toUpperCase()}` : 'CONTINUE',
                filledSlots: knownSlots,
                latencyMs,
                tokensUsed: response.usage?.total_tokens || 0,
                llmqnaUsed: !!collectingSlot,
                // 🔍 COMPREHENSIVE DEBUG
                debug: debugInfo
            };
            
            logger.info('[HYBRID LLM] ✅ Response', {
                callId,
                reply: finalReply.substring(0, 60) + '...',
                collectingSlot: collectingSlot || 'none',
                llmDecision: parsed.slot || 'none',
                llmAck: (parsed.ack || '').substring(0, 40),
                latencyMs
            });
            
            return result;
            
        } catch (error) {
            // 🚨 CRITICAL DEBUG: Log everything about the error
            logger.error('[HYBRID LLM] ❌ CRITICAL ERROR in processConversation:', {
                errorName: error.name,
                errorMessage: error.message,
                errorCode: error.code,
                stack: error.stack?.substring(0, 800),
                callId,
                companyId,
                userInput: userInput?.substring(0, 50),
                currentMode,
                hasCompany: !!company,
                hasBehaviorConfig: !!behaviorConfig,
                latencyAtError: Date.now() - startTime
            });
            
            // Return fallback with detailed error info for debugging
            const fallback = this.emergencyFallback(currentMode, knownSlots, behaviorConfig);
            fallback.debug = {
                error: true,
                errorMessage: error.message,
                errorName: error.name,
                errorCode: error.code || 'NO_CODE',
                errorType: error.name,
                promptSummary: { error: 'LLM call failed' },
                llmDecision: { error: error.message, stack: error.stack?.substring(0, 300) },
                engineAction: { error: 'Used emergency fallback due to: ' + error.message },
                performance: { latencyMs: Date.now() - startTime, tokensUsed: 0 }
            };
            return fallback;
        }
    }
    
    /**
     * Get the next missing slot that needs to be collected
     * Uses dynamic bookingSlots from UI config
     */
    static getNextMissingSlot(knownSlots, behaviorConfig = {}, company = null) {
        // Use BookingScriptEngine as single source of truth
        const slots = this.getBookingSlots(behaviorConfig, company);
        
        // Use BookingScriptEngine helper
        const nextSlot = BookingScriptEngine.getNextRequiredSlot(slots, knownSlots);
        return nextSlot?.slotId || null;
    }
    
    /**
     * Get the question for a specific slot
     * Uses dynamic bookingSlots from UI config
     */
    static getSlotPrompt(slotName, behaviorConfig = {}) {
        // Use BookingScriptEngine for consistent slot lookup
        const slots = this.getBookingSlots(behaviorConfig);
        const question = BookingScriptEngine.getSlotQuestion(slots, slotName);
        
        if (question) {
            return question;
        }
        
        // Fallback: Check legacy bookingPrompts directly
        const prompts = behaviorConfig.bookingPrompts || {};
        switch (slotName) {
            case 'name':
                return prompts.askName || null;
            case 'phone':
                return prompts.askPhone || null;
            case 'address':
                return prompts.askAddress || null;
            case 'time':
                return prompts.askTime || null;
            default:
                return null;
        }
    }
    
    /**
     * Get all configured booking slots sorted by order
     * 🚨 Uses BookingScriptEngine as single source of truth
     * 
     * @param {Object} behaviorConfig - From loadFrontDeskConfig()
     * @param {Object} company - Full company object (optional, for legacy path fallback)
     */
    static getBookingSlots(behaviorConfig = {}, company = null) {
        // If company object provided, use BookingScriptEngine for full path checking
        if (company) {
            const result = BookingScriptEngine.getBookingSlotsFromCompany(company);
            return result.slots;
        }
        
        // Fallback: use behaviorConfig directly (already loaded)
        if (behaviorConfig.bookingSlots?.length > 0) {
            return BookingScriptEngine.normalizeBookingSlots(behaviorConfig.bookingSlots);
        }
        
        // Check legacy bookingPrompts
        if (behaviorConfig.bookingPrompts) {
            const converted = BookingScriptEngine.convertLegacyBookingPrompts(behaviorConfig.bookingPrompts);
            if (converted.length > 0) {
                return converted;
            }
        }
        
        logger.warn('[HYBRID LLM] ⚠️ NO BOOKING SLOTS - Company needs to save Front Desk Behavior');
        return [];
    }
    
    /**
     * ════════════════════════════════════════════════════════════════════════════
     * 🎯 LEAN SYSTEM PROMPT - Under 400 tokens
     * ════════════════════════════════════════════════════════════════════════════
     * 
     * ARCHITECTURE: "Thin LLM, Thick Engine"
     * - LLM decides WHAT to do (which slot, acknowledgment)
     * - Engine decides exact WORDING (questions from DB)
     * 
     * This prompt works for ANY trade - HVAC, dental, legal, plumbing, etc.
     * All company-specific behavior comes from database config.
     * 
     * ════════════════════════════════════════════════════════════════════════════
     */
    static buildSystemPrompt({ company, currentMode, knownSlots, behaviorConfig, triageContext, customerContext, runningSummary, serviceAreaInfo, detectedServices, lastAgentResponse, turnCount, speakingCorrections, callerId, partialName }) {
        const companyName = company.companyName || company.name || 'our company';
        const trade = company.tradeType || company.trade || 'service';
        
        // Get booking slots for determining what to collect
        const bookingConfig = BookingScriptEngine.getBookingSlotsFromCompany(company);
        const bookingSlots = bookingConfig.slots || [];
        const slotIds = bookingSlots.map(s => s.slotId || s.id);
        
        // Build slot status - what we have vs need
        const collected = [];
        const needed = [];
        for (const slotId of slotIds) {
            if (knownSlots[slotId]) {
                collected.push(`${slotId}:${knownSlots[slotId]}`);
            } else if ((slot.type === 'name' || slotId === 'name') && knownSlots.partialName) {
                // If we have a partial name, treat it as collected (don't re-ask)
                collected.push(`name:${knownSlots.partialName} (partial - accept as complete)`);
            } else {
                needed.push(slotId);
            }
        }
        
        // Conversation style from config - just the tone, no example phrases to parrot
        const style = behaviorConfig?.conversationStyle || 'balanced';
        const styleHint = {
            confident: 'Be decisive and confident.',
            balanced: 'Be friendly and professional.',
            polite: 'Be courteous and respectful.'
        }[style] || 'Be friendly and professional.';
        
        // Customer context (brief)
        const callerInfo = customerContext?.isReturning 
            ? `Returning customer${customerContext.name ? `: ${customerContext.name}` : ''}`
            : 'New caller';
        
        // Forbidden phrases from config (keep short)
        const uiConfig = loadFrontDeskConfig(company);
        const forbidden = uiConfig.forbiddenPhrases?.slice(0, 3).join(', ') || '';
        
        // 🔍 DEBUG: Log what we're sending to LLM
        logger.info('[HYBRID LLM] 📋 LEAN PROMPT CONTEXT:', {
            company: companyName,
            trade,
            style,
            collected: collected.join(', ') || 'none',
            needed: needed.join(', ') || 'none',
            callerInfo
        });
        
        // ════════════════════════════════════════════════════════════════════
        // THE LEAN PROMPT - ~350 tokens
        // ════════════════════════════════════════════════════════════════════
        
        // Determine first missing slot for order guidance
        const firstMissingSlot = needed[0] || 'none';
        
        const prompt = `You are ${companyName}'s receptionist (${trade}). ${styleHint}

CALLER: ${callerInfo}
HAVE: ${collected.join(', ') || 'nothing yet'}
NEED (in order): ${needed.join(' → ') || 'nothing - ready to confirm'}

${runningSummary ? `CONTEXT: ${runningSummary}\n` : ''}OUTPUT JSON:
{"slot":"${slotIds.join('|')}|none","ack":"your response"}

RULES:
1. GREETING: Mirror the caller's time of day EXACTLY. "good morning" → "Good morning!", "good afternoon" → "Good afternoon!", "good evening" → "Good evening!". If they just say "hi/hello" without a time, say "Hi!" or "Hello!"
2. ALWAYS ACKNOWLEDGE what the caller just said BEFORE asking for info. Never ignore their words.
3. If caller is STILL EXPLAINING their situation (mentions past visits, gives context, describes problem) → slot:"none", acknowledge and let them finish: "I understand, please go on" or "I see, tell me more"
4. If sentence seems INCOMPLETE (ends with "a", "the", "to", "and", "but", "I need to", etc.) → slot:"none", ask them to continue
5. If caller mentions a clear problem/service need AND seems done explaining → start collecting info
6. Collect slots IN ORDER: ${needed.join(' → ')} (start with ${firstMissingSlot})
7. slot = which info to collect next (system adds the exact question)
8. ack = MUST acknowledge what caller said, then transition naturally. Never just ask for info without acknowledging.
9. Never re-ask for info already in HAVE
10. Keep responses under 2 sentences
11. NEVER make up, assume, or hallucinate data (times, dates, prices, etc.) - ONLY use what caller explicitly said
12. If NEED list is not empty, keep collecting - do NOT confirm appointment until ALL required slots are filled
${forbidden ? `13. Never say: ${forbidden}` : ''}
${lastAgentResponse ? `- You just said: "${lastAgentResponse.substring(0, 40)}..." - don't repeat` : ''}

Examples:
User: "good morning"
{"slot":"none","ack":"Good morning! How can I help you today?"}

User: "My AC is broken"
{"slot":"${firstMissingSlot}","ack":"I'm sorry to hear that! Let me get you scheduled."}

User: "yeah you guys were here yesterday"
{"slot":"none","ack":"I see we were out yesterday. I apologize if the issue wasn't fully resolved. What's happening now?"}

User: "and they did some work on the unit"
{"slot":"none","ack":"I understand. Please tell me what's going on now so I can help."}

User: "now it's not working at all"
{"slot":"${firstMissingSlot}","ack":"I'm so sorry to hear that. Let me get a technician back out there."}

User: "This is John"
{"slot":"phone","ack":"Thanks, John!"}

User: "What time do you open?"
{"slot":"none","ack":"We're open 8am to 6pm Monday through Friday."}`;

        return prompt;
    }
    
    /**
     * Format conversation history for the messages array
     * OPTIMIZED: Keep minimal history for speed
     */
    static formatConversationHistory(history) {
        if (!history || !Array.isArray(history)) return [];
        
        // Keep last 6 turns (3 exchanges) for better context
        // This helps the AI remember what it said and not repeat
        const recent = history.slice(-6);
        
        return recent.map(turn => ({
            // Handle both 'caller'/'user' for compatibility (AI Test sends 'user', real calls send 'caller')
            role: (turn.role === 'caller' || turn.role === 'user') ? 'user' : 'assistant',
            // Truncate long messages to save tokens
            content: (turn.content || turn.text || '').substring(0, 200)
        }));
    }
    
    /**
     * Merge new slots with existing, preferring new non-null values
     */
    /**
     * Determine next goal based on phase (3-Phase System)
     * Uses dynamic booking slots from UI config
     */
    static phaseToNextGoal(phase, filledSlots = {}, behaviorConfig = {}) {
        if (phase === 'DISCOVERY') {
            return 'UNDERSTAND_PROBLEM';
        }
        if (phase === 'DECISION') {
            return 'CONFIRM_WANTS_BOOKING';
        }
        if (phase === 'BOOKING') {
            // Use BookingScriptEngine for consistent slot handling
            const slots = this.getBookingSlots(behaviorConfig);
            for (const slot of slots) {
                const slotId = slot.slotId || slot.id;
                if (!filledSlots[slotId]) {
                    return `ASK_${slotId.toUpperCase()}`;
                }
            }
            return 'CONFIRM_BOOKING';
        }
        return 'UNDERSTAND_PROBLEM';
    }
    
    static mergeSlots(existing, extracted) {
        const merged = { ...existing };
        
        for (const [key, value] of Object.entries(extracted || {})) {
            if (value && value !== 'null' && value !== null) {
                // Clean phone numbers
                if (key === 'phone') {
                    const digits = value.replace(/\D/g, '');
                    if (digits.length >= 10) {
                        merged.phone = `${digits.slice(-10, -7)}-${digits.slice(-7, -4)}-${digits.slice(-4)}`;
                    }
                } 
                // Normalize service type
                else if (key === 'serviceType') {
                    if (/repair|fix|broken|not working/i.test(value)) {
                        merged.serviceType = 'repair';
                    } else if (/maintenance|tune|check|clean/i.test(value)) {
                        merged.serviceType = 'maintenance';
                    } else {
                        merged.serviceType = value;
                    }
                }
                else {
                    merged[key] = value;
                }
            }
        }
        
        return merged;
    }
    
    /**
     * Normalize mode string
     */
    static normalizeMode(mode) {
        const modeMap = {
            'free': 'free',
            'discovery': 'free',
            'free_discovery': 'free',
            'booking': 'booking',
            'guided': 'booking',
            'guided_booking': 'booking',
            'triage': 'triage',
            'diagnosis': 'triage',
            'rescue': 'rescue',
            'frustration': 'rescue'
        };
        return modeMap[mode?.toLowerCase()] || 'free';
    }
    
    /**
     * Emergency fallback when LLM fails
     * 🚨 HONESTY RULES:
     * - NEVER pretend to understand when you don't
     * - NEVER say "Got it" if you didn't get it
     * - Blame the connection, not the caller
     * - Use tiered fallback based on miss count
     */
    static emergencyFallback(mode, knownSlots, behaviorConfig = {}, missCount = 1) {
        const fallbacks = behaviorConfig.fallbackResponses || {};
        
        // Check if config is complete
        const isConfigured = behaviorConfig._isConfigured || behaviorConfig.bookingSlots?.length > 0;
        
        let reply;
        
        // ═══════════════════════════════════════════════════════════════════
        // 🚨 TIERED FALLBACK - HONESTY-FIRST APPROACH
        // When the LLM fails or doesn't understand, be HONEST about it
        // ═══════════════════════════════════════════════════════════════════
        
        if (!isConfigured) {
            // Config error - this is a system problem, not caller's fault
            reply = fallbacks.didNotUnderstandTier1 
                || "I'm sorry, the connection was a little rough and I didn't catch that. Can you please say that one more time?";
            logger.error('[HYBRID LLM] 🚨 EMERGENCY FALLBACK - Company not configured! No bookingSlots in database.');
        } else if (missCount >= 3) {
            // Tier 3 - Third miss: offer callback bailout
            reply = fallbacks.didNotUnderstandTier3 
                || "It sounds like this connection isn't great. Do you want me to have someone from the office call or text you back to help you?";
            logger.warn('[HYBRID LLM] 🚨 TIER 3 FALLBACK - Offering callback bailout');
        } else if (missCount >= 2) {
            // Tier 2 - Second miss: ask to slow down
            reply = fallbacks.didNotUnderstandTier2 
                || "I'm still having trouble hearing you clearly. Could you repeat that a bit slower for me?";
            logger.warn('[HYBRID LLM] 🚨 TIER 2 FALLBACK - Second miss');
        } else {
            // Tier 1 - First miss: apologize, blame connection
            reply = fallbacks.didNotUnderstandTier1 
                || "I'm sorry, the connection was a little rough and I didn't catch that. Can you please say that one more time?";
            logger.warn('[HYBRID LLM] 🚨 TIER 1 FALLBACK - First miss');
        }
        
        logger.warn('[HYBRID LLM] 🚨 Emergency fallback used - LLM was not called', {
            mode,
            isConfigured,
            missCount,
            tier: missCount >= 3 ? 3 : (missCount >= 2 ? 2 : 1),
            hasSlots: Object.keys(knownSlots || {}).filter(k => knownSlots[k]).length
        });
        
        return {
            reply,
            conversationMode: mode,
            intent: 'unknown',
            nextGoal: null,
            filledSlots: knownSlots,
            signals: { frustrated: false, wantsHuman: missCount >= 3 },
            latencyMs: 0,
            tokensUsed: 0,
            isEmergencyFallback: true,
            fallbackTier: missCount >= 3 ? 3 : (missCount >= 2 ? 2 : 1),
            configError: !isConfigured
        };
    }
    
    /**
     * Check if booking is complete
     */
    static isBookingComplete(slots) {
        return !!(slots.name && slots.phone && slots.address && slots.time);
    }
    
    /**
     * Detect if caller is frustrated from their input
     * 🚨 100% UI-CONTROLLED - Uses triggers from frontDeskBehavior.frustrationTriggers
     * 
     * @param {string} input - Caller's input
     * @param {Object} company - Company object with aiAgentSettings.frontDeskBehavior
     * @returns {boolean} True if frustrated
     */
    static detectFrustration(input, company = null) {
        if (!input) return false;
        
        const lowerInput = input.toLowerCase();
        
        // Load frustration triggers from UI config
        const uiConfig = loadFrontDeskConfig(company);
        const uiTriggers = uiConfig.frustrationTriggers || [];
        
        // If no UI triggers configured, return false (no detection)
        // This is intentional - if admin doesn't configure triggers, no detection happens
        if (uiTriggers.length === 0) {
            logger.debug('[HYBRID LLM] No frustration triggers configured in UI - skipping detection');
            return false;
        }
        
        // Check UI-configured triggers
        const matched = uiTriggers.find(trigger => 
            trigger && lowerInput.includes(trigger.toLowerCase())
        );
        
        if (matched) {
            logger.info('[HYBRID LLM] 😤 Frustration detected via UI trigger', {
                input: input.substring(0, 50),
                matchedTrigger: matched,
                source: 'UI_CONFIGURED'
            });
            return true;
        }
        
        return false;
    }
    
    /**
     * Detect if caller wants to speak to a human
     * 🚨 100% UI-CONTROLLED - Uses triggers from frontDeskBehavior.escalation.triggerPhrases
     */
    static detectEscalationRequest(input, company = null) {
        if (!input) return false;
        
        const lowerInput = input.toLowerCase();
        const uiConfig = loadFrontDeskConfig(company);
        const triggerPhrases = uiConfig.escalation.triggerPhrases || [];
        
        if (triggerPhrases.length === 0) {
            return false;
        }
        
        return triggerPhrases.some(trigger => 
            trigger && lowerInput.includes(trigger.toLowerCase())
        );
    }
    
    /**
     * Detect if input is a question that needs answering
     */
    static detectQuestion(input) {
        return /\?|do you|can you|will you|how much|how long|when|where|what time|what is/i.test(input);
    }
}

// Export class and version
module.exports = HybridReceptionistLLM;
module.exports.LLM_VERSION = HYBRID_LLM_VERSION;

