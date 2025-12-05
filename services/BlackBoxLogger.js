/**
 * ============================================================================
 * BLACK BOX LOGGER SERVICE
 * ============================================================================
 * 
 * THE SINGLE ENTRY POINT FOR ALL CALL RECORDING.
 * 
 * Every part of the call flow (Twilio, Brain-1, Triage, Booking, TTS) 
 * calls THIS service. No direct model access from elsewhere.
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
 * Call this at the START of /voice endpoint
 */
async function initCall({ callId, companyId, from, to, customerId, customerContext }) {
  const now = new Date();
  
  try {
    const recording = await BlackBoxRecording.create({
      callId,
      companyId,
      from,
      to,
      startedAt: now,
      customerId: customerId || null,
      customerContext: customerContext || {},
      events: [{
        type: 'CALL_START',
        ts: now,
        t: 0,
        turn: 0,
        data: {
          from,
          to,
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
      from
    });
    
    return recording;
    
  } catch (error) {
    // Don't let black box failures kill the call
    logger.error('[BLACK BOX] Failed to init recording (non-fatal)', {
      callId,
      companyId,
      error: error.message
    });
    return null;
  }
}

// ============================================================================
// LOG EVENT - Append to timeline
// ============================================================================

/**
 * Log an event to the call timeline
 * Events are append-only and immutable
 */
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

/**
 * Log an error that occurred during the call
 */
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

/**
 * Add a transcript entry (caller or agent)
 */
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
              source: source || 'FRONTLINE'
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
// FINALIZE CALL - Compute summary + visualizations
// ============================================================================

/**
 * Finalize the call recording
 * Computes: performance summary, flags, diagnosis, visualizations
 * Call this when the call ends (hangup, transfer complete, etc.)
 */
async function finalizeCall({ callId, companyId, endedAt, callOutcome, performanceData }) {
  try {
    const now = endedAt || new Date();
    
    // Get the full recording to analyze
    const recording = await BlackBoxRecording.findOne({ callId, companyId }).lean();
    if (!recording) {
      logger.warn('[BLACK BOX] Cannot finalize - recording not found', { callId });
      return false;
    }
    
    const durationMs = now.getTime() - new Date(recording.startedAt).getTime();
    
    // ──────────────────────────────────────────────────────────────────────
    // COMPUTE PERFORMANCE SUMMARY
    // ──────────────────────────────────────────────────────────────────────
    const events = recording.events || [];
    const performance = computePerformance(events, performanceData);
    
    // ──────────────────────────────────────────────────────────────────────
    // COMPUTE FLAGS
    // ──────────────────────────────────────────────────────────────────────
    const flags = computeFlags(events, recording);
    
    // ──────────────────────────────────────────────────────────────────────
    // COMPUTE BOOKING STORY
    // ──────────────────────────────────────────────────────────────────────
    const booking = computeBookingStory(events, recording.booking);
    
    // ──────────────────────────────────────────────────────────────────────
    // COMPUTE DIAGNOSIS
    // ──────────────────────────────────────────────────────────────────────
    const diagnosis = computeDiagnosis(events, flags, booking, performance);
    
    // ──────────────────────────────────────────────────────────────────────
    // GENERATE VISUALIZATIONS
    // ──────────────────────────────────────────────────────────────────────
    const visualization = {
      sequenceDiagram: generateSequenceDiagram(events, recording),
      decisionTree: generateDecisionTree(events, flags),
      waterfall: generateWaterfall(events, performanceData)
    };
    
    // ──────────────────────────────────────────────────────────────────────
    // UPDATE RECORDING
    // ──────────────────────────────────────────────────────────────────────
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
        },
        $push: {
          events: {
            type: 'CALL_END',
            ts: now,
            t: durationMs,
            turn: performance.totalTurns || 0,
            data: { outcome: callOutcome || 'COMPLETED' }
          }
        }
      }
    );
    
    logger.info('[BLACK BOX] 📼 Recording finalized', {
      callId,
      companyId: companyId.toString(),
      durationMs,
      outcome: callOutcome,
      turns: performance.totalTurns,
      flags: Object.keys(flags).filter(k => flags[k])
    });
    
    return true;
    
  } catch (error) {
    logger.error('[BLACK BOX] Failed to finalize recording (non-fatal)', {
      callId,
      error: error.message,
      stack: error.stack
    });
    return false;
  }
}

