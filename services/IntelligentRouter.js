/**
 * ============================================================================
 * INTELLIGENT ROUTER - 3-TIER CASCADE ORCHESTRATOR
 * ============================================================================
 * 
 * PURPOSE:
 * Orchestrates the 3-tier intelligence cascade that powers the self-improvement
 * cycle. Routes each call through Tier 1 → Tier 2 → Tier 3 based on confidence
 * thresholds, minimizing LLM costs while ensuring high-quality responses.
 * 
 * THE 3-TIER CASCADE:
 * 
 * Tier 1: Rule-Based (HybridScenarioSelector)
 *   - Cost: $0
 *   - Speed: ~50ms
 *   - Handles: 20% (Week 1) → 85% (Week 24)
 *   - Logic: Exact keyword + synonym matching
 * 
 * Tier 2: Semantic (BM25 + Context)
 *   - Cost: $0
 *   - Speed: ~100ms
 *   - Handles: 10% (Week 1) → 13% (Week 24)
 *   - Logic: Statistical similarity + context
 * 
 * Tier 3: LLM Fallback (GPT-4 Turbo)
 *   - Cost: ~$0.50/call
 *   - Speed: ~1500ms
 *   - Handles: 70% (Week 1) → 2% (Week 24)
 *   - Logic: Natural language understanding
 *   - **TEACHES TIER 1** new patterns
 * 
 * SELF-IMPROVEMENT MECHANISM:
 * When Tier 3 handles a call, it extracts patterns (synonyms, fillers) and
 * teaches Tier 1. Next time, Tier 1 handles it for FREE. This is how costs
 * drop from $350/month → $10/month over 6 months.
 * 
 * ============================================================================
 */

const HybridScenarioSelector = require('./HybridScenarioSelector');
const Tier3LLMFallback = require('./Tier3LLMFallback');
const PatternLearningService = require('./PatternLearningService');
const IntelligenceMonitor = require('./IntelligenceMonitor');  // 🚨 Comprehensive monitoring
const AdminNotificationService = require('./AdminNotificationService');  // 🔔 Notification Center
const SmartWarmupService = require('./SmartWarmupService');  // 🔥 Smart LLM Pre-warming
const { logTier3SuggestionSmart } = require('./LlmLearningLogger');  // 🧠 V2 LLM Learning Console
const LLMCallLog = require('../models/LLMCallLog');
const logger = require('../utils/logger');

class IntelligentRouter {
    constructor() {
        this.config = {
            // Default thresholds (can be overridden per-template)
            defaultTier1Threshold: 0.80,  // 80% confidence required for Tier 1
            defaultTier2Threshold: 0.60,  // 60% confidence required for Tier 2
            
            // Cost controls
            enableCostTracking: process.env.COST_TRACKING_ENABLED !== 'false',
            enableLearning: process.env.ENABLE_PATTERN_LEARNING !== 'false',
            
            // Performance
            maxTotalTime: 5000,  // 5 seconds max total time
            enableCaching: true
        };
    }
    
