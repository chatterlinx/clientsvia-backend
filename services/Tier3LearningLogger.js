/**
 * ============================================================================
 * TIER 3 LEARNING LOGGER - ENHANCED WITH OPENAI ANALYSIS
 * ============================================================================
 * 
 * PURPOSE: Log every Tier 3 (LLM) call to ProductionLLMSuggestion for learning
 * 
 * FEATURES:
 * - Fire-and-forget logging (never blocks caller)
 * - OpenAI analyzes WHY Tier 3 was needed
 * - Generates human-readable root cause + suggestion
 * - Auto-calculates priority, severity, impact score
 * - Supports 3 call sources: template-test, company-test, production
 * 
 * ============================================================================
 */

const ProductionLLMSuggestion = require('../models/ProductionLLMSuggestion');
const logger = require('../utils/logger');

// Use centralized OpenAI client (handles missing API key gracefully)
const openai = require('../config/openai');

/**
 * Fire-and-forget logger for Tier 3 calls.
 * DO NOT await this in the request/response path – just call and .catch().
 * 
 * @param {Object} params - Logging parameters
 * @param {string} params.callSource - 'template-test' | 'company-test' | 'production'
 * @param {Object} params.template - { _id, name }
 * @param {Object} params.company - { _id, name } or null for global template test
 * @param {Object} params.tierResults - { finalTier, finalConfidence, tier1Score, tier2Score, ... }
 * @param {Object} params.timing - { tier1LatencyMs, tier2LatencyMs, tier3LatencyMs, overallLatencyMs, maxDeadAirMs, avgDeadAirMs }
 * @param {string} params.transcript - Full call transcript or last utterance
 * @param {string} params.agentReply - Text sent back to caller
 * @param {Object} params.meta - { callSid, scenarioName, categoryName, llmModel, tokens, costUsd }
 */
