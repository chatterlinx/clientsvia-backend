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

module.exports = router;
