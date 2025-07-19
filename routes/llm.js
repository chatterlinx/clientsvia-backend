// API routes for Ollama LLM integration
// Add these routes to your existing Express app

const express = require('express');
const router = express.Router();
const localLLM = require('../services/localLLM');

/**
 * GET /api/llm/status
 * Check Ollama service and model status
 */
router.get('/status', async (req, res) => {
  try {
    const status = await localLLM.getStatus();
    res.json({
      success: true,
      ...status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/llm/query
 * Direct query to the local LLM (for testing)
 */
router.post('/query', async (req, res) => {
  try {
    const { prompt, context, systemPrompt, maxTokens } = req.body;
    
    if (!prompt) {
      return res.status(400).json({
        success: false,
        error: 'Prompt is required'
      });
    }

    const response = await localLLM.queryLLM(prompt, {
      context,
      systemPrompt,
      maxTokens
    });

    res.json({
      success: true,
      response,
      model: localLLM.model,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/llm/customer-service
 * Customer service specific LLM query
 */
router.post('/customer-service', async (req, res) => {
  try {
    const { query, companyId, conversationHistory } = req.body;
    
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query is required'
      });
    }

    // Get company context if companyId provided
    let companyContext = '';
    if (companyId) {
      const Company = require('../models/Company');
      const company = await Company.findById(companyId);
      
      if (company) {
        companyContext = `Company: ${company.name}
Business Type: ${company.businessType || 'Service Provider'}
Trade: ${company.tradeCategory || 'General Services'}`;
        
        if (company.aiSettings && company.aiSettings.companyDescription) {
          companyContext += `\nDescription: ${company.aiSettings.companyDescription}`;
        }
      }
    }

    const response = await localLLM.generateCustomerServiceResponse(
      query,
      companyContext,
      conversationHistory
    );

    res.json({
      success: true,
      response,
      companyId,
      model: localLLM.model,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/llm/models
 * List available models in Ollama
 */
router.get('/models', async (req, res) => {
  try {
    const axios = require('axios');
    const response = await axios.get(`${localLLM.ollamaUrl}/api/tags`);
    
    res.json({
      success: true,
      models: response.data.models || [],
      currentModel: localLLM.model
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;
