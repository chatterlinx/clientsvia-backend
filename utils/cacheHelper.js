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

const { getSharedRedisClient, isRedisConfigured } = require('../services/redisClientFactory');
const logger = require('./logger');

// Track cache failures for alert throttling
let consecutiveCacheFailures = 0;
let lastCacheFailureAlert = 0;
const CACHE_FAILURE_ALERT_THRESHOLD = 5; // Alert after 5 consecutive failures
const CACHE_FAILURE_ALERT_COOLDOWN = 300000; // 5 minutes between alerts

class CacheHelper {
    /**
     * ============================================================================
     * GENERIC GET - Read a value from cache
     * ============================================================================
     * @param {String} key - Cache key
     * @returns {Promise<String|null>} - Cached value or null
     */
    static async get(key) {
        if (!key || !isRedisConfigured()) return null;
        
        try {
            const redis = await getSharedRedisClient();
            if (!redis) return null;
            
            return await redis.get(key);
        } catch (error) {
            logger.warn('[CACHE HELPER] get() failed:', error.message);
            return null;
        }
    }

    /**
     * ============================================================================
     * GENERIC SET - Store a value in cache
     * ============================================================================
     * @param {String} key - Cache key
     * @param {String} value - Value to cache
     * @param {Number} ttlSeconds - Time to live in seconds
     * @returns {Promise<Boolean>} - Success status
     */
    static async set(key, value, ttlSeconds = 3600) {
        if (!key || !isRedisConfigured()) return false;
        
        try {
            const redis = await getSharedRedisClient();
            if (!redis) return false;
            
            await redis.set(key, value, { EX: ttlSeconds });
            return true;
        } catch (error) {
            logger.warn('[CACHE HELPER] set() failed:', error.message);
            return false;
        }
    }

    /**
     * ============================================================================
     * GENERIC INVALIDATE - Delete a specific cache key
     * ============================================================================
     * @param {String} key - Cache key to invalidate
     * @returns {Promise<Boolean>} - Success status
     */
    static async invalidate(key) {
        if (!key || !isRedisConfigured()) return false;
        
        try {
            const redis = await getSharedRedisClient();
            if (!redis) return false;
            
            await redis.del(key);
            logger.debug('[CACHE HELPER] Key invalidated:', key);
            return true;
        } catch (error) {
            logger.warn('[CACHE HELPER] invalidate() failed:', error.message);
            return false;
        }
    }

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

            // ============================================
            // 🚀 NEW: INVALIDATE COMPANY SCENARIO CACHES
            // ============================================
            // When a template changes, all companies using it need fresh scenario lists
            // This ensures AiCore Live Scenarios and runtime stay in sync
            try {
                const Company = require('../models/v2Company');
                const redisClient = await getSharedRedisClient();
                
                if (!redisClient) {
                    logger.warn('⚠️ [CACHE HELPER] Redis not available for company scenario cache invalidation');
                } else {
                    // Find all companies using this template (new or legacy system)
                    const companies = await Company.find({
                        $or: [
                            { 'aiAgentSettings.templateReferences.templateId': templateId.toString() },
                            { 'configuration.clonedFrom': templateId.toString() }
                        ]
                    }).select('_id companyName').lean();
                    
                    if (companies.length > 0) {
                        logger.info(`🔄 [CACHE HELPER] Invalidating live-scenarios cache for ${companies.length} companies using template ${templateId}`);
                        
                        for (const company of companies) {
                            const companyKey = `live-scenarios:${company._id.toString()}`;
                            await redisClient.del(companyKey);
                            logger.debug(`  ✅ Cleared: ${companyKey} (${company.companyName})`);
                        }
                    }
                }
            } catch (companyInvalidationError) {
                // Log but don't fail - company cache invalidation is bonus, not critical
                logger.warn('⚠️ [CACHE HELPER] Company scenario cache invalidation failed:', companyInvalidationError.message);
            }

            // Reset failure counter on success
            this._resetFailureCounter();

