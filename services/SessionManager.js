// services/SessionManager.js
// ============================================================================
// SESSION MANAGER - Hybrid Session Store with 4-Layer Caching
// ============================================================================
// PURPOSE: Ultra-fast session state with durable persistence
// ARCHITECTURE: L0 (LRU) → L1 (Redis) → L2 (MongoDB) → L3 (Periodic writes)
// PERFORMANCE: Sub-1ms reads (L0), 1-2ms (L1), 10-20ms (L2 cold start only)
// DURABILITY: Async batched MongoDB writes every 5s
// EVICTION: LRU eviction on L0, TTL on L1/MongoDB
// ============================================================================

const Redis = require('ioredis');
const logger = require('../utils/logger');

// L0: In-Process LRU Cache (ultra-fast, volatile)
const LRU_MAX_SIZE = 50; // Keep 50 most recent sessions in memory
const lruCache = new Map();
const lruOrder = []; // Track access order for LRU eviction

// L1: Redis Client
const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  password: process.env.REDIS_PASSWORD,
  db: parseInt(process.env.REDIS_DB || '0', 10),
  retryStrategy: (times) => {
    const delay = Math.min(times * 50, 2000);
    logger.warn('[SESSION MANAGER] Redis retry', { attempt: times, delayMs: delay });
    return delay;
  }
});

redis.on('error', (err) => {
  logger.error('[SESSION MANAGER] Redis connection error', { error: err.message });
});

redis.on('connect', () => {
  logger.info('[SESSION MANAGER] Redis connected');
});

// L3: Write Buffer (batched MongoDB writes)
const writeBuffer = new Map();
const WRITE_INTERVAL_MS = 5000; // Flush every 5 seconds
let writeIntervalTimer = null;

class SessionManager {
  
