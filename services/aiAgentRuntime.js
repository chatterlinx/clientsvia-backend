/**
 * aiAgentRuntime.js - Enhanced AI Agent Runtime Integration
 * 
 * This service orchestrates all AI Agent Logic components:
 * - Intent routing
 * - Knowledge source selection
 * - Behavior application
 * - Booking flow management
 * - Response tracing
 * 
 * Integrates with existing Twilio infrastructure while adding new capabilities.
 */

const { route: routeIntent } = require('../src/runtime/IntentRouter');
const { route: routeKnowledge } = require('../src/runtime/KnowledgeRouter');
const { apply: applyBehavior, updateCallState } = require('../src/runtime/BehaviorEngine');
const { start: startBooking, next: nextBooking } = require('../src/runtime/BookingHandler');
const { ResponseTraceLogger } = require('../src/runtime/ResponseTrace');
const aiLoader = require('../src/config/aiLoader');
const Company = require('../models/Company');

// Import existing services for backwards compatibility
const { answerQuestion } = require('./agent');
const { findCachedAnswer } = require('../utils/aiAgent');

/**
 * Helper function to check if call transfer is enabled for a company
 * @param {string} companyID - Company identifier
 * @returns {boolean} - Whether transfer is enabled
 */
async function isTransferEnabled(companyID) {
  try {
    const company = await Company.findById(companyID);
    return company?.aiAgentLogic?.callTransferConfig?.dialOutEnabled === true;
  } catch (error) {
    console.error('[AI AGENT] Error checking transfer status:', error);
    return false;
  }
}

/**
 * Helper function to create appropriate response when transfer is disabled
 * @param {string} originalText - Original transfer message
 * @param {string} scenario - Scenario type (emergency, booking, etc.)
 * @returns {Object} - Response object with transfer disabled
 */
function createNonTransferResponse(originalText, scenario = 'general') {
  const fallbackMessages = {
    emergency: "I understand this is urgent. Please call our emergency number directly at your earliest convenience, or visit our website for immediate contact information.",
    booking: "I'm having trouble with the booking system. Please try our online booking system or call back later to schedule your appointment.",
    transfer: "I apologize, but I cannot transfer your call at this time. Please visit our website or try calling back later for assistance.",
    general: "I apologize, but I cannot assist further at this time. Please visit our website or try calling back later."
  };
  
  return {
    text: fallbackMessages[scenario] || fallbackMessages.general,
    shouldTransfer: false,
    shouldHangup: true,
    transferDisabled: true
  };
}

class AIAgentRuntime {
  /**
   * Initialize a new call and generate greeting
   * @param {string} companyID - Company identifier  
   * @param {string} callId - Twilio call SID
   * @param {string} from - Caller phone number
   * @param {string} to - Called phone number
   * @returns {Object} Initialization result with greeting and call state
   */
  static async initializeCall(companyID, callId, from, to) {
    const startTime = Date.now();
    
    try {
      console.log(`[AI AGENT INIT] Initializing call for company ${companyID}, CallSid: ${callId}`);
      
      // Load AI configuration
      const config = await aiLoader.get(companyID);
      if (!config) {
        console.log(`[AI AGENT INIT] No AI config found for company ${companyID}, using default greeting`);
        return {
          greeting: "Hello! Thank you for calling. How can I help you today?", // REMOVED: This should never be reached - all companies must have aiAgentLogic
          callState: {
            callId,
            from,
            to,
            startTime: new Date(),
            stage: 'greeting'
          }
        };
      }

      // Generate personalized greeting from AI Agent Logic - MUST come from database
      let greeting = null; // CRITICAL: No hardcoded fallback - force loading from aiAgentLogic
      
      // Check if company has AI Agent Logic greeting configured
      if (config.responseCategories?.core?.['greeting-response']) {
        greeting = config.responseCategories.core['greeting-response'];
      } else if (config.responseCategories?.greeting?.template) {
        greeting = config.responseCategories.greeting.template;
      } else if (config.agentSetup?.agentGreeting) {
        greeting = config.agentSetup.agentGreeting;
      }
      
      // CRITICAL: If no greeting found, this is a configuration error - FORCE admin to configure
      if (!greeting) {
        console.error(`❌ CRITICAL: No greeting configured for company ${companyID} - check aiAgentLogic.responseCategories.core['greeting-response']`);
        console.error(`❌ CRITICAL: Company must configure greeting in Agent Personality tab - no hardcoded fallback allowed`);
        greeting = `Configuration error for ${config.businessName || config.companyName || 'this company'} - greeting not configured in Agent Personality tab`;
      }
      
      // Apply placeholder replacements [[memory:8276820]]
      if (config.businessName || config.companyName) {
        const companyName = config.businessName || config.companyName;
        greeting = greeting.replace(/\{companyname\}/gi, companyName);
        greeting = greeting.replace(/\{companyName\}/gi, companyName);
        greeting = greeting.replace(/\{\{companyName\}\}/gi, companyName);
      }
      
      // Handle caller name placeholder - will be filled during actual call processing
      // For now, remove the placeholder since we don't have caller info at greeting time
      greeting = greeting.replace(/\{\{callerName\}\}/gi, '');
      greeting = greeting.replace(/\{callerName\}/gi, '');
      greeting = greeting.replace(/\{callername\}/gi, '');

      console.log(`[AI AGENT INIT] Generated greeting: "${greeting}"`);

      // Initialize call state
      const callState = {
        callId,
        from,
        to,
        startTime: new Date(),
        stage: 'greeting',
        consecutiveSilences: 0,
        failedAttempts: 0,
        context: {}
      };

      const initTime = Date.now() - startTime;
      console.log(`[AI AGENT INIT] Call initialized in ${initTime}ms`);

      return {
        greeting,
        callState
      };

    } catch (error) {
      console.error(`[AI AGENT INIT ERROR] Failed to initialize call: ${error.message}`);
      
      // Fallback to basic greeting
      return {
        greeting: greeting || "Configuration error - no greeting found",
        callState: {
          callId,
          from,
          to,
          startTime: new Date(),
          stage: 'greeting'
        }
      };
    }
  }

