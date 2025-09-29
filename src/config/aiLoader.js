/**
 * 🎯 BLUEPRINT COMPLIANCE: AI Configuration Loader
 * Loads all AI agent configurations by companyID with Redis cache
 * Part of the production-ready AI Agent Logic system
 * 
 * 🚀 ENTERPRISE OPTIMIZATION: Mongoose + Redis for sub-50ms performance
 * ⚡ PERFORMANCE TARGET: Sub-50ms response times for AI agent routing
 * 🌐 COFFEE SHOP FRIENDLY: Graceful fallback to in-memory cache
 */

const Company = require('../../models/Company');
const { redisClient } = require('../../clients');

class AIConfigLoader {
    constructor() {
        this.fallbackCache = new Map(); // In-memory fallback for coffee shop mode
        this.cacheTimeout = 300; // 5 minutes in Redis (seconds)
        this.fallbackTimeout = 60000; // 60 seconds for fallback cache (ms)
    }

    /**
     * Clear cache for a company (kills hahaha ghosts!)
     * @param {string} companyID - The company identifier
     */
    async clearCache(companyID) {
        const cacheKey = `ai_config_${companyID}`;
        
        try {
            if (redisClient) {
                await redisClient.del(cacheKey);
                console.log(`💥 CACHE CLEARED for company: ${companyID}`);
            }
            this.fallbackCache.delete(cacheKey);
            console.log(`💥 FALLBACK CACHE CLEARED for company: ${companyID}`);
        } catch (error) {
            console.warn(`⚠️ Cache clear failed for ${companyID}:`, error.message);
        }
    }

    /**
     * Get complete AI configuration for a company
     * @param {string} companyID - The company identifier
     * @returns {Object} Complete AI configuration
     */
    async get(companyID) {
        const cacheKey = `ai_config_${companyID}`;
        
        // 🚀 STEP 1: Try Redis cache first (v2 optimization)
        try {
            if (redisClient) {
                const cachedConfig = await redisClient.get(cacheKey);
                if (cachedConfig) {
                    console.log(`⚡ Redis cache hit for company: ${companyID}`);
                    return JSON.parse(cachedConfig);
                }
            }
        } catch (redisError) {
            console.warn(`⚠️ Redis cache read failed for ${companyID}:`, redisError.message);
        }
        
        // 🌐 STEP 2: Fallback to in-memory cache (coffee shop mode)
        if (this.fallbackCache.has(cacheKey)) {
            const cached = this.fallbackCache.get(cacheKey);
            if (Date.now() - cached.timestamp < this.fallbackTimeout) {
                console.log(`🚀 Fallback cache hit for company: ${companyID}`);
                return cached.data;
            }
        }

        console.log(`🔍 Loading AI configuration from MongoDB for company: ${companyID}`);
        
        try {
            const company = await Company.findById(companyID);
            if (!company) {
                throw new Error(`Company not found: ${companyID}`);
            }

            const aiLogic = company.aiAgentLogic || {};
            
            // Build comprehensive configuration per Blueprint
            const config = {
                companyID,
                companyName: company.companyName || company.name,
                businessName: company.businessName || company.companyName || company.name,
                
                // Answer Priority Flow
                answerPriority: this.getAnswerPriority(aiLogic),
                
                // Confidence Thresholds
                thresholds: {
                    // 🚨 REMOVED: All hardcoded thresholds - must come from aiAgentLogic UI configuration
                    ...aiLogic.thresholds
                },
                
                // Memory Configuration
                memory: {
                    mode: aiLogic.memorySettings?.memoryMode || "conversational",
                    retentionMinutes: aiLogic.memorySettings?.contextRetention || 30
                },
                
                // Escalation Rules
                escalation: {
                    onNoMatch: aiLogic.fallbackBehavior?.escalateOnNoMatch !== undefined ? aiLogic.fallbackBehavior.escalateOnNoMatch : true,
                    rejectLowConfidence: aiLogic.fallbackBehavior?.rejectLowConfidence !== undefined ? aiLogic.fallbackBehavior.rejectLowConfidence : true,
                    strategy: "ask-confirm",
                    message: aiLogic.fallbackBehavior?.message || "I want to make sure I give you accurate information. Let me connect you with a specialist who can help."
                },
                
                // Conversation Management
                rePromptAfterTurns: aiLogic.rePromptAfterTurns || 3,
                maxPromptsPerCall: aiLogic.maxPromptsPerCall || 2,
                
                // LLM Configuration
                modelConfig: {
                    primary: "gemini-pro",
                    fallback: "gpt-4o-mini",
                    allowed: ["gemini-pro", "gpt-4o-mini", "claude-3-haiku"],
                    ...aiLogic.modelConfig
                },
                
                // Trade Categories
                tradeCategories: company.tradeCategories || ["HVAC Residential", "Plumbing Residential"],
                
                // Agent Personality
                agentPersonality: {
                    voiceTone: "friendly",
                    speechPace: "moderate",
                    ...aiLogic.agentPersonality
                },
                
                // Behavior Controls
                behaviorControls: {
                    allowBargeIn: false,
                    acknowledgeEmotion: false,
                    useEmails: false,
                    silencePolicy: {
                        maxSilences: 2,
                        warnBeforeHangup: true
                    },
                    hangupScript: "I may have lost you. I'll send a text and follow up.",
                    ...aiLogic.behaviorControls
                },
                
                // Response Categories
                responseCategories: aiLogic.responseCategories || {},
                
                // Knowledge Base
                knowledgeBase: aiLogic.knowledgeBase || [],
                
                // Booking Flow
                bookingFlow: aiLogic.bookingFlow || {
                    steps: [
                        { prompt: "What's your full name?", field: "fullName", required: true },
                        { prompt: "What's the service address?", field: "address", required: true },
                        { prompt: "What service do you need?", field: "serviceType", required: true },
                        { prompt: "Best callback number?", field: "phone", required: true },
                        { prompt: "Morning or afternoon?", field: "timePref", required: false }
                    ]
                },
                
                // Metadata
                version: aiLogic.version || 1,
                lastUpdated: aiLogic.lastUpdated || new Date()
            };

            // 🚀 STEP 3: Cache the configuration (Redis + fallback)
            await this.cacheConfiguration(cacheKey, config);

            console.log(`✅ AI configuration loaded and cached for company: ${companyID}`);
            return config;

        } catch (error) {
            console.error(`❌ Failed to load AI configuration for company ${companyID}:`, error);
            throw error;
        }
    }