// ============================================================================
// COMPUTE HELPERS
// ============================================================================

function computePerformance(events, performanceData = {}) {
  // Count turns from GATHER_FINAL events
  const gatherEvents = events.filter(e => e.type === 'GATHER_FINAL');
  const responseEvents = events.filter(e => e.type === 'AGENT_RESPONSE_BUILT');
  const totalTurns = gatherEvents.length;
  
  // ════════════════════════════════════════════════════════════════════════════
  // TURN-LEVEL PERFORMANCE BREAKDOWN
  // ════════════════════════════════════════════════════════════════════════════
  // For each turn, calculate:
  // - STT ms (from GATHER_PARTIAL to GATHER_FINAL)
  // - Brain-1 ms (from GATHER_FINAL to INTENT_DETECTED)
  // - 3-Tier ms (from TIER3_ENTERED to TIER3_EXIT)
  // - LLM ms (if TIER3_LLM_FALLBACK_CALLED)
  // - TTS ms (TTS_GENERATED timing)
  // ════════════════════════════════════════════════════════════════════════════
  const turnBreakdowns = [];
  
  for (let i = 0; i < gatherEvents.length; i++) {
    const gather = gatherEvents[i];
    const turnNum = i + 1;
    
    // Find events for this turn
    const nextGather = gatherEvents[i + 1];
    const turnEndTime = nextGather?.t || Infinity;
    
    const turnEvents = events.filter(e => e.t >= gather.t && e.t < turnEndTime);
    
    // Find specific events in this turn
    const intentEvent = turnEvents.find(e => e.type === 'INTENT_DETECTED');
    const tier3Enter = turnEvents.find(e => e.type === 'TIER3_ENTERED');
    const tier3Exit = turnEvents.find(e => e.type === 'TIER3_EXIT');
    const llmFallback = turnEvents.find(e => e.type === 'TIER3_LLM_FALLBACK_CALLED');
    const ttsEvent = turnEvents.find(e => e.type === 'TTS_GENERATED');
    const responseEvent = turnEvents.find(e => e.type === 'AGENT_RESPONSE_BUILT');
    
    const breakdown = {
      turn: turnNum,
      totalMs: responseEvent ? (responseEvent.t - gather.t) : 0,
      sttMs: 0, // Would need GATHER_PARTIAL timing
      brain1Ms: intentEvent ? (intentEvent.t - gather.t) : 0,
      tier3Ms: (tier3Enter && tier3Exit) ? (tier3Exit.t - tier3Enter.t) : 0,
      llmMs: llmFallback?.data?.ms || 0,
      ttsMs: ttsEvent?.data?.ms || 0,
      bottleneck: 'UNKNOWN'
    };
    
    // Determine bottleneck
    const maxComponent = Math.max(breakdown.brain1Ms, breakdown.tier3Ms, breakdown.llmMs, breakdown.ttsMs);
    if (maxComponent === breakdown.llmMs && breakdown.llmMs > 0) {
      breakdown.bottleneck = 'LLM';
    } else if (maxComponent === breakdown.ttsMs && breakdown.ttsMs > 0) {
      breakdown.bottleneck = 'TTS';
    } else if (maxComponent === breakdown.tier3Ms && breakdown.tier3Ms > 0) {
      breakdown.bottleneck = 'TIER3';
    } else if (breakdown.brain1Ms > 0) {
      breakdown.bottleneck = 'BRAIN1';
    }
    
    turnBreakdowns.push(breakdown);
  }
  
  // Calculate averages and find slowest
  let avgTurnTimeMs = 0;
  let slowestTurn = { turnNumber: 0, totalMs: 0, bottleneck: 'UNKNOWN' };
  
  if (turnBreakdowns.length > 0) {
    avgTurnTimeMs = Math.round(
      turnBreakdowns.reduce((sum, t) => sum + t.totalMs, 0) / turnBreakdowns.length
    );
    
    const slowest = turnBreakdowns.reduce(
      (max, t) => t.totalMs > max.totalMs ? t : max, 
      turnBreakdowns[0]
    );
    slowestTurn = {
      turnNumber: slowest.turn,
      totalMs: slowest.totalMs,
      bottleneck: slowest.bottleneck,
      breakdown: {
        brain1Ms: slowest.brain1Ms,
        tier3Ms: slowest.tier3Ms,
        llmMs: slowest.llmMs,
        ttsMs: slowest.ttsMs
      }
    };
  }
  
  // Count LLM calls (both Brain-1 and Tier-3)
  const brain1LlmEvents = events.filter(e => e.type === 'LLM_RESPONSE');
  const tier3LlmEvents = events.filter(e => e.type === 'TIER3_LLM_FALLBACK_CALLED');
  const allLlmEvents = [...brain1LlmEvents, ...tier3LlmEvents];
  
  const llmCalls = {
    count: allLlmEvents.length,
    totalMs: allLlmEvents.reduce((sum, e) => sum + (e.data?.ms || 0), 0),
    brain1Count: brain1LlmEvents.length,
    tier3Count: tier3LlmEvents.length
  };
  
  // TTS total
  const ttsEvents = events.filter(e => e.type === 'TTS_GENERATED');
  const ttsTotalMs = ttsEvents.reduce((sum, e) => sum + (e.data?.ms || 0), 0);
  
  return {
    totalTurns,
    avgTurnTimeMs,
    slowestTurn,
    turnBreakdowns,
    llmCalls,
    ttsTotalMs
  };
}

