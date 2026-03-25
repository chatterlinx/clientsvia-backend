/**
 * Call Intelligence Routes
 * 
 * API endpoints for AI-powered call analysis and recommendations.
 * 
 * @module routes/agentConsole/callIntelligence
 */

const express = require('express');
const router = express.Router();
const https = require('https');
const CallIntelligenceService = require('../../services/CallIntelligenceService');
const GPT4AnalysisService = require('../../services/GPT4AnalysisService');
const CallTranscriptV2 = require('../../models/CallTranscriptV2');
const CallSummary = require('../../models/CallSummary');
const CallIntelligenceSettings = require('../../models/CallIntelligenceSettings');
const CallIntelligence = require('../../models/CallIntelligence');
const Company = require('../../models/v2Company');
const ConversationSession = require('../../models/ConversationSession');
const LLMCallLog = require('../../models/LLMCallLog');

const mongoose = require('mongoose');

function buildCallSummaryDateRange(timeRange) {
  const now = new Date();
  let start;

  switch (timeRange) {
    case 'today':
      start = new Date(now.setHours(0, 0, 0, 0));
      break;
    case 'week':
      start = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      start = new Date(now.setMonth(now.getMonth() - 1));
      break;
    default:
      return {};
  }

  return {
    startedAt: {
      $gte: start,
      $lte: new Date()
    }
  };
}

function findLastTrace(trace = [], kind) {
  for (let i = trace.length - 1; i >= 0; i -= 1) {
    if (trace[i]?.kind === kind) return trace[i];
  }
  return null;
}

function normalizeTurn(turn) {
  if (!turn) return null;
  const prov = turn.trace?.provenance || turn.provenance || {};
  const normalized = {
    speaker: turn.speaker || 'unknown',
    text: turn.text || '',
    kind: turn.kind || null,
    source: turn.sourceKey || turn.source || null,
    timestamp: turn.ts || turn.timestamp || null
  };
  // Include voice delivery metadata for system turns
  if (turn.speaker === 'system' && (turn.kind === 'TWIML_PLAY' || turn.kind === 'TWIML_SAY')) {
    normalized.voiceProvider = prov.voiceProviderUsed || (turn.kind === 'TWIML_PLAY' ? 'elevenlabs' : 'twilio_say');
    normalized.twimlVerb = turn.kind === 'TWIML_PLAY' ? 'PLAY' : 'SAY';
    if (prov.isBridge) normalized.isBridge = true;
    if (prov.deliveredVia) normalized.deliveredVia = prov.deliveredVia;
  }
  return normalized;
}

function buildTranscript(turns = [], limit = 25) {
  const normalized = turns.map(normalizeTurn).filter(t => t && t.text);
  if (normalized.length === 0) return [];
  return normalized.slice(Math.max(0, normalized.length - limit));
}

function extractRuleId(cardId) {
  if (!cardId) return null;
  if (cardId.includes('::')) {
    return cardId.split('::')[1] || cardId;
  }
  return cardId;
}

function buildResponseContext(trace = []) {
  const responseReady = findLastTrace(trace, 'A2_RESPONSE_READY');
  const speechSelected = findLastTrace(trace, 'SPEECH_SOURCE_SELECTED');
  const pathSelected = findLastTrace(trace, 'A2_PATH_SELECTED');
  const micProof = findLastTrace(trace, 'A2_MIC_OWNER_PROOF');
  const micConfirmed = findLastTrace(trace, 'A2_MIC_OWNER_CONFIRMED');
  const triggerEval = findLastTrace(trace, 'A2_TRIGGER_EVAL');
  const callerName = findLastTrace(trace, 'CALLER_NAME_EXTRACTED');
  const traceSummary = findLastTrace(trace, 'TURN_TRACE_SUMMARY');

  const intakeExtraction = findLastTrace(trace, 'LLM_INTAKE_EXTRACTION');

  const responseSource = responseReady?.payload?.source || speechSelected?.payload?.sourceId || null;
  const responsePath = responseReady?.payload?.path || pathSelected?.payload?.path || null;
  const responseOwner = micProof?.payload?.finalResponder || micConfirmed?.payload?.owner || null;
  const usedCallerName = responseReady?.payload?.usedCallerName;
  const callerNameExtracted = callerName?.payload?.firstName || null;
  const callerNameConfidence = callerName?.payload?.confidence ?? null;
  const responsePreview = responseReady?.payload?.responsePreview || speechSelected?.payload?.textPreview || null;
  const matchSource = traceSummary?.payload?.responseSource?.matchSource || traceSummary?.payload?.matchSource || null;
  const responseType = responseSource && responseSource.toLowerCase().includes('fallback')
    ? 'fallback'
    : (responseSource ? 'configured' : 'unknown');

  const rawCardId = triggerEval?.payload?.cardId;
  const ruleId = extractRuleId(rawCardId);

  const ctx = {
    responseType,
    responseSource,
    responsePath,
    responseOwner,
    matchSource,
    responsePreview,
    usedCallerName,
    callerNameExtracted,
    callerNameConfidence,
    triggerMatched: triggerEval?.payload?.matched ?? null,
    matchedTriggerLabel: triggerEval?.payload?.cardLabel || null,
    matchedTriggerId: rawCardId,
    matchedTriggerRuleId: ruleId,
    routingTier: traceSummary?.payload?._123rp || null
  };

  // Attach LLM Intake extraction summary if present
  if (intakeExtraction?.payload) {
    const ip = intakeExtraction.payload;
    ctx.intakeExtraction = {
      entities: ip.entities || {},
      callReason: ip.callReason,
      urgency: ip.urgency,
      nextLane: ip.nextLane,
      extractionSummary: ip.extractionSummary || [],
      wasPartial: ip.wasPartial,
      latencyMs: ip.latencyMs
    };
  }

  return ctx;
}

