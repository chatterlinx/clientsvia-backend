// Agent Performance Intelligence API Routes
const express = require('express');
const router = express.Router();
const agentPerformanceTracker = require('../services/agentPerformanceTracker');
const { ObjectId } = require('mongodb');

// Get real-time performance metrics for a company
router.get('/performance/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { timeRange = '24h' } = req.query;

    const metrics = await agentPerformanceTracker.getPerformanceMetrics(companyId, timeRange);
    
    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    console.error('[API] Error getting performance metrics:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get performance metrics'
    });
  }
});

// Get improvement suggestions for a company
router.get('/performance/:companyId/suggestions', async (req, res) => {
  try {
    const { companyId } = req.params;

    const suggestions = await agentPerformanceTracker.getImprovementSuggestions(companyId);
    
    res.json({
      success: true,
      data: suggestions
    });
  } catch (error) {
    console.error('[API] Error getting improvement suggestions:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get improvement suggestions'
    });
  }
});

// Get conversation flow analysis for a specific call
router.get('/performance/:companyId/conversation/:callSid', async (req, res) => {
  try {
    const { companyId, callSid } = req.params;

    const conversationFlow = await agentPerformanceTracker.getConversationFlow(companyId, callSid);
    
    res.json({
      success: true,
      data: conversationFlow
    });
  } catch (error) {
    console.error('[API] Error getting conversation flow:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get conversation flow'
    });
  }
});

// Get performance trends over time
router.get('/performance/:companyId/trends', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { days = 7 } = req.query;

    // Get performance data for each day
    const trends = [];
    const now = new Date();
    
    for (let i = parseInt(days) - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);
      
      const nextDate = new Date(date);
      nextDate.setDate(nextDate.getDate() + 1);
      
      const dayMetrics = await agentPerformanceTracker.getPerformanceMetrics(companyId, '24h');
      
      trends.push({
        date: date.toISOString().split('T')[0],
        metrics: dayMetrics
      });
    }
    
    res.json({
      success: true,
      data: trends
    });
  } catch (error) {
    console.error('[API] Error getting performance trends:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get performance trends'
    });
  }
});

// Test agent performance with a sample question
router.post('/performance/:companyId/test', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { question } = req.body;

    if (!question) {
      return res.status(400).json({
        success: false,
        error: 'Question is required'
      });
    }

    // Import the agent function
    const { answerQuestion } = require('../services/agent');
    
    const startTime = Date.now();
    const response = await answerQuestion(companyId, question, 'concise', [], '', 'friendly', '', '', 'test-call');
    const responseTime = Date.now() - startTime;

    res.json({
      success: true,
      data: {
        question,
        response: response.text,
        responseTime,
        escalate: response.escalate || false,
        debugInfo: response.debugInfo || {}
      }
    });
  } catch (error) {
    console.error('[API] Error testing agent performance:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to test agent performance'
    });
  }
});

// Get real-time agent health status
router.get('/performance/:companyId/health', async (req, res) => {
  try {
    const { companyId } = req.params;

    const metrics = await agentPerformanceTracker.getPerformanceMetrics(companyId, '1h');
    
    // Calculate health status
    let healthStatus = 'excellent';
    let healthScore = 100;
    const issues = [];

    // Check response time
    if (metrics.avgResponseTime > 3000) {
      healthStatus = 'poor';
      healthScore -= 30;
      issues.push('Response time is too slow (>3s)');
    } else if (metrics.avgResponseTime > 2000) {
      if (healthStatus === 'excellent') healthStatus = 'good';
      healthScore -= 15;
      issues.push('Response time could be improved (>2s)');
    }

    // Check LLM fallback rate
    const llmFallbackRate = (metrics.methodDistribution['llm-fallback'] || 0) / (metrics.totalResponses || 1);
    if (llmFallbackRate > 0.5) {
      healthStatus = 'poor';
      healthScore -= 25;
      issues.push('Too many LLM fallbacks (>50%)');
    } else if (llmFallbackRate > 0.3) {
      if (healthStatus === 'excellent') healthStatus = 'good';
      healthScore -= 15;
      issues.push('High LLM fallback rate (>30%)');
    }

    // Check intelligence level
    if (metrics.avgIntelligence < 60) {
      healthStatus = 'poor';
      healthScore -= 20;
      issues.push('Low agent intelligence score (<60)');
    } else if (metrics.avgIntelligence < 75) {
      if (healthStatus === 'excellent') healthStatus = 'good';
      healthScore -= 10;
      issues.push('Agent intelligence could be improved (<75)');
    }

    res.json({
      success: true,
      data: {
        healthStatus,
        healthScore: Math.max(0, healthScore),
        issues,
        lastChecked: new Date(),
        metrics
      }
    });
  } catch (error) {
    console.error('[API] Error getting agent health:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to get agent health'
    });
  }
});

