// routes/company/personality.js - Agent Personality Settings API
const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');
const { defaultResponses } = require('../../utils/personalityResponses_enhanced');

console.log('✅ Agent Personality routes loading...');

/**
 * @route   GET /api/company/:id/personality
 * @desc    Get company agent personality settings and responses
 * @access  Private (per company)
 */
router.get('/:id/personality', async (req, res) => {
  try {
    const company = await Company.findById(req.params.id).lean();
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Return personality settings with defaults if not set
    const personalitySettings = company.agentPersonalitySettings || {
      voiceTone: 'friendly',
      speechPace: 'normal',
      bargeInMode: true,
      acknowledgeEmotion: true,
      useEmojis: false
    };
    
    // Return call transfer configuration with defaults if not set
    const callTransferConfig = company.aiAgentLogic?.callTransferConfig || {
      dialOutEnabled: false,
      dialOutNumber: null,
      transferMessage: 'Let me connect you with someone who can better assist you.'
    };
    
    console.log(`✅ Personality and transfer settings loaded for ${company.companyName}`);
    res.json({ 
      personalitySettings,
      callTransferConfig 
    });
  } catch (error) {
    console.error('❌ Error fetching personality settings:', error);
    res.status(500).json({ error: 'Failed to fetch personality settings' });
  }
});

/**
 * @route   PUT /api/company/:id/personality  
 * @desc    Save company agent personality settings and simple responses
 * @access  Private (per company)
 */
router.put('/:id/personality', async (req, res) => {
  try {
    const {
      voiceTone,
      speechPace,
      bargeInMode,
      acknowledgeEmotion,
      useEmojis,
      personalityResponses
    } = req.body;

    // Validate input
    const validTones = ['friendly', 'professional', 'playful'];
    const validPaces = ['slow', 'normal', 'fast'];
    
    if (voiceTone && !validTones.includes(voiceTone)) {
      return res.status(400).json({ error: 'Invalid voice tone' });
    }
    
    if (speechPace && !validPaces.includes(speechPace)) {
      return res.status(400).json({ error: 'Invalid speech pace' });
    }

    // Prepare update object
    const personalityUpdate = {
      agentPersonalitySettings: {
        voiceTone: voiceTone || 'friendly',
        speechPace: speechPace || 'normal',
        bargeInMode: bargeInMode !== undefined ? Boolean(bargeInMode) : true,
        acknowledgeEmotion: acknowledgeEmotion !== undefined ? Boolean(acknowledgeEmotion) : true,
        useEmojis: useEmojis !== undefined ? Boolean(useEmojis) : false
      }
    };

    // Add personality responses if provided
    if (personalityResponses) {
      personalityUpdate.agentPersonalitySettings.personalityResponses = personalityResponses;
    }

    const company = await Company.findByIdAndUpdate(
      req.params.id,
      personalityUpdate,
      { new: true }
    );

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    console.log(`✅ Personality settings saved for ${company.companyName}`);
    console.log(`🎭 Voice: ${personalityUpdate.agentPersonalitySettings.voiceTone}, Pace: ${personalityUpdate.agentPersonalitySettings.speechPace}`);
    
    res.json({ 
      success: true,
      message: 'Personality settings saved successfully',
      settings: company.agentPersonalitySettings
    });
  } catch (error) {
    console.error('❌ Error saving personality settings:', error);
    res.status(500).json({ error: 'Failed to save personality settings' });
  }
});

/**
 * @route   POST /api/company/:id/personality
 * @desc    Save company agent personality settings and call transfer configuration
 * @access  Private (per company)
 */
