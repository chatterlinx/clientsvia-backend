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
    if (!transcript) {
      return res.status(404).json({
        success: false,
        error: 'Call transcript not found'
      });
    }

    const callSummary = await CallSummary.findOne({ callSid }).lean();

    const callTrace = {
      callSid: transcript.callSid,
      companyId: transcript.companyId,
      call: {
        callSid: transcript.callSid,
        fromPhone: callSummary?.fromPhone,
        toPhone: callSummary?.toPhone,
        startTime: transcript.firstTurnTs || callSummary?.callTime,
        durationSeconds: transcript.callMeta?.twilioDurationSeconds
      },
      turns: transcript.turns || [],
      events: transcript.trace || [],
      trace: transcript.trace || []
    };

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
    
    const intelligence = await CallIntelligenceService.getCallIntelligence(callSid);
    
    if (!intelligence) {
      return res.status(404).json({
        success: false,
        error: 'Intelligence not found for this call'
      });
    }

    res.json({
      success: true,
      intelligence
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
    const { page, limit, status, sortBy, autoAnalyze = 'true' } = req.query;

    console.log('[CallIntelligence] Fetching list for company:', companyId);

    let result = await CallIntelligenceService.getIntelligenceList(companyId, {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 50,
      status,
      sortBy
    });

    console.log('[CallIntelligence] Found', result.items.length, 'analyzed calls');

    if (result.items.length === 0 && autoAnalyze === 'true') {
      console.log('[CallIntelligence] No analyzed calls found, fetching recent calls for auto-analysis...');
      const recentCalls = await CallSummary.find({ companyId })
        .sort({ callTime: -1 })
        .limit(50)
        .select('callSid fromPhone toPhone callTime events turns')
        .lean();

      console.log('[CallIntelligence] Found', recentCalls.length, 'recent calls in CallSummary');
      
      if (recentCalls.length > 0) {
        const sampleCall = recentCalls[0];
        console.log('[CallIntelligence] Sample call structure:', {
          callSid: sampleCall.callSid,
          hasEvents: !!(sampleCall.events && sampleCall.events.length > 0),
          eventsCount: sampleCall.events?.length || 0,
          hasTurns: !!(sampleCall.turns && sampleCall.turns.length > 0),
          turnsCount: sampleCall.turns?.length || 0
        });
      }

      if (recentCalls.length > 0) {
        const callSidsToAnalyze = recentCalls.map(c => c.callSid);
        
        const transcripts = await CallTranscriptV2.find({
          callSid: { $in: callSidsToAnalyze }
        }).lean();

        console.log('[CallIntelligence] Found', transcripts.length, 'transcripts in CallTranscriptV2');

        const fullSummaries = await CallSummary.find({
          callSid: { $in: callSidsToAnalyze }
        })
        .select('callSid fromPhone toPhone callTime events turns')
        .lean();

        const summaryMap = new Map(fullSummaries.map(s => [s.callSid, s]));

        const callTracesToAnalyze = [];

        if (transcripts.length > 0) {
          for (const transcript of transcripts) {
            const summary = summaryMap.get(transcript.callSid);
            callTracesToAnalyze.push({
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
            });
          }
        } else {
          console.log('[CallIntelligence] No CallTranscriptV2 found, using CallSummary events as fallback');
          for (const summary of fullSummaries) {
            if (summary.events && summary.events.length > 0) {
              callTracesToAnalyze.push({
                callSid: summary.callSid,
                companyId,
                call: {
                  callSid: summary.callSid,
                  fromPhone: summary.fromPhone,
                  toPhone: summary.toPhone,
                  startTime: summary.callTime,
                  durationSeconds: 0
                },
                turns: summary.turns || [],
                events: summary.events || [],
                trace: summary.events || []
              });
            }
          }
        }

        console.log('[CallIntelligence] Prepared', callTracesToAnalyze.length, 'calls for analysis');

        const analysisPromises = callTracesToAnalyze.slice(0, 20).map(async (callTrace) => {
          try {
            return await CallIntelligenceService.analyzeCall(callTrace, {
              useGPT4: false,
              mode: 'quick'
            });
          } catch (err) {
            console.error(`[CallIntelligence] Failed to analyze ${callTrace.callSid}:`, err.message);
            return null;
          }
        });

        const results = await Promise.allSettled(analysisPromises);
        const successful = results.filter(r => r.status === 'fulfilled').length;
        
        console.log('[CallIntelligence] Auto-analyzed', successful, 'out of', results.length, 'calls');

        result = await CallIntelligenceService.getIntelligenceList(companyId, {
          page: parseInt(page) || 1,
          limit: parseInt(limit) || 50,
          status,
          sortBy
        });
        
        console.log('[CallIntelligence] After auto-analysis, found', result.items.length, 'intelligence records');
      } else {
        console.log('[CallIntelligence] No recent calls found in CallSummary');
      }
    }

    console.log('[CallIntelligence] Returning', result.items.length, 'items to frontend');

    res.json({
      success: true,
      ...result
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

    const [summaryCount, transcriptV2Count, intelligenceCount] = await Promise.all([
      CallSummary.countDocuments({ companyId }),
      CallTranscriptV2.countDocuments({ companyId }),
      require('../../models/CallIntelligence').countDocuments({ companyId })
    ]);

    const recentSummaries = await CallSummary.find({ companyId })
      .sort({ callTime: -1 })
      .limit(5)
      .select('callSid callTime fromPhone events turns')
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
          callSid: s.callSid,
          callTime: s.callTime,
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
