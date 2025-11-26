/**
 * ============================================================================
 * TRACE LOGGER SERVICE - RESPONSE TRACE LOGGING
 * ============================================================================
 * 
 * PURPOSE: Log turn-by-turn decision chain for LLM-0 orchestrator debugging
 * ARCHITECTURE: Fire-and-forget MongoDB writes (never blocks call flow)
 * USAGE: Called by orchestrationEngine after each turn
 * 
 * ============================================================================
 */

const { v4: uuidv4 } = require('uuid');
const ResponseTraceLog = require('../models/ResponseTraceLog');

class TraceLogger {
  /**
   * Log a single turn of a call.
   *
   * @param {Object} payload
   * @param {string} payload.callId
   * @param {string} payload.companyId
   * @param {number} payload.turnNumber
   * @param {Object} payload.input
   * @param {Object} payload.frontlineIntel
   * @param {Object} payload.orchestratorDecision
   * @param {Object} payload.knowledgeLookup
   * @param {Object} payload.bookingAction
   * @param {Object} payload.output
   * @param {Object} payload.performance
   * @param {Object} payload.cost
   * @param {Object} payload.contextSnapshot
   */
  async logTurn(payload) {
    const traceId = uuidv4();

    const doc = {
      traceId,
      callId: payload.callId,
      companyId: payload.companyId,
      turnNumber: payload.turnNumber,
      timestamp: new Date(),

      input: payload.input || {},
      frontlineIntel: payload.frontlineIntel || {},
      orchestratorDecision: payload.orchestratorDecision || {},
      knowledgeLookup: payload.knowledgeLookup || { triggered: false },
      bookingAction: payload.bookingAction || { triggered: false },
      output: payload.output || {},
      performance: payload.performance || {},
      cost: payload.cost || {},
      contextSnapshot: payload.contextSnapshot || {}
    };

    try {
      await ResponseTraceLog.create(doc);
      // Logging failure must never break call flow
      if (process.env.NODE_ENV !== 'production') {
        console.log(
          `[TRACE] Logged turn ${doc.turnNumber} for call ${doc.callId} (company ${doc.companyId})`
        );
      }
      return traceId;
    } catch (err) {
      console.error('[TRACE] Failed to log turn', {
        message: err.message,
        stack: err.stack
      });
      return null;
    }
  }

  /**
   * Fetch full trace for a call, ordered by turnNumber.
   */
  async getCallTrace(callId, companyId) {
    const query = { callId };
    if (companyId) query.companyId = companyId;

    return ResponseTraceLog.find(query).sort({ turnNumber: 1 }).lean();
  }

  /**
   * Fetch latest traces for a company (for dashboards).
   */
  async getRecentTraces(companyId, limit = 50) {
    return ResponseTraceLog.find({ companyId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();
  }
}

module.exports = new TraceLogger();

