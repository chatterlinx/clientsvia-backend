/**
 * ============================================================================
 * CALL REVIEW API — Real Call Data for Call Console
 * ClientVia Platform · Agent Console
 * 
 * Provides access to CallTranscriptV2 data with inline viewing support.
 * No JSON downloads required - all data viewable directly in the UI.
 * ============================================================================
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const { authenticateJWT } = require('../../middleware/auth');
const { requirePermission, PERMISSIONS } = require('../../middleware/rbac');
const CallTranscriptV2 = require('../../models/CallTranscriptV2');
const CallSummary = require('../../models/CallSummary');
const CallTranscript = require('../../models/CallTranscript');

const MODULE_ID = 'CALL_REVIEW_API';

/**
 * GET /:companyId/calls
 * List recent calls with pagination and filtering
 */
router.get('/:companyId/calls', 
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    const { 
      page = 1, 
      limit = 25,
      search = '',
      dateRange = 'week',
      status = ''
    } = req.query;

    try {
      const pageNum = Math.max(1, parseInt(page, 10));
      const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10)));
      const skip = (pageNum - 1) * limitNum;

      // Build query
      const query = { companyId };

      // Date range filter
      if (dateRange && dateRange !== 'all') {
        const now = new Date();
        let startDate;
        
        switch (dateRange) {
          case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
          case 'yesterday':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            break;
          case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        }
        
        if (startDate) {
          query['callMeta.startedAt'] = { $gte: startDate };
        }
      }

      // Search filter (phone number or CallSid)
      if (search) {
        query.$or = [
          { callSid: { $regex: search, $options: 'i' } },
          { 'callMeta.from': { $regex: search.replace(/\D/g, ''), $options: 'i' } }
        ];
      }

      // Detect whether CallTranscriptV2 has data for this company
      const v2Count = await CallTranscriptV2.countDocuments({ companyId });

      if (v2Count > 0) {
        // ─────────────────────────────────────────────────────────────
        // PRIMARY SOURCE: CallTranscriptV2 (new canonical)
        // ─────────────────────────────────────────────────────────────
        const total = await CallTranscriptV2.countDocuments(query);

        const calls = await CallTranscriptV2.find(query)
          .select('callSid callMeta firstTurnTs lastTurnTs turns trace updatedAt')
          .sort({ updatedAt: -1 })
          .skip(skip)
          .limit(limitNum)
          .lean();

        const formattedCalls = calls.map(call => {
          const conversationTurns = (call.turns || []).filter(t => 
            t.speaker === 'caller' || t.speaker === 'agent'
          );
          
          const duration = call.callMeta?.twilioDurationSeconds || 
            (call.callMeta?.endedAt && call.callMeta?.startedAt
              ? Math.floor((new Date(call.callMeta.endedAt) - new Date(call.callMeta.startedAt)) / 1000)
              : null);

          return {
            callSid: call.callSid,
            fromPhone: call.callMeta?.from || null,
            startTime: call.callMeta?.startedAt || call.firstTurnTs,
            durationSeconds: duration,
            turnCount: conversationTurns.length,
            hasTrace: (call.trace || []).length > 0,
            lastUpdated: call.updatedAt
          };
        });

        const totalPages = Math.ceil(total / limitNum);

        return res.json({
          success: true,
          page: pageNum,
          limit: limitNum,
          total,
          totalPages,
          calls: formattedCalls
        });
      }

      // ─────────────────────────────────────────────────────────────
      // FALLBACK SOURCE: CallSummary + CallTranscript (legacy V111)
      // This restores Call Console for environments without V2 data.
      // ─────────────────────────────────────────────────────────────
      const summaryQuery = { companyId };
      if (search) {
        const searchRegex = new RegExp(search, 'i');
        const phoneSearch = search.replace(/\D/g, '');
        summaryQuery.$or = [
          { twilioSid: searchRegex },
          { callId: searchRegex },
          { phone: phoneSearch ? new RegExp(phoneSearch, 'i') : searchRegex }
        ];
      }
      if (query['callMeta.startedAt']) {
        summaryQuery.startedAt = query['callMeta.startedAt'];
      }

      const total = await CallSummary.countDocuments(summaryQuery);
      const callDocs = await CallSummary.find(summaryQuery)
        .sort({ startedAt: -1 })
        .skip(skip)
        .limit(limitNum)
        .lean();

      const formattedCalls = callDocs.map(call => ({
        callSid: call.twilioSid || call.callId,
        fromPhone: call.phone || call.from || null,
        startTime: call.startedAt || null,
        durationSeconds: call.durationSeconds || null,
        turnCount: call.turnCount || 0,
        hasFallback: call.routingTier === 3 || (call.llmCost || 0) > 0,
        hasHardcodedViolation: false,
        problemCount: 0
      }));

      const totalPages = Math.ceil(total / limitNum);

      return res.json({
        success: true,
        page: pageNum,
        limit: limitNum,
        total,
        totalPages,
        calls: formattedCalls
      });

    } catch (error) {
      logger.error(`[${MODULE_ID}] Error listing calls`, {
        companyId,
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        success: false,
        error: 'Failed to list calls',
        message: error.message
      });
    }
  }
);

