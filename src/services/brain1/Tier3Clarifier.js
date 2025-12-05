/**
 * ============================================================================
 * TIER-3 CLARIFIER - Intelligent Fallback Question Generator
 * ============================================================================
 * 
 * When normal routing fails (no triage card match, generic response detected),
 * this module generates a contextual, probing question using company-specific
 * data from the database.
 * 
 * ════════════════════════════════════════════════════════════════════════════
 * MULTI-TENANT SAFETY (NON-NEGOTIABLE):
 * ════════════════════════════════════════════════════════════════════════════
 * 
 * ✅ Uses only:
 *    - company.trade / companyType from DB
 *    - company.serviceTypes from DB
 *    - The actual user text
 * 
 * ❌ FORBIDDEN:
 *    - No "if HVAC then X" logic
 *    - No trade-specific strings in code
 *    - No hardcoded categories
 * 
 * All business meaning comes from the company's database record.
 * The engine is pure traffic control.
 * 
 * ============================================================================
 */

const logger = require('../../../utils/logger');
const OpenAI = require('openai');

// ════════════════════════════════════════════════════════════════════════════
// CONFIGURATION
// ════════════════════════════════════════════════════════════════════════════

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const DEFAULT_TIMEOUT_MS = 3000; // 3 second max for clarifier

/**
 * Generate a contextual clarifying question when normal routing fails.
 * 
 * This is called when:
 * 1. Brain-1 couldn't match a triage card
 * 2. The generated response failed validation (dead-end pattern)
 * 3. We need to keep the conversation going without bailout
 * 
 * @param {Object} params
 * @param {string} params.userText - What the caller said
 * @param {Object} params.company - Company document from DB
 * @param {string} params.callId - Call SID for logging
 * @param {number} params.turnNumber - Current turn in conversation
 * @returns {Promise<Object>} { text: string, source: string, success: boolean }
 */
async function generateClarifyingQuestion({ userText, company, callId, turnNumber = 1 }) {
    const startTime = Date.now();
    
    logger.info('[TIER-3 CLARIFIER] Generating contextual question', {
        callId: callId?.substring(0, 12),
        turnNumber,
        userTextLength: userText?.length,
        companyTrade: company?.trade || company?.companyType
    });
    
    try {
        // ════════════════════════════════════════════════════════════════════════════
        // EXTRACT COMPANY-SPECIFIC DATA FROM DATABASE
        // ════════════════════════════════════════════════════════════════════════════
        // All business context comes from the company record, not from code
        
        const companyName = company?.name || company?.companyName || 'our company';
        const trade = company?.trade || company?.companyType || 'service';
        const serviceTypes = extractServiceTypes(company);
        
        // ════════════════════════════════════════════════════════════════════════════
        // BUILD GENERIC PROMPT USING COMPANY DATA
        // ════════════════════════════════════════════════════════════════════════════
        // The prompt structure is generic. Only the DATA is per-company.
        
        const systemPrompt = buildClarifierSystemPrompt({
            companyName,
            trade,
            serviceTypes
        });
        
        const userPrompt = `The caller said: "${userText}"

Generate ONE short, specific clarifying question (15-25 words max) to understand what they need.

Do NOT say:
- "Is there anything else?"
- "How can I help you?"
- "What can I do for you?"
- "Tell me more"

DO ask about:
- Specific symptoms or issues they're experiencing
- What outcome they're hoping for
- Timing or urgency if relevant

Return ONLY the question, no quotes or explanation.`;

        // ════════════════════════════════════════════════════════════════════════════
        // CALL LLM WITH TIMEOUT
        // ════════════════════════════════════════════════════════════════════════════
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
        
        const response = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            max_tokens: 60,
            temperature: 0.7,
        }, {
            signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        const clarifyingQuestion = response.choices?.[0]?.message?.content?.trim();
        
        if (!clarifyingQuestion || clarifyingQuestion.length < 10) {
            throw new Error('LLM returned empty or too-short response');
        }
        
        const elapsedMs = Date.now() - startTime;
        
        logger.info('[TIER-3 CLARIFIER] ✅ Generated question', {
            callId: callId?.substring(0, 12),
            question: clarifyingQuestion.substring(0, 50),
            elapsedMs
        });
        
        return {
            text: clarifyingQuestion,
            source: 'tier3.clarifier',
            success: true,
            elapsedMs
        };
        
    } catch (error) {
        const elapsedMs = Date.now() - startTime;
        
        logger.warn('[TIER-3 CLARIFIER] ⚠️ Failed, using rule-based fallback', {
            callId: callId?.substring(0, 12),
            error: error.message,
            elapsedMs
        });
        
        // ════════════════════════════════════════════════════════════════════════════
        // RULE-BASED FALLBACK - Still uses company data, no hardcoded trades
        // ════════════════════════════════════════════════════════════════════════════
        
        const fallbackQuestion = buildRuleBasedClarifier({
            userText,
            company,
            turnNumber
        });
        
        return {
            text: fallbackQuestion,
            source: 'tier3.clarifier.fallback',
            success: false,
            error: error.message,
            elapsedMs
        };
    }
}

