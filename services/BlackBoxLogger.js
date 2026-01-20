/**
 * ============================================================================
 * BLACK BOX LOGGER SERVICE - V2 (Jan 2026)
 * ============================================================================
 * 
 * THE SINGLE ENTRY POINT FOR ALL CALL RECORDING.
 * 
 * ARCHITECTURE UPDATE (Jan 18, 2026):
 * - Renamed "Brain-1" → "ConversationEngine"
 * - Renamed "Brain-2" → Removed (merged into ConversationEngine)
 * - Renamed "Triage" → "ScenarioMatcher"
 * - Added 3-Tier Intelligence tracking (Tier1=Rules, Tier2=Semantic, Tier3=LLM)
 * - Added response source tracking (matchSource, tier, tokensUsed)
 * - Added scenario matching events
 * - Added mode transition events
 * 
 * METHODS:
 * - initCall()     → Start recording a new call
 * - logEvent()     → Append an event to the timeline
 * - appendError()  → Log an error
 * - addTranscript()→ Add caller/agent turn to transcript
 * - finalizeCall() → Compute summary, diagnosis, visualizations
 * 
 * USAGE:
 *   const BlackBoxLogger = require('../services/BlackBoxLogger');
 *   await BlackBoxLogger.initCall({ callId, companyId, from, to });
 *   await BlackBoxLogger.logEvent({ callId, companyId, type: 'GREETING_SENT', data: {...} });
 *   await BlackBoxLogger.finalizeCall({ callId, companyId, summary: {...} });
 * 
 * ============================================================================
 */

const BlackBoxRecording = require('../models/BlackBoxRecording');
const logger = require('../utils/logger');

// ============================================================================
// HELPER: Truncate text for display
// ============================================================================
function truncate(text, maxLen = 40) {
  if (!text) return '';
  return text.length > maxLen ? text.substring(0, maxLen) + '...' : text;
}

// ============================================================================
// INIT CALL - Start recording
// ============================================================================

/**
 * Initialize a new call recording
 * Call this at the START of /voice endpoint, test console, SMS, or web chat
 */
async function initCall({ callId, companyId, from, to, source = 'voice', customerId, customerContext, sessionSnapshot }) {
  const now = new Date();
  
  try {
    const recording = await BlackBoxRecording.create({
      callId,
      companyId,
      from,
      to,
      source,
      startedAt: now,
      customerId: customerId || null,
      customerContext: customerContext || {},
      sessionSnapshot: sessionSnapshot || {
        phase: 'greeting',
        mode: 'DISCOVERY',
        locks: {
          greeted: false,
          issueCaptured: false,
          bookingStarted: false,
          bookingLocked: false,
          askedSlots: {}
        },
        memory: {
          rollingSummary: '',
          facts: {},
          lastUserIntent: null,
          acknowledgedClaims: []
        }
      },
      events: [{
        type: 'CALL_START',
        ts: now,
        t: 0,
        turn: 0,
        data: {
          from,
          to,
          source,
          customerId: customerId || null,
          isReturning: customerContext?.isReturning || false
        }
      }],
      transcript: {
        callerTurns: [],
        agentTurns: []
      }
    });
    
    logger.info('[BLACK BOX] 📼 Recording started', {
      callId,
      companyId: companyId.toString(),
      from,
      source
    });
    
    return recording;
    
  } catch (error) {
    // Don't let black box failures kill the call
    logger.error('[BLACK BOX] Failed to init recording (non-fatal)', {
      callId,
      companyId,
      source,
      error: error.message
    });
    return null;
  }
}

/**
 * Ensure a call recording exists (idempotent).
 */
async function ensureCall({ callId, companyId, from, to, source = 'voice', customerId, customerContext, sessionSnapshot }) {
  try {
    const existing = await BlackBoxRecording.findOne({ callId, companyId }).lean();
    if (existing) return existing;
    return await initCall({ callId, companyId, from, to, source, customerId, customerContext, sessionSnapshot });
  } catch (error) {
    logger.error('[BLACK BOX] Failed to ensure recording (non-fatal)', {
      callId,
      companyId,
      source,
      error: error.message
    });
    return null;
  }
}

// ============================================================================
// LOG EVENT - Append to timeline
// ============================================================================

async function logEvent({ callId, companyId, type, turn, data = {} }) {
  const now = new Date();
  
  try {
    // Get startedAt for calculating offset
    const rec = await BlackBoxRecording.findOne(
      { callId, companyId },
      { startedAt: 1 }
    ).lean();
    
    if (!rec) {
      logger.warn('[BLACK BOX] Cannot log event - recording not found', {
        callId,
        type
      });
      return false;
    }
    
    const t = rec.startedAt ? (now.getTime() - new Date(rec.startedAt).getTime()) : 0;
    
    await BlackBoxRecording.updateOne(
      { callId, companyId },
      {
        $push: {
          events: {
            type,
            ts: now,
            t,
            turn: turn || 0,
            data
          }
        }
      }
    );
    
    logger.debug('[BLACK BOX] Event logged', {
      callId,
      type,
      t: `${(t / 1000).toFixed(1)}s`
    });
    
    return true;
    
  } catch (error) {
    logger.error('[BLACK BOX] Failed to log event (non-fatal)', {
      callId,
      type,
      error: error.message
    });
    return false;
  }
}

// ============================================================================
// APPEND ERROR
// ============================================================================

async function appendError({ callId, companyId, source, error }) {
  const now = new Date();
  
  try {
    await BlackBoxRecording.updateOne(
      { callId, companyId },
      {
        $push: {
          errors: {
            ts: now,
            source: source || 'UNKNOWN',
            message: error?.message || String(error),
            stack: error?.stack || null
          }
        }
      }
    );
    
    // Also log as event
    await logEvent({
      callId,
      companyId,
      type: 'ERROR_OCCURRED',
      data: {
        source,
        message: error?.message || String(error)
      }
    });
    
    return true;
    
  } catch (err) {
    logger.error('[BLACK BOX] Failed to append error (non-fatal)', {
      callId,
      originalError: error?.message,
      logError: err.message
    });
    return false;
  }
}

// ============================================================================
// ADD TRANSCRIPT
// ============================================================================

async function addTranscript({ callId, companyId, speaker, turn, text, confidence, source }) {
  try {
    const rec = await BlackBoxRecording.findOne(
      { callId, companyId },
      { startedAt: 1 }
    ).lean();
    
    if (!rec) return false;
    
    const now = new Date();
    const t = rec.startedAt ? (now.getTime() - new Date(rec.startedAt).getTime()) : 0;
    
    if (speaker === 'caller') {
      await BlackBoxRecording.updateOne(
        { callId, companyId },
        {
          $push: {
            'transcript.callerTurns': {
              turn,
              t,
              text,
              confidence: confidence || 1.0
            }
          }
        }
      );
    } else {
      await BlackBoxRecording.updateOne(
        { callId, companyId },
        {
          $push: {
            'transcript.agentTurns': {
              turn,
              t,
              text,
              source: source || 'UNKNOWN'
            }
          }
        }
      );
    }
    
    return true;
    
  } catch (error) {
    logger.error('[BLACK BOX] Failed to add transcript (non-fatal)', {
      callId,
      speaker,
      error: error.message
    });
    return false;
  }
}

// ============================================================================
// LOG BOOKING DIAGNOSTIC - What was done vs. what was missed
// ============================================================================

/**
 * Log a comprehensive diagnostic checklist at end of booking
 * Shows what features were used vs. missed for debugging
 */
