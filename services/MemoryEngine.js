// services/MemoryEngine.js
//
// Brain-4: loads per-caller and per-company resolution memory
// and attaches it onto context.memory for downstream brains.

const CallerIntentHistory = require("../models/memory/CallerIntentHistory");
const IntentResolutionPath = require("../models/memory/IntentResolutionPath");
const logger = require('../utils/logger');

/**
 * Hydrate memory context for this call.
 * - Caller history (per phoneNumber, intent)
 * - Resolution paths (per intent + triageCategory + scenario)
 *
 * @param {Object} context – call context object built in v2AIAgentRuntime
 * @returns {Promise<Object>} updated context
 */
async function hydrateMemoryContext(context) {
  try {
    const { companyID, callState } = context;

    if (!companyID || !callState || !callState.from) {
      logger.debug('[MEMORY ENGINE] Missing companyId or phone number, skipping memory hydration');
      context.memory = {
        callerHistory: [],
        resolutionPaths: []
      };
      return context;
    }

    const phoneNumber = callState.from;

    logger.info('[MEMORY ENGINE] 🧠 Hydrating memory for caller', {
      companyId: companyID,
      phoneNumber: phoneNumber.substring(0, 8) + '***', // Partial for privacy
      callId: context.callId
    });

    const [callerHistory, resolutionPaths] = await Promise.all([
      CallerIntentHistory.find({
        companyId: companyID,
        phoneNumber
      }).lean(),
      IntentResolutionPath.find({
        companyId: companyID
      }).lean()
    ]);

    context.memory = {
      callerHistory: callerHistory || [],
      resolutionPaths: resolutionPaths || []
    };

    logger.info('[MEMORY ENGINE] ✅ Memory hydrated', {
      companyId: companyID,
      callerHistoryRecords: context.memory.callerHistory.length,
      resolutionPathRecords: context.memory.resolutionPaths.length,
      callId: context.callId
    });

    return context;
  } catch (err) {
    // Fail-safe: never break the call because memory failed
    logger.error("[MEMORY ENGINE] hydrateMemoryContext error:", {
      error: err.message,
      stack: err.stack,
      companyId: context.companyID,
      callId: context.callId
    });

    context.memory = {
      callerHistory: [],
      resolutionPaths: []
    };

    return context;
  }
}

module.exports = {
  hydrateMemoryContext
};