/**
 * GET /:companyId/calls/:callSid
 * Get full call details with transcript and trace
 */
router.get('/:companyId/calls/:callSid',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId, callSid } = req.params;

    try {
      // Try V2 first
      const call = await CallTranscriptV2.findOne({ companyId, callSid }).lean();

      if (!call) {
        // ─────────────────────────────────────────────────────────────
        // FALLBACK: CallSummary + CallTranscript (legacy)
        // ─────────────────────────────────────────────────────────────
        const summary = await CallSummary.findOne({
          companyId,
          $or: [{ twilioSid: callSid }, { callId: callSid }]
        }).lean();

        if (!summary) {
          return res.status(404).json({
            success: false,
            error: 'Call not found'
          });
        }

        let transcript = null;
        if (summary.transcriptRef) {
          transcript = await CallTranscript.findById(summary.transcriptRef).lean();
        } else {
          transcript = await CallTranscript.findOne({ callId: callSid }).lean();
        }

        const rawTurns = transcript?.turns || [];
        const turns = rawTurns.map((t, idx) => ({
          turnNumber: Number.isFinite(t?.turn) ? t.turn : (idx + 1),
          speaker: t.speaker || 'caller',
          kind: t.kind || (t.speaker === 'agent' ? 'CONVERSATION_AGENT' : 'CONVERSATION_CALLER'),
          text: t.text || '',
          timestamp: t.timestamp || summary.startedAt || null,
          source: t.source || null,
          provenance: t.provenance || null
        }));

        const durationSeconds = summary.durationSeconds || (summary.startedAt && summary.endedAt
          ? Math.floor((new Date(summary.endedAt) - new Date(summary.startedAt)) / 1000)
          : null);

        return res.json({
          success: true,
          call: {
            callSid: summary.twilioSid || summary.callId,
            companyId: summary.companyId,
            fromPhone: summary.phone || summary.from || null,
            toPhone: summary.toPhone || summary.to || null,
            startTime: summary.startedAt || null,
            endTime: summary.endedAt || null,
            durationSeconds,
            llmUsage: null
          },
          turns,
          trace: [],
          events: [],
          problems: [],
          callMeta: {
            from: summary.phone || summary.from || null,
            to: summary.toPhone || summary.to || null,
            startedAt: summary.startedAt || null,
            endedAt: summary.endedAt || null
          }
        });
      }

      // Separate conversation turns from system turns
      const conversationTurns = (call.turns || [])
        .filter(t => t.speaker === 'caller' || t.speaker === 'agent')
        .sort((a, b) => a.turnNumber - b.turnNumber);

      const systemTurns = (call.turns || [])
        .filter(t => t.speaker === 'system')
        .sort((a, b) => a.turnNumber - b.turnNumber);

      // Calculate duration
      const duration = call.callMeta?.twilioDurationSeconds ||
        (call.callMeta?.endedAt && call.callMeta?.startedAt
          ? Math.floor((new Date(call.callMeta.endedAt) - new Date(call.callMeta.startedAt)) / 1000)
          : null);

      // Build response (format expected by frontend)
      const response = {
        success: true,
        call: {
          callSid: call.callSid,
          companyId: call.companyId,
          fromPhone: call.callMeta?.from,
          toPhone: call.callMeta?.to,
          startTime: call.callMeta?.startedAt,
          endTime: call.callMeta?.endedAt,
          durationSeconds: duration,
          
          // Timestamps
          firstTurnTs: call.firstTurnTs,
          lastTurnTs: call.lastTurnTs,
          createdAt: call.createdAt,
          updatedAt: call.updatedAt
        },
        
        // Transcript turns (frontend expects flat array)
        turns: conversationTurns,
        
        // Trace events (frontend expects flat array)
        trace: (call.trace || []).sort((a, b) => 
          a.turnNumber - b.turnNumber || new Date(a.ts) - new Date(b.ts)
        ),
        
        // Additional metadata
        callMeta: call.callMeta,
        
        // System turns (if frontend needs them)
        systemTurns,
        
        // Stats
        stats: {
          totalTurns: conversationTurns.length,
          callerTurns: conversationTurns.filter(t => t.speaker === 'caller').length,
          agentTurns: conversationTurns.filter(t => t.speaker === 'agent').length,
          traceEvents: (call.trace || []).length
        }
      };

      res.json(response);

    } catch (error) {
      logger.error(`[${MODULE_ID}] Error fetching call details`, {
        companyId,
        callSid,
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        success: false,
        error: 'Failed to fetch call details',
        message: error.message
      });
    }
  }
);

