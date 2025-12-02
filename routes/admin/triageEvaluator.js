/**
 * Triage Evaluator API Routes
 * 
 * PURPOSE: Backend endpoints for the Triage Command Center
 * - Run full evaluation
 * - Get version history
 * - Apply recommendations
 * - Rollback to previous version
 * 
 * @module routes/admin/triageEvaluator
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const TriageEvaluator = require('../../services/TriageEvaluator');
const TriageVersion = require('../../models/TriageVersion');
const TriageCardMetrics = require('../../models/TriageCardMetrics');
const TriageCard = require('../../models/TriageCard');

// All routes require authentication
router.use(authenticateJWT);

// ═══════════════════════════════════════════════════════════════════════════
// RUN FULL EVALUATION
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/triage-evaluator/:companyId/evaluate
 * Run a full evaluation of triage cards
 */
router.post('/:companyId/evaluate', requireRole('admin', 'company_admin'), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { businessDescription } = req.body;
    
    logger.info('[TRIAGE EVALUATOR API] Starting evaluation', {
      companyId,
      user: req.user.email
    });
    
    const result = await TriageEvaluator.runFullEvaluation({
      companyId,
      businessDescription,
      adminUserId: req.user._id
    });
    
    res.json({
      success: true,
      evaluation: result
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Evaluation failed', {
      error: error.message,
      stack: error.stack
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET QUICK STATS (Without full evaluation)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/triage-evaluator/:companyId/quick-stats
 * Get quick stats without running full LLM evaluation
 */
router.get('/:companyId/quick-stats', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const [cards, metrics, latestVersion] = await Promise.all([
      TriageCard.find({ companyId }).lean(),
      TriageCardMetrics.getCardHealthSummary(companyId, 7),
      TriageVersion.getCurrentVersion(companyId)
    ]);
    
    const activeCards = cards.filter(c => c.isActive);
    const totalKeywords = cards.reduce((sum, c) => sum + (c.mustHaveKeywords?.length || 0), 0);
    
    // Calculate simple grade based on card health
    const avgHealth = metrics.length > 0
      ? metrics.reduce((sum, m) => sum + (m.avgF1 || 0), 0) / metrics.length
      : 0;
    
    const quickGrade = avgHealth >= 0.9 ? 'A' :
                       avgHealth >= 0.8 ? 'B' :
                       avgHealth >= 0.7 ? 'C' :
                       avgHealth >= 0.6 ? 'D' : 'F';
    
    res.json({
      success: true,
      stats: {
        totalCards: cards.length,
        activeCards: activeCards.length,
        disabledCards: cards.length - activeCards.length,
        totalKeywords,
        avgKeywordsPerCard: cards.length > 0 
          ? Math.round(totalKeywords / cards.length * 10) / 10 
          : 0,
        quickGrade,
        avgHealthScore: Math.round(avgHealth * 100),
        lastEvaluated: latestVersion?.appliedAt,
        currentVersion: latestVersion?.version,
        currentVersionName: latestVersion?.versionName
      }
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Quick stats failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// VERSION MANAGEMENT
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/triage-evaluator/:companyId/versions
 * Get version history
 */
router.get('/:companyId/versions', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { limit = 20 } = req.query;
    
    const versions = await TriageVersion.getVersionHistory(companyId, parseInt(limit));
    
    res.json({
      success: true,
      versions
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Get versions failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/triage-evaluator/:companyId/versions/:version
 * Get a specific version's details
 */
router.get('/:companyId/versions/:version', async (req, res) => {
  try {
    const { companyId, version } = req.params;
    
    const versionDoc = await TriageVersion.findOne({ 
      companyId, 
      version: parseInt(version) 
    });
    
    if (!versionDoc) {
      return res.status(404).json({
        success: false,
        error: 'Version not found'
      });
    }
    
    res.json({
      success: true,
      version: versionDoc
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Get version failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/triage-evaluator/:companyId/versions/:version/rollback
 * Rollback to a specific version
 */
router.post('/:companyId/versions/:version/rollback', requireRole('admin', 'company_admin'), async (req, res) => {
  try {
    const { companyId, version } = req.params;
    
    logger.info('[TRIAGE EVALUATOR API] Rolling back', {
      companyId,
      targetVersion: version,
      user: req.user.email
    });
    
    const result = await TriageVersion.rollbackToVersion({
      companyId,
      targetVersion: parseInt(version),
      appliedBy: {
        userId: req.user._id,
        email: req.user.email,
        role: req.user.role
      },
      TriageCard
    });
    
    res.json({
      success: true,
      message: `Rolled back to version ${version}`,
      newVersion: result.newVersion.version,
      cardsRestored: result.restoredCards.length
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Rollback failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/triage-evaluator/:companyId/versions/compare
 * Compare two versions
 */
router.get('/:companyId/versions/compare', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { versionA, versionB } = req.query;
    
    if (!versionA || !versionB) {
      return res.status(400).json({
        success: false,
        error: 'Both versionA and versionB are required'
      });
    }
    
    const diff = await TriageVersion.compareVersions(
      companyId, 
      parseInt(versionA), 
      parseInt(versionB)
    );
    
    res.json({
      success: true,
      diff
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Compare versions failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// APPLY RECOMMENDATIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/triage-evaluator/:companyId/apply-recommendation
 * Apply a single recommendation
 */
router.post('/:companyId/apply-recommendation', requireRole('admin', 'company_admin'), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { recommendation } = req.body;
    
    if (!recommendation) {
      return res.status(400).json({
        success: false,
        error: 'Recommendation is required'
      });
    }
    
    logger.info('[TRIAGE EVALUATOR API] Applying recommendation', {
      companyId,
      type: recommendation.type,
      user: req.user.email
    });
    
    const result = await TriageEvaluator.applyRecommendation({
      companyId,
      recommendation,
      appliedBy: {
        userId: req.user._id,
        email: req.user.email,
        role: req.user.role
      }
    });
    
    res.json({
      success: true,
      result
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Apply recommendation failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/triage-evaluator/:companyId/apply-all
 * Apply all high-priority recommendations at once
 */
router.post('/:companyId/apply-all', requireRole('admin', 'company_admin'), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { recommendations, priority = 'high' } = req.body;
    
    if (!recommendations || !Array.isArray(recommendations)) {
      return res.status(400).json({
        success: false,
        error: 'Recommendations array is required'
      });
    }
    
    logger.info('[TRIAGE EVALUATOR API] Applying all recommendations', {
      companyId,
      count: recommendations.length,
      priority,
      user: req.user.email
    });
    
    const results = [];
    const errors = [];
    
    for (const recommendation of recommendations) {
      try {
        const result = await TriageEvaluator.applyRecommendation({
          companyId,
          recommendation,
          appliedBy: {
            userId: req.user._id,
            email: req.user.email,
            role: req.user.role
          }
        });
        results.push({ recommendation: recommendation.title, ...result });
      } catch (err) {
        errors.push({ recommendation: recommendation.title, error: err.message });
      }
    }
    
    res.json({
      success: errors.length === 0,
      applied: results.length,
      failed: errors.length,
      results,
      errors
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Apply all failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CARD METRICS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/triage-evaluator/:companyId/card-health
 * Get per-card health metrics
 */
router.get('/:companyId/card-health', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { days = 7 } = req.query;
    
    const health = await TriageCardMetrics.getCardHealthSummary(companyId, parseInt(days));
    
    res.json({
      success: true,
      cardHealth: health
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Get card health failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/admin/triage-evaluator/:companyId/unmatched-phrases
 * Get phrases that didn't match any card
 */
router.get('/:companyId/unmatched-phrases', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { days = 30, limit = 50 } = req.query;
    
    const phrases = await TriageCardMetrics.getUnmatchedPhrases(
      companyId, 
      parseInt(days), 
      parseInt(limit)
    );
    
    res.json({
      success: true,
      unmatchedPhrases: phrases
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Get unmatched phrases failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/triage-evaluator/:companyId/mark-false-positive
 * Mark a card match as false positive
 */
router.post('/:companyId/mark-false-positive', requireRole('admin', 'company_admin'), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { cardId, phrase, expectedCard, callId } = req.body;
    
    if (!cardId || !phrase) {
      return res.status(400).json({
        success: false,
        error: 'cardId and phrase are required'
      });
    }
    
    await TriageCardMetrics.markFalsePositive({
      companyId,
      cardId,
      phrase,
      expectedCard,
      callId,
      markedBy: req.user.email
    });
    
    res.json({
      success: true,
      message: 'Marked as false positive'
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Mark false positive failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/admin/triage-evaluator/:companyId/mark-missed-match
 * Mark a phrase that should have matched a card
 */
router.post('/:companyId/mark-missed-match', requireRole('admin', 'company_admin'), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { cardId, triageLabel, phrase, matchedCard, callId } = req.body;
    
    if (!cardId || !phrase) {
      return res.status(400).json({
        success: false,
        error: 'cardId and phrase are required'
      });
    }
    
    await TriageCardMetrics.markMissedMatch({
      companyId,
      cardId,
      triageLabel,
      phrase,
      matchedCard,
      callId,
      markedBy: req.user.email
    });
    
    res.json({
      success: true,
      message: 'Marked as missed match'
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Mark missed match failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// CREATE VERSION SNAPSHOT (Manual)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/triage-evaluator/:companyId/create-version
 * Create a named version snapshot
 */
router.post('/:companyId/create-version', requireRole('admin', 'company_admin'), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { versionName, changeSummary } = req.body;
    
    const version = await TriageVersion.createVersion({
      companyId,
      versionName: versionName || `manual-${new Date().toISOString().split('T')[0]}`,
      changeType: 'MANUAL_EDIT',
      changeSummary: changeSummary || 'Manual version snapshot',
      appliedBy: {
        userId: req.user._id,
        email: req.user.email,
        role: req.user.role
      },
      TriageCard
    });
    
    res.json({
      success: true,
      version: {
        version: version.version,
        versionName: version.versionName,
        cardCount: version.cards.length
      }
    });
    
  } catch (error) {
    logger.error('[TRIAGE EVALUATOR API] Create version failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

