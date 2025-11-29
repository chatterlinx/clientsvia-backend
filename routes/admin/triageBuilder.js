// routes/admin/triageBuilder.js
// V22 Triage Builder Admin Routes - CRUD for TriageCards + LLM-A generation

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const TriageCard = require('../../models/TriageCard');
const TriageService = require('../../services/TriageService');
const LLMA = require('../../services/LLMA_TriageCardGenerator');
const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════════
// CARD VIEW MODEL TRANSFORMER
// Maps TriageCard to UI-friendly format (matches screenshot design)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Transform a TriageCard document into the UI card view model.
 * This matches the visual design from the HVAC Template screenshot.
 * 
 * @param {Object} card - TriageCard document (lean or full)
 * @param {Object} [options] - Optional overrides
 * @param {string} [options.templateName] - Template name to display
 * @param {string} [options.templateVersion] - Template version
 * @returns {Object} Card view model for frontend
 */
function toCardViewModel(card, options = {}) {
  if (!card) return null;

  // Extract first keyword as trigger label
  const keywords = card.quickRuleConfig?.keywordsMustHave || [];
  const triggerLabel = keywords[0] || card.triageLabel?.toLowerCase().replace(/_/g, ' ') || '';

  // Build preview reply from various sources
  let previewReply = '';
  if (card.frontlinePlaybook?.openingLines?.[0]) {
    previewReply = card.frontlinePlaybook.openingLines[0];
  } else if (card.actionPlaybooks?.explainAndPush?.explanationLines?.[0]) {
    previewReply = card.actionPlaybooks.explainAndPush.explanationLines[0];
  } else if (card.description) {
    previewReply = card.description;
  }

  // Compute stats
  const totalMatches = card.matchHistory?.totalMatches || 0;
  const successRate = card.matchHistory?.successRate || 0;
  const successPercent = totalMatches > 0 ? Math.round(successRate * 100) : null;

  // Category/folder label
  const categoryLabel = card.threeTierPackageDraft?.categoryName 
    || card.triageCategory 
    || card.trade 
    || 'Uncategorized';

  return {
    // Identity
    id: card._id?.toString() || card.id,
    triageLabel: card.triageLabel,
    
    // UI Display (matches screenshot)
    active: card.isActive || false,
    title: card.displayName || card.triageLabel,
    triggerLabel: triggerLabel,
    previewReply: previewReply.substring(0, 200) + (previewReply.length > 200 ? '...' : ''),
    
    // Template info
    templateName: options.templateName || `${card.trade} Trade Knowledge Template`,
    templateVersion: options.templateVersion || 'V22',
    trade: card.trade,
    
    // Stats (right side pills)
    uses: totalMatches,
    successPercent: successPercent, // null = "--%" in UI
    
    // Classification
    categoryLabel: categoryLabel,
    serviceType: card.serviceType,
    intent: card.intent,
    priority: card.priority || 100,
    
    // Action info
    action: card.quickRuleConfig?.action || 'DIRECT_TO_3TIER',
    
    // Keywords for display
    keywordsMustHave: keywords,
    keywordsExclude: card.quickRuleConfig?.keywordsExclude || [],
    
    // Linked scenario (if any)
    linkedScenarioId: card.linkedScenario?.scenarioId || null,
    linkedScenarioName: card.linkedScenario?.scenarioName || null,
    
    // Timestamps
    createdAt: card.createdAt,
    updatedAt: card.updatedAt
  };
}

/**
 * Transform array of cards to view models
 */
function toCardViewModels(cards, options = {}) {
  return cards.map(card => toCardViewModel(card, options));
}

/**
 * Group cards by category for folder display
 */
function groupByCategory(cardViewModels) {
  const groups = {};
  
  for (const card of cardViewModels) {
    const category = card.categoryLabel || 'Uncategorized';
    if (!groups[category]) {
      groups[category] = {
        name: category,
        cards: [],
        count: 0,
        activeCount: 0
      };
    }
    groups[category].cards.push(card);
    groups[category].count++;
    if (card.active) groups[category].activeCount++;
  }
  
  // Sort groups by name, convert to array
  return Object.values(groups).sort((a, b) => a.name.localeCompare(b.name));
}

