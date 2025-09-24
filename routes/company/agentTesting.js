// routes/company/agentTesting.js - AI Agent Testing Console API
// Multi-tenant safe implementation with proper company isolation
const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Company = require('../../models/Company');
// Legacy personality system removed - using modern AI Agent Logic responseCategories

console.log('🧪 Agent Testing routes loading...');

/**
 * @route   POST /api/company/companies/:id/agent-test
 * @desc    Test AI agent response with full trace logging
 * @access  Private (per company - tenant isolated)
 */
router.post('/companies/:id/agent-test', async (req, res) => {
  try {
    const companyId = req.params.id;
    const { 
      message, 
      testType = 'full' // 'full', 'personality', 'knowledge'
    } = req.body;

    if (!message) {
      return res.status(400).json({ 
        error: 'Message is required',
        trace: []
      });
    }

    // Initialize trace log with company isolation
    const trace = [];
    const startTime = Date.now();
    const sessionId = `test-${companyId}-${Date.now()}`;

    trace.push({
      step: 1,
      action: 'test_started',
      timestamp: new Date().toISOString(),
      data: { companyId, message, testType, sessionId }
    });

    // Validate ObjectId format
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      trace.push({
        step: 2,
        action: 'invalid_company_id',
        timestamp: new Date().toISOString(),
        error: 'Invalid company ID format'
      });
      
      return res.status(400).json({ 
        error: 'Invalid company ID format',
        trace
      });
    }

    // Step 1: Load company data with tenant isolation
    const company = await Company.findById(companyId).lean();
    if (!company) {
      trace.push({
        step: 2,
        action: 'company_not_found',
        timestamp: new Date().toISOString(),
        error: 'Company not found'
      });
      
      return res.status(404).json({ 
        error: 'Company not found',
        trace
      });
    }

    trace.push({
      step: 2,
      action: 'company_loaded',
      timestamp: new Date().toISOString(),
      data: { 
        companyName: company.companyName,
        hasPersonalitySettings: !!company.agentPersonalitySettings,
        hasKnowledgeSettings: !!company.agentKnowledgeSettings
      }
    });

    // Step 2: Analyze message intent
    const intent = analyzeMessageIntent(message);
    trace.push({
      step: 3,
      action: 'intent_analyzed',
      timestamp: new Date().toISOString(),
      data: intent
    });

    // Step 3: Test personality response (company-specific)
    let personalityResponse = null;
    if (testType === 'full' || testType === 'personality') {
      personalityResponse = await testPersonalityResponse(companyId, intent.category, trace);
    }

    // Step 4: Test knowledge sources (company-specific)
    let knowledgeResponse = null;
    if (testType === 'full' || testType === 'knowledge') {
      knowledgeResponse = await testKnowledgeSources(companyId, message, company, trace);
    }

    // Step 5: Generate final response
    const finalResponse = generateTestResponse(
      message, 
      intent, 
      personalityResponse, 
      knowledgeResponse, 
      company,
      trace
    );

    const endTime = Date.now();
    const processingTime = endTime - startTime;

    trace.push({
      step: trace.length + 1,
      action: 'test_completed',
      timestamp: new Date().toISOString(),
      data: { 
        processingTime: `${processingTime}ms`,
        finalResponse: finalResponse.text
      }
    });

    res.json({
      success: true,
      response: finalResponse,
      trace,
      processingTime,
      metadata: {
        companyId,
        companyName: company.companyName,
        testType,
        sessionId,
        messageLength: message.length,
        traceSteps: trace.length
      }
    });

  } catch (error) {
    console.error('❌ Error in agent test:', error);
    res.status(500).json({ 
      error: 'Internal server error during agent test',
      trace: [{
        step: 'error',
        action: 'server_error',
        timestamp: new Date().toISOString(),
        error: error.message
      }]
    });
  }
});

/**
 * Analyze message to determine intent/category
 */
function analyzeMessageIntent(message) {
  const lowerMessage = message.toLowerCase();
  
  // Simple intent classification
  if (lowerMessage.includes('hello') || lowerMessage.includes('hi') || lowerMessage.includes('hey')) {
    return { category: 'greeting', confidence: 0.9, keywords: ['hello', 'hi', 'hey'] };
  }
  
  if (lowerMessage.includes('book') || lowerMessage.includes('schedule') || lowerMessage.includes('appointment')) {
    return { category: 'booking', confidence: 0.85, keywords: ['book', 'schedule', 'appointment'] };
  }
  
  if (lowerMessage.includes('price') || lowerMessage.includes('cost') || lowerMessage.includes('how much')) {
    return { category: 'pricing', confidence: 0.8, keywords: ['price', 'cost', 'how much'] };
  }
  
  if (lowerMessage.includes('hours') || lowerMessage.includes('open') || lowerMessage.includes('closed')) {
    return { category: 'businessHours', confidence: 0.8, keywords: ['hours', 'open', 'closed'] };
  }
  
  return { category: 'general', confidence: 0.5, keywords: [] };
}

/**
 * Test personality response generation (company-specific)
 */