    /**
     * Get answer priority array from configuration
     * @param {Object} aiLogic - AI logic configuration
     * @returns {Array} Priority order array
     */
    getAnswerPriority(aiLogic) {
        if (aiLogic.answerPriorityFlow && Array.isArray(aiLogic.answerPriorityFlow)) {
            // If we have detailed flow items, extract the IDs in priority order
            return aiLogic.answerPriorityFlow
                .sort((a, b) => (a.priority || 999) - (b.priority || 999))
                .filter(item => item.active !== false)
                .map(item => item.id);
        }
        
        // 🚨 MULTI-TENANT COMPLIANCE: No hardcoded defaults - must be configured per company
        console.warn(`⚠️ Company ${companyID} has no priority flow configured. Please configure in AI Agent Logic tab.`);
        return []; // Empty - must be configured per company
    }

    /**
     * 💾 Cache configuration in Redis + fallback
     * @param {string} cacheKey - Cache key
     * @param {Object} config - Configuration to cache
     */
    async cacheConfiguration(cacheKey, config) {
        // 🚀 Primary: Store in Redis (v2 optimization)
        try {
            if (redisClient) {
                await redisClient.setEx(cacheKey, this.cacheTimeout, JSON.stringify(config));
                console.log(`⚡ Configuration cached in Redis: ${cacheKey}`);
            }
        } catch (redisError) {
            console.warn(`⚠️ Redis cache write failed for ${cacheKey}:`, redisError.message);
        }
        
        // 🌐 Fallback: Store in memory (coffee shop mode)
        this.fallbackCache.set(cacheKey, {
            data: config,
            timestamp: Date.now()
        });
    }

    /**
     * Invalidate cache for a specific company (Redis + fallback)
     * @param {string} companyID - The company identifier
     */
    async invalidate(companyID) {
        const cacheKey = `ai_config_${companyID}`;
        
        // Clear from Redis
        try {
            if (redisClient) {
                await redisClient.del(cacheKey);
                console.log(`⚡ Redis cache invalidated for company: ${companyID}`);
            }
        } catch (redisError) {
            console.warn(`⚠️ Redis cache invalidation failed for ${companyID}:`, redisError.message);
        }
        
        // Clear from fallback cache
        this.fallbackCache.delete(cacheKey);
        console.log(`🗑️ Cache invalidated for company: ${companyID}`);
    }

    /**
     * Clear all cache (Redis + fallback)
     */
    async clearCache() {
        // Clear Redis cache
        try {
            if (redisClient) {
                const keys = await redisClient.keys('ai_config_*');
                if (keys.length > 0) {
                    await redisClient.del(keys);
                    console.log(`⚡ Redis cache cleared: ${keys.length} AI configs`);
                }
            }
        } catch (redisError) {
            console.warn(`⚠️ Redis cache clear failed:`, redisError.message);
        }
        
        // Clear fallback cache
        this.fallbackCache.clear();
        console.log('🗑️ All AI configuration cache cleared');
    }
}

// Export singleton instance
module.exports = new AIConfigLoader();
