/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * TRANSCRIPTS API ROUTES - V111 Call Transcript Endpoints
 * ═══════════════════════════════════════════════════════════════════════════════
 * 
 * API endpoints for retrieving and managing call transcripts.
 * 
 * ENDPOINTS:
 * - GET /api/admin/transcripts/:companyId/recent - Get recent transcripts
 * - GET /api/admin/transcripts/call/:callId - Get transcript for specific call
 * - GET /api/admin/transcripts/call/:callId/customer - Get customer transcript only
 * - GET /api/admin/transcripts/call/:callId/engineering - Get engineering transcript only
 * - POST /api/admin/transcripts/generate/:callId - Generate transcript from BlackBox
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const logger = require('../../utils/logger');
const CallTranscript = require('../../models/CallTranscript');
const BlackBoxRecording = require('../../models/BlackBoxRecording');
const v2Company = require('../../models/v2Company');
const { TranscriptGenerator, generateAllTranscripts } = require('../../services/TranscriptGenerator');

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/transcripts/:companyId/recent
// ═══════════════════════════════════════════════════════════════════════════════
// Get recent transcripts for a company

router.get('/:companyId/recent', async (req, res) => {
  try {
    const { companyId } = req.params;
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);
    
    logger.debug('[TRANSCRIPTS] GET recent', { companyId, limit });
    
    const transcripts = await CallTranscript.getRecentForCompany(companyId, limit);
    
    res.json({
      success: true,
      count: transcripts.length,
      transcripts: transcripts.map(t => ({
        callId: t.callId,
        startTime: t.callStartTime,
        duration: t.durationMs,
        durationFormatted: formatDuration(t.durationMs),
        endReason: t.endReason,
        turnCount: t.turnCount,
        bookingCreated: t.bookingCreated,
        goalsComplete: t.captureProgress?.complete || false,
        callerName: t.facts?.name || 'Unknown'
      }))
    });
    
  } catch (error) {
    logger.error('[TRANSCRIPTS] Error getting recent', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/transcripts/call/:callId
// ═══════════════════════════════════════════════════════════════════════════════
// Get full transcript for a specific call

router.get('/call/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    
    logger.debug('[TRANSCRIPTS] GET by callId', { callId });
    
    const transcript = await CallTranscript.getByCallId(callId);
    
    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Transcript not found',
        callId
      });
    }
    
    res.json({
      success: true,
      transcript: {
        callId: transcript.callId,
        companyId: transcript.companyId,
        startTime: transcript.callStartTime,
        endTime: transcript.callEndTime,
        duration: transcript.durationMs,
        durationFormatted: formatDuration(transcript.durationMs),
        endReason: transcript.endReason,
        finalPhase: transcript.finalPhase,
        turnCount: transcript.turnCount,
        customerTranscript: transcript.customerTranscript,
        engineeringTranscript: transcript.engineeringTranscript,
        facts: transcript.facts,
        captureProgress: transcript.captureProgress,
        bookingCreated: transcript.bookingCreated,
        metrics: {
          avgLatencyMs: transcript.avgLatencyMs,
          handlerDistribution: transcript.handlerDistribution,
          v111Enabled: transcript.v111Enabled
        }
      }
    });
    
  } catch (error) {
    logger.error('[TRANSCRIPTS] Error getting by callId', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/transcripts/call/:callId/customer
// ═══════════════════════════════════════════════════════════════════════════════
// Get just the customer transcript (plain text)

router.get('/call/:callId/customer', async (req, res) => {
  try {
    const { callId } = req.params;
    
    const transcript = await CallTranscript.findOne({ callId })
      .select({ customerTranscript: 1 })
      .lean();
    
    if (!transcript) {
      return res.status(404).json({ success: false, error: 'Transcript not found' });
    }
    
    // Return as plain text if requested
    if (req.query.format === 'text') {
      res.type('text/plain');
      return res.send(transcript.customerTranscript || '');
    }
    
    res.json({
      success: true,
      callId,
      transcript: transcript.customerTranscript || ''
    });
    
  } catch (error) {
    logger.error('[TRANSCRIPTS] Error getting customer transcript', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// GET /api/admin/transcripts/call/:callId/engineering
// ═══════════════════════════════════════════════════════════════════════════════
// Get just the engineering transcript (plain text)

router.get('/call/:callId/engineering', async (req, res) => {
  try {
    const { callId } = req.params;
    
    const transcript = await CallTranscript.findOne({ callId })
      .select({ engineeringTranscript: 1 })
      .lean();
    
    if (!transcript) {
      return res.status(404).json({ success: false, error: 'Transcript not found' });
    }
    
    // Return as plain text if requested
    if (req.query.format === 'text') {
      res.type('text/plain');
      return res.send(transcript.engineeringTranscript || '');
    }
    
    res.json({
      success: true,
      callId,
      transcript: transcript.engineeringTranscript || ''
    });
    
  } catch (error) {
    logger.error('[TRANSCRIPTS] Error getting engineering transcript', { error: error.message });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// POST /api/admin/transcripts/generate/:callId
// ═══════════════════════════════════════════════════════════════════════════════
// Generate transcript from BlackBox data (for calls without V111 or regeneration)

router.post('/generate/:callId', async (req, res) => {
  try {
    const { callId } = req.params;
    
    logger.info('[TRANSCRIPTS] Generate request', { callId });
    
    // Check if transcript already exists
    const existing = await CallTranscript.findOne({ callId });
    if (existing && !req.query.force) {
      return res.json({
        success: true,
        message: 'Transcript already exists',
        callId,
        createdAt: existing.createdAt
      });
    }
    
    // Try to find TURN_RECORDED events in BlackBox
    const turnRecords = await BlackBoxRecording.find({
      callId,
      eventType: 'TURN_RECORDED'
    }).sort({ createdAt: 1 }).lean();
    
    if (!turnRecords || turnRecords.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No turn records found for this call',
        callId
      });
    }
    
    // Reconstruct memory from turn records
    const firstTurn = turnRecords[0];
    const lastTurn = turnRecords[turnRecords.length - 1];
    
    const memory = {
      callId,
      companyId: firstTurn.companyId,
      createdAt: firstTurn.createdAt,
      version: lastTurn.payload?._meta?.version || 'v111.0',
      turns: turnRecords.map(t => t.payload),
      facts: lastTurn.payload?.memorySnapshot?.knownFacts || {},
      captureProgress: lastTurn.payload?.memorySnapshot?.captureProgress || {},
      booking: {
        modeLocked: lastTurn.payload?.memorySnapshot?.bookingMode || false
      },
      outcome: {
        endReason: 'unknown',
        duration: new Date(lastTurn.createdAt).getTime() - new Date(firstTurn.createdAt).getTime()
      },
      phase: {
        current: lastTurn.payload?.routing?.phase || 'DISCOVERY'
      }
    };
    
    // Load company for branding
    const company = await v2Company.findById(memory.companyId).lean();
    
    // Generate transcripts
    const transcripts = generateAllTranscripts(memory, company);
    
    // Save or update
    if (existing) {
      await CallTranscript.updateOne(
        { callId },
        {
          customerTranscript: transcripts.customer,
          engineeringTranscript: transcripts.engineering,
          memorySnapshot: memory,
          updatedAt: new Date()
        }
      );
    } else {
      await CallTranscript.createFromMemory(memory, transcripts, company);
    }
    
    res.json({
      success: true,
      message: existing ? 'Transcript regenerated' : 'Transcript generated',
      callId,
      turnCount: turnRecords.length
    });
    
  } catch (error) {
    logger.error('[TRANSCRIPTS] Error generating', { error: error.message, stack: error.stack });
    res.status(500).json({ success: false, error: error.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function formatDuration(ms) {
  if (!ms) return '0s';
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

// ═══════════════════════════════════════════════════════════════════════════════
// EXPORT
// ═══════════════════════════════════════════════════════════════════════════════

module.exports = router;
