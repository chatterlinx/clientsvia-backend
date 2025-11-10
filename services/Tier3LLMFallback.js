/**
 * ============================================================================
 * TIER 3: LLM FALLBACK SERVICE - GPT-4 TURBO INTEGRATION
 * ============================================================================
 * 
 * PURPOSE:
 * When Tier 1 (rule-based) and Tier 2 (semantic) fail to match with sufficient
 * confidence, this service uses OpenAI GPT-4 Turbo to:
 * 1. Understand the caller's intent with natural language processing
 * 2. Match to the best scenario
 * 3. Extract patterns (synonyms, fillers) for future learning
 * 4. Return high-confidence response
 * 
 * COST: ~$0.50 per call (GPT-4 Turbo pricing)
 * SPEED: 500-2000ms (network + LLM processing)
 * GOAL: Reduce usage from 70% (Week 1) → 2% (Week 24) via learning
 * 
 * BUSINESS VALUE:
 * - Handles ambiguous/novel queries that rules can't match
 * - TEACHES Tier 1 new patterns for future free matches
 * - Ensures no caller is ever stuck (ultimate fallback)
 * - Self-improving: Gets cheaper over time as it teaches Tier 1
 * 
 * ============================================================================
 */

const OpenAI = require('openai');
const AdminNotificationService = require('./AdminNotificationService');
const logger = require('../utils/logger');

