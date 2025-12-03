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
  console.error('[REDIS] ❌ REDIS_URL is NOT SET – failing hard.');
  console.error('[REDIS] ❌ Set REDIS_URL in Render environment variables');
  logger.error('[REDIS] REDIS_URL environment variable is missing');
} else {
  // Sanitize URL for logging (hide password if present)
  const sanitizedUrl = REDIS_URL.replace(/:([^@]+)@/, ':***@');
  console.log('[REDIS] ✅ Using REDIS_URL:', sanitizedUrl);
  logger.info('[REDIS] Redis URL configured', { urlLength: REDIS_URL.length });
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
// EXPORTS
// ============================================================================

module.exports = {
  createIORedisClient,
  createNodeRedisClient,
  isRedisConfigured,
  getSanitizedRedisUrl,
  REDIS_URL,
};

