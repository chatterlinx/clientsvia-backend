/**
 * ============================================================================
 * FRONTLINE CONTEXT SERVICE - REDIS-BASED CALL STATE MANAGEMENT
 * ============================================================================
 * 
 * PURPOSE: Manage live call context in Redis for sub-50ms performance
 * ARCHITECTURE: Single source of truth for active call state
 * TTL: 1 hour (calls longer than this are exceptional)
 * 
 * CRITICAL: All call engine components read/write context through this service
 * 
 * ============================================================================
 */

const redis = require('../config/redisClient');
const logger = require('../../utils/logger');

const CTX_TTL_SECONDS = 60 * 60; // 1 hour

/**
 * Generate Redis key for call context
 * @param {string} callId - Twilio Call SID
 * @returns {string}
 */
function getCtxKey(callId) {
  return `frontline:ctx:${callId}`;
}

/**
 * Load context from Redis
 * @param {string} callId
 * @returns {Promise<import("../core/frontlineTypes").FrontlineContext|null>}
 */
async function loadContext(callId) {
  try {
    const raw = await redis.get(getCtxKey(callId));
    if (!raw) {
      logger.debug(`[FRONTLINE CTX] No context found for call: ${callId}`);
      return null;
    }
    
    const ctx = JSON.parse(raw);
    logger.debug(`[FRONTLINE CTX] Loaded context for call: ${callId}`, {
      intent: ctx.currentIntent,
      readyToBook: ctx.readyToBook,
      transcriptLength: ctx.transcript?.length || 0
    });
    
    return ctx;
  } catch (error) {
    logger.error(`[FRONTLINE CTX] Failed to load context for call: ${callId}`, {
      error: error.message,
      stack: error.stack
    });
    return null;
  }
}

/**
 * Save context to Redis with TTL
 * @param {import("../core/frontlineTypes").FrontlineContext} ctx
 * @returns {Promise<void>}
 */
async function saveContext(ctx) {
  try {
    ctx.updatedAt = Date.now();
    
    const key = getCtxKey(ctx.callId);
    const value = JSON.stringify(ctx);
    
    await redis.set(key, value, 'EX', CTX_TTL_SECONDS);
    
    logger.debug(`[FRONTLINE CTX] Saved context for call: ${ctx.callId}`, {
      companyId: ctx.companyId,
      intent: ctx.currentIntent,
      readyToBook: ctx.readyToBook,
      transcriptTurns: ctx.transcript?.length || 0
    });
  } catch (error) {
    logger.error(`[FRONTLINE CTX] Failed to save context for call: ${ctx.callId}`, {
      error: error.message,
      stack: error.stack
    });
    // Don't throw - non-fatal, caller can continue
  }
}

/**
 * Initialize a new context for a call
 * @param {Object} params
 * @param {string} params.callId - Twilio Call SID
 * @param {string} params.companyId
 * @param {string} [params.trade] - "hvac", "plumbing", etc
 * @param {number} [params.configVersion] - AiCore config version
 * @returns {Promise<import("../core/frontlineTypes").FrontlineContext>}
 */
async function initContext({ callId, companyId, trade, configVersion }) {
  const now = Date.now();
  
  /** @type {import("../core/frontlineTypes").FrontlineContext} */
  const ctx = {
    callId,
    companyId,
    trade: trade || "",
    currentIntent: "",
    extracted: {},
    triageMatches: [],
    tierTrace: [],
    transcript: [],
    readyToBook: false,
    appointmentId: undefined,
    configVersion: configVersion || 1,
    createdAt: now,
    updatedAt: now
  };
  
  await saveContext(ctx);
  
  logger.info(`[FRONTLINE CTX] Initialized context for call: ${callId}`, {
    companyId,
    trade,
    configVersion
  });
  
  return ctx;
}

/**
 * Delete context from Redis (called at call end after persisting to Mongo)
 * @param {string} callId
 * @returns {Promise<void>}
 */
async function deleteContext(callId) {
  try {
    await redis.del(getCtxKey(callId));
    logger.info(`[FRONTLINE CTX] Deleted context for call: ${callId}`);
  } catch (error) {
    logger.error(`[FRONTLINE CTX] Failed to delete context for call: ${callId}`, {
      error: error.message
    });
    // Non-fatal
  }
}

/**
 * Append a transcript turn to the context
 * @param {string} callId
 * @param {import("../core/frontlineTypes").TranscriptTurn} turn
 * @returns {Promise<void>}
 */
async function appendTranscript(callId, turn) {
  const ctx = await loadContext(callId);
  if (!ctx) {
    logger.warn(`[FRONTLINE CTX] Cannot append transcript - context not found: ${callId}`);
    return;
  }
  
  if (!turn.timestamp) {
    turn.timestamp = Date.now();
  }
  
  ctx.transcript.push(turn);
  await saveContext(ctx);
}

/**
 * Update extracted context fields
 * @param {string} callId
 * @param {Partial<import("../core/frontlineTypes").ExtractedContext>} updates
 * @returns {Promise<void>}
 */
async function updateExtracted(callId, updates) {
  const ctx = await loadContext(callId);
  if (!ctx) {
    logger.warn(`[FRONTLINE CTX] Cannot update extracted - context not found: ${callId}`);
    return;
  }
  
  ctx.extracted = {
    ...ctx.extracted,
    ...updates
  };
  
  await saveContext(ctx);
}

/**
 * Add a tier resolution to the trace
 * @param {string} callId
 * @param {import("../core/frontlineTypes").TierResolution} resolution
 * @returns {Promise<void>}
 */
async function addTierResolution(callId, resolution) {
  const ctx = await loadContext(callId);
  if (!ctx) {
    logger.warn(`[FRONTLINE CTX] Cannot add tier resolution - context not found: ${callId}`);
    return;
  }
  
  ctx.tierTrace.push(resolution);
  await saveContext(ctx);
  
  logger.info(`[FRONTLINE CTX] Added tier ${resolution.tier} resolution for call: ${callId}`, {
    confidence: resolution.confidence,
    sourceId: resolution.sourceId
  });
}

/**
 * Mark context as ready to book
 * @param {string} callId
 * @param {boolean} ready
 * @returns {Promise<void>}
 */
async function setReadyToBook(callId, ready) {
  const ctx = await loadContext(callId);
  if (!ctx) {
    logger.warn(`[FRONTLINE CTX] Cannot set ready to book - context not found: ${callId}`);
    return;
  }
  
  ctx.readyToBook = ready;
  await saveContext(ctx);
  
  logger.info(`[FRONTLINE CTX] Set readyToBook=${ready} for call: ${callId}`);
}

/**
 * Set the appointment ID after booking
 * @param {string} callId
 * @param {string} appointmentId
 * @returns {Promise<void>}
 */
async function setAppointmentId(callId, appointmentId) {
  const ctx = await loadContext(callId);
  if (!ctx) {
    logger.warn(`[FRONTLINE CTX] Cannot set appointment ID - context not found: ${callId}`);
    return;
  }
  
  ctx.appointmentId = appointmentId;
  await saveContext(ctx);
  
  logger.info(`[FRONTLINE CTX] Set appointmentId=${appointmentId} for call: ${callId}`);
}

module.exports = {
  loadContext,
  saveContext,
  initContext,
  deleteContext,
  appendTranscript,
  updateExtracted,
  addTierResolution,
  setReadyToBook,
  setAppointmentId
};

