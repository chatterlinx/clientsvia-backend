// routes/company/personality.js - Agent Personality Settings API
const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');
const { defaultResponses } = require('../../utils/personalityResponses_enhanced');

console.log('✅ Agent Personality routes loading...');

/**
 * @route   GET /api/company/companies/:id/personality
 * @desc    Get company agent personality settings
 * @access  Private (per company)
 */
router.get('/companies/:id/personality', async (req, res) => {
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
    
    console.log(`✅ Personality settings loaded for ${company.companyName}`);
    res.json(personalitySettings);
  } catch (error) {
    console.error('❌ Error fetching personality settings:', error);
    res.status(500).json({ error: 'Failed to fetch personality settings' });
  }
});

/**
 * @route   PUT /api/company/companies/:id/personality
 * @desc    Save company agent personality settings
 * @access  Private (per company)
 */
router.put('/companies/:id/personality', async (req, res) => {
  try {
    const {
      voiceTone,
      speechPace,
      bargeInMode,
      acknowledgeEmotion,
      useEmojis
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
 * @route   GET /api/company/companies/:id/personality/responses
 * @desc    Get company agent personality response categories
 * @access  Private (per company)
 */
router.get('/companies/:id/personality/responses', async (req, res) => {
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
 * @route   PUT /api/company/companies/:id/personality/responses
 * @desc    Save company agent personality response categories
 * @access  Private (per company)
 */
router.put('/companies/:id/personality/responses', async (req, res) => {
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
