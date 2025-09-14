// routes/company/agentSettings.js - Enterprise AI Agent Configuration API
// Updated for Answer Priority Flow support
const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');
const { getDB } = require('../../db');

// 🚀 Save AI Agent Intelligence Settings (Updated for Answer Priority Flow)
router.post('/companies/:id/agent-settings', async (req, res) => {
  try {
    const { 
      tradeCategories = [], 
      agentIntelligenceSettings = {},
      answerPriorityFlow = [],  // NEW: Answer Priority Flow data
      aiAgentLogic = {}  // NEW: Complete AI Agent Logic config
    } = req.body;
    const companyId = req.params.id;

    // Validate trade categories exist in enterprise system
    if (tradeCategories.length > 0) {
      const db = getDB();
      const enterpriseCategories = await db.collection('enterpriseTradeCategories')
        .find({ name: { $in: tradeCategories } })
        .toArray();
      
      const validCategoryNames = enterpriseCategories.map(cat => cat.name);
      
      // Filter out invalid categories
      const filteredCategories = tradeCategories.filter(cat => validCategoryNames.includes(cat));
      
      if (filteredCategories.length !== tradeCategories.length) {
        console.warn(`Some trade categories were invalid for company ${companyId}`);
      }
    }

    // Validate and process Answer Priority Flow data
    let validatedPriorityFlow = [];
    if (answerPriorityFlow && Array.isArray(answerPriorityFlow)) {
      validatedPriorityFlow = answerPriorityFlow.map((item, index) => ({
        id: item.id || `priority-${index}`,
        name: item.name || 'Unknown Source',
        description: item.description || '',
        active: Boolean(item.active !== undefined ? item.active : true),
        primary: Boolean(item.primary !== undefined ? item.primary : index === 0),
        priority: item.priority || index + 1,
        icon: item.icon || 'cog',
        category: item.category || 'other',
        confidenceThreshold: Math.min(Math.max(item.confidenceThreshold || 0.7, 0), 1),
        intelligenceLevel: ['high', 'medium', 'low', 'smart'].includes(item.intelligenceLevel) 
          ? item.intelligenceLevel : 'medium',
        performance: {
          successRate: item.performance?.successRate || 0,
          avgConfidence: item.performance?.avgConfidence || 0,
          usageCount: item.performance?.usageCount || 0
        }
      }));
      
      console.log(`✅ Validated Answer Priority Flow for company ${companyId}:`, validatedPriorityFlow.length, 'items');
    }

    // Validate agent settings
    const validatedSettings = {
      useLLM: agentIntelligenceSettings.useLLM !== undefined ? agentIntelligenceSettings.useLLM : true,
      llmModel: agentIntelligenceSettings.llmModel || 'gemini-pro',
      memoryMode: ['short', 'conversation'].includes(agentIntelligenceSettings.memoryMode) 
        ? agentIntelligenceSettings.memoryMode : 'short',
      fallbackThreshold: Math.min(Math.max(agentIntelligenceSettings.fallbackThreshold || 0.5, 0), 1),
      escalationMode: ['ask', 'auto'].includes(agentIntelligenceSettings.escalationMode) 
        ? agentIntelligenceSettings.escalationMode : 'ask',
      rePromptAfterTurns: Math.min(Math.max(agentIntelligenceSettings.rePromptAfterTurns || 3, 1), 10),
      maxPromptsPerCall: Math.min(Math.max(agentIntelligenceSettings.maxPromptsPerCall || 2, 1), 10),
      
      // 🧠 AI Intelligence Features
      contextualMemory: agentIntelligenceSettings.features?.contextualMemory !== undefined ? 
        agentIntelligenceSettings.features.contextualMemory : true,
      dynamicReasoning: agentIntelligenceSettings.features?.dynamicReasoning !== undefined ? 
        agentIntelligenceSettings.features.dynamicReasoning : true,
      smartEscalation: agentIntelligenceSettings.features?.smartEscalation !== undefined ? 
        agentIntelligenceSettings.features.smartEscalation : true,
      autoLearningQueue: agentIntelligenceSettings.features?.autoLearning !== undefined ? 
        agentIntelligenceSettings.features.autoLearning : true,
      realTimeOptimization: agentIntelligenceSettings.features?.realtimeOptimization !== undefined ? 
        agentIntelligenceSettings.features.realtimeOptimization : true,
      contextRetentionMinutes: Math.min(Math.max(agentIntelligenceSettings.contextRetention || 30, 5), 120)
    };

    // Update company with validated data
    const company = await Company.findByIdAndUpdate(
      companyId,
      { 
        tradeCategories, 
        agentIntelligenceSettings: validatedSettings,
        answerPriorityFlow: validatedPriorityFlow, // NEW: Save validated Answer Priority Flow
        aiAgentLogic, // NEW: Save AI Agent Logic config
        updatedAt: new Date()
      },
      { new: true, runValidators: true }
    );

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // 🔥 CRITICAL: Clear Redis cache after save to ensure fresh data on next load
    const { redisClient } = require('../../clients');
    const cacheKey = `company:${companyId}`;
    try {
      await redisClient.del(cacheKey);
      console.log(`🗑️ CACHE CLEARED: ${cacheKey} - Fresh aiAgentLogic will be loaded on next request`);
    } catch (cacheError) {
      console.warn(`⚠️ Cache clear failed for ${cacheKey}:`, cacheError.message);
    }

    // Log the update for audit trail  
    console.log(`✅ Agent settings updated for company ${company.companyName} (${companyId}):`, {
      tradeCategories: tradeCategories.length,
      llmModel: validatedSettings.llmModel,
      useLLM: validatedSettings.useLLM,
      aiAgentLogicSaved: !!company.aiAgentLogic // NEW: Confirm aiAgentLogic was saved
    });

    res.json({ 
      success: true, 
      company: {
        _id: company._id,
        companyName: company.companyName,
        tradeCategories: company.tradeCategories,
        agentIntelligenceSettings: company.agentIntelligenceSettings,
        answerPriorityFlow: company.answerPriorityFlow, // NEW: Include Answer Priority Flow in response
        aiAgentLogic: company.aiAgentLogic // NEW: Include AI Agent Logic in response for verification
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
      .select('companyName tradeCategories agentIntelligenceSettings agentSettings answerPriorityFlow aiAgentLogic');

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // Merge legacy and new settings for backward compatibility
    const settings = {
      ...company.agentSettings, // Legacy settings
      ...company.agentIntelligenceSettings // New intelligence settings
    };

    // 🔍 DEBUG: Log what we're returning for threshold debugging
    console.log('🔍 LOAD DEBUG - Company ID:', req.params.id);
    console.log('🔍 LOAD DEBUG - aiAgentLogic exists:', !!company.aiAgentLogic);
    console.log('🔍 LOAD DEBUG - aiAgentLogic.thresholds:', company.aiAgentLogic?.thresholds);
    
    res.json({
      success: true,
      company: {
        _id: company._id,
        companyName: company.companyName,
        tradeCategories: company.tradeCategories || [],
        agentIntelligenceSettings: settings,
        answerPriorityFlow: company.answerPriorityFlow || [],
        aiAgentLogic: company.aiAgentLogic || {}
      }
    });

  } catch (err) {
    console.error('❌ Error fetching agent settings:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 📊 Get Available Trade Categories (Enterprise System)
router.get('/trade-categories', async (req, res) => {
  try {
    const db = getDB();
    const categories = await db.collection('enterpriseTradeCategories')
      .find({})
      .project({ name: 1, description: 1, isActive: 1 })
      .sort({ name: 1 })
      .toArray();

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
        llmModel: settings.llmModel || 'gemini-pro',
        useLLM: settings.useLLM !== false,
        memoryMode: settings.memoryMode || 'short',
        fallbackThreshold: settings.fallbackThreshold || 0.5
      },
      confidence: Math.random() * 0.4 + 0.6, // Mock confidence between 0.6-1.0
      response: `Mock AI response using ${settings.llmModel || 'gemini-pro'} model with ${settings.memoryMode || 'short'} memory mode.`,
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

// 🧠 Save AI Intelligence Features Settings (specific endpoint)
router.post('/companies/:id/ai-intelligence-settings', async (req, res) => {
  try {
    const companyId = req.params.id;
    const { memoryMode, contextRetention, features } = req.body;

    console.log('📧 Saving AI Intelligence Settings for company:', companyId, { memoryMode, contextRetention, features });

    // Validate the settings
    const validatedSettings = {};
    
    if (memoryMode && ['short', 'conversational', 'persistent'].includes(memoryMode)) {
      validatedSettings.memoryMode = memoryMode;
    }
    
    if (contextRetention !== undefined) {
      validatedSettings.contextRetentionMinutes = Math.min(Math.max(parseInt(contextRetention), 5), 120);
    }
    
    if (features && typeof features === 'object') {
      if (features.contextualMemory !== undefined) {
        validatedSettings.contextualMemory = Boolean(features.contextualMemory);
      }
      if (features.dynamicReasoning !== undefined) {
        validatedSettings.dynamicReasoning = Boolean(features.dynamicReasoning);
      }
      if (features.smartEscalation !== undefined) {
        validatedSettings.smartEscalation = Boolean(features.smartEscalation);
      }
      if (features.autoLearning !== undefined) {
        validatedSettings.autoLearningQueue = Boolean(features.autoLearning);
      }
      if (features.realtimeOptimization !== undefined) {
        validatedSettings.realTimeOptimization = Boolean(features.realtimeOptimization);
      }
    }

    // Build the update object for nested agentIntelligenceSettings
    const updateObject = {};
    Object.keys(validatedSettings).forEach(key => {
      updateObject[`agentIntelligenceSettings.${key}`] = validatedSettings[key];
    });
    
    updateObject.updatedAt = new Date();

    // Update company
    const company = await Company.findByIdAndUpdate(
      companyId,
      updateObject,
      { new: true, runValidators: true }
    );

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    console.log('✅ AI Intelligence settings updated successfully:', validatedSettings);

    res.json({ 
      success: true, 
      message: 'AI Intelligence settings saved successfully',
      settings: validatedSettings,
      company: {
        _id: company._id,
        companyName: company.companyName,
        agentIntelligenceSettings: company.agentIntelligenceSettings
      }
    });

  } catch (err) {
    console.error('❌ Error saving AI Intelligence settings:', err);
    res.status(500).json({ 
      error: 'Failed to save AI Intelligence settings',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  }
});

module.exports = router;