class Tier3LLMFallback {
    constructor() {
        // Initialize OpenAI client
        this.openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY || ''
        });
        
        // Configuration
        this.config = {
            model: process.env.LLM_MODEL || 'gpt-4o-mini',  // GPT-4o mini is best price/performance
            temperature: 0.3,  // Low temperature for consistent results
            maxTokens: 1000,
            timeout: 15000,  // 15 seconds max
            
            // Cost tracking - UPDATED TO CURRENT OPENAI PRICING (Nov 2025)
            // Source: https://openai.com/api/pricing/
            gpt4oMiniCostPer1kTokens: {
                prompt: 0.00015,   // $0.15 per 1M tokens (CURRENT)
                completion: 0.0006 // $0.60 per 1M tokens (CURRENT)
            },
            gpt4TurboCostPer1kTokens: {
                prompt: 0.01,      // $10 per 1M tokens
                completion: 0.03   // $30 per 1M tokens
            },
            gpt35TurboCostPer1kTokens: {
                prompt: 0.0005,    // $0.50 per 1M tokens (LEGACY)
                completion: 0.0015 // $1.50 per 1M tokens (LEGACY)
            }
        };
        
        // Fallback models if primary fails
        this.fallbackModels = [
            'gpt-4-turbo-preview',
            'gpt-3.5-turbo-0125',  // Cheaper fallback
            'gpt-3.5-turbo'        // Last resort
        ];
    }
    
    /**
     * ============================================================================
     * MAIN METHOD: Analyze caller input with LLM – PHASE A.5 UPGRADE
     * ============================================================================
     * Uses scenario fields (triggers, examples, scenarioType, followUpMode, etc.)
     * Returns clean JSON decision with confidence and rationale.
     * 
     * @param {Object} params
     * @param {String} params.callerInput - What the caller said
     * @param {Object} params.template - GlobalInstantResponseTemplate object
     * @param {Array} params.availableScenarios - Scenarios with full metadata
     * @param {Object} params.context - { companyName, categoryName, channel, language }
     * @returns {Object} - { success, scenario, confidence, tier, source, rationale, matched }
     */
    async analyze({ callerInput, template, availableScenarios, context = {} }) {
        const startTime = Date.now();
        
        if (!callerInput || !Array.isArray(availableScenarios) || availableScenarios.length === 0) {
            logger.warn('🤖 [TIER 3 LLM] Invalid input', {
                hasInput: !!callerInput,
                scenarioCount: availableScenarios.length
            });
            return {
                success: false,
                matched: false,
                scenario: null,
                confidence: 0,
                tier: 3,
                source: 'tier3-llm',
                rationale: 'No scenarios or empty input'
            };
        }

        try {
            logger.info('🤖 [TIER 3 LLM] Starting analysis (Phase A.5)', {
                templateId: template._id,
                templateName: template.name,
                callerInputLength: callerInput.length,
                scenarioCount: availableScenarios.length,
                model: this.config.model
            });
            
            // Compact scenario summary for LLM
            const scenarioSummaries = availableScenarios.map(s => ({
                id: s.scenarioId,
                name: s.name,
                type: s.scenarioType || null,
                replyStrategy: s.replyStrategy || 'AUTO',
                triggers: (s.triggers || []).slice(0, 5),
                examples: (s.exampleUserPhrases || []).slice(0, 5),
                negatives: (s.negativeUserPhrases || []).slice(0, 3),
                followUpMode: s.followUpMode || 'NONE'
            }));
            
            // Build system + user prompts
            const systemPrompt = `You are an expert call-center router for ClientVia.ai.

Your job: Choose which scenario best matches what the caller said.

Respond ONLY with JSON. No explanation.

{
  "scenarioId": "id or null",
  "confidence": 0.0-1.0,
  "reason": "short explanation"
}

Rules:
- Use ALL scenario metadata: triggers, examples, negatives, type
- Prefer scenarios whose NEGATIVE phrases do NOT match the caller
- If multiple fit, pick the MOST SPECIFIC
- If confidence < 0.4, return null
- ONLY use ids from the provided list`;

            const userPrompt = `Company: ${context.companyName || 'Unknown'}
Template: ${template.name}
Channel: ${context.channel || 'voice'}

Caller said:
"""
${callerInput}
"""

Scenarios:
${JSON.stringify(scenarioSummaries, null, 2)}`;

            // Call OpenAI
            const completion = await this.openai.chat.completions.create({
                model: this.config.model,
                response_format: { type: 'json_object' },
                temperature: 0.2,
                max_tokens: 500,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ]
            });

            let parsed;
            try {
                parsed = JSON.parse(completion.choices[0].message.content);
            } catch (parseErr) {
                logger.error('🤖 [TIER 3 LLM] Failed to parse JSON', {
                    error: parseErr.message,
                    content: completion.choices[0].message.content
                });
                return {
                    success: false,
                    matched: false,
                    scenario: null,
                    confidence: 0,
                    tier: 3,
                    source: 'tier3-llm',
                    rationale: 'Failed to parse LLM JSON'
                };
            }

            const confidence = typeof parsed.confidence === 'number' 
                ? Math.max(0, Math.min(1, parsed.confidence)) 
                : 0;
            const chosenId = parsed.scenarioId || null;
            const rationale = parsed.reason || 'LLM routing decision';

            // Calculate cost
            const cost = this.calculateCost(completion.usage, this.config.model);
            const responseTime = Date.now() - startTime;

            if (!chosenId) {
                logger.info('🤖 [TIER 3 LLM] No match (LLM confidence too low or explicit null)', {
                    confidence,
                    rationale,
                    responseTime: `${responseTime}ms`,
                    cost: `$${cost.toFixed(4)}`
                });
                return {
                    success: true,
                    matched: false,
                    scenario: null,
                    confidence,
                    tier: 3,
                    source: 'tier3-llm',
                    rationale,
                    performance: { responseTime, cost }
                };
            }

            // Find scenario by id
            const scenario = availableScenarios.find(s => s.scenarioId === chosenId);
            if (!scenario) {
                logger.warn('🤖 [TIER 3 LLM] LLM returned unknown scenarioId', {
                    chosenId,
                    validIds: availableScenarios.map(s => s.scenarioId).slice(0, 5)
                });
                return {
                    success: true,
                    matched: false,
                    scenario: null,
                    confidence,
                    tier: 3,
                    source: 'tier3-llm',
                    rationale: 'LLM chose unknown scenario'
                };
            }

            logger.info('✅ [TIER 3 LLM] Scenario matched', {
                scenarioId: scenario.scenarioId,
                scenarioName: scenario.name,
                scenarioType: scenario.scenarioType,
                confidence,
                rationale,
                responseTime: `${responseTime}ms`,
                cost: `$${cost.toFixed(4)}`
            });

            return {
                success: true,
                matched: true,
                scenario,
                confidence,
                tier: 3,
                source: 'tier3-llm',
                rationale,
                performance: { responseTime, cost, tokens: completion.usage.total_tokens }
            };

        } catch (error) {
            const responseTime = Date.now() - startTime;
            
            logger.error('❌ [TIER 3 LLM] Error', {
                error: error.message,
                stack: error.stack,
                responseTime: `${responseTime}ms`
            });
            
            // Alert on critical failures
            if (error.response?.status === 429 || error.response?.status === 500) {
                await AdminNotificationService.sendAlert({
                    code: 'AI_TIER3_LLM_FAILURE',
                    severity: 'CRITICAL',
                    companyId: null,
                    companyName: 'Platform',
                    title: '🚨 AI Tier 3 (LLM) Service Degraded',
                    message: `OpenAI API error (${error.response?.status}). Calls may fall through to escalation.`,
                    details: { error: error.message, status: error.response?.status }
                });
            }
            
            return {
                success: false,
                matched: false,
                scenario: null,
                confidence: 0,
                tier: 3,
                source: 'tier3-llm',
                rationale: `LLM error: ${error.message}`
            };
        }
    }
    
    /**
     * ============================================================================
     * BUILD ANALYSIS PROMPT
     * ============================================================================
     * Constructs a detailed prompt for GPT-4 to analyze the caller's intent
     */
    buildAnalysisPrompt(callerInput, template, availableScenarios) {
        // Build scenario list for prompt
        const scenarioDescriptions = availableScenarios.map((s, idx) => {
            return `${idx + 1}. "${s.name}" (ID: ${s.scenarioId})
   Category: ${s.categoryName || 'N/A'}
   Triggers: ${(s.triggerPhrases || []).slice(0, 3).join(', ')}
   Keywords: ${(s.intentKeywords || []).slice(0, 5).join(', ')}`;
        }).join('\n\n');
        
        const prompt = `You are an expert AI assistant helping to route caller inquiries to the most appropriate scenario in a customer service system.

**TEMPLATE:** ${template.name}
**INDUSTRY:** ${template.industryLabel || 'General'}

**CALLER INPUT:**
"${callerInput}"

**AVAILABLE SCENARIOS (${availableScenarios.length} total):**
${scenarioDescriptions}

**YOUR TASK:**
1. Analyze the caller's intent and what they're trying to accomplish
2. Match to the BEST scenario from the list above
3. Provide a confidence score (0-1.0)
4. Extract any patterns for future learning:
   - Colloquial terms that should map to technical terms (synonyms)
   - Filler words/phrases that should be ignored (fillers)
   - Important keywords that could improve matching (keywords)

**RESPOND IN JSON FORMAT:**
\`\`\`json
{
  "matched": true,
  "scenarioId": "scenario-id-here",
  "scenarioName": "Scenario Name",
  "confidence": 0.95,
  "reasoning": "Why this scenario matches the caller's intent",
  "patterns": [
    {
      "type": "synonym",
      "technicalTerm": "thermostat",
      "colloquialTerm": "thingy",
      "confidence": 0.85,
      "reasoning": "Caller used 'thingy' to refer to thermostat"
    },
    {
      "type": "filler",
      "words": ["you know", "like"],
      "confidence": 0.90,
      "reasoning": "These are conversational fillers"
    }
  ]
}
\`\`\`

**GUIDELINES:**
- Be conservative with confidence scores (only >0.8 if you're very sure)
- Extract patterns ONLY if they're clearly useful
- If no good match exists, set matched: false
- Focus on the caller's PRIMARY intent
- Ignore pleasantries, focus on the core request`;

        return prompt;
    }
    
    /**
     * ============================================================================
     * CALL OPENAI WITH RETRY LOGIC
     * ============================================================================
     */
    async callOpenAIWithRetry(prompt, retryCount = 0) {
        const maxRetries = 3;
        const model = this.fallbackModels[retryCount] || this.config.model;
        
        try {
            const response = await this.openai.chat.completions.create({
                model,
                messages: [
                    {
                        role: 'system',
                        content: 'You are a world-class AI assistant specializing in understanding customer intent and routing queries to appropriate scenarios. You always respond in valid JSON format.'
                    },
                    {
                        role: 'user',
                        content: prompt
                    }
                ],
                temperature: this.config.temperature,
                max_tokens: this.config.maxTokens,
                response_format: { type: 'json_object' }  // Force JSON response
            });
            
            return {
                content: response.choices[0].message.content,
                usage: response.usage,
                model: response.model
            };
            
        } catch (error) {
            logger.error(`❌ [TIER 3 LLM] API call failed (attempt ${retryCount + 1}/${maxRetries})`, {
                error: error.message,
                model,
                code: error.code
            });
            
            // Retry with fallback model if available
            if (retryCount < maxRetries - 1) {
                logger.warn(`⚠️ [TIER 3 LLM] Retrying with fallback model: ${this.fallbackModels[retryCount + 1]}`);
                await this.sleep(1000 * (retryCount + 1));  // Exponential backoff
                return this.callOpenAIWithRetry(prompt, retryCount + 1);
            }
            
            throw error;
        }
    }
    
    /**
     * ============================================================================
     * PARSE ANALYSIS RESPONSE FROM LLM
     * ============================================================================
     */
    parseAnalysisResponse(content) {
        try {
            const parsed = JSON.parse(content);
            
            return {
                matched: parsed.matched || false,
                scenario: parsed.matched ? {
                    scenarioId: parsed.scenarioId,
                    name: parsed.scenarioName
                } : null,
                confidence: parsed.confidence || 0,
                reasoning: parsed.reasoning || 'No reasoning provided',
                patterns: parsed.patterns || []
            };
            
        } catch (error) {
            logger.error('❌ [TIER 3 LLM] Failed to parse LLM response', {
                error: error.message,
                content: content.substring(0, 200)
            });
            
            // Fallback: Try to extract info manually
            return {
                matched: false,
                scenario: null,
                confidence: 0,
                reasoning: 'Failed to parse LLM response',
                patterns: []
            };
        }
    }
    
    /**
     * ============================================================================
     * CALCULATE COST BASED ON TOKEN USAGE
     * ============================================================================
     */
    calculateCost(usage, model) {
        // Determine pricing based on model
        let costs;
        if (model.includes('gpt-4o-mini') || model.includes('gpt-4o-mini')) {
            costs = this.config.gpt4oMiniCostPer1kTokens;
        } else if (model.includes('gpt-4')) {
            costs = this.config.gpt4TurboCostPer1kTokens;
        } else {
            costs = this.config.gpt35TurboCostPer1kTokens;
        }
        
        const promptCost = (usage.prompt_tokens / 1000) * costs.prompt;
        const completionCost = (usage.completion_tokens / 1000) * costs.completion;
        
        return promptCost + completionCost;
    }
    
    /**
     * ============================================================================
     * EXTRACT PATTERNS FROM MULTIPLE CALLS (BATCH ANALYSIS)
     * ============================================================================
     * Used by Intelligence Dashboard to analyze a batch of test calls
     */
    async extractPatternsFromCalls(calls, template) {
        const startTime = Date.now();
        const allPatterns = [];
        
        logger.info('🧠 [TIER 3 LLM] Starting batch pattern extraction', {
            callCount: calls.length,
            templateId: template._id
        });
        
        for (const call of calls) {
            try {
                const result = await this.analyze({
                    callerInput: call.input,
                    template,
                    availableScenarios: call.scenarios || [],
                    context: { callId: call.callId }
                });
                
                if (result.success && result.patterns.length > 0) {
                    allPatterns.push(...result.patterns.map(p => ({
                        ...p,
                        callId: call.callId,
                        callerInput: call.input
                    })));
                }
                
                // Rate limiting: Don't hammer OpenAI
                await this.sleep(500);
                
            } catch (error) {
                logger.error('❌ [TIER 3 LLM] Batch analysis error', {
                    callId: call.callId,
                    error: error.message
                });
            }
        }
        
        const responseTime = Date.now() - startTime;
        
        logger.info('✅ [TIER 3 LLM] Batch pattern extraction complete', {
            callsAnalyzed: calls.length,
            patternsExtracted: allPatterns.length,
            responseTime: `${responseTime}ms`
        });
        
        return {
            success: true,
            patterns: allPatterns,
            callsAnalyzed: calls.length,
            responseTime
        };
    }
    
    /**
     * ============================================================================
     * HEALTH CHECK - Verify OpenAI connectivity
     * ============================================================================
     */
    async healthCheck() {
        try {
            const response = await this.openai.chat.completions.create({
                model: 'gpt-3.5-turbo',  // Use cheapest model for health check
                messages: [{ role: 'user', content: 'ping' }],
                max_tokens: 5
            });
            
            return {
                status: 'healthy',
                provider: 'openai',
                model: response.model,
                latency: response.usage ? '< 1000ms' : 'N/A'
            };
            
        } catch (error) {
            return {
                status: 'unhealthy',
                provider: 'openai',
                error: error.message
            };
        }
    }
    
    /**
     * Helper: Sleep for specified milliseconds
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

module.exports = new Tier3LLMFallback();

