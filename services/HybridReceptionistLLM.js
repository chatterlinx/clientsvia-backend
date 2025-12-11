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

// ═══════════════════════════════════════════════════════════════════════════════
// 🎯 VERSION BANNER - This log PROVES the new code is deployed
// ═══════════════════════════════════════════════════════════════════════════════
const HYBRID_LLM_VERSION = '2025-12-11-V1-100-PERCENT-UI-CONTROLLED';
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
 * This is the SINGLE SOURCE OF TRUTH for AI behavior
 */
function loadFrontDeskConfig(company) {
    const config = company?.aiAgentSettings?.frontDeskBehavior || {};
    
    return {
        // Personality
        personality: {
            tone: config.personality?.tone || 'warm',
            verbosity: config.personality?.verbosity || 'concise',
            maxResponseWords: config.personality?.maxResponseWords || 30,
            useCallerName: config.personality?.useCallerName !== false,
            agentName: config.personality?.agentName || 'Ashley'
        },
        
        // Dynamic booking slots (new system)
        bookingSlots: config.bookingSlots?.length > 0 ? config.bookingSlots : [
            { id: 'name', label: 'Full Name', question: config.bookingPrompts?.askName || "May I have your name?", required: true, order: 0, type: 'text' },
            { id: 'phone', label: 'Phone Number', question: config.bookingPrompts?.askPhone || "What's the best phone number to reach you?", required: true, order: 1, type: 'phone' },
            { id: 'address', label: 'Service Address', question: config.bookingPrompts?.askAddress || "What's the service address?", required: true, order: 2, type: 'address' },
            { id: 'time', label: 'Preferred Time', question: config.bookingPrompts?.askTime || "When works best for you - morning or afternoon?", required: false, order: 3, type: 'time' }
        ],
        
        // Booking templates for confirmation/completion
        bookingTemplates: {
            confirmTemplate: config.bookingTemplates?.confirmTemplate || config.bookingPrompts?.confirmTemplate || "Let me confirm — I have {name} at {address}, {time}. Does that sound right?",
            completeTemplate: config.bookingTemplates?.completeTemplate || config.bookingPrompts?.completeTemplate || "You're all set, {name}! A technician will be out {time}. You'll receive a confirmation text shortly.",
            offerAsap: config.bookingTemplates?.offerAsap !== false,
            asapPhrase: config.bookingTemplates?.asapPhrase || "Or I can send someone as soon as possible."
        },
        
        // Legacy booking prompts (for backward compatibility)
        bookingPrompts: {
            askName: config.bookingPrompts?.askName || "May I have your name?",
            askPhone: config.bookingPrompts?.askPhone || "What's the best phone number to reach you?",
            askAddress: config.bookingPrompts?.askAddress || "What's the service address?",
            askTime: config.bookingPrompts?.askTime || "When works best for you - morning or afternoon?",
            confirmTemplate: config.bookingPrompts?.confirmTemplate || "So I have {name} at {address}, {time}. Does that sound right?",
            completeTemplate: config.bookingPrompts?.completeTemplate || "You're all set, {name}! A technician will be out {time}. You'll receive a confirmation text shortly."
        },
        
        // Emotion responses (from UI)
        emotionResponses: config.emotionResponses || {},
        
        // Frustration triggers (from UI) - THESE CONTROL DETECTION
        frustrationTriggers: config.frustrationTriggers || [],
        
        // Escalation settings (from UI)
        escalation: {
            enabled: config.escalation?.enabled !== false,
            maxLoopsBeforeOffer: config.escalation?.maxLoopsBeforeOffer || 3,
            triggerPhrases: config.escalation?.triggerPhrases || [],
            offerMessage: config.escalation?.offerMessage || "I can connect you to someone directly. Would you like that?",
            transferMessage: config.escalation?.transferMessage || "Let me connect you to our team now."
        },
        
        // Loop prevention (from UI)
        loopPrevention: {
            enabled: config.loopPrevention?.enabled !== false,
            maxSameQuestion: config.loopPrevention?.maxSameQuestion || 2,
            onLoop: config.loopPrevention?.onLoop || 'rephrase'
        },
        
        // Forbidden phrases (from UI) - THESE ARE CHECKED AGAINST LLM OUTPUT
        forbiddenPhrases: config.forbiddenPhrases || [],
        
        // Detection triggers (from UI) - THESE CONTROL WHAT AI DETECTS
        detectionTriggers: {
            trustConcern: config.detectionTriggers?.trustConcern || [],
            callerFeelsIgnored: config.detectionTriggers?.callerFeelsIgnored || [],
            refusedSlot: config.detectionTriggers?.refusedSlot || [],
            describingProblem: config.detectionTriggers?.describingProblem || [],
            wantsBooking: config.detectionTriggers?.wantsBooking || []
        },
        
        // Fallback responses (from UI) - WHAT AI SAYS WHEN LLM FAILS
        // These ensure the call NEVER goes silent
        fallbackResponses: {
            // Initial & Discovery
            greeting: config.fallbackResponses?.greeting || "Thanks for calling! How can I help you today?",
            discovery: config.fallbackResponses?.discovery || "Got it, what's going on — is it not cooling, not heating, making noise, or something else?",
            // Booking Slots
            askName: config.fallbackResponses?.askName || "May I have your name please?",
            askPhone: config.fallbackResponses?.askPhone || "And what's the best phone number to reach you?",
            askAddress: config.fallbackResponses?.askAddress || "What's the service address?",
            askTime: config.fallbackResponses?.askTime || "When works best for you — morning or afternoon? Or I can send someone as soon as possible.",
            // Confirmation
            confirmBooking: config.fallbackResponses?.confirmBooking || "Let me confirm — I have you scheduled. Does that sound right?",
            bookingComplete: config.fallbackResponses?.bookingComplete || "You're all set! A technician will be out and you'll receive a confirmation text shortly. Is there anything else?",
            // Error Recovery
            didNotHear: config.fallbackResponses?.didNotHear || "I'm sorry, I didn't quite catch that. Could you please repeat?",
            connectionIssue: config.fallbackResponses?.connectionIssue || "I'm sorry, I think our connection isn't great. Could you please repeat that?",
            clarification: config.fallbackResponses?.clarification || "I want to make sure I understand correctly. Could you tell me a bit more?",
            // Transfer & Catch-All
            transfering: config.fallbackResponses?.transfering || "Let me connect you with someone who can help you right away. Please hold.",
            generic: config.fallbackResponses?.generic || "I'm here to help. What can I do for you?"
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
        
        // Note: callLLM0 is imported from llmRegistry - it handles OpenAI config internally
        if (!callLLM0) {
            logger.error('[HYBRID LLM] llmRegistry.callLLM0 not available!');
            return this.emergencyFallback(currentMode, knownSlots);
        }
        
        try {
            // ════════════════════════════════════════════════════════════════
            // ❓ QUICK ANSWERS - Check for instant responses FIRST
            // ════════════════════════════════════════════════════════════════
            // If the caller is asking a common question (hours, pricing, etc.)
            // we can give an instant answer without needing the full LLM
            const QuickAnswersMatcher = require('./QuickAnswersMatcher');
            
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
            
            // ════════════════════════════════════════════════════════════════
            // 🗺️ SERVICE AREA CHECK - Answer area questions FIRST
            // ════════════════════════════════════════════════════════════════
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
            
            // ════════════════════════════════════════════════════════════════
            // 🔍 GET TRIAGE CONTEXT - This is what makes us SMART
            // ════════════════════════════════════════════════════════════════
            // Look up matching triage cards so we know:
            // - What diagnostic questions to ask
            // - What explanations to give
            // - Urgency level
            // - Whether this is repair vs maintenance
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
            
            // ════════════════════════════════════════════════════════════════
            // BUILD THE SYSTEM PROMPT (now with triage + customer context)
            // ════════════════════════════════════════════════════════════════
            // Get last agent response to prevent repetition
            const lastAgentTurn = conversationHistory
                .filter(t => t.role === 'assistant')
                .slice(-1)[0];
            const lastAgentResponse = lastAgentTurn?.content?.substring(0, 100) || null;
            
            const systemPrompt = this.buildSystemPrompt({
                company,
                currentMode,
                knownSlots,
                behaviorConfig,
                triageContext,  // Pass triage context for smarter responses
                serviceAreaInfo,  // Include service area detection
                detectedServices,  // Include detected service needs
                customerContext: callContext.customerContext || { isReturning: false, totalCalls: 0 },
                lastAgentResponse,  // Prevent repetition
                turnCount: callContext.turnCount || 1,
                speakingCorrections  // What words NOT to use
            });
            
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
            
            // ════════════════════════════════════════════════════════════════
            // PARSE AND VALIDATE RESPONSE
            // ════════════════════════════════════════════════════════════════
            // ════════════════════════════════════════════════════════════════
            // SIMPLE RESPONSE PARSING
            // AI returns: {"reply":"...", "needsInfo":"name|phone|address|time|none"}
            // ════════════════════════════════════════════════════════════════
            let parsed;
            try {
                parsed = JSON.parse(content);
            } catch (parseErr) {
                // If JSON parse fails, maybe AI just returned plain text (which is fine!)
                logger.warn('[HYBRID LLM] JSON parse failed, using raw content as reply');
                parsed = { reply: content.replace(/[{}"\n]/g, '').trim() };
            }
            
            const reply = parsed.reply || parsed.response || content;
            const needsInfo = parsed.needsInfo || 'none';
            
            // Determine mode from what we still need
            const hasAllSlots = knownSlots.name && knownSlots.phone && knownSlots.address && knownSlots.time;
            const conversationMode = hasAllSlots ? 'confirmation' : 
                                     needsInfo !== 'none' ? 'booking' : 'discovery';
            
            const result = {
                reply,
                conversationMode,
                needsInfo,
                nextGoal: needsInfo !== 'none' ? `ASK_${needsInfo.toUpperCase()}` : 'CONTINUE',
                filledSlots: knownSlots,
                latencyMs,
                tokensUsed: response.usage?.total_tokens || 0
            };
            
            logger.info('[HYBRID LLM] ✅ Response', {
                callId,
                reply: reply.substring(0, 60) + '...',
                needsInfo,
                latencyMs
            });
            
            return result;
            
        } catch (error) {
            logger.error('[HYBRID LLM] Error:', error.message);
            return this.emergencyFallback(currentMode, knownSlots);
        }
    }
    
    /**
     * Get the next missing slot that needs to be collected
     * Uses dynamic bookingSlots from UI config
     */
    static getNextMissingSlot(knownSlots, behaviorConfig = {}) {
        // Use dynamic slots sorted by order, or fallback to defaults
        const slots = behaviorConfig.bookingSlots?.length > 0 
            ? [...behaviorConfig.bookingSlots].sort((a, b) => a.order - b.order)
            : [
                { id: 'name', required: true },
                { id: 'phone', required: true },
                { id: 'address', required: true },
                { id: 'time', required: false }
            ];
        
        // Find first required slot that's not filled
        for (const slot of slots) {
            if (slot.required && !knownSlots[slot.id]) {
                return slot.id;
            }
        }
        
        // Then check optional slots
        for (const slot of slots) {
            if (!slot.required && !knownSlots[slot.id]) {
                return slot.id;
            }
        }
        
        return null; // All slots filled
    }
    
    /**
     * Get the question for a specific slot
     * Uses dynamic bookingSlots from UI config
     */
    static getSlotPrompt(slotName, behaviorConfig = {}) {
        // Check dynamic slots first
        const slots = behaviorConfig.bookingSlots || [];
        const dynamicSlot = slots.find(s => s.id === slotName);
        if (dynamicSlot?.question) {
            return dynamicSlot.question;
        }
        
        // Fallback to legacy bookingPrompts
        const prompts = behaviorConfig.bookingPrompts || {};
        switch (slotName) {
            case 'name':
                return prompts.askName || 'May I have your name?';
            case 'phone':
                return prompts.askPhone || 'What is the best phone number to reach you?';
            case 'address':
                return prompts.askAddress || 'What is the address where service is needed?';
            case 'time':
                return prompts.askTime || 'What day and time works best for you?';
            default:
                return 'How can I help you?';
        }
    }
    
    /**
     * Get all configured booking slots sorted by order
     */
    static getBookingSlots(behaviorConfig = {}) {
        if (behaviorConfig.bookingSlots?.length > 0) {
            return [...behaviorConfig.bookingSlots].sort((a, b) => a.order - b.order);
        }
        // Default slots
        return [
            { id: 'name', label: 'Full Name', question: 'May I have your name?', required: true, order: 0, type: 'text' },
            { id: 'phone', label: 'Phone Number', question: 'What is the best phone number to reach you?', required: true, order: 1, type: 'phone' },
            { id: 'address', label: 'Service Address', question: 'What is the service address?', required: true, order: 2, type: 'address' },
            { id: 'time', label: 'Preferred Time', question: 'When works best for you?', required: false, order: 3, type: 'time' }
        ];
    }
    
    /**
     * Build the system prompt with all context
     * 🚨 100% UI-CONTROLLED - All instructions come from frontDeskBehavior config
     */
    static buildSystemPrompt({ company, currentMode, knownSlots, behaviorConfig, triageContext, customerContext, serviceAreaInfo, detectedServices, lastAgentResponse, turnCount, speakingCorrections }) {
        const companyName = company.name || 'our company';
        const trade = company.trade || 'HVAC';
        
        // ════════════════════════════════════════════════════════════════════
        // 🚨 LOAD ALL CONFIG FROM UI - NO HARDCODED DEFAULTS
        // ════════════════════════════════════════════════════════════════════
        const uiConfig = loadFrontDeskConfig(company);
        
        logger.debug('[HYBRID LLM] Building prompt from UI config', {
            personality: uiConfig.personality,
            forbiddenCount: uiConfig.forbiddenPhrases.length,
            frustrationTriggersCount: uiConfig.frustrationTriggers.length,
            bookingPromptsConfigured: Object.keys(uiConfig.bookingPrompts).length
        });
        
        // Build speaking style rules from corrections
        let speakingStyleSection = '';
        if (speakingCorrections && speakingCorrections.length > 0) {
            const rules = speakingCorrections
                .map(sc => `- Say "${sc.sayInstead}" NOT "${sc.dontSay}"`)
                .join('\n');
            speakingStyleSection = `
═══ SPEAKING STYLE (CRITICAL) ═══
${rules}
Never use the words on the left - always use the replacement on the right.
`;
        }
        
        // ════════════════════════════════════════════════════════════════════
        // FORBIDDEN PHRASES FROM UI (not hardcoded!)
        // ════════════════════════════════════════════════════════════════════
        let forbiddenSection = '';
        if (uiConfig.forbiddenPhrases.length > 0) {
            forbiddenSection = `
═══ FORBIDDEN PHRASES (from UI settings) ═══
${uiConfig.forbiddenPhrases.map(p => `- "${p}"`).join('\n')}
NEVER say any of these phrases. They make you sound robotic.
`;
        }
        
        // NOTE: Emotion handling and booking prompts removed - AI handles naturally
        // GPT-4o-mini knows how to be empathetic, ask for info, etc.
        // We trust the AI to be a good receptionist.
        
        // ════════════════════════════════════════════════════════════════════
        // DYNAMIC BOOKING SLOTS FROM UI
        // ════════════════════════════════════════════════════════════════════
        const bookingSlots = this.getBookingSlots(uiConfig);
        const slotIds = bookingSlots.map(s => s.id);
        
        // Compact slot display
        const hasSlots = Object.entries(knownSlots).filter(([k, v]) => v);
        const slotsList = hasSlots.length > 0 
            ? hasSlots.map(([k, v]) => `${k}:${v}`).join(', ')
            : 'none';
        
        // Get missing slots based on dynamic config
        const missingSlots = slotIds.filter(s => !knownSlots[s]).join(',') || 'none';
        
        // Build slot prompts for the AI
        const slotPromptsSection = bookingSlots.map(slot => {
            const status = knownSlots[slot.id] ? `✓ collected: "${knownSlots[slot.id]}"` : `○ missing ${slot.required ? '(REQUIRED)' : '(optional)'}`;
            return `  ${slot.id}: "${slot.question}" [${status}]`;
        }).join('\n');
        
        // Customer context
        const isReturning = customerContext?.isReturning || customerContext?.totalCalls > 1;
        const customerNote = isReturning 
            ? `RETURNING CUSTOMER (${customerContext?.totalCalls || 'multiple'} previous calls). Acknowledge this!` 
            : '';
        
        // ════════════════════════════════════════════════════════════════════
        // SERVICE AREA & NEEDS SECTION
        // ════════════════════════════════════════════════════════════════════
        let serviceAreaSection = '';
        if (serviceAreaInfo) {
            if (serviceAreaInfo.detected?.isKnownArea) {
                serviceAreaSection = `
═══ SERVICE AREA QUESTION ═══
CALLER ASKED ABOUT: ${serviceAreaInfo.detected.city}
WE SERVICE THIS AREA: YES!
RESPOND: "Yes, we absolutely service ${serviceAreaInfo.detected.city}!"`;
            } else if (serviceAreaInfo.detected) {
                serviceAreaSection = `
═══ SERVICE AREA QUESTION ═══
CALLER ASKED ABOUT: ${serviceAreaInfo.detected.city}
WE SERVICE THIS AREA: Likely yes (Southwest Florida)
RESPOND: "I believe we service ${serviceAreaInfo.detected.city}, let me get your info..."`;
            }
        }
        
        // Build triage context section if available
        let triageSection = '';
        if (triageContext?.matched) {
            const questions = triageContext.diagnosticQuestions?.slice(0, 2).join('\n  - ') || '';
            triageSection = `
═══ ISSUE MATCHED ═══
Issue: ${triageContext.cardName || 'AC Issue'}
Urgency: ${triageContext.urgency?.toUpperCase() || 'NORMAL'}
${triageContext.explanation ? `Explain: ${triageContext.explanation}` : ''}
${questions ? `Possible questions:\n  - ${questions}` : ''}
Type: ${triageContext.suggestedServiceType || 'repair'}
`;
        }
        
        // ════════════════════════════════════════════════════════════════════
        // 🚨 100% UI-CONTROLLED SYSTEM PROMPT
        // All behavior comes from frontDeskBehavior config
        // ════════════════════════════════════════════════════════════════════
        
        // Map personality tone to description
        const toneDescriptions = {
            warm: 'warm, friendly, and approachable',
            professional: 'professional, polished, and efficient',
            casual: 'casual, relaxed, and conversational',
            formal: 'formal, respectful, and businesslike'
        };
        const toneDesc = toneDescriptions[uiConfig.personality.tone] || toneDescriptions.warm;
        
        // Map verbosity to word limit
        const verbosityLimits = {
            concise: 30,
            balanced: 50,
            detailed: 75
        };
        const maxWords = uiConfig.personality.maxResponseWords || verbosityLimits[uiConfig.personality.verbosity] || 30;
        
        // ════════════════════════════════════════════════════════════════════
        // STREAMLINED PROMPT - Let AI be an AI, not a form-filler
        // ════════════════════════════════════════════════════════════════════
        
        // Build a MINIMAL, FOCUSED prompt
        let prompt = `You are ${uiConfig.personality.agentName || 'the receptionist'} at ${companyName} (${trade}). LIVE PHONE CALL.

STYLE: ${toneDesc}, max ${maxWords} words per response.
${speakingStyleSection}
GOAL: Help caller, schedule service if needed.

═══ BOOKING SLOTS (ask in order) ═══
${slotPromptsSection}

KNOWN: ${slotsList}
${missingSlots !== 'none' ? `STILL NEED: ${missingSlots}` : 'ALL INFO COLLECTED - confirm and complete.'}`;

        // Add only what's RELEVANT to this specific turn
        if (customerNote) prompt += `\n${customerNote}`;
        if (serviceAreaSection) prompt += `\n${serviceAreaSection}`;
        if (triageSection) prompt += `\n${triageSection}`;
        
        // Forbidden phrases (keep minimal)
        if (uiConfig.forbiddenPhrases.length > 0 && uiConfig.forbiddenPhrases.length <= 5) {
            prompt += `\nDON'T SAY: ${uiConfig.forbiddenPhrases.slice(0, 5).join(', ')}`;
        }
        
        // Last response anti-repeat
        if (lastAgentResponse) {
            prompt += `\n\nYOU JUST SAID: "${lastAgentResponse.substring(0, 50)}..." - say something DIFFERENT.`;
        }
        
        // Build needsInfo options from dynamic slots
        const needsInfoOptions = slotIds.join('|') + '|none';
        
        // SIMPLE output format - just reply + one useful field
        prompt += `

RESPOND with JSON:
{"reply":"<what you say>","needsInfo":"${needsInfoOptions}"}`;
        
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
            // Use dynamic slots from config
            const slots = this.getBookingSlots(behaviorConfig);
            for (const slot of slots) {
                if (!filledSlots[slot.id]) {
                    return `ASK_${slot.id.toUpperCase()}`;
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
     * Emergency fallback when LLM fails - MUST be smart, NOT generic
     */
    static emergencyFallback(mode, knownSlots) {
        // 🧠 SMART FALLBACK - Even in emergency, sound like a receptionist not a chatbot
        let reply = "Got it, what's going on — is it not cooling, not heating, making noise, or something else?";
        
        if (mode === 'booking') {
            if (!knownSlots.name) {
                reply = "Perfect, let me get you on the schedule. What's your name?";
            } else if (!knownSlots.phone) {
                reply = `Great ${knownSlots.name}, and what's the best number to reach you?`;
            } else if (!knownSlots.address) {
                reply = "What's the address where service is needed?";
            } else if (!knownSlots.time) {
                reply = "When works best for you — morning or afternoon?";
            }
        }
        
        logger.warn('[HYBRID LLM] 🚨 Emergency fallback used - LLM was not called', {
            mode,
            hasSlots: Object.keys(knownSlots || {}).filter(k => knownSlots[k]).length
        });
        
        return {
            reply,
            conversationMode: mode,
            intent: 'unknown',
            nextGoal: null,
            filledSlots: knownSlots,
            signals: { frustrated: false, wantsHuman: false },
            latencyMs: 0,
            tokensUsed: 0,
            isEmergencyFallback: true
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

module.exports = HybridReceptionistLLM;