async function logBookingDiagnostic({ callId, companyId, filledSlots, addressConfig, sessionMeta }) {
  try {
    const checklist = [];
    
    // ═══════════════════════════════════════════════════════════════════════════
    // NAME COLLECTION
    // ═══════════════════════════════════════════════════════════════════════════
    if (filledSlots?.name) {
      checklist.push({ 
        item: 'Name collected', 
        status: 'done', 
        value: filledSlots.name,
        details: null
      });
      
      // Check if spelling was confirmed (Mark vs Marc)
      if (sessionMeta?.nameSpellingConfirmed) {
        checklist.push({ item: 'Name spelling confirmed', status: 'done', value: sessionMeta.nameSpelling });
      } else {
        checklist.push({ 
          item: 'Name spelling NOT confirmed', 
          status: 'missed',
          value: filledSlots.name,
          suggestion: 'Enable "Confirm spelling" in Booking Prompts → Name slot'
        });
      }
    } else {
      checklist.push({ item: 'Name collection', status: 'missed', suggestion: 'Name slot not configured or not collected' });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // PHONE COLLECTION
    // ═══════════════════════════════════════════════════════════════════════════
    if (filledSlots?.phone) {
      checklist.push({ item: 'Phone collected', status: 'done', value: filledSlots.phone });
      if (sessionMeta?.phoneFromCallerId) {
        checklist.push({ item: 'Phone from caller ID', status: 'done', value: 'Used caller ID' });
      }
    } else {
      checklist.push({ item: 'Phone collection', status: 'missed' });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // ADDRESS COLLECTION & VALIDATION
    // ═══════════════════════════════════════════════════════════════════════════
    if (filledSlots?.address) {
      checklist.push({ item: 'Address collected', status: 'done', value: filledSlots.address });
      
      // Google Maps Validation
      if (addressConfig?.useGoogleMapsValidation) {
        if (sessionMeta?.googleMapsValidated) {
          checklist.push({ 
            item: 'Google Maps validation', 
            status: 'done',
            value: sessionMeta.googleMapsNormalized || filledSlots.address
          });
        } else {
          checklist.push({ 
            item: 'Google Maps validation FAILED', 
            status: 'warning',
            suggestion: 'Check API key or address format'
          });
        }
      } else {
        checklist.push({ 
          item: 'Google Maps validation DISABLED', 
          status: 'missed',
          suggestion: 'Enable: Front Desk → Booking Prompts → Address → "Enable Google Maps validation"'
        });
      }
      
      // Unit Number Detection
      if (sessionMeta?.unitNumberAsked) {
        checklist.push({ 
          item: 'Unit/Apt number asked', 
          status: 'done',
          value: sessionMeta.unitNumber || 'Caller said N/A'
        });
      } else if (addressConfig?.unitNumberMode === 'smart' || addressConfig?.unitNumberMode === 'always') {
        checklist.push({ 
          item: 'Unit number NOT asked', 
          status: 'missed',
          suggestion: 'Google Maps validation needed for smart unit detection'
        });
      }
      
      // Gate Code Detection
      if (sessionMeta?.gateCodeAsked) {
        checklist.push({ 
          item: 'Gate code asked', 
          status: 'done',
          value: sessionMeta.gateCode || 'Caller provided none'
        });
      } else {
        checklist.push({ 
          item: 'Gate code NOT asked', 
          status: 'info',
          suggestion: 'Gated community detection requires Google Maps validation'
        });
      }
      
      // Equipment Access
      if (sessionMeta?.equipmentAccessAsked) {
        checklist.push({ item: 'Equipment access asked', status: 'done' });
      } else {
        checklist.push({ 
          item: 'Equipment access NOT asked', 
          status: 'info',
          suggestion: 'Enable in Address slot settings if needed'
        });
      }
    } else {
      checklist.push({ item: 'Address collection', status: 'missed' });
    }
    
    // ═══════════════════════════════════════════════════════════════════════════
    // TIME COLLECTION
    // ═══════════════════════════════════════════════════════════════════════════
    if (filledSlots?.time) {
      checklist.push({ item: 'Time/Date collected', status: 'done', value: filledSlots.time });
    } else {
      checklist.push({ item: 'Time/Date collection', status: 'missed' });
    }
    
    // Count stats
    const doneCount = checklist.filter(c => c.status === 'done').length;
    const missedCount = checklist.filter(c => c.status === 'missed').length;
    const warningCount = checklist.filter(c => c.status === 'warning').length;
    
    // Log to Black Box
    await logEvent({
      callId,
      companyId,
      type: 'BOOKING_DIAGNOSTIC',
      data: {
        checklist,
        summary: {
          done: doneCount,
          missed: missedCount,
          warnings: warningCount,
          total: checklist.length
        },
        filledSlots,
        configUsed: {
          googleMapsValidation: addressConfig?.useGoogleMapsValidation || false,
          unitNumberMode: addressConfig?.unitNumberMode || 'never',
          nameSpellingConfirm: addressConfig?.nameSpellingConfirm || false
        }
      }
    });
    
    logger.info('[BLACK BOX] 📋 Booking diagnostic logged', {
      callId,
      done: doneCount,
      missed: missedCount
    });
    
    return { checklist, done: doneCount, missed: missedCount };
    
  } catch (error) {
    logger.error('[BLACK BOX] Failed to log booking diagnostic', { callId, error: error.message });
    return null;
  }
}

// ============================================================================
// FINALIZE CALL - Compute summary + visualizations
// ============================================================================

async function finalizeCall({ callId, companyId, endedAt, callOutcome, performanceData }) {
  try {
    const recording = await BlackBoxRecording.findOne({ callId, companyId });
    
    if (!recording) {
      logger.warn('[BLACK BOX] Cannot finalize - recording not found', { callId });
      return null;
    }
    
    const events = recording.events || [];
    const now = endedAt || new Date();
    
    // Calculate duration
    const durationMs = now.getTime() - new Date(recording.startedAt).getTime();
    
    // Compute performance metrics
    const performance = computePerformance(events, performanceData);
    
    // Compute flags
    const flags = computeFlags(events, recording);
    
    // Compute booking story
    const booking = computeBookingStory(events, recording.bookingProgress);
    
    // Compute diagnosis
    const diagnosis = computeDiagnosis(events, flags, booking, recording);
    
    // Generate visualizations
    const visualization = {
      sequenceDiagram: generateSequenceDiagram(events),
      waterfall: generateWaterfall(events, performanceData),
      decisionTree: generateDecisionTree(events, flags)
    };
    
    // Update recording
    await BlackBoxRecording.updateOne(
      { callId, companyId },
      {
        $set: {
          endedAt: now,
          durationMs,
          callOutcome: callOutcome || 'COMPLETED',
          performance,
          flags,
          booking,
          diagnosis,
          visualization
        }
      }
    );
    
    logger.info('[BLACK BOX] 📼 Recording finalized', {
      callId,
      durationMs,
      outcome: callOutcome,
      flags
    });
    
    return { callId, durationMs, callOutcome, flags, diagnosis };
    
  } catch (error) {
    logger.error('[BLACK BOX] Failed to finalize recording', {
      callId,
      error: error.message
    });
    return null;
  }
}

// ============================================================================
// COMPUTE FUNCTIONS
// ============================================================================

function computePerformance(events, performanceData = {}) {
  const gatherEvents = events.filter(e => e.type === 'GATHER_FINAL');
  const responseEvents = events.filter(e => e.type === 'AGENT_RESPONSE_BUILT');
  const totalTurns = gatherEvents.length;
  
  // Calculate turn latencies
  const turnLatencies = [];
  
  for (let i = 0; i < gatherEvents.length; i++) {
    const gather = gatherEvents[i];
    const nextResponse = responseEvents.find(r => r.t > gather.t);
    
    if (nextResponse) {
      const latency = nextResponse.t - gather.t;
      turnLatencies.push(latency);
    }
  }
  
  const avgTurnTimeMs = turnLatencies.length > 0 
    ? Math.round(turnLatencies.reduce((a, b) => a + b, 0) / turnLatencies.length)
    : 0;
  
  // Find slowest turn
  const slowestTurnMs = Math.max(...turnLatencies, 0);
  const slowestTurnIndex = turnLatencies.indexOf(slowestTurnMs);
  
  // Build turn breakdowns
  const turnBreakdowns = [];
  
  for (let i = 0; i < gatherEvents.length; i++) {
    const gather = gatherEvents[i];
    const nextGather = gatherEvents[i + 1];
    
    const turnEvents = events.filter(e => 
      e.t >= gather.t && 
      (nextGather ? e.t < nextGather.t : true)
    );
    
    // Find specific events in this turn
    const scenarioMatch = turnEvents.find(e => e.type === 'SCENARIO_MATCHED');
    const tier3Event = turnEvents.find(e => e.type === 'TIER3_FALLBACK');
    const ttsEvent = turnEvents.find(e => e.type === 'TTS_COMPLETED');
    const responseEvent = turnEvents.find(e => e.type === 'AGENT_RESPONSE_BUILT');
    
    const breakdown = {
      turn: i + 1,
      sttMs: 300, // Approximate
      matchingMs: scenarioMatch?.data?.latencyMs || 50,
      tier3Ms: tier3Event?.data?.latencyMs || 0,
      ttsMs: ttsEvent?.data?.latencyMs || 0,
      totalMs: responseEvent ? (responseEvent.t - gather.t) : 0,
      bottleneck: 'UNKNOWN'
    };
    
    // Determine bottleneck
    const maxComponent = Math.max(breakdown.sttMs, breakdown.matchingMs, breakdown.tier3Ms, breakdown.ttsMs);
    if (maxComponent === breakdown.tier3Ms && breakdown.tier3Ms > 0) {
      breakdown.bottleneck = 'LLM';
    } else if (maxComponent === breakdown.ttsMs && breakdown.ttsMs > 0) {
      breakdown.bottleneck = 'TTS';
    } else if (maxComponent === breakdown.matchingMs) {
      breakdown.bottleneck = 'MATCHING';
    } else {
      breakdown.bottleneck = 'STT';
    }
    
    turnBreakdowns.push(breakdown);
  }
  
  // Count LLM calls by tier
  const tier1Matches = events.filter(e => e.type === 'SCENARIO_MATCHED' && e.data?.tier === 'tier1').length;
  const tier2Matches = events.filter(e => e.type === 'SCENARIO_MATCHED' && e.data?.tier === 'tier2').length;
  const tier3Fallbacks = events.filter(e => e.type === 'TIER3_FALLBACK').length;
  
  // Calculate total LLM tokens
  const tokensUsed = events
    .filter(e => e.data?.tokensUsed > 0)
    .reduce((sum, e) => sum + (e.data.tokensUsed || 0), 0);
  
  // TTS total
  const ttsEvents = events.filter(e => e.type === 'TTS_COMPLETED');
  const ttsTotalMs = ttsEvents.reduce((sum, e) => sum + (e.data?.latencyMs || 0), 0);
  
  // ═══════════════════════════════════════════════════════════════════════════
  // LATENCY ANALYSIS - Automatic Performance Diagnostics
  // ═══════════════════════════════════════════════════════════════════════════
  const latencyAnalysis = computeLatencyAnalysis(events, turnBreakdowns, {
    tier1: tier1Matches,
    tier2: tier2Matches,
    tier3: tier3Fallbacks
  }, ttsTotalMs);
  
  return {
    totalTurns,
    avgTurnTimeMs,
    slowestTurn: slowestTurnIndex + 1,
    slowestTurnMs,
    turnBreakdowns,
    tierStats: {
      tier1: tier1Matches,
      tier2: tier2Matches,
      tier3: tier3Fallbacks,
      tokensUsed
    },
    ttsTotalMs,
    // ═══════════════════════════════════════════════════════════════════════
    // V2: LATENCY ANALYSIS (auto-embedded in every Black Box report)
    // ═══════════════════════════════════════════════════════════════════════
    latencyAnalysis
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * LATENCY ANALYSIS - Automatic Performance Diagnostics
 * ═══════════════════════════════════════════════════════════════════════════════
 * Computes detailed latency breakdown for every call, identifying:
 * - Where delays occur (AI, TTS, STT)
 * - Performance vs targets
 * - Bottleneck identification
 * - Recommendations
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function computeLatencyAnalysis(events, turnBreakdowns, tierStats, ttsTotalMs) {
  // Performance targets (ms)
  const TARGETS = {
    tier1Response: 1000,      // Scenario match + TTS: target <1s
    tier3Response: 2500,      // LLM + TTS: target <2.5s
    ttsGeneration: 1000,      // TTS: target <1s
    aiProcessingTier1: 300,   // Scenario matching: target <300ms
    aiProcessingTier3: 2000,  // LLM call: target <2s
    fullCycleGood: 1500,      // Good experience: <1.5s
    fullCycleAcceptable: 2500,// Acceptable: <2.5s
    fullCyclePoor: 4000       // Poor: >4s
  };
  
  // Analyze each turn
  const turnAnalyses = turnBreakdowns.map((turn, idx) => {
    const aiMs = turn.tier3Ms > 0 ? turn.tier3Ms : turn.matchingMs;
    const ttsMs = turn.ttsMs || 0;
    const totalMs = turn.totalMs || 0;
    const tier = turn.tier3Ms > 0 ? 'tier3' : 'tier1';
    
    // Calculate targets for this turn's tier
    const aiTarget = tier === 'tier3' ? TARGETS.aiProcessingTier3 : TARGETS.aiProcessingTier1;
    const totalTarget = tier === 'tier3' ? TARGETS.tier3Response : TARGETS.tier1Response;
    
    // Status determination
    let status = 'GOOD';
    let grade = 'A';
    if (totalMs > TARGETS.fullCyclePoor) {
      status = 'CRITICAL';
      grade = 'F';
    } else if (totalMs > TARGETS.fullCycleAcceptable) {
      status = 'SLOW';
      grade = 'D';
    } else if (totalMs > TARGETS.fullCycleGood) {
      status = 'ACCEPTABLE';
      grade = 'C';
    } else if (totalMs > 800) {
      grade = 'B';
    }
    
    return {
      turn: idx + 1,
      tier,
      timing: {
        aiMs,
        ttsMs,
        totalMs,
        aiTarget,
        totalTarget
      },
      status,
      grade,
      bottleneck: turn.bottleneck,
      overTarget: totalMs > totalTarget
    };
  });
  
  // Calculate averages
  const avgAiMs = turnAnalyses.length > 0
    ? Math.round(turnAnalyses.reduce((sum, t) => sum + t.timing.aiMs, 0) / turnAnalyses.length)
    : 0;
  const avgTtsMs = turnAnalyses.length > 0
    ? Math.round(turnAnalyses.reduce((sum, t) => sum + t.timing.ttsMs, 0) / turnAnalyses.length)
    : 0;
  const avgTotalMs = turnAnalyses.length > 0
    ? Math.round(turnAnalyses.reduce((sum, t) => sum + t.timing.totalMs, 0) / turnAnalyses.length)
    : 0;
  
  // Identify primary bottleneck across all turns
  const bottleneckCounts = { LLM: 0, TTS: 0, MATCHING: 0, STT: 0, UNKNOWN: 0 };
  turnAnalyses.forEach(t => {
    bottleneckCounts[t.bottleneck] = (bottleneckCounts[t.bottleneck] || 0) + 1;
  });
  const primaryBottleneck = Object.entries(bottleneckCounts)
    .sort((a, b) => b[1] - a[1])[0]?.[0] || 'UNKNOWN';
  
  // Calculate overall grade
  const gradeWeights = { A: 4, B: 3, C: 2, D: 1, F: 0 };
  const avgGradeScore = turnAnalyses.length > 0
    ? turnAnalyses.reduce((sum, t) => sum + gradeWeights[t.grade], 0) / turnAnalyses.length
    : 0;
  let overallGrade = 'A';
  if (avgGradeScore < 1) overallGrade = 'F';
  else if (avgGradeScore < 2) overallGrade = 'D';
  else if (avgGradeScore < 2.5) overallGrade = 'C';
  else if (avgGradeScore < 3.5) overallGrade = 'B';
  
  // Generate recommendations
  const recommendations = [];
  
  if (primaryBottleneck === 'LLM' && tierStats.tier3 > tierStats.tier1) {
    recommendations.push({
      priority: 'HIGH',
      issue: 'LLM fallback used more than scenarios',
      action: 'Add more scenario triggers to reduce LLM calls',
      impact: 'Save 1-2s per response + reduce costs'
    });
  }
  
  if (avgTtsMs > TARGETS.ttsGeneration) {
    recommendations.push({
      priority: 'MEDIUM',
      issue: `TTS averaging ${avgTtsMs}ms (target: ${TARGETS.ttsGeneration}ms)`,
      action: 'Implement TTS caching for common phrases',
      impact: 'Save 800-1200ms on cached responses'
    });
  }
  
  if (primaryBottleneck === 'LLM') {
    recommendations.push({
      priority: 'MEDIUM',
      issue: 'LLM is the primary bottleneck',
      action: 'Enable latency masking ("One moment please")',
      impact: 'Eliminates perceived dead silence'
    });
  }
  
  const slowTurns = turnAnalyses.filter(t => t.status === 'CRITICAL' || t.status === 'SLOW');
  if (slowTurns.length > 0) {
    recommendations.push({
      priority: 'HIGH',
      issue: `${slowTurns.length} of ${turnAnalyses.length} turns exceeded acceptable latency`,
      action: 'Review slow turns for trigger improvements',
      impact: 'Better caller experience'
    });
  }
  
  // Summary
  const summary = {
    overallGrade,
    avgResponseMs: avgTotalMs,
    primaryBottleneck,
    tier1Percentage: turnAnalyses.length > 0 
      ? Math.round((turnAnalyses.filter(t => t.tier === 'tier1').length / turnAnalyses.length) * 100)
      : 0,
    targets: {
      tier1: TARGETS.tier1Response,
      tier3: TARGETS.tier3Response,
      tts: TARGETS.ttsGeneration
    }
  };
  
  return {
    summary,
    turnAnalyses,
    averages: {
      aiMs: avgAiMs,
      ttsMs: avgTtsMs,
      totalMs: avgTotalMs
    },
    bottleneckBreakdown: bottleneckCounts,
    recommendations
  };
}

/**
 * ═══════════════════════════════════════════════════════════════════════════════
 * RESPONSE SOURCE AUDIT - Detect Legacy Paths & Hijacking
 * ═══════════════════════════════════════════════════════════════════════════════
 * Tracks WHERE each response came from and WHY.
 * Flags suspicious sources that might indicate legacy code hijacking.
 * 
 * LEGITIMATE SOURCES (Production-Ready):
 * - SCENARIO_MATCHED: Scenario from template matched (BEST - free, fast)
 * - GREETING_INTERCEPT: Greeting handled without LLM (GOOD - free)
 * - STATE_MACHINE: Booking flow deterministic response (GOOD - free)
 * - LLM_FALLBACK/TIER3: No scenario matched, LLM generated (OK - costs $)
 * - QUICK_ANSWER: Company quick answers matched (GOOD - free)
 * 
 * SUSPICIOUS SOURCES (May indicate legacy/bug):
 * - unknown: Source not tracked - INVESTIGATE
 * - undefined: Missing source field - BUG
 * - HARDCODED: Hardcoded fallback triggered - LEGACY ALERT
 * - LEGACY_*: Any source starting with LEGACY - OLD CODE STILL RUNNING
 * - null: Null source - ERROR IN LOGGING
 * 
 * ═══════════════════════════════════════════════════════════════════════════════
 */
function computeResponseSourceAudit(events) {
  // Define legitimate vs suspicious sources
  const LEGITIMATE_SOURCES = [
    'SCENARIO_MATCHED', 'TIER1_SCENARIO_MATCH',
    'GREETING_INTERCEPT', 'GREETING',
    'STATE_MACHINE', 'STATE_MACHINE_BOOKING', 'STATE_MACHINE_DISCOVERY',
    'STATE_MACHINE_GREETING', 'STATE_MACHINE_UI', 'STATE_MACHINE_DEFAULT',
    'LLM_FALLBACK', 'TIER3_FALLBACK', 'LLM',
    'QUICK_ANSWER', 'CHEATSHEET_MATCH',
    'BOOKING_SLOT', 'BOOKING_CONFIRM', 'BOOKING_COMPLETE',
    'FAST_PATH_BOOKING', 'BOOKING_SAFETY_NET'
  ];
  
  const SUSPICIOUS_PATTERNS = [
    /^unknown$/i,
    /^undefined$/i,
    /^null$/i,
    /^HARDCODED/i,
    /^LEGACY/i,
    /^DEFAULT.*FALLBACK/i,
    /^MISSING/i,
    /^ERROR/i
  ];
  
  // Get all response events
  const responseEvents = events.filter(e => e.type === 'AGENT_RESPONSE_BUILT');
  const gatherEvents = events.filter(e => e.type === 'GATHER_FINAL');
  const scenarioEvents = events.filter(e => e.type === 'SCENARIO_MATCHED' || e.type === 'SCENARIO_NO_MATCH');
  
  // Build turn-by-turn source audit
  const turnAudits = [];
  const sourceStats = {};
  const alerts = [];
  
  for (let i = 0; i < responseEvents.length; i++) {
    const response = responseEvents[i];
    const source = response.data?.source || 'unknown';
    const tier = response.data?.tier || 'unknown';
    const text = response.data?.text || '';
    
    // Find corresponding gather event
    const prevGather = gatherEvents.filter(g => g.t < response.t).pop();
    const userText = prevGather?.data?.text || '';
    
    // Find scenario match attempt for this turn
    const scenarioForTurn = scenarioEvents.find(s => 
      s.t >= (prevGather?.t || 0) && s.t <= response.t
    );
    
    // Count sources
    sourceStats[source] = (sourceStats[source] || 0) + 1;
    
    // Check if source is legitimate
    const isLegitimate = LEGITIMATE_SOURCES.some(leg => 
      source.toUpperCase().includes(leg.toUpperCase())
    );
    
    // Check if source is suspicious
    const isSuspicious = SUSPICIOUS_PATTERNS.some(pattern => pattern.test(source));
    
    // Determine status
    let status = 'OK';
    let flag = null;
    
    if (isSuspicious) {
      status = 'ALERT';
      flag = `⚠️ SUSPICIOUS SOURCE: "${source}" - May be legacy code or missing tracking`;
      alerts.push({
        turn: i + 1,
        type: 'SUSPICIOUS_SOURCE',
        source,
        message: flag,
        userText: userText.substring(0, 50),
        responseText: text.substring(0, 50)
      });
    } else if (!isLegitimate && source !== 'unknown') {
      status = 'REVIEW';
      flag = `🔍 UNKNOWN SOURCE: "${source}" - Not in legitimate list, review needed`;
      alerts.push({
        turn: i + 1,
        type: 'UNKNOWN_SOURCE',
        source,
        message: flag,
        userText: userText.substring(0, 50),
        responseText: text.substring(0, 50)
      });
    } else if (source === 'unknown') {
      status = 'MISSING';
      flag = `❓ SOURCE NOT TRACKED - Response has no source identifier`;
      alerts.push({
        turn: i + 1,
        type: 'MISSING_SOURCE',
        source,
        message: flag,
        userText: userText.substring(0, 50),
        responseText: text.substring(0, 50)
      });
    }
    
    // Check for scenario mismatch (should have matched but didn't)
    if (scenarioForTurn?.type === 'SCENARIO_NO_MATCH' && tier === 'tier3') {
      const noMatchReason = scenarioForTurn.data?.reason || 'unknown';
      alerts.push({
        turn: i + 1,
        type: 'SCENARIO_MISS',
        source,
        message: `📉 NO SCENARIO MATCHED: "${userText.substring(0, 40)}" → LLM fallback (reason: ${noMatchReason})`,
        userText: userText.substring(0, 50),
        responseText: text.substring(0, 50),
        suggestion: 'Consider adding scenario triggers for this phrase'
      });
    }
    
    turnAudits.push({
      turn: i + 1,
      source,
      tier,
      status,
      flag,
      userTextPreview: userText.substring(0, 50),
      responsePreview: text.substring(0, 50),
      scenarioMatched: scenarioForTurn?.type === 'SCENARIO_MATCHED' ? scenarioForTurn.data?.scenarioName : null,
      tokensUsed: response.data?.tokensUsed || 0
    });
  }
  
  // Calculate health score
  const totalResponses = turnAudits.length;
  const okResponses = turnAudits.filter(t => t.status === 'OK').length;
  const healthScore = totalResponses > 0 ? Math.round((okResponses / totalResponses) * 100) : 100;
  
  // Determine overall status
  let overallStatus = 'HEALTHY';
  if (alerts.some(a => a.type === 'SUSPICIOUS_SOURCE')) {
    overallStatus = 'LEGACY_DETECTED';
  } else if (alerts.some(a => a.type === 'MISSING_SOURCE')) {
    overallStatus = 'TRACKING_GAPS';
  } else if (alerts.filter(a => a.type === 'SCENARIO_MISS').length > totalResponses / 2) {
    overallStatus = 'LOW_SCENARIO_COVERAGE';
  }
  
  // Build decision path summary
  const decisionPath = turnAudits.map(t => 
    `T${t.turn}: ${t.source}${t.tier !== 'unknown' ? ` (${t.tier})` : ''}${t.status !== 'OK' ? ` ${t.flag}` : ''}`
  );
  
  return {
    overallStatus,
    healthScore,
    totalResponses,
    sourceStats,
    turnAudits,
    alerts,
    decisionPath,
    legitimateSources: LEGITIMATE_SOURCES
  };
}

function computeFlags(events, recording) {
  const flags = {
    loopDetected: events.some(e => e.type === 'LOOP_DETECTED'),
    bailoutTriggered: events.some(e => e.type === 'BAILOUT_TRIGGERED'),
    noScenarioMatch: events.filter(e => e.type === 'TIER3_FALLBACK').length > 
                     events.filter(e => e.type === 'SCENARIO_MATCHED').length,
    customerFrustrated: events.some(e => 
      e.type === 'EMOTION_DETECTED' && e.data?.emotion === 'frustrated'
    ),
    slowResponse: false,
    bookingIgnored: false
  };
  
  // Check booking ignored
  const bookingIntents = events.filter(e => e.type === 'INTENT_DETECTED' && e.data?.intent === 'BOOKING');
  const bookingLocked = events.find(e => e.type === 'BOOKING_MODE_LOCKED');
  
  if (bookingIntents.length >= 2 && !bookingLocked) {
    const gatherAfterIntent = events.filter(e => 
      e.type === 'GATHER_FINAL' && 
      e.t > (bookingIntents[0]?.t || 0)
    );
    
    if (gatherAfterIntent.length >= 2) {
      flags.bookingIgnored = true;
    }
  }
  
  // Check for slow responses (>8 seconds)
  const responseEvents = events.filter(e => e.type === 'AGENT_RESPONSE_BUILT');
  const gatherEvents = events.filter(e => e.type === 'GATHER_FINAL');
  
  for (let i = 0; i < gatherEvents.length; i++) {
    const gather = gatherEvents[i];
    const nextResponse = responseEvents.find(r => r.t > gather.t);
    
    if (nextResponse && (nextResponse.t - gather.t) > 8000) {
      flags.slowResponse = true;
      break;
    }
  }
  
  return flags;
}

function computeBookingStory(events, existingBooking = {}) {
  const booking = {
    primaryIntent: 'unknown',
    firstBookingIntentAtMs: null,
    intentLockedAtMs: null,
    questionsAskedBeforeLock: 0,
    modeActive: false,
    modeLocked: false,
    currentStep: 'NONE',
    collected: {
      name: null,
      address: null,
      phone: null,
      time: null
    },
    slotsRemaining: 4
  };
  
  // Find intent events
  const intentEvents = events.filter(e => e.type === 'INTENT_DETECTED');
  const bookingLocked = events.find(e => e.type === 'BOOKING_MODE_LOCKED');
  
  // Determine primary intent
  if (intentEvents.length > 0) {
    const intentCounts = {};
    intentEvents.forEach(e => {
      const intent = e.data?.intent || 'unknown';
      intentCounts[intent] = (intentCounts[intent] || 0) + 1;
    });
    booking.primaryIntent = Object.entries(intentCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'unknown';
  }
  
  // Find first booking intent
  const firstBooking = intentEvents.find(e => e.data?.intent === 'BOOKING');
  if (firstBooking) {
    booking.firstBookingIntentAtMs = firstBooking.t;
  }
  
  // Check if locked
  if (bookingLocked) {
    booking.intentLockedAtMs = bookingLocked.t;
    booking.modeLocked = true;
    booking.modeActive = true;
  }
  
  // Count questions before lock
  if (booking.firstBookingIntentAtMs && booking.intentLockedAtMs) {
    const gathersBetween = events.filter(e => 
      e.type === 'GATHER_FINAL' &&
      e.t > booking.firstBookingIntentAtMs &&
      e.t < booking.intentLockedAtMs
    );
    booking.questionsAskedBeforeLock = gathersBetween.length;
  }
  
  // Get slot collection status
  const slotEvents = events.filter(e => e.type === 'SLOT_COLLECTED');
  slotEvents.forEach(e => {
    const slot = e.data?.slot;
    const value = e.data?.value;
    if (slot && value && booking.collected.hasOwnProperty(slot)) {
      booking.collected[slot] = value;
    }
  });
  
  // Calculate remaining
  booking.slotsRemaining = Object.values(booking.collected).filter(v => v === null).length;
  
  // Get current step
  const modeEvents = events.filter(e => e.type === 'MODE_CHANGED' || e.type === 'SLOT_ASKING');
  if (modeEvents.length > 0) {
    const lastMode = modeEvents[modeEvents.length - 1];
    booking.currentStep = lastMode.data?.nextSlot || lastMode.data?.mode || 'UNKNOWN';
  }
  
  return booking;
}

function computeDiagnosis(events, flags, booking, recording) {
  const diagnosis = {
    primaryBottleneck: 'NONE',
    rootCause: null,
    suggestedFix: null,
    severity: 'INFO'
  };
  
  // Check for critical issues first
  if (flags.bailoutTriggered) {
    const bailoutEvent = events.find(e => e.type === 'BAILOUT_TRIGGERED');
    diagnosis.primaryBottleneck = 'BAILOUT';
    diagnosis.rootCause = `Bailout triggered: ${bailoutEvent?.data?.reason || 'unknown'}`;
    diagnosis.suggestedFix = 'Review bailout triggers and add missing scenarios';
    diagnosis.severity = 'CRITICAL';
    return diagnosis;
  }
  
  if (flags.loopDetected) {
    diagnosis.primaryBottleneck = 'LOOP';
    diagnosis.rootCause = 'Conversation entered a repetitive loop';
    diagnosis.suggestedFix = 'Review conversation flow and add loop breakers';
    diagnosis.severity = 'ERROR';
    return diagnosis;
  }
  
  if (flags.bookingIgnored) {
    diagnosis.primaryBottleneck = 'BOOKING_IGNORED';
    diagnosis.rootCause = 'Customer requested booking but AI kept asking questions';
    diagnosis.suggestedFix = 'Lower booking intent threshold or add more booking triggers';
    diagnosis.severity = 'WARNING';
    return diagnosis;
  }
  
  if (flags.noScenarioMatch) {
    diagnosis.primaryBottleneck = 'SCENARIO_COVERAGE';
    diagnosis.rootCause = 'Most turns went to LLM fallback (no scenario matched)';
    diagnosis.suggestedFix = 'Add scenarios for common questions in this call';
    diagnosis.severity = 'WARNING';
    return diagnosis;
  }
  
  if (flags.slowResponse) {
    diagnosis.primaryBottleneck = 'LATENCY';
    diagnosis.rootCause = 'One or more responses took >8 seconds';
    diagnosis.suggestedFix = 'Check LLM timeouts and scenario matching performance';
    diagnosis.severity = 'WARNING';
    return diagnosis;
  }
  
  // Check for high LLM usage
  const tierStats = computePerformance(events).tierStats;
  if (tierStats.tier3 > tierStats.tier1 + tierStats.tier2) {
    diagnosis.primaryBottleneck = 'LLM_HEAVY';
    diagnosis.rootCause = 'More LLM calls than scenario matches - expensive and slow';
    diagnosis.suggestedFix = 'Add scenario triggers for patterns that went to LLM';
    diagnosis.severity = 'INFO';
    return diagnosis;
  }
  
  return diagnosis;
}

// ============================================================================
// VISUALIZATION GENERATORS (Updated for V2 Architecture)
// ============================================================================

function generateSequenceDiagram(events) {
  let mermaid = `sequenceDiagram
    participant C as Caller
    participant T as Twilio
    participant CE as ConversationEngine
    participant SM as ScenarioMatcher
    participant LLM as LLM (Tier3)
    participant TTS as TTS
`;
  
  for (const event of events) {
    const time = `${((event.t || 0) / 1000).toFixed(0)}s`;
    
    switch (event.type) {
      case 'CALL_START':
        mermaid += `    Note over C,TTS: CALL START\n`;
        break;
      case 'GREETING_SENT':
        mermaid += `    TTS-->>C: ${time} Greeting\n`;
        break;
      case 'GATHER_FINAL':
        const text = truncate(event.data?.text || '', 25);
        mermaid += `    C->>T: ${time} "${text}"\n`;
        mermaid += `    T->>CE: Process\n`;
        break;
      case 'STT_PREPROCESSING':
        const fillers = event.data?.fillersRemoved?.length || 0;
        if (fillers > 0) {
          mermaid += `    Note over T: 🔇 ${fillers} fillers removed\n`;
        }
        break;
      case 'SCENARIO_MATCH_ATTEMPT':
        const count = event.data?.scenariosChecked || '?';
        mermaid += `    CE->>SM: Check ${count} scenarios\n`;
        break;
      case 'SCENARIO_MATCHED':
        const scenario = truncate(event.data?.scenarioName || '?', 20);
        const tier = event.data?.tier || 'tier1';
        mermaid += `    SM->>CE: ✅ ${tier.toUpperCase()}: ${scenario}\n`;
        break;
      case 'TIER3_FALLBACK':
        mermaid += `    SM->>LLM: ⚠️ No match, LLM fallback\n`;
        mermaid += `    LLM->>CE: Response (${event.data?.latencyMs || '?'}ms)\n`;
        break;
      case 'INTENT_DETECTED':
        mermaid += `    Note over CE: Intent: ${event.data?.intent || '?'}\n`;
        break;
      case 'MODE_CHANGED':
        mermaid += `    Note over CE: Mode: ${event.data?.newMode || '?'}\n`;
        break;
      case 'AGENT_RESPONSE_BUILT':
        const source = event.data?.source || 'unknown';
        mermaid += `    CE->>TTS: Response (${source})\n`;
        break;
      case 'TTS_COMPLETED':
        mermaid += `    TTS-->>C: ${time} Audio\n`;
        break;
      case 'BOOKING_MODE_LOCKED':
        mermaid += `    Note over CE: 📅 BOOKING LOCKED\n`;
        break;
      case 'SLOT_COLLECTED':
        mermaid += `    Note over CE: ✅ ${event.data?.slot}: ${truncate(event.data?.value, 15)}\n`;
        break;
      case 'LOOP_DETECTED':
        mermaid += `    Note over CE: 🔄 LOOP DETECTED\n`;
        break;
      case 'BAILOUT_TRIGGERED':
        mermaid += `    Note over CE: 🚨 BAILOUT\n`;
        break;
      case 'TRANSFER_INITIATED':
        mermaid += `    CE->>T: 📞 TRANSFER\n`;
        break;
    }
  }
  
  mermaid += `    Note over C,TTS: CALL END`;
  return mermaid;
}

function generateWaterfall(events, performanceData = {}) {
  const waterfall = [];
  const gatherEvents = events.filter(e => e.type === 'GATHER_FINAL');
  
  gatherEvents.forEach((gatherEvent, index) => {
    const turn = index + 1;
    const turnStart = gatherEvent.t;
    
    const nextGather = gatherEvents[index + 1];
    const turnEnd = nextGather ? nextGather.t : (events[events.length - 1]?.t || turnStart + 5000);
    
    const turnEvents = events.filter(e => e.t >= turnStart && e.t < turnEnd);
    
    const segments = [];
    let currentOffset = 0;
    
    // STT segment
    segments.push({
      name: 'STT',
      startMs: currentOffset,
      durationMs: 300,
      status: 'ok',
      detail: `Speech: "${truncate(gatherEvent.data?.text, 30)}"`
    });
    currentOffset += 300;
    
    // Scenario Matching segment
    const scenarioMatch = turnEvents.find(e => e.type === 'SCENARIO_MATCHED');
    const tier3Event = turnEvents.find(e => e.type === 'TIER3_FALLBACK');
    
    if (scenarioMatch) {
      const tier = scenarioMatch.data?.tier || 'tier1';
      const ms = scenarioMatch.data?.latencyMs || 50;
      segments.push({
        name: `Match (${tier})`,
        startMs: currentOffset,
        durationMs: ms,
        status: 'ok',
        detail: `${scenarioMatch.data?.scenarioName || 'matched'}`
      });
      currentOffset += ms;
    } else if (tier3Event) {
      const ms = tier3Event.data?.latencyMs || 3000;
      segments.push({
        name: 'LLM (tier3)',
        startMs: currentOffset,
        durationMs: ms,
        status: ms > 3000 ? 'slow' : 'ok',
        detail: `LLM fallback: ${ms}ms`
      });
      currentOffset += ms;
    }
    
    // TTS segment
    const tts = turnEvents.find(e => e.type === 'TTS_COMPLETED');
    if (tts) {
      const ttsMs = tts.data?.latencyMs || 2000;
      segments.push({
        name: 'TTS',
        startMs: currentOffset,
        durationMs: ttsMs,
        status: ttsMs > 3000 ? 'slow' : 'ok',
        detail: `TTS: ${ttsMs}ms`
      });
      currentOffset += ttsMs;
    }
    
    waterfall.push({
      turn,
      totalMs: currentOffset,
      segments
    });
  });
  
  return waterfall;
}

function generateDecisionTree(events, flags) {
  const scenarioMatch = events.find(e => e.type === 'SCENARIO_MATCHED');
  const tier3Fallback = events.find(e => e.type === 'TIER3_FALLBACK');
  const intentDetected = events.find(e => e.type === 'INTENT_DETECTED');
  const bookingLocked = events.find(e => e.type === 'BOOKING_MODE_LOCKED');
  const bailout = events.find(e => e.type === 'BAILOUT_TRIGGERED');
  const transfer = events.find(e => e.type === 'TRANSFER_INITIATED');
  
  const sanitize = (str) => (str || '?').replace(/["\[\]{}|<>]/g, '').substring(0, 30);
  
  let lines = [];
  lines.push('flowchart TD');
  lines.push('    A[Caller Input]');
  
  // Scenario matching path
  if (scenarioMatch) {
    const tier = scenarioMatch.data?.tier || 'tier1';
    const name = sanitize(scenarioMatch.data?.scenarioName);
    lines.push(`    A --> B{Scenario Match?}`);
    lines.push(`    B -->|"✅ ${tier.toUpperCase()}"| C["${name}"]`);
    lines.push(`    style C fill:#22c55e,color:#fff`);
  } else if (tier3Fallback) {
    lines.push(`    A --> B{Scenario Match?}`);
    lines.push(`    B -->|"❌ No Match"| C["LLM Tier-3"]`);
    lines.push(`    style C fill:#f59e0b,color:#000`);
  }
  
  // Intent detection
  if (intentDetected) {
    const intent = sanitize(intentDetected.data?.intent);
    const lastNode = scenarioMatch || tier3Fallback ? 'C' : 'A';
    lines.push(`    ${lastNode} --> D["Intent: ${intent}"]`);
    
    // Booking path
    if (bookingLocked) {
      lines.push(`    D --> E["📅 Booking Locked"]`);
      lines.push(`    style E fill:#3b82f6,color:#fff`);
    }
  }
  
  // Error states
  if (flags.loopDetected) {
    lines.push(`    ${scenarioMatch || tier3Fallback ? 'C' : 'A'} --> LOOP["🔄 LOOP"]`);
    lines.push(`    style LOOP fill:#f97316,color:#fff`);
  }
  
  if (bailout) {
    const reason = sanitize(bailout.data?.reason);
    lines.push(`    ${intentDetected ? 'D' : (scenarioMatch || tier3Fallback ? 'C' : 'A')} --> BAIL["🚨 BAILOUT: ${reason}"]`);
    lines.push(`    style BAIL fill:#ef4444,color:#fff`);
  }
  
  if (transfer) {
    lines.push(`    BAIL --> XFER["📞 TRANSFER"]`);
    lines.push(`    style XFER fill:#8b5cf6,color:#fff`);
  }
  
  return lines.join('\n');
}

// ============================================================================
// QUICK LOG METHODS (V2 - Updated for New Architecture)
// ============================================================================

const QuickLog = {
  // === Core Call Events ===
  greetingSent: (callId, companyId, text, ttsMs) => 
    logEvent({ callId, companyId, type: 'GREETING_SENT', turn: 0, data: { text, ttsMs } }),
    
  gatherFinal: (callId, companyId, turn, text, confidence) =>
    logEvent({ callId, companyId, type: 'GATHER_FINAL', turn, data: { text, confidence } }),
    
  gatherTimeout: (callId, companyId, turn, reason, nextAction) =>
    logEvent({ callId, companyId, type: 'GATHER_TIMEOUT', turn, data: { reason, nextAction } }),
    
  gatherPartial: (callId, companyId, turn, text, confidence, sequence) =>
    logEvent({ callId, companyId, type: 'GATHER_PARTIAL', turn, data: { text, confidence, sequence } }),
  
  // === STT Events ===
  sttPreprocessing: (callId, companyId, turn, raw, cleaned, fillersRemoved, correctionsApplied) =>
    logEvent({ callId, companyId, type: 'STT_PREPROCESSING', turn, data: { 
      raw, 
      cleaned, 
      fillersRemoved: fillersRemoved || [],
      correctionsApplied: correctionsApplied || [],
      processingTimeMs: 0
    }}),
    
  sttHintsLoaded: (callId, companyId, templateId, hintsCount, hintsPreview) =>
    logEvent({ callId, companyId, type: 'STT_HINTS_LOADED', turn: 0, data: { 
      templateId, 
      hintsCount, 
      hintsPreview,
      source: 'STT_PROFILE'
    }}),

  // === Scenario Matching Events (NEW!) ===
  scenarioMatchAttempt: (callId, companyId, turn, input, normalizedInput, scenariosChecked) =>
    logEvent({ callId, companyId, type: 'SCENARIO_MATCH_ATTEMPT', turn, data: { 
      input: truncate(input, 50),
      normalizedInput: truncate(normalizedInput, 50),
      scenariosChecked
    }}),
    
  scenarioMatched: (callId, companyId, turn, scenarioId, scenarioName, tier, confidence, matchReason, latencyMs) =>
    logEvent({ callId, companyId, type: 'SCENARIO_MATCHED', turn, data: { 
      scenarioId,
      scenarioName,
      tier,  // 'tier1', 'tier2', 'tier3'
      confidence,
      matchReason,
      latencyMs
    }}),
    
  scenarioNoMatch: (callId, companyId, turn, input, bestCandidate, bestConfidence, threshold, reason) =>
    logEvent({ callId, companyId, type: 'SCENARIO_NO_MATCH', turn, data: { 
      input: truncate(input, 50),
      bestCandidate,
      bestConfidence,
      threshold,
      reason
    }}),
    
  tier3Fallback: (callId, companyId, turn, reason, latencyMs, tokensUsed) =>
    logEvent({ callId, companyId, type: 'TIER3_FALLBACK', turn, data: { 
      reason,
      latencyMs,
      tokensUsed
    }}),
  
  // === Response Building (Updated!) ===
  responseBuilt: (callId, companyId, turn, text, source, tier, tokensUsed) =>
    logEvent({ callId, companyId, type: 'AGENT_RESPONSE_BUILT', turn, data: { 
      text: truncate(text, 100), 
      source,  // 'GREETING_INTERCEPT', 'SCENARIO_MATCH', 'STATE_MACHINE', 'LLM_FALLBACK', etc.
      tier,    // 'tier1', 'tier2', 'tier3'
      tokensUsed: tokensUsed || 0
    }}),
    
  // === Intent & Mode Events ===
  intentDetected: (callId, companyId, turn, intent, confidence, source) =>
    logEvent({ callId, companyId, type: 'INTENT_DETECTED', turn, data: { intent, confidence, source } }),
    
  modeChanged: (callId, companyId, turn, fromMode, toMode, trigger) =>
    logEvent({ callId, companyId, type: 'MODE_CHANGED', turn, data: { fromMode, toMode, trigger } }),
    
  // === Booking Events ===
  bookingModeLocked: (callId, companyId, turn, intentConfidence) =>
    logEvent({ callId, companyId, type: 'BOOKING_MODE_LOCKED', turn, data: { intentConfidence, locked: true } }),
    
  slotCollected: (callId, companyId, turn, slot, value, extractionMethod) =>
    logEvent({ callId, companyId, type: 'SLOT_COLLECTED', turn, data: { 
      slot, 
      value: truncate(value, 50),
      extractionMethod
    }}),
    
  slotAsking: (callId, companyId, turn, slot, question) =>
    logEvent({ callId, companyId, type: 'SLOT_ASKING', turn, data: { slot, question: truncate(question, 80) } }),
    
  bookingComplete: (callId, companyId, turn, collected) =>
    logEvent({ callId, companyId, type: 'BOOKING_COMPLETE', turn, data: { collected } }),
    
  // === State Events ===
  stateLoaded: (callId, companyId, turn, source, bookingModeLocked, bookingState, turnCount) =>
    logEvent({ callId, companyId, type: 'STATE_LOADED', turn, data: { 
      source,  // 'REDIS', 'REDIS_EMPTY', 'MEMORY', 'ERROR'
      error: null,
      bookingModeLocked,
      bookingState,
      currentBookingStep: null,
      turnCount
    }}),
    
  stateSaved: (callId, companyId, turn, result, bookingModeLocked, bookingState, bookingCollected) =>
    logEvent({ callId, companyId, type: 'STATE_SAVED', turn, data: { 
      result,  // 'REDIS_OK', 'REDIS_ERROR', 'MEMORY_OK'
      error: null,
      bookingModeLocked,
      bookingState,
      currentBookingStep: null,
      bookingCollected
    }}),
    
  // === Routing Events ===
  routingDecision: (callId, companyId, turn, llm0Enabled, reason, bookingModeLocked, path) =>
    logEvent({ callId, companyId, type: 'ROUTING_DECISION', turn, data: { 
      llm0Enabled,
      reason,
      bookingModeLocked,
      bookingState: null,
      currentBookingStep: null,
      path  // 'HybridReceptionistLLM', 'StateMachine', 'BookingFlow'
    }}),
    
  hybridPathStart: (callId, companyId, turn, reason, bookingModeLocked, userInput) =>
    logEvent({ callId, companyId, type: 'HYBRID_PATH_START', turn, data: { 
      reason,
      bookingModeLocked,
      userInput: truncate(userInput, 60)
    }}),
    
  hybridPathSuccess: (callId, companyId, turn, latencyMs, responsePreview, mode) =>
    logEvent({ callId, companyId, type: 'HYBRID_PATH_SUCCESS', turn, data: { 
      latencyMs,
      responsePreview: truncate(responsePreview, 100),
      mode
    }}),
    
  pathResolved: (callId, companyId, turn, usedPath, latencyMs, responseLength) =>
    logEvent({ callId, companyId, type: 'PATH_RESOLVED', turn, data: { usedPath, latencyMs, responseLength } }),
    
  turnComplete: (callId, companyId, turn, handler, action, responsePreview, bookingModeLocked, bookingState, bookingCollected) =>
    logEvent({ callId, companyId, type: 'TURN_COMPLETE', turn, data: { 
      handler,
      action,
      responsePreview: truncate(responsePreview, 100),
      bookingModeLocked,
      bookingState,
      currentBookingStep: null,
      bookingCollected
    }}),
  
  // === TTS Events ===
  ttsStarted: (callId, companyId, turn, voiceId, textLength) =>
    logEvent({ callId, companyId, type: 'TTS_STARTED', turn, data: { voiceId, textLength } }),
    
  ttsCompleted: (callId, companyId, turn, voiceId, latencyMs) =>
    logEvent({ callId, companyId, type: 'TTS_COMPLETED', turn, data: { voiceId, latencyMs } }),
    
  ttsFailed: (callId, companyId, turn, error, fallback) =>
    logEvent({ callId, companyId, type: 'TTS_FAILED', turn, data: { error: truncate(error, 200), fallback } }),
    
  twimlSent: (callId, companyId, turn, route, twimlLength, hasGather, hasPlay, hasSay, actionUrl, twimlPreview) =>
    logEvent({ callId, companyId, type: 'TWIML_SENT', turn, data: { 
      route, twimlLength, hasGather, hasPlay, hasSay, actionUrl, twimlPreview: truncate(twimlPreview, 500)
    }}),
    
  gatherConfigured: (callId, companyId, turn, actionUrl, timeout, speechTimeout, bargeIn, hintsCount) =>
    logEvent({ callId, companyId, type: 'GATHER_CONFIGURED', turn, data: { 
      actionUrl, timeout, speechTimeout, bargeIn, hintsCount
    }}),
  
  // === Error/Warning Events ===
  loopDetected: (callId, companyId, turn) =>
    logEvent({ callId, companyId, type: 'LOOP_DETECTED', turn, data: {} }),
    
  bailoutTriggered: (callId, companyId, turn, type, reason) =>
    logEvent({ callId, companyId, type: 'BAILOUT_TRIGGERED', turn, data: { type, reason } }),
    
  conversationEngineError: (callId, companyId, turn, error, errorType, lastCheckpoint, stackPreview, latencyMs) =>
    logEvent({ callId, companyId, type: 'CONVERSATION_ENGINE_ERROR', turn, data: { 
      error,
      errorType,
      lastCheckpoint,
      stackPreview,
      latencyMs
    }}),
    
  lowConfidenceHit: (callId, companyId, turn, confidence, transcript, repeatCount) =>
    logEvent({ callId, companyId, type: 'LOW_CONFIDENCE_HIT', turn, data: { 
      confidence, 
      transcript: truncate(transcript, 100), 
      repeatCount
    }}),
    
  // === Transfer Events ===
  transferInitiated: (callId, companyId, turn, target, reason) =>
    logEvent({ callId, companyId, type: 'TRANSFER_INITIATED', turn, data: { target, reason } }),
    
  // === Customer Events ===
  customerIdentified: (callId, companyId, turn, customerId, isReturning, customerName) =>
    logEvent({ callId, companyId, type: 'CUSTOMER_IDENTIFIED', turn, data: { 
      customerId,
      isReturning,
      customerName: truncate(customerName, 30)
    }}),
    
  // === Emotion Detection ===
  emotionDetected: (callId, companyId, turn, emotion, confidence) =>
    logEvent({ callId, companyId, type: 'EMOTION_DETECTED', turn, data: { emotion, confidence } })
};

// ============================================================================
// UPDATE SESSION SNAPSHOT
// ============================================================================

async function updateSessionSnapshot(callId, companyId, session) {
  try {
    const snapshot = {
      phase: session.phase || session.conversationMemory?.currentStage || 'unknown',
      mode: session.mode || 'DISCOVERY',
      locks: {
        greeted: session.locks?.greeted || false,
        issueCaptured: session.locks?.issueCaptured || false,
        bookingStarted: session.locks?.bookingStarted || false,
        bookingLocked: session.locks?.bookingLocked || false,
        askedSlots: session.locks?.askedSlots || {}
      },
      memory: {
        rollingSummary: session.memory?.rollingSummary || '',
        facts: session.memory?.facts || {},
        lastUserIntent: session.memory?.lastUserIntent || null
      }
    };
    
    await BlackBoxRecording.updateOne(
      { callId, companyId },
      { $set: { sessionSnapshot: snapshot } }
    );
    
  } catch (error) {
    logger.error('[BLACK BOX] Failed to update session snapshot (non-fatal)', {
      callId,
      error: error.message
    });
  }
}

// ============================================================================
// UPDATE BOOKING PROGRESS
// ============================================================================

async function updateBookingProgress(callId, companyId, progress) {
  try {
    await BlackBoxRecording.updateOne(
      { callId, companyId },
      { $set: { bookingProgress: progress } }
    );
  } catch (error) {
    logger.error('[BLACK BOX] Failed to update booking progress', { callId, error: error.message });
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

module.exports = {
  // Core methods
  initCall,
  ensureCall,
  logEvent,
  appendError,
  addTranscript,
  finalizeCall,
  
  // Diagnostics
  logBookingDiagnostic,
  
  // Quick log helpers
  QuickLog,
  
  // State updates
  updateSessionSnapshot,
  updateBookingProgress
};
