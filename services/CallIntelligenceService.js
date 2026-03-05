/**
 * Call Intelligence Service
 * 
 * Core business logic for analyzing calls, detecting issues,
 * and generating actionable recommendations.
 * 
 * Can operate with or without GPT-4 (rule-based fallback).
 * 
 * @module services/CallIntelligenceService
 */

const CallIntelligence = require('../models/CallIntelligence');
const GPT4AnalysisService = require('./GPT4AnalysisService');
const mongoose = require('mongoose');

class CallIntelligenceService {
  
  /**
   * Analyze a call and store intelligence data
   * @param {Object} callTrace - Full call trace from database
   * @param {Object} options - Analysis options
   * @returns {Promise<Object>} Intelligence analysis
   */
  async analyzeCall(callTrace, options = {}) {
    const { useGPT4 = false, mode = 'full' } = options;
    
    const callSid = callTrace.call?.callSid || callTrace.callSid;
    const companyId = callTrace.companyId;

    if (!callSid || !companyId) {
      throw new Error('Invalid call trace: missing callSid or companyId');
    }

    const existing = await CallIntelligence.findOne({ callSid });
    if (existing && !options.forceReanalyze) {
      return existing;
    }

    let analysis;
    let gpt4Metadata = { enabled: false };

    if (useGPT4 && GPT4AnalysisService.getStatus().enabled) {
      try {
        const gpt4Result = await GPT4AnalysisService.analyzeCall(callTrace, { mode });
        analysis = gpt4Result;
        gpt4Metadata = gpt4Result.gpt4Metadata;
        delete analysis.gpt4Metadata;
      } catch (error) {
        console.warn(`⚠️  GPT-4 analysis failed for ${callSid}, falling back to rule-based`);
        analysis = this.ruleBasedAnalysis(callTrace);
      }
    } else {
      analysis = this.ruleBasedAnalysis(callTrace);
    }

    const intelligenceData = {
      callSid,
      companyId,
      analyzedAt: new Date(),
      status: analysis.status,
      issueCount: analysis.issues?.length || 0,
      criticalIssueCount: analysis.issues?.filter(i => i.severity === 'critical').length || 0,
      executiveSummary: analysis.executiveSummary,
      topIssue: analysis.topIssue,
      issues: analysis.issues || [],
      recommendations: analysis.recommendations || [],
      analysis: analysis.analysis,
      gpt4Analysis: gpt4Metadata,
      callMetadata: {
        duration: callTrace.call?.durationSeconds,
        turns: callTrace.turns?.length,
        fromPhone: callTrace.call?.fromPhone,
        startTime: callTrace.call?.startTime
      }
    };

    if (existing) {
      Object.assign(existing, intelligenceData);
      return await existing.save();
    }

    const intelligence = new CallIntelligence(intelligenceData);
    return await intelligence.save();
  }