function computeFlags(events, recording) {
  const flags = {
    loopDetected: events.some(e => e.type === 'LOOP_DETECTED'),
    bailoutTriggered: events.some(e => e.type === 'BAILOUT_TRIGGERED'),
    noTriageMatch: events.filter(e => e.type === 'LLM_FALLBACK').length > 
                   events.filter(e => e.type === 'FAST_MATCH_HIT').length,
    customerFrustrated: events.some(e => 
      e.type === 'BEHAVIOR_EVENT' && e.data?.type === 'FRUSTRATED'
    ),
    slowResponse: false,
    bookingIgnored: false
  };
  
  // ════════════════════════════════════════════════════════════════════════════
  // BOOKING IGNORED DETECTION
  // ════════════════════════════════════════════════════════════════════════════
  // bookingIgnored = TRUE when:
  // 1. Booking intent was detected with confidence >= 0.65
  // 2. BUT system never entered BOOKING_MODE_ACTIVATED
  // 3. AND we asked 2+ more questions after booking intent
  // ════════════════════════════════════════════════════════════════════════════
  const intentEvents = events.filter(e => e.type === 'INTENT_DETECTED');
  const bookingActivated = events.find(e => e.type === 'BOOKING_MODE_ACTIVATED');
  
  // Find first clear booking intent
  const firstBookingIntent = intentEvents.find(e => {
    const intent = (e.data?.intent || '').toLowerCase();
    const confidence = e.data?.confidence || 0;
    const isBookingIntent = intent.includes('book') || 
                            intent.includes('schedule') || 
                            intent.includes('appointment');
    return isBookingIntent && confidence >= 0.65;
  });
  
  if (firstBookingIntent && !bookingActivated) {
    // Booking intent detected but never locked - count questions after
    const gatherAfterIntent = events.filter(e => 
      e.type === 'GATHER_FINAL' && 
      e.t > firstBookingIntent.t
    );
    
    if (gatherAfterIntent.length >= 1) {
      // Customer had to answer another question after clear booking intent
      flags.bookingIgnored = true;
    }
  }
  
  // ════════════════════════════════════════════════════════════════════════════
  // SLOW RESPONSE DETECTION
  // ════════════════════════════════════════════════════════════════════════════
  // Check for any turn taking > 8 seconds (exceptionally slow)
  const responseEvents = events.filter(e => e.type === 'AGENT_RESPONSE_BUILT');
  const gatherEvents = events.filter(e => e.type === 'GATHER_FINAL');
  
  for (let i = 0; i < gatherEvents.length; i++) {
    const gather = gatherEvents[i];
    const nextResponse = responseEvents.find(r => r.t > gather.t);
    if (nextResponse) {
      const turnMs = nextResponse.t - gather.t;
      if (turnMs > 8000) {
        flags.slowResponse = true;
        break;
      }
    }
  }
  
  return flags;
}