function buildTurnByTurnFlow(turns = [], trace = []) {
  if (!Array.isArray(trace)) trace = [];
  if (!Array.isArray(turns)) turns = [];
  if (turns.length === 0 && trace.length === 0) return [];

  const flowSteps = [];
  const maxTurns = 20;

  // Collect turn numbers from BOTH transcript entries AND trace events
  // so turns with only trace data (e.g., bridge/fallback turns) are visible
  const turnNumsFromTranscript = turns.map(t => t.turnNumber).filter(n => Number.isFinite(n));
  const turnNumsFromTrace = trace.map(t => t.turnNumber).filter(n => Number.isFinite(n) && n > 0);
  const turnNumbers = [...new Set([...turnNumsFromTranscript, ...turnNumsFromTrace])].sort((a, b) => a - b).slice(0, maxTurns);

  const traceByKind = new Map();
  for (const t of trace) {
    if (!t.kind) continue;
    const key = `${t.turnNumber || 0}:${t.kind}`;
    traceByKind.set(key, t);
  }

  for (const turnNum of turnNumbers) {
    const turnData = { turnNumber: turnNum };

    const callerTurn = turns.find(t => t.turnNumber === turnNum && t.speaker === 'caller');
    const agentTurnEntry = turns.find(t => t.turnNumber === turnNum && t.speaker === 'agent');
    const hasTranscript = !!(callerTurn || agentTurnEntry);
    if (!hasTranscript) turnData.traceOnly = true;

    if (callerTurn) {
      turnData.callerInput = {
        raw: callerTurn.text?.substring(0, 500),
        timestamp: callerTurn.timestamp || null
      };
    }

    const scrabProcessed = traceByKind.get(`${turnNum}:SCRABENGINE_PROCESSED`);
    if (scrabProcessed?.payload) {
      const p = scrabProcessed.payload;
      turnData.scrabEngineOutput = {
        normalized: p.normalizedPreview?.substring(0, 300),
        tokensOriginal: p.tokensOriginal,
        tokensExpanded: p.tokensExpanded,
        qualityPassed: p.quality?.passed,
        qualityReason: p.quality?.reason
      };
    }

    const scrabHandoff = traceByKind.get(`${turnNum}:SCRABENGINE_HANDOFF_TO_TRIGGERS`);
    if (scrabHandoff?.payload) {
      const p = scrabHandoff.payload;
      turnData.scrabHandoff = {
        normalizedInput: p.normalizedInput?.substring(0, 300),
        expandedTokens: (p.expandedTokens || []).slice(0, 30),
        tokensAdded: p.tokensAdded
      };
    }

    const triggerEval = traceByKind.get(`${turnNum}:A2_TRIGGER_EVAL`);
    if (triggerEval?.payload) {
      const p = triggerEval.payload;
      const cardId = p.cardId || '';
      const ruleId = cardId.includes('::') ? cardId.split('::')[1] : cardId;
      
      turnData.triggerEvaluation = {
        matched: p.matched,
        cardLabel: p.cardLabel,
        cardId: p.cardId,
        ruleId: ruleId,
        matchedOn: p.matchedOn,
        totalCards: p.totalCards,
        enabledCards: p.enabledCards
      };
    }

    const pathSelected = traceByKind.get(`${turnNum}:A2_PATH_SELECTED`);
    if (pathSelected?.payload) {
      turnData.pathSelected = {
        path: pathSelected.payload.path,
        reason: pathSelected.payload.reason?.substring(0, 200)
      };
    }

    // LLM Intake extraction details (Turn-1 entity extraction)
    const intakeExtraction = traceByKind.get(`${turnNum}:LLM_INTAKE_EXTRACTION`);
    if (intakeExtraction?.payload) {
      const ip = intakeExtraction.payload;
      turnData.intakeExtraction = {
        entities: ip.entities || {},
        callReason: ip.callReason,
        urgency: ip.urgency,
        nextLane: ip.nextLane,
        doNotReask: ip.doNotReask || [],
        employeeMentioned: ip.employeeMentioned,
        priorVisit: ip.priorVisit,
        sameDayRequested: ip.sameDayRequested,
        extractionSummary: ip.extractionSummary || [],
        confidence: ip.confidence || {},
        wasPartial: ip.wasPartial,
        latencyMs: ip.latencyMs
      };
    }

    // ── KC ENGINE DATA ───────────────────────────────────────────────────
    // Populate per-turn KC engine details from trace events emitted by
    // KCDiscoveryRunner. Shows container match, SPFUQ state, Groq answer,
    // booking intent, LLM fallback, caller screening — everything needed
    // to understand what the KC engine did on this turn.
    // ─────────────────────────────────────────────────────────────────────
    const kcContainerMatched = traceByKind.get(`${turnNum}:KC_CONTAINER_MATCHED`);
    const kcGroqAnswered     = traceByKind.get(`${turnNum}:KC_GROQ_ANSWERED`);
    const kcSpfuqLoaded      = traceByKind.get(`${turnNum}:KC_SPFUQ_LOADED`);
    const kcPfuqReask        = traceByKind.get(`${turnNum}:KC_PFUQ_REASK_FIRED`);
    const kcBookingFired     = traceByKind.get(`${turnNum}:KC_BOOKING_INTENT_FIRED`);
    const kcLlmFallback      = traceByKind.get(`${turnNum}:KC_LLM_FALLBACK_FIRED`);
    const kcGracefulAck      = traceByKind.get(`${turnNum}:KC_GRACEFUL_ACK_FIRED`);
    const callerScreening    = traceByKind.get(`${turnNum}:CALLER_SCREENING_INTERCEPT`);

    if (kcContainerMatched || kcGroqAnswered || kcBookingFired || kcLlmFallback || kcGracefulAck) {
      turnData.kcEngine = {
        // ── Container identity ────────────────────────────────────────────
        containerTitle:  kcGroqAnswered?.payload?.containerTitle || kcContainerMatched?.payload?.containerTitle || kcPfuqReask?.payload?.containerTitle || null,
        containerId:     kcGroqAnswered?.payload?.containerId || kcContainerMatched?.payload?.containerId || kcPfuqReask?.payload?.containerId || null,
        kcId:            kcGroqAnswered?.payload?.kcId || kcContainerMatched?.payload?.kcId || null,
        matchScore:      kcContainerMatched?.payload?.score ?? null,

        // ── Groq answer details ───────────────────────────────────────────
        groqIntent:      kcGroqAnswered?.payload?.intent || null,
        groqConfidence:  kcGroqAnswered?.payload?.confidence ?? null,
        groqLatencyMs:   kcGroqAnswered?.payload?.latencyMs ?? null,
        groqResponse:    kcGroqAnswered?.payload?.responsePreview || null,
        path:            kcGroqAnswered?.payload?.path || kcBookingFired?.payload?.path || null,

        // ── Source material — what Groq READ to generate its answer ───────
        // This is the formatted LABEL: content sections from the KC container
        // that were injected into Groq's system prompt. Full provenance.
        containerBlockPreview: kcGroqAnswered?.payload?.containerBlockPreview || null,

        // ── State flags ───────────────────────────────────────────────────
        spfuqActive:     !!kcSpfuqLoaded,
        spfuqContainer:  kcSpfuqLoaded?.payload?.containerTitle || null,
        pfuqReask:       !!kcPfuqReask,
        bookingFired:    !!kcBookingFired,
        llmFallback:     !!kcLlmFallback,
        llmFallbackReason: kcLlmFallback?.payload?.reason || null,
        gracefulAck:     !!kcGracefulAck,
      };
    }

    if (callerScreening?.payload) {
      turnData.callerScreening = {
        callerType:  callerScreening.payload.callerType,
        intercepted: true,
      };
    }

    // ── AGENT RESPONSE ───────────────────────────────────────────────────
    // Sources (in priority order):
    //   1. Transcript turn with speaker='agent' + matching turnNumber
    //   2. A2_RESPONSE_READY trace event (ScrabEngine / trigger path)
    //   3. KC_GROQ_ANSWERED trace event (KC engine path — responsePreview)
    // ─────────────────────────────────────────────────────────────────────
    const responseReady = traceByKind.get(`${turnNum}:A2_RESPONSE_READY`);
    const agentTurn = turns.find(t => t.turnNumber === turnNum && t.speaker === 'agent');
    if (responseReady?.payload || kcGroqAnswered?.payload || agentTurn) {
      turnData.agentResponse = {
        text: (agentTurn?.text || responseReady?.payload?.responsePreview || kcGroqAnswered?.payload?.responsePreview || '').substring(0, 500),
        source: responseReady?.payload?.source || (kcGroqAnswered ? 'KC_ENGINE' : null),
        usedCallerName: responseReady?.payload?.usedCallerName,
        timestamp: agentTurn?.timestamp || null
      };
    }

    // ── VOICE DELIVERY AUDIT ─────────────────────────────────────────────
    // Shows what the caller ACTUALLY heard vs what was intended.
    // Priority: ACTUAL_DELIVERY entries (ground truth from bridge-continue)
    // are authoritative. Falls back to TWIML_PLAY/TWIML_SAY if no
    // ACTUAL_DELIVERY exists (non-bridge path, older calls).
    // ─────────────────────────────────────────────────────────────────────
    const actualDeliveryTurn = turns.find(t =>
      t.turnNumber === turnNum &&
      t.speaker === 'system' &&
      t.kind === 'ACTUAL_DELIVERY'
    );
    const deliveryTurns = turns.filter(t =>
      t.turnNumber === turnNum &&
      t.speaker === 'system' &&
      (t.kind === 'TWIML_PLAY' || t.kind === 'TWIML_SAY' || t.kind === 'TWIML_PAUSE')
    );
    const bridgeTurns = turns.filter(t =>
      t.turnNumber === turnNum &&
      t.speaker === 'system' &&
      t.sourceKey === 'AGENT2_BRIDGE'
    );
    if (actualDeliveryTurn || deliveryTurns.length > 0 || bridgeTurns.length > 0) {
      const deliveryEntries = [];

      // Bridge lines (played while processing)
      for (const bt of bridgeTurns) {
        const prov = bt.trace?.provenance || bt.provenance || {};
        deliveryEntries.push({
          type: 'bridge',
          text: (bt.text || '').substring(0, 300),
          voiceProvider: prov.voiceProviderUsed || (bt.kind === 'TWIML_PLAY' ? 'elevenlabs_cached' : 'twilio_say'),
          twimlVerb: bt.kind === 'TWIML_PLAY' ? 'PLAY' : bt.kind === 'TWIML_PAUSE' ? 'PAUSE' : 'SAY',
          isBridge: true,
        });
      }

      // ── ACTUAL_DELIVERY is ground truth (from bridge-continue) ──────
      if (actualDeliveryTurn) {
        const adTrace = actualDeliveryTurn.trace || {};
        deliveryEntries.push({
          type: 'response',
          text: (actualDeliveryTurn.text || '').substring(0, 500),
          voiceProvider: adTrace.voiceProvider || 'unknown',
          twimlVerb: adTrace.twimlVerb || 'SAY',
          deliveredVia: adTrace.bridgePath || 'bridge',
          audioUrl: null,
          isActualDelivery: true,
        });
      } else {
        // Fallback: use TWIML_PLAY/TWIML_SAY entries (non-bridge or older calls)
        for (const dt of deliveryTurns) {
          if (dt.sourceKey === 'AGENT2_BRIDGE') continue;
          const prov = dt.trace?.provenance || dt.provenance || {};
          deliveryEntries.push({
            type: 'response',
            text: (dt.text || '').substring(0, 500),
            voiceProvider: prov.voiceProviderUsed || (dt.kind === 'TWIML_PLAY' ? 'elevenlabs' : 'twilio_say'),
            twimlVerb: dt.kind === 'TWIML_PLAY' ? 'PLAY' : dt.kind === 'TWIML_PAUSE' ? 'PAUSE' : 'SAY',
            deliveredVia: prov.deliveredVia || (dt.sourceKey === 'twiml' ? 'direct' : dt.sourceKey || 'unknown'),
            audioUrl: prov.audioUrl || null,
          });
        }
      }

      // Detect mismatch: intended response vs what was delivered
      const intendedText = turnData.agentResponse?.text || '';
      const deliveredResponse = deliveryEntries.find(e => e.type === 'response');
      const deliveredText = deliveredResponse?.text || '';
      // ACTUAL_DELIVERY carries its own mismatch flag (most reliable)
      const adMismatch = actualDeliveryTurn?.trace?.mismatch;
      const textMismatch = adMismatch === true || (
        adMismatch == null && intendedText && deliveredText &&
        intendedText.substring(0, 80).toLowerCase() !== deliveredText.substring(0, 80).toLowerCase()
      );
      const voiceMismatch = deliveredResponse?.voiceProvider === 'twilio_say' && deliveredResponse?.twimlVerb === 'SAY';

      turnData.voiceDelivery = {
        entries: deliveryEntries,
        voiceProvider: deliveredResponse?.voiceProvider || null,
        twimlVerb: deliveredResponse?.twimlVerb || null,
        hadBridge: bridgeTurns.length > 0,
        bridgeCount: bridgeTurns.length,
        textMismatch,
        voiceMismatch,
        deliveredText: deliveredText.substring(0, 500),
        intendedText: actualDeliveryTurn?.trace?.intended || intendedText.substring(0, 500),
        sanitizerReason: actualDeliveryTurn?.trace?.sanitizerReason || null,
        bridgePath: actualDeliveryTurn?.trace?.bridgePath || null,
      };
    }

    // 123RP — Extract routing tier from TURN_TRACE_SUMMARY
    const turnTraceSummary = traceByKind.get(`${turnNum}:TURN_TRACE_SUMMARY`);
    if (turnTraceSummary?.payload?._123rp) {
      turnData.routingTier = turnTraceSummary.payload._123rp;
    }

    flowSteps.push(turnData);
  }

  return flowSteps;
}

