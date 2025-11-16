/**
 * ============================================================================
 * TWILIO CALL ENGINE INTEGRATION - PHASE 1
 * ============================================================================
 * 
 * PURPOSE: Wire FrontlineContext into existing Twilio voice webhooks
 * ARCHITECTURE: Helper functions called from routes/v2twilio.js
 * SCOPE: Context init, transcript updates, call finalization
 * 
 * INTEGRATION POINTS:
 * 1. Call Start (/incoming) → initCallContext()
 * 2. Speech Turn → updateTranscript()
 * 3. Call End (/status-callback) → finalizeCall()
 * 
 * ============================================================================
 */

const { 
  initContext, 
  loadContext, 
  saveContext,
  appendTranscript,
  updateExtracted,
  addTierResolution
} = require('./frontlineContextService');

const { finalizeCallTrace, recordUsage } = require('./usageService');
const logger = require('../../utils/logger');

/**
 * Initialize call context at call start
 * Should be called from Twilio /incoming webhook
 * 
 * @param {Object} params
 * @param {string} params.callId - Twilio Call SID
 * @param {string} params.companyId
 * @param {string} [params.trade] - Company trade (hvac, plumbing, etc)
 * @param {number} [params.configVersion] - AiCore config version
 * @returns {Promise<Object>} Initialized context
 */
async function initCallContext({ callId, companyId, trade, configVersion }) {
  try {
    const ctx = await initContext({ 
      callId, 
      companyId, 
      trade, 
      configVersion 
    });
    
    logger.info(`[TWILIO INTEGRATION] Call context initialized`, {
      callId,
      companyId,
      trade
    });
    
    return ctx;
  } catch (error) {
    logger.error(`[TWILIO INTEGRATION] Failed to init call context`, {
      error: error.message,
      stack: error.stack,
      callId,
      companyId
    });
    // Non-fatal - call can proceed without context
    return null;
  }
}

/**
 * Update transcript with caller or agent speech
 * Should be called after each speech-to-text event
 * 
 * @param {string} callId
 * @param {string} role - "caller" or "agent"
 * @param {string} text - Spoken text
 * @returns {Promise<void>}
 */
async function updateTranscript(callId, role, text) {
  try {
    await appendTranscript(callId, {
      role,
      text,
      timestamp: Date.now()
    });
    
    logger.debug(`[TWILIO INTEGRATION] Transcript updated`, {
      callId,
      role,
      textLength: text.length
    });
  } catch (error) {
    logger.error(`[TWILIO INTEGRATION] Failed to update transcript`, {
      error: error.message,
      callId,
      role
    });
    // Non-fatal
  }
}

/**
 * Update extracted context fields from caller input
 * Can be called after LLM extraction or rule-based parsing
 * 
 * @param {string} callId
 * @param {Object} updates - Partial ExtractedContext
 * @returns {Promise<void>}
 */
async function updateCallContext(callId, updates) {
  try {
    await updateExtracted(callId, updates);
    
    logger.debug(`[TWILIO INTEGRATION] Context updated`, {
      callId,
      fields: Object.keys(updates)
    });
  } catch (error) {
    logger.error(`[TWILIO INTEGRATION] Failed to update context`, {
      error: error.message,
      callId,
      updates
    });
    // Non-fatal
  }
}

/**
 * Record a tier resolution (Tier 1/2/3 intelligence decision)
 * Should be called after scenario matching or LLM response
 * 
 * @param {string} callId
 * @param {number} tier - 1, 2, or 3
 * @param {number} confidence - 0-1
 * @param {string} [sourceId] - Triage card ID, KB doc ID, etc
 * @param {string} [answerText] - Response text
 * @param {string} [reasoning] - Why this tier was selected
 * @returns {Promise<void>}
 */
async function recordTierResolution(callId, { tier, confidence, sourceId, answerText, reasoning }) {
  try {
    await addTierResolution(callId, {
      tier,
      confidence,
      sourceId,
      answerText,
      reasoning
    });
    
    logger.info(`[TWILIO INTEGRATION] Tier ${tier} resolution recorded`, {
      callId,
      confidence,
      sourceId
    });
  } catch (error) {
    logger.error(`[TWILIO INTEGRATION] Failed to record tier resolution`, {
      error: error.message,
      callId,
      tier
    });
    // Non-fatal
  }
}

/**
 * Finalize call at end - persist to MongoDB and clean up Redis
 * Should be called from Twilio /status-callback webhook
 * 
 * @param {Object} params
 * @param {string} params.callId - Twilio Call SID
 * @param {number} params.startedAt - Unix timestamp (ms) when call started
 * @param {number} params.endedAt - Unix timestamp (ms) when call ended
 * @param {number} [params.durationSeconds] - Call duration from Twilio
 * @param {Object} [params.usageData] - Usage tracking data
 * @param {number} [params.usageData.llmTurns=0]
 * @param {number} [params.usageData.tier1Count=0]
 * @param {number} [params.usageData.tier2Count=0]
 * @param {number} [params.usageData.tier3Count=0]
 * @param {string} [params.usageData.primaryIntent='other']
 * @param {number} [params.usageData.estimatedAiCost=0]
 * @returns {Promise<void>}
 */
async function finalizeCall({ callId, startedAt, endedAt, durationSeconds, usageData = {} }) {
  try {
    // Load context to get companyId and other data
    const ctx = await loadContext(callId);
    
    if (!ctx) {
      logger.warn(`[TWILIO INTEGRATION] No context found for call finalization: ${callId}`);
      return;
    }
    
    // Persist call trace
    await finalizeCallTrace(callId, { startedAt, endedAt });
    
    logger.info(`[TWILIO INTEGRATION] Call trace finalized`, {
      callId,
      companyId: ctx.companyId,
      durationSeconds
    });
    
    // Record usage for billing
    const rawDurationSeconds = durationSeconds || Math.round((endedAt - startedAt) / 1000);
    
    await recordUsage({
      companyId: ctx.companyId,
      callId,
      rawDurationSeconds,
      llmTurns: usageData.llmTurns || 0,
      tier1Count: usageData.tier1Count || 0,
      tier2Count: usageData.tier2Count || 0,
      tier3Count: usageData.tier3Count || 0,
      primaryIntent: usageData.primaryIntent || ctx.currentIntent || 'other',
      estimatedAiCost: usageData.estimatedAiCost || 0,
      bookingCreated: !!ctx.appointmentId,
      appointmentId: ctx.appointmentId || null
    });
    
    logger.info(`[TWILIO INTEGRATION] Usage recorded`, {
      callId,
      companyId: ctx.companyId,
      billedMinutes: Math.ceil(rawDurationSeconds / 60),
      appointmentCreated: !!ctx.appointmentId
    });
    
  } catch (error) {
    logger.error(`[TWILIO INTEGRATION] Failed to finalize call`, {
      error: error.message,
      stack: error.stack,
      callId
    });
    // Don't throw - we want to acknowledge Twilio callback even if finalization fails
  }
}

/**
 * Helper: Get current call context (for debugging/introspection)
 * @param {string} callId
 * @returns {Promise<Object|null>}
 */
async function getCallContext(callId) {
  try {
    return await loadContext(callId);
  } catch (error) {
    logger.error(`[TWILIO INTEGRATION] Failed to get call context`, {
      error: error.message,
      callId
    });
    return null;
  }
}

module.exports = {
  initCallContext,
  updateTranscript,
  updateCallContext,
  recordTierResolution,
  finalizeCall,
  getCallContext
};