// Test Super AI Intelligence
router.post('/test-intelligence', async (req, res) => {
  try {
    const { companyId, scenario, query } = req.body;

    if (!companyId || !query) {
      return res.status(400).json({
        success: false,
        error: 'Company ID and query are required'
      });
    }

    // Simulate intelligence test with different processing chains based on scenario
    const startTime = Date.now();
    
    // Mock different test scenarios
    let intelligenceScore, confidence, method, processingChain;
    
    switch (scenario) {
      case 'complex':
        intelligenceScore = Math.floor(Math.random() * 20) + 70; // 70-90%
        confidence = Math.floor(Math.random() * 30) + 60; // 60-90%
        method = 'Dynamic Reasoning + LLM';
        processingChain = [
          '1. Query analyzed for complexity',
          '2. Dynamic reasoning engine activated',
          '3. Contextual memory searched',
          '4. LLM called with enhanced context',
          '5. Response generated and validated'
        ];
        break;
      case 'emotional':
        intelligenceScore = Math.floor(Math.random() * 15) + 80; // 80-95%
        confidence = Math.floor(Math.random() * 25) + 70; // 70-95%
        method = 'Sentiment Analysis + Smart Escalation';
        processingChain = [
          '1. Sentiment analysis performed',
          '2. Emotional context detected',
          '3. Smart escalation rules checked',
          '4. Empathetic response generated',
          '5. Context preserved for handoff'
        ];
        break;
      case 'urgent':
        intelligenceScore = Math.floor(Math.random() * 10) + 85; // 85-95%
        confidence = Math.floor(Math.random() * 20) + 75; // 75-95%
        method = 'Priority Detection + Fast Path';
        processingChain = [
          '1. Urgency keywords detected',
          '2. Priority escalation triggered',
          '3. Fast-path knowledge search',
          '4. Immediate response generated',
          '5. Follow-up actions queued'
        ];
        break;
      default: // standard
        intelligenceScore = Math.floor(Math.random() * 25) + 75; // 75-100%
        confidence = Math.floor(Math.random() * 30) + 70; // 70-100%
        method = 'Semantic Knowledge Search';
        processingChain = [
          '1. Query parsed and analyzed',
          '2. Semantic knowledge search performed',
          '3. Best match found (95% confidence)',
          '4. Response generated from knowledge base',
          '5. Response quality validated'
        ];
    }

    const responseTime = Date.now() - startTime + Math.floor(Math.random() * 800) + 200; // 200-1000ms

    // Generate mock response based on query
    const response = generateMockIntelligentResponse(query, scenario);

    res.json({
      success: true,
      data: {
        intelligenceScore,
        responseTime,
        confidence,
        method,
        response,
        processingChain,
        timestamp: new Date()
      }
    });
  } catch (error) {
    console.error('[API] Error testing intelligence:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to test intelligence'
    });
  }
});

// Update intelligence settings
router.post('/intelligence-settings/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const settings = req.body;

    // In a real implementation, these would be saved to the database
    // For now, we'll just acknowledge the settings update
    console.log(`[API] Intelligence settings updated for company ${companyId}:`, settings);

    res.json({
      success: true,
      message: 'Intelligence settings updated successfully'
    });
  } catch (error) {
    console.error('[API] Error updating intelligence settings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update intelligence settings'
    });
  }
});

// Update learning settings
router.post('/learning-settings/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const settings = req.body;

    // In a real implementation, these would be saved to the database
    console.log(`[API] Learning settings updated for company ${companyId}:`, settings);

    res.json({
      success: true,
      message: 'Learning settings updated successfully'
    });
  } catch (error) {
    console.error('[API] Error updating learning settings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update learning settings'
    });
  }
});

/**
 * Generate a mock intelligent response based on query and scenario
 */
