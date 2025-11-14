/**
 * ============================================================================
 * TRIAGE BUILDER SERVICE
 * ============================================================================
 * 
 * Purpose: LLM-powered content generator for creating Service Type Triage packages
 * 
 * Role: ADMIN-SIDE CONTENT AUTHORING ONLY
 * - LLM generates triage rules, symptom maps, response scripts
 * - NOT used for runtime call decisions
 * - Admins review/edit output before applying to companies
 * 
 * Output Format:
 * - Frontline-Intel procedural section (how to triage step-by-step)
 * - Cheat Sheet triage map (symptom keywords → serviceType)
 * - Response Library (human-like response variations)
 * 
 * ============================================================================
 */

const openaiClient = require('../config/openai');
const logger = require('../utils/logger');

/**
 * Generate a complete triage package using LLM
 * 
 * @param {string} trade - Trade/industry (e.g., "HVAC", "Plumbing", "Dental")
 * @param {string} situation - Description of triage scenario
 * @param {string[]} serviceTypes - Service type classifications (e.g., ["REPAIR", "MAINTENANCE", "EMERGENCY", "OTHER"])
 * @returns {Promise<Object>} - { frontlineIntelSection, cheatSheetTriageMap, responseLibrary[] }
 */
async function generateTriagePackage(trade, situation, serviceTypes) {
    logger.info('[TRIAGE BUILDER] Generating triage package', {
        trade,
        situationLength: situation.length,
        serviceTypes
    });

    // Validate OpenAI client is available
    if (!openaiClient) {
        throw new Error('OpenAI client not configured. Please set OPENAI_API_KEY environment variable.');
    }

    // Build structured prompt
    const systemPrompt = buildSystemPrompt(trade, serviceTypes, situation);
    const userPrompt = buildUserPrompt(situation, serviceTypes);

    logger.debug('[TRIAGE BUILDER] Calling OpenAI', {
        systemPromptLength: systemPrompt.length,
        userPromptLength: userPrompt.length,
        model: 'gpt-4o-mini'
    });

    // Call OpenAI
    let completion;
    try {
        completion = await openaiClient.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.7,
            max_tokens: 2000
        });
    } catch (error) {
        logger.error('[TRIAGE BUILDER] OpenAI API call failed', {
            error: error.message
        });
        throw new Error(`LLM API call failed: ${error.message}`);
    }

    // Extract response
    const rawResponse = completion.choices[0]?.message?.content || '';
    
    if (!rawResponse) {
        throw new Error('LLM returned empty response');
    }

    logger.debug('[TRIAGE BUILDER] LLM response received', {
        length: rawResponse.length,
        preview: rawResponse.substring(0, 200)
    });

    // Parse response into structured sections
    const parsed = parseTriagePackage(rawResponse);

    logger.info('[TRIAGE BUILDER] Triage package generated successfully', {
        frontlineIntelLength: parsed.frontlineIntelSection.length,
        cheatSheetLength: parsed.cheatSheetTriageMap.length,
        responseCount: parsed.responseLibrary.length
    });

    return parsed;
}

/**
 * Build system prompt for LLM
 */