/**
 * Build the system prompt for the clarifier.
 * Uses company data from DB, no hardcoded business logic.
 */
function buildClarifierSystemPrompt({ companyName, trade, serviceTypes }) {
    // Generic template, filled with per-company data
    let prompt = `You are a helpful phone receptionist for ${companyName}, a ${trade} company.`;
    
    if (serviceTypes && serviceTypes.length > 0) {
        prompt += ` They offer services including: ${serviceTypes.slice(0, 5).join(', ')}.`;
    }
    
    prompt += `

Your job is to ask ONE clarifying question to understand what the caller needs.
Be friendly, professional, and specific. Use natural conversational language.
Do NOT be generic. Ask about the specific situation they described.`;
    
    return prompt;
}

/**
 * Extract service types from company document.
 * Handles different possible field names in the schema.
 */
function extractServiceTypes(company) {
    // Try various field names that might contain service types
    const sources = [
        company?.serviceTypes,
        company?.services,
        company?.aiAgentSettings?.serviceTypes,
        company?.configuration?.serviceTypes,
        company?.businessInfo?.services
    ];
    
    for (const source of sources) {
        if (Array.isArray(source) && source.length > 0) {
            // Handle array of strings or array of objects
            return source.map(s => {
                if (typeof s === 'string') return s;
                if (typeof s === 'object') return s.name || s.label || s.type;
                return null;
            }).filter(Boolean);
        }
    }
    
    return [];
}

/**
 * Rule-based fallback when LLM fails.
 * Still uses company data, still generic engine logic.
 */
function buildRuleBasedClarifier({ userText, company, turnNumber }) {
    const trade = company?.trade || company?.companyType || 'service';
    const lowerText = userText?.toLowerCase() || '';
    
    // Generic patterns - work for any trade
    // The questions adapt based on keywords in user text, not trade type
    
    if (lowerText.includes('not working') || lowerText.includes("won't") || lowerText.includes('broken')) {
        return `I'd like to help with that. Can you tell me when you first noticed the problem?`;
    }
    
    if (lowerText.includes('service') || lowerText.includes('maintenance')) {
        return `I can help schedule that! Is this for routine maintenance or are you experiencing an issue?`;
    }
    
    if (lowerText.includes('appointment') || lowerText.includes('schedule') || lowerText.includes('book')) {
        return `I'll help you get scheduled. What day works best for you?`;
    }
    
    if (lowerText.includes('price') || lowerText.includes('cost') || lowerText.includes('quote')) {
        return `I can get you pricing information. Can you describe what you need done?`;
    }
    
    if (lowerText.includes('urgent') || lowerText.includes('emergency') || lowerText.includes('asap')) {
        return `I understand this is urgent. Can you briefly describe the situation so I can get you the right help?`;
    }
    
    // Default: Generic but still useful
    // Uses the trade from company DB
    return `I can help with your ${trade} needs. Could you tell me a bit more about what's going on?`;
}

module.exports = {
    generateClarifyingQuestion,
    // Exposed for testing
    buildClarifierSystemPrompt,
    buildRuleBasedClarifier,
    extractServiceTypes
};

