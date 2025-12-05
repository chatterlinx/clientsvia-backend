// ═════════════════════════════════════════════════════════════════════════════
// TRIAGE CARDS API ROUTES
// ═════════════════════════════════════════════════════════════════════════════
// Purpose: RESTful API for Triage Card management
// Scope: Per-company, multi-tenant isolated
// Auth: Requires JWT + admin/owner role
// ═════════════════════════════════════════════════════════════════════════════

const express = require('express');
const router = express.Router({ mergeParams: true }); // Inherit :companyId from parent
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const TriageCardService = require('../../services/TriageCardService');
const TriageCard = require('../../models/TriageCard');
const logger = require('../../utils/logger');

// ─────────────────────────────────────────────────────────────────────────────
// MIDDLEWARE: All routes require authentication
// ─────────────────────────────────────────────────────────────────────────────

router.use(authenticateJWT);
router.use(requireRole('admin', 'owner'));

// ─────────────────────────────────────────────────────────────────────────────
// CREATE NEW TRIAGE CARD
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/company/:companyId/triage-cards
// Body: { frontlineIntelBlock, triageMap, responses, category, trade, serviceTypes, status }
// ─────────────────────────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const cardData = req.body;
    const createdBy = req.user?.id;

    logger.info('[TRIAGE CARDS API] Create card request', { 
      companyId, 
      trade: cardData.trade,
      categorySlug: cardData.category?.slug 
    });

    // Validation
    if (!cardData.frontlineIntelBlock) {
      return res.status(400).json({ 
        success: false, 
        error: 'frontlineIntelBlock is required' 
      });
    }

    if (!cardData.triageMap || !Array.isArray(cardData.triageMap) || cardData.triageMap.length === 0) {
      return res.status(400).json({ 
        success: false, 
        error: 'triageMap must be a non-empty array' 
      });
    }

    if (!cardData.responses || !Array.isArray(cardData.responses) || cardData.responses.length < 5) {
      return res.status(400).json({ 
        success: false, 
        error: 'responses must contain at least 5 variations' 
      });
    }

    if (!cardData.category || !cardData.category.slug) {
      return res.status(400).json({ 
        success: false, 
        error: 'category with slug is required' 
      });
    }

    if (!cardData.trade) {
      return res.status(400).json({ 
        success: false, 
        error: 'trade is required' 
      });
    }

    if (!cardData.serviceTypes || !Array.isArray(cardData.serviceTypes)) {
      return res.status(400).json({ 
        success: false, 
        error: 'serviceTypes must be an array' 
      });
    }

    // Create card
    const card = await TriageCardService.createCard(companyId, cardData, createdBy);

    res.status(201).json({
      success: true,
      card: card.toObject()
    });

  } catch (error) {
    logger.error('[TRIAGE CARDS API] Create failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET ALL TRIAGE CARDS FOR COMPANY
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/company/:companyId/triage-cards?status=ACTIVE&trade=HVAC
// ─────────────────────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { status, trade } = req.query;

    logger.debug('[TRIAGE CARDS API] List cards request', { companyId, status, trade });

    const filter = {};
    if (status) filter.status = status;
    if (trade) filter.trade = trade;

    const cards = await TriageCardService.getCardsByCompany(companyId, filter);

    res.json({
      success: true,
      count: cards.length,
      cards: cards.map(c => c.toObject())
    });

  } catch (error) {
    logger.error('[TRIAGE CARDS API] List failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET SINGLE TRIAGE CARD
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/company/:companyId/triage-cards/:cardId
// ─────────────────────────────────────────────────────────────────────────────

router.get('/:cardId', async (req, res) => {
  try {
    const { companyId, cardId } = req.params;

    logger.debug('[TRIAGE CARDS API] Get card request', { companyId, cardId });

    const card = await TriageCardService.getCardById(companyId, cardId);

    res.json({
      success: true,
      card: card.toObject()
    });

  } catch (error) {
    logger.error('[TRIAGE CARDS API] Get card failed', { error: error.message });
    
    if (error.message === 'Triage Card not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// UPDATE TRIAGE CARD
// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/company/:companyId/triage-cards/:cardId
// Body: { frontlineIntelBlock?, triageMap?, responses?, category?, status? }
// ─────────────────────────────────────────────────────────────────────────────

router.patch('/:cardId', async (req, res) => {
  try {
    const { companyId, cardId } = req.params;
    const updates = req.body;
    const modifiedBy = req.user?.id;

    logger.info('[TRIAGE CARDS API] Update card request', { companyId, cardId });

    const card = await TriageCardService.updateCard(companyId, cardId, updates, modifiedBy);

    res.json({
      success: true,
      card: card.toObject()
    });

  } catch (error) {
    logger.error('[TRIAGE CARDS API] Update failed', { error: error.message });
    
    if (error.message === 'Triage Card not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE TRIAGE CARD
// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/company/:companyId/triage-cards/:cardId
// ─────────────────────────────────────────────────────────────────────────────

router.delete('/:cardId', async (req, res) => {
  try {
    const { companyId, cardId } = req.params;

    logger.info('[TRIAGE CARDS API] Delete card request', { companyId, cardId });

    await TriageCardService.deleteCard(companyId, cardId);

    res.json({
      success: true,
      message: 'Triage Card deleted successfully'
    });

  } catch (error) {
    logger.error('[TRIAGE CARDS API] Delete failed', { error: error.message });
    
    if (error.message === 'Triage Card not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ACTIVATE TRIAGE CARD
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/company/:companyId/triage-cards/:cardId/activate
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:cardId/activate', async (req, res) => {
  try {
    const { companyId, cardId } = req.params;

    logger.info('[TRIAGE CARDS API] Activate card request', { companyId, cardId });

    const card = await TriageCardService.activateCard(companyId, cardId);

    res.json({
      success: true,
      card: card.toObject(),
      message: 'Triage Card activated. Compiled config updated.'
    });

  } catch (error) {
    logger.error('[TRIAGE CARDS API] Activate failed', { error: error.message });
    
    if (error.message === 'Triage Card not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DEACTIVATE TRIAGE CARD
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/company/:companyId/triage-cards/:cardId/deactivate
// ─────────────────────────────────────────────────────────────────────────────

router.post('/:cardId/deactivate', async (req, res) => {
  try {
    const { companyId, cardId } = req.params;

    logger.info('[TRIAGE CARDS API] Deactivate card request', { companyId, cardId });

    const card = await TriageCardService.deactivateCard(companyId, cardId);

    res.json({
      success: true,
      card: card.toObject(),
      message: 'Triage Card deactivated. Compiled config updated.'
    });

  } catch (error) {
    logger.error('[TRIAGE CARDS API] Deactivate failed', { error: error.message });
    
    if (error.message === 'Triage Card not found') {
      return res.status(404).json({
        success: false,
        error: error.message
      });
    }

    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BULK ENABLE ALL TRIAGE CARDS
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/company/:companyId/triage-cards/bulk-enable
// Purpose: Enable all triage cards for this company at once
// ─────────────────────────────────────────────────────────────────────────────

router.post('/bulk-enable', async (req, res) => {
  try {
    const { companyId } = req.params;

    logger.info('[TRIAGE CARDS API] Bulk enable all cards', { companyId });

    const result = await TriageCard.updateMany(
      { companyId, isActive: false },
      { $set: { isActive: true, updatedAt: new Date() } }
    );

    // Invalidate cache so THE BRAIN picks up the changes
    await TriageCardService.invalidateCache(companyId);

    logger.info('[TRIAGE CARDS API] Bulk enable complete', { 
      companyId, 
      modifiedCount: result.modifiedCount 
    });

    res.json({
      success: true,
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} Triage Cards enabled`
    });

  } catch (error) {
    logger.error('[TRIAGE CARDS API] Bulk enable failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BULK DISABLE ALL TRIAGE CARDS
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/company/:companyId/triage-cards/bulk-disable
// Purpose: Disable all triage cards for this company at once
// ─────────────────────────────────────────────────────────────────────────────

router.post('/bulk-disable', async (req, res) => {
  try {
    const { companyId } = req.params;

    logger.info('[TRIAGE CARDS API] Bulk disable all cards', { companyId });

    const result = await TriageCard.updateMany(
      { companyId, isActive: true },
      { $set: { isActive: false, updatedAt: new Date() } }
    );

    // Invalidate cache so THE BRAIN picks up the changes
    await TriageCardService.invalidateCache(companyId);

    logger.info('[TRIAGE CARDS API] Bulk disable complete', { 
      companyId, 
      modifiedCount: result.modifiedCount 
    });

    res.json({
      success: true,
      modifiedCount: result.modifiedCount,
      message: `${result.modifiedCount} Triage Cards disabled`
    });

  } catch (error) {
    logger.error('[TRIAGE CARDS API] Bulk disable failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// INVALIDATE COMPILED TRIAGE CACHE
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/company/:companyId/triage-cards/invalidate-cache
// Purpose: Clear cached compiled config when manual rules or cards change
// ─────────────────────────────────────────────────────────────────────────────

router.post('/invalidate-cache', async (req, res) => {
  try {
    const { companyId } = req.params;

    logger.info('[TRIAGE CARDS API] 🧠 Cache invalidation requested', { companyId });

    await TriageCardService.invalidateCache(companyId);

    res.json({
      success: true,
      message: 'Compiled triage cache invalidated. THE BRAIN will rebuild on next call.'
    });

  } catch (error) {
    logger.error('[TRIAGE CARDS API] Cache invalidation failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEST THE BRAIN (TEST WHICH RULE FIRES FOR SAMPLE INPUT)
// ─────────────────────────────────────────────────────────────────────────────
// POST /api/company/:companyId/triage-cards/test-match
// Body: { callerInput: "my ac is not cooling", llmKeywords: ["not cooling", "ac"] }
// Purpose: Test which triage rule would fire for a given input
// ─────────────────────────────────────────────────────────────────────────────

router.post('/test-match', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { callerInput, llmKeywords } = req.body;

    if (!callerInput) {
      return res.status(400).json({
        success: false,
        error: 'callerInput is required'
      });
    }

    logger.info('[TRIAGE CARDS API] 🧪 Test THE BRAIN request', { companyId, callerInput });

    // Load compiled triage config
    const compiledConfig = await TriageCardService.compileActiveCards(companyId);

    // Import FrontlineIntel for matching logic
    const FrontlineIntel = require('../../services/FrontlineIntel');

    // Run matching logic (same as production)
    const matchResult = FrontlineIntel.matchTriageRules(
      callerInput,
      compiledConfig.triageRules || [],
      {
        llmKeywords: llmKeywords || [],
        llmIntent: 'test'
      }
    );

    if (matchResult) {
      logger.info('[TRIAGE CARDS API] 🧪 Test result: MATCH FOUND', {
        source: matchResult.source,
        priority: matchResult.priority,
        serviceType: matchResult.serviceType,
        action: matchResult.action
      });

      res.json({
        success: true,
        matched: true,
        result: {
          ruleMatched: {
            source: matchResult.source,
            priority: matchResult.priority,
            keywords: matchResult.keywords,
            excludeKeywords: matchResult.excludeKeywords,
            serviceType: matchResult.serviceType,
            action: matchResult.action,
            categorySlug: matchResult.categorySlug,
            explanation: matchResult.explanation,
            matchMethod: matchResult.matchMethod,
            matchedKeywords: matchResult.matchedKeywords
          },
          matchedAtIndex: matchResult.ruleIndex,
          totalRulesChecked: compiledConfig.triageRules.length,
          whatHappensNext: this.explainAction(matchResult.action)
        }
      });
    } else {
      logger.warn('[TRIAGE CARDS API] 🧪 Test result: NO MATCH (should not happen!)');

      res.json({
        success: true,
        matched: false,
        result: {
          message: 'No rule matched (fallback rule should always match)',
          totalRulesChecked: compiledConfig.triageRules.length
        }
      });
    }

  } catch (error) {
    logger.error('[TRIAGE CARDS API] Test match failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET COMPILED CONFIG (FOR DEBUGGING)
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/company/:companyId/triage-cards/compiled/config
// Purpose: View the final merged triage table (manual + AI cards + fallback)
// ─────────────────────────────────────────────────────────────────────────────

router.get('/compiled/config', async (req, res) => {
  try {
    const { companyId } = req.params;

    logger.debug('[TRIAGE CARDS API] Get compiled config request', { companyId });

    const compiledConfig = await TriageCardService.compileActiveCards(companyId);

    res.json({
      success: true,
      compiledConfig
    });

  } catch (error) {
    logger.error('[TRIAGE CARDS API] Get compiled config failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DIAGNOSTIC: Check response content of all triage cards
// ─────────────────────────────────────────────────────────────────────────────
// GET /api/company/:companyId/triage-cards/diagnose-content
// Returns analysis of which cards have response content and which don't
// ─────────────────────────────────────────────────────────────────────────────

router.get('/diagnose-content', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    logger.info('[TRIAGE CARDS API] Running content diagnostic', { companyId });
    
    const cards = await TriageCard.find({ 
      companyId,
      isActive: true 
    }).lean();
    
    const analysis = {
      companyId,
      totalActiveCards: cards.length,
      cardsWithContent: [],
      cardsWithoutContent: [],
      contentSourcesSummary: {}
    };
    
    for (const card of cards) {
      const sources = [];
      
      // Check all possible response sources
      const checks = [
        { field: 'frontlinePlaybook.openingLines[0]', value: card.frontlinePlaybook?.openingLines?.[0] },
        { field: 'frontlinePlaybook.openingLine', value: card.frontlinePlaybook?.openingLine },
        { field: 'frontlinePlaybook.frontlineGoal', value: card.frontlinePlaybook?.frontlineGoal },
        { field: 'quickRuleConfig.explanation', value: card.quickRuleConfig?.explanation },
        { field: 'quickRuleConfig.acknowledgment', value: card.quickRuleConfig?.acknowledgment },
        { field: 'actionPlaybooks.explainAndPush.explanationLines[0]', value: card.actionPlaybooks?.explainAndPush?.explanationLines?.[0] },
        { field: 'actionPlaybooks.takeMessage.introLines[0]', value: card.actionPlaybooks?.takeMessage?.introLines?.[0] },
        { field: 'actionPlaybooks.escalateToHuman.preTransferLines[0]', value: card.actionPlaybooks?.escalateToHuman?.preTransferLines?.[0] },
        { field: 'response', value: card.response },
      ];
      
      for (const check of checks) {
        if (check.value && check.value.trim()) {
          sources.push({
            field: check.field,
            preview: check.value.substring(0, 80) + (check.value.length > 80 ? '...' : '')
          });
          analysis.contentSourcesSummary[check.field] = (analysis.contentSourcesSummary[check.field] || 0) + 1;
        }
      }
      
      const cardInfo = {
        id: card._id.toString(),
        triageLabel: card.triageLabel,
        displayName: card.displayName,
        action: card.quickRuleConfig?.action,
        sources
      };
      
      if (sources.length > 0) {
        analysis.cardsWithContent.push(cardInfo);
      } else {
        analysis.cardsWithoutContent.push(cardInfo);
      }
    }
    
    // Add recommendations
    analysis.recommendations = [];
    if (analysis.cardsWithoutContent.length > 0) {
      analysis.recommendations.push({
        severity: 'warning',
        message: `${analysis.cardsWithoutContent.length} cards have NO response content - they will use generic fallback`,
        fix: 'Add frontlinePlaybook.openingLines or quickRuleConfig.explanation to these cards'
      });
    }
    
    logger.info('[TRIAGE CARDS API] Content diagnostic complete', {
      companyId,
      totalCards: cards.length,
      withContent: analysis.cardsWithContent.length,
      withoutContent: analysis.cardsWithoutContent.length
    });
    
    res.json({
      success: true,
      diagnostic: analysis
    });
    
  } catch (error) {
    logger.error('[TRIAGE CARDS API] Content diagnostic failed', { error: error.message });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Explain what happens for each action
// ─────────────────────────────────────────────────────────────────────────────

router.explainAction = function(action) {
  const explanations = {
    'DIRECT_TO_3TIER': 'Call immediately routes to 3-Tier Scenario Matching with this serviceType and categorySlug',
    'EXPLAIN_AND_PUSH': 'Agent explains the situation to caller first, then routes to 3-Tier if caller agrees',
    'ESCALATE_TO_HUMAN': 'Call transfers to human agent immediately, no 3-Tier processing',
    'TAKE_MESSAGE': 'Agent takes a message for callback, no 3-Tier processing',
    'END_CALL_POLITE': 'Call ends politely, no 3-Tier processing'
  };
  
  return explanations[action] || 'Unknown action';
};

module.exports = router;

