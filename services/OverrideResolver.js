/**
 * ============================================================================
 * OVERRIDE RESOLVER SERVICE
 * ============================================================================
 * 
 * PURPOSE: Apply company-specific overrides to matched scenarios
 * Per December 2025 Directive: Deterministic fallback, NO LLM required
 * 
 * RESOLUTION ORDER (LOCKED):
 * 1. Scenario enabled → return normal scenario reply
 * 2. Scenario disabled + has alternate reply (SCENARIO fallback) → return alternate
 * 3. Scenario disabled + category has default (CATEGORY fallback) → return category default
 * 4. Scenario disabled → return company Not Offered reply
 * 5. ONLY IF NONE OF ABOVE → allow Tier 3 LLM fallback
 * 
 * KEY PRINCIPLE:
 * - Scenario Brain decides WHAT to say (deterministic)
 * - This service applies company customization (also deterministic)
 * - LLM decides HOW to say it (polish only, optional)
 * 
 * MULTI-TENANT: All operations scoped by companyId
 * 
 * ============================================================================
 */

const logger = require('../utils/logger');
const CompanyScenarioOverride = require('../models/CompanyScenarioOverride');
const CompanyCategoryOverride = require('../models/CompanyCategoryOverride');
const CompanyResponseDefaults = require('../models/CompanyResponseDefaults');
const CompanyPlaceholders = require('../models/CompanyPlaceholders');
const v2Company = require('../models/v2Company');

// Redis for caching overrides (optional performance boost)
let redisClient;
try {
    const db = require('../db');
    redisClient = db.redisClient;
} catch (e) {
    logger.warn('[OVERRIDE RESOLVER] Redis not available, using direct DB queries');
}

const CACHE_TTL = 300; // 5 minutes cache for overrides

class OverrideResolver {
    
