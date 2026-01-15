// routes/admin/triageBuilder.js
// V23 Triage Builder Admin Routes - CRUD for TriageCards + LLM-A generation
// 
// CRITICAL V23 ARCHITECTURE:
// - The "Golden Rule": Build Brain 2 (Scenarios) BEFORE Brain 1 (Triage)
// - LLM-A HARD STOPS if no scenarios are active
// - Pre-flight check enforces this at API level

const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');
const TriageCard = require('../../models/TriageCard');
const TriageService = require('../../services/TriageService');
const LLMA = require('../../services/LLMA_TriageCardGenerator');
const logger = require('../../utils/logger');

// Authentication middleware - required for all admin routes
const { authenticateJWT } = require('../../middleware/auth');

// Apply authentication to ALL routes in this router
router.use(authenticateJWT);

// V23: Active Scenarios Helper (Pre-flight check)
const { 
  getActiveScenariosForCompany, 
  preFlightCheckForTriageBuilder,
  getScenarioKeysForLLMA 
} = require('../../services/ActiveScenariosHelper');

// Import official UI contract transformers
const {
  buildCardViewModel,
  buildCardViewModels,
  buildSummary,
  groupByCategory
} = require('../../services/triageViewModel');

// Aliases for backward compatibility
const toCardViewModel = buildCardViewModel;
const toCardViewModels = buildCardViewModels;

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
// V23: PRE-FLIGHT CHECK (THE "GOLDEN RULE" ENFORCEMENT)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/triage-builder/preflight/:companyId
 * 
 * V23 Pre-Flight Check - Verify Brain 2 is ready before Brain 1 creation
 * 
 * CRITICAL: If this returns canProceed: false, the UI MUST block the Triage Builder
 * 
 * Response: {
 *   canProceed: boolean,
 *   scenarioCount: number,
 *   scenarios: Array<{ scenarioKey, name, categoryKey }>,
 *   message: string,
 *   companyName: string,
 *   trade: string
 * }
 */
