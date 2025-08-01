/**
 * ResponseTrace.js - Structured trace logging for AI agent responses
 * 
 * Provides comprehensive logging and tracing for:
 * - Knowledge source selection and scoring
 * - Intent routing decisions
 * - Behavior rule applications
 * - Booking flow progression
 * - Performance metrics
 * - Debug information
 */

const mongoose = require('mongoose');

// ResponseTrace schema for storing trace logs
const responseTraceSchema = new mongoose.Schema({
  companyID: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  callId: { type: String, required: true, index: true },
  sessionId: { type: String, index: true },
  timestamp: { type: Date, default: Date.now, index: true },
  
  // Input information
  input: {
    text: String,
    intent: String,
    confidence: Number,
    parameters: mongoose.Schema.Types.Mixed
  },
  
  // Knowledge routing trace
  knowledgeTrace: [{
    source: String,
    query: String,
    matches: Number,
    score: Number,
    threshold: Number,
    selected: Boolean,
    responseTime: Number,
    error: String
  }],
  
  // Final response information
  response: {
    text: String,
    source: String,
    confidence: Number,
    responseId: String
  },
  
  // Behavior applications
  behaviors: [{
    type: String,
    applied: Boolean,
    config: mongoose.Schema.Types.Mixed,
    result: mongoose.Schema.Types.Mixed
  }],
  
  // Booking flow trace (if applicable)
  bookingTrace: {
    stepIndex: Number,
    stepName: String,
    fieldExtracted: String,
    extractionConfidence: Number,
    isComplete: Boolean,
    bookingId: String
  },
  
  // Performance metrics
  metrics: {
    totalResponseTime: Number,
    knowledgeRoutingTime: Number,
    behaviorProcessingTime: Number,
    llmCallTime: Number,
    cacheHit: Boolean
  },
  
  // Context and state
  context: {
    previousIntent: String,
    callDuration: Number,
    silenceCount: Number,
    interruptionCount: Number,
    detectedEmotion: String
  },
  
  // Debug information
  debug: {
    modelUsed: String,
    fallbackTriggered: Boolean,
    errorOccurred: Boolean,
    errorDetails: String,
    configVersion: String
  }
}, {
  timestamps: true
});

// Indexes for efficient querying
responseTraceSchema.index({ companyID: 1, timestamp: -1 });
responseTraceSchema.index({ callId: 1, timestamp: 1 });
responseTraceSchema.index({ 'response.source': 1, timestamp: -1 });

const ResponseTrace = mongoose.model('ResponseTrace', responseTraceSchema);

class ResponseTraceLogger {
  /**
   * Start a new trace session
   * @param {string} companyID - Company identifier
   * @param {string} callId - Call identifier
   * @param {Object} input - Initial input data
   * @returns {Object} Trace session object
   */
  static startTrace(companyID, callId, input = {}) {
    return {
      companyID,
      callId,
      sessionId: input.sessionId,
      startTime: Date.now(),
      input: {
        text: input.text,
        intent: null,
        confidence: null,
        parameters: {}
      },
      knowledgeTrace: [],
      response: {},
      behaviors: [],
      bookingTrace: null,
      metrics: {
        cacheHit: false
      },
      context: input.context || {},
      debug: {
        errorOccurred: false,
        fallbackTriggered: false
      }
    };
  }

  /**
   * Add intent routing step to trace
   * @param {Object} trace - Current trace object
   * @param {Object} intentResult - Intent routing result
   */
  static addIntentStep(trace, intentResult) {
    trace.input.intent = intentResult.intent;
    trace.input.confidence = intentResult.confidence;
    trace.input.parameters = intentResult.parameters || {};
    
    if (intentResult.isFallback) {
      trace.debug.fallbackTriggered = true;
    }
  }

  /**
   * Add knowledge source step to trace
   * @param {Object} trace - Current trace object
   * @param {string} source - Knowledge source name
   * @param {Object} result - Search result
   * @param {number} threshold - Confidence threshold
   * @param {boolean} selected - Whether this source was selected
   * @param {number} responseTime - Time taken for this step
   */
  static addKnowledgeStep(trace, source, result, threshold, selected, responseTime) {
    trace.knowledgeTrace.push({
      source,
      query: result.query || trace.input.text,
      matches: result.matches || 0,
      score: result.score || 0,
      threshold,
      selected,
      responseTime,
      error: result.error
    });
    
    if (result.error) {
      trace.debug.errorOccurred = true;
    }
  }

