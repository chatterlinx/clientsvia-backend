/**
 * ============================================================================
 * LLM REGISTRY - THE ONLY GATEWAY TO AI BRAINS
 * ============================================================================
 * 
 * CRITICAL ARCHITECTURE RULE:
 * This file is the ONLY place in the entire codebase that is allowed to
 * make OpenAI/LLM calls during live customer calls.
 * 
 * TWO BRAINS EXIST. ONLY TWO. EVER.
 * 
 * 1. LLM-0 (Frontline Brain)
 *    - Handles ALL conversation: discovery, decision, booking
 *    - Called via: callLLM0()
 * 
 * 2. TIER3 (Fallback Brain)  
 *    - Only fires when Tier1/Tier2 knowledge has no match
 *    - Called via: callTier3Fallback()
 * 
 * RULE: If you see ANY other file importing openai and calling it
 * during a live call, THAT IS A BUG. Hunt it down and kill it.
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

// Import the configured OpenAI client
let openaiClient;
try {
    openaiClient = require('../config/openai');
} catch (e) {
    logger.error('[LLM REGISTRY] Failed to load OpenAI client', { error: e.message });
}

// Import BlackBox for logging (optional - don't crash if missing)
let BlackBoxLogger;
try {
    BlackBoxLogger = require('./BlackBoxLogger');
} catch (e) {
    logger.warn('[LLM REGISTRY] BlackBoxLogger not available');
}

// ============================================================================
// CONFIGURATION
// ============================================================================

const CONFIG = {
    LLM0_MODEL: process.env.LLM0_MODEL || 'gpt-4.1-mini',
    TIER3_MODEL: process.env.TIER3_MODEL || 'gpt-4.1-mini',
    LLM0_TIMEOUT_MS: parseInt(process.env.LLM0_TIMEOUT_MS) || 4000,
    TIER3_TIMEOUT_MS: parseInt(process.env.TIER3_TIMEOUT_MS) || 5000,
    LOG_PROMPTS: process.env.LOG_LLM_PROMPTS === 'true'
};

// ============================================================================
// LLM-0: FRONTLINE BRAIN
// ============================================================================
// This is the ONLY function that should be called for frontline AI responses.
// It handles: greetings, discovery, decisions, booking, everything conversational.
// ============================================================================

/**
 * Call LLM-0 (Frontline Brain)
 * 
 * @param {Object} payload - OpenAI chat completion payload
 * @param {string} payload.callId - Twilio Call SID (required for logging)
 * @param {string} payload.companyId - Company ID (required for logging)
 * @param {Array} payload.messages - OpenAI messages array
 * @param {number} [payload.temperature] - Temperature (default 0.7)
 * @param {number} [payload.max_tokens] - Max tokens (default 300)
 * @param {Object} [payload.response_format] - Response format (e.g., { type: 'json_object' })
 * @param {Object} [payload.metadata] - Additional metadata for logging
 * @returns {Promise<Object>} OpenAI response
 */
