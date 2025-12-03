/**
 * ============================================================================
 * REDIS CLIENT CONFIGURATION - DEPRECATED WRAPPER
 * ============================================================================
 * 
 * DEPRECATED: This file now wraps services/redisClientFactory.js
 * All new code should import directly from redisClientFactory.
 * 
 * ============================================================================
 */

const { getSharedRedisClient, isRedisConfigured } = require('../../services/redisClientFactory');

// Re-export for backwards compatibility
// NOTE: getRedisClient is now async!
module.exports = {
  async getRedisClient() {
    if (!isRedisConfigured()) {
      return null;
    }
    return await getSharedRedisClient();
  },
  isRedisConfigured
};

