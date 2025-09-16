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
    
    console.log(`✅ Personality settings loaded for ${company.companyName}`);
    res.json(personalitySettings);
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
      personalityResponses,
      state,
      updatedBy
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
      $set: {
        'agentPersonalitySettings.voiceTone': voiceTone || 'friendly',
        'agentPersonalitySettings.speechPace': speechPace || 'normal',
        'agentPersonalitySettings.bargeInMode': bargeInMode !== undefined ? Boolean(bargeInMode) : true,
        'agentPersonalitySettings.acknowledgeEmotion': acknowledgeEmotion !== undefined ? Boolean(acknowledgeEmotion) : true,
        'agentPersonalitySettings.useEmojis': useEmojis !== undefined ? Boolean(useEmojis) : false,
        'agentPersonalitySettings.updatedAt': new Date(),
        ...(state ? { 'agentPersonalitySettings.state': state } : {}),
        ...(updatedBy ? { 'agentPersonalitySettings.updatedBy': updatedBy } : {})
      }
    };

    // Add personality responses if provided
    if (personalityResponses) {
      personalityUpdate.$set['agentPersonalitySettings.responses'] = personalityResponses;
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
 * @route   POST /api/company/:id/personality/publish
 * @desc    Publish current personality settings (version bump + state)
 */
router.post('/:id/personality/publish', async (req, res) => {
  try {
    const { publishedBy } = req.body || {};
    const company = await Company.findById(req.params.id);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }
    if (!company.agentPersonalitySettings) {
      company.agentPersonalitySettings = {
        voiceTone: 'friendly',
        speechPace: 'normal',
        bargeInMode: true,
        acknowledgeEmotion: true,
        useEmojis: false
      };
    }
    company.agentPersonalitySettings.version = (company.agentPersonalitySettings.version || 1) + 1;
    company.agentPersonalitySettings.state = 'published';
    company.agentPersonalitySettings.publishedAt = new Date();
    company.agentPersonalitySettings.updatedAt = new Date();
    if (publishedBy) company.agentPersonalitySettings.updatedBy = publishedBy;
    await company.save();
    return res.json({
      success: true,
      message: 'Personality published',
      version: company.agentPersonalitySettings.version,
      state: company.agentPersonalitySettings.state,
      publishedAt: company.agentPersonalitySettings.publishedAt
    });
  } catch (error) {
    console.error('❌ Error publishing personality:', error);
    res.status(500).json({ error: 'Failed to publish personality' });
  }
});

/**
 * @route GET /api/company/:id/personality/meta
 * @desc  Get personality metadata and linkage
 */
router.get('/:id/personality/meta', async (req, res) => {
  try {
    const company = await Company.findById(req.params.id).lean();
    if (!company) return res.status(404).json({ error: 'Company not found' });
    const s = company.agentPersonalitySettings || {};
    return res.json({
      version: s.version || 1,
      state: s.state || 'draft',
      updatedAt: s.updatedAt || null,
      publishedAt: s.publishedAt || null,
      updatedBy: s.updatedBy || 'system',
      links: {
        knowledgeBase: '/api/knowledge/company/' + company._id + '/qnas',
        tradeQnA: '/api/knowledge/company/' + company._id + '/analytics',
        priorityFlow: '/api/ai-agent/logic/' + company._id
      }
    });
  } catch (error) {
    console.error('❌ Error fetching personality meta:', error);
    res.status(500).json({ error: 'Failed to fetch personality metadata' });
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