function buildSystemPrompt(trade, serviceTypes, situation) {
    const serviceTypesStr = serviceTypes.join(', ');

    return `You are generating triage rules and scripts for an AI receptionist system called ClientsVia.ai.

Trade: ${trade}
Service types: ${serviceTypesStr}

Situation we are solving:
"${situation}"

Your job is to output a COMPLETE TRIAGE PACKAGE in strict sections.

You MUST use EXACTLY these section headers (case-sensitive):

### FRONTLINE_INTEL_SECTION
### CHEAT_SHEET_TRIAGE_MAP
### RESPONSE_LIBRARY

---

SECTION 1: FRONTLINE_INTEL_SECTION

Write a procedural "how to triage this situation" block in the same style as existing Frontline-Intel documents:
- Human tone, bullet rules, clear steps
- Include when to classify as each serviceType (${serviceTypesStr})
- Explain how to politely prevent "downgrade to cheaper service" when symptoms indicate a higher-priority serviceType
- Be specific to the ${trade} industry
- Use conversational, professional language

SECTION 2: CHEAT_SHEET_TRIAGE_MAP

Write a compressed, quick-reference triage map:
- Keywords and phrases to watch for (specific to ${trade})
- Symptom → serviceType mapping
- Downgrade prevention summary
- UNKNOWN handling rule
- Format as a concise lookup table

SECTION 3: RESPONSE_LIBRARY

Generate 7-10 short, human-like response variations the agent can use when the customer tries to pick the wrong service type for their situation (e.g., wants maintenance but clearly needs repair).

Requirements:
- Tone: calm, professional, empathetic, firm
- Each response: 1-2 sentences max, voice-ready
- Format each line with a bullet (- or *)
- Natural language, not robotic
- Specific to ${trade} terminology

CRITICAL: Output EXACTLY in this structure with these headers:

### FRONTLINE_INTEL_SECTION
[your procedural triage content here]

### CHEAT_SHEET_TRIAGE_MAP
[your quick-reference map here]

### RESPONSE_LIBRARY
- [response line 1]
- [response line 2]
- [response line 3]
...

Do NOT add any other text, explanations, or formatting outside this structure.`;
}

/**
 * Build user prompt (concise request)
 */
function buildUserPrompt(situation, serviceTypes) {
    return `Generate the complete triage package for this situation:

"${situation}"

Service types to classify: ${serviceTypes.join(', ')}

Use the exact section headers specified and follow all formatting requirements.`;
}

/**
 * Parse LLM response into structured sections
 * 
 * @param {string} rawResponse - Raw LLM output
 * @returns {Object} - { frontlineIntelSection, cheatSheetTriageMap, responseLibrary }
 */
function parseTriagePackage(rawResponse) {
    // Extract FRONTLINE_INTEL_SECTION
    const frontlineMatch = rawResponse.match(/### FRONTLINE_INTEL_SECTION\s*\n([\s\S]*?)(?=### |$)/);
    const frontlineIntelSection = frontlineMatch ? frontlineMatch[1].trim() : null;

    // Extract CHEAT_SHEET_TRIAGE_MAP
    const cheatsheetMatch = rawResponse.match(/### CHEAT_SHEET_TRIAGE_MAP\s*\n([\s\S]*?)(?=### |$)/);
    const cheatSheetTriageMap = cheatsheetMatch ? cheatsheetMatch[1].trim() : null;

    // Extract RESPONSE_LIBRARY
    const responsesMatch = rawResponse.match(/### RESPONSE_LIBRARY\s*\n([\s\S]*?)$/);
    let responseLibrary = [];
    
    if (responsesMatch) {
        // Extract lines starting with - or * (bullet points)
        responseLibrary = responsesMatch[1]
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.startsWith('-') || line.startsWith('*'))
            .map(line => line.replace(/^[-*]\s*/, '').trim())
            .filter(line => line.length > 0);
    }

    // Validate all required sections are present
    const errors = [];
    
    if (!frontlineIntelSection) {
        errors.push('FRONTLINE_INTEL_SECTION missing or empty');
    }
    
    if (!cheatSheetTriageMap) {
        errors.push('CHEAT_SHEET_TRIAGE_MAP missing or empty');
    }
    
    if (responseLibrary.length === 0) {
        errors.push('RESPONSE_LIBRARY missing or empty');
    }

    if (errors.length > 0) {
        logger.error('[TRIAGE BUILDER] Parsing failed - missing sections', {
            errors,
            rawResponsePreview: rawResponse.substring(0, 500)
        });
        throw new Error(`LLM output missing required sections: ${errors.join(', ')}`);
    }

    return {
        frontlineIntelSection,
        cheatSheetTriageMap,
        responseLibrary
    };
}

module.exports = {
    generateTriagePackage
};

