/**
 * ════════════════════════════════════════════════════════════════════════════════
 * CONFIG CACHE SERVICE — Redis-First Configuration Layer
 * ════════════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE:
 * Provides Redis-first caching for runtime configuration reads.
 * Mongo stays canonical truth. Redis is the speed layer.
 * 
 * READ PATH (always this order):
 * 1. Session memory (per-call cache)
 * 2. Redis
 * 3. Mongo → then write to Redis
 * 
 * WRITE PATH (Agent Console saves):
 * - Write Mongo
 * - Then SET/DELETE Redis so runtime sees changes instantly
 * 
 * REDIS KEYS:
 * Per-company:
 *   cfg:agent2:<companyId>
 *   cfg:booking:<companyId>
 *   cfg:calendar:<companyId>
 * 
 * Global:
 *   global:firstNames
 *   global:lastNames
 *   global:nameStopWords
 * 
 * ════════════════════════════════════════════════════════════════════════════════
 */

const logger = require('../utils/logger');
const { getSharedRedisClient, isRedisConfigured } = require('./redisClientFactory');
const v2Company = require('../models/v2Company');

const MODULE_ID = 'CONFIG_CACHE';

const CACHE_TTL_SECONDS = 300; // 5 minutes default TTL
const GLOBAL_CACHE_TTL_SECONDS = 600; // 10 minutes for global dictionaries

const REDIS_KEYS = {
  agent2Config: (companyId) => `cfg:agent2:${companyId}`,
  bookingConfig: (companyId) => `cfg:booking:${companyId}`,
  calendarStatus: (companyId) => `cfg:calendar:${companyId}`,
  globalFirstNames: 'global:firstNames',
  globalLastNames: 'global:lastNames',
  globalNameStopWords: 'global:nameStopWords'
};

/* ============================================================================
   PERF TRACE — Turn-level timing
   ============================================================================ */

class PerfTrace {
  constructor(turnId) {
    this.turnId = turnId;
    this.startTime = Date.now();
    this.timings = {};
    this.cacheHits = {};
  }
  
  start(label) {
    this.timings[`${label}_start`] = Date.now();
  }
  
  end(label) {
    const startKey = `${label}_start`;
    if (this.timings[startKey]) {
      this.timings[`t_${label}_ms`] = Date.now() - this.timings[startKey];
      delete this.timings[startKey];
    }
  }
  
  setCacheHit(key, hit) {
    this.cacheHits[key] = hit;
  }
  
  toObject() {
    return {
      turnId: this.turnId,
      t_total_ms: Date.now() - this.startTime,
      ...this.timings,
      cacheHit: this.cacheHits
    };
  }
}

function createPerfTrace(turnId) {
  return new PerfTrace(turnId || `turn_${Date.now()}`);
}

/* ============================================================================
   REDIS HELPERS
   ============================================================================ */

async function getRedis() {
  if (!isRedisConfigured()) {
    return null;
  }
  return await getSharedRedisClient();
}

async function redisGet(key) {
  try {
    const redis = await getRedis();
    if (!redis) return null;
    
    const value = await redis.get(key);
    return value ? JSON.parse(value) : null;
  } catch (err) {
    logger.warn(`[${MODULE_ID}] Redis GET failed: ${err.message}`, { key });
    return null;
  }
}

async function redisSet(key, value, ttlSeconds = CACHE_TTL_SECONDS) {
  try {
    const redis = await getRedis();
    if (!redis) return false;
    
    await redis.set(key, JSON.stringify(value), { EX: ttlSeconds });
    return true;
  } catch (err) {
    logger.warn(`[${MODULE_ID}] Redis SET failed: ${err.message}`, { key });
    return false;
  }
}

async function redisDel(key) {
  try {
    const redis = await getRedis();
    if (!redis) return false;
    
    await redis.del(key);
    return true;
  } catch (err) {
    logger.warn(`[${MODULE_ID}] Redis DEL failed: ${err.message}`, { key });
    return false;
  }
}

/* ============================================================================
   AGENT 2.0 CONFIG — Redis-first read
   ============================================================================ */

