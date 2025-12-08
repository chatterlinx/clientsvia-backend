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
        
        if (!openaiClient) {
            logger.error('[HYBRID LLM] OpenAI not configured!');
            return this.emergencyFallback(currentMode, knownSlots);
        }
        
        try {
            // ════════════════════════════════════════════════════════════════
            // BUILD THE SYSTEM PROMPT
            // ════════════════════════════════════════════════════════════════
            const systemPrompt = this.buildSystemPrompt({
                company,
                currentMode,
                knownSlots,
                behaviorConfig
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
            // CALL THE LLM
            // ════════════════════════════════════════════════════════════════
            const response = await openaiClient.chat.completions.create({
                model: 'gpt-4o-mini', // Fast, cheap, good enough for conversation
                messages,
                temperature: 0.8, // More personality
                max_tokens: 300,
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
     */
    static buildSystemPrompt({ company, currentMode, knownSlots, behaviorConfig }) {
        const companyName = company.name || 'our company';
        const trade = company.trade || 'HVAC';
        const serviceAreas = company.serviceAreas?.join(', ') || 'your area';
        
        const personality = behaviorConfig.personality || {};
        const tone = personality.tone || 'warm and professional';
        
        // Format known slots for display
        const slotsList = Object.entries(knownSlots)
            .filter(([k, v]) => v)
            .map(([k, v]) => `  ${k}: ${v}`)
            .join('\n') || '  (nothing collected yet)';
        
        // Format missing slots
        const requiredSlots = ['name', 'phone', 'address', 'serviceType', 'time'];
        const missingSlots = requiredSlots.filter(s => !knownSlots[s]).join(', ') || 'none';
        
        return `You are the receptionist for ${companyName}, a ${trade} company serving ${serviceAreas}.

═══ YOUR PERSONALITY ═══
Tone: ${tone}
Style: Conversational, helpful, efficient. You sound like a real person, not a robot.
You're the kind of receptionist people actually LIKE talking to.

═══ CURRENT STATE ═══
Mode: ${currentMode}
${MODE_INSTRUCTIONS[currentMode] || MODE_INSTRUCTIONS.free}

═══ WHAT YOU ALREADY KNOW ═══
${slotsList}

═══ STILL NEED (for booking) ═══
${missingSlots}

${BEHAVIOR_RULES}

═══ YOUR OUTPUT (JSON) ═══
Return ONLY valid JSON with this structure:
{
  "reply": "What you say to the caller (max 40 words, 2-3 sentences)",
  "conversationMode": "free|booking|triage|rescue",
  "intent": "booking|triage|question|smalltalk|cancel|escalate",
  "nextGoal": "ASK_NAME|ASK_PHONE|ASK_ADDRESS|ASK_SERVICE_TYPE|ASK_TIME|CONFIRM|TRIAGE_STEP|ANSWER_QUESTION|null",
  "filledSlots": {
    "name": "extracted name or null",
    "phone": "extracted phone or null",
    "address": "extracted address or null",
    "serviceType": "repair|maintenance|null",
    "time": "extracted time preference or null"
  },
  "signals": {
    "frustrated": false,
    "wantsHuman": false,
    "isQuestion": false,
    "bookingComplete": false
  },
  "reasoning": "Brief explanation of your decision"
}

REMEMBER: 
- Your reply goes DIRECTLY to the caller. Make it sound human.
- Answer what they said FIRST, then move the conversation forward.
- If you already have their phone, DON'T ask for it again.
`;
    }
    
    /**
     * Format conversation history for the messages array
     */
    static formatConversationHistory(history) {
        if (!history || !Array.isArray(history)) return [];
        
        // Keep last 10 turns max (context window efficiency)
        const recent = history.slice(-10);
        
        return recent.map(turn => ({
            role: turn.role === 'caller' ? 'user' : 'assistant',
            content: turn.content || turn.text
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

