/**
 * ============================================================================
 * RESPONSE CONSTRUCTOR - THE ONLY VOICE
 * ============================================================================
 * 
 * CRITICAL ARCHITECTURAL RULE:
 * This is the ONLY module in the entire codebase that is allowed to build
 * the final response string sent to Twilio/TTS.
 * 
 * NO OTHER MODULE should assemble a full reply for the caller.
 * 
 * INPUTS:
 * - llm0Behavior: Mood, tone, pace, filler from LLM0BehaviorAnalyzer
 * - triage: Intent, route, openingLine from TriageRouter
 * - scenario: Response content from Brain-2 (3-Tier engine)
 * - isFirstTurnForScenario: Whether this is the first turn in this scenario
 * 
 * OUTPUT:
 * - Single unified response (text + ssml)
 * 
 * FLOW:
 * 1. Optional filler from LLM-0 ("Alright,", "Okay,", etc.)
 * 2. Opening line from Triage (ONLY on first turn of scenario)
 * 3. Scenario content from Brain-2 (the actual HVAC/business answer)
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

/**
 * Build the final response for Twilio/TTS
 * 
 * @param {Object} params
 * @param {Object} params.context - Call context (callId, companyId, turnNumber)
 * @param {Object|null} params.llm0Behavior - Behavior analysis from LLM-0
 * @param {Object|null} params.triage - Triage result with openingLine
 * @param {Object} params.scenario - Scenario result from Brain-2
 * @param {boolean} params.isFirstTurnForScenario - Is this first turn for this scenario?
 * @returns {Object} - { text, ssml, meta }
 */
function buildFinalResponse({ context, llm0Behavior, triage, scenario, isFirstTurnForScenario }) {
    const startTime = Date.now();
    const chunks = [];
    const sources = [];
    
    logger.debug('[RESPONSE CONSTRUCTOR] Building final response', {
        callId: context?.callId,
        turnNumber: context?.turnNumber,
        isFirstTurn: isFirstTurnForScenario,
        hasLLM0: !!llm0Behavior,
        hasTriage: !!triage,
        hasScenario: !!scenario
    });
    
    // ========================================================================
    // STEP 1: Optional filler from LLM-0 behavior
    // ========================================================================
    // These are conversational micro-words like "Alright,", "Okay,", "Got it,"
    // They make the agent sound more human and natural.
    // ========================================================================
    if (llm0Behavior?.suggestedFiller) {
        const filler = llm0Behavior.suggestedFiller.trim();
        if (filler) {
            chunks.push(filler);
            sources.push('llm0.filler');
            logger.debug('[RESPONSE CONSTRUCTOR] Added LLM-0 filler', { filler });
        }
    }
    
    // ========================================================================
    // STEP 2: Triage opening line (ONLY on first turn of scenario)
    // ========================================================================
    // The opening line is a micro-acknowledgment like:
    // "I can help you with that, let me get some details."
    // It ONLY appears once, when first entering a scenario.
    // ========================================================================
    if (isFirstTurnForScenario && triage?.openingLine) {
        const openingLine = triage.openingLine.trim();
        if (openingLine) {
            chunks.push(openingLine);
            sources.push('triage.openingLine');
            logger.debug('[RESPONSE CONSTRUCTOR] Added triage openingLine', { 
                openingLine: openingLine.substring(0, 50) 
            });
        }
    }
    
    // ========================================================================
    // STEP 3: Scenario content from Brain-2 (the actual answer)
    // ========================================================================
    // This is the REAL content from the 3-Tier engine.
    // It includes acknowledgment of what caller said + next question/info.
    // ========================================================================
    if (scenario?.response?.full) {
        const content = scenario.response.full.trim();
        if (content) {
            chunks.push(content);
            sources.push('scenario.content');
            logger.debug('[RESPONSE CONSTRUCTOR] Added scenario content', { 
                contentLength: content.length,
                preview: content.substring(0, 50)
            });
        }
    } else if (scenario?.response) {
        // Fallback: scenario.response might be a string directly
        const content = typeof scenario.response === 'string' 
            ? scenario.response.trim() 
            : '';
        if (content) {
            chunks.push(content);
            sources.push('scenario.content');
            logger.debug('[RESPONSE CONSTRUCTOR] Added scenario content (string fallback)', { 
                contentLength: content.length 
            });
        }
    } else if (scenario?.text) {
        // Another fallback: some handlers might use .text directly
        const content = scenario.text.trim();
        if (content) {
            chunks.push(content);
            sources.push('scenario.text');
            logger.debug('[RESPONSE CONSTRUCTOR] Added scenario text fallback', { 
                contentLength: content.length 
            });
        }
    }
    
    // ========================================================================
    // STEP 4: Combine chunks into final text
    // ========================================================================
    const text = chunks.filter(Boolean).join(' ').trim();
    
    // ========================================================================
    // STEP 5: Build SSML with style adjustments from LLM-0
    // ========================================================================
    const ssml = buildSSML(text, llm0Behavior);
    
    const result = {
        text,
        ssml,
        meta: {
            callId: context?.callId || 'unknown',
            companyId: context?.companyId || 'unknown',
            turnNumber: context?.turnNumber || 0,
            sources,
            constructedAt: new Date().toISOString(),
            constructionMs: Date.now() - startTime
        }
    };
    
    logger.info('[RESPONSE CONSTRUCTOR] ✅ Final response built', {
        callId: context?.callId,
        turnNumber: context?.turnNumber,
        textLength: text.length,
        sources,
        constructionMs: result.meta.constructionMs
    });
    
    return result;
}

