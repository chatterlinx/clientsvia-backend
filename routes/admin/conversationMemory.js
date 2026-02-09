/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * CONVERSATION MEMORY API - V111 Runtime Truth Viewer
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * API endpoints for viewing conversation memory data from completed calls.
 * Phase 1: Read-only viewer for debugging and analysis.
 * 
 * ENDPOINTS:
 * - GET /api/admin/conversation-memory/recent/:companyId - List recent calls with memory
 * - GET /api/admin/conversation-memory/:companyId/:callId - Get full memory for a call
 * - GET /api/admin/conversation-memory/:companyId/:callId/turns - Get turn-by-turn breakdown
 * - GET /api/admin/conversation-memory/:companyId/:callId/facts - Get facts timeline
 * 
 * SPEC: docs/architecture/V111-ConversationMemory-Spec.md
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const BlackBoxRecording = require('../../models/BlackBoxRecording');

// ═══════════════════════════════════════════════════════════════════════════════
// GET /recent/:companyId - List recent calls with V111 TurnRecords
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/recent/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { limit = 20, skip = 0, fromDate, toDate } = req.query;
    
    // Build query for calls that have TURN_RECORDED events
    const query = { 
      companyId,
      'events.type': 'TURN_RECORDED'
    };
    
    // Date range filter
    if (fromDate || toDate) {
      query.startedAt = {};
      if (fromDate) query.startedAt.$gte = new Date(fromDate);
      if (toDate) query.startedAt.$lte = new Date(toDate);
    }
    
    const calls = await BlackBoxRecording.find(query)
      .select({
        callId: 1,
        from: 1,
        to: 1,
        startedAt: 1,
        endedAt: 1,
        durationMs: 1,
        callOutcome: 1,
        'performance.totalTurns': 1,
        source: 1,
        // Count TURN_RECORDED events
        events: {
          $elemMatch: { type: 'TURN_RECORDED' }
        }
      })
      .sort({ startedAt: -1 })
      .skip(parseInt(skip))
      .limit(parseInt(limit))
      .lean();
    
    // Process results to add V111 summary
    const processedCalls = calls.map(call => {
      // Count total TURN_RECORDED events from full document
      const turnRecordedCount = call.events?.filter(e => e.type === 'TURN_RECORDED').length || 0;
      
      return {
        callId: call.callId,
        from: call.from,
        to: call.to,
        startedAt: call.startedAt,
        endedAt: call.endedAt,
        durationMs: call.durationMs,
        callOutcome: call.callOutcome,
        totalTurns: call.performance?.totalTurns || turnRecordedCount,
        source: call.source || 'voice',
        hasV111Data: turnRecordedCount > 0,
        v111TurnCount: turnRecordedCount
      };
    });
    
    // Get total count
    const total = await BlackBoxRecording.countDocuments(query);
    
    res.json({
      success: true,
      data: {
        calls: processedCalls,
        total,
        limit: parseInt(limit),
        skip: parseInt(skip),
        hasMore: (parseInt(skip) + processedCalls.length) < total
      }
    });
    
  } catch (error) {
    logger.error('[CONVERSATION MEMORY API] Failed to list recent calls', {
      error: error.message,
      companyId: req.params.companyId
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /:companyId/:callId - Get full conversation memory for a call
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/:callId', async (req, res) => {
  try {
    const { companyId, callId } = req.params;
    
    const recording = await BlackBoxRecording.findOne({ companyId, callId }).lean();
    
    if (!recording) {
      return res.status(404).json({
        success: false,
        error: 'Call recording not found'
      });
    }
    
    // Extract TURN_RECORDED events
    const turnRecords = (recording.events || [])
      .filter(e => e.type === 'TURN_RECORDED')
      .sort((a, b) => (a.data?.turn || 0) - (b.data?.turn || 0))
      .map(e => e.data);
    
    // Build facts timeline from turn records
    const factsTimeline = buildFactsTimeline(turnRecords);
    
    // Build routing summary
    const routingSummary = buildRoutingSummary(turnRecords);
    
    // Build response
    const memory = {
      callId: recording.callId,
      companyId: recording.companyId,
      from: recording.from,
      to: recording.to,
      startedAt: recording.startedAt,
      endedAt: recording.endedAt,
      durationMs: recording.durationMs,
      callOutcome: recording.callOutcome,
      source: recording.source || 'voice',
      
      // V111 Data
      v111: {
        turnCount: turnRecords.length,
        turns: turnRecords,
        factsTimeline,
        routingSummary,
        
        // Final state (from last turn)
        finalState: turnRecords.length > 0 ? {
          facts: turnRecords[turnRecords.length - 1]?.memorySnapshot?.knownFacts || {},
          phase: turnRecords[turnRecords.length - 1]?.memorySnapshot?.phase || 'UNKNOWN',
          bookingMode: turnRecords[turnRecords.length - 1]?.memorySnapshot?.bookingMode || false
        } : null
      },
      
      // Include legacy transcript for comparison
      legacyTranscript: recording.transcript
    };
    
    res.json({
      success: true,
      data: memory
    });
    
  } catch (error) {
    logger.error('[CONVERSATION MEMORY API] Failed to get call memory', {
      error: error.message,
      companyId: req.params.companyId,
      callId: req.params.callId
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /:companyId/:callId/turns - Get turn-by-turn breakdown
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/:callId/turns', async (req, res) => {
  try {
    const { companyId, callId } = req.params;
    
    const recording = await BlackBoxRecording.findOne(
      { companyId, callId },
      { events: 1, startedAt: 1 }
    ).lean();
    
    if (!recording) {
      return res.status(404).json({
        success: false,
        error: 'Call recording not found'
      });
    }
    
    // Extract and format turn records
    const turnRecords = (recording.events || [])
      .filter(e => e.type === 'TURN_RECORDED')
      .sort((a, b) => (a.data?.turn || 0) - (b.data?.turn || 0))
      .map(e => ({
        turn: e.data?.turn,
        timestamp: e.data?.timestamp || e.ts,
        offsetMs: e.t,
        
        // Caller input
        caller: {
          raw: e.data?.caller?.raw,
          cleaned: e.data?.caller?.cleaned,
          confidence: e.data?.caller?.confidence,
          sttOps: e.data?.caller?.sttOps
        },
        
        // Extraction results
        extraction: {
          slots: e.data?.extraction?.slots || {},
          intent: e.data?.extraction?.intent
        },
        
        // Routing decision
        routing: {
          handler: e.data?.routing?.selectedHandler,
          why: e.data?.routing?.why || [],
          phase: e.data?.routing?.phase
        },
        
        // Response
        response: {
          text: e.data?.response?.text,
          latencyMs: e.data?.response?.latencyMs,
          handler: e.data?.response?.handler
        },
        
        // What changed
        delta: e.data?.delta || {}
      }));
    
    res.json({
      success: true,
      data: {
        callId,
        startedAt: recording.startedAt,
        turnCount: turnRecords.length,
        turns: turnRecords
      }
    });
    
  } catch (error) {
    logger.error('[CONVERSATION MEMORY API] Failed to get turns', {
      error: error.message,
      companyId: req.params.companyId,
      callId: req.params.callId
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /:companyId/:callId/facts - Get facts timeline
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/:callId/facts', async (req, res) => {
  try {
    const { companyId, callId } = req.params;
    
    const recording = await BlackBoxRecording.findOne(
      { companyId, callId },
      { events: 1 }
    ).lean();
    
    if (!recording) {
      return res.status(404).json({
        success: false,
        error: 'Call recording not found'
      });
    }
    
    // Extract turn records
    const turnRecords = (recording.events || [])
      .filter(e => e.type === 'TURN_RECORDED')
      .sort((a, b) => (a.data?.turn || 0) - (b.data?.turn || 0))
      .map(e => e.data);
    
    // Build facts timeline
    const factsTimeline = buildFactsTimeline(turnRecords);
    
    res.json({
      success: true,
      data: {
        callId,
        factsTimeline,
        finalFacts: turnRecords.length > 0 
          ? turnRecords[turnRecords.length - 1]?.memorySnapshot?.knownFacts || {}
          : {}
      }
    });
    
  } catch (error) {
    logger.error('[CONVERSATION MEMORY API] Failed to get facts', {
      error: error.message,
      companyId: req.params.companyId,
      callId: req.params.callId
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /:companyId/:callId/transcript - Get transcripts for a call (V111 Phase 5)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/:companyId/:callId/transcript', async (req, res) => {
  try {
    const { companyId, callId } = req.params;
    const { format = 'all' } = req.query; // 'customer', 'engineering', 'json', 'all'
    
    // Try CallTranscript first (V111 Phase 5)
    let CallTranscript;
    try {
      CallTranscript = require('../../models/CallTranscript');
    } catch (e) {
      // Model not yet available
    }
    
    if (CallTranscript) {
      const transcript = await CallTranscript.getByCallId(callId);
      
      if (transcript) {
        const response = {
          success: true,
          source: 'CallTranscript',
          data: {
            callId: transcript.callId,
            companyId: transcript.companyId,
            callStartTime: transcript.callStartTime,
            durationMs: transcript.durationMs,
            turnCount: transcript.turnCount,
            bookingCreated: transcript.bookingCreated,
            v111Enabled: transcript.v111Enabled
          }
        };
        
        // Include requested formats
        if (format === 'customer' || format === 'all') {
          response.data.customerTranscript = transcript.customerTranscript;
        }
        if (format === 'engineering' || format === 'all') {
          response.data.engineeringTranscript = transcript.engineeringTranscript;
        }
        if (format === 'json' || format === 'all') {
          response.data.memorySnapshot = transcript.memorySnapshot;
          response.data.facts = transcript.facts;
          response.data.captureProgress = transcript.captureProgress;
        }
        
        return res.json(response);
      }
    }
    
    // Fall back to generating from BlackBox recording
    const recording = await BlackBoxRecording.findOne({ companyId, callId }).lean();
    
    if (!recording) {
      return res.status(404).json({
        success: false,
        error: 'Call recording not found'
      });
    }
    
    // Extract turn records and build a memory-like structure
    const turnRecords = (recording.events || [])
      .filter(e => e.type === 'TURN_RECORDED')
      .sort((a, b) => (a.data?.turn || 0) - (b.data?.turn || 0))
      .map(e => e.data);
    
    if (turnRecords.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No V111 turn records found for this call'
      });
    }
    
    // Build memory object from turn records
    const lastTurn = turnRecords[turnRecords.length - 1];
    const memory = {
      callId: recording.callId,
      companyId: recording.companyId,
      createdAt: recording.startedAt,
      outcome: {
        duration: recording.durationMs,
        endReason: recording.callOutcome || 'unknown'
      },
      facts: lastTurn?.memorySnapshot?.knownFacts || {},
      turns: turnRecords,
      captureProgress: lastTurn?.memorySnapshot?.captureProgress || {},
      booking: {
        modeLocked: lastTurn?.memorySnapshot?.bookingMode || false
      }
    };
    
    // Generate transcripts on-the-fly
    const { generateAllTranscripts } = require('../../services/TranscriptGenerator');
    const v2Company = require('../../models/v2Company');
    const company = await v2Company.findById(companyId).lean();
    
    const transcripts = generateAllTranscripts(memory, company);
    
    const response = {
      success: true,
      source: 'BlackBoxRecording',
      data: {
        callId: recording.callId,
        companyId: recording.companyId,
        callStartTime: recording.startedAt,
        durationMs: recording.durationMs,
        turnCount: turnRecords.length
      }
    };
    
    if (format === 'customer' || format === 'all') {
      response.data.customerTranscript = transcripts.customer;
    }
    if (format === 'engineering' || format === 'all') {
      response.data.engineeringTranscript = transcripts.engineering;
    }
    if (format === 'json' || format === 'all') {
      response.data.memorySnapshot = memory;
      response.data.json = transcripts.json;
    }
    
    res.json(response);
    
  } catch (error) {
    logger.error('[CONVERSATION MEMORY API] Failed to get transcript', {
      error: error.message,
      companyId: req.params.companyId,
      callId: req.params.callId
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /transcripts/:companyId - List recent transcripts (V111 Phase 5)
// ═══════════════════════════════════════════════════════════════════════════════

router.get('/transcripts/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { limit = 20 } = req.query;
    
    let CallTranscript;
    try {
      CallTranscript = require('../../models/CallTranscript');
    } catch (e) {
      return res.json({
        success: true,
        data: { transcripts: [], total: 0 },
        message: 'CallTranscript model not available'
      });
    }
    
    const transcripts = await CallTranscript.getRecentForCompany(companyId, parseInt(limit));
    const total = await CallTranscript.countDocuments({ companyId });
    
    res.json({
      success: true,
      data: {
        transcripts,
        total,
        limit: parseInt(limit)
      }
    });
    
  } catch (error) {
    logger.error('[CONVERSATION MEMORY API] Failed to list transcripts', {
      error: error.message,
      companyId: req.params.companyId
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Build a timeline of when facts were captured
 */
function buildFactsTimeline(turnRecords) {
  const timeline = [];
  const seenFacts = new Set();
  
  for (const turn of turnRecords) {
    const delta = turn?.delta || {};
    const snapshot = turn?.memorySnapshot?.knownFacts || {};
    
    // Facts added this turn
    if (delta.factsAdded && delta.factsAdded.length > 0) {
      for (const factId of delta.factsAdded) {
        if (!seenFacts.has(factId)) {
          timeline.push({
            factId,
            action: 'added',
            turn: turn.turn,
            timestamp: turn.timestamp,
            value: snapshot[factId],
            source: turn.extraction?.slots?.[factId]?.source || 'unknown'
          });
          seenFacts.add(factId);
        }
      }
    }
    
    // Facts updated this turn
    if (delta.factsUpdated && delta.factsUpdated.length > 0) {
      for (const factId of delta.factsUpdated) {
        timeline.push({
          factId,
          action: 'updated',
          turn: turn.turn,
          timestamp: turn.timestamp,
          value: snapshot[factId],
          source: turn.extraction?.slots?.[factId]?.source || 'unknown'
        });
      }
    }
  }
  
  return timeline;
}

/**
 * Build a summary of routing decisions
 */
function buildRoutingSummary(turnRecords) {
  const handlerCounts = {};
  const routingTrace = [];
  
  for (const turn of turnRecords) {
    const handler = turn?.routing?.selectedHandler || 'UNKNOWN';
    const why = turn?.routing?.why || [];
    
    // Count handlers
    handlerCounts[handler] = (handlerCounts[handler] || 0) + 1;
    
    // Build trace
    routingTrace.push({
      turn: turn.turn,
      handler,
      why: why.map(w => w.rule || w).join(' → '),
      phase: turn?.routing?.phase || 'UNKNOWN'
    });
  }
  
  // Determine primary handler
  const primaryHandler = Object.entries(handlerCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';
  
  return {
    totalTurns: turnRecords.length,
    handlerCounts,
    primaryHandler,
    routingTrace
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = router;
