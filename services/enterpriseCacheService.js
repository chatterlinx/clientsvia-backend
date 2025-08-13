/**
 * 🚀 ENTERPRISE CACHING SERVICE
 * Multi-tier caching with Redis, memory, and intelligent cache invalidation
 * Optimized for high-performance AI agent operations
 */

const redis = require('redis');
const crypto = require('crypto');

class EnterpriseCacheService {
    constructor() {
        // Multi-tier cache configuration
        this.memoryCache = new Map();
        this.memoryCacheConfig = {
            maxSize: 1000,
            ttl: 30000 // 30 seconds
        };
        
        // Redis client for distributed caching
        this.redisClient = redis.createClient({
            url: process.env.REDIS_URL || 'redis://localhost:6379',
            socket: {
                connectTimeout: 5000,
                lazyConnect: true,
                reconnectDelay: 1000,
                reconnectAttempts: 5,
                keepAlive: 30000
            },
            retry_unfulfilled_commands: true,
            enable_offline_queue: false
        });

        this.redisConfig = {
            defaultTTL: 300000, // 5 minutes
            maxTTL: 3600000     // 1 hour
        };

        // Performance metrics
        this.metrics = {
            hits: { memory: 0, redis: 0, total: 0 },
            misses: { memory: 0, redis: 0, total: 0 },
            operations: { get: 0, set: 0, delete: 0 }
        };

        this.setupRedis();
        this.setupCleanupTasks();
    }

    setupRedis() {
        this.redisClient.on('error', (err) => {
            console.error('🔴 Redis Cache Error:', err.message);
        });

        this.redisClient.on('connect', () => {
            console.log('✅ Enterprise Cache Service - Redis connected');
        });

        this.redisClient.on('ready', () => {
            console.log('🚀 Enterprise Cache Service - Ready for high-performance operations');
        });

        // Auto-connect
        this.connectRedis();
    }

    async connectRedis() {
        try {
            if (!this.redisClient.isOpen) {
                await this.redisClient.connect();
            }
        } catch (error) {
            console.error('Redis connection failed, using memory cache only:', error.message);
        }
    }

    /**
     * Generate optimized cache key
     */
    generateKey(type, ...params) {
        const keyMap = {
            companyKB: (companyId) => `kb:company:${companyId}`,
            tradeQA: (categories) => `kb:trade:${this.hashArray(categories)}`,
            aiConfig: (companyId) => `config:ai:${companyId}`,
            routing: (companyId, text) => `route:${companyId}:${this.hashString(text)}`,
            analytics: (companyId, date) => `analytics:${companyId}:${date}`,
            search: (companyId, query) => `search:${companyId}:${this.hashString(query)}`
        };

        return keyMap[type] ? keyMap[type](...params) : `cache:${type}:${params.join(':')}`;
    }

    /**
     * Multi-tier GET operation
     * Checks memory first, then Redis, with intelligent fallback
     */
    async get(key, options = {}) {
        this.metrics.operations.get++;
        const startTime = Date.now();

        try {
            // Tier 1: Memory cache (fastest)
            const memoryResult = this.getFromMemory(key);
            if (memoryResult !== null) {
                this.metrics.hits.memory++;
                this.metrics.hits.total++;
                console.log(`🟢 Cache HIT (Memory): ${key} [${Date.now() - startTime}ms]`);
                return memoryResult;
            }
            this.metrics.misses.memory++;

            // Tier 2: Redis cache (fast distributed)
            if (this.redisClient.isOpen) {
                const redisResult = await this.getFromRedis(key);
                if (redisResult !== null) {
                    this.metrics.hits.redis++;
                    this.metrics.hits.total++;
                    
                    // Promote to memory cache for next access
                    this.setInMemory(key, redisResult, this.memoryCacheConfig.ttl);
                    
                    console.log(`🟡 Cache HIT (Redis): ${key} [${Date.now() - startTime}ms]`);
                    return redisResult;
                }
                this.metrics.misses.redis++;
            }

            // Cache miss
            this.metrics.misses.total++;
            console.log(`🔴 Cache MISS: ${key} [${Date.now() - startTime}ms]`);
            return null;

        } catch (error) {
            console.error(`Cache GET error for key ${key}:`, error.message);
            return null;
        }
    }

    /**
     * Multi-tier SET operation
     * Sets in both memory and Redis with appropriate TTLs
     */
    async set(key, value, ttl = null) {
        this.metrics.operations.set++;
        const promises = [];

        try {
            // Set in memory cache
            const memoryTTL = Math.min(ttl || this.memoryCacheConfig.ttl, this.memoryCacheConfig.ttl);
            this.setInMemory(key, value, memoryTTL);

            // Set in Redis cache
            if (this.redisClient.isOpen) {
                const redisTTL = ttl || this.redisConfig.defaultTTL;
                promises.push(this.setInRedis(key, value, redisTTL));
            }

            await Promise.all(promises);
            console.log(`✅ Cache SET: ${key} (TTL: ${ttl || 'default'})`);
            return true;

        } catch (error) {
            console.error(`Cache SET error for key ${key}:`, error.message);
            return false;
        }
    }

