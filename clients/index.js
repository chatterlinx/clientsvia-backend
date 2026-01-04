// clients/index.js
// ============================================================================
// CENTRALIZED CLIENT EXPORTS - Redis, Email, and SMS
// ============================================================================
// 
// REDIS: Uses the SINGLE shared client from redisClientFactory.js
// This module does NOT create its own Redis client.
// All Redis operations use the factory's singleton.
//
// ============================================================================

const logger = require('../utils/logger.js');
const { 
  getSharedRedisClient,
  getSharedRedisClientSync,
  isRedisConfigured, 
  getSanitizedRedisUrl,
  redisHealthCheck,
  warmupRedis 
} = require('../services/redisClientFactory');

let AdminNotificationService; // Lazy load to avoid circular dependency

/**
 * Initialize Redis using the centralized factory's shared client
 * 
 * IMPORTANT: This does NOT create a new client.
 * It initializes the factory's singleton and returns it.
 */
async function initializeRedis() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🔧 [REDIS INIT] STARTING (via factory singleton)');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`🔍 [REDIS INIT] Node.js version: ${process.version}`);
  console.log(`🔍 [REDIS INIT] Platform: ${process.platform}`);
  
  // Lazy load AdminNotificationService to avoid circular dependency
  if (!AdminNotificationService) {
    try {
      AdminNotificationService = require('../services/AdminNotificationService');
      console.log('🔍 [REDIS] AdminNotificationService loaded successfully');
    } catch (err) {
      console.log(`🔍 [REDIS] AdminNotificationService not available: ${err.message}`);
      logger.warn('⚠️ [REDIS] AdminNotificationService not available during initialization', { error: err.message });
    }
  }

  const connectionStartTime = Date.now();

  // ========================================================================
  // CHECKPOINT 1: Check if Redis is configured via factory
  // ========================================================================
  console.log('───────────────────────────────────────────────────────────────────────');
  console.log('🔍 [REDIS] CHECKPOINT 1: Checking REDIS_URL via factory...');
  console.log('───────────────────────────────────────────────────────────────────────');
  
  const redisConfigured = isRedisConfigured();
  console.log(`   ├─ REDIS_URL configured: ${redisConfigured ? '✅ YES' : '❌ NO'}`);
  console.log(`   └─ URL (sanitized): ${getSanitizedRedisUrl()}`);
  
  // ========================================================================
  // GRACEFUL SKIP: No Redis configuration provided
  // ========================================================================
  if (!redisConfigured) {
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('⚠️ [REDIS] SKIPPING - REDIS_URL not set');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('⚠️ [REDIS] Platform will operate without Redis caching');
    console.log('⚠️ [REDIS] To enable Redis, set REDIS_URL environment variable');
    logger.warn('[REDIS] ⚠️ Redis NOT configured - operating in MEMORY-ONLY mode');
    logger.warn('[REDIS] Sessions and cache will NOT persist across restarts');
    return null;
  }

  try {
    // ========================================================================
    // CHECKPOINT 2: Get shared client from factory (creates if needed)
    // ========================================================================
    console.log('───────────────────────────────────────────────────────────────────────');
    console.log('🔍 [REDIS] CHECKPOINT 2: Getting shared client from factory...');
    console.log('───────────────────────────────────────────────────────────────────────');
    
    const client = await getSharedRedisClient();
    
    if (!client) {
      throw new Error('Factory returned null - could not connect to Redis');
    }
    
    console.log('   └─ ✅ Shared client obtained from factory');

    // ========================================================================
    // CHECKPOINT 3: Run canonical health check
    // ========================================================================
    console.log('───────────────────────────────────────────────────────────────────────');
    console.log('🔍 [REDIS] CHECKPOINT 3: Running health check (SET/GET/DEL)...');
    console.log('───────────────────────────────────────────────────────────────────────');
    
    const healthResult = await redisHealthCheck();
    
    if (!healthResult.ok) {
      throw new Error(`Health check failed: ${healthResult.errorMessage} (code: ${healthResult.errorCode})`);
    }
    
    console.log(`   ├─ Health check: ✅ PASSED`);
    console.log(`   └─ Round trip time: ${healthResult.rttMs}ms`);
    
    // ========================================================================
    // SUCCESS: All checkpoints passed
    // ========================================================================
    const connectionTime = Date.now() - connectionStartTime;
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`✅ [REDIS] ALL CHECKPOINTS PASSED - Ready in ${connectionTime}ms`);
    console.log('═══════════════════════════════════════════════════════════════════════');
    logger.debug('🚀 Redis initialized successfully via factory', { connectionTimeMs: connectionTime });
    
    // ⚠️ WARNING: Slow Redis connection
    if (connectionTime > 5000 && AdminNotificationService) {
      AdminNotificationService.sendAlert({
        code: 'REDIS_CONNECTION_SLOW',
        severity: 'WARNING',
        companyId: null,
        companyName: 'Platform',
        message: '⚠️ Slow Redis connection detected',
        details: `Redis initialization took ${connectionTime}ms (threshold: 5000ms).`,
        stackTrace: null
      }).catch(notifErr => logger.error('Failed to send Redis slow alert:', notifErr));
    }
    
    return client;

  } catch (error) {
    const connectionTime = Date.now() - connectionStartTime;
    
    // ========================================================================
    // INITIALIZATION FAILED - Detailed error report
    // ========================================================================
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('❌ [REDIS] INITIALIZATION FAILED');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`   ├─ Duration: ${connectionTime}ms`);
    console.log(`   ├─ Error name: ${error.name}`);
    console.log(`   ├─ Error message: ${error.message}`);
    console.log(`   ├─ Error code: ${error.code || 'N/A'}`);
    
    // Common error diagnostics
    if (error.code === 'ENOTFOUND') {
      console.log('   ├─ DIAGNOSIS: DNS lookup failed - Redis hostname not found');
      console.log('   └─ ACTION: Check if REDIS_URL hostname is correct');
    } else if (error.code === 'ECONNREFUSED') {
      console.log('   ├─ DIAGNOSIS: Connection refused - Redis not accepting connections');
      console.log('   └─ ACTION: Check if Redis service is running');
    } else if (error.code === 'ETIMEDOUT') {
      console.log('   ├─ DIAGNOSIS: Connection timed out');
      console.log('   └─ ACTION: Check network/firewall, Redis may be unreachable');
    } else {
      console.log(`   └─ Stack trace: ${error.stack}`);
    }
    
    console.log('═══════════════════════════════════════════════════════════════════════');
    
    logger.error('❌ [REDIS] Initialization failed', {
      error: error.message,
      code: error.code,
      stack: error.stack,
      connectionTimeMs: connectionTime
    });

    // 🚨 CRITICAL: Redis connection failed
    if (AdminNotificationService) {
      await AdminNotificationService.sendAlert({
        code: 'REDIS_CONNECTION_FAILURE',
        severity: 'CRITICAL',
        companyId: null,
        companyName: 'Platform',
        message: '🔴 CRITICAL: Redis connection failed - Cache unavailable',
        details: {
          error: error.message,
          connectionTimeMs: connectionTime,
          errorCode: error.code || 'UNKNOWN',
          impact: 'Cache unavailable - All queries hit database directly',
          action: 'Check Redis service status, verify REDIS_URL is correct'
        },
        stackTrace: error.stack
      }).catch(notifErr => logger.error('Failed to send Redis connection failure alert:', notifErr));
    }

    return null;
  }
}

// Redis initialization is handled explicitly in index.js during server startup
// to ensure proper async sequencing with database and other services
logger.info('📦 [REDIS] Redis client module loaded - using factory singleton');

module.exports = {
  // Synchronous getter - returns the shared client or null
  // This maintains backward compatibility with existing code
  get redisClient() {
    return getSharedRedisClientSync();
  },
  // Async getter for when you need the client guaranteed connected
  getRedisClient: getSharedRedisClient,
  initializeRedis,
  // Re-export health check for convenience
  redisHealthCheck
};
