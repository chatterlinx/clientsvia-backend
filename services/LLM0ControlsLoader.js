/**
 * ============================================================================
 * CALL HANDLING CONTROLS LOADER (Migrated from LLM-0, March 2026)
 * ============================================================================
 *
 * Loads call edge-case handling settings for runtime use.
 * Source of truth: LLMSettings collection (scope: company:{id}) → callHandling
 * Fallback: v2Company.aiAgentSettings.llm0Controls (legacy, transition safety)
 *
 * WHAT'S USED:
 * - silenceHandling: EdgeCaseHandler.js uses for silence prompts
 * - customerPatience: EdgeCaseHandler.js uses for never-hangup mode
 * - recoveryMessages: v2twilio.js uses for STT recovery phrases
 * - lowConfidenceHandling: v2twilio.js + LowConfidenceHandler.js
 *
 * USAGE:
 *   const controls = await LLM0ControlsLoader.load(companyId);
 *   const silencePrompt = LLM0ControlsLoader.getSilencePrompt(1, controls);
 *   const recovery = await LLM0ControlsLoader.loadRecoveryMessages(companyId);
 *   const lcSettings = await LLM0ControlsLoader.loadLowConfidenceSettings(companyId);
 *
 * CACHING: Uses Redis for fast access during calls (5 min TTL)
 *
 * ============================================================================
 */

const logger = require('../utils/logger');

// Default controls
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

const DEFAULT_RECOVERY = {
    audioUnclear: '',
    silenceRecovery: '',
    connectionCutOut: '',
    generalError: '',
    technicalTransfer: ''
};

const DEFAULT_LOW_CONFIDENCE = {
    enabled: true,
    threshold: 60,
    action: 'repeat',
    repeatPhrase: "Sorry, there's some background noise — could you say that again?",
    maxRepeatsBeforeEscalation: 2,
    escalatePhrase: "I'm having trouble hearing you clearly. Let me get someone to help you.",
    preserveBookingOnLowConfidence: true,
    bookingRepeatPhrase: "Sorry — could you say that again so I can get this right?",
    logToBlackBox: true,
    skipConfirmationOnClearRepeat: true,
    useDeepgramFallback: true,
    deepgramFallbackThreshold: 60,
    deepgramAcceptThreshold: 80
};

class LLM0ControlsLoader {

    /**
     * Load full callHandling settings from LLMSettings, with Redis cache
     * @private
     */
    static async _loadCallHandling(companyId) {
        const cacheKey = `callhandling:${companyId}`;

        // Try Redis cache first
        try {
            const { getSharedRedisClient } = require('./redisClientFactory');
            const redisClient = await getSharedRedisClient();
            if (redisClient) {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    logger.debug('[CALL HANDLING] Loaded from Redis cache', { companyId });
                    return JSON.parse(cached);
                }
            }
        } catch (cacheError) {
            logger.debug('[CALL HANDLING] Redis cache miss', { companyId, error: cacheError.message });
        }

        // Load from LLMSettings (primary source)
        let callHandling = null;
        try {
            const llmSettingsService = require('./llmSettingsService');
            const settings = await llmSettingsService.getSettings(`company:${companyId}`);
            if (settings?.callHandling) {
                callHandling = settings.callHandling;
            }
        } catch (err) {
            logger.warn('[CALL HANDLING] Failed to load from LLMSettings', { companyId, error: err.message });
        }

        // Fallback to v2Company legacy location (transition safety)
        if (!callHandling || !this._hasData(callHandling)) {
            try {
                const v2Company = require('../models/v2Company');
                const company = await v2Company.findById(companyId)
                    .select('aiAgentSettings.llm0Controls')
                    .lean();
                if (company?.aiAgentSettings?.llm0Controls) {
                    const legacy = company.aiAgentSettings.llm0Controls;
                    callHandling = {
                        silenceHandling: legacy.silenceHandling || {},
                        customerPatience: legacy.customerPatience || {},
                        recoveryMessages: legacy.recoveryMessages || {},
                        lowConfidenceHandling: legacy.lowConfidenceHandling || {}
                    };
                    logger.debug('[CALL HANDLING] Loaded from v2Company legacy fallback', { companyId });
                }
            } catch (legacyErr) {
                logger.debug('[CALL HANDLING] Legacy fallback failed', { companyId });
            }
        }

