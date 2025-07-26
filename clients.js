const { createClient } = require('redis');
let Pinecone;
try {
  ({ Pinecone } = require('@pinecone-database/pinecone'));
} catch (err) {
  Pinecone = class {
    index() { return {}; }
  };
}

// --- Initialize Redis Client ---
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    connectTimeout: 60000, // 60 seconds
    lazyConnect: true,
    reconnectDelay: 1000, // 1 second
    reconnectAttempts: 5,
    keepAlive: 30000, // 30 seconds
  },
  retry_unfulfilled_commands: true,
  enable_offline_queue: false
});

redisClient.on('error', (err) => {
  console.log('Redis Client Error', err);
  // Don't crash the application on Redis errors
});

redisClient.on('connect', () => {
  console.log('🧠 AI Intelligence Engine: Redis connected');
});

redisClient.on('reconnecting', () => {
  console.log('🔄 Redis reconnecting...');
});

redisClient.on('ready', () => {
  console.log('✅ Redis client ready');
});

if (process.env.NODE_ENV !== 'test') {
  redisClient.connect().then(() => {
    console.log('Successfully connected to Redis.');
  }).catch((err) => {
    console.error('❌ Failed to connect to Redis:', err);
    // Continue without Redis if connection fails
    console.log('⚠️ Continuing without Redis...');
  });
}

// --- Initialize Pinecone Client ---
let pinecone = null;
if (process.env.PINECONE_API_KEY) {
  pinecone = new Pinecone({
    apiKey: process.env.PINECONE_API_KEY,
  });
} else {
  console.warn('PINECONE_API_KEY is not set. Pinecone features will be disabled.');
}

const getPineconeIndex = () => {
  if (!pinecone) return null;
  return pinecone.index(process.env.PINECONE_INDEX);
};

// --- Redis Helper Functions for Production Resilience ---
async function safeRedisGet(key) {
  try {
    if (!redisClient.isReady) {
      console.log('⚠️ Redis not ready, skipping cache get for:', key);
      return null;
    }
    return await redisClient.get(key);
  } catch (error) {
    console.log('⚠️ Redis get failed for key:', key, error.message);
    return null; // Gracefully continue without cache
  }
}

async function safeRedisSet(key, value, ttl = 3600) {
  try {
    if (!redisClient.isReady) {
      console.log('⚠️ Redis not ready, skipping cache set for:', key);
      return false;
    }
    await redisClient.setEx(key, ttl, value);
    return true;
  } catch (error) {
    console.log('⚠️ Redis set failed for key:', key, error.message);
    return false; // Gracefully continue without cache
  }
}

async function safeRedisDel(key) {
  try {
    if (!redisClient.isReady) {
      console.log('⚠️ Redis not ready, skipping cache delete for:', key);
      return false;
    }
    await redisClient.del(key);
    return true;
  } catch (error) {
    console.log('⚠️ Redis delete failed for key:', key, error.message);
    return false; // Gracefully continue without cache
  }
}

module.exports = { 
  redisClient, 
  pinecone, 
  getPineconeIndex,
  safeRedisGet,
  safeRedisSet,
  safeRedisDel
};
