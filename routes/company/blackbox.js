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
const mongoose = require('mongoose');
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
      onlyProblematic,
      // 🆕 PHASE 2.5: New filter params
      source,
      mode,
      bookingLock
    } = req.query;
    
    logger.info('[BLACK BOX API] List request', {
      companyId,
      limit,
      skip,
      flag,
      onlyProblematic,
      source,
      mode,
      bookingLock
    });
    
    const result = await BlackBoxRecording.getCallList(companyId, {
      limit: parseInt(limit, 10),
      skip: parseInt(skip, 10),
      fromDate,
      toDate,
      flag,
      phone,
      onlyProblematic: onlyProblematic === 'true',
      // 🆕 PHASE 2.5: Pass new filters
      source,
      mode,
      bookingLock
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
    
    const matchStage = {
      companyId: new mongoose.Types.ObjectId(companyId),
      startedAt: { $gte: fromDate }
    };
    
    // Main stats aggregation
    const stats = await BlackBoxRecording.aggregate([
      { $match: matchStage },
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
    
    // 🆕 PHASE 2.5: Source breakdown
    const sourceStats = await BlackBoxRecording.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { $ifNull: ['$source', 'voice'] },
          count: { $sum: 1 }
        }
      }
    ]);
    
    // 🆕 PHASE 2.5: Mode breakdown
    const modeStats = await BlackBoxRecording.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { $ifNull: ['$sessionSnapshot.mode', 'UNKNOWN'] },
          count: { $sum: 1 }
        }
      }
    ]);
    
    // 🆕 PHASE 2.5: Booking lock breakdown
    const bookingStats = await BlackBoxRecording.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          locked: { $sum: { $cond: ['$sessionSnapshot.locks.bookingLocked', 1, 0] } },
          started: { $sum: { $cond: [
            { $and: [
              '$sessionSnapshot.locks.bookingStarted',
              { $ne: ['$sessionSnapshot.locks.bookingLocked', true] }
            ]}, 1, 0
          ]}},
          none: { $sum: { $cond: [{ $ne: ['$sessionSnapshot.locks.bookingStarted', true] }, 1, 0] } }
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
    
    // 🆕 PHASE 2.5: Format source/mode/booking breakdowns
    const bySource = {};
    sourceStats.forEach(s => { bySource[s._id] = s.count; });
    
    const byMode = {};
    modeStats.forEach(m => { byMode[m._id] = m.count; });
    
    const byBooking = bookingStats[0] || { locked: 0, started: 0, none: 0 };
    
    res.json({
      success: true,
      stats: result,
      // 🆕 PHASE 2.5: New breakdown stats
      breakdown: {
        bySource,   // { voice: 10, test: 5, sms: 2, web: 1 }
        byMode,     // { DISCOVERY: 5, BOOKING: 8, COMPLETE: 5 }
        byBooking   // { locked: 5, started: 3, none: 10 }
      },
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
  
  const bp = recording.bookingProgress || {};
  const conflicts = recording.conflicts || {};
  
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

Booking Progress:
- modeActive: ${bp.modeActive || false}
- modeLocked: ${bp.modeLocked || false}  ← CRITICAL: Must be TRUE to prevent overrides
- lockThreshold: ${bp.lockThreshold || 0.65}
- currentStep: ${bp.currentStep || 'NONE'}
- collected:
    name: ${bp.collected?.name ? `"${bp.collected.name}"` : 'null'}
    address: ${bp.collected?.address ? `"${bp.collected.address}"` : 'null'}
    phone: ${bp.collected?.phone ? `"${bp.collected.phone}"` : 'null'}
    time: ${bp.collected?.time ? `"${bp.collected.time}"` : 'null'}
- slotsRemaining: ${bp.slotsRemaining ?? 4}
- lastStepAskedAtMs: ${bp.lastStepAskedAtMs || 'N/A'}

Conflict Detector:
- bookingVsTriage: ${conflicts.bookingVsTriage || false}
- bookingVsTroubleshooting: ${conflicts.bookingVsTroubleshooting || false}
- bookingOverriddenCount: ${conflicts.bookingOverriddenCount || 0}
${conflicts.overrideEvents?.length > 0 ? conflicts.overrideEvents.map(e => 
  `- OVERRIDE at ${formatTime(e.t || 0)}: ${e.overriddenBy} hijacked ${e.bookingStep} → "${e.responseText}"`
).join('\n') : '- (no overrides)'}

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
  └─ breakdown: brain1=${recording.performance?.slowestTurn?.breakdown?.brain1Ms || 0}ms, tier3=${recording.performance?.slowestTurn?.breakdown?.tier3Ms || 0}ms, llm=${recording.performance?.slowestTurn?.breakdown?.llmMs || 0}ms, tts=${recording.performance?.slowestTurn?.breakdown?.ttsMs || 0}ms
- llmCalls: { count: ${recording.performance?.llmCalls?.count || 0}, brain1: ${recording.performance?.llmCalls?.brain1Count || 0}, tier3: ${recording.performance?.llmCalls?.tier3Count || 0}, totalMs: ${recording.performance?.llmCalls?.totalMs || 0} }
- ttsTotalMs: ${recording.performance?.ttsTotalMs || 0}

Key Timeline:
`;

  // Add key events - include all significant decision points
  const keyEvents = (recording.events || [])
    .filter(e => [
      'GREETING_SENT', 'GATHER_FINAL', 'INTENT_DETECTED', 'TRIAGE_DECISION',
      'TIER3_ENTERED', 'TIER3_FAST_MATCH', 'TIER3_EMBEDDING_MATCH',
      'TIER3_LLM_FALLBACK_CALLED', 'TIER3_LLM_FALLBACK_RESPONSE', 'TIER3_EXIT',
      'BOOKING_MODE_ACTIVATED', 'BOOKING_MODE_LOCKED', 'BOOKING_STEP', 
      'BOOKING_SLOT_FILLED', 'BOOKING_OVERRIDDEN', 'BOOKING_COMPLETE',
      'BOOKING_INTENT_OVERRIDE',
      'AGENT_RESPONSE_BUILT', 'LOOP_DETECTED', 'BAILOUT_TRIGGERED', 
      'TRANSFER_INITIATED', 'CALL_END'
    ].includes(e.type))
    .slice(0, 35);
  
  for (const event of keyEvents) {
    const time = formatTime(event.t || 0);
    const source = event.data?.source ? ` (source=${event.data.source})` : '';
    let detail = '';
    
    switch (event.type) {
      case 'GREETING_SENT':
        detail = `"${(event.data?.text || '').substring(0, 50)}..."`;
        break;
      case 'GATHER_FINAL':
        detail = `CALLER "${(event.data?.text || '').substring(0, 50)}..."`;
        break;
      case 'INTENT_DETECTED':
        detail = `${event.data?.intent || '?'} (${event.data?.confidence?.toFixed(2) || '?'})${source}`;
        break;
      case 'TRIAGE_DECISION':
        detail = `${event.data?.route || event.data?.cardName || '?'} intent=${event.data?.intentTag || '?'}${source}`;
        break;
      case 'AGENT_RESPONSE_BUILT':
        detail = `"${(event.data?.text || '').substring(0, 50)}..."${source}`;
        break;
      case 'BAILOUT_TRIGGERED':
        detail = `type=${event.data?.bailoutType || event.data?.type} reason=${event.data?.reason}`;
        break;
      case 'TRANSFER_INITIATED':
        detail = `target=${event.data?.target}`;
        break;
      case 'CALL_END':
        detail = `outcome=${event.data?.outcome}`;
        break;
      case 'TIER3_ENTERED':
        detail = `reason=${event.data?.reason || '?'}`;
        break;
      case 'TIER3_FAST_MATCH':
      case 'TIER3_EMBEDDING_MATCH':
        detail = `${event.data?.nodeName || event.data?.nodeKey || '?'} (source=${event.data?.source || '?'})`;
        break;
      case 'TIER3_LLM_FALLBACK_CALLED':
        detail = `model=${event.data?.model || '?'} prompt=${event.data?.promptType || '?'}`;
        break;
      case 'TIER3_LLM_FALLBACK_RESPONSE':
        detail = `"${(event.data?.finalText || '').substring(0, 40)}..."`;
        break;
      case 'TIER3_EXIT':
        detail = `outcome=${event.data?.outcome || '?'} route=${event.data?.routedTo || '?'}`;
        break;
      case 'BOOKING_MODE_ACTIVATED':
        detail = `reason=${event.data?.reason || '?'}`;
        break;
      case 'BOOKING_MODE_LOCKED':
        detail = `🔒 HARD LOCK (confidence=${event.data?.intentConfidence?.toFixed(2) || '?'})`;
        break;
      case 'BOOKING_STEP':
        detail = `${event.data?.stepKey || '?'} status=${event.data?.status || '?'}`;
        break;
      case 'BOOKING_SLOT_FILLED':
        detail = `${event.data?.slot || '?'} = "${event.data?.value || '?'}"`;
        break;
      case 'BOOKING_OVERRIDDEN':
        detail = `⚠️ ${event.data?.overriddenBy} hijacked ${event.data?.bookingStep} → "${event.data?.responseText || '?'}"`;
        break;
      case 'BOOKING_COMPLETE':
        detail = `✅ name=${event.data?.collected?.name || '?'}, phone=${event.data?.collected?.phone || '?'}`;
        break;
      case 'BOOKING_INTENT_OVERRIDE':
        detail = `originalAction=${event.data?.originalAction} → BOOK (${event.data?.confidence?.toFixed(2) || '?'})`;
        break;
      case 'LOOP_DETECTED':
        detail = `pattern=${event.data?.pattern || '?'}`;
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

