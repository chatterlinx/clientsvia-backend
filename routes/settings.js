const express = require('express');
const router = express.Router();
const { auditLog } = require('../middleware/audit');

// Helper function to validate company exists
async function validateCompanyExists(companyId) {
  const Company = require('../models/Company');
  if (!companyId) {
    throw new Error('Company ID is required');
  }
  const company = await Company.findById(companyId);
  if (!company) {
    throw new Error('Company not found');
  }
  return company;
}

// GET /api/company/:companyId/settings - get company API settings
async function getAPISettings(req, res) {
  try {
    const company = await validateCompanyExists(req.params.companyId);
    
    // Return settings without exposing actual API keys (for security)
    const settings = {
      elevenLabs: {
        configured: !!(company.aiSettings?.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY),
        voiceId: company.aiSettings?.elevenLabsVoiceId || process.env.ELEVENLABS_VOICE_ID || null
      },
      baseUrl: process.env.API_BASE_URL || 'https://clientsvia-backend.onrender.com'
    };
    
    res.json(settings);
  } catch (err) {
    if (err.message === 'Company not found') {
      return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ message: 'Error fetching API settings', error: err.message });
  }
}

// PATCH /api/company/:companyId/settings - update company API settings
async function updateAPISettings(req, res) {
  try {
    const company = await validateCompanyExists(req.params.companyId);
    
    const { 
      elevenLabsApiKey, 
      elevenLabsVoiceId
    } = req.body;
    
    // Initialize aiSettings if it doesn't exist
    if (!company.aiSettings) {
      company.aiSettings = {};
    }
    
    // Update settings if provided
    if (elevenLabsApiKey !== undefined) {
      company.aiSettings.elevenLabsApiKey = elevenLabsApiKey;
    }
    if (elevenLabsVoiceId !== undefined) {
      company.aiSettings.elevenLabsVoiceId = elevenLabsVoiceId;
    }
    
    company.updatedAt = new Date();
    await company.save();
    
    auditLog('update API settings', req);
    
    // Return updated settings without exposing API keys
    const updatedSettings = {
      elevenLabs: {
        configured: !!(company.aiSettings.elevenLabsApiKey || process.env.ELEVENLABS_API_KEY),
        voiceId: company.aiSettings.elevenLabsVoiceId || process.env.ELEVENLABS_VOICE_ID || null
      },
      baseUrl: process.env.API_BASE_URL || 'https://clientsvia-backend.onrender.com'
    };
    
    res.json(updatedSettings);
  } catch (err) {
    if (err.message === 'Company not found') {
      return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ message: 'Error updating API settings', error: err.message });
  }
}

// GET /api/company/:companyId/agent-setup - get agent setup configuration
async function getAgentSetup(req, res) {
  try {
    const company = await validateCompanyExists(req.params.companyId);
    res.json(company.agentSetup || {});
  } catch (err) {
    if (err.message === 'Company not found') {
      return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ message: 'Error fetching agent setup', error: err.message });
  }
}

// PATCH /api/company/:companyId/agent-setup - update agent setup
async function updateAgentSetup(req, res) {
  try {
    const company = await validateCompanyExists(req.params.companyId);
    
    // Update agent setup with provided data
    company.agentSetup = {
      ...company.agentSetup,
      ...req.body,
      updatedAt: new Date()
    };
    
    company.updatedAt = new Date();
    await company.save();
    
    auditLog('update agent setup', req);
    res.json(company.agentSetup);
  } catch (err) {
    if (err.message === 'Company not found') {
      return res.status(404).json({ message: err.message });
    }
    res.status(500).json({ message: 'Error updating agent setup', error: err.message });
  }
}

// GET /api/global-settings - get global environment settings (admin only)
async function getGlobalSettings(req, res) {
  try {
    const settings = {
      apiBaseUrl: process.env.API_BASE_URL || 'https://clientsvia-backend.onrender.com',
      elevenLabsConfigured: !!process.env.ELEVENLABS_API_KEY,
      defaultVoiceSettings: {
        elevenLabsVoiceId: process.env.ELEVENLABS_VOICE_ID || null
      }
    };
    
    res.json(settings);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching global settings', error: err.message });
  }
}

// Routes
router.get('/:companyId/settings', getAPISettings);
router.patch('/:companyId/settings', updateAPISettings);
router.get('/:companyId/agent-setup', getAgentSetup);
router.patch('/:companyId/agent-setup', updateAgentSetup);
router.get('/global-settings', getGlobalSettings);

module.exports = router;
