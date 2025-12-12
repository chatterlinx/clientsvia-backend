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
 * CRITICAL FIX (Dec 8, 2025):
 * - Response MUST match the step we're on
 * - If LLM response doesn't match step, we OVERRIDE with correct prompt
 * - Address parsing converts "Twelve" → "12"
 * - Don't ask for fields we already have
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
// ════════════════════════════════════════════════════════════════════════════
// ⚠️ IMPORTANT: All LLM calls go through llmRegistry - NOT direct OpenAI
// ════════════════════════════════════════════════════════════════════════════
const { callLLM0 } = require('./llmRegistry');
const { DEFAULT_FRONT_DESK_CONFIG } = require('../config/frontDeskPrompt');

// ════════════════════════════════════════════════════════════════════════════
// NUMBER WORD TO DIGIT CONVERSION
// ════════════════════════════════════════════════════════════════════════════
const NUMBER_WORDS = {
    'zero': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
    'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9',
    'ten': '10', 'eleven': '11', 'twelve': '12', 'thirteen': '13',
    'fourteen': '14', 'fifteen': '15', 'sixteen': '16', 'seventeen': '17',
    'eighteen': '18', 'nineteen': '19', 'twenty': '20', 'thirty': '30',
    'forty': '40', 'fifty': '50', 'sixty': '60', 'seventy': '70',
    'eighty': '80', 'ninety': '90', 'hundred': '00'
};

/**
 * Convert spoken numbers to digits
 * "Twelve, 155" → "12155"
 * "Twenty one fifty five" → "2155"
 * "One two three Main Street" → "123 Main Street"
 */
