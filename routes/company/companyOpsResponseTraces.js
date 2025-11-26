/**
 * ============================================================================
 * COMPANYOPS RESPONSE TRACES ROUTES
 * ============================================================================
 * 
 * PURPOSE: API endpoints for fetching ResponseTraceLog data for Control Plane
 * ARCHITECTURE: Per-company trace retrieval for LLM-0 Cortex-Intel debugging
 * AUTH: Requires JWT auth + company access middleware
 * 
 * ENDPOINTS:
 * GET /api/company/:companyId/response-traces?callId=xxx
 * GET /api/company/:companyId/response-traces/calls
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });

const TraceLogger = require('../../services/TraceLogger');
const ResponseTraceLog = require('../../models/ResponseTraceLog');

// GET /api/company/:companyId/response-traces?callId=xxx
router.get('/', async (req, res) => {
  try {
    const companyId = req.params.companyId;
    const { callId, limit } = req.query;

    if (!companyId) {
      return res.status(400).json({ success: false, message: 'companyId required' });
    }

    if (callId) {
      const trace = await TraceLogger.getCallTrace(callId, companyId);
      return res.json({
        success: true,
        mode: 'byCallId',
        callId,
        count: trace.length,
        trace
      });
    }

    // fallback: recent traces
    const lim = Math.min(parseInt(limit || '50', 10), 200);
    const recent = await TraceLogger.getRecentTraces(companyId, lim);
    return res.json({
      success: true,
      mode: 'recent',
      count: recent.length,
      traces: recent
    });
  } catch (err) {
    console.error('[ResponseTraces] GET failed', {
      message: err.message,
      stack: err.stack
    });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

// GET /api/company/:companyId/response-traces/calls
// → list distinct callIds with basic stats
router.get('/calls', async (req, res) => {
  try {
    const companyId = req.params.companyId;
    if (!companyId) {
      return res.status(400).json({ success: false, message: 'companyId required' });
    }

    const { limit } = req.query;
    const lim = Math.min(parseInt(limit || '100', 10), 500);

    const agg = await ResponseTraceLog.aggregate([
      { $match: { companyId } },
      {
        $group: {
          _id: '$callId',
          firstTurn: { $min: '$turnNumber' },
          lastTurn: { $max: '$turnNumber' },
          startTime: { $min: '$timestamp' },
          endTime: { $max: '$timestamp' },
          totalCost: { $sum: '$cost.total' },
          totalTurns: { $sum: 1 }
        }
      },
      { $sort: { startTime: -1 } },
      { $limit: lim }
    ]);

    res.json({
      success: true,
      calls: agg.map((c) => ({
        callId: c._id,
        totalTurns: c.totalTurns,
        totalCost: c.totalCost,
        startTime: c.startTime,
        endTime: c.endTime
      }))
    });
  } catch (err) {
    console.error('[ResponseTraces] /calls failed', {
      message: err.message,
      stack: err.stack
    });
    res.status(500).json({ success: false, message: 'Server error' });
  }
});

module.exports = router;

