/**
 * ============================================================================
 * LLM-0 CONTROLS LOADER (Cleaned Feb 2026)
 * ============================================================================
 * 
 * Loads call edge-case handling settings for runtime use.
 * 
 * WHAT'S ACTUALLY USED:
 * - silenceHandling: EdgeCaseHandler.js uses for silence prompts
 * - customerPatience: EdgeCaseHandler.js uses for never-hangup mode
 * 
 * ☢️ NUKED Feb 2026:
 * - loopDetection: Was never consumed (ConversationMemory uses hardcoded defaults)
 * - spamFilter: Was never wired to main call flow
 * - bailoutRules: Was never consumed anywhere
 * - confidenceThresholds: Was never consumed anywhere
 * 
 * USAGE:
 *   const controls = await LLM0ControlsLoader.load(companyId);
 *   const silencePrompt = LLM0ControlsLoader.getSilencePrompt(1, controls);
 * 
 * CACHING: Uses Redis for fast access during calls (5 min TTL)
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

// Default controls - ONLY what's actually used
const DEFAULT_CONTROLS = {
    silenceHandling: {
        enabled: true,
        thresholdSeconds: 5,
        firstPrompt: "I'm still here. Take your time.",
        secondPrompt: "Are you still there? I'm happy to wait.",
        thirdPrompt: "If you need a moment, I can call you back. Just let me know.",
        maxPrompts: 3,
        offerCallback: true,
        callbackMessage: "Would you like me to have someone call you back at this number?"
    },
    customerPatience: {
        enabled: true,
        neverAutoHangup: true,
        maxPatiencePrompts: 5,
        alwaysOfferCallback: true,
        patienceMessage: "No rush at all. I'm here whenever you're ready."
    }
};

class LLM0ControlsLoader {
    
    /**
     * Load LLM-0 controls for a company
     * @param {string} companyId - Company ID
     * @param {Object} company - Optional: company document if already loaded
     * @returns {Object} LLM-0 controls merged with defaults
     */
    static async load(companyId, company = null) {
        try {
            let controls = null;
            
            // Try Redis cache first
            try {
                const { getSharedRedisClient } = require('./redisClientFactory');
                const redisClient = await getSharedRedisClient();
                
                if (redisClient) {
                    const cached = await redisClient.get(`llm0controls:${companyId}`);
                    if (cached) {
                        controls = JSON.parse(cached);
                        logger.debug('[LLM-0 CONTROLS] Loaded from Redis cache', { companyId });
                    }
                }
            } catch (cacheError) {
                logger.debug('[LLM-0 CONTROLS] Redis cache miss or error', { 
                    companyId, 
                    error: cacheError.message 
                });
            }
            
            // If not cached, load from company document
            if (!controls) {
                if (!company) {
                    const v2Company = require('../models/v2Company');
                    company = await v2Company.findById(companyId).lean();
                }
                
                if (company?.aiAgentSettings?.llm0Controls) {
                    controls = company.aiAgentSettings.llm0Controls;
                    
                    // Cache for 5 minutes
                    try {
                        const { getSharedRedisClient } = require('./redisClientFactory');
                        const redisClient = await getSharedRedisClient();
                        if (redisClient) {
                            await redisClient.setex(
                                `llm0controls:${companyId}`,
                                300,
                                JSON.stringify(controls)
                            );
                        }
                    } catch (cacheSetError) {
                        logger.debug('[LLM-0 CONTROLS] Failed to cache', { companyId });
                    }
                }
            }
            
            return this.mergeWithDefaults(controls || {});
            
        } catch (error) {
            logger.error('[LLM-0 CONTROLS] Failed to load, using defaults', {
                companyId,
                error: error.message
            });
            return DEFAULT_CONTROLS;
        }
    }
    
    /**
     * Merge loaded controls with defaults (only used fields)
     */
    static mergeWithDefaults(controls) {
        return {
            silenceHandling: {
                ...DEFAULT_CONTROLS.silenceHandling,
                ...(controls.silenceHandling || {})
            },
            customerPatience: {
                ...DEFAULT_CONTROLS.customerPatience,
                ...(controls.customerPatience || {})
            }
        };
    }
    
    /**
     * Clear cached controls (call after settings are updated)
     */
    static async clearCache(companyId) {
        try {
            const { getSharedRedisClient } = require('./redisClientFactory');
            const redisClient = await getSharedRedisClient();
            if (redisClient) {
                await redisClient.del(`llm0controls:${companyId}`);
                logger.debug('[LLM-0 CONTROLS] Cache cleared', { companyId });
            }
        } catch (error) {
            logger.warn('[LLM-0 CONTROLS] Failed to clear cache', { companyId });
        }
    }
    
    /**
     * Get default controls
     */
    static getDefaults() {
        return DEFAULT_CONTROLS;
    }
    
    // ========================================================================
    // RUNTIME HELPERS - Used by EdgeCaseHandler.js
    // ========================================================================
    
    /**
     * Get the appropriate silence prompt based on count
     */
    static getSilencePrompt(silenceCount, controls) {
        if (!controls?.silenceHandling?.enabled) return null;
        
        const sh = controls.silenceHandling;
        
        if (silenceCount === 1) return sh.firstPrompt;
        if (silenceCount === 2) return sh.secondPrompt;
        if (silenceCount === 3) return sh.thirdPrompt;
        if (silenceCount >= sh.maxPrompts && sh.offerCallback) {
            return sh.callbackMessage;
        }
        
        // Use patience message or fallback
        const patience = controls.customerPatience;
        return patience?.patienceMessage || sh.thirdPrompt || "I'm still here when you're ready.";
    }
}

module.exports = LLM0ControlsLoader;
