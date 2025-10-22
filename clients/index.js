// clients/index.js
// Centralized client exports for Redis, Email, and SMS

const redis = require('redis');
const logger = require('../utils/logger.js');


let redisClient = null;

/**
 * Initialize Redis client with v5+ compatible configuration
 */
async function initializeRedis() {
  try {
    // Redis v5+ URL-based connection format
    const redisUrl = process.env.REDIS_URL || 
      `redis://${process.env.REDIS_PASSWORD ? `:${process.env.REDIS_PASSWORD}@` : ''}${process.env.REDIS_HOST || 'localhost'}:${process.env.REDIS_PORT || 6379}`;
    
    redisClient = redis.createClient({
      url: redisUrl,
      socket: {
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            logger.warn('⚠️ Redis max reconnection attempts reached. Operating without cache.');
            return false; // Stop retrying
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    redisClient.on('connect', () => {
      logger.security('✅ Redis Session Store connected');
    });

    redisClient.on('ready', () => {
      logger.security('🔥 Redis Session Store ready for v2 operations');
    });

    redisClient.on('error', (err) => {
      logger.security('⚠️ Redis initialization failed:', { timestamp: new Date().toISOString() });
      redisClient = null; // Disable Redis operations
    });

    // Connect to Redis (required in v5+)
    await redisClient.connect();
    
    // Test connection
    await redisClient.ping();
    logger.debug('🚀 Redis client initialized successfully');
    
    return redisClient;

  } catch (error) {
    logger.warn('⚠️ Redis initialization failed:', { timestamp: new Date().toISOString() });
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