router.post('/:id/personality', async (req, res) => {
  try {
    const { personalitySettings, callTransferConfig } = req.body;
    
    // Find company
    const company = await Company.findById(req.params.id);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Initialize aiAgentLogic if it doesn't exist
    if (!company.aiAgentLogic) {
      company.aiAgentLogic = {
        enabled: true,
        version: 1,
        lastUpdated: new Date()
      };
    }
    
    // Update personality settings
    if (personalitySettings) {
      if (!company.agentPersonalitySettings) {
        company.agentPersonalitySettings = {};
      }
      
      Object.assign(company.agentPersonalitySettings, {
        voiceTone: personalitySettings.voiceTone || 'friendly',
        speechPace: personalitySettings.speechPace || 'normal',
        bargeInMode: personalitySettings.bargeIn !== undefined ? Boolean(personalitySettings.bargeIn) : true,
        acknowledgeEmotion: personalitySettings.acknowledgeEmotion !== undefined ? Boolean(personalitySettings.acknowledgeEmotion) : true,
        useEmojis: personalitySettings.useEmojis !== undefined ? Boolean(personalitySettings.useEmojis) : false
      });
    }
    
    // Update call transfer configuration
    if (callTransferConfig) {
      if (!company.aiAgentLogic.callTransferConfig) {
        company.aiAgentLogic.callTransferConfig = {};
      }
      
      Object.assign(company.aiAgentLogic.callTransferConfig, {
        dialOutEnabled: Boolean(callTransferConfig.dialOutEnabled),
        dialOutNumber: callTransferConfig.dialOutNumber ? callTransferConfig.dialOutNumber.trim() : null,
        transferMessage: callTransferConfig.transferMessage ? callTransferConfig.transferMessage.trim() : 'Let me connect you with someone who can better assist you.'
      });
      
      // Update lastUpdated timestamp
      company.aiAgentLogic.lastUpdated = new Date();
    }
    
    // Save changes
    await company.save();
    
    console.log(`✅ Personality and transfer settings saved for ${company.companyName}`);
    console.log(`📞 Transfer enabled: ${company.aiAgentLogic?.callTransferConfig?.dialOutEnabled}, Number: ${company.aiAgentLogic?.callTransferConfig?.dialOutNumber}`);
    
    res.json({ 
      success: true,
      message: 'Personality and transfer settings saved successfully',
      personalitySettings: company.agentPersonalitySettings,
      callTransferConfig: company.aiAgentLogic?.callTransferConfig
    });
  } catch (error) {
    console.error('❌ Error saving personality and transfer settings:', error);
    res.status(500).json({ error: 'Failed to save settings' });
  }
});

/**
 * @route   GET /api/company/:id/personality/responses
 * @desc    Get company agent personality response categories
 * @access  Private (per company)
 */
router.get('/:id/personality/responses', async (req, res) => {
  try {
    const company = await Company.findById(req.params.id).lean();
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Get custom responses or return an empty array if none exist
    let responses = [];
    
    if (company.agentPersonalitySettings && company.agentPersonalitySettings.responses) {
      responses = company.agentPersonalitySettings.responses;
    }
    
    // Get default responses for any categories that don't have custom ones
    const defaultCategories = Object.keys(defaultResponses).map(key => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
      description: '',
      defaultMessage: Array.isArray(defaultResponses[key]) ? defaultResponses[key][0] : '',
      customMessage: null,
      useCustom: false
    }));
    
    // Merge custom responses with defaults
    const responseCategories = [];
    defaultCategories.forEach(defCat => {
      const existingResponse = responses.find(r => r.key === defCat.key);
      if (existingResponse) {
        responseCategories.push(existingResponse);
      } else {
        responseCategories.push(defCat);
      }
    });
    
    console.log(`✅ Personality responses loaded for ${company.companyName}: ${responseCategories.length} categories`);
    res.json(responseCategories);
  } catch (error) {
    console.error('❌ Error fetching personality responses:', error);
    res.status(500).json({ error: 'Failed to fetch personality responses' });
  }
});

/**
 * @route   PUT /api/company/:id/personality/responses
 * @desc    Save company agent personality response categories
 * @access  Private (per company)
 */
router.put('/:id/personality/responses', async (req, res) => {
  try {
    const { responses } = req.body;
    
    if (!Array.isArray(responses)) {
      return res.status(400).json({ error: 'Responses must be an array' });
    }
    
    // Validate responses
    for (const response of responses) {
      if (!response.key || !response.label) {
        return res.status(400).json({ error: 'Each response must have a key and label' });
      }
    }
    
    // Find company and get existing personality settings
    const company = await Company.findById(req.params.id);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Initialize personality settings if they don't exist
    if (!company.agentPersonalitySettings) {
      company.agentPersonalitySettings = {
        voiceTone: 'friendly',
        speechPace: 'normal',
        bargeInMode: true,
        acknowledgeEmotion: true,
        useEmojis: false,
        responses: []
      };
    }
    
    // Update responses
    company.agentPersonalitySettings.responses = responses;
    
    // Save changes
    await company.save();
    
    console.log(`✅ Personality responses saved for ${company.companyName}: ${responses.length} categories`);
    
    res.json({ 
      success: true,
      message: 'Personality responses saved successfully',
      responses: company.agentPersonalitySettings.responses
    });
  } catch (error) {
    console.error('❌ Error saving personality responses:', error);
    res.status(500).json({ error: 'Failed to save personality responses' });
  }
});

