/**
 * ============================================================================
 * LLM LEARNING LOGGER SERVICE
 * ============================================================================
 * 
 * PURPOSE: Log Tier 3 (LLM) events into the LLM Learning Console
 * 
 * FLOW:
 * 1. Caller triggers 3-Tier intelligence system
 * 2. If Tier 3 (LLM) is needed, this logs why + metrics
 * 3. Admin reviews in LLM Learning Console
 * 4. Admin applies fixes to templates
 * 5. Future calls use improved Tier 1/2 (cheaper, faster)
 * 
 * CRITICAL: This NEVER breaks a live call. If logging fails, we swallow
 * the error and let the call continue normally.
 * 
 * ============================================================================
 */

const ProductionLLMSuggestion = require('../models/ProductionLLMSuggestion');
const logger = require('../utils/logger');

/**
 * Log a Tier 3 learning event into the LLM Learning Console.
 *
 * Everything is optional - we try our best with what we have,
 * so this NEVER breaks a live call if something is missing.
 * 
 * @param {Object} params - All context about the call and LLM usage
 * @param {Object} params.callContext - Who/where/when
 * @param {Object} params.tierContext - Tier routing metrics
 * @param {Object} params.llmContext - LLM model/cost/response
 * @param {Object} params.suggestion - What to improve
 */
async function logTier3Suggestion({
  callContext = {},
  tierContext = {},
  llmContext = {},
  suggestion = {},
}) {
  try {
    logger.info('[LLM LEARNING] Logging Tier 3 suggestion...');
    
    // ========================================================================
    // CALL CONTEXT (Who / Where / When)
    // ========================================================================
    const {
      templateId,
      templateName,
      companyId,
      companyName,
      callSource,        // 'template-test' | 'company-test' | 'production'
      callId,
      callSid,
      callDate,
      callTranscript,
    } = callContext;

    // ========================================================================
    // TIER CONTEXT (Routing Metrics)
    // ========================================================================
    const {
      tier1Score,
      tier1Threshold,
      tier1LatencyMs,
      tier2Score,
      tier2Threshold,
      tier2LatencyMs,
      tier3LatencyMs,
      overallLatencyMs,
      maxDeadAirMs,
      avgDeadAirMs,
      scenarioId,
      scenarioName,
      categoryName,
    } = tierContext;

    // ========================================================================
    // LLM CONTEXT (Model / Cost / Response)
    // ========================================================================
    const {
      llmModel,
      tokens,
      costUsd,
      customerPhrase,
      agentResponseSnippet,
      llmResponse,
    } = llmContext;

    // ========================================================================
    // SUGGESTION (What to Improve)
    // ========================================================================
    const {
      suggestionType,
      suggestedValue,
      suggestionSummary,
      rootCauseReason,
      priority = 'medium',
      severity = 'medium',
      changeImpactScore = 0,
      similarCallCount = 1,
      status = 'pending',
    } = suggestion;

    // ========================================================================
    // CREATE SUGGESTION RECORD
    // ========================================================================
    const newSuggestion = await ProductionLLMSuggestion.create({
      // Who / where
      templateId,
      templateName,
      companyId,
      companyName,
      callSource: callSource || 'production',
      callId: callId || callSid,
      callSid,
      callDate: callDate || new Date(),

      // Scenario / category
      scenarioId,
      scenarioName,
      categoryName,

      // Tier metrics
      tier1Score,
      tier1Threshold,
      tier1LatencyMs,
      tier2Score,
      tier2Threshold,
      tier2LatencyMs,
      tier3LatencyMs,
      overallLatencyMs: overallLatencyMs || (tier1LatencyMs || 0) + (tier2LatencyMs || 0) + (tier3LatencyMs || 0),
      maxDeadAirMs,
      avgDeadAirMs,

      // LLM info
      llmModel: llmModel || 'gpt-4o-mini',
      tokens,
      costUsd: costUsd || 0,
      customerPhrase,
      agentResponseSnippet,
      llmResponse,
      fullCallTranscript: callTranscript,

      // The suggestion itself
      suggestionType: suggestionType || 'OTHER',
      suggestedValue,
      suggestionSummary: suggestionSummary || `${suggestionType || 'Tier 3 needed'}: ${(rootCauseReason || '').slice(0, 100)}`,
      rootCauseReason: rootCauseReason || 'Tier 3 was required because Tier 1/2 scores were below thresholds or no scenario fully matched.',
      priority,
      severity,
      changeImpactScore,
      similarCallCount,

      // Workflow status
      status,
    });

    logger.info(`[LLM LEARNING] ✅ Suggestion created: ${newSuggestion._id}`, {
      templateName,
      companyName: companyName || '(Global)',
      callSource,
      suggestionType,
      priority,
      severity,
      costUsd
    });

    return newSuggestion;

  } catch (err) {
    // CRITICAL: Swallow error so we NEVER break a live call
    logger.error('[LLM LEARNING] ❌ Failed to log Tier 3 suggestion', {
      error: err.message,
      stack: err.stack,
      callId: callContext?.callId || callContext?.callSid
    });
    
    // Return null but don't throw - call must continue
    return null;
  }
}

