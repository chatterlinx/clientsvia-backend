/**
 * ============================================================================
 * RETURN LANE ADMIN ROUTES (V1 - 2026-02)
 * ============================================================================
 * 
 * Admin endpoints for configuring Return Lane:
 * - Company-level settings (enable/disable, defaults, templates)
 * - Card-level returnConfig updates (convenience endpoint)
 * 
 * IMPORTANT:
 * - All endpoints require JWT authentication
 * - All endpoints are scoped by companyId
 * - Card updates also available via PUT /api/admin/triage/card/:cardId
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const Company = require('../../models/v2Company');
const TriageCard = require('../../models/TriageCard');
const TriageService = require('../../services/TriageService');
const logger = require('../../utils/logger');

// Authentication middleware
const { authenticateJWT } = require('../../middleware/auth');
router.use(authenticateJWT);

// ═══════════════════════════════════════════════════════════════════════════
// COMPANY-LEVEL RETURN LANE SETTINGS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/return-lane/company/:companyId
 * Get company Return Lane settings
 */
router.get('/company/:companyId', async (req, res, next) => {
  try {
    const { companyId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ ok: false, error: 'Invalid company ID' });
    }
    
    const company = await Company.findById(companyId)
      .select('aiAgentSettings.returnLane companyName')
      .lean();
    
    if (!company) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }
    
    res.json({
      ok: true,
      companyId,
      companyName: company.companyName,
      returnLane: company.aiAgentSettings?.returnLane || {
        enabled: false,
        defaults: {},
        pushPromptTemplates: {},
        tier3Governance: {}
      }
    });
  } catch (err) {
    logger.error('[RETURN LANE ADMIN] Get company settings error', {
      error: err.message,
      companyId: req.params.companyId
    });
    next(err);
  }
});

/**
 * PUT /api/admin/return-lane/company/:companyId
 * Update company Return Lane settings
 */
router.put('/company/:companyId', async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const updates = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ ok: false, error: 'Invalid company ID' });
    }
    
    // Build update object with dot notation for nested fields
    const updateObj = {};
    
    // Enable/disable
    if (typeof updates.enabled === 'boolean') {
      updateObj['aiAgentSettings.returnLane.enabled'] = updates.enabled;
    }
    
    // Defaults
    if (updates.defaults) {
      if (updates.defaults.lane) {
        updateObj['aiAgentSettings.returnLane.defaults.lane'] = updates.defaults.lane;
      }
      if (updates.defaults.postResponseAction) {
        updateObj['aiAgentSettings.returnLane.defaults.postResponseAction'] = updates.defaults.postResponseAction;
      }
      if (updates.defaults.pushPromptKey) {
        updateObj['aiAgentSettings.returnLane.defaults.pushPromptKey'] = updates.defaults.pushPromptKey;
      }
    }
    
    // Push prompt templates
    if (updates.pushPromptTemplates) {
      for (const [key, value] of Object.entries(updates.pushPromptTemplates)) {
        if (typeof value === 'string') {
          updateObj[`aiAgentSettings.returnLane.pushPromptTemplates.${key}`] = value.trim();
        }
      }
    }
    
    // Tier 3 governance
    if (updates.tier3Governance) {
      if (Array.isArray(updates.tier3Governance.restrictedActions)) {
        updateObj['aiAgentSettings.returnLane.tier3Governance.restrictedActions'] = updates.tier3Governance.restrictedActions;
      }
      if (typeof updates.tier3Governance.allowHardActions === 'boolean') {
        updateObj['aiAgentSettings.returnLane.tier3Governance.allowHardActions'] = updates.tier3Governance.allowHardActions;
      }
    }
    
    // Metadata
    updateObj['aiAgentSettings.returnLane.configuredAt'] = new Date();
    updateObj['aiAgentSettings.returnLane.configuredBy'] = req.user?.email || req.user?._id?.toString() || 'admin';
    
    if (Object.keys(updateObj).length === 2) {
      // Only metadata, no actual updates
      return res.status(400).json({ ok: false, error: 'No valid updates provided' });
    }
    
    const company = await Company.findByIdAndUpdate(
      companyId,
      { $set: updateObj },
      { new: true, runValidators: true }
    ).select('aiAgentSettings.returnLane companyName').lean();
    
    if (!company) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }
    
    logger.info('[RETURN LANE ADMIN] Company settings updated', {
      companyId,
      enabled: company.aiAgentSettings?.returnLane?.enabled,
      updatedBy: req.user?.email
    });
    
    res.json({
      ok: true,
      companyId,
      returnLane: company.aiAgentSettings?.returnLane
    });
  } catch (err) {
    logger.error('[RETURN LANE ADMIN] Update company settings error', {
      error: err.message,
      companyId: req.params.companyId
    });
    next(err);
  }
});

