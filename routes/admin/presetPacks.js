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


