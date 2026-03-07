/**
 * Call Intelligence Routes
 * 
 * API endpoints for AI-powered call analysis and recommendations.
 * 
 * @module routes/agentConsole/callIntelligence
 */

const express = require('express');
const router = express.Router();
const CallIntelligenceService = require('../../services/CallIntelligenceService');
const GPT4AnalysisService = require('../../services/GPT4AnalysisService');
const CallTranscriptV2 = require('../../models/CallTranscriptV2');
const CallSummary = require('../../models/CallSummary');
const CallIntelligenceSettings = require('../../models/CallIntelligenceSettings');
const CallIntelligence = require('../../models/CallIntelligence');
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
  return {
    speaker: turn.speaker || 'unknown',
    text: turn.text || '',
    kind: turn.kind || null,
    source: turn.sourceKey || turn.source || null,
    timestamp: turn.ts || turn.timestamp || null
  };
}

function buildTranscript(turns = [], limit = 12) {
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

  return {
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
}

function buildTurnByTurnFlow(turns = [], trace = []) {
  if (!Array.isArray(turns) || turns.length === 0) return [];
  if (!Array.isArray(trace)) return [];
  
  const flowSteps = [];
  const maxTurns = 10;
  const turnNumbers = [...new Set(turns.map(t => t.turnNumber).filter(n => Number.isFinite(n)))].sort((a, b) => a - b).slice(0, maxTurns);

  const traceByKind = new Map();
  for (const t of trace) {
    if (!t.kind) continue;
    const key = `${t.turnNumber || 0}:${t.kind}`;
    traceByKind.set(key, t);
  }

  for (const turnNum of turnNumbers) {
    const turnData = { turnNumber: turnNum };

    const callerTurn = turns.find(t => t.turnNumber === turnNum && t.speaker === 'caller');
    if (callerTurn) {
      turnData.callerInput = { raw: callerTurn.text?.substring(0, 500) };
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

    const responseReady = traceByKind.get(`${turnNum}:A2_RESPONSE_READY`);
    const agentTurn = turns.find(t => t.turnNumber === turnNum && t.speaker === 'agent');
    if (responseReady?.payload || agentTurn) {
      turnData.agentResponse = {
        text: (agentTurn?.text || responseReady?.payload?.responsePreview || '').substring(0, 500),
        source: responseReady?.payload?.source,
        usedCallerName: responseReady?.payload?.usedCallerName
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

function buildCallContext(turns = [], trace = []) {
  const scrabHandoff = findLastTrace(trace, 'SCRABENGINE_HANDOFF_TO_TRIGGERS');
  
  return {
    transcript: buildTranscript(turns),
    response: buildResponseContext(trace),
    scrabEngineHandoff: scrabHandoff?.payload || null,
    turnByTurnFlow: buildTurnByTurnFlow(turns, trace)
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
    const { gpt4Enabled, analysisMode, autoAnalyzeEnabled } = req.body;

    const updates = {};
    if (typeof gpt4Enabled === 'boolean') updates.gpt4Enabled = gpt4Enabled;
    if (analysisMode) updates.analysisMode = analysisMode;
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
    const { useGPT4 = false, mode = 'full', forceReanalyze = false } = req.body;

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

    const intelligence = await CallIntelligenceService.analyzeCall(callTrace, {
      useGPT4,
      mode,
      forceReanalyze
    });

    res.json({
      success: true,
      intelligence
    });
  } catch (error) {
    console.error('Error analyzing call:', error);
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
    
    const [intelligence, transcript, summary] = await Promise.all([
      CallIntelligenceService.getCallIntelligence(callSid),
      CallTranscriptV2.findOne({ callSid }).lean(),
      CallSummary.findOne({ $or: [{ twilioSid: callSid }, { callId: callSid }] }).lean()
    ]);

    const turns = transcript?.turns || summary?.turns || [];
    const trace = transcript?.trace || summary?.events || [];
    const callContext = buildCallContext(turns, trace);

    // If GPT-4 analysis exists, merge callContext and return
    if (intelligence) {
      const payload = intelligence.toObject ? intelligence.toObject() : intelligence;
      payload.callContext = callContext;
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
          callMetadata: {
            duration: summary?.durationSeconds || 0,
            turns: summary?.turnCount || turns.filter(t => t.speaker === 'caller').length || 0,
            fromPhone: summary?.phone || null,
            startTime: summary?.startedAt || transcript?.firstTurnTs || null,
            routingTier: summary?.routingTier || null
          },
          callContext
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
    const { page, limit, status, autoAnalyze = 'true', timeRange } = req.query;
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
        .select('callId twilioSid startedAt endedAt phone toPhone durationSeconds turnCount routingTier events turns')
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
          .select('callId twilioSid startedAt endedAt phone toPhone durationSeconds turnCount routingTier events turns')
          .lean(),
        CallSummary.countDocuments(fallbackQuery)
      ]);
    }

    const callSids = summaries.map(c => c.twilioSid || c.callId).filter(Boolean);
    const intelligenceDocs = callSids.length > 0
      ? await CallIntelligence.find({ companyId, callSid: { $in: callSids } }).lean()
      : [];
    const intelligenceMap = new Map(intelligenceDocs.map(doc => [doc.callSid, doc]));

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
                      durationSeconds: transcript.callMeta?.twilioDurationSeconds
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
                      durationSeconds: summary.durationSeconds || 0
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

    let items = summaries.map(summary => {
      const callSid = summary.twilioSid || summary.callId;
      const intel = intelligenceMap.get(callSid);
      if (intel) {
        // Merge routingTier from CallSummary into intelligence response
        if (summary.routingTier) {
          intel.callMetadata = intel.callMetadata || {};
          intel.callMetadata.routingTier = summary.routingTier;
        }
        return intel;
      }

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
        callMetadata: {
          duration: summary.durationSeconds || 0,
          turns: summary.turnCount || 0,
          fromPhone: summary.phone,
          startTime: summary.startedAt,
          routingTier: summary.routingTier || null
        }
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

module.exports = router;
