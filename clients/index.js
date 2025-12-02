// clients/index.js
// Centralized client exports for Redis, Email, and SMS

const redis = require('redis');
const logger = require('../utils/logger.js');

let redisClient = null;
let AdminNotificationService; // Lazy load to avoid circular dependency

/**
 * Initialize Redis client with v5+ compatible configuration
 * 
 * GRACEFUL DEGRADATION:
 * - If no Redis configuration is provided, skips Redis entirely
 * - Does NOT fall back to localhost (which would always fail on cloud platforms)
 * - Returns null to indicate Redis is not available
 */
async function initializeRedis() {
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log('🔧 [REDIS] INITIALIZATION STARTED');
  console.log('═══════════════════════════════════════════════════════════════════════');
  console.log(`🔍 [REDIS] Node.js version: ${process.version}`);
  console.log(`🔍 [REDIS] Platform: ${process.platform}`);
  console.log(`🔍 [REDIS] redis package version: ${require('redis/package.json').version}`);
  
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
  let retriesAttempted = 0;

  // ========================================================================
  // CHECKPOINT 1: Check if Redis is configured
  // ========================================================================
  console.log('───────────────────────────────────────────────────────────────────────');
  console.log('🔍 [REDIS] CHECKPOINT 1: Checking environment variables...');
  console.log('───────────────────────────────────────────────────────────────────────');
  
  const redisUrlFromEnv = process.env.REDIS_URL;
  const redisHostFromEnv = process.env.REDIS_HOST;
  const redisConfigured = !!(redisUrlFromEnv || redisHostFromEnv);
  
  console.log(`   ├─ REDIS_URL: ${redisUrlFromEnv ? `EXISTS (${redisUrlFromEnv.length} chars)` : '❌ NOT SET'}`);
  console.log(`   ├─ REDIS_HOST: ${redisHostFromEnv ? `EXISTS (${redisHostFromEnv})` : '(not set, optional)'}`);
  console.log(`   └─ Redis configured: ${redisConfigured ? '✅ YES' : '❌ NO'}`);
  
  // ========================================================================
  // GRACEFUL SKIP: No Redis configuration provided
  // ========================================================================
  if (!redisConfigured) {
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('⚠️ [REDIS] SKIPPING INITIALIZATION - No Redis configuration found');
    console.log('═══════════════════════════════════════════════════════════════════════');
    console.log('⚠️ [REDIS] Platform will operate without Redis caching');
    console.log('⚠️ [REDIS] To enable Redis, set REDIS_URL environment variable');
    logger.warn('[REDIS] ⚠️ Redis NOT configured - operating in MEMORY-ONLY mode');
    logger.warn('[REDIS] Sessions and cache will NOT persist across restarts');
    redisClient = null;
    return null;
  }
  
  if (redisUrlFromEnv) {
    // Log sanitized URL (hide password)
    const sanitizedUrl = redisUrlFromEnv.replace(/:([^@]+)@/, ':***@');
    console.log(`   ├─ URL format (sanitized): ${sanitizedUrl}`);
    console.log(`   ├─ URL starts with redis://: ${redisUrlFromEnv.startsWith('redis://')}`);
    console.log(`   └─ URL starts with rediss:// (TLS): ${redisUrlFromEnv.startsWith('rediss://')}`);
  }

  try {
    // ========================================================================
    // CHECKPOINT 2: Create Redis client
    // ========================================================================
    console.log('───────────────────────────────────────────────────────────────────────');
    console.log('🔍 [REDIS] CHECKPOINT 2: Creating Redis client...');
    console.log('───────────────────────────────────────────────────────────────────────');
    
    // Redis v5+ URL-based connection format
    // Only use REDIS_URL or build from REDIS_HOST - never default to localhost
    const redisUrl = process.env.REDIS_URL || 
      `redis://${process.env.REDIS_PASSWORD ? `:${process.env.REDIS_PASSWORD}@` : ''}${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`;
    
    // Check if using TLS (rediss://)
    const isTLS = redisUrl.startsWith('rediss://');
    console.log(`   ├─ TLS enabled: ${isTLS ? '✅ YES (rediss://)' : 'NO (redis://)'}`);
    console.log(`   ├─ URL length: ${redisUrl.length} chars`);
    
    // ========================================================================
    // PERFORMANCE OPTIMIZATIONS FOR PAID REDIS
    // ========================================================================
    // - keepAlive: Prevents connection drops, reduces reconnect overhead
    // - noDelay: Disables Nagle's algorithm for faster small packets
    // - connectTimeout: Fast failure detection
    // - commandTimeout: Prevents hanging on slow commands
    // ========================================================================
    
    // Build socket configuration
    const socketConfig = {
      // 🚀 PERFORMANCE: Keep connections alive (reduces reconnect latency)
      keepAlive: 5000, // Send keepalive every 5 seconds
      
      // 🚀 PERFORMANCE: Disable Nagle's algorithm (faster small packets)
      noDelay: true,
      
      // 🚀 PERFORMANCE: Connection timeout (fail fast, don't hang)
      connectTimeout: 10000, // 10 seconds max to connect
      
      reconnectStrategy: (retries) => {
        retriesAttempted = retries;
        console.log(`🔄 [REDIS] Reconnection attempt #${retries}`);
        
        if (retries > 3) {
          console.log('❌ [REDIS] Max reconnection attempts (3) reached. Giving up.');
          logger.warn('⚠️ Redis max reconnection attempts reached. Operating without cache.');
          
          // 🚨 CRITICAL: Redis exhausted reconnection attempts
          if (AdminNotificationService) {
            AdminNotificationService.sendAlert({
              code: 'REDIS_RECONNECT_MAX_ATTEMPTS',
              severity: 'CRITICAL',
              companyId: null,
              companyName: 'Platform',
              message: '🔴 CRITICAL: Redis reconnection failed after 3 attempts',
              details: {
                retriesAttempted: retries,
                maxRetries: 3,
                impact: 'Cache unavailable - Performance degraded, all queries hit database',
                action: 'Check Redis service health, verify REDIS_URL, check network connectivity'
              },
              stackTrace: new Error().stack
            }).catch(notifErr => logger.error('Failed to send Redis reconnect alert:', notifErr));
          }
          
          return false; // Stop retrying
        }
        // Exponential backoff: 100ms, 200ms, 400ms, max 3000ms
        const delay = Math.min(retries * 100, 3000);
        console.log(`🔄 [REDIS] Will retry in ${delay}ms`);
        return delay;
      }
    };
    
    // Add TLS config if using rediss://
    if (isTLS) {
      console.log(`   ├─ Adding TLS configuration for rediss://`);
      socketConfig.tls = true;
      socketConfig.rejectUnauthorized = false; // Render's Redis uses self-signed certs
      console.log(`   ├─ tls: true`);
      console.log(`   └─ rejectUnauthorized: false (for self-signed certs)`);
    }
    
    console.log(`   └─ Creating client with socket config...`);
    
    try {
      redisClient = redis.createClient({
        url: redisUrl,
        socket: socketConfig,
        // 🚀 PERFORMANCE: Command queue settings
        commandsQueueMaxLength: 1000, // Prevent memory issues under load
        disableOfflineQueue: false // Queue commands while reconnecting
      });
      console.log('   ✅ redis.createClient() succeeded - client object created');
    } catch (createError) {
      console.log('   ❌ redis.createClient() FAILED');
      console.log(`   ├─ Error name: ${createError.name}`);
      console.log(`   ├─ Error message: ${createError.message}`);
      console.log(`   ├─ Error code: ${createError.code || 'N/A'}`);
      console.log(`   └─ Stack: ${createError.stack}`);
      throw createError;
    }

    // ========================================================================
    // CHECKPOINT 2.5: Set up event handlers BEFORE connecting
    // ========================================================================
    console.log('───────────────────────────────────────────────────────────────────────');
    console.log('🔍 [REDIS] CHECKPOINT 2.5: Setting up event handlers...');
    console.log('───────────────────────────────────────────────────────────────────────');

    redisClient.on('connect', () => {
      console.log('📡 [REDIS] EVENT: connect - TCP connection established');
      logger.security('✅ Redis Session Store connected');
    });

    redisClient.on('ready', () => {
      const connectionTime = Date.now() - connectionStartTime;
      console.log(`🔥 [REDIS] EVENT: ready - Client ready for commands (${connectionTime}ms)`);
      logger.security('🔥 Redis Session Store ready for v2 operations');
      logger.info('✅ [REDIS] Connected and ready', { connectionTimeMs: connectionTime });

      // ⚠️ WARNING: Slow Redis connection
      // Threshold: 5000ms (5 seconds) - accounts for Render free tier cold starts
      if (connectionTime > 5000 && AdminNotificationService) {
        AdminNotificationService.sendAlert({
          code: 'REDIS_CONNECTION_SLOW',
          severity: 'WARNING',
          companyId: null,
          companyName: 'Platform',
          message: '⚠️ Slow Redis connection detected',
          details: `Redis connection took ${connectionTime}ms (threshold: 5000ms). This may indicate network latency or Redis service performance issues. Note: Render free tier cold starts (3-5 seconds) are normal.`,
          stackTrace: null
        }).catch(notifErr => logger.error('Failed to send Redis slow alert:', notifErr));
      }
    });

    // 🚨 CRITICAL: Redis error - DO NOT nullify client during initialization
    redisClient.on('error', async (err) => {
      console.log('❌ [REDIS] EVENT: error');
      console.log(`   ├─ Error name: ${err.name}`);
      console.log(`   ├─ Error message: ${err.message}`);
      console.log(`   ├─ Error code: ${err.code || 'N/A'}`);
      console.log(`   ├─ Error errno: ${err.errno || 'N/A'}`);
      console.log(`   ├─ Error syscall: ${err.syscall || 'N/A'}`);
      console.log(`   └─ Error hostname: ${err.hostname || 'N/A'}`);
      
      logger.error('❌ [REDIS] Connection error', { 
        error: err.message, 
        code: err.code,
        errno: err.errno,
        syscall: err.syscall,
        hostname: err.hostname,
        stack: err.stack 
      });
      
      // Don't alert on every error (may be transient), but log it
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
            errno: err.errno,
            syscall: err.syscall,
            impact: 'Cache operations may be failing - Performance degraded',
            action: 'Check Redis logs, verify service health'
          },
          stackTrace: err.stack
        }).catch(notifErr => logger.error('Failed to send Redis error alert:', notifErr));
      }
      
      // NOTE: We intentionally do NOT set redisClient = null here anymore
      // The error event fires during connection attempts too, and we need to let
      // the reconnection strategy handle recovery. Only the catch block should null it.
    });

    // ⚠️ WARNING: Redis disconnected
    redisClient.on('end', async () => {
      console.log('🔌 [REDIS] EVENT: end - Connection closed');
      logger.warn('⚠️ [REDIS] Connection closed');
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
      // Null the client when connection ends (intentional disconnection)
      redisClient = null;
    });

    // ℹ️ INFO: Redis reconnecting
    redisClient.on('reconnecting', () => {
      console.log(`🔄 [REDIS] EVENT: reconnecting (attempt #${retriesAttempted + 1})`);
      logger.info('🔄 [REDIS] Attempting to reconnect...', { attempt: retriesAttempted + 1 });
    });
    
    console.log('   └─ Event handlers attached: connect, ready, error, end, reconnecting');

    // ========================================================================
    // CHECKPOINT 3: Connect to Redis (required in v5+)
    // ========================================================================
    console.log('───────────────────────────────────────────────────────────────────────');
    console.log('🔍 [REDIS] CHECKPOINT 3: Initiating connection...');
    console.log('───────────────────────────────────────────────────────────────────────');
    
    const connectStart = Date.now();
    try {
      await redisClient.connect();
      const connectTime = Date.now() - connectStart;
      console.log(`   └─ ✅ connect() completed in ${connectTime}ms`);
    } catch (connectError) {
      const connectTime = Date.now() - connectStart;
      console.log(`   ❌ connect() FAILED after ${connectTime}ms`);
      console.log(`   ├─ Error name: ${connectError.name}`);
      console.log(`   ├─ Error message: ${connectError.message}`);
      console.log(`   ├─ Error code: ${connectError.code || 'N/A'}`);
      console.log(`   └─ Full error: ${JSON.stringify(connectError, Object.getOwnPropertyNames(connectError), 2)}`);
      throw connectError;
    }
    
    // ========================================================================
    // CHECKPOINT 4: Test connection with ping
    // ========================================================================
    console.log('───────────────────────────────────────────────────────────────────────');
    console.log('🔍 [REDIS] CHECKPOINT 4: Testing connection with PING...');
    console.log('───────────────────────────────────────────────────────────────────────');
    
    const pingStart = Date.now();
    try {
      const pingResult = await redisClient.ping();
      const pingTime = Date.now() - pingStart;
      console.log(`   ├─ Ping result: ${pingResult}`);
      console.log(`   └─ Ping latency: ${pingTime}ms`);
    } catch (pingError) {
      const pingTime = Date.now() - pingStart;
      console.log(`   ❌ PING FAILED after ${pingTime}ms`);
      console.log(`   ├─ Error: ${pingError.message}`);
      console.log(`   └─ This indicates connection is not healthy`);
      throw pingError;
    }
    
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
    console.log(`   ├─ Error errno: ${error.errno || 'N/A'}`);
    console.log(`   ├─ Error syscall: ${error.syscall || 'N/A'}`);
    console.log(`   ├─ Error hostname: ${error.hostname || 'N/A'}`);
    console.log(`   ├─ Error address: ${error.address || 'N/A'}`);
    console.log(`   ├─ Error port: ${error.port || 'N/A'}`);
    
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
    } else if (error.code === 'ECONNRESET') {
      console.log('   ├─ DIAGNOSIS: Connection was reset by peer');
      console.log('   └─ ACTION: Redis may have closed connection, check Redis logs');
    } else if (error.message.includes('WRONGPASS') || error.message.includes('AUTH')) {
      console.log('   ├─ DIAGNOSIS: Authentication failed - wrong password');
      console.log('   └─ ACTION: Verify Redis password in REDIS_URL is correct');
    } else if (error.message.includes('certificate') || error.message.includes('TLS') || error.message.includes('SSL')) {
      console.log('   ├─ DIAGNOSIS: TLS/SSL certificate issue');
      console.log('   └─ ACTION: Check TLS settings, try rejectUnauthorized: false');
    } else {
      console.log(`   └─ Stack trace: ${error.stack}`);
    }
    
    console.log('═══════════════════════════════════════════════════════════════════════');
    
    logger.error('❌ [REDIS] Initialization failed', {
      error: error.message,
      code: error.code,
      errno: error.errno,
      syscall: error.syscall,
      hostname: error.hostname,
      address: error.address,
      port: error.port,
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
          errorName: error.name || 'Error',
          errno: error.errno,
          syscall: error.syscall,
          hostname: error.hostname,
          impact: 'Cache unavailable - All queries hit database directly, performance severely degraded',
          action: 'Check Redis service status, verify REDIS_URL/REDIS_HOST/REDIS_PORT, check network connectivity, verify Redis password if authentication enabled'
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