    /**
     * Intelligent cache invalidation
     */
    async invalidate(pattern) {
        this.metrics.operations.delete++;
        
        try {
            // Invalidate memory cache
            if (pattern.includes('*')) {
                const regex = new RegExp(pattern.replace(/\*/g, '.*'));
                for (const key of this.memoryCache.keys()) {
                    if (regex.test(key)) {
                        this.memoryCache.delete(key);
                    }
                }
            } else {
                this.memoryCache.delete(pattern);
            }

            // Invalidate Redis cache
            if (this.redisClient.isOpen) {
                if (pattern.includes('*')) {
                    const keys = await this.redisClient.keys(pattern);
                    if (keys.length > 0) {
                        await this.redisClient.del(keys);
                    }
                } else {
                    await this.redisClient.del(pattern);
                }
            }

            console.log(`🗑️ Cache INVALIDATED: ${pattern}`);
            return true;

        } catch (error) {
            console.error(`Cache invalidation error for pattern ${pattern}:`, error.message);
            return false;
        }
    }

    /**
     * Company-specific cache operations
     */
    async getCompanyKB(companyId) {
        const key = this.generateKey('companyKB', companyId);
        return await this.get(key);
    }

    async setCompanyKB(companyId, data, ttl = 300000) {
        const key = this.generateKey('companyKB', companyId);
        return await this.set(key, data, ttl);
    }

    async getTradeQA(categories) {
        const key = this.generateKey('tradeQA', categories);
        return await this.get(key);
    }

    async setTradeQA(categories, data, ttl = 600000) {
        const key = this.generateKey('tradeQA', categories);
        return await this.set(key, data, ttl);
    }

    async getAIConfig(companyId) {
        const key = this.generateKey('aiConfig', companyId);
        return await this.get(key);
    }

    async setAIConfig(companyId, config, ttl = 300000) {
        const key = this.generateKey('aiConfig', companyId);
        return await this.set(key, config, ttl);
    }

    async invalidateCompany(companyId) {
        await this.invalidate(`*:${companyId}:*`);
        await this.invalidate(`*:${companyId}`);
    }

    // === PRIVATE METHODS ===

    getFromMemory(key) {
        const item = this.memoryCache.get(key);
        if (!item) return null;
        
        if (Date.now() > item.expiry) {
            this.memoryCache.delete(key);
            return null;
        }
        
        return item.value;
    }

    setInMemory(key, value, ttl) {
        // Enforce memory cache size limit
        if (this.memoryCache.size >= this.memoryCacheConfig.maxSize) {
            const oldestKey = this.memoryCache.keys().next().value;
            this.memoryCache.delete(oldestKey);
        }

        this.memoryCache.set(key, {
            value: value,
            expiry: Date.now() + ttl
        });
    }

    async getFromRedis(key) {
        try {
            const result = await this.redisClient.get(key);
            return result ? JSON.parse(result) : null;
        } catch (error) {
            console.error(`Redis GET error for ${key}:`, error.message);
            return null;
        }
    }

    async setInRedis(key, value, ttl) {
        try {
            const serialized = JSON.stringify(value);
            await this.redisClient.setEx(key, Math.floor(ttl / 1000), serialized);
            return true;
        } catch (error) {
            console.error(`Redis SET error for ${key}:`, error.message);
            return false;
        }
    }

    hashString(str) {
        return crypto.createHash('md5').update(str).digest('hex').substring(0, 8);
    }

    hashArray(arr) {
        return this.hashString(JSON.stringify(arr.sort()));
    }

    setupCleanupTasks() {
        // Clean expired memory cache entries every 5 minutes
        setInterval(() => {
            const now = Date.now();
            for (const [key, item] of this.memoryCache.entries()) {
                if (now > item.expiry) {
                    this.memoryCache.delete(key);
                }
            }
        }, 300000);
    }

    /**
     * Get performance metrics
     */
    getMetrics() {
        const totalOps = this.metrics.hits.total + this.metrics.misses.total;
        const hitRate = totalOps > 0 ? (this.metrics.hits.total / totalOps * 100).toFixed(2) : 0;
        
        return {
            ...this.metrics,
            hitRate: `${hitRate}%`,
            memorySize: this.memoryCache.size,
            redisConnected: this.redisClient.isOpen
        };
    }

    /**
     * Health check
     */
    async healthCheck() {
        const health = {
            memory: { status: 'ok', size: this.memoryCache.size },
            redis: { status: 'disconnected', latency: null }
        };

        try {
            if (this.redisClient.isOpen) {
                const start = Date.now();
                await this.redisClient.ping();
                health.redis = {
                    status: 'ok',
                    latency: `${Date.now() - start}ms`
                };
            }
        } catch (error) {
            health.redis.status = 'error';
            health.redis.error = error.message;
        }

        return health;
    }
}

// Export singleton instance
module.exports = new EnterpriseCacheService();
