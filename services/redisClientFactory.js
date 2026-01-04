// ============================================================================
// 🔴 REDIS CLIENT FACTORY - SINGLE SOURCE OF TRUTH
// ============================================================================
// 
// This is the ONLY place that knows how to connect to Redis.
// All Redis connections in the codebase MUST use this factory.
//
// WHY THIS EXISTS:
// - Standardizes on REDIS_URL (no HOST/PORT/PASSWORD chaos)
// - Prevents localhost fallbacks that break in production
// - Provides consistent error handling and logging
// - Single point to update Redis config if needed
//
// USAGE:
//   const { createIORedisClient } = require('./redisClientFactory');
//   const redis = createIORedisClient();
//
//   OR for node-redis v5:
//   const { createNodeRedisClient } = require('./redisClientFactory');
//   const client = createNodeRedisClient();
//
// ============================================================================

const Redis = require('ioredis');
const { createClient } = require('redis');
const logger = require('../utils/logger');

// ============================================================================
// ENVIRONMENT VALIDATION - SIMPLE, BRUTAL LOGGING
// ============================================================================
const REDIS_URL = process.env.REDIS_URL;

if (!REDIS_URL) {
  console.error('[REDIS FACTORY] ❌ REDIS_URL is NOT SET');
  console.error('[REDIS FACTORY] ❌ Set REDIS_URL in Render environment variables');
  logger.error('[REDIS FACTORY] REDIS_URL environment variable is missing');
} else {
  // Sanitize URL for logging (hide password if present)
  const sanitizedUrl = REDIS_URL.replace(/:([^@]+)@/, ':***@');
  console.log('[REDIS FACTORY] ✅ Using REDIS_URL:', sanitizedUrl);
  logger.info('[REDIS FACTORY] Redis URL configured', { urlLength: REDIS_URL.length });
}

// ============================================================================
// SHARED CLIENT SINGLETON - For health checks and reuse
// ============================================================================
let sharedClient = null;
let sharedClientConnected = false;

/**
 * Get the shared Redis client (singleton) - ASYNC
 * Creates one if it doesn't exist, connects it, returns existing if already connected
 * @returns {Promise<Object|null>} - The connected shared node-redis client or null
 */
async function getSharedRedisClient() {
  if (!REDIS_URL) {
    return null;
  }
  
  // If we have a connected client, return it
  if (sharedClient && sharedClientConnected) {
    return sharedClient;
  }
  
  // If client exists but disconnected, try to reconnect
  if (sharedClient && !sharedClientConnected) {
    try {
      await sharedClient.connect();
      return sharedClient;
    } catch (err) {
      console.warn('[REDIS FACTORY] Reconnect failed, creating new client:', err.message);
      sharedClient = null;
      sharedClientConnected = false;
    }
  }
  
  // Create new client
  if (!sharedClient) {
    sharedClient = createNodeRedisClient();
    
    if (sharedClient) {
      sharedClient.on('ready', () => {
        sharedClientConnected = true;
        console.log('[REDIS FACTORY] ✅ Shared client ready');
      });
      
      sharedClient.on('end', () => {
        sharedClientConnected = false;
        console.log('[REDIS FACTORY] Shared client disconnected');
      });
      
      sharedClient.on('error', (err) => {
        console.error('[REDIS FACTORY] Shared client error:', err.message);
      });
      
      // CRITICAL: Connect the client!
      try {
        await sharedClient.connect();
        console.log('[REDIS FACTORY] ✅ Shared client connected');
      } catch (err) {
        console.error('[REDIS FACTORY] ❌ Shared client connect failed:', err.message);
        sharedClient = null;
        sharedClientConnected = false;
        return null;
      }
    }
  }
  
  return sharedClient;
}

/**
 * Check if shared client is connected and ready
 * @returns {boolean}
 */
function isSharedClientReady() {
  return sharedClient && sharedClientConnected;
}

/**
 * Get the shared client synchronously (may be null if not connected)
 * Use this for backward compatibility with code expecting sync access
 * @returns {Object|null} - The shared client or null
 */
function getSharedRedisClientSync() {
  if (sharedClient && sharedClientConnected) {
    return sharedClient;
  }
  return null;
}

// ============================================================================
// IOREDIS CLIENT FACTORY
// ============================================================================
// For services currently using ioredis (TriageCardService, SessionManager, etc.)
// ============================================================================