/**
 * POST /api/admin/return-lane/company/:companyId/enable
 * Quick enable Return Lane for a company (convenience endpoint)
 */
router.post('/company/:companyId/enable', async (req, res, next) => {
  try {
    const { companyId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ ok: false, error: 'Invalid company ID' });
    }
    
    const company = await Company.findByIdAndUpdate(
      companyId,
      {
        $set: {
          'aiAgentSettings.returnLane.enabled': true,
          'aiAgentSettings.returnLane.configuredAt': new Date(),
          'aiAgentSettings.returnLane.configuredBy': req.user?.email || 'admin'
        }
      },
      { new: true }
    ).select('aiAgentSettings.returnLane.enabled companyName').lean();
    
    if (!company) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }
    
    logger.info('[RETURN LANE ADMIN] Company Return Lane enabled', {
      companyId,
      enabledBy: req.user?.email
    });
    
    res.json({
      ok: true,
      companyId,
      enabled: true
    });
  } catch (err) {
    logger.error('[RETURN LANE ADMIN] Enable error', {
      error: err.message,
      companyId: req.params.companyId
    });
    next(err);
  }
});

/**
 * POST /api/admin/return-lane/company/:companyId/disable
 * Quick disable Return Lane for a company (convenience endpoint)
 */
router.post('/company/:companyId/disable', async (req, res, next) => {
  try {
    const { companyId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ ok: false, error: 'Invalid company ID' });
    }
    
    const company = await Company.findByIdAndUpdate(
      companyId,
      {
        $set: {
          'aiAgentSettings.returnLane.enabled': false,
          'aiAgentSettings.returnLane.configuredAt': new Date(),
          'aiAgentSettings.returnLane.configuredBy': req.user?.email || 'admin'
        }
      },
      { new: true }
    ).select('aiAgentSettings.returnLane.enabled companyName').lean();
    
    if (!company) {
      return res.status(404).json({ ok: false, error: 'Company not found' });
    }
    
    logger.info('[RETURN LANE ADMIN] Company Return Lane disabled', {
      companyId,
      disabledBy: req.user?.email
    });
    
    res.json({
      ok: true,
      companyId,
      enabled: false
    });
  } catch (err) {
    logger.error('[RETURN LANE ADMIN] Disable error', {
      error: err.message,
      companyId: req.params.companyId
    });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CARD-LEVEL RETURN CONFIG
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/return-lane/card/:cardId
 * Get a card's returnConfig
 */
router.get('/card/:cardId', async (req, res, next) => {
  try {
    const { cardId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(cardId)) {
      return res.status(400).json({ ok: false, error: 'Invalid card ID' });
    }
    
    const card = await TriageCard.findById(cardId)
      .select('triageLabel displayName returnConfig companyId')
      .lean();
    
    if (!card) {
      return res.status(404).json({ ok: false, error: 'Card not found' });
    }
    
    res.json({
      ok: true,
      cardId,
      triageLabel: card.triageLabel,
      displayName: card.displayName,
      returnConfig: card.returnConfig || { enabled: false }
    });
  } catch (err) {
    logger.error('[RETURN LANE ADMIN] Get card config error', {
      error: err.message,
      cardId: req.params.cardId
    });
    next(err);
  }
});

/**
 * PUT /api/admin/return-lane/card/:cardId
 * Update a card's returnConfig
 */
router.put('/card/:cardId', async (req, res, next) => {
  try {
    const { cardId } = req.params;
    const returnConfig = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(cardId)) {
      return res.status(400).json({ ok: false, error: 'Invalid card ID' });
    }
    
    // Validate returnConfig structure
    if (typeof returnConfig !== 'object') {
      return res.status(400).json({ ok: false, error: 'returnConfig must be an object' });
    }
    
    const card = await TriageCard.findByIdAndUpdate(
      cardId,
      { $set: { returnConfig } },
      { new: true, runValidators: true }
    ).select('triageLabel displayName returnConfig companyId trade').lean();
    
    if (!card) {
      return res.status(404).json({ ok: false, error: 'Card not found' });
    }
    
    // Invalidate triage cache
    TriageService.invalidateCache(card.companyId, card.trade);
    
    logger.info('[RETURN LANE ADMIN] Card returnConfig updated', {
      cardId,
      triageLabel: card.triageLabel,
      enabled: card.returnConfig?.enabled,
      lane: card.returnConfig?.lane
    });
    
    res.json({
      ok: true,
      cardId,
      triageLabel: card.triageLabel,
      returnConfig: card.returnConfig
    });
  } catch (err) {
    logger.error('[RETURN LANE ADMIN] Update card config error', {
      error: err.message,
      cardId: req.params.cardId
    });
    next(err);
  }
});

