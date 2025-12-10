/**
 * ============================================================================
 * TIER 3: LLM-BASED SCENARIO ROUTER – PHASE A.5 UPGRADE
 * ============================================================================
 * 
 * PURPOSE:
 * When Tier 1 (rule-based) and Tier 2 (semantic) fail to match with sufficient
 * confidence, this service uses OpenAI to intelligently select the best scenario.
 * 
 * CRITICAL: This is a ROUTER, NOT an answer generator.
 * - Input: caller phrase + scenario metadata
 * - Output: JSON decision { scenarioId, confidence, reason }
 * - Role: Score and select scenarios, nothing else
 * - ResponseEngine (Phase A.3) picks the actual reply
 * 
 * COST: ~$0.0005–$0.001 per call (gpt-4o-mini pricing)
 * SPEED: 500–1000ms typical
 * 
 * DEEPGRAM INTEGRATION (Dec 2025):
 * Before spending money on LLM, we ensure we have the best possible transcript.
 * If STT confidence is borderline (60-80%), re-transcribe with Deepgram first.
 * This dramatically improves LLM accuracy and reduces wasted API calls.
 * 
 * ============================================================================
 */

// ════════════════════════════════════════════════════════════════════════════
// ⚠️ IMPORTANT: All LLM calls go through llmRegistry - NOT direct OpenAI
// ════════════════════════════════════════════════════════════════════════════
const { callTier3Fallback } = require('./llmRegistry');
const logger = require('../utils/logger');

// Deepgram fallback for better transcripts before LLM
let DeepgramFallback;
try {
    DeepgramFallback = require('./DeepgramFallback');
} catch (err) {
    logger.warn('[Tier3] DeepgramFallback not available');
}

// Black Box for logging Deepgram events
let BlackBoxLogger;
try {
    BlackBoxLogger = require('./BlackBoxLogger');
} catch (err) {
    logger.warn('[Tier3] BlackBoxLogger not available');
}

class Tier3LLMFallback {
  constructor() {
    this.config = {
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      temperature: 0.2,  // Consistent, not creative
      maxTokens: 500,
    };
  }

