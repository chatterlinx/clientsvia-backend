/**
 * 🚀 ENTERPRISE AI AGENT CACHE SERVICE
 * ===================================
 * Redis-powered caching for sub-50ms AI agent performance
 * Multi-tenant, priority-aware, bulletproof reliability
 * 
 * CACHE ARCHITECTURE:
 * - Knowledge Source Priorities: 1hr TTL (stable configuration)
 * - Knowledge Management: 30min TTL (content updates)
 * - Personality System: 1hr TTL (personality changes)
 * - Combined Agent Config: 15min TTL (runtime optimization)
 * - Live Agent Config: No expiry during calls (critical performance)
 * 
 * PERFORMANCE TARGETS:
 * - Cache Hit: < 5ms
 * - Cache Miss + DB: < 50ms
 * - Cache Warming: < 100ms
 * - Memory Usage: < 10MB per company
 */

const Redis = require('ioredis');
const logger = require('../utils/logger');

class AIAgentCacheService {
    constructor() {
        // Redis connection with retry logic
        this.redis = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: process.env.REDIS_PORT || 6379,
            password: process.env.REDIS_PASSWORD || null,
            db: process.env.REDIS_DB || 0,
            retryDelayOnFailover: 100,
            maxRetriesPerRequest: 3,
            lazyConnect: true,
            keepAlive: 30000,
            // Connection pool for high performance
            family: 4,
            connectTimeout: 10000,
            commandTimeout: 5000
        });

        // Cache key prefixes for organization
        this.keyPrefixes = {
            priorities: 'ai:priorities:',
            knowledge: 'ai:knowledge:',
            personality: 'ai:personality:',
            combined: 'ai:combined:',
            live: 'ai:live:',
            performance: 'ai:perf:'
        };

        // TTL configurations (in seconds)
        this.ttl = {
            priorities: 3600,    // 1 hour - stable configuration
            knowledge: 1800,     // 30 minutes - content updates
            personality: 3600,   // 1 hour - personality changes
            combined: 900,       // 15 minutes - runtime optimization
            live: 0,            // No expiry during calls
            performance: 86400   // 24 hours - metrics
        };

        // Performance monitoring
        this.metrics = {
            hits: 0,
            misses: 0,
            errors: 0,
            avgResponseTime: 0
        };

        this.setupEventHandlers();
    }

    /**
     * Setup Redis event handlers for monitoring
     */
    setupEventHandlers() {
        this.redis.on('connect', () => {
            logger.info('🔗 AI Agent Cache Service: Redis connected');
        });

        this.redis.on('error', (error) => {
            logger.error('❌ AI Agent Cache Service: Redis error', error);
            this.metrics.errors++;
        });

        this.redis.on('ready', () => {
            logger.info('✅ AI Agent Cache Service: Redis ready for operations');
        });
    }

    /**
     * 🎯 KNOWLEDGE SOURCE PRIORITIES CACHING
     */
    
    /**
     * Cache knowledge source priorities configuration
     * @param {string} companyId - Company identifier
     * @param {Object} priorities - Priority configuration object
     */
    async cachePriorities(companyId, priorities) {
        const startTime = Date.now();
        try {
            const key = `${this.keyPrefixes.priorities}${companyId}`;
            const data = {
                ...priorities,
                cachedAt: new Date().toISOString(),
                version: priorities.version || 1
            };

            await this.redis.setex(key, this.ttl.priorities, JSON.stringify(data));
            
            logger.info(`🎯 Cached priorities for company ${companyId}`, {
                responseTime: Date.now() - startTime,
                ttl: this.ttl.priorities
            });

            return true;
        } catch (error) {
            logger.error(`❌ Failed to cache priorities for company ${companyId}`, error);
            this.metrics.errors++;
            return false;
        }
    }

    /**
     * Retrieve knowledge source priorities from cache
     * @param {string} companyId - Company identifier
     * @returns {Object|null} Priority configuration or null if not cached
     */
    async getPriorities(companyId) {
        const startTime = Date.now();
        try {
            const key = `${this.keyPrefixes.priorities}${companyId}`;
            const cached = await this.redis.get(key);
            
            const responseTime = Date.now() - startTime;
            this.updateMetrics(responseTime, cached !== null);

            if (cached) {
                const data = JSON.parse(cached);
                logger.debug(`🎯 Cache HIT: Priorities for company ${companyId}`, {
                    responseTime,
                    version: data.version
                });
                return data;
            }

            logger.debug(`🎯 Cache MISS: Priorities for company ${companyId}`, { responseTime });
            return null;
        } catch (error) {
            logger.error(`❌ Failed to get priorities for company ${companyId}`, error);
            this.metrics.errors++;
            return null;
        }
    }

    /**
     * 📚 KNOWLEDGE MANAGEMENT CACHING
     */
    
    /**
     * Cache knowledge management data
     * @param {string} companyId - Company identifier
     * @param {Object} knowledge - Knowledge management object
     */
    async cacheKnowledge(companyId, knowledge) {
        const startTime = Date.now();
        try {
            const key = `${this.keyPrefixes.knowledge}${companyId}`;
            const data = {
                ...knowledge,
                cachedAt: new Date().toISOString(),
                statistics: {
                    ...knowledge.statistics,
                    cacheGenerated: true
                }
            };

            await this.redis.setex(key, this.ttl.knowledge, JSON.stringify(data));
            
            logger.info(`📚 Cached knowledge for company ${companyId}`, {
                responseTime: Date.now() - startTime,
                entries: {
                    companyQnA: knowledge.companyQnA?.length || 0,
                    tradeQnA: knowledge.tradeQnA?.length || 0,
                    templates: knowledge.templates?.length || 0
                }
            });

            return true;
        } catch (error) {
            logger.error(`❌ Failed to cache knowledge for company ${companyId}`, error);
            this.metrics.errors++;
            return false;
        }
    }

    /**
     * Retrieve knowledge management data from cache
     * @param {string} companyId - Company identifier
     * @returns {Object|null} Knowledge data or null if not cached
     */
    async getKnowledge(companyId) {
        const startTime = Date.now();
        try {
            const key = `${this.keyPrefixes.knowledge}${companyId}`;
            const cached = await this.redis.get(key);
            
            const responseTime = Date.now() - startTime;
            this.updateMetrics(responseTime, cached !== null);

            if (cached) {
                const data = JSON.parse(cached);
                logger.debug(`📚 Cache HIT: Knowledge for company ${companyId}`, {
                    responseTime,
                    totalEntries: data.statistics?.totalEntries || 0
                });
                return data;
            }

            logger.debug(`📚 Cache MISS: Knowledge for company ${companyId}`, { responseTime });
            return null;
        } catch (error) {
            logger.error(`❌ Failed to get knowledge for company ${companyId}`, error);
            this.metrics.errors++;
            return null;
        }
    }

    /**
     * 🎭 PERSONALITY SYSTEM CACHING
     */
    
    /**
     * Cache personality system configuration
     * @param {string} companyId - Company identifier
     * @param {Object} personality - Personality configuration object
     */
    async cachePersonality(companyId, personality) {
        const startTime = Date.now();
        try {
            const key = `${this.keyPrefixes.personality}${companyId}`;
            const data = {
                ...personality,
                cachedAt: new Date().toISOString(),
                profile: personality.safeZoneProfile || 'enterprise-professional'
            };

            await this.redis.setex(key, this.ttl.personality, JSON.stringify(data));
            
            logger.info(`🎭 Cached personality for company ${companyId}`, {
                responseTime: Date.now() - startTime,
                profile: data.profile,
                customized: data.isCustomized
            });

            return true;
        } catch (error) {
            logger.error(`❌ Failed to cache personality for company ${companyId}`, error);
            this.metrics.errors++;
            return false;
        }
    }

    /**
     * Retrieve personality system configuration from cache
     * @param {string} companyId - Company identifier
     * @returns {Object|null} Personality data or null if not cached
     */
    async getPersonality(companyId) {
        const startTime = Date.now();
        try {
            const key = `${this.keyPrefixes.personality}${companyId}`;
            const cached = await this.redis.get(key);
            
            const responseTime = Date.now() - startTime;
            this.updateMetrics(responseTime, cached !== null);

            if (cached) {
                const data = JSON.parse(cached);
                logger.debug(`🎭 Cache HIT: Personality for company ${companyId}`, {
                    responseTime,
                    profile: data.profile
                });
                return data;
            }

            logger.debug(`🎭 Cache MISS: Personality for company ${companyId}`, { responseTime });
            return null;
        } catch (error) {
            logger.error(`❌ Failed to get personality for company ${companyId}`, error);
            this.metrics.errors++;
            return null;
        }
    }

    /**
     * 🚀 COMBINED AGENT CONFIGURATION CACHING
     */
    
    /**
     * Cache combined AI agent configuration for runtime
     * @param {string} companyId - Company identifier
     * @param {Object} config - Combined configuration object
     */
    async cacheCombinedConfig(companyId, config) {
        const startTime = Date.now();
        try {
            const key = `${this.keyPrefixes.combined}${companyId}`;
            const data = {
                priorities: config.priorities,
                knowledge: config.knowledge,
                personality: config.personality,
                cachedAt: new Date().toISOString(),
                version: config.version || 1,
                // Performance optimization flags
                optimized: true,
                precomputed: {
                    totalKnowledgeEntries: (config.knowledge?.companyQnA?.length || 0) + 
                                         (config.knowledge?.tradeQnA?.length || 0) + 
                                         (config.knowledge?.templates?.length || 0),
                    priorityFlow: config.priorities?.priorityFlow || [],
                    personalityProfile: config.personality?.safeZoneProfile || 'enterprise-professional'
                }
            };

            await this.redis.setex(key, this.ttl.combined, JSON.stringify(data));
            
            logger.info(`🚀 Cached combined config for company ${companyId}`, {
                responseTime: Date.now() - startTime,
                totalEntries: data.precomputed.totalKnowledgeEntries,
                profile: data.precomputed.personalityProfile
            });

            return true;
        } catch (error) {
            logger.error(`❌ Failed to cache combined config for company ${companyId}`, error);
            this.metrics.errors++;
            return false;
        }
    }

    /**
     * Retrieve combined AI agent configuration from cache
     * @param {string} companyId - Company identifier
     * @returns {Object|null} Combined configuration or null if not cached
     */
    async getCombinedConfig(companyId) {
        const startTime = Date.now();
        try {
            const key = `${this.keyPrefixes.combined}${companyId}`;
            const cached = await this.redis.get(key);
            
            const responseTime = Date.now() - startTime;
            this.updateMetrics(responseTime, cached !== null);

            if (cached) {
                const data = JSON.parse(cached);
                logger.debug(`🚀 Cache HIT: Combined config for company ${companyId}`, {
                    responseTime,
                    totalEntries: data.precomputed?.totalKnowledgeEntries || 0
                });
                return data;
            }

            logger.debug(`🚀 Cache MISS: Combined config for company ${companyId}`, { responseTime });
            return null;
        } catch (error) {
            logger.error(`❌ Failed to get combined config for company ${companyId}`, error);
            this.metrics.errors++;
            return null;
        }
    }

    /**
     * ⚡ LIVE AGENT CONFIGURATION (CRITICAL PERFORMANCE)
     */
    
    /**
     * Cache live agent configuration (no expiry during calls)
     * @param {string} companyId - Company identifier
     * @param {Object} liveConfig - Live configuration for active calls
     */
    async cacheLiveConfig(companyId, liveConfig) {
        const startTime = Date.now();
        try {
            const key = `${this.keyPrefixes.live}${companyId}`;
            const data = {
                ...liveConfig,
                cachedAt: new Date().toISOString(),
                callActive: true,
                // Emergency fallback always available
                emergencyFallback: {
                    enabled: true,
                    response: 'I want to make sure you get the best help possible. Let me connect you with a specialist.'
                }
            };

            // No TTL - critical for call performance
            await this.redis.set(key, JSON.stringify(data));
            
            logger.info(`⚡ Cached live config for company ${companyId}`, {
                responseTime: Date.now() - startTime,
                critical: true
            });

            return true;
        } catch (error) {
            logger.error(`❌ CRITICAL: Failed to cache live config for company ${companyId}`, error);
            this.metrics.errors++;
            return false;
        }
    }

    /**
     * Retrieve live agent configuration (sub-5ms target)
     * @param {string} companyId - Company identifier
     * @returns {Object|null} Live configuration or emergency fallback
     */
    async getLiveConfig(companyId) {
        const startTime = Date.now();
        try {
            const key = `${this.keyPrefixes.live}${companyId}`;
            const cached = await this.redis.get(key);
            
            const responseTime = Date.now() - startTime;
            this.updateMetrics(responseTime, cached !== null);

            if (cached) {
                const data = JSON.parse(cached);
                logger.debug(`⚡ Cache HIT: Live config for company ${companyId}`, {
                    responseTime,
                    critical: true
                });
                return data;
            }

            // CRITICAL: Always return emergency fallback if cache miss
            logger.warn(`⚡ Cache MISS: Live config for company ${companyId} - using emergency fallback`, { 
                responseTime 
            });
            
            return this.getEmergencyFallback(companyId);
        } catch (error) {
            logger.error(`❌ CRITICAL: Failed to get live config for company ${companyId}`, error);
            this.metrics.errors++;
            // Return emergency fallback to prevent call failures
            return this.getEmergencyFallback(companyId);
        }
    }

    /**
     * 🚨 EMERGENCY FALLBACK SYSTEM
     */
    
    /**
     * Get emergency fallback configuration (never fails)
     * @param {string} companyId - Company identifier
     * @returns {Object} Emergency fallback configuration
     */
    getEmergencyFallback(companyId) {
        return {
            companyId,
            emergency: true,
            priorities: {
                priorityFlow: [
                    { source: 'inHouseFallback', priority: 1, threshold: 0.5, enabled: true, fallbackBehavior: 'always_respond' }
                ]
            },
            knowledge: {
                inHouseFallback: {
                    enabled: true,
                    responses: {
                        general: 'I want to make sure you get the best help possible. Let me connect you with a specialist.'
                    }
                }
            },
            personality: {
                corePersonality: {
                    voiceTone: 'professional',
                    empathyLevel: 4
                }
            },
            cachedAt: new Date().toISOString(),
            fallbackReason: 'Emergency configuration - cache unavailable'
        };
    }

    /**
     * 🧹 CACHE MANAGEMENT UTILITIES
     */
    
    /**
     * Invalidate all cache entries for a company
     * @param {string} companyId - Company identifier
     */
    async invalidateCompany(companyId) {
        try {
            const keys = [
                `${this.keyPrefixes.priorities}${companyId}`,
                `${this.keyPrefixes.knowledge}${companyId}`,
                `${this.keyPrefixes.personality}${companyId}`,
                `${this.keyPrefixes.combined}${companyId}`,
                `${this.keyPrefixes.live}${companyId}`
            ];

            await this.redis.del(...keys);
            logger.info(`🧹 Invalidated all cache for company ${companyId}`);
            return true;
        } catch (error) {
            logger.error(`❌ Failed to invalidate cache for company ${companyId}`, error);
            return false;
        }
    }

    /**
     * Warm cache for a company (preload all configurations)
     * @param {string} companyId - Company identifier
     * @param {Object} Company - Company model for database access
     */
    async warmCache(companyId, Company) {
        const startTime = Date.now();
        try {
            logger.info(`🔥 Warming cache for company ${companyId}...`);

            // Load company data from database
            const company = await Company.findById(companyId).lean();
            if (!company) {
                throw new Error(`Company ${companyId} not found`);
            }

            // Cache all components
            const promises = [];
            
            if (company.aiAgentLogic?.knowledgeSourcePriorities) {
                promises.push(this.cachePriorities(companyId, company.aiAgentLogic.knowledgeSourcePriorities));
            }
            
            if (company.aiAgentLogic?.knowledgeManagement) {
                promises.push(this.cacheKnowledge(companyId, company.aiAgentLogic.knowledgeManagement));
            }
            
            if (company.aiAgentLogic?.personalitySystem) {
                promises.push(this.cachePersonality(companyId, company.aiAgentLogic.personalitySystem));
            }

            await Promise.all(promises);

            // Generate combined configuration
            const combinedConfig = {
                priorities: company.aiAgentLogic?.knowledgeSourcePriorities,
                knowledge: company.aiAgentLogic?.knowledgeManagement,
                personality: company.aiAgentLogic?.personalitySystem,
                version: 1
            };

            await this.cacheCombinedConfig(companyId, combinedConfig);
            await this.cacheLiveConfig(companyId, combinedConfig);

            const totalTime = Date.now() - startTime;
            logger.info(`🔥 Cache warming complete for company ${companyId}`, {
                totalTime,
                target: '< 100ms',
                success: totalTime < 100
            });

            return true;
        } catch (error) {
            logger.error(`❌ Failed to warm cache for company ${companyId}`, error);
            return false;
        }
    }

    /**
     * 📊 PERFORMANCE MONITORING
     */
    
    /**
     * Update performance metrics
     * @param {number} responseTime - Response time in milliseconds
     * @param {boolean} hit - Whether it was a cache hit
     */
    updateMetrics(responseTime, hit) {
        if (hit) {
            this.metrics.hits++;
        } else {
            this.metrics.misses++;
        }

        // Update average response time
        const totalRequests = this.metrics.hits + this.metrics.misses;
        this.metrics.avgResponseTime = (
            (this.metrics.avgResponseTime * (totalRequests - 1)) + responseTime
        ) / totalRequests;
    }

    /**
     * Get performance metrics
     * @returns {Object} Performance metrics
     */
    getMetrics() {
        const totalRequests = this.metrics.hits + this.metrics.misses;
        return {
            ...this.metrics,
            hitRate: totalRequests > 0 ? (this.metrics.hits / totalRequests) * 100 : 0,
            totalRequests,
            status: this.metrics.avgResponseTime < 50 ? 'excellent' : 
                   this.metrics.avgResponseTime < 100 ? 'good' : 'needs_optimization'
        };
    }

    /**
     * Health check for cache service
     * @returns {Object} Health status
     */
    async healthCheck() {
        try {
            const start = Date.now();
            await this.redis.ping();
            const responseTime = Date.now() - start;

            return {
                status: 'healthy',
                responseTime,
                metrics: this.getMetrics(),
                redis: {
                    connected: this.redis.status === 'ready',
                    status: this.redis.status
                }
            };
        } catch (error) {
            return {
                status: 'unhealthy',
                error: error.message,
                metrics: this.getMetrics(),
                redis: {
                    connected: false,
                    status: this.redis.status
                }
            };
        }
    }
}

// Export singleton instance
module.exports = new AIAgentCacheService();