// ═══════════════════════════════════════════════════════════════════════════
// LLM-A: GENERATE CARD DRAFT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/triage/generate-card
 * Generate a triage card draft using LLM-A (admin-only)
 */
router.post('/generate-card', async (req, res, next) => {
  try {
    const {
      companyId,
      trade,
      scenarioTitle,
      scenarioDescription,
      targetServiceTypes,
      preferredAction,
      adminNotes,
      language
    } = req.body;

    if (!companyId || !trade || !scenarioTitle || !scenarioDescription) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: companyId, trade, scenarioTitle, scenarioDescription'
      });
    }

    logger.info('[TRIAGE BUILDER] Generating card draft', {
      companyId,
      trade,
      scenarioTitle,
      userId: req.user?._id
    });

    const draft = await LLMA.generateTriageCardDraft({
      companyId,
      trade,
      scenarioTitle,
      scenarioDescription,
      targetServiceTypes,
      preferredAction,
      adminNotes,
      language
    });

    // Create card in DB (inactive by default)
    const card = await TriageCard.create({
      companyId,
      trade,
      ...draft,
      isActive: false, // Admin must manually activate
      createdBy: req.user?._id || null
    });

    // Invalidate cache
    TriageService.invalidateCache(companyId, trade);

    logger.info('[TRIAGE BUILDER] Card created', {
      cardId: card._id,
      triageLabel: card.triageLabel,
      companyId
    });

    res.json({
      ok: true,
      card: card.toObject()
    });
  } catch (err) {
    logger.error('[TRIAGE BUILDER] Generate card error', {
      error: err.message,
      companyId: req.body?.companyId
    });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CRUD: LIST CARDS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/triage/cards/:companyId
 * List all triage cards for a company
 * 
 * Query params:
 *   - trade: Filter by trade (e.g., "HVAC")
 *   - isActive: Filter by active status ("true" or "false")
 *   - format: "raw" (default) | "view" | "grouped"
 * 
 * Response formats:
 *   - raw: Full TriageCard documents
 *   - view: UI card view models (matches screenshot design)
 *   - grouped: Cards grouped by category (for folder view)
 */
router.get('/cards/:companyId', async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { trade, isActive, format = 'raw' } = req.query;

    const query = { companyId };
    if (trade) query.trade = trade;
    if (isActive !== undefined) query.isActive = isActive === 'true';

    const cards = await TriageCard.find(query)
      .sort({ priority: -1, createdAt: -1 })
      .lean();

    // Summary stats
    const summary = {
      totalCards: cards.length,
      activeCards: cards.filter(c => c.isActive).length,
      disabledCards: cards.filter(c => !c.isActive).length,
      totalTriggers: cards.reduce((sum, c) => sum + (c.quickRuleConfig?.keywordsMustHave?.length || 0), 0),
      trades: [...new Set(cards.map(c => c.trade))],
      categories: [...new Set(cards.map(c => c.threeTierPackageDraft?.categoryName || c.triageCategory).filter(Boolean))]
    };

    if (format === 'view') {
      // UI card view models
      const viewModels = toCardViewModels(cards, { templateVersion: 'V22' });
      return res.json({
        ok: true,
        format: 'view',
        summary,
        cards: viewModels
      });
    }

    if (format === 'grouped') {
      // Grouped by category (folder view)
      const viewModels = toCardViewModels(cards, { templateVersion: 'V22' });
      const groups = groupByCategory(viewModels);
      return res.json({
        ok: true,
        format: 'grouped',
        summary,
        categories: groups
      });
    }

    // Default: raw cards
    res.json({
      ok: true,
      format: 'raw',
      summary,
      cards
    });
  } catch (err) {
    logger.error('[TRIAGE BUILDER] List cards error', {
      error: err.message,
      companyId: req.params.companyId
    });
    next(err);
  }
});

/**
 * GET /api/admin/triage/card/:cardId
 * Get single triage card by ID
 * 
 * Returns both raw card and UI view model
 */
