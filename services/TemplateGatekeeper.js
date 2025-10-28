// ============================================================================
// 🚀 PRODUCTION AI - TEMPLATE GATEKEEPER SERVICE
// ============================================================================
// PURPOSE: Enterprise-grade 3-tier routing for production customer calls
// ARCHITECTURE: Tier 1 (Rule-Based) → Tier 2 (Semantic) → Tier 3 (LLM Fallback)
// PERFORMANCE: Sub-50ms for Tier 1/2, budget-controlled Tier 3
// SCALABILITY: Handles 100+ companies simultaneously with Redis caching
// DOCUMENTATION: /docs/PRODUCTION-AI-CORE-INTEGRATION.md
// ============================================================================

const logger = require('../utils/logger');
const Company = require('../models/v2Company');
const GlobalInstantResponseTemplate = require('../models/GlobalInstantResponseTemplate');

// ============================================================================
// 🔧 TEMPLATE GATEKEEPER CLASS
// ============================================================================

class TemplateGatekeeper {
    constructor() {
        this.openaiClient = null;
        this.TIER_3_ENABLED = process.env.ENABLE_3_TIER_INTELLIGENCE === 'true';
        this.OPENAI_API_KEY = process.env.OPENAI_API_KEY;
        
        // Performance tracking
        this.metrics = {
            tier1Calls: 0,
            tier2Calls: 0,
            tier3Calls: 0,
            fallbackCalls: 0,
            avgResponseTime: 0
        };
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🎯 MAIN ENTRY POINT: Process Query Through 3-Tier System
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Routes a customer query through the 3-tier intelligence system
     * @param {string} query - Customer's question/request
     * @param {Object} company - Company document (with aiAgentLogic.templateGatekeeper config)
     * @param {Array} templates - Array of GlobalInstantResponseTemplate documents
     * @param {Object} context - Additional context (callId, phoneNumber, etc.)
     * @returns {Promise<Object>} Matched response or null (triggers fallback)
     */
    async processQuery(query, company, templates, context = {}) {
        const startTime = Date.now();
        
        try {
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 1: Validate inputs
            // ────────────────────────────────────────────────────────────────
            if (!query || typeof query !== 'string') {
                throw new Error('Invalid query: must be a non-empty string');
            }
            
            if (!company || !company._id) {
                throw new Error('Invalid company: missing company data');
            }
            
            if (!templates || templates.length === 0) {
                logger.warn('[GATEKEEPER] No templates provided', {
                    companyId: company._id,
                    companyName: company.companyName
                });
                return null; // No templates = fallback
            }
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 2: Load gatekeeper configuration
            // ────────────────────────────────────────────────────────────────
            const gatekeeperConfig = company.aiAgentLogic?.templateGatekeeper;
            
            if (!gatekeeperConfig || !gatekeeperConfig.enabled) {
                logger.info('[GATEKEEPER] Gatekeeper disabled for company', {
                    companyId: company._id,
                    companyName: company.companyName
                });
                // Gatekeeper disabled → use basic template matching only
                return await this.basicTemplateMatch(query, templates);
            }
            
            logger.info('[GATEKEEPER] Processing query', {
                companyId: company._id,
                companyName: company.companyName,
                query: query.substring(0, 100),
                templatesCount: templates.length,
                config: {
                    tier1Threshold: gatekeeperConfig.tier1Threshold,
                    tier2Threshold: gatekeeperConfig.tier2Threshold,
                    llmEnabled: gatekeeperConfig.enableLLMFallback,
                    budget: gatekeeperConfig.monthlyBudget,
                    spent: gatekeeperConfig.currentSpend
                }
            });
            
            // ────────────────────────────────────────────────────────────────
            // TIER 1: RULE-BASED MATCHING (FREE - Pattern Matching)
            // ────────────────────────────────────────────────────────────────
            logger.info('[GATEKEEPER] Starting Tier 1 (Rule-Based)...');
            
            const tier1Result = await this.tier1RuleBasedMatch(query, templates, company);
            
            if (tier1Result && tier1Result.confidence >= gatekeeperConfig.tier1Threshold) {
                logger.info('[GATEKEEPER] ✅ Tier 1 match found', {
                    companyId: company._id,
                    confidence: tier1Result.confidence,
                    threshold: gatekeeperConfig.tier1Threshold,
                    scenarioName: tier1Result.scenarioName,
                    cost: 0,
                    responseTime: Date.now() - startTime
                });
                
                this.metrics.tier1Calls++;
                
                // Update company metrics (non-blocking)
                this.updateCompanyMetrics(company._id, 'tier1Calls', Date.now() - startTime).catch(err => {
                    logger.error('[GATEKEEPER] Failed to update company metrics', { error: err.message });
                });
                
                return {
                    ...tier1Result,
                    tier: 1,
                    cost: 0,
                    responseTime: Date.now() - startTime
                };
            }
            
            logger.info('[GATEKEEPER] ❌ Tier 1 no match', {
                companyId: company._id,
                confidence: tier1Result?.confidence || 0,
                threshold: gatekeeperConfig.tier1Threshold
            });
            
            // ────────────────────────────────────────────────────────────────
            // TIER 2: SEMANTIC SIMILARITY (FREE - Vector Matching)
            // ────────────────────────────────────────────────────────────────
            logger.info('[GATEKEEPER] Starting Tier 2 (Semantic)...');
            
            const tier2Result = await this.tier2SemanticMatch(query, templates, company);
            
            if (tier2Result && tier2Result.confidence >= gatekeeperConfig.tier2Threshold) {
                logger.info('[GATEKEEPER] ✅ Tier 2 match found', {
                    companyId: company._id,
                    confidence: tier2Result.confidence,
                    threshold: gatekeeperConfig.tier2Threshold,
                    scenarioName: tier2Result.scenarioName,
                    cost: 0,
                    responseTime: Date.now() - startTime
                });
                
                this.metrics.tier2Calls++;
                
                // Update company metrics (non-blocking)
                this.updateCompanyMetrics(company._id, 'tier2Calls', Date.now() - startTime).catch(err => {
                    logger.error('[GATEKEEPER] Failed to update company metrics', { error: err.message });
                });
                
                return {
                    ...tier2Result,
                    tier: 2,
                    cost: 0,
                    responseTime: Date.now() - startTime
                };
            }
            
            logger.info('[GATEKEEPER] ❌ Tier 2 no match', {
                companyId: company._id,
                confidence: tier2Result?.confidence || 0,
                threshold: gatekeeperConfig.tier2Threshold
            });
            
            // ────────────────────────────────────────────────────────────────
            // TIER 3: LLM FALLBACK (PAID - OpenAI GPT-4)
            // ────────────────────────────────────────────────────────────────
            
            // CHECKPOINT 3: Check if LLM is enabled
            if (!gatekeeperConfig.enableLLMFallback) {
                logger.warn('[GATEKEEPER] LLM disabled by config', {
                    companyId: company._id
                });
                
                this.metrics.fallbackCalls++;
                
                // No LLM → return null (triggers fallback)
                return null;
            }
            
            // CHECKPOINT 4: Check if Tier 3 system is enabled globally
            if (!this.TIER_3_ENABLED) {
                logger.warn('[GATEKEEPER] Tier 3 system disabled globally', {
                    companyId: company._id,
                    envFlag: 'ENABLE_3_TIER_INTELLIGENCE=false'
                });
                
                this.metrics.fallbackCalls++;
                
                return null;
            }
            
            // CHECKPOINT 5: Check budget (CRITICAL!)
            const budgetRemaining = gatekeeperConfig.monthlyBudget - gatekeeperConfig.currentSpend;
            
            if (budgetRemaining <= 0) {
                logger.error('[GATEKEEPER] 🔴 Budget exceeded - LLM blocked', {
                    companyId: company._id,
                    companyName: company.companyName,
                    budget: gatekeeperConfig.monthlyBudget,
                    spent: gatekeeperConfig.currentSpend,
                    remaining: budgetRemaining
                });
                
                // Send critical notification (non-blocking)
                const ProductionAIHealthMonitor = require('./ProductionAIHealthMonitor');
                ProductionAIHealthMonitor.trackBudgetExceeded(company._id, company.companyName, gatekeeperConfig).catch(err => {
                    logger.error('[GATEKEEPER] Failed to send budget exceeded notification', { error: err.message });
                });
                
                this.metrics.fallbackCalls++;
                
                return null; // Budget exceeded → fallback
            }
            
            // Estimate cost (rough: $0.50 per call)
            const estimatedCost = 0.50;
            
            if (budgetRemaining < estimatedCost) {
                logger.warn('[GATEKEEPER] ⚠️ Insufficient budget for LLM call', {
                    companyId: company._id,
                    remaining: budgetRemaining,
                    estimatedCost
                });
                
                this.metrics.fallbackCalls++;
                
                return null;
            }
            
            // ────────────────────────────────────────────────────────────────
            // CHECKPOINT 6: Call OpenAI (with error handling)
            // ────────────────────────────────────────────────────────────────
            logger.info('[GATEKEEPER] Starting Tier 3 (LLM)...', {
                companyId: company._id,
                budgetRemaining,
                estimatedCost
            });
            
            let tier3Result = null;
            let actualCost = 0;
            
            try {
                const llmResponse = await this.tier3LLMFallback(query, templates, company);
                
                if (llmResponse) {
                    tier3Result = llmResponse.result;
                    actualCost = llmResponse.cost || estimatedCost;
                    
                    logger.info('[GATEKEEPER] ✅ Tier 3 LLM match found', {
                        companyId: company._id,
                        confidence: tier3Result.confidence,
                        scenarioName: tier3Result.scenarioName,
                        cost: actualCost,
                        responseTime: Date.now() - startTime
                    });
                    
                    this.metrics.tier3Calls++;
                    
                    // ────────────────────────────────────────────────────────
                    // CHECKPOINT 7: Update budget (atomic operation)
                    // ────────────────────────────────────────────────────────
                    try {
                        await Company.findByIdAndUpdate(
                            company._id,
                            {
                                $inc: {
                                    'aiAgentLogic.templateGatekeeper.currentSpend': actualCost,
                                    'aiAgentLogic.templateGatekeeper.metrics.tier3Calls': 1
                                },
                                $set: {
                                    'aiAgentLogic.templateGatekeeper.metrics.lastUpdated': new Date()
                                }
                            }
                        );
                        
                        logger.info('[GATEKEEPER] Budget updated', {
                            companyId: company._id,
                            previousSpend: gatekeeperConfig.currentSpend,
                            cost: actualCost,
                            newSpend: gatekeeperConfig.currentSpend + actualCost,
                            remaining: gatekeeperConfig.monthlyBudget - (gatekeeperConfig.currentSpend + actualCost)
                        });
                        
                        // Clear Redis cache (budget changed)
                        try {
                            const redisClient = require('../db').redisClient;
                            if (redisClient && redisClient.del) {
                                await redisClient.del(`company:${company._id}:production-ai`);
                            }
                        } catch (cacheError) {
                            logger.warn('[GATEKEEPER] Failed to clear Redis cache', {
                                error: cacheError.message
                            });
                        }
                        
                        // Check if approaching budget limit (80%)
                        const newSpend = gatekeeperConfig.currentSpend + actualCost;
                        const budgetUsage = newSpend / gatekeeperConfig.monthlyBudget;
                        
                        if (budgetUsage >= 0.80 && budgetUsage < 1.0) {
                            const ProductionAIHealthMonitor = require('./ProductionAIHealthMonitor');
                            ProductionAIHealthMonitor.trackBudgetWarning(
                                company._id,
                                company.companyName,
                                gatekeeperConfig,
                                newSpend,
                                budgetUsage
                            ).catch(err => {
                                logger.error('[GATEKEEPER] Failed to send budget warning', { error: err.message });
                            });
                        }
                        
                    } catch (updateError) {
                        logger.error('[GATEKEEPER] Failed to update budget', {
                            companyId: company._id,
                            error: updateError.message,
                            stack: updateError.stack
                        });
                        
                        // Still return the result (budget update failure shouldn't block customer)
                    }
                    
                    return {
                        ...tier3Result,
                        tier: 3,
                        cost: actualCost,
                        responseTime: Date.now() - startTime
                    };
                }
                
            } catch (llmError) {
                logger.error('[GATEKEEPER] ❌ Tier 3 LLM error', {
                    companyId: company._id,
                    error: llmError.message,
                    stack: llmError.stack
                });
                
                // Send error notification (non-blocking)
                const ProductionAIHealthMonitor = require('./ProductionAIHealthMonitor');
                ProductionAIHealthMonitor.trackRoutingError(
                    company._id,
                    llmError,
                    {
                        stage: 'TIER_3_LLM',
                        query: query.substring(0, 100),
                        companyName: company.companyName
                    }
                ).catch(err => {
                    logger.error('[GATEKEEPER] Failed to send routing error notification', { error: err.message });
                });
            }
            
            // ────────────────────────────────────────────────────────────────
            // ALL TIERS FAILED → Return null (triggers fallback)
            // ────────────────────────────────────────────────────────────────
            logger.warn('[GATEKEEPER] ❌ All tiers failed - triggering fallback', {
                companyId: company._id,
                tier1Confidence: tier1Result?.confidence || 0,
                tier2Confidence: tier2Result?.confidence || 0,
                tier3Attempted: !!tier3Result,
                responseTime: Date.now() - startTime
            });
            
            this.metrics.fallbackCalls++;
            
            return null;
            
        } catch (error) {
            logger.error('[GATEKEEPER] Critical error in processQuery', {
                companyId: company?._id,
                error: error.message,
                stack: error.stack
            });
            
            // Send critical error notification (non-blocking)
            try {
                const ProductionAIHealthMonitor = require('./ProductionAIHealthMonitor');
                await ProductionAIHealthMonitor.trackRoutingError(
                    company._id,
                    error,
                    {
                        stage: 'GATEKEEPER_PROCESS_QUERY',
                        query: query?.substring(0, 100),
                        companyName: company?.companyName
                    }
                );
            } catch (notifError) {
                logger.error('[GATEKEEPER] Failed to send error notification', {
                    error: notifError.message
                });
            }
            
            return null;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🎯 TIER 1: RULE-BASED MATCHING (Pattern Matching)
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Tier 1: Fast rule-based pattern matching
     * - BM25 algorithm
     * - Keyword matching
     * - Regex patterns
     * - Cost: FREE
     * - Speed: ~5-15ms
     */
    async tier1RuleBasedMatch(query, templates, company) {
        try {
            // Load the existing HybridScenarioSelector (Tier 1 logic already exists!)
            const HybridScenarioSelector = require('./HybridScenarioSelector');
            
            // Use existing Tier 1 matching logic
            const result = await HybridScenarioSelector.selectScenario(query, company, templates);
            
            if (result && result.scenario) {
                return {
                    matched: true,
                    confidence: result.confidence || 0,
                    scenarioName: result.scenario.name,
                    scenarioId: result.scenario.scenarioId,
                    response: result.scenario.responseVariations?.[0] || 'Response not available',
                    category: result.category?.name,
                    template: result.template?.name,
                    matchType: 'rule-based'
                };
            }
            
            return {
                matched: false,
                confidence: result?.confidence || 0
            };
            
        } catch (error) {
            logger.error('[GATEKEEPER] Tier 1 error', {
                error: error.message,
                stack: error.stack
            });
            
            return {
                matched: false,
                confidence: 0,
                error: error.message
            };
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🎯 TIER 2: SEMANTIC SIMILARITY (Vector Matching)
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Tier 2: Semantic similarity using vector embeddings
     * - TF-IDF vectorization
     * - Cosine similarity
     * - Context matching
     * - Cost: FREE
     * - Speed: ~20-40ms
     */
    async tier2SemanticMatch(query, templates, company) {
        try {
            // Load the existing SemanticMatcher (Tier 2 logic)
            const SemanticMatcher = require('./SemanticMatcher');
            
            // Use existing Tier 2 matching logic
            const result = await SemanticMatcher.match(query, templates, company);
            
            if (result && result.matched) {
                return {
                    matched: true,
                    confidence: result.confidence || 0,
                    scenarioName: result.scenarioName,
                    scenarioId: result.scenarioId,
                    response: result.response,
                    category: result.category,
                    template: result.template,
                    matchType: 'semantic'
                };
            }
            
            return {
                matched: false,
                confidence: result?.confidence || 0
            };
            
        } catch (error) {
            logger.error('[GATEKEEPER] Tier 2 error', {
                error: error.message,
                stack: error.stack
            });
            
            return {
                matched: false,
                confidence: 0,
                error: error.message
            };
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🎯 TIER 3: LLM FALLBACK (OpenAI GPT-4)
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Tier 3: LLM-powered fallback using OpenAI GPT-4
     * - Full context understanding
     * - Intent classification
     * - Response generation
     * - Cost: ~$0.50 per call
     * - Speed: ~1-3 seconds
     */
    async tier3LLMFallback(query, templates, company) {
        try {
            // Initialize OpenAI client if not already done
            if (!this.openaiClient && this.OPENAI_API_KEY) {
                const { Configuration, OpenAIApi } = require('openai');
                const configuration = new Configuration({
                    apiKey: this.OPENAI_API_KEY
                });
                this.openaiClient = new OpenAIApi(configuration);
            }
            
            if (!this.openaiClient) {
                throw new Error('OpenAI client not initialized - missing API key');
            }
            
            // ────────────────────────────────────────────────────────────────
            // Build context for LLM
            // ────────────────────────────────────────────────────────────────
            const scenariosList = [];
            templates.forEach(template => {
                template.categories?.forEach(category => {
                    category.scenarios?.forEach(scenario => {
                        if (scenario.isActive) {
                            scenariosList.push({
                                name: scenario.name,
                                id: scenario.scenarioId,
                                keywords: scenario.intentKeywords || [],
                                category: category.name,
                                template: template.name
                            });
                        }
                    });
                });
            });
            
            const systemPrompt = `You are an AI assistant helping route customer queries to the correct scenario.

Company: ${company.companyName}
Industry: ${company.industryType || 'Service Business'}

Available scenarios:
${scenariosList.map((s, i) => `${i + 1}. ${s.name} (Category: ${s.category}, Keywords: ${s.keywords.join(', ')})`).join('\n')}

Your task:
1. Analyze the customer's query
2. Identify the best matching scenario
3. Return ONLY the scenario ID and confidence score (0.0-1.0)

Format your response as JSON:
{
  "scenarioId": "scenario_xxx",
  "scenarioName": "Name of Scenario",
  "confidence": 0.95,
  "reasoning": "Brief explanation"
}`;

            const userPrompt = `Customer query: "${query}"

Which scenario best matches this query?`;

            // ────────────────────────────────────────────────────────────────
            // Call OpenAI API
            // ────────────────────────────────────────────────────────────────
            const startTime = Date.now();
            
            const completion = await this.openaiClient.createChatCompletion({
                model: 'gpt-4',
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt }
                ],
                temperature: 0.3,
                max_tokens: 200,
                response_format: { type: 'json_object' }
            });
            
            const responseTime = Date.now() - startTime;
            
            logger.info('[GATEKEEPER] OpenAI API call successful', {
                model: 'gpt-4',
                responseTime,
                tokensUsed: completion.data.usage
            });
            
            // ────────────────────────────────────────────────────────────────
            // Parse LLM response
            // ────────────────────────────────────────────────────────────────
            const llmResponse = JSON.parse(completion.data.choices[0].message.content);
            
            // Find the matched scenario in templates
            let matchedScenario = null;
            let matchedCategory = null;
            let matchedTemplate = null;
            
            for (const template of templates) {
                for (const category of template.categories || []) {
                    const scenario = category.scenarios?.find(s => s.scenarioId === llmResponse.scenarioId);
                    if (scenario) {
                        matchedScenario = scenario;
                        matchedCategory = category;
                        matchedTemplate = template;
                        break;
                    }
                }
                if (matchedScenario) break;
            }
            
            if (!matchedScenario) {
                logger.warn('[GATEKEEPER] LLM returned unknown scenario ID', {
                    scenarioId: llmResponse.scenarioId
                });
                return null;
            }
            
            // ────────────────────────────────────────────────────────────────
            // Calculate cost (rough estimate based on tokens)
            // ────────────────────────────────────────────────────────────────
            const inputTokens = completion.data.usage.prompt_tokens;
            const outputTokens = completion.data.usage.completion_tokens;
            
            // GPT-4 pricing (approximate): $0.03/1K input, $0.06/1K output
            const cost = ((inputTokens / 1000) * 0.03) + ((outputTokens / 1000) * 0.06);
            
            return {
                result: {
                    matched: true,
                    confidence: llmResponse.confidence || 0.9,
                    scenarioName: matchedScenario.name,
                    scenarioId: matchedScenario.scenarioId,
                    response: matchedScenario.responseVariations?.[0] || 'Response not available',
                    category: matchedCategory.name,
                    template: matchedTemplate.name,
                    matchType: 'llm',
                    llmReasoning: llmResponse.reasoning,
                    llmModel: 'gpt-4'
                },
                cost,
                tokensUsed: completion.data.usage,
                responseTime
            };
            
        } catch (error) {
            logger.error('[GATEKEEPER] Tier 3 LLM error', {
                error: error.message,
                stack: error.stack
            });
            
            throw error; // Re-throw to be caught by processQuery
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 🔧 UTILITY: Basic Template Matching (When Gatekeeper Disabled)
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Fallback to basic template matching when gatekeeper is disabled
     */
    async basicTemplateMatch(query, templates) {
        try {
            const HybridScenarioSelector = require('./HybridScenarioSelector');
            const result = await HybridScenarioSelector.selectScenario(query, { aiAgentLogic: {} }, templates);
            
            if (result && result.scenario) {
                return {
                    matched: true,
                    confidence: result.confidence || 0,
                    scenarioName: result.scenario.name,
                    scenarioId: result.scenario.scenarioId,
                    response: result.scenario.responseVariations?.[0] || 'Response not available',
                    category: result.category?.name,
                    template: result.template?.name,
                    matchType: 'basic',
                    tier: 0 // No tier (gatekeeper disabled)
                };
            }
            
            return null;
            
        } catch (error) {
            logger.error('[GATEKEEPER] Basic match error', {
                error: error.message
            });
            
            return null;
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 📊 UTILITY: Update Company Metrics
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Updates company-level performance metrics (non-blocking)
     */
    async updateCompanyMetrics(companyId, metricType, responseTime) {
        try {
            const updateData = {
                $inc: {},
                $set: {
                    'aiAgentLogic.templateGatekeeper.metrics.lastUpdated': new Date()
                }
            };
            
            // Increment the specific metric
            updateData.$inc[`aiAgentLogic.templateGatekeeper.metrics.${metricType}`] = 1;
            
            await Company.findByIdAndUpdate(companyId, updateData);
            
            logger.debug('[GATEKEEPER] Company metrics updated', {
                companyId,
                metricType,
                responseTime
            });
            
        } catch (error) {
            logger.error('[GATEKEEPER] Failed to update company metrics', {
                companyId,
                error: error.message
            });
        }
    }

    // ════════════════════════════════════════════════════════════════════════
    // 📊 UTILITY: Get Gatekeeper Metrics
    // ════════════════════════════════════════════════════════════════════════
    /**
     * Returns current gatekeeper performance metrics
     */
    getMetrics() {
        return {
            ...this.metrics,
            tier3Enabled: this.TIER_3_ENABLED,
            timestamp: new Date()
        };
    }
}

// ============================================================================
// 🚀 EXPORT SINGLETON INSTANCE
// ============================================================================

module.exports = new TemplateGatekeeper();

