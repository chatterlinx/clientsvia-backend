// examples/agent-route-integration.js
// Example of how to integrate behaviorMiddleware into your existing agent routes

const express = require('express');
const { behaviorMiddleware } = require('../middleware/behaviorMiddleware');
const { evaluateBehavior, createBehaviorContext } = require('../utils/behaviorRules');

const router = express.Router();

/**
 * OPTION 1: Use as Express middleware (recommended)
 * This automatically handles behavioral triggers before normal processing
 */
router.post('/agent/:companyId/voice', 
  behaviorMiddleware,  // <-- Add this line to your existing route
  async (req, res) => {
    // Your existing agent logic continues here
    // behaviorMiddleware will handle escalations/special cases
    // and only pass through normal conversations
    
    const { transcript, companyProfile, session } = req.body;
    
    // Your normal AI agent processing...
    const aiResponse = await processWithOpenAI(transcript, companyProfile);
    
    res.send({
      actions: [
        { say: { text: aiResponse } }
      ]
    });
  }
);

/**
 * OPTION 2: Manual integration within your existing route
 * Use this if you need more control over the behavior evaluation
 */
router.post('/agent/:companyId/voice-manual', async (req, res) => {
  try {
    const { transcript, companyProfile, session = {} } = req.body;
    
    // Check for behavioral triggers first
    const behaviorContext = createBehaviorContext(session);
    const behaviorResult = evaluateBehavior({
      transcript,
      companyProfile,
      context: behaviorContext
    });
    
    // Handle special behavioral cases
    switch (behaviorResult.action) {
      case "escalate_to_service_advisor":
        return res.send({
          actions: [
            { say: { text: behaviorResult.message } },
            { connect: { endpoint: { type: 'phone', number: companyProfile.serviceAdvisorNumber } } }
          ]
        });
        
      case "humanize_response":
        session.robotDetectionCount = (session.robotDetectionCount || 0) + 1;
        return res.send({
          actions: [
            { say: { text: behaviorResult.message, voice: 'alice', rate: '95%' } }
          ]
        });
        
      case "handle_silence":
        session.silenceCount = behaviorResult.silenceCount;
        return res.send({
          actions: [
            { say: { text: behaviorResult.message } }
          ]
        });
    }
    
    // Continue with normal AI processing if no behavioral override
    const aiResponse = await processWithOpenAI(transcript, companyProfile);
    
    res.send({
      actions: [
        { say: { text: aiResponse } }
      ]
    });
    
  } catch (error) {
    console.error('Agent route error:', error);
    res.status(500).send({ error: 'Internal server error' });
  }
});

/**
 * OPTION 3: Company-specific behavior enabling
 * Only enable behavior engine for specific companies (like Penguin Air)
 */
router.post('/agent/:companyId/voice-selective', async (req, res) => {
  const { companyId } = req.params;
  const { transcript, companyProfile, session = {} } = req.body;
  
  // Enable behavior engine only for Penguin Air
  if (companyId === '686a680241806a4991f7367f') {
    // Use behavior middleware for Penguin Air
    const behaviorContext = createBehaviorContext(session);
    const behaviorResult = evaluateBehavior({
      transcript,
      companyProfile,
      context: behaviorContext
    });
    
    if (behaviorResult.action !== "continue_normal_flow") {
      // Handle special behavior
      return handleBehaviorAction(behaviorResult, res, session, companyProfile);
    }
  }
  
  // Continue with normal processing for all other companies
  const aiResponse = await processWithOpenAI(transcript, companyProfile);
  res.send({
    actions: [{ say: { text: aiResponse } }]
  });
});

/**
 * Helper function to handle different behavioral actions
 */
function handleBehaviorAction(behaviorResult, res, session, companyProfile) {
  const { action, message, priority } = behaviorResult;
  
  switch (action) {
    case "escalate_to_service_advisor":
      return res.send({
        actions: [
          { say: { text: message } },
          { connect: { endpoint: { type: 'phone', number: companyProfile.serviceAdvisorNumber || '+18885551234' } } }
        ]
      });
      
    case "humanize_response":
      session.robotDetectionCount = (session.robotDetectionCount || 0) + 1;
      return res.send({
        actions: [
          { say: { text: message, voice: 'alice', rate: '95%' } }
        ]
      });
      
    case "confirm_technician_request":
      session.requestedTechnician = behaviorResult.technician;
      return res.send({
        actions: [
          { say: { text: message } }
        ]
      });
      
    case "handle_silence":
      session.silenceCount = behaviorResult.silenceCount;
      return res.send({
        actions: [
          { say: { text: message } }
        ]
      });
      
    case "after_hours_message":
      return res.send({
        actions: [
          { say: { text: message } }
        ]
      });
      
    default:
      return res.send({
        actions: [
          { say: { text: message || "I'm here to help. How can I assist you?" } }
        ]
      });
  }
}

/**
 * Mock function - replace with your actual AI processing
 */
async function processWithOpenAI(transcript, companyProfile) {
  // Your existing OpenAI/Gemini processing logic
  return "Thank you for calling " + companyProfile.name + ". How can I help you today?";
}

/**
 * Testing endpoint to verify behavior rules
 */
router.get('/test-behavior/:companyId', async (req, res) => {
  const { companyId } = req.params;
  const { transcript = "Are you a robot?" } = req.query;
  
  try {
    // Mock company profile for testing
    const mockCompany = {
      _id: companyId,
      name: "Test Company",
      behaviorRules: {
        escalationTriggers: ["robot", "human", "frustrated"],
        technicianNames: ["Dustin", "Marcello"],
        silenceLimitSeconds: 2
      }
    };
    
    const behaviorContext = createBehaviorContext({});
    const result = evaluateBehavior({
      transcript,
      companyProfile: mockCompany,
      context: behaviorContext
    });
    
    res.json({
      input: transcript,
      result,
      companyId,
      timestamp: new Date().toISOString()
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
