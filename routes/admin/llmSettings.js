// routes/admin/llmSettings.js
const express = require('express');
const router = express.Router();

const { getSettings, saveSettings, resetSettings } = require('../../services/llmSettingsService');
const { authenticateJWT, requireRole } = require('../../middleware/auth');

router.use(authenticateJWT);
router.use(requireRole('admin'));

// GET current settings
router.get('/', async (req, res, next) => {
  try {
    const settings = await getSettings('global');
    res.json({ success: true, settings });
  } catch (err) {
    next(err);
  }
});

// UPDATE settings (partial)
router.put('/', async (req, res, next) => {
  try {
    const partial = req.body || {};
    const settings = await saveSettings(partial, 'global');
    res.json({ success: true, settings });
  } catch (err) {
    next(err);
  }
});

// RESET settings
router.post('/reset', async (req, res, next) => {
  try {
    const scope = 'global';
    const section = req.body?.scope || 'all';
    const settings = await resetSettings(scope, section);
    res.json({ success: true, settings });
  } catch (err) {
    next(err);
  }
});

module.exports = router;

