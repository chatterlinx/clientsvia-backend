// clients/index.js
// ============================================================================
// CENTRALIZED CLIENT EXPORTS - Redis, Email, and SMS
// ============================================================================
// 
// REDIS: Uses redisClientFactory.js for standardized connection
// All Redis connections use REDIS_URL only - no HOST/PORT/PASSWORD fallbacks
//
// ============================================================================

const logger = require('../utils/logger.js');
const { createNodeRedisClient, isRedisConfigured, getSanitizedRedisUrl } = require('../services/redisClientFactory');

let redisClient = null;
let AdminNotificationService; // Lazy load to avoid circular dependency

/**
 * Initialize Redis client using the centralized factory
 * 
 * STANDARDIZED CONNECTION:
 * - Uses REDIS_URL only (no HOST/PORT/PASSWORD fallbacks)
 * - Never falls back to localhost
 * - Returns null if REDIS_URL not configured
 */
async function initializeRedis() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🔧 [REDIS] INITIALIZATION STARTED (using redisClientFactory)');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`🔍 [REDIS] Node.js version: ${process.version}`);
  console.log(`🔍 [REDIS] Platform: ${process.platform}`);
  
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
    redisClient = null;
    return null;
  }

  try {
    // ========================================================================
    // CHECKPOINT 2: Create Redis client via factory
    // ========================================================================
    console.log('───────────────────────────────────────────────────────────────────────');
    console.log('🔍 [REDIS] CHECKPOINT 2: Creating client via redisClientFactory...');
    console.log('───────────────────────────────────────────────────────────────────────');
    
    redisClient = createNodeRedisClient();
    
    if (!redisClient) {
      throw new Error('Factory returned null - REDIS_URL may be invalid');
    }
    
    console.log('   └─ ✅ Client created via factory');

    // ========================================================================
    // CHECKPOINT 2.5: Set up additional event handlers
    // ========================================================================
    console.log('───────────────────────────────────────────────────────────────────────');
    console.log('🔍 [REDIS] CHECKPOINT 2.5: Setting up notification handlers...');
    console.log('───────────────────────────────────────────────────────────────────────');

    // Add AdminNotificationService alerts on top of factory handlers
    redisClient.on('ready', () => {
      const connectionTime = Date.now() - connectionStartTime;
      
      // ⚠️ WARNING: Slow Redis connection
      if (connectionTime > 5000 && AdminNotificationService) {
        AdminNotificationService.sendAlert({
          code: 'REDIS_CONNECTION_SLOW',
          severity: 'WARNING',
          companyId: null,
          companyName: 'Platform',
          message: '⚠️ Slow Redis connection detected',
          details: `Redis connection took ${connectionTime}ms (threshold: 5000ms).`,
          stackTrace: null
        }).catch(notifErr => logger.error('Failed to send Redis slow alert:', notifErr));
      }
    });

    redisClient.on('error', async (err) => {
      if (AdminNotificationService && err.code !== 'ECONNREFUSED') {
        await AdminNotificationService.sendAlert({
          code: 'REDIS_CONNECTION_ERROR',
          severity: 'WARNING',
          companyId: null,
          companyName: 'Platform',
          message: '⚠️ Redis connection error',
          details: {
            error: err.message,
            errorCode: err.code || 'UNKNOWN',
            impact: 'Cache operations may be failing - Performance degraded',
            action: 'Check Redis logs, verify service health'
          },
          stackTrace: err.stack
        }).catch(notifErr => logger.error('Failed to send Redis error alert:', notifErr));
      }
    });

    redisClient.on('end', async () => {
      if (AdminNotificationService) {
        await AdminNotificationService.sendAlert({
          code: 'REDIS_CONNECTION_CLOSED',
          severity: 'WARNING',
          companyId: null,
          companyName: 'Platform',
          message: '⚠️ Redis connection closed',
          details: 'Redis connection was closed. Cache unavailable until reconnected.',
          stackTrace: new Error().stack
        }).catch(notifErr => logger.error('Failed to send Redis close alert:', notifErr));
      }
      redisClient = null;
    });
    
    console.log('   └─ Event handlers attached');

    // ========================================================================
    // CHECKPOINT 3: Connect to Redis (required in v5+)
    // ========================================================================
    console.log('───────────────────────────────────────────────────────────────────────');
    console.log('🔍 [REDIS] CHECKPOINT 3: Initiating connection...');
    console.log('───────────────────────────────────────────────────────────────────────');
    
    const connectStart = Date.now();
    await redisClient.connect();
    const connectTime = Date.now() - connectStart;
    console.log(`   └─ ✅ connect() completed in ${connectTime}ms`);
    
    // ========================================================================
    // CHECKPOINT 4: Test connection with ping
    // ========================================================================
    console.log('───────────────────────────────────────────────────────────────────────');
    console.log('🔍 [REDIS] CHECKPOINT 4: Testing connection with PING...');
    console.log('───────────────────────────────────────────────────────────────────────');
    
    const pingStart = Date.now();
    const pingResult = await redisClient.ping();
    const pingTime = Date.now() - pingStart;
    console.log(`   ├─ Ping result: ${pingResult}`);
    console.log(`   └─ Ping latency: ${pingTime}ms`);
    
    // ========================================================================
    // SUCCESS: All checkpoints passed
    // ========================================================================
    const connectionTime = Date.now() - connectionStartTime;
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log(`✅ [REDIS] ALL CHECKPOINTS PASSED - Connected in ${connectionTime}ms`);
    console.log('═══════════════════════════════════════════════════════════════════════');
    logger.debug('🚀 Redis client initialized successfully', { connectionTimeMs: connectionTime });
    
    return redisClient;

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

    redisClient = null;
    return null;
  }
}

// Redis initialization is handled explicitly in index.js during server startup
// to ensure proper async sequencing with database and other services
logger.info('📦 [REDIS] Redis client module loaded - waiting for explicit initialization');

module.exports = {
  get redisClient() {
    return redisClient;
  },
  initializeRedis
};