function buildVoiceDeliverySummary(turns = []) {
  // Build a call-level summary of all voice delivery:
  // what voices were used, any Twilio <Say> fallbacks, any text mismatches
  const systemTurns = turns.filter(t =>
    t.speaker === 'system' &&
    (t.kind === 'TWIML_PLAY' || t.kind === 'TWIML_SAY' || t.kind === 'TWIML_PAUSE')
  );

  if (systemTurns.length === 0) return null;

  const providers = new Set();
  const verbs = new Set();
  let twilioSayCount = 0;
  let elevenLabsPlayCount = 0;
  const spokenLines = [];

  for (const st of systemTurns) {
    const prov = st.trace?.provenance || st.provenance || {};
    const vp = prov.voiceProviderUsed || (st.kind === 'TWIML_PLAY' ? 'elevenlabs' : 'twilio_say');
    providers.add(vp);
    verbs.add(st.kind);
    if (st.kind === 'TWIML_SAY') twilioSayCount++;
    if (st.kind === 'TWIML_PLAY') elevenLabsPlayCount++;

    spokenLines.push({
      turn: st.turnNumber,
      text: (st.text || '').substring(0, 200),
      voiceProvider: vp,
      verb: st.kind,
      source: st.sourceKey || prov.reason || null,
      isBridge: st.sourceKey === 'AGENT2_BRIDGE' || prov.isBridge === true,
    });
  }

  return {
    totalSpokenLines: spokenLines.length,
    providers: [...providers],
    twilioSayCount,
    elevenLabsPlayCount,
    hadTwilioFallback: twilioSayCount > 0,
    spokenLines,
  };
}

