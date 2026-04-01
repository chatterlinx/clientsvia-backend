'use strict';

/**
 * ============================================================================
 * ADMIN — LAP KEYWORD GROUPS  (GlobalShare)
 * ============================================================================
 *
 * PURPOSE:
 *   Manage the SYSTEM-LEVEL keyword lists for ListenerActParser groups.
 *   These keywords are global — every company inherits them.
 *   Companies add their own keywords on top via /api/company/:id/lap-config.
 *
 * AUTH:   authenticateJWT  (admin access)
 *
 * ROUTES:
 *   GET  /api/admin/globalshare/lap-groups
 *   PATCH /api/admin/globalshare/lap-groups/:groupId/keywords
 *
 * ============================================================================
 */

const express          = require('express');
const router           = express.Router();
const logger           = require('../../utils/logger');
const AdminSettings    = require('../../models/AdminSettings');
const GlobalHubService = require('../../services/GlobalHubService');
const LAPService       = require('../../services/engine/lap/LAPService');
const { authenticateJWT } = require('../../middleware/auth');

router.use(authenticateJWT);

// ── GET /api/admin/globalshare/lap-groups ─────────────────────────────────────
// Returns all system LAP groups with keyword counts and defaults.
// Used by GlobalShare.html LAP section.
router.get('/', async (req, res) => {
  try {
    const groups = await GlobalHubService.getLapGroups();
    res.json({
      groups: groups.map(g => ({
        id:                    g.id,
        name:                  g.name,
        action:                g.action,
        systemKeywords:        g.systemKeywords || [],
        keywordCount:          (g.systemKeywords || []).length,
        defaultClosedQuestion: g.defaultClosedQuestion,
        defaultHoldConfig:     g.defaultHoldConfig || null,
      }))
    });
  } catch (err) {
    logger.error('[LAP ADMIN] GET lap-groups failed', { error: err.message });
    res.status(500).json({ error: 'Failed to load LAP groups' });
  }
});

// ── PATCH /api/admin/globalshare/lap-groups/:groupId/keywords ─────────────────
// Replace the systemKeywords for a specific group.
// Normalizes: lowercase, trim, deduplicate, filter empty.
// Saves to MongoDB + syncs to Redis + invalidates all company caches.
router.patch('/:groupId/keywords', async (req, res) => {
  const { groupId } = req.params;
  const { keywords } = req.body;

  if (!Array.isArray(keywords)) {
    return res.status(400).json({ error: 'keywords must be an array of strings' });
  }

  try {
    // Normalize: lowercase, trim, dedup, filter empty
    const clean = [...new Set(
      keywords.map(k => (k || '').toLowerCase().trim()).filter(Boolean)
    )];

    // Load current groups
    const groups = await GlobalHubService.getLapGroups();
    const idx = groups.findIndex(g => g.id === groupId);
    if (idx === -1) {
      return res.status(404).json({ error: `LAP group '${groupId}' not found` });
    }

    // Update keywords
    groups[idx] = { ...groups[idx], systemKeywords: clean };

    // Save to MongoDB
    await AdminSettings.findOneAndUpdate(
      {},
      {
        $set: {
          'globalHub.lapGroups':           groups,
          'globalHub.lapGroupsUpdatedAt':  new Date(),
          'globalHub.lapGroupsUpdatedBy':  req.user?.email || 'admin',
        }
      },
      { upsert: true, runValidators: false }
    );

    // Sync to Redis
    await GlobalHubService.syncLapGroupsToRedis(groups);

    // Invalidate all company merged-group caches (system keywords changed)
    await LAPService.invalidateAll();

    logger.info('[LAP ADMIN] Keywords updated', {
      groupId,
      count: clean.length,
      by:    req.user?.email
    });

    res.json({
      success:        true,
      groupId,
      keywordCount:   clean.length,
      systemKeywords: clean,
    });

  } catch (err) {
    logger.error('[LAP ADMIN] PATCH keywords failed', { groupId, error: err.message });
    res.status(500).json({ error: 'Failed to update LAP group keywords' });
  }
});

module.exports = router;
