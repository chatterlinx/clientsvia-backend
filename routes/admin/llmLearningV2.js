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
// V22 NUKED: AIGatewaySuggestion removed (AI Gateway legacy)
// V22 uses IntentResolutionPath for learned patterns
// Stub to prevent crashes
const AIGatewaySuggestion = {
  create: async () => ({}),
  find: () => ({ sort: () => ({ skip: () => ({ limit: () => ({ lean: async () => [] }) }) }) }),
  findById: async () => null,
  countDocuments: async () => 0
};
const GlobalInstantResponseTemplate = require('../../models/GlobalInstantResponseTemplate');  // For Apply handlers
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const logger = require('../../utils/logger');

// Apply admin-only protection
// NOTE: authenticateJWT checks for token in cookies (httpOnly) OR Authorization header
// Admin UI stores JWT in httpOnly cookie after login
router.use(authenticateJWT);
router.use(requireRole('admin'));

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
      severity,
      suggestionType,
      slowOnly,
      from,
      to,
      page = 1,
      pageSize = 25,
    } = req.query;

    page = Number(page) || 1;
    pageSize = Math.min(Number(pageSize) || 25, 100);

    logger.info(`[LLM LEARNING V2] Fetching suggestions: page=${page}, pageSize=${pageSize}, filters=${JSON.stringify({ templateId, companyId, callSource, status, priority, severity, slowOnly })}`);

    const filter = {};

    if (templateId) filter.templateId = templateId;
    if (companyId) filter.companyId = companyId === 'null' ? null : companyId;
    if (callSource) filter.callSource = callSource;
    if (status) filter.status = status;
    if (priority) filter.priority = priority;
    if (severity) filter.severity = severity;
    if (suggestionType) filter.suggestionType = suggestionType;

    // slowOnly filter: show only calls with high latency or dead air
    if (slowOnly === 'true') {
      filter.$or = [
        { tier3LatencyMs: { $gte: 500 } }, // Tier 3 took >500ms
        { maxDeadAirMs: { $gte: 2000 } },  // Dead air >2 seconds
        { overallLatencyMs: { $gte: 1000 } } // Overall >1 second
      ];
    }

    if (from || to) {
      filter.callDate = {};
      if (from) filter.callDate.$gte = new Date(from);
      if (to) filter.callDate.$lte = new Date(to);
    }

    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      ProductionLLMSuggestion.find(filter)
        .sort({ callDate: -1, severity: -1, priority: -1 })
        .skip(skip)
        .limit(pageSize)
        .lean()
        .exec(),
      ProductionLLMSuggestion.countDocuments(filter),
    ]);

    logger.info(`[LLM LEARNING V2] Found ${items.length} suggestions (${total} total)`);

    res.json({
      items,
      total,
      page,
      pageSize,
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
 *       taskType: 'COVERAGE_GAP',
 *       summary: 'Add reschedule appointment scenario',
 *       rootCauseReason: 'Multiple calls asking to move existing appointment...',
 *       severity: 'high',
 *       priority: 'high',
 *       affectedCalls: 7,
 *       suggestionIds: ['6730d2f3a21c...', '6730d3025d8b...']
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
            suggestionType: '$suggestionType',
          },
          templateId: { $first: '$templateId' },
          templateName: { $first: '$templateName' },
          companyId: { $first: '$companyId' },
          companyName: { $first: '$companyName' },
          taskType: { $first: '$suggestionType' }, // Use suggestionType as taskType
          summary: { $first: '$suggestionSummary' }, // Use first suggestion's summary
          rootCauseReason: { $first: '$rootCauseReason' }, // Use first suggestion's reason
          severity: { $max: '$severity' }, // Highest severity in group
          priority: { $max: '$priority' }, // Highest priority in group
          affectedCalls: { $sum: '$similarCallCount' }, // Sum of all affected calls
          suggestionIds: { $push: '$_id' }, // Collect all suggestion IDs
        },
      },
      {
        $sort: { severity: -1, priority: -1, affectedCalls: -1 },
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

// ============================================================================
// 📋 PHASE C.0 – NEW ROUTES: Tier-3 Event Suggestions
// ============================================================================
// These routes feed the console v2 with AIGatewaySuggestion docs created by
// LLMLearningWorker from Tier-3 usage events.
// ============================================================================

/**
 * ============================================================================
 * GET /api/admin/llm-learning/v2/suggestions-c0
 * ============================================================================
 * PURPOSE: Fetch Tier-3-based suggestions from AIGatewaySuggestion
 * (This powers the main console v2 UI with real Tier-3 events)
 * 
 * QUERY PARAMS:
 * - templateId: Filter by template
 * - companyId: Filter by company
 * - status: 'pending' | 'applied' | 'rejected'
 * - severity: 'low' | 'medium' | 'high'
 * - limit: Max results (default 100)
 * 
 * RESPONSE:
 * {
 *   success: true,
 *   data: [
 *     {
 *       id,
 *       issueCode,
 *       issueLabel,
 *       why: "Tier path: T1 (0.25) -> T2 (0.30) -> T3...",
 *       severity,
 *       status,
 *       latencyMs,
 *       tierPath,
 *       callSource,
 *       createdAt
 *     }
 *   ]
 * }
 * ============================================================================
 */
router.get('/v2/suggestions-c0', async (req, res) => {
  try {
    const {
      templateId,
      companyId,
      status,
      severity,
      limit = 100,
    } = req.query;

    const query = {};

    if (templateId) query.templateId = templateId;
    if (companyId) query.companyId = companyId;
    if (status) query.status = status;
    if (severity) query.priority = severity;

    const docs = await AIGatewaySuggestion.find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit));

    const rows = docs.map(doc => {
      const m = doc.metadata || {};
      return {
        id: doc._id,
        templateId: doc.templateId,
        companyId: doc.companyId,
        issueCode: m.issueCode || 'ADD_KEYWORDS',
        issueLabel: mapIssueCodeToLabel(m.issueCode),
        why: buildWhyText(doc),
        severity: doc.priority || 'medium',
        status: doc.status,
        latencyMs: m.latencyMs ?? null,
        tierPath: m.tierPath || null,
        callSource: doc.callSource || 'voice',
        createdAt: doc.createdAt,
      };
    });

    res.json({ success: true, data: rows });
  } catch (err) {
    logger.error('[LLM LEARNING V2] /v2/suggestions-c0 error', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ============================================================================
 * POST /api/admin/llm-learning/v2/suggestions-c0/:id/apply
 * ============================================================================
 * PURPOSE: Apply a Tier-3-based suggestion (update scenario with keywords/triggers)
 * Supports: ADD_KEYWORDS, TIGHTEN_NEGATIVE_TRIGGERS
 * 
 * RESPONSE:
 * { success: true }
 * ============================================================================
 */
router.post('/v2/suggestions-c0/:id/apply', async (req, res) => {
  try {
    const suggestion = await AIGatewaySuggestion.findById(req.params.id);
    if (!suggestion) {
      return res.status(404).json({ success: false, error: 'Suggestion not found' });
    }

    const m = suggestion.metadata || {};
    const issueCode = m.issueCode;
    const targetScenarioId = m.targetScenarioId;

    if (!targetScenarioId) {
      // Nothing to apply, just mark applied
      suggestion.status = 'applied';
      suggestion.updatedAt = new Date();
      await suggestion.save();
      return res.json({ success: true });
    }

    const template = await GlobalInstantResponseTemplate.findById(suggestion.templateId);
    if (!template) {
      return res.status(404).json({ success: false, error: 'Template not found' });
    }

    const scenario = template.scenarios.id(targetScenarioId);
    if (!scenario) {
      return res.status(404).json({ success: false, error: 'Scenario not found on template' });
    }

    // Handle ADD_KEYWORDS
    if (issueCode === 'ADD_KEYWORDS' && Array.isArray(m.suggestedKeywords)) {
      const existing = new Set(scenario.triggers || []);
      for (const kw of m.suggestedKeywords) {
        if (typeof kw === 'string' && kw.trim()) {
          existing.add(kw.trim());
        }
      }
      scenario.triggers = Array.from(existing);
      logger.info('[LLM LEARNING V2] Applied ADD_KEYWORDS', {
        scenarioId: targetScenarioId,
        count: m.suggestedKeywords.length,
      });
    }

    // Handle TIGHTEN_NEGATIVE_TRIGGERS
    if (issueCode === 'TIGHTEN_NEGATIVE_TRIGGERS' && Array.isArray(m.suggestedNegativePhrases)) {
      const existingNeg = new Set(scenario.negativeUserPhrases || []);
      for (const phrase of m.suggestedNegativePhrases) {
        if (typeof phrase === 'string' && phrase.trim()) {
          existingNeg.add(phrase.trim());
        }
      }
      scenario.negativeUserPhrases = Array.from(existingNeg);
      logger.info('[LLM LEARNING V2] Applied TIGHTEN_NEGATIVE_TRIGGERS', {
        scenarioId: targetScenarioId,
        count: m.suggestedNegativePhrases.length,
      });
    }

    // TODO: Handle ADD_SYNONYMS if TemplateNLPConfig exists

    await template.save();

    suggestion.status = 'applied';
    suggestion.updatedAt = new Date();
    await suggestion.save();

    res.json({ success: true });
  } catch (err) {
    logger.error('[LLM LEARNING V2] Apply failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * ============================================================================
 * POST /api/admin/llm-learning/v2/suggestions-c0/:id/reject
 * ============================================================================
 * PURPOSE: Reject a Tier-3-based suggestion (no changes to scenario)
 * 
 * RESPONSE:
 * { success: true }
 * ============================================================================
 */
router.post('/v2/suggestions-c0/:id/reject', async (req, res) => {
  try {
    const suggestion = await AIGatewaySuggestion.findById(req.params.id);
    if (!suggestion) {
      return res.status(404).json({ success: false, error: 'Suggestion not found' });
    }

    suggestion.status = 'rejected';
    suggestion.updatedAt = new Date();
    await suggestion.save();

    logger.info('[LLM LEARNING V2] Suggestion rejected', { id: req.params.id });

    res.json({ success: true });
  } catch (err) {
    logger.error('[LLM LEARNING V2] Reject failed', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Map issueCode to human-readable label
 */
function mapIssueCodeToLabel(code) {
  const map = {
    ADD_KEYWORDS: 'Add keywords',
    ADD_SYNONYMS: 'Add synonyms',
    TIGHTEN_NEGATIVE_TRIGGERS: 'Tighten negative triggers',
    SPLIT_SCENARIO: 'Split scenario',
    ADD_NEW_SCENARIO: 'Add new scenario',
  };
  return map[code] || 'Improve matching';
}

/**
 * Build a rich "WHY" explanation from suggestion metadata
 */
function buildWhyText(suggestion) {
  const m = suggestion.metadata || {};
  const parts = [];

  if (m.tierPath) {
    parts.push(`Tier path: ${m.tierPath}.`);
  }
  if (typeof m.tier1Score === 'number' && typeof m.tier1Threshold === 'number') {
    parts.push(
      `Tier 1 score (${m.tier1Score.toFixed(2)}) was below threshold (${m.tier1Threshold.toFixed(2)}).`
    );
  }
  if (typeof m.tier2Score === 'number' && typeof m.tier2Threshold === 'number') {
    parts.push(
      `Tier 2 score (${m.tier2Score.toFixed(2)}) was below threshold (${m.tier2Threshold.toFixed(2)}).`
    );
  }
  if (typeof m.tier3Confidence === 'number') {
    parts.push(`Tier 3 confidence: ${m.tier3Confidence.toFixed(2)}.`);
  }
  if (m.tier3Rationale) {
    parts.push(`LLM rationale: ${m.tier3Rationale}`);
  }
  if (m.summary) {
    parts.push(`Summary: ${m.summary}`);
  }

  return parts.join(' ');
}

module.exports = router;

