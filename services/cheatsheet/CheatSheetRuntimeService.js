/**
 * ============================================================================
 * CHEATSHEET RUNTIME SERVICE
 * ============================================================================
 * 
 * Production-optimized config reads for AI agent call runtime.
 * Implements Redis caching for sub-10ms response times.
 * 
 * KEY RESPONSIBILITIES:
 * 1. Fetch live config for production calls (FAST)
 * 2. Redis caching with automatic invalidation
 * 3. Admin testing endpoint (fetch draft/specific versions)
 * 4. Runtime safety (fails loud if no live config)
 * 
 * CRITICAL RULES:
 * - Production calls ONLY read status='live' via liveVersionId
 * - NEVER read draft in production (admin testing only)
 * - Cache hit ratio should be >95%
 * - Cache invalidated on push-live
 * - Fail loud (throw error) if no live config
 * 
 * PERFORMANCE TARGETS:
 * - Cache hit: <10ms
 * - Cache miss: <50ms
 * - 1000+ concurrent reads supported
 * 
 * ============================================================================
 */

const CheatSheetVersion = require('../../models/cheatsheet/CheatSheetVersion');
const Company = require('../../models/v2Company');
const CacheHelper = require('../../utils/cacheHelper');
const logger = require('../../utils/logger');
const {
  NoLiveConfigError,
  LiveConfigNotFoundError,
  VersionNotFoundError
} = require('../../utils/errors/CheatSheetErrors');

class CheatSheetRuntimeService {
  
  // Cache configuration
  static CACHE_TTL = 3600; // 1 hour (invalidated on push-live anyway)
  static CACHE_PREFIX = 'cheatsheet:live:';
  
  // ============================================================================
  // PRODUCTION RUNTIME (Cache-Optimized)
  // ============================================================================
  
  /**
   * Get live config for production calls
   * 
   * This is THE method that production call handler uses.
   * Optimized for speed with Redis caching.
   * 
   * @param {string} companyId - Company ID
   * @returns {Promise<object>} Live config
   * @throws {NoLiveConfigError} If no live config set
   * @throws {LiveConfigNotFoundError} If liveVersionId points to invalid version
   */
  async getRuntimeConfig(companyId) {
    const startTime = Date.now();
    
    // Try cache first
    const cacheKey = this._getCacheKey(companyId);
    
    try {
      const cached = await CacheHelper.get(cacheKey);
      
      if (cached) {
        const duration = Date.now() - startTime;
        logger.debug('CHEATSHEET_CACHE_HIT', {
          companyId,
          duration,
          cacheKey
        });
        return JSON.parse(cached);
      }
    } catch (cacheErr) {
      // Cache error shouldn't break the call
      logger.warn('CHEATSHEET_CACHE_ERROR', {
        companyId,
        error: cacheErr.message,
        operation: 'get'
      });
      // Continue to DB fetch
    }
    
    // Cache miss - fetch from DB
    logger.debug('CHEATSHEET_CACHE_MISS', { companyId });
    
    const company = await Company.findById(companyId)
      .select('aiAgentSettings.cheatSheetMeta')
      .lean();
    
    if (!company) {
      throw new NoLiveConfigError(companyId);
    }
    
    const liveVersionId = company.aiAgentSettings?.cheatSheetMeta?.liveVersionId;
    
    if (!liveVersionId) {
      throw new NoLiveConfigError(companyId);
    }
    
    const live = await CheatSheetVersion.findOne({
      companyId,
      versionId: liveVersionId,
      status: 'live'
    })
    .select('config')
    .lean();
    
    if (!live) {
      throw new LiveConfigNotFoundError(companyId, liveVersionId);
    }
    
    const config = live.config;
    
    // Cache for future reads
    try {
      await CacheHelper.set(
        cacheKey,
        JSON.stringify(config),
        CheatSheetRuntimeService.CACHE_TTL
      );
    } catch (cacheErr) {
      // Cache error shouldn't break the call
      logger.warn('CHEATSHEET_CACHE_ERROR', {
        companyId,
        error: cacheErr.message,
        operation: 'set'
      });
    }
    
    const duration = Date.now() - startTime;
    logger.debug('CHEATSHEET_DB_FETCH', {
      companyId,
      liveVersionId,
      duration,
      cached: true
    });
    
    return config;
  }
  
