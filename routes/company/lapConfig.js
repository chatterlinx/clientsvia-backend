'use strict';

/**
 * ============================================================================
 * COMPANY — LAP CONFIG  (ListenerActParser per-company settings)
 * ============================================================================
 *
 * PURPOSE:
 *   Read and write per-company LAP configuration from UAP.html → LAP tab.
 *   Companies customise: responses, custom keywords, hold timers, enabled state.
 *   System keyword lists (globalHub.lapGroups) are read-only here — admin-managed.
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
const GlobalHubService = require('../../services/GlobalHubService');
const LAPService       = require('../../services/engine/lap/LAPService');
const { authenticateJWT, requireCompanyAccess } = require('../../middleware/auth');

router.use(authenticateJWT);
router.use(requireCompanyAccess);

// ── GET /api/company/:companyId/lap-config ────────────────────────────────────
// Returns company lapConfig + read-only globalGroups (system keywords).
// If company has no lapConfig yet, seeds defaults from globalHub.lapGroups.
router.get('/', async (req, res) => {
  const { companyId } = req.params;
  try {
    const [company, systemGroups] = await Promise.all([
      Company.findById(companyId).select('lapConfig').lean(),
      GlobalHubService.getLapGroups(),
    ]);

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    // If lapConfig not yet saved, build defaults from system groups
    let lapConfig = company.lapConfig;
    if (!lapConfig || !Array.isArray(lapConfig.groups) || lapConfig.groups.length === 0) {
      lapConfig = {
        enabled:    true,
        cooldownMs: 3000,
        groups: systemGroups.map(sg => ({
          groupId:        sg.id,
          isCustom:       false,
          name:           sg.name,
          enabled:        true,
          customKeywords: [],
          closedQuestion: sg.defaultClosedQuestion || '',
          holdConfig:     sg.defaultHoldConfig || null,
        })),
      };
    }

    res.json({
      enabled:      lapConfig.enabled    ?? true,
      cooldownMs:   lapConfig.cooldownMs ?? 3000,
      groups:       lapConfig.groups     || [],
      // Read-only system keyword lists — displayed as "Global defaults" in the UI
      globalGroups: systemGroups.map(sg => ({
        id:             sg.id,
        name:           sg.name,
        action:         sg.action,
        systemKeywords: sg.systemKeywords || [],
      })),
    });

  } catch (err) {
    logger.error('[LAP CONFIG] GET failed', { companyId, error: err.message });
    res.status(500).json({ error: 'Failed to load LAP config' });
  }
});

// ── PATCH /api/company/:companyId/lap-config ──────────────────────────────────
// Save company lapConfig. Validates structure, saves to MongoDB, clears Redis cache.
router.patch('/', async (req, res) => {
  const { companyId } = req.params;
  const { enabled, cooldownMs, groups } = req.body;

  try {
    // Basic validation
    if (typeof enabled !== 'undefined' && typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be boolean' });
    }
    if (typeof cooldownMs !== 'undefined' && (typeof cooldownMs !== 'number' || cooldownMs < 0)) {
      return res.status(400).json({ error: 'cooldownMs must be a non-negative number' });
    }
    if (groups !== undefined && !Array.isArray(groups)) {
      return res.status(400).json({ error: 'groups must be an array' });
    }

    // Sanitize groups
    const cleanGroups = (groups || []).map(g => ({
      groupId:        g.groupId  || null,
      isCustom:       Boolean(g.isCustom),
      name:           (g.name || '').trim(),
      enabled:        g.enabled !== false,
      customKeywords: (g.customKeywords || [])
                        .map(k => (k || '').toLowerCase().trim())
                        .filter(Boolean),
      closedQuestion: (g.closedQuestion || '').trim(),
      holdConfig:     g.holdConfig ? {
        maxHoldSeconds:      Number(g.holdConfig.maxHoldSeconds)      || 30,
        deadAirCheckSeconds: Number(g.holdConfig.deadAirCheckSeconds) || 8,
        deadAirPrompt:       (g.holdConfig.deadAirPrompt || '').trim(),
        resumeKeywords:      (g.holdConfig.resumeKeywords || [])
                               .map(k => (k || '').toLowerCase().trim())
                               .filter(Boolean),
      } : null,
    }));

    // Build update object (only include provided fields)
    const update = {};
    if (typeof enabled    !== 'undefined') update['lapConfig.enabled']    = enabled;
    if (typeof cooldownMs !== 'undefined') update['lapConfig.cooldownMs'] = cooldownMs;
    if (groups            !== undefined)   update['lapConfig.groups']     = cleanGroups;

    await Company.findByIdAndUpdate(
      companyId,
      { $set: update },
      { runValidators: false }
    );

    // Invalidate merged-group Redis cache for this company
    await LAPService.invalidate(companyId);

    logger.info('[LAP CONFIG] PATCH saved', {
      companyId,
      groupCount: cleanGroups.length,
      enabled,
      by: req.user?.email,
    });

    res.json({ success: true, lapConfig: { enabled, cooldownMs, groups: cleanGroups } });

  } catch (err) {
    logger.error('[LAP CONFIG] PATCH failed', { companyId, error: err.message });
    res.status(500).json({ error: 'Failed to save LAP config' });
  }
});

module.exports = router;