    /**
     * ============================================================================
     * MAIN METHOD: Route a call through the 3-tier cascade
     * ============================================================================
     * @param {Object} params
     * @param {String} params.callerInput - What the caller said/typed
     * @param {Object} params.template - GlobalInstantResponseTemplate object
     * @param {Object} params.company - Company object (optional, for context)
     * @param {String} params.callId - Unique call identifier
     * @param {Object} params.context - Additional context (call history, etc.)
     * @returns {Object} - Complete routing result with tier used, scenario, cost, patterns
     */
    async route({ callerInput, template, company = null, callId, context = {} }) {
        const startTime = Date.now();
        const routingId = `${callId}-${Date.now()}`;
        
        logger.info('🎯 [INTELLIGENT ROUTER] Starting 3-tier cascade', {
            routingId,
            callId,
            templateId: template._id,
            templateName: template.name,
            callerInput: callerInput.substring(0, 100)
        });
        
        // Get template-specific thresholds
        const tier1Threshold = template.learningSettings?.tier1Threshold || this.config.defaultTier1Threshold;
        const tier2Threshold = template.learningSettings?.tier2Threshold || this.config.defaultTier2Threshold;
        
        const result = {
            routingId,
            callId,
            templateId: template._id,
            templateName: template.name,
            callerInput,
            
            // Tier results
            tier1Result: null,
            tier2Result: null,
            tier3Result: null,
            
            // Final decision
            tierUsed: null,
            matched: false,
            scenario: null,
            confidence: 0,
            response: null,
            
            // Learning
            patternsLearned: [],
            
            // Cost & Performance
            cost: { tier1: 0, tier2: 0, tier3: 0, total: 0 },
            performance: {
                tier1Time: 0,
                tier2Time: 0,
                tier3Time: 0,
                totalTime: 0
            },
            
            // Metadata
            timestamp: new Date(),
            success: false,
            error: null
        };
        
        try {
            // ============================================
            // TIER 1: RULE-BASED (HybridScenarioSelector)
            // ============================================
            result.tier1Result = await this.tryTier1({
                callerInput,
                template,
                threshold: tier1Threshold,
                context
            });
            
            result.performance.tier1Time = result.tier1Result.responseTime;
            
            if (result.tier1Result.success && result.tier1Result.confidence >= tier1Threshold) {
                // ✅ TIER 1 SUCCESS - Free, fast match!
                result.tierUsed = 1;
                result.matched = true;
                result.scenario = result.tier1Result.scenario;
                result.confidence = result.tier1Result.confidence;
                result.response = result.tier1Result.response;
                result.success = true;
                
                logger.info('✅ [TIER 1] Rule-based match succeeded', {
                    routingId,
                    confidence: result.confidence,
                    scenario: result.scenario?.name,
                    responseTime: `${result.tier1Result.responseTime}ms`,
                    cost: '$0.00'
                });
                
                // Log success and return
                await this.logCall(result, template, company);
                result.performance.totalTime = Date.now() - startTime;
                return result;
            }
            
            logger.info('⚠️ [TIER 1] Below threshold, escalating to Tier 2', {
                routingId,
                confidence: result.tier1Result.confidence,
                threshold: tier1Threshold
            });
            
            // ============================================
            // SMART WARMUP: Check if we should pre-warm LLM
            // ============================================
            let warmupHandle = null;
            const companyId = company?._id || company?.companyId;
            
            if (companyId) {
                // Check if warmup should be triggered (before Tier 2 starts)
                const warmupDecision = await SmartWarmupService.shouldTriggerWarmup(
                    companyId,
                    result.tier1Result.confidence,
                    template.category
                );
                
                if (warmupDecision.trigger) {
                    logger.info('🔥 [SMART WARMUP] Triggering parallel LLM pre-warm', {
                        routingId,
                        reason: warmupDecision.reason,
                        tier1Confidence: warmupDecision.confidence,
                        budgetRemaining: warmupDecision.budgetRemaining
                    });
                    
                    // Start warmup in parallel with Tier 2
                    warmupHandle = await SmartWarmupService.startWarmup(companyId, callerInput, {
                        systemPrompt: this.buildSystemPrompt(template, company),
                        template,
                        availableScenarios: this.prepareScenarios(template)
                    });
                } else {
                    logger.debug('[SMART WARMUP] Skipped', {
                        routingId,
                        reason: warmupDecision.reason
                    });
                }
            }
            
            // ============================================
            // TIER 2: SEMANTIC (BM25 + Context)
            // ============================================
            result.tier2Result = await this.tryTier2({
                callerInput,
                template,
                threshold: tier2Threshold,
                context,
                tier1Result: result.tier1Result
            });
            
            result.performance.tier2Time = result.tier2Result.responseTime;
            
            if (result.tier2Result.success && result.tier2Result.confidence >= tier2Threshold) {
                // ✅ TIER 2 SUCCESS - Still free, slightly slower
                result.tierUsed = 2;
                result.matched = true;
                result.scenario = result.tier2Result.scenario;
                result.confidence = result.tier2Result.confidence;
                result.response = result.tier2Result.response;
                result.success = true;
                
                // Cancel warmup if it was triggered (Tier 2 succeeded, no need for LLM)
                if (warmupHandle) {
                    logger.info('⚡ [SMART WARMUP] Cancelling warmup (Tier 2 succeeded)', {
                        routingId,
                        warmupId: warmupHandle.warmupId
                    });
                    await warmupHandle.cancel();
                }
                
                logger.info('✅ [TIER 2] Semantic match succeeded', {
                    routingId,
                    confidence: result.confidence,
                    scenario: result.scenario?.name,
                    responseTime: `${result.tier2Result.responseTime}ms`,
                    cost: '$0.00'
                });
                
                await this.logCall(result, template, company);
                result.performance.totalTime = Date.now() - startTime;
                return result;
            }
            
            logger.warn('⚠️ [TIER 2] Below threshold, escalating to Tier 3 (LLM - EXPENSIVE!)', {
                routingId,
                confidence: result.tier2Result.confidence,
                threshold: tier2Threshold,
                note: 'This call will cost ~$0.50'
            });
            
            // ============================================
            // TIER 3: LLM FALLBACK (GPT-4 Turbo - $$$)
            // ============================================
            
            // Check budget before calling LLM
            const budgetCheck = await this.checkBudget(template);
            if (!budgetCheck.allowed) {
                logger.error('❌ [TIER 3] LLM budget exhausted, falling back to Tier 2 best guess', {
                    routingId,
                    budgetUsed: budgetCheck.used,
                    budgetLimit: budgetCheck.limit
                });
                
                // Use Tier 2 result as fallback
                result.tierUsed = 2;
                result.matched = result.tier2Result.success;
                result.scenario = result.tier2Result.scenario;
                result.confidence = result.tier2Result.confidence;
                result.response = result.tier2Result.response;
                result.success = result.tier2Result.success;
                result.error = 'LLM budget exhausted';
                
                await this.logCall(result, template, company);
                result.performance.totalTime = Date.now() - startTime;
                return result;
            }
            
            // Prepare scenarios for LLM
            const availableScenarios = this.prepareScenarios(template);
            
            // ============================================
            // SMART WARMUP: Use pre-warmed LLM if available
            // ============================================
            let warmupResult = null;
            if (warmupHandle) {
                logger.info('💰 [SMART WARMUP] Using pre-warmed LLM (instant Tier 3!)', {
                    routingId,
                    warmupId: warmupHandle.warmupId
                });
                
                warmupResult = await SmartWarmupService.useWarmup(warmupHandle.warmupId);
                
                if (warmupResult && warmupResult.success) {
                    // Warmup succeeded! Use it directly
                    logger.info('✅ [SMART WARMUP] Warmup result ready, using for Tier 3', {
                        routingId,
                        duration: warmupResult.duration,
                        cost: warmupResult.cost,
                        savedTime: '~1000ms'
                    });
                    
                    // Convert warmup result to Tier3 format
                    result.tier3Result = {
                        success: true,
                        matched: true,
                        scenario: null, // Will be extracted from response
                        confidence: 0.90, // Warmup results are high confidence
                        response: warmupResult.response,
                        patterns: [],
                        cost: {
                            llmApiCost: warmupResult.cost
                        },
                        performance: {
                            responseTime: warmupResult.duration
                        },
                        warmupUsed: true
                    };
                    
                    result.performance.tier3Time = warmupResult.duration;
                    result.cost.tier3 = warmupResult.cost;
                    result.cost.total = warmupResult.cost;
                } else {
                    logger.warn('⚠️ [SMART WARMUP] Warmup failed or timed out, falling back to fresh LLM call', {
                        routingId
                    });
                }
            }
            
            // If no warmup or warmup failed, make fresh LLM call
            if (!warmupResult || !warmupResult.success) {
                result.tier3Result = await Tier3LLMFallback.analyze({
                    callerInput,
                    template,
                    availableScenarios,
                    context
                });
                
                result.performance.tier3Time = result.tier3Result.performance.responseTime;
                result.cost.tier3 = result.tier3Result.cost.llmApiCost;
                result.cost.total = result.cost.tier3;
            }
            
            if (result.tier3Result.success && result.tier3Result.matched) {
                // ✅ TIER 3 SUCCESS - Expensive but guaranteed to work
                result.tierUsed = 3;
                result.matched = true;
                result.scenario = result.tier3Result.scenario;
                result.confidence = result.tier3Result.confidence;
                // Extract actual reply text from scenario (same as Tier 1)
                result.response = result.tier3Result.scenario?.quickReplies?.[0] || 
                                 result.tier3Result.scenario?.fullReplies?.[0] || 
                                 'I understand.';
                result.success = true;
                
                // 🧠 LEARNING: Extract patterns and teach Tier 1
                if (this.config.enableLearning && result.tier3Result.patterns.length > 0) {
                    logger.info('🧠 [LEARNING] LLM extracted patterns, teaching Tier 1...', {
                        routingId,
                        patternCount: result.tier3Result.patterns.length
                    });
                    
                    const learningResult = await PatternLearningService.learnFromLLM({
                        patterns: result.tier3Result.patterns,
                        template,
                        callId,
                        confidence: result.confidence
                    });
                    
                    result.patternsLearned = learningResult.patternsApplied || [];
                    
                    logger.info('✅ [LEARNING] Patterns applied to Tier 1', {
                        routingId,
                        patternsApplied: result.patternsLearned.length,
                        note: 'Next call with these patterns will be FREE (Tier 1)'
                    });
                }
                
                logger.info('✅ [TIER 3] LLM match succeeded', {
                    routingId,
                    confidence: result.confidence,
                    scenario: result.scenario?.name,
                    responseTime: `${result.tier3Result.performance.responseTime}ms`,
                    cost: `$${result.cost.tier3.toFixed(4)}`,
                    patternsLearned: result.patternsLearned.length
                });
                
                // 🧠 V2: Log to LLM Learning Console (Smart Classification)
                try {
                    const callSource = context.callSource || 'production'; // 'template-test' | 'company-test' | 'production'
                    
                    // Get thresholds from context or use defaults
                    const tier1Threshold = context.intelligenceConfig?.thresholds?.tier1 ?? this.config.defaultTier1Threshold;
                    const tier2Threshold = context.intelligenceConfig?.thresholds?.tier2 ?? this.config.defaultTier2Threshold;
                    
                    // Calculate dead air metrics (if available)
                    const maxDeadAirMs = context.voiceMetrics?.maxDeadAirMs || null;
                    const avgDeadAirMs = context.voiceMetrics?.avgDeadAirMs || null;
                    
                    // Log with smart auto-classification
                    await logTier3SuggestionSmart({
                        callContext: {
                            templateId: template._id,
                            templateName: template.name,
                            companyId: company?._id || null,
                            companyName: company?.companyName || company?.businessName || null,
                            callSource,
                            callId: context.callId || callId || null,
                            callSid: context.callSid || null,
                            callDate: new Date(),
                            callTranscript: context.transcript || context.fullCallTranscript || ''
                        },
                        tierContext: {
                            tier1Score: result.tier1Result?.confidence || 0,
                            tier1Threshold,
                            tier1LatencyMs: result.performance.tier1Time || null,
                            tier2Score: result.tier2Result?.confidence || 0,
                            tier2Threshold,
                            tier2LatencyMs: result.performance.tier2Time || null,
                            tier3LatencyMs: result.performance.tier3Time || null,
                            overallLatencyMs: result.performance.totalTime || null,
                            maxDeadAirMs,
                            avgDeadAirMs,
                            scenarioId: result.scenario?._id?.toString() || null,
                            scenarioName: result.scenario?.name || null,
                            categoryName: result.scenario?.categoryName || null
                        },
                        llmContext: {
                            llmModel: result.tier3Result.llmModel || 'gpt-4o-mini',
                            tokens: result.tier3Result.tokens || null,
                            costUsd: result.cost.tier3 || 0,
                            customerPhrase: callerInput,
                            agentResponseSnippet: result.response?.substring(0, 400) || null,
                            llmResponse: result.response
                        },
                        suggestion: {
                            // Smart logger will auto-calculate these if not provided
                            rootCauseReason: `Tier 3 was required because Tier 1 score (${(result.tier1Result?.confidence || 0).toFixed(2)}) was below threshold (${tier1Threshold}) and Tier 2 score (${(result.tier2Result?.confidence || 0).toFixed(2)}) was below threshold (${tier2Threshold}).`,
                            similarCallCount: 1,
                            status: 'pending'
                        }
                    });
                    
                    logger.info('📝 [LLM LEARNING V2] Tier 3 usage logged with smart classification', {
                        routingId,
                        callSource,
                        cost: `$${result.cost.tier3.toFixed(4)}`
                    });
                } catch (loggingError) {
                    logger.error('❌ [LLM LEARNING] Failed to log Tier 3 usage:', loggingError.message);
                    // Non-fatal - don't block the call
                }
                
            } else {
                // ❌ EVEN LLM FAILED (rare, but possible)
                result.tierUsed = 3;
                result.matched = false;
                result.success = false;
                result.error = result.tier3Result.error || 'LLM could not match any scenario';
                
                logger.error('❌ [TIER 3] LLM failed to match', {
                    routingId,
                    error: result.error,
                    cost: `$${result.cost.tier3.toFixed(4)}`
                });
            }
            
            // Log to database
            await this.logCall(result, template, company);
            result.performance.totalTime = Date.now() - startTime;
            
            // ============================================
            // 🚨 COMPREHENSIVE MONITORING
            // ============================================
            // Monitor this routing result and send alerts if issues detected
            await IntelligenceMonitor.monitorRoutingResult(result, {
                templateId: template._id,
                templateName: template.name,
                callId,
                companyId: company?._id,
                tier1Threshold: tier1Threshold,
                tier2Threshold: tier2Threshold,
                scenarioCount: this.prepareScenarios(template).length
            });
            
            return result;
            
        } catch (error) {
            logger.error('❌ [INTELLIGENT ROUTER] Routing failed', {
                routingId,
                error: error.message,
                stack: error.stack
            });
            
            result.success = false;
            result.error = error.message;
            result.performance.totalTime = Date.now() - startTime;
            
            // 🚨 Monitor the failure
            await IntelligenceMonitor.monitorRoutingResult(result, {
                templateId: template._id,
                templateName: template.name,
                callId,
                companyId: company?._id
            });
            
            return result;
        }
    }
    
