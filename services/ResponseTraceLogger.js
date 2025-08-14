/**
 * ResponseTraceLogger.js - Centralized logging utility for response traces
 * 
 * Uses the canonical ResponseTrace model from models/ResponseTrace.js
 * Provides safe methods for adding behavior steps and saving traces
 */

const ResponseTrace = require('../models/ResponseTrace');

class ResponseTraceLogger {
  /**
   * Start a new trace
   * @param {string} companyID - Company identifier
   * @param {string} callId - Call identifier
   * @param {Object} input - Input information
   * @returns {Object} - New trace object
   */
  static startTrace(companyID, callId, input = {}) {
    console.log(`[TRACE] Starting new trace for company ${companyID}, call ${callId}`);
    
    return {
      companyID: companyID,
      callId: callId,
      sessionId: input.sessionId,
      timestamp: new Date(),
      input: input,
      knowledgeTrace: [],
      response: {},
      behaviors: [], // Ensure it's always an array
      bookingTrace: {},
      metrics: {},
      context: input.context || {},
      debug: {}
    };
  }

  /**
   * Add a behavior step to an existing trace
   * @param {Object} trace - The response trace object
   * @param {string} behaviorType - Type of behavior
   * @param {boolean} applied - Whether behavior was applied
   * @param {Object} config - Behavior configuration
   * @param {Object} result - Behavior result
   */
  static addBehaviorStep(trace, behaviorType, applied, config, result) {
    console.log(`[TRACE] Adding behavior step: ${behaviorType} (applied: ${applied})`);
    
    if (!trace.behaviors) {
      trace.behaviors = [];
    }
    
    // Defensive coercion
    if (typeof trace.behaviors === 'string') {
      console.error('🚨 CRITICAL: behaviors field is a string in addBehaviorStep!');
      try {
        trace.behaviors = JSON.parse(trace.behaviors);
        console.warn('⚠️ Fixed stringified behaviors array in addBehaviorStep');
      } catch (error) {
        console.error('❌ Failed to parse behaviors string in addBehaviorStep:', error);
        trace.behaviors = [];
      }
    }
    
    if (!Array.isArray(trace.behaviors)) {
      console.error('🚨 CRITICAL: behaviors is not an array in addBehaviorStep - fixing');
      trace.behaviors = [];
    }
    
    const behaviorStep = {
      type: behaviorType,
      applied: applied,
      config: config,
      result: result,
      timestamp: new Date()
    };
    
    trace.behaviors.push(behaviorStep);
    console.log(`[TRACE] Behavior step added. Total behaviors: ${trace.behaviors.length}`);
  }
  
  /**
   * Add intent step to trace
   * @param {Object} trace - The trace object
   * @param {Object} intentResult - Intent routing result
   */
  static addIntentStep(trace, intentResult) {
    this.addBehaviorStep(trace, 'intent_routing', true, intentResult, {
      intent: intentResult.intent,
      confidence: intentResult.confidence,
      processingTime: intentResult.processingTime
    });
    
    trace.input = trace.input || {};
    trace.input.intent = intentResult.intent;
    trace.input.confidence = intentResult.confidence;
  }
  
  /**
   * Add booking step to trace
   * @param {Object} trace - The trace object
   * @param {Object} bookingState - Booking state
   * @param {Object} extractionResult - Field extraction result
   */
  static addBookingStep(trace, bookingState, extractionResult) {
    trace.bookingTrace = {
      stepIndex: bookingState.stepIndex,
      stepName: bookingState.stepName,
      fieldExtracted: extractionResult?.field,
      extractionConfidence: extractionResult?.confidence,
      isComplete: bookingState.isComplete,
      bookingId: bookingState.bookingId
    };
    
    this.addBehaviorStep(trace, 'booking_step', true, bookingState, extractionResult);
  }
  
  /**
   * Add knowledge step to trace
   * @param {Object} trace - The trace object
   * @param {string} source - Knowledge source
   * @param {string} query - Search query
   * @param {number} matches - Number of matches
   * @param {number} score - Match score
   * @param {boolean} selected - Whether selected
   */
  static addKnowledgeStep(trace, source, query, matches, score, selected) {
    if (!trace.knowledgeTrace) {
      trace.knowledgeTrace = [];
    }
    
    trace.knowledgeTrace.push({
      source: source,
      query: query,
      matches: matches,
      score: score,
      selected: selected,
      responseTime: Date.now() - (trace.timestamp?.getTime() || Date.now())
    });
    
    this.addBehaviorStep(trace, 'knowledge_search', selected, { source, query }, {
      matches: matches,
      score: score,
      selected: selected
    });
    
    console.log(`[TRACE] Knowledge step added: ${source} (score: ${score}, selected: ${selected})`);
  }
  
  /**
   * Set response information
   * @param {Object} trace - The trace object
   * @param {Object} responseData - Response data
   * @param {string} source - Response source
   */
  static setResponse(trace, responseData, source) {
    trace.response = {
      text: responseData.text,
      source: source,
      confidence: responseData.confidence,
      responseId: responseData.responseId || `resp_${Date.now()}`
    };
    
    console.log(`[TRACE] Response set: source=${source}, length=${responseData.text?.length || 0}`);
  }
  
  /**
   * Set debug information
   * @param {Object} trace - The trace object
   * @param {Object} debugInfo - Debug information
   */
  static setDebug(trace, debugInfo) {
    trace.debug = Object.assign(trace.debug || {}, debugInfo);
    console.log(`[TRACE] Debug info updated:`, debugInfo);
  }
  
