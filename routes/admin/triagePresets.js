/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TRIAGE PRESETS API - Dynamic preset loading for LLM-A Builder
 * ═══════════════════════════════════════════════════════════════════════════
 * 
 * PURPOSE: Serve preset scenarios by trade for the AI Triage Builder UI
 * USAGE: Frontend calls these endpoints when trade dropdown changes
 * 
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const TriagePresetScenario = require('../../models/TriagePresetScenario');
const TradeDefinition = require('../../models/TradeDefinition');
const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/triage-presets/trades
// Returns list of available trades with their display names
// ═══════════════════════════════════════════════════════════════════════════

router.get('/trades', async (req, res) => {
  try {
    // Get trades from TradeDefinition model
    const trades = await TradeDefinition.find({ isActive: true })
      .select('tradeKey displayName description icon sortOrder')
      .sort({ sortOrder: 1, displayName: 1 })
      .lean();

    // If no trades in DB, return hardcoded defaults
    if (!trades || trades.length === 0) {
      return res.json({
        success: true,
        trades: getDefaultTrades()
      });
    }

    res.json({
      success: true,
      trades
    });
  } catch (error) {
    logger.error('[TRIAGE PRESETS] Error fetching trades:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch trades',
      trades: getDefaultTrades() // Fallback
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/triage-presets/:tradeKey
// Returns all presets for a specific trade, grouped by category
// ═══════════════════════════════════════════════════════════════════════════

router.get('/:tradeKey', async (req, res) => {
  try {
    const { tradeKey } = req.params;
    
    if (!tradeKey) {
      return res.status(400).json({
        success: false,
        error: 'tradeKey is required'
      });
    }

    // Fetch presets for this trade
    const presets = await TriagePresetScenario.find({
      tradeKey: tradeKey.toUpperCase(),
      isActive: true
    })
      .sort({ category: 1, sortOrder: 1, displayName: 1 })
      .lean();

    // Group by category
    const grouped = {};
    for (const preset of presets) {
      const cat = preset.category || 'Other';
      if (!grouped[cat]) {
        grouped[cat] = [];
      }
      grouped[cat].push({
        presetKey: preset.presetKey,
        displayName: preset.displayName,
        description: preset.description,
        action: preset.quickRuleSkeleton?.action || 'DIRECT_TO_3TIER',
        serviceType: preset.quickRuleSkeleton?.serviceType || 'REPAIR',
        samplePhrases: preset.samplePhrases || []
      });
    }

    // Convert to array format for frontend
    const categories = Object.entries(grouped).map(([category, items]) => ({
      category,
      presets: items
    }));

    res.json({
      success: true,
      tradeKey: tradeKey.toUpperCase(),
      totalPresets: presets.length,
      categories
    });

  } catch (error) {
    logger.error('[TRIAGE PRESETS] Error fetching presets:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch presets'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET /api/admin/triage-presets/:tradeKey/:presetKey
// Returns full preset details for cloning into a TriageCard
// ═══════════════════════════════════════════════════════════════════════════

router.get('/:tradeKey/:presetKey', async (req, res) => {
  try {
    const { tradeKey, presetKey } = req.params;

    const preset = await TriagePresetScenario.findOne({
      tradeKey: tradeKey.toUpperCase(),
      presetKey: presetKey.toUpperCase()
    }).lean();

    if (!preset) {
      return res.status(404).json({
        success: false,
        error: `Preset not found: ${tradeKey}/${presetKey}`
      });
    }

    res.json({
      success: true,
      preset
    });

  } catch (error) {
    logger.error('[TRIAGE PRESETS] Error fetching preset:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch preset'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// POST /api/admin/triage-presets/clone
// Clone a preset into a TriageCard for a specific company
// ═══════════════════════════════════════════════════════════════════════════

router.post('/clone', async (req, res) => {
  try {
    const { tradeKey, presetKey, companyId, activate = true } = req.body;

    if (!tradeKey || !presetKey || !companyId) {
      return res.status(400).json({
        success: false,
        error: 'tradeKey, presetKey, and companyId are required'
      });
    }

    const triageCard = await TriagePresetScenario.cloneToTriageCard(
      presetKey,
      tradeKey,
      companyId,
      { activate }
    );

    res.json({
      success: true,
      message: `Cloned ${presetKey} to company ${companyId}`,
      triageCardId: triageCard._id
    });

  } catch (error) {
    logger.error('[TRIAGE PRESETS] Error cloning preset:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Failed to clone preset'
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// HELPER: Default trades (fallback if DB is empty)
// ═══════════════════════════════════════════════════════════════════════════

function getDefaultTrades() {
  return [
    { tradeKey: 'HVAC', displayName: 'HVAC / Air Conditioning', icon: '❄️', sortOrder: 1 },
    { tradeKey: 'PLUMBING', displayName: 'Plumbing', icon: '🔧', sortOrder: 2 },
    { tradeKey: 'ELECTRICAL', displayName: 'Electrical', icon: '⚡', sortOrder: 3 },
    { tradeKey: 'DENTAL', displayName: 'Dental / Orthodontics', icon: '🦷', sortOrder: 4 },
    { tradeKey: 'MEDICAL', displayName: 'Medical / Healthcare', icon: '🏥', sortOrder: 5 },
    { tradeKey: 'LEGAL', displayName: 'Legal / Law Office', icon: '⚖️', sortOrder: 6 },
    { tradeKey: 'ACCOUNTING', displayName: 'Accounting / CPA', icon: '📊', sortOrder: 7 },
    { tradeKey: 'REAL_ESTATE', displayName: 'Real Estate', icon: '🏠', sortOrder: 8 },
    { tradeKey: 'INSURANCE', displayName: 'Insurance', icon: '🛡️', sortOrder: 9 },
    { tradeKey: 'AUTO', displayName: 'Auto Repair / Service', icon: '🚗', sortOrder: 10 },
    { tradeKey: 'LANDSCAPING', displayName: 'Landscaping / Lawn Care', icon: '🌳', sortOrder: 11 },
    { tradeKey: 'CLEANING', displayName: 'Cleaning Services', icon: '🧹', sortOrder: 12 },
    { tradeKey: 'PEST_CONTROL', displayName: 'Pest Control', icon: '🐜', sortOrder: 13 },
    { tradeKey: 'ROOFING', displayName: 'Roofing', icon: '🏗️', sortOrder: 14 },
    { tradeKey: 'GENERAL', displayName: 'General / Other', icon: '📞', sortOrder: 99 }
  ];
}

module.exports = router;

