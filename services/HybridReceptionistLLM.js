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

// ═══════════════════════════════════════════════════════════════════════════════
// 🎯 VERSION BANNER - This log PROVES the new code is deployed
// ═══════════════════════════════════════════════════════════════════════════════
const HYBRID_LLM_VERSION = '2025-12-10-V2-SMART-PERSONALITY';
logger.info(`[HYBRID RECEPTIONIST LLM] 🧠 LOADED VERSION: ${HYBRID_LLM_VERSION}`, {
    features: [
        'Smart personality prompt (reflects, hypothesizes)',
        '3-turn memory (no repetition)',
        'llmRegistry integration (brain: LLM0)',
        'Trade-aware discovery questions'
    ]
});
// ═══════════════════════════════════════════════════════════════════════════════
const ServiceAreaHandler = require('./ServiceAreaHandler');

// ════════════════════════════════════════════════════════════════════════════
// BEHAVIOR RULES - Baked into every prompt
// ════════════════════════════════════════════════════════════════════════════

const BEHAVIOR_RULES = `
═══ GOLDEN RULES - FOLLOW THESE OR YOU FAIL ═══

RULE 1: ANSWER THEN BRIDGE
- NEVER ignore what the caller just said.
- First sentence: Answer/acknowledge what they said.
- Second sentence: Bridge to your next goal.
- Example: "Yes, we service Fort Myers! Let me grab your phone number in case we get disconnected."

RULE 1B: SERVICE AREA QUESTIONS
- If they ask "Do you service [area]?" - ANSWER IMMEDIATELY
- If the area is in our service territory: "Yes, we absolutely service {city}!"
- Then acknowledge their needs and start booking
- Example: "Yes, we service Fort Myers! Duct cleaning and thermostat work — we can help with both. What's your name?"

RULE 2: NEVER ASK FOR WHAT YOU ALREADY HAVE
- If a field is filled in knownSlots, do NOT ask for it again.
- If caller repeats something you have: confirm and move on.
- Example: "Yes, I have 239-565-2202. What's the service address?"

RULE 3: COMPRESS WHEN THEY GIVE A LOT
- If caller gives multiple pieces of info, USE ALL OF THEM.
- Don't ask for things they just told you.
- Skip ahead in the flow.

RULE 4: HANDLE SIDE COMMENTS AND QUESTIONS
- If they ask something off-topic, answer briefly, then pivot back.
- "Man this heat is killing me" → "Yeah, it's brutal. Let's get you cooled down. What's your address?"
- "How much is this gonna cost?" → "The tech will give you an estimate on-site. What time works for you?"

RULE 5: FRUSTRATION = IMMEDIATE REPAIR
- If they say "I just told you", "Are you listening?", "What?" etc:
  1. Apologize ONCE, briefly
  2. Confirm what you have
  3. Move to the next thing you need
- Example: "You're right, I have your number as 239-565-2202. Let me just get the address."

RULE 6: KEEP IT SHORT
- Max 2-3 sentences per response.
- Max 40 words unless explaining something complex.
- Sound conversational, not scripted.

RULE 7: NEVER SAY THESE
- "I apologize for any inconvenience"
- "Thank you for your patience"  
- "I understand your frustration" (too canned)
- "How may I assist you today" (robotic)
- Don't start every sentence with "Great!" or "Got it!"
`;

// ════════════════════════════════════════════════════════════════════════════
// MODE DEFINITIONS
// ════════════════════════════════════════════════════════════════════════════