            return true;

        } catch (error) {
            logger.error('❌ [CACHE HELPER] Template invalidation failed', {
                templateId: templateId.toString(),
                error: error.message,
                stack: error.stack
            });
            
            // Track consecutive failures and alert if threshold reached
            await this._handleCacheFailure('TEMPLATE_CACHE_INVALIDATION_FAILURE', {
                entityType: 'template',
                entityId: templateId.toString(),
                error: error.message,
                impact: 'Template data may be stale - Users may see outdated scenarios, categories, or settings',
                action: 'Check Redis health, verify redisClient connection, check for Redis timeouts'
            }, error.stack);
            
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
                `company:${companyId}:aiAgentSettings`,    // AI agent settings
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
                `callLogs:${companyId}:*`                  // Call logs
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
            if (!isRedisConfigured()) {
                logger.warn('⚠️ [CACHE HELPER] Redis not configured, skipping deletion');
                return 0;
            }
            
            const redisClient = await getSharedRedisClient();
            if (!redisClient) {
                logger.warn('⚠️ [CACHE HELPER] Redis client not connected, skipping deletion');
                return 0;
            }

            // Use pipeline for efficient multi-key deletion
            const pipeline = redisClient.multi();
            keys.forEach(key => pipeline.del(key));
            const results = await pipeline.exec();

            // Count successful deletions
            const deleted = results.filter(r => r && r > 0).length;

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
            if (!isRedisConfigured()) {
                logger.warn('⚠️ [CACHE HELPER] Redis not configured, skipping pattern deletion');
                return 0;
            }
            
            const redisClient = await getSharedRedisClient();
            if (!redisClient) {
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
                deleted = results.filter(r => r && r > 0).length;
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

    /**
     * ============================================================================
     * CACHE FAILURE HANDLER (Internal)
     * ============================================================================
     * Tracks consecutive cache failures and sends alerts when threshold is reached.
     * Implements smart throttling to prevent alert storms.
     * 
     * @private
     * @param {String} alertCode - Alert code to send
     * @param {Object} details - Failure details
     * @param {String} stackTrace - Error stack trace
     * @returns {Promise<void>}
     */
    static async _handleCacheFailure(alertCode, details, stackTrace) {
        consecutiveCacheFailures++;

        const now = Date.now();
        const timeSinceLastAlert = now - lastCacheFailureAlert;
        const shouldAlert = 
            consecutiveCacheFailures >= CACHE_FAILURE_ALERT_THRESHOLD &&
            timeSinceLastAlert >= CACHE_FAILURE_ALERT_COOLDOWN;

        if (shouldAlert) {
            try {
                const AdminNotificationService = require('../services/AdminNotificationService');
                
                await AdminNotificationService.sendAlert({
                    code: 'CACHE_INVALIDATION_PATTERN_FAILURE',
                    severity: 'WARNING',
                    companyId: null,
                    companyName: 'Platform',
                    message: `⚠️ Redis cache invalidation failing repeatedly`,
                    details: {
                        consecutiveFailures: consecutiveCacheFailures,
                        threshold: CACHE_FAILURE_ALERT_THRESHOLD,
                        lastFailure: details,
                        impact: 'Cache invalidation is failing - Data staleness risk across platform',
                        action: 'Check Redis health, verify connection, investigate Redis performance issues'
                    },
                    stackTrace
                });

                lastCacheFailureAlert = now;
                logger.warn(`🚨 [CACHE HELPER] Sent alert after ${consecutiveCacheFailures} consecutive failures`);
            } catch (notifErr) {
                logger.error('Failed to send cache failure alert:', notifErr);
            }
        } else if (consecutiveCacheFailures >= CACHE_FAILURE_ALERT_THRESHOLD) {
            const nextAlertIn = Math.ceil((CACHE_FAILURE_ALERT_COOLDOWN - timeSinceLastAlert) / 1000);
            logger.debug(`[CACHE HELPER] ${consecutiveCacheFailures} failures, next alert in ${nextAlertIn}s`);
        }
    }

    /**
     * ============================================================================
     * RESET FAILURE COUNTER (Internal)
     * ============================================================================
     * Resets the consecutive failure counter after successful operations.
     * Should be called by cache invalidation methods on success.
     * 
     * @private
     * @returns {void}
     */
    static _resetFailureCounter() {
        if (consecutiveCacheFailures > 0) {
            logger.debug(`✅ [CACHE HELPER] Cache operations recovered - resetting failure count (was ${consecutiveCacheFailures})`);
            consecutiveCacheFailures = 0;
        }
    }
}

module.exports = CacheHelper;