  /**
   * Add behavior application to trace
   * @param {Object} trace - Current trace object
   * @param {string} behaviorType - Type of behavior applied
   * @param {boolean} applied - Whether behavior was applied
   * @param {Object} config - Behavior configuration
   * @param {Object} result - Behavior result
   */
  static addBehaviorStep(trace, behaviorType, applied, config, result) {
    trace.behaviors.push({
      type: behaviorType,
      applied,
      config,
      result
    });
  }

  /**
   * Add booking flow step to trace
   * @param {Object} trace - Current trace object
   * @param {Object} bookingState - Current booking state
   * @param {Object} extractionResult - Field extraction result
   */
  static addBookingStep(trace, bookingState, extractionResult) {
    const currentStep = bookingState.flowConfig?.steps?.[bookingState.stepIndex];
    
    trace.bookingTrace = {
      stepIndex: bookingState.stepIndex,
      stepName: currentStep?.field || 'unknown',
      fieldExtracted: extractionResult?.value,
      extractionConfidence: extractionResult?.confidence || 0,
      isComplete: bookingState.isComplete || false,
      bookingId: bookingState.bookingId
    };
  }

  /**
   * Set final response in trace
   * @param {Object} trace - Current trace object
   * @param {Object} response - Final response object
   * @param {string} source - Source that provided the response
   */
  static setResponse(trace, response, source) {
    trace.response = {
      text: response.text,
      source,
      confidence: response.confidence || response.score || 0,
      responseId: response.id || response._id
    };
  }

  /**
   * Set performance metrics
   * @param {Object} trace - Current trace object
   * @param {Object} metrics - Performance metrics
   */
  static setMetrics(trace, metrics) {
    const totalTime = Date.now() - trace.startTime;
    
    trace.metrics = {
      totalResponseTime: totalTime,
      knowledgeRoutingTime: metrics.knowledgeRoutingTime || 0,
      behaviorProcessingTime: metrics.behaviorProcessingTime || 0,
      llmCallTime: metrics.llmCallTime || 0,
      cacheHit: metrics.cacheHit || false
    };
  }

  /**
   * Set debug information
   * @param {Object} trace - Current trace object
   * @param {Object} debug - Debug information
   */
  static setDebug(trace, debug) {
    trace.debug = {
      ...trace.debug,
      modelUsed: debug.modelUsed,
      errorDetails: debug.errorDetails,
      configVersion: debug.configVersion
    };
  }

  /**
   * Finalize and save trace to database
   * @param {Object} trace - Complete trace object
   * @returns {Object} Saved trace document
   */
  static async saveTrace(trace) {
    try {
      const traceDoc = new ResponseTrace({
        companyID: trace.companyID,
        callId: trace.callId,
        sessionId: trace.sessionId,
        input: trace.input,
        knowledgeTrace: trace.knowledgeTrace,
        response: trace.response,
        behaviors: trace.behaviors,
        bookingTrace: trace.bookingTrace,
        metrics: trace.metrics,
        context: trace.context,
        debug: trace.debug
      });

      const savedTrace = await traceDoc.save();
      return savedTrace;
    } catch (error) {
      console.error('Error saving response trace:', error);
      throw error;
    }
  }

  /**
   * Get trace by call ID
   * @param {string} companyID - Company identifier
   * @param {string} callId - Call identifier
   * @returns {Array} Array of trace documents
   */
  static async getTraceByCallId(companyID, callId) {
    try {
      return await ResponseTrace.find({
        companyID,
        callId
      }).sort({ timestamp: 1 });
    } catch (error) {
      console.error('Error fetching trace by call ID:', error);
      throw error;
    }
  }

  /**
   * Get recent traces for company
   * @param {string} companyID - Company identifier
   * @param {number} limit - Number of traces to return
   * @returns {Array} Array of recent trace documents
   */
  static async getRecentTraces(companyID, limit = 50) {
    try {
      return await ResponseTrace.find({ companyID })
        .sort({ timestamp: -1 })
        .limit(limit);
    } catch (error) {
      console.error('Error fetching recent traces:', error);
      throw error;
    }
  }

