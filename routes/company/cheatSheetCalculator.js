/**
 * ============================================================================
 * CHEAT SHEET - CALCULATOR STATS ROUTES
 * ============================================================================
 * 
 * PURPOSE: Per-company usage and cost breakdown for AI tuning
 * SCOPE: Per-company (all operations scoped by companyId)
 * 
 * ROUTES:
 * - GET /api/company/:companyId/calculator-stats
 * 
 * DATA SOURCES:
 * - UsageRecord (per-call metrics)
 * - CompanyBillingState (billing cycle info)
 * 
 * KEY FEATURES:
 * - Last 7/30 days usage breakdown
 * - Tier1/Tier2/Tier3 turn counts and percentages
 * - Estimated cost vs plan
 * - Cost per call
 * - Warning thresholds (e.g., Tier3 > 10%)
 * 
 * SAME DATA AS CompanyOps → Usage, but framed for AI tuning
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true }); // Inherit :companyId from parent

const UsageRecord = require('../../models/UsageRecord');
const CompanyBillingState = require('../../models/CompanyBillingState');
const { authenticateJWT } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// All routes require authentication
router.use(authenticateJWT);

/**
 * ============================================================================
 * GET /api/company/:companyId/calculator-stats
 * ============================================================================
 * Get usage and cost stats for AI tuning
 * 
 * Query params:
 * - period: string ("7d" or "30d", default "7d")
 */
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { period = '7d' } = req.query;

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    
    if (period === '30d') {
      startDate.setDate(startDate.getDate() - 30);
    } else {
      startDate.setDate(startDate.getDate() - 7);
    }

    // Get usage records for period
    const usageRecords = await UsageRecord.find({
      companyId,
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    }).lean();

    // Get billing state
    const billingState = await CompanyBillingState.findOne({ companyId }).lean();

    // Calculate aggregates
    const stats = {
      // Period info
      period,
      periodStart: startDate,
      periodEnd: endDate,
      
      // Call counts
      totalCalls: usageRecords.length,
      
      // Duration
      totalMinutes: 0,
      
      // Tier usage counts
      tier1Turns: 0,
      tier2Turns: 0,
      tier3Turns: 0,
      totalTurns: 0,
      
      // LLM turns
      totalLlmTurns: 0
    };

    // Aggregate from usage records
    usageRecords.forEach(record => {
      stats.totalMinutes += record.billedMinutes || 0;
      stats.totalLlmTurns += record.llmTurns || 0;
      stats.tier1Turns += record.tier1Count || 0;
      stats.tier2Turns += record.tier2Count || 0;
      stats.tier3Turns += record.tier3Count || 0;
    });

    stats.totalTurns = stats.tier1Turns + stats.tier2Turns + stats.tier3Turns;

    // Calculate tier distribution percentages
    const tierDistribution = stats.totalTurns > 0 ? {
      tier1Percent: Math.round((stats.tier1Turns / stats.totalTurns) * 100),
      tier2Percent: Math.round((stats.tier2Turns / stats.totalTurns) * 100),
      tier3Percent: Math.round((stats.tier3Turns / stats.totalTurns) * 100)
    } : {
      tier1Percent: 0,
      tier2Percent: 0,
      tier3Percent: 0
    };

    // Calculate cost estimates (rough approximations)
    const estimatedCost = {
      tier1: 0, // Free
      tier2: (stats.tier2Turns * 0.0001).toFixed(4), // ~$0.0001 per turn
      tier3: (stats.tier3Turns * 0.001).toFixed(4), // ~$0.001 per turn
      total: ((stats.tier2Turns * 0.0001) + (stats.tier3Turns * 0.001)).toFixed(4)
    };

    // Calculate cost per call
    const avgCostPerCall = stats.totalCalls > 0
      ? (estimatedCost.total / stats.totalCalls).toFixed(4)
      : 0;

    // Generate warnings
    const warnings = [];

    if (tierDistribution.tier3Percent > 10) {
      warnings.push({
        type: 'tier3_overuse',
        severity: 'warning',
        message: `Tier 3 usage is ${tierDistribution.tier3Percent}% (target < 10%). Consider reviewing LLM-0 Cortex-Intel for optimization opportunities.`,
        recommendation: 'Review high-confidence Tier 3 responses and convert them to Tier 1 rules in the Knowledgebase.'
      });
    }

    if (tierDistribution.tier3Percent > 20) {
      warnings.push({
        type: 'tier3_critical',
        severity: 'critical',
        message: `Tier 3 usage is critically high at ${tierDistribution.tier3Percent}% (target < 10%). Immediate action recommended.`,
        recommendation: 'Check if scenarios are properly configured. Many Tier 3 calls indicate missing knowledge base entries.'
      });
    }

    if (stats.totalCalls > 0 && tierDistribution.tier1Percent < 70) {
      warnings.push({
        type: 'tier1_low',
        severity: 'info',
        message: `Tier 1 usage is ${tierDistribution.tier1Percent}% (target > 70%). Room for optimization.`,
        recommendation: 'Add more scenarios and filler words to improve Tier 1 matching.'
      });
    }

    // Billing comparison (if billing state exists)
    let billingComparison = null;
    if (billingState) {
      const minutesIncluded = billingState.minutesIncluded || 0;
      const minutesUsed = billingState.minutesUsed || 0;
      const minutesRemaining = Math.max(0, minutesIncluded - minutesUsed);
      const utilizationPercent = minutesIncluded > 0
        ? Math.round((minutesUsed / minutesIncluded) * 100)
        : 0;

      billingComparison = {
        minutesIncluded,
        minutesUsed,
        minutesRemaining,
        utilizationPercent,
        estimatedAiCost: billingState.estimatedAiCost || 0,
        overageMinutes: billingState.overageMinutes || 0
      };

      // Add billing warnings
      if (utilizationPercent > 80) {
        warnings.push({
          type: 'minutes_high',
          severity: 'warning',
          message: `You've used ${utilizationPercent}% of your included minutes this cycle.`,
          recommendation: 'Monitor usage closely to avoid overage charges.'
        });
      }
    }

    res.json({
      ok: true,
      data: {
        ...stats,
        tierDistribution,
        estimatedCost: {
          ...estimatedCost,
          currency: 'USD'
        },
        avgCostPerCall: parseFloat(avgCostPerCall),
        warnings,
        billingComparison,
        
        // Optimization score (0-100)
        optimizationScore: calculateOptimizationScore(tierDistribution, warnings),
        
        // Recommendations
        recommendations: generateRecommendations(tierDistribution, stats)
      }
    });

  } catch (error) {
    logger.error('[Cheat Sheet Calculator] GET failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch calculator stats'
    });
  }
});