async function testPersonalityResponse(companyId, category, trace) {
  try {
    // Legacy personality system removed - using modern AI Agent Logic responseCategories
    const response = 'Modern AI Agent Logic system active - legacy testing removed';
    
    trace.push({
      step: trace.length + 1,
      action: 'personality_response_generated',
      timestamp: new Date().toISOString(),
      data: { 
        category, 
        response,
        source: response ? 'company_specific' : 'default',
        companyId
      }
    });
    
    return response;
  } catch (error) {
    trace.push({
      step: trace.length + 1,
      action: 'personality_response_error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
    
    return null;
  }
}

/**
 * Test knowledge sources in priority order (company-specific)
 */
async function testKnowledgeSources(companyId, message, company, trace) {
  const knowledgeSettings = company.agentKnowledgeSettings;
  
  // 🚨 MULTI-TENANT COMPLIANCE: No hardcoded defaults - must be configured per company
  if (!knowledgeSettings?.sourcePriority) {
    console.warn(`⚠️ Company ${companyId} has no knowledge source priority configured. Please configure in AI Agent Logic tab.`);
    return { source: 'none', confidence: 0, answer: 'Configuration required' };
  }
  
  const priority = knowledgeSettings.sourcePriority;
  const confidenceThresholds = knowledgeSettings.confidenceThresholds;
  
  // Sort sources by priority
  const sortedSources = Object.entries(priority)
    .sort(([,a], [,b]) => a - b)
    .map(([source]) => source);
  
  trace.push({
    step: trace.length + 1,
    action: 'knowledge_sources_prioritized',
    timestamp: new Date().toISOString(),
    data: { 
      sortedSources,
      confidenceThresholds,
      companyId
    }
  });
  
  // Test each source in order (company-specific)
  for (const source of sortedSources) {
    const result = await testKnowledgeSource(source, message, companyId, confidenceThresholds[source], trace);
    
    if (result.confidence >= confidenceThresholds[source]) {
      trace.push({
        step: trace.length + 1,
        action: 'knowledge_source_selected',
        timestamp: new Date().toISOString(),
        data: { 
          selectedSource: source,
          confidence: result.confidence,
          answer: result.answer,
          companyId
        }
      });
      
      return result;
    }
  }
  
  // No good match found
  trace.push({
    step: trace.length + 1,
    action: 'no_knowledge_match_found',
    timestamp: new Date().toISOString(),
    data: { companyId }
  });
  
  return { source: 'none', confidence: 0, answer: null };
}

/**
 * Test individual knowledge source (company-specific)
 */
async function testKnowledgeSource(source, message, companyId, threshold, trace) {
  // Mock responses for testing (in production, these would call actual services)
  const mockResponses = {
    companyQnA: {
      confidence: Math.random() * 0.4 + 0.6, // 0.6-1.0
      answer: `[Company-specific] Answer for "${message}" from company ${companyId}`
    },
    tradeQnA: {
      confidence: Math.random() * 0.3 + 0.5, // 0.5-0.8
      answer: `[Trade category] Answer for "${message}"`
    },
    vectorSearch: {
      confidence: Math.random() * 0.4 + 0.3, // 0.3-0.7
      answer: `[Vector search] Result for "${message}"`
    },
    llmFallback: {
      confidence: Math.random() * 0.3 + 0.4, // 0.4-0.7
      answer: `[LLM fallback] Generated response for "${message}"`
    }
  };
  
  const result = mockResponses[source] || { confidence: 0, answer: null };
  
  trace.push({
    step: trace.length + 1,
    action: 'knowledge_source_tested',
    timestamp: new Date().toISOString(),
    data: { 
      source,
      confidence: result.confidence,
      threshold,
      passed: result.confidence >= threshold,
      answer: result.answer,
      companyId
    }
  });
  
  return { source, ...result };
}

/**
 * Generate final test response
 */
function generateTestResponse(message, intent, personalityResponse, knowledgeResponse, company, trace) {
  let responseText = '';
  let responseSource = [];
  
  // Add personality greeting if available
  if (personalityResponse && intent.category === 'greeting') {
    responseText += personalityResponse + ' ';
    responseSource.push('personality');
  }
  
  // Add knowledge response if available
  if (knowledgeResponse && knowledgeResponse.answer) {
    responseText += knowledgeResponse.answer;
    responseSource.push(knowledgeResponse.source);
  } else {
    // Fallback response
    responseText += `I understand you're asking about "${message}". Let me help you with that.`;
    responseSource.push('fallback');
  }
  
  trace.push({
    step: trace.length + 1,
    action: 'final_response_generated',
    timestamp: new Date().toISOString(),
    data: { 
      responseLength: responseText.length,
      sources: responseSource,
      hasPersonality: !!personalityResponse,
      hasKnowledge: !!(knowledgeResponse && knowledgeResponse.answer),
      companyId: company._id
    }
  });
  
  return {
    text: responseText.trim(),
    sources: responseSource,
    intent: intent,
    confidence: knowledgeResponse?.confidence || 0.5
  };
}

module.exports = router;
