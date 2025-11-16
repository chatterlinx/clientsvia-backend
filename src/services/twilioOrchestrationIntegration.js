/**
 * ============================================================================
 * TWILIO ORCHESTRATION INTEGRATION - PHASE 3
 * ============================================================================
 * 
 * PURPOSE: Helper functions to integrate orchestration engine with Twilio routes
 * ARCHITECTURE: Wrapper around orchestrationEngine for easy Twilio integration
 * USED BY: routes/v2twilio.js and other Twilio voice webhooks
 * 
 * USAGE IN TWILIO ROUTES:
 * 
 * const { handleCallerUtterance, initializeCall, finalizeCall } = require('../src/services/twilioOrchestrationIntegration');
 * 
 * // On call start:
 * await initializeCall({ callId, companyId, callerPhone });
 * 
 * // On each STT result:
 * const { nextPrompt } = await handleCallerUtterance({ callId, companyId, text: sttText });
 * // Then play nextPrompt via TTS
 * 
 * // On call end:
 * await finalizeCall({ callId, startedAt, endedAt });
 * 
 * ============================================================================
 */

const logger = require('../../utils/logger');
const { processCallerTurn } = require('./orchestrationEngine');
const { initContext, loadContext } = require('./frontlineContextService');
const { finalizeCallTrace, recordUsage } = require('./usageService');

/**
 * Initialize orchestration context for a new call
 * @param {Object} params
 * @param {string} params.callId - Twilio Call SID
 * @param {string} params.companyId - Company ID
 * @param {string} [params.callerPhone] - Caller's phone number
 * @param {string} [params.trade] - Company trade (hvac, plumbing, etc)
 * @param {number} [params.configVersion] - Config version
 * @returns {Promise<Object>} Initialized context
 */
async function initializeCall({ callId, companyId, callerPhone, trade, configVersion }) {
  try {
    logger.info('[TWILIO INTEGRATION] Initializing call', {
      callId,
      companyId,
      callerPhone,
      trade
    });
    
    // Initialize context in Redis
    const ctx = await initContext({
      callId,
      companyId,
      trade,
      configVersion: configVersion || 1
    });
    
    // Pre-populate caller phone if available
    if (callerPhone) {
      ctx.extracted = {
        ...ctx.extracted,
        callerPhone
      };
    }
    
    logger.info('[TWILIO INTEGRATION] Call initialized', {
      callId,
      contextId: ctx.callId
    });
    
    return ctx;
    
  } catch (error) {
    logger.error('[TWILIO INTEGRATION] Failed to initialize call', {
      error: error.message,
      stack: error.stack,
      callId,
      companyId
    });
    throw error;
  }
}

/**
 * Check if utterance is a micro-confirmation that doesn't need LLM processing
 * @param {string} text - Caller's text
 * @returns {boolean} True if micro-utterance
 */
function isMicroUtterance(text) {
  const trimmed = text.trim().toLowerCase();
  
  // Short length check
  if (trimmed.length >= 8) {
    return false;
  }
  
  // Whitelist of simple confirmations/acknowledgments
  const microUtterances = [
    'yes', 'yeah', 'yep', 'yup', 'yea',
    'no', 'nope', 'nah',
    'ok', 'okay', 'k',
    'sure', 'fine',
    'right', 'correct',
    'uh huh', 'mm hmm', 'mhmm',
    'that works', 'sounds good'
  ];
  
  return microUtterances.includes(trimmed);
}

/**
 * Handle a caller utterance and get response to speak back
 * @param {Object} params
 * @param {string} params.callId - Twilio Call SID
 * @param {string} params.companyId - Company ID
 * @param {string} params.text - Caller's text from STT
 * @param {Object} [params.sttMetadata] - STT metadata (confidence, timestamp, etc)
 * @returns {Promise<{nextPrompt: string, decision: Object}>}
 */