async function callLLM0(payload) {
    const startTime = Date.now();
    const { callId, companyId, messages, temperature = 0.7, max_tokens = 300, response_format, metadata = {} } = payload;
    
    // Validation
    if (!callId) {
        logger.error('[LLM REGISTRY] callLLM0 called without callId - this is a bug!');
    }
    if (!messages || !Array.isArray(messages)) {
        throw new Error('[LLM REGISTRY] callLLM0 requires messages array');
    }
    
    logger.info('[LLM REGISTRY] 🧠 LLM-0 (Frontline Brain) called', {
        callId,
        companyId,
        messageCount: messages.length,
        model: CONFIG.LLM0_MODEL
    });
    
    if (CONFIG.LOG_PROMPTS) {
        logger.debug('[LLM REGISTRY] LLM-0 prompt:', {
            systemPrompt: messages.find(m => m.role === 'system')?.content?.substring(0, 500),
            userMessage: messages.find(m => m.role === 'user')?.content?.substring(0, 200)
        });
    }
    
    try {
        // Build OpenAI request options
        const requestOptions = {
            model: CONFIG.LLM0_MODEL,
            messages,
            temperature,
            max_tokens
        };
        
        // Add response_format if specified (for JSON responses)
        if (response_format) {
            requestOptions.response_format = response_format;
        }
        
        // Make the OpenAI call with timeout
        const response = await Promise.race([
            openaiClient.chat.completions.create(requestOptions),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`LLM-0 timeout (${CONFIG.LLM0_TIMEOUT_MS}ms)`)), CONFIG.LLM0_TIMEOUT_MS)
            )
        ]);
        
        const latencyMs = Date.now() - startTime;
        const responseText = response.choices?.[0]?.message?.content || '';
        const tokensUsed = response.usage?.total_tokens || 0;
        
        logger.info('[LLM REGISTRY] ✅ LLM-0 response received', {
            callId,
            companyId,
            latencyMs,
            tokensUsed,
            responsePreview: responseText.substring(0, 100)
        });
        
        // Log to Black Box with BRAIN IDENTIFIER
        if (BlackBoxLogger) {
            await BlackBoxLogger.logEvent({
                callId,
                companyId,
                type: 'LLM_RESPONSE',
                data: {
                    brain: 'LLM0',  // CRITICAL: Always identify which brain spoke
                    model: CONFIG.LLM0_MODEL,
                    latencyMs,
                    tokensUsed,
                    responsePreview: responseText.substring(0, 200),
                    ...metadata
                }
            }).catch(err => {
                logger.error('[LLM REGISTRY] Failed to log to Black Box', { error: err.message });
            });
        }
        
        return {
            ...response,
            _brain: 'LLM0',  // Tag the response so callers know which brain
            _latencyMs: latencyMs
        };
        
    } catch (error) {
        const latencyMs = Date.now() - startTime;
        
        logger.error('[LLM REGISTRY] ❌ LLM-0 call failed', {
            callId,
            companyId,
            error: error.message,
            latencyMs
        });
        
        // Log failure to Black Box
        if (BlackBoxLogger) {
            await BlackBoxLogger.logEvent({
                callId,
                companyId,
                type: 'LLM_ERROR',
                data: {
                    brain: 'LLM0',
                    model: CONFIG.LLM0_MODEL,
                    error: error.message,
                    latencyMs
                }
            }).catch(() => {});
        }
        
        throw error;
    }
}

// ============================================================================
// TIER-3: FALLBACK BRAIN
// ============================================================================
// This is ONLY called when Tier1 (rules) and Tier2 (semantic) have no match.
// It's the "last resort" brain for edge cases.
// ============================================================================

/**
 * Call Tier-3 LLM (Fallback Brain)
 * 
 * @param {Object} payload - OpenAI chat completion payload
 * @param {string} payload.callId - Twilio Call SID (required for logging)
 * @param {string} payload.companyId - Company ID (required for logging)
 * @param {Array} payload.messages - OpenAI messages array
 * @param {number} [payload.temperature] - Temperature (default 0.5)
 * @param {number} [payload.max_tokens] - Max tokens (default 200)
 * @param {Object} [payload.response_format] - Response format (e.g., { type: 'json_object' })
 * @param {Object} [payload.metadata] - Additional metadata for logging
 * @returns {Promise<Object>} OpenAI response
 */