    /**
     * ============================================================================
     * MAIN ENTRY POINT: Resolve Response with Overrides
     * ============================================================================
     * 
     * Called AFTER scenario matching, BEFORE response generation
     * 
     * @param {Object} params
     * @param {String} params.companyId - Company ID
     * @param {Object} params.matchedScenario - The scenario that matched (can be null)
     * @param {String} params.templateId - Template the scenario belongs to
     * @param {String} params.categoryId - Category the scenario belongs to
     * @param {String} params.scenarioId - Scenario ID
     * @param {Object} params.originalReply - Original reply from scenario { quickReply, fullReply }
     * @returns {Object} - Resolved reply with override info
     */
    static async resolveResponse({
        companyId,
        matchedScenario,
        templateId,
        categoryId,
        scenarioId,
        originalReply
    }) {
        const startTime = Date.now();
        
        logger.debug('[OVERRIDE RESOLVER] Resolving response', {
            companyId,
            scenarioId,
            hasMatch: !!matchedScenario
        });
        
        try {
            // If no scenario matched, no override to apply
            if (!matchedScenario || !scenarioId) {
                return {
                    resolved: false,
                    overrideApplied: false,
                    reply: originalReply,
                    resolution: 'NO_MATCH',
                    resolvedIn: Date.now() - startTime
                };
            }
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 1: Check scenario override
            // ═══════════════════════════════════════════════════════════════
            const scenarioOverride = await this.getScenarioOverride(companyId, scenarioId);
            
            // If no override exists OR scenario is enabled → use original reply
            if (!scenarioOverride || scenarioOverride.enabled !== false) {
                return {
                    resolved: true,
                    overrideApplied: false,
                    reply: originalReply,
                    resolution: 'SCENARIO_ENABLED',
                    resolvedIn: Date.now() - startTime
                };
            }
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 2: Scenario is DISABLED - apply fallback preference
            // ═══════════════════════════════════════════════════════════════
            const fallbackPreference = scenarioOverride.fallbackPreference || 'COMPANY';
            
            logger.info('[OVERRIDE RESOLVER] Scenario disabled, applying fallback', {
                companyId,
                scenarioId,
                fallbackPreference
            });
            
            // FALLBACK 1: Use scenario's own alternate reply
            if (fallbackPreference === 'SCENARIO') {
                const alternateReply = scenarioOverride.disabledAlternateReply;
                if (alternateReply?.fullReply) {
                    return {
                        resolved: true,
                        overrideApplied: true,
                        reply: {
                            quickReply: alternateReply.quickReply || alternateReply.fullReply.substring(0, 100),
                            fullReply: alternateReply.fullReply
                        },
                        resolution: 'SCENARIO_ALTERNATE',
                        overrideSource: 'scenario',
                        resolvedIn: Date.now() - startTime
                    };
                }
            }
            
            // FALLBACK 2: Use category default reply
            if (fallbackPreference === 'CATEGORY' || fallbackPreference === 'SCENARIO') {
                const categoryOverride = await this.getCategoryOverride(companyId, categoryId);
                if (categoryOverride?.disabledDefaultReply?.fullReply && !categoryOverride.useCompanyDefault) {
                    return {
                        resolved: true,
                        overrideApplied: true,
                        reply: {
                            quickReply: categoryOverride.disabledDefaultReply.quickReply || 
                                        categoryOverride.disabledDefaultReply.fullReply.substring(0, 100),
                            fullReply: categoryOverride.disabledDefaultReply.fullReply
                        },
                        resolution: 'CATEGORY_DEFAULT',
                        overrideSource: 'category',
                        resolvedIn: Date.now() - startTime
                    };
                }
            }
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 3: Use company Not Offered default
            // ═══════════════════════════════════════════════════════════════
            const companyDefaults = await this.getCompanyDefaults(companyId);
            if (companyDefaults?.notOfferedReply?.fullReply) {
                return {
                    resolved: true,
                    overrideApplied: true,
                    reply: {
                        quickReply: companyDefaults.notOfferedReply.quickReply ||
                                    companyDefaults.notOfferedReply.fullReply.substring(0, 100),
                        fullReply: companyDefaults.notOfferedReply.fullReply
                    },
                    resolution: 'COMPANY_NOT_OFFERED',
                    overrideSource: 'company',
                    resolvedIn: Date.now() - startTime
                };
            }
            
            // ═══════════════════════════════════════════════════════════════
            // STEP 4: No override configured - fall through to LLM (last resort)
            // ═══════════════════════════════════════════════════════════════
            logger.warn('[OVERRIDE RESOLVER] No override configured, falling through to LLM', {
                companyId,
                scenarioId
            });
            
            return {
                resolved: true,
                overrideApplied: true,
                reply: null, // Signal to caller to use LLM fallback
                resolution: 'NO_OVERRIDE_CONFIGURED_LLM_FALLBACK',
                overrideSource: null,
                resolvedIn: Date.now() - startTime
            };
            
        } catch (error) {
            logger.error('[OVERRIDE RESOLVER] Error resolving response:', error);
            
            // On error, return original reply (safe fallback)
            return {
                resolved: false,
                overrideApplied: false,
                reply: originalReply,
                resolution: 'ERROR',
                error: error.message,
                resolvedIn: Date.now() - startTime
            };
        }
    }
    
    /**
     * ============================================================================
     * Get scenario override for a company (with caching)
     * ============================================================================
     */
    static async getScenarioOverride(companyId, scenarioId) {
        const cacheKey = `override:scenario:${companyId}:${scenarioId}`;
        
        // Try cache first
        if (redisClient) {
            try {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    return JSON.parse(cached);
                }
            } catch (e) {
                // Cache miss or error, continue to DB
            }
        }
        
        // Query database
        const override = await CompanyScenarioOverride.findOne({ 
            companyId, 
            scenarioId 
        }).lean();
        
