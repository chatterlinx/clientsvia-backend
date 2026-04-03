'use strict';

/**
 * Turn1Engine Config Routes
 *
 * GET  /company/:companyId/config  — read  aiAgentSettings.turn1
 * PATCH /company/:companyId/config — write aiAgentSettings.turn1
 *
 * Mounted at: /api/admin/turn1
 */

const express    = require('express');
const router     = express.Router();
const { ObjectId } = require('mongodb');

let Company;
try { Company = require('../../models/v2Company'); } catch (_) {}

const ALLOWED_FIELDS = [
  'enabled',
  'didntUnderstandText',
  'returningCallerEnabled',
  'historyDepthDays',
  'promptAudio',
];

// ── GET /api/admin/turn1/company/:companyId/config ────────────────────────────
router.get('/company/:companyId/config', async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!Company) return res.status(503).json({ error: 'Company model unavailable' });

    const company = await Company.findById(companyId)
      .select('aiAgentSettings.turn1')
      .lean();

    if (!company) return res.status(404).json({ error: 'Company not found' });

    const config = company?.aiAgentSettings?.turn1 || {};
    return res.json({ config });
  } catch (err) {
    console.error('[turn1Config] GET error', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ── PATCH /api/admin/turn1/company/:companyId/config ─────────────────────────
router.patch('/company/:companyId/config', async (req, res) => {
  try {
    const { companyId } = req.params;
    if (!Company) return res.status(503).json({ error: 'Company model unavailable' });

    const body = req.body || {};
    const $set = {};

    for (const field of ALLOWED_FIELDS) {
      if (Object.prototype.hasOwnProperty.call(body, field)) {
        $set[`aiAgentSettings.turn1.${field}`] = body[field];
      }
    }

    if (Object.keys($set).length === 0) {
      return res.status(400).json({ error: 'No valid fields provided' });
    }

    const updated = await Company.findByIdAndUpdate(
      companyId,
      { $set },
      { new: true, select: 'aiAgentSettings.turn1', lean: true }
    );

    if (!updated) return res.status(404).json({ error: 'Company not found' });

    return res.json({ ok: true, config: updated?.aiAgentSettings?.turn1 || {} });
  } catch (err) {
    console.error('[turn1Config] PATCH error', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
