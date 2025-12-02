/**
 * Agent Excellence API Routes
 * 
 * PURPOSE: Backend endpoints for the AI Agent Excellence Center
 * - Get current score (cached)
 * - Get score history for trending
 * - Get improvement suggestions
 * - Apply suggestions (with human approval)
 * 
 * @module routes/admin/agentExcellence
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const AgentExcellenceService = require('../../services/AgentExcellenceService');
const AgentExcellenceScore = require('../../models/AgentExcellenceScore');

// All routes require authentication
router.use(authenticateJWT);

// ═══════════════════════════════════════════════════════════════════════════
// GET CURRENT SCORE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/agent-excellence/:companyId/score
 * Get current excellence score (from cache or calculate)
 */
router.get('/:companyId/score', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const score = await AgentExcellenceService.calculateScore(companyId);
    
    res.json({
      success: true,
      score: {
        overall: score.overallScore,
        trend: score.trend,
        trendDelta: score.trendDelta,
        categories: score.categories,
        revenue: score.revenue,
        updatedAt: score.updatedAt
      },
      formula: AgentExcellenceScore.getScoringFormula()
    });
    
  } catch (error) {
    logger.error('[EXCELLENCE API] Get score failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET SCORE HISTORY
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/agent-excellence/:companyId/history
 * Get score history for trending charts
 */
router.get('/:companyId/history', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { days = 30 } = req.query;
    
    const history = await AgentExcellenceScore.getScoreHistory(companyId, parseInt(days));
    
    res.json({
      success: true,
      history: history.map(h => ({
        date: h.date,
        overall: h.overallScore,
        trend: h.trend,
        revenuePerCall: h.revenue?.revenuePerCall,
        categories: {
          booking: h.categories?.bookingFlow?.score,
          triage: h.categories?.triageAccuracy?.score,
          knowledge: h.categories?.knowledgeCompleteness?.score,
          memory: h.categories?.customerMemory?.score,
          outcomes: h.categories?.callOutcomes?.score,
          frontline: h.categories?.frontlineIntelligence?.score
        }
      }))
    });
    
  } catch (error) {
    logger.error('[EXCELLENCE API] Get history failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET IMPROVEMENT SUGGESTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/agent-excellence/:companyId/suggestions
 * Get cached LLM improvement suggestions
 */
router.get('/:companyId/suggestions', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const score = await AgentExcellenceScore.getLatestScore(companyId);
    
    if (!score?.llmAnalysis?.topImprovements) {
      return res.json({
        success: true,
        suggestions: [],
        message: 'No suggestions available yet. Run nightly analysis first.'
      });
    }
    
    // Check if cache is expired
    const isExpired = score.llmAnalysis.cacheExpiresAt && 
                      new Date() > score.llmAnalysis.cacheExpiresAt;
    
    res.json({
      success: true,
      suggestions: score.llmAnalysis.topImprovements,
      weeklySummary: score.llmAnalysis.weeklySummary,
      learnings: score.llmAnalysis.learnings,
      generatedAt: score.llmAnalysis.generatedAt,
      isExpired,
      cacheExpiresAt: score.llmAnalysis.cacheExpiresAt
    });
    
  } catch (error) {
    logger.error('[EXCELLENCE API] Get suggestions failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GENERATE SUGGESTIONS (Manual trigger - normally run by nightly job)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/agent-excellence/:companyId/generate-suggestions
 * Manually trigger LLM analysis (admin only)
 */
router.post('/:companyId/generate-suggestions', requireRole(['admin']), async (req, res) => {
  try {
    const { companyId } = req.params;
    
    logger.info('[EXCELLENCE API] Manual suggestion generation triggered', {
      companyId,
      user: req.user.email
    });
    
    const analysis = await AgentExcellenceService.generateImprovementSuggestions(companyId);
    
    res.json({
      success: true,
      suggestions: analysis.topImprovements,
      weeklySummary: analysis.weeklySummary,
      learnings: analysis.learnings,
      generatedAt: analysis.generatedAt
    });
    
  } catch (error) {
    logger.error('[EXCELLENCE API] Generate suggestions failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// APPLY SUGGESTION (With human approval)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * POST /api/admin/agent-excellence/:companyId/apply-suggestion
 * Apply a single suggestion (requires human approval - no auto-apply)
 */
router.post('/:companyId/apply-suggestion', requireRole(['admin', 'company_admin']), async (req, res) => {
  try {
    const { companyId } = req.params;
    const { suggestionIndex } = req.body;
    
    if (suggestionIndex === undefined || suggestionIndex < 0) {
      return res.status(400).json({
        success: false,
        error: 'suggestionIndex is required'
      });
    }
    
    logger.info('[EXCELLENCE API] Applying suggestion', {
      companyId,
      suggestionIndex,
      user: req.user.email
    });
    
    const applied = await AgentExcellenceService.applySuggestion(
      companyId, 
      suggestionIndex,
      req.user.email
    );
    
    res.json({
      success: true,
      applied,
      message: 'Suggestion applied. Changes will take effect on next call.'
    });
    
  } catch (error) {
    logger.error('[EXCELLENCE API] Apply suggestion failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// GET SCORING FORMULA (Transparency)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/agent-excellence/formula
 * Get the transparent scoring formula
 */
router.get('/formula', (req, res) => {
  res.json({
    success: true,
    ...AgentExcellenceScore.getScoringFormula()
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// GET WEEKLY REPORT (For client sharing)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/admin/agent-excellence/:companyId/weekly-report
 * Get formatted weekly report for sharing with clients
 */
router.get('/:companyId/weekly-report', async (req, res) => {
  try {
    const { companyId } = req.params;
    
    const score = await AgentExcellenceScore.getLatestScore(companyId);
    
    if (!score) {
      return res.status(404).json({
        success: false,
        error: 'No score data available'
      });
    }
    
    const report = {
      periodStart: score.rawMetrics?.periodStart,
      periodEnd: score.rawMetrics?.periodEnd,
      
      headline: score.llmAnalysis?.weeklySummary?.headline || 
                `Agent Score: ${score.overallScore}/100`,
      
      metrics: {
        overallScore: score.overallScore,
        trend: score.trend,
        trendDelta: score.trendDelta,
        
        callsHandled: score.rawMetrics?.totalCalls || 0,
        bookingsMade: score.rawMetrics?.totalBookings || 0,
        bookingRate: score.categories?.bookingFlow?.metrics?.bookingRate || 0,
        
        revenuePerCall: score.revenue?.revenuePerCall || 0,
        estimatedRevenue: score.revenue?.estimatedRevenue || 0,
        
        newCustomers: score.rawMetrics?.newCustomers || 0,
        returningCustomers: score.rawMetrics?.returningCustomers || 0,
        recognitionRate: score.categories?.customerMemory?.metrics?.recognitionRate || 0
      },
      
      highlights: score.llmAnalysis?.weeklySummary?.highlights || [],
      concerns: score.llmAnalysis?.weeklySummary?.concerns || [],
      recommendations: score.llmAnalysis?.weeklySummary?.recommendations || [],
      
      learnings: score.llmAnalysis?.learnings || []
    };
    
    res.json({
      success: true,
      report
    });
    
  } catch (error) {
    logger.error('[EXCELLENCE API] Get weekly report failed', {
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;

