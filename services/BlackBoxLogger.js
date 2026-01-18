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
    ttsTotalMs
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
  
  // Quick log helpers
  QuickLog,
  
  // State updates
  updateSessionSnapshot,
  updateBookingProgress
};
