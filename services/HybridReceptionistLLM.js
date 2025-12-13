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
        fallbackResponses: {
            greeting: config.fallbackResponses?.greeting || null,
            discovery: config.fallbackResponses?.discovery || null,
            askName: config.fallbackResponses?.askName || null,
            askPhone: config.fallbackResponses?.askPhone || null,
            askAddress: config.fallbackResponses?.askAddress || null,
            askTime: config.fallbackResponses?.askTime || null,
            confirmBooking: config.fallbackResponses?.confirmBooking || null,
            bookingComplete: config.fallbackResponses?.bookingComplete || null,
            didNotHear: config.fallbackResponses?.didNotHear || null,
            connectionIssue: config.fallbackResponses?.connectionIssue || null,
            clarification: config.fallbackResponses?.clarification || null,
            transfering: config.fallbackResponses?.transfering || null,
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
                runningSummary: callContext.runningSummary || null,  // Running conversation summary
                lastAgentResponse,  // Prevent repetition
                turnCount: callContext.turnCount || 1,
                speakingCorrections,  // What words NOT to use
                callerId: callContext.callerId || callContext.callerPhone || null  // For caller ID confirmation
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
     * Build the system prompt with all context
     * 🚨 100% UI-CONTROLLED - All instructions come from frontDeskBehavior config
     */
    static buildSystemPrompt({ company, currentMode, knownSlots, behaviorConfig, triageContext, customerContext, runningSummary, serviceAreaInfo, detectedServices, lastAgentResponse, turnCount, speakingCorrections, callerId }) {
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
        // DYNAMIC BOOKING SLOTS FROM UI (via BookingScriptEngine)
        // ════════════════════════════════════════════════════════════════════
        const bookingConfig = BookingScriptEngine.getBookingSlotsFromCompany(company);
        const bookingSlots = bookingConfig.slots;
        const slotIds = bookingSlots.map(s => s.slotId);
        const bookingIsConfigured = bookingConfig.isConfigured;
        
        // 🚨 DEBUG: Log exactly what questions are being used
        logger.info('[HYBRID LLM] 📋 BOOKING CONFIG:', {
            source: bookingConfig.source,
            isConfigured: bookingIsConfigured,
            slotCount: bookingSlots.length,
            questions: bookingSlots.map(s => ({ id: s.slotId, question: s.question }))
        });
        
        // Compact slot display
        const hasSlots = Object.entries(knownSlots).filter(([k, v]) => v);
        const slotsList = hasSlots.length > 0 
            ? hasSlots.map(([k, v]) => `${k}:${v}`).join(', ')
            : 'none';
        
        // Get missing slots based on dynamic config
        const missingSlots = slotIds.filter(s => !knownSlots[s]).join(',') || 'none';
        
        // Build slot prompts section - ONLY if configured
        let slotPromptsSection = '';
        if (bookingIsConfigured) {
            slotPromptsSection = bookingSlots.map(slot => {
                const collected = knownSlots[slot.slotId];
                if (collected) {
                    return `  ${slot.slotId}: ✓ COLLECTED → "${collected}"`;
                } else {
                    const requiredTag = slot.required ? 'REQUIRED' : 'optional';
                    const confirmNote = slot.confirmBack 
                        ? `\n    → After answer, confirm: "${slot.confirmPrompt?.replace('{value}', '[their answer]') || 'Is that correct?'}"`
                        : '';
                    return `  ${slot.slotId}: ASK → "${slot.question}" (${requiredTag})${confirmNote}`;
                }
            }).join('\n');
        }
        
        // Build list of slots that need confirmation
        const slotsNeedingConfirm = bookingSlots
            .filter(s => s.confirmBack)
            .map(s => s.slotId);
        
        const confirmInstructions = slotsNeedingConfirm.length > 0
            ? `\nCONFIRM BACK: For ${slotsNeedingConfirm.join(', ')} - repeat the value back to verify you heard correctly.`
            : '';
        
        // Build name handling instructions from slot config
        const nameSlot = bookingSlots.find(s => s.id === 'name');
        let nameInstructions = '';
        if (nameSlot) {
            const rules = [];
            if (nameSlot.useFirstNameOnly !== false) {
                rules.push('When addressing caller later, use FIRST NAME only (e.g., "Great, John!" not "Great, John Smith!")');
            }
            
            // UI-configurable: Ask once for missing name part - make this VERY prominent
            if (nameSlot.askMissingNamePart === true) {
                rules.push(`
🚨 PARTIAL NAME PROTOCOL (ENABLED):
   When caller gives ONLY first name (like "Marc" or "John"):
   → DO NOT proceed to phone number yet!
   → Say: "Thank you, [Name]! May I also have your last name?"
   → Wait for their response before continuing.
   
   When caller gives ONLY last name (like "Smith" or "Walter"):
   → Say: "Thank you, Mr./Ms. [Name]! And your first name?"
   
   ⚠️ Ask ONE TIME ONLY. If they don't provide it, that's fine - continue with booking.`);
            }
            
            if (rules.length > 0) {
                nameInstructions = `\n👤 NAME HANDLING: ${rules.join('\n')}`;
            }
        }
        
        // Build phone/caller ID instructions from slot config
        const phoneSlot = bookingSlots.find(s => s.id === 'phone' || s.type === 'phone');
        let phoneInstructions = '';
        if (phoneSlot && phoneSlot.offerCallerId !== false && callerId && !knownSlots.phone) {
            // Format caller ID for display (e.g., 239-565-2202)
            const formattedCallerId = callerId.replace(/^\+1/, '').replace(/(\d{3})(\d{3})(\d{4})/, '$1-$2-$3');
            const prompt = (phoneSlot.callerIdPrompt || "I see you're calling from {callerId} - is that a good number for text confirmations, or would you prefer a different one?")
                .replace('{callerId}', formattedCallerId);
            phoneInstructions = `\n📞 CALLER ID AVAILABLE: ${formattedCallerId}\n   When asking for phone, offer: "${prompt}"\n   If they say YES/that's fine/correct → use ${formattedCallerId} as their phone\n   If they give a different number → use that instead`;
        }
        
        // Build address confirmation instructions from slot config
        const addressSlot = bookingSlots.find(s => s.id === 'address' || s.type === 'address');
        let addressInstructions = '';
        if (addressSlot && addressSlot.confirmBack) {
            const level = addressSlot.addressConfirmLevel || 'street_city';
            const levelDesc = {
                'street_only': 'ONLY the street (e.g., "123 Market Place") - NO city/state/zip',
                'street_city': 'street + city (e.g., "123 Market Place, Naples") - NO state/zip',
                'full': 'full address including city, state, zip'
            };
            addressInstructions = `\n📍 ADDRESS CONFIRM: When confirming address back, say ${levelDesc[level]}`;
        }
        
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

═══ CRITICAL CONVERSATION RULES ═══
1. NEVER ask for info you already have (check KNOWN below)
2. If caller says something UNCLEAR or gets CUT OFF:
   - Reference what you DID hear ("You mentioned something about...")
   - Ask them to finish/clarify ("What were you saying about that?")
3. If caller mentions a specific person/technician:
   - Acknowledge it: "You want [name] specifically?"
   - Then help with their actual request
4. LISTEN for what they're actually asking - don't just collect slots robotically

${bookingIsConfigured ? `═══ BOOKING SLOTS (DO NOT READ THIS ALOUD - INTERNAL ONLY) ═══
When collecting booking info, use these EXACT questions:
${slotPromptsSection}

KNOWN: ${slotsList}
${missingSlots !== 'none' ? `STILL NEED: ${missingSlots}` : 'ALL INFO COLLECTED - confirm and complete.'}` : `═══ BOOKING STATUS ═══
KNOWN: ${slotsList}
No booking questions configured. Have a natural conversation.
If caller wants to book, say you'll take their info and have someone call back.`}`;

        // Add only what's RELEVANT to this specific turn
        if (customerNote) prompt += `\n${customerNote}`;
        
        // Add running summary for conversation context
        if (runningSummary && typeof runningSummary === 'string' && runningSummary.trim()) {
            prompt += `\n${runningSummary}`;
        }
        
        if (serviceAreaSection) prompt += `\n${serviceAreaSection}`;
        if (triageSection) prompt += `\n${triageSection}`;
        
        // Add confirm-back instructions if any slots need it
        if (confirmInstructions) {
            prompt += confirmInstructions;
        }
        
        // Add name handling instructions if configured
        if (nameInstructions) {
            prompt += nameInstructions;
        }
        
        // Add phone/caller ID instructions if configured
        if (phoneInstructions) {
            prompt += phoneInstructions;
        }
        
        // Add address confirmation instructions if configured
        if (addressInstructions) {
            prompt += addressInstructions;
        }
        
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
     * 🚨 Uses UI-configured responses ONLY - no hardcoded defaults
     */
    static emergencyFallback(mode, knownSlots, behaviorConfig = {}) {
        const fallbacks = behaviorConfig.fallbackResponses || {};
        
        // Check if config is complete
        const isConfigured = behaviorConfig._isConfigured || behaviorConfig.bookingSlots?.length > 0;
        
        let reply;
        
        if (!isConfigured) {
            // 🚨 NOT CONFIGURED - Tell the caller to hold (config error)
            reply = "One moment please, let me check on something.";
            logger.error('[HYBRID LLM] 🚨 EMERGENCY FALLBACK - Company not configured! No bookingSlots in database.');
        } else if (mode === 'booking') {
            // Use UI-configured slot questions
            const bookingSlots = this.getBookingSlots(behaviorConfig);
            const nameSlot = bookingSlots.find(s => s.id === 'name');
            
            if (!knownSlots.name) {
                const nameQ = this.getSlotPrompt('name', behaviorConfig);
                reply = nameQ ? `Perfect, let me get you on the schedule. ${nameQ}` : fallbacks.askName;
            } else if (!knownSlots.phone) {
                const firstName = (nameSlot?.useFirstNameOnly !== false && knownSlots.name) 
                    ? knownSlots.name.split(' ')[0] 
                    : knownSlots.name;
                const phoneQ = this.getSlotPrompt('phone', behaviorConfig);
                reply = phoneQ ? `Great ${firstName}, ${phoneQ}` : fallbacks.askPhone;
            } else if (!knownSlots.address) {
                reply = this.getSlotPrompt('address', behaviorConfig) || fallbacks.askAddress;
            } else if (!knownSlots.time) {
                reply = this.getSlotPrompt('time', behaviorConfig) || fallbacks.askTime;
            } else {
                reply = fallbacks.generic || "How can I help you?";
            }
        } else {
            reply = fallbacks.discovery || fallbacks.generic || "How can I help you?";
        }
        
        // Final safety - if still null, use absolute minimum
        if (!reply) {
            reply = "I'm here to help. What can I do for you?";
            logger.error('[HYBRID LLM] 🚨 CRITICAL: No fallback response configured in database!');
        }
        
        logger.warn('[HYBRID LLM] 🚨 Emergency fallback used - LLM was not called', {
            mode,
            isConfigured,
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
            isEmergencyFallback: true,
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

module.exports = HybridReceptionistLLM;