/**
 * GET /:companyId/calls/export
 * Export multiple calls as JSON (for compliance/auditing)
 */
router.get('/:companyId/calls/export',
  authenticateJWT,
  requirePermission(PERMISSIONS.CONFIG_READ),
  async (req, res) => {
    const { companyId } = req.params;
    const { 
      limit = 100,
      dateRange = 'week'
    } = req.query;

    try {
      const limitNum = Math.min(1000, Math.max(1, parseInt(limit, 10)));

      const v2Count = await CallTranscriptV2.countDocuments({ companyId });

      // Build query
      const query = { companyId };

      // Date range filter
      if (dateRange && dateRange !== 'all') {
        const now = new Date();
        let startDate;
        
        switch (dateRange) {
          case 'today':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            break;
          case 'yesterday':
            startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
            break;
          case 'week':
            startDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
            break;
          case 'month':
            startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
            break;
        }
        
        if (startDate) {
          query['callMeta.startedAt'] = { $gte: startDate };
        }
      }

      if (v2Count > 0) {
        const calls = await CallTranscriptV2.find(query)
          .sort({ updatedAt: -1 })
          .limit(limitNum)
          .lean();

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="calls-export-${Date.now()}.json"`);
        return res.json({
          exportedAt: new Date().toISOString(),
          companyId,
          dateRange,
          totalCalls: calls.length,
          calls
        });
      }

      // Fallback export using CallSummary + CallTranscript
      const summaries = await CallSummary.find(query)
        .sort({ startedAt: -1 })
        .limit(limitNum)
        .lean();

      const calls = await Promise.all(summaries.map(async (summary) => {
        let transcript = null;
        if (summary.transcriptRef) {
          transcript = await CallTranscript.findById(summary.transcriptRef).lean();
        } else {
          transcript = await CallTranscript.findOne({ callId: summary.twilioSid || summary.callId }).lean();
        }

        const rawTurns = transcript?.turns || [];
        const turns = rawTurns.map((t, idx) => ({
          turnNumber: Number.isFinite(t?.turn) ? t.turn : (idx + 1),
          speaker: t.speaker || 'caller',
          kind: t.kind || (t.speaker === 'agent' ? 'CONVERSATION_AGENT' : 'CONVERSATION_CALLER'),
          text: t.text || '',
          timestamp: t.timestamp || summary.startedAt || null,
          source: t.source || null,
          provenance: t.provenance || null
        }));

        return {
          callSid: summary.twilioSid || summary.callId,
          fromPhone: summary.phone || summary.from || null,
          toPhone: summary.toPhone || summary.to || null,
          startTime: summary.startedAt || null,
          durationSeconds: summary.durationSeconds || null,
          llmUsage: null,
          problems: [],
          turns
        };
      }));

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="calls-export-${Date.now()}.json"`);
      return res.json({
        exportedAt: new Date().toISOString(),
        companyId,
        dateRange,
        totalCalls: calls.length,
        calls
      });

    } catch (error) {
      logger.error(`[${MODULE_ID}] Error exporting calls`, {
        companyId,
        error: error.message,
        stack: error.stack
      });
      res.status(500).json({
        success: false,
        error: 'Failed to export calls',
        message: error.message
      });
    }
  }
);

module.exports = router;
