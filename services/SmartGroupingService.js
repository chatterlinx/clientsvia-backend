// ============================================================================
// 🔗 SMART GROUPING SERVICE
// ============================================================================
// Purpose: Prevent alert storms by grouping duplicate errors
// 
// Features:
// - Detect repeated errors within a time window
// - Group them into a single consolidated alert
// - Configurable threshold (default: 3+ errors in 15 minutes)
// - Redis-based tracking for fast lookups
// - Automatic cleanup of old tracking data
//
// Example:
// - 5 SMS_DELIVERY_FAILURE errors in 10 minutes
// - Instead of 5 separate SMS/emails
// - Send ONE: "🚨 5 SMS_DELIVERY_FAILURE errors in 10 minutes"
//
// 🚨 LESSON LEARNED (Oct 2025 - Infinite Recursion Loop):
// CRITICAL: This service can cause INFINITE ALERT LOOPS if not careful!
// 
// THE PROBLEM:
// 1. Redis connection fails → AdminNotificationService sends alert
// 2. AdminNotificationService calls SmartGroupingService to dedupe
// 3. SmartGroupingService tries to use Redis → Redis fails AGAIN
// 4. SmartGroupingService triggers ANOTHER alert via AdminNotificationService
// 5. Loop repeats infinitely, crashing the server
//
// THE SOLUTION (Circuit Breaker in AdminNotificationService):
// - AdminNotificationService has a list of infrastructure error codes
// - For these errors, it SKIPS calling SmartGroupingService entirely
// - Examples: REDIS_CONNECTION_FAILED, MONGODB_CONNECTION_FAILED
// - This breaks the infinite loop
//
// IF YOU SEE INFINITE ALERTS:
// 1. Check AdminNotificationService.js for circuit breaker logic
// 2. Add the error code to INFRASTRUCTURE_ERRORS array
// 3. Never remove the circuit breaker - it prevents catastrophic loops
// ============================================================================

// Use centralized Redis factory - single source of truth
const { getSharedRedisClient, isRedisConfigured } = require('./redisClientFactory');
const logger = require('../utils/logger');

class SmartGroupingService {
    static async getRedisClient() {
        if (!isRedisConfigured()) return null;
        return await getSharedRedisClient();
    }
    
    /**
     * Check if an error should be grouped
     * @param {string} errorCode - Error code (e.g., 'SMS_DELIVERY_FAILURE')
     * @param {string} severity - CRITICAL, WARNING, INFO
     * @param {Object} policy - Smart grouping policy from AdminSettings
     * @returns {Object} { shouldGroup: boolean, groupKey: string, count: number }
     */
    static async shouldGroupError(errorCode, severity, policy) {
        try {
            // Check if grouping is enabled
            if (!policy || !policy.enabled) {
                return { shouldGroup: false };
            }
            
            const threshold = policy.threshold || 3;
            const windowMinutes = policy.windowMinutes || 15;
            const windowSeconds = windowMinutes * 60;
            
            // Create a unique key for this error code + severity
            const groupKey = `alert-group:${severity}:${errorCode}`;
            
            // Increment counter with expiration
            const count = await this.incrementCounter(groupKey, windowSeconds);
            
            logger.debug(`🔗 [SMART GROUPING] ${errorCode}: ${count}/${threshold} in ${windowMinutes}min window`);
            
            // If we've reached the threshold, group future occurrences
            if (count >= threshold) {
                return {
                    shouldGroup: true,
                    groupKey,
                    count,
                    threshold,
                    windowMinutes
                };
            }
            
            return { shouldGroup: false, count };
            
        } catch (error) {
            logger.error('❌ [SMART GROUPING] Error checking grouping:', error);
            // Fail open - don't group if we can't track
            return { shouldGroup: false };
        }
    }
    
    /**
     * Mark that we've sent a grouped alert for this error
     * @param {string} groupKey - The group key
     * @param {number} totalCount - Total occurrences in this group
     * @returns {Promise<boolean>} Success
     */
    static async markGroupedAlertSent(groupKey, totalCount) {
        try {
            const sentKey = `${groupKey}:sent`;
            const sentTime = Date.now();
            
            // Store when we sent the grouped alert
            const redisClient = this.getRedisClient();
            if (!redisClient) {
                logger.warn('⚠️ [SMART GROUPING] Redis client unavailable when marking grouped alert');
                return false;
            }
            await redisClient.set(sentKey, JSON.stringify({
                sentAt: sentTime,
                totalCount
            }), {
                EX: 3600 // Expire after 1 hour
            });
            
            logger.info(`🔗 [SMART GROUPING] Marked grouped alert sent: ${groupKey} (${totalCount} occurrences)`);
            return true;
            
        } catch (error) {
            logger.error('❌ [SMART GROUPING] Error marking grouped alert:', error);
            return false;
        }
    }
    
