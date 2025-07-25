// routes/agentSettings.js - Enterprise AI Agent Settings API
const express = require('express');
const router = express.Router();
const Company = require('../models/Company');

console.log('✅ Agent Settings routes loading...');

// Get company agent settings (multi-tenant)
router.get('/companies/:companyId/agent-settings', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    console.log(`🏢 [Agent Settings] Loading settings for companyId: ${companyId}`);
    
    // Find company by MongoDB _id using Mongoose findById
    const company = await Company.findById(companyId);
    
    if (!company) {
      console.log(`❌ [Agent Settings] Company not found: ${companyId}`);
      return res.status(404).json({ error: 'Company not found' });
    }

    const response = {
      companyId: company._id.toString(), // Use MongoDB _id as companyId
      companyName: company.companyName,
      // Multi-tenant: Each company selects from global trade categories
      tradeCategories: company.tradeCategories || [],
      agentSettings: company.agentSettings || {
        useLLM: true,
        llmModel: 'ollama-mistral',
        memoryMode: 'short',
        fallbackThreshold: 0.5,
        escalationMode: 'ask',
        rePromptAfterTurns: 3,
        maxPromptsPerCall: 2,
        firstPromptSoft: true,
        semanticSearchEnabled: true,
        confidenceScoring: true,
        autoLearningQueue: true
      },
      bookingFlow: company.bookingFlow || [],
      personnel: company.personnel || [],
      calendars: company.calendars || [],
      messageTemplates: company.messageTemplates || {
        bookingConfirmation: {
          sms: "You're booked for {{time}} at {{companyName}}.",
          email: "Hi {{name}}, your booking is confirmed for {{time}}."
        },
        fallbackMessage: {
          sms: "Message from customer: {{message}}",
          email: "Customer message: {{message}}"
        }
      }
    };

    console.log(`✅ [Agent Settings] Loaded settings for ${company.companyName} (${companyId})`);
    res.json(response);
  } catch (error) {
    console.error('❌ [Agent Settings] Error fetching agent settings:', error);
    res.status(500).json({ error: 'Failed to fetch agent settings' });
  }
});

// Save company agent settings (multi-tenant)
router.post('/companies/:companyId/agent-settings', async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      tradeCategories = [],
      agentSettings = {},
      bookingFlow = [],
      personnel = [],
      calendars = [],
      messageTemplates = {}
    } = req.body;

    console.log(`🏢 [Agent Settings] Saving settings for companyId: ${companyId}`);
    console.log(`📋 Selected trade categories: ${tradeCategories.join(', ')}`);

    // Validate agent settings with enterprise-grade validation
    const validatedSettings = {
      useLLM: agentSettings.useLLM !== undefined ? Boolean(agentSettings.useLLM) : true,
      llmModel: agentSettings.llmModel || 'ollama-mistral',
      memoryMode: ['short', 'conversation'].includes(agentSettings.memoryMode) ? agentSettings.memoryMode : 'short',
      fallbackThreshold: Math.max(0, Math.min(1, parseFloat(agentSettings.fallbackThreshold) || 0.5)),
      escalationMode: ['ask', 'auto'].includes(agentSettings.escalationMode) ? agentSettings.escalationMode : 'ask',
      rePromptAfterTurns: Math.max(1, Math.min(10, parseInt(agentSettings.rePromptAfterTurns) || 3)),
      maxPromptsPerCall: Math.max(1, Math.min(10, parseInt(agentSettings.maxPromptsPerCall) || 2)),
      firstPromptSoft: agentSettings.firstPromptSoft !== undefined ? Boolean(agentSettings.firstPromptSoft) : true,
      semanticSearchEnabled: agentSettings.semanticSearchEnabled !== undefined ? Boolean(agentSettings.semanticSearchEnabled) : true,
      confidenceScoring: agentSettings.confidenceScoring !== undefined ? Boolean(agentSettings.confidenceScoring) : true,
      autoLearningQueue: agentSettings.autoLearningQueue !== undefined ? Boolean(agentSettings.autoLearningQueue) : true
    };

    // Multi-tenant update: Update specific company by MongoDB _id
    const company = await Company.findByIdAndUpdate(
      companyId,
      {
        tradeCategories,
        agentSettings: validatedSettings,
        bookingFlow,
        personnel,
        calendars,
        messageTemplates,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    );

    if (!company) {
      console.log(`❌ [Agent Settings] Company not found: ${companyId}`);
      return res.status(404).json({ error: 'Company not found' });
    }

    console.log(`✅ [Agent Settings] Settings saved for ${company.companyName} (${companyId})`);
    
    res.json({ 
      success: true, 
      message: 'AI Agent settings saved successfully',
      company: {
        companyId: company._id.toString(), // Use MongoDB _id as companyId
        companyName: company.companyName,
        tradeCategories: company.tradeCategories,
        agentSettings: company.agentSettings
      }
    });

  } catch (error) {
    console.error('❌ [Agent Settings] Error saving agent settings:', error);
    res.status(500).json({ 
      error: 'Failed to save agent settings',
      details: error.message 
    });
  }
});

// Test agent configuration
router.post('/companies/:companyId/test-agent', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { testMessage } = req.body;

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Simulate agent response based on settings
    const settings = company.agentSettings || {};
    const response = {
      message: testMessage,
      usedLLM: settings.useLLM,
      model: settings.llmModel,
      confidence: Math.random() * (1 - settings.fallbackThreshold) + settings.fallbackThreshold,
      memoryMode: settings.memoryMode,
      escalationTriggered: Math.random() < 0.1, // 10% chance for demo
      responseTime: Math.random() * 2 + 0.5, // 0.5-2.5 seconds
      timestamp: new Date()
    };

    res.json(response);
  } catch (error) {
    console.error('Error testing agent:', error);
    res.status(500).json({ error: 'Failed to test agent configuration' });
  }
});

// Get agent performance analytics
router.get('/companies/:companyId/agent-analytics', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { days = 7 } = req.query;

    // Mock analytics data - replace with real analytics service
    const analytics = {
      companyId,
      period: `${days} days`,
      metrics: {
        totalInteractions: Math.floor(Math.random() * 1000) + 100,
        averageConfidence: Math.random() * 0.3 + 0.7, // 0.7-1.0
        escalationRate: Math.random() * 0.1 + 0.05, // 5-15%
        responseTime: Math.random() * 1 + 1.5, // 1.5-2.5 seconds
        bookingConversionRate: Math.random() * 0.2 + 0.6, // 60-80%
        customerSatisfactionScore: Math.random() * 1 + 4, // 4-5 stars
      },
      topQuestions: [
        { question: "What are your hours?", frequency: 45, confidence: 0.95 },
        { question: "How much does it cost?", frequency: 32, confidence: 0.87 },
        { question: "Can I book an appointment?", frequency: 28, confidence: 0.92 },
        { question: "Where are you located?", frequency: 22, confidence: 0.98 },
        { question: "What services do you offer?", frequency: 18, confidence: 0.89 }
      ],
      performanceTrend: Array.from({ length: parseInt(days) }, (_, i) => ({
        date: new Date(Date.now() - (parseInt(days) - i - 1) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        interactions: Math.floor(Math.random() * 50) + 20,
        avgConfidence: Math.random() * 0.2 + 0.8,
        escalations: Math.floor(Math.random() * 5) + 1
      }))
    };

    res.json(analytics);
  } catch (error) {
    console.error('Error fetching agent analytics:', error);
    res.status(500).json({ error: 'Failed to fetch agent analytics' });
  }
});

console.log('✅ Agent Settings routes loaded successfully');
module.exports = router;