/**
 * Calculate optimization score (0-100)
 * Higher is better
 */
function calculateOptimizationScore(tierDistribution, warnings) {
  let score = 100;

  // Penalize high Tier 3 usage
  if (tierDistribution.tier3Percent > 10) {
    score -= (tierDistribution.tier3Percent - 10) * 2; // -2 points per % above 10%
  }

  // Reward high Tier 1 usage
  if (tierDistribution.tier1Percent < 70) {
    score -= (70 - tierDistribution.tier1Percent) * 0.5; // -0.5 points per % below 70%
  }

  // Penalize critical warnings
  const criticalWarnings = warnings.filter(w => w.severity === 'critical');
  score -= criticalWarnings.length * 15;

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Generate actionable recommendations
 */
function generateRecommendations(tierDistribution, stats) {
  const recommendations = [];

  if (tierDistribution.tier3Percent > 10) {
    recommendations.push({
      priority: 'high',
      action: 'Review LLM-0 Cortex-Intel',
      detail: 'Analyze Tier 3 patterns and convert high-confidence responses to Tier 1 rules.',
      estimatedSavings: `Could save ~$${((stats.tier3Turns * 0.5) * 0.001).toFixed(2)}/period`
    });
  }

  if (tierDistribution.tier1Percent < 70) {
    recommendations.push({
      priority: 'medium',
      action: 'Expand Knowledge Base',
      detail: 'Add more scenarios, synonyms, and filler words to improve Tier 1 matching.',
      estimatedImpact: `Could improve T1 by ${Math.min(20, 70 - tierDistribution.tier1Percent)}%`
    });
  }

  if (stats.totalCalls > 0 && stats.totalLlmTurns / stats.totalCalls > 5) {
    recommendations.push({
      priority: 'low',
      action: 'Review Conversation Flow',
      detail: 'Average LLM turns per call is high. Consider streamlining booking flow.',
      estimatedImpact: 'Faster bookings, lower costs'
    });
  }

  return recommendations;
}

module.exports = router;