    /**
     * Check if we've already sent a grouped alert for this error recently
     * @param {string} groupKey - The group key
     * @returns {Promise<Object>} { alreadySent: boolean, sentInfo: object }
     */
    static async hasRecentGroupedAlert(groupKey) {
        try {
            const sentKey = `${groupKey}:sent`;
            const redisClient = this.getRedisClient();
            if (!redisClient) {
                logger.warn('⚠️ [SMART GROUPING] Redis client unavailable when checking recent alerts');
                return { alreadySent: false };
            }
            const sentData = await redisClient.get(sentKey);
            
            if (!sentData) {
                return { alreadySent: false };
            }
            
            const info = JSON.parse(sentData);
            const minutesAgo = Math.floor((Date.now() - info.sentAt) / 60000);
            
            logger.debug(`🔗 [SMART GROUPING] Found recent grouped alert: ${groupKey} (sent ${minutesAgo}min ago)`);
            
            return {
                alreadySent: true,
                sentInfo: {
                    ...info,
                    minutesAgo
                }
            };
            
        } catch (error) {
            logger.error('❌ [SMART GROUPING] Error checking recent alert:', error);
            return { alreadySent: false };
        }
    }
    
    /**
     * Get current count for an error group
     * @param {string} groupKey - The group key
     * @returns {Promise<number>} Current count
     */
    static async getGroupCount(groupKey) {
        try {
            const redisClient = this.getRedisClient();
            if (!redisClient) {
                logger.warn('⚠️ [SMART GROUPING] Redis client unavailable when getting group count');
                return 0;
            }
            const count = await redisClient.get(groupKey);
            return count ? parseInt(count) : 0;
        } catch (error) {
            logger.error('❌ [SMART GROUPING] Error getting count:', error);
            return 0;
        }
    }
    
    /**
     * Reset a group counter (used after sending grouped alert)
     * @param {string} groupKey - The group key
     * @returns {Promise<boolean>} Success
     */
    static async resetGroupCounter(groupKey) {
        try {
            const redisClient = this.getRedisClient();
            if (!redisClient) {
                logger.warn('⚠️ [SMART GROUPING] Redis client unavailable when resetting counter');
                return false;
            }
            await redisClient.del(groupKey);
            logger.debug(`🔗 [SMART GROUPING] Reset counter: ${groupKey}`);
            return true;
        } catch (error) {
            logger.error('❌ [SMART GROUPING] Error resetting counter:', error);
            return false;
        }
    }
    
    /**
     * Increment error counter with automatic expiration
     * @private
     * @param {string} key - Redis key
     * @param {number} expirationSeconds - TTL
     * @returns {Promise<number>} New count
     */
    static async incrementCounter(key, expirationSeconds) {
        try {
            // Increment the counter
            const redisClient = this.getRedisClient();
            if (!redisClient) {
                logger.warn('⚠️ [SMART GROUPING] Redis client unavailable when incrementing counter');
                return 0;
            }
            const count = await redisClient.incr(key);
            
            // Set expiration only on first occurrence
            if (count === 1) {
                await redisClient.expire(key, expirationSeconds);
            }
            
            return count;
            
        } catch (error) {
            logger.error('❌ [SMART GROUPING] Error incrementing counter:', error);
            return 0;
        }
    }
    
    /**
     * Generate a grouped alert message
     * @param {string} errorCode - Error code
     * @param {number} count - Number of occurrences
     * @param {number} windowMinutes - Time window
     * @param {string} template - Message template from policy
     * @returns {string} Formatted message
     */
    static generateGroupedMessage(errorCode, count, windowMinutes, template) {
        const defaultTemplate = '🚨 {count} {errorCode} failures detected in {window} minutes';
        const messageTemplate = template || defaultTemplate;
        
        return messageTemplate
            .replace('{count}', count)
            .replace('{errorCode}', errorCode)
            .replace('{window}', windowMinutes);
    }
}

module.exports = SmartGroupingService;

