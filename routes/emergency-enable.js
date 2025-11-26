/**
 * EMERGENCY ROUTE: Enable AI Agent for Marc's company
 * This bypasses auth for emergency fixes only
 * DELETE THIS FILE after use
 */

const express = require('express');
const router = express.Router();
const Company = require('../models/v2Company');

// EMERGENCY ONLY - NO AUTH REQUIRED
router.post('/emergency-enable-agent/:secret', async (req, res) => {
  try {
    // Simple secret to prevent abuse
    if (req.params.secret !== 'nasa-shuttle-2500') {
      return res.status(403).json({ error: 'Invalid secret' });
    }

    const COMPANY_ID = '68e3f77a9d623b8058c700c4';
    
    const company = await Company.findById(COMPANY_ID);
    
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // FORCE ENABLE
    if (!company.aiAgentSettings) {
      company.aiAgentSettings = {};
    }
    
    const wasBefore = company.aiAgentSettings.enabled;
    company.aiAgentSettings.enabled = true;
    company.markModified('aiAgentSettings');
    await company.save();

    res.json({
      success: true,
      message: 'AI Agent ENABLED',
      before: wasBefore,
      after: company.aiAgentSettings.enabled,
      companyName: company.businessName || company.companyName
    });

  } catch (err) {
    console.error('Emergency enable failed:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