function buildGreeting(turns = []) {
  // Greeting is stored as turnNumber:0 — excluded from turnByTurnFlow (n > 0 filter)
  const agentTurn = turns.find(t => t.turnNumber === 0 && t.speaker === 'agent' && t.kind === 'GREETING');
  const systemTurn = turns.find(t => t.turnNumber === 0 && t.speaker === 'system' &&
    (t.kind === 'TWIML_PLAY' || t.kind === 'TWIML_SAY'));
  if (!agentTurn && !systemTurn) return null;
  return {
    text: (agentTurn?.text || systemTurn?.text || '').substring(0, 500),
    timestamp: agentTurn?.timestamp || systemTurn?.timestamp || null,
    voiceProvider: systemTurn?.kind === 'TWIML_PLAY' ? 'elevenlabs' : 'twilio_say',
    twimlVerb: systemTurn?.kind === 'TWIML_PLAY' ? 'PLAY' : 'SAY'
  };
}

function buildCallContext(turns = [], trace = []) {
  const scrabHandoff = findLastTrace(trace, 'SCRABENGINE_HANDOFF_TO_TRIGGERS');

  return {
    transcript: buildTranscript(turns),
    response: buildResponseContext(trace),
    scrabEngineHandoff: scrabHandoff?.payload || null,
    greeting: buildGreeting(turns),
    turnByTurnFlow: buildTurnByTurnFlow(turns, trace),
    voiceDelivery: buildVoiceDeliverySummary(turns)
  };
}

/**
 * GET /api/call-intelligence/status
 * Get GPT-4 analysis service status
 */