async function callTier3Fallback(payload) {
    const startTime = Date.now();
    const { callId, companyId, messages, temperature = 0.5, max_tokens = 200, response_format, metadata = {} } = payload;
    
    // Validation
    if (!callId) {
        logger.error('[LLM REGISTRY] callTier3Fallback called without callId - this is a bug!');
    }
    if (!messages || !Array.isArray(messages)) {
        throw new Error('[LLM REGISTRY] callTier3Fallback requires messages array');
    }
    
    logger.info('[LLM REGISTRY] 🔥 TIER-3 (Fallback Brain) called', {
        callId,
        companyId,
        messageCount: messages.length,
        model: CONFIG.TIER3_MODEL,
        reason: metadata.reason || 'No Tier1/Tier2 match'
    });
    
    try {
        // Build OpenAI request options
        const requestOptions = {
            model: CONFIG.TIER3_MODEL,
            messages,
            temperature,
            max_tokens
        };
        
        // Add response_format if specified (for JSON responses)
        if (response_format) {
            requestOptions.response_format = response_format;
        }
        
        // Make the OpenAI call with timeout
        const response = await Promise.race([
            openaiClient.chat.completions.create(requestOptions),
            new Promise((_, reject) => 
                setTimeout(() => reject(new Error(`Tier-3 timeout (${CONFIG.TIER3_TIMEOUT_MS}ms)`)), CONFIG.TIER3_TIMEOUT_MS)
            )
        ]);
        
        const latencyMs = Date.now() - startTime;
        const responseText = response.choices?.[0]?.message?.content || '';
        const tokensUsed = response.usage?.total_tokens || 0;
        
        logger.info('[LLM REGISTRY] ✅ TIER-3 response received', {
            callId,
            companyId,
            latencyMs,
            tokensUsed,
            responsePreview: responseText.substring(0, 100)
        });
        
        // Log to Black Box with BRAIN IDENTIFIER
        if (BlackBoxLogger) {
            await BlackBoxLogger.logEvent({
                callId,
                companyId,
                type: 'LLM_RESPONSE',
                data: {
                    brain: 'TIER3',  // CRITICAL: Always identify which brain spoke
                    model: CONFIG.TIER3_MODEL,
                    latencyMs,
                    tokensUsed,
                    responsePreview: responseText.substring(0, 200),
                    tier: 3,
                    ...metadata
                }
            }).catch(err => {
                logger.error('[LLM REGISTRY] Failed to log to Black Box', { error: err.message });
            });
        }
        
        return {
            ...response,
            _brain: 'TIER3',  // Tag the response so callers know which brain
            _latencyMs: latencyMs
        };
        
    } catch (error) {
        const latencyMs = Date.now() - startTime;
        
        logger.error('[LLM REGISTRY] ❌ TIER-3 call failed', {
            callId,
            companyId,
            error: error.message,
            latencyMs
        });
        
        // Log failure to Black Box
        if (BlackBoxLogger) {
            await BlackBoxLogger.logEvent({
                callId,
                companyId,
                type: 'LLM_ERROR',
                data: {
                    brain: 'TIER3',
                    model: CONFIG.TIER3_MODEL,
                    error: error.message,
                    latencyMs
                }
            }).catch(() => {});
        }
        
        throw error;
    }
}

// ============================================================================
// ADMIN-ONLY LLM CALLS (NOT FOR LIVE CALLS)
// ============================================================================
// These are for admin tools like triage card generation, suggestions, etc.
// They are NOT allowed to be called during live customer calls.
// ============================================================================

/**
 * Call LLM for admin/tool purposes (NOT live calls)
 * 
 * @param {Object} payload - OpenAI payload
 * @param {string} payload.purpose - What this is for (logging)
 * @returns {Promise<Object>} OpenAI response
 */
async function callAdminLLM(payload) {
    const { purpose, messages, temperature = 0.7, max_tokens = 1000 } = payload;
    
    logger.info('[LLM REGISTRY] 🔧 ADMIN LLM called (not a live call)', {
        purpose,
        messageCount: messages?.length
    });
    
    // This is for admin tools only - no Black Box logging needed
    const response = await openaiClient.chat.completions.create({
        model: CONFIG.LLM0_MODEL,
        messages,
        temperature,
        max_tokens
    });
    
    return {
        ...response,
        _brain: 'ADMIN',
        _purpose: purpose
    };
}

// ============================================================================
// HEALTH CHECK
// ============================================================================

/**
 * Check if LLM registry is healthy
 */
async function healthCheck() {
    return {
        status: openaiClient ? 'healthy' : 'unhealthy',
        config: {
            llm0Model: CONFIG.LLM0_MODEL,
            tier3Model: CONFIG.TIER3_MODEL,
            llm0TimeoutMs: CONFIG.LLM0_TIMEOUT_MS,
            tier3TimeoutMs: CONFIG.TIER3_TIMEOUT_MS
        }
    };
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
    // The ONLY two functions allowed for live calls
    callLLM0,
    callTier3Fallback,
    
    // Admin-only (not for live calls)
    callAdminLLM,
    
    // Health check
    healthCheck,
    
    // Config (read-only)
    CONFIG
};

