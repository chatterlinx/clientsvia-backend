/**
 * ============================================================================
 * BLACK BOX RECORDER API ROUTES
 * ============================================================================
 * 
 * API endpoints for the Black Box Recorder UI.
 * 
 * ROUTES:
 * - GET  /api/company/:companyId/blackbox/list           List calls with filters
 * - GET  /api/company/:companyId/blackbox/call/:callId   Get full call detail
 * - GET  /api/company/:companyId/blackbox/stats          Get summary stats
 * 
 * ============================================================================
 */

const express = require('express');
const router = express.Router({ mergeParams: true });
const { authenticateJWT, requireRole } = require('../../middleware/auth');
const BlackBoxRecording = require('../../models/BlackBoxRecording');
const logger = require('../../utils/logger');

// ============================================================================
// MIDDLEWARE
// ============================================================================

router.use(authenticateJWT);
router.use(requireRole('admin', 'owner'));

// ============================================================================
// LIST CALLS
// ============================================================================
// GET /api/company/:companyId/blackbox/list
// Query params: limit, skip, fromDate, toDate, flag, phone, onlyProblematic
// ============================================================================

router.get('/list', async (req, res) => {
  try {
    const { companyId } = req.params;
    const {
      limit = 20,
      skip = 0,
      fromDate,
      toDate,
      flag,
      phone,
      onlyProblematic
    } = req.query;
    
    logger.info('[BLACK BOX API] List request', {
      companyId,
      limit,
      skip,
      flag,
      onlyProblematic
    });
    
    const result = await BlackBoxRecording.getCallList(companyId, {
      limit: parseInt(limit, 10),
      skip: parseInt(skip, 10),
      fromDate,
      toDate,
      flag,
      phone,
      onlyProblematic: onlyProblematic === 'true'
    });
    
    res.json({
      success: true,
      calls: result.calls,
      total: result.total,
      pagination: {
        limit: parseInt(limit, 10),
        skip: parseInt(skip, 10),
        hasMore: result.total > parseInt(skip, 10) + result.calls.length
      }
    });
    
  } catch (error) {
    logger.error('[BLACK BOX API] List failed', {
      companyId: req.params.companyId,
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// GET CALL DETAIL
// ============================================================================
// GET /api/company/:companyId/blackbox/call/:callId
// Returns full BlackBoxRecording document
// ============================================================================

router.get('/call/:callId', async (req, res) => {
  try {
    const { companyId, callId } = req.params;
    
    logger.info('[BLACK BOX API] Detail request', {
      companyId,
      callId
    });
    
    const recording = await BlackBoxRecording.getCallDetail(companyId, callId);
    
    if (!recording) {
      return res.status(404).json({
        success: false,
        error: 'Recording not found'
      });
    }
    
    // Generate engineering snapshot
    const snapshot = generateEngineeringSnapshot(recording);
    
    res.json({
      success: true,
      recording,
      snapshot
    });
    
  } catch (error) {
    logger.error('[BLACK BOX API] Detail failed', {
      companyId: req.params.companyId,
      callId: req.params.callId,
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// GET STATS
// ============================================================================
// GET /api/company/:companyId/blackbox/stats
// Returns aggregate stats for the company
// ============================================================================

router.get('/stats', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { days = 7 } = req.query;
    
    const fromDate = new Date();
    fromDate.setDate(fromDate.getDate() - parseInt(days, 10));
    
    const stats = await BlackBoxRecording.aggregate([
      {
        $match: {
          companyId: require('mongoose').Types.ObjectId(companyId),
          startedAt: { $gte: fromDate }
        }
      },
      {
        $group: {
          _id: null,
          totalCalls: { $sum: 1 },
          avgDurationMs: { $avg: '$durationMs' },
          avgTurns: { $avg: '$performance.totalTurns' },
          avgTurnTimeMs: { $avg: '$performance.avgTurnTimeMs' },
          loopsDetected: { $sum: { $cond: ['$flags.loopDetected', 1, 0] } },
          bailoutsTriggered: { $sum: { $cond: ['$flags.bailoutTriggered', 1, 0] } },
          bookingsIgnored: { $sum: { $cond: ['$flags.bookingIgnored', 1, 0] } },
          slowResponses: { $sum: { $cond: ['$flags.slowResponse', 1, 0] } },
          transfers: { $sum: { $cond: [{ $eq: ['$callOutcome', 'TRANSFERRED'] }, 1, 0] } },
          completed: { $sum: { $cond: [{ $eq: ['$callOutcome', 'COMPLETED'] }, 1, 0] } }
        }
      }
    ]);
    
    const result = stats[0] || {
      totalCalls: 0,
      avgDurationMs: 0,
      avgTurns: 0,
      avgTurnTimeMs: 0,
      loopsDetected: 0,
      bailoutsTriggered: 0,
      bookingsIgnored: 0,
      slowResponses: 0,
      transfers: 0,
      completed: 0
    };
    
    // Calculate problem rate
    const totalProblems = result.loopsDetected + result.bailoutsTriggered + 
                          result.bookingsIgnored + result.slowResponses;
    result.problemRate = result.totalCalls > 0 
      ? Math.round((totalProblems / result.totalCalls) * 100) 
      : 0;
    
    res.json({
      success: true,
      stats: result,
      period: {
        days: parseInt(days, 10),
        from: fromDate,
        to: new Date()
      }
    });
    
  } catch (error) {
    logger.error('[BLACK BOX API] Stats failed', {
      companyId: req.params.companyId,
      error: error.message
    });
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ============================================================================
// HELPER: Generate Engineering Snapshot
// ============================================================================

function generateEngineeringSnapshot(recording) {
  const formatDuration = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };
  
  const formatTime = (ms) => {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };
  
  let snapshot = `[BLACK BOX SNAPSHOT]

Company: ${recording.companyId}
CallId: ${recording.callId}
From: ${recording.from}  To: ${recording.to}
Date: ${new Date(recording.startedAt).toLocaleString()}
Duration: ${formatDuration(recording.durationMs || 0)}
Outcome: ${recording.callOutcome || 'UNKNOWN'}

Intent:
- primaryIntent: ${recording.primaryIntent || 'unknown'} (${recording.primaryIntentConfidence?.toFixed(2) || '?'})
- firstBookingIntentAtMs: ${recording.booking?.firstIntentDetectedAtMs || 'N/A'}
- intentLockedAtMs: ${recording.booking?.intentLockedAtMs || 'N/A'}
- questionsAskedBeforeLock: ${recording.booking?.questionsAskedBeforeLock || 0}
- completed: ${recording.booking?.completed ?? 'N/A'}
- failureReason: ${recording.booking?.failureReason || 'N/A'}

Flags:
- loopDetected: ${recording.flags?.loopDetected || false}
- bookingIgnored: ${recording.flags?.bookingIgnored || false}
- bailoutTriggered: ${recording.flags?.bailoutTriggered || false}
- noTriageMatch: ${recording.flags?.noTriageMatch || false}
- customerFrustrated: ${recording.flags?.customerFrustrated || false}
- slowResponse: ${recording.flags?.slowResponse || false}

Diagnosis:
- primaryBottleneck: ${recording.diagnosis?.primaryBottleneck || 'NONE'}
- rootCause: ${recording.diagnosis?.rootCause || 'N/A'}
- suggestedFix: ${recording.diagnosis?.suggestedFix || 'N/A'}
- severity: ${recording.diagnosis?.severity || 'INFO'}

Performance:
- totalTurns: ${recording.performance?.totalTurns || 0}
- avgTurnTimeMs: ${recording.performance?.avgTurnTimeMs || 0}
- slowestTurn: #${recording.performance?.slowestTurn?.turnNumber || '?'} (${recording.performance?.slowestTurn?.totalMs || 0}ms, bottleneck=${recording.performance?.slowestTurn?.bottleneck || '?'})
- llmCalls: { count: ${recording.performance?.llmCalls?.count || 0}, totalMs: ${recording.performance?.llmCalls?.totalMs || 0} }
- ttsTotalMs: ${recording.performance?.ttsTotalMs || 0}

Key Timeline:
`;

  // Add key events
  const keyEvents = (recording.events || [])
    .filter(e => [
      'GREETING_SENT', 'GATHER_FINAL', 'INTENT_DETECTED', 'TRIAGE_DECISION',
      'AGENT_RESPONSE_BUILT', 'LOOP_DETECTED', 'BAILOUT_TRIGGERED', 
      'TRANSFER_INITIATED', 'CALL_END'
    ].includes(e.type))
    .slice(0, 20);
  
  for (const event of keyEvents) {
    const time = formatTime(event.t || 0);
    let detail = '';
    
    switch (event.type) {
      case 'GREETING_SENT':
        detail = `"${(event.data?.text || '').substring(0, 50)}..."`;
        break;
      case 'GATHER_FINAL':
        detail = `CALLER "${(event.data?.text || '').substring(0, 50)}..."`;
        break;
      case 'INTENT_DETECTED':
        detail = `${event.data?.intent || '?'} (${event.data?.confidence?.toFixed(2) || '?'})`;
        break;
      case 'TRIAGE_DECISION':
        detail = `${event.data?.route || event.data?.cardName || '?'}`;
        break;
      case 'AGENT_RESPONSE_BUILT':
        detail = `"${(event.data?.text || '').substring(0, 50)}..."`;
        break;
      case 'BAILOUT_TRIGGERED':
        detail = `type=${event.data?.type} reason=${event.data?.reason}`;
        break;
      case 'TRANSFER_INITIATED':
        detail = `target=${event.data?.target}`;
        break;
      case 'CALL_END':
        detail = `outcome=${event.data?.outcome}`;
        break;
      default:
        detail = JSON.stringify(event.data || {}).substring(0, 50);
    }
    
    snapshot += `- ${time} ${event.type} ${detail}\n`;
  }
  
  return snapshot;
}

// ============================================================================
// EXPORT
// ============================================================================

module.exports = router;

