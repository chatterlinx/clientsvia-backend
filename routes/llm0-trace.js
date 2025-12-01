/**
 * ============================================================================
 * LLM-0 CORTEX-INTEL TRACE API
 * ============================================================================
 * 
 * PURPOSE: Provides access to Brain-1 trace documents for debugging
 * UI: LLM-0 Cortex-Intel dashboard
 * 
 * ENDPOINTS:
 * - GET /api/llm0/trace/:callId - Get all turns for a call
 * - GET /api/llm0/trace/:callId/:turn - Get specific turn
 * - GET /api/llm0/traces/recent - Get recent traces for a company
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const Brain1Trace = require('../models/Brain1Trace');
const { authMiddleware } = require('../middleware/authMiddleware');

/**
 * GET /api/llm0/trace/:callId
 * Get all turn traces for a call
 */
router.get('/trace/:callId', authMiddleware, async (req, res) => {
    try {
        const { callId } = req.params;
        
        if (!callId) {
            return res.status(400).json({ 
                success: false, 
                error: 'callId is required' 
            });
        }
        
        const traces = await Brain1Trace.getCallTrace(callId);
        
        if (!traces || traces.length === 0) {
            return res.status(404).json({
                success: false,
                error: 'No traces found for this call',
                callId
            });
        }
        
        logger.debug('[LLM-0 TRACE] Retrieved call traces', {
            callId,
            turnCount: traces.length
        });
        
        res.json({
            success: true,
            callId,
            turnCount: traces.length,
            traces
        });
        
    } catch (error) {
        logger.error('[LLM-0 TRACE] Error retrieving traces', {
            callId: req.params.callId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve traces',
            details: error.message
        });
    }
});

/**
 * GET /api/llm0/trace/:callId/:turn
 * Get specific turn trace
 */
router.get('/trace/:callId/:turn', authMiddleware, async (req, res) => {
    try {
        const { callId, turn } = req.params;
        
        if (!callId || !turn) {
            return res.status(400).json({ 
                success: false, 
                error: 'callId and turn are required' 
            });
        }
        
        const trace = await Brain1Trace.findOne({ 
            callId, 
            turn: parseInt(turn, 10) 
        }).lean();
        
        if (!trace) {
            return res.status(404).json({
                success: false,
                error: 'Trace not found',
                callId,
                turn
            });
        }
        
        res.json({
            success: true,
            trace
        });
        
    } catch (error) {
        logger.error('[LLM-0 TRACE] Error retrieving turn trace', {
            callId: req.params.callId,
            turn: req.params.turn,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve trace',
            details: error.message
        });
    }
});

/**
 * GET /api/llm0/traces/recent
 * Get recent traces for a company
 */
router.get('/traces/recent', authMiddleware, async (req, res) => {
    try {
        const { companyId, limit = 50 } = req.query;
        
        // Get companyId from query or from authenticated user
        const targetCompanyId = companyId || req.user?.companyId;
        
        if (!targetCompanyId) {
            return res.status(400).json({
                success: false,
                error: 'companyId is required'
            });
        }
        
        const traces = await Brain1Trace.find({ companyId: targetCompanyId })
            .sort({ createdAt: -1 })
            .limit(parseInt(limit, 10))
            .lean();
        
        // Group by callId for better display
        const callGroups = {};
        for (const trace of traces) {
            if (!callGroups[trace.callId]) {
                callGroups[trace.callId] = {
                    callId: trace.callId,
                    turns: [],
                    firstTimestamp: trace.timestamps?.received,
                    lastAction: null
                };
            }
            callGroups[trace.callId].turns.push({
                turn: trace.turn,
                action: trace.decision?.action,
                triageTag: trace.decision?.triageTag,
                emotion: trace.emotion?.primary,
                brain2Called: trace.brain2?.called,
                tier: trace.brain2?.tier
            });
            callGroups[trace.callId].lastAction = trace.decision?.action;
        }
        
        res.json({
            success: true,
            companyId: targetCompanyId,
            totalTraces: traces.length,
            callCount: Object.keys(callGroups).length,
            calls: Object.values(callGroups).slice(0, 20) // Limit to 20 most recent calls
        });
        
    } catch (error) {
        logger.error('[LLM-0 TRACE] Error retrieving recent traces', {
            companyId: req.query.companyId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve traces',
            details: error.message
        });
    }
});

/**
 * GET /api/llm0/stats
 * Get Brain-1 statistics for AI Performance Monitor
 */
router.get('/stats', authMiddleware, async (req, res) => {
    try {
        const { companyId, hours = 24 } = req.query;
        
        const targetCompanyId = companyId || req.user?.companyId;
        
        if (!targetCompanyId) {
            return res.status(400).json({
                success: false,
                error: 'companyId is required'
            });
        }
        
        const since = new Date(Date.now() - hours * 60 * 60 * 1000);
        
        const [
            totalTurns,
            actionCounts,
            tierCounts,
            avgPerformance
        ] = await Promise.all([
            // Total turns
            Brain1Trace.countDocuments({
                companyId: targetCompanyId,
                createdAt: { $gte: since }
            }),
            
            // Action distribution
            Brain1Trace.aggregate([
                { $match: { companyId: targetCompanyId, createdAt: { $gte: since } } },
                { $group: { _id: '$decision.action', count: { $sum: 1 } } }
            ]),
            
            // Brain-2 tier distribution
            Brain1Trace.aggregate([
                { $match: { companyId: targetCompanyId, createdAt: { $gte: since }, 'brain2.called': true } },
                { $group: { _id: '$brain2.tier', count: { $sum: 1 } } }
            ]),
            
            // Average performance
            Brain1Trace.aggregate([
                { $match: { companyId: targetCompanyId, createdAt: { $gte: since } } },
                { 
                    $group: { 
                        _id: null, 
                        avgTotalMs: { $avg: '$performance.totalMs' },
                        avgBrain1Ms: { $avg: '$performance.brain1Ms' },
                        avgBrain2Ms: { $avg: '$performance.brain2Ms' }
                    } 
                }
            ])
        ]);
        
        res.json({
            success: true,
            companyId: targetCompanyId,
            timeRange: `${hours} hours`,
            stats: {
                totalTurns,
                actions: Object.fromEntries(actionCounts.map(a => [a._id, a.count])),
                brain2Tiers: Object.fromEntries(tierCounts.map(t => [`tier${t._id}`, t.count])),
                performance: avgPerformance[0] || { avgTotalMs: 0, avgBrain1Ms: 0, avgBrain2Ms: 0 }
            }
        });
        
    } catch (error) {
        logger.error('[LLM-0 TRACE] Error retrieving stats', {
            companyId: req.query.companyId,
            error: error.message
        });
        
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve stats',
            details: error.message
        });
    }
});

module.exports = router;

