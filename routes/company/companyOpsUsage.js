/**
 * ============================================================================
 * COMPANYOPS USAGE & BILLING - READ-ONLY ROUTES
 * ============================================================================
 * 
 * PURPOSE: View usage and billing stats for CompanyOps Console
 * SCOPE: Per-company (all operations scoped by companyId)
 * 
 * ROUTES:
 * - GET /api/company/:companyId/usage
 * - GET /api/company/:companyId/billing-state
 * - GET /api/company/:companyId/usage/export (CSV download)
 * 
 * MODELS: UsageRecord, CompanyBillingState (Phase 1)
 * 
 * KEY FEATURES:
 * - Current billing cycle stats
 * - Minutes used vs included
 * - AI cost breakdown
 * - Tier distribution percentages
 * - Per-call metrics
 * - CSV export
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
 * GET /api/company/:companyId/usage
 * ============================================================================
 * Get detailed usage stats for current billing cycle
 * 
 * Query params:
 * - dateFrom: ISO date string (optional, overrides billing cycle)
 * - dateTo: ISO date string (optional, overrides billing cycle)
 */
router.get('/', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { dateFrom, dateTo } = req.query;

    // Get billing state to determine cycle dates
    const billingState = await CompanyBillingState.findOne({ companyId }).lean();

    // Use custom date range or billing cycle
    let startDate, endDate;
    if (dateFrom && dateTo) {
      startDate = new Date(dateFrom);
      endDate = new Date(dateTo);
    } else if (billingState) {
      startDate = billingState.billingCycleStart;
      endDate = billingState.billingCycleEnd;
    } else {
      // Default: last 30 days
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
    }

    // Get usage records for period
    const usageRecords = await UsageRecord.find({
      companyId,
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    }).lean();

    // Calculate aggregates
    const stats = {
      // Period info
      periodStart: startDate,
      periodEnd: endDate,
      
      // Call counts
      totalCalls: usageRecords.length,
      
      // Duration totals
      totalDurationSeconds: 0,
      totalBilledMinutes: 0,
      
      // LLM usage
      totalLlmTurns: 0,
      
      // Tier usage
      tier1Count: 0,
      tier2Count: 0,
      tier3Count: 0,
      
      // Intent breakdown
      intentCounts: {},
      
      // Cost (if available in billingState)
      estimatedAiCost: billingState?.estimatedAiCost || 0
    };

    // Aggregate from usage records
    usageRecords.forEach(record => {
      stats.totalDurationSeconds += record.rawDurationSeconds || 0;
      stats.totalBilledMinutes += record.billedMinutes || 0;
      stats.totalLlmTurns += record.llmTurns || 0;
      stats.tier1Count += record.tier1Count || 0;
      stats.tier2Count += record.tier2Count || 0;
      stats.tier3Count += record.tier3Count || 0;

      // Count intents
      const intent = record.primaryIntent || 'unknown';
      stats.intentCounts[intent] = (stats.intentCounts[intent] || 0) + 1;
    });

    // Calculate tier distribution percentages
    const totalTierTurns = stats.tier1Count + stats.tier2Count + stats.tier3Count;
    const tierDistribution = totalTierTurns > 0 ? {
      tier1Percent: Math.round((stats.tier1Count / totalTierTurns) * 100),
      tier2Percent: Math.round((stats.tier2Count / totalTierTurns) * 100),
      tier3Percent: Math.round((stats.tier3Count / totalTierTurns) * 100)
    } : {
      tier1Percent: 0,
      tier2Percent: 0,
      tier3Percent: 0
    };

    // Calculate averages
    const avgCostPerCall = stats.totalCalls > 0
      ? (stats.estimatedAiCost / stats.totalCalls).toFixed(4)
      : 0;

    const avgDurationSeconds = stats.totalCalls > 0
      ? Math.round(stats.totalDurationSeconds / stats.totalCalls)
      : 0;

    // Add billing info if available
    let billingInfo = null;
    if (billingState) {
      const overageMinutes = Math.max(0, stats.totalBilledMinutes - (billingState.minutesIncluded || 0));
      
      billingInfo = {
        minutesIncluded: billingState.minutesIncluded || 0,
        minutesUsed: stats.totalBilledMinutes,
        overageMinutes,
        estimatedAiCost: stats.estimatedAiCost,
        cycleStart: billingState.billingCycleStart,
        cycleEnd: billingState.billingCycleEnd
      };
    }

    res.json({
      ok: true,
      data: {
        ...stats,
        tierDistribution,
        avgCostPerCall: parseFloat(avgCostPerCall),
        avgDurationSeconds,
        billing: billingInfo
      }
    });

  } catch (error) {
    logger.error('[CompanyOps Usage] GET failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch usage stats'
    });
  }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/billing-state
 * ============================================================================
 * Get billing state document
 */
