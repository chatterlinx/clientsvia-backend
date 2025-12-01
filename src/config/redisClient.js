/**
 * ============================================================================
 * REDIS CLIENT CONFIGURATION
 * ============================================================================
 * 
 * PURPOSE: Shared Redis connection for call context and caching
 * INTEGRATION: Uses existing Redis client from root-level db.js
 * SCOPE: Imported by services that need Redis access
 * 
 * CRITICAL: redisClient is exported as a getter from db.js to avoid
 * capturing null value at module load time. We must re-export it the same way.
 * 
 * ============================================================================
 */

const db = require('../../db');

// Re-export using getter pattern to ensure we always get the live Redis client
// This prevents capturing null at module load time
module.exports = {
  get redisClient() {
    return db.redisClient;
  }
};