/**
 * Creates an ioredis client instance
 * @param {Object} overrides - Optional config overrides
 * @returns {Redis|null} - ioredis client or null if REDIS_URL not set
 */
function createIORedisClient(overrides = {}) {
  if (!REDIS_URL) {
    console.warn('🔴 [REDIS FACTORY] Cannot create ioredis client - REDIS_URL not set');
    logger.warn('🔴 [REDIS FACTORY] ioredis client creation skipped - no REDIS_URL');
    return null;
  }

  const client = new Redis(REDIS_URL, {
    // Connection settings
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: false,
    
    // Reconnection strategy
    retryStrategy(times) {
      if (times > 5) {
        console.error(`🔴 [REDIS FACTORY] ioredis max retries (${times}) exceeded`);
        logger.error('🔴 [REDIS FACTORY] ioredis connection failed after max retries', { attempts: times });
        return null; // Stop retrying
      }
      const delay = Math.min(times * 100, 3000);
      console.log(`🔴 [REDIS FACTORY] ioredis retry #${times} in ${delay}ms`);
      return delay;
    },
    
    // Apply any overrides
    ...overrides,
  });

  // Event handlers
  client.on('connect', () => {
    console.log('🔴 [REDIS FACTORY] ioredis connected');
    logger.info('🔴 [REDIS FACTORY] ioredis client connected');
  });

  client.on('ready', () => {
    console.log('🔴 [REDIS FACTORY] ioredis ready for commands');
    logger.info('🔴 [REDIS FACTORY] ioredis client ready');
  });

  client.on('error', (err) => {
    console.error('🔴 [REDIS FACTORY] ioredis error:', err.message);
    logger.error('🔴 [REDIS FACTORY] ioredis client error', { 
      error: err.message, 
      code: err.code 
    });
  });

  client.on('close', () => {
    console.warn('🔴 [REDIS FACTORY] ioredis connection closed');
    logger.warn('🔴 [REDIS FACTORY] ioredis connection closed');
  });

  return client;
}

// ============================================================================
// NODE-REDIS V5 CLIENT FACTORY
// ============================================================================
// For services using node-redis (clients/index.js, redisSessionStore, etc.)
// ============================================================================

/**
 * Creates a node-redis v5 client instance
 * @param {Object} overrides - Optional config overrides
 * @returns {Object|null} - node-redis client or null if REDIS_URL not set
 */
function createNodeRedisClient(overrides = {}) {
  if (!REDIS_URL) {
    console.warn('🔴 [REDIS FACTORY] Cannot create node-redis client - REDIS_URL not set');
    logger.warn('🔴 [REDIS FACTORY] node-redis client creation skipped - no REDIS_URL');
    return null;
  }

  // Check if using TLS (rediss://)
  const isTLS = REDIS_URL.startsWith('rediss://');
  
  const socketConfig = {
    // Performance optimizations
    keepAlive: 5000,
    noDelay: true,
    connectTimeout: 10000,
    
    // Reconnection strategy
    reconnectStrategy: (retries) => {
      if (retries > 5) {
        console.error(`🔴 [REDIS FACTORY] node-redis max retries (${retries}) exceeded`);
        logger.error('🔴 [REDIS FACTORY] node-redis connection failed after max retries', { attempts: retries });
        return false; // Stop retrying
      }
      const delay = Math.min(retries * 100, 3000);
      console.log(`🔴 [REDIS FACTORY] node-redis retry #${retries} in ${delay}ms`);
      return delay;
    },
    
    // TLS config if using rediss://
    ...(isTLS && {
      tls: true,
      rejectUnauthorized: false // Render uses self-signed certs
    }),
    
    // Apply socket overrides
    ...overrides.socket,
  };

  const client = createClient({
    url: REDIS_URL,
    socket: socketConfig,
    commandsQueueMaxLength: 1000,
    disableOfflineQueue: false,
    ...overrides,
  });

  // Event handlers
  client.on('connect', () => {
    console.log('🔴 [REDIS FACTORY] node-redis connected');
    logger.info('🔴 [REDIS FACTORY] node-redis client connected');
  });

  client.on('ready', () => {
    console.log('🔴 [REDIS FACTORY] node-redis ready for commands');
    logger.info('🔴 [REDIS FACTORY] node-redis client ready');
  });

  client.on('error', (err) => {
    console.error('🔴 [REDIS FACTORY] node-redis error:', err.message);
    logger.error('🔴 [REDIS FACTORY] node-redis client error', { 
      error: err.message, 
      code: err.code 
    });
  });

  client.on('end', () => {
    console.warn('🔴 [REDIS FACTORY] node-redis connection ended');
    logger.warn('🔴 [REDIS FACTORY] node-redis connection ended');
  });

  client.on('reconnecting', () => {
    console.log('🔴 [REDIS FACTORY] node-redis reconnecting...');
    logger.info('🔴 [REDIS FACTORY] node-redis reconnecting');
  });

  return client;
}