function computeBookingStory(events, existingBooking = {}) {
  const intentEvents = events.filter(e => e.type === 'INTENT_DETECTED');
  const bookingActivated = events.find(e => e.type === 'BOOKING_MODE_ACTIVATED');
  
  // Find first booking intent
  const firstBookingIntent = intentEvents.find(e => 
    e.data?.intent?.toLowerCase().includes('book') ||
    e.data?.intent?.toLowerCase().includes('schedule') ||
    e.data?.intent?.toLowerCase().includes('appointment')
  );
  
  const booking = {
    ...existingBooking,
    firstIntentDetectedAtMs: firstBookingIntent?.t || existingBooking.firstIntentDetectedAtMs || null,
    intentLockedAtMs: bookingActivated?.t || existingBooking.intentLockedAtMs || null
  };
  
  // Count questions between first intent and lock
  if (booking.firstIntentDetectedAtMs && booking.intentLockedAtMs) {
    const gatherEvents = events.filter(e => 
      e.type === 'GATHER_FINAL' &&
      e.t > booking.firstIntentDetectedAtMs &&
      e.t < booking.intentLockedAtMs
    );
    booking.questionsAskedBeforeLock = gatherEvents.length;
  }
  
  return booking;
}

function computeDiagnosis(events, flags, booking, performance) {
  const diagnosis = {
    primaryBottleneck: null,
    rootCause: null,
    suggestedFix: null,
    severity: 'INFO'
  };
  
  // ════════════════════════════════════════════════════════════════════════════
  // BOOKING IGNORED is the HIGHEST priority issue
  // ════════════════════════════════════════════════════════════════════════════
  if (flags.bookingIgnored) {
    // Find the first booking intent for details
    const firstBookingIntent = events.find(e => {
      const intent = (e.data?.intent || '').toLowerCase();
      const confidence = e.data?.confidence || 0;
      return (intent.includes('book') || intent.includes('schedule') || intent.includes('appointment')) 
             && confidence >= 0.65;
    });
    
    // Check what route was taken instead
    const triageAfterBooking = events.find(e => 
      e.type === 'TRIAGE_DECISION' && 
      e.t > (firstBookingIntent?.t || 0)
    );
    
    diagnosis.primaryBottleneck = 'BOOKING_IGNORED';
    diagnosis.rootCause = `Booking intent detected (${firstBookingIntent?.data?.intent || 'booking'}, ` +
      `confidence=${(firstBookingIntent?.data?.confidence || 0).toFixed(2)}) at ` +
      `${((firstBookingIntent?.t || 0) / 1000).toFixed(1)}s, but system routed to ` +
      `${triageAfterBooking?.data?.route || 'MESSAGE_ONLY'} instead of BOOKING_FLOW.`;
    diagnosis.suggestedFix = 'Check BOOKING_INTENT_THRESHOLD in FrontlineIntelEngine.js. ' +
      'Current threshold is 0.65. If booking intent confidence was above this but still not ' +
      'routed to BOOK, check if the triage router is overriding the action.';
    diagnosis.severity = 'CRITICAL';
    return diagnosis;
  }
  
  // Booking delayed (we eventually got to booking, but asked too many questions first)
  if (booking.firstIntentDetectedAtMs && 
      booking.intentLockedAtMs && 
      booking.questionsAskedBeforeLock >= 3) {
    diagnosis.primaryBottleneck = 'BOOKING_DELAYED';
    diagnosis.rootCause = `Customer asked to book at ${(booking.firstIntentDetectedAtMs / 1000).toFixed(1)}s, ` +
      `but system asked ${booking.questionsAskedBeforeLock} more questions before committing at ` +
      `${(booking.intentLockedAtMs / 1000).toFixed(1)}s.`;
    diagnosis.suggestedFix = 'Tighten booking behavior rules - when booking intent confidence > 0.65, ' +
      'enter booking flow immediately without additional troubleshooting.';
    diagnosis.severity = 'CRITICAL';
    return diagnosis;
  }
  
  // Loop detected is CRITICAL
  if (flags.loopDetected) {
    diagnosis.primaryBottleneck = 'BEHAVIOR_RULE';
    diagnosis.rootCause = 'AI repeated similar responses, triggering loop detection.';
    diagnosis.suggestedFix = 'Review triage cards and response templates for variety. ' +
      'Ensure each scenario has distinct responses.';
    diagnosis.severity = 'CRITICAL';
    return diagnosis;
  }
  
  // Bailout is WARNING
  if (flags.bailoutTriggered) {
    const bailoutEvent = events.find(e => e.type === 'BAILOUT_TRIGGERED');
    diagnosis.primaryBottleneck = 'BEHAVIOR_RULE';
    diagnosis.rootCause = `Bailout triggered: ${bailoutEvent?.data?.reason || 'unknown reason'}`;
    diagnosis.suggestedFix = 'Review ResponseValidator patterns and triage card matching.';
    diagnosis.severity = 'WARNING';
    return diagnosis;
  }
  
  // Triage miss is WARNING
  if (flags.noTriageMatch) {
    diagnosis.primaryBottleneck = 'TRIAGE_MISS';
    diagnosis.rootCause = 'Fast match failed multiple times - caller phrases not matching triage keywords.';
    diagnosis.suggestedFix = 'Add missing keywords to triage cards based on actual caller phrases.';
    diagnosis.severity = 'WARNING';
    return diagnosis;
  }
  
  // LLM slow is WARNING
  if (performance.llmCalls.count > 3 && performance.llmCalls.totalMs > 10000) {
    diagnosis.primaryBottleneck = 'LLM_SLOW';
    diagnosis.rootCause = `${performance.llmCalls.count} LLM calls totaling ${(performance.llmCalls.totalMs / 1000).toFixed(1)}s.`;
    diagnosis.suggestedFix = 'Improve triage card keywords to reduce LLM fallback.';
    diagnosis.severity = 'WARNING';
    return diagnosis;
  }
  
  // Default
  diagnosis.primaryBottleneck = null;
  diagnosis.rootCause = 'Call completed normally.';
  diagnosis.severity = 'INFO';
  
  return diagnosis;
}