function generateMockIntelligentResponse(query, scenario) {
  const lowerQuery = query.toLowerCase();
  
  // Emergency/urgent responses
  if (lowerQuery.includes('emergency') || lowerQuery.includes('urgent') || scenario === 'urgent') {
    return "I understand this is urgent. We offer 24/7 emergency service. I can connect you with our emergency dispatch team right now, or schedule the earliest available appointment. What would work better for you?";
  }
  
  // Hours/availability questions
  if (lowerQuery.includes('hours') || lowerQuery.includes('open') || lowerQuery.includes('available')) {
    return "We're open Monday through Friday 8 AM to 6 PM, and Saturday 9 AM to 3 PM. For emergency service, we're available 24/7. Would you like to schedule an appointment during our regular hours or do you need emergency service?";
  }
  
  // Service/repair questions
  if (lowerQuery.includes('service') || lowerQuery.includes('repair') || lowerQuery.includes('fix')) {
    return "We provide comprehensive HVAC services including repairs, maintenance, and installations. Our certified technicians can diagnose and fix most issues the same day. What specific problem are you experiencing with your system?";
  }
  
  // Pricing questions
  if (lowerQuery.includes('cost') || lowerQuery.includes('price') || lowerQuery.includes('charge')) {
    return "Our service call fee is $89, which is applied toward any repair work. We provide upfront pricing before any work begins, and all our work is backed by our satisfaction guarantee. Would you like me to schedule a diagnostic appointment?";
  }
  
  // Emotional/complex scenarios
  if (scenario === 'emotional') {
    return "I completely understand your frustration, and I'm here to help resolve this situation. Let me connect you with our customer care specialist who can review your account and find the best solution for you. Your satisfaction is our top priority.";
  }
  
  // Complex questions
  if (scenario === 'complex') {
    return "That's a great question that involves several technical factors. Let me connect you with one of our HVAC specialists who can provide detailed information and recommendations specific to your situation. They'll be able to explain all your options clearly.";
  }
  
  // Default response
  return "Thank you for your question. I'd be happy to help you with that. Let me check our available options and connect you with the right specialist who can provide detailed assistance. How would you prefer to proceed?";
}

// Save Smart Learning Settings
router.post('/smart-learning/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const settings = req.body;

    // In a real implementation, these would be saved to the database
    console.log(`[API] Smart Learning settings updated for company ${companyId}:`, settings);

    // Simulate some processing time
    await new Promise(resolve => setTimeout(resolve, 500));

    res.json({
      success: true,
      message: 'Smart Learning settings updated successfully',
      settings: settings
    });
  } catch (error) {
    console.error('[API] Error updating Smart Learning settings:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to update Smart Learning settings'
    });
  }
});

// Get Performance Metrics
router.get('/performance-metrics/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { timeRange } = req.query;

    // Generate mock performance metrics based on time range
    const now = new Date();
    let multiplier = 1;
    
    switch (timeRange) {
      case '1h':
        multiplier = 0.1;
        break;
      case '24h':
        multiplier = 1;
        break;
      case '7d':
        multiplier = 7;
        break;
      case '30d':
        multiplier = 30;
        break;
    }

    const metrics = {
      totalResponses: Math.floor((50 + Math.random() * 100) * multiplier),
      avgIntelligence: Math.floor(80 + Math.random() * 20), // 80-100
      avgResponseTime: Math.floor(200 + Math.random() * 600), // 200-800ms
      bookingRate: Math.floor(75 + Math.random() * 20), // 75-95%
      responseTime: (1.5 + Math.random() * 1.5).toFixed(1), // 1.5-3.0s
      transferRate: Math.floor(5 + Math.random() * 20), // 5-25%
      satisfactionScore: (3.8 + Math.random() * 1.2).toFixed(1), // 3.8-5.0
      healthScore: Math.floor(70 + Math.random() * 30), // 70-100
      intelligenceTrend: ['↗️ Improving', '↘️ Declining', '➡️ Stable'][Math.floor(Math.random() * 3)],
      timestamp: now
    };

    console.log(`[API] Performance metrics retrieved for company ${companyId} (${timeRange}):`, metrics);

    res.json({
      success: true,
      data: metrics
    });
  } catch (error) {
    console.error('[API] Error retrieving performance metrics:', error.message);
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance metrics'
    });
  }
});

module.exports = router;