  /**
   * Get live config metadata (without full config)
   * 
   * Useful for status checks, UI display, etc.
   * Much faster than full config fetch.
   * 
   * @param {string} companyId - Company ID
   * @returns {Promise<object>} Live version metadata
   * @throws {NoLiveConfigError} If no live config set
   */
  async getRuntimeMetadata(companyId) {
    const company = await Company.findById(companyId)
      .select('aiAgentSettings.cheatSheetMeta')
      .lean();
    
    if (!company) {
      throw new NoLiveConfigError(companyId);
    }
    
    const liveVersionId = company.aiAgentSettings?.cheatSheetMeta?.liveVersionId;
    
    if (!liveVersionId) {
      throw new NoLiveConfigError(companyId);
    }
    
    const live = await CheatSheetVersion.findOne({
      companyId,
      versionId: liveVersionId,
      status: 'live'
    })
    .select('-config') // Exclude config
    .lean();
    
    if (!live) {
      throw new LiveConfigNotFoundError(companyId, liveVersionId);
    }
    
    return {
      versionId: live.versionId,
      name: live.name,
      activatedAt: live.activatedAt,
      checksum: live.checksum,
      schemaVersion: live.config?.schemaVersion || 1
    };
  }
  
  // ============================================================================
  // ADMIN TESTING (Non-Cached)
  // ============================================================================
  
  /**
   * Get config for admin testing
   * 
   * Admin can test draft or specific archived versions.
   * NOT cached (testing should use fresh data).
   * NOT used by production call handler.
   * 
   * @param {string} companyId - Company ID
   * @param {string} source - 'live', 'draft', or 'version'
   * @param {string|null} versionId - Specific version ID (if source='version')
   * @returns {Promise<object>} Config
   * @throws {VersionNotFoundError} If version doesn't exist
   */
  async getTestConfig(companyId, source = 'live', versionId = null) {
    logger.info('CHEATSHEET_TEST_CONFIG', {
      companyId,
      source,
      versionId
    });
    
    let version;
    
    switch (source) {
      case 'draft':
        version = await CheatSheetVersion.findOne({
          companyId,
          status: 'draft'
        }).lean();
        
        if (!version) {
          throw new VersionNotFoundError(companyId, 'draft');
        }
        break;
        
      case 'version':
        if (!versionId) {
          throw new Error('versionId required when source=version');
        }
        
        version = await CheatSheetVersion.findOne({
          companyId,
          versionId
        }).lean();
        
        if (!version) {
          throw new VersionNotFoundError(companyId, versionId);
        }
        break;
        
      case 'live':
      default:
        // Default to live (same as getRuntimeConfig but not cached)
        const company = await Company.findById(companyId)
          .select('aiAgentSettings.cheatSheetMeta')
          .lean();
        
        const liveVersionId = company?.aiAgentSettings?.cheatSheetMeta?.liveVersionId;
        
        if (!liveVersionId) {
          throw new NoLiveConfigError(companyId);
        }
        
        version = await CheatSheetVersion.findOne({
          companyId,
          versionId: liveVersionId,
          status: 'live'
        }).lean();
        
        if (!version) {
          throw new LiveConfigNotFoundError(companyId, liveVersionId);
        }
        break;
    }
    
    return version.config;
  }
  
  // ============================================================================
  // CACHE MANAGEMENT
  // ============================================================================
  
  /**
   * Invalidate cache for a company
   * 
   * Called after push-live to ensure fresh config.
   * Also useful for manual cache clearing if needed.
   * 
   * @param {string} companyId - Company ID
   * @returns {Promise<void>}
   */
  async invalidateCache(companyId) {
    const cacheKey = this._getCacheKey(companyId);
    
    try {
      await CacheHelper.invalidate(cacheKey);
      
      logger.info('CHEATSHEET_CACHE_INVALIDATED', {
        companyId,
        cacheKey
      });
    } catch (err) {
      logger.error('CHEATSHEET_CACHE_INVALIDATION_FAILED', {
        companyId,
        error: err.message
      });
      // Don't throw - cache invalidation failure isn't critical
    }
  }
  
