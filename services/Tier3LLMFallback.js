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
            model: process.env.LLM_MODEL || 'gpt-4-turbo-preview',  // or 'gpt-3.5-turbo' for cheaper
            temperature: 0.3,  // Low temperature for consistent results
            maxTokens: 1000,
            timeout: 15000,  // 15 seconds max
            
            // Cost tracking
            gpt4TurboCostPer1kTokens: {
                prompt: 0.01,      // $0.01 per 1K prompt tokens
                completion: 0.03   // $0.03 per 1K completion tokens
            },
            gpt35TurboCostPer1kTokens: {
                prompt: 0.0005,    // $0.0005 per 1K prompt tokens
                completion: 0.0015 // $0.0015 per 1K completion tokens
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
     * MAIN METHOD: Analyze caller input with LLM
     * ============================================================================
     * @param {Object} params
     * @param {String} params.callerInput - What the caller said
     * @param {Object} params.template - GlobalInstantResponseTemplate object
     * @param {Array} params.availableScenarios - Scenarios to choose from
     * @param {Object} params.context - Additional context (call history, etc.)
     * @returns {Object} - { matched: true/false, scenario, confidence, patterns, cost, responseTime }
     */
    async analyze({ callerInput, template, availableScenarios, context = {} }) {
        const startTime = Date.now();
        
        try {
            logger.info('🤖 [TIER 3 LLM] Starting analysis', {
                templateId: template._id,
                templateName: template.name,
                callerInput: callerInput.substring(0, 100),
                scenarioCount: availableScenarios.length,
                model: this.config.model
            });
            
            // Build prompt
            const prompt = this.buildAnalysisPrompt(callerInput, template, availableScenarios);
            
            // Call OpenAI with retry logic
            const llmResponse = await this.callOpenAIWithRetry(prompt);
            
            // Extract analysis from response
            const analysis = this.parseAnalysisResponse(llmResponse.content);
            
            // Calculate cost
            const cost = this.calculateCost(llmResponse.usage, llmResponse.model);
            
            const responseTime = Date.now() - startTime;
            
            logger.info('✅ [TIER 3 LLM] Analysis complete', {
                matched: analysis.matched,
                confidence: analysis.confidence,
                scenarioMatched: analysis.scenario?.name,
                patternsExtracted: analysis.patterns.length,
                cost: `$${cost.toFixed(4)}`,
                responseTime: `${responseTime}ms`,
                tokensUsed: llmResponse.usage.total_tokens
            });
            
            return {
                success: true,
                matched: analysis.matched,
                scenario: analysis.scenario,
                confidence: analysis.confidence,
                reasoning: analysis.reasoning,
                patterns: analysis.patterns,  // For PatternLearningService
                cost: {
                    llmApiCost: cost,
                    totalCost: cost
                },
                performance: {
                    responseTime,
                    tokensUsed: llmResponse.usage,
                    model: llmResponse.model,
                    provider: 'openai'
                }
            };
            
        } catch (error) {
            const responseTime = Date.now() - startTime;
            
            logger.error('❌ [TIER 3 LLM] Analysis failed', {
                error: error.message,
                stack: error.stack,
                templateId: template._id,
                callerInput: callerInput.substring(0, 100),
                responseTime: `${responseTime}ms`
            });
            
            // 🚨 CRITICAL: Tier 3 LLM failure = ultimate fallback is down
            await AdminNotificationService.sendAlert({
                code: 'AI_TIER3_LLM_FAILURE',
                severity: 'CRITICAL',
                companyId: null,
                companyName: 'Platform',
                title: '🚨 AI Tier 3 (LLM) CRITICAL FAILURE',
                message: `OpenAI API call failed for template "${template.name}". Ultimate AI fallback is DOWN. Callers may receive generic error messages.`,
                details: {
                    error: error.message,
                    stackTrace: error.stack,
                    templateId: template._id,
                    templateName: template.name,
                    callId,
                    callerInput: callerInput.substring(0, 200),
                    responseTime: `${responseTime}ms`,
                    impact: 'ALL calls that Tier 1/2 cannot handle will FAIL. Customer experience severely degraded. No pattern learning possible.',
                    action: 'Check OpenAI API key, account credits, rate limits, and API status at https://status.openai.com'
                }
            });
            
            return {
                success: false,
                matched: false,
                scenario: null,
                confidence: 0,
                reasoning: `LLM analysis failed: ${error.message}`,
                patterns: [],
                cost: { llmApiCost: 0, totalCost: 0 },
                performance: { responseTime, error: error.message },
                error: error.message
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
        const costs = model.includes('gpt-4') 
            ? this.config.gpt4TurboCostPer1kTokens 
            : this.config.gpt35TurboCostPer1kTokens;
        
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