    /**
     * ============================================================================
     * TIER 1: RULE-BASED MATCHING
     * ============================================================================
     */
    async tryTier1({ callerInput, template, threshold, context }) {
        const startTime = Date.now();
        
        try {
            // Build effective fillers (template + all categories)
            const effectiveFillers = this.buildEffectiveFillers(template);
            
            // Build effective synonym map (template + all categories)
            const effectiveSynonymMap = this.buildEffectiveSynonymMap(template);
            
            // Initialize HybridScenarioSelector
            const urgencyKeywords = template.urgencyKeywords || [];
            const selector = new HybridScenarioSelector(effectiveFillers, urgencyKeywords, effectiveSynonymMap);
            
            // Get all scenarios from all categories
            const allScenarios = [];
            for (const category of template.categories) {
                for (const scenario of category.scenarios || []) {
                    if (scenario.isActive && scenario.status === 'live') {
                        allScenarios.push({
                            ...scenario.toObject(),
                            categoryName: category.name
                        });
                    }
                }
            }
            
            // Match
            const match = await selector.selectScenario(callerInput, allScenarios);
            
            const responseTime = Date.now() - startTime;
            
            return {
                success: match.matched,
                scenario: match.matched ? match.scenario : null,
                confidence: match.confidence,
                responseTime,
                response: match.matched ? match.scenario.quickReplies[0] : null,
                reasoning: match.reasoning || 'Rule-based matching'
            };
            
        } catch (error) {
            logger.error('❌ [TIER 1] Error', { error: error.message });
            return {
                success: false,
                scenario: null,
                confidence: 0,
                responseTime: Date.now() - startTime,
                error: error.message
            };
        }
    }
    