/**
 * POST /api/admin/return-lane/card/:cardId/enable
 * Quick enable Return Lane on a card
 */
router.post('/card/:cardId/enable', async (req, res, next) => {
  try {
    const { cardId } = req.params;
    const { lane, postResponseAction } = req.body;
    
    if (!mongoose.Types.ObjectId.isValid(cardId)) {
      return res.status(400).json({ ok: false, error: 'Invalid card ID' });
    }
    
    const updateObj = {
      'returnConfig.enabled': true
    };
    
    // Optionally set lane and action when enabling
    if (lane) {
      updateObj['returnConfig.lane'] = lane;
    }
    if (postResponseAction) {
      updateObj['returnConfig.postResponseAction'] = postResponseAction;
    }
    
    const card = await TriageCard.findByIdAndUpdate(
      cardId,
      { $set: updateObj },
      { new: true }
    ).select('triageLabel returnConfig companyId trade').lean();
    
    if (!card) {
      return res.status(404).json({ ok: false, error: 'Card not found' });
    }
    
    TriageService.invalidateCache(card.companyId, card.trade);
    
    logger.info('[RETURN LANE ADMIN] Card Return Lane enabled', {
      cardId,
      triageLabel: card.triageLabel,
      lane: card.returnConfig?.lane
    });
    
    res.json({
      ok: true,
      cardId,
      triageLabel: card.triageLabel,
      enabled: true,
      returnConfig: card.returnConfig
    });
  } catch (err) {
    logger.error('[RETURN LANE ADMIN] Enable card error', {
      error: err.message,
      cardId: req.params.cardId
    });
    next(err);
  }
});

/**
 * POST /api/admin/return-lane/card/:cardId/disable
 * Quick disable Return Lane on a card
 */
router.post('/card/:cardId/disable', async (req, res, next) => {
  try {
    const { cardId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(cardId)) {
      return res.status(400).json({ ok: false, error: 'Invalid card ID' });
    }
    
    const card = await TriageCard.findByIdAndUpdate(
      cardId,
      { $set: { 'returnConfig.enabled': false } },
      { new: true }
    ).select('triageLabel returnConfig companyId trade').lean();
    
    if (!card) {
      return res.status(404).json({ ok: false, error: 'Card not found' });
    }
    
    TriageService.invalidateCache(card.companyId, card.trade);
    
    logger.info('[RETURN LANE ADMIN] Card Return Lane disabled', {
      cardId,
      triageLabel: card.triageLabel
    });
    
    res.json({
      ok: true,
      cardId,
      triageLabel: card.triageLabel,
      enabled: false
    });
  } catch (err) {
    logger.error('[RETURN LANE ADMIN] Disable card error', {
      error: err.message,
      cardId: req.params.cardId
    });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// BULK OPERATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/return-lane/cards/:companyId
 * List all cards with their returnConfig status
 */
router.get('/cards/:companyId', async (req, res, next) => {
  try {
    const { companyId } = req.params;
    
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      return res.status(400).json({ ok: false, error: 'Invalid company ID' });
    }
    
    const cards = await TriageCard.find({ companyId, isActive: true })
      .select('triageLabel displayName returnConfig isActive trade')
      .sort({ triageLabel: 1 })
      .lean();
    
    const summary = {
      total: cards.length,
      enabled: cards.filter(c => c.returnConfig?.enabled === true).length,
      disabled: cards.filter(c => c.returnConfig?.enabled !== true).length,
      byLane: {}
    };
    
    // Count by lane
    for (const card of cards) {
      if (card.returnConfig?.enabled) {
        const lane = card.returnConfig.lane || 'UNKNOWN';
        summary.byLane[lane] = (summary.byLane[lane] || 0) + 1;
      }
    }
    
    res.json({
      ok: true,
      companyId,
      summary,
      cards: cards.map(c => ({
        cardId: c._id,
        triageLabel: c.triageLabel,
        displayName: c.displayName,
        trade: c.trade,
        returnConfig: {
          enabled: c.returnConfig?.enabled || false,
          lane: c.returnConfig?.lane || null,
          postResponseAction: c.returnConfig?.postResponseAction || null
        }
      }))
    });
  } catch (err) {
    logger.error('[RETURN LANE ADMIN] List cards error', {
      error: err.message,
      companyId: req.params.companyId
    });
    next(err);
  }
});

module.exports = router;
