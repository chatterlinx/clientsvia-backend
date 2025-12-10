/**
 * ============================================================================
 * RUNTIME CONFIG LOADER - Unified Config Loading for Live Calls
 * ============================================================================
 * 
 * PURPOSE:
 * Single entry point for loading ALL company configuration needed during calls.
 * This replaces the scattered config loading across v2twilio, LLM0TurnHandler,
 * HybridReceptionistLLM, etc.
 * 
 * USAGE:
 *   const runtimeConfig = await RuntimeConfigLoader.load(companyId);
 *   // Now pass runtimeConfig to LLM0TurnHandler, HybridReceptionistLLM, etc.
 * 
 * CACHING:
 * Uses Redis with 5-minute TTL for fast access during calls.
 * Automatically invalidates when company settings change.
 * 
 * SEE: docs/clientsvia-runtime-map.md for full architecture
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const Company = require('../models/v2Company');

// Config Loaders
const LLM0ControlsLoader = require('./LLM0ControlsLoader');
const { DEFAULT_FRONT_DESK_CONFIG } = require('../config/frontDeskPrompt');

// Optional services (don't crash if not available)
let CheatSheetRuntimeService;
try {
    CheatSheetRuntimeService = require('./cheatsheet/CheatSheetRuntimeService');
} catch (e) {
    logger.warn('[RUNTIME CONFIG] CheatSheetRuntimeService not available');
}

let STTProfileService;
try {
    // STT Profile is loaded by templateId, not companyId
    // This is handled separately in the STT pipeline
} catch (e) {
    logger.warn('[RUNTIME CONFIG] STTProfileService not available');
}

// Redis for caching
let getSharedRedisClient;
try {
    const factory = require('./redisClientFactory');
    getSharedRedisClient = factory.getSharedRedisClient;
} catch (e) {
    logger.warn('[RUNTIME CONFIG] Redis not available for caching');
}

// Cache TTL
const CACHE_TTL_SECONDS = 300; // 5 minutes

/**
 * Deep merge helper - merges source into target, preferring source values
 */
function deepMerge(target, source) {
    const result = { ...target };
    for (const key of Object.keys(source || {})) {
        if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
            result[key] = deepMerge(result[key] || {}, source[key]);
        } else if (source[key] !== undefined) {
            result[key] = source[key];
        }
    }
    return result;
}

class RuntimeConfigLoader {
    
    /**
     * ========================================================================
     * MAIN ENTRY POINT: Load all runtime config for a company
     * ========================================================================
     * 
     * Loads and merges ALL config needed for live call processing:
     * - Company document
     * - LLM-0 Controls (silence, loops, spam, etc.)
     * - Front Desk Behavior (personality, prompts)
     * - Call Flow Engine (Mission Control settings)
     * - Cheat Sheet (live version)
     * - Triage Cards
     * - Quick Answers
     * - Voice Settings
     * 
     * @param {string} companyId - Company ID
     * @param {Object} options - Options
     * @param {boolean} options.skipCache - Force fresh load
     * @returns {Promise<Object>} Complete runtime config
     */
    static async load(companyId, options = {}) {
        const startTime = Date.now();
        const { skipCache = false } = options;
        
        if (!companyId) {
            logger.error('[RUNTIME CONFIG] load() called without companyId');
            return this.getDefaultConfig();
        }
        
        const cacheKey = `runtimeConfig:${companyId}`;
        
        // Try cache first (unless skipCache)
        if (!skipCache && getSharedRedisClient) {
            try {
                const redisClient = await getSharedRedisClient();
                if (redisClient) {
                    const cached = await redisClient.get(cacheKey);
                    if (cached) {
                        const parsed = JSON.parse(cached);
                        logger.debug('[RUNTIME CONFIG] ✅ Loaded from cache', {
                            companyId,
                            latencyMs: Date.now() - startTime
                        });
                        return parsed;
                    }
                }
            } catch (cacheError) {
                logger.debug('[RUNTIME CONFIG] Cache miss or error', {
                    companyId,
                    error: cacheError.message
                });
            }
        }
        
        // Load from database
        logger.info('[RUNTIME CONFIG] 📦 Loading fresh config from database', { companyId });
        
        try {
            // Load company document
            const company = await Company.findById(companyId).lean();
            
            if (!company) {
                logger.error('[RUNTIME CONFIG] Company not found', { companyId });
                return this.getDefaultConfig();
            }
            
            // Load all configs in parallel
            const [
                llm0Controls,
                cheatSheet
            ] = await Promise.all([
                LLM0ControlsLoader.load(companyId, company),
                this.loadCheatSheet(companyId)
            ]);
            
            // Extract configs from company document
            const aiAgentSettings = company.aiAgentSettings || {};
            const callFlowEngine = aiAgentSettings.callFlowEngine || {};
            
            // Build the unified runtime config
            const runtimeConfig = {
                // Company basics
                companyId: companyId.toString(),
                companyName: company.companyName || 'Company',
                trade: company.trade || 'HVAC',
                
                // LLM-0 Controls (silence, loops, spam, etc.)
                llm0Controls,
                
                // Front Desk Behavior (personality, prompts)
                frontDesk: deepMerge(DEFAULT_FRONT_DESK_CONFIG, aiAgentSettings.frontDeskBehavior || {}),
                
                // Call Flow Engine (Mission Control)
                callFlowEngine: {
                    enabled: callFlowEngine.enabled !== false,
                    activeTrade: callFlowEngine.activeTrade || '_default',
                    synonymMap: callFlowEngine.synonymMap || {},
                    customBlockers: callFlowEngine.customBlockers || {},
                    bookingFields: callFlowEngine.bookingFields || [],
                    transferRules: callFlowEngine.transferRules || [],
                    missionTriggers: callFlowEngine.missionTriggers || []
                },
                
                // Triage Cards
                triageCards: callFlowEngine.triageCards || [],
                
                // Quick Answers
                quickAnswers: (callFlowEngine.quickAnswers || []).filter(qa => qa.enabled !== false),
                
                // Cheat Sheet (live version)
                cheatSheet: cheatSheet || {},
                
                // Voice Settings
                voiceSettings: aiAgentSettings.voiceSettings || {},
                
                // Service Areas
                serviceAreas: company.serviceAreas || [],
                
                // Booking Rules
                bookingRules: {
                    fields: callFlowEngine.bookingFields || [],
                    style: callFlowEngine.style || {}
                },
                
                // Template References
                templateReferences: aiAgentSettings.templateReferences || [],
                
                // Metadata
                _loadedAt: new Date().toISOString(),
                _loadTimeMs: Date.now() - startTime
            };
            
            // Cache for future requests
            if (getSharedRedisClient) {
                try {
                    const redisClient = await getSharedRedisClient();
                    if (redisClient) {
                        await redisClient.setex(
                            cacheKey,
                            CACHE_TTL_SECONDS,
                            JSON.stringify(runtimeConfig)
                        );
                    }
                } catch (cacheSetError) {
                    logger.debug('[RUNTIME CONFIG] Failed to cache', {
                        companyId,
                        error: cacheSetError.message
                    });
                }
            }
            
            logger.info('[RUNTIME CONFIG] ✅ Config loaded successfully', {
                companyId,
                latencyMs: Date.now() - startTime,
                triageCardCount: runtimeConfig.triageCards.length,
                quickAnswerCount: runtimeConfig.quickAnswers.length,
                hasCheatSheet: !!runtimeConfig.cheatSheet?.config
            });
            
            return runtimeConfig;
            
        } catch (error) {
            logger.error('[RUNTIME CONFIG] ❌ Failed to load config', {
                companyId,
                error: error.message,
                stack: error.stack
            });
            return this.getDefaultConfig();
        }
    }
    