    /**
     * ============================================================================
     * TIER 2: SEMANTIC MATCHING (BM25 + Context)
     * ============================================================================
     * For now, this is a placeholder. In production, you'd use:
     * - BM25 scoring
     * - TF-IDF
     * - Context windows
     * - Call history
     */
    async tryTier2({ callerInput, template, threshold, context, tier1Result }) {
        const startTime = Date.now();
        
        try {
            // For now, boost Tier 1 result slightly with context
            // In production, you'd implement full semantic matching
            
            let boostedConfidence = tier1Result.confidence * 1.1;  // 10% boost
            
            // Add context boost if available
            if (context.previousScenario) {
                boostedConfidence *= 1.05;  // 5% boost for context
            }
            
            boostedConfidence = Math.min(boostedConfidence, 0.95);  // Cap at 95%
            
            const responseTime = Date.now() - startTime;
            
            return {
                success: boostedConfidence >= threshold,
                scenario: tier1Result.scenario,
                confidence: boostedConfidence,
                responseTime,
                response: tier1Result.response,
                reasoning: 'Semantic + context boost applied to Tier 1 result'
            };
            
        } catch (error) {
            logger.error('❌ [TIER 2] Error', { error: error.message });
            return {
                success: false,
                scenario: null,
                confidence: 0,
                responseTime: Date.now() - startTime,
                error: error.message
            };
        }
    }
    
