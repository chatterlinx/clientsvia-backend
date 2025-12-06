/**
 * ============================================================================
 * LLM-0 CONTROLS LOADER
 * ============================================================================
 * 
 * Loads and provides LLM-0 controls for runtime use.
 * These settings control Brain-1's behavior: silence handling, loops, spam, etc.
 * 
 * USAGE:
 *   const controls = await LLM0ControlsLoader.load(companyId);
 *   const silenceThreshold = controls.silenceHandling.thresholdSeconds;
 * 
 * CACHING: Uses Redis for fast access during calls
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');

// Default controls (matches the schema in v2Company.js)
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
    loopDetection: {
        enabled: true,
        maxRepeatedResponses: 3,
        detectionWindow: 5,
        onLoopAction: 'escalate',
        escalationMessage: "I want to make sure I'm helping you correctly. Let me connect you with someone who can assist."
    },
    spamFilter: {
        enabled: true,
        telemarketerPhrases: [
            'google listing',
            'google business',
            'verify your business',
            'seo services',
            'website ranking',
            'marketing services',
            'special offer',
            'are you the owner',
            'decision maker',
            'person in charge'
        ],
        onSpamDetected: 'polite_dismiss',
        dismissMessage: "I appreciate the call, but we're not interested in any services at this time. Thank you, goodbye.",
        autoAddToBlacklist: false,
        logToBlackBox: true
    },
    customerPatience: {
        enabled: true,
        neverAutoHangup: true,
        maxPatiencePrompts: 5,
        alwaysOfferCallback: true,
        patienceMessage: "No rush at all. I'm here whenever you're ready."
    },
    bailoutRules: {
        enabled: true,
        maxTurnsBeforeEscalation: 10,
        confusionThreshold: 0.3,
        escalateOnBailout: true,
        bailoutMessage: "I want to make sure you get the help you need. Let me transfer you to our team.",
        transferTarget: null
    },
    confidenceThresholds: {
        highConfidence: 0.85,
        mediumConfidence: 0.65,
        lowConfidence: 0.45,
        fallbackToLLM: 0.4
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
            // If company not provided, try to load from cache or DB
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
                                300, // 5 minutes
                                JSON.stringify(controls)
                            );
                        }
                    } catch (cacheSetError) {
                        logger.debug('[LLM-0 CONTROLS] Failed to cache', { companyId });
                    }
                }
            }
            
            // Merge with defaults (ensures all fields exist)
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
     * Merge loaded controls with defaults
     */
    static mergeWithDefaults(controls) {
        return {
            silenceHandling: {
                ...DEFAULT_CONTROLS.silenceHandling,
                ...(controls.silenceHandling || {})
            },
            loopDetection: {
                ...DEFAULT_CONTROLS.loopDetection,
                ...(controls.loopDetection || {})
            },
            spamFilter: {
                ...DEFAULT_CONTROLS.spamFilter,
                ...(controls.spamFilter || {}),
                // Ensure array is preserved
                telemarketerPhrases: controls.spamFilter?.telemarketerPhrases || 
                    DEFAULT_CONTROLS.spamFilter.telemarketerPhrases
            },
            customerPatience: {
                ...DEFAULT_CONTROLS.customerPatience,
                ...(controls.customerPatience || {})
            },
            bailoutRules: {
                ...DEFAULT_CONTROLS.bailoutRules,
                ...(controls.bailoutRules || {})
            },
            confidenceThresholds: {
                ...DEFAULT_CONTROLS.confidenceThresholds,
                ...(controls.confidenceThresholds || {})
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
    // RUNTIME HELPERS - Use these in call handlers
    // ========================================================================
    
    /**
     * Check if input matches spam phrases
     */
    static isSpamPhrase(input, controls) {
        if (!controls?.spamFilter?.enabled) return false;
        
        const lowerInput = input.toLowerCase();
        const phrases = controls.spamFilter.telemarketerPhrases || [];
        
        return phrases.some(phrase => lowerInput.includes(phrase.toLowerCase()));
    }
    
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
        
        return sh.patienceMessage || "I'm still here when you're ready.";
    }
    
    /**
     * Check if we should escalate due to loop
     */
    static shouldEscalateLoop(repeatedCount, controls) {
        if (!controls?.loopDetection?.enabled) return false;
        return repeatedCount >= controls.loopDetection.maxRepeatedResponses;
    }
    
    /**
     * Check if we should bailout
     */
    static shouldBailout(turnCount, confusionScore, controls) {
        if (!controls?.bailoutRules?.enabled) return false;
        
        const br = controls.bailoutRules;
        return turnCount >= br.maxTurnsBeforeEscalation || 
               confusionScore <= br.confusionThreshold;
    }
    
    /**
     * Check confidence level
     */
    static getConfidenceLevel(score, controls) {
        const ct = controls?.confidenceThresholds || DEFAULT_CONTROLS.confidenceThresholds;
        
        if (score >= ct.highConfidence) return 'HIGH';
        if (score >= ct.mediumConfidence) return 'MEDIUM';
        if (score >= ct.lowConfidence) return 'LOW';
        if (score >= ct.fallbackToLLM) return 'FALLBACK';
        return 'UNKNOWN';
    }
}

module.exports = LLM0ControlsLoader;

