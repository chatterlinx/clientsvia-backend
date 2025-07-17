// middleware/behaviorMiddleware.js
// Real-time behavior processing middleware for AI agent calls

const { evaluateBehavior, createBehaviorContext } = require('../utils/behaviorRules');

/**
 * Behavior middleware that processes every user input for behavioral triggers
 * Integrates with Twilio call flow and agent responses
 */
const behaviorMiddleware = async (req, res, next) => {
  try {
    const { 
      transcript, 
      companyProfile, 
      session = {},
      callSid,
      from: phoneNumber 
    } = req.body;

    // Skip if no transcript or company profile
    if (!transcript || !companyProfile) {
      return next();
    }

    // Create behavior context from session data
    const behaviorContext = createBehaviorContext(session);
    
    // Evaluate behavioral triggers
    const behaviorResult = evaluateBehavior({
      transcript,
      detectedIntent: req.body.detectedIntent,
      companyProfile,
      context: behaviorContext
    });

    // Handle different behavioral actions
    switch (behaviorResult.action) {
      case "escalate_to_service_advisor":
        return handleEscalation(res, behaviorResult, companyProfile);
        
      case "humanize_response":
        return handleHumanizeResponse(res, behaviorResult, session);
        
      case "confirm_technician_request":
        return handleTechnicianConfirmation(res, behaviorResult, session);
        
      case "handle_silence":
        return handleSilenceResponse(res, behaviorResult, session);
        
      case "apologize_for_delay":
        return handleDelayApology(res, behaviorResult, session);
        
      case "after_hours_message":
        return handleAfterHours(res, behaviorResult, companyProfile);
        
      case "escalate_due_to_silence":
        return handleSilenceEscalation(res, behaviorResult, companyProfile);
        
      case "continue_normal_flow":
      default:
        // Continue to normal agent processing
        req.behaviorResult = behaviorResult;
        return next();
    }
    
  } catch (error) {
    console.error('Behavior middleware error:', error);
    // Continue to normal flow on error
    return next();
  }
};

/**
 * Handle escalation to human service advisor
 */
function handleEscalation(res, behaviorResult, companyProfile) {
  const transferNumber = companyProfile.serviceAdvisorNumber || companyProfile.mainPhone || '+18885551234';
  
  return res.send({
    actions: [
      { 
        say: { 
          text: behaviorResult.message 
        } 
      },
      { 
        connect: { 
          endpoint: { 
            type: 'phone', 
            number: transferNumber 
          } 
        } 
      }
    ]
  });
}

/**
 * Handle robot detection with humanizing response
 */
function handleHumanizeResponse(res, behaviorResult, session) {
  // Track robot detection attempts
  session.robotDetectionCount = (session.robotDetectionCount || 0) + 1;
  
  return res.send({
    actions: [
      { 
        say: { 
          text: behaviorResult.message,
          voice: 'alice', // Use more natural voice
          rate: '95%' // Slightly slower for more human feel
        } 
      }
    ]
  });
}

/**
 * Handle technician name confirmation
 */
function handleTechnicianConfirmation(res, behaviorResult, session) {
  session.requestedTechnician = behaviorResult.technician;
  
  return res.send({
    actions: [
      { 
        say: { 
          text: behaviorResult.message 
        } 
      }
    ]
  });
}

/**
 * Handle silence with progressive responses
 */
function handleSilenceResponse(res, behaviorResult, session) {
  session.silenceCount = behaviorResult.silenceCount;
  session.lastSilenceResponse = Date.now();
  
  return res.send({
    actions: [
      { 
        say: { 
          text: behaviorResult.message 
        } 
      }
    ]
  });
}

/**
 * Handle system delay apology
 */
function handleDelayApology(res, behaviorResult, session) {
  session.lastDelayApology = Date.now();
  
  return res.send({
    actions: [
      { 
        say: { 
          text: behaviorResult.message 
        } 
      }
    ]
  });
}

/**
 * Handle after hours messaging
 */
function handleAfterHours(res, behaviorResult, companyProfile) {
  return res.send({
    actions: [
      { 
        say: { 
          text: behaviorResult.message 
        } 
      }
    ]
  });
}

/**
 * Handle escalation due to excessive silence
 */
function handleSilenceEscalation(res, behaviorResult, companyProfile) {
  const transferNumber = companyProfile.serviceAdvisorNumber || companyProfile.mainPhone || '+18885551234';
  
  return res.send({
    actions: [
      { 
        say: { 
          text: behaviorResult.message 
        } 
      },
      { 
        connect: { 
          endpoint: { 
            type: 'phone', 
            number: transferNumber 
          } 
        } 
      }
    ]
  });
}

/**
 * Utility function to send simple text response
 */
function sendTextResponse(res, text, options = {}) {
  return res.send({
    actions: [
      { 
        say: { 
          text,
          ...options
        } 
      }
    ]
  });
}

/**
 * Log behavioral events for monitoring and improvement
 */
function logBehaviorEvent(eventType, data) {
  console.log(`[BEHAVIOR] ${eventType}:`, {
    timestamp: new Date().toISOString(),
    ...data
  });
}

module.exports = {
  behaviorMiddleware,
  handleEscalation,
  handleHumanizeResponse,
  sendTextResponse,
  logBehaviorEvent
};