/**
 * Build SSML wrapper with style adjustments from LLM-0 behavior
 * 
 * @param {string} text - Plain text content
 * @param {Object|null} llm0Behavior - Behavior analysis with style hints
 * @returns {string} - SSML-wrapped text
 */
function buildSSML(text, llm0Behavior) {
    if (!text) {
        return '<speak></speak>';
    }
    
    // Default prosody values
    let rate = 'medium';
    let pitch = 'medium';
    
    // Adjust based on LLM-0 behavior analysis
    if (llm0Behavior?.style) {
        // Map pace to SSML rate
        switch (llm0Behavior.style.pace) {
            case 'slow':
                rate = 'slow';
                break;
            case 'fast':
                rate = 'fast';
                break;
            default:
                rate = 'medium';
        }
        
        // Map tone to SSML pitch (rough approximation)
        switch (llm0Behavior.style.tone) {
            case 'warm':
            case 'friendly':
                pitch = 'medium';
                break;
            case 'calming':
                pitch = 'low';
                rate = 'slow';
                break;
            case 'direct':
            case 'professional':
                pitch = 'medium';
                break;
            default:
                pitch = 'medium';
        }
    }
    
    // Handle mood-based adjustments
    if (llm0Behavior?.mood?.current === 'frustrated' || llm0Behavior?.mood?.current === 'angry') {
        // Slow down and lower pitch for calming effect
        rate = 'slow';
        pitch = 'low';
    }
    
    // Escape any special characters in text for SSML
    const escapedText = escapeSSML(text);
    
    return `<speak><prosody rate="${rate}" pitch="${pitch}">${escapedText}</prosody></speak>`;
}

/**
 * Escape special characters for SSML
 * 
 * @param {string} text - Raw text
 * @returns {string} - Escaped text safe for SSML
 */
function escapeSSML(text) {
    if (!text) return '';
    
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}

/**
 * Build a simple response without complex construction
 * Used for edge cases like transfers, end calls, errors
 * 
 * @param {Object} params
 * @param {Object} params.context - Call context
 * @param {string} params.text - Simple text to speak
 * @param {string} params.source - Source label for tracing
 * @returns {Object} - { text, ssml, meta }
 */
function buildSimpleResponse({ context, text, source = 'direct' }) {
    const cleanText = (text || '').trim();
    
    return {
        text: cleanText,
        ssml: buildSSML(cleanText, null),
        meta: {
            callId: context?.callId || 'unknown',
            companyId: context?.companyId || 'unknown',
            turnNumber: context?.turnNumber || 0,
            sources: [source],
            constructedAt: new Date().toISOString(),
            constructionMs: 0
        }
    };
}

module.exports = {
    buildFinalResponse,
    buildSimpleResponse,
    buildSSML,
    escapeSSML
};

