/**
 * ============================================================================
 * CACHE HELPER - AUTOMATIC REDIS CACHE INVALIDATION
 * ============================================================================
 * 
 * PURPOSE:
 * Centralized utility for managing Redis cache across the platform.
 * Provides clean, reusable functions for cache invalidation that maintain
 * data consistency between MongoDB and Redis.
 * 
 * ARCHITECTURE:
 * - "Set it and forget it" - Add one line to endpoints, cache stays fresh
 * - Mongoose (source of truth) + Redis (performance layer)
 * - Sub-50ms response times with automatic invalidation
 * 
 * USAGE:
 * ```javascript
 * const CacheHelper = require('./utils/cacheHelper');
 * 
 * // After updating company
 * await CacheHelper.clearCompanyCache(companyId);
 * 
 * // After updating template
 * await CacheHelper.clearTemplateCache(templateId);
 * ```
 * 
 * ============================================================================
 */

const Company = require('../models/v2Company');
const logger = require('./logger.js');


// ============================================================================
// REDIS CLIENT INITIALIZATION
// ============================================================================

let redisClient;

try {
    // Import Redis client from centralized clients module
    const clients = require('../clients/index');
    redisClient = clients.redisClient;
    
    if (redisClient) {
        logger.debug('✅ [CACHE HELPER] Redis client connected');
    } else {
        logger.warn('⚠️  [CACHE HELPER] Redis client not available - cache operations will be no-ops');
    }
} catch (error) {
    logger.warn('⚠️  [CACHE HELPER] Redis import failed:', error.message);
    redisClient = null;
}

/**
 * Get Redis client (lazy getter to handle async initialization)
 * @returns {object|null} Redis client or null
 */
function getRedisClient() {
    if (!redisClient) {
        try {
            const clients = require('../clients/index');
            redisClient = clients.redisClient;
        } catch (error) {
            // Silent fail - already logged above
        }
    }
    return redisClient;
}

// ============================================================================
// CACHE HELPER CLASS - WORLD-CLASS CACHE MANAGEMENT
// ============================================================================

class CacheHelper {
    
    // ========================================================================
    // COMPANY CACHE INVALIDATION
    // ========================================================================
    
    /**
     * Clear cache for a single company
     * 
     * USE CASE: Company updates settings, variables, or configuration
     * SCOPE: Only affects the specific company
     * PERFORMANCE: 1-5ms
     * 
     * @param {string} companyId - MongoDB ObjectId as string
     * @returns {Promise<void>}
     * 
     * @example
     * // After company updates phone number
     * await Company.findByIdAndUpdate(companyId, { phone: newPhone });
     * await CacheHelper.clearCompanyCache(companyId);
     */
    static async clearCompanyCache(companyId) {
        const client = getRedisClient();
        if (!client) {
            logger.debug('ℹ️  [CACHE] Redis not available, skipping cache clear');
            return;
        }
        
        try {
            const keys = [
                `company:${companyId}:config`,     // Company configuration
                `company:${companyId}:scenarios`,  // Merged scenarios with variables
                `company:${companyId}`,            // Legacy key (for compatibility)
            ];
            
            // Delete all keys in parallel
            await Promise.all(
                keys.map(key => client.del(key))
            );
            
            logger.debug(`✅ [CACHE] Cleared cache for company ${companyId}`);
            
        } catch (error) {
            // Non-blocking error - cache miss is acceptable
            logger.error(`⚠️  [CACHE] Failed to clear company ${companyId}:`, error.message);
        }
    }
    
    // ========================================================================
    // TEMPLATE CACHE INVALIDATION
    // ========================================================================
    