  /**
   * Set metrics
   * @param {Object} trace - The trace object
   * @param {Object} metrics - Metrics to set
   */
  static setMetrics(trace, metrics) {
    trace.metrics = Object.assign(trace.metrics || {}, metrics);
    console.log(`[TRACE] Metrics updated:`, metrics);
  }
  
  /**
   * Create a new response trace
   * @param {string} companyID - Company identifier
   * @param {string} callId - Call identifier
   * @param {Object} options - Additional trace options
   * @returns {Object} - New trace object
   */
  static createTrace(companyID, callId, options = {}) {
    console.log(`[TRACE] Creating new trace for company ${companyID}, call ${callId}`);
    
    return {
      companyID: companyID,
      callId: callId,
      sessionId: options.sessionId,
      timestamp: new Date(),
      input: options.input || {},
      knowledgeTrace: [],
      response: options.response || {},
      behaviors: [], // Ensure it's always an array
      bookingTrace: options.bookingTrace || {},
      metrics: options.metrics || {},
      context: options.context || {},
      debug: options.debug || {}
    };
  }
  
  /**
   * Save a trace to the database
   * @param {Object} trace - The trace object to save
   * @returns {Promise<Object>} - Saved trace document
   */
  static async saveTrace(trace) {
    try {
      console.log(`[TRACE] Saving trace for call ${trace.callId}`);
      
      // Final defensive check before save
      if (!trace.behaviors) {
        trace.behaviors = [];
      }
      
      if (typeof trace.behaviors === 'string') {
        console.error('🚨 CRITICAL: behaviors is string in saveTrace - coercing');
        try {
          trace.behaviors = JSON.parse(trace.behaviors);
        } catch (error) {
          console.error('❌ Failed to parse behaviors in saveTrace:', error);
          trace.behaviors = [];
        }
      }
      
      if (!Array.isArray(trace.behaviors)) {
        console.error('🚨 CRITICAL: behaviors not array in saveTrace - fixing');
        trace.behaviors = [];
      }
      
      const savedTrace = await ResponseTrace.create(trace);
      console.log(`[TRACE] Trace saved successfully. Behaviors count: ${savedTrace.behaviors.length}`);
      
      return savedTrace;
    } catch (error) {
      console.error('❌ Failed to save trace:', error);
      throw error;
    }
  }
  
  /**
   * Add knowledge source to trace
   * @param {Object} trace - The trace object
   * @param {string} source - Knowledge source name
   * @param {string} query - Query used
   * @param {number} matches - Number of matches
   * @param {number} score - Match score
   * @param {boolean} selected - Whether this source was selected
   */
  static addKnowledgeTrace(trace, source, query, matches, score, selected) {
    if (!trace.knowledgeTrace) {
      trace.knowledgeTrace = [];
    }
    
    trace.knowledgeTrace.push({
      source: source,
      query: query,
      matches: matches,
      score: score,
      selected: selected,
      responseTime: Date.now() - (trace.timestamp?.getTime() || Date.now())
    });
    
    console.log(`[TRACE] Knowledge trace added: ${source} (score: ${score}, selected: ${selected})`);
  }
  
  /**
   * Update trace metrics
   * @param {Object} trace - The trace object
   * @param {Object} metrics - Metrics to update
   */
  static updateMetrics(trace, metrics) {
    if (!trace.metrics) {
      trace.metrics = {};
    }
    
    Object.assign(trace.metrics, metrics);
    console.log(`[TRACE] Metrics updated:`, metrics);
  }
  
  /**
   * Get trace statistics for a company
   * @param {string} companyID - Company identifier
   * @param {Date} startDate - Start date
   * @param {Date} endDate - End date
   * @returns {Promise<Object>} - Trace statistics
   */
  static async getTraceStatistics(companyID, startDate, endDate) {
    try {
      const traces = await ResponseTrace.find({
        companyID: companyID,
        timestamp: { $gte: startDate, $lte: endDate }
      });
      
      return {
        totalTraces: traces.length,
        successfulResponses: traces.filter(t => t.response?.text).length,
        averageResponseTime: traces.reduce((sum, t) => sum + (t.metrics?.totalResponseTime || 0), 0) / traces.length,
        knowledgeSources: traces.flatMap(t => t.knowledgeTrace || []).map(kt => kt.source)
      };
    } catch (error) {
      console.error('Error getting trace statistics:', error);
      throw error;
    }
  }
  
  /**
   * Get trace by call ID
   * @param {string} companyID - Company identifier
   * @param {string} callId - Call identifier
   * @returns {Promise<Object>} - Trace object
   */
  static async getTraceByCallId(companyID, callId) {
    try {
      return await ResponseTrace.findOne({ companyID, callId });
    } catch (error) {
      console.error('Error getting trace by call ID:', error);
      throw error;
    }
  }
  
  /**
   * Get recent traces for a company
   * @param {string} companyID - Company identifier
   * @param {number} limit - Number of traces to return
   * @returns {Promise<Array>} - Array of recent traces
   */
  static async getRecentTraces(companyID, limit = 10) {
    try {
      return await ResponseTrace.find({ companyID })
        .sort({ timestamp: -1 })
        .limit(limit);
    } catch (error) {
      console.error('Error getting recent traces:', error);
      throw error;
    }
  }
}

module.exports = { ResponseTraceLogger };