        // Cache result for 5 minutes
        if (callHandling) {
            try {
                const { getSharedRedisClient } = require('./redisClientFactory');
                const redisClient = await getSharedRedisClient();
                if (redisClient) {
                    await redisClient.setex(cacheKey, 300, JSON.stringify(callHandling));
                }
            } catch (cacheSetError) {
                logger.debug('[CALL HANDLING] Failed to cache', { companyId });
            }
        }

        return callHandling || {};
    }

    /**
     * Check if callHandling has any real user data (not just defaults)
     */
    static _hasData(ch) {
        // Check if recovery messages have any values
        const rm = ch.recoveryMessages || {};
        if (Object.values(rm).some(v => v && String(v).trim())) return true;
        // Check if silence handling was customized
        if (ch.silenceHandling && ch.silenceHandling.firstPrompt) return true;
        return false;
    }

    /**
     * Load silence + patience controls for EdgeCaseHandler
     * @param {string} companyId
     * @param {Object} company - Optional (ignored, kept for backward compat)
     * @returns {Object} { silenceHandling, customerPatience }
     */
    static async load(companyId, company = null) {
        try {
            const ch = await this._loadCallHandling(companyId);
            return {
                silenceHandling: {
                    ...DEFAULT_CONTROLS.silenceHandling,
                    ...(ch.silenceHandling || {})
                },
                customerPatience: {
                    ...DEFAULT_CONTROLS.customerPatience,
                    ...(ch.customerPatience || {})
                }
            };
        } catch (error) {
            logger.error('[CALL HANDLING] Failed to load, using defaults', { companyId, error: error.message });
            return DEFAULT_CONTROLS;
        }
    }

    /**
     * Load recovery messages for v2twilio.js
     * @param {string} companyId
     * @returns {Object} { audioUnclear, silenceRecovery, connectionCutOut, generalError, technicalTransfer }
     */
    static async loadRecoveryMessages(companyId) {
        try {
            const ch = await this._loadCallHandling(companyId);
            return {
                ...DEFAULT_RECOVERY,
                ...(ch.recoveryMessages || {})
            };
        } catch (error) {
            logger.error('[CALL HANDLING] Failed to load recovery messages', { companyId, error: error.message });
            return DEFAULT_RECOVERY;
        }
    }

    /**
     * Load low confidence settings for v2twilio.js + LowConfidenceHandler
     * @param {string} companyId
     * @returns {Object} lowConfidenceHandling settings
     */
    static async loadLowConfidenceSettings(companyId) {
        try {
            const ch = await this._loadCallHandling(companyId);
            return {
                ...DEFAULT_LOW_CONFIDENCE,
                ...(ch.lowConfidenceHandling || {})
            };
        } catch (error) {
            logger.error('[CALL HANDLING] Failed to load low confidence settings', { companyId, error: error.message });
            return DEFAULT_LOW_CONFIDENCE;
        }
    }

    /**
     * Clear cached controls (call after settings are updated)
     */
    static async clearCache(companyId) {
        try {
            const { getSharedRedisClient } = require('./redisClientFactory');
            const redisClient = await getSharedRedisClient();
            if (redisClient) {
                await redisClient.del(`callhandling:${companyId}`);
                // Also clear legacy key if it exists
                await redisClient.del(`llm0controls:${companyId}`);
                logger.debug('[CALL HANDLING] Cache cleared', { companyId });
            }
        } catch (error) {
            logger.warn('[CALL HANDLING] Failed to clear cache', { companyId });
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
