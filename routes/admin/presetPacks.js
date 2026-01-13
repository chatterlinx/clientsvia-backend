/**
 * ============================================================================
 * PRESET PACKS API (Admin)
 * ============================================================================
 *
 * Read endpoints for UI to load versioned preset packs by tradeKey.
 * These packs are "UI-loaded defaults" and do NOT change runtime until saved.
 */

const express = require('express');
const router = express.Router();
const PresetPack = require('../../models/PresetPack');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const logger = require('../../utils/logger');
const { getDefaultPresetPacks } = require('../../config/presets/defaultPresetPacks');

router.use(authenticateJWT);
router.use(requireRole('admin', 'owner'));

function normalizeTradeKey(raw) {
  return String(raw || '').trim().toLowerCase();
}

/**
 * GET /api/admin/preset-packs?tradeKey=hvac
 * List published preset packs for a trade.
 */
router.get('/', async (req, res) => {
  try {
    const tradeKey = normalizeTradeKey(req.query.tradeKey);
    if (!tradeKey) {
      return res.status(400).json({ success: false, error: 'tradeKey is required' });
    }

    const packs = await PresetPack.find({ tradeKey, status: 'published' })
      .select('tradeKey packId version label description status updatedAt createdAt')
      .sort({ updatedAt: -1 })
      .lean();

    return res.json({ success: true, tradeKey, packs });
  } catch (err) {
    logger.error('[PRESET PACKS] List failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * POST /api/admin/preset-packs/seed-defaults?tradeKey=hvac
 *
 * Admin-only, idempotent seeding of default preset packs into the live DB.
 * - Creates missing packs (by unique key tradeKey+packId+version)
 * - Does NOT overwrite existing packs (even if draft/archived) unless we
 *   explicitly add a future "force" option.
 */
router.post('/seed-defaults', requireRole('admin'), async (req, res) => {
  try {
    const requestedTradeKey = normalizeTradeKey(req.query.tradeKey);
    const defaults = getDefaultPresetPacks();
    const candidates = requestedTradeKey
      ? defaults.filter(p => normalizeTradeKey(p.tradeKey) === requestedTradeKey)
      : defaults;

    if (requestedTradeKey && candidates.length === 0) {
      return res.status(404).json({
        success: false,
        error: `No default packs defined for tradeKey: ${requestedTradeKey}`
      });
    }

    const seeded = [];
    const skipped = [];

    for (const p of candidates) {
      const tradeKey = normalizeTradeKey(p.tradeKey);
      const packId = String(p.packId || '').trim();
      const version = String(p.version || '').trim();

      if (!tradeKey || !packId || !version) {
        skipped.push({ tradeKey, packId, version, reason: 'invalid_definition' });
        continue;
      }

      const existing = await PresetPack.findOne({ tradeKey, packId, version }).lean();
      if (existing) {
        skipped.push({
          tradeKey,
          packId,
          version,
          status: existing.status,
          reason: existing.status === 'published' ? 'already_published' : 'already_exists_non_published'
        });
        continue;
      }

      const createdBy = req.user?.email || req.user?._id?.toString?.() || 'admin';
      const doc = await PresetPack.create({
        ...p,
        tradeKey,
        packId,
        version,
        createdBy,
        updatedBy: createdBy
      });

      seeded.push({
        tradeKey: doc.tradeKey,
        packId: doc.packId,
        version: doc.version,
        status: doc.status
      });
    }

    logger.info('[PRESET PACKS] Seed defaults', {
      requestedTradeKey: requestedTradeKey || null,
      seededCount: seeded.length,
      skippedCount: skipped.length
    });

    return res.json({
      success: true,
      requestedTradeKey: requestedTradeKey || null,
      seeded,
      skipped
    });
  } catch (err) {
    logger.error('[PRESET PACKS] Seed defaults failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/admin/preset-packs/:tradeKey/:packId?version=v1
 * Get one preset pack (defaults to latest published version if version omitted).
 */
router.get('/:tradeKey/:packId', async (req, res) => {
  try {
    const tradeKey = normalizeTradeKey(req.params.tradeKey);
    const packId = (req.params.packId || '').trim();
    const version = (req.query.version || '').trim();

    if (!tradeKey || !packId) {
      return res.status(400).json({ success: false, error: 'tradeKey and packId are required' });
    }

    let pack = null;
    if (version) {
      pack = await PresetPack.findOne({ tradeKey, packId, version, status: 'published' }).lean();
    } else {
      pack = await PresetPack.findOne({ tradeKey, packId, status: 'published' })
        .sort({ updatedAt: -1 })
        .lean();
    }

    if (!pack) {
      return res.status(404).json({ success: false, error: 'Preset pack not found', tradeKey, packId, version: version || null });
    }

    return res.json({ success: true, pack });
  } catch (err) {
    logger.error('[PRESET PACKS] Get failed:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;