async function getAgent2Config(companyId, trace = null) {
  const key = REDIS_KEYS.agent2Config(companyId);
  
  if (trace) trace.start('redis');
  
  const cached = await redisGet(key);
  if (cached) {
    if (trace) {
      trace.end('redis');
      trace.setCacheHit('agent2Cfg', true);
    }
    return cached;
  }
  
  if (trace) {
    trace.end('redis');
    trace.setCacheHit('agent2Cfg', false);
    trace.start('mongo');
  }
  
  const company = await v2Company.findById(companyId)
    .select('aiAgentSettings.agent2 companyName timezone')
    .lean();
  
  if (trace) trace.end('mongo');
  
  if (!company) {
    logger.warn(`[${MODULE_ID}] Company not found: ${companyId}`);
    return null;
  }
  
  const config = {
    companyId,
    companyName: company.companyName,
    timezone: company.timezone || 'America/New_York',
    agent2: company.aiAgentSettings?.agent2 || {},
    cachedAt: new Date().toISOString()
  };
  
  await redisSet(key, config);
  
  return config;
}

async function invalidateAgent2Config(companyId) {
  const key = REDIS_KEYS.agent2Config(companyId);
  await redisDel(key);
  logger.info(`[${MODULE_ID}] Invalidated agent2 config`, { companyId });
}

/* ============================================================================
   BOOKING CONFIG — Redis-first read
   ============================================================================ */

async function getBookingConfig(companyId, trace = null) {
  const key = REDIS_KEYS.bookingConfig(companyId);
  
  if (trace) trace.start('redis');
  
  const cached = await redisGet(key);
  if (cached) {
    if (trace) {
      trace.end('redis');
      trace.setCacheHit('bookingCfg', true);
    }
    return cached;
  }
  
  if (trace) {
    trace.end('redis');
    trace.setCacheHit('bookingCfg', false);
    trace.start('mongo');
  }
  
  const company = await v2Company.findById(companyId)
    .select('aiAgentSettings.bookingLogic googleCalendar timezone businessHours companyName')
    .lean();
  
  if (trace) trace.end('mongo');
  
  if (!company) {
    logger.warn(`[${MODULE_ID}] Company not found: ${companyId}`);
    return null;
  }
  
  const config = {
    companyId,
    companyName: company.companyName,
    timezone: company.timezone || 'America/New_York',
    bookingLogic: company.aiAgentSettings?.bookingLogic || {},
    businessHours: company.businessHours || null,
    calendarConnected: !!company.googleCalendar?.connected,
    calendarId: company.googleCalendar?.calendarId || null,
    cachedAt: new Date().toISOString()
  };
  
  await redisSet(key, config);
  
  return config;
}

async function invalidateBookingConfig(companyId) {
  const key = REDIS_KEYS.bookingConfig(companyId);
  await redisDel(key);
  logger.info(`[${MODULE_ID}] Invalidated booking config`, { companyId });
}

/* ============================================================================
   CALENDAR STATUS — Redis-first read (no tokens!)
   ============================================================================ */

async function getCalendarStatus(companyId, trace = null) {
  const key = REDIS_KEYS.calendarStatus(companyId);
  
  if (trace) trace.start('redis');
  
  const cached = await redisGet(key);
  if (cached) {
    if (trace) {
      trace.end('redis');
      trace.setCacheHit('calendarStatus', true);
    }
    return cached;
  }
  
  if (trace) {
    trace.end('redis');
    trace.setCacheHit('calendarStatus', false);
    trace.start('mongo');
  }
  
  const company = await v2Company.findById(companyId)
    .select('googleCalendar.connected googleCalendar.calendarId googleCalendar.calendarName googleCalendar.healthy googleCalendar.lastError googleCalendar.connectedAt')
    .lean();
  
  if (trace) trace.end('mongo');
  
  if (!company) {
    return { connected: false, error: 'Company not found' };
  }
  
  const gc = company.googleCalendar || {};
  const status = {
    connected: gc.connected || false,
    calendarId: gc.calendarId || null,
    calendarName: gc.calendarName || null,
    healthy: gc.healthy !== false,
    lastError: gc.lastError || null,
    connectedAt: gc.connectedAt || null,
    cachedAt: new Date().toISOString()
  };
  
  await redisSet(key, status, 60); // Shorter TTL for status
  
  return status;
}