// ============================================================================
// VISUALIZATION GENERATORS
// ============================================================================

function generateSequenceDiagram(events, recording) {
  let mermaid = `sequenceDiagram
    participant C as Caller
    participant T as Twilio
    participant B1 as Brain-1
    participant TR as Triage
    participant B2 as Brain-2
    participant TTS as TTS
`;

  for (const event of events) {
    const time = `${(event.t / 1000).toFixed(0)}s`;
    
    switch (event.type) {
      case 'CALL_START':
        mermaid += `    Note over C,TTS: CALL START\n`;
        break;
        
      case 'GREETING_SENT':
        mermaid += `    TTS-->>C: ${time} "${truncate(event.data?.text, 25)}"\n`;
        break;
        
      case 'GATHER_FINAL':
        mermaid += `    C->>T: ${time} "${truncate(event.data?.text, 30)}"\n`;
        mermaid += `    T->>B1: Process\n`;
        break;
        
      case 'FAST_MATCH_HIT':
        mermaid += `    B1->>TR: ✅ Fast Match: ${event.data?.cardName || 'matched'}\n`;
        break;
        
      case 'LLM_FALLBACK':
        mermaid += `    Note over B1: ⚠️ LLM Fallback (${event.data?.ms || '?'}ms)\n`;
        break;
        
      case 'INTENT_DETECTED':
        mermaid += `    B1->>TR: Intent: ${event.data?.intent || '?'}\n`;
        break;
        
      case 'TRIAGE_DECISION':
        mermaid += `    TR->>B2: Route: ${event.data?.route || event.data?.cardName || 'MESSAGE_ONLY'}\n`;
        break;
        
      case 'AGENT_RESPONSE_BUILT':
        mermaid += `    B2->>TTS: Response ready\n`;
        break;
        
      case 'TTS_GENERATED':
        mermaid += `    TTS-->>C: ${time} (${event.data?.ms || '?'}ms)\n`;
        break;
        
      case 'LOOP_DETECTED':
        mermaid += `    Note over B1: 🔄 LOOP DETECTED\n`;
        break;
        
      case 'BAILOUT_TRIGGERED':
        mermaid += `    Note over B1: 🚨 BAILOUT: ${event.data?.reason || 'unknown'}\n`;
        break;
        
      case 'TRANSFER_INITIATED':
        mermaid += `    B1->>T: TRANSFER\n`;
        mermaid += `    T-->>C: Connecting...\n`;
        break;
        
      case 'CALL_END':
        mermaid += `    Note over C,TTS: CALL END (${event.data?.outcome || 'COMPLETED'})\n`;
        break;
    }
  }
  
  return mermaid;
}