router.get('/card/:cardId', async (req, res, next) => {
  try {
    const { cardId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(cardId)) {
      return res.status(400).json({ ok: false, error: 'Invalid card ID' });
    }

    const card = await TriageCard.findById(cardId).lean();

    if (!card) {
      return res.status(404).json({ ok: false, error: 'Card not found' });
    }

    res.json({ 
      ok: true, 
      card,
      viewModel: toCardViewModel(card, { templateVersion: 'V22' })
    });
  } catch (err) {
    logger.error('[TRIAGE BUILDER] Get card error', {
      error: err.message,
      cardId: req.params.cardId
    });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CRUD: CREATE CARD (MANUAL)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/triage/card
 * Create a triage card manually (without LLM-A)
 */
router.post('/card', async (req, res, next) => {
  try {
    const cardData = req.body;

    if (!cardData.companyId || !cardData.trade || !cardData.triageLabel || !cardData.displayName) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: companyId, trade, triageLabel, displayName'
      });
    }

    if (!cardData.quickRuleConfig || !cardData.quickRuleConfig.action) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required field: quickRuleConfig.action'
      });
    }

    // Normalize triageLabel
    cardData.triageLabel = String(cardData.triageLabel)
      .toUpperCase()
      .replace(/[^A-Z0-9_]/g, '_');

    cardData.createdBy = req.user?._id || null;

    const card = await TriageCard.create(cardData);

    // Invalidate cache
    TriageService.invalidateCache(cardData.companyId, cardData.trade);

    logger.info('[TRIAGE BUILDER] Manual card created', {
      cardId: card._id,
      triageLabel: card.triageLabel,
      companyId: cardData.companyId
    });

    res.status(201).json({ ok: true, card: card.toObject() });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        ok: false,
        error: 'Duplicate triageLabel for this company'
      });
    }
    logger.error('[TRIAGE BUILDER] Create card error', {
      error: err.message
    });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CRUD: UPDATE CARD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * PUT /api/admin/triage/card/:cardId
 * Update a triage card
 */