    /**
     * Load cheat sheet live config
     */
    static async loadCheatSheet(companyId) {
        if (!CheatSheetRuntimeService) return null;
        
        try {
            const service = new CheatSheetRuntimeService();
            return await service.getLiveConfig(companyId);
        } catch (error) {
            logger.debug('[RUNTIME CONFIG] CheatSheet not available', {
                companyId,
                error: error.message
            });
            return null;
        }
    }
    
    /**
     * Invalidate cache for a company (call after settings change)
     */
    static async invalidateCache(companyId) {
        if (!getSharedRedisClient) return;
        
        try {
            const redisClient = await getSharedRedisClient();
            if (redisClient) {
                const cacheKey = `runtimeConfig:${companyId}`;
                await redisClient.del(cacheKey);
                logger.info('[RUNTIME CONFIG] Cache invalidated', { companyId });
            }
        } catch (error) {
            logger.warn('[RUNTIME CONFIG] Failed to invalidate cache', {
                companyId,
                error: error.message
            });
        }
    }
    
    /**
     * Get default config (used when loading fails)
     */
    static getDefaultConfig() {
        return {
            companyId: null,
            companyName: 'Company',
            trade: 'HVAC',
            llm0Controls: LLM0ControlsLoader.getDefaults(),
            frontDesk: DEFAULT_FRONT_DESK_CONFIG,
            callFlowEngine: { enabled: true },
            triageCards: [],
            quickAnswers: [],
            cheatSheet: {},
            voiceSettings: {},
            serviceAreas: [],
            bookingRules: { fields: [], style: {} },
            templateReferences: [],
            _loadedAt: new Date().toISOString(),
            _isDefault: true
        };
    }
    
    /**
     * Health check - verify config loading works
     */
    static async healthCheck(companyId) {
        const startTime = Date.now();
        
        try {
            const config = await this.load(companyId, { skipCache: true });
            
            return {
                status: 'healthy',
                companyId,
                latencyMs: Date.now() - startTime,
                hasLlm0Controls: !!config.llm0Controls,
                hasFrontDesk: !!config.frontDesk,
                hasCallFlowEngine: !!config.callFlowEngine,
                triageCardCount: config.triageCards?.length || 0,
                quickAnswerCount: config.quickAnswers?.length || 0,
                isDefault: config._isDefault || false
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                companyId,
                error: error.message,
                latencyMs: Date.now() - startTime
            };
        }
    }
}

module.exports = RuntimeConfigLoader;