function generateDecisionTree(events, flags) {
  const fastMatch = events.find(e => e.type === 'FAST_MATCH_HIT');
  const llmFallback = events.find(e => e.type === 'LLM_FALLBACK');
  const intentDetected = events.find(e => e.type === 'INTENT_DETECTED');
  const triageDecision = events.find(e => e.type === 'TRIAGE_DECISION');
  const bookingActivated = events.find(e => e.type === 'BOOKING_MODE_ACTIVATED');
  const bailout = events.find(e => e.type === 'BAILOUT_TRIGGERED');
  const transfer = events.find(e => e.type === 'TRANSFER_INITIATED');
  
  let mermaid = `flowchart TD
    A["📞 Caller Input"] --> B{Fast Match?}
`;
  
  if (fastMatch) {
    mermaid += `    B -->|"✅ Yes"| C["Card: ${truncate(fastMatch.data?.cardName, 20)}"]
    style C fill:#22c55e,color:#fff
`;
    if (triageDecision) {
      mermaid += `    C --> D["Route: ${triageDecision.data?.route || 'MESSAGE_ONLY'}"]
`;
    }
  } else if (llmFallback) {
    mermaid += `    B -->|"❌ No"| E["LLM Fallback"]
    style E fill:#f59e0b,color:#000
`;
    
    if (intentDetected) {
      mermaid += `    E --> F["Intent: ${intentDetected.data?.intent || '?'}"]
`;
      if (triageDecision) {
        mermaid += `    F --> D["Route: ${triageDecision.data?.route || 'MESSAGE_ONLY'}"]
`;
      }
    }
  } else {
    mermaid += `    B --> D["Route: MESSAGE_ONLY"]
`;
  }
  
  if (bookingActivated) {
    mermaid += `    D --> G["📅 Booking Flow"]
    style G fill:#3b82f6,color:#fff
`;
  }
  
  if (flags.loopDetected) {
    mermaid += `    D --> H["🔄 LOOP DETECTED"]
    style H fill:#f97316,color:#fff
`;
  }
  
  if (bailout) {
    mermaid += `    D --> I["🚨 BAILOUT: ${bailout.data?.reason || '?'}"]
    style I fill:#ef4444,color:#fff
`;
  }
  
  if (transfer) {
    mermaid += `    I --> J["📞 TRANSFER"]
    style J fill:#8b5cf6,color:#fff
`;
  }
  
  return mermaid;
}

