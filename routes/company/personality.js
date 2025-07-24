// routes/company/personality.js - Agent Personality Settings API
const express = require('express');
const router = express.Router();
const Company = require('../../models/Company');

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

module.exports = router;
