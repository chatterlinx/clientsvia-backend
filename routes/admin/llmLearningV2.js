/**
 * ============================================================================
 * LLM LEARNING CONSOLE - V2 ROUTES
 * ============================================================================
 * 
 * PURPOSE: Enhanced API endpoints for LLM Learning Console
 * VERSION: 2.0 - Multi-source support + latency tracking
 * 
 * ROUTES:
 * - GET    /api/admin/llm-learning/v2/overview
 * - GET    /api/admin/llm-learning/v2/suggestions
 * - GET    /api/admin/llm-learning/v2/tasks
 * - PATCH  /api/admin/llm-learning/v2/suggestions/:id/approve
 * - PATCH  /api/admin/llm-learning/v2/suggestions/:id/reject
 * - PATCH  /api/admin/llm-learning/v2/suggestions/:id/snooze
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();

const ProductionLLMSuggestion = require('../../models/ProductionLLMSuggestion');
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// Apply admin-only protection
router.use(authenticateJWT, requireRole('admin'));

/**
 * ============================================================================
 * GET /api/admin/llm-learning/v2/overview
 * ============================================================================
 * PURPOSE: Summary numbers for the top stats cards
 * 
 * RESPONSE:
 * {
 *   todayCostUsd: 2.40,
 *   weekCostUsd: 18.50,
 *   roiSavingsUsd: 120.00,
 *   tier3ReductionPercent: 15,
 *   totalSuggestions: 487,
 *   appliedSuggestions: 123
 * }
 * ============================================================================
 */
router.get('/overview', async (req, res, next) => {
  try {
    logger.info('[LLM LEARNING V2] Fetching overview stats');
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);

    // Today's cost
    const [todayAgg] = await ProductionLLMSuggestion.aggregate([
      { $match: { callDate: { $gte: today } } },
      { 
        $group: { 
          _id: null, 
          costUsd: { $sum: '$costUsd' }, 
          count: { $sum: 1 } 
        } 
      },
    ]);

    // This week's cost
    const [weekAgg] = await ProductionLLMSuggestion.aggregate([
      { $match: { callDate: { $gte: weekAgo } } },
      { 
        $group: { 
          _id: null, 
          costUsd: { $sum: '$costUsd' }, 
          count: { $sum: 1 } 
        } 
      },
    ]);

    // Total suggestions & applied
    const [totals, applied] = await Promise.all([
      ProductionLLMSuggestion.countDocuments({}),
      ProductionLLMSuggestion.countDocuments({ status: 'applied' }),
    ]);

    const todayCost = todayAgg?.costUsd ?? 0;
    const weekCost = weekAgg?.costUsd ?? 0;
    const appliedCount = applied || 0;
    const totalCount = totals || 0;

    // TODO: ROI savings calculation (requires estimatedSavingsUsd field)
    const roiSavings = 0;
    
    // TODO: Tier 3 reduction (requires baseline vs current comparison)
    const tier3Reduction = 0;

    logger.info(`[LLM LEARNING V2] Overview: Today $${todayCost.toFixed(2)}, Week $${weekCost.toFixed(2)}, Total ${totalCount}, Applied ${appliedCount}`);

    res.json({
      todayCostUsd: todayCost,
      weekCostUsd: weekCost,
      roiSavingsUsd: roiSavings,
      tier3ReductionPercent: tier3Reduction,
      totalSuggestions: totalCount,
      appliedSuggestions: appliedCount,
    });
  } catch (err) {
    logger.error('[LLM LEARNING V2] Error fetching overview:', err);
    next(err);
  }
});

/**
 * ============================================================================
 * GET /api/admin/llm-learning/v2/suggestions
 * ============================================================================
 * PURPOSE: Paginated list with filters for the main console UI
 * 
 * QUERY PARAMS:
 * - templateId: Filter by template
 * - companyId: Filter by company (or 'null' for template tests)
 * - callSource: 'template-test' | 'company-test' | 'production'
 * - status: 'pending' | 'applied' | 'rejected' | 'snoozed'
 * - priority: 'low' | 'medium' | 'high' | 'critical'
 * - suggestionType: 'ADD_KEYWORDS' | etc.
 * - from: ISO date string (start of date range)
 * - to: ISO date string (end of date range)
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 25, max: 100)
 * 
 * RESPONSE:
 * {
 *   items: [...],
 *   total: 487,
 *   page: 1,
 *   pages: 20
 * }
 * ============================================================================
 */
