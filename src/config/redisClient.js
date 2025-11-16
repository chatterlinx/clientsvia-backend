/**
 * ============================================================================
 * REDIS CLIENT CONFIGURATION
 * ============================================================================
 * 
 * PURPOSE: Shared Redis connection for call context and caching
 * INTEGRATION: Uses existing Redis client from root-level clients.js
 * SCOPE: Imported by services that need Redis access
 * 
 * ============================================================================
 */

const { redisClient } = require('../../db');

// Re-export the existing Redis client from centralized location
// This allows services to import from a consistent location
module.exports = redisClient;