  constructor() {
    this.CallLog = null; // Lazy load to avoid circular deps
    
    // Start periodic write flusher
    this.startPeriodicWrites();
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // GET SESSION - 4-Layer Cascade
  // ═══════════════════════════════════════════════════════════════════
  // Try L0 → L1 → L2 in order, return first hit
  // Populate higher caches on miss (cache warming)
  // ═══════════════════════════════════════════════════════════════════
  
  async getSession(callId) {
    const startTime = Date.now();
    
    // ────────────────────────────────────────────────────────────────
    // L0: In-Process LRU Cache (FASTEST)
    // ────────────────────────────────────────────────────────────────
    
    if (lruCache.has(callId)) {
      const session = lruCache.get(callId);
      
      // Move to end (most recently used)
      this.touchLRU(callId);
      
      const elapsed = Date.now() - startTime;
      
      logger.debug('[SESSION MANAGER] L0 cache hit', {
        callId,
        timeMs: elapsed
      });
      
      return { ...session, _cacheLayer: 'L0', _timeMs: elapsed };
    }
    
    // ────────────────────────────────────────────────────────────────
    // L1: Redis Session Store (FAST)
    // ────────────────────────────────────────────────────────────────
    
    try {
      const redisKey = `session:${callId}`;
      const cached = await redis.get(redisKey);
      
      if (cached) {
        const session = JSON.parse(cached);
        
        // Warm L0 cache
        this.setLRU(callId, session);
        
        const elapsed = Date.now() - startTime;
        
        logger.debug('[SESSION MANAGER] L1 cache hit', {
          callId,
          timeMs: elapsed
        });
        
        return { ...session, _cacheLayer: 'L1', _timeMs: elapsed };
      }
    } catch (err) {
      logger.error('[SESSION MANAGER] Redis read error', {
        callId,
        error: err.message
      });
      // Continue to L2 on Redis failure
    }
    
    // ────────────────────────────────────────────────────────────────
    // L2: MongoDB Read (COLD START) - AI Gateway CallLog REMOVED
    // ────────────────────────────────────────────────────────────────
    
    // LEGACY: AI Gateway CallLog model was removed during analytics cleanup
    // Session recovery now relies only on L0 (LRU) and L1 (Redis) caches
    // If you need MongoDB persistence, integrate v2AIAgentCallLog or create a new SessionLog model
    logger.debug(`[SESSION MANAGER] L2 (MongoDB CallLog) skipped - AI Gateway removed`);
    
    // ────────────────────────────────────────────────────────────────
    // CACHE MISS - Return null
    // ────────────────────────────────────────────────────────────────
    
    const elapsed = Date.now() - startTime;
    
    logger.debug('[SESSION MANAGER] Cache miss (all layers)', {
      callId,
      timeMs: elapsed
    });
    
    return null;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // SET SESSION - Write to L0 + L1, Buffer for L3
  // ═══════════════════════════════════════════════════════════════════
  // L0: Immediate (in-memory)
  // L1: Immediate (Redis)
  // L3: Buffered (MongoDB, flushed every 5s)
  // ═══════════════════════════════════════════════════════════════════
  
  async setSession(callId, session) {
    const startTime = Date.now();
    
    // ────────────────────────────────────────────────────────────────
    // L0: In-Process LRU Cache (IMMEDIATE)
    // ────────────────────────────────────────────────────────────────
    
    this.setLRU(callId, session);
    
    // ────────────────────────────────────────────────────────────────
    // L1: Redis Session Store (IMMEDIATE)
    // ────────────────────────────────────────────────────────────────
    
    try {
      const redisKey = `session:${callId}`;
      await redis.setex(redisKey, 3600, JSON.stringify(session)); // 1 hour TTL
      
      logger.debug('[SESSION MANAGER] L1 written', {
        callId,
        timeMs: Date.now() - startTime
      });
    } catch (err) {
      logger.error('[SESSION MANAGER] Redis write error', {
        callId,
        error: err.message
      });
      // Continue - L0 cache still works
    }
    
    // ────────────────────────────────────────────────────────────────
    // L3: Buffer for Batched MongoDB Write (ASYNC)
    // ────────────────────────────────────────────────────────────────
    
    writeBuffer.set(callId, {
      session,
      bufferedAt: new Date()
    });
    
    logger.debug('[SESSION MANAGER] L3 buffered for write', {
      callId,
      bufferSize: writeBuffer.size
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // DELETE SESSION - Evict from all layers
  // ═══════════════════════════════════════════════════════════════════
  
  async deleteSession(callId) {
    // L0: In-memory
    if (lruCache.has(callId)) {
      lruCache.delete(callId);
      const index = lruOrder.indexOf(callId);
      if (index > -1) {
        lruOrder.splice(index, 1);
      }
    }
    
    // L1: Redis
    try {
      const redisKey = `session:${callId}`;
      await redis.del(redisKey);
    } catch (err) {
      logger.error('[SESSION MANAGER] Redis delete error', {
        callId,
        error: err.message
      });
    }
    
    // L3: Remove from write buffer (won't be written)
    writeBuffer.delete(callId);
    
    logger.debug('[SESSION MANAGER] Session deleted from all layers', {
      callId
    });
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // TOUCH SESSION - Update lastActivityAt
  // ═══════════════════════════════════════════════════════════════════
  
  async touchSession(callId) {
    const session = await this.getSession(callId);
    
    if (session) {
      session.lastActivityAt = new Date();
      await this.setSession(callId, session);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // L0: LRU CACHE HELPERS
  // ═══════════════════════════════════════════════════════════════════
  
  setLRU(callId, session) {
    // If already in cache, remove from old position
    if (lruCache.has(callId)) {
      const index = lruOrder.indexOf(callId);
      if (index > -1) {
        lruOrder.splice(index, 1);
      }
    }
    
    // Add to cache
    lruCache.set(callId, session);
    lruOrder.push(callId); // Most recently used goes to end
    
    // Evict least recently used if over capacity
    if (lruCache.size > LRU_MAX_SIZE) {
      const lruCallId = lruOrder.shift(); // Remove first (oldest)
      lruCache.delete(lruCallId);
      
      logger.debug('[SESSION MANAGER] LRU eviction', {
        evictedCallId: lruCallId,
        cacheSize: lruCache.size
      });
    }
  }
  
  touchLRU(callId) {
    // Move to end (most recently used)
    const index = lruOrder.indexOf(callId);
    if (index > -1) {
      lruOrder.splice(index, 1);
      lruOrder.push(callId);
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // L3: PERIODIC MONGODB WRITES
  // ═══════════════════════════════════════════════════════════════════
  // Flush write buffer to MongoDB every 5 seconds
  // Batched for performance (reduce write load)
  // ═══════════════════════════════════════════════════════════════════
  
  startPeriodicWrites() {
    if (writeIntervalTimer) {
      clearInterval(writeIntervalTimer);
    }
    
    writeIntervalTimer = setInterval(async () => {
      await this.flushWriteBuffer();
    }, WRITE_INTERVAL_MS);
    
    logger.info('[SESSION MANAGER] Periodic write flusher started', {
      intervalMs: WRITE_INTERVAL_MS
    });
  }
  
  async flushWriteBuffer() {
    if (writeBuffer.size === 0) {
      return;
    }
    
    const startTime = Date.now();
    const entries = Array.from(writeBuffer.entries());
    
    logger.info('[SESSION MANAGER] Flushing write buffer to MongoDB', {
      batchSize: entries.length
    });
    
    // LEGACY: AI Gateway CallLog model removed - sessions only use L0/L1 cache
    
    let successCount = 0;
    let errorCount = 0;
    
    for (const [callId, { session }] of entries) {
      try {
        await this.CallLog.findOneAndUpdate(
          { callId },
          {
            $set: {
              turnCount: session.turnNumber,
              capturedEntities: session.capturedEntities,
              lastActivityAt: session.lastActivityAt
            }
          },
          { upsert: false } // Don't create if missing (session should exist)
        );
        
        writeBuffer.delete(callId);
        successCount++;
        
      } catch (err) {
        logger.error('[SESSION MANAGER] MongoDB write error', {
          callId,
          error: err.message
        });
        errorCount++;
        
        // Keep in buffer for retry (but limit retries to prevent infinite growth)
        const buffered = writeBuffer.get(callId);
        if (buffered) {
          const ageMinutes = (Date.now() - buffered.bufferedAt.getTime()) / 60000;
          
          if (ageMinutes > 30) {
            // Drop after 30 minutes of failed retries
            writeBuffer.delete(callId);
            
            logger.warn('[SESSION MANAGER] Dropped stale buffered write', {
              callId,
              ageMinutes: ageMinutes.toFixed(1)
            });
          }
        }
      }
    }
    
    const elapsed = Date.now() - startTime;
    
    logger.info('[SESSION MANAGER] Write buffer flushed', {
      batchSize: entries.length,
      successCount,
      errorCount,
      timeMs: elapsed,
      remainingBuffer: writeBuffer.size
    });
    
    // Alert ops if high error rate
    if (errorCount > 0 && errorCount / entries.length > 0.5) {
      logger.error('[SESSION MANAGER] High write error rate detected', {
        errorRate: (errorCount / entries.length * 100).toFixed(1) + '%',
        totalErrors: errorCount,
        totalWrites: entries.length
      });
    }
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // STATS - Observability
  // ═══════════════════════════════════════════════════════════════════
  
  getStats() {
    return {
      l0: {
        size: lruCache.size,
        maxSize: LRU_MAX_SIZE,
        utilizationPercent: (lruCache.size / LRU_MAX_SIZE * 100).toFixed(1)
      },
      l3: {
        bufferSize: writeBuffer.size,
        oldestBufferedAge: this.getOldestBufferedAge()
      }
    };
  }
  
  getOldestBufferedAge() {
    if (writeBuffer.size === 0) return 0;
    
    let oldestAge = 0;
    
    for (const { bufferedAt } of writeBuffer.values()) {
      const age = (Date.now() - bufferedAt.getTime()) / 1000; // seconds
      if (age > oldestAge) {
        oldestAge = age;
      }
    }
    
    return oldestAge;
  }
  
  // ═══════════════════════════════════════════════════════════════════
  // GRACEFUL SHUTDOWN
  // ═══════════════════════════════════════════════════════════════════
  
  async shutdown() {
    logger.info('[SESSION MANAGER] Shutting down...');
    
    // Stop periodic writes
    if (writeIntervalTimer) {
      clearInterval(writeIntervalTimer);
    }
    
    // Flush remaining writes
    await this.flushWriteBuffer();
    
    // Close Redis connection
    await redis.quit();
    
    logger.info('[SESSION MANAGER] Shutdown complete');
  }
}

// ═══════════════════════════════════════════════════════════════════
// EXPORT SINGLETON
// ═══════════════════════════════════════════════════════════════════
module.exports = new SessionManager();