router.get('/suggestions', async (req, res, next) => {
  try {
    let {
      templateId,
      companyId,
      callSource,
      status,
      priority,
      suggestionType,
      from,
      to,
      page = 1,
      limit = 25,
    } = req.query;

    page = Number(page) || 1;
    limit = Math.min(Number(limit) || 25, 100);

    logger.info(`[LLM LEARNING V2] Fetching suggestions: page=${page}, limit=${limit}, filters=${JSON.stringify({ templateId, companyId, callSource, status, priority })}`);

    const filter = {};

    if (templateId) filter.templateId = templateId;
    if (companyId) filter.companyId = companyId === 'null' ? null : companyId;
    if (callSource) filter.callSource = callSource;
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (suggestionType) filter.suggestionType = suggestionType;

    if (from || to) {
      filter.callDate = {};
      if (from) filter.callDate.$gte = new Date(from);
      if (to) filter.callDate.$lte = new Date(to);
    }

    const skip = (page - 1) * limit;

    const [items, total] = await Promise.all([
      ProductionLLMSuggestion.find(filter)
        .sort({ callDate: -1, priority: -1 })
        .skip(skip)
        .limit(limit)
        .lean()
        .exec(),
      ProductionLLMSuggestion.countDocuments(filter),
    ]);

    logger.info(`[LLM LEARNING V2] Found ${items.length} suggestions (${total} total)`);

    res.json({
      items,
      total,
      page,
      pages: Math.ceil(total / limit) || 1,
    });
  } catch (err) {
    logger.error('[LLM LEARNING V2] Error fetching suggestions:', err);
    next(err);
  }
});

/**
 * ============================================================================
 * GET /api/admin/llm-learning/v2/tasks
 * ============================================================================
 * PURPOSE: Lightweight "task list" grouped by template + company
 * Used for the TODO-style view
 * 
 * RESPONSE:
 * {
 *   items: [
 *     {
 *       templateId: '...',
 *       templateName: 'Universal AI Brain',
 *       companyId: '...',
 *       companyName: 'Royal Plumbing',
 *       pendingCount: 23,
 *       snoozedCount: 5,
 *       highestPriority: 'high',
 *       latestCallDate: '2025-11-07T...'
 *     },
 *     ...
 *   ]
 * }
 * ============================================================================
 */
router.get('/tasks', async (req, res, next) => {
  try {
    logger.info('[LLM LEARNING V2] Fetching task list');
    
    const pipeline = [
      {
        $match: {
          status: { $in: ['pending', 'snoozed'] },
        },
      },
      {
        $group: {
          _id: {
            templateId: '$templateId',
            companyId: '$companyId',
          },
          templateId: { $first: '$templateId' },
          templateName: { $first: '$templateName' },
          companyId: { $first: '$companyId' },
          companyName: { $first: '$companyName' },
          pendingCount: {
            $sum: {
              $cond: [{ $eq: ['$status', 'pending'] }, 1, 0],
            },
          },
          snoozedCount: {
            $sum: {
              $cond: [{ $eq: ['$status', 'snoozed'] }, 1, 0],
            },
          },
          highestPriority: { $max: '$priority' },
          latestCallDate: { $max: '$callDate' },
        },
      },
      {
        $sort: { latestCallDate: -1 },
      },
    ];

    const groups = await ProductionLLMSuggestion.aggregate(pipeline).exec();

    logger.info(`[LLM LEARNING V2] Found ${groups.length} task groups`);

    res.json({ items: groups });
  } catch (err) {
    logger.error('[LLM LEARNING V2] Error fetching tasks:', err);
    next(err);
  }
});

