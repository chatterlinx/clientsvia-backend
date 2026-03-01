// routes/admin/llmSettings.js
const express = require('express');
const router = express.Router();

const { getSettings, saveSettings, resetSettings } = require('../../services/llmSettingsService');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const {
  ARCHITECT_LLM_PROFILES,
  getScenarioPromptPartsFromSettings
} = require('../../config/llmScenarioPrompts');

router.use(authenticateJWT);
router.use(requireRole('admin'));

// GET current settings + prompt text for UI display
router.get('/', async (req, res, next) => {
  try {
    // Support company-scoped settings via query parameter
    // ?scope=company:12345 or ?scope=global
    const scope = req.query.scope || 'global';
    const settings = await getSettings(scope);
    
    // Get prompt parts so UI can display exactly what the LLM sees
    const promptParts = getScenarioPromptPartsFromSettings(settings);
    
    res.json({
      success: true,
      scope,
      settings,
      profiles: ARCHITECT_LLM_PROFILES, // Profile metadata for UI
      promptParts // Actual prompt text broken into parts
    });
  } catch (err) {
    next(err);
  }
});

// UPDATE settings (partial)
router.put('/', async (req, res, next) => {
  try {
    // Support company-scoped updates
    const { scope, settings: partial } = req.body;
    const scopeToUse = scope || 'global';
    
    const settings = await saveSettings(partial, scopeToUse);
    
    // Return updated prompt parts so UI shows live changes
    const promptParts = getScenarioPromptPartsFromSettings(settings);
    
    res.json({ 
      success: true,
      scope: scopeToUse,
      settings,
      profiles: ARCHITECT_LLM_PROFILES,
      promptParts
    });
  } catch (err) {
    next(err);
  }
});

// RESET settings
router.post('/reset', async (req, res, next) => {
  try {
    // Support company-scoped reset
    const { scope, section } = req.body;
    const scopeToUse = scope || 'global';
    const sectionToReset = section || 'all';
    
    const settings = await resetSettings(scopeToUse, sectionToReset);
    
    // Return updated prompt parts so UI shows defaults
    const promptParts = getScenarioPromptPartsFromSettings(settings);
    
    res.json({ 
      success: true,
      scope: scopeToUse,
      settings,
      profiles: ARCHITECT_LLM_PROFILES,
      promptParts
    });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