function generateWaterfall(events, performanceData = {}) {
  const waterfall = [];
  
  // Group events by turn
  const gatherEvents = events.filter(e => e.type === 'GATHER_FINAL');
  
  gatherEvents.forEach((gatherEvent, index) => {
    const turn = index + 1;
    const turnStart = gatherEvent.t;
    
    // Find events for this turn (between this gather and next)
    const nextGather = gatherEvents[index + 1];
    const turnEnd = nextGather ? nextGather.t : (events[events.length - 1]?.t || turnStart + 5000);
    
    const turnEvents = events.filter(e => e.t >= turnStart && e.t < turnEnd);
    
    const segments = [];
    let currentOffset = 0;
    
    // STT segment
    segments.push({
      name: 'STT',
      startMs: currentOffset,
      durationMs: 300, // Approximate
      status: 'ok',
      detail: `Speech: "${truncate(gatherEvent.data?.text, 30)}"`
    });
    currentOffset += 300;
    
    // Brain-1 segment
    const fastMatch = turnEvents.find(e => e.type === 'FAST_MATCH_HIT');
    const llmFallback = turnEvents.find(e => e.type === 'LLM_FALLBACK');
    
    if (fastMatch) {
      segments.push({
        name: 'Brain-1 (Fast)',
        startMs: currentOffset,
        durationMs: 50,
        status: 'ok',
        detail: `Fast match: ${fastMatch.data?.cardName || 'matched'}`
      });
      currentOffset += 50;
    } else if (llmFallback) {
      const llmMs = llmFallback.data?.ms || 3000;
      segments.push({
        name: 'Brain-1 (LLM)',
        startMs: currentOffset,
        durationMs: llmMs,
        status: llmMs > 3000 ? 'slow' : 'ok',
        detail: `LLM fallback: ${llmMs}ms`
      });
      currentOffset += llmMs;
    }
    
    // Triage segment
    const triage = turnEvents.find(e => e.type === 'TRIAGE_DECISION');
    if (triage) {
      segments.push({
        name: 'Triage',
        startMs: currentOffset,
        durationMs: 50,
        status: 'ok',
        detail: `Route: ${triage.data?.route || 'MESSAGE_ONLY'}`
      });
      currentOffset += 50;
    }
    
    // TTS segment
    const tts = turnEvents.find(e => e.type === 'TTS_GENERATED');
    if (tts) {
      const ttsMs = tts.data?.ms || 2000;
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

// ============================================================================
// CONVENIENCE: Quick log methods
// ============================================================================

const QuickLog = {
  greetingSent: (callId, companyId, text, ttsMs) => 
    logEvent({ callId, companyId, type: 'GREETING_SENT', turn: 0, data: { text, ttsMs } }),
    
  gatherFinal: (callId, companyId, turn, text, confidence) =>
    logEvent({ callId, companyId, type: 'GATHER_FINAL', turn, data: { text, confidence } }),
    
  fastMatchHit: (callId, companyId, turn, cardId, cardName, keywords) =>
    logEvent({ callId, companyId, type: 'FAST_MATCH_HIT', turn, data: { cardId, cardName, keywords } }),
    
  llmFallback: (callId, companyId, turn, ms, reason) =>
    logEvent({ callId, companyId, type: 'LLM_FALLBACK', turn, data: { ms, reason } }),
    
  intentDetected: (callId, companyId, turn, intent, confidence, source) =>
    logEvent({ callId, companyId, type: 'INTENT_DETECTED', turn, data: { intent, confidence, source } }),
    
  triageDecision: (callId, companyId, turn, route, cardId, cardName) =>
    logEvent({ callId, companyId, type: 'TRIAGE_DECISION', turn, data: { route, cardId, cardName } }),
    
  responseBuilt: (callId, companyId, turn, text, source) =>
    logEvent({ callId, companyId, type: 'AGENT_RESPONSE_BUILT', turn, data: { text: truncate(text, 100), source } }),
    
  ttsGenerated: (callId, companyId, turn, ms, audioUrl) =>
    logEvent({ callId, companyId, type: 'TTS_GENERATED', turn, data: { ms, audioUrl } }),
    
  loopDetected: (callId, companyId, turn) =>
    logEvent({ callId, companyId, type: 'LOOP_DETECTED', turn, data: {} }),
    
  bailoutTriggered: (callId, companyId, turn, type, reason) =>
    logEvent({ callId, companyId, type: 'BAILOUT_TRIGGERED', turn, data: { type, reason } }),
    
  transferInitiated: (callId, companyId, turn, target, reason) =>
    logEvent({ callId, companyId, type: 'TRANSFER_INITIATED', turn, data: { target, reason } })
};

// ============================================================================
// EXPORT
// ============================================================================

module.exports = {
  initCall,
  logEvent,
  appendError,
  addTranscript,
  finalizeCall,
  QuickLog
};