/**
 * @route   POST /api/company/:id/personality-responses
 * @desc    Save company agent personality and response categories (new system)
 * @access  Private (per company)
 */
router.post('/:id/personality-responses', async (req, res) => {
  try {
    const { agentPersonality, responseCategories } = req.body;
    
    // Find company and get existing personality settings
    const company = await Company.findById(req.params.id);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Initialize personality settings if they don't exist
    if (!company.agentPersonalitySettings) {
      company.agentPersonalitySettings = {
        voiceTone: 'friendly',
        speechPace: 'normal',
        bargeInMode: true,
        acknowledgeEmotion: true,
        useEmojis: false
      };
    }
    
    // Update personality settings
    if (agentPersonality) {
      Object.assign(company.agentPersonalitySettings, agentPersonality);
    }
    
    // Update response categories
    if (responseCategories) {
      company.agentPersonalitySettings.responseCategories = responseCategories;
    }
    
    // Save changes
    await company.save();
    
    console.log(`✅ Advanced personality settings saved for ${company.companyName}`);
    
    res.json({ 
      success: true,
      message: 'Personality settings and response categories saved successfully',
      agentPersonalitySettings: company.agentPersonalitySettings
    });
  } catch (error) {
    console.error('❌ Error saving advanced personality settings:', error);
    res.status(500).json({ error: 'Failed to save personality settings' });
  }
});

/**
 * @route   GET /api/company/:id/personality-responses
 * @desc    Get company agent personality response categories (alternative endpoint)
 * @access  Private (per company)
 */
router.get('/:id/personality-responses', async (req, res) => {
  try {
    const company = await Company.findById(req.params.id).lean();
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Get custom responses or return an empty array if none exist
    let responses = [];
    
    if (company.agentPersonalitySettings && company.agentPersonalitySettings.responses) {
      responses = company.agentPersonalitySettings.responses;
    }
    
    // Get default responses for any categories that don't have custom ones
    const defaultCategories = Object.keys(defaultResponses).map(key => ({
      key,
      label: key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, ' $1'),
      description: '',
      defaultMessage: Array.isArray(defaultResponses[key]) ? defaultResponses[key][0] : '',
      customMessage: null,
      useCustom: false
    }));
    
    // Merge custom responses with defaults
    const responseCategories = [];
    defaultCategories.forEach(defCat => {
      const existingResponse = responses.find(r => r.key === defCat.key);
      if (existingResponse) {
        responseCategories.push(existingResponse);
      } else {
        responseCategories.push(defCat);
      }
    });
    
    console.log(`✅ Personality responses loaded for ${company.companyName}: ${responseCategories.length} categories`);
    res.json(responseCategories);
  } catch (error) {
    console.error('❌ Error fetching personality responses:', error);
    res.status(500).json({ error: 'Failed to fetch personality responses' });
  }
});

/**
 * @route   PUT /api/company/:id/personality-responses
 * @desc    Save company agent personality response categories (alternative endpoint)
 * @access  Private (per company)
 */
router.put('/:id/personality-responses', async (req, res) => {
  try {
    const { responses } = req.body;
    
    if (!Array.isArray(responses)) {
      return res.status(400).json({ error: 'Responses must be an array' });
    }
    
    // Validate responses
    for (const response of responses) {
      if (!response.key || !response.label) {
        return res.status(400).json({ error: 'Each response must have a key and label' });
      }
    }
    
    // Find company and get existing personality settings
    const company = await Company.findById(req.params.id);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    
    // Initialize personality settings if they don't exist
    if (!company.agentPersonalitySettings) {
      company.agentPersonalitySettings = {
        voiceTone: 'friendly',
        speechPace: 'normal',
        bargeInMode: true,
        acknowledgeEmotion: true,
        useEmojis: false,
        responses: []
      };
    }
    
    // Update responses
    company.agentPersonalitySettings.responses = responses;
    
    // Save changes
    await company.save();
    
    console.log(`✅ Personality responses saved for ${company.companyName}: ${responses.length} categories`);
    
    res.json({ 
      success: true,
      message: 'Personality responses saved successfully',
      responses: company.agentPersonalitySettings.responses
    });
  } catch (error) {
    console.error('❌ Error saving personality responses:', error);
    res.status(500).json({ error: 'Failed to save personality responses' });
  }
});

module.exports = router;