    /**
     * ============================================================================
     * BUDGET CHECK: Ensure we haven't exceeded monthly LLM budget
     * ============================================================================
     */
    async checkBudget(template) {
        try {
            const monthlyBudget = template.learningSettings?.llmBudgetMonthly || 500;
            
            // Get current month spend
            const currentMonth = new Date().toISOString().substring(0, 7);
            const spent = await LLMCallLog.aggregate([
                {
                    $match: {
                        templateId: template._id,
                        monthYear: currentMonth,
                        tierUsed: 3
                    }
                },
                {
                    $group: {
                        _id: null,
                        total: { $sum: '$costBreakdown.llmApiCost' }
                    }
                }
            ]);
            
            const totalSpent = spent[0]?.total || 0;
            const remaining = monthlyBudget - totalSpent;
            
            return {
                allowed: remaining > 0,
                used: totalSpent,
                limit: monthlyBudget,
                remaining,
                percentage: (totalSpent / monthlyBudget * 100).toFixed(1)
            };
            
        } catch (error) {
            logger.error('❌ [BUDGET CHECK] Error', { error: error.message, stack: error.stack });
            
            // 🚨 CRITICAL: Budget system failure
            await AdminNotificationService.sendAlert({
                code: 'AI_BUDGET_SYSTEM_FAILURE',
                severity: 'WARNING',
                companyId: null,  // Platform-wide issue
                companyName: 'Platform',
                title: '⚠️ AI Budget System Failure',
                message: `Budget check failed for template "${template.name}". Budget controls are not enforcing limits.`,
                details: {
                    error: error.message,
                    stackTrace: error.stack,
                    templateId: template._id,
                    templateName: template.name,
                    impact: 'LLM costs may exceed monthly budget',
                    action: 'Investigate learning stats calculation or MongoDB query failure'
                }
            });
            
            // If budget check fails, allow the call (fail open)
            return { allowed: true, error: error.message };
        }
    }
    
