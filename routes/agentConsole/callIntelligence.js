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
const SemanticMatchService = require('../../services/engine/kc/SemanticMatchService');

function _cosineSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; normA += a[i] * a[i]; normB += b[i] * b[i]; }
  return (normA && normB) ? dot / (Math.sqrt(normA) * Math.sqrt(normB)) : 0;
}
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
  const triggerEval = findLastTrace(trace, 'A2_TRIGGER_EVAL');
  const callerName = findLastTrace(trace, 'CALLER_NAME_EXTRACTED');
  const traceSummary = findLastTrace(trace, 'TURN_TRACE_SUMMARY');

  const intakeExtraction = findLastTrace(trace, 'LLM_INTAKE_EXTRACTION');

  const responseSource = responseReady?.payload?.source || speechSelected?.payload?.sourceId || null;
  const responsePath = responseReady?.payload?.path || pathSelected?.payload?.path || null;
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
    matchSource,
    responsePreview,
    usedCallerName,
    callerNameExtracted,
    callerNameConfidence,
    triggerMatched: triggerEval?.payload?.matched ?? null,
    matchedTriggerLabel: triggerEval?.payload?.cardLabel || null,
    matchedTriggerId: rawCardId,
    matchedTriggerRuleId: ruleId,
    kcTrace: traceSummary?.payload?.kcTrace || traceSummary?.payload?._123rp || null
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
    // KCDiscoveryRunner. Shows container match, Groq answer, booking
    // intent, LLM fallback, caller screening — everything needed to
    // understand what the KC engine did on this turn.
    // ─────────────────────────────────────────────────────────────────────
    const kcContainerMatched = traceByKind.get(`${turnNum}:KC_CONTAINER_MATCHED`);
    const kcGroqAnswered     = traceByKind.get(`${turnNum}:KC_GROQ_ANSWERED`);
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
        pfuqReask:       !!kcPfuqReask,
        bookingFired:    !!kcBookingFired,
        llmFallback:     !!kcLlmFallback,
        gracefulAck:     !!kcGracefulAck,

        // ── LLM fallback diagnostics — WHY no KC container matched ────────
        // llmFallbackReason: 'no_kc_match' (containers exist, none matched)
        //                    'no_containers_configured' (company has zero KC containers)
        // llmFallbackInput: what the caller said that triggered KC
        // containerCount/containerTitles: which containers were searched
        llmFallbackReason:     kcLlmFallback?.payload?.reason || null,
        llmFallbackInput:      kcLlmFallback?.payload?.inputPreview || null,
        containerCount:        kcLlmFallback?.payload?.containerCount ?? null,
        containerTitles:       kcLlmFallback?.payload?.containerTitles || [],
      };
    }

    if (callerScreening?.payload) {
      turnData.callerScreening = {
        callerType:  callerScreening.payload.callerType,
        intercepted: true,
      };
    }

    // ── BOOKING ENGINE DATA ──────────────────────────────────────────────
    // BOOKING_LOGIC_STEP_RESULT → nextPromptPreview, currentStep, isComplete, latencyMs
    // BOOKING_LOGIC_TRACE.payload.steps[] → BK_* events from BookingLogicEngine.events[]
    // Booking turns do NOT emit A2_RESPONSE_READY / KC_GROQ_ANSWERED, so we
    // read booking-specific trace events to populate agentResponse, routingTier,
    // kcEngine (Tier 1.5 KC digression), and bookingStep details.
    // ─────────────────────────────────────────────────────────────────────
    const bookingStepResult = traceByKind.get(`${turnNum}:BOOKING_LOGIC_STEP_RESULT`);
    const bookingTrace      = traceByKind.get(`${turnNum}:BOOKING_LOGIC_TRACE`);

    if (bookingStepResult?.payload) {
      const bsp   = bookingStepResult.payload;
      const steps = bookingTrace?.payload?.steps || [];

      // ── Booking step metadata ────────────────────────────────────────
      turnData.bookingStep = {
        currentStep: bsp.currentStep || null,
        nameStage:   bsp.nameStage   || null,
        isComplete:  bsp.isComplete  ?? false,
        latencyMs:   bsp.latencyMs   ?? null,
      };

      // ── Parse BK_* step events to determine routing tier ────────────
      // Booking digressions route exclusively through KC (services.html).
      // Stateless — KC answer + re-anchor in one response, no consent gate.
      const kcAnswered = steps.find(s =>
        s.type === 'BK_KC_DIGRESSION_ANSWERED' || s.type === 'BK_BPFUQ_KC_ANSWERED'
      );
      const kcNoMatch  = steps.find(s =>
        s.type === 'BK_KC_DIGRESSION_NO_MATCH' || s.type === 'BK_BPFUQ_KC_NO_MATCH'
      );
      // Legacy event names kept for backward compat with old call data
      const legacyTier1_5 = steps.find(s => s.type === 'BK_123RP_TIER1_5_KC');

      const kcDigressionStep = kcAnswered || legacyTier1_5;

      let routingPath = 'BK_STEP_NORMAL';
      let routingTierNum = 0;
      if (kcNoMatch)         { routingPath = 'BK_KC_DIGRESSION_NO_MATCH'; routingTierNum = 1.5; }
      if (kcDigressionStep)  { routingPath = 'BK_KC_DIGRESSION';          routingTierNum = 1.5; }

      turnData.routingTier = {
        tier:   routingTierNum,
        path:   routingPath,
        source: 'BOOKING_ENGINE',
      };

      // ── KC digression — container + KC ID ──────────────────────────
      if (kcDigressionStep) {
        turnData.kcEngine = {
          containerTitle: kcDigressionStep.containerTitle || null,
          containerId:    kcDigressionStep.containerId    || null,
          kcId:           kcDigressionStep.kcId           || null,
          matchScore:     null,
          groqIntent:     'ANSWERED',
          groqLatencyMs:  null,
          groqResponse:   (bsp.nextPromptPreview || '').substring(0, 500) || null,
          path:           'BK_KC_DIGRESSION',
          llmFallback:    false,
          gracefulAck:    false,
        };
      }

      // ── Agent response from booking prompt preview ───────────────────
      // Booking turns write the agent reply to the transcript, so prefer
      // that; fall back to nextPromptPreview (500-char window).
      const agentTurnBk = turns.find(t => t.turnNumber === turnNum && t.speaker === 'agent');
      if (!turnData.agentResponse) {
        const responseText = agentTurnBk?.text || bsp.nextPromptPreview || '';
        if (responseText) {
          turnData.agentResponse = {
            text:           responseText.substring(0, 500),
            source:         tier1_5Step ? 'KC_ENGINE (booking digression)' : 'BOOKING_ENGINE',
            usedCallerName: false,
            timestamp:      agentTurnBk?.timestamp || null,
          };
        }
      }
    }

    // ── AGENT RESPONSE ───────────────────────────────────────────────────
    // Sources (in priority order):
    //   1. Transcript turn with speaker='agent' + matching turnNumber
    //   2. A2_RESPONSE_READY trace event (ScrabEngine / trigger path)
    //   3. KC_GROQ_ANSWERED trace event (KC engine path — responsePreview)
    //   NOTE: Booking turns are handled above in the BOOKING ENGINE block.
    // ─────────────────────────────────────────────────────────────────────
    const responseReady = traceByKind.get(`${turnNum}:A2_RESPONSE_READY`);
    const agentTurn = turns.find(t => t.turnNumber === turnNum && t.speaker === 'agent');
    if (!turnData.agentResponse && (responseReady?.payload || kcGroqAnswered?.payload || agentTurn)) {
      // Clarify source label for KC→LLM turns: answer came from Claude (own knowledge),
      // not from a KC container — so the user knows Groq is NOT reading from services.html.
      const kcLlmFallbackForSource = traceByKind.get(`${turnNum}:KC_LLM_FALLBACK_FIRED`);
      const baseSource = responseReady?.payload?.source || (kcGroqAnswered ? 'KC_ENGINE' : null);
      const resolvedSource = kcLlmFallbackForSource
        ? 'LLM (no KC container matched — Claude own knowledge)'
        : baseSource;

      turnData.agentResponse = {
        text: (agentTurn?.text || responseReady?.payload?.responsePreview || kcGroqAnswered?.payload?.responsePreview || '').substring(0, 500),
        source: resolvedSource,
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

    // KC Trace — Extract KC engine context from TURN_TRACE_SUMMARY.
    // New transcripts: payload.kcTrace   (UAP-era)
    // Old transcripts: payload._123rp    (backward compat — legacy 123rp era)
    const turnTraceSummary = traceByKind.get(`${turnNum}:TURN_TRACE_SUMMARY`);
    const kcTrace = turnTraceSummary?.payload?.kcTrace || turnTraceSummary?.payload?._123rp || null;
    if (kcTrace) {
      turnData.routingTier = kcTrace; // keep for backward compat with UI components that read routingTier
    }

    // ── KC ENGINE — build dedicated kcEngine block when KC trace is present ──
    // kcTrace.containerId, containerTitle, kcId, intent, latencyMs
    // come from KCDiscoveryRunner._buildKcTrace() (or legacy _build123rp).
    // KC_CONTAINER_MATCHED / KC_GROQ_ANSWERED events are used as fallback sources.
    if (kcTrace) {
      const kcContainerMatched = traceByKind.get(`${turnNum}:KC_CONTAINER_MATCHED`);
      const kcGroqAnswered = traceByKind.get(`${turnNum}:KC_GROQ_ANSWERED`);
      turnData.kcEngine = {
        containerId:    kcTrace.containerId || null,
        containerTitle: kcTrace.containerTitle || kcContainerMatched?.payload?.containerTitle || null,
        kcId:           kcTrace.kcId || null,
        sectionIdx:     kcTrace.sectionIdx ?? null,
        sectionId:      kcTrace.sectionId || null,
        matchScore:     kcContainerMatched?.payload?.score ?? null,
        groqIntent:     kcTrace.intent || kcGroqAnswered?.payload?.intent || null,
        groqLatencyMs:  kcTrace.latencyMs || kcGroqAnswered?.payload?.latencyMs || null,
        groqResponse:   turnData.agentResponse?.text || null,
        path:           kcTrace.path || null,
        llmFallback:    kcTrace.path === 'KC_LLM_FALLBACK',
        gracefulAck:    kcTrace.path === 'KC_GRACEFUL_ACK',
      };
    }

    // ── TURN VERDICT + OWNER from TURN_TRACE_SUMMARY ─────────────────────────
    // verdict: 'GREETING' | 'KC_ENGINE:KC_DIRECT_ANSWER' | 'KC_ENGINE:KC_LLM_FALLBACK' | 'BOOKING_ENGINE'
    if (turnTraceSummary?.payload) {
      const tsp = turnTraceSummary.payload;
      if (tsp.verdict)       turnData.turnVerdict   = tsp.verdict;
      if (tsp.ownerSelected) turnData.ownerSelected = tsp.ownerSelected;
      if (tsp.sectionTrail)  turnData.sectionTrail  = tsp.sectionTrail;
    }

    // ── DISCOVERY WIRE PATH (DISCOVERY_WIRE_PATH) ─────────────────────────────
    // 'TURN1_ENGINE' → Turn1Engine owned this turn (turn === 1 only)
    // 'GREETING'     → Agent2GreetingInterceptor handled this turn
    // 'KC_ENGINE'    → KCDiscoveryRunner handled this turn (UAP → KC pipeline)
    const discoveryWireTrace = traceByKind.get(`${turnNum}:DISCOVERY_WIRE_PATH`);
    if (discoveryWireTrace?.payload) {
      turnData.discoveryWirePath = discoveryWireTrace.payload.path || null;
    }

    // ── TURN1ENGINE TRIAGE DETAILS ────────────────────────────────────────────
    // TURN1_TRIAGE  → lane, callerName, isKnown, uapDaType, uapSubType, uapConfidence
    // TURN1_PATH    → path (lane name), prefix (for CALLER_WITH_INTENT only)
    // TURN1_DISABLED → admin disabled Turn1Engine; fell straight to KC
    const turn1TriageTrace   = traceByKind.get(`${turnNum}:TURN1_TRIAGE`);
    const turn1PathTrace     = traceByKind.get(`${turnNum}:TURN1_PATH`);
    const turn1DisabledTrace = traceByKind.get(`${turnNum}:TURN1_DISABLED`);
    if (turn1TriageTrace?.payload || turn1PathTrace?.payload) {
      const tp = turn1TriageTrace?.payload || {};
      const pp = turn1PathTrace?.payload   || {};
      turnData.turn1Engine = {
        lane:          tp.lane          || pp.path  || null,  // e.g. 'SIMPLE_GREETING'
        callerName:    tp.callerName    || null,
        isKnown:       tp.isKnown       ?? null,
        uapDaType:     tp.uapDaType     || null,
        uapSubType:    tp.uapSubType    || null,
        uapConfidence: tp.uapConfidence ?? null,
        prefix:        pp.prefix        || null,  // "Hi John! I'm sorry to hear that —"
      };
    }
    if (turn1DisabledTrace?.payload) {
      turnData.turn1Disabled = true;  // admin disabled Turn1Engine this company
    }

    // ── LLM AGENT CALL details (A2_LLM_AGENT_CALLED) ─────────────────────────
    // mode: TIER_2_INTAKE | TIER_2_NO_MATCH | TIER_2_FOLLOW_UP | STT_EMPTY_RECOVERY
    const llmAgentCalledTrace = traceByKind.get(`${turnNum}:A2_LLM_AGENT_CALLED`);
    if (llmAgentCalledTrace?.payload) {
      const p = llmAgentCalledTrace.payload;
      turnData.llmAgentCall = {
        mode:         p.mode         || null,
        model:        p.model        || null,
        provider:     p.provider     || null,  // 'anthropic' | 'groq'
        bucket:       p.bucket       || null,
        historyTurns: p.historyTurns ?? null,
        isSttEmpty:   p.isSttEmpty   ?? false,
        isRecovery:   p.isRecovery   ?? false,
      };
    }

    // ── LLM STREAM METRICS (A2_LLM_STREAM_COMPLETE) ──────────────────────────
    // latencyMs = total streaming time; firstSentenceMs = approx time to first sentence
    const llmStreamTrace = traceByKind.get(`${turnNum}:A2_LLM_STREAM_COMPLETE`);
    if (llmStreamTrace?.payload) {
      const p = llmStreamTrace.payload;
      turnData.llmStreamMetrics = {
        latencyMs:       p.latencyMs       ?? null,
        firstSentenceMs: p.firstSentenceMs ?? null,
        tokensOutput:    p.tokensOutput    ?? p.tokenCount ?? null,
        tokensInput:     p.tokensInput     ?? null,
        sentenceCount:   p.sentenceCount   ?? null,
        wasPartial:      p.wasPartial      ?? false,
        provider:        p.provider        || null,
      };
    }

    // ── PFUQ STATE (PFUQ_SCRABENGINE_BYPASSED or CONSENT_LOOP_PFUQ_SET) ──────
    // Bypassed = an active PFUQ question caused ScrabEngine to be skipped this turn.
    // Newly set = LLM Intake installed a new pending question for the next turn.
    const pfuqBypassed    = traceByKind.get(`${turnNum}:PFUQ_SCRABENGINE_BYPASSED`);
    const consentPfuqSet  = traceByKind.get(`${turnNum}:CONSENT_LOOP_PFUQ_SET`);
    if (pfuqBypassed?.payload || consentPfuqSet?.payload) {
      const pb = pfuqBypassed?.payload;
      const cp = consentPfuqSet?.payload;
      turnData.pfuqState = {
        type:     pb ? 'BYPASSED' : 'NEWLY_SET',
        question: ((pb?.question || cp?.question) || '').substring(0, 120),
        reason:   pb?.reason  || null,
        source:   cp?.source  || null,
        setTurn:  cp?.turn    ?? null,
      };
    }

    // ── GHOST TURN / STT EMPTY details ────────────────────────────────────────
    // Ghost = bridge empty turn while PFUQ was pending — question preserved.
    // STT_EMPTY = caller was silent / timed out — protocol engaged.
    const pfuqGhost  = traceByKind.get(`${turnNum}:PFUQ_GHOST_TURN_SKIPPED`);
    const sttEmpty   = traceByKind.get(`${turnNum}:STT_EMPTY_PROTOCOL_ENGAGED`);
    if (pfuqGhost?.payload || sttEmpty?.payload) {
      const pg = pfuqGhost?.payload;
      const se = sttEmpty?.payload;
      turnData.ghostTurnInfo = {
        type:              pg ? 'PFUQ_GHOST' : 'STT_EMPTY',
        reason:            pg?.reason || se?.reason || 'Empty STT input',
        preservedQuestion: pg?.question     || null,
        pfuqTurn:          pg?.pfuqTurn     ?? null,
        isSilence:         se?.isSilence    ?? null,
        isTimeout:         se?.isTimeout    ?? null,
      };
    }

    // ── TURN OUTCOME (computed last — depends on all fields above) ────────────
    turnData.turnOutcome = (() => {
      if (turnData.ghostTurnInfo?.type === 'PFUQ_GHOST') return 'GHOST_SKIPPED';
      if (turnData.ghostTurnInfo?.type === 'STT_EMPTY')  return 'STT_EMPTY';

      // ── TURN1ENGINE lane outcomes ─────────────────────────────────────────
      // Checked before booking/KC — Turn1Engine always owns turn 1 when enabled.
      // discoveryWirePath='TURN1_ENGINE' OR ownerSelected='TURN1_ENGINE' either confirms.
      if (turnData.discoveryWirePath === 'TURN1_ENGINE' ||
          turnData.ownerSelected     === 'TURN1_ENGINE') {
        if (turnData.turn1Disabled) return 'TURN1_DISABLED';
        const lane = turnData.turn1Engine?.lane;
        if (lane === 'SIMPLE_GREETING')    return 'TURN1_SIMPLE_GREETING';
        if (lane === 'RETURNING_CALLER')   return 'TURN1_RETURNING_CALLER';
        if (lane === 'CALLER_WITH_INTENT') return 'TURN1_CALLER_WITH_INTENT';
        if (lane === 'DIDNT_UNDERSTAND')   return 'TURN1_DIDNT_UNDERSTAND';
        return 'TURN1_ENGINE';   // Turn1 fired but lane not yet captured
      }

      // ── BOOKING ENGINE lane outcomes (most specific — checked first) ──
      // Digressions route through KC (stateless) — no trigger or LLM paths.
      if (turnData.bookingStep) {
        if (turnData.bookingStep.isComplete)               return 'BOOKING_COMPLETE';
        const rp = turnData.routingTier?.path;
        if (rp === 'BK_KC_DIGRESSION')                    return 'BOOKING_KC_DIGRESSION';
        if (rp === 'BK_KC_DIGRESSION_NO_MATCH')           return 'BOOKING_KC_NO_MATCH';
        // Legacy BPFUQ outcomes from old call data
        if (rp === 'BK_BPFUQ_NO_MATCH')                   return 'BOOKING_KC_NO_MATCH';
        if (rp === 'BK_BPFUQ_RESUME')                     return 'BOOKING_STEP';
        if (rp === 'BK_BPFUQ_REASK')                      return 'BOOKING_STEP';
        return 'BOOKING_STEP';
      }

      const src = turnData.routingTier?.source;
      if (src === 'KC_ENGINE') {
        if (turnData.kcEngine?.llmFallback) return 'KC_LLM_FALLBACK';
        if (turnData.kcEngine?.gracefulAck) return 'GRACEFUL_ACK';
        if (turnData.routingTier?.path === 'KC_BOOKING_INTENT') return 'BOOKING_HANDOFF';
        return 'KC_ANSWERED';
      }
      const llmMode = turnData.llmAgentCall?.mode;
      if (llmMode === 'TIER_2_INTAKE')       return 'INTAKE';
      if (llmMode === 'TIER_2_NO_MATCH')     return 'LLM_ANSWERED';
      if (llmMode === 'TIER_2_FOLLOW_UP')    return 'LLM_ANSWERED';
      if (llmMode === 'STT_EMPTY_RECOVERY')  return 'STT_EMPTY';
      if (turnData.intakeExtraction)         return 'INTAKE';
      if (turnData.triggerEvaluation?.matched) return 'TRIGGER_ANSWERED';
      const verdict = turnData.turnVerdict || '';
      if (verdict.includes('BOOKING_ENGINE')) return 'BOOKING_HANDOFF';
      if (turnData.agentResponse?.source?.toLowerCase().includes('fallback')) return 'GRACEFUL_ACK';
      if (turnData.traceOnly) return 'TRACE_ONLY';
      return 'UNKNOWN';
    })();

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

  const flow = buildTurnByTurnFlow(turns, trace);

  // Aggregate outcome counts for overview summary bar
  const turnOutcomeCounts = {};
  for (const step of flow) {
    const o = step.turnOutcome || 'UNKNOWN';
    turnOutcomeCounts[o] = (turnOutcomeCounts[o] || 0) + 1;
  }

  return {
    transcript: buildTranscript(turns),
    response: buildResponseContext(trace),
    scrabEngineHandoff: scrabHandoff?.payload || null,
    greeting: buildGreeting(turns),
    turnByTurnFlow: flow,
    turnOutcomeCounts,
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
 * Build a human-readable auto-diagnostic summary from trace data alone.
 * Used for trace_only calls where GPT-4 analysis has not run yet.
 * Returns { executiveSummary, topIssue, issues }.
 */
function buildAutoSummary(callContext) {
  const flow    = callContext.turnByTurnFlow || [];
  const txScript = callContext.transcript    || [];

  const lines  = [];
  const issues = [];

  // ── Intake extraction ──────────────────────────────────────────────────────
  const intakeTurn       = flow.find(t => t.intakeExtraction);
  const firstName        = intakeTurn?.intakeExtraction?.entities?.firstName;
  const callReason       = intakeTurn?.intakeExtraction?.callReason;
  const urgency          = intakeTurn?.intakeExtraction?.urgency;
  const priorVisit       = intakeTurn?.intakeExtraction?.priorVisit;
  const sameDayRequested = intakeTurn?.intakeExtraction?.sameDayRequested;
  const nextLane         = intakeTurn?.intakeExtraction?.nextLane;

  // Caller + reason narrative
  if (firstName || callReason) {
    let intro = firstName ? `${firstName} called` : 'Caller';
    if (callReason) intro += ` about: ${callReason}`;
    if (urgency === 'high') intro += ' [HIGH URGENCY]';
    if (priorVisit)        intro += '. Prior visit on record.';
    if (sameDayRequested)  intro += ' Same-day service requested.';
    lines.push(intro + '.');
  }

  // ── KC containers accessed ─────────────────────────────────────────────────
  const kcTurns      = flow.filter(t => t.kcEngine);
  const kcContainers = [...new Set(kcTurns.map(t => t.kcEngine.containerTitle).filter(Boolean))];
  if (kcTurns.length > 0) {
    lines.push(
      `KC engine answered ${kcTurns.length} question${kcTurns.length > 1 ? 's' : ''} ` +
      `from container: "${kcContainers.join('", "')}".`
    );
  }

  // ── Routing distribution ───────────────────────────────────────────────────
  // Uses DiscoveryWire / KCDiscoveryRunner path data (UAP-era architecture).
  const realTurns      = flow.filter(t => !t.traceOnly);
  const greetingTurns  = realTurns.filter(t => t.turnVerdict === 'GREETING' || t.sourceKey === 'GREETING');
  const kcDirectTurns  = realTurns.filter(t => t.kcEngine?.path === 'KC_DIRECT_ANSWER' || (t.kcEngine?.path && !t.kcEngine.llmFallback && !t.kcEngine.gracefulAck));
  const kcLlmTurns     = realTurns.filter(t => t.kcEngine?.llmFallback);
  const kcAckTurns     = realTurns.filter(t => t.kcEngine?.gracefulAck);
  const routeParts     = [];
  if (greetingTurns.length) routeParts.push(`${greetingTurns.length} greeting`);
  if (kcDirectTurns.length) routeParts.push(`${kcDirectTurns.length} KC answered`);
  if (kcLlmTurns.length)    routeParts.push(`${kcLlmTurns.length} LLM fallback`);
  if (kcAckTurns.length)    routeParts.push(`${kcAckTurns.length} graceful ACK`);
  if (routeParts.length) lines.push(`Routing: ${routeParts.join(', ')}.`);

  // ── Ghost / empty turns ────────────────────────────────────────────────────
  const ghostCount = txScript.filter(t => t.kind === 'GHOST_TURN_SKIPPED').length;
  if (ghostCount > 0) {
    issues.push(`${ghostCount} empty STT turn${ghostCount > 1 ? 's' : ''} silently skipped by ghost guard`);
  }

  // ── Booking status ─────────────────────────────────────────────────────────
  if (nextLane === 'BOOKING_HANDOFF') {
    const bookingCompleted = flow.some(t => t.kcEngine?.bookingFired);
    if (!bookingCompleted) {
      issues.push('Booking handoff was expected (nextLane=BOOKING_HANDOFF) but no booking was completed — call may have ended prematurely');
    }
  }

  // ── LLM fallbacks inside KC ────────────────────────────────────────────────
  const llmFallbacks = kcTurns.filter(t => t.kcEngine?.llmFallback).length;
  if (llmFallbacks > 0) {
    issues.push(`KC fell back to LLM ${llmFallbacks} time${llmFallbacks > 1 ? 's' : ''} (Groq could not answer directly)`);
  }

  // ── Assemble ───────────────────────────────────────────────────────────────
  let summary = lines.join(' ');
  if (!summary) summary = 'Call completed — no intake extraction available.';
  if (issues.length > 0) summary += ` Diagnostic flags: ${issues.join('; ')}.`;

  const topIssue = issues.length > 0 ? issues[0]
    : (nextLane === 'BOOKING_HANDOFF' ? 'Awaiting booking completion'
    : kcContainers.length > 0        ? `KC: ${kcContainers[0]}`
    : 'No issues detected');

  return { executiveSummary: summary, topIssue, autoIssues: issues };
}

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
      const autoSummary = buildAutoSummary(callContext);
      return res.json({
        success: true,
        intelligence: {
          callSid,
          companyId: transcript?.companyId || summary?.companyId || null,
          status: 'trace_only',
          executiveSummary: autoSummary.executiveSummary,
          topIssue: autoSummary.topIssue,
          issueCount: autoSummary.autoIssues.length,
          criticalIssueCount: 0,
          issues: autoSummary.autoIssues.map(msg => ({ title: msg, severity: 'medium', category: 'auto_diagnostic' })),
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
 * GET /api/call-intelligence/company/:companyId/stats
 * Dashboard stats bar — reads CallSummary (all calls) + CallIntelligence (analyzed calls).
 *
 * Apr 22, 2026 — honour ?timeRange=today|week|month on the stat cards
 * that the UI presents as "in range" (critical / needs / performing / avgCost
 * / analyzedCount). todayCount/weekCount remain fixed-window counters,
 * totalAllTime preserves backward compat for anything still reading `total`.
 *
 * Returns:
 *   todayCount, weekCount       — fixed windows (today / last 7d)
 *   totalAllTime                — all-time CallSummary count (prior `total`)
 *   analyzedCount               — CallIntelligence count inside timeRange
 *                                  (this is what "TOTAL ANALYZED" means)
 *   critical / needsImprovement / performingWell / avgCost — in timeRange
 *   timeRange                   — echoed back so UI can verify
 */
router.get('/company/:companyId/stats', async (req, res) => {
  try {
    const { companyId } = req.params;
    const { timeRange } = req.query;
    const companyOid = mongoose.Types.ObjectId.isValid(companyId)
      ? new mongoose.Types.ObjectId(companyId)
      : companyId;

    const now = new Date();
    const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0);
    const weekStart  = new Date(now); weekStart.setDate(now.getDate() - 7);

    // buildCallSummaryDateRange returns { startedAt: { $gte, $lte } } for CallSummary.
    // For the CallIntelligence aggregate we need the same window but on `analyzedAt`.
    const summaryRange = buildCallSummaryDateRange(timeRange);
    const intelRange   = summaryRange.startedAt
      ? { analyzedAt: { $gte: summaryRange.startedAt.$gte, $lte: summaryRange.startedAt.$lte } }
      : {};

    const [todayCount, weekCount, totalAllTime, analyzedCount, intelStats] = await Promise.all([
      CallSummary.countDocuments({ companyId: companyOid, startedAt: { $gte: todayStart } }),
      CallSummary.countDocuments({ companyId: companyOid, startedAt: { $gte: weekStart } }),
      CallSummary.countDocuments({ companyId: companyOid }),
      CallIntelligence.countDocuments({ companyId: companyId.toString(), ...intelRange }),
      CallIntelligence.aggregate([
        { $match: { companyId: companyId.toString(), ...intelRange } },
        { $group: {
          _id: null,
          critical:         { $sum: { $cond: [{ $eq: ['$status', 'critical'] }, 1, 0] } },
          needsImprovement: { $sum: { $cond: [{ $eq: ['$status', 'needs_improvement'] }, 1, 0] } },
          performingWell:   { $sum: { $cond: [{ $eq: ['$status', 'performing_well'] }, 1, 0] } },
          avgCost:          { $avg: '$analysis.totalCost' }
        }}
      ])
    ]);

    const intel = intelStats[0] || {};
    res.json({
      ok: true,
      todayCount,
      weekCount,
      totalAllTime,
      // Backward compat: `total` used to mean all-time CallSummary. Keep it
      // so anything old still works, but the frontend should move to
      // `analyzedCount` for the "TOTAL ANALYZED" card since that's what
      // actually corresponds to the stat cards below it (which filter by
      // timeRange via CallIntelligence).
      total: totalAllTime,
      analyzedCount,
      critical:         intel.critical         || 0,
      needsImprovement: intel.needsImprovement || 0,
      performingWell:   intel.performingWell   || 0,
      avgCost:          intel.avgCost          ?? null,
      timeRange:        timeRange || 'all'
    });
  } catch (err) {
    console.error('[call-intelligence stats]', err.message);
    res.status(500).json({ ok: false, error: err.message });
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

    // Apr 22, 2026 — returns the honest count for the requested timeRange.
    // Previously this fell back to "companyId only" when the range was empty,
    // which caused the flickering-UX bug (list appears to randomly show/hide
    // calls between refreshes when the range is narrow). The UI now renders
    // a proper empty state when totalSummaries === 0 and timeRange is set.
    const [summaries, totalSummaries] = await Promise.all([
      CallSummary.find(summaryQuery)
        .sort({ startedAt: -1 })
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .select('callId twilioSid startedAt endedAt phone toPhone durationSeconds turnCount routingTier events turns hasRecording recordingUrl recordingSid recordingDuration sttProvider')
        .lean(),
      CallSummary.countDocuments(summaryQuery)
    ]);

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
        routingTier: summary.routingTier || null,
        // C6 — which STT pipeline ran this call. Null = legacy / gather.
        sttProvider: summary.sttProvider || null
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

// ═══════════════════════════════════════════════════════════════════════════
// ENTERPRISE FULL REPORT  —  GET /:callSid/full-report?companyId=X
// Assembles all 8 sections from CallSummary, CallTranscriptV2,
// CallIntelligence, Customer.discoveryNotes, and KC cards in one pass.
// ═══════════════════════════════════════════════════════════════════════════

const Customer = require('../../models/Customer');
const CompanyKnowledgeContainer = require('../../models/CompanyKnowledgeContainer');

// ── helpers ──────────────────────────────────────────────────────────────

function fmtElapsed(startedAt, ts) {
  if (!startedAt || !ts) return null;
  const diffMs = new Date(ts).getTime() - new Date(startedAt).getTime();
  if (diffMs < 0) return '00:00';
  const secs = Math.floor(diffMs / 1000);
  const m = String(Math.floor(secs / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function fmtDuration(seconds) {
  if (!seconds) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

// ── Per-turn STT provider inference ──────────────────────────────────────
// Caller turns carry `trace.inputTextSource` written by whichever pipeline
// transcribed the utterance:
//
//   'deepgram_live'     — Media Streams path (MediaStreamServer._runTurn)
//   'deepgram_fallback' — DeepgramFallback rescue on low-confidence Gather
//   'speechResult'      — Twilio <Gather speechModel="auto"> (default)
//   null / undefined    — legacy transcripts before the field existed
//
// The UI uses this to render a green DEEPGRAM pill on caller rows whenever
// Deepgram did the STT — giving an at-a-glance view of which specific turns
// benefited from Nova-3 acoustic quality vs Twilio's managed STT.
function derivePerTurnSttProvider(turn) {
  if (!turn || turn.speaker !== 'caller') return null;
  const src = turn?.trace?.inputTextSource;
  if (src === 'deepgram_live')     return 'deepgram-live';
  if (src === 'deepgram_fallback') return 'deepgram-fallback';
  if (src === 'speechResult')      return 'gather';
  // null / undefined / unknown → leave unset so the UI can hide the pill
  // rather than assert a provider we aren't sure about.
  return null;
}

// ── Source key → provenanceType inference ──────────────────────────────────
// When trace.provenance.type is absent from the transcript (older calls, or
// paths that don't write it explicitly), infer from the sourceKey.
// KC_ENGINE is UI_OWNED by default; GRACEFUL_ACK/BOOKING_INTENT overrides
// to HARDCODED below in buildConversationTurns (those are canned scripts).
const _SOURCE_TYPE_MAP = {
  // ── Current (DiscoveryWire / KCDiscoveryRunner era) ──────────────────────
  'TURN1_ENGINE':         'ENGINE_COMPOSED', // Turn1Engine — rule-composed first-turn greeting/ack
  'GREETING':             'UI_OWNED',        // Agent2GreetingInterceptor — admin-authored greeting
  'KC_ENGINE':            'UI_OWNED',        // KC Answer Engine (authored KC cards)
  'BOOKING_LOGIC_ENGINE': 'HARDCODED',       // Booking flow collection prompts (scripted)
  'greetings':            'UI_OWNED',        // Admin-authored greeting text (config key)
  'TRIGGER_AUDIO':        'UI_OWNED',        // Instant audio trigger responses
  // ── Legacy — Agent2DiscoveryRunner era (backward compat for old transcripts) ──
  'AGENT2_DISCOVERY':     'LLM_GENERATED',
};

// ── KC attribution helper ─────────────────────────────────────────────────
// Matches any turn where KC authored content was delivered — either directly
// from KC_ENGINE or via a booking KC digression (BookingLogicEngine → KC).
function _isKCAnswered(t) {
  if (t.provenanceType === 'UI_OWNED' && t.sourceKey === 'KC_ENGINE') return true;
  if (t.provenanceType === 'UI_OWNED' && t.provenancePath === 'BK_KC_DIGRESSION') return true;
  return false;
}

// Canned KC paths that produce hardcoded text (not KC card content)
const _HARDCODED_KC_PATHS = new Set([
  'KC_GRACEFUL_ACK',    // "I'll have someone follow up with you"
  'KC_BOOKING_INTENT',  // "Great! Let me get that scheduled for you."
]);

// ── Answer-mode classifier ────────────────────────────────────────────────
// Returns one of the 4 canonical answer modes that can generate agent speech,
// or null for deterministic scripts / transfer / unclassified.
//
//   'uap-text'   → KC direct hit, Fixed content delivered as TTS (no audio cache)
//   'uap-audio'  → KC direct hit, pre-cached audio file served (no TTS)
//   'groq'       → KC content reshaped by Groq formatter (BK_KC_DIGRESSION or groq-path)
//   'llm-agent'  → Claude answer-from-kb (Turn 1 intake + KC_LLM_FALLBACK)
//
// Signals used:
//   • TWIML system turn (kind=TWIML_PLAY → cached audio served; kind=TWIML_SAY → TTS)
//     — ground truth written in v2twilio.js for every agent turn.
//   • kcTrace.groqLatencyMs / groqIntent — Groq formatter ran.
//   • flags LLM_FALLBACK + provPath KC_LLM_FALLBACK — Claude answered.
//
// No heuristics on prov.audioUrl — that field is set from many sources and is
// not a reliable per-turn audio-served signal. If the explicit signals are
// missing, we return the base mode ('uap' generic) rather than guess.
function classifyAnswerMode({ speaker, turnNumber, provPath, sourceKey, flags, kcTrace, audioServed }) {
  if (speaker !== 'agent') return null;

  // Scripts + transfer + unknowns are NOT LLM-generated — return null.
  if (_HARDCODED_KC_PATHS.has(provPath)) return null;
  if (sourceKey === 'BOOKING_LOGIC_ENGINE' && provPath !== 'BK_KC_DIGRESSION') return null;
  if (sourceKey === 'TRANSFER_ENGINE') return null;

  // LLM Agent — Turn 1 + explicit LLM fallback
  const hasLLMFallback = (flags || []).some(f => f.code === 'LLM_FALLBACK');
  if (turnNumber === 1) return 'llm-agent';
  if (hasLLMFallback) return 'llm-agent';
  if (provPath === 'KC_LLM_FALLBACK') return 'llm-agent';

  // Groq — booking KC digression goes through KnowledgeContainerService.answer() (Groq formatter),
  // or explicit groq signal on the trace.
  if (provPath === 'BK_KC_DIGRESSION') return 'groq';
  if (kcTrace?.groqLatencyMs || kcTrace?.groqIntent === 'answered') return 'groq';

  // UAP hit — use TWIML system-turn ground truth (only reliable audio signal).
  if (provPath === 'KC_DIRECT_ANSWER') {
    if (audioServed === true) return 'uap-audio';
    if (audioServed === false) return 'uap-text';
    return 'uap';  // signal unavailable — don't guess text vs audio
  }

  return null; // unclassified — don't guess
}

function provenanceLabel(type, sourceKey, provPath) {
  // 0. Turn1Engine — lane-specific labels (provPath carries the _exitReason)
  //    sourceKey === 'TURN1_ENGINE' for all 4 lanes.
  if (sourceKey === 'TURN1_ENGINE') {
    if (provPath === 'TURN1_SIMPLE_GREETING')    return 'Turn 1 — Simple Greeting';
    if (provPath === 'TURN1_RETURNING_CALLER')   return 'Turn 1 — Returning Caller';
    if (provPath === 'TURN1_CALLER_WITH_INTENT') return 'Turn 1 — Intent + KC';
    if (provPath === 'TURN1_DIDNT_UNDERSTAND')   return 'Turn 1 — Didn\'t Understand';
    return 'Turn 1 Engine';
  }

  // 1. Path-specific overrides (most precise — canned KC scripts)
  if (provPath === 'KC_BOOKING_INTENT') return 'Booking Intent Script';
  if (provPath === 'KC_GRACEFUL_ACK')   return 'Fallback Acknowledgment';

  // 2. Source-key overrides — more descriptive than generic type labels.
  //    MUST come before type checks because BOOKING_LOGIC_ENGINE maps to
  //    'HARDCODED' in _SOURCE_TYPE_MAP, which would catch it first otherwise.
  if (sourceKey === 'BOOKING_LOGIC_ENGINE') return 'Booking Flow Script';
  if (sourceKey === 'GREETING')             return 'Greeting';
  if (sourceKey === 'greetings')            return 'Greeting';

  // 3. Type-based labels
  if (type === 'UI_OWNED')        return 'KC / Trigger';
  if (type === 'ENGINE_COMPOSED') return 'Engine Composed';
  if (type === 'LLM_GENERATED')   return 'LLM Generated';
  if (type === 'HARDCODED')       return 'Hardcoded';

  // 4. Final fallbacks by sourceKey
  if (sourceKey === 'AGENT2_DISCOVERY') return 'LLM Generated';    // legacy only
  if (sourceKey === 'KC_ENGINE')        return 'KC Answer Engine';
  return 'Unknown';
}

function detectTurnFlags(turn, kcCard, provenancePath, sourceKey) {
  const flags = [];
  const path = (provenancePath || '').toUpperCase();
  const src  = (sourceKey || '').toUpperCase();

  if (path.includes('LLM_FALLBACK') || path.includes('LLM_AGENT')) {
    flags.push({ code: 'LLM_FALLBACK', label: 'LLM Fallback', severity: 'warn' });
  }
  if (kcCard?.bookingAction === 'offer_to_book' && !path.includes('BOOKING')) {
    flags.push({ code: 'MISSED_BOOKING_CTA', label: 'Missed Booking CTA', severity: 'warn' });
  }
  // KC_GRACEFUL_ACK means no KC card AND no LLM — knowledge gap
  if (path === 'KC_GRACEFUL_ACK') {
    flags.push({ code: 'KC_GRACEFUL_ACK', label: 'No KC Match — Canned ACK', severity: 'warn' });
  }
  // Booking CTA was delivered but no booking was created (caller didn't commit)
  if (path === 'KC_BOOKING_INTENT') {
    flags.push({ code: 'BOOKING_INTENT_FIRED', label: 'Booking Intent Detected', severity: 'info' });
  }
  return flags;
}

function calcHealthScore(summary, convTurns, discoveryNotes) {
  let score = 100;

  // Outcome (−20 max)
  const outcome = summary?.outcome;
  if (outcome === 'error') score -= 20;
  else if (outcome === 'abandoned') score -= 15;
  else if (outcome === 'in_progress') score -= 10;

  // Booking created = bonus (cap at 100)
  if (summary?.appointmentCreatedId) score = Math.min(100, score + 5);

  // LLM fallback rate (−20 max): each fallback turn −4
  const fallbackTurns = convTurns.filter(t =>
    (t.provenancePath || '').toUpperCase().includes('LLM_FALLBACK') ||
    (t.provenancePath || '').toUpperCase().includes('LLM_AGENT')
  ).length;
  score -= Math.min(20, fallbackTurns * 4);

  // Discovery completeness (−25 max)
  if (discoveryNotes) {
    if (!discoveryNotes.entities?.firstName && !discoveryNotes.entities?.fullName) score -= 10;
    if (!discoveryNotes.callReason) score -= 10;
    if (!discoveryNotes.entities?.address && !summary?.capturedSummary?.addressCaptured) score -= 5;
  } else {
    // No discovery notes — partial deduction
    score -= 10;
  }

  // Missed booking CTAs (−5 each, max −15)
  const missedBooking = convTurns.filter(t =>
    t.flags?.some(f => f.code === 'MISSED_BOOKING_CTA')
  ).length;
  score -= Math.min(15, missedBooking * 5);

  // Twilio errors (−30, critical infrastructure failure)
  if (summary?.callLifecycle?.twilioErrors?.length > 0) {
    score -= 30;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function buildHeader(callSid, companyId, summary, healthScore, hasIntelligence, convTurns) {
  return {
    callSid,
    companyId,
    callerName: summary?.capturedSummary?.name || summary?.callerName || null,
    phone: summary?.phone || null,
    isReturning: summary?.isReturning || false,
    startedAt: summary?.startedAt || null,
    durationSeconds: summary?.durationSeconds || 0,
    durationFormatted: fmtDuration(summary?.durationSeconds),
    turnCount: summary?.turnCount || convTurns?.length || 0,  // fallback to transcript if CallSummary not incremented (e.g. crash)
    outcome: summary?.outcome || 'unknown',
    outcomeDetail: summary?.outcomeDetail || null,
    routingTier: summary?.routingTier || null,
    totalCost: summary?.llmCost || 0,
    llmModel: summary?.llmModel || null,
    healthScore,
    hasIntelligence,
    recordingUrl: summary?.recordingUrl || null,
    hasRecording: !!summary?.recordingUrl
  };
}

function buildStory(summary, discoveryNotes, convTurns, intelligence) {
  if (intelligence?.executiveSummary) {
    return { text: intelligence.executiveSummary, source: 'gpt4' };
  }

  // Auto-generate from available data
  const parts = [];
  const name = summary?.capturedSummary?.name || summary?.callerName;
  const reason = summary?.capturedSummary?.problemSummary || discoveryNotes?.callReason;
  const urgency = summary?.capturedSummary?.urgency || discoveryNotes?.urgency;
  const outcome = summary?.outcome;
  const turns = summary?.turnCount || convTurns.length;

  if (name) parts.push(`${name} called`);
  else parts.push('A caller called');
  if (summary?.startedAt) {
    const d = new Date(summary.startedAt);
    parts[0] += ` at ${d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;
  }
  if (reason) parts[0] += ` about: "${reason}"`;
  if (urgency === 'high' || urgency === 'urgent' || urgency === 'emergency') {
    parts.push(`Urgency was marked ${urgency.toUpperCase()}.`);
  }

  const kcTurns = convTurns.filter(t => t.provenanceType === 'UI_OWNED' && t.kcCard).length;
  const llmTurns = convTurns.filter(t =>
    (t.provenancePath || '').toUpperCase().includes('LLM')
  ).length;

  if (kcTurns > 0) parts.push(`${kcTurns} turn${kcTurns > 1 ? 's' : ''} were handled by KC cards.`);
  if (llmTurns > 0) parts.push(`${llmTurns} turn${llmTurns > 1 ? 's' : ''} required LLM fallback — responses may not reflect authored policy.`);

  if (outcome === 'completed' && summary?.appointmentCreatedId) {
    parts.push('Call ended with a booking confirmed.');
  } else if (outcome === 'transferred') {
    parts.push('Call ended with a transfer.');
  } else if (outcome === 'abandoned') {
    parts.push('Caller disconnected before resolution.');
  } else if (outcome === 'completed') {
    parts.push(`Call completed in ${turns} turns without a booking.`);
  }

  const hasMissedBooking = convTurns.some(t => t.flags?.some(f => f.code === 'MISSED_BOOKING_CTA'));
  if (hasMissedBooking) {
    parts.push('At least one KC card had bookingAction=offer_to_book — the booking CTA was not delivered.');
  }

  return { text: parts.join(' '), source: 'auto' };
}

function buildVitals(summary, convTurns, discoveryNotes) {
  const agentTurns = convTurns.filter(t => t.speaker === 'agent');
  const totalAgentTurns = agentTurns.length || 1;
  // KC hit = agent turn where KC answered from an authored card (direct or booking digression)
  const kcTurns = agentTurns.filter(t => _isKCAnswered(t)).length;
  // LLM fallback = Turn 2+ agent turns where KC couldn't answer and fell to Claude.
  // Turn 1 is always LLM (intake/greeting) — exclude it from the fallback count.
  const llmTurns = agentTurns.filter(t =>
    t.turnNumber > 1 && (
      (t.provenancePath || '').toUpperCase().includes('LLM_FALLBACK') ||
      (t.provenancePath || '').toUpperCase().includes('KC_LLM_FALLBACK')
    )
  ).length;
  const kcHitRate = Math.round((kcTurns / totalAgentTurns) * 100);

  const objective = discoveryNotes?.objective || null;
  const stagesReached = [];
  if (discoveryNotes?.entities?.firstName || discoveryNotes?.entities?.fullName) stagesReached.push('INTAKE');
  if (discoveryNotes?.callReason) stagesReached.push('DISCOVERY');
  if (objective === 'BOOKING' || summary?.appointmentCreatedId) stagesReached.push('BOOKING');
  if (summary?.outcome === 'completed') stagesReached.push('CLOSING');

  const complianceScore = stagesReached.length > 0
    ? Math.round((stagesReached.length / 4) * 100)
    : null;

  return {
    metrics: [
      {
        label: 'Protocol Compliance',
        value: complianceScore !== null ? `${complianceScore}%` : 'N/A',
        sub: stagesReached.length > 0 ? `${stagesReached.join(' → ')}` : 'No discovery data',
        status: complianceScore === null ? 'unknown' : complianceScore >= 90 ? 'ok' : complianceScore >= 60 ? 'warn' : 'fail'
      },
      {
        label: 'KC Hit Rate',
        value: `${kcHitRate}%`,
        sub: `${kcTurns} of ${totalAgentTurns} agent turns`,
        status: kcHitRate >= 70 ? 'ok' : kcHitRate >= 40 ? 'warn' : 'fail'
      },
      {
        label: 'LLM Fallback Turns',
        value: llmTurns,
        sub: llmTurns > 0 ? `${Math.round(llmTurns / (totalAgentTurns || 1) * 100)}% of turns` : 'None',
        status: llmTurns === 0 ? 'ok' : llmTurns <= 2 ? 'warn' : 'fail'
      },
      {
        label: 'Outcome',
        value: (summary?.outcome || 'unknown').replace('_', ' '),
        sub: summary?.outcomeDetail || '',
        status: (summary?.outcome === 'completed' || summary?.outcome === 'callback_requested') ? 'ok' :
          summary?.outcome === 'transferred' ? 'warn' : 'fail'
      },
      {
        label: 'Booking Created',
        value: summary?.appointmentCreatedId ? 'Yes' : 'No',
        sub: summary?.appointmentCreatedId ? 'Appointment scheduled' : 'No booking',
        status: summary?.appointmentCreatedId ? 'ok' : 'neutral'
      },
      {
        label: 'First Contact Resolution',
        value: (summary?.outcome === 'completed' && !summary?.followUpRequired) ? 'Yes' : 'No',
        sub: summary?.followUpRequired ? 'Follow-up required' : '',
        status: (summary?.outcome === 'completed' && !summary?.followUpRequired) ? 'ok' : 'warn'
      },
      {
        label: 'Total Call Cost',
        value: `$${(summary?.llmCost || 0).toFixed(4)}`,
        sub: summary?.llmModel || '',
        status: (summary?.llmCost || 0) < 0.15 ? 'ok' : (summary?.llmCost || 0) < 0.30 ? 'warn' : 'fail'
      }
    ]
  };
}

function buildProtocolAudit(summary, transcriptV2, convTurns, discoveryNotes, company) {
  const startedAt = transcriptV2?.callMeta?.startedAt || summary?.startedAt;

  // Read the ACTUAL stored speechTimeout from company config (no more hardcoded strings)
  // CANONICAL UI SAVE PATH: aiAgentSettings.speechDetection (v2companyConfiguration.js L2703-2705)
  // Legacy fallbacks: agent2.speechDetection → voiceSettings.speechDetection
  // Mirrors _getSpeechDetection() in routes/v2twilio.js L137 — keep in sync.
  const speechDet =
    company?.aiAgentSettings?.speechDetection ||
    company?.aiAgentSettings?.agent2?.speechDetection ||
    company?.agent2?.speechDetection ||
    company?.aiAgentSettings?.voiceSettings?.speechDetection ||
    company?.voiceSettings?.speechDetection ||
    {};
  const speechTimeoutVal = (speechDet.speechTimeout !== undefined && speechDet.speechTimeout !== null)
    ? speechDet.speechTimeout
    : 'auto';
  // Numeric value used for EOS total estimate; fall back to Twilio's ~1.5s auto default
  const speechTimeoutNum = typeof speechTimeoutVal === 'number'
    ? speechTimeoutVal
    : (parseFloat(speechTimeoutVal) || 1.5);

  function stg(id, name, group, status, detail) {
    return { id, name, group, status, detail: detail || null };
  }

  const stages = [
    // GROUP A — Call Entry
    stg('twilio_inbound', 'Twilio Inbound Call', 'A',
      summary ? 'pass' : 'unknown', summary ? `CallSid: ${summary.callId || 'N/A'}` : null),
    stg('config_gate', 'Configuration Gate', 'A',
      summary?.outcome !== 'spam' ? 'pass' : 'fail',
      summary?.outcome === 'spam' ? 'Rejected: spam' : 'Company active'),
    stg('spam_filter', 'Spam / Caller ID Filter', 'A',
      summary?.outcome === 'spam' ? 'blocked' : 'pass',
      summary?.outcome === 'spam' ? 'Blocked by spam filter' : `${summary?.phone || 'N/A'} not flagged`),
    stg('greeting', 'Greeting Delivered', 'A',
      convTurns.length > 0 ? 'pass' : 'unknown',
      convTurns.length > 0 ? 'Call reached Turn 1' : 'No turns recorded'),
    stg('twilio_health', 'Twilio Webhook Health', 'A',
      (() => {
        const _te = transcriptV2?.trace || [];
        const errors = _te.filter(t => t.kind === 'TWILIO_ERROR').length;
        const atRisk = _te.filter(t => t.kind === 'WEBHOOK_TIMING' && t.payload?.atRisk).length;
        if (errors > 0) return 'fail';
        if (atRisk > 0) return 'warn';
        return 'pass';
      })(),
      (() => {
        const _te = transcriptV2?.trace || [];
        const errors = _te.filter(t => t.kind === 'TWILIO_ERROR').length;
        const timings = _te.filter(t => t.kind === 'WEBHOOK_TIMING');
        const atRisk = timings.filter(t => t.payload?.atRisk).length;
        const maxMs = timings.length > 0 ? Math.max(...timings.map(t => t.payload?.totalElapsedMs || 0)) : 0;
        if (errors > 0) return `${errors} Twilio error(s) captured via fallback URL`;
        if (atRisk > 0) return `${atRisk} turn(s) near timeout (max ${maxMs}ms, limit 15000ms)`;
        if (timings.length > 0) return `All webhooks healthy (max ${maxMs}ms)`;
        return 'No webhook timing data (pre-instrumentation)';
      })()),

    // GROUP B — Call Receipt
    stg('stt_gather', 'STT Gather (Deepgram)', 'B',
      convTurns.some(t => t.callerText) ? 'pass' : 'unknown',
      `speechTimeout=${speechTimeoutVal}s per turn (from UI)`),
    stg('eos_detection', 'End-of-Speech Detection', 'B',
      'info',
      `~${speechTimeoutNum.toFixed(1)}s VAD overhead × ${convTurns.length} turns = ~${(convTurns.length * speechTimeoutNum).toFixed(1)}s total`),
    stg('scrabengine', 'ScrabEngine', 'B',
      'bypassed', 'Intentionally bypassed — Groq handles natively'),

    // GROUP C — Turn 1
    stg('llm_intake', 'Turn 1 Entity Extraction', 'C',
      discoveryNotes ? 'pass' : 'unknown',
      (() => {
        if (!discoveryNotes) return 'No discovery data';
        const ent = discoveryNotes.entities || {};
        const found = [];
        if (ent.firstName)              found.push(`name=${ent.firstName}`);
        if (discoveryNotes.callReason)  found.push(`callReason=${discoveryNotes.callReason}`);
        if (discoveryNotes.urgency)     found.push(`urgency=${discoveryNotes.urgency}`);
        if (ent.employeeMentioned)      found.push(`employee=${ent.employeeMentioned}`);
        if (ent.callerType && ent.callerType !== 'CUSTOMER') found.push(`callerType=${ent.callerType}`);
        if (ent.priorVisit === true)    found.push('priorVisit=true');
        if (ent.sameDayRequested)       found.push('sameDayRequested=true');
        return found.length ? `Extracted: ${found.join(', ')}` : 'Extracted: nothing captured';
      })()),
    stg('response_gen', 'Turn 1 Response Generation', 'C',
      convTurns.length > 0 ? 'pass' : 'unknown',
      convTurns[0]?.agentText ? `Turn 1 delivered` : null),
    stg('first_sentence_tts', 'First Sentence → TTS', 'C',
      convTurns.length > 0 ? 'pass' : 'unknown', null),

    // GROUP D — Turn 2+
    stg('question_detector', 'Question Detector', 'D',
      convTurns.length > 1 ? 'pass' : 'unknown',
      convTurns.length > 1 ? `${convTurns.length - 1} follow-up turns processed` : null),
    stg('booking_intent', 'Booking Intent Gate', 'D',
      summary?.appointmentCreatedId ? 'pass' :
        (summary?.outcome === 'transferred' ? 'partial' : 'not_triggered'),
      summary?.appointmentCreatedId ? 'Booking intent detected → booking created' :
        'No booking intent detected in this call'),
    stg('kc_answer', 'KC Answer Engine', 'D',
      (() => {
        const hits = convTurns.filter(t => _isKCAnswered(t)).length;
        if (hits > 0) return 'pass';
        if (convTurns.length > 1) return 'warn';
        return 'unknown';
      })(),
      (() => {
        const hits = convTurns.filter(t => _isKCAnswered(t)).length;
        const misses = convTurns.filter(t =>
          t.provenancePath?.toUpperCase().includes('LLM_FALLBACK') ||
          t.provenancePath?.toUpperCase().includes('LLM_AGENT')
        ).length;
        return `${hits} KC hit${hits !== 1 ? 's' : ''}, ${misses} LLM fallback${misses !== 1 ? 's' : ''}`;
      })()),
    stg('groq_formatter', 'Groq Response Formatter', 'D',
      convTurns.some(t => _isKCAnswered(t)) ? 'pass' : 'unknown', null),

    // GROUP E — Behavior rules (Engine Hub nuked April 2026)
    stg('behavior_card_kc', 'Behavior Card — KC Linked', 'E',
      (() => {
        // KC card present + behavior card would be injected into Groq
        const kcTurns = convTurns.filter(t => _isKCAnswered(t) && t.kcCard).length;
        return kcTurns > 0 ? 'pass' : 'info';
      })(),
      'Category-linked BC injected into Groq prompt via KnowledgeContainerService.answer()'),

    stg('llm_behavior_rules', 'LLM Behavior Rules', 'E',
      (() => {
        // Flow-level behavior lives in aiAgentSettings.llmAgent.behaviorRules[]
        // injected by composeSystemPrompt on every LLM call.
        const llmTurns = convTurns.filter(t =>
          (t.provenancePath || '').toUpperCase().includes('LLM')
        ).length;
        return llmTurns > 0 ? 'pass' : 'info';
      })(),
      'Rendered by composeSystemPrompt() — edit in services.html Behavior tab')
  ];

  // Discovery compliance checklist
  const compliance = [];

  // INTAKE
  compliance.push({
    stage: 'INTAKE',
    check: 'Name captured',
    expected: 'Turn 1–2',
    actual: discoveryNotes?.entities?.firstName
      ? `Turn ${discoveryNotes?.qaLog?.[0]?.turn || '?'} — "${discoveryNotes.entities.firstName}"`
      : (summary?.capturedSummary?.name ? `"${summary.capturedSummary.name}"` : null),
    compliant: !!(discoveryNotes?.entities?.firstName || summary?.capturedSummary?.name),
    gap: (!discoveryNotes?.entities?.firstName && !summary?.capturedSummary?.name) ? 'Name never captured' : null
  });
  compliance.push({
    stage: 'INTAKE',
    check: 'Phone number',
    expected: 'Pre-call (CallerID)',
    actual: summary?.phone || 'From Twilio CallerID',
    compliant: true,
    gap: null
  });
  compliance.push({
    stage: 'INTAKE',
    check: 'Address captured',
    expected: 'Turn 1–2',
    actual: discoveryNotes?.entities?.address || (summary?.capturedSummary?.addressCaptured ? 'Yes' : null),
    compliant: !!(discoveryNotes?.entities?.address || summary?.capturedSummary?.addressCaptured),
    gap: (!discoveryNotes?.entities?.address && !summary?.capturedSummary?.addressCaptured) ? 'Address not captured' : null
  });

  // DISCOVERY
  compliance.push({
    stage: 'DISCOVERY',
    check: 'Call reason captured',
    expected: 'Turn 2–3',
    actual: discoveryNotes?.callReason || summary?.capturedSummary?.problemSummary || null,
    compliant: !!(discoveryNotes?.callReason || summary?.capturedSummary?.problemSummary),
    gap: (!discoveryNotes?.callReason && !summary?.capturedSummary?.problemSummary) ? 'Call reason not captured' : null
  });
  compliance.push({
    stage: 'DISCOVERY',
    check: 'Urgency assessed',
    expected: 'Turn 2–4',
    actual: discoveryNotes?.urgency || summary?.capturedSummary?.urgency || null,
    compliant: !!(discoveryNotes?.urgency || summary?.capturedSummary?.urgency),
    gap: (!discoveryNotes?.urgency && !summary?.capturedSummary?.urgency) ? 'Urgency never assessed' : null
  });

  // BOOKING
  compliance.push({
    stage: 'BOOKING',
    check: 'Booking CTA delivered',
    expected: 'When KC bookingAction=offer_to_book',
    actual: summary?.appointmentCreatedId ? 'Booking created' : null,
    compliant: !!summary?.appointmentCreatedId,
    gap: !summary?.appointmentCreatedId ? 'No booking created this call' : null
  });

  return { stages, compliance };
}

function buildCostBreakdown(summary, convTurns) {
  const total = summary?.llmCost || 0;
  const model = summary?.llmModel || 'unknown';
  const turnCount = convTurns.length || summary?.turnCount || 1;

  return {
    totalCost: total,
    totalCostFormatted: `$${total.toFixed(4)}`,
    perTurnAvg: turnCount > 0 ? total / turnCount : 0,
    perTurnAvgFormatted: `$${(turnCount > 0 ? total / turnCount : 0).toFixed(4)}`,
    model,
    note: 'Per-turn token breakdown requires runtime instrumentation (not yet persisted per turn). Showing call-level totals.'
  };
}

function buildConversationTurns(rawTurns, kcMap, discoveryNotes, startedAt) {
  // Show ALL meaningful turns in chronological order (sorted by turnNumber then ts).
  // We do NOT group caller+agent by turnNumber because the turn counter used for
  // the greeting (0), caller STT (1…N), and agent booking responses may differ.
  // Sequential display accurately reflects what was said and when.
  const convo = rawTurns
    .filter(t =>
      (t.speaker === 'caller' || t.speaker === 'agent') &&
      t.kind !== 'diagnostics' &&
      t.text?.trim()
    )
    .sort((a, b) => {
      // Primary: turnNumber ascending; secondary: ts ascending (handles same-turn ordering)
      const na = typeof a.turnNumber === 'number' ? a.turnNumber : 9999;
      const nb = typeof b.turnNumber === 'number' ? b.turnNumber : 9999;
      if (na !== nb) return na - nb;
      const ta = a.ts ? new Date(a.ts).getTime() : 0;
      const tb = b.ts ? new Date(b.ts).getTime() : 0;
      return ta - tb;
    });

  // ── TWIML audio-served lookup (ground truth per turn) ──
  // v2twilio.js writes a companion system turn for every agent turn:
  //   kind='TWIML_PLAY' → pre-cached audio was served (no TTS)
  //   kind='TWIML_SAY'  → TTS synthesized (no cached audio)
  // Map keyed by turnNumber → boolean (true=audio served, false=TTS).
  const audioServedByTurn = new Map();
  for (const t of rawTurns) {
    if (t.speaker !== 'system') continue;
    if (t.kind !== 'TWIML_PLAY' && t.kind !== 'TWIML_SAY') continue;
    if (typeof t.turnNumber !== 'number') continue;
    // First write wins (primary TWIML log for the turn); bridge logs come later.
    if (!audioServedByTurn.has(t.turnNumber)) {
      audioServedByTurn.set(t.turnNumber, t.kind === 'TWIML_PLAY');
    }
  }

  const result = [];
  let displayIndex = 0;

  for (const t of convo) {
    displayIndex++;
    const trace  = t.trace || {};
    const prov   = trace.provenance || {};
    // kcTrace: new UAP-era field. _123rp: legacy backward compat for existing transcripts.
    const kcTrace = trace.kcTrace || trace._123rp || {};

    const provPath = kcTrace.path || kcTrace.lastPath || prov.uiPath || t.sourceKey || null;
    const srcKey   = t.sourceKey || null;

    // Derive provenance type.
    //
    // The transcript frequently stores provenance.type = 'HARDCODED' as a
    // catch-all default, even for KC_ENGINE turns that answered from an authored
    // KC card. _SOURCE_TYPE_MAP corrects this per sourceKey; we override the stored
    // value when the sourceKey is a known UI_OWNED source and the stored type is
    // the generic HARDCODED default.
    const mappedType = _SOURCE_TYPE_MAP[t.sourceKey] || null;
    let provType;

    if (mappedType && (prov.type === 'HARDCODED' || !prov.type)) {
      // Transcript stored a generic HARDCODED — use the more accurate sourceKey map
      provType = mappedType;
    } else {
      // Explicit non-HARDCODED type in trace wins (LLM_GENERATED, UI_OWNED set at runtime)
      provType = prov.type
        || (t.kind === 'GREETING' ? 'UI_OWNED' : null)
        || mappedType
        || 'UNKNOWN';
    }

    // Exception: KC canned-script paths produce hardcoded text, not KC card content.
    // If the path is a known canned response, override back to HARDCODED regardless.
    if (_HARDCODED_KC_PATHS.has(provPath)) {
      provType = 'HARDCODED';
    }

    // KC card lookup from containerId or uiAnchor
    let kcCard = null;
    const containerId = kcTrace.containerId || prov.containerId;
    if (containerId && kcMap.has(containerId.toString())) {
      kcCard = kcMap.get(containerId.toString());
    }
    if (!kcCard && prov.uiAnchor) {
      for (const [, kc] of kcMap) {
        if (kc.kcId === prov.uiAnchor || kc._id.toString() === prov.uiAnchor) {
          kcCard = kc; break;
        }
      }
    }

    // Flags only make sense for agent turns
    const flags = t.speaker === 'agent'
      ? detectTurnFlags({ callerText: null, agentText: t.text }, kcCard, provPath, srcKey)
      : [];

    // Pass 2d — aggregate ALL qaLog entries for this turn, not just the first.
    // Frontend uses `qaEntry` for the Why? panel (backward compat) and `qaCosts`
    // for the per-turn cost rollup (Claude/Groq/ElevenLabs → Est. Cost card).
    const qaEntriesForTurn = Array.isArray(discoveryNotes?.qaLog)
      ? discoveryNotes.qaLog.filter(q => q.turn === t.turnNumber)
      : [];
    // Preserve original semantics: the first diagnostic entry is the "primary" qaEntry.
    // Skip pure-cost events (ELEVENLABS_TTS_CHARS) so Why? panel still shows the real diag.
    const qaEntry = qaEntriesForTurn.find(q => q.type !== 'ELEVENLABS_TTS_CHARS')
      || qaEntriesForTurn[0]
      || null;
    // Aggregate cost data from every qaLog entry for the turn.
    // Shape: { claudeUsd, groqUsd, elevenUsd, elevenChars, totalUsd, breakdown: [...] }
    const qaCosts = (() => {
      if (!qaEntriesForTurn.length) return null;
      let claudeUsd = 0, groqUsd = 0, elevenUsd = 0, elevenChars = 0;
      const breakdown = [];
      for (const q of qaEntriesForTurn) {
        const usd = q.cost?.usd;
        if (typeof usd !== 'number' || usd <= 0) continue;
        // `rate` is the per-event rate provenance stamp (tier + per-unit rate +
        // source 'company'|'env'|'default'). Forwarded to the frontend drawer so
        // each line can render "Sonnet 4.5 (enterprise) @ $2.50/M in (company)".
        const rate = q.cost?.rate || null;
        // Route by event type + model
        if (q.type === 'ELEVENLABS_TTS_CHARS') {
          elevenUsd  += usd;
          elevenChars += (q.chars || q.cost?.chars || 0);
          breakdown.push({ type: 'elevenlabs', source: q.source, chars: q.chars, usd, rate });
        } else if (q.provider === 'groq' || q.cost?.model?.includes('llama')) {
          groqUsd += usd;
          breakdown.push({ type: 'groq', source: q.source || q.type, model: q.cost?.model, usd, rate });
        } else {
          // KC_LLM_FALLBACK, A2_LLM_INTAKE_TURN_1 (Claude), etc.
          claudeUsd += usd;
          breakdown.push({ type: 'claude', source: q.source || q.type, model: q.cost?.model, usd, rate });
        }
      }
      const totalUsd = claudeUsd + groqUsd + elevenUsd;
      if (totalUsd <= 0) return null;
      return { claudeUsd, groqUsd, elevenUsd, elevenChars, totalUsd, breakdown };
    })();

    // Classify which engine actually produced this agent turn (UAP/Groq/LLMAgent split)
    const audioServed = audioServedByTurn.has(t.turnNumber)
      ? audioServedByTurn.get(t.turnNumber)
      : null; // signal unavailable → classifier returns generic 'uap'
    const answerMode = classifyAnswerMode({
      speaker: t.speaker,
      turnNumber: t.turnNumber,
      provPath,
      sourceKey: srcKey,
      flags,
      kcTrace,
      audioServed
    });

    result.push({
      displayIndex,                      // sequential 1…N for the report
      turnNumber: t.turnNumber,          // raw DB turn number (shown in pipeline trace)
      speaker: t.speaker,                // 'caller' | 'agent'
      text: t.text?.trim() || '',
      // Legacy compat for renderTurnBlock which reads callerText/agentText:
      callerText: t.speaker === 'caller' ? t.text?.trim() : null,
      agentText:  t.speaker === 'agent'  ? t.text?.trim() : null,
      elapsed: fmtElapsed(startedAt, t.ts),
      ts: t.ts || null,
      kind: t.kind || null,
      sourceKey: srcKey,
      // Per-turn STT provider: drives the green DEEPGRAM pill on caller
      // rows when the utterance was transcribed by Deepgram (either live
      // via Media Streams or rescued via DeepgramFallback). Null for agent
      // turns and for legacy transcripts with no inputTextSource.
      sttProvider: derivePerTurnSttProvider(t),
      provenanceType: provType,
      provenanceLabel: provenanceLabel(provType, srcKey, provPath),
      provenancePath: provPath,
      answerMode,                         // 'uap' | 'uap-text' | 'uap-audio' | 'groq' | 'llm-agent' | null
      audioServed,                        // true=TWIML_PLAY, false=TWIML_SAY, null=no system turn logged
      groqLatencyMs: kcTrace?.groqLatencyMs || null,
      latencyMs: kcTrace.latencyMs || null,
      kcCard: kcCard ? {
        _id: kcCard._id.toString(),
        kcId: kcCard.kcId || null,
        sectionIdx: kcTrace.sectionIdx ?? null,
        sectionId: kcTrace.sectionId || null,
        title: kcCard.title || null,
        bookingAction: kcCard.bookingAction || null,
        closingPrompt: kcCard.closingPrompt || null,
        category: kcCard.category || null
      } : null,
      score:  typeof kcTrace.score === 'number' ? kcTrace.score : null,
      intent: kcTrace.intent || null,
      qaEntry,
      // ── PR 2b (Apr 22, 2026) — forward the FULL per-turn qaLog so the
      // Call Intelligence UAP Decision panel can render the complete
      // gate timeline for a turn (Layer 1 hit + SECTION_GAP + LLM fallback
      // often all exist on the same turn). qaEntry remains for backward
      // compat. ELEVENLABS_TTS_CHARS rows are stripped here — they carry
      // no decision info and bloat the payload.
      qaEntries: qaEntriesForTurn.filter(q => q && q.type !== 'ELEVENLABS_TTS_CHARS'),
      qaCosts,  // Pass 2d — aggregated real cost breakdown for Est. Cost card
      flags
    });
  }

  return result;
}

function buildKCAudit(convTurns, kcMap) {
  const matched = [];
  const gaps = [];

  for (const turn of convTurns) {
    if (turn.kcCard) {
      matched.push({
        turnNumber: turn.turnNumber,
        elapsed: turn.elapsed,
        kcId: turn.kcCard.kcId,
        sectionId: turn.kcCard.sectionId || null,
        title: turn.kcCard.title,
        mongoId: turn.kcCard._id,
        score: turn.score,
        path: turn.provenancePath,
        bookingAction: turn.kcCard.bookingAction,
        missedBookingCta: turn.flags?.some(f => f.code === 'MISSED_BOOKING_CTA')
      });
    } else if (turn.callerText && turn.agentText &&
      (turn.provenancePath?.toUpperCase().includes('LLM') ||
        turn.provenanceType === 'LLM_GENERATED')) {
      gaps.push({
        turnNumber: turn.turnNumber,
        elapsed: turn.elapsed,
        callerText: turn.callerText,
        path: turn.provenancePath
      });
    }
  }

  return { matched, gaps };
}

// ═══════════════════════════════════════════════════════════════════════════
// 📡 TWILIO HEALTH — Aggregates webhook timing + Twilio errors for the report
// ═══════════════════════════════════════════════════════════════════════════
function buildTwilioHealth(transcriptV2, summary, convTurns) {
  const traceEvents = transcriptV2?.trace || [];

  // ── WEBHOOK_TIMING traces ────────────────────────────────────────────
  const timingTraces = traceEvents
    .filter(t => t.kind === 'WEBHOOK_TIMING')
    .sort((a, b) => (a.turnNumber || 0) - (b.turnNumber || 0));

  const webhookTimings = timingTraces.map(t => ({
    turnNumber: t.turnNumber,
    route: t.payload?.route || null,
    totalElapsedMs: t.payload?.totalElapsedMs || null,
    breakdown: t.payload?.breakdown || null,
    atRisk: t.payload?.atRisk === true,
    timedOut: t.payload?.timedOut === true,
    voiceProviderUsed: t.payload?.voiceProviderUsed || null
  }));

  const atRiskTurns = webhookTimings.filter(t => t.atRisk);
  const timedOutTurns = webhookTimings.filter(t => t.timedOut);
  const avgWebhookMs = webhookTimings.length > 0
    ? Math.round(webhookTimings.reduce((s, t) => s + (t.totalElapsedMs || 0), 0) / webhookTimings.length)
    : null;
  const maxWebhookMs = webhookTimings.length > 0
    ? Math.max(...webhookTimings.map(t => t.totalElapsedMs || 0))
    : null;

  // ── TWILIO_ERROR traces ──────────────────────────────────────────────
  const errorTraces = traceEvents
    .filter(t => t.kind === 'TWILIO_ERROR')
    .map(t => ({
      errorCode: t.payload?.errorCode || 'UNKNOWN',
      errorUrl: t.payload?.errorUrl || null,
      ts: t.ts,
      source: t.payload?.source || null
    }));

  // Also read from callLifecycle.twilioErrors (CallSummary)
  const lifecycleErrors = (summary?.callLifecycle?.twilioErrors || []).map(e => ({
    errorCode: e.errorCode || 'UNKNOWN',
    errorUrl: e.errorUrl || null,
    ts: e.ts,
    source: e.source || 'callLifecycle'
  }));

  // Deduplicate by errorCode+ts
  const allErrors = [...errorTraces, ...lifecycleErrors];
  const seen = new Set();
  const twilioErrors = allErrors.filter(e => {
    const key = `${e.errorCode}:${e.ts?.toISOString?.() || ''}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // ── ANOMALY: Very few turns relative to call duration ────────────────
  const durationSeconds = summary?.durationSeconds || 0;
  const humanTurnCount = convTurns.filter(t => t.speaker === 'caller').length;
  const abnormalTermination = durationSeconds > 20 && humanTurnCount <= 1;

  // ── Voice fallback detection ─────────────────────────────────────────
  const voiceFallbackTurns = webhookTimings.filter(t =>
    t.voiceProviderUsed === 'twilio_say'
  ).length;

  // ── Voice provider forensic summary (Apr 24, 2026) ───────────────────
  // Aggregates voiceProviderUsed across every turn so client disputes can
  // be answered with the truth: "agent rendered turn 1 via ElevenLabs,
  // turns 2-5 via Polly Matthew (configured primary), turn 6 fell back to
  // twilio_say after EL synthesis timed out." Built from webhookTimings
  // (call path) + trace events VOICE_PROVIDER_USED / VOICE_PROVIDER_FALLBACK
  // (router-emitted, deeper than webhookTimings catch).
  const providerCounts = {};
  for (const t of webhookTimings) {
    const p = t.voiceProviderUsed || 'unknown';
    providerCounts[p] = (providerCounts[p] || 0) + 1;
  }
  const routerUsedEvents = traceEvents.filter(t => t.kind === 'VOICE_PROVIDER_USED');
  const routerFallbackEvents = traceEvents
    .filter(t => t.kind === 'VOICE_PROVIDER_FALLBACK')
    .map(t => ({
      ts: t.ts || null,
      from: t.payload?.fromProvider || null,
      to: t.payload?.toProvider || null,
      reason: t.payload?.reason || null,
      errorMessage: t.payload?.errorMessage || null,
      ttsSource: t.payload?.ttsSource || null,
      fallbackVoice: t.payload?.fallbackVoice || null
    }));

  // Best guess at the tenant's configured primary: most common router 'used'
  // event provider, falling back to majority of webhookTimings entries.
  // Not authoritative — the company doc is the source of truth for live config —
  // but accurate for "what did this call actually do".
  const routerUsedCounts = {};
  for (const e of routerUsedEvents) {
    const p = e.payload?.provider || 'unknown';
    routerUsedCounts[p] = (routerUsedCounts[p] || 0) + 1;
  }
  const inferredPrimary = (() => {
    const entries = Object.entries(routerUsedCounts);
    if (entries.length > 0) {
      entries.sort((a, b) => b[1] - a[1]);
      return entries[0][0];
    }
    // Map webhookTimings provider strings → conceptual primary.
    const elFamily = ['elevenlabs', 'elevenlabs_cached', 'instant_audio_cache', 'instant_audio_trigger', 'instant_audio_kc', 'instant_audio_agent2'];
    const pollyFamily = ['polly', 'polly_fallback', 'polly_time_budget_guard'];
    const elCount = Object.entries(providerCounts).filter(([k]) => elFamily.includes(k)).reduce((s, [, n]) => s + n, 0);
    const pollyCount = Object.entries(providerCounts).filter(([k]) => pollyFamily.includes(k)).reduce((s, [, n]) => s + n, 0);
    if (elCount === 0 && pollyCount === 0) return 'unknown';
    return elCount >= pollyCount ? 'elevenlabs' : 'polly';
  })();

  const voiceProviderSummary = {
    inferredPrimary,
    turnCounts: providerCounts,
    routerEvents: {
      used: routerUsedEvents.length,
      fallbacks: routerFallbackEvents.length
    },
    fallbackDetails: routerFallbackEvents,
    note: routerUsedEvents.length === 0 && Object.keys(providerCounts).length === 0
      ? 'No voice provider data on this call.'
      : null
  };

  // ── Overall health status ────────────────────────────────────────────
  let status = 'healthy';
  if (twilioErrors.length > 0 || timedOutTurns.length > 0) status = 'error';
  else if (atRiskTurns.length > 0 || abnormalTermination) status = 'warning';

  return {
    status,
    webhookTimings,
    avgWebhookMs,
    maxWebhookMs,
    atRiskTurns: atRiskTurns.length,
    timedOutTurns: timedOutTurns.length,
    twilioErrors,
    voiceFallbackTurns,
    voiceProviderSummary,
    abnormalTermination,
    durationSeconds,
    humanTurnCount,
    note: webhookTimings.length === 0
      ? 'No webhook timing data available — call may predate instrumentation.'
      : null
  };
}

function buildLatencyProfile(summary, convTurns) {
  const turns = convTurns.map(t => ({
    turnNumber: t.turnNumber,
    elapsed: t.elapsed,
    latencyMs: t.latencyMs,
    path: t.provenancePath,
    color: !t.latencyMs ? 'unknown' :
      t.latencyMs < 500 ? 'ok' :
        t.latencyMs < 1500 ? 'warn' : 'fail'
  }));

  const known = turns.filter(t => t.latencyMs);
  const avgMs = known.length > 0
    ? Math.round(known.reduce((s, t) => s + t.latencyMs, 0) / known.length)
    : (summary?.avgLatencyMs || null);

  const worst = known.length > 0
    ? known.reduce((a, b) => b.latencyMs > a.latencyMs ? b : a)
    : null;

  const speechTimeoutOverheadSecs = convTurns.length * 1.5;

  return {
    turns,
    avgMs,
    avgFormatted: avgMs ? `${avgMs}ms` : (summary?.avgLatencyMs ? `${summary.avgLatencyMs}ms (avg)` : 'N/A'),
    worstTurn: worst,
    speechTimeoutOverheadSecs,
    note: known.length === 0
      ? 'Per-turn latency not yet persisted to transcript. Showing call-level avg from CallSummary.'
      : null
  };
}

function buildEntityTimeline(discoveryNotes, convTurns) {
  if (!discoveryNotes) {
    return {
      entries: [],
      missing: ['All discovery data'],
      note: 'No discoveryNotes found for this call.'
    };
  }

  const entries = [];
  const e = discoveryNotes.entities || {};

  // ── Entity captures (structured fields extracted by LLM intake) ───────────
  // These go first so the entity timeline reads: entities captured → then Q&As
  if (e.firstName || e.fullName) {
    entries.push({ turn: 1, field: 'name', value: e.fullName || e.firstName, type: 'entity' });
  }
  if (discoveryNotes.callReason) {
    entries.push({ turn: 1, field: 'callReason', value: discoveryNotes.callReason, type: 'entity' });
  }
  if (discoveryNotes.urgency) {
    entries.push({ turn: 1, field: 'urgency', value: String(discoveryNotes.urgency), type: 'entity' });
  }
  if (discoveryNotes.priorVisit === true) {
    entries.push({ turn: 1, field: 'priorVisit', value: 'Yes', type: 'entity' });
  }
  if (e.address) {
    entries.push({ turn: 1, field: 'address', value: e.address, type: 'entity' });
  }

  // ── Q&A log (KC card answers delivered during the call) ──────────────────
  // field/value are NOT question text — use question/answer so the frontend
  // can render them correctly.  'field' stays as 'qa' for type-switch logic.
  const qaLog = discoveryNotes.qaLog || [];
  for (const qa of qaLog) {
    entries.push({
      turn:     qa.turn,
      field:    'qa',          // type tag — frontend switches on this
      question: qa.question,   // the caller's utterance that triggered KC
      value:    qa.answer,     // the KC card answer that was delivered
      type:     'qa'
    });
  }

  // Sort by turn ascending
  entries.sort((a, b) => (a.turn || 0) - (b.turn || 0));

  const missing = [];
  if (!e.firstName && !e.fullName) missing.push('name');
  if (!e.address) missing.push('address');
  if (!discoveryNotes.callReason) missing.push('callReason');
  if (discoveryNotes.priorVisit === null || discoveryNotes.priorVisit === undefined) missing.push('priorVisit');

  return {
    entries,
    missing,
    objective: discoveryNotes.objective || null,
    doNotReask: discoveryNotes.doNotReask || []
  };
}

function buildAutoIssues(summary, convTurns, discoveryNotes, transcriptV2) {
  const issues = [];
  let seq = 1;

  // LLM fallback turns
  const llmTurns = convTurns.filter(t =>
    (t.provenancePath || '').toUpperCase().includes('LLM')
  );
  if (llmTurns.length > 0) {
    issues.push({
      id: `auto-${seq++}`,
      severity: llmTurns.length >= 3 ? 'high' : 'medium',
      category: 'bucket_gap',
      title: `${llmTurns.length} turn${llmTurns.length > 1 ? 's' : ''} used LLM fallback`,
      description: `LLM generated ${llmTurns.length} response${llmTurns.length > 1 ? 's' : ''} because no KC card matched. These answers may not reflect authored policy and cost ~6× more per turn than KC answers.`,
      affectedTurns: llmTurns.map(t => t.turnNumber),
      action: 'create_kc'
    });
  }

  // Missed booking CTA
  const missedBooking = convTurns.filter(t =>
    t.flags?.some(f => f.code === 'MISSED_BOOKING_CTA')
  );
  if (missedBooking.length > 0) {
    issues.push({
      id: `auto-${seq++}`,
      severity: 'high',
      category: 'response_quality',
      title: 'Booking CTA not delivered',
      description: `${missedBooking.length} KC card${missedBooking.length > 1 ? 's' : ''} with bookingAction=offer_to_book did not deliver a booking CTA. Potential booking opportunity missed.`,
      affectedTurns: missedBooking.map(t => t.turnNumber),
      kcIds: missedBooking.map(t => t.kcCard?._id).filter(Boolean),
      action: 'edit_kc'
    });
  }

  // Missing discovery data
  if (discoveryNotes && !discoveryNotes.entities?.address && !summary?.capturedSummary?.addressCaptured) {
    issues.push({
      id: `auto-${seq++}`,
      severity: 'medium',
      category: 'performance',
      title: 'Address not captured',
      description: 'Service address was not captured during this call. INTAKE stage requires address in Turns 1–2.',
      action: null
    });
  }


  // Name captured in Turn 1 but never used (agent echoed it, discoveryNotes missing)
  const agentUsedName = convTurns.some(t =>
    t.speaker === 'agent' && t.turnNumber === 1 &&
    discoveryNotes?.entities?.firstName &&
    t.text?.toLowerCase().includes(discoveryNotes.entities.firstName.toLowerCase())
  );
  const nameInDiscovery = !!(discoveryNotes?.entities?.firstName || discoveryNotes?.entities?.fullName);
  if (agentUsedName && !nameInDiscovery) {
    issues.push({
      id: `auto-${seq++}`,
      severity: 'medium',
      category: 'entity_capture',
      title: 'Name echoed in greeting but missing from discoveryNotes',
      description: 'The agent addressed the caller by name in Turn 1 but the name was not persisted to discoveryNotes entities. The booking engine may cold-ask for the name again. Check llm_intake entity write timing.',
      action: null
    });
  }

  // KC answered a question but no booking CTA delivered anywhere in the call
  const kcAnsweredTurns = convTurns.filter(t => _isKCAnswered(t));
  const bookingCreated = !!summary?.appointmentCreatedId;
  const bookingIntentFired = convTurns.some(t =>
    t.flags?.some(f => f.code === 'BOOKING_INTENT_FIRED')
  );
  if (kcAnsweredTurns.length > 0 && !bookingCreated && !bookingIntentFired) {
    issues.push({
      id: `auto-${seq++}`,
      severity: 'high',
      category: 'response_quality',
      title: 'KC answered but no booking CTA delivered',
      description: `KC answered ${kcAnsweredTurns.length} turn(s) but the call ended without a booking or a booking intent signal. Check that KC cards have bookingAction=offer_to_book and that closingPrompts are set to pivot the caller toward scheduling.`,
      affectedTurns: kcAnsweredTurns.map(t => t.turnNumber),
      action: 'edit_kc'
    });
  }

  // ── Twilio Infrastructure Issues ──────────────────────────────────────

  // 1. Webhook timeout risk — any turn > 12000ms
  const _timingTraces = (transcriptV2?.trace || []).filter(t => t.kind === 'WEBHOOK_TIMING');
  const _atRiskTimings = _timingTraces.filter(t => t.payload?.atRisk === true);
  if (_atRiskTimings.length > 0) {
    const worstMs = Math.max(..._atRiskTimings.map(t => t.payload?.totalElapsedMs || 0));
    const _timedOut = _atRiskTimings.filter(t => t.payload?.timedOut === true).length;
    issues.push({
      id: `auto-${seq++}`,
      severity: _timedOut > 0 ? 'critical' : 'high',
      category: 'infrastructure',
      title: _timedOut > 0
        ? `${_timedOut} turn(s) exceeded Twilio 15s timeout`
        : `${_atRiskTimings.length} turn(s) near Twilio timeout (>12s)`,
      description: _timedOut > 0
        ? `${_timedOut} webhook response(s) took longer than Twilio's 15-second limit. The caller heard "We are sorry, an application error has occurred." Worst: ${worstMs}ms.`
        : `${_atRiskTimings.length} webhook response(s) exceeded 12s (Twilio limit: 15s). Worst: ${worstMs}ms. At risk of timeout under load.`,
      affectedTurns: _atRiskTimings.map(t => t.turnNumber).filter(n => n != null),
      action: null
    });
  }

  // 2. Twilio errors captured during call
  const _twilioErrorTraces = (transcriptV2?.trace || []).filter(t => t.kind === 'TWILIO_ERROR');
  const _lifecycleErrors = summary?.callLifecycle?.twilioErrors || [];
  const _totalTwilioErrors = _twilioErrorTraces.length + _lifecycleErrors.length;
  if (_totalTwilioErrors > 0) {
    const errorCodes = [
      ..._twilioErrorTraces.map(t => t.payload?.errorCode),
      ..._lifecycleErrors.map(e => e.errorCode)
    ].filter(Boolean);
    issues.push({
      id: `auto-${seq++}`,
      severity: 'critical',
      category: 'infrastructure',
      title: `Twilio error${_totalTwilioErrors > 1 ? 's' : ''} during call (${[...new Set(errorCodes)].join(', ')})`,
      description: `Twilio reported ${_totalTwilioErrors} error(s) via the fallback URL. The caller heard Twilio's generic "application error" message on at least one turn.`,
      action: null
    });
  }

  // 3. Voice provider crash recovery
  const _crashTurns = convTurns.filter(t =>
    t.sourceKey === 'ROUTE_CRASH' || t.sourceKey === 'COMPUTE_CRASH'
  );
  if (_crashTurns.length > 0) {
    issues.push({
      id: `auto-${seq++}`,
      severity: 'high',
      category: 'infrastructure',
      title: `${_crashTurns.length} turn(s) used crash recovery`,
      description: `${_crashTurns.length} response(s) delivered via crash recovery (Twilio <Say> fallback) instead of the normal pipeline.`,
      affectedTurns: _crashTurns.map(t => t.turnNumber),
      action: null
    });
  }

  // 4. Abnormal call termination (long duration, very few turns)
  const _durationSec = summary?.durationSeconds || 0;
  const _callerTurnCount = convTurns.filter(t => t.speaker === 'caller').length;
  if (_durationSec > 20 && _callerTurnCount <= 1) {
    issues.push({
      id: `auto-${seq++}`,
      severity: 'high',
      category: 'infrastructure',
      title: 'Abnormal call termination',
      description: `Call lasted ${_durationSec}s but only had ${_callerTurnCount} caller turn(s). The caller likely heard Twilio's "application error" message and hung up, or the webhook timed out on a subsequent turn.`,
      action: null
    });
  }

  return issues;
}

function buildAutoRecommendations(summary, convTurns, discoveryNotes, kcMap) {
  const recs = [];
  let seq = 1;

  // Recommend KC cards for each LLM fallback gap
  const llmTurns = convTurns.filter(t =>
    (t.provenancePath || '').toUpperCase().includes('LLM') && t.callerText
  );
  for (const turn of llmTurns) {
    recs.push({
      id: `rec-${seq++}`,
      type: 'create_trigger',
      priority: 'high',
      title: `Create KC card for Turn ${turn.turnNumber}`,
      description: `Caller asked: "${turn.callerText.substring(0, 100)}". No KC matched. Add an authored KC card to own this answer and reduce LLM reliance.`,
      copyableContent: turn.callerText,
      status: 'pending',
      turnNumber: turn.turnNumber
    });
  }

  return recs;
}

function buildFullReport({ callSid, companyId, summary, transcriptV2, intelligence, discoveryNotes, kcMap, company }) {
  const startedAt = transcriptV2?.callMeta?.startedAt || summary?.startedAt;
  const rawTurns = transcriptV2?.turns || [];
  const convTurns = buildConversationTurns(rawTurns, kcMap, discoveryNotes, startedAt);

  // ── Upgrade booking turns with KC digression attribution ──────────────
  // BookingLogicEngine KC digressions carry sourceKey='BOOKING_LOGIC_ENGINE'
  // in the transcript (maps to HARDCODED). Cross-ref trace events to upgrade
  // provenance and surface the KC card when KC actually answered.
  const _traceEvts = transcriptV2?.trace || [];
  for (const evt of _traceEvts) {
    if (evt.kind !== 'BOOKING_LOGIC_TRACE' || !evt.payload?.steps) continue;
    const kcStep = evt.payload.steps.find(s =>
      s.type === 'BK_KC_DIGRESSION_ANSWERED' || s.type === 'BK_BPFUQ_KC_ANSWERED'
    );
    if (!kcStep) continue;

    const agentTurn = convTurns.find(t =>
      t.turnNumber === evt.turnNumber && t.speaker === 'agent' && t.sourceKey === 'BOOKING_LOGIC_ENGINE'
    );
    if (!agentTurn) continue;

    // Upgrade provenance: this booking turn was answered by KC
    agentTurn.provenanceType  = 'UI_OWNED';
    agentTurn.provenanceLabel = 'KC (Booking Digression)';
    agentTurn.provenancePath  = 'BK_KC_DIGRESSION';

    // Surface the KC card if in kcMap
    const cid = kcStep.containerId;
    if (cid && kcMap.has(cid)) {
      const kc = kcMap.get(cid);
      agentTurn.kcCard = {
        _id:           kc._id.toString(),
        kcId:          kc.kcId || null,
        title:         kc.title || null,
        bookingAction: kc.bookingAction || null,
        closingPrompt: kc.closingPrompt || null,
        category:      kc.category || null
      };
    }
  }

  // Engine Hub nuked April 2026 — header no longer surfaces EH mode.
  const healthScore = calcHealthScore(summary, convTurns, discoveryNotes);

  // Rich per-turn pipeline trace — Turn1Engine, UAP, Semantic, Groq, section IDs
  let turnByTurnFlow = [];
  try {
    turnByTurnFlow = buildTurnByTurnFlow(rawTurns, _traceEvts);
  } catch (flowErr) {
    console.warn('[buildFullReport] turnByTurnFlow failed (non-fatal):', flowErr.message);
  }

  return {
    header: buildHeader(callSid, companyId, summary, healthScore, !!intelligence, convTurns),
    story: buildStory(summary, discoveryNotes, convTurns, intelligence),
    vitals: buildVitals(summary, convTurns, discoveryNotes),
    protocolAudit: buildProtocolAudit(summary, transcriptV2, convTurns, discoveryNotes, company),
    costBreakdown: buildCostBreakdown(summary, convTurns),
    turns: convTurns,
    kcAudit: buildKCAudit(convTurns, kcMap),
    latencyProfile: buildLatencyProfile(summary, convTurns),
    twilioHealth: buildTwilioHealth(transcriptV2, summary, convTurns),
    entityTimeline: buildEntityTimeline(discoveryNotes, convTurns),
    issues: intelligence?.issues?.length ? intelligence.issues : buildAutoIssues(summary, convTurns, discoveryNotes, transcriptV2),
    recommendations: intelligence?.recommendations?.length
      ? intelligence.recommendations
      : buildAutoRecommendations(summary, convTurns, discoveryNotes, kcMap),
    turnByTurnFlow,                      // Rich per-turn pipeline trace (Turn1, UAP, Semantic, Groq)
    hasGpt4Analysis: !!intelligence,
    gpt4Meta: intelligence?.gpt4Analysis || null,
    engineeringScore: intelligence?.engineeringScore || null,
    callerJourney: intelligence?.callerJourney || null,
    turnByTurnAnalysis: intelligence?.turnByTurnAnalysis || null,
    rootCauseAnalysis: intelligence?.rootCauseAnalysis || null
  };
}

// ── route handler ─────────────────────────────────────────────────────────

router.get('/:callSid/full-report', async (req, res) => {
  try {
    const { callSid } = req.params;
    const { companyId } = req.query;

    if (!companyId || !callSid) {
      return res.status(400).json({ error: 'callSid and companyId are required' });
    }

    let companyOid;
    try {
      companyOid = new mongoose.Types.ObjectId(companyId);
    } catch {
      return res.status(400).json({ error: 'Invalid companyId format' });
    }

    // 1. Parallel load of all data sources (company needed for buildProtocolAudit
    //    speechDetection config; Engine Hub subdoc was nuked April 2026).
    const [summary, transcriptV2, intelligence, company] = await Promise.all([
      CallSummary.findOne({
        companyId: companyOid,
        $or: [{ twilioSid: callSid }, { callId: callSid }]
      }).lean(),
      CallTranscriptV2.findOne({ companyId: companyOid, callSid }).lean(),
      CallIntelligence.findOne({ callSid }).lean(),
      Company.findById(companyOid).select('aiAgentSettings voiceSettings').lean()
    ]);

    // 2. Load Customer discoveryNotes
    let discoveryNotes = null;
    if (summary?.customerId) {
      try {
        const customer = await Customer.findOne({
          _id: summary.customerId,
          companyId: companyOid
        }).select('discoveryNotes').lean();
        discoveryNotes = customer?.discoveryNotes?.find(n => n.callSid === callSid) || null;
      } catch (err) {
        console.warn('[full-report] discoveryNotes load failed:', err.message);
      }
    }

    // 3. Extract KC anchor/container IDs from turns
    const rawTurns = transcriptV2?.turns || [];
    const kcLookupIds = new Set();
    for (const turn of rawTurns) {
      const trace = turn.trace || {};
      const cid = trace.kcTrace?.containerId || trace._123rp?.containerId || trace.provenance?.containerId;
      if (cid && mongoose.Types.ObjectId.isValid(cid)) kcLookupIds.add(cid.toString());
    }

    // 3b. Also extract container IDs from booking KC digression events in trace.
    //     Booking turns carry sourceKey='BOOKING_LOGIC_ENGINE' — the KC containerId
    //     is only inside the BOOKING_LOGIC_TRACE event, not the turn's embedded trace.
    const traceEvents = transcriptV2?.trace || [];
    for (const evt of traceEvents) {
      if (evt.kind !== 'BOOKING_LOGIC_TRACE' || !evt.payload?.steps) continue;
      for (const step of evt.payload.steps) {
        if ((step.type === 'BK_KC_DIGRESSION_ANSWERED' || step.type === 'BK_BPFUQ_KC_ANSWERED') && step.containerId) {
          if (mongoose.Types.ObjectId.isValid(step.containerId)) kcLookupIds.add(step.containerId);
        }
      }
    }

    // 4. Load KC cards
    const kcMap = new Map();
    if (kcLookupIds.size > 0) {
      try {
        const kcCards = await CompanyKnowledgeContainer.find({
          companyId: companyOid,
          _id: { $in: [...kcLookupIds].map(id => new mongoose.Types.ObjectId(id)) }
        }).select('_id kcId title bookingAction closingPrompt category keywords').lean();
        for (const kc of kcCards) kcMap.set(kc._id.toString(), kc);
      } catch (err) {
        console.warn('[full-report] KC card load failed:', err.message);
      }
    }

    // 5. Assemble and return
    const report = buildFullReport({ callSid, companyId, summary, transcriptV2, intelligence, discoveryNotes, kcMap, company });

    return res.json({ ok: true, report });

  } catch (err) {
    console.error('[call-intelligence full-report]', err.message, err.stack);
    return res.status(500).json({ error: 'Failed to assemble report', message: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Shared Groq HTTP helper (reused by both gap endpoints below)
// ─────────────────────────────────────────────────────────────────────────────
function _groqChat({ messages, maxTokens = 400, temperature = 0.1 }) {
  const groqKey = process.env.GROQ_API_KEY;
  if (!groqKey) return Promise.reject(new Error('GROQ_API_KEY not configured'));

  const body = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages,
    temperature,
    max_tokens: maxTokens,
    response_format: { type: 'json_object' }
  });

  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      },
      timeout: 10000
    };
    const req = https.request(opts, res => {
      let raw = '';
      res.on('data', c => { raw += c; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          const content = parsed?.choices?.[0]?.message?.content;
          if (!content) return reject(new Error('Empty Groq response'));
          resolve(JSON.parse(content));
        } catch (e) {
          reject(new Error(`Groq parse failed: ${e.message}`));
        }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Groq timeout')); });
    req.write(body);
    req.end();
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /company/:companyId/cue-gap
//
// Multi-signal gap analysis. Groq identifies 1-3 DISTINCT intent signals
// in the caller utterance — each with a UAP-matchable phrase candidate and
// its own 8-field cueFrame extraction. Returns candidates[] for rendering
// and downstream phrase matching.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/company/:companyId/cue-gap', async (req, res) => {
  const { companyId } = req.params;
  const { utterance, callSid, turnNumber } = req.body || {};

  if (!utterance || typeof utterance !== 'string' || utterance.trim().length < 3) {
    return res.status(400).json({ error: 'utterance required (min 3 chars)' });
  }
  if (!process.env.GROQ_API_KEY) {
    return res.status(503).json({ error: 'GROQ_API_KEY not configured' });
  }

  const safeUtterance = utterance.replace(/\\/g, '\\\\').replace(/"/g, '\\"').slice(0, 500);

  const systemPrompt = `You are a multi-signal extraction engine for a voice AI phone agent.

A caller utterance often contains MULTIPLE DISTINCT intent signals — like a repeat-visit complaint, an equipment failure symptom, and a new secondary issue all in one breath.

Your job: decompose the utterance into 1-3 DISTINCT, NON-OVERLAPPING signals.

For each signal produce a JSON object with these exact keys:
- "signal": one of: repeat_visit | equipment_failure | new_symptom | payment_inquiry | scheduling_request | info_request | complaint | warranty_question | other
- "phrase": a 3-7 word compact phrase in natural caller language for THIS signal only. This is a SEARCH KEY fed into a phrase matcher — keep it caller-natural (e.g. "ac not cooling again", "water leaking garage", "same problem as before").
- "rationale": one sentence — why this is a distinct signal worth matching separately.
- "cueFrame": extract ONLY what belongs to THIS signal using these STRICT definitions:
  {
    "requestCue":    ONLY if caller explicitly asks for something to be done: "can you", "could you", "I want you to", "I need you to". NULL for statements or descriptions.
    "permissionCue": ONLY if caller asks whether they must do something: "do I have to", "am I required to", "is it okay if". NULL otherwise.
    "infoCue":       ONLY if caller asks a direct question for information: "what is", "how much", "when does", "do you know if". A caller STATING a problem (e.g. "it's not cooling") is NOT infoCue — that is modifierCore or tradeMatches.
    "directiveCue":  ONLY explicit commands the caller gives to the agent: "just fix it", "please send someone", "I need you to come out". Narrative openers like "I'm calling because", "I just wanted to", "I'm having" are NOT directiveCue — leave null.
    "actionCore":    The core action or problem verb: "fix", "repair", "replace", "schedule", "pay", "not working", "leaking", "broke". Extract the action, not the equipment.
    "urgencyCore":   ONLY explicit time pressure: "today", "now", "asap", "emergency", "right away". NULL if no urgency stated.
    "modifierCore":  Context that qualifies the situation: "same problem", "again", "as before", "under warranty", "still broken". Equipment names belong in tradeMatches, not here.
    "tradeMatches":  Trade/industry terms and equipment names only: [ {"term": "AC", "category": "hvac"}, {"term": "thermostat", "category": "hvac"} ] or []
  }

CRITICAL CLASSIFICATION RULES:
1. A value must appear in EXACTLY ONE field — never duplicate a value across multiple fields.
2. infoCue = QUESTIONS ONLY. "not cooling", "leaking", "broke" are NEVER infoCue — they are actionCore or tradeMatches.
3. modifierCore = situation context ("same problem", "again") NOT equipment names. Equipment → tradeMatches.
4. Each candidate must address a DIFFERENT topic — never paraphrase the same signal twice.
5. "phrase" must be 3-7 lowercase words of natural caller speech.
6. Extract ONLY what is clearly stated — never infer or hallucinate.
7. cueFrame field values: 2-8 words or null. Never full sentences.
8. If utterance has only one clear signal, return exactly 1 candidate.
9. Return ONLY: { "candidates": [ ...1-3 objects... ] }`;

  const userMsg = `UTTERANCE: "${safeUtterance}"`;

  try {
    const result = await _groqChat({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMsg }
      ],
      maxTokens: 700,
      temperature: 0.05
    });

    // Validate and sanitise candidates
    const raw = Array.isArray(result?.candidates) ? result.candidates : [];
    const candidates = raw
      .filter(c => c && typeof c.phrase === 'string' && c.phrase.trim().length >= 3)
      .slice(0, 3)
      .map((c, idx) => ({
        idx,
        signal:    typeof c.signal === 'string' ? c.signal : 'other',
        phrase:    c.phrase.trim().toLowerCase().slice(0, 80),
        rationale: typeof c.rationale === 'string' ? c.rationale.slice(0, 200) : '',
        cueFrame: {
          requestCue:    c.cueFrame?.requestCue    || null,
          permissionCue: c.cueFrame?.permissionCue || null,
          infoCue:       c.cueFrame?.infoCue       || null,
          directiveCue:  c.cueFrame?.directiveCue  || null,
          actionCore:    c.cueFrame?.actionCore    || null,
          urgencyCore:   c.cueFrame?.urgencyCore   || null,
          modifierCore:  c.cueFrame?.modifierCore  || null,
          tradeMatches:  Array.isArray(c.cueFrame?.tradeMatches) ? c.cueFrame.tradeMatches : []
        }
      }));

    if (!candidates.length) {
      return res.status(422).json({ error: 'Groq returned no valid candidates', raw: result });
    }

    return res.json({ ok: true, candidates, utterance, callSid, turnNumber });
  } catch (err) {
    console.error('[cue-gap]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /company/:companyId/cue-phrase-match
//
// Run a phrase candidate through the live UAP phrase index. Returns whether
// it matched a KC container, and if so which one — so the operator knows
// whether to add the phrase to the dictionary or if it already routes correctly.
// ─────────────────────────────────────────────────────────────────────────────
router.post('/company/:companyId/cue-phrase-match', async (req, res) => {
  const { companyId } = req.params;
  const { phrase } = req.body || {};

  if (!phrase || typeof phrase !== 'string' || phrase.trim().length < 3) {
    return res.status(400).json({ error: 'phrase required (min 3 chars)' });
  }
  if (!companyId) {
    return res.status(400).json({ error: 'companyId required' });
  }

  try {
    const UAP = require('../../services/engine/kc/UtteranceActParser');
    const KCS = require('../../services/engine/agent2/KnowledgeContainerService');

    // Run UAP phrase index lookup + load containers + embed input phrase in parallel
    const [uapResult, containers, phraseEmbs] = await Promise.all([
      UAP.parse(companyId, phrase.trim()),
      KCS.getActiveForCompany(companyId),
      SemanticMatchService.embedBatch([phrase.trim()])
    ]);

    const matched = !!(uapResult.containerId && uapResult.matchType !== 'NONE');

    let containerTitle = null;
    let sectionLabel   = null;
    if (matched) {
      const container = containers.find(c => String(c._id) === uapResult.containerId);
      containerTitle = container?.title || null;
      sectionLabel   = uapResult.sectionLabel || null;
    }

    // ── Top-3 phrase matches via embedding cosine similarity ─────────────
    // Load caller phrases from all active containers for this company
    const phraseEmb = phraseEmbs[0];
    let topMatches = [];
    if (phraseEmb?.length) {
      const allDocs = await CompanyKnowledgeContainer.collection.find(
        { companyId, isActive: { $ne: false } },
        { projection: {
          title: 1, kcId: 1,
          'sections.label': 1, 'sections.isActive': 1,
          'sections.callerPhrases.text': 1, 'sections.callerPhrases.anchorWords': 1,
        } }
      ).toArray();

      // Flatten all caller phrases with section metadata
      const cpList = [];
      for (const doc of allDocs) {
        const docId = doc._id.toString();
        (doc.sections || []).forEach((sec, idx) => {
          if (sec.isActive === false) return;
          const kcId = doc.kcId || null;
          const sectionKcId = kcId ? `${kcId}-${String(idx + 1).padStart(2, '0')}` : null;
          (sec.callerPhrases || []).forEach(cp => {
            const text = typeof cp === 'string' ? cp : cp.text;
            if (text) cpList.push({
              text,
              containerId:   docId,
              containerName: doc.title || 'Untitled',
              sectionIndex:  idx,
              sectionLabel:  sec.label || `Section ${idx + 1}`,
              sectionKcId,
            });
          });
        });
      }

      const cpEmbs = cpList.length
        ? await SemanticMatchService.embedBatch(cpList.map(c => c.text))
        : [];

      // Best match per section (highest cosine similarity)
      const bestPerSection = new Map();
      for (let i = 0; i < cpEmbs.length; i++) {
        const sim = _cosineSimilarity(phraseEmb, cpEmbs[i]);
        if (sim < 0.65) continue;
        const cp = cpList[i];
        const key = `${cp.containerId}:${cp.sectionIndex}`;
        const prev = bestPerSection.get(key);
        if (!prev || sim > prev.score) {
          bestPerSection.set(key, { score: sim, phraseText: cp.text, ...cp });
        }
      }

      topMatches = [...bestPerSection.values()]
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(m => ({
          containerId:   m.containerId,
          containerName: m.containerName,
          sectionIndex:  m.sectionIndex,
          sectionLabel:  m.sectionLabel,
          sectionKcId:   m.sectionKcId,
          phraseText:    m.phraseText,
          score:         Math.round(m.score * 1000) / 1000,
          tier:          m.score >= 0.90 ? '90%+' : m.score >= 0.80 ? '80%+' : '70%+',
        }));
    }

    return res.json({
      ok: true,
      matched,
      matchType:      uapResult.matchType,
      confidence:     uapResult.confidence ?? null,
      matchedPhrase:  uapResult.matchedPhrase || null,
      containerId:    uapResult.containerId   || null,
      containerTitle,
      sectionLabel,
      phrase,
      topMatches,
    });
  } catch (err) {
    console.error('[cue-phrase-match]', err.message);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
