'use strict';

/**
 * ============================================================================
 * COMPANY — LAP CONFIG  (ListenerActParser per-company settings)
 * ============================================================================
 *
 * PURPOSE:
 *   Read and write per-company LAP settings: enabled toggle + cooldown.
 *   LAP phrases/responses are GLOBAL (AdminSettings.lapEntries).
 *   Audio is per-company (LAPResponseAudio model).
 *
 * AUTH:   authenticateJWT + requireCompanyAccess
 *
 * ROUTES:
 *   GET   /api/company/:companyId/lap-config
 *   PATCH /api/company/:companyId/lap-config
 *
 * ============================================================================
 */

const express          = require('express');
const router           = express.Router({ mergeParams: true });
const logger           = require('../../utils/logger');
const Company          = require('../../models/v2Company');
const LAPService       = require('../../services/engine/lap/LAPService');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');

router.use(authenticateJWT);
router.use(requireCompanyAccess);

// ── GET /api/company/:companyId/lap-config ────────────────────────────────────
// Returns company-level LAP toggle state.
router.get('/', async (req, res) => {
  const { companyId } = req.params;
  try {
    const company = await Company.findById(companyId).select('lapConfig').lean();
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const lapConfig = company.lapConfig || {};

    res.json({
      enabled:    lapConfig.enabled    ?? true,
      cooldownMs: lapConfig.cooldownMs ?? 3000,
    });

  } catch (err) {
    logger.error('[LAP CONFIG] GET failed', { companyId, error: err.message });
    res.status(500).json({ error: 'Failed to load LAP config' });
  }
});

// ── PATCH /api/company/:companyId/lap-config ──────────────────────────────────
// Save company LAP toggle. Only: enabled + cooldownMs.
router.patch('/', async (req, res) => {
  const { companyId } = req.params;
  const { enabled, cooldownMs } = req.body;

  try {
    if (typeof enabled !== 'undefined' && typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be boolean' });
    }
    if (typeof cooldownMs !== 'undefined' && (typeof cooldownMs !== 'number' || cooldownMs < 0)) {
      return res.status(400).json({ error: 'cooldownMs must be a non-negative number' });
    }

    const update = {};
    if (typeof enabled    !== 'undefined') update['lapConfig.enabled']    = enabled;
    if (typeof cooldownMs !== 'undefined') update['lapConfig.cooldownMs'] = cooldownMs;

    await Company.findByIdAndUpdate(
      companyId,
      { $set: update },
      { runValidators: false }
    );

    // Invalidate merged cache for this company
    await LAPService.invalidate(companyId);

    logger.info('[LAP CONFIG] PATCH saved', { companyId, enabled, cooldownMs, by: req.user?.email });
    res.json({ success: true, enabled, cooldownMs });

  } catch (err) {
    logger.error('[LAP CONFIG] PATCH failed', { companyId, error: err.message });
    res.status(500).json({ error: 'Failed to save LAP config' });
  }
});

module.exports = router;