    /**
     * Clear cache for a Global AI Brain template and ALL companies using it
     * 
     * USE CASE: Admin updates template scenarios, categories, or structure
     * SCOPE: Template + all companies referencing it
     * PERFORMANCE: 10-50ms depending on company count
     * 
     * @param {string} templateId - Global template MongoDB ObjectId as string
     * @returns {Promise<void>}
     * 
     * @example
     * // After updating Global AI Brain template
     * await GlobalInstantResponseTemplate.findByIdAndUpdate(templateId, updates);
     * await CacheHelper.clearTemplateCache(templateId);
     */
    static async clearTemplateCache(templateId) {
        const client = getRedisClient();
        if (!client) {
            logger.debug('ℹ️  [CACHE] Redis not available, skipping cache clear');
            return;
        }
        
        try {
            // 1. Clear template-level cache
            await client.del(`scenarios:${templateId}`);
            
            logger.debug(`✅ [CACHE] Cleared template ${templateId} cache`);
            
            // 2. Find all companies using this template
            const companies = await Company.find({
                'aiAgentSettings.templateReferences.templateId': templateId
            }).select('_id');
            
            if (companies.length === 0) {
                logger.debug(`ℹ️  [CACHE] No companies using template ${templateId}`);
                return;
            }
            
            // 3. Clear cache for each company (parallel for speed)
            await Promise.all(
                companies.map(company => this.clearCompanyCache(company._id.toString()))
            );
            
            logger.debug(`✅ [CACHE] Cleared template ${templateId} and ${companies.length} companies`);
            
        } catch (error) {
            logger.error(`⚠️  [CACHE] Failed to clear template ${templateId}:`, error.message);
        }
    }
    
    // ========================================================================
    // NUCLEAR OPTION - CLEAR ALL CACHE
    // ========================================================================
    
    /**
     * Clear ALL Redis cache (nuclear option)
     * 
     * USE CASE: 
     * - Major system update
     * - Database migration
     * - Emergency cache corruption
     * - Admin "Clear All Cache" button
     * 
     * WARNING: Next requests will be slower until cache rebuilds
     * PERFORMANCE: 5-10ms
     * 
     * @returns {Promise<void>}
     * 
     * @example
     * // In admin panel emergency button
     * await CacheHelper.clearAllCache();
     */
    static async clearAllCache() {
        const client = getRedisClient();
        if (!client) {
            logger.debug('ℹ️  [CACHE] Redis not available, skipping cache clear');
            return;
        }
        
        try {
            await client.flushDb();
            logger.debug(`🔥 [CACHE] CLEARED ALL CACHE (nuclear option used)`);
            
        } catch (error) {
            logger.error(`❌ [CACHE] Failed to clear all cache:`, error.message);
            throw error; // Re-throw for this critical operation
        }
    }
    
    // ========================================================================
    // CACHE WARMING - OPTIONAL PERFORMANCE OPTIMIZATION
    // ========================================================================
    
    /**
     * Pre-warm cache for a company (optional optimization)
     * 
     * USE CASE:
     * - After company creation
     * - After major configuration update
     * - Before expected high traffic
     * 
     * BENEFIT: First call is fast (already cached)
     * 
     * @param {string} companyId - MongoDB ObjectId as string
     * @param {number} ttl - Time to live in seconds (default: 3600 = 1 hour)
     * @returns {Promise<void>}
     * 
     * @example
     * // After company clones template
     * await CacheHelper.warmCompanyCache(companyId);
     */
    static async warmCompanyCache(companyId, ttl = 3600) {
        const client = getRedisClient();
        if (!client) {
            return;
        }
        
        try {
            // Load company config
            const company = await Company.findById(companyId)
                .select('aiAgentSettings')
                .lean();
            
            if (!company) {
                logger.warn(`⚠️  [CACHE] Company ${companyId} not found for warming`);
                return;
            }
            
            // Cache company config
            await client.setEx(
                `company:${companyId}:config`,
                ttl,
                JSON.stringify(company.aiAgentSettings)
            );
            
            logger.debug(`🔥 [CACHE] Warmed cache for company ${companyId}`);
            
        } catch (error) {
            logger.error(`⚠️  [CACHE] Failed to warm cache for ${companyId}:`, error.message);
        }
    }
    
    // ========================================================================
    // HEALTH CHECK - VERIFY REDIS CONNECTION
    // ========================================================================
    
    /**
     * Check if Redis is available and responding
     * 
     * USE CASE:
     * - System health checks
     * - Monitoring dashboards
     * - Troubleshooting
     * 
     * @returns {Promise<boolean>} True if Redis is healthy
     * 
     * @example
     * const isHealthy = await CacheHelper.healthCheck();
     * logger.debug(`Redis: ${isHealthy ? 'OK' : 'DOWN'}`);
     */
    static async healthCheck() {
        const client = getRedisClient();
        if (!client) {
            return false;
        }
        
        try {
            await client.ping();
            return true;
        } catch (error) {
            logger.error('❌ [CACHE] Redis health check failed:', error.message);
            return false;
        }
    }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = CacheHelper;