/**
 * Helper: Determine suggestion type based on context
 * 
 * This is a smart classifier that looks at tier scores and context
 * to suggest what kind of improvement is needed.
 */
function determineSuggestionType(context = {}) {
  const { tier1Score, tier1Threshold, tier2Score, tier2Threshold, matchedScenario } = context;
  
  // If Tier 1 failed badly, likely missing keywords
  if (tier1Score != null && tier1Score < 0.5) {
    return 'ADD_KEYWORDS';
  }
  
  // If Tier 1 was okay but Tier 2 failed, might need synonyms
  if (tier1Score != null && tier1Score >= 0.5 && tier1Score < (tier1Threshold || 0.8)) {
    return 'ADD_SYNONYMS';
  }
  
  // If Tier 2 failed and no scenario matched, might need new scenario
  if (!matchedScenario || (tier2Score != null && tier2Score < 0.5)) {
    return 'NEW_SCENARIO';
  }
  
  // If both tiers had reasonable scores but still failed, might be overlap
  if (tier1Score > 0.6 && tier2Score > 0.6) {
    return 'OVERLAP_WARNING';
  }
  
  // Default: general coverage gap
  return 'COVERAGE_GAP';
}

/**
 * Helper: Calculate priority based on metrics
 */
function calculatePriority(context = {}) {
  const { callSource, tier1Score, overallLatencyMs, maxDeadAirMs } = context;
  
  // Production calls with bad latency = critical
  if (callSource === 'production') {
    if (overallLatencyMs >= 2000 || maxDeadAirMs >= 4000) {
      return 'critical';
    }
    if (overallLatencyMs >= 1500 || maxDeadAirMs >= 3000) {
      return 'high';
    }
  }
  
  // Very low tier1 scores = high priority (template has major gaps)
  if (tier1Score != null && tier1Score < 0.3) {
    return 'high';
  }
  
  // Default
  return 'medium';
}

/**
 * Helper: Calculate severity based on impact
 */
function calculateSeverity(context = {}) {
  const { tier1Score, tier2Score, overallLatencyMs, callSource } = context;
  
  // Both tiers failed badly + slow = critical
  if (tier1Score < 0.4 && tier2Score < 0.4 && overallLatencyMs >= 1500) {
    return 'critical';
  }
  
  // Production call with poor performance = high severity
  if (callSource === 'production' && (tier1Score < 0.5 || overallLatencyMs >= 1500)) {
    return 'high';
  }
  
  // Test calls or moderate issues = medium
  if (callSource === 'template-test' || callSource === 'company-test') {
    return 'medium';
  }
  
  return 'medium';
}

/**
 * Helper: Calculate change impact score (0-5)
 */
function calculateChangeImpactScore(context = {}) {
  const { priority, severity, callSource, tier1Score } = context;
  
  let score = 0;
  
  // Priority contribution
  if (priority === 'critical') score += 2;
  else if (priority === 'high') score += 1.5;
  else if (priority === 'medium') score += 1;
  
  // Severity contribution
  if (severity === 'critical') score += 2;
  else if (severity === 'high') score += 1.5;
  else if (severity === 'medium') score += 1;
  
  // Production calls matter more
  if (callSource === 'production') score += 1;
  
  // Very low tier1 scores = high impact fix
  if (tier1Score != null && tier1Score < 0.3) score += 0.5;
  
  return Math.min(score, 5); // Cap at 5
}

/**
 * Convenience wrapper with auto-calculated fields
 * 
 * Use this when you want the logger to be smart about classifying
 * the suggestion type, priority, severity, etc.
 */
async function logTier3SuggestionSmart(params = {}) {
  const { callContext = {}, tierContext = {}, llmContext = {}, suggestion = {} } = params;
  
  // Auto-calculate if not provided
  const suggestionType = suggestion.suggestionType || determineSuggestionType({
    tier1Score: tierContext.tier1Score,
    tier1Threshold: tierContext.tier1Threshold,
    tier2Score: tierContext.tier2Score,
    tier2Threshold: tierContext.tier2Threshold,
    matchedScenario: tierContext.scenarioId,
  });
  
  const priority = suggestion.priority || calculatePriority({
    callSource: callContext.callSource,
    tier1Score: tierContext.tier1Score,
    overallLatencyMs: tierContext.overallLatencyMs,
    maxDeadAirMs: tierContext.maxDeadAirMs,
  });
  
  const severity = suggestion.severity || calculateSeverity({
    tier1Score: tierContext.tier1Score,
    tier2Score: tierContext.tier2Score,
    overallLatencyMs: tierContext.overallLatencyMs,
    callSource: callContext.callSource,
  });
  
  const changeImpactScore = suggestion.changeImpactScore ?? calculateChangeImpactScore({
    priority,
    severity,
    callSource: callContext.callSource,
    tier1Score: tierContext.tier1Score,
  });
  
  return logTier3Suggestion({
    callContext,
    tierContext,
    llmContext,
    suggestion: {
      ...suggestion,
      suggestionType,
      priority,
      severity,
      changeImpactScore,
    },
  });
}

module.exports = {
  logTier3Suggestion,
  logTier3SuggestionSmart,
  determineSuggestionType,
  calculatePriority,
  calculateSeverity,
  calculateChangeImpactScore,
};

