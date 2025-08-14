/**
 * ResponseTrace.js - Canonical ResponseTrace model for AI agent responses
 * 
 * Single source of truth for response tracing with proper behaviors schema
 */

const mongoose = require('mongoose');

// Response trace schema with correct behaviors type
const responseTraceSchema = new mongoose.Schema({
  companyID: { 
    type: mongoose.Schema.Types.ObjectId, 
    required: true, 
    index: true 
  },
  callId: { 
    type: String, 
    required: true, 
    index: true 
  },
  sessionId: { 
    type: String, 
    index: true 
  },
  timestamp: { 
    type: Date, 
    default: Date.now, 
    index: true 
  },
  
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
  
  // CRITICAL: behaviors as array of objects/Mixed, NOT [String]
  behaviors: [{
    type: { type: String },
    applied: { type: Boolean },
    config: { type: mongoose.Schema.Types.Mixed },
    result: { type: mongoose.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now }
  }],
  
  // Booking flow trace
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

// Defensive behavior coercion before save
responseTraceSchema.pre('validate', function() {
  // Guard against legacy string behaviors
  if (this.behaviors) {
    if (typeof this.behaviors === 'string') {
      console.error('🚨 CRITICAL: behaviors field is a string - coercing to array');
      try {
        this.behaviors = JSON.parse(this.behaviors);
      } catch (error) {
        console.error('❌ Failed to parse behaviors string, setting to empty array:', error);
        this.behaviors = [];
      }
      
      // Log trace coercion for debugging
      if (!this.behaviors.find(b => b.type === 'trace_coercion')) {
        this.behaviors.push({
          type: 'trace_coercion',
          applied: true,
          config: { source: 'models/ResponseTrace.js:pre-validate' },
          result: 'converted string to array'
        });
      }
    }
    
    if (!Array.isArray(this.behaviors)) {
      console.error('🚨 CRITICAL: behaviors is not an array - setting to empty array');
      this.behaviors = [];
      
      if (!this.behaviors.find(b => b.type === 'trace_coercion')) {
        this.behaviors.push({
          type: 'trace_coercion',
          applied: true,
          config: { source: 'models/ResponseTrace.js:pre-validate' },
          result: 'converted non-array to array'
        });
      }
    }
  }
});

// Indexes for efficient querying
responseTraceSchema.index({ companyID: 1, timestamp: -1 });
responseTraceSchema.index({ callId: 1, timestamp: 1 });
responseTraceSchema.index({ companyID: 1, callId: 1, createdAt: -1 });

const ResponseTrace = mongoose.model('ResponseTrace', responseTraceSchema);

module.exports = ResponseTrace;