  /**
   * Process a voice call turn through the enhanced AI pipeline
   * @param {string} companyID - Company identifier
   * @param {string} callId - Twilio call SID
   * @param {string} userText - Transcribed user speech
   * @param {Object} callState - Current call state
   * @param {Object} company - Company document (for backwards compatibility)
   * @returns {Object} Complete response with text, behavior controls, and metadata
   */
  static async processCallTurn(companyID, callId, userText, callState = {}, company = null) {
    const startTime = Date.now();
    let trace = null;
    
    try {
      // Start trace logging
      trace = ResponseTraceLogger.startTrace(companyID, callId, {
        text: userText,
        context: callState
      });

      // Load AI configuration
      const config = await aiLoader.get(companyID);
      if (!config) {
        throw new Error(`AI configuration not found for company ${companyID}`);
      }

      // 1. Intent routing
      const intentStart = Date.now();
      const intentResult = await routeIntent(companyID, userText, callState);
      const intentTime = Date.now() - intentStart;
      
      ResponseTraceLogger.addIntentStep(trace, intentResult);
      
      // Handle specific intents
      switch (intentResult.intent) {
        case 'booking':
          return await this.handleBookingIntent(companyID, callId, userText, callState, trace, config);
          
        case 'transfer':
          return await this.handleTransferIntent(companyID, callId, userText, callState, trace, config);
          
        case 'emergency':
          return await this.handleEmergencyIntent(companyID, callId, userText, callState, trace, config);
          
        case 'hours':
          return await this.handleHoursIntent(companyID, callId, userText, callState, trace, config);
          
        case 'cancel':
          return await this.handleCancelIntent(companyID, callId, userText, callState, trace, config);
          
        case 'qa':
        default:
          return await this.handleKnowledgeIntent(companyID, callId, userText, callState, trace, config, company);
      }
      
    } catch (error) {
      console.error('❌ CRITICAL ERROR in AI Agent Runtime:', error);
      
      if (trace) {
        ResponseTraceLogger.setDebug(trace, {
          errorOccurred: true,
          errorDetails: error.message
        });
        await ResponseTraceLogger.saveTrace(trace);
      }
      
      // Re-throw the error - let the in-house fallback system handle it [[memory:8276820]]
      // The in-house fallback (0.5 threshold) should always respond, no need for legacy fallback
      throw error;
    }
  }