router.put('/card/:cardId', async (req, res, next) => {
  try {
    const { cardId } = req.params;
    const updates = req.body;

    if (!mongoose.Types.ObjectId.isValid(cardId)) {
      return res.status(400).json({ ok: false, error: 'Invalid card ID' });
    }

    // Prevent updating immutable fields
    delete updates._id;
    delete updates.companyId;
    delete updates.createdAt;
    delete updates.createdBy;

    updates.updatedBy = req.user?._id || null;

    // Normalize triageLabel if provided
    if (updates.triageLabel) {
      updates.triageLabel = String(updates.triageLabel)
        .toUpperCase()
        .replace(/[^A-Z0-9_]/g, '_');
    }

    const card = await TriageCard.findByIdAndUpdate(
      cardId,
      { $set: updates },
      { new: true, runValidators: true }
    ).lean();

    if (!card) {
      return res.status(404).json({ ok: false, error: 'Card not found' });
    }

    // Invalidate cache
    TriageService.invalidateCache(card.companyId, card.trade);

    logger.info('[TRIAGE BUILDER] Card updated', {
      cardId,
      triageLabel: card.triageLabel,
      companyId: card.companyId
    });

    res.json({ ok: true, card });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({
        ok: false,
        error: 'Duplicate triageLabel for this company'
      });
    }
    logger.error('[TRIAGE BUILDER] Update card error', {
      error: err.message,
      cardId: req.params.cardId
    });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CRUD: DELETE CARD
// ═══════════════════════════════════════════════════════════════════════════

/**
 * DELETE /api/admin/triage/card/:cardId
 * Delete a triage card
 */
router.delete('/card/:cardId', async (req, res, next) => {
  try {
    const { cardId } = req.params;

    if (!mongoose.Types.ObjectId.isValid(cardId)) {
      return res.status(400).json({ ok: false, error: 'Invalid card ID' });
    }

    const card = await TriageCard.findByIdAndDelete(cardId).lean();

    if (!card) {
      return res.status(404).json({ ok: false, error: 'Card not found' });
    }

    // Invalidate cache
    TriageService.invalidateCache(card.companyId, card.trade);

    logger.info('[TRIAGE BUILDER] Card deleted', {
      cardId,
      triageLabel: card.triageLabel,
      companyId: card.companyId
    });

    res.json({ ok: true, deleted: true, cardId });
  } catch (err) {
    logger.error('[TRIAGE BUILDER] Delete card error', {
      error: err.message,
      cardId: req.params.cardId
    });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// ACTIVATION: TOGGLE CARD ACTIVE STATE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/triage/card/:cardId/activate
 * Activate a triage card
 */
router.post('/card/:cardId/activate', async (req, res, next) => {
  try {
    const { cardId } = req.params;

    const card = await TriageCard.findByIdAndUpdate(
      cardId,
      { $set: { isActive: true, updatedBy: req.user?._id } },
      { new: true }
    ).lean();

    if (!card) {
      return res.status(404).json({ ok: false, error: 'Card not found' });
    }

    TriageService.invalidateCache(card.companyId, card.trade);

    logger.info('[TRIAGE BUILDER] Card activated', {
      cardId,
      triageLabel: card.triageLabel
    });

    res.json({ ok: true, card });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/admin/triage/card/:cardId/deactivate
 * Deactivate a triage card
 */
router.post('/card/:cardId/deactivate', async (req, res, next) => {
  try {
    const { cardId } = req.params;

    const card = await TriageCard.findByIdAndUpdate(
      cardId,
      { $set: { isActive: false, updatedBy: req.user?._id } },
      { new: true }
    ).lean();

    if (!card) {
      return res.status(404).json({ ok: false, error: 'Card not found' });
    }

    TriageService.invalidateCache(card.companyId, card.trade);

    logger.info('[TRIAGE BUILDER] Card deactivated', {
      cardId,
      triageLabel: card.triageLabel
    });

    res.json({ ok: true, card });
  } catch (err) {
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// TESTING: TEST QUICK RULES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/triage/test-rules
 * Test quick triage rules against sample input
 */
router.post('/test-rules', async (req, res, next) => {
  try {
    const { companyId, trade, testInput } = req.body;

    if (!companyId || !testInput) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: companyId, testInput'
      });
    }

    const result = await TriageService.applyQuickTriageRules(testInput, companyId, trade);

    res.json({
      ok: true,
      testInput,
      normalizedInput: TriageService.normalizeText(testInput),
      result
    });
  } catch (err) {
    logger.error('[TRIAGE BUILDER] Test rules error', {
      error: err.message
    });
    next(err);
  }
});

/**
 * GET /api/admin/triage/stats/:companyId
 * Get triage statistics for a company
 */
router.get('/stats/:companyId', async (req, res, next) => {
  try {
    const { companyId } = req.params;

    const stats = await TriageCard.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
      {
        $group: {
          _id: null,
          totalCards: { $sum: 1 },
          activeCards: { $sum: { $cond: ['$isActive', 1, 0] } },
          totalMatches: { $sum: '$matchHistory.totalMatches' },
          totalSuccesses: { $sum: '$matchHistory.totalSuccesses' },
          avgSuccessRate: { $avg: '$matchHistory.successRate' }
        }
      }
    ]);

    const byTrade = await TriageCard.aggregate([
      { $match: { companyId: new mongoose.Types.ObjectId(companyId) } },
      {
        $group: {
          _id: '$trade',
          count: { $sum: 1 },
          active: { $sum: { $cond: ['$isActive', 1, 0] } }
        }
      }
    ]);

    const topCards = await TriageCard.find({ companyId })
      .sort({ 'matchHistory.totalMatches': -1 })
      .limit(10)
      .select('triageLabel displayName matchHistory.totalMatches matchHistory.successRate')
      .lean();

    res.json({
      ok: true,
      summary: stats[0] || { totalCards: 0, activeCards: 0, totalMatches: 0 },
      byTrade,
      topCards
    });
  } catch (err) {
    logger.error('[TRIAGE BUILDER] Stats error', {
      error: err.message,
      companyId: req.params.companyId
    });
    next(err);
  }
});

module.exports = router;