router.get('/preflight/:companyId', async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    const { companyId } = req.params;
    
    // CHECKPOINT 1: Validate company ID format
    logger.info('[TRIAGE PREFLIGHT] ⏳ CHECKPOINT 1: Starting pre-flight check', { 
      companyId,
      userId: req.user?.id || 'unknown',
      userEmail: req.user?.email || 'unknown'
    });
    
    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      logger.error('[TRIAGE PREFLIGHT] ❌ CHECKPOINT 1.1: Invalid company ID format', { companyId });
      return res.status(400).json({
        success: false,
        canProceed: false,
        error: 'INVALID_COMPANY_ID',
        message: 'Invalid company ID format'
      });
    }
    
    // CHECKPOINT 2: Call helper to get active scenarios
    logger.info('[TRIAGE PREFLIGHT] 🔍 CHECKPOINT 2: Fetching scenarios from ActiveScenariosHelper');
    const preFlightResult = await preFlightCheckForTriageBuilder(companyId);
    
    // CHECKPOINT 3: Log results
    const elapsed = Date.now() - startTime;
    
    if (!preFlightResult.canProceed) {
      logger.warn('[TRIAGE PREFLIGHT] ⚠️ CHECKPOINT 3: Pre-flight FAILED - No scenarios loaded', {
        companyId,
        scenarioCount: preFlightResult.scenarioCount,
        companyName: preFlightResult.companyName,
        elapsedMs: elapsed
      });
    } else {
      logger.info('[TRIAGE PREFLIGHT] ✅ CHECKPOINT 3: Pre-flight PASSED', {
        companyId,
        scenarioCount: preFlightResult.scenarioCount,
        companyName: preFlightResult.companyName,
        elapsedMs: elapsed
      });
    }
    
    // CHECKPOINT 4: Send response
    res.json({
      success: true,
      ...preFlightResult
    });
    
    logger.info('[TRIAGE PREFLIGHT] ✅ CHECKPOINT 4: Response sent', { elapsedMs: Date.now() - startTime });
    
  } catch (err) {
    // NEVER mask errors - log everything
    logger.error('[TRIAGE PREFLIGHT] ❌ CHECKPOINT X: Fatal error in pre-flight', {
      error: err.message,
      stack: err.stack,
      companyId: req.params.companyId,
      elapsedMs: Date.now() - startTime
    });
    
    // Return proper error response instead of passing to generic handler
    res.status(500).json({
      success: false,
      canProceed: false,
      error: 'INTERNAL_ERROR',
      message: 'Pre-flight check failed due to server error',
      details: err.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// V23: LLM-A TRIAGE ARCHITECT (STRUCTURED GENERATION WITH VALIDATION)
// ═══════════════════════════════════════════════════════════════════════════

const LLMAV23 = require('../../services/LLMA_TriageCardGeneratorV23');

/**
 * POST /api/admin/triage-builder/generate-card-v23
 * 
 * V23 LLM-A Triage Architect - generates validated card draft
 * 
 * CRITICAL: This endpoint HARD STOPS if Brain 2 (scenarios) is empty.
 * The "Golden Rule": Build Brain 2 first, then Brain 1.
 * 
 * Input: {
 *   companyId: string,
 *   tradeKey: string (HVAC, PLUMBING, etc.),
 *   regionProfile: { climate, supportsHeating, supportsCooling, ... },
 *   triageIdea: {
 *     adminTitle: string,
 *     adminNotes: string,
 *     exampleUtterances: string[],
 *     desiredAction: string,
 *     serviceTypeHint: string,
 *     priorityHint: number
 *   }
 * }
 * 
 * Output: {
 *   ok: boolean,
 *   draft: object (triageCardDraft),
 *   validationReport: { status, coverage, failures },
 *   errors: string[]
 * }
 */
router.post('/generate-card-v23', async (req, res, next) => {
  try {
    const { companyId, tradeKey, regionProfile, triageIdea } = req.body;
    
    logger.info('[TRIAGE BUILDER V23] Generate request', {
      companyId,
      tradeKey,
      adminTitle: triageIdea?.adminTitle,
      userId: req.user?._id
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // V23 PRE-FLIGHT CHECK: Brain 2 must have scenarios
    // This is the "Golden Rule" enforcement
    // ═══════════════════════════════════════════════════════════════════════
    const scenariosResult = await getActiveScenariosForCompany(companyId);
    
    if (!scenariosResult.success || scenariosResult.count === 0) {
      logger.error('[TRIAGE BUILDER V23] ❌ HARD STOP - No scenarios loaded', {
        companyId,
        scenarioCount: scenariosResult.count,
        message: scenariosResult.message
      });
      
      return res.status(400).json({
        success: false,
        ok: false,
        error: 'NO_SCENARIOS_LOADED',
        message: 'Cannot generate triage cards. No AiCore scenarios are active for this company.',
        action: 'Activate templates in AiCore → Live Scenarios before using the Triage Builder.',
        activeScenarioCount: 0,
        companyName: scenariosResult.companyName,
        trade: scenariosResult.trade
      });
    }
    
    logger.info('[TRIAGE BUILDER V23] Pre-flight PASSED', {
      companyId,
      scenarioCount: scenariosResult.count
    });
    
    // ═══════════════════════════════════════════════════════════════════════
    // GENERATE with scenario injection
    // ═══════════════════════════════════════════════════════════════════════
    const result = await LLMAV23.generateTriageCardV23({
      companyId,
      companyName: scenariosResult.companyName,
      tradeKey: tradeKey || scenariosResult.trade,
      regionProfile,
      triageIdea,
      // V23: Inject active scenarios for LLM-A to map to
      activeScenarios: scenariosResult.scenarios
    });
    
    if (!result.ok) {
      logger.warn('[TRIAGE BUILDER V23] Generation failed', {
        companyId,
        errors: result.errors
      });
      return res.status(400).json(result);
    }
    
    logger.info('[TRIAGE BUILDER V23] Generation success', {
      companyId,
      cardLabel: result.triageCardDraft?.triageLabel,
      validationStatus: result.validationReport?.status,
      scenarioCount: scenariosResult.count
    });
    
    // Include scenario count in response for UI
    res.json({
      ...result,
      activeScenarioCount: scenariosResult.count
    });
    
  } catch (err) {
    logger.error('[TRIAGE BUILDER V23] Error', {
      error: err.message,
      stack: err.stack,
      companyId: req.body?.companyId
    });
    next(err);
  }
});

/**
 * POST /api/admin/triage-builder/save-draft-v23
 * 
 * Save a V23 draft as actual TriageCard (inactive by default)
 */
router.post('/save-draft-v23', async (req, res, next) => {
  try {
    const { companyId, tradeKey, draft, validationReport } = req.body;
    
    if (!companyId || !tradeKey || !draft) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: companyId, tradeKey, draft'
      });
    }
    
    // Convert draft to TriageCard
    const cardData = LLMAV23.draftToTriageCard(companyId, tradeKey, draft, validationReport);
    cardData.createdBy = req.user?._id || null;
    
    // Check for existing card with same label
    const existing = await TriageCard.findOne({
      companyId,
      triageLabel: cardData.triageLabel
    });
    
    if (existing) {
      return res.status(409).json({
        ok: false,
        error: `Card with label "${cardData.triageLabel}" already exists`,
        existingCardId: existing._id
      });
    }
    
    // Create card
    const card = await TriageCard.create(cardData);
    
    // Invalidate cache
    TriageService.invalidateCache(companyId, tradeKey);
    
    logger.info('[TRIAGE BUILDER V23] Card saved', {
      cardId: card._id,
      triageLabel: card.triageLabel,
      companyId,
      validationStatus: validationReport?.status
    });
    
    res.json({
      ok: true,
      card: card.toObject(),
      message: 'Card saved (inactive). Activate when ready.'
    });
    
  } catch (err) {
    logger.error('[TRIAGE BUILDER V23] Save error', {
      error: err.message,
      companyId: req.body?.companyId
    });
    next(err);
  }
});

/**
 * POST /api/admin/triage-builder/validate-utterances
 * 
 * Test utterances against a draft card (LOCAL simulation, no DB)
 * OR against live triage rules (if companyId provided)
 */
router.post('/validate-utterances', async (req, res, next) => {
  try {
    const { companyId, trade, utterances, triageCardDraft, testPlan } = req.body;
    
    // Import the validator helper
    const { simulateTriageMatch, validateAgainstTestPlan } = require('../../services/TriageValidatorHelper');
    
    // Mode 1: Validate draft card against test plan (local simulation)
    if (triageCardDraft && testPlan) {
      const validationReport = validateAgainstTestPlan(
        triageCardDraft.quickRuleConfig,
        testPlan
      );
      
      return res.json({
        ok: true,
        mode: 'draft_simulation',
        validationReport
      });
    }
    
    // Mode 2: Test utterances against live triage rules
    if (companyId && utterances && Array.isArray(utterances)) {
      const results = [];
      
      for (const utterance of utterances) {
        const result = await TriageService.applyQuickTriageRules(utterance, companyId, trade);
        
        results.push({
          utterance,
          matched: result.matched,
          matchedCard: result.triageLabel || null,
          action: result.action || null,
          intent: result.intent || null,
          serviceType: result.serviceType || null
        });
      }
      
      const summary = {
        total: results.length,
        matched: results.filter(r => r.matched).length,
        unmatched: results.filter(r => !r.matched).length
      };
      
      return res.json({
        ok: true,
        mode: 'live_rules',
        results,
        summary
      });
    }
    
    return res.status(400).json({
      ok: false,
      error: 'Provide either (triageCardDraft + testPlan) for draft simulation, or (companyId + utterances[]) for live testing'
    });
    
  } catch (err) {
    logger.error('[TRIAGE BUILDER] Validate utterances error', {
      error: err.message
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
    const { companyId, trade, testInput, cardId } = req.body;

    if (!companyId || !testInput) {
      return res.status(400).json({
        ok: false,
        error: 'Missing required fields: companyId, testInput'
      });
    }

    // If testing a specific card, test that card directly (even if not active)
    if (cardId) {
      const card = await TriageCard.findById(cardId).lean();
      if (!card) {
        return res.status(404).json({
          ok: false,
          error: 'Card not found'
        });
      }
      
      // Test this specific card's keywords
      const normalized = TriageService.normalizeText(testInput);
      const cfg = card.quickRuleConfig || {};
      const mustKeywords = (cfg.keywordsMustHave || []).map(k => TriageService.normalizeText(k)).filter(Boolean);
      const excludeKeywords = (cfg.keywordsExclude || []).map(k => TriageService.normalizeText(k)).filter(Boolean);
      
      // Check if ANY of the must keywords are present (OR logic)
      // Triage cards use alternatives: "smell gas" OR "gas odor" OR "gas leak"
      let anyMustPresent = false;
      const matchedKeywords = [];
      const unmatchedKeywords = [];
      
      for (const keyword of mustKeywords) {
        if (normalized.includes(keyword)) {
          matchedKeywords.push(keyword);
          anyMustPresent = true;  // At least one matched!
        } else {
          unmatchedKeywords.push(keyword);
        }
      }
      
      // Check if any exclude keywords are present (blocks the match)
      let hasExcluded = false;
      const foundExcluded = [];
      for (const keyword of excludeKeywords) {
        if (normalized.includes(keyword)) {
          hasExcluded = true;
          foundExcluded.push(keyword);
        }
      }
      
      // Match if: ANY keyword matched AND no exclude keywords found
      const matched = anyMustPresent && !hasExcluded;
      
      return res.json({
        ok: true,
        testInput,
        normalizedInput: normalized,
        cardTested: {
          id: card._id,
          triageLabel: card.triageLabel,
          displayName: card.displayName,
          isActive: card.isActive
        },
        result: matched ? {
          matched: true,
          source: 'SPECIFIC_CARD_TEST',
          triageCardId: card._id.toString(),
          triageLabel: card.triageLabel,
          displayName: card.displayName,
          intent: card.intent,
          serviceType: card.serviceType,
          action: cfg.action,
          confidence: 1.0
        } : {
          matched: false
        },
        debug: {
          mustKeywords,
          matchedKeywords,
          unmatchedKeywords,
          excludeKeywords,
          foundExcluded,
          matchLogic: 'OR (any keyword matches)',
          reason: !matched ? (
            foundExcluded.length > 0
              ? `Blocked by exclude keyword: ${foundExcluded.join(', ')}`
              : matchedKeywords.length === 0
                ? `No keywords matched. Caller must say one of: ${mustKeywords.join(' OR ')}`
                : mustKeywords.length === 0
                  ? 'No keywords configured on this card'
                  : 'Unknown'
          ) : `Matched keyword: "${matchedKeywords[0]}"`
        },
        warning: !card.isActive 
          ? '⚠️ This card is NOT ACTIVE. Enable it for production use.' 
          : null
      });
    }

    // Default: Test against all active rules
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

// ═══════════════════════════════════════════════════════════════════════════
// RETIRED: HVAC STARTER PACK
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/triage-builder/seed-hvac/:companyId
 * Retired seed endpoint (use triage builder UI instead)
 */
router.post('/seed-hvac/:companyId', async (req, res) => {
  return res.status(410).json({
    ok: false,
    error: 'Seed endpoint retired. Use the triage builder UI to create cards.'
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-SCAN: FULL SCAN (Generate cards for ALL scenarios)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/triage-builder/auto-scan/:companyId
 * 
 * Full scan of Brain 2 - generates cards for ALL active scenarios
 * 
 * Response: {
 *   success: true,
 *   totalScenarios: 47,
 *   cardsGenerated: 47,
 *   categoriesFound: 8,
 *   categories: [{ categoryName, cards: [...] }],
 *   cards: [...],
 *   errors: [],
 *   elapsedMs: 12543
 * }
 */
router.post('/auto-scan/:companyId', async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    const { companyId } = req.params;
    
    logger.info('[TRIAGE AUTO-SCAN] Full scan request', {
      companyId,
      userId: req.user?._id
    });
    
    // Import AutoScanService
    const AutoScanService = require('../../services/AutoScanService');
    
    // Run full scan
    const result = await AutoScanService.scanAndGenerateCards(companyId);
    
    if (!result.success) {
      logger.warn('[TRIAGE AUTO-SCAN] Scan failed', {
        companyId,
        error: result.error,
        message: result.message
      });
      
      return res.status(400).json({
        ok: false,
        error: result.error,
        message: result.message
      });
    }
    
    logger.info('[TRIAGE AUTO-SCAN] ✅ Full scan complete', {
      companyId,
      totalScenarios: result.totalScenarios,
      cardsGenerated: result.cardsGenerated,
      categoriesFound: result.categoriesFound,
      errors: result.errors.length,
      elapsedMs: Date.now() - startTime
    });
    
    res.json({
      ok: true,
      ...result
    });
    
  } catch (err) {
    logger.error('[TRIAGE AUTO-SCAN] Fatal error', {
      error: err.message,
      stack: err.stack,
      companyId: req.params.companyId
    });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-SCAN: RESCAN (Generate cards only for NEW scenarios)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/triage-builder/rescan/:companyId
 * 
 * Rescan Brain 2 - generates cards ONLY for NEW scenarios
 * 
 * Response: {
 *   success: true,
 *   totalScenarios: 52,
 *   existingCards: 47,
 *   newScenariosFound: 5,
 *   newCardsGenerated: 5,
 *   categories: [{ categoryName, cards: [...] }],
 *   newCards: [...],
 *   errors: []
 * }
 */
router.post('/rescan/:companyId', async (req, res, next) => {
  const startTime = Date.now();
  
  try {
    const { companyId } = req.params;
    
    logger.info('[TRIAGE RESCAN] Rescan request', {
      companyId,
      userId: req.user?._id
    });
    
    // Import AutoScanService
    const AutoScanService = require('../../services/AutoScanService');
    
    // Run rescan
    const result = await AutoScanService.rescan(companyId);
    
    if (!result.success) {
      logger.warn('[TRIAGE RESCAN] Rescan failed', {
        companyId,
        error: result.error,
        message: result.message
      });
      
      return res.status(400).json({
        ok: false,
        error: result.error,
        message: result.message
      });
    }
    
    logger.info('[TRIAGE RESCAN] ✅ Rescan complete', {
      companyId,
      totalScenarios: result.totalScenarios,
      existingCards: result.existingCards,
      newScenariosFound: result.newScenariosFound,
      newCardsGenerated: result.newCardsGenerated,
      errors: result.errors.length,
      elapsedMs: Date.now() - startTime
    });
    
    res.json({
      ok: true,
      ...result
    });
    
  } catch (err) {
    logger.error('[TRIAGE RESCAN] Fatal error', {
      error: err.message,
      stack: err.stack,
      companyId: req.params.companyId
    });
    next(err);
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTO-SCAN: SAVE GENERATED CARDS (Batch save after review)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/triage-builder/save-batch/:companyId
 * 
 * Save multiple generated cards at once (after admin review)
 * 
 * Body: {
 *   cards: [{ card draft objects }],
 *   activateAll: false
 * }
 */
router.post('/save-batch/:companyId', async (req, res, next) => {
  try {
    const { companyId } = req.params;
    const { cards, activateAll = false } = req.body;
    
    if (!Array.isArray(cards) || cards.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Cards array is required and must not be empty'
      });
    }
    
    logger.info('[TRIAGE SAVE-BATCH] Saving generated cards', {
      companyId,
      cardCount: cards.length,
      activateAll,
      userId: req.user?._id
    });
    
    const savedCards = [];
    const errors = [];
    
    for (const cardDraft of cards) {
      try {
        // Ensure isActive is set correctly
        cardDraft.isActive = activateAll;
        cardDraft.createdBy = req.user?._id || null;
        
        // Create card in database
        const card = await TriageCard.create(cardDraft);
        savedCards.push(card);
        
        logger.debug('[TRIAGE SAVE-BATCH] Card saved', {
          cardId: card._id,
          triageLabel: card.triageLabel
        });
        
      } catch (error) {
        logger.error('[TRIAGE SAVE-BATCH] Failed to save card', {
          triageLabel: cardDraft.triageLabel,
          error: error.message
        });
        errors.push({
          triageLabel: cardDraft.triageLabel,
          error: error.message
        });
      }
    }
    
    // Invalidate cache after batch save
    const TriageService = require('../../services/TriageService');
    await TriageService.invalidateCache(companyId);
    
    logger.info('[TRIAGE SAVE-BATCH] ✅ Batch save complete', {
      companyId,
      requested: cards.length,
      saved: savedCards.length,
      errors: errors.length
    });
    
    res.json({
      ok: true,
      savedCount: savedCards.length,
      savedCards: savedCards.map(c => c.toObject()),
      errors: errors
    });
    
  } catch (err) {
    logger.error('[TRIAGE SAVE-BATCH] Fatal error', {
      error: err.message,
      companyId: req.params.companyId
    });
    next(err);
  }
});

module.exports = router;