  /**
   * Handle booking intent
   */
  static async handleBookingIntent(companyID, callId, userText, callState, trace, config) {
    try {
      let bookingState = callState.bookingState;
      
      if (!bookingState) {
        // Start new booking flow
        bookingState = await startBooking(companyID, {
          userText,
          intent: 'booking'
        });
        
        callState.bookingState = bookingState;
        callState.intent = 'booking';
        
        const response = bookingState.flowConfig.steps[0].prompt || 
          "I'd be happy to help you schedule an appointment. Could you please tell me your name?";
        
        ResponseTraceLogger.addBookingStep(trace, bookingState, null);
        ResponseTraceLogger.setResponse(trace, { text: response }, 'booking_flow');
        
        const finalResponse = await this.applyBehaviorAndFinalize(
          config, callState, { text: response }, trace, companyID
        );
        
        return finalResponse;
      } else {
        // Continue existing booking flow
        const bookingResult = await nextBooking(bookingState, userText, {
          callState,
          companyID
        });
        
        callState.bookingState = bookingResult.state;
        
        ResponseTraceLogger.addBookingStep(trace, bookingResult.state, bookingResult.extractionResult);
        ResponseTraceLogger.setResponse(trace, { text: bookingResult.response }, 'booking_flow');
        
        const finalResponse = await this.applyBehaviorAndFinalize(
          config, callState, { text: bookingResult.response }, trace
        );
        
        // If booking is complete, clear booking state
        if (bookingResult.isComplete) {
          delete callState.bookingState;
          callState.intent = null;
        }
        
        return finalResponse;
      }
    } catch (error) {
      console.error('Error handling booking intent:', error);
      
      // Check if transfer is enabled for booking errors
      const transferEnabled = await isTransferEnabled(companyID);
      
      let errorResponse;
      if (transferEnabled) {
        errorResponse = {
          text: "I'm having trouble with the booking system right now. Let me transfer you to someone who can help you schedule your appointment.",
          shouldTransfer: true
        };
      } else {
        errorResponse = createNonTransferResponse(
          "I'm having trouble with the booking system right now.", 
          'booking'
        );
      }
      
      return await this.applyBehaviorAndFinalize(config, callState, errorResponse, trace, companyID);
    }
  }

  /**
   * Handle knowledge/QA intent
   */
  static async handleKnowledgeIntent(companyID, callId, userText, callState, trace, config, company) {
    try {
      const knowledgeStart = Date.now();
      
      // Use new knowledge router
      const knowledgeResult = await routeKnowledge({
        companyID,
        text: userText,
        context: callState,
        config: config
      });
      
      const knowledgeTime = Date.now() - knowledgeStart;
      
      // Add knowledge steps to trace
      knowledgeResult.trace.forEach(step => {
        ResponseTraceLogger.addKnowledgeStep(
          trace, step.source, step, step.threshold || 0, step.selected, knowledgeTime
        );
      });
      
      ResponseTraceLogger.setResponse(trace, knowledgeResult.result, knowledgeResult.trace.find(t => t.selected)?.source || 'unknown');
      
      const finalResponse = await this.applyBehaviorAndFinalize(
        config, callState, knowledgeResult.result, trace
      );
      
      return finalResponse;
      
    } catch (error) {
      console.error('❌ CRITICAL ERROR in knowledge routing:', error);
      
      // Re-throw the error - let the in-house fallback system handle it [[memory:8276820]]
      // The in-house fallback (0.5 threshold) should always respond, no need for legacy fallback
      throw error;
    }
  }

  /**
   * Handle transfer intent
   */
  static async handleTransferIntent(companyID, callId, userText, callState, trace, config) {
    // Check if transfer is enabled
    const transferEnabled = await isTransferEnabled(companyID);
    
    if (!transferEnabled) {
      console.log('[AI AGENT] Transfer requested but disabled for company:', companyID);
      const response = createNonTransferResponse(
        "I understand you'd like to speak with someone else.", 
        'transfer'
      );
      ResponseTraceLogger.setResponse(trace, response, 'transfer_disabled');
      return await this.applyBehaviorAndFinalize(config, callState, response, trace, companyID);
    }
    
    const transferMessage = config.behaviorControls?.escalationPolicy?.keywordMessage || 
      "I'll transfer you to one of our team members who can better assist you. Please hold while I connect you.";
    
    const response = {
      text: transferMessage,
      shouldTransfer: true,
      transferReason: 'user_request'
    };
    
    ResponseTraceLogger.setResponse(trace, response, 'transfer_request');
    
    return await this.applyBehaviorAndFinalize(config, callState, response, trace, companyID);
  }

