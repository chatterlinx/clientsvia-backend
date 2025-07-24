// routes/company/agentSettings.js - Enterprise AI Agent Configuration API
// Updated for deployment test
const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');
const TradeCategory = require('../../models/TradeCategory');

// 🚀 Save AI Agent Intelligence Settings
router.post('/companies/:id/agent-settings', async (req, res) => {
  try {
    const { tradeCategories = [], agentIntelligenceSettings = {} } = req.body;
    const companyId = req.params.id;

    // Validate trade categories exist
    if (tradeCategories.length > 0) {
      const validCategories = await TradeCategory.find({ name: { $in: tradeCategories } });
      const validCategoryNames = validCategories.map(cat => cat.name);
      
      // Filter out invalid categories
      const filteredCategories = tradeCategories.filter(cat => validCategoryNames.includes(cat));
      
      if (filteredCategories.length !== tradeCategories.length) {
        console.warn(`Some trade categories were invalid for company ${companyId}`);
      }
    }

    // Validate agent settings
    const validatedSettings = {
      useLLM: agentIntelligenceSettings.useLLM !== undefined ? agentIntelligenceSettings.useLLM : true,
      llmModel: agentIntelligenceSettings.llmModel || 'ollama-phi3',
      memoryMode: ['short', 'conversation'].includes(agentIntelligenceSettings.memoryMode) 
        ? agentIntelligenceSettings.memoryMode : 'short',
      fallbackThreshold: Math.min(Math.max(agentIntelligenceSettings.fallbackThreshold || 0.5, 0), 1),
      escalationMode: ['ask', 'auto'].includes(agentIntelligenceSettings.escalationMode) 
        ? agentIntelligenceSettings.escalationMode : 'ask',
      rePromptAfterTurns: Math.min(Math.max(agentIntelligenceSettings.rePromptAfterTurns || 3, 1), 10),
      maxPromptsPerCall: Math.min(Math.max(agentIntelligenceSettings.maxPromptsPerCall || 2, 1), 10)
    };

    // Update company with validated data
    const company = await Company.findByIdAndUpdate(
      companyId,
      { 
        tradeCategories, 
        agentIntelligenceSettings: validatedSettings,
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    );

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Log the update for audit trail
    console.log(`✅ Agent settings updated for company ${company.companyName} (${companyId}):`, {
      tradeCategories: tradeCategories.length,
      llmModel: validatedSettings.llmModel,
      useLLM: validatedSettings.useLLM
    });

    res.json({ 
      success: true, 
      company: {
        _id: company._id,
        companyName: company.companyName,
        tradeCategories: company.tradeCategories,
        agentIntelligenceSettings: company.agentIntelligenceSettings
      }
    });

  } catch (err) {
    console.error('❌ Error saving agent settings:', err);
    res.status(500).json({ 
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

// 🔍 Get AI Agent Settings
router.get('/companies/:id/agent-settings', async (req, res) => {
  try {
    const company = await Company.findById(req.params.id)
      .select('companyName tradeCategories agentIntelligenceSettings agentSettings');

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Merge legacy and new settings for backward compatibility
    const settings = {
      ...company.agentSettings, // Legacy settings
      ...company.agentIntelligenceSettings // New intelligence settings
    };

    res.json({
      success: true,
      company: {
        _id: company._id,
        companyName: company.companyName,
        tradeCategories: company.tradeCategories || [],
        agentIntelligenceSettings: settings
      }
    });

  } catch (err) {
    console.error('❌ Error fetching agent settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 📊 Get Available Trade Categories
router.get('/trade-categories', async (req, res) => {
  try {
    const categories = await TradeCategory.find({ isActive: true })
      .select('name description serviceTypes')
      .sort({ name: 1 });

    res.json(categories);

  } catch (err) {
    console.error('❌ Error fetching trade categories:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 🧠 Test AI Agent Configuration
router.post('/companies/:id/test-agent', async (req, res) => {
  try {
    const { testMessage } = req.body;
    const companyId = req.params.id;

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Mock AI response based on current settings
    const settings = company.agentIntelligenceSettings || {};
    const mockResponse = {
      message: testMessage,
      processedWith: {
        llmModel: settings.llmModel || 'ollama-phi3',
        useLLM: settings.useLLM !== false,
        memoryMode: settings.memoryMode || 'short',
        fallbackThreshold: settings.fallbackThreshold || 0.5
      },
      confidence: Math.random() * 0.4 + 0.6, // Mock confidence between 0.6-1.0
      response: `Mock AI response using ${settings.llmModel || 'ollama-phi3'} model with ${settings.memoryMode || 'short'} memory mode.`,
      timestamp: new Date().toISOString()
    };

    res.json({
      success: true,
      test: mockResponse
    });

  } catch (err) {
    console.error('❌ Error testing agent:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;