router.get('/status', async (req, res) => {
  try {
    const status = GPT4AnalysisService.getStatus();
    res.json({
      success: true,
      status
    });
  } catch (error) {
    console.error('Error getting GPT-4 status:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/call-intelligence/settings/:companyId
 * Get company-specific intelligence settings
 */
router.get('/settings/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const settings = await CallIntelligenceSettings.getSettings(companyId);
    
    res.json({
      success: true,
      settings
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/call-intelligence/settings/:companyId
 * Update company-specific intelligence settings
 */
router.post('/settings/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { gpt4Enabled, analysisMode, analysisModel, autoAnalyzeEnabled } = req.body;

    const updates = {};
    if (typeof gpt4Enabled === 'boolean') updates.gpt4Enabled = gpt4Enabled;
    if (analysisMode) updates.analysisMode = analysisMode;
    if (analysisModel) updates.analysisModel = analysisModel;
    if (typeof autoAnalyzeEnabled === 'boolean') updates.autoAnalyzeEnabled = autoAnalyzeEnabled;

    const settings = await CallIntelligenceSettings.updateSettings(companyId, updates);
    
    res.json({
      success: true,
      settings,
      message: 'Settings saved successfully'
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/call-intelligence/toggle
 * Enable/disable GPT-4 analysis
 */
router.post('/toggle', async (req, res) => {
  try {
    const { enabled } = req.body;

    if (enabled) {
      GPT4AnalysisService.enable();
    } else {
      GPT4AnalysisService.disable();
    }

    const status = GPT4AnalysisService.getStatus();
    
    res.json({
      success: true,
      status,
      message: enabled ? 'GPT-4 analysis enabled' : 'GPT-4 analysis disabled'
    });
  } catch (error) {
    console.error('Error toggling GPT-4:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/call-intelligence/analyze/:callSid
 * Analyze a specific call
 */
router.post('/analyze/:callSid', async (req, res) => {
  try {
    const { callSid } = req.params;
    const { useGPT4 = false, mode = 'full', model = null, forceReanalyze = false } = req.body;
    console.log(`[ANALYZE] ▶ POST /analyze/${callSid} — useGPT4: ${useGPT4}, mode: ${mode}, model: ${model}, forceReanalyze: ${forceReanalyze}`);

    const transcript = await CallTranscriptV2.findOne({ callSid }).lean();
    const callSummary = await CallSummary.findOne({
      $or: [{ twilioSid: callSid }, { callId: callSid }]
    }).lean();
    if (!transcript && !callSummary) {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    let callTrace;

    if (transcript) {
      callTrace = {
        callSid: transcript.callSid,
        companyId: transcript.companyId,
        call: {
          callSid: transcript.callSid,
        fromPhone: callSummary?.phone,
          toPhone: callSummary?.toPhone,
        startTime: transcript.firstTurnTs || callSummary?.startedAt,
          durationSeconds: transcript.callMeta?.twilioDurationSeconds
        },
        turns: transcript.turns || [],
        events: transcript.trace || [],
        trace: transcript.trace || []
      };
    } else if (callSummary) {
      callTrace = {
        callSid,
        companyId: callSummary.companyId,
        call: {
          callSid,
          fromPhone: callSummary.phone,
          toPhone: callSummary.toPhone,
          startTime: callSummary.startedAt,
          durationSeconds: callSummary.durationSeconds || 0
        },
        turns: callSummary.turns || [],
        events: callSummary.events || [],
        trace: callSummary.events || []
      };
    } else {
      return res.status(404).json({
        success: false,
        error: 'Call not found'
      });
    }

    console.log(`[ANALYZE] 📊 callTrace built — turns: ${callTrace.turns?.length || 0}, events: ${callTrace.events?.length || 0}`);
    const intelligence = await CallIntelligenceService.analyzeCall(callTrace, {
      useGPT4,
      mode,
      model,
      forceReanalyze
    });
    console.log(`[ANALYZE] ✅ Analysis complete — status: ${intelligence?.status}, issueCount: ${intelligence?.issueCount}`);

    res.json({
      success: true,
      intelligence
    });
  } catch (error) {
    console.error('[ANALYZE] ❌ Error analyzing call:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/call-intelligence/:callSid
 * Get intelligence for a specific call
 */
router.get('/:callSid', async (req, res) => {
  try {
    const { callSid } = req.params;
    console.log(`[GET-INTEL] ▶ GET /api/call-intelligence/${callSid}`);

    const [intelligence, transcript, summary, session, llmLogs] = await Promise.all([
      CallIntelligenceService.getCallIntelligence(callSid),
      CallTranscriptV2.findOne({ callSid }).lean(),
      CallSummary.findOne({ $or: [{ twilioSid: callSid }, { callId: callSid }] })
        .select('companyId callId twilioSid phone durationSeconds turnCount routingTier startedAt events turns hasRecording recordingUrl recordingSid recordingDuration')
        .lean(),
      // Claude T2 tokens — ConversationSession keyed by twilioCallSid
      ConversationSession.findOne({ 'channelIdentifiers.twilioCallSid': callSid })
        .select('metrics.totalTokens metrics.llmTurns turns.tokensUsed turns.role')
        .lean(),
      // OpenAI T3 tokens — LLMCallLog entries for this call
      LLMCallLog.find({ callId: callSid, 'tier3Result.attempted': true })
        .select('tier3Result.tokensUsed tier3Result.cost tier3Result.llmModel tier3Result.llmProvider')
        .lean()
    ]);

    console.log(`[GET-INTEL] 📊 Queries done — intelligence: ${!!intelligence}, transcript: ${!!transcript}, summary: ${!!summary}, session: ${!!session}, llmLogs: ${(llmLogs || []).length}`);

    const recording = {
      hasRecording: !!summary?.recordingUrl,
      url: summary?.recordingUrl || null,
      duration: summary?.recordingDuration || null,
      sid: summary?.recordingSid || null
    };

    const turns = transcript?.turns || summary?.turns || [];
    const trace = transcript?.trace || summary?.events || [];
    const callContext = buildCallContext(turns, trace);

    // ── Build token usage summary across all 3 AI systems ──
    const tokenUsage = {
      // Claude (T2 LLM Agent) tokens
      claude: {
        totalTokens: session?.metrics?.totalTokens || 0,
        llmTurns: session?.metrics?.llmTurns || 0,
        perTurn: (session?.turns || [])
          .filter(t => t.role === 'assistant' && t.tokensUsed > 0)
          .map(t => t.tokensUsed)
      },
      // OpenAI (T3 Fallback) tokens
      openai: {
        totalTokens: (llmLogs || []).reduce((sum, log) => sum + (log.tier3Result?.tokensUsed?.total || 0), 0),
        promptTokens: (llmLogs || []).reduce((sum, log) => sum + (log.tier3Result?.tokensUsed?.prompt || 0), 0),
        completionTokens: (llmLogs || []).reduce((sum, log) => sum + (log.tier3Result?.tokensUsed?.completion || 0), 0),
        totalCost: (llmLogs || []).reduce((sum, log) => sum + (log.tier3Result?.cost || 0), 0),
        model: llmLogs?.[0]?.tier3Result?.llmModel || null,
        callCount: (llmLogs || []).length
      },
      // GPT-4 Analysis tokens (already on the intelligence doc)
      gpt4Analysis: {
        totalTokens: intelligence?.gpt4Analysis?.tokensUsed || 0,
        enabled: !!intelligence?.gpt4Analysis?.enabled,
        model: intelligence?.gpt4Analysis?.modelVersion || null
      }
    };

    console.log(`[GET-INTEL] 🔢 Token usage — Claude: ${tokenUsage.claude.totalTokens}, OpenAI: ${tokenUsage.openai.totalTokens}, GPT4: ${tokenUsage.gpt4Analysis.totalTokens}`);

    // Build trace event summary — counts by event type for full audit trail
    const traceEventSummary = (() => {
      const counts = {};
      for (const t of trace) {
        if (t.kind) counts[t.kind] = (counts[t.kind] || 0) + 1;
      }
      return { totalEvents: trace.length, eventCounts: counts };
    })();

    // ── LLM Diagnostics — expose provider + failure details from stored trace payloads ──
    // This surfaces the actual error message and HTTP status from A2_LLM_STREAM_FAILED
    // so we can diagnose failures without needing to dig through Render logs.
    const llmDiagnostics = (() => {
      // Intake call event — provider + model used for turn-1 intake
      const intakeCall = trace.find(t => t.kind === 'A2_LLM_AGENT_CALLED' && t.payload?.mode === 'TIER_2_INTAKE');
      // All stream failures — includes reason, error message, HTTP status, latency, provider
      const failures = trace
        .filter(t => t.kind === 'A2_LLM_STREAM_FAILED')
        .map(t => ({
          turn:         t.turnNumber,
          reason:       t.payload?.reason                                       || null,
          errorMsg:     t.payload?.errorMsg || t.payload?.error                 || null,
          httpStatus:   t.payload?.httpStatus                                   || null,
          latencyMs:    t.payload?.latencyMs                                    || null,
          partialChars: t.payload?.partialChars                                 || 0,
          provider:     t.payload?.provider                                     || null,
        }));
      // Provider fallback event — fires when Groq configured but key missing
      const providerFallback = trace.find(t => t.kind === 'A2_LLM_INTAKE_PROVIDER_FALLBACK');

      return {
        intakeProvider:    intakeCall?.payload?.provider || null,
        intakeModel:       intakeCall?.payload?.model    || null,
        streamFailures:    failures.length > 0 ? failures : null,
        providerFallback:  providerFallback ? {
          from: providerFallback.payload?.from,
          to:   providerFallback.payload?.to,
        } : null,
      };
    })();

    // If GPT-4 analysis exists, merge callContext, recording & tokens, return
    if (intelligence) {
      const payload = intelligence.toObject ? intelligence.toObject() : intelligence;
      payload.callContext = callContext;
      payload.recording = recording;
      payload.tokenUsage = tokenUsage;
      payload.traceEventSummary = traceEventSummary;
      payload.llmDiagnostics = llmDiagnostics;
      return res.json({ success: true, intelligence: payload });
    }

    // No GPT-4 analysis yet — return trace-based callContext so admin can
    // still see turn-by-turn flow + 123RP tier data without waiting for analysis.
    if (turns.length > 0 || trace.length > 0) {
      return res.json({
        success: true,
        intelligence: {
          callSid,
          companyId: transcript?.companyId || summary?.companyId || null,
          status: 'trace_only',
          executiveSummary: 'GPT-4 analysis not yet run. Turn-by-turn trace data shown below.',
          topIssue: 'Not analyzed',
          issueCount: 0,
          criticalIssueCount: 0,
          issues: [],
          recommendations: [],
          recording,
          callMetadata: {
            duration: summary?.durationSeconds || 0,
            turns: Math.max(summary?.turnCount || 0, callContext?.turnByTurnFlow?.length || 0, turns.filter(t => t.speaker === 'caller').length || 0),
            fromPhone: summary?.phone || null,
            startTime: summary?.startedAt || transcript?.firstTurnTs || null,
            routingTier: summary?.routingTier || null
          },
          callContext,
          tokenUsage,
          traceEventSummary,
          llmDiagnostics
        }
      });
    }

    return res.status(404).json({
      success: false,
      error: 'No trace data or intelligence found for this call'
    });
  } catch (error) {
    console.error('Error getting intelligence:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/call-intelligence/company/:companyId/summary
 * Get intelligence summary for company
 */
router.get('/company/:companyId/summary', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { timeRange } = req.query;

    const summary = await CallIntelligenceService.getCompanySummary(companyId, {
      timeRange
    });

    res.json({
      success: true,
      summary
    });
  } catch (error) {
    console.error('Error getting company summary:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/call-intelligence/company/:companyId/list
 * Get paginated intelligence list for company
 * Auto-analyzes recent calls if not yet analyzed
 */
router.get('/company/:companyId/list', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { page, limit, status, autoAnalyze = 'false', timeRange } = req.query;
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 50;

    console.log('[CallIntelligence] Fetching list for company:', companyId);
    const dateFilter = buildCallSummaryDateRange(timeRange);
    const companyObjectId = mongoose.Types.ObjectId.isValid(companyId)
      ? new mongoose.Types.ObjectId(companyId)
      : companyId;
    const summaryQuery = { companyId: companyObjectId, ...dateFilter };

    let [summaries, totalSummaries] = await Promise.all([
      CallSummary.find(summaryQuery)
        .sort({ startedAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .select('callId twilioSid startedAt endedAt phone toPhone durationSeconds turnCount routingTier events turns hasRecording recordingUrl recordingSid recordingDuration')
        .lean(),
      CallSummary.countDocuments(summaryQuery)
    ]);

    if (summaries.length === 0 && timeRange) {
      console.log('[CallIntelligence] No calls found for timeRange, retrying without date filter');
      const fallbackQuery = { companyId: companyObjectId };
      [summaries, totalSummaries] = await Promise.all([
        CallSummary.find(fallbackQuery)
          .sort({ startedAt: -1 })
          .skip((pageNum - 1) * limitNum)
          .limit(limitNum)
          .select('callId twilioSid startedAt endedAt phone toPhone durationSeconds turnCount routingTier events turns hasRecording recordingUrl recordingSid recordingDuration')
          .lean(),
        CallSummary.countDocuments(fallbackQuery)
      ]);
    }

    const callSids = summaries.map(c => c.twilioSid || c.callId).filter(Boolean);
    const intelligenceDocs = callSids.length > 0
      ? await CallIntelligence.find({ companyId, callSid: { $in: callSids } }).lean()
      : [];
    const intelligenceMap = new Map(intelligenceDocs.map(doc => [doc.callSid, doc]));

    // Recording data is now read directly from CallSummary (hasRecording, recordingUrl, etc.)
    // No separate v2AIAgentCallLog query needed.

    if (autoAnalyze === 'true') {
      const settings = await CallIntelligenceSettings.getSettings(companyId);
      if (settings.autoAnalyzeEnabled) {
        const missingSummaries = summaries
          .filter(s => !intelligenceMap.has(s.twilioSid || s.callId))
          .slice(0, 10);

        if (missingSummaries.length > 0) {
          console.log('[CallIntelligence] Queuing auto-analysis for', missingSummaries.length, 'recent calls');
          const callSidsToAnalyze = missingSummaries.map(s => s.twilioSid || s.callId).filter(Boolean);

          void (async () => {
            try {
              const transcripts = await CallTranscriptV2.find({
                callSid: { $in: callSidsToAnalyze }
              }).lean();

              const transcriptMap = new Map(transcripts.map(t => [t.callSid, t]));
              const callTracesToAnalyze = [];

              for (const summary of missingSummaries) {
                const callSid = summary.twilioSid || summary.callId;
                const transcript = transcriptMap.get(callSid);
                if (transcript) {
                  callTracesToAnalyze.push({
                    callSid: transcript.callSid,
                    companyId: transcript.companyId,
                    call: {
                      callSid: transcript.callSid,
                      fromPhone: summary.phone,
                      toPhone: summary.toPhone,
                      startTime: transcript.firstTurnTs || summary.startedAt,
                      // null = "unknown / not yet finalized" — analysis should NOT bake 0
                      // as a permanent value when the real duration hasn't arrived yet.
                      durationSeconds: transcript.callMeta?.twilioDurationSeconds ?? summary.durationSeconds ?? null
                    },
                    turns: transcript.turns || [],
                    events: transcript.trace || [],
                    trace: transcript.trace || []
                  });
                } else {
                  callTracesToAnalyze.push({
                    callSid,
                    companyId,
                    call: {
                      callSid,
                      fromPhone: summary.phone,
                      toPhone: summary.toPhone,
                      startTime: summary.startedAt,
                      // null = "unknown" — never collapse to 0 for analysis purposes
                      durationSeconds: summary.durationSeconds ?? null
                    },
                    turns: summary.turns || [],
                    events: summary.events || [],
                    trace: summary.events || []
                  });
                }
              }

              const analysisPromises = callTracesToAnalyze.map(callTrace =>
                CallIntelligenceService.analyzeCall(callTrace, {
                  useGPT4: settings.gpt4Enabled,
                  mode: settings.analysisMode || 'quick'
                }).catch(err => {
                  console.error(`[CallIntelligence] Failed to analyze ${callTrace.callSid}:`, err.message);
                  return null;
                })
              );

              await Promise.allSettled(analysisPromises);
              console.log('[CallIntelligence] Auto-analysis completed for queued calls');
            } catch (error) {
              console.error('[CallIntelligence] Auto-analysis background job failed:', error.message);
            }
          })();
        }
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    // BUILD RESPONSE: CallSummary is the CANONICAL source of truth for
    // completion metrics (duration, recording, routingTier). CallIntelligence
    // owns analysis data only. This separation ensures that race conditions
    // between auto-analysis and Twilio callbacks never corrupt the display.
    // ──────────────────────────────────────────────────────────────────────────
    let items = summaries.map(summary => {
      const callSid = summary.twilioSid || summary.callId;
      const intel = intelligenceMap.get(callSid);

      // Recording object: derived from CallSummary (canonical owner)
      const recording = {
        hasRecording: !!summary.recordingUrl,
        url: summary.recordingUrl || null,
        sid: summary.recordingSid || null,
        duration: summary.recordingDuration ?? null
      };

      // Canonical completion metadata: ALWAYS from CallSummary, never from analysis doc.
      // null = "unknown / not yet received from Twilio"
      // 0    = "Twilio reported zero seconds" (legitimate for unanswered calls)
      const canonicalMetadata = {
        duration: summary.durationSeconds ?? null,
        turns: summary.turnCount || 0,
        fromPhone: summary.phone,
        startTime: summary.startedAt,
        routingTier: summary.routingTier || null
      };

      if (intel) {
        // Analysis doc exists — use it for analysis fields, but ALWAYS
        // override completion metrics from CallSummary (authoritative).
        intel.callMetadata = {
          ...(intel.callMetadata || {}),
          ...canonicalMetadata
        };
        intel.recording = recording;
        return intel;
      }

      // No analysis doc — return stub with CallSummary data
      return {
        callSid,
        companyId,
        analyzedAt: summary.startedAt,
        status: 'not_analyzed',
        issueCount: 0,
        criticalIssueCount: 0,
        executiveSummary: 'Not analyzed yet.',
        topIssue: 'Not analyzed yet',
        issues: [],
        recommendations: [],
        analysis: {},
        gpt4Analysis: { enabled: false },
        recording,
        callMetadata: canonicalMetadata
      };
    });

    if (status) {
      items = items.filter(item => item.status === status);
    }

    res.json({
      success: true,
      items,
      total: totalSummaries,
      page: pageNum,
      pages: Math.ceil(totalSummaries / limitNum)
    });
  } catch (error) {
    console.error('Error getting intelligence list:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/call-intelligence/:callSid/recommendation/:recommendationId/implement
 * Mark recommendation as implemented
 */
router.post('/:callSid/recommendation/:recommendationId/implement', async (req, res) => {
  try {
    const { callSid, recommendationId } = req.params;
    const { implementedBy } = req.body;

    const intelligence = await CallIntelligenceService.markRecommendationImplemented(
      callSid,
      recommendationId,
      implementedBy || 'admin'
    );

    res.json({
      success: true,
      intelligence
    });
  } catch (error) {
    console.error('Error marking recommendation:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/call-intelligence/batch-analyze
 * Batch analyze multiple calls
 */
router.post('/batch-analyze', async (req, res) => {
  try {
    const { callSids, useGPT4 = false, mode = 'quick' } = req.body;

    if (!Array.isArray(callSids) || callSids.length === 0) {
      return res.status(400).json({
        success: false,
        error: 'callSids must be a non-empty array'
      });
    }

    const transcripts = await CallTranscriptV2.find({
      callSid: { $in: callSids }
    }).lean();

    const summaries = await CallSummary.find({
      callSid: { $in: callSids }
    }).lean();

    const summaryMap = new Map(summaries.map(s => [s.callSid, s]));

    const callTraces = transcripts.map(transcript => {
      const summary = summaryMap.get(transcript.callSid);
      return {
        callSid: transcript.callSid,
        companyId: transcript.companyId,
        call: {
          callSid: transcript.callSid,
          fromPhone: summary?.fromPhone,
          toPhone: summary?.toPhone,
          startTime: transcript.firstTurnTs || summary?.callTime,
          durationSeconds: transcript.callMeta?.twilioDurationSeconds
        },
        turns: transcript.turns || [],
        events: transcript.trace || [],
        trace: transcript.trace || []
      };
    });

    const results = await Promise.allSettled(
      callTraces.map(callTrace => 
        CallIntelligenceService.analyzeCall(callTrace, { useGPT4, mode })
      )
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    const failed = results.filter(r => r.status === 'rejected').length;

    res.json({
      success: true,
      total: callSids.length,
      successful,
      failed,
      results: results.map((r, i) => ({
        callSid: callSids[i],
        status: r.status,
        data: r.status === 'fulfilled' ? r.value : null,
        error: r.status === 'rejected' ? r.reason.message : null
      }))
    });
  } catch (error) {
    console.error('Error batch analyzing:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/call-intelligence/estimate-cost
 * Estimate GPT-4 analysis cost
 */
router.get('/estimate-cost', async (req, res) => {
  try {
    const { callCount = 1, mode = 'full' } = req.query;

    const estimate = GPT4AnalysisService.estimateCost(
      parseInt(callCount),
      mode
    );

    res.json({
      success: true,
      estimate
    });
  } catch (error) {
    console.error('Error estimating cost:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/call-intelligence/debug/:companyId
 * Debug endpoint to check data availability
 */
router.get('/debug/:companyId', async (req, res) => {
  try {
    const { companyId } = req.params;
    const companyObjectId = mongoose.Types.ObjectId.isValid(companyId)
      ? new mongoose.Types.ObjectId(companyId)
      : companyId;

    const [summaryCount, transcriptV2Count, intelligenceCount] = await Promise.all([
      CallSummary.countDocuments({ companyId: companyObjectId }),
      CallTranscriptV2.countDocuments({ companyId: companyObjectId }),
      require('../../models/CallIntelligence').countDocuments({ companyId })
    ]);

    const recentSummaries = await CallSummary.find({ companyId: companyObjectId })
      .sort({ startedAt: -1 })
      .limit(5)
      .select('callId twilioSid startedAt phone events turns')
      .lean();

    const recentTranscripts = await CallTranscriptV2.find({ companyId })
      .sort({ firstTurnTs: -1 })
      .limit(5)
      .select('callSid firstTurnTs turns trace')
      .lean();

    res.json({
      success: true,
      debug: {
        companyId,
        counts: {
          callSummary: summaryCount,
          callTranscriptV2: transcriptV2Count,
          callIntelligence: intelligenceCount
        },
        recentSummaries: recentSummaries.map(s => ({
          callSid: s.twilioSid || s.callId,
          callTime: s.startedAt,
          fromPhone: s.phone,
          hasEvents: !!(s.events && s.events.length > 0),
          eventsCount: s.events?.length || 0,
          hasTurns: !!(s.turns && s.turns.length > 0),
          turnsCount: s.turns?.length || 0
        })),
        recentTranscripts: recentTranscripts.map(t => ({
          callSid: t.callSid,
          firstTurnTs: t.firstTurnTs,
          hasTurns: !!(t.turns && t.turns.length > 0),
          turnsCount: t.turns?.length || 0,
          hasTrace: !!(t.trace && t.trace.length > 0),
          traceCount: t.trace?.length || 0
        }))
      }
    });
  } catch (error) {
    console.error('Error in debug endpoint:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/call-intelligence/company/:companyId/lifecycle-diagnostic
 * Shows the Twilio callback lifecycle for the most recent calls.
 * Answers: "Did the status callback register? Did it fire? Did recording start?"
 */
router.get('/company/:companyId/lifecycle-diagnostic', async (req, res) => {
  try {
    const { companyId } = req.params;
    const limit = parseInt(req.query.limit, 10) || 10;

    const companyObjectId = mongoose.Types.ObjectId.isValid(companyId)
      ? new mongoose.Types.ObjectId(companyId)
      : companyId;

    // Load company Twilio config to expose Account SID for credential verification
    const Company = require('../../models/v2Company');
    const company = await Company.findById(companyObjectId)
      .select('twilioConfig.accountSid businessName')
      .lean();

    const calls = await CallSummary.find({ companyId: companyObjectId })
      .sort({ startedAt: -1 })
      .limit(limit)
      .select('callId twilioSid phone startedAt endedAt durationSeconds turnCount hasRecording recordingUrl recordingSid callLifecycle')
      .lean();

    const diagnostic = calls.map(c => ({
      callId: c.callId,
      twilioSid: c.twilioSid,
      phone: c.phone,
      startedAt: c.startedAt,
      endedAt: c.endedAt,
      durationSeconds: c.durationSeconds,
      turnCount: c.turnCount,
      recording: {
        hasRecording: c.hasRecording || false,
        hasUrl: !!c.recordingUrl,
        hasSid: !!c.recordingSid
      },
      lifecycle: c.callLifecycle || { _note: 'NO LIFECYCLE DATA — call predates this fix or lifecycle was never written' }
    }));

    res.json({
      success: true,
      companyId,
      companyName: company?.businessName || 'unknown',
      twilioAccountSid: company?.twilioConfig?.accountSid || 'NOT CONFIGURED',
      callCount: diagnostic.length,
      diagnostic
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/call-intelligence/recording/:recordingSid/audio
 * Proxy Twilio recording audio so the browser can play it without CORS/auth issues.
 */
router.get('/recording/:recordingSid/audio', async (req, res) => {
  try {
    const { recordingSid } = req.params;

    // Look up the CallSummary to get the recording URL and companyId
    const summary = await CallSummary.findOne({ recordingSid })
      .select('recordingUrl companyId')
      .lean();

    if (!summary?.recordingUrl) {
      return res.status(404).json({ error: 'Recording not found' });
    }

    // Get Twilio credentials from the company config
    const company = await Company.findById(summary.companyId)
      .select('twilioConfig.accountSid twilioConfig.authToken')
      .lean();

    const accountSid = company?.twilioConfig?.accountSid || process.env.TWILIO_ACCOUNT_SID;
    const authToken = company?.twilioConfig?.authToken || process.env.TWILIO_AUTH_TOKEN;

    if (!accountSid || !authToken) {
      return res.status(500).json({ error: 'Twilio credentials not configured' });
    }

    // Twilio recording URL — append .mp3 for the audio file
    const audioUrl = summary.recordingUrl.endsWith('.mp3')
      ? summary.recordingUrl
      : summary.recordingUrl + '.mp3';

    const parsed = new URL(audioUrl);
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');

    const proxyReq = https.get(
      { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { Authorization: `Basic ${auth}` } },
      (twilioRes) => {
        if (twilioRes.statusCode !== 200) {
          res.status(twilioRes.statusCode).json({ error: 'Could not fetch recording from Twilio' });
          twilioRes.resume();
          return;
        }
        res.setHeader('Content-Type', twilioRes.headers['content-type'] || 'audio/mpeg');
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        twilioRes.pipe(res);
      }
    );

    proxyReq.on('error', (err) => {
      console.error('[Recording Proxy] Error:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'Upstream error' });
    });

    req.on('close', () => proxyReq.destroy());
  } catch (error) {
    console.error('[Recording Proxy] Unexpected error:', error.message);
    if (!res.headersSent) res.status(500).json({ error: error.message });
  }
});

/**
 * DELETE /api/call-intelligence/company/:companyId/bulk-delete
 * Delete selected call records (CallSummary + CallIntelligence docs).
 * Body: { callSids: ['CA...', ...] }
 */
router.delete('/company/:companyId/bulk-delete', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { callSids } = req.body;

    if (!Array.isArray(callSids) || callSids.length === 0) {
      return res.status(400).json({ error: 'callSids array required' });
    }

    const [summaryResult, intelligenceResult] = await Promise.all([
      CallSummary.deleteMany({
        companyId,
        $or: [
          { twilioSid: { $in: callSids } },
          { callId: { $in: callSids } }
        ]
      }),
      CallIntelligence.deleteMany({ companyId, callSid: { $in: callSids } })
    ]);

    console.log(`[CallIntelligence] Bulk delete for company ${companyId}: ${summaryResult.deletedCount} summaries, ${intelligenceResult.deletedCount} intelligence docs`);

    res.json({
      success: true,
      deleted: {
        summaries: summaryResult.deletedCount,
        intelligence: intelligenceResult.deletedCount
      }
    });
  } catch (error) {
    console.error('[CallIntelligence] Bulk delete error:', error.message);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