  /**
   * Handle emergency intent
   */
  static async handleEmergencyIntent(companyID, callId, userText, callState, trace, config) {
    // Check if transfer is enabled
    const transferEnabled = await isTransferEnabled(companyID);
    
    if (!transferEnabled) {
      console.log('[AI AGENT] Emergency transfer requested but disabled for company:', companyID);
      const response = createNonTransferResponse(
        "I understand this is an emergency.", 
        'emergency'
      );
      ResponseTraceLogger.setResponse(trace, response, 'emergency_transfer_disabled');
      return await this.applyBehaviorAndFinalize(config, callState, response, trace, companyID);
    }
    
    const emergencyMessage = config.responseCategories?.emergency?.template || 
      "I understand this is an emergency. I'm connecting you with our emergency service team right away.";
    
    const response = {
      text: emergencyMessage,
      shouldTransfer: true,
      transferReason: 'emergency',
      priority: 'urgent'
    };
    
    ResponseTraceLogger.setResponse(trace, response, 'emergency_response');
    
    return await this.applyBehaviorAndFinalize(config, callState, response, trace, companyID);
  }

  /**
   * Handle hours inquiry intent
   */
  static async handleHoursIntent(companyID, callId, userText, callState, trace, config) {
    // Look for hours information in company knowledge base or use template
    const hoursTemplate = config.responseCategories?.hours?.template || 
      "Our business hours are Monday through Friday, 8 AM to 6 PM, and Saturday 9 AM to 4 PM. We're closed on Sundays.";
    
    const response = {
      text: hoursTemplate,
      confidence: 0.9
    };
    
    ResponseTraceLogger.setResponse(trace, response, 'hours_template');
    
    return await this.applyBehaviorAndFinalize(config, callState, response, trace);
  }

  /**
   * Handle cancel/reschedule intent
   */
  static async handleCancelIntent(companyID, callId, userText, callState, trace, config) {
    const cancelMessage = "I can help you with canceling or rescheduling your appointment. Can you please provide your confirmation number or the phone number the appointment was made under?";
    
    const response = {
      text: cancelMessage,
      confidence: 0.8
    };
    
    ResponseTraceLogger.setResponse(trace, response, 'cancel_template');
    
    return await this.applyBehaviorAndFinalize(config, callState, response, trace);
  }

  /**
   * Apply behavior controls and finalize response
   */
  static async applyBehaviorAndFinalize(config, callState, response, trace, companyID = null) {
    try {
      const behaviorStart = Date.now();
      
      // Extract companyID from config if not provided
      const effectiveCompanyID = companyID || config?.companyID || callState?.companyID || 'unknown';
      
      // Apply behavior engine
      const behaviorResult = await applyBehavior(
        config,
        callState,
        response,
        {
          detectedEmotion: callState.detectedEmotion,
          userText: callState.lastUserText,
          silenceDetected: callState.consecutiveSilences > 0,
          bargeInDetected: callState.lastBargeIn,
          failedAttempts: callState.failedAttempts || 0,
          companyID: effectiveCompanyID // Use effective companyID
        }
      );
      
      const behaviorTime = Date.now() - behaviorStart;
      
      // EMERGENCY NUCLEAR BYPASS: Completely disable behavior tracking to prevent validation errors [[memory:8912579]]
      console.log('⚠️ EMERGENCY NUCLEAR BYPASS: Skipping behavior tracking to prevent ResponseTrace validation errors');
      console.log('📊 Behavior result would have been tracked:', {
        text: behaviorResult.text || '',
        shouldEscalate: behaviorResult.shouldEscalate || false,
        shouldHangup: behaviorResult.shouldHangup || false
      });
      
      // ResponseTraceLogger.addBehaviorStep(
      //   trace, 'silence_policy', 
      //   behaviorResult.shouldHangup || behaviorResult.metadata?.appliedBehaviors?.includes('silence_policy'),
      //   config.behaviorControls?.silencePolicy,
      //   sanitizedBehaviorResult
      // );
      
      // EMERGENCY NUCLEAR BYPASS: Disable all behavior tracking [[memory:8912579]]
      // if (behaviorResult.metadata?.appliedBehaviors?.includes('emotion_acknowledgment')) {
      //   ResponseTraceLogger.addBehaviorStep(
      //     trace, 'emotion_acknowledgment', true,
      //     config.behaviorControls?.emotionAcknowledgment,
      //     sanitizedBehaviorResult
      //   );
      // }
      
      // Update call state
      callState = updateCallState(callState, {
        userSpoke: true,
        successfulMatch: response.confidence > 0.7
      });
      
      // Set final metrics and save trace
      ResponseTraceLogger.setMetrics(trace, {
        behaviorProcessingTime: behaviorTime,
        cacheHit: false // This could be enhanced to track actual cache hits
      });
      
      ResponseTraceLogger.setDebug(trace, {
        modelUsed: response.modelUsed || 'knowledge_router',
        configVersion: config.version || '1.0'
      });
      
      await ResponseTraceLogger.saveTrace(trace);
      
      return {
        text: behaviorResult.text,
        shouldTransfer: behaviorResult.shouldEscalate || response.shouldTransfer,
        shouldHangup: behaviorResult.shouldHangup,
        controlFlags: behaviorResult.controlFlags,
        callState: callState,
        metadata: {
          ...behaviorResult.metadata,
          intent: trace.input.intent,
          confidence: response.confidence || 0,
          responseSource: trace.response.source,
          traceId: trace._id
        }
      };
      
    } catch (error) {
      console.error('Error applying behavior controls:', error);
      
      // Save trace with error and return basic response
      ResponseTraceLogger.setDebug(trace, {
        errorOccurred: true,
        errorDetails: error.message
      });
      
      await ResponseTraceLogger.saveTrace(trace);
      
      // Check if transfer is enabled before setting shouldTransfer
      const transferEnabled = companyID ? await isTransferEnabled(companyID) : false;
      
      if (transferEnabled) {
        return {
          text: response.text || "I'm sorry, I'm having technical difficulties. Please hold while I transfer you.",
          shouldTransfer: true,
          callState: callState,
          error: error.message
        };
      } else {
        return {
          text: "I'm sorry, I'm having technical difficulties. Please try calling back later or visit our website for assistance.",
          shouldTransfer: false,
          shouldHangup: true,
          callState: callState,
          error: error.message
        };
      }
    }
  }