async function logTier3Suggestion({
  callSource,        // 'template-test' | 'company-test' | 'production'
  template,          // { _id, name }
  company,           // { _id, name } or null for global template test
  tierResults,       // { finalTier, finalConfidence, tier1Score, tier2Score, ... }
  timing,            // { tier1LatencyMs, tier2LatencyMs, tier3LatencyMs, overallLatencyMs, maxDeadAirMs, avgDeadAirMs }
  transcript,        // full call transcript or last utterance
  agentReply,        // text sent back to caller
  meta = {},         // { callSid, scenarioName, categoryName, llmModel, tokens, costUsd }
}) {
  try {
    logger.info('[Tier3LearningLogger] Logging Tier 3 suggestion', {
      callSource,
      template: template?.name,
      company: company?.name
    });

    // 1) Derive a suggestionType + severity guess from routing info
    const {
      finalTier,
      finalConfidence,
      tier1Score,
      tier1Threshold,
      tier2Score,
      tier2Threshold,
      matchedScenarioName,
      matchedCategoryName,
      matchedTrigger,
    } = tierResults || {};

    let suggestionType = 'ADD_KEYWORDS';
    let severity = 'medium';
    let priority = 'medium';

    if (finalTier === 'tier3') {
      // If Tier 1 was close but not enough → more triggers
      if (typeof tier1Score === 'number' && typeof tier1Threshold === 'number' &&
          tier1Score < tier1Threshold && tier1Score > tier1Threshold - 0.1) {
        suggestionType = 'ADD_KEYWORDS';
        severity = 'high';
        priority = 'high';
      }
      // If Tier 2 was low/confused → semantic tuning
      else if (typeof tier2Score === 'number' && typeof tier2Threshold === 'number' &&
               tier2Score < tier2Threshold) {
        suggestionType = 'TWEAK_REPLY_TONE';
        severity = 'high';
        priority = 'high';
      }
      // If timing is bad → latency / dead-air focus
      if (timing && timing.tier3LatencyMs >= 1500) {
        suggestionType = 'LATENCY_WARNING';
        severity = 'high';
      }
      if (timing && timing.maxDeadAirMs >= 3000) {
        suggestionType = 'OTHER';
        severity = 'critical';
        priority = 'high';
      }
    }

    // 2) Ask LLM for a human-readable root cause + suggestion text
    const llmPrompt = [
      {
        role: 'system',
        content:
          'You are an analytics expert helping improve a 3-tier phone AI (rules, semantic, LLM fallback). ' +
          'Given call context and tier scores, explain WHY Tier 3 was needed and WHAT to change in the rules/template. ' +
          'Be concise (2-3 sentences).',
      },
      {
        role: 'user',
        content: JSON.stringify(
          {
            callSource,
            templateName: template?.name,
            companyName: company?.name,
            tierResults,
            timing,
            customerPhrase: transcript,
            agentReply,
            meta,
          },
          null,
          2
        ),
      },
    ];

    let rootCauseReason = '';
    let suggestion = '';
    let changeImpactScore = 3.0;

    try {
      const completion = await openai.chat.completions.create({
        model: meta.llmModel || 'gpt-4o-mini',
        messages: llmPrompt,
        max_tokens: 220,
        temperature: 0.2,
      });

      const text = completion.choices?.[0]?.message?.content?.trim() || '';
      rootCauseReason = text;

      // Crude impact scoring based on wording
      const lower = text.toLowerCase();
      if (lower.includes('critical') || lower.includes('frequent') || lower.includes('many calls')) {
        changeImpactScore = 4.5;
      } else if (lower.includes('sometimes') || lower.includes('occasional')) {
        changeImpactScore = 3.5;
      } else {
        changeImpactScore = 2.5;
      }

      suggestion = text; // For now, use same text; later we can split into separate fields
      
      logger.info('[Tier3LearningLogger] OpenAI analysis complete', {
        suggestionType,
        severity,
        changeImpactScore
      });
    } catch (err) {
      logger.error('[Tier3LearningLogger] LLM analysis failed, falling back:', err.message);
      rootCauseReason = 'Tier 3 had to handle this call. Review triggers and semantic matching for this phrase.';
      suggestion = 'Review and tune rules/keywords/semantic matching for this scenario.';
      changeImpactScore = 3.0;
    }

    // 3) Build document
    const doc = new ProductionLLMSuggestion({
      callSource,
      templateId: template?._id || null,
      templateName: template?.name || 'Unknown Template',

      companyId: company?._id || null,
      companyName: company?.name || null,

      scenarioName: meta.scenarioName || matchedScenarioName || null,
      categoryName: meta.categoryName || matchedCategoryName || null,

      suggestionType,
      suggestionSummary: suggestion?.substring(0, 100) || `${suggestionType}: ${rootCauseReason?.substring(0, 80)}`,
      rootCauseReason,

      customerPhrase: transcript,
      agentResponseSnippet: agentReply,

      tier1Score: typeof tier1Score === 'number' ? tier1Score : null,
      tier1Threshold: typeof tier1Threshold === 'number' ? tier1Threshold : null,
      tier2Score: typeof tier2Score === 'number' ? tier2Score : null,
      tier2Threshold: typeof tier2Threshold === 'number' ? tier2Threshold : null,

      tier1LatencyMs: timing?.tier1LatencyMs ?? null,
      tier2LatencyMs: timing?.tier2LatencyMs ?? null,
      tier3LatencyMs: timing?.tier3LatencyMs ?? null,
      overallLatencyMs: timing?.overallLatencyMs ?? null,
      maxDeadAirMs: timing?.maxDeadAirMs ?? null,
      avgDeadAirMs: timing?.avgDeadAirMs ?? null,

      llmModel: meta.llmModel || 'gpt-4o-mini',
      tokens: meta.tokens ?? null,
      costUsd: meta.costUsd ?? null,

      priority,
      severity,
      status: 'pending',

      changeImpactScore,
      similarCallCount: meta.similarCallCount ?? 1,

      callSid: meta.callSid || null,
      callDate: new Date(),
    });

    await doc.save();
    
    logger.info('[Tier3LearningLogger] ✅ Saved suggestion', {
      id: doc._id,
      callSource,
      template: template?.name,
      company: company?.name,
      suggestionType,
      severity,
      priority
    });
    
    return doc;
  } catch (err) {
    logger.error('[Tier3LearningLogger] ❌ Failed to log suggestion:', err);
    throw err; // Caller will catch this
  }
}

module.exports = {
  logTier3Suggestion,
};

