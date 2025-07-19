const express = require('express');
const router = express.Router();
const ollamaService = require('../services/ollamaService');
const { checkKBWithFallback } = require('../middleware/checkKBWithOllama');
const { testOllamaIntegration } = require('../test-ollama-integration');
const TraceLogger = require('../utils/traceLogger');

/**
 * Ollama Integration API Routes for Monitoring and Testing
 */

// GET /api/ollama/status - Check Ollama service status
router.get('/status', async (req, res) => {
  try {
    console.log('[API] Checking Ollama status...');
    
    const healthCheck = await ollamaService.checkHealth();
    const connectionTest = await ollamaService.testConnection();
    
    const status = {
      timestamp: new Date().toISOString(),
      service: {
        available: healthCheck,
        url: process.env.OLLAMA_API_URL || 'http://localhost:11434',
        configured_model: process.env.OLLAMA_MODEL || 'llama3.2:3b',
        timeout: process.env.OLLAMA_TIMEOUT || 30000
      },
      connection: connectionTest.success ? {
        success: true,
        available_models: connectionTest.available_models,
        test_generation_success: connectionTest.test_generation?.success || false
      } : {
        success: false,
        error: connectionTest.error
      },
      environment: {
        ollama_fallback_enabled: process.env.OLLAMA_FALLBACK_ENABLED === 'true',
        confidence_threshold: parseFloat(process.env.OLLAMA_CONFIDENCE_THRESHOLD) || 0.7
      }
    };
    
    res.json(status);
    
  } catch (error) {
    console.error('[API] Error checking Ollama status:', error);
    res.status(500).json({
      error: 'Failed to check Ollama status',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/ollama/test - Test Ollama generation with custom prompt
router.post('/test', async (req, res) => {
  try {
    const { prompt, options = {} } = req.body;
    
    if (!prompt) {
      return res.status(400).json({
        error: 'Missing required field: prompt'
      });
    }
    
    console.log(`[API] Testing Ollama generation with prompt: "${prompt.substring(0, 100)}..."`);
    
    const startTime = Date.now();
    const result = await ollamaService.generateResponse(prompt, options);
    const totalTime = Date.now() - startTime;
    
    res.json({
      timestamp: new Date().toISOString(),
      request: {
        prompt: prompt,
        options: options
      },
      result: {
        success: result.success,
        text: result.text,
        model: result.model,
        response_time_ms: result.responseTime,
        total_time_ms: totalTime,
        error: result.error || null
      }
    });
    
  } catch (error) {
    console.error('[API] Error testing Ollama generation:', error);
    res.status(500).json({
      error: 'Failed to test Ollama generation',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/ollama/agent-test - Test agent-specific response generation
router.post('/agent-test', async (req, res) => {
  try {
    const { 
      question, 
      company_name = 'Test Company',
      trade_category = 'general',
      personality = 'professional and helpful',
      conversation_history = []
    } = req.body;
    
    if (!question) {
      return res.status(400).json({
        error: 'Missing required field: question'
      });
    }
    
    console.log(`[API] Testing agent response for: "${question}"`);
    
    const context = {
      companyName: company_name,
      tradeCategory: trade_category,
      personality: personality,
      conversationHistory: conversation_history
    };
    
    const startTime = Date.now();
    const result = await ollamaService.generateAgentResponse(question, context);
    const totalTime = Date.now() - startTime;
    
    res.json({
      timestamp: new Date().toISOString(),
      request: {
        question: question,
        context: context
      },
      result: {
        success: result.success,
        text: result.text,
        model: result.model,
        response_time_ms: result.responseTime,
        total_time_ms: totalTime,
        error: result.error || null
      }
    });
    
  } catch (error) {
    console.error('[API] Error testing agent response:', error);
    res.status(500).json({
      error: 'Failed to test agent response',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// POST /api/ollama/kb-fallback-test - Test KB + Ollama fallback integration
router.post('/kb-fallback-test', async (req, res) => {
  try {
    const { 
      question, 
      company_id = 'test-company',
      company_data = {},
      fallback_enabled = true
    } = req.body;
    
    if (!question) {
      return res.status(400).json({
        error: 'Missing required field: question'
      });
    }
    
    console.log(`[API] Testing KB + Ollama fallback for: "${question}"`);
    
    // Mock company data if not provided
    const mockCompany = {
      _id: company_id,
      companyName: company_data.companyName || 'Test Company',
      tradeCategory: company_data.tradeCategory || 'general',
      aiSettings: {
        personality: company_data.personality || 'professional and helpful',
        ollamaFallbackEnabled: fallback_enabled,
        ...company_data.aiSettings
      },
      ...company_data
    };
    
    const traceLogger = new TraceLogger();
    const startTime = Date.now();
    
    const result = await checkKBWithFallback(question, company_id, traceLogger, {
      ollamaFallbackEnabled: fallback_enabled,
      company: mockCompany,
      conversationHistory: []
    });
    
    const totalTime = Date.now() - startTime;
    
    res.json({
      timestamp: new Date().toISOString(),
      request: {
        question: question,
        company_id: company_id,
        fallback_enabled: fallback_enabled
      },
      result: {
        answer: result.answer,
        source: result.source,
        confidence: result.confidence,
        fallback_used: result.fallbackUsed,
        response_time_ms: result.responseTime || null,
        total_time_ms: totalTime,
        trace: result.trace,
        error: result.error || null
      }
    });
    
  } catch (error) {
    console.error('[API] Error testing KB + Ollama fallback:', error);
    res.status(500).json({
      error: 'Failed to test KB + Ollama fallback',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/ollama/run-tests - Run the complete integration test suite
router.get('/run-tests', async (req, res) => {
  try {
    console.log('[API] Running complete Ollama integration test suite...');
    
    // Capture console output
    const originalLog = console.log;
    const logs = [];
    console.log = (...args) => {
      logs.push(args.join(' '));
      originalLog(...args);
    };
    
    const startTime = Date.now();
    
    try {
      await testOllamaIntegration();
      const totalTime = Date.now() - startTime;
      
      // Restore console.log
      console.log = originalLog;
      
      res.json({
        timestamp: new Date().toISOString(),
        test_suite: {
          completed: true,
          total_time_ms: totalTime,
          logs: logs
        }
      });
      
    } catch (testError) {
      // Restore console.log
      console.log = originalLog;
      
      res.status(500).json({
        timestamp: new Date().toISOString(),
        test_suite: {
          completed: false,
          error: testError.message,
          logs: logs
        }
      });
    }
    
  } catch (error) {
    console.error('[API] Error running test suite:', error);
    res.status(500).json({
      error: 'Failed to run test suite',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// GET /api/ollama/models - List available models
router.get('/models', async (req, res) => {
  try {
    console.log('[API] Fetching available Ollama models...');
    
    const axios = require('axios');
    const baseUrl = process.env.OLLAMA_API_URL || 'http://localhost:11434';
    
    const response = await axios.get(`${baseUrl}/api/tags`, {
      timeout: 5000
    });
    
    const models = response.data.models || [];
    
    res.json({
      timestamp: new Date().toISOString(),
      service_url: baseUrl,
      models: models.map(model => ({
        name: model.name,
        size_gb: (model.size / (1024 * 1024 * 1024)).toFixed(2),
        modified: model.modified,
        details: model.details
      })),
      configured_model: process.env.OLLAMA_MODEL || 'llama3.2:3b'
    });
    
  } catch (error) {
    console.error('[API] Error fetching models:', error);
    res.status(500).json({
      error: 'Failed to fetch models',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

module.exports = router;