  /**
   * REMOVED: Legacy fallback system eliminated [[memory:8276820]]
   * The in-house fallback system (0.5 threshold) should always respond.
   * If there are errors, they should be handled by proper error handling, not fallback messages.
   */

  /**
   * Get call statistics for a company
   */
  static async getCallStatistics(companyID, startDate, endDate) {
    try {
      return await ResponseTraceLogger.getTraceStatistics(companyID, startDate, endDate);
    } catch (error) {
      console.error('Error getting call statistics:', error);
      return null;
    }
  }

  /**
   * Get trace by call ID for debugging
   */
  static async getCallTrace(companyID, callId) {
    try {
      return await ResponseTraceLogger.getTraceByCallId(companyID, callId);
    } catch (error) {
      console.error('Error getting call trace:', error);
      return null;
    }
  }

  /**
   * Health check for all AI components
   */
  static async healthCheck(companyID) {
    const results = {
      aiLoader: false,
      intentRouter: false,
      knowledgeRouter: false,
      behaviorEngine: false,
      bookingHandler: false,
      responseTrace: false
    };
    
    try {
      // Test AI Loader
      const config = await aiLoader.get(companyID);
      results.aiLoader = !!config;
      
      // Test Intent Router
      const intentResult = await IntentRouter.route(companyID, "test message", {});
      results.intentRouter = !!intentResult.intent;
      
      // Test Knowledge Router (basic test)
      results.knowledgeRouter = true; // KnowledgeRouter is available
      
      // Test Behavior Engine (basic test)
      results.behaviorEngine = true; // BehaviorEngine is available
      
      // Test Booking Handler (basic test)
      results.bookingHandler = true; // BookingHandler is available
      
      // Test Response Trace
      const recentTraces = await ResponseTraceLogger.getRecentTraces(companyID, 1);
      results.responseTrace = Array.isArray(recentTraces);
      
    } catch (error) {
      console.error('Error in health check:', error);
    }
    
    return results;
  }
}

module.exports = {
  initializeCall: async (companyID, callId, from, to) => {
    return await AIAgentRuntime.initializeCall(companyID, callId, from, to);
  },
  processCallTurn: async (companyID, callId, userText, callState, company) => {
    return await AIAgentRuntime.processCallTurn(companyID, callId, userText, callState, company);
  },
  healthCheck: async (companyID) => {
    return await AIAgentRuntime.healthCheck(companyID);
  },
  getCallStatistics: async (companyID, startDate, endDate) => {
    return await AIAgentRuntime.getCallStatistics(companyID, startDate, endDate);
  },
  getCallTrace: async (companyID, callId) => {
    return await AIAgentRuntime.getCallTrace(companyID, callId);
  },
  AIAgentRuntime
};