  /**
   * Get trace statistics for company
   * @param {string} companyID - Company identifier
   * @param {Date} startDate - Start date for statistics
   * @param {Date} endDate - End date for statistics
   * @returns {Object} Trace statistics
   */
  static async getTraceStatistics(companyID, startDate, endDate) {
    try {
      const pipeline = [
        {
          $match: {
            companyID: new mongoose.Types.ObjectId(companyID),
            timestamp: {
              $gte: startDate,
              $lte: endDate
            }
          }
        },
        {
          $group: {
            _id: null,
            totalTraces: { $sum: 1 },
            averageResponseTime: { $avg: '$metrics.totalResponseTime' },
            cacheHitRate: {
              $avg: {
                $cond: ['$metrics.cacheHit', 1, 0]
              }
            },
            sourceBreakdown: {
              $push: '$response.source'
            },
            intentBreakdown: {
              $push: '$input.intent'
            },
            errorRate: {
              $avg: {
                $cond: ['$debug.errorOccurred', 1, 0]
              }
            }
          }
        }
      ];

      const result = await ResponseTrace.aggregate(pipeline);
      
      if (result.length === 0) {
        return {
          totalTraces: 0,
          averageResponseTime: 0,
          cacheHitRate: 0,
          sourceBreakdown: {},
          intentBreakdown: {},
          errorRate: 0
        };
      }

      const stats = result[0];
      
      // Process breakdowns
      const sourceBreakdown = {};
      stats.sourceBreakdown.forEach(source => {
        sourceBreakdown[source] = (sourceBreakdown[source] || 0) + 1;
      });
      
      const intentBreakdown = {};
      stats.intentBreakdown.forEach(intent => {
        intentBreakdown[intent] = (intentBreakdown[intent] || 0) + 1;
      });
      
      return {
        totalTraces: stats.totalTraces,
        averageResponseTime: Math.round(stats.averageResponseTime || 0),
        cacheHitRate: Math.round((stats.cacheHitRate || 0) * 100),
        sourceBreakdown,
        intentBreakdown,
        errorRate: Math.round((stats.errorRate || 0) * 100)
      };
    } catch (error) {
      console.error('Error calculating trace statistics:', error);
      throw error;
    }
  }

  /**
   * Search traces by criteria
   * @param {string} companyID - Company identifier
   * @param {Object} criteria - Search criteria
   * @returns {Array} Matching trace documents
   */
  static async searchTraces(companyID, criteria) {
    try {
      const query = { companyID };
      
      if (criteria.callId) {
        query.callId = criteria.callId;
      }
      
      if (criteria.intent) {
        query['input.intent'] = criteria.intent;
      }
      
      if (criteria.source) {
        query['response.source'] = criteria.source;
      }
      
      if (criteria.errorOnly) {
        query['debug.errorOccurred'] = true;
      }
      
      if (criteria.startDate && criteria.endDate) {
        query.timestamp = {
          $gte: criteria.startDate,
          $lte: criteria.endDate
        };
      }
      
      const sort = criteria.sortBy === 'responseTime' 
        ? { 'metrics.totalResponseTime': -1 }
        : { timestamp: -1 };
      
      return await ResponseTrace.find(query)
        .sort(sort)
        .limit(criteria.limit || 100);
    } catch (error) {
      console.error('Error searching traces:', error);
      throw error;
    }
  }

  /**
   * Delete old traces (for cleanup)
   * @param {string} companyID - Company identifier
   * @param {Date} olderThan - Delete traces older than this date
   * @returns {Object} Deletion result
   */
  static async deleteOldTraces(companyID, olderThan) {
    try {
      const result = await ResponseTrace.deleteMany({
        companyID,
        timestamp: { $lt: olderThan }
      });
      
      return {
        deletedCount: result.deletedCount
      };
    } catch (error) {
      console.error('Error deleting old traces:', error);
      throw error;
    }
  }

  /**
   * Export trace data for analysis
   * @param {string} companyID - Company identifier
   * @param {Object} criteria - Export criteria
   * @returns {Array} Trace data for export
   */
  static async exportTraces(companyID, criteria = {}) {
    try {
      const traces = await this.searchTraces(companyID, criteria);
      
      return traces.map(trace => ({
        timestamp: trace.timestamp,
        callId: trace.callId,
        intent: trace.input.intent,
        inputText: trace.input.text,
        responseText: trace.response.text,
        responseSource: trace.response.source,
        confidence: trace.response.confidence,
        responseTime: trace.metrics.totalResponseTime,
        cacheHit: trace.metrics.cacheHit,
        errorOccurred: trace.debug.errorOccurred,
        knowledgeSources: trace.knowledgeTrace.map(kt => ({
          source: kt.source,
          score: kt.score,
          selected: kt.selected
        }))
      }));
    } catch (error) {
      console.error('Error exporting traces:', error);
      throw error;
    }
  }
}

module.exports = {
  ResponseTraceLogger,
  ResponseTrace
};