  /**
   * Rule-based analysis (fallback when GPT-4 is disabled)
   * @param {Object} callTrace - Call trace data
   * @returns {Object} Analysis result
   * @private
   */
  ruleBasedAnalysis(callTrace) {
    const issues = [];
    const recommendations = [];
    let status = 'performing_well';
    let topIssue = 'Call handled correctly';

    const triggerEval = callTrace.events?.find(e => e.kind === 'A2_TRIGGER_EVAL');
    const scrabProcessed = callTrace.events?.find(e => e.kind === 'SCRABENGINE_PROCESSED');
    const pathSelected = callTrace.events?.find(e => e.kind === 'A2_PATH_SELECTED');

    if (!triggerEval || !scrabProcessed) {
      return {
        status: 'needs_improvement',
        topIssue: 'Incomplete trace data',
        executiveSummary: 'Call trace is missing critical analysis events.',
        issues: [],
        recommendations: [],
        analysis: {}
      };
    }

    const triggerMatched = triggerEval.payload?.matched || false;
    const totalTriggers = triggerEval.payload?.totalCards || 0;
    const fallbackPath = pathSelected?.payload?.path === 'FALLBACK_NO_REASON';

    if (!triggerMatched && totalTriggers > 0) {
      status = 'critical';
      topIssue = 'No trigger match';
      
      issues.push({
        id: 'no_trigger_match',
        severity: 'critical',
        category: 'trigger_match',
        title: 'No Trigger Matched',
        description: `System evaluated ${totalTriggers} triggers but found no match. Caller likely used conversational language not captured in trigger keywords.`,
        evidence: {
          triggersEvaluated: totalTriggers,
          triggersMatched: 0,
          normalizedInput: scrabProcessed.payload?.normalizedPreview
        },
        affectedComponent: 'Trigger System (No specific trigger - need to add keywords)'
      });

      recommendations.push({
        id: 'add_conversational_keywords',
        type: 'add_keyword',
        priority: 'immediate',
        title: 'Add Conversational Keywords',
        description: 'Review caller input and add common conversational patterns to relevant triggers.',
        copyableContent: this.extractMissingKeywords(scrabProcessed.payload),
        targetTrigger: 'Check normalized input to identify which trigger should match'
      });
    } else if (triggerMatched) {
      const matchedCardId = triggerEval.payload?.cardId;
      const matchedCardLabel = triggerEval.payload?.cardLabel;
      
      issues.push({
        id: 'trigger_matched_successfully',
        severity: 'low',
        category: 'trigger_match',
        title: 'Trigger Matched Successfully',
        description: `Trigger "${matchedCardLabel}" matched correctly.`,
        affectedComponent: matchedCardId || matchedCardLabel
      });
    }

    if (fallbackPath) {
      if (status === 'performing_well') {
        status = 'needs_improvement';
        topIssue = 'Generic fallback used';
      }

      issues.push({
        id: 'fallback_used',
        severity: 'high',
        category: 'response_quality',
        title: 'Fallback Response Used',
        description: 'System fell back to generic response instead of providing specific help.',
        evidence: {
          path: pathSelected?.payload?.path,
          reason: pathSelected?.payload?.reason
        }
      });
    }

    const scrabQuality = scrabProcessed.payload?.quality;
    if (scrabQuality && !scrabQuality.passed) {
      issues.push({
        id: 'scrabengine_quality_failed',
        severity: 'medium',
        category: 'scrabengine',
        title: 'ScrabEngine Quality Check Failed',
        description: `Input quality assessment failed: ${scrabQuality.reason}`,
        evidence: scrabQuality
      });
    }

    const executiveSummary = this.generateExecutiveSummary(issues, triggerMatched, fallbackPath);

    return {
      status,
      topIssue,
      executiveSummary,
      issues,
      recommendations,
      analysis: {
        triggerAnalysis: {
          totalTriggersEvaluated: totalTriggers,
          triggersMatched: triggerMatched ? 1 : 0,
          matchRate: triggerMatched ? 100 : 0,
          topIssue: triggerMatched ? null : 'No conversational keywords',
          tokensDelivered: (scrabProcessed.payload?.transformations || []).map(t => t.value || String(t)),
          normalizedInput: scrabProcessed.payload?.normalizedPreview || ''
        },
        scrabEnginePerformance: this.analyzeScrabEngine(scrabProcessed.payload),
        callFlowAnalysis: {
          totalTurns: callTrace.turns?.length || 0,
          pathsSelected: [pathSelected?.payload?.path],
          fallbackUsed: fallbackPath,
          responseQuality: triggerMatched ? 'good' : 'suboptimal'
        }
      },
      confidence: 0.85
    };
  }

  /**
   * Analyze ScrabEngine performance
   * @param {Object} scrabPayload - ScrabEngine processed payload
   * @returns {Object} Performance analysis
   * @private
   */
  analyzeScrabEngine(scrabPayload) {
    if (!scrabPayload) {
      return { overallStatus: 'unknown', stages: {}, totalProcessingTime: 0 };
    }

    const { quality, performance } = scrabPayload;
    
    return {
      overallStatus: quality?.passed ? 'excellent' : 'needs_improvement',
      stages: {
        fillerRemoval: { status: 'success', details: 'Completed' },
        vocabularyNormalization: { status: 'success', details: 'Completed' },
        tokenExpansion: { status: 'success', details: 'Completed' },
        entityExtraction: { status: 'partial', details: 'Completed' },
        qualityAssessment: { 
          status: quality?.passed ? 'success' : 'failed',
          details: quality?.reason || 'Unknown'
        }
      },
      totalProcessingTime: performance?.totalTimeMs || 0
    };
  }