async function handleCallerUtterance({ callId, companyId, text, sttMetadata = {} }) {
  try {
    logger.info('[TWILIO INTEGRATION] Handling caller utterance', {
      callId,
      companyId,
      textLength: text.length
    });
    
    // PRODUCTION HARDENING: Filter micro-utterances to save LLM cost/latency
    if (isMicroUtterance(text)) {
      logger.debug('[TWILIO INTEGRATION] Micro-utterance detected, skipping LLM', {
        callId,
        text
      });
      
      // Load context to see current state
      const ctx = await loadContext(callId);
      
      // Simple acknowledgment without LLM call
      return {
        nextPrompt: "Got it. What else can I help you with?",
        decision: {
          action: 'no_op',
          nextPrompt: "Got it. What else can I help you with?",
          updatedIntent: null,
          updates: { extracted: {}, flags: {} },
          knowledgeQuery: null,
          debugNotes: 'micro_utterance_filtered'
        }
      };
    }
    
    // Process through orchestration engine
    const result = await processCallerTurn({
      companyId,
      callId,
      speaker: 'caller',
      text,
      rawSttMetadata: sttMetadata
    });
    
    logger.info('[TWILIO INTEGRATION] Orchestration complete', {
      callId,
      action: result.decision.action,
      promptLength: result.nextPrompt.length
    });
    
    return result;
    
  } catch (error) {
    logger.error('[TWILIO INTEGRATION] Failed to handle caller utterance', {
      error: error.message,
      stack: error.stack,
      callId,
      companyId,
      text: text?.substring(0, 100)
    });
    
    // Return safe fallback
    return {
      nextPrompt: "I'm here to help. Could you please repeat that?",
      decision: {
        action: 'ask_question',
        nextPrompt: "I'm here to help. Could you please repeat that?",
        updatedIntent: null,
        updates: { extracted: {}, flags: { readyToBook: false, needsKnowledgeSearch: false, wantsHuman: false } },
        knowledgeQuery: null,
        debugNotes: `error: ${error.message}`
      }
    };
  }
}

/**
 * Finalize call and persist trace
 * @param {Object} params
 * @param {string} params.callId - Twilio Call SID
 * @param {number} params.startedAt - Unix timestamp (ms) when call started
 * @param {number} params.endedAt - Unix timestamp (ms) when call ended
 * @param {Object} [params.usageData] - Optional usage data override
 * @returns {Promise<void>}
 */
async function finalizeCall({ callId, startedAt, endedAt, usageData = {} }) {
  try {
    logger.info('[TWILIO INTEGRATION] Finalizing call', {
      callId,
      startedAt,
      endedAt,
      durationSec: Math.floor((endedAt - startedAt) / 1000)
    });
    
    // Load final context to get tier trace and usage info
    const ctx = await loadContext(callId);
    
    if (!ctx) {
      logger.warn('[TWILIO INTEGRATION] No context found for finalization', {
        callId
      });
      return;
    }
    
    // Finalize call trace (persists to MongoDB and cleans Redis)
    await finalizeCallTrace(callId, { startedAt, endedAt });
    
    // Calculate usage from tier trace
    const tier1Count = ctx.tierTrace.filter(t => t.tier === 1).length;
    const tier2Count = ctx.tierTrace.filter(t => t.tier === 2).length;
    const tier3Count = ctx.tierTrace.filter(t => t.tier === 3).length;
    const llmTurns = ctx.tierTrace.filter(t => t.tier === 0 || t.tier === 3).length; // LLM-0 + Tier 3
    
    // Estimate AI cost (placeholder - will be refined in Phase 4)
    const estimatedAiCost = (llmTurns * 0.0005); // Rough estimate: $0.0005 per LLM turn
    
    // Record usage
    await recordUsage({
      companyId: ctx.companyId,
      callId: ctx.callId,
      rawDurationSeconds: (endedAt - startedAt) / 1000,
      llmTurns: usageData.llmTurns || llmTurns,
      tier1Count: usageData.tier1Count || tier1Count,
      tier2Count: usageData.tier2Count || tier2Count,
      tier3Count: usageData.tier3Count || tier3Count,
      primaryIntent: usageData.primaryIntent || ctx.currentIntent || 'UNKNOWN',
      estimatedAiCost: usageData.estimatedAiCost || estimatedAiCost
    });
    
    logger.info('[TWILIO INTEGRATION] Call finalized successfully', {
      callId,
      companyId: ctx.companyId,
      intent: ctx.currentIntent,
      appointmentId: ctx.appointmentId,
      llmTurns,
      tier1Count,
      tier2Count,
      tier3Count,
      estimatedCost: estimatedAiCost.toFixed(4)
    });
    
  } catch (error) {
    logger.error('[TWILIO INTEGRATION] Failed to finalize call', {
      error: error.message,
      stack: error.stack,
      callId
    });
    
    // Don't throw - finalization errors shouldn't crash the system
  }
}

/**
 * Get current call context (useful for debugging)
 * @param {string} callId - Twilio Call SID
 * @returns {Promise<Object|null>} Current context or null
 */
async function getCallContext(callId) {
  try {
    return await loadContext(callId);
  } catch (error) {
    logger.error('[TWILIO INTEGRATION] Failed to get call context', {
      error: error.message,
      callId
    });
    return null;
  }
}

module.exports = {
  initializeCall,
  handleCallerUtterance,
  finalizeCall,
  getCallContext
};

