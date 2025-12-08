/**
 * ============================================================================
 * BOOKING CONVERSATION LLM - Actual AI for Booking Flow
 * ============================================================================
 * 
 * THIS IS THE REAL LLM!
 * 
 * Instead of hardcoded responses, this service calls OpenAI/Claude to:
 * 1. Understand what the caller said
 * 2. Answer questions naturally
 * 3. Extract booking data (name, phone, address, time)
 * 4. Generate human-like responses
 * 5. Detect emotion and respond appropriately
 * 
 * Uses Front Desk Behavior config from UI for personality/prompts.
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const openaiClient = require('../config/openai');
const { DEFAULT_FRONT_DESK_CONFIG } = require('../config/frontDeskPrompt');

class BookingConversationLLM {
    
    /**
     * Generate a conversational response during booking
     * 
     * @param {Object} params
     * @param {string} params.userInput - What the caller said
     * @param {string} params.currentStep - ASK_NAME, ASK_PHONE, ASK_ADDRESS, ASK_TIME
     * @param {Object} params.collected - Already collected data { name, phone, address, time }
     * @param {Object} params.frontDeskConfig - UI config from company settings
     * @param {string} params.companyName - Company name for personalization
     * @param {string} params.serviceType - What service they want
     * @returns {Promise<{response: string, extracted: Object, emotion: string, isQuestion: boolean}>}
     */
    static async generateResponse({
        userInput,
        currentStep,
        collected = {},
        frontDeskConfig = {},
        companyName = 'our company',
        serviceType = 'service'
    }) {
        if (!openaiClient) {
            logger.warn('[BOOKING LLM] OpenAI not configured, using fallback');
            return this.fallbackResponse(userInput, currentStep, collected, frontDeskConfig);
        }
        
        const config = { ...DEFAULT_FRONT_DESK_CONFIG, ...frontDeskConfig };
        const startTime = Date.now();
        
        try {
            // Build the system prompt from UI config
            const systemPrompt = this.buildSystemPrompt(config, companyName, serviceType, currentStep, collected);
            
            const response = await openaiClient.chat.completions.create({
                model: 'gpt-4o-mini', // Fast and cheap - typically 500-1500ms
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userInput }
                ],
                temperature: 0.7,
                max_tokens: 200,
                response_format: { type: 'json_object' }
            });
            
            const ms = Date.now() - startTime;
            const content = response.choices[0]?.message?.content;
            
            logger.info('[BOOKING LLM] Response generated', {
                ms,
                currentStep,
                inputLength: userInput?.length
            });
            
            // Parse the JSON response
            const parsed = JSON.parse(content);
            
            return {
                response: parsed.reply || parsed.response || this.getFallbackPrompt(currentStep, config),
                extracted: {
                    name: parsed.extractedName || parsed.name || null,
                    phone: parsed.extractedPhone || parsed.phone || null,
                    address: parsed.extractedAddress || parsed.address || null,
                    time: parsed.extractedTime || parsed.time || null,
                    serviceType: parsed.extractedServiceType || parsed.serviceType || null
                },
                emotion: parsed.emotion || parsed.emotionGuess || 'neutral',
                isQuestion: parsed.isQuestion || false,
                needsConfirmation: parsed.needsConfirmation || false,
                nextStep: parsed.nextStep || null,
                llmUsed: true,
                latencyMs: ms
            };
            
        } catch (error) {
            logger.error('[BOOKING LLM] Error calling OpenAI:', error.message);
            return this.fallbackResponse(userInput, currentStep, collected, frontDeskConfig);
        }
    }
    
    /**
     * Build the system prompt from UI configuration
     */
    static buildSystemPrompt(config, companyName, serviceType, currentStep, collected) {
        const personality = config.personality || {};
        const bookingPrompts = config.bookingPrompts || {};
        const emotionResponses = config.emotionResponses || {};
        
        const collectedSummary = [];
        if (collected.serviceType) collectedSummary.push(`Service Type: ${collected.serviceType}`);
        if (collected.name) collectedSummary.push(`Name: ${collected.name}`);
        if (collected.phone) collectedSummary.push(`Phone: ${collected.phone}`);
        if (collected.address) collectedSummary.push(`Address: ${collected.address}`);
        if (collected.time) collectedSummary.push(`Time: ${collected.time}`);
        
        const stepInstructions = {
            'ASK_SERVICE_TYPE': `IMPORTANT: Ask if this is for REPAIR (something broken) or MAINTENANCE (tune-up/cleaning). Say: "Is this for a repair issue, or routine maintenance?"`,
            'ASK_NAME': `Get their name. Say: "${bookingPrompts.askName || 'May I have your name?'}"`,
            'ASK_PHONE': `Get phone number. Say: "${bookingPrompts.askPhone || "What's the best phone number?"}"`,
            'ASK_ADDRESS': `Get service address. Say: "${bookingPrompts.askAddress || "What's the service address?"}"`,
            'ASK_TIME': `Get appointment time. Say: "${bookingPrompts.askTime || "When works best?"}"`,
            'CONFIRM': `Read back ALL details: "So I have [name] at [address], [phone], for [service type] [time]. Does that sound right?"`,
            'POST_BOOKING': 'Booking confirmed. Answer follow-up questions. If they say thanks/goodbye, say: "You\'re all set! A technician will call before arriving. Have a great day!"'
        };
        
        // Determine if we need service type clarification
        const needsServiceType = !collected.serviceType && 
            (serviceType === 'AC service' || serviceType === 'service' || !serviceType || serviceType === 'unknown');
        
        return `You are the front desk receptionist for ${companyName}.
Personality: ${personality.tone || 'warm'}, ${personality.verbosity || 'concise'}.
Max ${personality.maxResponseWords || 25} words per response.
${personality.useCallerName !== false ? 'Use caller\'s name when you know it.' : ''}

═══ BOOKING DATA ═══
${collectedSummary.length > 0 ? collectedSummary.join('\n') : 'Nothing collected yet'}

═══ CURRENT STEP: ${currentStep} ═══
${stepInstructions[currentStep] || 'Help the caller.'}

═══ CRITICAL RULES ═══
1. ${needsServiceType && currentStep === 'ASK_NAME' ? 'FIRST ask if this is repair or maintenance BEFORE asking for name!' : ''}
2. If caller asks a question, answer it briefly, then continue booking.
3. When frustrated: "${emotionResponses.frustrated?.followUp || "I understand, let me help."}"
4. Before completing booking, ALWAYS confirm: name, phone, address, service type, time.
5. Extract: name from "my name is X", phone from digits, address from street names, time from morning/afternoon/tomorrow/asap.
6. If they say "repair/fix/broken" → serviceType = "repair"
7. If they say "maintenance/tune-up/cleaning/check" → serviceType = "maintenance"

═══ OUTPUT JSON ═══
{
  "reply": "your response (max 25 words)",
  "extractedName": "name or null",
  "extractedPhone": "phone or null",
  "extractedAddress": "address or null",
  "extractedTime": "time or null",
  "extractedServiceType": "repair|maintenance|null",
  "emotion": "neutral|friendly|stressed|frustrated|angry",
  "isQuestion": true/false,
  "needsConfirmation": true/false,
  "nextStep": "ASK_SERVICE_TYPE|ASK_NAME|ASK_PHONE|ASK_ADDRESS|ASK_TIME|CONFIRM|POST_BOOKING|null"
}`;
    }
    
    /**
     * Fallback when LLM is unavailable
     */
    static fallbackResponse(userInput, currentStep, collected, config) {
        const bookingPrompts = config.bookingPrompts || {};
        
        return {
            response: this.getFallbackPrompt(currentStep, config),
            extracted: {
                name: this.extractName(userInput),
                phone: this.extractPhone(userInput),
                address: this.extractAddress(userInput),
                time: this.extractTime(userInput)
            },
            emotion: 'neutral',
            isQuestion: /\?/.test(userInput),
            llmUsed: false,
            latencyMs: 0
        };
    }
    
    /**
     * Get fallback prompt for a step
     */
    static getFallbackPrompt(step, config) {
        const bp = config.bookingPrompts || {};
        switch (step) {
            case 'ASK_NAME': return bp.askName || "May I have your name?";
            case 'ASK_PHONE': return bp.askPhone || "What's the best phone number to reach you?";
            case 'ASK_ADDRESS': return bp.askAddress || "What's the service address?";
            case 'ASK_TIME': return bp.askTime || "When works best for you?";
            default: return "How can I help you?";
        }
    }
    
    // Simple extraction fallbacks
    static extractName(input) {
        if (!input) return null;
        const match = input.match(/(?:my name is|i'm|this is|i am|name's)\s+([A-Z][a-z]+)/i);
        return match ? match[1] : null;
    }
    
    static extractPhone(input) {
        if (!input) return null;
        const digits = input.replace(/\D/g, '');
        return digits.length >= 10 ? digits : null;
    }
    
    static extractAddress(input) {
        if (!input) return null;
        if (/\d+.*(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|way|court|ct|boulevard|blvd|parkway|pkwy)/i.test(input)) {
            return input.trim();
        }
        return null;
    }
    
    static extractTime(input) {
        if (!input) return null;
        const patterns = [
            /\b(morning|afternoon|evening|tonight|tomorrow|today|asap|as soon as possible)\b/i,
            /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
            /\d{1,2}(:\d{2})?\s*(am|pm)/i
        ];
        for (const pattern of patterns) {
            const match = input.match(pattern);
            if (match) return match[0];
        }
        return null;
    }
}

module.exports = BookingConversationLLM;