function convertNumberWordsToDigits(input) {
    if (!input) return input;
    
    let result = input;
    
    // Replace compound numbers first (twenty one → 21)
    const compoundPattern = /\b(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\s+(one|two|three|four|five|six|seven|eight|nine)\b/gi;
    result = result.replace(compoundPattern, (match, tens, ones) => {
        const tensDigit = NUMBER_WORDS[tens.toLowerCase()];
        const onesDigit = NUMBER_WORDS[ones.toLowerCase()];
        return (parseInt(tensDigit) + parseInt(onesDigit)).toString();
    });
    
    // Replace individual number words
    for (const [word, digit] of Object.entries(NUMBER_WORDS)) {
        const regex = new RegExp(`\\b${word}\\b`, 'gi');
        result = result.replace(regex, digit);
    }
    
    // Clean up: "12, 155" or "12 155" → "12155" when at start (address numbers)
    result = result.replace(/^(\d+)[,\s]+(\d+)/, '$1$2');
    
    // Clean up stray commas between numbers
    result = result.replace(/(\d),\s*(\d)/g, '$1$2');
    
    return result.trim();
}

// ════════════════════════════════════════════════════════════════════════════
// STEP-TO-PROMPT ENFORCER
// ════════════════════════════════════════════════════════════════════════════
// If LLM returns garbage, we FORCE the correct prompt
// 🚨 NOTE: These are FALLBACK ONLY - UI-configured questions take priority
// Use HybridReceptionistLLM.getSlotPrompt() to get UI-configured questions
const STEP_PROMPTS = {
    'ASK_SERVICE_TYPE': 'Is this for a repair issue, or routine maintenance?',
    'ASK_NAME': 'May I have your full name?',  // Default - UI config overrides
    'ASK_PHONE': "What's the best phone number to reach you?",  // Default - UI config overrides
    'ASK_ADDRESS': "What's the service address?",  // Default - UI config overrides
    'ASK_TIME': 'When works best for you?',  // Default - UI config overrides
    'CONFIRM': 'Does that sound right?',
    'POST_BOOKING': 'Is there anything else I can help you with?'
};

const STEP_KEYWORDS = {
    'ASK_SERVICE_TYPE': ['repair', 'maintenance', 'service type', 'type of service'],
    'ASK_NAME': ['name', 'who am i speaking'],
    'ASK_PHONE': ['phone', 'number', 'reach you', 'contact'],
    'ASK_ADDRESS': ['address', 'location', 'where'],
    'ASK_TIME': ['time', 'when', 'schedule', 'come out', 'appointment'],
    'CONFIRM': ['sound right', 'correct', 'confirm', 'does that'],
    'POST_BOOKING': ['anything else', 'else i can help', 'thank you']
};

/**
 * Validate that LLM response matches the target step
 * Returns true if response is appropriate, false if it needs override
 */
function validateResponseMatchesStep(response, targetStep, collected) {
    if (!response || !targetStep) return false;
    
    const lowerResponse = response.toLowerCase();
    const keywords = STEP_KEYWORDS[targetStep] || [];
    
    // Check if response contains keywords for the target step
    const hasCorrectKeywords = keywords.some(kw => lowerResponse.includes(kw));
    
    // Check if response is asking for something we already have (BAD)
    if (collected.phone && lowerResponse.includes('phone')) return false;
    if (collected.address && lowerResponse.includes('address')) return false;
    if (collected.name && lowerResponse.includes('name') && !lowerResponse.includes(collected.name.toLowerCase())) return false;
    
    return hasCorrectKeywords;
}

/**
 * Build the correct prompt for a step, including collected info
 * 🚨 Uses UI-configured booking slots from HybridReceptionistLLM
 */
function buildStepPrompt(step, collected, frontDeskConfig) {
    // Import HybridReceptionistLLM for UI-configured questions
    const HybridReceptionistLLM = require('./HybridReceptionistLLM');
    
    const name = collected?.name || '';
    // Get first name only if configured
    const bookingSlots = HybridReceptionistLLM.getBookingSlots(frontDeskConfig);
    const nameSlot = bookingSlots.find(s => s.id === 'name');
    const firstName = (nameSlot?.useFirstNameOnly !== false && name) ? name.split(' ')[0] : name;
    
    switch (step) {
        case 'ASK_SERVICE_TYPE':
            return frontDeskConfig?.bookingPrompts?.askServiceType || 'Is this for a repair issue, or routine maintenance?';
        case 'ASK_NAME':
            // Use UI-configured question
            return HybridReceptionistLLM.getSlotPrompt('name', frontDeskConfig);
        case 'ASK_PHONE':
            // Use UI-configured question with name prefix
            const phoneQ = HybridReceptionistLLM.getSlotPrompt('phone', frontDeskConfig);
            return firstName ? `Thanks, ${firstName}! ${phoneQ}` : phoneQ;
        case 'ASK_ADDRESS':
            // Use UI-configured question
            return HybridReceptionistLLM.getSlotPrompt('address', frontDeskConfig);
        case 'ASK_TIME':
            // Use UI-configured question
            return HybridReceptionistLLM.getSlotPrompt('time', frontDeskConfig);
        case 'CONFIRM':
            // Build confirmation with all collected data
            const parts = [];
            if (collected.name) parts.push(collected.name);
            if (collected.address) parts.push(`at ${collected.address}`);
            if (collected.phone) parts.push(collected.phone);
            if (collected.serviceType) parts.push(`for ${collected.serviceType}`);
            if (collected.time) parts.push(collected.time);
            return `Got it! So I have ${parts.join(', ')}. Does that sound right?`;
        case 'POST_BOOKING':
            const templates = frontDeskConfig?.bookingTemplates || frontDeskConfig?.bookingPrompts || {};
            return templates.completeTemplate?.replace('{name}', firstName) || 
                "You're all set! A technician will call before arriving. Is there anything else I can help you with?";
        default:
            return 'How can I help you?';
    }
}

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
        const startTime = Date.now();
        const config = { ...DEFAULT_FRONT_DESK_CONFIG, ...frontDeskConfig };
        
        // ════════════════════════════════════════════════════════════════════════════
        // STEP 1: Extract data from user input (regardless of LLM)
        // ════════════════════════════════════════════════════════════════════════════
        const extracted = this.extractAllFields(userInput, collected);
        
        // Update collected with extracted data
        const newCollected = {
            ...collected,
            ...Object.fromEntries(
                Object.entries(extracted).filter(([k, v]) => v !== null)
            )
        };
        
        // ════════════════════════════════════════════════════════════════════════════
        // STEP 2: Determine NEXT step based on what we NOW have
        // ════════════════════════════════════════════════════════════════════════════
        let nextStep = this.determineNextStep(currentStep, newCollected, config);
        
        logger.info('[BOOKING LLM] Extraction & step logic', {
            currentStep,
            nextStep,
            extracted: Object.keys(extracted).filter(k => extracted[k]),
            nowHave: Object.keys(newCollected).filter(k => newCollected[k])
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // STEP 3: Check if this is a QUESTION (handle before booking)
        // ════════════════════════════════════════════════════════════════════════════
        const isQuestion = /\?|do you|why|what is|how much|how long|when will|can you|will you/i.test(userInput);
        
        // ════════════════════════════════════════════════════════════════════════════
        // STEP 4: Try LLM for natural response
        // ════════════════════════════════════════════════════════════════════════════
        let llmResponse = null;
        let llmUsed = false;
        
        if (openaiClient) {
            try {
                llmResponse = await this.callLLM({
                    userInput,
                    currentStep,
                    nextStep,
                    collected: newCollected,
                    config,
                    companyName,
                    serviceType,
                    isQuestion
                });
                llmUsed = true;
                
            } catch (error) {
                logger.error('[BOOKING LLM] LLM call failed:', error.message);
            }
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // STEP 5: VALIDATE AND ENFORCE RESPONSE
        // ════════════════════════════════════════════════════════════════════════════
        let finalResponse;
        
        if (llmResponse?.reply) {
            // Check if LLM response makes sense for the NEXT step
            const isValid = validateResponseMatchesStep(llmResponse.reply, nextStep, newCollected);
            
            if (isValid) {
                finalResponse = llmResponse.reply;
                logger.info('[BOOKING LLM] ✅ LLM response valid for step', { nextStep });
            } else {
                // LLM response is WRONG - override with correct prompt
                finalResponse = buildStepPrompt(nextStep, newCollected, config);
                logger.warn('[BOOKING LLM] ⚠️ LLM response invalid, using override', {
                    nextStep,
                    llmSaid: llmResponse.reply?.substring(0, 50),
                    override: finalResponse?.substring(0, 50)
                });
            }
            
            // Use LLM's extracted data if it found something we missed
            if (llmResponse.extractedName && !extracted.name) extracted.name = llmResponse.extractedName;
            if (llmResponse.extractedPhone && !extracted.phone) extracted.phone = llmResponse.extractedPhone;
            if (llmResponse.extractedAddress && !extracted.address) extracted.address = llmResponse.extractedAddress;
            if (llmResponse.extractedTime && !extracted.time) extracted.time = llmResponse.extractedTime;
            if (llmResponse.extractedServiceType && !extracted.serviceType) extracted.serviceType = llmResponse.extractedServiceType;
            
        } else {
            // No LLM - use template
            finalResponse = buildStepPrompt(nextStep, newCollected, config);
        }
        
        // ════════════════════════════════════════════════════════════════════════════
        // STEP 6: Handle questions by prepending answer
        // ════════════════════════════════════════════════════════════════════════════
        if (isQuestion && !extracted.time && !extracted.phone && !extracted.address) {
            const answer = this.answerQuestion(userInput, newCollected, config);
            if (answer) {
                finalResponse = `${answer} ${finalResponse}`;
                // Stay on current step since they asked a question
                if (nextStep === currentStep) {
                    // Already staying, good
                } else if (!extracted.name && !extracted.phone && !extracted.address && !extracted.time) {
                    // They just asked a question, didn't give data - stay on step
                    nextStep = currentStep;
                }
            }
        }
        
        const latencyMs = Date.now() - startTime;
        
        return {
            response: finalResponse,
            extracted: {
                name: extracted.name || null,
                phone: extracted.phone || null,
                address: extracted.address || null,
                time: extracted.time || null,
                serviceType: extracted.serviceType || null
            },
            emotion: llmResponse?.emotion || 'neutral',
            isQuestion,
            needsConfirmation: nextStep === 'CONFIRM',
            nextStep,
            llmUsed,
            latencyMs
        };
    }
    
    /**
     * Call LLM-0 via registry for response generation
     * @param {Object} params
     * @param {string} params.callId - Twilio Call SID (for logging)
     * @param {string} params.companyId - Company ID (for logging)
     */
    static async callLLM({ callId, companyId, userInput, currentStep, nextStep, collected, config, companyName, serviceType, isQuestion }) {
        const personality = config.personality || {};
        const bookingPrompts = config.bookingPrompts || {};
        
        const collectedList = [];
        if (collected.serviceType) collectedList.push(`Service: ${collected.serviceType}`);
        if (collected.name) collectedList.push(`Name: ${collected.name}`);
        if (collected.phone) collectedList.push(`Phone: ${collected.phone}`);
        if (collected.address) collectedList.push(`Address: ${collected.address}`);
        if (collected.time) collectedList.push(`Time: ${collected.time}`);
        
        const systemPrompt = `You are the receptionist for ${companyName}. Personality: ${personality.tone || 'warm'}, ${personality.verbosity || 'concise'}.

CURRENT STATE:
- Collected: ${collectedList.length > 0 ? collectedList.join(', ') : 'Nothing yet'}
- Current step: ${currentStep}
- Next step needed: ${nextStep}

YOUR TASK: Generate a SHORT response (max 20 words) that:
1. ${isQuestion ? 'First answers their question briefly, then...' : ''}
2. Asks for the NEXT piece of info: ${STEP_PROMPTS[nextStep] || 'How can I help?'}

CRITICAL RULES:
- NEVER ask for something you already have
- If you have phone, DON'T ask for phone
- If you have address, DON'T ask for address
- Your response MUST end asking for: ${nextStep}
${collected.name ? `- Use their name: ${collected.name}` : ''}

Extract from their input:
- Name: from "my name is X" or "I'm X"
- Phone: any 10-digit number
- Address: street numbers + street name
- Time: morning/afternoon/tomorrow/asap
- Service type: repair = broken/fix/not working, maintenance = tune-up/check/cleaning

OUTPUT JSON:
{
  "reply": "your response asking for ${nextStep}",
  "extractedName": "name or null",
  "extractedPhone": "phone or null", 
  "extractedAddress": "address or null",
  "extractedTime": "time or null",
  "extractedServiceType": "repair|maintenance|null",
  "emotion": "neutral|friendly|frustrated|angry"
}`;

        // ════════════════════════════════════════════════════════════════
        // CALL LLM-0 via REGISTRY (THE ONLY ALLOWED PATH)
        // ════════════════════════════════════════════════════════════════
        const response = await callLLM0({
            callId: callId || 'booking-unknown',
            companyId: companyId || 'booking-unknown',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userInput }
            ],
            temperature: 0.7,
            max_tokens: 150,
            response_format: { type: 'json_object' },
            metadata: {
                source: 'BookingConversationLLM',
                step: currentStep,
                nextStep
            }
        });
        
        const content = response.choices[0]?.message?.content;
        return JSON.parse(content);
    }
    
    /**
     * Extract ALL booking fields from input
     */
    static extractAllFields(input, existing = {}) {
        const extracted = {
            name: null,
            phone: null,
            address: null,
            time: null,
            serviceType: null
        };
        
        if (!input) return extracted;
        
        // Convert number words first for address parsing
        const converted = convertNumberWordsToDigits(input);
        
        // Extract name (if we don't have one)
        if (!existing.name) {
            extracted.name = this.extractName(input);
        }
        
        // Extract phone (if we don't have one)
        if (!existing.phone) {
            extracted.phone = this.extractPhone(converted);
        }
        
        // Extract address (if we don't have one) - use converted input
        if (!existing.address) {
            extracted.address = this.extractAddress(converted);
        }
        
        // Extract time (if we don't have one)
        if (!existing.time) {
            extracted.time = this.extractTime(input);
        }
        
        // Extract service type (if we don't have one)
        if (!existing.serviceType) {
            extracted.serviceType = this.extractServiceType(input);
        }
        
        return extracted;
    }
    
    /**
     * Determine the next booking step based on what we have
     */
    static determineNextStep(currentStep, collected, config) {
        // Service type clarification REMOVED Dec 2025 - Triage handles this
        const needsServiceType = false; // Disabled
        
        // Priority order of slots
        if (needsServiceType && currentStep === 'ASK_NAME') {
            // If they haven't told us service type yet and we're about to ask name
            // Maybe we should ask service type first (optional - depends on config)
        }
        
        // Check what's missing
        if (!collected.name) return 'ASK_NAME';
        if (!collected.phone) return 'ASK_PHONE';
        if (!collected.address) return 'ASK_ADDRESS';
        if (!collected.time) return 'ASK_TIME';
        
        // All slots filled
        return 'POST_BOOKING';
    }
    
    /**
     * Answer common questions during booking
     */
    static answerQuestion(userInput, collected, config) {
        const lower = userInput.toLowerCase();
        
        if (/do you|are you|you do/i.test(lower) && /ac|air condition|hvac|service/i.test(lower)) {
            return "Yes, we do! We can help you with that.";
        }
        if (/how much|cost|price|charge/i.test(lower)) {
            return "The technician will provide an estimate on-site before any work.";
        }
        if (/how long|take|duration/i.test(lower)) {
            return "It depends on the issue, but the tech will give you a timeframe on arrival.";
        }
        if (/why|coming out|what for/i.test(lower)) {
            const service = collected.serviceType || 'service';
            return `For your ${service} request.`;
        }
        if (/when|what time|arrive/i.test(lower) && collected.time) {
            return `We have you scheduled for ${collected.time}.`;
        }
        if (/address|where|location/i.test(lower) && collected.address) {
            return `I have ${collected.address}.`;
        }
        
        return null;
    }
    
    // ════════════════════════════════════════════════════════════════════════════
    // EXTRACTION HELPERS
    // ════════════════════════════════════════════════════════════════════════════
    
    static extractName(input) {
        if (!input) return null;
        
        const patterns = [
            /(?:my name is|my name's|i'm|i am|it's|this is|call me)\s+([a-z]+(?:\s+[a-z]+)?)/i,
            /(?:sure,?\s*)?(?:my name is|i'm|i am)\s+([a-z]+)/i,
            /^(?:hi,?\s*)?(?:this is|i'm|i am)\s+([a-z]+)/i,
        ];
        
        for (const pattern of patterns) {
            const match = input.match(pattern);
            if (match && match[1]) {
                const name = match[1].trim();
                // Filter out non-names
                if (/^(i|my|the|a|an|it|this|that|need|want|calling|here)$/i.test(name)) continue;
                return name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();
            }
        }
        
        // If input is short and looks like just a name
        if (input.length < 25) {
            const cleaned = input.replace(/^(sure|yes|hi|hey|okay|ok|um|uh)[,.\s]*/i, '').trim();
            const words = cleaned.split(/\s+/).filter(w => w.length > 1);
            if (words.length >= 1 && words.length <= 2) {
                const firstWord = words[0].toLowerCase();
                const notNames = ['i', 'my', 'the', 'a', 'an', 'it', 'this', 'that', 'need', 'want', 'can', 'could', 'what', 'yes', 'no'];
                if (!notNames.includes(firstWord) && /^[a-z]+$/i.test(words[0])) {
                    return words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
                }
            }
        }
        
        return null;
    }
    
    static extractPhone(input) {
        if (!input) return null;
        
        // Extract digits only
        const digits = input.replace(/\D/g, '');
        
        // Valid phone numbers are 10 or 11 digits
        if (digits.length >= 10 && digits.length <= 11) {
            // Format as XXX-XXX-XXXX
            const normalized = digits.length === 11 ? digits.slice(1) : digits;
            return `${normalized.slice(0, 3)}-${normalized.slice(3, 6)}-${normalized.slice(6)}`;
        }
        
        return null;
    }
    
    static extractAddress(input) {
        if (!input) return null;
        
        // Must have numbers and look like an address
        const hasNumber = /\d/.test(input);
        const hasStreetWord = /\b(street|st|road|rd|avenue|ave|lane|ln|drive|dr|court|ct|way|place|pl|boulevard|blvd|parkway|pkwy|circle|cir)\b/i.test(input);
        
        if (hasNumber && (hasStreetWord || input.length > 10)) {
            // Clean up the address
            let address = input.trim();
            // Remove filler words at start
            address = address.replace(/^(that's|that is|it's|it is|my address is|the address is)\s*/i, '');
            return address;
        }
        
        // If they just said the address without a street type
        if (hasNumber && input.length > 5) {
            return input.trim();
        }
        
        return null;
    }
    
    static extractTime(input) {
        if (!input) return null;
        
        const lower = input.toLowerCase();
        
        // Reject if it's clearly a question
        if (/\?|do you know|when will|how long|why/i.test(input)) {
            return null;
        }
        
        // Time patterns
        const patterns = [
            /\b(morning|afternoon|evening|tonight)\b/i,
            /\b(tomorrow|today|asap|as soon as possible|now|right away|immediately)\b/i,
            /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i,
            /\d{1,2}(:\d{2})?\s*(am|pm)/i,
            /\b(next week|this week|anytime|whenever|earliest|soonest)\b/i,
        ];
        
        for (const pattern of patterns) {
            const match = input.match(pattern);
            if (match) {
                return match[0].toLowerCase().trim();
            }
        }
        
        return null;
    }
    
    static extractServiceType(input) {
        if (!input) return null;
        
        const lower = input.toLowerCase();
        
        // Repair keywords
        if (/repair|broken|not working|doesn't work|fix|won't turn|stopped|issue|problem|emergency/i.test(lower)) {
            return 'repair';
        }
        
        // Maintenance keywords
        if (/maintenance|tune.?up|check|cleaning|routine|regular|annual|inspection|service check/i.test(lower)) {
            return 'maintenance';
        }
        
        return null;
    }
}

module.exports = BookingConversationLLM;