// ============================================================================
// UTILITY: Check if Redis is configured
// ============================================================================

/**
 * Returns true if REDIS_URL is configured
 * @returns {boolean}
 */
function isRedisConfigured() {
  return !!REDIS_URL;
}

/**
 * Returns the REDIS_URL (for logging/debugging only - sanitized)
 * @returns {string}
 */
function getSanitizedRedisUrl() {
  if (!REDIS_URL) return 'NOT_CONFIGURED';
  return REDIS_URL.replace(/:([^@]+)@/, ':***@');
}

// ============================================================================
// REDIS HEALTH CHECK - SINGLE SOURCE OF TRUTH
// ============================================================================
// This is the ONE health check used by /api/readyz AND ER triage
// Performs SET/GET/DEL test and returns standardized result
// ============================================================================

/**
 * Canonical Redis health check - SET/GET/DEL test
 * @returns {Promise<{ok: boolean, rttMs: number|null, errorCode: string|null, errorMessage: string|null}>}
 */
async function redisHealthCheck() {
  // Not configured = not ok (but not an error - just skipped)
  if (!REDIS_URL) {
    return {
      ok: false,
      rttMs: null,
      errorCode: 'NOT_CONFIGURED',
      errorMessage: 'REDIS_URL not set'
    };
  }

  try {
    const client = await getSharedRedisClient();
    
    if (!client) {
      return {
        ok: false,
        rttMs: null,
        errorCode: 'CLIENT_NULL',
        errorMessage: 'Could not get shared Redis client'
      };
    }

    // Perform SET/GET/DEL test
    const testKey = `cv:healthcheck:${Date.now()}`;
    const testValue = 'healthcheck-test';
    const startTime = Date.now();

    // SET
    await client.set(testKey, testValue, { EX: 10 });
    
    // GET and verify
    const retrieved = await client.get(testKey);
    
    // DEL
    await client.del(testKey);

    const rttMs = Date.now() - startTime;

    // Verify round-trip succeeded
    if (retrieved !== testValue) {
      return {
        ok: false,
        rttMs,
        errorCode: 'VALUE_MISMATCH',
        errorMessage: `GET returned '${retrieved}' instead of '${testValue}'`
      };
    }

    return {
      ok: true,
      rttMs,
      errorCode: null,
      errorMessage: null
    };

  } catch (err) {
    return {
      ok: false,
      rttMs: null,
      errorCode: err.code || 'UNKNOWN',
      errorMessage: err.message
    };
  }
}

// ============================================================================
// WARMUP FUNCTION - Call at startup to verify Redis works
// ============================================================================

/**
 * Warmup Redis connection - call during server startup
 * Uses the canonical redisHealthCheck()
 * @returns {Promise<boolean>} - true if Redis is healthy
 */
async function warmupRedis() {
  if (!REDIS_URL) {
    console.log('[REDIS] ⚠️ Warmup skipped - REDIS_URL not set');
    return false;
  }
  
  console.log('[REDIS] 🔄 Warmup: running health check...');
  
  const result = await redisHealthCheck();
  
  if (result.ok) {
    console.log(`[REDIS] ✅ Warmup COMPLETE - Redis healthy (${result.rttMs}ms RTT)`);
    return true;
  } else {
    console.error(`[REDIS] ❌ Warmup FAILED: ${result.errorMessage} (code: ${result.errorCode})`);
    return false;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  createIORedisClient,
  createNodeRedisClient,
  getSharedRedisClient,
  getSharedRedisClientSync,  // Sync access for backward compatibility
  isSharedClientReady,
  isRedisConfigured,
  getSanitizedRedisUrl,
  redisHealthCheck,  // CANONICAL health check - use this everywhere
  warmupRedis,
  REDIS_URL,
};