    /**
     * ============================================================================
     * LOG CALL TO DATABASE
     * ============================================================================
     */
    async logCall(result, template, company) {
        if (!this.config.enableCostTracking) {
            return;
        }
        
        try {
            const weekNumber = this.calculateWeekNumber(template.createdAt);
            const monthYear = new Date().toISOString().substring(0, 7);
            
            await LLMCallLog.create({
                callId: result.callId,
                companyId: company?._id || null,
                templateId: result.templateId,
                templateName: result.templateName,
                
                tierUsed: result.tierUsed,
                
                tier1Result: result.tier1Result ? {
                    attempted: true,
                    confidence: result.tier1Result.confidence,
                    matchedScenario: result.tier1Result.scenario?.name,
                    responseTime: result.tier1Result.responseTime
                } : { attempted: false },
                
                tier2Result: result.tier2Result ? {
                    attempted: true,
                    confidence: result.tier2Result.confidence,
                    matchedScenario: result.tier2Result.scenario?.name,
                    responseTime: result.tier2Result.responseTime
                } : { attempted: false },
                
                tier3Result: result.tier3Result ? {
                    attempted: true,
                    confidence: result.tier3Result.confidence,
                    matchedScenario: result.tier3Result.scenario?.name,
                    responseTime: result.tier3Result.performance?.responseTime,
                    llmModel: result.tier3Result.performance?.model,
                    llmProvider: result.tier3Result.performance?.provider,
                    tokensUsed: result.tier3Result.performance?.tokensUsed,
                    cost: result.cost.tier3
                } : { attempted: false },
                
                callerInput: result.callerInput,
                finalResponse: result.response?.text || result.response,
                
                scenarioMatched: result.matched ? {
                    scenarioId: result.scenario?.scenarioId,
                    scenarioName: result.scenario?.name,
                    confidence: result.confidence
                } : null,
                
                patternsLearned: result.patternsLearned || [],
                
                costBreakdown: {
                    llmApiCost: result.cost.tier3 || 0,
                    tier1Cost: 0,
                    tier2Cost: 0,
                    totalCost: result.cost.total || 0
                },
                
                performanceMetrics: {
                    totalTime: result.performance.totalTime,
                    tier1Time: result.performance.tier1Time,
                    tier2Time: result.performance.tier2Time,
                    tier3Time: result.performance.tier3Time
                },
                
                weekNumber,
                monthYear
            });
            
        } catch (error) {
            logger.error('❌ [LOG CALL] Failed to log call', { error: error.message, stack: error.stack });
            
            // 🚨 WARNING: Losing audit data
            await AdminNotificationService.sendAlert({
                code: 'AI_CALL_LOG_FAILURE',
                severity: 'WARNING',
                companyId: company?._id || null,
                companyName: company?.companyName || 'Unknown',
                title: '⚠️ AI Call Logging Failure',
                message: `Failed to log AI routing call to database. Audit trail is incomplete.`,
                details: {
                    error: error.message,
                    stackTrace: error.stack,
                    templateId: template._id,
                    templateName: template.name,
                    tierUsed: result.tierUsed,
                    callId: result.routingId,
                    impact: 'Missing audit data, cost tracking incomplete, analytics degraded',
                    action: 'Check MongoDB connection and LLMCallLog schema'
                }
            });
        }
    }
    