router.get('/billing-state', async (req, res) => {
  try {
    const { companyId } = req.params;

    const billingState = await CompanyBillingState.findOne({ companyId }).lean();

    if (!billingState) {
      return res.status(404).json({
        ok: false,
        error: 'Billing state not found. This company may not have any usage yet.'
      });
    }

    res.json({
      ok: true,
      data: billingState
    });

  } catch (error) {
    logger.error('[CompanyOps Usage] GET billing-state failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to fetch billing state'
    });
  }
});

/**
 * ============================================================================
 * GET /api/company/:companyId/usage/export
 * ============================================================================
 * Export usage records as CSV
 * 
 * Query params:
 * - dateFrom: ISO date string
 * - dateTo: ISO date string
 */
router.get('/export', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { dateFrom, dateTo } = req.query;

    // Get billing state for default dates
    const billingState = await CompanyBillingState.findOne({ companyId }).lean();

    // Use custom date range or billing cycle
    let startDate, endDate;
    if (dateFrom && dateTo) {
      startDate = new Date(dateFrom);
      endDate = new Date(dateTo);
    } else if (billingState) {
      startDate = billingState.billingCycleStart;
      endDate = billingState.billingCycleEnd;
    } else {
      // Default: last 30 days
      endDate = new Date();
      startDate = new Date();
      startDate.setDate(startDate.getDate() - 30);
    }

    // Get usage records
    const usageRecords = await UsageRecord.find({
      companyId,
      createdAt: {
        $gte: startDate,
        $lte: endDate
      }
    })
      .sort({ createdAt: -1 })
      .lean();

    // Build CSV
    const csvHeaders = [
      'Call ID',
      'Date',
      'Duration (seconds)',
      'Billed Minutes',
      'LLM Turns',
      'Tier 1 Count',
      'Tier 2 Count',
      'Tier 3 Count',
      'Primary Intent'
    ];

    const csvRows = usageRecords.map(record => [
      record.callId || '',
      new Date(record.createdAt).toISOString(),
      record.rawDurationSeconds || 0,
      record.billedMinutes || 0,
      record.llmTurns || 0,
      record.tier1Count || 0,
      record.tier2Count || 0,
      record.tier3Count || 0,
      record.primaryIntent || 'unknown'
    ]);

    // Format CSV
    const csv = [
      csvHeaders.join(','),
      ...csvRows.map(row => row.map(field => 
        typeof field === 'string' && field.includes(',') 
          ? `"${field}"` 
          : field
      ).join(','))
    ].join('\n');

    // Set response headers
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 
      `attachment; filename="usage-${companyId}-${startDate.toISOString().split('T')[0]}-to-${endDate.toISOString().split('T')[0]}.csv"`
    );

    res.send(csv);

  } catch (error) {
    logger.error('[CompanyOps Usage] Export failed', {
      error: error.message,
      stack: error.stack,
      companyId: req.params.companyId
    });
    
    res.status(500).json({
      ok: false,
      error: 'Failed to export usage data'
    });
  }
});

module.exports = router;