        // Cache result
        if (redisClient && override) {
            try {
                await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(override));
            } catch (e) {
                // Cache write failed, non-critical
            }
        }
        
        return override;
    }
    
    /**
     * ============================================================================
     * Get category override for a company (with caching)
     * ============================================================================
     */
    static async getCategoryOverride(companyId, categoryId) {
        if (!categoryId) return null;
        
        const cacheKey = `override:category:${companyId}:${categoryId}`;
        
        // Try cache first
        if (redisClient) {
            try {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    return JSON.parse(cached);
                }
            } catch (e) {
                // Cache miss or error
            }
        }
        
        // Query database
        const override = await CompanyCategoryOverride.findOne({ 
            companyId, 
            categoryId 
        }).lean();
        
        // Cache result
        if (redisClient && override) {
            try {
                await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(override));
            } catch (e) {
                // Cache write failed
            }
        }
        
        return override;
    }
    
    /**
     * ============================================================================
     * Get company defaults (with caching)
     * ============================================================================
     */
    static async getCompanyDefaults(companyId) {
        const cacheKey = `override:defaults:${companyId}`;
        
        // Try cache first
        if (redisClient) {
            try {
                const cached = await redisClient.get(cacheKey);
                if (cached) {
                    return JSON.parse(cached);
                }
            } catch (e) {
                // Cache miss or error
            }
        }
        
        // Query database or create defaults
        const defaults = await CompanyResponseDefaults.getOrCreate(companyId);
        
        // Cache result
        if (redisClient && defaults) {
            try {
                await redisClient.setEx(cacheKey, CACHE_TTL, JSON.stringify(defaults));
            } catch (e) {
                // Cache write failed
            }
        }
        
        return defaults;
    }
    
    /**
     * ============================================================================
     * Apply placeholder substitution to a reply
     * ============================================================================
     */
    static async renderWithPlaceholders(reply, companyId) {
        if (!reply) return reply;
        
        try {
            const placeholdersMap = await CompanyPlaceholders.getPlaceholdersMap(companyId);

            // Always inject SYSTEM placeholders so templates/scenarios can safely use:
            // {companyname}, {companyphone}, {companyid} without requiring admin setup.
            // (keys are case-insensitive because CompanyPlaceholders.render lowercases)
            try {
                const company = await v2Company.findById(companyId)
                    .select('companyName companyPhone phoneNumber tradeKey')
                    .lean();
                if (company) {
                    if (!placeholdersMap.has('companyname') && company.companyName) {
                        placeholdersMap.set('companyname', company.companyName);
                    }
                    const phone = company.companyPhone || company.phoneNumber;
                    if (!placeholdersMap.has('companyphone') && phone) {
                        placeholdersMap.set('companyphone', phone);
                    }
                    if (!placeholdersMap.has('companyid') && companyId) {
                        placeholdersMap.set('companyid', companyId.toString());
                    }
                    if (!placeholdersMap.has('tradekey') && company.tradeKey) {
                        placeholdersMap.set('tradekey', company.tradeKey);
                    }
                }
            } catch (e) {
                logger.warn('[OVERRIDE RESOLVER] System placeholder injection failed (non-fatal)', { companyId, error: e.message });
            }
            
            // Render both quick and full replies
            return {
                quickReply: reply.quickReply ? 
                    CompanyPlaceholders.render(reply.quickReply, placeholdersMap) : 
                    reply.quickReply,
                fullReply: reply.fullReply ? 
                    CompanyPlaceholders.render(reply.fullReply, placeholdersMap) : 
                    reply.fullReply
            };
        } catch (error) {
            logger.error('[OVERRIDE RESOLVER] Placeholder rendering error:', error);
            return reply;
        }
    }
    
    /**
     * ============================================================================
     * FULL PIPELINE: Resolve + Render Placeholders
     * ============================================================================
     * 
     * Call this from the conversation engine for complete override handling
     */
    static async resolveAndRender({
        companyId,
        matchedScenario,
        templateId,
        categoryId,
        scenarioId,
        originalReply
    }) {
        // Step 1: Resolve overrides
        const resolution = await this.resolveResponse({
            companyId,
            matchedScenario,
            templateId,
            categoryId,
            scenarioId,
            originalReply
        });
        
        // Step 2: Apply placeholder substitution if we have a reply
        if (resolution.reply) {
            resolution.reply = await this.renderWithPlaceholders(resolution.reply, companyId);
        }
        
        return resolution;
    }
    
    /**
     * ============================================================================
     * Invalidate cache for a company (call after override changes)
     * ============================================================================
     */
    static async invalidateCache(companyId) {
        if (!redisClient) return;
        
        try {
            // Delete all override caches for this company
            const keys = await redisClient.keys(`override:*:${companyId}:*`);
            if (keys.length > 0) {
                await redisClient.del(keys);
            }
            
            // Also delete defaults cache
            await redisClient.del(`override:defaults:${companyId}`);
            
            logger.debug('[OVERRIDE RESOLVER] Cache invalidated for company:', companyId);
        } catch (error) {
            logger.warn('[OVERRIDE RESOLVER] Cache invalidation error:', error.message);
        }
    }
}

module.exports = OverrideResolver;