async function invalidateCalendarStatus(companyId) {
  const key = REDIS_KEYS.calendarStatus(companyId);
  await redisDel(key);
  logger.info(`[${MODULE_ID}] Invalidated calendar status`, { companyId });
}

/* ============================================================================
   GLOBAL DICTIONARIES — Redis-first read
   ============================================================================ */

async function getGlobalFirstNames(trace = null) {
  const key = REDIS_KEYS.globalFirstNames;
  
  if (trace) trace.start('redis');
  
  const cached = await redisGet(key);
  if (cached) {
    if (trace) {
      trace.end('redis');
      trace.setCacheHit('globalFirstNames', true);
    }
    return cached;
  }
  
  if (trace) {
    trace.end('redis');
    trace.setCacheHit('globalFirstNames', false);
    trace.start('mongo');
  }
  
  try {
    const GlobalFirstNames = require('../models/GlobalFirstNames');
    const names = await GlobalFirstNames.find({}).select('name').lean();
    const nameSet = names.map(n => n.name.toLowerCase());
    
    if (trace) trace.end('mongo');
    
    const result = {
      names: nameSet,
      count: nameSet.length,
      cachedAt: new Date().toISOString()
    };
    
    await redisSet(key, result, GLOBAL_CACHE_TTL_SECONDS);
    
    return result;
  } catch (err) {
    if (trace) trace.end('mongo');
    logger.warn(`[${MODULE_ID}] Failed to load GlobalFirstNames: ${err.message}`);
    return { names: [], count: 0 };
  }
}

async function invalidateGlobalFirstNames() {
  await redisDel(REDIS_KEYS.globalFirstNames);
  logger.info(`[${MODULE_ID}] Invalidated global first names cache`);
}

/* ============================================================================
   PRE-WARM — Load configs at CALL_START to avoid cold spikes
   ============================================================================ */

async function prewarmForCall(companyId) {
  const trace = createPerfTrace(`prewarm_${companyId}`);
  
  logger.info(`[${MODULE_ID}] Pre-warming configs for call`, { companyId });
  
  const results = await Promise.all([
    getAgent2Config(companyId, trace),
    getBookingConfig(companyId, trace),
    getCalendarStatus(companyId, trace),
    getGlobalFirstNames(trace)
  ]);
  
  const perfData = trace.toObject();
  
  logger.info(`[${MODULE_ID}] Pre-warm complete`, {
    companyId,
    t_total_ms: perfData.t_total_ms,
    cacheHits: perfData.cacheHit
  });
  
  return {
    agent2Config: results[0],
    bookingConfig: results[1],
    calendarStatus: results[2],
    globalFirstNames: results[3],
    perf: perfData
  };
}

/* ============================================================================
   INVALIDATE ALL — For full company config refresh
   ============================================================================ */

async function invalidateAllForCompany(companyId) {
  await Promise.all([
    invalidateAgent2Config(companyId),
    invalidateBookingConfig(companyId),
    invalidateCalendarStatus(companyId)
  ]);
  logger.info(`[${MODULE_ID}] Invalidated all configs for company`, { companyId });
}

/* ============================================================================
   EXPORTS
   ============================================================================ */

module.exports = {
  // Perf tracing
  createPerfTrace,
  PerfTrace,
  
  // Agent 2.0
  getAgent2Config,
  invalidateAgent2Config,
  
  // Booking
  getBookingConfig,
  invalidateBookingConfig,
  
  // Calendar
  getCalendarStatus,
  invalidateCalendarStatus,
  
  // Global
  getGlobalFirstNames,
  invalidateGlobalFirstNames,
  
  // Pre-warm
  prewarmForCall,
  
  // Bulk invalidation
  invalidateAllForCompany,
  
  // Key patterns (for debugging)
  REDIS_KEYS
};
