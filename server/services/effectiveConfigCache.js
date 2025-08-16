/**
 * Effective Configuration Cache - Phase 2
 * 
 * High-performance in-memory cache with TTL and ETag support
 * Instant invalidation on configuration changes
 * 
 * @author Chief Coding Engineer
 * @version 2.0
 */

const crypto = require('crypto');

class EffectiveConfigCache {
    constructor() {
        this.cache = new Map();
        this.TTL = 60 * 1000; // 60 seconds
        this.enabled = process.env.LIVE_RESOLVER_V1 !== 'false';
        
        console.log(`[EffectiveCache] Cache initialized, TTL: ${this.TTL}ms, Enabled: ${this.enabled}`);
        
        // Cleanup expired entries every 30 seconds
        setInterval(() => this.cleanup(), 30 * 1000);
    }

    /**
     * Generate cache key
     */
    _getCacheKey(companyId, moduleKey = 'full') {
        return `${companyId}:${moduleKey}`;
    }

    /**
     * Generate ETag for configuration
     */
    _generateETag(config) {
        const configString = JSON.stringify(config, Object.keys(config).sort());
        return crypto.createHash('md5').update(configString).digest('hex').substring(0, 8);
    }

    /**
     * Check if cache entry is expired
     */
    _isExpired(entry) {
        return Date.now() - entry.timestamp > this.TTL;
    }

    /**
     * Get cached configuration
     */
    get(companyId, moduleKey = 'full') {
        if (!this.enabled) return null;

        const key = this._getCacheKey(companyId, moduleKey);
        const entry = this.cache.get(key);

        if (!entry || this._isExpired(entry)) {
            if (entry) {
                console.log(`[EffectiveCache] Cache expired for ${key}`);
                this.cache.delete(key);
            }
            return null;
        }

        console.log(`[EffectiveCache] Cache HIT for ${key}`);
        return {
            config: entry.config,
            etag: entry.etag,
            cachedAt: entry.timestamp
        };
    }

    /**
     * Set cached configuration
     */
    set(companyId, config, moduleKey = 'full') {
        if (!this.enabled) return this._generateETag(config);

        const key = this._getCacheKey(companyId, moduleKey);
        const etag = this._generateETag(config);
        const timestamp = Date.now();

        const entry = {
            config: JSON.parse(JSON.stringify(config)), // Deep clone
            etag,
            timestamp,
            companyId,
            moduleKey
        };

        this.cache.set(key, entry);
        console.log(`[EffectiveCache] Cache SET for ${key}, ETag: ${etag}`);

        return etag;
    }

    /**
     * Invalidate cache for specific company/module
     */
    invalidate(companyId, moduleKey = null) {
        if (!this.enabled) return;

        if (moduleKey) {
            // Invalidate specific module
            const key = this._getCacheKey(companyId, moduleKey);
            const deleted = this.cache.delete(key);
            console.log(`[EffectiveCache] Invalidated ${key}: ${deleted ? 'SUCCESS' : 'NOT_FOUND'}`);
        } else {
            // Invalidate all modules for company
            let deletedCount = 0;
            for (const [key, entry] of this.cache.entries()) {
                if (entry.companyId === companyId) {
                    this.cache.delete(key);
                    deletedCount++;
                }
            }
            console.log(`[EffectiveCache] Invalidated all for company ${companyId}: ${deletedCount} entries`);
        }
    }

    /**
     * Clear all cache entries
     */
    clear() {
        const size = this.cache.size;
        this.cache.clear();
        console.log(`[EffectiveCache] Cache cleared: ${size} entries removed`);
    }

    /**
     * Cleanup expired entries
     */
    cleanup() {
        let cleanedCount = 0;
        const now = Date.now();

        for (const [key, entry] of this.cache.entries()) {
            if (now - entry.timestamp > this.TTL) {
                this.cache.delete(key);
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            console.log(`[EffectiveCache] Cleanup: removed ${cleanedCount} expired entries`);
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const entries = Array.from(this.cache.values());
        const now = Date.now();

        return {
            enabled: this.enabled,
            totalEntries: this.cache.size,
            activeEntries: entries.filter(e => now - e.timestamp <= this.TTL).length,
            expiredEntries: entries.filter(e => now - e.timestamp > this.TTL).length,
            ttl: this.TTL,
            oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.timestamp)) : null,
            newestEntry: entries.length > 0 ? Math.max(...entries.map(e => e.timestamp)) : null
        };
    }

    /**
     * Enable/disable cache
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        if (!enabled) {
            this.clear();
        }
        console.log(`[EffectiveCache] Cache ${enabled ? 'ENABLED' : 'DISABLED'}`);
    }
}

// Export singleton instance
const effectiveConfigCache = new EffectiveConfigCache();

module.exports = effectiveConfigCache;