const MODE_INSTRUCTIONS = {
    free: `
MODE: FREE/DISCOVERY
You're in open conversation mode. Figure out what they want.
- Answer their questions naturally
- Pick up any info they volunteer (name, phone, location, issue)
- When you understand their intent, transition to the right mode
- Don't jump straight to "What's your name?" - have a conversation first
`,
    booking: `
MODE: GUIDED BOOKING
Goal: Get them scheduled with minimum friction.
Required slots: name, phone, address, serviceType, time
- Only ask for slots you DON'T have yet
- If they give multiple pieces of info, use all of them
- Be conversational, not robotic
- When all slots are filled, confirm everything once and wrap up
`,
    triage: `
MODE: TRIAGE/DIAGNOSIS
Goal: Understand their issue to route correctly.
- Ask diagnostic questions naturally
- If they volunteer booking info, capture it
- If they clearly want to book, transition to booking mode
`,
    rescue: `
MODE: RESCUE (FRUSTRATION DETECTED)
The caller is frustrated. Handle with care:
1. Acknowledge briefly (don't over-apologize)
2. Confirm what you already know
3. Move forward with ONE clear next question
4. If they stay frustrated, offer human transfer
`
};

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
                        fromQuickAnswers: true
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
            
            // Only get triage context if caller is describing an issue
            const isDescribingIssue = /problem|issue|broken|not working|leak|noise|smell|blank|won't|doesn't|can't|stopped/i.test(userInput);
            
            if (isDescribingIssue && companyId) {
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
                turnCount: callContext.turnCount || 1
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
            let parsed;
            try {
                parsed = JSON.parse(content);
            } catch (parseErr) {
                logger.error('[HYBRID LLM] JSON parse failed', { content });
                return this.emergencyFallback(currentMode, knownSlots);
            }
            
            // ════════════════════════════════════════════════════════════════
            // NORMALIZE RESPONSE (3-Phase System)
            // ════════════════════════════════════════════════════════════════
            const phase = (parsed.phase || 'DISCOVERY').toUpperCase();
            const problemSummary = parsed.problemSummary || parsed.summary || null;
            const wantsBooking = parsed.wantsBooking === true;
            const confidence = parsed.confidence || 0.5;
            
            // Determine conversation mode from phase
            let conversationMode = 'free';
            if (phase === 'BOOKING' && wantsBooking && problemSummary) {
                conversationMode = 'booking';
            } else if (phase === 'DECISION') {
                conversationMode = 'decision';
            } else {
                conversationMode = 'discovery';
            }
            
            const result = {
                reply: parsed.reply || parsed.response || "What's going on with the AC?",
                phase,
                conversationMode,
                problemSummary,
                wantsBooking,
                confidence,
                intent: parsed.intent || 'unknown',
                nextGoal: parsed.nextGoal || this.phaseToNextGoal(phase, parsed.filledSlots),
                filledSlots: this.mergeSlots(knownSlots, parsed.filledSlots || parsed.extracted || {}),
                signals: {
                    frustrated: parsed.signals?.frustrated || parsed.frustrated || false,
                    wantsHuman: parsed.signals?.wantsHuman || parsed.wantsHuman || false,
                    wantsEstimate: parsed.signals?.wantsEstimate || false,
                    offTopic: parsed.signals?.offTopic || false,
                    isQuestion: parsed.signals?.isQuestion || parsed.isQuestion || false,
                    bookingComplete: parsed.signals?.bookingComplete || false
                },
                reasoning: parsed.reasoningTrace || parsed.reasoning || null,
                latencyMs,
                tokensUsed: response.usage?.total_tokens || 0
            };
            
            logger.info('[HYBRID LLM] Turn processed', {
                callId,
                mode: result.conversationMode,
                intent: result.intent,
                nextGoal: result.nextGoal,
                latencyMs,
                slots: Object.keys(result.filledSlots).filter(k => result.filledSlots[k]),
                signals: result.signals
            });
            
            return result;
            
        } catch (error) {
            logger.error('[HYBRID LLM] Error:', error.message);
            return this.emergencyFallback(currentMode, knownSlots);
        }
    }
    
    /**
     * Get the next missing slot that needs to be collected
     */
    static getNextMissingSlot(knownSlots) {
        const slotOrder = ['name', 'phone', 'address', 'time'];
        for (const slot of slotOrder) {
            if (!knownSlots[slot]) {
                return slot;
            }
        }
        return null;
    }
    
    /**
     * Get a prompt for a specific slot (for bridging from Quick Answers)
     */
    static getSlotPrompt(slotName, behaviorConfig = {}) {
        const prompts = behaviorConfig.bookingPrompts || {};
        
        switch (slotName) {
            case 'name':
                return prompts.name || 'may I have your name?';
            case 'phone':
                return prompts.phone || 'what is the best phone number to reach you?';
            case 'address':
                return prompts.address || 'what is the address where service is needed?';
            case 'time':
                return prompts.time || 'what day and time works best for you?';
            default:
                return 'how can I help you?';
        }
    }
    
    /**
     * Build the system prompt with all context
     * OPTIMIZED: Reduced token count for faster responses
     * ENHANCED: Better empathy and customer recognition
     */
    static buildSystemPrompt({ company, currentMode, knownSlots, behaviorConfig, triageContext, customerContext, serviceAreaInfo, detectedServices, lastAgentResponse, turnCount }) {
        const companyName = company.name || 'our company';
        const trade = company.trade || 'HVAC';
        
        // Compact slot display
        const hasSlots = Object.entries(knownSlots).filter(([k, v]) => v);
        const slotsList = hasSlots.length > 0 
            ? hasSlots.map(([k, v]) => `${k}:${v}`).join(', ')
            : 'none';
        
        const missingSlots = ['name', 'phone', 'address', 'time']
            .filter(s => !knownSlots[s]).join(',') || 'none';
        
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
        // 3-PHASE SYSTEM PROMPT (DISCOVERY → DECISION → BOOKING)
        // ════════════════════════════════════════════════════════════════════
        return `You are the lead receptionist at ${companyName}, a ${trade} company. You are on a LIVE phone call RIGHT NOW.

═══ WHO YOU ARE ═══
You've taken 10,000+ calls. You're confident, warm, and efficient.
You sound like a real person — not a chatbot, not an IVR, not a script.
You LEAD the conversation. You don't wait for the caller to drive it.

═══ YOUR 3 CORE BEHAVIORS ═══

1. REFLECT - Always echo back what you heard
   ✓ "Got it, your AC isn't cooling and the outside unit is loud."
   ✓ "Okay, so there's water leaking in the garage."
   ✗ "I can help you with that." (says nothing)
   ✗ "What would you like to know?" (useless)

2. HYPOTHESIZE - Make educated guesses
   ✓ "That sounds like it needs a repair visit."
   ✓ "If it's not cooling at all, that's something we should look at."
   ✗ "What do you need?" (lazy, makes caller work)

3. LEAD - Move the conversation forward
   ✓ "Let me ask you one thing — is it blowing warm air or not coming on at all?"
   ✓ "Would you like us to send someone out to diagnose it?"
   ✗ "How can I help you?" (empty, robotic)

═══ THE 3 PHASES ═══

PHASE 1: DISCOVERY (turns 1-2)
Goal: Understand the problem in the caller's words.
- REFLECT what they said: "Got it, AC service..."
- HYPOTHESIZE: "That sounds like a repair/maintenance call."
- ASK ONE smart question: "Is it not cooling, making noise, or something else?"
- FORBIDDEN: name, phone, address, scheduling questions

PHASE 2: DECISION (after you understand)
Goal: Confirm what they need.
- SUMMARIZE: "So your AC stopped cooling yesterday and it's making a grinding noise."
- OFFER: "That definitely needs a tech. Want me to get someone out there?"
- If yes → BOOKING. If no → answer their question.

PHASE 3: BOOKING (after they agree)
Goal: Collect details efficiently.
- TRANSITION: "Perfect, let me get you scheduled. What's your name?"
- Ask ONE thing at a time: name → phone → address → time
- Keep referencing their issue: "Great, so for the AC repair at 123 Main..."

═══ FORBIDDEN PHRASES (Instant fail if you say these) ═══
- "How can I help you?" / "How may I assist you?"
- "What would you like to know?"
- "I can help you with that." (alone, without specifics)
- "What can I do for you today?"
- "Is there anything else I can help with?"
- "May I have your name and what you need help with?"

═══ SMART ASSUMPTIONS ═══
- "AC service" or "air conditioning" → probably REPAIR unless they say maintenance/tune-up
- "Not cooling" / "blowing warm" → definitely REPAIR
- "Tune-up" / "maintenance" / "check" → MAINTENANCE
- "Something's wrong" → REPAIR, ask what symptoms
- If unsure → ask ONE clarifying question, don't interrogate

═══ CURRENT CALL STATE ═══
Turn: ${turnCount || 1}
Collected: ${slotsList}
${customerNote}
${serviceAreaSection}
${triageSection}
${lastAgentResponse ? `
═══ YOUR LAST RESPONSE (DO NOT REPEAT) ═══
"${lastAgentResponse}"
You MUST say something DIFFERENT. Progress the conversation forward.
If you already asked a question, don't ask it again — either:
- Answer based on what they said, OR
- Ask a DIFFERENT follow-up question
` : ''}
═══ OUTPUT FORMAT ═══
Return ONLY valid JSON:
{
  "reply": "<your spoken response, max 40 words, sounds human>",
  "phase": "DISCOVERY|DECISION|BOOKING",
  "problemSummary": "<one sentence summary of their issue, or null>",
  "likelyNeed": "repair|maintenance|question|unknown",
  "wantsBooking": false,
  "confidence": 0.5,
  "filledSlots": {"name":null,"phone":null,"address":null,"serviceType":null,"time":null},
  "signals": {"frustrated":false,"wantsHuman":false,"isQuestion":false}
}`;
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
            role: turn.role === 'caller' ? 'user' : 'assistant',
            // Truncate long messages to save tokens
            content: (turn.content || turn.text || '').substring(0, 200)
        }));
    }
    
    /**
     * Merge new slots with existing, preferring new non-null values
     */
    /**
     * Determine next goal based on phase (3-Phase System)
     */
    static phaseToNextGoal(phase, filledSlots = {}) {
        if (phase === 'DISCOVERY') {
            return 'UNDERSTAND_PROBLEM';
        }
        if (phase === 'DECISION') {
            return 'CONFIRM_WANTS_BOOKING';
        }
        if (phase === 'BOOKING') {
            // In booking phase, determine which slot to ask for next
            if (!filledSlots.name) return 'ASK_NAME';
            if (!filledSlots.phone) return 'ASK_PHONE';
            if (!filledSlots.address) return 'ASK_ADDRESS';
            if (!filledSlots.time) return 'ASK_TIME';
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
     */
    static detectFrustration(input) {
        const frustrationPatterns = [
            /i just told you/i,
            /i already said/i,
            /are you (even )?listening/i,
            /what\?/i,
            /this is ridiculous/i,
            /forget it/i,
            /can i talk to a (real )?human/i,
            /this is frustrating/i,
            /you('re| are) not helping/i
        ];
        
        return frustrationPatterns.some(p => p.test(input));
    }
    
    /**
     * Detect if input is a question that needs answering
     */
    static detectQuestion(input) {
        return /\?|do you|can you|will you|how much|how long|when|where|what time|what is/i.test(input);
    }
}

module.exports = HybridReceptionistLLM;