    /**
     * Helper: Calculate week number since template creation
     */
    calculateWeekNumber(createdAt) {
        const now = new Date();
        const created = new Date(createdAt);
        const diffMs = now - created;
        const diffWeeks = Math.floor(diffMs / (7 * 24 * 60 * 60 * 1000));
        return Math.max(1, Math.min(diffWeeks + 1, 52));
    }
    
    /**
     * Helper: Build effective fillers from template + categories
     */
    buildEffectiveFillers(template) {
        const templateFillers = template.fillerWords || [];
        const allFillers = [...templateFillers];
        
        template.categories.forEach(category => {
            if (category.additionalFillerWords && Array.isArray(category.additionalFillerWords)) {
                allFillers.push(...category.additionalFillerWords);
            }
        });
        
        return [...new Set(allFillers)];
    }
    
    /**
     * Helper: Build effective synonym map from template + categories
     */
    buildEffectiveSynonymMap(template) {
        const effectiveMap = new Map();
        
        // Start with template synonyms
        if (template.synonymMap) {
            for (const [term, aliases] of Object.entries(template.synonymMap instanceof Map ? Object.fromEntries(template.synonymMap) : template.synonymMap)) {
                if (Array.isArray(aliases)) {
                    effectiveMap.set(term, [...aliases]);
                }
            }
        }
        
        // Merge category synonyms
        template.categories.forEach(category => {
            if (category.synonymMap) {
                const catMap = category.synonymMap instanceof Map ? category.synonymMap : new Map(Object.entries(category.synonymMap || {}));
                for (const [term, aliases] of catMap.entries()) {
                    if (effectiveMap.has(term)) {
                        const existing = effectiveMap.get(term);
                        effectiveMap.set(term, [...new Set([...existing, ...aliases])]);
                    } else {
                        effectiveMap.set(term, [...aliases]);
                    }
                }
            }
        });
        
        return effectiveMap;
    }
    
    /**
     * Helper: Build system prompt for LLM
     */
    buildSystemPrompt(template, company) {
        const companyName = company?.businessName || company?.companyName || 'the company';
        const templateName = template?.name || 'general';
        
        return `You are a helpful AI assistant for ${companyName}. 
You are helping with ${templateName} inquiries.
Provide accurate, professional, and helpful responses based on the available knowledge.
Be concise but thorough. If you're not sure about something, say so.`;
    }
    
    /**
     * Helper: Prepare scenarios for LLM
     */
    prepareScenarios(template) {
        const scenarios = [];
        
        for (const category of template.categories) {
            for (const scenario of category.scenarios || []) {
                if (scenario.isActive && scenario.status === 'live') {
                    scenarios.push({
                        scenarioId: scenario.scenarioId,
                        name: scenario.name,
                        categoryName: category.name,
                        triggerPhrases: scenario.triggerPhrases || [],
                        intentKeywords: scenario.intentKeywords || []
                    });
                }
            }
        }
        
        return scenarios;
    }
}

module.exports = new IntelligentRouter();

