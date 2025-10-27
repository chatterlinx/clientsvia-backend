// clients/index.js
// Centralized client exports for Redis, Email, and SMS

const redis = require('redis');
const logger = require('../utils/logger.js');

let redisClient = null;
let AdminNotificationService; // Lazy load to avoid circular dependency

/**
 * Initialize Redis client with v5+ compatible configuration
 */
async function initializeRedis() {
  // Lazy load AdminNotificationService to avoid circular dependency
  if (!AdminNotificationService) {
    try {
      AdminNotificationService = require('../services/AdminNotificationService');
    } catch (err) {
      logger.warn('⚠️ [REDIS] AdminNotificationService not available during initialization', { error: err.message });
    }
  }

  const connectionStartTime = Date.now();
  let retriesAttempted = 0;

  try {
    // Redis v5+ URL-based connection format
    const redisUrl = process.env.REDIS_URL || 
      `redis://${process.env.REDIS_PASSWORD ? `:${process.env.REDIS_PASSWORD}@` : ''}${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;
    
    redisClient = redis.createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          retriesAttempted = retries;
          
          if (retries > 3) {
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
          return Math.min(retries * 100, 3000);
        }
      }
    });

    // ========================================================================
    // REDIS CONNECTION EVENT MONITORING
    // ========================================================================

    redisClient.on('connect', () => {
      logger.security('✅ Redis Session Store connected');
    });

    redisClient.on('ready', () => {
      const connectionTime = Date.now() - connectionStartTime;
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

    // 🚨 CRITICAL: Redis error
    redisClient.on('error', async (err) => {
      logger.error('❌ [REDIS] Connection error', { error: err.message, stack: err.stack });
      
      // Don't alert on every error (may be transient), but log it
      if (AdminNotificationService && err.code !== 'ECONNREFUSED') { // Only alert on non-connection-refused errors
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
      
      redisClient = null; // Disable Redis operations
    });

    // ⚠️ WARNING: Redis disconnected
    redisClient.on('end', async () => {
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
    });

    // ℹ️ INFO: Redis reconnecting
    redisClient.on('reconnecting', () => {
      logger.info('🔄 [REDIS] Attempting to reconnect...', { attempt: retriesAttempted + 1 });
    });

    // Connect to Redis (required in v5+)
    await redisClient.connect();
    
    // Test connection
    await redisClient.ping();
    const connectionTime = Date.now() - connectionStartTime;
    logger.debug('🚀 Redis client initialized successfully', { connectionTimeMs: connectionTime });
    
    return redisClient;

  } catch (error) {
    const connectionTime = Date.now() - connectionStartTime;
    logger.error('❌ [REDIS] Initialization failed', {
      error: error.message,
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

// Initialize Redis on module load
initializeRedis().catch(err => {
  logger.warn('⚠️ Redis initialization failed:', { timestamp: new Date().toISOString() });
});

module.exports = {
  get redisClient() {
    return redisClient;
  },
  initializeRedis
};
