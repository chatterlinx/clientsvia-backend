// ============================================================================
// LLM SUGGESTION ANALYZER SERVICE
// ============================================================================
// Purpose: Analyzes Tier 3 LLM calls and generates improvement suggestions
// Uses: OpenAI GPT-4 to identify patterns and suggest template enhancements
// Runs: Background cron job every 5 minutes
// ============================================================================

const OpenAI = require('openai');
const ProductionAICallLog = require('../models/ProductionAICallLog');
const SuggestionKnowledgeBase = require('../models/knowledge/SuggestionKnowledgeBase');
const AdminNotificationService = require('./AdminNotificationService');
const logger = require('../utils/logger');

// ────────────────────────────────────────────────────────────────────────────
// SERVICE CLASS
// ────────────────────────────────────────────────────────────────────────────

class LLMSuggestionAnalyzer {
  constructor() {
    this.openaiClient = null;
    this.isEnabled = process.env.ENABLE_3_TIER_INTELLIGENCE === 'true';
    this.openaiApiKey = process.env.OPENAI_API_KEY;
    this.model = 'gpt-4-turbo';
    
    // Initialize OpenAI client if enabled
    if (this.isEnabled && this.openaiApiKey) {
      this.openaiClient = new OpenAI({ apiKey: this.openaiApiKey });
      logger.info('[LLM SUGGESTION ANALYZER] Initialized with GPT-4');
    } else {
      logger.warn('[LLM SUGGESTION ANALYZER] Disabled (missing ENABLE_3_TIER_INTELLIGENCE or OPENAI_API_KEY)');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // MAIN ANALYSIS METHOD
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Analyze a single call log and generate suggestions
   * @param {Object} callLog - ProductionAICallLog document
   * @returns {Promise<Array>} Array of created suggestions
   */
  async analyzeCall(callLog) {
    logger.info(`[LLM SUGGESTION ANALYZER] Analyzing call: ${callLog.callId}`);

    try {
      // Validate call log
      if (!callLog.tierUsed || callLog.tierUsed !== 3) {
        logger.warn(`[LLM SUGGESTION ANALYZER] Skipping call ${callLog.callId} - not Tier 3`);
        return [];
      }

      // Prepare context for LLM
      const context = this._prepareContext(callLog);

      // Call GPT-4 for analysis
      const llmResponse = await this._callGPT4(context);

      // Parse LLM response (should be JSON)
      const analysis = this._parseLLMResponse(llmResponse);

      // Create suggestions from analysis
      const suggestions = await this._createSuggestions(callLog, analysis);

      // Mark call log as analyzed
      await callLog.markAnalyzed(suggestions.length > 0);

      // Send high-priority notifications
      await this._sendNotifications(suggestions);

      logger.info(`[LLM SUGGESTION ANALYZER] Created ${suggestions.length} suggestions for call ${callLog.callId}`);
      return suggestions;

    } catch (error) {
      logger.error(`[LLM SUGGESTION ANALYZER] Error analyzing call ${callLog.callId}:`, error);

      // Increment analysis attempts
      await callLog.incrementAnalysisAttempts(error);

      // If 3rd failure, send critical notification
      if (callLog.analysisAttempts >= 3) {
        await this._sendFailureNotification(callLog, error);
      }

      throw error;
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CONTEXT PREPARATION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Prepare context for GPT-4 analysis
   * @param {Object} callLog - ProductionAICallLog document
   * @returns {Object} Context object
   */
  _prepareContext(callLog) {
    return {
      transcript: callLog.transcript,
      callerQuery: callLog.callerQuery,
      processedQuery: callLog.processedQuery || callLog.callerQuery,
      
      tier1: {
        attempted: callLog.tier1Result?.attempted || false,
        matched: callLog.tier1Result?.matched || false,
        confidence: callLog.tier1Result?.confidence || 0,
        reason: callLog.tier1Result?.reason || 'Not attempted'
      },

      tier2: {
        attempted: callLog.tier2Result?.attempted || false,
        matched: callLog.tier2Result?.matched || false,
        confidence: callLog.tier2Result?.confidence || 0,
        reason: callLog.tier2Result?.reason || 'Not attempted'
      },

      tier3: {
        matched: callLog.tier3Result?.matched || false,
        confidence: callLog.tier3Result?.confidence || 0,
        matchedScenarioId: callLog.tier3Result?.matchedScenarioId,
        reason: callLog.tier3Result?.reason || '',
        llmReasoning: callLog.tier3Result?.llmReasoning || ''
      },

      metadata: {
        companyId: callLog.companyId,
        templateId: callLog.templateId,
        categoryId: callLog.categoryId,
        scenarioId: callLog.scenarioId,
        callId: callLog.callId,
        timestamp: callLog.timestamp
      }
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // GPT-4 API CALL
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Call GPT-4 with analysis prompt
   * @param {Object} context - Prepared context
   * @returns {Promise<Object>} GPT-4 response
   */
  async _callGPT4(context) {
    if (!this.openaiClient) {
      throw new Error('OpenAI client not initialized');
    }

    const prompt = this._buildPrompt(context);

    logger.info('[LLM SUGGESTION ANALYZER] Calling GPT-4...');
    const startTime = Date.now();

    const response = await this.openaiClient.chat.completions.create({
      model: this.model,
      messages: [
        {
          role: 'system',
          content: 'You are an AI expert analyzing customer service calls to improve AI agent performance. Your task is to identify specific, actionable improvements to prevent future expensive LLM fallbacks.'
        },
        {
          role: 'user',
          content: prompt
        }
      ],
      response_format: { type: 'json_object' },
      temperature: 0.3, // Low temperature for consistent, focused analysis
      max_tokens: 2000
    });

    const responseTime = Date.now() - startTime;
    logger.info(`[LLM SUGGESTION ANALYZER] GPT-4 response received in ${responseTime}ms`);

    return {
      content: response.choices[0].message.content,
      model: response.model,
      tokens: response.usage.total_tokens,
      cost: this._calculateCost(response.usage.total_tokens),
      responseTime
    };
  }

  /**
   * Build GPT-4 analysis prompt
   * @param {Object} context - Prepared context
   * @returns {String} Prompt text
   */
  _buildPrompt(context) {
    return `
# CALL ANALYSIS REQUEST

You are analyzing a customer service call where our AI agent used expensive LLM fallback (Tier 3) instead of cheaper rule-based (Tier 1) or semantic (Tier 2) matching.

Your task: Identify SPECIFIC improvements to prevent future LLM calls.

## CALL DETAILS

**Transcript:**
${context.transcript}

**Original Caller Query:**
"${context.callerQuery}"

**Processed Query (after preprocessing):**
"${context.processedQuery}"

## ROUTING RESULTS

**Tier 1 (Rule-Based Matching):**
- Attempted: ${context.tier1.attempted ? 'Yes' : 'No'}
- Matched: ${context.tier1.matched ? 'Yes' : 'No'}
- Confidence: ${context.tier1.confidence.toFixed(2)}
- Why it failed: ${context.tier1.reason}

**Tier 2 (Semantic Matching):**
- Attempted: ${context.tier2.attempted ? 'Yes' : 'No'}
- Matched: ${context.tier2.matched ? 'Yes' : 'No'}
- Confidence: ${context.tier2.confidence.toFixed(2)}
- Why it failed: ${context.tier2.reason}

**Tier 3 (LLM Fallback - EXPENSIVE):**
- Matched: ${context.tier3.matched ? 'Yes' : 'No'}
- Confidence: ${context.tier3.confidence.toFixed(2)}
- LLM Reasoning: ${context.tier3.llmReasoning}

## YOUR ANALYSIS TASK

Analyze this call and return JSON with the following structure:

{
  "fillerWords": ["um", "like", "you know"],
  "synonymMappings": [
    {
      "colloquial": "thingy on the wall",
      "technical": "thermostat",
      "confidence": 0.95,
      "occurrences": 12
    }
  ],
  "keywordsToAdd": {
    "scenarioId": "${context.tier3.matchedScenarioId || 'null'}",
    "keywords": ["thingy", "wall device", "temperature control"]
  },
  "negativeKeywords": {
    "scenarioId": "${context.tier3.matchedScenarioId || 'null'}",
    "keywords": ["don't need", "not interested"]
  },
  "missingScenario": {
    "name": "Payment Plan Inquiry",
    "category": "Billing & Payment",
    "keywords": ["payment plan", "installments", "monthly payments"],
    "negativeKeywords": ["pay in full", "one payment"],
    "response": "We offer flexible payment plans for repairs over $500...",
    "actionHook": null,
    "behavior": "Professional & Helpful"
  },
  "reasoning": "Full explanation of why Tier 1/2 failed and how these improvements will help...",
  "impact": {
    "similarCallsThisMonth": 12,
    "estimatedMonthlySavings": 5.64,
    "performanceGain": 2785
  }
}

## IMPORTANT RULES

1. **Only suggest improvements that would have prevented this specific LLM call**
2. **Be specific**: Don't say "add more keywords" - list the EXACT keywords
3. **Provide confidence**: How sure are you this will help? (0.0 - 1.0)
4. **Estimate impact**: How many similar calls per month? How much $ saved?
5. **If no improvements needed**: Return empty arrays (not null)
6. **Missing scenario**: Only suggest if there's a clear gap in coverage (not just one call)

Return ONLY valid JSON, no markdown formatting.
`;
  }

  /**
   * Calculate cost based on tokens
   * @param {Number} tokens - Total tokens used
   * @returns {Number} Cost in dollars
   */
  _calculateCost(tokens) {
    // GPT-4-turbo pricing (as of 2024): $0.01 per 1K input tokens, $0.03 per 1K output tokens
    // Simplified: average $0.02 per 1K tokens
    return (tokens / 1000) * 0.02;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RESPONSE PARSING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Parse LLM response (JSON)
   * @param {Object} llmResponse - GPT-4 response
   * @returns {Object} Parsed analysis
   */
  _parseLLMResponse(llmResponse) {
    try {
      const parsed = JSON.parse(llmResponse.content);
      
      // Add metadata from response
      parsed.llmModel = llmResponse.model;
      parsed.llmTokens = llmResponse.tokens;
      parsed.llmCost = llmResponse.cost;

      return parsed;
    } catch (error) {
      logger.error('[LLM SUGGESTION ANALYZER] Failed to parse GPT-4 response:', error);
      logger.error('[LLM SUGGESTION ANALYZER] Raw response:', llmResponse.content);
      throw new Error('Invalid JSON response from GPT-4');
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // SUGGESTION CREATION
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Create suggestions from LLM analysis
   * @param {Object} callLog - ProductionAICallLog document
   * @param {Object} analysis - Parsed LLM analysis
   * @returns {Promise<Array>} Created suggestions
   */
  async _createSuggestions(callLog, analysis) {
    const suggestions = [];

    // 1. Filler words suggestion
    if (analysis.fillerWords && analysis.fillerWords.length > 0) {
      const suggestion = await SuggestionKnowledgeBase.create({
        companyId: callLog.companyId,
        templateId: callLog.templateId,
        categoryId: callLog.categoryId,
        scenarioId: callLog.scenarioId,
        callLogId: callLog._id,
        type: 'filler-words',
        confidence: 0.7, // Filler words are generally safe to add
        improvements: {
          fillerWords: analysis.fillerWords
        },
        llmReasoning: analysis.reasoning,
        llmModel: analysis.llmModel,
        llmTokens: analysis.llmTokens,
        llmCost: analysis.llmCost,
        impact: this._buildImpact(analysis.impact, 'filler-words'),
        status: 'pending'
      });
      suggestions.push(suggestion);
    }

    // 2. Synonym mappings
    if (analysis.synonymMappings && analysis.synonymMappings.length > 0) {
      for (const mapping of analysis.synonymMappings) {
        const suggestion = await SuggestionKnowledgeBase.create({
          companyId: callLog.companyId,
          templateId: callLog.templateId,
          categoryId: callLog.categoryId,
          scenarioId: callLog.scenarioId,
          callLogId: callLog._id,
          type: 'synonym',
          confidence: mapping.confidence || 0.8,
          improvements: {
            synonymMapping: {
              colloquial: mapping.colloquial,
              technical: mapping.technical,
              additionalMappings: []
            }
          },
          llmReasoning: analysis.reasoning,
          llmModel: analysis.llmModel,
          llmTokens: analysis.llmTokens,
          llmCost: analysis.llmCost,
          impact: this._buildImpact(analysis.impact, 'synonym'),
          status: 'pending'
        });
        suggestions.push(suggestion);
      }
    }

    // 3. Keywords to add
    if (analysis.keywordsToAdd && analysis.keywordsToAdd.keywords && analysis.keywordsToAdd.keywords.length > 0) {
      const suggestion = await SuggestionKnowledgeBase.create({
        companyId: callLog.companyId,
        templateId: callLog.templateId,
        categoryId: callLog.categoryId,
        scenarioId: analysis.keywordsToAdd.scenarioId || callLog.scenarioId,
        callLogId: callLog._id,
        type: 'keywords',
        confidence: 0.75,
        improvements: {
          keywords: {
            scenarioId: analysis.keywordsToAdd.scenarioId || callLog.scenarioId,
            scenarioName: 'Scenario', // Will be populated in frontend
            keywordsToAdd: analysis.keywordsToAdd.keywords,
            currentKeywords: []
          }
        },
        llmReasoning: analysis.reasoning,
        llmModel: analysis.llmModel,
        llmTokens: analysis.llmTokens,
        llmCost: analysis.llmCost,
        impact: this._buildImpact(analysis.impact, 'keywords'),
        status: 'pending'
      });
      suggestions.push(suggestion);
    }

    // 4. Negative keywords
    if (analysis.negativeKeywords && analysis.negativeKeywords.keywords && analysis.negativeKeywords.keywords.length > 0) {
      const suggestion = await SuggestionKnowledgeBase.create({
        companyId: callLog.companyId,
        templateId: callLog.templateId,
        categoryId: callLog.categoryId,
        scenarioId: analysis.negativeKeywords.scenarioId || callLog.scenarioId,
        callLogId: callLog._id,
        type: 'negative-keywords',
        confidence: 0.8,
        improvements: {
          negativeKeywords: {
            scenarioId: analysis.negativeKeywords.scenarioId || callLog.scenarioId,
            scenarioName: 'Scenario',
            negativeKeywordsToAdd: analysis.negativeKeywords.keywords,
            currentNegativeKeywords: []
          }
        },
        llmReasoning: analysis.reasoning,
        llmModel: analysis.llmModel,
        llmTokens: analysis.llmTokens,
        llmCost: analysis.llmCost,
        impact: this._buildImpact(analysis.impact, 'negative-keywords'),
        status: 'pending'
      });
      suggestions.push(suggestion);
    }

    // 5. Missing scenario
    if (analysis.missingScenario && analysis.missingScenario.name) {
      const suggestion = await SuggestionKnowledgeBase.create({
        companyId: callLog.companyId,
        templateId: callLog.templateId,
        categoryId: callLog.categoryId,
        callLogId: callLog._id,
        type: 'missing-scenario',
        confidence: 0.85,
        improvements: {
          missingScenario: {
            suggestedName: analysis.missingScenario.name,
            suggestedCategory: analysis.missingScenario.category,
            suggestedKeywords: analysis.missingScenario.keywords || [],
            suggestedNegativeKeywords: analysis.missingScenario.negativeKeywords || [],
            suggestedResponse: analysis.missingScenario.response || '',
            suggestedActionHook: analysis.missingScenario.actionHook,
            suggestedBehavior: analysis.missingScenario.behavior
          }
        },
        llmReasoning: analysis.reasoning,
        llmModel: analysis.llmModel,
        llmTokens: analysis.llmTokens,
        llmCost: analysis.llmCost,
        impact: this._buildImpact(analysis.impact, 'missing-scenario'),
        status: 'pending'
      });
      suggestions.push(suggestion);
    }

    return suggestions;
  }

  /**
   * Build impact object for suggestion
   * @param {Object} rawImpact - Impact data from LLM
   * @param {String} type - Suggestion type
   * @returns {Object} Formatted impact
   */
  _buildImpact(rawImpact, type) {
    if (!rawImpact) {
      return {
        similarCallsThisMonth: 0,
        similarCallsLastMonth: 0,
        projectedNextMonth: 0,
        estimatedMonthlySavings: 0,
        estimatedAnnualSavings: 0,
        performanceGain: 0,
        currentTierUsage: { tier1Percent: 0, tier2Percent: 0, tier3Percent: 100 },
        projectedTierUsage: { tier1Percent: 70, tier2Percent: 20, tier3Percent: 10 },
        description: 'Impact data unavailable'
      };
    }

    return {
      similarCallsThisMonth: rawImpact.similarCallsThisMonth || 0,
      similarCallsLastMonth: rawImpact.similarCallsLastMonth || 0,
      projectedNextMonth: rawImpact.similarCallsThisMonth || 0,
      estimatedMonthlySavings: rawImpact.estimatedMonthlySavings || 0,
      estimatedAnnualSavings: (rawImpact.estimatedMonthlySavings || 0) * 12,
      performanceGain: rawImpact.performanceGain || 0,
      currentTierUsage: {
        tier1Percent: 0,
        tier2Percent: 0,
        tier3Percent: 100
      },
      projectedTierUsage: {
        tier1Percent: type === 'synonym' || type === 'keywords' ? 70 : 0,
        tier2Percent: 20,
        tier3Percent: 10
      },
      description: this._getImpactDescription(type, rawImpact)
    };
  }

  /**
   * Get human-readable impact description
   * @param {String} type - Suggestion type
   * @param {Object} rawImpact - Impact data
   * @returns {String} Description
   */
  _getImpactDescription(type, rawImpact) {
    const calls = rawImpact.similarCallsThisMonth || 0;
    const savings = rawImpact.estimatedMonthlySavings || 0;

    switch (type) {
      case 'synonym':
        return `${calls} similar calls this month costing $${savings.toFixed(2)}. Adding this synonym will route to Tier 1 (rule-based), saving ~$${savings.toFixed(2)}/month.`;
      
      case 'missing-scenario':
        return `${calls} unmatched calls this month. Creating this scenario will improve customer experience and reduce LLM usage.`;
      
      case 'keywords':
        return `Adding these keywords will improve Tier 1 matching by ~${Math.round((calls / 100) * 100)}%, faster responses by ${rawImpact.performanceGain || 0}ms.`;
      
      case 'negative-keywords':
        return `Prevents false positives. Estimated ${calls} incorrect matches per month.`;
      
      case 'filler-words':
        return `Appears in ~${Math.round((calls / 100) * 100)}% of calls. Cleaner input improves Tier 1/2 matching accuracy.`;
      
      default:
        return 'Impact data unavailable';
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // NOTIFICATIONS
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Send notifications for high-priority suggestions
   * @param {Array} suggestions - Created suggestions
   */
  async _sendNotifications(suggestions) {
    const highPriority = suggestions.filter(s => s.priority === 'high');

    for (const suggestion of highPriority) {
      try {
        await AdminNotificationService.sendNotification({
          code: 'PRODUCTION_AI_SUGGESTION_HIGH_PRIORITY',
          severity: 'WARNING',
          message: `New high-priority suggestion: ${suggestion.getBriefDescription()}`,
          details: {
            suggestionId: suggestion._id,
            templateId: suggestion.templateId,
            companyId: suggestion.companyId,
            type: suggestion.type,
            confidence: suggestion.confidence,
            estimatedSavings: suggestion.impact.estimatedMonthlySavings
          },
          source: 'LLMSuggestionAnalyzer',
          actionLink: `/admin-global-instant-responses.html#production-ai?suggestion=${suggestion._id}`
        });
      } catch (error) {
        logger.error('[LLM SUGGESTION ANALYZER] Failed to send notification:', error);
        // Don't throw - notification failure shouldn't block analysis
      }
    }
  }

  /**
   * Send failure notification (after 3 failed attempts)
   * @param {Object} callLog - ProductionAICallLog document
   * @param {Error} error - Last error
   */
  async _sendFailureNotification(callLog, error) {
    try {
      await AdminNotificationService.sendNotification({
        code: 'PRODUCTION_AI_ANALYSIS_FAILED',
        severity: 'CRITICAL',
        message: `Failed to analyze call log after 3 attempts`,
        details: {
          callId: callLog.callId,
          callLogId: callLog._id,
          companyId: callLog.companyId,
          templateId: callLog.templateId,
          error: error.message,
          stack: error.stack,
          attempts: callLog.analysisAttempts
        },
        source: 'LLMSuggestionAnalyzer',
        actionLink: `/admin-global-instant-responses.html#production-ai`
      });
    } catch (notifError) {
      logger.error('[LLM SUGGESTION ANALYZER] Failed to send failure notification:', notifError);
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BATCH PROCESSING
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Process unanalyzed Tier 3 calls (called by cron job)
   * @param {Number} limit - Max calls to process per run
   * @returns {Promise<Object>} { processed, succeeded, failed }
   */
  async processBatch(limit = 10) {
    if (!this.isEnabled) {
      logger.warn('[LLM SUGGESTION ANALYZER] Batch processing skipped (service disabled)');
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    logger.info(`[LLM SUGGESTION ANALYZER] Starting batch processing (limit: ${limit})`);

    const callLogs = await ProductionAICallLog.findUnanalyzedTier3Calls(limit);

    if (callLogs.length === 0) {
      logger.info('[LLM SUGGESTION ANALYZER] No unanalyzed calls found');
      return { processed: 0, succeeded: 0, failed: 0 };
    }

    let succeeded = 0;
    let failed = 0;

    for (const callLog of callLogs) {
      try {
        await this.analyzeCall(callLog);
        succeeded++;
      } catch (error) {
        failed++;
        logger.error(`[LLM SUGGESTION ANALYZER] Failed to analyze call ${callLog.callId}:`, error);
      }
    }

    logger.info(`[LLM SUGGESTION ANALYZER] Batch complete: ${succeeded} succeeded, ${failed} failed`);

    return {
      processed: callLogs.length,
      succeeded,
      failed
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// SINGLETON EXPORT
// ────────────────────────────────────────────────────────────────────────────

module.exports = new LLMSuggestionAnalyzer();

