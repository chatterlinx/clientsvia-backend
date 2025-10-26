/**
 * ============================================================================
 * CACHE HELPER - Redis Cache Invalidation Utility
 * ============================================================================
 * 
 * PURPOSE:
 * Centralized cache invalidation patterns for all Mongoose save operations.
 * Ensures REFACTOR_PROTOCOL compliance by providing consistent, reliable,
 * and observable cache clearing across the entire platform.
 * 
 * PROTOCOL REQUIREMENT (REFACTOR_PROTOCOL.md lines 49-64):
 * "Always clear cache after save:
 *   await company.save();
 *   await redisClient.del(`company:${companyId}`);"
 * 
 * FEATURES:
 * - Single responsibility: Cache invalidation only
 * - Observable: Logs all cache operations
 * - Resilient: Never throws, always fails gracefully
 * - Multi-tenant safe: Scoped by entity type + ID
 * - Pattern-based: Supports wildcards for bulk invalidation
 * 
 * USAGE EXAMPLES:
 * 
 * // After saving a template
 * await template.save();
 * await CacheHelper.invalidateTemplate(template._id);
 * 
 * // After saving a company
 * await company.save();
 * await CacheHelper.invalidateCompany(company._id);
 * 
 * // After updating company settings affecting AI
 * await company.save();
 * await CacheHelper.invalidateCompanyAndRelated(company._id);
 * 
 * ============================================================================
 */

const { redisClient } = require('../db');
const logger = require('./logger');

class CacheHelper {
    /**
     * ============================================================================
     * TEMPLATE CACHE INVALIDATION
     * ============================================================================
     * Invalidates all cache keys related to a specific template.
     * Called after: template.save(), template updates, scenario changes, etc.
     * 
     * @param {String|ObjectId} templateId - Template ID
     * @returns {Promise<Boolean>} - Success status
     */
    static async invalidateTemplate(templateId) {
        if (!templateId) {
            logger.warn('⚠️ [CACHE HELPER] invalidateTemplate called with null ID');
            return false;
        }

        try {
            const keys = [
                `template:${templateId}`,              // Main template cache
                `template:${templateId}:scenarios`,    // Scenario list cache
                `template:${templateId}:categories`,   // Category list cache
                `template:${templateId}:stats`,        // Statistics cache
                `template:${templateId}:metadata`,     // Metadata cache
                'templates:active',                    // Active templates list
                'templates:all'                        // All templates list
            ];

            const deleted = await this._deleteKeys(keys);

            logger.debug('🗑️ [CACHE HELPER] Template cache invalidated', {
                templateId: templateId.toString(),
                keysDeleted: deleted,
                timestamp: new Date().toISOString()
            });

            return true;

        } catch (error) {
            logger.error('❌ [CACHE HELPER] Template invalidation failed', {
                templateId: templateId.toString(),
                error: error.message,
                stack: error.stack
            });
            // Never throw - cache failures should not break business logic
            return false;
        }
    }