/**
 * ============================================================================
 * PATCH /api/admin/llm-learning/v2/suggestions/:id/approve
 * ============================================================================
 * PURPOSE: Mark a suggestion as applied
 * 
 * BODY: (optional)
 * {
 *   notes: 'Applied successfully'
 * }
 * ============================================================================
 */
router.patch('/suggestions/:id/approve', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { notes } = req.body || {};
    const adminEmail = req.user?.email || 'system';

    logger.info(`[LLM LEARNING V2] Approving suggestion ${id} by ${adminEmail}`);

    const update = {
      status: 'applied',
      appliedBy: adminEmail,
      appliedAt: new Date(),
      reviewedBy: adminEmail,
    };

    if (notes) update.notes = notes;

    const doc = await ProductionLLMSuggestion.findByIdAndUpdate(id, update, {
      new: true,
    });

    if (!doc) {
      logger.warn(`[LLM LEARNING V2] Suggestion ${id} not found`);
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    logger.info(`[LLM LEARNING V2] ✅ Suggestion ${id} approved successfully`);

    res.json({ 
      success: true,
      message: 'Suggestion approved and marked as applied',
      item: doc 
    });
  } catch (err) {
    logger.error('[LLM LEARNING V2] Error approving suggestion:', err);
    next(err);
  }
});

/**
 * ============================================================================
 * PATCH /api/admin/llm-learning/v2/suggestions/:id/reject
 * ============================================================================
 * PURPOSE: Mark a suggestion as rejected
 * 
 * BODY: (optional)
 * {
 *   reason: 'Not relevant for this template'
 * }
 * ============================================================================
 */
router.patch('/suggestions/:id/reject', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body || {};
    const adminEmail = req.user?.email || 'system';

    logger.info(`[LLM LEARNING V2] Rejecting suggestion ${id} by ${adminEmail}`);

    const update = {
      status: 'rejected',
      rejectedBy: adminEmail,
      rejectedReason: reason || null,
      reviewedBy: adminEmail,
    };

    const doc = await ProductionLLMSuggestion.findByIdAndUpdate(id, update, {
      new: true,
    });

    if (!doc) {
      logger.warn(`[LLM LEARNING V2] Suggestion ${id} not found`);
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    logger.info(`[LLM LEARNING V2] ❌ Suggestion ${id} rejected`);

    res.json({ 
      success: true,
      message: 'Suggestion rejected',
      item: doc 
    });
  } catch (err) {
    logger.error('[LLM LEARNING V2] Error rejecting suggestion:', err);
    next(err);
  }
});

/**
 * ============================================================================
 * PATCH /api/admin/llm-learning/v2/suggestions/:id/snooze
 * ============================================================================
 * PURPOSE: Snooze a suggestion until a certain date
 * 
 * BODY:
 * {
 *   until: '2025-11-15T00:00:00.000Z' // ISO date string
 * }
 * ============================================================================
 */
router.patch('/suggestions/:id/snooze', async (req, res, next) => {
  try {
    const { id } = req.params;
    const { until } = req.body || {};
    const adminEmail = req.user?.email || 'system';

    logger.info(`[LLM LEARNING V2] Snoozing suggestion ${id} until ${until} by ${adminEmail}`);

    const snoozeUntil = until ? new Date(until) : null;

    const update = {
      status: 'snoozed',
      snoozeUntil,
      reviewedBy: adminEmail,
    };

    const doc = await ProductionLLMSuggestion.findByIdAndUpdate(id, update, {
      new: true,
    });

    if (!doc) {
      logger.warn(`[LLM LEARNING V2] Suggestion ${id} not found`);
      return res.status(404).json({ error: 'Suggestion not found' });
    }

    logger.info(`[LLM LEARNING V2] 💤 Suggestion ${id} snoozed until ${snoozeUntil}`);

    res.json({ 
      success: true,
      message: `Suggestion snoozed until ${snoozeUntil ? snoozeUntil.toISOString() : 'indefinitely'}`,
      item: doc 
    });
  } catch (err) {
    logger.error('[LLM LEARNING V2] Error snoozing suggestion:', err);
    next(err);
  }
});

module.exports = router;

