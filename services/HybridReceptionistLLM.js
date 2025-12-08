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
const openaiClient = require('../config/openai');
const TriageContextProvider = require('./TriageContextProvider');

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
        
        if (!openaiClient) {
            logger.error('[HYBRID LLM] OpenAI not configured!');
            return this.emergencyFallback(currentMode, knownSlots);
        }
        
        try {
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
            // BUILD THE SYSTEM PROMPT (now with triage context)
            // ════════════════════════════════════════════════════════════════
            const systemPrompt = this.buildSystemPrompt({
                company,
                currentMode,
                knownSlots,
                behaviorConfig,
                triageContext  // Pass triage context for smarter responses
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
            // CALL THE LLM - OPTIMIZED FOR SPEED
            // ════════════════════════════════════════════════════════════════
            // Target: <1.5s response time
            // - Reduced max_tokens (we only need ~100 for a short reply)
            // - Lower temperature for more predictable (faster) responses
            // - Compact prompt to reduce input tokens
            const response = await openaiClient.chat.completions.create({
                model: 'gpt-4o-mini', // Fast and cheap
                messages,
                temperature: 0.6, // Lower = faster, more focused
                max_tokens: 150, // We only need ~100 for reply + slots
                response_format: { type: 'json_object' }
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
            
            // Normalize the response
            const result = {
                reply: parsed.reply || parsed.response || "I'm here to help. What can I do for you?",
                conversationMode: this.normalizeMode(parsed.conversationMode || parsed.mode || currentMode),
                intent: parsed.intent || 'unknown',
                nextGoal: parsed.nextGoal || null,
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
     * Build the system prompt with all context
     * OPTIMIZED: Reduced token count for faster responses
     */
    static buildSystemPrompt({ company, currentMode, knownSlots, behaviorConfig, triageContext }) {
        const companyName = company.name || 'our company';
        const trade = company.trade || 'HVAC';
        
        // Compact slot display
        const hasSlots = Object.entries(knownSlots).filter(([k, v]) => v);
        const slotsList = hasSlots.length > 0 
            ? hasSlots.map(([k, v]) => `${k}:${v}`).join(', ')
            : 'none';
        
        const missingSlots = ['name', 'phone', 'address', 'time']
            .filter(s => !knownSlots[s]).join(',') || 'none';
        
        // Build triage context section if available
        let triageSection = '';
        if (triageContext?.matched) {
            const questions = triageContext.diagnosticQuestions?.slice(0, 2).join('\n  - ') || '';
            triageSection = `
═══ ISSUE DIAGNOSIS ═══
Matched: ${triageContext.cardName || 'AC Issue'}
Urgency: ${triageContext.urgency?.toUpperCase() || 'NORMAL'}
${triageContext.explanation ? `Explain: ${triageContext.explanation}` : ''}
${questions ? `Ask one of:\n  - ${questions}` : ''}
Suggested: ${triageContext.suggestedServiceType || 'repair'}
`;
        }
        
        // Compact mode instructions
        const modeInstructions = {
            'free': 'Figure out what they want. Answer questions naturally.',
            'booking': `Get: ${missingSlots}. Don't re-ask filled slots.`,
            'triage': 'Ask diagnostic questions from ISSUE DIAGNOSIS. Then recommend repair/maintenance and book.',
            'rescue': 'Apologize once. Confirm what you have. Move forward.'
        };
        
        return `You: receptionist at ${companyName} (${trade}).
Mode: ${currentMode}. ${modeInstructions[currentMode] || ''}
Have: ${slotsList}
Need: ${missingSlots}
${triageSection}
RULES:
1. Answer their question/comment first, then ask next thing.
2. Never re-ask filled slots.
3. Max 30 words. Sound human.
4. If describing issue, ask diagnostic question then transition to booking.

OUTPUT JSON:
{"reply":"<30 words>","conversationMode":"${currentMode}","intent":"booking|triage|question","nextGoal":"ASK_NAME|ASK_PHONE|ASK_ADDRESS|ASK_TIME|TRIAGE_STEP|CONFIRM","filledSlots":{"name":null,"phone":null,"address":null,"serviceType":null,"time":null},"signals":{"frustrated":false,"wantsHuman":false}}`;
    }
    
    /**
     * Format conversation history for the messages array
     * OPTIMIZED: Keep minimal history for speed
     */
    static formatConversationHistory(history) {
        if (!history || !Array.isArray(history)) return [];
        
        // Keep only last 4 turns (2 exchanges) for speed
        // This is enough for context while reducing token count
        const recent = history.slice(-4);
        
        return recent.map(turn => ({
            role: turn.role === 'caller' ? 'user' : 'assistant',
            // Truncate long messages to save tokens
            content: (turn.content || turn.text || '').substring(0, 200)
        }));
    }
    
    /**
     * Merge new slots with existing, preferring new non-null values
     */
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
     */
    static emergencyFallback(mode, knownSlots) {
        let reply = "I'm here to help. What can I do for you?";
        
        if (mode === 'booking') {
            if (!knownSlots.name) {
                reply = "Let me get some details. What's your name?";
            } else if (!knownSlots.phone) {
                reply = `Thanks ${knownSlots.name}. What's the best phone number?`;
            } else if (!knownSlots.address) {
                reply = "What's the service address?";
            } else if (!knownSlots.time) {
                reply = "When would be a good time?";
            }
        }
        
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