    /**
     * ============================================================================
     * COMPANY CACHE INVALIDATION
     * ============================================================================
     * Invalidates all cache keys related to a specific company.
     * Called after: company.save(), settings updates, etc.
     * 
     * @param {String|ObjectId} companyId - Company ID
     * @returns {Promise<Boolean>} - Success status
     */
    static async invalidateCompany(companyId) {
        if (!companyId) {
            logger.warn('⚠️ [CACHE HELPER] invalidateCompany called with null ID');
            return false;
        }

        try {
            const keys = [
                `company:${companyId}`,                    // Main company cache
                `company:${companyId}:settings`,           // Settings cache
                `company:${companyId}:aiAgentLogic`,       // AI agent settings
                `company:${companyId}:contacts`,           // Contact list
                `company:${companyId}:templates`,          // Associated templates
                `company:${companyId}:knowledgeBase`,      // Knowledge base
                `company:${companyId}:qna`,                // Q&A pairs
                'companies:active',                        // Active companies list
                'companies:all'                            // All companies list
            ];

            const deleted = await this._deleteKeys(keys);

            logger.debug('🗑️ [CACHE HELPER] Company cache invalidated', {
                companyId: companyId.toString(),
                keysDeleted: deleted,
                timestamp: new Date().toISOString()
            });

            return true;

        } catch (error) {
            logger.error('❌ [CACHE HELPER] Company invalidation failed', {
                companyId: companyId.toString(),
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    /**
     * ============================================================================
     * COMPANY + RELATED CACHE INVALIDATION
     * ============================================================================
     * Invalidates company AND all related caches (templates, AI settings, etc.).
     * Use when changes affect multiple subsystems.
     * 
     * @param {String|ObjectId} companyId - Company ID
     * @returns {Promise<Boolean>} - Success status
     */
    static async invalidateCompanyAndRelated(companyId) {
        if (!companyId) {
            logger.warn('⚠️ [CACHE HELPER] invalidateCompanyAndRelated called with null ID');
            return false;
        }

        try {
            // First invalidate company itself
            await this.invalidateCompany(companyId);

            // Then invalidate related caches
            const additionalKeys = [
                `sessions:${companyId}:*`,                 // User sessions
                `metrics:${companyId}:*`,                  // Performance metrics
                `callLogs:${companyId}:*`,                 // Call logs
                `aiPerformance:${companyId}:*`             // AI performance stats
            ];

            // Use Redis SCAN for pattern-based deletion (safer than KEYS)
            for (const pattern of additionalKeys) {
                await this._deleteByPattern(pattern);
            }

            logger.info('🗑️ [CACHE HELPER] Company + related caches invalidated', {
                companyId: companyId.toString(),
                timestamp: new Date().toISOString()
            });

            return true;

        } catch (error) {
            logger.error('❌ [CACHE HELPER] Company + related invalidation failed', {
                companyId: companyId.toString(),
                error: error.message,
                stack: error.stack
            });
            return false;
        }
    }

    /**
     * ============================================================================
     * SUGGESTION CACHE INVALIDATION
     * ============================================================================
     * Invalidates suggestion knowledge base caches.
     * Called after: suggestion updates, approvals, dismissals.
     * 
     * @param {String|ObjectId} templateId - Template ID
     * @returns {Promise<Boolean>} - Success status
     */
    static async invalidateSuggestions(templateId) {
        if (!templateId) {
            logger.warn('⚠️ [CACHE HELPER] invalidateSuggestions called with null ID');
            return false;
        }

        try {
            const keys = [
                `suggestions:${templateId}`,
                `suggestions:${templateId}:pending`,
                `suggestions:${templateId}:approved`,
                `suggestions:${templateId}:stats`,
                'suggestions:global'
            ];

            const deleted = await this._deleteKeys(keys);

            logger.debug('🗑️ [CACHE HELPER] Suggestions cache invalidated', {
                templateId: templateId.toString(),
                keysDeleted: deleted
            });

            return true;

        } catch (error) {
            logger.error('❌ [CACHE HELPER] Suggestions invalidation failed', {
                templateId: templateId.toString(),
                error: error.message
            });
            return false;
        }
    }

    /**
     * ============================================================================
     * GLOBAL PATTERN CACHE INVALIDATION
     * ============================================================================
     * Invalidates global pattern caches (used by all templates).
     * Called after: global pattern approvals, updates, rejections.
     * 
     * @returns {Promise<Boolean>} - Success status
     */
    static async invalidateGlobalPatterns() {
        try {
            const keys = [
                'globalPatterns:all',
                'globalPatterns:approved',
                'globalPatterns:pending',
                'globalPatterns:fillers',
                'globalPatterns:synonyms',
                'globalPatterns:keywords'
            ];

            const deleted = await this._deleteKeys(keys);

            logger.info('🗑️ [CACHE HELPER] Global patterns cache invalidated', {
                keysDeleted: deleted
            });

            return true;

        } catch (error) {
            logger.error('❌ [CACHE HELPER] Global patterns invalidation failed', {
                error: error.message
            });
            return false;
        }
    }

    /**
     * ============================================================================
     * ADMIN SETTINGS CACHE INVALIDATION
     * ============================================================================
     * Invalidates AdminSettings singleton cache.
     * Called after: Twilio test config updates, notification settings, etc.
     * 
     * @returns {Promise<Boolean>} - Success status
     */
    static async invalidateAdminSettings() {
        try {
            const keys = [
                'adminSettings',
                'adminSettings:twilioTest',
                'adminSettings:notifications',
                'adminSettings:security'
            ];

            const deleted = await this._deleteKeys(keys);

            logger.info('🗑️ [CACHE HELPER] Admin settings cache invalidated', {
                keysDeleted: deleted
            });

            return true;

        } catch (error) {
            logger.error('❌ [CACHE HELPER] Admin settings invalidation failed', {
                error: error.message
            });
            return false;
        }
    }

    /**
     * ============================================================================
     * LLM CALL LOG CACHE INVALIDATION
     * ============================================================================
     * Invalidates LLM call log and metrics caches.
     * Called after: new LLM calls, cost tracking updates.
     * 
     * @param {String|ObjectId} templateId - Template ID
     * @returns {Promise<Boolean>} - Success status
     */
    static async invalidateLLMMetrics(templateId) {
        if (!templateId) {
            logger.warn('⚠️ [CACHE HELPER] invalidateLLMMetrics called with null ID');
            return false;
        }

        try {
            const keys = [
                `llmMetrics:${templateId}`,
                `llmMetrics:${templateId}:daily`,
                `llmMetrics:${templateId}:weekly`,
                `llmMetrics:${templateId}:monthly`,
                `llmMetrics:${templateId}:cost`,
                `llmCalls:${templateId}:recent`,
                'llmMetrics:global'
            ];

            const deleted = await this._deleteKeys(keys);

            logger.debug('🗑️ [CACHE HELPER] LLM metrics cache invalidated', {
                templateId: templateId.toString(),
                keysDeleted: deleted
            });

            return true;

        } catch (error) {
            logger.error('❌ [CACHE HELPER] LLM metrics invalidation failed', {
                templateId: templateId.toString(),
                error: error.message
            });
            return false;
        }
    }

    /**
     * ============================================================================
     * INTERNAL HELPER: DELETE SPECIFIC KEYS
     * ============================================================================
     * Deletes an array of specific Redis keys.
     * 
     * @private
     * @param {Array<String>} keys - Array of Redis keys to delete
     * @returns {Promise<Number>} - Number of keys deleted
     */
    static async _deleteKeys(keys) {
        if (!keys || keys.length === 0) return 0;

        try {
            // Check if Redis client is connected
            if (!redisClient || !redisClient.isOpen) {
                logger.warn('⚠️ [CACHE HELPER] Redis client not connected, skipping deletion');
                return 0;
            }

            // Use pipeline for efficient multi-key deletion
            const pipeline = redisClient.multi();
            keys.forEach(key => pipeline.del(key));
            const results = await pipeline.exec();

            // Count successful deletions
            const deleted = results.filter(r => r[1] > 0).length;

            return deleted;

        } catch (error) {
            logger.error('❌ [CACHE HELPER] _deleteKeys failed', {
                keys,
                error: error.message
            });
            return 0;
        }
    }

    /**
     * ============================================================================
     * INTERNAL HELPER: DELETE BY PATTERN
     * ============================================================================
     * Deletes all Redis keys matching a pattern using SCAN (safe for production).
     * 
     * @private
     * @param {String} pattern - Redis key pattern (e.g., 'company:123:*')
     * @returns {Promise<Number>} - Number of keys deleted
     */
    static async _deleteByPattern(pattern) {
        try {
            // Check if Redis client is connected
            if (!redisClient || !redisClient.isOpen) {
                logger.warn('⚠️ [CACHE HELPER] Redis client not connected, skipping pattern deletion');
                return 0;
            }

            let cursor = 0;
            let deleted = 0;
            const keysToDelete = [];

            // Use SCAN to safely iterate through keys (non-blocking)
            do {
                const reply = await redisClient.scan(cursor, {
                    MATCH: pattern,
                    COUNT: 100
                });

                cursor = reply.cursor;
                keysToDelete.push(...reply.keys);

            } while (cursor !== 0);

            // Delete found keys in batches
            if (keysToDelete.length > 0) {
                const pipeline = redisClient.multi();
                keysToDelete.forEach(key => pipeline.del(key));
                const results = await pipeline.exec();
                deleted = results.filter(r => r[1] > 0).length;
            }

            logger.debug('🗑️ [CACHE HELPER] Pattern deletion complete', {
                pattern,
                keysFound: keysToDelete.length,
                keysDeleted: deleted
            });

            return deleted;

        } catch (error) {
            logger.error('❌ [CACHE HELPER] _deleteByPattern failed', {
                pattern,
                error: error.message
            });
            return 0;
        }
    }

    /**
     * ============================================================================
     * BULK INVALIDATION
     * ============================================================================
     * Invalidates multiple cache types at once. Use for complex operations
     * that affect multiple subsystems (e.g., template sync, company migration).
     * 
     * @param {Object} targets - Object specifying what to invalidate
     * @param {String} targets.templateId - Template ID (optional)
     * @param {String} targets.companyId - Company ID (optional)
     * @param {Boolean} targets.suggestions - Invalidate suggestions (optional)
     * @param {Boolean} targets.globalPatterns - Invalidate global patterns (optional)
     * @param {Boolean} targets.llmMetrics - Invalidate LLM metrics (optional)
     * @returns {Promise<Boolean>} - Success status
     */
    static async invalidateBulk({ templateId, companyId, suggestions, globalPatterns, llmMetrics }) {
        try {
            const operations = [];

            if (templateId) {
                operations.push(this.invalidateTemplate(templateId));
            }

            if (companyId) {
                operations.push(this.invalidateCompanyAndRelated(companyId));
            }

            if (suggestions && templateId) {
                operations.push(this.invalidateSuggestions(templateId));
            }

            if (globalPatterns) {
                operations.push(this.invalidateGlobalPatterns());
            }

            if (llmMetrics && templateId) {
                operations.push(this.invalidateLLMMetrics(templateId));
            }

            await Promise.all(operations);

            logger.info('🗑️ [CACHE HELPER] Bulk invalidation complete', {
                templateId,
                companyId,
                operations: operations.length
            });

            return true;

        } catch (error) {
            logger.error('❌ [CACHE HELPER] Bulk invalidation failed', {
                error: error.message
            });
            return false;
        }
    }
}

module.exports = CacheHelper;