  /**
   * Extract missing keywords from normalized input
   * @param {Object} scrabPayload - ScrabEngine payload
   * @returns {string} Suggested keywords
   * @private
   */
  extractMissingKeywords(scrabPayload) {
    const normalized = scrabPayload?.normalizedPreview || '';
    const commonPhrases = [
      'get somebody out',
      'send someone',
      'come out',
      'need help',
      'having issues'
    ];

    const found = commonPhrases.filter(phrase => 
      normalized.toLowerCase().includes(phrase)
    );

    return found.length > 0 
      ? `Keywords to add:\n${found.map(p => `• ${p}`).join('\n')}`
      : 'Review caller input for conversational patterns';
  }

  /**
   * Generate executive summary
   * @param {Array} issues - Detected issues
   * @param {boolean} triggerMatched - Whether trigger matched
   * @param {boolean} fallbackUsed - Whether fallback was used
   * @returns {string} Summary text
   * @private
   */
  generateExecutiveSummary(issues, triggerMatched, fallbackUsed) {
    if (issues.length === 0) {
      return 'Call was handled correctly with appropriate trigger match and response.';
    }

    if (!triggerMatched && fallbackUsed) {
      return 'Call failed to match any triggers and fell back to generic response. Caller likely used conversational language not captured in trigger keywords.';
    }

    if (fallbackUsed) {
      return 'System matched a trigger but still used fallback response, indicating potential response configuration issue.';
    }

    return `Call had ${issues.length} issue(s) that need attention.`;
  }

  /**
   * Get intelligence for a call
   * @param {string} callSid - Call SID
   * @returns {Promise<Object|null>}
   */
  async getCallIntelligence(callSid) {
    return await CallIntelligence.findOne({ callSid });
  }

  /**
   * Get intelligence summary for company
   * @param {string} companyId - Company ID
   * @param {Object} filters - Filter options
   * @returns {Promise<Object>}
   */
  async getCompanySummary(companyId, filters = {}) {
    const dateRange = this.buildDateRange(filters.timeRange);
    
    const summary = await CallIntelligence.getCompanySummary(companyId, dateRange);
    
    const recentCritical = await CallIntelligence.find({
      companyId,
      status: 'critical',
      ...dateRange
    })
    .sort({ analyzedAt: -1 })
    .limit(5)
    .select('callSid topIssue analyzedAt');

    return {
      ...summary,
      recentCritical
    };
  }

  /**
   * Get paginated intelligence list
   * @param {string} companyId - Company ID
   * @param {Object} options - Query options
   * @returns {Promise<Object>}
   */
  async getIntelligenceList(companyId, options = {}) {
    const {
      page = 1,
      limit = 50,
      status,
      sortBy = '-analyzedAt'
    } = options;

    const query = { companyId };
    if (status) {
      query.status = status;
    }

    const [items, total] = await Promise.all([
      CallIntelligence.find(query)
        .sort(sortBy)
        .skip((page - 1) * limit)
        .limit(limit)
        .select('-analysis.scrabEnginePerformance.stages -issues.evidence'),
      CallIntelligence.countDocuments(query)
    ]);

    return {
      items,
      total,
      page,
      pages: Math.ceil(total / limit)
    };
  }

  /**
   * Build date range query
   * @param {string} timeRange - Time range (today, week, month)
   * @returns {Object} Date range query
   * @private
   */
  buildDateRange(timeRange) {
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
      analyzedAt: {
        $gte: start,
        $lte: new Date()
      }
    };
  }

  /**
   * Mark recommendation as implemented
   * @param {string} callSid - Call SID
   * @param {string} recommendationId - Recommendation ID
   * @param {string} implementedBy - User who implemented
   * @returns {Promise<Object>}
   */
  async markRecommendationImplemented(callSid, recommendationId, implementedBy) {
    const intelligence = await CallIntelligence.findOne({ callSid });
    if (!intelligence) {
      throw new Error('Call intelligence not found');
    }

    return await intelligence.markRecommendationImplemented(recommendationId, implementedBy);
  }
}

module.exports = new CallIntelligenceService();
