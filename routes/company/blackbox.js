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
const ScenarioSuggestionEngine = require('../../services/ScenarioSuggestionEngine');

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
    const scenarioSuggestions = ScenarioSuggestionEngine.suggestFromEvents(recording.events || []);
    
    res.json({
      success: true,
      recording,
      snapshot,
      scenarioSuggestions
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
// HELPER: Compute Response Source Audit
// ============================================================================
// Analyzes WHERE each response came from and flags legacy/hijack paths.
// This is CRITICAL for quickly identifying when the AI is using wrong paths.
// ============================================================================

function computeResponseSourceAudit(events) {
  // Define LEGITIMATE sources (expected, production-ready)
  const LEGITIMATE_SOURCES = [
    'SCENARIO_MATCHED', 'TIER1_SCENARIO_MATCH', 'scenario_match', 'tier1',
    'GREETING_INTERCEPT', 'greeting', 'GREETING',
    'STATE_MACHINE', 'state_machine', 'statemachine',
    'LLM_FALLBACK', 'TIER3_FALLBACK', 'tier3', 'llm', 'LLM',
    'QUICK_ANSWER', 'CHEATSHEET_MATCH',
    'BOOKING_SLOT', 'BOOKING_CONFIRM', 'BOOKING_COMPLETE',
    'FAST_PATH_BOOKING', 'BOOKING_SAFETY_NET',
    'silence_response', 'SILENCE_RESPONSE'
  ];
  
  // Get all response events
  const responseEvents = events.filter(e => e.type === 'AGENT_RESPONSE_BUILT');
  const gatherEvents = events.filter(e => e.type === 'GATHER_FINAL');
  const scenarioEvents = events.filter(e => e.type === 'SCENARIO_MATCHED' || e.type === 'SCENARIO_NO_MATCH');
  const llmEvents = events.filter(e => e.type === 'TIER3_FALLBACK' || e.type === 'LLM_RESPONSE');
  
  const turnAudits = [];
  const sourceStats = {};
  const alerts = [];
  
  for (let i = 0; i < responseEvents.length; i++) {
    const response = responseEvents[i];
    const source = response.data?.source || 'unknown';
    const tier = response.data?.tier || 'unknown';
    const text = response.data?.text || '';
    const tokensUsed = response.data?.tokensUsed || 0;
    
    // Find corresponding gather event
    const prevGather = gatherEvents.filter(g => g.t < response.t).pop();
    const userText = prevGather?.data?.text || '[silence]';
    
    // Find scenario match for this turn
    const scenarioForTurn = scenarioEvents.find(s => 
      s.t >= (prevGather?.t || 0) && s.t <= response.t
    );
    
    // Find LLM call for this turn
    const llmForTurn = llmEvents.find(l =>
      l.t >= (prevGather?.t || 0) && l.t <= response.t
    );
    
    // Count sources
    sourceStats[source] = (sourceStats[source] || 0) + 1;
    
    // Check if source is legitimate
    const isLegitimate = LEGITIMATE_SOURCES.some(leg => 
      source.toLowerCase().includes(leg.toLowerCase())
    );
    
    // Determine status and flags
    let status = 'OK';
    let flag = '';
    let emoji = '✅';
    
    if (source === 'unknown' || source === 'undefined' || source === 'null' || !source) {
      status = 'MISSING';
      flag = '❓ SOURCE NOT TRACKED - code path not instrumented';
      emoji = '❓';
      alerts.push({
        turn: i + 1,
        type: 'MISSING_SOURCE',
        severity: 'HIGH',
        message: `Turn ${i + 1}: Response has no source identifier - cannot trace where this came from`,
        userText: userText.substring(0, 60),
        responseText: text.substring(0, 60)
      });
    } else if (!isLegitimate) {
      status = 'SUSPICIOUS';
      flag = `⚠️ UNEXPECTED SOURCE: "${source}" - may be legacy code`;
      emoji = '⚠️';
      alerts.push({
        turn: i + 1,
        type: 'UNEXPECTED_SOURCE',
        severity: 'MEDIUM',
        message: `Turn ${i + 1}: Source "${source}" not in expected list - review code path`,
        userText: userText.substring(0, 60),
        responseText: text.substring(0, 60)
      });
    }
    
    // Check for scenario mismatch (user asked something, no scenario matched, went to LLM)
    if (tier === 'tier3' || source.toLowerCase().includes('llm') || source.toLowerCase().includes('tier3')) {
      if (scenarioForTurn?.type !== 'SCENARIO_MATCHED') {
        alerts.push({
          turn: i + 1,
          type: 'LLM_FALLBACK',
          severity: 'LOW',
          message: `Turn ${i + 1}: No scenario matched, used LLM (tokens: ${tokensUsed}, cost: ~$${((tokensUsed / 1000) * 0.002).toFixed(4)})`,
          userText: userText.substring(0, 60),
          suggestion: 'Consider adding scenario triggers for this phrase'
        });
      }
    }
    
    turnAudits.push({
      turn: i + 1,
      source,
      tier,
      status,
      flag,
      emoji,
      userTextPreview: userText.substring(0, 60),
      responsePreview: text.substring(0, 60),
      scenarioMatched: scenarioForTurn?.data?.scenarioName || scenarioForTurn?.data?.scenarioId || null,
      tokensUsed
    });
  }
  
  // Calculate health metrics
  const totalResponses = turnAudits.length;
  const trackedResponses = turnAudits.filter(t => t.status === 'OK').length;
  const healthScore = totalResponses > 0 ? Math.round((trackedResponses / totalResponses) * 100) : 100;
  
  // Overall status
  let overallStatus = 'HEALTHY';
  let overallEmoji = '🟢';
  if (alerts.some(a => a.severity === 'HIGH')) {
    overallStatus = 'TRACKING_GAPS';
    overallEmoji = '🔴';
  } else if (alerts.some(a => a.severity === 'MEDIUM')) {
    overallStatus = 'REVIEW_NEEDED';
    overallEmoji = '🟡';
  } else if (alerts.filter(a => a.type === 'LLM_FALLBACK').length > totalResponses / 2) {
    overallStatus = 'LOW_SCENARIO_COVERAGE';
    overallEmoji = '🟠';
  }
  
  return {
    overallStatus,
    overallEmoji,
    healthScore,
    totalResponses,
    sourceStats,
    turnAudits,
    alerts
  };
}

// ============================================================================
// HELPER: Format Response Source Audit
// ============================================================================

function formatResponseSourceAudit(events) {
  const audit = computeResponseSourceAudit(events);
  
  if (audit.totalResponses === 0) {
    return `
Response Source Audit:
- (No responses recorded)
`;
  }
  
  // Build turn-by-turn source log
  const turnLines = audit.turnAudits.map(t => 
    `    T${t.turn}: ${t.emoji} ${t.source}${t.tier !== 'unknown' ? ` (${t.tier})` : ''} ${t.scenarioMatched ? `[scenario: ${t.scenarioMatched}]` : ''}${t.tokensUsed > 0 ? ` [tokens: ${t.tokensUsed}]` : ''}`
  ).join('\n');
  
  // Build source breakdown
  const sourceBreakdown = Object.entries(audit.sourceStats)
    .sort((a, b) => b[1] - a[1])
    .map(([source, count]) => `${source}: ${count}`)
    .join(', ');
  
  // Build alerts
  const alertLines = audit.alerts.length > 0
    ? audit.alerts.slice(0, 5).map(a => 
        `    [${a.severity}] ${a.message}${a.suggestion ? `\n           → ${a.suggestion}` : ''}`
      ).join('\n')
    : '    (No issues detected - all sources properly tracked)';
  
  return `
Response Source Audit: ${audit.overallEmoji} ${audit.overallStatus} (${audit.healthScore}% tracked)
- Sources: ${sourceBreakdown}
- Expected: scenario_match, tier1, tier3, greeting, state_machine, booking_slot

Turn-by-Turn Sources (WHERE DID RESPONSE COME FROM?):
${turnLines}

Alerts:
${alertLines}
`;
}

// ============================================================================
// HELPER: Format Latency Analysis
// ============================================================================
// Formats the latency analysis into a readable text block for the snapshot.
// This appears automatically in every Black Box snapshot for quick diagnosis.
// ============================================================================

function formatLatencyAnalysis(latencyAnalysis) {
  if (!latencyAnalysis) {
    return `
Latency Analysis:
- (No latency analysis available - check BlackBoxLogger)
`;
  }
  
  const summary = latencyAnalysis.summary || {};
  const averages = latencyAnalysis.averages || {};
  const recommendations = latencyAnalysis.recommendations || [];
  const turnAnalyses = latencyAnalysis.turnAnalyses || [];
  
  // Grade emoji
  const gradeEmoji = {
    'A': '🟢',
    'B': '🟡',
    'C': '🟠',
    'D': '🔴',
    'F': '⛔'
  };
  
  // Build turn-by-turn breakdown (max 5 turns shown)
  const turnBreakdownLines = turnAnalyses.slice(0, 5).map(t => {
    const statusEmoji = t.status === 'GOOD' ? '✅' : t.status === 'ACCEPTABLE' ? '⚠️' : '❌';
    return `    Turn ${t.turn}: ${t.timing.totalMs}ms (AI=${t.timing.aiMs}ms, TTS=${t.timing.ttsMs}ms) ${statusEmoji} ${t.tier.toUpperCase()} [${t.bottleneck}]`;
  }).join('\n');
  
  // Build recommendations
  const recommendationLines = recommendations.length > 0
    ? recommendations.slice(0, 3).map(r => `    [${r.priority}] ${r.issue}\n      → ${r.action}`).join('\n')
    : '    (No issues detected)';
  
  return `
Latency Analysis: ${gradeEmoji[summary.overallGrade] || '?'} Grade ${summary.overallGrade || '?'}
- avgResponseMs: ${summary.avgResponseMs || 0}ms (target: <1500ms for tier1, <2500ms for tier3)
- primaryBottleneck: ${summary.primaryBottleneck || 'UNKNOWN'}
- tier1Usage: ${summary.tier1Percentage || 0}% (higher = faster + cheaper)
- averages: AI=${averages.aiMs || 0}ms, TTS=${averages.ttsMs || 0}ms

Turn-by-Turn Timing:
${turnBreakdownLines || '    (no turns recorded)'}

Recommendations:
${recommendationLines}
`;
}

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
${formatLatencyAnalysis(recording.performance?.latencyAnalysis)}
${formatResponseSourceAudit(recording.events || [])}
${formatScenarioSuggestions(recording.events || [])}
Key Timeline:
`;

  // Add key events - include all significant decision points
  const keyEvents = (recording.events || [])
    .filter(e => [
      'GREETING_SENT', 'GATHER_FINAL', 'INTENT_DETECTED', 'TRIAGE_DECISION',
      // Scenario matching events (CRITICAL for debugging)
      'SCENARIO_MATCH_ATTEMPT', 'SCENARIO_MATCHED', 'SCENARIO_NO_MATCH',
      // Tier-3 LLM events
      'TIER3_ENTERED', 'TIER3_FAST_MATCH', 'TIER3_EMBEDDING_MATCH',
      'TIER3_FALLBACK', 'TIER3_LLM_FALLBACK_CALLED', 'TIER3_LLM_FALLBACK_RESPONSE', 'TIER3_EXIT',
      // Booking events
      'BOOKING_MODE_ACTIVATED', 'BOOKING_MODE_LOCKED', 'BOOKING_STEP', 
      'BOOKING_SLOT_FILLED', 'BOOKING_OVERRIDDEN', 'BOOKING_COMPLETE',
      'BOOKING_INTENT_OVERRIDE',
      // Response and call events
      'AGENT_RESPONSE_BUILT', 'LOOP_DETECTED', 'BAILOUT_TRIGGERED', 
      'TRANSFER_INITIATED', 'CALL_END',
      // Mode changes
      'MODE_CHANGED', 'SLOT_COLLECTED', 'CUSTOMER_IDENTIFIED'
    ].includes(e.type))
    .slice(0, 40);
  
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
      case 'AGENT_RESPONSE_BUILT': {
        const src = event.data?.source || 'unknown';
        const tier = event.data?.tier || '';
        const tokens = event.data?.tokensUsed || 0;
        const srcEmoji = src === 'unknown' ? '❓' : (tier === 'tier3' || src.includes('llm') || src.includes('LLM')) ? '💰' : '✅';
        detail = `${srcEmoji} [${src}${tier ? '/' + tier : ''}] "${(event.data?.text || '').substring(0, 40)}..."${tokens > 0 ? ` (${tokens} tokens)` : ''}`;
        break;
      }
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
      // === SCENARIO MATCHING EVENTS (Critical for debugging) ===
      case 'SCENARIO_MATCH_ATTEMPT':
        detail = `🔍 Looking for: "${(event.data?.userText || '').substring(0, 40)}..." in ${event.data?.scenarioCount || '?'} scenarios`;
        break;
      case 'SCENARIO_MATCHED':
        detail = `✅ MATCH: ${event.data?.scenarioName || event.data?.scenarioId || '?'} (${(event.data?.confidence || 0).toFixed(2)}) → "${(event.data?.reply || '').substring(0, 40)}..."`;
        break;
      case 'SCENARIO_NO_MATCH':
        detail = `❌ NO MATCH: ${event.data?.reason || 'unknown'}, top candidate: ${event.data?.topCandidate || 'none'} (${(event.data?.topConfidence || 0).toFixed(2)})`;
        break;
      case 'TIER3_FALLBACK':
        detail = `💰 LLM FALLBACK: reason=${event.data?.reason || '?'} tokens=${event.data?.tokensUsed || '?'}`;
        break;
      // === MODE & STATE EVENTS ===
      case 'MODE_CHANGED':
        detail = `${event.data?.from || '?'} → ${event.data?.to || '?'} (reason: ${event.data?.reason || '?'})`;
        break;
      case 'SLOT_COLLECTED':
        detail = `📝 ${event.data?.slotKey || '?'} = "${event.data?.value || '?'}"`;
        break;
      case 'CUSTOMER_IDENTIFIED':
        detail = `👤 ${event.data?.customerName || 'unknown'} (returning: ${event.data?.isReturning || false})`;
        break;
      default:
        detail = JSON.stringify(event.data || {}).substring(0, 50);
    }
    
    snapshot += `- ${time} ${event.type} ${detail}\n`;
  }
  
  return snapshot;
}

// ============================================================================
// HELPER: Scenario Suggestions (Per-Call, Deterministic)
// ============================================================================

function formatScenarioSuggestions(events) {
  try {
    const result = ScenarioSuggestionEngine.suggestFromEvents(events || [], { maxSuggestions: 6 });
    if (!result?.available) {
      return `
Scenario Suggestions:
- (Unavailable)
`;
    }

    const suggestions = result.suggestions || [];
    if (suggestions.length === 0) {
      return `
Scenario Suggestions:
- None detected for this call.
`;
    }

    const lines = suggestions.map((s, idx) => {
      const examples = (s.examples || []).map(e => `"${e}"`).join(', ');
      const triggers = (s.triggers || []).slice(0, 6).map(t => `"${t}"`).join(', ');
      const negatives = (s.negativeTriggers || []).slice(0, 6).map(t => `"${t}"`).join(', ');
      const evidence = s.evidence || {};

      return `  ${idx + 1}. ${s.suggestedScenarioName}
     - intent: ${s.intentLabel} (${s.intentKey})
     - recommendedTier: ${s.recommendedTier}
     - evidence: count=${evidence.count || 0}, tier3Count=${evidence.tier3Count || 0}, avgTier3LatencyMs=${evidence.avgTier3LatencyMs || 0}
     - exampleUtterances: ${examples || '(none)'}
     - triggerIdeas: ${triggers || '(none)'}
     - negativeTriggerIdeas: ${negatives || '(none)'}
     - responseGoal: ${s.responseGoal || 'N/A'}`;
    }).join('\n');

    return `
Scenario Suggestions:
- summary: ${result.summary?.message || ''}
- gapsDetected: ${result.summary?.totalGaps || 0}
- tier3Fallbacks: ${result.summary?.totalTier3Fallbacks || 0}
- topSuggestions:
${lines}
`;
  } catch (error) {
    return `
Scenario Suggestions:
- (Failed to generate: ${error.message})
`;
  }
}

// ============================================================================
// EXPORT
// ============================================================================

module.exports = router;