  /**
   * ============================================================================
   * MAIN METHOD: Score scenarios and return best match
   * ============================================================================
   * 
   * This is a pure router. It does NOT generate answers.
   * 
   * @param {Object} params
   * @param {String} params.callerInput - What the caller said
   * @param {Array} params.scenarios - Available scenarios with full metadata
   * @param {Object} params.context - { companyName, categoryName, channel }
   * 
   * @returns {Object} Decision object:
   *   {
   *     success: boolean,
   *     scenario: scenarioObjectOrNull,
   *     confidence: number 0–1,
   *     tier: 3,
   *     source: 'tier3-llm',
   *     rationale: string,
   *     performance: { responseTime, cost, tokens }
   *   }
   */
  async analyze({ callerInput, scenarios, context = {} }) {
    const startTime = Date.now();
    const { 
      companyName, 
      categoryName, 
      channel = 'voice',
      // Deepgram integration context
      sttConfidence = null,       // 0-100 from Twilio
      recordingUrl = null,        // For Deepgram re-transcription
      companyId = null,
      callId = null
    } = context;

    // GUARD: Empty input
    if (!callerInput || !Array.isArray(scenarios) || scenarios.length === 0) {
      logger.warn('[Tier3] Invalid input', {
        hasCallerInput: !!callerInput,
        scenarioCount: Array.isArray(scenarios) ? scenarios.length : 0,
        scenariosType: typeof scenarios
      });
      return {
        success: false,
        matched: false,  // Compatible with IntelligentRouter.js
        scenario: null,
        confidence: 0,
        tier: 3,
        source: 'tier3-llm',
        rationale: 'No scenarios or empty caller input',
      };
    }

    // ========================================================================
    // 🎯 DEEPGRAM PRE-LLM ENHANCEMENT
    // ========================================================================
    // If we're at Tier 3 (expensive LLM), ensure we have the best transcript.
    // If STT confidence is borderline (40-80%), try Deepgram for better accuracy.
    // This prevents wasting LLM calls on misheard transcripts.
    // ========================================================================
    let effectiveCallerInput = callerInput;
    let usedDeepgram = false;
    
    if (DeepgramFallback && DeepgramFallback.isDeepgramConfigured() && recordingUrl) {
      const confidencePercent = sttConfidence ?? 100; // Default to 100 if not provided
      
      // Trigger Deepgram if confidence is in the "uncertain zone" (40-80%)
      // We don't trigger below 40% (those already went through repeat flow)
      // We don't trigger above 80% (those are reliable)
      if (confidencePercent >= 40 && confidencePercent < 80) {
        logger.info(`[Tier3] 🎯 STT confidence ${confidencePercent}% is borderline - trying Deepgram before LLM`, {
          originalInput: callerInput.substring(0, 50),
          callId
        });
        
        // Log to Black Box: Tier 3 Deepgram attempt started
        if (BlackBoxLogger) {
          try {
            await BlackBoxLogger.logEvent({
              callId,
              companyId,
              type: 'TIER3_DEEPGRAM_STARTED',
              data: {
                twilioConfidence: confidencePercent,
                twilioTranscript: callerInput?.substring(0, 100) || '',
                reason: 'STT confidence borderline (40-80%) - checking before expensive LLM call'
              }
            });
          } catch (logErr) {
            logger.warn('[Tier3] Black Box log failed:', logErr.message);
          }
        }
        
        try {
          const dgResult = await DeepgramFallback.transcribeWithDeepgram(recordingUrl);
          
          if (dgResult && dgResult.transcript && dgResult.confidencePercent >= 80) {
            effectiveCallerInput = dgResult.transcript;
            usedDeepgram = true;
            
            logger.info(`[Tier3] ✅ Deepgram improved transcript: "${dgResult.transcript.substring(0, 50)}..." (${dgResult.confidencePercent}%)`, {
              originalConfidence: confidencePercent,
              deepgramConfidence: dgResult.confidencePercent,
              callId
            });
            
            // Log to Black Box: Tier 3 Deepgram SUCCESS
            if (BlackBoxLogger) {
              try {
                const vocabSuggestions = DeepgramFallback.generateVocabularySuggestions(callerInput, dgResult.transcript);
                await BlackBoxLogger.logEvent({
                  callId,
                  companyId,
                  type: 'TIER3_DEEPGRAM_SUCCESS',
                  data: {
                    twilioConfidence: confidencePercent,
                    deepgramConfidence: dgResult.confidencePercent,
                    twilioTranscript: callerInput?.substring(0, 100) || '',
                    deepgramTranscript: dgResult.transcript?.substring(0, 100) || '',
                    durationMs: dgResult.durationMs,
                    vocabSuggestions,
                    savings: 'Prevented potential $0.50 LLM waste on bad transcript'
                  }
                });
              } catch (logErr) {
                logger.warn('[Tier3] Black Box success log failed:', logErr.message);
              }
            }
          } else {
            logger.debug(`[Tier3] Deepgram didn't improve transcript - proceeding with original`);
            
            // Log to Black Box: Deepgram didn't help
            if (BlackBoxLogger) {
              try {
                await BlackBoxLogger.logEvent({
                  callId,
                  companyId,
                  type: 'TIER3_DEEPGRAM_NO_IMPROVEMENT',
                  data: {
                    twilioConfidence: confidencePercent,
                    deepgramConfidence: dgResult?.confidencePercent || 0,
                    reason: 'Deepgram confidence also low - proceeding with original transcript'
                  }
                });
              } catch (logErr) {
                logger.warn('[Tier3] Black Box no-improvement log failed:', logErr.message);
              }
            }
          }
        } catch (dgErr) {
          logger.warn(`[Tier3] Deepgram pre-LLM check failed (non-fatal):`, dgErr.message);
          
          // Log to Black Box: Deepgram error
          if (BlackBoxLogger) {
            try {
              await BlackBoxLogger.logEvent({
                callId,
                companyId,
                type: 'TIER3_DEEPGRAM_ERROR',
                data: { error: dgErr.message }
              });
            } catch (logErr) {
              logger.warn('[Tier3] Black Box error log failed:', logErr.message);
            }
          }
        }
      }
    }

    try {
      logger.info('[Tier3] Starting LLM route decision', {
        callerInputLength: effectiveCallerInput.length,
        originalInputLength: callerInput.length,
        usedDeepgram,
        scenarioCount: scenarios.length,
        companyName,
        channel,
      });

      // Build compact scenario summaries for LLM
      const scenarioSummaries = scenarios.map((s) => ({
        id: s.scenarioId,
        name: s.scenarioName || s.name || 'Untitled',
        type: s.scenarioType || null,
        triggers: (s.triggers || []).slice(0, 8),
        negativeTriggers: (s.negativeTriggers || []).slice(0, 4),
        examples: (s.exampleUserPhrases || []).slice(0, 6),
        negatives: (s.negativeUserPhrases || []).slice(0, 3),
        followUpMode: s.followUpMode || 'NONE',
      }));

      // System prompt: STRICT instructions for JSON routing
      const systemPrompt = `You are an expert call router for ClientsVia.ai call receptionist.

YOUR JOB: Choose which scenario best matches what the caller said. That's it.

OUTPUT FORMAT: Valid JSON only. No explanation, no markdown.

{
  "scenarioId": "exact id from provided list, or null if no good match",
  "confidence": number from 0.0 to 1.0,
  "reason": "one-sentence explanation"
}

DECISION RULES:
1. Review TRIGGERS first – most reliable signal.
2. Check NEGATIVE PHRASES and NEGATIVE TRIGGERS – if they match, REJECT this scenario.
3. Use EXAMPLES to disambiguate edge cases.
4. Prefer MOST SPECIFIC scenario (not generic).
5. If confidence < 0.4, return null (don't force a bad match).
6. ONLY use scenarioIds from the provided list.

NEVER invent scenarioIds.
NEVER return multiple scenarios.
NEVER return confidence > 1.0 or < 0.0.`;

      // User prompt: caller input + scenario data
      // Use effectiveCallerInput (may be Deepgram-enhanced)
      const userPrompt = `Company: ${companyName || 'Unknown'}
Category: ${categoryName || 'Unknown'}
Channel: ${channel}

CALLER SAID:
"""
${effectiveCallerInput}
"""

AVAILABLE SCENARIOS:
${JSON.stringify(scenarioSummaries, null, 2)}

Choose the best matching scenario ID, or null.`;

      // ════════════════════════════════════════════════════════════════
      // CALL TIER-3 via REGISTRY (THE ONLY ALLOWED PATH)
      // ════════════════════════════════════════════════════════════════
      // All LLM calls go through llmRegistry.callTier3Fallback()
      // This ensures proper logging with brain identifier
      // ════════════════════════════════════════════════════════════════
      let completion;
      try {
        completion = await callTier3Fallback({
          callId,
          companyId,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: this.config.temperature,
          max_tokens: this.config.maxTokens,
          response_format: { type: 'json_object' },
          metadata: {
            scenarioCount: scenarios.length,
            usedDeepgram,
            sttConfidence: sttConfidence
          }
        });
      } catch (openaiErr) {
        logger.error('[Tier3] LLM API error', {
          error: openaiErr.message,
          code: openaiErr.code,
        });
        return {
          success: false,
          matched: false,  // Compatible with IntelligentRouter.js
          scenario: null,
          confidence: 0,
          tier: 3,
          source: 'tier3-llm',
          rationale: `LLM error: ${openaiErr.message}`,
        };
      }

      // Parse LLM response
      let parsed;
      try {
        const rawContent = completion.choices[0].message.content;
        parsed = JSON.parse(rawContent);
      } catch (parseErr) {
        logger.error('[Tier3] LLM JSON parse failed', {
          error: parseErr.message,
          content: completion.choices[0].message.content?.substring(0, 100),
        });
        return {
          success: false,
          matched: false,  // Compatible with IntelligentRouter.js
          scenario: null,
          confidence: 0,
          tier: 3,
          source: 'tier3-llm',
          rationale: 'LLM response was not valid JSON',
        };
      }

      // Validate and clamp confidence
      const rawConfidence = typeof parsed.confidence === 'number' ? parsed.confidence : 0;
      const confidence = Math.max(0, Math.min(1, rawConfidence));
      const chosenId = parsed.scenarioId || null;
      const rationale = parsed.reason || 'LLM routing decision';

      // Calculate cost
      const cost = this._calculateCost(completion.usage);
      const responseTime = Date.now() - startTime;

      // Case 1: LLM said "no good match"
      if (!chosenId) {
        logger.info('[Tier3] No match found', {
          confidence,
          rationale,
          responseTime: `${responseTime}ms`,
        });
        return {
          success: true,
          matched: false,  // Compatible with IntelligentRouter.js
          scenario: null,
          confidence,
          tier: 3,
          source: 'tier3-llm',
          rationale,
          performance: { responseTime, cost, tokens: completion.usage.total_tokens },
        };
      }

      // Case 2: Find the scenario by ID
      const scenario = scenarios.find((s) => s.scenarioId === chosenId);
      if (!scenario) {
        logger.warn('[Tier3] LLM chose unknown scenarioId', {
          chosenId,
          validIds: scenarios.map((s) => s.scenarioId).slice(0, 5),
        });
        return {
          success: true,
          matched: false,  // Compatible with IntelligentRouter.js
          scenario: null,
          confidence,
          tier: 3,
          source: 'tier3-llm',
          rationale: 'LLM chose unknown scenarioId',
          performance: { responseTime, cost, tokens: completion.usage.total_tokens },
        };
      }

      // Case 3: Success! Scenario matched
      logger.info('[Tier3] Scenario selected', {
        scenarioId: scenario.scenarioId,
        scenarioName: scenario.scenarioName || scenario.name,
        scenarioType: scenario.scenarioType,
        confidence,
        rationale,
        usedDeepgram,
        responseTime: `${responseTime}ms`,
        cost: `$${cost.toFixed(5)}`,
      });

      return {
        success: true,
        matched: true,  // Compatible with IntelligentRouter.js
        scenario,
        confidence,
        tier: 3,
        source: 'tier3-llm',
        rationale,
        performance: {
          responseTime,
          cost,
          tokens: completion.usage.total_tokens,
        },
        // Deepgram enhancement info
        deepgram: usedDeepgram ? {
          used: true,
          originalInput: callerInput,
          enhancedInput: effectiveCallerInput
        } : { used: false }
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      logger.error('[Tier3] Unexpected error', {
        error: error.message,
        stack: error.stack,
        responseTime: `${responseTime}ms`,
      });

      return {
        success: false,
        matched: false,  // Compatible with IntelligentRouter.js
        scenario: null,
        confidence: 0,
        tier: 3,
        source: 'tier3-llm',
        rationale: `Tier3 error: ${error.message}`,
      };
    }
  }

  /**
   * Calculate cost of OpenAI API call
   * gpt-4o-mini: $0.15 per 1M input, $0.60 per 1M output
   */
  _calculateCost(usage) {
    const inputTokens = usage.prompt_tokens || 0;
    const outputTokens = usage.completion_tokens || 0;

    const inputCost = (inputTokens / 1_000_000) * 0.15;
    const outputCost = (outputTokens / 1_000_000) * 0.60;

    return inputCost + outputCost;
  }
}

module.exports = new Tier3LLMFallback();