  /**
   * Warm cache for a company
   * 
   * Pre-load cache to avoid cold start on first call.
   * Useful after push-live or during deployment.
   * 
   * @param {string} companyId - Company ID
   * @returns {Promise<void>}
   */
  async warmCache(companyId) {
    logger.info('CHEATSHEET_CACHE_WARMING', { companyId });
    
    try {
      // This will fetch from DB and cache it
      await this.getRuntimeConfig(companyId);
      
      logger.info('CHEATSHEET_CACHE_WARMED', { companyId });
    } catch (err) {
      logger.error('CHEATSHEET_CACHE_WARMING_FAILED', {
        companyId,
        error: err.message
      });
      // Don't throw - cache warming failure isn't critical
    }
  }
  
  /**
   * Bulk warm cache for multiple companies
   * 
   * Useful during deployment or after system restart.
   * 
   * @param {Array<string>} companyIds - Array of company IDs
   * @returns {Promise<object>} Results summary
   */
  async bulkWarmCache(companyIds) {
    logger.info('CHEATSHEET_BULK_CACHE_WARMING', {
      count: companyIds.length
    });
    
    const results = {
      success: [],
      failed: []
    };
    
    // Warm in parallel (but limit concurrency to avoid overwhelming DB)
    const CONCURRENCY = 10;
    const chunks = this._chunkArray(companyIds, CONCURRENCY);
    
    for (const chunk of chunks) {
      await Promise.all(
        chunk.map(async (companyId) => {
          try {
            await this.warmCache(companyId);
            results.success.push(companyId);
          } catch (err) {
            results.failed.push({
              companyId,
              error: err.message
            });
          }
        })
      );
    }
    
    logger.info('CHEATSHEET_BULK_CACHE_WARMING_COMPLETE', {
      success: results.success.length,
      failed: results.failed.length
    });
    
    return results;
  }
  
  /**
   * Get cache statistics
   * 
   * Useful for monitoring cache performance.
   * 
   * @returns {Promise<object>} Cache stats
   */
  async getCacheStats() {
    // This would integrate with Redis INFO command
    // For now, return basic stats
    return {
      prefix: CheatSheetRuntimeService.CACHE_PREFIX,
      ttl: CheatSheetRuntimeService.CACHE_TTL,
      // Redis-specific stats would go here
      note: 'Full stats require Redis INFO integration'
    };
  }
  
  // ============================================================================
  // HEALTH CHECK
  // ============================================================================
  
  /**
   * Health check for runtime service
   * 
   * Verifies:
   * 1. Can connect to MongoDB
   * 2. Can connect to Redis
   * 3. Sample config fetch works
   * 
   * @param {string} sampleCompanyId - Company ID to test with
   * @returns {Promise<object>} Health status
   */
  async healthCheck(sampleCompanyId = null) {
    const health = {
      status: 'healthy',
      checks: {}
    };
    
    // Check MongoDB
    try {
      await Company.findOne().limit(1);
      health.checks.mongodb = { status: 'ok' };
    } catch (err) {
      health.checks.mongodb = { status: 'error', error: err.message };
      health.status = 'unhealthy';
    }
    
    // Check Redis
    try {
      await CacheHelper.set('healthcheck:cheatsheet', 'ok', 10);
      const value = await CacheHelper.get('healthcheck:cheatsheet');
      if (value === 'ok') {
        health.checks.redis = { status: 'ok' };
      } else {
        throw new Error('Cache read/write mismatch');
      }
    } catch (err) {
      health.checks.redis = { status: 'error', error: err.message };
      health.status = 'degraded'; // Can run without cache, just slower
    }
    
    // Check config fetch (if sample provided)
    if (sampleCompanyId) {
      try {
        await this.getRuntimeConfig(sampleCompanyId);
        health.checks.configFetch = { status: 'ok' };
      } catch (err) {
        health.checks.configFetch = { status: 'error', error: err.message };
        health.status = 'unhealthy';
      }
    }
    
    return health;
  }
  
  // ============================================================================
  // HELPER METHODS
  // ============================================================================
  
  /**
   * Get cache key for a company
   * @private
   */
  _getCacheKey(companyId) {
    return `${CheatSheetRuntimeService.CACHE_PREFIX}${companyId}`;
  }
  
  /**
   * Chunk array for batch processing
   * @private
   */
  _chunkArray(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}

// ============================================================================
// EXPORT SINGLETON
// ============================================================================
module.exports = new CheatSheetRuntimeService();

